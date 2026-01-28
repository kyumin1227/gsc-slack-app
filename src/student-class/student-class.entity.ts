import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
} from 'typeorm';
import { User } from '../user/user.entity';

export enum StudentClassStatus {
  ACTIVE = 'active', // 활동 중
  GRADUATED = 'graduated', // 졸업
}

@Entity()
export class StudentClass {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  name: string; // 예: "2024-A반", "2025-A반"

  @Column({
    type: 'enum',
    enum: StudentClassStatus,
    default: StudentClassStatus.ACTIVE,
  })
  status: StudentClassStatus;

  @Column()
  graduationYear: number; // 졸업 연도

  @OneToMany(() => User, (user) => user.studentClass)
  users: User[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
