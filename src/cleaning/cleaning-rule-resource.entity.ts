import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  Unique,
} from 'typeorm';
import { CleaningRule } from './cleaning-rule.entity';
import { Resource } from '../resource/resource.entity';

@Unique(['ruleId'])
@Entity('cleaning_rule_resources')
export class CleaningRuleResource {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => CleaningRule)
  rule: CleaningRule;

  @Column()
  ruleId: number;

  @ManyToOne(() => Resource)
  resource: Resource;

  @Column()
  resourceId: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
