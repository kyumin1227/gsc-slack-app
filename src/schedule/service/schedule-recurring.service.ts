import { Inject, Injectable, Logger } from '@nestjs/common';
import { BusinessError, ErrorCode } from '../../common/errors';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Schedule } from '../schedule.entity';
import { RecurrenceGroup } from '../recurrence-group.entity';
import { GoogleCalendarService } from '../../google/google-calendar.service';
import { UserService } from '../../user/user.service';
import { ChannelService } from '../../channel/channel.service';
import { WebClient } from '@slack/web-api';
import { randomUUID } from 'crypto';
import { RRule, Weekday } from 'rrule';
import { ScheduleNotificationService } from './schedule-notification.service';
import {
  RecurrenceType,
  CreateRecurringEventsDto,
  UpdateRecurringEventsDto,
} from '../dto/recurring.dto';
import {
  buildRecurringCreationBlocks,
  buildRecurringDeleteBlocks,
  buildRecurringUpdateBlocks,
} from '../view/schedule-recurring.view';

@Injectable()
export class ScheduleRecurringService {
  private readonly logger = new Logger(ScheduleRecurringService.name);
  private readonly slack = new WebClient(process.env.SLACK_BOT_TOKEN);

  constructor(
    @InjectRepository(Schedule)
    private scheduleRepository: Repository<Schedule>,
    @InjectRepository(RecurrenceGroup)
    private recurrenceGroupRepository: Repository<RecurrenceGroup>,
    @Inject(CACHE_MANAGER) private cache: Cache,
    private readonly channelService: ChannelService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly userService: UserService,
    private readonly scheduleNotificationService: ScheduleNotificationService,
  ) {}

  private async resolveWriterDisplay(calendarId: string): Promise<string> {
    try {
      const acl = await this.googleCalendarService.getCalendarAcl(calendarId);
      const emails = acl
        .filter((e) => e.role === 'writer' || e.role === 'owner')
        .map((e) => e.email);
      const slackIds = await this.userService.mapEmailsToSlackIds(emails);
      return slackIds.length > 0
        ? slackIds.map((id) => `<@${id}>`).join('  ')
        : '알 수 없음';
    } catch {
      return '알 수 없음';
    }
  }

