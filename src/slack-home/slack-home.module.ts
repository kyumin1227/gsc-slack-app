import { Module } from '@nestjs/common';
import { SlackHomeController } from './slack-home.controller';
import { UserModule } from 'src/user/user.module';
import { TagModule } from 'src/tag/tag.module';
import { ScheduleModule } from 'src/schedule/schedule.module';
import { StudyRoomModule } from 'src/study-room/study-room.module';
import { SlackHomeService } from './slack-home.service';

@Module({
  imports: [UserModule, TagModule, ScheduleModule, StudyRoomModule],
  controllers: [SlackHomeController],
  providers: [SlackHomeService],
})
export class SlackHomeModule {}
