import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
  Unique,
} from 'typeorm';
import { User } from '../user/user.entity';

export enum StudentClassStatus {
  ACTIVE = 'active', // 활동 중
  GRADUATED = 'graduated', // 졸업
}

export enum ClassSection {
  A = 'A',
  B = 'B',
}

@Entity()
@Unique(['admissionYear', 'section'])
export class StudentClass {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  name: string; // 자동 생성: "${admissionYear}-${section}" (예: "2024-A")

  @Column()
  admissionYear: number; // 입학 연도 (예: 2024)

  @Column({ type: 'enum', enum: ClassSection })
  section: ClassSection; // A 또는 B

  @Column({
    type: 'enum',
    enum: StudentClassStatus,
    default: StudentClassStatus.ACTIVE,
  })
  status: StudentClassStatus;

  @Column()
  graduationYear: number; // 졸업 연도

  @Column({ type: 'varchar', nullable: true })
  slackChannelId: string | null; // 반 전용 Slack 채널 ID

  @OneToMany(() => User, (user) => user.studentClass)
  users: User[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
