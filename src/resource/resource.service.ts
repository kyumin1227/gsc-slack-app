import { Injectable, Logger } from '@nestjs/common';
import { formatClassLabel } from '../common/class-label.util';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Resource, ResourceStatus, ResourceType } from './resource.entity';
import { GoogleCalendarService } from '../google/google-calendar.service';
import { UserService } from '../user/user.service';
import { BusinessError, ErrorCode } from '../common/errors';

export interface CreateResourceDto {
  name: string;
  type?: ResourceType;
  aliases?: string[];
  description?: string;
  isDefault?: boolean;
}

export interface BookResourceDto {
  resourceId: number;
  title: string;
  startTime: Date;
  endTime: Date;
  bookerSlackId: string;
  attendeeSlackIds: string[];
}

export interface ConsultationItem {
  professorName: string;
  summary: string;
  startTime: Date;
  endTime: Date;
  htmlLink?: string;
}

export interface BookingItem {
  calendarId: string;
  eventId: string;
  resourceName: string;
  summary: string;
  startTime: Date;
  endTime: Date;
}

export interface ModifyBookingDto {
  title: string;
  startTime: Date;
  endTime: Date;
  attendeeSlackIds: string[];
  resourceName: string;
}

@Injectable()
export class ResourceService {
  private readonly logger = new Logger(ResourceService.name);

