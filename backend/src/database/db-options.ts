import type { DataSourceOptions } from 'typeorm';
import { AttachmentEntity } from '../attachments/attachment.entity';
import { TicketEventEntity } from '../events/ticket-event.entity';
import { ProjectEntity } from '../projects/project.entity';
import { WorktreeEntity } from '../projects/worktree.entity';
import { SettingEntity } from '../settings/setting.entity';
import { TicketEntity } from '../tickets/ticket.entity';
import { Init1759300000000 } from './migrations/1759300000000-Init';
import { SeedSettings1759300000001 } from './migrations/1759300000001-SeedSettings';
import { Projects1759400000000 } from './migrations/1759400000000-Projects';
import { TicketRulesList1759500000000 } from './migrations/1759500000000-TicketRulesList';
import { Worktrees1759600000000 } from './migrations/1759600000000-Worktrees';
import { Attachments1759600000001 } from './migrations/1759600000001-Attachments';

export const ENTITIES = [ProjectEntity, WorktreeEntity, TicketEntity, TicketEventEntity, SettingEntity, AttachmentEntity];
/** Listed explicitly (not globbed) so the CLI, Nest and Jest all load the same classes. */
export const MIGRATIONS = [Init1759300000000, SeedSettings1759300000001, Projects1759400000000, TicketRulesList1759500000000, Worktrees1759600000000, Attachments1759600000001];

/** Shared by the TypeORM CLI data source, the Nest TypeOrmModule and tests. */
export function buildDataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    migrationsTableName: 'migrations',
    uuidExtension: 'pgcrypto', // gen_random_uuid() (built into Postgres 13+)
    installExtensions: false,
    synchronize: false,
    migrationsRun: false,
    logging: ['error'],
  };
}