  // 반복 일정 생성
  async createRecurringEvents(
    dto: CreateRecurringEventsDto,
    executorSlackId?: string,
  ): Promise<void> {
    const schedule = await this.scheduleRepository.findOne({
      where: { id: dto.scheduleId },
      relations: ['tags', 'createdBy'],
    });
    if (!schedule) throw new BusinessError(ErrorCode.SCHEDULE_NOT_FOUND);

    // 1. 날짜 배열 계산
    const dates = expandRecurringDates(dto);
    if (dates.length === 0)
      throw new BusinessError(ErrorCode.NO_EVENTS_TO_CREATE);

    // 2. groupId 생성 + Redis suppress 등록 (이벤트 생성 전)
    const groupId = randomUUID();
    await this.cache.set(`suppress:group:${groupId}`, true, 3 * 60 * 1000);

    // 3. 이벤트 10개씩 청크 생성 (Rate Limit 방지)
    const results = await runInChunks(
      dates,
      ({ startDateTime, endDateTime }) =>
        this.googleCalendarService.createEventAsServiceAccount(
          schedule.calendarId,
          {
            summary: dto.title,
            startDateTime,
            endDateTime,
            description: dto.description,
            location: dto.location,
            groupId,
          },
        ),
    );

    const successCount = results.filter((r) => r.status === 'fulfilled').length;

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Failed to create event at ${dates[index].startDateTime}: ${result.reason}`,
        );
      }
    });

    if (successCount < results.length) {
      this.logger.warn(
        `createRecurringEvents: ${results.length - successCount}/${results.length} events failed (groupId: ${groupId})`,
      );
    }

    // 4. RecurrenceGroup DB 저장
    await this.recurrenceGroupRepository.save({
      groupId,
      title: dto.title,
      scheduleId: dto.scheduleId,
      daysOfWeek: dto.daysOfWeek
        ? [...dto.daysOfWeek].sort((a, b) => a - b)
        : undefined,
      location: dto.location,
      startDate: dto.startDate,
      endDate: dto.endDate,
      startTime: dto.startTime,
      endTime: dto.endTime,
      recurrenceType: dto.recurrenceType,
    });

    // 5. Slack 채널에 요약 알림 발송 (웹훅 알림 차단용 auto-mute 선행)
    await this.scheduleNotificationService.autoMute(dto.scheduleId);

    const slackChannelIds = await this.channelService.getSlackChannelIds(
      dto.scheduleId,
    );
    if (
      slackChannelIds.length > 0 &&
      !(await this.scheduleNotificationService.isManuallyMuted(dto.scheduleId))
    ) {
      const writerDisplay = await this.resolveWriterDisplay(
        schedule.calendarId,
      );
      const executorDisplay = executorSlackId
        ? `<@${executorSlackId}>`
        : '알 수 없음';
      const blocks = buildRecurringCreationBlocks(
        schedule.name,
        dto,
        dates.length,
        successCount,
        executorDisplay,
        writerDisplay,
      );
      await Promise.allSettled(
        slackChannelIds.map((channel) =>
          this.slack.chat.postMessage({
            channel,
            text: `✨ ${schedule.name} 반복 일정 추가 안내`,
            blocks,
          }),
        ),
      );
    }

    this.logger.log(
      `Recurring events created: groupId=${groupId}, total=${successCount}/${dates.length}`,
    );
  }

  // id로 반복 그룹 조회
  async findRecurrenceGroupById(id: number): Promise<RecurrenceGroup | null> {
    return this.recurrenceGroupRepository.findOne({ where: { id } });
  }

  // 스케줄 ID로 반복 그룹 목록 조회
  async findRecurrenceGroupsBySchedule(
    scheduleId: number,
  ): Promise<RecurrenceGroup[]> {
    return this.recurrenceGroupRepository.find({
      where: { scheduleId },
      order: { createdAt: 'DESC' },
    });
  }

  // 전체 반복 그룹 조회 (삭제되지 않은 것)
  async findAllRecurrenceGroups(): Promise<
    (RecurrenceGroup & { scheduleName: string })[]
  > {
    const groups = await this.recurrenceGroupRepository.find({
      order: { createdAt: 'DESC' },
    });
    const scheduleIds = [...new Set(groups.map((g) => g.scheduleId))];
    const schedules = await this.scheduleRepository.findBy({
      id: In(scheduleIds),
    });
    const scheduleMap = new Map(schedules.map((s) => [s.id, s.name]));
    return groups.map((g) => ({
      ...g,
      scheduleName: scheduleMap.get(g.scheduleId) ?? '',
    }));
  }

  // 반복 그룹이 있는 스케줄 목록 조회 (step1 모달용)
  async findSchedulesWithRecurrenceGroups(): Promise<
    { id: number; name: string }[]
  > {
    const groups = await this.recurrenceGroupRepository.find({
      select: ['scheduleId'],
    });
    const scheduleIds = [...new Set(groups.map((g) => g.scheduleId))];
    if (scheduleIds.length === 0) return [];
    const schedules = await this.scheduleRepository.findBy({
      id: In(scheduleIds),
    });
    return schedules.map((s) => ({ id: s.id, name: s.name }));
  }

  // 반복 그룹 삭제
  async deleteRecurringGroup(
    groupDbId: number,
    scope: 'all' | 'future',
    filterOriginal = false,
    executorSlackId?: string,
  ): Promise<{ deleted: number; total: number }> {
    const group = await this.recurrenceGroupRepository.findOne({
      where: { id: groupDbId },
    });
    if (!group) throw new BusinessError(ErrorCode.RECURRENCE_GROUP_NOT_FOUND);

    const schedule = await this.scheduleRepository.findOne({
      where: { id: group.scheduleId },
      relations: ['tags', 'createdBy'],
    });
    if (!schedule) throw new BusinessError(ErrorCode.SCHEDULE_NOT_FOUND);

    await this.cache.set(
      `suppress:group:${group.groupId}`,
      true,
      3 * 60 * 1000,
    );

    let events = await this.googleCalendarService.listEventsByGroupId(
      schedule.calendarId,
      group.groupId,
    );

    if (scope === 'future') {
      const today = new Date().toISOString().slice(0, 10);
      events = events.filter(
        (e) => (e.start?.dateTime ?? e.start?.date ?? '') >= today,
      );
    }

    if (filterOriginal) {
      events = events.filter((e) => isOriginalEvent(e, group));
    }

    const results = await runInChunks(events, (e) =>
      this.googleCalendarService.deleteEventAsServiceAccount(
        schedule.calendarId,
        e.id!,
      ),
    );
    const deletedCount = results.filter((r) => r.status === 'fulfilled').length;
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Failed to delete event ${events[index].id}: ${result.reason}`,
        );
      }
    });

    if (scope === 'all') {
      await this.recurrenceGroupRepository.softDelete({ id: groupDbId });
    }

    await this.scheduleNotificationService.autoMute(group.scheduleId);

    const slackChannelIds = await this.channelService.getSlackChannelIds(
      group.scheduleId,
    );
    const writerDisplay = await this.resolveWriterDisplay(schedule.calendarId);
    const executorDisplay = executorSlackId
      ? `<@${executorSlackId}>`
      : '알 수 없음';
    if (
      !(await this.scheduleNotificationService.isManuallyMuted(
        group.scheduleId,
      ))
    ) {
      await Promise.allSettled(
        slackChannelIds.map((channel) =>
          this.slack.chat.postMessage({
            channel,
            text: `🗑️ ${schedule.name} 반복 일정 삭제 안내`,
            blocks: buildRecurringDeleteBlocks(
              schedule.name,
              group,
              scope,
              filterOriginal,
              deletedCount,
              events.length,
              executorDisplay,
              writerDisplay,
            ),
          }),
        ),
      );
    }

    this.logger.log(
      `Recurring group deleted: groupId=${group.groupId}, scope=${scope}, deleted=${deletedCount}/${events.length}`,
    );

    return { deleted: deletedCount, total: events.length };
  }

  // 반복 그룹 수정
  async updateRecurringGroup(
    groupDbId: number,
    dto: UpdateRecurringEventsDto,
    scope: 'all' | 'future',
    executorSlackId?: string,
  ): Promise<{ updated: number; total: number }> {
    const group = await this.recurrenceGroupRepository.findOne({
      where: { id: groupDbId },
    });
    if (!group) throw new BusinessError(ErrorCode.RECURRENCE_GROUP_NOT_FOUND);

    const schedule = await this.scheduleRepository.findOne({
      where: { id: group.scheduleId },
      relations: ['tags', 'createdBy'],
    });
    if (!schedule) throw new BusinessError(ErrorCode.SCHEDULE_NOT_FOUND);

    await this.cache.set(
      `suppress:group:${group.groupId}`,
      true,
      3 * 60 * 1000,
    );

    let events = await this.googleCalendarService.listEventsByGroupId(
      schedule.calendarId,
      group.groupId,
    );

    if (scope === 'future') {
      const today = new Date().toISOString().slice(0, 10);
      events = events.filter(
        (e) => (e.start?.dateTime ?? e.start?.date ?? '') >= today,
      );
    }

    // 원본 조건(제목·시간·요일)과 일치하는 이벤트만 수정
    events = events.filter((e) => isOriginalEvent(e, group));

    let updatedCount = 0;

    const needsRecreate =
      dto.daysOfWeek !== undefined ||
      dto.startDate !== undefined ||
      dto.endDate !== undefined;

    if (needsRecreate) {
      // 요일/기간 변경: 기존 원본 전체 삭제 후 재생성
      await runInChunks(events, (e) =>
        this.googleCalendarService.deleteEventAsServiceAccount(
          schedule.calendarId,
          e.id!,
        ),
      );

      const effectiveStartDate = dto.startDate ?? group.startDate ?? null;
      const effectiveEndDate = dto.endDate ?? group.endDate ?? null;

      if (effectiveStartDate && effectiveEndDate) {
        const effectiveStartTime = dto.startTime ?? group.startTime ?? '00:00';
        const effectiveEndTime = dto.endTime ?? group.endTime ?? '00:00';
        const effectiveDaysOfWeek =
          dto.daysOfWeek ?? group.daysOfWeek ?? undefined;

        const newDates = expandRecurringDates({
          scheduleId: group.scheduleId,
          title: dto.title ?? group.title,
          startDate: effectiveStartDate,
          endDate: effectiveEndDate,
          startTime: effectiveStartTime,
          endTime: effectiveEndTime,
          daysOfWeek: effectiveDaysOfWeek,
          recurrenceType: (group.recurrenceType as RecurrenceType) ?? 'weekly',
        });

        const createResults = await runInChunks(
          newDates,
          ({ startDateTime, endDateTime }) =>
            this.googleCalendarService.createEventAsServiceAccount(
              schedule.calendarId,
              {
                summary: dto.title ?? group.title,
                startDateTime,
                endDateTime,
                description: dto.description,
                location: dto.location ?? group.location ?? undefined,
                groupId: group.groupId,
              },
            ),
        );
        updatedCount = createResults.filter(
          (r) => r.status === 'fulfilled',
        ).length;
      }
    } else {
      // 일반 수정 (제목·시각·설명·장소)
      const results = await runInChunks(events, (e) => {
        let startDateTime: string | undefined;
        let endDateTime: string | undefined;

        if (dto.startTime && e.start?.dateTime) {
          const datePart = e.start.dateTime.slice(0, 10);
          startDateTime = `${datePart}T${dto.startTime}:00+09:00`;
        }
        if (dto.endTime && e.end?.dateTime) {
          const datePart = e.end.dateTime.slice(0, 10);
          endDateTime = `${datePart}T${dto.endTime}:00+09:00`;
        }

        return this.googleCalendarService.updateEventAsServiceAccount(
          schedule.calendarId,
          e.id!,
          {
            summary: dto.title,
            description: dto.description,
            location: dto.location,
            startDateTime,
            endDateTime,
          },
        );
      });
      updatedCount = results.filter((r) => r.status === 'fulfilled').length;
    }

    // DB 업데이트
    const updateData: Partial<RecurrenceGroup> = {};
    if (dto.title) updateData.title = dto.title;
    if (dto.location !== undefined) updateData.location = dto.location;
    if (dto.startTime) updateData.startTime = dto.startTime;
    if (dto.endTime) updateData.endTime = dto.endTime;
    if (dto.daysOfWeek !== undefined)
      updateData.daysOfWeek = [...dto.daysOfWeek].sort((a, b) => a - b);
    if (dto.startDate) updateData.startDate = dto.startDate;
    if (dto.endDate) updateData.endDate = dto.endDate;

    if (Object.keys(updateData).length > 0) {
      await this.recurrenceGroupRepository.update(
        { id: groupDbId },
        updateData,
      );
    }

    await this.scheduleNotificationService.autoMute(group.scheduleId);

    const slackChannelIds = await this.channelService.getSlackChannelIds(
      group.scheduleId,
    );
    const writerDisplay = await this.resolveWriterDisplay(schedule.calendarId);
    const executorDisplay = executorSlackId
      ? `<@${executorSlackId}>`
      : '알 수 없음';

    if (
      !(await this.scheduleNotificationService.isManuallyMuted(
        group.scheduleId,
      ))
    ) {
      await Promise.allSettled(
        slackChannelIds.map((channel) =>
          this.slack.chat.postMessage({
            channel,
            text: `🔄 ${schedule.name} 반복 일정 수정 안내`,
            blocks: buildRecurringUpdateBlocks(
              schedule.name,
              group,
              dto,
              scope,
              updatedCount,
              events.length,
              executorDisplay,
              writerDisplay,
            ),
          }),
        ),
      );
    }

    this.logger.log(
      `Recurring group updated: groupId=${group.groupId}, scope=${scope}, updated=${updatedCount}/${events.length}`,
    );

    return { updated: updatedCount, total: events.length };
  }
}

