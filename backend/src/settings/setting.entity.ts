import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Key/value settings: `globalRules` (string), `workerEnabled` (boolean). */
@Entity({ name: 'settings' })
export class SettingEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'jsonb' })
  value!: unknown;
}
