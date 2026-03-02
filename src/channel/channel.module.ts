import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleChannel } from './schedule-channel.entity';
import { ChannelService } from './channel.service';
import { StudentClass } from '../student-class/student-class.entity';
import { StudentClassModule } from '../student-class/student-class.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScheduleChannel, StudentClass]),
    forwardRef(() => StudentClassModule),
  ],
  providers: [ChannelService],
  exports: [ChannelService],
})
export class ChannelModule {}
