import type { View } from '@slack/types';

export class ScheduleClassRepView {
  // 반 대표 과목 목록 모달
  static scheduleListModal(
    schedules: {
      id: number;
      name: string;
      description?: string;
      channels: string[];
    }[],
    mutedScheduleIds: Set<number> = new Set(),
  ): View {
    const blocks: View['blocks'] = [];

    if (schedules.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '내 반 태그가 달린 과목이 없습니다.' },
      });
    } else {
      for (const schedule of schedules) {
        const channelText =
          schedule.channels.length > 0
            ? `\n알림 채널: ${schedule.channels.map((id) => `<#${id}>`).join('  ')}`
            : '';
        const description = schedule.description
          ? `\n${schedule.description}`
          : '';

        blocks.push(
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${schedule.name}*${description}${channelText}`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '수정' },
                action_id: `schedule:class-rep:edit:${schedule.id}`,
              },
              mutedScheduleIds.has(schedule.id)
                ? {
                    type: 'button',
                    text: { type: 'plain_text', text: '🔔 알림 켜기' },
                    action_id: `schedule:class-rep:unmute:${schedule.id}`,
                  }
                : {
                    type: 'button',
                    text: { type: 'plain_text', text: '🔕 알림 끄기 (30분)' },
                    action_id: `schedule:class-rep:mute:${schedule.id}`,
                  },
              {
                type: 'button',
                text: { type: 'plain_text', text: '반복 일정 생성' },
                action_id: `schedule:class-rep:create-recurring:${schedule.id}`,
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '반복 일정 수정' },
                action_id: `schedule:class-rep:edit-recurring:${schedule.id}`,
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '반복 일정 삭제' },
                action_id: `schedule:class-rep:delete-recurring:${schedule.id}`,
                style: 'danger',
              },
            ],
          },
          { type: 'divider' },
        );
      }
    }

    return {
      type: 'modal',
      callback_id: 'schedule:modal:class-rep:list',
      title: { type: 'plain_text', text: '내 반 과목 관리' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  // 반 대표 과목 수정 모달 (과목명, 설명, 알림 채널만)
  static editModal(
    schedule: { id: number; name: string; description?: string },
    notificationChannelIds: string[] = [],
  ): View {
    return {
      type: 'modal',
      callback_id: 'schedule:modal:class-rep:edit',
      private_metadata: schedule.id.toString(),
      title: { type: 'plain_text', text: '과목 수정' },
      submit: { type: 'plain_text', text: '저장' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'input',
          block_id: 'name_block',
          element: {
            type: 'plain_text_input',
            action_id: 'name_input',
            initial_value: schedule.name,
          },
          label: { type: 'plain_text', text: '과목명' },
        },
        {
          type: 'input',
          block_id: 'description_block',
          optional: true,
          element: {
            type: 'plain_text_input',
            action_id: 'description_input',
            multiline: true,
            ...(schedule.description
              ? { initial_value: schedule.description }
              : {}),
          },
          label: { type: 'plain_text', text: '설명' },
        },
        { type: 'divider' },
        {
          type: 'input',
          block_id: 'notification_channels_block',
          optional: true,
          element: {
            type: 'multi_conversations_select',
            action_id: 'channels_select',
            placeholder: { type: 'plain_text', text: '알림 받을 채널 선택' },
            filter: { include: ['public', 'private'] },
            ...(notificationChannelIds.length > 0
              ? { initial_conversations: notificationChannelIds }
              : {}),
          },
          label: { type: 'plain_text', text: '알림 채널' },
        },
      ],
    };
  }
}
