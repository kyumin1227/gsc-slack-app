import type { View } from '@slack/types';
import { StudyRoom, StudyRoomStatus } from './study-room.entity';
import { BookingItem } from './study-room.service';
import { CalendarAclEntry } from '../google/google-calendar.util';
import { toKST } from '../utils/date.util';

// Google Calendar 캘린더 색상
const ROOM_COLORS = [
  '%234285F4', // 파랑
  '%23DB4437', // 빨강
  '%230F9D58', // 초록
  '%23F4B400', // 노랑
  '%239E69AF', // 보라
  '%23F6511D', // 주황
  '%2300BCD4', // 하늘
  '%23E91E63', // 분홍
];

const DURATION_OPTIONS = (() => {
  const options: {
    text: { type: 'plain_text'; text: string };
    value: string;
  }[] = [];
  for (let m = 15; m <= 240; m += 15) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const label =
      h > 0 ? (min > 0 ? `${h}시간 ${min}분` : `${h}시간`) : `${min}분`;
    options.push({
      text: { type: 'plain_text' as const, text: label },
      value: String(m),
    });
  }
  return options;
})();

export class StudyRoomView {
  static listModal(rooms: StudyRoom[]): View {
    const combinedCalendarUrl =
      rooms.length > 0
        ? 'https://calendar.google.com/calendar/embed?' +
          rooms
            .map(
              (room, i) =>
                `src=${encodeURIComponent(room.calendarId)}&color=${ROOM_COLORS[i % ROOM_COLORS.length]}`,
            )
            .join('&') +
          '&ctz=Asia%2FSeoul&mode=WEEK'
        : undefined;

    const blocks: View['blocks'] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '예약할 스터디룸을 선택하세요.',
        },
        ...(combinedCalendarUrl && {
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '전체 일정 보기' },
            url: combinedCalendarUrl,
            action_id: 'study-room:action:view-all-calendar',
          },
        }),
      },
      { type: 'divider' },
    ];

    if (rooms.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '등록된 스터디룸이 없습니다.' },
      });
    } else {
      for (const [i, room] of rooms.entries()) {
        const color = ROOM_COLORS[i % ROOM_COLORS.length];
        const calendarUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(room.calendarId)}&color=${color}&ctz=Asia%2FSeoul&mode=WEEK`;
        blocks.push(
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*${room.name}*` },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '예약' },
                action_id: 'study-room:action:book',
                value: String(room.id),
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '일정 보기' },
                url: calendarUrl,
                action_id: 'study-room:action:view-calendar',
              },
            ],
          },
        );
      }
    }

    return {
      type: 'modal',
      callback_id: 'study-room:modal:list',
      title: { type: 'plain_text', text: '스터디룸 예약' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  static createModal(): View {
    return {
      type: 'modal',
      callback_id: 'study-room:modal:create',
      title: { type: 'plain_text', text: '스터디룸 등록' },
      submit: { type: 'plain_text', text: '등록' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'input',
          block_id: 'name_block',
          label: { type: 'plain_text', text: '이름' },
          element: {
            type: 'plain_text_input',
            action_id: 'name_input',
            placeholder: {
              type: 'plain_text',
              text: '스터디룸 이름을 입력하세요',
            },
          },
        },
      ],
    };
  }

  static bookingModal(room: StudyRoom, calculatedEndTime?: string): View {
    return {
      type: 'modal',
      callback_id: 'study-room:modal:book',
      title: { type: 'plain_text', text: '예약하기' },
      submit: { type: 'plain_text', text: '예약' },
      close: { type: 'plain_text', text: '취소' },
      private_metadata: JSON.stringify({ roomId: room.id }),
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${room.name}*` },
        },
        { type: 'divider' },
        {
          type: 'input',
          block_id: 'title_block',
          label: { type: 'plain_text', text: '목적' },
          element: {
            type: 'plain_text_input',
            action_id: 'title_input',
            placeholder: { type: 'plain_text', text: '이용 목적을 입력하세요' },
          },
        },
        {
          type: 'input',
          block_id: 'date_block',
          label: { type: 'plain_text', text: '날짜' },
          element: {
            type: 'datepicker',
            action_id: 'date_select',
          },
        },
        {
          type: 'input',
          block_id: 'start_time_block',
          label: { type: 'plain_text', text: '시간' },
          hint: {
            type: 'plain_text',
            text: '15분 단위로 입력하세요 (예: 09:00, 09:15, 09:30)',
          },
          dispatch_action: true,
          element: {
            type: 'timepicker',
            action_id: 'start_time_select',
          },
        },
        {
          type: 'input',
          block_id: 'duration_block',
          label: { type: 'plain_text', text: '이용 시간' },
          dispatch_action: true,
          element: {
            type: 'static_select',
            action_id: 'duration_select',
            placeholder: { type: 'plain_text', text: '이용 시간 선택' },
            options: DURATION_OPTIONS,
          },
        },
        {
          type: 'context',
          block_id: 'end_time_context',
          elements: [
            {
              type: 'mrkdwn',
              text: calculatedEndTime
                ? `⏰ 종료 시간: *${calculatedEndTime}*`
                : '시작 시간과 이용 시간을 선택하면 종료 시간이 표시됩니다.',
            },
          ],
        },
        {
          type: 'input',
          block_id: 'attendees_block',
          label: { type: 'plain_text', text: '참석자' },
          optional: true,
          element: {
            type: 'multi_users_select',
            action_id: 'attendees_select',
            placeholder: { type: 'plain_text', text: '참석자를 선택하세요' },
          },
        },
      ],
    };
  }

  static myBookingsModal(bookings: BookingItem[]): View {
    const blocks: View['blocks'] = [];

    if (bookings.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '예약 내역이 없습니다.' },
      });
    } else {
      for (const booking of bookings) {
        const start = toKST(booking.startTime);
        const end = toKST(booking.endTime);
        const dateStr = `${start.getUTCFullYear()}.${String(start.getUTCMonth() + 1).padStart(2, '0')}.${String(start.getUTCDate()).padStart(2, '0')}`;
        const startStr = `${String(start.getUTCHours()).padStart(2, '0')}:${String(start.getUTCMinutes()).padStart(2, '0')}`;
        const endStr = `${String(end.getUTCHours()).padStart(2, '0')}:${String(end.getUTCMinutes()).padStart(2, '0')}`;
        const meta = JSON.stringify({
          calendarId: booking.calendarId,
          eventId: booking.eventId,
          roomName: booking.roomName,
          startIso: booking.startTime.toISOString(),
          endIso: booking.endTime.toISOString(),
        });

        blocks.push(
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${booking.summary}*\n${booking.roomName} | ${dateStr} ${startStr}~${endStr}`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '수정' },
                action_id: 'study-room:action:modify',
                value: meta,
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '취소' },
                action_id: 'study-room:action:cancel',
                style: 'danger',
                value: meta,
                confirm: {
                  title: { type: 'plain_text', text: '예약 취소' },
                  text: {
                    type: 'mrkdwn',
                    text: `*${booking.summary}* 예약을 취소하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
                  },
                  confirm: { type: 'plain_text', text: '취소하기' },
                  deny: { type: 'plain_text', text: '돌아가기' },
                  style: 'danger',
                },
              },
            ],
          },
          { type: 'divider' },
        );
      }
    }

    return {
      type: 'modal',
      callback_id: 'study-room:modal:my-bookings',
      title: { type: 'plain_text', text: '내 예약' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  static modifyBookingModal(
    booking: {
      calendarId: string;
      eventId: string;
      roomName: string;
      summary: string;
      startTime: Date;
      endTime: Date;
    },
    initialAttendeeSlackIds: string[] = [],
  ): View {
    const durationMinutes = Math.round(
      (booking.endTime.getTime() - booking.startTime.getTime()) / 60000,
    );
    const clampedDuration = Math.min(Math.max(durationMinutes, 15), 240);
    const snappedDuration = Math.round(clampedDuration / 15) * 15;

    const kstStart = toKST(booking.startTime);
    const dateStr = `${kstStart.getUTCFullYear()}-${String(kstStart.getUTCMonth() + 1).padStart(2, '0')}-${String(kstStart.getUTCDate()).padStart(2, '0')}`;
    const timeStr = `${String(kstStart.getUTCHours()).padStart(2, '0')}:${String(kstStart.getUTCMinutes()).padStart(2, '0')}`;

    return {
      type: 'modal',
      callback_id: 'study-room:modal:modify-booking',
      title: { type: 'plain_text', text: '예약 수정' },
      submit: { type: 'plain_text', text: '수정' },
      close: { type: 'plain_text', text: '취소' },
      private_metadata: JSON.stringify({
        calendarId: booking.calendarId,
        eventId: booking.eventId,
        roomName: booking.roomName,
      }),
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${booking.roomName}*` },
        },
        { type: 'divider' },
        {
          type: 'input',
          block_id: 'title_block',
          label: { type: 'plain_text', text: '목적' },
          element: {
            type: 'plain_text_input',
            action_id: 'title_input',
            initial_value: booking.summary,
            placeholder: { type: 'plain_text', text: '이용 목적을 입력하세요' },
          },
        },
        {
          type: 'input',
          block_id: 'date_block',
          label: { type: 'plain_text', text: '날짜' },
          element: {
            type: 'datepicker',
            action_id: 'date_select',
            initial_date: dateStr,
          },
        },
        {
          type: 'input',
          block_id: 'start_time_block',
          label: { type: 'plain_text', text: '시간' },
          hint: {
            type: 'plain_text',
            text: '15분 단위로 입력하세요 (예: 09:00, 09:15, 09:30)',
          },
          dispatch_action: true,
          element: {
            type: 'timepicker',
            action_id: 'start_time_select',
            initial_time: timeStr,
          },
        },
        {
          type: 'input',
          block_id: 'duration_block',
          label: { type: 'plain_text', text: '이용 시간' },
          dispatch_action: true,
          element: {
            type: 'static_select',
            action_id: 'duration_select',
            placeholder: { type: 'plain_text', text: '이용 시간 선택' },
            options: DURATION_OPTIONS,
            initial_option: DURATION_OPTIONS.find(
              (o) => o.value === String(snappedDuration),
            ),
          },
        },
        {
          type: 'context',
          block_id: 'end_time_context',
          elements: [
            {
              type: 'mrkdwn',
              text: `⏰ 종료 시간: *${String(toKST(booking.endTime).getUTCHours()).padStart(2, '0')}:${String(toKST(booking.endTime).getUTCMinutes()).padStart(2, '0')}*`,
            },
          ],
        },
        {
          type: 'input',
          block_id: 'attendees_block',
          label: { type: 'plain_text', text: '참석자' },
          optional: true,
          element: {
            type: 'multi_users_select',
            action_id: 'attendees_select',
            placeholder: { type: 'plain_text', text: '참석자를 선택하세요' },
            ...(initialAttendeeSlackIds.length > 0 && {
              initial_users: initialAttendeeSlackIds,
            }),
          },
        },
      ],
    };
  }

  // ========== 스터디룸 관리 (어드민) ==========

  static manageModal(rooms: StudyRoom[]): View {
    const blocks: View['blocks'] = [
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '+ 새 스터디룸 등록' },
            action_id: 'study-room:admin:open-create',
            style: 'primary',
          },
        ],
      },
      { type: 'divider' },
    ];

    if (rooms.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '등록된 스터디룸이 없습니다.' },
      });
    } else {
      for (const room of rooms) {
        const meta = JSON.stringify({
          roomId: room.id,
          roomName: room.name,
          calendarId: room.calendarId,
        });
        const statusLabel =
          room.status === StudyRoomStatus.ACTIVE ? '활성' : '비활성';

        blocks.push(
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${room.name}* \`${statusLabel}\`${room.description ? `\n${room.description}` : ''}`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '수정' },
                action_id: 'study-room:admin:open-edit',
                value: meta,
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '수정자 관리' },
                action_id: 'study-room:admin:open-editors',
                value: meta,
              },
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text:
                    room.status === StudyRoomStatus.ACTIVE
                      ? '비활성화'
                      : '활성화',
                },
                action_id: 'study-room:admin:toggle-status',
                style:
                  room.status === StudyRoomStatus.ACTIVE ? 'danger' : 'primary',
                value: meta,
                confirm:
                  room.status === StudyRoomStatus.ACTIVE
                    ? {
                        title: { type: 'plain_text', text: '비활성화 확인' },
                        text: {
                          type: 'mrkdwn',
                          text: `*${room.name}*을 비활성화하시겠습니까?\n예약 목록에서 숨겨집니다.`,
                        },
                        confirm: { type: 'plain_text', text: '비활성화' },
                        deny: { type: 'plain_text', text: '취소' },
                        style: 'danger',
                      }
                    : undefined,
              },
            ],
          },
          { type: 'divider' },
        );
      }
    }

    return {
      type: 'modal',
      callback_id: 'study-room:modal:manage',
      title: { type: 'plain_text', text: '스터디룸 관리' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  static editModal(room: StudyRoom): View {
    return {
      type: 'modal',
      callback_id: 'study-room:modal:edit',
      title: { type: 'plain_text', text: '스터디룸 수정' },
      submit: { type: 'plain_text', text: '저장' },
      close: { type: 'plain_text', text: '취소' },
      private_metadata: JSON.stringify({
        roomId: room.id,
        roomName: room.name,
        calendarId: room.calendarId,
      }),
      blocks: [
        {
          type: 'input',
          block_id: 'name_block',
          label: { type: 'plain_text', text: '이름' },
          element: {
            type: 'plain_text_input',
            action_id: 'name_input',
            initial_value: room.name,
          },
        },
        {
          type: 'input',
          block_id: 'description_block',
          label: { type: 'plain_text', text: '설명' },
          optional: true,
          element: {
            type: 'plain_text_input',
            action_id: 'description_input',
            multiline: true,
            initial_value: room.description ?? '',
            placeholder: {
              type: 'plain_text',
              text: '시설 정보, 수용 인원 등',
            },
          },
        },
        {
          type: 'input',
          block_id: 'status_block',
          label: { type: 'plain_text', text: '상태' },
          element: {
            type: 'static_select',
            action_id: 'status_select',
            options: [
              {
                text: { type: 'plain_text', text: '활성' },
                value: StudyRoomStatus.ACTIVE,
              },
              {
                text: { type: 'plain_text', text: '비활성' },
                value: StudyRoomStatus.INACTIVE,
              },
            ],
            initial_option: {
              text: {
                type: 'plain_text',
                text:
                  room.status === StudyRoomStatus.ACTIVE ? '활성' : '비활성',
              },
              value: room.status,
            },
          },
        },
      ],
    };
  }

  static editorsModal(room: StudyRoom, editors: CalendarAclEntry[]): View {
    const blocks: View['blocks'] = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${room.name}* 수정자 목록` },
      },
      { type: 'divider' },
    ];

    if (editors.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '수정자가 없습니다.' },
      });
    } else {
      for (const editor of editors) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: editor.email },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '제거' },
            action_id: 'study-room:admin:remove-editor',
            style: 'danger',
            value: JSON.stringify({
              roomId: room.id,
              calendarId: room.calendarId,
              email: editor.email,
            }),
            confirm: {
              title: { type: 'plain_text', text: '수정자 제거' },
              text: {
                type: 'mrkdwn',
                text: `*${editor.email}*의 수정 권한을 제거하시겠습니까?`,
              },
              confirm: { type: 'plain_text', text: '제거' },
              deny: { type: 'plain_text', text: '취소' },
              style: 'danger',
            },
          },
        });
      }
    }

    blocks.push(
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '+ 수정자 추가' },
            action_id: 'study-room:admin:open-add-editor',
            style: 'primary',
            value: JSON.stringify({
              roomId: room.id,
              roomName: room.name,
              calendarId: room.calendarId,
            }),
          },
        ],
      },
    );

    return {
      type: 'modal',
      callback_id: 'study-room:modal:editors',
      title: { type: 'plain_text', text: '수정자 관리' },
      close: { type: 'plain_text', text: '닫기' },
      private_metadata: JSON.stringify({
        roomId: room.id,
        roomName: room.name,
        calendarId: room.calendarId,
      }),
      blocks,
    };
  }

  static addEditorModal(room: StudyRoom): View {
    return {
      type: 'modal',
      callback_id: 'study-room:modal:add-editor',
      title: { type: 'plain_text', text: '수정자 추가' },
      submit: { type: 'plain_text', text: '추가' },
      close: { type: 'plain_text', text: '취소' },
      private_metadata: JSON.stringify({
        roomId: room.id,
        roomName: room.name,
        calendarId: room.calendarId,
      }),
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${room.name}*에 수정자를 추가합니다.`,
          },
        },
        {
          type: 'input',
          block_id: 'editor_block',
          label: { type: 'plain_text', text: '추가할 사용자' },
          element: {
            type: 'users_select',
            action_id: 'editor_select',
            placeholder: { type: 'plain_text', text: '사용자를 선택하세요' },
          },
        },
      ],
    };
  }
}