// ========== 날짜 확장 헬퍼 ==========

function expandRecurringDates(dto: CreateRecurringEventsDto): {
  startDateTime: string;
  endDateTime: string;
}[] {
  const dtstart = new Date(`${dto.startDate}T00:00:00Z`);
  const until = new Date(`${dto.endDate}T00:00:00Z`);

  const ruleOptions: ConstructorParameters<typeof RRule>[0] = {
    freq: dto.recurrenceType === 'monthly' ? RRule.MONTHLY : RRule.WEEKLY,
    interval: dto.recurrenceType === 'biweekly' ? 2 : 1,
    dtstart,
    until,
  };

  if (dto.recurrenceType !== 'monthly' && dto.daysOfWeek?.length) {
    ruleOptions.byweekday = dto.daysOfWeek.map(jsWeekdayToRRule);
  }

  const rule = new RRule(ruleOptions);
  const pad = (n: number) => String(n).padStart(2, '0');

  return rule.all().map((date) => {
    const y = date.getUTCFullYear();
    const mo = pad(date.getUTCMonth() + 1);
    const d = pad(date.getUTCDate());
    return {
      startDateTime: `${y}-${mo}-${d}T${dto.startTime}:00+09:00`,
      endDateTime: `${y}-${mo}-${d}T${dto.endTime}:00+09:00`,
    };
  });
}

