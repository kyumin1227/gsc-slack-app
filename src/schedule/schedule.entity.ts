import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToMany,
  ManyToOne,
  JoinTable,
} from 'typeorm';
import { Tag } from '../tag/tag.entity';
import { User } from '../user/user.entity';

export enum ScheduleStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity()
export class Schedule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string; // 과목명

  @Column({ unique: true })
  calendarId: string; // Google Calendar ID

  @Column({ nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: ScheduleStatus,
    default: ScheduleStatus.ACTIVE,
  })
  status: ScheduleStatus;

  @ManyToMany(() => Tag)
  @JoinTable({
    name: 'schedule_tag', // 중간 테이블명
    joinColumn: { name: 'scheduleId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tagId', referencedColumnName: 'id' },
  })
  tags: Tag[];

  // 생성자 (소유자)
  @ManyToOne(() => User)
  createdBy: User;

  @Column()
  createdById: number;

  // Google Calendar Watch 채널 정보
  @Column({ type: 'varchar', nullable: true })
  watchChannelId: string | null; // 우리가 지정한 UUID (웹훅 수신 시 스케줄 매핑 키)

  @Column({ type: 'varchar', nullable: true })
  watchResourceId: string | null; // Google이 발급한 resourceId (watch stop 시 필요)

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
