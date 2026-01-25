import { Controller } from '@nestjs/common';
import { AllMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';
import { Event } from 'nestjs-slack-bolt';
import { SlackHomeService } from './slack-home.service';

@Controller('slack')
export class SlackHomeController {
  constructor(private readonly slackHomeService: SlackHomeService) {}

  @Event('app_home_opened')
  async event({
    client,
    event,
    logger,
  }: SlackEventMiddlewareArgs<'app_home_opened'> & AllMiddlewareArgs) {
    try {
      if (event.tab === 'home') {
        const view = await this.slackHomeService.getHomeView(event.user);
        const result = await client.views.publish({
          user_id: event.user,
          view: await this.slackHomeService.getHomeView(event.user),
        });
        logger.info(event);

        const user = await client.users.info({ user: event.user });
      }
    } catch (error) {}
  }
}
