import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  Unique,
} from 'typeorm';
import { CleaningRule } from './cleaning-rule.entity';

export enum CleaningScheduleStatus {
  SCHEDULED = '예정',
  COMPLETED = '완료',
  CANCELED = '취소',
}

@Unique(['ruleId', 'cleaningDate'])
@Entity('cleaning_schedules')
export class CleaningSchedule {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => CleaningRule)
  rule: CleaningRule;

  @Column()
  ruleId: number;

  @Column({ type: 'date' })
  cleaningDate: string;

  @Column()
  needPeoples: number;

  @Column({
    type: 'enum',
    enum: CleaningScheduleStatus,
    default: CleaningScheduleStatus.SCHEDULED,
  })
  status: CleaningScheduleStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
