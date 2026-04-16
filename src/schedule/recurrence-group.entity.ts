import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  DeleteDateColumn,
  ManyToOne,
} from 'typeorm';
import { Schedule } from './schedule.entity';

@Entity()
export class RecurrenceGroup {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  groupId: string; // UUID (extendedProperties.private.groupId와 동일)

  @Column()
  title: string;

  @Column({ type: 'simple-json', nullable: true })
  daysOfWeek: number[] | null; // [0=일, 1=월 ... 6=토] — weekly/biweekly 시 저장

  @Column({ type: 'varchar', nullable: true })
  location: string | null;

  @Column()
  startTime: string; // HH:MM

  @Column()
  endTime: string; // HH:MM

  @Column()
  recurrenceType: string; // 'weekly' | 'biweekly' | 'monthly'

  @Column()
  startDate: string; // YYYY-MM-DD

  @Column()
  endDate: string; // YYYY-MM-DD

  @ManyToOne(() => Schedule, { onDelete: 'CASCADE' })
  schedule: Schedule;

  @Column()
  scheduleId: number;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
