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
  ];

  constructor(
    private readonly studyRoomService: StudyRoomService,
    private readonly userService: UserService,
  ) {}

  async execute(
    name: string,
    _input: unknown,
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
    return null;
  }
}
