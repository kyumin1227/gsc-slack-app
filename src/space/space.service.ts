import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Space, SpaceStatus, SpaceType } from './space.entity';
import { GoogleCalendarUtil } from '../google/google-calendar.util';
import { UserService } from '../user/user.service';
import { BusinessError, ErrorCode } from '../common/errors';

export interface CreateSpaceDto {
  name: string;
  type?: SpaceType;
  aliases?: string[];
  description?: string;
  isDefault?: boolean;
}

export interface BookSpaceDto {
  spaceId: number;
  title: string;
  startTime: Date;
  endTime: Date;
  bookerSlackId: string;
  attendeeSlackIds: string[];
}

export interface BookingItem {
  calendarId: string;
  eventId: string;
  spaceName: string;
  summary: string;
  startTime: Date;
  endTime: Date;
}

export interface ModifyBookingDto {
  title: string;
  startTime: Date;
  endTime: Date;
  attendeeSlackIds: string[];
  spaceName: string;
}

@Injectable()
export class SpaceService {
  private readonly logger = new Logger(SpaceService.name);

  constructor(
    @InjectRepository(Space)
    private readonly spaceRepository: Repository<Space>,
    private readonly userService: UserService,
  ) {}

  async create(dto: CreateSpaceDto): Promise<Space> {
    const { calendarId } = await GoogleCalendarUtil.createCalendar(dto.name);
    await GoogleCalendarUtil.makeCalendarPublic(calendarId);

    if (dto.isDefault) {
      await this.spaceRepository
        .createQueryBuilder()
        .update()
        .set({ isDefault: false })
        .where('1=1')
        .execute();
    }

    const space = this.spaceRepository.create({
      name: dto.name,
      calendarId,
      type: dto.type ?? SpaceType.STUDY_ROOM,
      aliases: dto.aliases ?? [],
      description: dto.description,
      isDefault: dto.isDefault ?? false,
    });
    return this.spaceRepository.save(space);
  }

  async findAll(onlyActive = false): Promise<Space[]> {
    return this.spaceRepository.find({
      where: onlyActive ? { status: SpaceStatus.ACTIVE } : {},
      order: { name: 'ASC' },
    });
  }

  async findAllByType(type: SpaceType, onlyActive = false): Promise<Space[]> {
    return this.spaceRepository.find({
      where: {
        type,
        ...(onlyActive ? { status: SpaceStatus.ACTIVE } : {}),
      },
      order: { name: 'ASC' },
    });
  }

  async findById(id: number): Promise<Space | null> {
    return this.spaceRepository.findOne({ where: { id } });
  }

  async findDefault(): Promise<Space | null> {
    return this.spaceRepository.findOne({ where: { isDefault: true } });
  }

  async setDefault(id: number): Promise<void> {
    await this.spaceRepository
      .createQueryBuilder()
      .update()
      .set({ isDefault: false })
      .where('1=1')
      .execute();
    await this.spaceRepository.update(id, { isDefault: true });
  }

  async unsetDefault(id: number): Promise<void> {
    await this.spaceRepository.update(id, { isDefault: false });
  }

  // location 문자열이 어떤 공간의 alias와 일치하면 해당 공간 반환
  async findByAlias(location: string): Promise<Space | null> {
    const lower = location.toLowerCase();
    const spaces = await this.spaceRepository.find({
      where: { status: SpaceStatus.ACTIVE },
    });
    return (
      spaces.find((s) => s.aliases?.some((a) => a.toLowerCase() === lower)) ??
      null
    );
  }

  async bookSpace(dto: BookSpaceDto): Promise<string> {
    const space = await this.findById(dto.spaceId);
    if (!space) throw new BusinessError(ErrorCode.STUDY_ROOM_NOT_FOUND);

    const acl = await GoogleCalendarUtil.getCalendarAcl(space.calendarId);
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

    const isBusy = await GoogleCalendarUtil.isTimeSlotBusy(
      space.calendarId,
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

    const eventId = await GoogleCalendarUtil.createEvent(
      space.calendarId,
      refreshToken,
      {
        summary: dto.title,
        startTime: dto.startTime,
        endTime: dto.endTime,
        attendeeEmails,
        location: space.name,
        description,
      },
    );

    this.logger.log(
      `Space booked: ${space.name} (${dto.startTime.toISOString()} ~ ${dto.endTime.toISOString()}), eventId: ${eventId}`,
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

  async getMyBookings(slackId: string): Promise<BookingItem[]> {
    const user = await this.userService.findBySlackId(slackId);
    if (!user) return [];

    const rooms = await this.findAllByType(SpaceType.STUDY_ROOM);
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
      spaceName: roomMap.get(calendarId) ?? calendarId,
      summary: event.summary ?? '(제목 없음)',
      startTime: new Date(event.start!.dateTime!),
      endTime: new Date(event.end!.dateTime!),
    }));
  }

  async rename(id: number, name: string): Promise<void> {
    const space = await this.findById(id);
    if (!space) throw new BusinessError(ErrorCode.STUDY_ROOM_NOT_FOUND);
    await GoogleCalendarUtil.updateCalendar(space.calendarId, name);
    await this.spaceRepository.update(id, { name });
  }

  async updateInfo(
    id: number,
    dto: { description?: string | null; status?: SpaceStatus; aliases?: string[]; type?: SpaceType },
  ): Promise<void> {
    await this.spaceRepository.update(id, dto as any);
  }

  async addEditor(id: number, email: string): Promise<void> {
    const space = await this.findById(id);
    if (!space) throw new BusinessError(ErrorCode.STUDY_ROOM_NOT_FOUND);
    await GoogleCalendarUtil.shareCalendar({
      calendarId: space.calendarId,
      email,
      role: 'writer',
    });
  }

  async removeEditor(id: number, email: string): Promise<void> {
    const space = await this.findById(id);
    if (!space) throw new BusinessError(ErrorCode.STUDY_ROOM_NOT_FOUND);
    await GoogleCalendarUtil.unshareCalendar(space.calendarId, email);
  }

  async remove(id: number): Promise<void> {
    const space = await this.findById(id);
    if (!space) throw new BusinessError(ErrorCode.STUDY_ROOM_NOT_FOUND);
    await GoogleCalendarUtil.deleteCalendar(space.calendarId);
    await this.spaceRepository.softDelete(id);
  }

  async cancelBooking(calendarId: string, eventId: string): Promise<void> {
    const refreshToken = await this.getEditorRefreshToken(calendarId);
    await GoogleCalendarUtil.deleteEvent(calendarId, refreshToken, eventId);
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
      location: dto.spaceName,
      description,
    });

    return 'modified';
  }
}
