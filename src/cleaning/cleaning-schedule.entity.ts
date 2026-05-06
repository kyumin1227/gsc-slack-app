import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export enum CleaningScheduleStatus {
  SCHEDULED = '예정',
  COMPLETED = '완료',
  CANCELED = '취소',
}

@Entity('cleaning_schedules')
export class CleaningSchedule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date', unique: true })
  cleaningDate: string;

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
