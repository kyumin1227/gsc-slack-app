import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { StudentClass } from '../../student-class/student-class.entity';
import { CleaningRuleResource } from './cleaning-rule-resource.entity';

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

  @Column('int', { array: true })
  daysOfWeek: number[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @OneToMany(() => CleaningRuleResource, (rr) => rr.rule)
  ruleResource: CleaningRuleResource[] | undefined;
}
