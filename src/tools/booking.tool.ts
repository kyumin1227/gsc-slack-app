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
      name: 'find_user',
      description:
        '이름, 학번, 이메일로 ACTIVE 유저를 검색합니다. 여러 키워드를 한 번에 전달해 참석자를 일괄 조회할 수 있습니다.',
      input_schema: {
        type: 'object' as const,
        properties: {
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: '검색할 이름, 학번, 이메일 목록 (부분 일치)',
          },
        },
        required: ['keywords'],
      },
    },
    {
      name: 'get_study_rooms',
      description:
        '예약 가능한 스터디룸 목록과 alias를 조회합니다. roomName이 필요한 툴 호출 전 반드시 먼저 호출하여 정확한 이름을 확인하세요.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'check_room_availability',
      description:
        '지정한 시간 범위 내 스터디룸별 예약 현황을 조회합니다. 빈 방과 예약된 방, 예약 시간대를 반환합니다. roomName을 사용할 경우 반드시 이 툴보다 먼저 get_study_rooms를 호출해 정확한 이름을 확인하세요.',
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
              '특정 방만 조회할 경우 방 이름 또는 alias. 반드시 get_study_rooms로 정확한 이름을 확인 후 입력. 생략 시 전체 방 조회.',
          },
        },
        required: ['startDatetime', 'endDatetime'],
      },
    },
    {
      name: 'book_room',
      description:
        '스터디룸을 예약합니다. 예약 전 반드시 check_room_availability로 시간대를 확인하세요. 참석자 slackId는 find_user로 조회하세요.',
      input_schema: {
        type: 'object' as const,
        properties: {
          roomId: {
            type: 'number',
            description: 'get_study_rooms에서 반환된 방 ID',
          },
          title: {
            type: 'string',
            description: '예약 목적 (예: 스터디, 팀 프로젝트 회의)',
          },
          startDatetime: {
            type: 'string',
            description:
              '예약 시작 일시 (ISO 8601, 반드시 15분 단위, 예: 2025-05-10T14:00:00+09:00, 2025-05-10T14:15:00+09:00)',
          },
          endDatetime: {
            type: 'string',
            description:
              '예약 종료 일시 (ISO 8601, 반드시 15분 단위, 예: 2025-05-10T16:00:00+09:00, 2025-05-10T15:45:00+09:00)',
          },
          attendeeSlackIds: {
            type: 'array',
            items: { type: 'string' },
            description:
              '참석자 슬랙 ID 목록 (예약자 본인 제외, 혼자 예약 시 빈 배열 전달)',
          },
        },
        required: [
          'roomId',
          'title',
          'startDatetime',
          'endDatetime',
          'attendeeSlackIds',
        ],
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
    if (name === 'find_user') {
      const { keywords } = input as { keywords: string[] };
      const results = await Promise.all(
        keywords.map(async (keyword) => ({
          keyword,
          users: await this.userService.findActiveByKeyword(keyword),
        })),
      );
      return results;
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

    if (name === 'book_room') {
      const { roomId, title, startDatetime, endDatetime, attendeeSlackIds } =
        input as {
          roomId: number;
          title: string;
          startDatetime: string;
          endDatetime: string;
          attendeeSlackIds: string[];
        };
      const start = new Date(startDatetime);
      const end = new Date(endDatetime);
      if (start.getMinutes() % 15 !== 0 || end.getMinutes() % 15 !== 0) {
        return {
          success: false,
          error: '시작 및 종료 시간은 15분 단위여야 합니다.',
        };
      }

      const eventId = await this.studyRoomService.bookResource({
        resourceId: roomId,
        title,
        startTime: start,
        endTime: end,
        bookerSlackId: slackId,
        attendeeSlackIds,
      });
      return { success: true, eventId };
    }

    return null;
  }
}
