import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StudyRoom } from './study-room.entity';
import { GoogleCalendarUtil } from '../google/google-calendar.util';
import { UserService } from '../user/user.service';

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

  async findAll(): Promise<StudyRoom[]> {
    return this.studyRoomRepository.find({ order: { name: 'ASC' } });
  }

  async findById(id: number): Promise<StudyRoom | null> {
    return this.studyRoomRepository.findOne({ where: { id } });
  }

  async bookStudyRoom(dto: BookStudyRoomDto): Promise<string> {
    const room = await this.findById(dto.studyRoomId);
    if (!room) throw new Error('스터디룸을 찾을 수 없습니다.');

    console.log(dto.attendeeSlackIds);

    // 1. 캘린더 수정 권한이 있는 유저 토큰 조회
    const acl = await GoogleCalendarUtil.getCalendarAcl(room.calendarId);
    const editorEmails = acl
      .filter((e) => e.role === 'writer' || e.role === 'owner')
      .map((e) => e.email);

    const editor = await this.userService.findActiveByEmails(editorEmails);
    if (!editor) {
      throw new Error('캘린더 수정 권한을 가진 활성 유저를 찾을 수 없습니다.');
    }

    const refreshToken = this.userService.getDecryptedRefreshToken(editor);
    if (!refreshToken) {
      throw new Error('캘린더 수정 권한자의 인증 정보가 없습니다.');
    }

    // 2. 중복 예약 체크
    const isBusy = await GoogleCalendarUtil.isTimeSlotBusy(
      room.calendarId,
      refreshToken,
      dto.startTime,
      dto.endTime,
    );
    if (isBusy) {
      throw new Error('해당 시간대에 이미 예약이 있습니다.');
    }

    // 3. 참석자 이메일 조회 (예약자 포함)
    const allSlackIds = [dto.bookerSlackId, ...dto.attendeeSlackIds];
    const attendeeEmails = (
      await Promise.all(
        allSlackIds.map((id) => this.userService.findBySlackId(id)),
      )
    )
      .filter((u): u is NonNullable<typeof u> => u !== null)
      .map((u) => u.email);

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
      },
    );

    this.logger.log(
      `Study room booked: ${room.name} (${dto.startTime.toISOString()} ~ ${dto.endTime.toISOString()}), eventId: ${eventId}`,
    );

    return eventId;
  }
}
