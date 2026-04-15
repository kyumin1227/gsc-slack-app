import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { WebClient } from '@slack/web-api';
import { ChannelService } from '../channel/channel.service';
import { UserService } from '../user/user.service';
import { GoogleCalendarUtil } from '../google/google-calendar.util';
import {
  buildCalendarNotificationBlocks,
  hasRelevantChanges,
  EventChangeType,
  EventSnapshot,
} from './schedule-watch.view';

export type { EventSnapshot };

export interface DebounceEntry {
  originalType: EventChangeType;
  calendarId: string;
  scheduleId: number;
  scheduleName: string;
  eventId: string;
  dueAt: number;
  beforeSnapshot?: EventSnapshot; // 첫 webhook 시점의 "변경 전" 상태
}

const DEBOUNCE_KEY_PREFIX = 'calendar:debounce:';
const DEBOUNCE_MS = 3 * 60 * 1000;
const ENTRY_TTL_MS = 60 * 60 * 1000; // 1시간 안전 TTL

const pendingKey = (key: string) => `${DEBOUNCE_KEY_PREFIX}${key}`;

@Injectable()
export class ScheduleNotificationService {
  private readonly logger = new Logger(ScheduleNotificationService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly slack = new WebClient(process.env.SLACK_BOT_TOKEN);

  constructor(
    @Inject(CACHE_MANAGER) private cache: Cache,
    private readonly channelService: ChannelService,
    private readonly userService: UserService,
  ) {}

  // 웹훅 수신 시: Redis 저장 + 타이머 예약 (타이머 리셋)
  async enqueue(key: string, entry: DebounceEntry): Promise<void> {
    await this.cache.set(pendingKey(key), entry, ENTRY_TTL_MS);

    // 기존 타이머 있으면 취소 후 재예약
    this.clearTimer(key);
    this.scheduleTimer(key, DEBOUNCE_MS);

    this.logger.log(
      `Debounce enqueued: ${key} (type: ${entry.originalType}, dueAt: ${new Date(entry.dueAt).toISOString()})`,
    );
  }

  // 신규 생성 후 삭제 시: 타이머 취소 + Redis 제거
  async cancel(key: string): Promise<void> {
    this.clearTimer(key);
    await this.cache.del(pendingKey(key));

    this.logger.log(`Debounce cancelled (new→delete): ${key}`);
  }

  private scheduleTimer(key: string, delayMs: number): void {
    const timeout = setTimeout(() => this.sendNotification(key), delayMs);
    this.timers.set(key, timeout);
  }

  private clearTimer(key: string): void {
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(key);
    }
  }

  private async sendNotification(key: string): Promise<void> {
    this.timers.delete(key);

    // Redis에서 entry 읽고 제거
    const entry = await this.cache.get<DebounceEntry>(pendingKey(key));
    if (!entry) return;

    await this.cache.del(pendingKey(key));

    // 최신 이벤트 조회 (미러 메타데이터 포함)
    const event = await GoogleCalendarUtil.getEventById(
      entry.calendarId,
      entry.eventId,
    );
    if (!event) return;

    // 신규 생성 후 결국 취소된 경우 발송 안 함
    if (entry.originalType === 'added' && event.status === 'cancelled') {
      this.logger.log(
        `Skipping notification: new event was cancelled (${key})`,
      );
      return;
    }

    // updated인데 발송 시점 최신 상태가 변경 전과 동일하면 발송 안 함 (되돌린 경우)
    if (
      entry.originalType === 'updated' &&
      entry.beforeSnapshot &&
      !hasRelevantChanges(entry.beforeSnapshot, event)
    ) {
      this.logger.log(
        `Skipping notification: event reverted to original state (${key})`,
      );
      return;
    }

    const slackChannelIds = await this.channelService.getSlackChannelIds(
      entry.scheduleId,
    );
    if (slackChannelIds.length === 0) return;

    // 발송 시점 이벤트 상태 반영: 취소된 경우 originalType 무관하게 cancelled
    const finalType: EventChangeType =
      event.status === 'cancelled' ? 'cancelled' : entry.originalType;

    // 캘린더 writer/owner 목록 → Slack 멘션으로 변환
    const writerDisplay = await this.resolveWriterDisplay(entry.calendarId);

    const blocks = buildCalendarNotificationBlocks(
      entry.scheduleName,
      event,
      finalType,
      finalType === 'updated' ? entry.beforeSnapshot : undefined,
      writerDisplay,
    );

    await Promise.allSettled(
      slackChannelIds.map((channel) =>
        this.slack.chat.postMessage({
          channel,
          text: `📅 ${entry.scheduleName} 일정 변경 알림`,
          blocks,
        }),
      ),
    );

    this.logger.log(
      `Notification sent: ${key} (type: ${finalType}, channels: ${slackChannelIds.length})`,
    );
  }

  // 캘린더 writer/owner → Slack 멘션 문자열 변환 (서비스 가입자만)
  private async resolveWriterDisplay(
    calendarId: string,
  ): Promise<string | undefined> {
    try {
      const acl = await GoogleCalendarUtil.getCalendarAcl(calendarId);
      const writerEmails = acl
        .filter((e) => e.role === 'writer' || e.role === 'owner')
        .map((e) => e.email);

      const slackIds = await this.userService.mapEmailsToSlackIds(writerEmails);
      const mentions = slackIds.map((id) => `<@${id}>`);

      return mentions.length > 0 ? mentions.join('  ') : undefined;
    } catch {
      return undefined;
    }
  }

  // 외부에서 현재 대기 entry 조회 (컨트롤러에서 중복 확인용)
  async getPendingEntry(key: string): Promise<DebounceEntry | undefined> {
    return (await this.cache.get<DebounceEntry>(pendingKey(key))) ?? undefined;
  }
}
