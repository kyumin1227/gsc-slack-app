import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CleaningController } from './cleaning.controller';
import { CleaningService } from './cleaning.service';
import { CleaningRuleService } from './cleaning-rule.service';
import { CleaningRule } from './cleaning-rule.entity';
import { CleaningRuleResource } from './cleaning-rule-resource.entity';
import { CleaningRuleUser } from './cleaning-rule-user.entity';
import { CleaningSchedule } from './cleaning-schedule.entity';
import { CleaningAssignment } from './cleaning-assignment.entity';
import { CleaningTrade } from './cleaning-trade.entity';
import { UserModule } from '../user/user.module';
import { StudentClassModule } from '../student-class/student-class.module';
import { ResourceModule } from '../resource/resource.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CleaningRule,
      CleaningRuleResource,
      CleaningRuleUser,
      CleaningSchedule,
      CleaningAssignment,
      CleaningTrade,
    ]),
    UserModule,
    StudentClassModule,
    ResourceModule,
  ],
  controllers: [CleaningController],
  providers: [CleaningService, CleaningRuleService],
})
export class CleaningModule {}
