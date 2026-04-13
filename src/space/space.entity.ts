import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

export enum SpaceType {
  CLASSROOM = 'classroom',
  STUDY_ROOM = 'study_room',
}

export enum SpaceStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Index('unique_default_space', ['isDefault'], {
  unique: true,
  where: '"isDefault" = true',
})
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

  @Column({ default: false })
  isDefault: boolean = false;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
