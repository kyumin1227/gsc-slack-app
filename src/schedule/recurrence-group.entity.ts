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

  @ManyToOne(() => Schedule, { onDelete: 'CASCADE' })
  schedule: Schedule;

  @Column()
  scheduleId: number;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
