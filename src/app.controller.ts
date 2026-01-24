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

  @Event('app_home_opened')
  async event({
    client,
    event,
    logger,
  }: SlackEventMiddlewareArgs<'app_home_opened'> & AllMiddlewareArgs) {
    try {
      const result = await client.views.publish({
        user_id: event.user,
        view: {
          // Home tabs must be enabled in your app configuration page under "App Home"
          type: 'home',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*Welcome home, <@' + event.user + '> :house:*',
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: 'Learn how home tabs can be more useful and interactive <https://docs.slack.dev/surfaces/app-home|*in the documentation*>.',
              },
            },
          ],
        },
      });
      logger.info(result);
      logger.info(event);

      const user = await client.users.info({ user: event.user });
      logger.info(user.user?.profile?.email);
    } catch (error) {}
  }
}
