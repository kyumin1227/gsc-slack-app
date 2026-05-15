import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CleaningController } from './cleaning.controller';
import { CleaningService } from './cleaning.service';
import { CleaningRule } from './cleaning-rule.entity';
import { CleaningRuleResource } from './cleaning-rule-resource.entity';
import { CleaningRuleUser } from './cleaning-rule-user.entity';
import { CleaningSchedule } from './cleaning-schedule.entity';
import { CleaningAssignment } from './cleaning-assignment.entity';
import { CleaningTrade } from './cleaning-trade.entity';
import { Resource } from '../resource/resource.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Resource,
      CleaningRule,
      CleaningRuleResource,
      CleaningRuleUser,
      CleaningSchedule,
      CleaningAssignment,
      CleaningTrade,
    ]),
  ],
  controllers: [CleaningController],
  providers: [CleaningService],
})
export class CleaningModule {}