  constructor(
    @InjectRepository(Resource)
    private readonly resourceRepository: Repository<Resource>,
    private readonly userService: UserService,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  async create(dto: CreateResourceDto): Promise<Resource> {
    const { calendarId } = await this.googleCalendarService.createCalendar(
      dto.name,
    );

    await this.googleCalendarService.makeCalendarPublic(calendarId);

    if (dto.isDefault) {
      await this.resourceRepository
        .createQueryBuilder()
        .update()
        .set({ isDefault: false })
        .where('1=1')
        .execute();
    }

    const resource = this.resourceRepository.create({
      name: dto.name,
      calendarId,
      type: dto.type ?? ResourceType.STUDY_ROOM,
      aliases: dto.aliases ?? [],
      description: dto.description,
      isDefault: dto.isDefault ?? false,
      status: ResourceStatus.ACTIVE,
    });
    return await this.resourceRepository.save(resource);
  }

  async findAll(onlyActive = false): Promise<Resource[]> {
    return this.resourceRepository.find({
      where: onlyActive ? { status: ResourceStatus.ACTIVE } : {},
      order: { name: 'ASC' },
    });
  }

  async findAllByType(
    type: ResourceType,
    onlyActive = false,
  ): Promise<Resource[]> {
    return this.resourceRepository.find({
      where: {
        type,
        ...(onlyActive ? { status: ResourceStatus.ACTIVE } : {}),
      },
      order: { name: 'ASC' },
    });
  }

  async findById(id: number): Promise<Resource | null> {
    return this.resourceRepository.findOne({ where: { id } });
  }

  async findDefault(): Promise<Resource | null> {
    return this.resourceRepository.findOne({ where: { isDefault: true } });
  }

  async setDefault(id: number): Promise<void> {
    await this.resourceRepository
      .createQueryBuilder()
      .update()
      .set({ isDefault: false })
      .where('1=1')
      .execute();
    await this.resourceRepository.update(id, { isDefault: true });
  }

  async unsetDefault(id: number): Promise<void> {
    await this.resourceRepository.update(id, { isDefault: false });
  }

  // location 문자열의 alias 매칭 — 활성 리소스 대상
  async findByAlias(location: string): Promise<Resource | null> {
    const lower = location.toLowerCase();
    const resources = await this.resourceRepository.find({
      where: { status: ResourceStatus.ACTIVE },
    });
    return (
      resources.find((r) =>
        r.aliases?.some((a) => a.toLowerCase() === lower),
      ) ?? null
    );
  }

  async bookResource(dto: BookResourceDto): Promise<string> {
    const resource = await this.findById(dto.resourceId);
    if (!resource) throw new BusinessError(ErrorCode.STUDY_ROOM_NOT_FOUND);
    if (resource.type === ResourceType.PROFESSOR) {
      throw new BusinessError(ErrorCode.STUDY_ROOM_NOT_FOUND); // 교수 캘린더는 예약 불가
    }

    const acl = await this.googleCalendarService.getCalendarAcl(
      resource.calendarId,
    );
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

    const isBusy = await this.googleCalendarService.isTimeSlotBusy(
      resource.calendarId,
      refreshToken,
      dto.startTime,
      dto.endTime,
    );
    if (isBusy) {
      throw new BusinessError(ErrorCode.BOOKING_CONFLICT);
    }

    const allSlackIds = [dto.bookerSlackId, ...dto.attendeeSlackIds];
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

    const eventId = await this.googleCalendarService.createEvent(
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

  private async getEditorRefreshToken(calendarId: string): Promise<string> {
    const acl = await this.googleCalendarService.getCalendarAcl(calendarId);
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

  async getMyBookings(slackId: string): Promise<BookingItem[]> {
    const user = await this.userService.findBySlackId(slackId);
    if (!user) return [];

    const rooms = await this.findAllByType(ResourceType.STUDY_ROOM);
    if (rooms.length === 0) return [];

    const calendarIds = rooms.map((r) => r.calendarId);
    const roomMap = new Map(rooms.map((r) => [r.calendarId, r.name]));

    const rawBookings = await this.googleCalendarService.getUserBookings(
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
    }));
  }

  async rename(id: number, name: string): Promise<void> {
    const resource = await this.findById(id);
    if (!resource) throw new BusinessError(ErrorCode.STUDY_ROOM_NOT_FOUND);
    await this.googleCalendarService.updateCalendar(resource.calendarId, name);
    await this.resourceRepository.update(id, { name });
  }

  async updateInfo(
    id: number,
    dto: {
      description?: string | null;
      status?: ResourceStatus;
      aliases?: string[];
      type?: ResourceType;
      bookingUrl?: string | null;
    },
  ): Promise<void> {
    await this.resourceRepository.update(id, dto as any);
  }

  async getProfessorConsultations(
    userEmail: string,
  ): Promise<ConsultationItem[]> {
    const professors = await this.findAllByType(ResourceType.PROFESSOR, true);
    const now = new Date();
    const future = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const results: ConsultationItem[] = [];

    await Promise.all(
      professors.map(async (prof) => {
        const events = await this.googleCalendarService.listEventsInRange(
          prof.calendarId,
          now,
          future,
        );
        for (const ev of events) {
          if (ev.status === 'cancelled') continue;
          const isAttendee = ev.attendees?.some(
            (a) => a.email?.toLowerCase() === userEmail.toLowerCase(),
          );
          if (!isAttendee) continue;
          const start = new Date(ev.start?.dateTime ?? ev.start?.date ?? '');
          const end = new Date(ev.end?.dateTime ?? ev.end?.date ?? '');
          results.push({
            professorName: prof.name,
            summary: ev.summary ?? '(제목 없음)',
            startTime: start,
            endTime: end,
            htmlLink: ev.htmlLink ?? undefined,
          });
        }
      }),
    );

    return results.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  }

  async addEditor(id: number, email: string): Promise<void> {
    const resource = await this.findById(id);
    if (!resource) throw new BusinessError(ErrorCode.STUDY_ROOM_NOT_FOUND);
    await this.googleCalendarService.shareCalendar({
      calendarId: resource.calendarId,
      email,
      role: 'writer',
    });
  }

  async removeEditor(id: number, email: string): Promise<void> {
    const resource = await this.findById(id);
    if (!resource) throw new BusinessError(ErrorCode.STUDY_ROOM_NOT_FOUND);
    await this.googleCalendarService.unshareCalendar(
      resource.calendarId,
      email,
    );
  }

  async remove(id: number): Promise<void> {
    const resource = await this.findById(id);
    if (!resource) throw new BusinessError(ErrorCode.STUDY_ROOM_NOT_FOUND);
    await this.googleCalendarService.deleteCalendar(resource.calendarId);
    await this.resourceRepository.softDelete(id);
  }

  async cancelBooking(calendarId: string, eventId: string): Promise<void> {
    const refreshToken = await this.getEditorRefreshToken(calendarId);
    await this.googleCalendarService.deleteEvent(
      calendarId,
      refreshToken,
      eventId,
    );
  }

  async modifyBooking(
    calendarId: string,
    eventId: string,
    dto: ModifyBookingDto,
  ): Promise<'cancelled' | 'modified'> {
    if (dto.attendeeSlackIds.length === 0) {
      await this.cancelBooking(calendarId, eventId);
      return 'cancelled';
    }

    const refreshToken = await this.getEditorRefreshToken(calendarId);

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

    await this.googleCalendarService.updateEvent(
      calendarId,
      refreshToken,
      eventId,
      {
        summary: dto.title,
        startTime: dto.startTime,
        endTime: dto.endTime,
        attendeeEmails,
        location: dto.resourceName,
        description,
      },
    );

    return 'modified';
  }
}
