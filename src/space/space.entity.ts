import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export enum SpaceType {
  CLASSROOM = 'classroom',
  STUDY_ROOM = 'study_room',
}

export enum SpaceStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('space')
export class Space {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column('simple-array', { nullable: true })
  aliases: string[];

  @Column({ unique: true })
  calendarId: string;

  @Column({
    type: 'enum',
    enum: SpaceType,
    default: SpaceType.STUDY_ROOM,
  })
  type: SpaceType;

  @Column({ nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: SpaceStatus,
    default: SpaceStatus.ACTIVE,
  })
  status: SpaceStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
