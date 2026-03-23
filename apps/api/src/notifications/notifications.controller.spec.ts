import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto.js';

const mockNotificationsService = {
  getPreferences: jest.fn(),
  updatePreferences: jest.fn(),
};

const basePreference = {
  id: 'pref-uuid-1',
  user_id: 'user-uuid',
  expo_push_token: null,
  price_drops: true,
  sharp_rise: true,
  monthly_summary: true,
  created_at: new Date('2026-03-23T12:00:00Z'),
  updated_at: new Date('2026-03-23T12:00:00Z'),
};

describe('NotificationsController', () => {
  let controller: NotificationsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  describe('getPreferences', () => {
    it('should call service.getPreferences with the userId', async () => {
      mockNotificationsService.getPreferences.mockResolvedValueOnce(basePreference);

      await controller.getPreferences('user-uuid');

      expect(mockNotificationsService.getPreferences).toHaveBeenCalledWith('user-uuid');
    });
  });

  describe('updatePreferences', () => {
    it('should call service.updatePreferences with userId and dto', async () => {
      mockNotificationsService.updatePreferences.mockResolvedValueOnce({
        ...basePreference,
        price_drops: false,
      });
      const dto: UpdateNotificationPreferencesDto = { price_drops: false };

      await controller.updatePreferences('user-uuid', dto);

      expect(mockNotificationsService.updatePreferences).toHaveBeenCalledWith('user-uuid', dto);
    });
  });
});
