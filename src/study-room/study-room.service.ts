import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StudyRoom, StudyRoomStatus } from './study-room.entity';
import { GoogleCalendarUtil } from '../google/google-calendar.util';
import { UserService } from '../user/user.service';
import { BusinessError, ErrorCode } from '../common/errors';

export interface CreateStudyRoomDto {
  name: string;
}

export interface BookStudyRoomDto {
  studyRoomId: number;
  title: string;
  startTime: Date;
  endTime: Date;
  bookerSlackId: string;
  attendeeSlackIds: string[];
}

export interface BookingItem {
  calendarId: string;
  eventId: string;
  roomName: string;
  summary: string;
  startTime: Date;
  endTime: Date;
}

export interface ModifyBookingDto {
  title: string;
  startTime: Date;
  endTime: Date;
  attendeeSlackIds: string[];
  roomName: string;
}

@Injectable()
export class StudyRoomService {
  private readonly logger = new Logger(StudyRoomService.name);

  constructor(
    @InjectRepository(StudyRoom)
    private studyRoomRepository: Repository<StudyRoom>,
    private readonly userService: UserService,
  ) {}

  async create(dto: CreateStudyRoomDto): Promise<StudyRoom> {
    const { calendarId } = await GoogleCalendarUtil.createCalendar(dto.name);
    await GoogleCalendarUtil.makeCalendarPublic(calendarId);
    const room = this.studyRoomRepository.create({
      name: dto.name,
      calendarId,
    });
    return this.studyRoomRepository.save(room);
  }

  async findAll(onlyActive = false): Promise<StudyRoom[]> {
    return this.studyRoomRepository.find({
      where: onlyActive ? { status: StudyRoomStatus.ACTIVE } : {},
      order: { name: 'ASC' },
    });
  }

  async findById(id: number): Promise<StudyRoom | null> {
    return this.studyRoomRepository.findOne({ where: { id } });
  }

  async bookStudyRoom(dto: BookStudyRoomDto): Promise<string> {
    const room = await this.findById(dto.studyRoomId);
    if (!room) throw new BusinessError(ErrorCode.STUDY_ROOM_NOT_FOUND);

    console.log(dto.attendeeSlackIds);

    // 1. 캘린더 수정 권한이 있는 유저 토큰 조회
    const acl = await GoogleCalendarUtil.getCalendarAcl(room.calendarId);
    const editorEmails = acl
      .filter((e) => e.role === 'writer' || e.role === 'owner')
      .map((e) => e.email);

    const editor = await this.userService.findActiveByEmails(editorEmails);
    if (!editor) {
      throw new BusinessError(ErrorCode.CALENDAR_WRITER_NOT_FOUND);
    }

    const refreshToken = this.userService.getDecryptedRefreshToken(editor);
    if (!refreshToken) {
      throw new BusinessError(ErrorCode.CALENDAR_WRITER_NO_TOKEN);
    }

    // 2. 중복 예약 체크
    const isBusy = await GoogleCalendarUtil.isTimeSlotBusy(
      room.calendarId,
      refreshToken,
      dto.startTime,
      dto.endTime,
    );
    if (isBusy) {
      throw new BusinessError(ErrorCode.BOOKING_CONFLICT);
    }

    // 3. 참석자 정보 조회 (예약자 포함)
    const allSlackIds = [dto.bookerSlackId, ...dto.attendeeSlackIds];
    const attendees = (
      await Promise.all(
        allSlackIds.map((id) => this.userService.findBySlackIdWithClass(id)),
      )
    ).filter((u): u is NonNullable<typeof u> => u !== null);

    const attendeeEmails = attendees.map((u) => u.email);
    const currentYear = new Date().getFullYear();
    const description = attendees
      .map((u) => {
        const admissionYear = u.studentClass?.name?.split('-')[0];
        const gradePart = admissionYear
          ? ` (${currentYear - parseInt(admissionYear) + 1}학년)`
          : '';
        return `${u.name}${gradePart} | ${u.code ?? '-'} | ${u.email}`;
      })
      .join('\n');

    // 4. 구글 캘린더 이벤트 생성
    const eventId = await GoogleCalendarUtil.createEvent(
      room.calendarId,
      refreshToken,
      {
        summary: dto.title,
        startTime: dto.startTime,
        endTime: dto.endTime,
        attendeeEmails,
        location: room.name,
        description,
      },
    );

    this.logger.log(
      `Study room booked: ${room.name} (${dto.startTime.toISOString()} ~ ${dto.endTime.toISOString()}), eventId: ${eventId}`,
    );

    return eventId;
  }

