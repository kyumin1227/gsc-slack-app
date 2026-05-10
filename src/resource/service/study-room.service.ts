import { Injectable, Logger } from '@nestjs/common';
import { formatClassLabel } from '../../common/class-label.util';
import { ResourceType } from '../resource.entity';
import { GoogleEventsService } from '../../google/calendar/events.service';
import { GoogleAclService } from '../../google/calendar/acl.service';
import { GoogleFreebusyService } from '../../google/calendar/freebusy.service';
import { UserService } from '../../user/service/user.service';
import {
  BusinessError,
  GoogleErrorCode,
  ResourceErrorCode,
} from '../../common/errors';
import {
  BookResourceDto,
  BookingItem,
  ModifyBookingDto,
  RoomAvailability,
} from '../dto/study-room.dto';
import { ResourceService } from './resource.service';

@Injectable()
export class StudyRoomService {
  private readonly logger = new Logger(StudyRoomService.name);

  constructor(
    private readonly resourceService: ResourceService,
    private readonly userService: UserService,
    private readonly googleEventsService: GoogleEventsService,
    private readonly googleAclService: GoogleAclService,
    private readonly googleFreebusyService: GoogleFreebusyService,
  ) {}

  // 캘린더 ACL에서 활성 편집자의 refresh token 조회
  private async getEditorRefreshToken(calendarId: string): Promise<string> {
    const acl = await this.googleAclService.getCalendarAcl(calendarId);
    const editorEmails = acl
      .filter((e) => e.role === 'writer' || e.role === 'owner')
      .map((e) => e.email);

    const editor = await this.userService.findActiveByEmails(editorEmails);
    if (!editor)
      throw new BusinessError(GoogleErrorCode.CALENDAR_WRITER_NOT_FOUND);

    const refreshToken = this.userService.getDecryptedRefreshToken(editor);
    if (!refreshToken)
      throw new BusinessError(GoogleErrorCode.CALENDAR_WRITER_NO_TOKEN);

    return refreshToken;
  }

  // 스터디룸 예약 생성 (시간 충돌 확인 후 Google Calendar 이벤트 생성)
  async bookResource(dto: BookResourceDto): Promise<string> {
    const resource = await this.resourceService.findById(dto.resourceId);
    if (!resource)
      throw new BusinessError(ResourceErrorCode.STUDY_ROOM_NOT_FOUND);
    if (resource.type === ResourceType.PROFESSOR) {
      throw new BusinessError(ResourceErrorCode.STUDY_ROOM_NOT_FOUND);
    }

    const refreshToken = await this.getEditorRefreshToken(resource.calendarId);

    const isBusy = await this.googleFreebusyService.isTimeSlotBusy(
      resource.calendarId,
      refreshToken,
      dto.startTime,
      dto.endTime,
    );
    if (isBusy) {
      throw new BusinessError(ResourceErrorCode.BOOKING_CONFLICT);
    }

    const allSlackIdsSet = new Set([
      dto.bookerSlackId,
      ...dto.attendeeSlackIds,
    ]);
    const allSlackIds = Array.from(allSlackIdsSet);
    const attendees = (
      await Promise.all(
        allSlackIds.map((id) => this.userService.findBySlackIdWithClass(id)),
      )
    ).filter((u): u is NonNullable<typeof u> => u !== null);

    const attendeeEmails = attendees.map((u) => u.email);
    const description = attendees
      .map((u) => {
        const classPart = u.studentClass
          ? ` (${formatClassLabel({ admissionYear: u.studentClass.admissionYear, section: u.studentClass.section })})`
          : '';
        return `${u.name}${classPart} | ${u.code ?? '-'} | ${u.email}`;
      })
      .join('\n');

    const eventId = await this.googleEventsService.createEvent(
      resource.calendarId,
      refreshToken,
      {
        summary: dto.title,
        startTime: dto.startTime,
        endTime: dto.endTime,
        attendeeEmails,
        location: resource.name,
        description,
      },
    );

    this.logger.log(
      `Resource booked: ${resource.name} (${dto.startTime.toISOString()} ~ ${dto.endTime.toISOString()}), eventId: ${eventId}`,
    );

    return eventId;
  }

