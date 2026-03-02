import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Schedule } from '../schedule/schedule.entity';

@Entity()
@Unique(['scheduleId', 'slackChannelId'])
export class ScheduleChannel {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  scheduleId: number;

  @ManyToOne(() => Schedule, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'scheduleId' })
  schedule: Schedule;

  @Column()
  slackChannelId: string; // Slack 채널 ID (예: "C01234ABCD")
}
