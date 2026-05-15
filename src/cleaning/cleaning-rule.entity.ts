import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
} from 'typeorm';
import { StudentClass } from '../student-class/student-class.entity';

@Entity('cleaning_rules')
export class CleaningRule {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => StudentClass)
  studentClass: StudentClass;

  @Column()
  studentClassId: number;

  @Column()
  cycle: number;

  @Column()
  needPeoples: number;

  @Column()
  dayOfWeek: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