  // 유저의 스터디룸 예약 목록 조회 (현재 이후 일정만)
  async getMyBookings(slackId: string): Promise<BookingItem[]> {
    const user = await this.userService.findBySlackId(slackId);
    if (!user) return [];

    const rooms = await this.resourceService.findAllByType(
      ResourceType.STUDY_ROOM,
    );
    if (rooms.length === 0) return [];

    const calendarIds = rooms.map((r) => r.calendarId);
    const roomMap = new Map(rooms.map((r) => [r.calendarId, r.name]));

    const rawBookings = await this.googleEventsService.getUserBookings(
      calendarIds,
      user.email,
    );

    return rawBookings.map(({ calendarId, event }) => ({
      calendarId,
      eventId: event.id!,
      resourceName: roomMap.get(calendarId) ?? calendarId,
      summary: event.summary ?? '(제목 없음)',
      startTime: new Date(event.start!.dateTime!),
      endTime: new Date(event.end!.dateTime!),
      attendeeEmails: (event.attendees ?? [])
        .filter((a) => !a.resource)
        .map((a) => a.email ?? ''),
    }));
  }

  // 스터디룸 목록 조회
  async getStudyRooms(): Promise<
    { id: number; name: string; aliases: string[] }[]
  > {
    const rooms = await this.resourceService.findAllByType(
      ResourceType.STUDY_ROOM,
    );
    return rooms.map((r) => ({
      id: r.id,
      name: r.name,
      aliases: r.aliases ?? [],
    }));
  }

  // 스터디룸별 예약 현황 조회 (지정 시간 범위 내 예약 목록 반환)
  async getRoomAvailability(
    startTime: Date,
    endTime: Date,
    roomName?: string,
  ): Promise<RoomAvailability[]> {
    const allRooms = await this.resourceService.findAllByType(
      ResourceType.STUDY_ROOM,
    );
    const rooms = roomName
      ? allRooms.filter(
          (r) => r.name === roomName || (r.aliases ?? []).includes(roomName),
        )
      : allRooms;

    return Promise.all(
      rooms.map(async (room) => {
        const events = await this.googleEventsService.listEventsInRange(
          room.calendarId,
          startTime,
          endTime,
        );
        const bookings = events
          .filter((e) => e.status !== 'cancelled' && e.start?.dateTime)
          .map((e) => ({
            startTime: e.start!.dateTime!,
            endTime: e.end!.dateTime!,
          }));
        return { roomName: room.name, bookings };
      }),
    );
  }

  // 예약 취소 (Google Calendar 이벤트 삭제)
  async cancelBooking(calendarId: string, eventId: string): Promise<void> {
    const refreshToken = await this.getEditorRefreshToken(calendarId);
    await this.googleEventsService.deleteEvent(
      calendarId,
      refreshToken,
      eventId,
    );
  }

  // 예약 수정 (참석자 없으면 취소, 있으면 이벤트 업데이트)
  async modifyBooking(
    calendarId: string,
    eventId: string,
    dto: ModifyBookingDto,
  ): Promise<'cancelled' | 'modified'> {
    if (dto.attendeeSlackIds.length === 0) {
      await this.cancelBooking(calendarId, eventId);
      return 'cancelled';
    }

    const resource = await this.resourceService.findByCalendarId(calendarId);
    if (!resource)
      throw new BusinessError(ResourceErrorCode.STUDY_ROOM_NOT_FOUND);

    const refreshToken = await this.getEditorRefreshToken(calendarId);

    const isBusy = await this.googleFreebusyService.isTimeSlotBusyExcluding(
      calendarId,
      dto.startTime,
      dto.endTime,
      eventId,
    );
    if (isBusy) {
      throw new BusinessError(ResourceErrorCode.BOOKING_CONFLICT);
    }

    const attendees = (
      await Promise.all(
        dto.attendeeSlackIds.map((id) =>
          this.userService.findBySlackIdWithClass(id),
        ),
      )
    ).filter((u): u is NonNullable<typeof u> => u !== null);

    const attendeeEmails = attendees.map((u) => u.email);
    const description = attendees
      .map((u) => {
        const classPart = u.studentClass
          ? ` (${formatClassLabel({ admissionYear: u.studentClass.admissionYear, section: u.studentClass.section })})`
          : '';
        return `${u.name}${classPart} | ${u.code ?? '-'} | ${u.email}`;
      })
      .join('\n');

    await this.googleEventsService.updateEvent(
      calendarId,
      refreshToken,
      eventId,
      {
        summary: dto.title,
        startTime: dto.startTime,
        endTime: dto.endTime,
        attendeeEmails,
        location: resource.name,
        description,
      },
    );

    return 'modified';
  }
}
