import { Module } from '@nestjs/common';
import { SlackHomeController } from './slack-home.controller';
import { UserModule } from 'src/user/user.module';
import { SlackHomeService } from './slack-home.service';

@Module({
  imports: [UserModule],
  controllers: [SlackHomeController],
  providers: [SlackHomeService],
})
export class SlackHomeModule {}
