import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Message } from 'nestjs-slack-bolt';
import type { SlackEventMiddlewareArgs } from '@slack/bolt';
import * as os from 'os';

const SERVER_START_TIME = new Date();

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Message('hi')
  @Message('test')
  @Message('health')
  @Message('ping')
  message({ say }: SlackEventMiddlewareArgs<'message'>) {
    const hostname = os.hostname();
    const networkInterfaces = os.networkInterfaces();
    const ip =
      Object.values(networkInterfaces)
        .flat()
        .find((iface) => iface?.family === 'IPv4' && !iface.internal)
        ?.address || 'unknown';

    const startedAtUtc = SERVER_START_TIME.toISOString();
    const startedAtKr = SERVER_START_TIME.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
    });
    say(
      `Hello from ${hostname} (${ip})\nStarted at: ${startedAtUtc} (${startedAtKr})`,
    );
  }
}
