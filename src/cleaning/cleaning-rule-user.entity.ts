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
import { User } from '../user/user.entity';

@Unique(['ruleId', 'userId'])
@Entity('cleaning_rule_users')
export class CleaningRuleUser {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => CleaningRule)
  rule: CleaningRule;

  @Column()
  ruleId: number;

  @ManyToOne(() => User)
  user: User;

  @Column()
  userId: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
