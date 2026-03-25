import { Controller } from '@nestjs/common';
import {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackEventMiddlewareArgs,
} from '@slack/bolt';
import { Action, Event } from 'nestjs-slack-bolt';
import { BlockAction } from '@slack/bolt';
import { SlackHomeService } from './slack-home.service';

@Controller('slack')
export class SlackHomeController {
  constructor(private readonly slackHomeService: SlackHomeService) {}

  @Action('home:external-calendar')
  @Action('home:user-guide')
  @Action('home:report-bug')
  @Action('home:request-feature')
  @Action('home:google-calendar')
  async ackLinkButtons({ ack }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
  }

  @Event('app_home_opened')
  async event({
    client,
    event,
    logger,
  }: SlackEventMiddlewareArgs<'app_home_opened'> & AllMiddlewareArgs) {
    try {
      if (event.tab === 'home') {
        await client.views.publish({
          user_id: event.user,
          view: await this.slackHomeService.getHomeView(event.user),
        });
        logger.info(event);
      }
    } catch (error) {}
  }
}
