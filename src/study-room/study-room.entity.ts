import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export enum StudyRoomStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity()
export class StudyRoom {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ unique: true })
  calendarId: string;

  @Column({ nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: StudyRoomStatus,
    default: StudyRoomStatus.ACTIVE,
  })
  status: StudyRoomStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
