import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { StudentClass } from '../student-class/student-class.entity';

export enum TagStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity()
export class Tag {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  name: string; // 예: "2024-A반", "전공", "일본어", "특강"

  @Column({
    type: 'enum',
    enum: TagStatus,
    default: TagStatus.ACTIVE,
  })
  status: TagStatus;

  // 반에서 자동 생성된 경우에만 연결 (수동 생성 태그는 null)
  @OneToOne(() => StudentClass, { nullable: true })
  @JoinColumn()
  studentClass: StudentClass;

  @Column({ nullable: true })
  studentClassId: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
