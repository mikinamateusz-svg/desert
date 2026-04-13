import { Controller, Get, Post, Body } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { OcrSpendService } from '../photo/ocr-spend.service.js';

@Controller('v1/admin/ocr-spend')
@Roles(UserRole.ADMIN)
export class AdminOcrSpendController {
  constructor(private readonly ocrSpend: OcrSpendService) {}

  /** Current daily spend, active cap, and whether an override is in effect. */
  @Get()
  async getStatus() {
    const [dailySpend, cap] = await Promise.all([
      this.ocrSpend.getDailySpend(),
      this.ocrSpend.getSpendCap(),
    ]);
    return { dailySpendUsd: dailySpend, capUsd: cap };
  }

  /** Override the daily spend cap for 24h. Pass { capUsd: 50 } or { capUsd: null } to clear. */
  @Post('cap')
  async setCapOverride(@Body() body: { capUsd: number | null }) {
    await this.ocrSpend.setSpendCapOverride(body.capUsd);
    const cap = await this.ocrSpend.getSpendCap();
    return { capUsd: cap, message: body.capUsd === null ? 'Override cleared' : `Cap set to $${cap} for 24h` };
  }
}
