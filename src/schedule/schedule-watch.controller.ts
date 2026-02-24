import { Controller, Headers, HttpCode, Logger, Post } from '@nestjs/common';
import { WebClient } from '@slack/web-api';
import { ChannelService } from '../channel/channel.service';
import { ScheduleService } from './schedule.service';

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
    @Headers('x-goog-resource-id') resourceId: string,
    @Headers('x-goog-resource-state') resourceState: string,
  ): Promise<void> {
    // 최초 연결 확인 (sync) — 200만 반환
    if (resourceState === 'sync') {
      this.logger.log(`Watch sync confirmed for channelId: ${channelId}`);
      return;
    }

    // 이벤트 변경 알림 (exists)
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

    const message = `📅 *${schedule.name}* 시간표에 변경 사항이 있습니다.\n<https://calendar.google.com/calendar/embed?src=${encodeURIComponent(schedule.calendarId)}|캘린더에서 확인하기>`;

    await Promise.allSettled(
      slackChannelIds.map((channel) =>
        this.slack.chat.postMessage({ channel, text: message }),
      ),
    );

    this.logger.log(
      `Notified ${slackChannelIds.length} channels for schedule ${schedule.id} (${schedule.name})`,
    );
  }
}
