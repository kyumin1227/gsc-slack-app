import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Schedule, ScheduleStatus } from './schedule.entity';
import { RecurrenceGroup } from './recurrence-group.entity';
import { GoogleCalendarUtil } from '../google/google-calendar.util';
import { Tag } from '../tag/tag.entity';
import { ChannelService } from '../channel/channel.service';
import { WebClient } from '@slack/web-api';
import { KnownBlock } from '@slack/web-api';
import { randomUUID } from 'crypto';
import { RRule, Weekday } from 'rrule';

export interface CreateScheduleDto {
  name: string;
  description?: string;
  tagIds?: number[];
  createdById: number;
  creatorEmail?: string;
  creatorRefreshToken?: string;
}

export interface UpdateScheduleDto {
  name?: string;
  description?: string;
  tagIds?: number[];
}

export type RecurrenceType = 'weekly' | 'biweekly' | 'monthly';

export interface UpdateRecurringEventsDto {
  title?: string;
  description?: string;
  location?: string;
  startTime?: string; // HH:MM, undefined → 시간 변경 안 함
  endTime?: string; // HH:MM
}

export interface CreateRecurringEventsDto {
  scheduleId: number;
  title: string;
  description?: string;
  location?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  recurrenceType: RecurrenceType;
  daysOfWeek?: number[]; // 0=일, 1=월 ... 6=토 (weekly/biweekly 시 사용)
}

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);
  private readonly slack = new WebClient(process.env.SLACK_BOT_TOKEN);

  constructor(
    @InjectRepository(Schedule)
    private scheduleRepository: Repository<Schedule>,
    @InjectRepository(Tag)
    private tagRepository: Repository<Tag>,
    @InjectRepository(RecurrenceGroup)
    private recurrenceGroupRepository: Repository<RecurrenceGroup>,
    @Inject(CACHE_MANAGER) private cache: Cache,
    private readonly channelService: ChannelService,
  ) {}

  // 스케줄 생성 (Google Calendar도 함께 생성)
  async createSchedule(dto: CreateScheduleDto): Promise<Schedule> {
    // 1. Google Calendar 생성
    const { calendarId } = await GoogleCalendarUtil.createCalendar(
      dto.name,
      dto.description,
    );

    // 2. 태그 조회
    let tags: Tag[] = [];
    if (dto.tagIds && dto.tagIds.length > 0) {
      tags = await this.tagRepository.find({
        where: { id: In(dto.tagIds) },
      });
    }

    // 3. Schedule 엔티티 저장
    const schedule = this.scheduleRepository.create({
      name: dto.name,
      calendarId,
      description: dto.description,
      status: ScheduleStatus.ACTIVE,
      tags,
      createdById: dto.createdById,
    });

    const saved = await this.scheduleRepository.save(schedule);

    // 4. 생성자에게 writer 권한 부여 및 자동 구독
    if (dto.creatorEmail && dto.creatorRefreshToken) {
      await GoogleCalendarUtil.shareCalendar({
        calendarId,
        email: dto.creatorEmail,
        role: 'writer',
      });
      await GoogleCalendarUtil.addCalendarToUserList(
        calendarId,
        dto.creatorRefreshToken,
      );
    }

    // 5. Google Calendar Watch 등록
    await this.registerWatch(saved.id);

    return saved;
  }

  async findById(id: number): Promise<Schedule | null> {
    return this.scheduleRepository.findOne({
      where: { id },
      relations: ['tags', 'createdBy'],
    });
  }

  async findByCalendarId(calendarId: string): Promise<Schedule | null> {
    return this.scheduleRepository.findOne({
      where: { calendarId },
      relations: ['tags', 'createdBy'],
    });
  }

  async findByName(name: string): Promise<Schedule | null> {
    return this.scheduleRepository.findOne({
      where: { name },
      relations: ['tags'],
    });
  }

  // 활성 스케줄 목록 조회
  async findActiveSchedules(): Promise<Schedule[]> {
    return this.scheduleRepository.find({
      where: { status: ScheduleStatus.ACTIVE },
      relations: ['tags', 'createdBy'],
      order: { name: 'ASC' },
    });
  }

  // 모든 스케줄 목록 조회 (관리용)
  async findAllSchedules(): Promise<Schedule[]> {
    return this.scheduleRepository.find({
      relations: ['tags', 'createdBy'],
      order: { status: 'ASC', name: 'ASC' },
    });
  }

  // 페이지네이션 + 필터 조회 (관리용)
  async findSchedulesPaginated(opts: {
    page: number;
    pageSize: number;
    status?: 'active' | 'inactive';
    tagIds?: number[];
  }): Promise<{ schedules: Schedule[]; total: number }> {
    const { page, pageSize, status, tagIds } = opts;

    if (tagIds && tagIds.length > 0) {
      // 태그 필터: 선택한 태그를 모두 포함하는 스케줄 (AND 조건)
      const idQb = this.scheduleRepository
        .createQueryBuilder('schedule')
        .innerJoin('schedule.tags', 'tag')
        .where('tag.id IN (:...tagIds)', { tagIds })
        .andWhere('schedule.deletedAt IS NULL');

      if (status) {
        idQb.andWhere('schedule.status = :status', {
          status:
            status === 'active'
              ? ScheduleStatus.ACTIVE
              : ScheduleStatus.INACTIVE,
        });
      }

      const ids = (
        await idQb
          .groupBy('schedule.id')
          .having('COUNT(DISTINCT tag.id) = :tagCount', {
            tagCount: tagIds.length,
          })
          .select('schedule.id')
          .getRawMany()
      ).map((r: { schedule_id: number }) => r.schedule_id);

      if (ids.length === 0) return { schedules: [], total: 0 };

      const [schedules, total] = await this.scheduleRepository.findAndCount({
        where: { id: In(ids) },
        relations: ['tags', 'createdBy'],
        order: { status: 'ASC', name: 'ASC' },
        skip: page * pageSize,
        take: pageSize,
      });

      return { schedules, total };
    }

    // 태그 필터 없음 → 기본 find
    const where: Record<string, unknown> = {};
    if (status) {
      where['status'] =
        status === 'active' ? ScheduleStatus.ACTIVE : ScheduleStatus.INACTIVE;
    }

    const [schedules, total] = await this.scheduleRepository.findAndCount({
      where,
      relations: ['tags', 'createdBy'],
      order: { status: 'ASC', name: 'ASC' },
      skip: page * pageSize,
      take: pageSize,
    });

    return { schedules, total };
  }

  // 스케줄 업데이트 (Google Calendar도 함께 업데이트)
  async updateSchedule(
    id: number,
    dto: UpdateScheduleDto,
  ): Promise<Schedule | null> {
    const schedule = await this.findById(id);
    if (!schedule) return null;

    // Google Calendar 업데이트
    if (dto.name || dto.description !== undefined) {
      await GoogleCalendarUtil.updateCalendar(
        schedule.calendarId,
        dto.name ?? schedule.name,
        dto.description ?? schedule.description,
      );
    }

    // 태그 업데이트
    if (dto.tagIds) {
      const tags = await this.tagRepository.find({
        where: { id: In(dto.tagIds) },
      });
      schedule.tags = tags;
    }

    if (dto.name) schedule.name = dto.name;
    if (dto.description !== undefined) schedule.description = dto.description;

    return this.scheduleRepository.save(schedule);
  }

  // 스케줄 비활성화
  async deactivateSchedule(id: number): Promise<Schedule | null> {
    await this.stopWatch(id);
    await this.scheduleRepository.update(
      { id },
      { status: ScheduleStatus.INACTIVE },
    );
    return this.findById(id);
  }

  // 스케줄 활성화
  async activateSchedule(id: number): Promise<Schedule | null> {
    await this.scheduleRepository.update(
      { id },
      { status: ScheduleStatus.ACTIVE },
    );
    await this.registerWatch(id);
    return this.findById(id);
  }

  // 스케줄 삭제 (soft delete, Google Calendar도 삭제)
  async deleteSchedule(id: number): Promise<void> {
    const schedule = await this.findById(id);
    if (!schedule) return;

    await this.stopWatch(id);

    // Google Calendar 삭제
    try {
      await GoogleCalendarUtil.deleteCalendar(schedule.calendarId);
    } catch (error) {
      // Calendar가 이미 삭제된 경우 무시
      this.logger.warn(
        `Failed to delete calendar ${schedule.calendarId}: ${error}`,
      );
    }

    await this.scheduleRepository.softDelete({ id });
  }

  // ========== Google Calendar Watch ==========

  // watch 등록 — 멱등 (기존 watch가 있으면 stop 후 재등록)
  async registerWatch(id: number): Promise<void> {
    const schedule = await this.scheduleRepository.findOne({ where: { id } });
    if (!schedule) return;

    if (!GoogleCalendarUtil.isWatchConfigured()) {
      this.logger.warn(
        'GOOGLE_WEBHOOK_URL not set, skipping watch registration',
      );
      return;
    }

    // 기존 watch가 있으면 먼저 해제
    if (schedule.watchChannelId && schedule.watchResourceId) {
      try {
        await GoogleCalendarUtil.stopCalendarWatch(
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
      const { resourceId } = await GoogleCalendarUtil.watchCalendarEvents(
        schedule.calendarId,
        channelId,
      );

      const syncToken = await GoogleCalendarUtil.getInitialSyncToken(
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
      await GoogleCalendarUtil.stopCalendarWatch(
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

  // 캘린더 권한 목록 조회 (Google Calendar API 사용)
  async getCalendarPermissions(id: number) {
    const schedule = await this.findById(id);
    if (!schedule) return null;

    return GoogleCalendarUtil.getCalendarAcl(schedule.calendarId);
  }

  // 캘린더 권한 부여
  async shareCalendar(
    id: number,
    email: string,
    role: 'reader' | 'writer' | 'owner',
  ): Promise<void> {
    const schedule = await this.findById(id);
    if (!schedule) throw new Error('Schedule not found');

    await GoogleCalendarUtil.shareCalendar({
      calendarId: schedule.calendarId,
      email,
      role,
    });
  }

  // 캘린더 권한 제거
  async unshareCalendar(id: number, email: string): Promise<void> {
    const schedule = await this.findById(id);
    if (!schedule) throw new Error('Schedule not found');

    await GoogleCalendarUtil.unshareCalendar(schedule.calendarId, email);
  }

  // 구독 (reader 권한 부여 + 사용자 캘린더 목록에 추가)
  async subscribe(
    id: number,
    email: string,
    userRefreshToken: string,
  ): Promise<void> {
    const schedule = await this.findById(id);
    if (!schedule) throw new Error('Schedule not found');

    // 1. reader 권한 부여
    await this.shareCalendar(id, email, 'reader');

    // 2. 사용자 캘린더 목록에 추가
    await GoogleCalendarUtil.addCalendarToUserList(
      schedule.calendarId,
      userRefreshToken,
    );
  }

  // 구독 해제 (권한 제거 + 사용자 캘린더 목록에서 제거)
  async unsubscribe(
    id: number,
    email: string,
    userRefreshToken: string,
  ): Promise<void> {
    const schedule = await this.findById(id);
    if (!schedule) throw new Error('Schedule not found');

    // 1. 권한 제거
    await this.unshareCalendar(id, email);

    // 2. 사용자 캘린더 목록에서 제거
    await GoogleCalendarUtil.removeCalendarFromUserList(
      schedule.calendarId,
      userRefreshToken,
    );
  }

  // 사용자가 구독 중인지 확인
  async isSubscribed(id: number, email: string): Promise<boolean> {
    const permissions = await this.getCalendarPermissions(id);
    if (!permissions) return false;
    return permissions.some((p) => p.email === email);
  }

  // ========== 반복 일정 ==========

  async createRecurringEvents(dto: CreateRecurringEventsDto): Promise<void> {
    const schedule = await this.findById(dto.scheduleId);
    if (!schedule) throw new Error('Schedule not found');

    // 1. 날짜 배열 계산
    const dates = expandRecurringDates(dto);
    if (dates.length === 0) throw new Error('생성할 일정이 없습니다.');

    // 2. groupId 생성 + Redis suppress 등록 (이벤트 생성 전)
    const groupId = randomUUID();
    await this.cache.set(`suppress:group:${groupId}`, true, 3 * 60 * 1000);

    // 3. 이벤트 N개 병렬 생성
    const results = await Promise.allSettled(
      dates.map(({ startDateTime, endDateTime }) =>
        GoogleCalendarUtil.createEventAsServiceAccount(schedule.calendarId, {
          summary: dto.title,
          startDateTime,
          endDateTime,
          description: dto.description,
          location: dto.location,
          groupId,
        }),
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
    });

    // 5. Slack 채널에 요약 알림 직접 발송
    const slackChannelIds = await this.channelService.getSlackChannelIds(
      dto.scheduleId,
    );
    if (slackChannelIds.length > 0) {
      const blocks = buildRecurringCreationBlocks(
        schedule.name,
        dto,
        dates.length,
        successCount,
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

  // groupId로 그룹 조회
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

  async deleteRecurringGroup(
    groupDbId: number,
    scope: 'all' | 'future',
  ): Promise<{ deleted: number; total: number }> {
    const group = await this.recurrenceGroupRepository.findOne({
      where: { id: groupDbId },
    });
    if (!group) throw new Error('반복 그룹을 찾을 수 없습니다.');

    const schedule = await this.findById(group.scheduleId);
    if (!schedule) throw new Error('시간표를 찾을 수 없습니다.');

    await this.cache.set(
      `suppress:group:${group.groupId}`,
      true,
      3 * 60 * 1000,
    );

    let events = await GoogleCalendarUtil.listEventsByGroupId(
      schedule.calendarId,
      group.groupId,
    );

    if (scope === 'future') {
      const today = new Date().toISOString().slice(0, 10);
      events = events.filter(
        (e) => (e.start?.dateTime ?? e.start?.date ?? '') >= today,
      );
    }

    const results = await Promise.allSettled(
      events.map((e) =>
        GoogleCalendarUtil.deleteEventAsServiceAccount(
          schedule.calendarId,
          e.id!,
        ),
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

    const slackChannelIds = await this.channelService.getSlackChannelIds(
      group.scheduleId,
    );
    await Promise.allSettled(
      slackChannelIds.map((channel) =>
        this.slack.chat.postMessage({
          channel,
          text: `🗑️ ${schedule.name} 반복 일정 삭제 안내`,
          blocks: buildRecurringDeleteBlocks(
            schedule.name,
            group.title,
            scope,
            deletedCount,
            events.length,
          ),
        }),
      ),
    );

    this.logger.log(
      `Recurring group deleted: groupId=${group.groupId}, scope=${scope}, deleted=${deletedCount}/${events.length}`,
    );

    return { deleted: deletedCount, total: events.length };
  }

  async updateRecurringGroup(
    groupDbId: number,
    dto: UpdateRecurringEventsDto,
    scope: 'all' | 'future',
  ): Promise<{ updated: number; total: number }> {
    const group = await this.recurrenceGroupRepository.findOne({
      where: { id: groupDbId },
    });
    if (!group) throw new Error('반복 그룹을 찾을 수 없습니다.');

    const schedule = await this.findById(group.scheduleId);
    if (!schedule) throw new Error('시간표를 찾을 수 없습니다.');

    await this.cache.set(
      `suppress:group:${group.groupId}`,
      true,
      3 * 60 * 1000,
    );

    let events = await GoogleCalendarUtil.listEventsByGroupId(
      schedule.calendarId,
      group.groupId,
    );

    if (scope === 'future') {
      const today = new Date().toISOString().slice(0, 10);
      events = events.filter(
        (e) => (e.start?.dateTime ?? e.start?.date ?? '') >= today,
      );
    }

    const results = await Promise.allSettled(
      events.map((e) => {
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

        return GoogleCalendarUtil.updateEventAsServiceAccount(
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
      }),
    );
    const updatedCount = results.filter((r) => r.status === 'fulfilled').length;

    if (dto.title) {
      await this.recurrenceGroupRepository.update(
        { id: groupDbId },
        { title: dto.title },
      );
    }

    const slackChannelIds = await this.channelService.getSlackChannelIds(
      group.scheduleId,
    );
    await Promise.allSettled(
      slackChannelIds.map((channel) =>
        this.slack.chat.postMessage({
          channel,
          text: `✏️ ${schedule.name} 반복 일정 수정 안내`,
          blocks: buildRecurringUpdateBlocks(
            schedule.name,
            dto.title ?? group.title,
            scope,
            updatedCount,
            events.length,
          ),
        }),
      ),
    );

    this.logger.log(
      `Recurring group updated: groupId=${group.groupId}, scope=${scope}, updated=${updatedCount}/${events.length}`,
    );

    return { updated: updatedCount, total: events.length };
  }
}

// ========== 날짜 확장 헬퍼 ==========
// TODO 타입 의존성 제거 후 DateUtil로 이동 예정

function expandRecurringDates(dto: CreateRecurringEventsDto): {
  startDateTime: string;
  endDateTime: string;
}[] {
  // UTC midnight으로 생성 → rrule이 UTC 기준 날짜를 그대로 반환
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
    // getUTC* 사용으로 서버 timezone 무관하게 정확한 날짜 추출
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
  return map[day];
}


function buildRecurringDeleteBlocks(
  scheduleName: string,
  title: string,
  scope: 'all' | 'future',
  deletedCount: number,
  totalCount: number,
): KnownBlock[] {
  const scopeText = scope === 'all' ? '전체' : '오늘 이후';
  const statusText =
    deletedCount < totalCount
      ? `⚠️ ${deletedCount}/${totalCount}개 삭제 완료`
      : `총 ${deletedCount}개 삭제`;

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🗑️ [${scheduleName}] 반복 일정 삭제 안내`,
        emoji: true,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `📌 *일정 제목*\n*${title}*` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `🔍 *삭제 범위*\n${scopeText}` },
        { type: 'mrkdwn', text: `📊 *처리 결과*\n${statusText}` },
      ],
    },
    { type: 'divider' },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `*Bannote Bot*` }],
    },
  ] as unknown as KnownBlock[];
}

function buildRecurringUpdateBlocks(
  scheduleName: string,
  title: string,
  scope: 'all' | 'future',
  updatedCount: number,
  totalCount: number,
): KnownBlock[] {
  const scopeText = scope === 'all' ? '전체' : '오늘 이후';
  const statusText =
    updatedCount < totalCount
      ? `⚠️ ${updatedCount}/${totalCount}개 수정 완료`
      : `총 ${updatedCount}개 수정`;

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `✏️ [${scheduleName}] 반복 일정 수정 안내`,
        emoji: true,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `📌 *일정 제목*\n*${title}*` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `🔍 *수정 범위*\n${scopeText}` },
        { type: 'mrkdwn', text: `📊 *처리 결과*\n${statusText}` },
      ],
    },
    { type: 'divider' },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `*Bannote Bot*` }],
    },
  ] as unknown as KnownBlock[];
}

// Slack 알림 블록 빌더
function buildRecurringCreationBlocks(
  scheduleName: string,
  dto: CreateRecurringEventsDto,
  totalCount: number,
  successCount: number,
): KnownBlock[] {
  const recurrenceLabel: Record<RecurrenceType, string> = {
    weekly: '매주',
    biweekly: '격주',
    monthly: '매월',
  };
  const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
  const daysText = dto.daysOfWeek?.length
    ? dto.daysOfWeek.map((d) => dayLabels[d]).join(', ')
    : '';

  const recurrenceText =
    dto.recurrenceType !== 'monthly' && daysText
      ? `${recurrenceLabel[dto.recurrenceType]} ${daysText}요일`
      : recurrenceLabel[dto.recurrenceType];

  const statusText =
    successCount < totalCount
      ? `⚠️ ${successCount}/${totalCount}개 생성 완료`
      : `총 ${successCount}개`;

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `✨ [${scheduleName}] 반복 일정 추가 안내`,
        emoji: true,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `📌 *일정 제목*\n*${dto.title}*`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `🗓️ *기간*\n${dto.startDate} ~ ${dto.endDate}`,
        },
        {
          type: 'mrkdwn',
          text: `🕐 *시간*\n${dto.startTime} ~ ${dto.endTime}`,
        },
      ],
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `🔁 *반복*\n${recurrenceText}`,
        },
        {
          type: 'mrkdwn',
          text: `📊 *생성 결과*\n${statusText}`,
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*Bannote Bot*`,
        },
      ],
    },
  ] as unknown as KnownBlock[];
}
