import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
} from 'typeorm';
import { CleaningSchedule } from './cleaning-schedule.entity';
import { CleaningStudent } from './cleaning-student.entity';
import { CleaningArea } from './cleaning-area.entity';

export enum CleaningAssignmentStatus {
  ASSIGNED = '배정',
  COMPLETED = '완료',
  CANCELED = '취소',
  NON_COMPLIANT = '불이행',
}

@Entity('cleaning_assignments')
export class CleaningAssignment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => CleaningSchedule)
  schedule: CleaningSchedule;

  @Column()
  scheduleId: number;

  @ManyToOne(() => CleaningStudent)
  student: CleaningStudent;

  @Column()
  studentId: number;

  @ManyToOne(() => CleaningArea)
  area: CleaningArea;

  @Column()
  areaId: number;

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
