import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CleaningRuleController } from './controller/cleaning-rule.controller';
import { CleaningScheduleController } from './controller/cleaning-schedule.controller';
import { CleaningTradeController } from './controller/cleaning-trade.controller';
import { CleaningNotificationService } from './service/cleaning-notification.service';
import { CleaningRuleService } from './service/cleaning-rule.service';
import { CleaningScheduleService } from './service/cleaning-schedule.service';
import { CleaningTradeService } from './service/cleaning-trade.service';
import { CleaningRule } from './entity/cleaning-rule.entity';
import { CleaningRuleResource } from './entity/cleaning-rule-resource.entity';
import { CleaningRuleUser } from './entity/cleaning-rule-user.entity';
import { CleaningSchedule } from './entity/cleaning-schedule.entity';
import { CleaningAssignment } from './entity/cleaning-assignment.entity';
import { CleaningTrade } from './entity/cleaning-trade.entity';
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
    // UserAdminController가 CleaningScheduleService를 쓰기 때문에 순환 참조를 허용한다.
    forwardRef(() => UserModule),
    StudentClassModule,
    forwardRef(() => ResourceModule),
  ],
  controllers: [
    CleaningRuleController,
    CleaningScheduleController,
    CleaningTradeController,
  ],
  providers: [
    CleaningNotificationService,
    CleaningRuleService,
    CleaningScheduleService,
    CleaningTradeService,
  ],
  exports: [CleaningScheduleService],
})
export class CleaningModule {}
