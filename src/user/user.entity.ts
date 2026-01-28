import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export enum UserStatus {
  REGISTERED = 'registered', // Google 로그인만 완료
  PENDING_APPROVAL = 'pending_approval', // 권한 추가 후 승인 대기
  ACTIVE = 'active', // 활성화
  INACTIVE = 'inactive', // 비활성화
}

export enum UserRole {
  PROFESSOR = 'professor', // 교수
  TA = 'ta', // 조교
  CLASS_REP = 'class_rep', // 반대표
  KEY_KEEPER = 'key_keeper', // 키지기
  STUDENT = 'student', // 학생
}

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  slackId: string;

  @Column({ unique: true })
  email: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  code: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    nullable: true,
  })
  role: UserRole;

  @Column({ nullable: true })
  refreshToken: string;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.REGISTERED,
  })
  status: UserStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
