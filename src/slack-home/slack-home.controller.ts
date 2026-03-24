import { Controller } from '@nestjs/common';
import {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackEventMiddlewareArgs,
} from '@slack/bolt';
import { Action, Event } from 'nestjs-slack-bolt';
import { BlockAction } from '@slack/bolt';
import { SlackHomeService } from './slack-home.service';
import { TagService } from '../tag/tag.service';
import { StudyRoomService } from '../study-room/study-room.service';
import { ScheduleView } from '../schedule/schedule.view';
import { StudyRoomView } from '../study-room/study-room.view';

@Controller('slack')
export class SlackHomeController {
  constructor(
    private readonly slackHomeService: SlackHomeService,
    private readonly tagService: TagService,
    private readonly studyRoomService: StudyRoomService,
  ) {}

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
