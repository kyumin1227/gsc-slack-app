import { Controller } from '@nestjs/common';
import { SlackEventMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { Event } from 'nestjs-slack-bolt';
import { SlackHomeService } from './slack-home.service';

@Controller('slack')
export class SlackHomeController {
  constructor(private readonly slackHomeService: SlackHomeService) {}

  @Event('app_home_opened')
  async event({
    client,
    event,
  }: SlackEventMiddlewareArgs<'app_home_opened'> & AllMiddlewareArgs) {
    try {
      if (event.tab === 'home') {
        await this.slackHomeService.syncSlackName(client, event.user);
        await client.views.publish({
          user_id: event.user,
          view: await this.slackHomeService.getHomeView(event.user),
        });
      }
    } catch (error) {}
  }
}
