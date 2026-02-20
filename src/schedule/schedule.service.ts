import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Schedule, ScheduleStatus } from './schedule.entity';
import { GoogleCalendarUtil } from '../google/google-calendar.util';
import { Tag } from '../tag/tag.entity';

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

  // 태그별 활성 스케줄 조회 (단일 태그)
  async findActiveSchedulesByTagId(tagId: number): Promise<Schedule[]> {
    return this.scheduleRepository
      .createQueryBuilder('schedule')
      .leftJoinAndSelect('schedule.tags', 'tag')
      .leftJoinAndSelect('schedule.createdBy', 'createdBy')
      .where('tag.id = :tagId', { tagId })
      .andWhere('schedule.status = :status', { status: ScheduleStatus.ACTIVE })
      .andWhere('schedule.deletedAt IS NULL')
      .orderBy('schedule.name', 'ASC')
      .getMany();
  }

  // 태그별 활성 스케줄 조회 (다중 태그 - AND 조건)
  async findActiveSchedulesByTagIds(tagIds: number[]): Promise<Schedule[]> {
    if (tagIds.length === 0) return [];

    // 모든 선택된 태그를 가진 schedule id 조회
    const scheduleIdsResult = await this.scheduleRepository
      .createQueryBuilder('schedule')
      .innerJoin('schedule.tags', 'tag')
      .where('tag.id IN (:...tagIds)', { tagIds })
      .andWhere('schedule.status = :status', { status: ScheduleStatus.ACTIVE })
      .andWhere('schedule.deletedAt IS NULL')
      .groupBy('schedule.id')
      .having('COUNT(DISTINCT tag.id) = :tagCount', { tagCount: tagIds.length })
      .select('schedule.id')
      .getRawMany();

    if (scheduleIdsResult.length === 0) return [];

    const ids = scheduleIdsResult.map(
      (s: { schedule_id: number }) => s.schedule_id,
    );

    // 전체 데이터 조회
    return this.scheduleRepository.find({
      where: { id: In(ids) },
      relations: ['tags', 'createdBy'],
      order: { name: 'ASC' },
    });
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
    return this.findById(id);
  }

  // 스케줄 삭제 (soft delete, Google Calendar도 삭제)
  async deleteSchedule(id: number): Promise<void> {
    const schedule = await this.findById(id);
    if (!schedule) return;

    // Google Calendar 삭제
    try {
      await GoogleCalendarUtil.deleteCalendar(schedule.calendarId);
    } catch (error) {
      // Calendar가 이미 삭제된 경우 무시
      console.warn(`Failed to delete calendar ${schedule.calendarId}:`, error);
    }

    await this.scheduleRepository.softDelete({ id });
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
