import { Module } from '@nestjs/common';
import { ToolsModule } from '../tools/tools.module';
import { UserModule } from '../user/user.module';
import { MetricsModule } from '../common/metrics/metrics.module';
import { SlackAiService } from './slack-ai.service';
import { SlackAiHandler } from './slack-ai.handler';

@Module({
  imports: [ToolsModule, UserModule, MetricsModule],
  controllers: [SlackAiHandler],
  providers: [SlackAiService],
})
export class SlackAiModule {}
