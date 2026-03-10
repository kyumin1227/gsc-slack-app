import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ScheduleService } from './schedule.service';

@Injectable()
export class ScheduleCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScheduleCronService.name);

  constructor(private readonly scheduleService: ScheduleService) {}

  // 서버 시작 시 — watch 갱신 (서버 재시작으로 만료된 watch 복구)
  async onApplicationBootstrap(): Promise<void> {
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
}
