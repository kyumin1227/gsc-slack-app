import type { View } from '@slack/types';
import { Resource } from '../resource.entity';
import { CALENDAR_COLORS } from '../../common/constants';

export class ClassroomView {
  // 교실별 Google Calendar 링크가 나열된 시간표 모달
  static classroomScheduleModal(resources: Resource[]): View {
    const combinedCalendarUrl =
      resources.length > 0
        ? 'https://calendar.google.com/calendar/embed?' +
          resources
            .map(
              (c, i) =>
                `src=${encodeURIComponent(c.calendarId)}&color=${CALENDAR_COLORS[i % CALENDAR_COLORS.length]}`,
            )
            .join('&') +
          '&ctz=Asia%2FSeoul&mode=WEEK'
        : undefined;

    const blocks: View['blocks'] = [
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '⚠️ 로직 변경으로 현재 일부 일정이 정확하지 않을 수 있습니다. \n빠른 시일 내에 수정하겠습니다.',
          },
        ],
      },
    ];

    if (combinedCalendarUrl) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '전체 교실 일정 보기 ❐' },
            url: combinedCalendarUrl,
            action_id: 'space:action:view-classroom-all',
          },
        ],
      });
    }

    if (resources.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '등록된 교실이 없습니다.' },
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
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: '일정 보기 ❐' },
              url: calendarUrl,
              action_id: `space:action:view-classroom-${resource.id}`,
            },
          },
          { type: 'divider' },
        );
      }
    }

    return {
      type: 'modal',
      callback_id: 'space:modal:classroom-schedule',
      title: { type: 'plain_text', text: '교실 시간표' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }
}
