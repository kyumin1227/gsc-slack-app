import { Module } from '@nestjs/common';
import { ToolsModule } from '../tools/tools.module';
import { SlackAiService } from './slack-ai.service';
import { SlackAiHandler } from './slack-ai.handler';

@Module({
  imports: [ToolsModule],
  controllers: [SlackAiHandler],
  providers: [SlackAiService],
})
export class SlackAiModule {}
