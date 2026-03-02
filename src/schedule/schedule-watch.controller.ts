import { Controller, Headers, HttpCode, Logger, Post } from '@nestjs/common';
import { ChannelService } from '../channel/channel.service';
import { GoogleCalendarUtil } from '../google/google-calendar.util';
import { ScheduleService } from './schedule.service';
import {
  ScheduleNotificationService,
  DebounceEntry,
} from './schedule-notification.service';
import { detectChangeType } from './schedule-watch.view';

@Controller('google/calendar')
export class ScheduleWatchController {
  private readonly logger = new Logger(ScheduleWatchController.name);

  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly channelService: ChannelService,
    private readonly notificationService: ScheduleNotificationService,
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

    // 연결된 Slack 채널 없으면 조기 종료
    const slackChannelIds = await this.channelService.getSlackChannelIds(
      schedule.id,
    );
    if (slackChannelIds.length === 0) return;

    const events = await GoogleCalendarUtil.getRecentChangedEvents(
      schedule.calendarId,
    );
    if (events.length === 0) return;

    for (const event of events) {
      if (!event.id) continue;

      const key = `${schedule.id}:${event.id}`;
      const currentType = detectChangeType(event);
      const existing = await this.notificationService.getPendingEntry(key);

      if (!existing) {
        const entry: DebounceEntry = {
          originalType: currentType,
          calendarId: schedule.calendarId,
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          eventId: event.id,
          dueAt: Date.now() + 3 * 60 * 1000,
        };
        await this.notificationService.enqueue(key, entry);
      } else {
        if (currentType === 'cancelled' && existing.originalType === 'added') {
          // 신규 생성 후 삭제 → 알림 취소
          await this.notificationService.cancel(key);
        } else if (
          existing.originalType === 'cancelled' &&
          currentType === 'updated'
        ) {
          // 삭제 후 실행 취소
          await this.notificationService.cancel(key);
        } else {
          // 타이머 리셋 (originalType 유지)
          await this.notificationService.enqueue(key, {
            ...existing,
            dueAt: Date.now() + 3 * 60 * 1000,
          });
        }
      }
    }
  }
}
