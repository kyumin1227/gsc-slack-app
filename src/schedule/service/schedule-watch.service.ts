import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Schedule, ScheduleStatus } from '../schedule.entity';
import { GoogleChannelsService } from '../../google/calendar/channels.service';
import { GoogleEventsService } from '../../google/calendar/events.service';
import { randomUUID } from 'crypto';

@Injectable()
export class ScheduleWatchService {
  private readonly logger = new Logger(ScheduleWatchService.name);

  constructor(
    @InjectRepository(Schedule)
    private scheduleRepository: Repository<Schedule>,
    private readonly googleChannelsService: GoogleChannelsService,
    private readonly googleEventsService: GoogleEventsService,
  ) {}

  // watch 등록 — 멱등 (기존 watch가 있으면 stop 후 재등록)
  async registerWatch(id: number): Promise<void> {
    const schedule = await this.scheduleRepository.findOne({ where: { id } });
    if (!schedule) return;

    if (!this.googleChannelsService.isWatchConfigured()) {
      this.logger.warn(
        'GOOGLE_WEBHOOK_URL not set, skipping watch registration',
      );
      return;
    }

    // 기존 watch가 있으면 먼저 해제
    if (schedule.watchChannelId && schedule.watchResourceId) {
      try {
        await this.googleChannelsService.stopCalendarWatch(
          schedule.watchChannelId,
          schedule.watchResourceId,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to stop existing watch for schedule ${id}: ${error}`,
        );
      }
    }

    const channelId = randomUUID();

    try {
      const { resourceId } =
        await this.googleChannelsService.watchCalendarEvents(
          schedule.calendarId,
          channelId,
        );

      const syncToken = await this.googleEventsService.getInitialSyncToken(
        schedule.calendarId,
      );

      await this.scheduleRepository.update(id, {
        watchChannelId: channelId,
        watchResourceId: resourceId,
        syncToken,
      });

      this.logger.log(
        `Watch registered for schedule ${id} (channelId: ${channelId})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to register watch for schedule ${id}: ${error}`,
      );
    }
  }

  // watch 해제
  async stopWatch(id: number): Promise<void> {
    const schedule = await this.scheduleRepository.findOne({ where: { id } });
    if (!schedule?.watchChannelId || !schedule?.watchResourceId) return;

    try {
      await this.googleChannelsService.stopCalendarWatch(
        schedule.watchChannelId,
        schedule.watchResourceId,
      );
    } catch (error) {
      this.logger.warn(`Failed to stop watch for schedule ${id}: ${error}`);
    }

    await this.scheduleRepository.update(id, {
      watchChannelId: null,
      watchResourceId: null,
    });

    this.logger.log(`Watch stopped for schedule ${id}`);
  }

  // 모든 active 스케줄 watch 일괄 갱신 (weekly cron 전용)
  async renewAllActiveWatches(): Promise<void> {
    const activeSchedules = await this.scheduleRepository.find({
      where: { status: ScheduleStatus.ACTIVE },
      select: ['id'],
    });

    this.logger.log(
      `Renewing watches for ${activeSchedules.length} active schedules`,
    );

    for (const { id } of activeSchedules) {
      await this.registerWatch(id);
    }
  }

  // watchChannelId로 스케줄 조회 (웹훅 수신 시 사용)
  async findByWatchChannelId(channelId: string): Promise<Schedule | null> {
    return this.scheduleRepository.findOne({
      where: { watchChannelId: channelId },
    });
  }

  // syncToken 업데이트 (웹훅 수신 후 새 토큰 저장)
  async updateSyncToken(id: number, syncToken: string): Promise<void> {
    await this.scheduleRepository.update(id, { syncToken });
  }
}
