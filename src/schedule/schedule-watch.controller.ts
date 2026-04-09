import { Controller, Headers, HttpCode, Inject, Logger, Post } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ChannelService } from '../channel/channel.service';
import { GoogleCalendarUtil } from '../google/google-calendar.util';
import { ScheduleService } from './schedule.service';
import {
  ScheduleNotificationService,
  DebounceEntry,
} from './schedule-notification.service';
import { detectChangeType } from './schedule-watch.view';
import { SpaceMirrorService } from '../space/space-mirror.service';

@Controller('google/calendar')
export class ScheduleWatchController {
  private readonly logger = new Logger(ScheduleWatchController.name);

  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly channelService: ChannelService,
    private readonly notificationService: ScheduleNotificationService,
    private readonly spaceMirrorService: SpaceMirrorService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
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

    if (!schedule.syncToken) {
      this.logger.warn(
        `No syncToken for schedule ${schedule.id}, skipping webhook`,
      );
      return;
    }

    // TODO: 반복 이벤트, 단일 이벤트 별도 처리 로직 필요
    const { events, nextSyncToken } =
      await GoogleCalendarUtil.getChangedEventsBySyncToken(
        schedule.calendarId,
        schedule.syncToken,
      );

    await this.scheduleService.updateSyncToken(schedule.id, nextSyncToken);

    if (events.length === 0) return;

    for (const event of events) {
      if (!event.id) continue;

      // 슬랙 앱에서 생성한 이벤트 suppress 체크 (중복 알림 방지)
      const groupId = event.extendedProperties?.private?.['groupId'];
      if (groupId) {
        const suppressed = await this.cache.get(`suppress:group:${groupId}`);
        if (suppressed) continue;
      }

      // 미러 이벤트 suppress (방어 코드 — Space 캘린더엔 watch 미등록으로 실제론 불필요)
      if (this.spaceMirrorService.isMirroredEvent(event)) continue;

      // 공간 미러링 — 즉시 실행 (알림 debounce와 독립)
      await this.spaceMirrorService.mirrorEvent(event).catch((err: Error) => {
        this.logger.warn(
          `Space mirror failed for event ${event.id}: ${err.message}`,
        );
      });

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
