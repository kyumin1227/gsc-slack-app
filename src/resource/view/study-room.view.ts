import type { View } from '@slack/types';
import { Resource } from '../resource.entity';
import { toKST } from '../../common/date.util';
import { multiUsersSelectBlock } from '../../common/blocks';
import { CALENDAR_COLORS } from '../../common/constants';

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
  // 예약 가능한 스터디룸 목록 모달 (전체 캘린더 보기 링크 포함)
  static listModal(resources: Resource[]): View {
    const combinedCalendarUrl =
      resources.length > 0
        ? 'https://calendar.google.com/calendar/embed?' +
          resources
            .map(
              (r, i) =>
                `src=${encodeURIComponent(r.calendarId)}&color=${CALENDAR_COLORS[i % CALENDAR_COLORS.length]}`,
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
            text: { type: 'plain_text', text: '전체 일정 보기 ❐' },
            url: combinedCalendarUrl,
            action_id: 'study-room:action:open-url',
          },
        }),
      },
      { type: 'divider' },
    ];

    if (resources.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '등록된 스터디룸이 없습니다.' },
      });
    } else {
      for (const [i, resource] of resources.entries()) {
        const color = CALENDAR_COLORS[i % CALENDAR_COLORS.length];
        const calendarUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(resource.calendarId)}&color=${color}&ctz=Asia%2FSeoul&mode=WEEK`;
        blocks.push(
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: resource.description
                ? `*${resource.name}*\n${resource.description}`
                : `*${resource.name}*`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '예약' },
                style: 'primary',
                action_id: 'study-room:action:book',
                value: String(resource.id),
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '일정 보기 ❐' },
                url: calendarUrl,
                action_id: 'study-room:action:open-url',
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

  // 스터디룸 예약 입력 모달 (종료 시간 계산값 표시 지원)
  static bookingModal(resource: Resource, calculatedEndTime?: string): View {
    return {
      type: 'modal',
      callback_id: 'study-room:modal:book',
      title: { type: 'plain_text', text: '예약하기' },
      submit: { type: 'plain_text', text: '예약' },
      close: { type: 'plain_text', text: '취소' },
      private_metadata: JSON.stringify({ roomId: resource.id }),
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${resource.name}*` },
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
        multiUsersSelectBlock({
          blockId: 'attendees_block',
          actionId: 'attendees_select',
          label: '참석자',
          placeholder: '참석자를 선택하세요',
          optional: true,
        }),
      ],
    };
  }

  // 예약 수정 모달 (기존 예약 정보 초기값 세팅)
  static modifyBookingModal(
    booking: {
      calendarId: string;
      eventId: string;
      roomName: string;
      summary: string;
      startTime: Date;
      endTime: Date;
      parentViewId?: string;
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
        parentViewId: booking.parentViewId ?? '',
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
        multiUsersSelectBlock({
          blockId: 'attendees_block',
          actionId: 'attendees_select',
          label: '참석자',
          placeholder: '참석자를 선택하세요',
          initialUsers: initialAttendeeSlackIds,
          optional: true,
        }),
      ],
    };
  }

  // 예약 취소 확인 모달
  static cancelConfirmModal(params: {
    calendarId: string;
    eventId: string;
    roomName: string;
    parentViewId: string;
  }): View {
    return {
      type: 'modal',
      callback_id: 'study-room:modal:cancel-confirm',
      title: { type: 'plain_text', text: '예약 취소' },
      submit: { type: 'plain_text', text: '취소하기' },
      close: { type: 'plain_text', text: '돌아가기' },
      private_metadata: JSON.stringify(params),
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${params.roomName}* 예약을 취소하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
          },
        },
      ],
    };
  }
}
