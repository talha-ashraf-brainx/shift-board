import type { SettingsDto } from '@agent-board/shared';
import { Body, Controller, Get, Put } from '@nestjs/common';
import { UpdateSettingsDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(): Promise<SettingsDto> {
    return this.settings.getDto();
  }

  @Put()
  update(@Body() body: UpdateSettingsDto): Promise<SettingsDto> {
    return this.settings.update(body);
  }
}
