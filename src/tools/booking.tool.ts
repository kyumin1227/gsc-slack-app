import { Injectable } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { StudyRoomService } from '../resource/service/study-room.service';
import { UserService } from '../user/service/user.service';
import { toKSTString } from '../utils/date.util';

@Injectable()
export class BookingTool {
  readonly definitions: Anthropic.Tool[] = [
    {
      name: 'get_my_bookings',
      description: '현재 사용자의 스터디룸 예약 목록을 조회합니다.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_study_rooms',
      description: '예약 가능한 스터디룸 목록과 alias를 조회합니다.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'check_room_availability',
      description:
        '지정한 시간 범위 내 스터디룸별 예약 현황을 조회합니다. 빈 방과 예약된 방, 예약 시간대를 반환합니다.',
      input_schema: {
        type: 'object' as const,
        properties: {
          startDatetime: {
            type: 'string',
            description:
              '조회 시작 일시 (ISO 8601, 예: 2025-05-10T09:00:00+09:00)',
          },
          endDatetime: {
            type: 'string',
            description:
              '조회 종료 일시 (ISO 8601, 예: 2025-05-10T22:00:00+09:00)',
          },
          roomName: {
            type: 'string',
            description:
              '특정 방만 조회할 경우 방 이름 또는 alias. 생략 시 전체 방 조회.',
          },
        },
        required: ['startDatetime', 'endDatetime'],
      },
    },
  ];

  constructor(
    private readonly studyRoomService: StudyRoomService,
    private readonly userService: UserService,
  ) {}

  async execute(
    name: string,
    input: unknown,
    slackId: string,
  ): Promise<unknown> {
    if (name === 'get_my_bookings') {
      const bookings = await this.studyRoomService.getMyBookings(slackId);
      return Promise.all(
        bookings.map(async (b) => {
          const attendees = (
            await Promise.all(
              b.attendeeEmails.map((email) =>
                this.userService.findByEmail(email),
              ),
            )
          )
            .filter((u) => u !== null)
            .map((u) => ({ name: u.name, slackId: u.slackId, code: u.code }));

          return {
            resourceName: b.resourceName,
            summary: b.summary,
            startTime: toKSTString(b.startTime),
            endTime: toKSTString(b.endTime),
            attendees,
          };
        }),
      );
    }
    if (name === 'get_study_rooms') {
      return this.studyRoomService.getStudyRooms();
    }

    if (name === 'check_room_availability') {
      const { startDatetime, endDatetime, roomName } = input as {
        startDatetime: string;
        endDatetime: string;
        roomName?: string;
      };
      const availability = await this.studyRoomService.getRoomAvailability(
        new Date(startDatetime),
        new Date(endDatetime),
        roomName,
      );
      return availability.map((r) => ({
        roomName: r.roomName,
        available: r.bookings.length === 0,
        bookings: r.bookings.map((b) => ({
          startTime: toKSTString(new Date(b.startTime)),
          endTime: toKSTString(new Date(b.endTime)),
        })),
      }));
    }

    return null;
  }
}
