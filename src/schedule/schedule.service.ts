import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Schedule, ScheduleStatus } from './schedule.entity';
import { GoogleCalendarUtil } from '../google/google-calendar.util';
import { Tag } from '../tag/tag.entity';
import { randomUUID } from 'crypto';

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

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    @InjectRepository(Schedule)
    private scheduleRepository: Repository<Schedule>,
    @InjectRepository(Tag)
    private tagRepository: Repository<Tag>,
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

      await this.scheduleRepository.update(id, {
        watchChannelId: channelId,
        watchResourceId: resourceId,
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
}
