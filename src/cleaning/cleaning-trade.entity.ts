import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { CleaningAssignment } from './cleaning-assignment.entity';

export enum CleaningTradeStatus {
  PENDING = '대기',
  APPROVED = '승인',
  REJECTED = '거절',
  CANCELED = '취소',
}

@Entity('cleaning_trades')
export class CleaningTrade {
  @PrimaryGeneratedColumn()
  id: number;

  // 교체를 요청한 배정
  @ManyToOne(() => CleaningAssignment)
  @JoinColumn({ name: 'requesterAssignmentId' })
  requesterAssignment: CleaningAssignment;

  @Column()
  requesterAssignmentId: number;

  // 교체 대상 배정
  @ManyToOne(() => CleaningAssignment)
  @JoinColumn({ name: 'targetAssignmentId' })
  targetAssignment: CleaningAssignment;

  @Column()
  targetAssignmentId: number;

  @Column({
    type: 'enum',
    enum: CleaningTradeStatus,
    default: CleaningTradeStatus.PENDING,
  })
  status: CleaningTradeStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
