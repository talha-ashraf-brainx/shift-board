import type { SettingsDto, UpdateSettingsInput } from '@agent-board/shared';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { WorkerSignal } from '../common/worker-signal.service';
import { AppConfig } from '../config/app-config';
import { SettingEntity } from './setting.entity';

export interface BoardSettings {
  globalRules: string;
  workerEnabled: boolean;
  /** Incoming-webhook URL for "ticket needs you" notifications; null = off. */
  notifyWebhookUrl: string | null;
}

/** Internal (backend-only) event emitted after settings change. */
export const SETTINGS_CHANGED = 'settings.changed';

const DEFAULTS: BoardSettings = { globalRules: '', workerEnabled: true, notifyWebhookUrl: null };

@Injectable()
export class SettingsService {
  private cache: BoardSettings | null = null;

  constructor(
    @InjectRepository(SettingEntity) private readonly repo: Repository<SettingEntity>,
    private readonly config: AppConfig,
    private readonly emitter: EventEmitter2,
    private readonly workerSignal: WorkerSignal,
  ) {}

  /** Cached in memory; refreshed on write. */
  async get(): Promise<BoardSettings> {
    if (this.cache) return { ...this.cache };
    const rows = await this.repo.find();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const globalRules = map.get('globalRules');
    const workerEnabled = map.get('workerEnabled');
    const notifyWebhookUrl = map.get('notifyWebhookUrl');
    this.cache = {
      globalRules: typeof globalRules === 'string' ? globalRules : DEFAULTS.globalRules,
      workerEnabled: typeof workerEnabled === 'boolean' ? workerEnabled : DEFAULTS.workerEnabled,
      // Stored as "" when cleared (the jsonb column is NOT NULL); no row = never set.
      notifyWebhookUrl: typeof notifyWebhookUrl === 'string' && notifyWebhookUrl ? notifyWebhookUrl : null,
    };
    return { ...this.cache };
  }

  async getDto(): Promise<SettingsDto> {
    const s = await this.get();
    return {
      ...s,
      worktreesRoot: this.config.worktreesDir,
    };
  }

  async update(input: UpdateSettingsInput): Promise<SettingsDto> {
    const current = await this.get();
    const next: BoardSettings = {
      globalRules: input.globalRules ?? current.globalRules,
      workerEnabled: input.workerEnabled ?? current.workerEnabled,
      notifyWebhookUrl:
        input.notifyWebhookUrl === undefined ? current.notifyWebhookUrl : input.notifyWebhookUrl?.trim() || null,
    };
    await this.persist(next);
    this.emitter.emit(SETTINGS_CHANGED);
    this.workerSignal.wake();
    return this.getDto();
  }

  private async persist(s: BoardSettings): Promise<void> {
    await this.repo.save([
      { key: 'globalRules', value: s.globalRules },
      { key: 'workerEnabled', value: s.workerEnabled },
      { key: 'notifyWebhookUrl', value: s.notifyWebhookUrl ?? '' },
    ]);
    this.cache = { ...s };
  }
}
