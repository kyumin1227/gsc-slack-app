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
import { Resource } from '../resource/resource.entity';

export enum CleaningScheduleStatus {
  SCHEDULED = '예정',
  COMPLETED = '완료',
  CANCELED = '취소',
}

@Unique(['resourceId', 'cleaningDate'])
@Entity('cleaning_schedules')
export class CleaningSchedule {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Resource)
  resource: Resource;

  @Column()
  resourceId: number;

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