// JS getDay() 기준 (0=일) → rrule Weekday
function jsWeekdayToRRule(day: number): Weekday {
  const map = [
    RRule.SU,
    RRule.MO,
    RRule.TU,
    RRule.WE,
    RRule.TH,
    RRule.FR,
    RRule.SA,
  ];
  const weekday = map[day];
  if (!weekday) throw new BusinessError(ErrorCode.INVALID_WEEKDAY);
  return weekday;
}

// 429 Rate Limit 시 exponential backoff으로 재시도
async function withRetry<R>(
  fn: () => Promise<R>,
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<R> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const isRateLimit =
        err instanceof Error && err.message.includes('Rate Limit');
      if (!isRateLimit || attempt === maxRetries) throw err;
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * 2 ** attempt),
      );
    }
  }
  throw lastError;
}

// 10개씩 청크로 나눠 순차 실행 (Google Calendar API Rate Limit 방지)
async function runInChunks<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  chunkSize = 10,
  delayMs = 500,
): Promise<PromiseSettledResult<R>[]> {
  const allResults: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const results = await Promise.allSettled(
      chunk.map((item) => withRetry(() => fn(item))),
    );
    allResults.push(...results);
    if (i + chunkSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return allResults;
}

// ========== 원본 이벤트 판별 헬퍼 ==========

function extractTimeKST(dateTimeStr: string): string {
  const d = new Date(dateTimeStr);
  const kstHours = (d.getUTCHours() + 9) % 24;
  const kstMinutes = d.getUTCMinutes();
  return `${String(kstHours).padStart(2, '0')}:${String(kstMinutes).padStart(2, '0')}`;
}

function getDayOfWeekKST(dateTimeStr: string): number {
  const d = new Date(dateTimeStr);
  const kstMs = d.getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).getUTCDay();
}

function isOriginalEvent(
  event: {
    summary?: string | null;
    start?: { dateTime?: string | null } | null;
    end?: { dateTime?: string | null } | null;
  },
  group: RecurrenceGroup,
): boolean {
  if (event.summary !== group.title) return false;

  if (group.startTime && event.start?.dateTime) {
    if (extractTimeKST(event.start.dateTime) !== group.startTime) return false;
  }
  if (group.endTime && event.end?.dateTime) {
    if (extractTimeKST(event.end.dateTime) !== group.endTime) return false;
  }
  if (
    group.daysOfWeek &&
    group.daysOfWeek.length > 0 &&
    event.start?.dateTime
  ) {
    if (!group.daysOfWeek.includes(getDayOfWeekKST(event.start.dateTime)))
      return false;
  }

  return true;
}
