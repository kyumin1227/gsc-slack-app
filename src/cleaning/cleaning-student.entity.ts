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
import { User } from '../user/user.entity';

export enum CleaningStudentStatus {
  ENROLLED = '재학',
  ON_LEAVE = '휴학',
}

@Entity('cleaning_students')
export class CleaningStudent {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne(() => User)
  @JoinColumn()
  user: User;

  @Column()
  userId: number;

  @Column()
  grade: number;

  @Column({
    type: 'enum',
    enum: CleaningStudentStatus,
    default: CleaningStudentStatus.ENROLLED,
  })
  status: CleaningStudentStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
