import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto.js';

// Phase 1 + Phase 2 fields surfaced to the client. Phase 1 columns
// retained for back-compat with the existing alert pipeline; UI consumes
// the Phase 2 columns post-Story 6.4. expo_push_token is intentionally
// excluded — it's a write-only secret from the client's POV.
const SELECT_WITHOUT_TOKEN = {
  id: true,
  user_id: true,
  // Phase 1 (legacy)
  price_drops: true,
  sharp_rise: true,
  monthly_summary: true,
  // Phase 2 (Story 6.4)
  price_drop_enabled: true,
  price_drop_mode: true,
  price_drop_target_pln: true,
  price_drop_fuel_types: true,
  alert_radius_km: true,
  rise_community_enabled: true,
  rise_predictive_enabled: true,
  created_at: true,
  updated_at: true,
} as const;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPreferences(userId: string) {
    return this.prisma.notificationPreference.upsert({
      where: { user_id: userId },
      create: { user_id: userId },
      update: {},
      select: SELECT_WITHOUT_TOKEN,
    });
  }

  async updatePreferences(userId: string, dto: UpdateNotificationPreferencesDto) {
    return this.prisma.notificationPreference.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        // Phase 1 — Story 1.7 created these as default-true. New rows
        // born here keep the legacy default unless the DTO overrides.
        ...(dto.expo_push_token !== undefined && { expo_push_token: dto.expo_push_token }),
        price_drops: dto.price_drops ?? true,
        sharp_rise: dto.sharp_rise ?? true,
        monthly_summary: dto.monthly_summary ?? true,
        // Phase 2 — schema defaults handle the false / 'cheaper_than_now'
        // / [] / 10 baseline; DTO overrides only when explicit.
        ...(dto.price_drop_enabled !== undefined && { price_drop_enabled: dto.price_drop_enabled }),
        ...(dto.price_drop_mode !== undefined && { price_drop_mode: dto.price_drop_mode }),
        ...(dto.price_drop_target_pln !== undefined && { price_drop_target_pln: dto.price_drop_target_pln }),
        ...(dto.price_drop_fuel_types !== undefined && { price_drop_fuel_types: dto.price_drop_fuel_types }),
        ...(dto.alert_radius_km !== undefined && { alert_radius_km: dto.alert_radius_km }),
        ...(dto.rise_community_enabled !== undefined && { rise_community_enabled: dto.rise_community_enabled }),
        ...(dto.rise_predictive_enabled !== undefined && { rise_predictive_enabled: dto.rise_predictive_enabled }),
      },
      update: {
        ...(dto.expo_push_token !== undefined && { expo_push_token: dto.expo_push_token }),
        // Phase 1
        ...(dto.price_drops !== undefined && { price_drops: dto.price_drops }),
        ...(dto.sharp_rise !== undefined && { sharp_rise: dto.sharp_rise }),
        ...(dto.monthly_summary !== undefined && { monthly_summary: dto.monthly_summary }),
        // Phase 2
        ...(dto.price_drop_enabled !== undefined && { price_drop_enabled: dto.price_drop_enabled }),
        ...(dto.price_drop_mode !== undefined && { price_drop_mode: dto.price_drop_mode }),
        ...(dto.price_drop_target_pln !== undefined && { price_drop_target_pln: dto.price_drop_target_pln }),
        ...(dto.price_drop_fuel_types !== undefined && { price_drop_fuel_types: dto.price_drop_fuel_types }),
        ...(dto.alert_radius_km !== undefined && { alert_radius_km: dto.alert_radius_km }),
        ...(dto.rise_community_enabled !== undefined && { rise_community_enabled: dto.rise_community_enabled }),
        ...(dto.rise_predictive_enabled !== undefined && { rise_predictive_enabled: dto.rise_predictive_enabled }),
      },
      select: SELECT_WITHOUT_TOKEN,
    });
  }
}
