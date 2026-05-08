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
import { CleaningSchedule } from './cleaning-schedule.entity';
import { User } from '../user/user.entity';

export enum CleaningAssignmentStatus {
  ASSIGNED = '배정',
  COMPLETED = '완료',
  CANCELED = '취소',
  NON_COMPLIANT = '불이행',
}

@Unique(['studentId', 'cleaningDate'])
@Entity('cleaning_assignments')
export class CleaningAssignment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => CleaningSchedule)
  schedule: CleaningSchedule;

  @Column()
  scheduleId: number;

  @ManyToOne(() => User)
  student: User;

  @Column()
  studentId: number;

  @Column({ type: 'date' })
  cleaningDate: string;

  @Column({
    type: 'enum',
    enum: CleaningAssignmentStatus,
    default: CleaningAssignmentStatus.ASSIGNED,
  })
  status: CleaningAssignmentStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
