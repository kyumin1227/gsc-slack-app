import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ScheduleService } from './schedule.service';

@Injectable()
export class ScheduleCronService {
  private readonly logger = new Logger(ScheduleCronService.name);

  constructor(private readonly scheduleService: ScheduleService) {}

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
}
