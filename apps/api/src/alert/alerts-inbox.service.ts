import { Injectable, NotFoundException } from '@nestjs/common';
import type { DriverAlert, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Story 6.11 — driver-facing alerts inbox. Renders past pushes as a
 * persistent, read/unread-tracked list so drivers can recover alerts
 * that scrolled out of their notification tray. Backend is shared by
 * all alert types (`price_rise`, `alerts_expiring_warning`, future
 * 6.1 / 6.2 / 6.5 alerts) — `alert_type` is a free-form string column
 * so new types ship via additive code change with no migration.
 */
export interface AlertRow {
  id: string;
  alert_type: string;
  title: string;
  body: string;
  sent_at: string;
  read_at: string | null;
  payload: Prisma.JsonValue | null;
}

export interface AlertListResult {
  data: AlertRow[];
  total: number;
  unread_count: number;
  page: number;
  limit: number;
}

const toRow = (a: DriverAlert): AlertRow => ({
  id: a.id,
  alert_type: a.alert_type,
  title: a.title,
  body: a.body,
  sent_at: a.sent_at.toISOString(),
  read_at: a.read_at ? a.read_at.toISOString() : null,
  payload: a.payload,
});

@Injectable()
export class AlertsInboxService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string, page: number, limit: number): Promise<AlertListResult> {
    const skip = (page - 1) * limit;

    const [rows, total, unread_count] = await Promise.all([
      this.prisma.driverAlert.findMany({
        where: { user_id: userId },
        orderBy: { sent_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.driverAlert.count({ where: { user_id: userId } }),
      this.prisma.driverAlert.count({ where: { user_id: userId, read_at: null } }),
    ]);

    return {
      data: rows.map(toRow),
      total,
      unread_count,
      page,
      limit,
    };
  }

  /**
   * Mark a single inbox row as read. Idempotent — calling on an already-read
   * row is a no-op success. Calling on a row owned by another user returns
   * 404 (not 403) so the existence of someone else's alert id isn't leaked.
   *
   * P1 (6.11 review) — single atomic `updateMany` with `read_at: null`
   * predicate is the claim. Two concurrent calls that race the old
   * findFirst-then-update pattern would both pass the null gate and both
   * fire updates; here only the first to land sets `count: 1`, the
   * second sees `count: 0` and short-circuits via the existence check.
   */
  async markRead(userId: string, alertId: string): Promise<AlertRow> {
    const claim = await this.prisma.driverAlert.updateMany({
      where: { id: alertId, user_id: userId, read_at: null },
      data: { read_at: new Date() },
    });

    if (claim.count === 0) {
      // Either the row doesn't exist for this user, or it was already read.
      // Disambiguate without leaking existence to non-owners.
      const existing = await this.prisma.driverAlert.findFirst({
        where: { id: alertId, user_id: userId },
      });
      if (!existing) {
        throw new NotFoundException('Alert not found');
      }
      return toRow(existing);
    }

    const updated = await this.prisma.driverAlert.findUniqueOrThrow({
      where: { id: alertId },
    });
    return toRow(updated);
  }

  async markAllRead(userId: string): Promise<{ marked_read: number }> {
    const result = await this.prisma.driverAlert.updateMany({
      where: { user_id: userId, read_at: null },
      data: { read_at: new Date() },
    });
    return { marked_read: result.count };
  }
}
