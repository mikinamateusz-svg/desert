import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '@prisma/client';
import {
  AdminPriceRulesService,
  type CreateRuleInput,
  type UpdateRuleInput,
} from './admin-price-rules.service.js';

class CreateRuleDto implements CreateRuleInput {
  rule_type!: string;
  applies_to!: string;
  parameters!: unknown;
  action!: string;
  reason_code!: string;
  enabled?: boolean;
  notes?: string | null;
}

class UpdateRuleDto implements UpdateRuleInput {
  rule_type?: string;
  applies_to?: string;
  parameters?: unknown;
  action?: string;
  reason_code?: string;
  enabled?: boolean;
  notes?: string | null;
}

class SetConfigDto {
  value!: string;
  description?: string | null;
}

@Controller('v1/admin')
@Roles(UserRole.ADMIN)
export class AdminPriceRulesController {
  constructor(private readonly service: AdminPriceRulesService) {}

  // ── Rules CRUD ──────────────────────────────────────────────────────────

  @Get('price-rules')
  async listRules() {
    return this.service.list();
  }

  @Get('price-rules/:id')
  async getRule(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('price-rules')
  @HttpCode(HttpStatus.CREATED)
  async createRule(@Body() body: CreateRuleDto) {
    return this.service.create(body);
  }

  @Patch('price-rules/:id')
  async updateRule(@Param('id') id: string, @Body() body: UpdateRuleDto) {
    return this.service.update(id, body);
  }

  @Delete('price-rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRule(@Param('id') id: string) {
    await this.service.delete(id);
  }

  /**
   * Dry-run: how would this rule have fired against the last N days of
   * verified submissions? Non-mutating — useful for tuning without risking
   * production pollution.
   */
  @Get('price-rules/:id/backtest')
  async backtest(
    @Param('id') id: string,
    @Query('windowDays', new DefaultValuePipe(30), ParseIntPipe) windowDays: number,
    @Query('limit', new DefaultValuePipe(500), ParseIntPipe) limit: number,
  ) {
    return this.service.backtest(id, { windowDays, limit });
  }

  // ── SystemConfig (vat_multiplier etc.) ──────────────────────────────────

  @Get('system-config/:key')
  async getConfig(@Param('key') key: string) {
    const row = await this.service.getConfig(key);
    if (!row) return { key, value: null, description: null };
    return row;
  }

  @Patch('system-config/:key')
  async setConfig(@Param('key') key: string, @Body() body: SetConfigDto) {
    await this.service.setConfig(key, body.value, body.description);
    return { status: 'updated', key, value: body.value };
  }
}
