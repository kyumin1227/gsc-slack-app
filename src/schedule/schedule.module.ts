import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Schedule } from './schedule.entity';
import { ScheduleService } from './schedule.service';
import { ScheduleController } from './schedule.controller';
import { ScheduleCronService } from './schedule-cron.service';
import { ScheduleWatchController } from './schedule-watch.controller';
import { UserModule } from '../user/user.module';
import { TagModule } from '../tag/tag.module';
import { Tag } from '../tag/tag.entity';
import { ChannelModule } from '../channel/channel.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Schedule, Tag]),
    forwardRef(() => UserModule),
    forwardRef(() => TagModule),
    ChannelModule,
  ],
  controllers: [ScheduleController, ScheduleWatchController],
  providers: [ScheduleService, ScheduleCronService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
