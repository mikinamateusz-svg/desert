import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto.js';

const SELECT_WITHOUT_TOKEN = {
  id: true,
  user_id: true,
  price_drops: true,
  sharp_rise: true,
  monthly_summary: true,
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
        ...(dto.expo_push_token !== undefined && { expo_push_token: dto.expo_push_token }),
        price_drops: dto.price_drops ?? true,
        sharp_rise: dto.sharp_rise ?? true,
        monthly_summary: dto.monthly_summary ?? true,
      },
      update: {
        ...(dto.expo_push_token !== undefined && { expo_push_token: dto.expo_push_token }),
        ...(dto.price_drops !== undefined && { price_drops: dto.price_drops }),
        ...(dto.sharp_rise !== undefined && { sharp_rise: dto.sharp_rise }),
        ...(dto.monthly_summary !== undefined && { monthly_summary: dto.monthly_summary }),
      },
      select: SELECT_WITHOUT_TOKEN,
    });
  }
}
