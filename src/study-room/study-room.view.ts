import type { View } from '@slack/types';
import { StudyRoom } from './study-room.entity';

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
    const blocks: View['blocks'] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '예약할 스터디룸을 선택하세요.',
        },
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
        const calendarUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(room.calendarId)}&ctz=Asia%2FSeoul&mode=WEEK`;
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
}