  private async getEditorRefreshToken(calendarId: string): Promise<string> {
    const acl = await GoogleCalendarUtil.getCalendarAcl(calendarId);
    const editorEmails = acl
      .filter((e) => e.role === 'writer' || e.role === 'owner')
      .map((e) => e.email);

    const editor = await this.userService.findActiveByEmails(editorEmails);
    if (!editor) throw new BusinessError(ErrorCode.CALENDAR_WRITER_NOT_FOUND);

    const refreshToken = this.userService.getDecryptedRefreshToken(editor);
    if (!refreshToken)
      throw new BusinessError(ErrorCode.CALENDAR_WRITER_NO_TOKEN);

    return refreshToken;
  }

  // TODO 토큰 절약을 위해 추후 Redis 캐싱 예정
  async getMyBookings(slackId: string): Promise<BookingItem[]> {
    const user = await this.userService.findBySlackId(slackId);
    if (!user) return [];

    const rooms = await this.findAll();
    if (rooms.length === 0) return [];

    const calendarIds = rooms.map((r) => r.calendarId);
    const roomMap = new Map(rooms.map((r) => [r.calendarId, r.name]));

    const rawBookings = await GoogleCalendarUtil.getUserBookings(
      calendarIds,
      user.email,
    );

    return rawBookings.map(({ calendarId, event }) => ({
      calendarId,
      eventId: event.id!,
      roomName: roomMap.get(calendarId) ?? calendarId,
      summary: event.summary ?? '(제목 없음)',
      startTime: new Date(event.start!.dateTime!),
      endTime: new Date(event.end!.dateTime!),
    }));
  }

  async rename(id: number, name: string): Promise<void> {
    const room = await this.findById(id);
    if (!room) throw new BusinessError(ErrorCode.STUDY_ROOM_NOT_FOUND);
    await GoogleCalendarUtil.updateCalendar(room.calendarId, name);
    await this.studyRoomRepository.update(id, { name });
  }

  async updateInfo(
    id: number,
    dto: { description?: string | null; status?: StudyRoomStatus },
  ): Promise<void> {
    await this.studyRoomRepository.update(id, dto as any);
  }

  async addEditor(id: number, email: string): Promise<void> {
    const room = await this.findById(id);
    if (!room) throw new BusinessError(ErrorCode.STUDY_ROOM_NOT_FOUND);
    await GoogleCalendarUtil.shareCalendar({
      calendarId: room.calendarId,
      email,
      role: 'writer',
    });
  }

  async removeEditor(id: number, email: string): Promise<void> {
    const room = await this.findById(id);
    if (!room) throw new BusinessError(ErrorCode.STUDY_ROOM_NOT_FOUND);
    await GoogleCalendarUtil.unshareCalendar(room.calendarId, email);
  }

  async remove(id: number): Promise<void> {
    const room = await this.findById(id);
    if (!room) throw new BusinessError(ErrorCode.STUDY_ROOM_NOT_FOUND);
    await GoogleCalendarUtil.deleteCalendar(room.calendarId);
    await this.studyRoomRepository.softDelete(id);
  }

  async cancelBooking(calendarId: string, eventId: string): Promise<void> {
    const refreshToken = await this.getEditorRefreshToken(calendarId);
    await GoogleCalendarUtil.deleteEvent(calendarId, refreshToken, eventId);
  }

  async modifyBooking(
    calendarId: string,
    eventId: string,
    dto: ModifyBookingDto,
  ): Promise<void> {
    const refreshToken = await this.getEditorRefreshToken(calendarId);

    const attendees = (
      await Promise.all(
        dto.attendeeSlackIds.map((id) =>
          this.userService.findBySlackIdWithClass(id),
        ),
      )
    ).filter((u): u is NonNullable<typeof u> => u !== null);

    const attendeeEmails = attendees.map((u) => u.email);
    const currentYear = new Date().getFullYear();
    const description = attendees
      .map((u) => {
        const admissionYear = u.studentClass?.name?.split('-')[0];
        const gradePart = admissionYear
          ? ` (${currentYear - parseInt(admissionYear) + 1}학년)`
          : '';
        return `${u.name}${gradePart} | ${u.code ?? '-'} | ${u.email}`;
      })
      .join('\n');

    await GoogleCalendarUtil.updateEvent(calendarId, refreshToken, eventId, {
      summary: dto.title,
      startTime: dto.startTime,
      endTime: dto.endTime,
      attendeeEmails,
      location: dto.roomName,
      description,
    });
  }
}
