import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Event, Message } from 'nestjs-slack-bolt';
import type { AllMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Message('hi')
  message({ say }: SlackEventMiddlewareArgs<'message'>) {
    say('Hello');
  }
}
