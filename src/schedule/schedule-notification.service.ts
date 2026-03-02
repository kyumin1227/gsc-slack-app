import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { WebClient } from '@slack/web-api';
import { ChannelService } from '../channel/channel.service';
import { GoogleCalendarUtil } from '../google/google-calendar.util';
import {
  buildCalendarNotificationBlocks,
  EventChangeType,
} from './schedule-watch.view';

export interface DebounceEntry {
  originalType: EventChangeType;
  calendarId: string;
  scheduleId: number;
  scheduleName: string;
  eventId: string;
  dueAt: number;
}

type PendingMap = Record<string, DebounceEntry>;

const PENDING_KEY = 'calendar:debounce:pending';
const DEBOUNCE_MS = 3 * 60 * 1000;
const PENDING_TTL_MS = 60 * 60 * 1000; // 1시간 안전 TTL

@Injectable()
export class ScheduleNotificationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScheduleNotificationService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly slack = new WebClient(process.env.SLACK_BOT_TOKEN);

  constructor(
    @Inject(CACHE_MANAGER) private cache: Cache,
    private readonly channelService: ChannelService,
  ) {}

  // 서버 재시작 시 Redis에 남은 대기 항목 타이머 재예약
  async onApplicationBootstrap(): Promise<void> {
    const pending = await this.getPending();
    const entries = Object.entries(pending);

    if (entries.length === 0) return;

    this.logger.log(
      `Recovering ${entries.length} pending notification(s) from Redis`,
    );

    for (const [key, entry] of entries) {
      const remainingMs = Math.max(0, entry.dueAt - Date.now());
      this.scheduleTimer(key, remainingMs);
    }
  }

  // 웹훅 수신 시: Redis 저장 + 타이머 예약 (타이머 리셋)
  async enqueue(key: string, entry: DebounceEntry): Promise<void> {
    const pending = await this.getPending();
    pending[key] = entry;
    await this.setPending(pending);

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

    const pending = await this.getPending();
    delete pending[key];
    await this.setPending(pending);

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
    const pending = await this.getPending();
    const entry = pending[key];
    if (!entry) return;

    delete pending[key];
    await this.setPending(pending);

    // 최신 이벤트 조회
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

    const slackChannelIds = await this.channelService.getSlackChannelIds(
      entry.scheduleId,
    );
    if (slackChannelIds.length === 0) return;

    // 발송 시점 이벤트 상태 반영: 취소된 경우 originalType 무관하게 cancelled
    const finalType: EventChangeType =
      event.status === 'cancelled' ? 'cancelled' : entry.originalType;

    const blocks = buildCalendarNotificationBlocks(
      entry.scheduleName,
      event,
      finalType,
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

  private async getPending(): Promise<PendingMap> {
    return (await this.cache.get<PendingMap>(PENDING_KEY)) ?? {};
  }

  private async setPending(pending: PendingMap): Promise<void> {
    await this.cache.set(PENDING_KEY, pending, PENDING_TTL_MS);
  }

  // 외부에서 현재 대기 entry 조회 (컨트롤러에서 중복 확인용)
  async getPendingEntry(key: string): Promise<DebounceEntry | undefined> {
    const pending = await this.getPending();
    return pending[key];
  }
}
