import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

export enum ResourceType {
  CLASSROOM = 'classroom',
  STUDY_ROOM = 'study_room',
  PROFESSOR = 'professor',
}

export enum ResourceStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Index('unique_default_resource', ['isDefault'], {
  unique: true,
  where: '"isDefault" = true',
})
@Entity('resource')
export class Resource {
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
    enum: ResourceType,
    default: ResourceType.STUDY_ROOM,
  })
  type: ResourceType;

  @Column({ nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: ResourceStatus,
    default: ResourceStatus.ACTIVE,
  })
  status: ResourceStatus;

  @Column({ default: false })
  isDefault: boolean = false;

  @Column({ type: 'varchar', nullable: true })
  bookingUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
