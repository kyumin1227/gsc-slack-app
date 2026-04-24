import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { GoogleCalendarService } from '../google/google-calendar.service';
import { ScheduleService } from './schedule.service';
import {
  ScheduleNotificationService,
  DebounceEntry,
} from './schedule-notification.service';
import { detectChangeType, hasRelevantChanges } from './schedule-watch.view';
import { SpaceMirrorService } from '../space/space-mirror.service';
import { EventSnapshot } from './schedule-notification.service';

@Controller('google/calendar')
export class ScheduleWatchController {
  private readonly logger = new Logger(ScheduleWatchController.name);

  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly notificationService: ScheduleNotificationService,
    private readonly spaceMirrorService: SpaceMirrorService,
    private readonly googleCalendarService: GoogleCalendarService,
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

    if (!schedule.syncToken) {
      this.logger.warn(
        `No syncToken for schedule ${schedule.id}, skipping webhook`,
      );
      return;
    }

    const { events, nextSyncToken } =
      await this.googleCalendarService.getChangedEventsBySyncToken(
        schedule.calendarId,
        schedule.syncToken,
      );

    await this.scheduleService.updateSyncToken(schedule.id, nextSyncToken);

    // cron 동기화 중 — syncToken은 소비하되 알림/미러링은 스킵
    if (await this.cache.get('suppress:cron:sync')) {
      this.logger.log('Webhook suppressed during cron sync');
      return;
    }

    if (events.length === 0) return;

    for (const event of events) {
      if (!event.id) continue;

      // 미러 이벤트 suppress (방어 코드 — Space 캘린더엔 watch 미등록으로 실제론 불필요)
      if (this.spaceMirrorService.isMirroredEvent(event)) continue;

      // 슬랙 앱에서 생성한 이벤트 suppress 체크 (알림만 방지, 미러링은 항상 실행)
      const groupId = event.extendedProperties?.private?.['groupId'];
      const notificationSuppressed = groupId
        ? !!(await this.cache.get(`suppress:group:${groupId}`))
        : false;

      const key = `${schedule.id}:${event.id}`;
      const currentType = detectChangeType(event);
      const existing = await this.notificationService.getPendingEntry(key);

      if (!existing) {
        // 미러링 전에 "변경 전" 상태 캡처 (업데이트 알림 diff용)
        let beforeSnapshot: EventSnapshot | undefined;
        if (currentType === 'updated') {
          const before = await this.spaceMirrorService
            .fetchCurrentMirrorEvent(event)
            .catch(() => null);
          if (before) {
            beforeSnapshot = {
              summary: before.summary,
              startDateTime: before.start?.dateTime,
              endDateTime: before.end?.dateTime,
              location: before.location,
              description: before.description,
            };
          }
        }

        // 공간 미러링 — 즉시 실행 (알림 debounce와 독립)
        await this.spaceMirrorService
          .mirrorEvent(event, schedule.calendarId)
          .catch((err: Error) => {
            this.logger.warn(
              `Space mirror failed for event ${event.id}: ${err.message}`,
            );
          });

        if (!notificationSuppressed) {
          // updated인데 추적 필드 변경 없으면 알림 스킵
          if (
            currentType === 'updated' &&
            beforeSnapshot &&
            !hasRelevantChanges(beforeSnapshot, event)
          ) {
            // no-op
          } else {
            const entry: DebounceEntry = {
              originalType: currentType,
              calendarId: schedule.calendarId,
              scheduleId: schedule.id,
              scheduleName: schedule.name,
              eventId: event.id,
              dueAt: Date.now() + 3 * 60 * 1000,
              beforeSnapshot,
            };
            await this.notificationService.enqueue(key, entry);
          }
        }
      } else {
        // 두 번째 이후 webhook — 미러 업데이트만, beforeSnapshot은 유지
        await this.spaceMirrorService
          .mirrorEvent(event, schedule.calendarId)
          .catch((err: Error) => {
            this.logger.warn(
              `Space mirror failed for event ${event.id}: ${err.message}`,
            );
          });

        if (!notificationSuppressed) {
          if (
            currentType === 'cancelled' &&
            existing.originalType === 'added'
          ) {
            // 신규 생성 후 삭제 → 알림 취소
            await this.notificationService.cancel(key);
          } else if (
            existing.originalType === 'cancelled' &&
            currentType === 'updated'
          ) {
            // 삭제 후 실행 취소
            await this.notificationService.cancel(key);
          } else {
            // 타이머 리셋 (originalType, beforeSnapshot 유지)
            await this.notificationService.enqueue(key, {
              ...existing,
              dueAt: Date.now() + 3 * 60 * 1000,
            });
          }
        }
      }
    }
  }
}
