import { Test, TestingModule } from '@nestjs/testing';
import { SubmissionsController } from './submissions.controller.js';
import { SubmissionsService } from './submissions.service.js';

const mockSubmissionsService = {
  getMySubmissions: jest.fn(),
};

const mockResponse = {
  data: [],
  total: 0,
  page: 1,
  limit: 20,
};

describe('SubmissionsController', () => {
  let controller: SubmissionsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubmissionsController],
      providers: [{ provide: SubmissionsService, useValue: mockSubmissionsService }],
    }).compile();

    controller = module.get<SubmissionsController>(SubmissionsController);
  });

  describe('getMySubmissions', () => {
    it('should call service with userId, page, and limit', async () => {
      mockSubmissionsService.getMySubmissions.mockResolvedValueOnce(mockResponse);

      const result = await controller.getMySubmissions('user-uuid', { page: 1, limit: 20 });

      expect(result).toEqual(mockResponse);
      expect(mockSubmissionsService.getMySubmissions).toHaveBeenCalledWith('user-uuid', 1, 20);
    });

    it('should use default page=1 and limit=20 when params are defaults', async () => {
      mockSubmissionsService.getMySubmissions.mockResolvedValueOnce(mockResponse);

      await controller.getMySubmissions('user-uuid', { page: 1, limit: 20 });

      expect(mockSubmissionsService.getMySubmissions).toHaveBeenCalledWith('user-uuid', 1, 20);
    });

    it('should pass custom page and limit to service', async () => {
      mockSubmissionsService.getMySubmissions.mockResolvedValueOnce({
        ...mockResponse,
        page: 3,
        limit: 10,
      });

      await controller.getMySubmissions('user-uuid', { page: 3, limit: 10 });

      expect(mockSubmissionsService.getMySubmissions).toHaveBeenCalledWith('user-uuid', 3, 10);
    });
  });
});
