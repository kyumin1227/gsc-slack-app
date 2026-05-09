import { Injectable, Logger } from '@nestjs/common';
import { BusinessError, ScheduleErrorCode } from '../../common/errors';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Schedule, ScheduleStatus } from '../schedule.entity';
import { GoogleCalendarsService } from '../../google/calendar/calendars.service';
import { GoogleAclService } from '../../google/calendar/acl.service';
import { GoogleCalendarListService } from '../../google/calendar/calendar-list.service';
import { UserService } from '../../user/service/user.service';
import { Tag } from '../../tag/tag.entity';
import { ScheduleWatchService } from './schedule-watch.service';
import { CreateScheduleDto, UpdateScheduleDto } from '../dto/schedule.dto';

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    @InjectRepository(Schedule)
    private scheduleRepository: Repository<Schedule>,
    @InjectRepository(Tag)
    private tagRepository: Repository<Tag>,
    private readonly googleCalendarsService: GoogleCalendarsService,
    private readonly googleAclService: GoogleAclService,
    private readonly googleCalendarListService: GoogleCalendarListService,
    private readonly userService: UserService,
    private readonly scheduleWatchService: ScheduleWatchService,
  ) {}

  // 스케줄 생성 (Google Calendar도 함께 생성)
  async createSchedule(dto: CreateScheduleDto): Promise<Schedule> {
    // 1. Google Calendar 생성
    const { calendarId } = await this.googleCalendarsService.createCalendar(
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

    // 4. 캘린더 전체 공개 설정
    await this.googleAclService.makeCalendarPublic(calendarId);

    // 5. 생성자에게 writer 권한 부여 및 자동 구독
    if (dto.creatorEmail && dto.creatorRefreshToken) {
      await this.googleAclService.shareCalendar({
        calendarId,
        email: dto.creatorEmail,
        role: 'writer',
      });
      await this.googleCalendarListService.addCalendarToUserList(
        calendarId,
        dto.creatorRefreshToken,
      );
    }

    // 6. Google Calendar Watch 등록
    await this.scheduleWatchService.registerWatch(saved.id);

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

  // 특정 태그를 가진 활성 스케줄 목록 조회 (태그 시간표용)
  async findActiveSchedulesByTagId(tagId: number): Promise<Schedule[]> {
    const ids = await this.scheduleRepository
      .createQueryBuilder('schedule')
      .innerJoin('schedule.tags', 'tag')
      .where('tag.id = :tagId', { tagId })
      .andWhere('schedule.status = :status', { status: ScheduleStatus.ACTIVE })
      .andWhere('schedule.deletedAt IS NULL')
      .select('schedule.id')
      .getRawMany()
      .then((rows: { schedule_id: number }[]) =>
        rows.map((r) => r.schedule_id),
      );

    if (ids.length === 0) return [];

    return this.scheduleRepository.find({
      where: { id: In(ids) },
      order: { name: 'ASC' },
    });
  }

  // 반 대표 슬랙 ID로 자기 반 태그가 달린 활성 스케줄 조회
  async findSchedulesByClassRepSlackId(
    slackUserId: string,
  ): Promise<Schedule[]> {
    const user = await this.userService.findBySlackIdWithClass(slackUserId);
    if (!user?.studentClassId) return [];

    const tag = await this.tagRepository.findOne({
      where: { studentClassId: user.studentClassId },
    });
    if (!tag) return [];

    return this.findActiveSchedulesByTagId(tag.id);
  }

  // 반 대표가 해당 과목에 대한 권한이 있는지 확인 (자기 반 태그 포함 여부)
  async isClassRepAuthorizedForSchedule(
    slackUserId: string,
    scheduleId: number,
  ): Promise<boolean> {
    const user = await this.userService.findBySlackIdWithClass(slackUserId);
    if (!user?.studentClassId) return false;

    const tag = await this.tagRepository.findOne({
      where: { studentClassId: user.studentClassId },
    });
    if (!tag) return false;

    const count = await this.scheduleRepository
      .createQueryBuilder('schedule')
      .innerJoin('schedule.tags', 'tag')
      .where('schedule.id = :scheduleId', { scheduleId })
      .andWhere('tag.id = :tagId', { tagId: tag.id })
      .getCount();

    return count > 0;
  }

  // 태그가 없는 활성 스케줄 목록 조회
  async findActiveSchedulesWithoutTags(): Promise<Schedule[]> {
    return this.scheduleRepository
      .createQueryBuilder('schedule')
      .leftJoin('schedule.tags', 'tag')
      .where('schedule.status = :status', { status: ScheduleStatus.ACTIVE })
      .andWhere('schedule.deletedAt IS NULL')
      .groupBy('schedule.id')
      .having('COUNT(tag.id) = 0')
      .orderBy('schedule.name', 'ASC')
      .getMany();
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

    if (dto.name || dto.description !== undefined) {
      await this.googleCalendarsService.updateCalendar(
        schedule.calendarId,
        dto.name ?? schedule.name,
        dto.description ?? schedule.description,
      );
    }

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
    await this.scheduleWatchService.stopWatch(id);
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
    await this.scheduleWatchService.registerWatch(id);
    return this.findById(id);
  }

  // 스케줄 삭제 (soft delete, Google Calendar도 삭제)
  async deleteSchedule(id: number): Promise<void> {
    const schedule = await this.findById(id);
    if (!schedule) return;

    await this.scheduleWatchService.stopWatch(id);

    try {
      await this.googleCalendarsService.deleteCalendar(schedule.calendarId);
    } catch (error) {
      this.logger.warn(
        `Failed to delete calendar ${schedule.calendarId}: ${error}`,
      );
    }

    await this.scheduleRepository.softDelete({ id });
  }

  // 캘린더 권한 목록 조회
  async getCalendarPermissions(id: number) {
    const schedule = await this.findById(id);
    if (!schedule) return null;

    return this.googleAclService.getCalendarAcl(schedule.calendarId);
  }

  // 캘린더 권한 부여
  async shareCalendar(
    id: number,
    email: string,
    role: 'reader' | 'writer' | 'owner',
  ): Promise<void> {
    const schedule = await this.findById(id);
    if (!schedule) throw new BusinessError(ScheduleErrorCode.SCHEDULE_NOT_FOUND);

    await this.googleAclService.shareCalendar({
      calendarId: schedule.calendarId,
      email,
      role,
    });
  }

  // 캘린더 권한 제거
  async unshareCalendar(id: number, email: string): Promise<void> {
    const schedule = await this.findById(id);
    if (!schedule) throw new BusinessError(ScheduleErrorCode.SCHEDULE_NOT_FOUND);

    await this.googleAclService.unshareCalendar(schedule.calendarId, email);
  }

  // 구독 (사용자 캘린더 목록에 추가)
  async subscribe(id: number, userRefreshToken: string): Promise<void> {
    const schedule = await this.findById(id);
    if (!schedule) throw new BusinessError(ScheduleErrorCode.SCHEDULE_NOT_FOUND);

    await this.googleCalendarListService.addCalendarToUserList(
      schedule.calendarId,
      userRefreshToken,
    );
  }

  // 구독 해제 (사용자 캘린더 목록에서 제거)
  async unsubscribe(id: number, userRefreshToken: string): Promise<void> {
    const schedule = await this.findById(id);
    if (!schedule) throw new BusinessError(ScheduleErrorCode.SCHEDULE_NOT_FOUND);

    await this.googleCalendarListService.removeCalendarFromUserList(
      schedule.calendarId,
      userRefreshToken,
    );
  }

  // 사용자의 구독 중인 calendarId Set 반환
  async getSubscribedCalendarIds(
    userRefreshToken: string,
  ): Promise<Set<string>> {
    return this.googleCalendarListService.getUserCalendarIds(userRefreshToken);
  }
}
