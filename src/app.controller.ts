import { Controller, Get, Redirect } from '@nestjs/common';
import { AppService } from './app.service';
import { Message } from 'nestjs-slack-bolt';
import type { SlackEventMiddlewareArgs } from '@slack/bolt';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Redirect('health')
  getRoot() {}

  @Get('health')
  getHealth() {
    return this.appService.getHealthInfo();
  }

  @Message('health')
  async healthMessage({ say }: SlackEventMiddlewareArgs<'message'>) {
    const info = this.appService.getDetailedHealthInfo();
    await say(
      `*GSC Slack App* v${info.version}\n` +
        `호스트: ${info.hostname} (${info.ip})\n` +
        `시작: ${info.startedAt}`,
    );
  }
}
