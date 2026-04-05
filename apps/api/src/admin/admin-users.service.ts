import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const AUDIT_ACTION_SHADOW_BAN = 'SHADOW_BAN';
const AUDIT_ACTION_UNBAN = 'UNBAN';

export interface UserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  trust_score: number;
  shadow_banned: boolean;
  submission_count: number;
  active_alert_count: number;
  created_at: Date;
}

export interface UserListResult {
  data: UserRow[];
  total: number;
  page: number;
  limit: number;
}

export interface UserSubmissionRow {
  id: string;
  station_id: string | null;
  price_data: unknown;
  status: string;
  flag_reason: string | null;
  created_at: Date;
}

export interface AnomalyAlertRow {
  id: string;
  alert_type: string;
  detail: unknown;
  created_at: Date;
  dismissed_at: Date | null;
}

export interface UserDetail {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  trust_score: number;
  shadow_banned: boolean;
  submission_count: number;
  created_at: Date;
  submissions: {
    data: UserSubmissionRow[];
    total: number;
  };
  alerts: AnomalyAlertRow[];
}

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listUsers(page: number, limit: number, search?: string): Promise<UserListResult> {
    const skip = (page - 1) * limit;
    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { display_name: { contains: search, mode: 'insensitive' as const } },
          ],
          deleted_at: null,
        }
      : { deleted_at: null };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          display_name: true,
          role: true,
          trust_score: true,
          shadow_banned: true,
          created_at: true,
          _count: { select: { submissions: true, anomalyAlerts: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // Get active (non-dismissed) alert counts separately for efficiency
    const userIds = users.map((u) => u.id);
    const activeCounts = await this.prisma.anomalyAlert.groupBy({
      by: ['user_id'],
      where: { user_id: { in: userIds }, dismissed_at: null },
      _count: { id: true },
    });
    const activeCountMap = new Map(activeCounts.map((r) => [r.user_id, r._count.id]));

    return {
      data: users.map((u) => ({
        id: u.id,
        email: u.email,
        display_name: u.display_name,
        role: u.role,
        trust_score: u.trust_score,
        shadow_banned: u.shadow_banned,
        submission_count: u._count.submissions,
        active_alert_count: activeCountMap.get(u.id) ?? 0,
        created_at: u.created_at,
      })),
      total,
      page,
      limit,
    };
  }

  async getUser(userId: string): Promise<UserDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        display_name: true,
        role: true,
        trust_score: true,
        shadow_banned: true,
        created_at: true,
        _count: { select: { submissions: true } },
      },
    });

    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const [submissions, alerts] = await Promise.all([
      this.prisma.submission.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        take: 20,
        select: {
          id: true,
          station_id: true,
          price_data: true,
          status: true,
          flag_reason: true,
          created_at: true,
        },
      }),
      this.prisma.anomalyAlert.findMany({
        where: { user_id: userId, dismissed_at: null },
        orderBy: { created_at: 'desc' },
        select: { id: true, alert_type: true, detail: true, created_at: true, dismissed_at: true },
      }),
    ]);

    const submissionCount = user._count.submissions;

    return {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      role: user.role,
      trust_score: user.trust_score,
      shadow_banned: user.shadow_banned,
      submission_count: submissionCount,
      created_at: user.created_at,
      submissions: {
        data: submissions.map((s) => ({
          id: s.id,
          station_id: s.station_id,
          price_data: s.price_data,
          status: s.status,
          flag_reason: s.flag_reason,
          created_at: s.created_at,
        })),
        total: submissionCount,
      },
      alerts,
    };
  }

  async shadowBan(userId: string, adminId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    if (user.role === UserRole.ADMIN) throw new ForbiddenException('Cannot shadow-ban an admin account');

    await this.prisma.user.update({
      where: { id: userId },
      data: { shadow_banned: true },
    });

    await this.writeAuditLog(adminId, AUDIT_ACTION_SHADOW_BAN, userId);
  }

  async unban(userId: string, adminId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    await this.prisma.user.update({
      where: { id: userId },
      data: { shadow_banned: false },
    });

    await this.writeAuditLog(adminId, AUDIT_ACTION_UNBAN, userId);
  }

  async listAlerts(userId: string): Promise<AnomalyAlertRow[]> {
    return this.prisma.anomalyAlert.findMany({
      where: { user_id: userId, dismissed_at: null },
      orderBy: { created_at: 'desc' },
      select: { id: true, alert_type: true, detail: true, created_at: true, dismissed_at: true },
    });
  }

  async dismissAlert(alertId: string, userId: string): Promise<void> {
    const alert = await this.prisma.anomalyAlert.findFirst({
      where: { id: alertId, user_id: userId },
    });

    if (!alert) throw new NotFoundException(`Alert ${alertId} not found for user ${userId}`);

    await this.prisma.anomalyAlert.update({
      where: { id: alertId },
      data: { dismissed_at: new Date() },
    });
  }

  private async writeAuditLog(adminId: string, action: string, targetUserId: string): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          admin_user_id: adminId,
          action,
          submission_id: null,
          notes: targetUserId,
        },
      });
    } catch (e: unknown) {
      this.logger.error(
        `[OPS-ALERT] Failed to write audit log for ${action} on user ${targetUserId} by admin ${adminId}: ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
