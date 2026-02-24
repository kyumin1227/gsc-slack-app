import { Controller, Headers, HttpCode, Logger, Post } from '@nestjs/common';
import { WebClient } from '@slack/web-api';
import { ChannelService } from '../channel/channel.service';
import { GoogleCalendarUtil } from '../google/google-calendar.util';
import { ScheduleService } from './schedule.service';
import { buildCalendarNotificationBlocks } from './schedule-watch.view';

@Controller('google/calendar')
export class ScheduleWatchController {
  private readonly logger = new Logger(ScheduleWatchController.name);
  private readonly slack = new WebClient(process.env.SLACK_BOT_TOKEN);

  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly channelService: ChannelService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Headers('x-goog-channel-id') channelId: string,
    @Headers('x-goog-resource-state') resourceState: string,
  ): Promise<void> {
    // 최초 연결 확인 (sync) — 200만 반환
    if (resourceState === 'sync') {
      this.logger.log(`Watch sync confirmed for channelId: ${channelId}`);
      return;
    }

    if (resourceState !== 'exists') return;

    const schedule = await this.scheduleService.findByWatchChannelId(channelId);
    if (!schedule) {
      this.logger.warn(`Unknown channelId: ${channelId}`);
      return;
    }

    const slackChannelIds = await this.channelService.getSlackChannelIds(
      schedule.id,
    );
    if (slackChannelIds.length === 0) return;

    // 최근 변경된 이벤트 조회
    const events = await GoogleCalendarUtil.getRecentChangedEvents(
      schedule.calendarId,
    );
    if (events.length === 0) {
      this.logger.warn(`No recent events found for schedule ${schedule.id}`);
      return;
    }

    // 이벤트별 Slack 알림 전송
    for (const event of events) {
      const blocks = buildCalendarNotificationBlocks(schedule.name, event);
      await Promise.allSettled(
        slackChannelIds.map((channel) =>
          this.slack.chat.postMessage({
            channel,
            text: `📅 ${schedule.name} 일정 변경 알림`,
            blocks,
          }),
        ),
      );
    }

    this.logger.log(
      `Notified ${slackChannelIds.length} channels for schedule ${schedule.id} (${schedule.name}), ${events.length} event(s)`,
    );
  }
}
