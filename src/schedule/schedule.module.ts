import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Schedule } from './schedule.entity';
import { ScheduleService } from './schedule.service';
import { ScheduleController } from './schedule.controller';
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
  controllers: [ScheduleController],
  providers: [ScheduleService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
