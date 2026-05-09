import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Schedule } from './schedule.entity';
import { RecurrenceGroup } from './recurrence-group.entity';
import { ScheduleService } from './service/schedule.service';
import { ScheduleWatchService } from './service/schedule-watch.service';
import { ScheduleRecurringService } from './service/schedule-recurring.service';
import { ScheduleController } from './controller/schedule.controller';
import { ScheduleRecurringController } from './controller/schedule-recurring.controller';
import { ScheduleClassRepController } from './controller/schedule-class-rep.controller';
import { ScheduleWatchController } from './controller/schedule-watch.controller';
import { ScheduleCronService } from './service/schedule-cron.service';
import { ScheduleNotificationService } from './service/schedule-notification.service';
import { UserModule } from '../user/user.module';
import { TagModule } from '../tag/tag.module';
import { Tag } from '../tag/tag.entity';
import { ChannelModule } from '../channel/channel.module';
import { ResourceModule } from '../resource/resource.module';
import { GoogleModule } from '../google/google.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Schedule, Tag, RecurrenceGroup]),
    forwardRef(() => UserModule),
    forwardRef(() => TagModule),
    ChannelModule,
    ResourceModule,
    GoogleModule,
  ],
  controllers: [
    ScheduleController,
    ScheduleRecurringController,
    ScheduleClassRepController,
    ScheduleWatchController,
  ],
  providers: [
    ScheduleService,
    ScheduleWatchService,
    ScheduleRecurringService,
    ScheduleCronService,
    ScheduleNotificationService,
  ],
  exports: [ScheduleService, ScheduleWatchService, ScheduleRecurringService],
})
export class ScheduleModule {}
