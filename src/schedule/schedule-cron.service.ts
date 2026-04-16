import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { calendar_v3 } from 'googleapis';
import { ScheduleService } from './schedule.service';
import { SpaceMirrorService } from '../space/space-mirror.service';
import { SpaceService } from '../space/space.service';
import { GoogleCalendarService } from '../google/google-calendar.service';

const CRON_SUPPRESS_KEY = 'suppress:cron:sync';

@Injectable()
export class ScheduleCronService {
  private readonly logger = new Logger(ScheduleCronService.name);

  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly spaceMirrorService: SpaceMirrorService,
    private readonly spaceService: SpaceService,
    private readonly googleCalendarService: GoogleCalendarService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // listen() 완료 후 main.ts에서 직접 호출
  async renewOnBootstrap(): Promise<void> {
    this.logger.log('Starting watch renewal on bootstrap...');
    await this.scheduleService.renewAllActiveWatches();
    this.logger.log('Bootstrap watch renewal completed');
  }

  // 매주 월요일 자정 — 모든 active 스케줄 watch 일괄 갱신
  // Google Calendar Watch 최대 만료 7일, 주 1회 갱신으로 충분
  @Cron('0 0 * * 1')
  async renewWatches(): Promise<void> {
    this.logger.log('Starting weekly watch renewal...');
    await this.scheduleService.renewAllActiveWatches();
    this.logger.log('Weekly watch renewal completed');
  }

  // 매일 새벽 3시 — 오늘부터 30일 이내 이벤트 미러링 동기화
  @Cron('0 3 * * *', { timeZone: 'Asia/Seoul' })
  async syncMirrors(): Promise<void> {
    try {
      this.logger.log('Starting daily mirror sync...');
      await this.cache.set(CRON_SUPPRESS_KEY, 1, 60 * 60 * 1000); // 1시간 failsafe TTL

      const schedules = await this.scheduleService.findActiveSchedules();
      const timeMin = new Date();
      const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      let synced = 0;
      let failed = 0;

      // 전방 패스: 소스 이벤트 미러링 + 유효한 미러 이벤트 ID 수집
      const validMirrorEventIds = new Set<string>();

      for (const schedule of schedules) {
        let events: calendar_v3.Schema$Event[];
        try {
          events = await this.googleCalendarService.listEventsInRange(
            schedule.calendarId,
            timeMin,
            timeMax,
          );
        } catch (err: any) {
          this.logger.warn(
            `Failed to list events for schedule ${schedule.id}: ${err.message}`,
          );
          continue;
        }

        for (const event of events) {
          if (!event.id) continue;
          if (this.spaceMirrorService.isMirroredEvent(event)) continue;
          if (event.recurringEventId) continue;

          // 잘못된 mirror가 삭제되지 않는것 보다, 정상적인 mirror를 삭제하는 것이 더 큰 문제라고 판단하여 원본과 연결된 미러 id 선보존
          const existingId =
            event.extendedProperties?.private?.['mirroredEventId'];
          if (existingId) validMirrorEventIds.add(existingId);

          const mirrorId = await this.spaceMirrorService
            .mirrorEvent(event, schedule.calendarId)
            .catch((err: Error) => {
              failed++;
              this.logger.warn(
                `Mirror sync failed for event ${event.id}: ${err.message}`,
              );
              return null;
            });

          if (mirrorId) {
            validMirrorEventIds.add(mirrorId);
            synced++;
          }
        }
      }

      // 역방향 패스: 소스가 사라진 미러 이벤트 삭제
      let removed = 0;
      const spaces = await this.spaceService.findAll(true);

      for (const space of spaces) {
        let mirrorEvents: calendar_v3.Schema$Event[];
        try {
          mirrorEvents = await this.googleCalendarService.listMirrorEventsInRange(
            space.calendarId,
            timeMin,
            timeMax,
          );
        } catch (err: any) {
          this.logger.warn(
            `Failed to list mirror events for space ${space.id}: ${err.message}`,
          );
          continue;
        }

        for (const mirror of mirrorEvents) {
          if (!mirror.id) continue;

          if (!validMirrorEventIds.has(mirror.id)) {
            await this.googleCalendarService.deleteEventAsServiceAccount(
              space.calendarId,
              mirror.id,
            )
              .then(() => removed++)
              .catch((err: Error) => {
                this.logger.warn(
                  `Failed to delete stale mirror ${mirror.id}: ${err.message}`,
                );
              });
          }
        }
      }

      this.logger.log(
        `Daily mirror sync completed: ${synced} synced, ${removed} removed, ${failed} failed`,
      );
    } finally {
      // 동기화 직후 발생하는 지연 웹훅들을 무시하기 위해 suppress 상태를 3분간 유지
      await this.cache.set(CRON_SUPPRESS_KEY, 1, 3 * 60 * 1000);
    }
  }
}
