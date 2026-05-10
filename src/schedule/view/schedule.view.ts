import type { View } from '@slack/types';
import { ScheduleStatus } from '../schedule.entity';
import { TagStatus } from '../../tag/tag.entity';
import { multiUsersSelectBlock } from '../../common/blocks';
import {
  ScheduleListItem,
  EditScheduleItem,
  SubscribeScheduleItem,
  TagOption,
} from '../dto/schedule.dto';

const STATUS_LABELS: Record<ScheduleStatus, string> = {
  [ScheduleStatus.ACTIVE]: '활성',
  [ScheduleStatus.INACTIVE]: '비활성',
};

const STATUS_OPTIONS = [
  { text: { type: 'plain_text' as const, text: '활성' }, value: 'active' },
  { text: { type: 'plain_text' as const, text: '비활성' }, value: 'inactive' },
];

export class ScheduleView {
  // 시간표 목록 모달 (페이지네이션 + 필터)
  static listModal(
    schedules: ScheduleListItem[],
    tags: TagOption[],
    meta: {
      page: number;
      totalPages: number;
      total: number;
      selectedStatus?: string;
      selectedTagIds?: number[];
      mutedScheduleIds?: Set<number>;
    },
  ): View {
    const {
      page,
      totalPages,
      total,
      selectedStatus,
      selectedTagIds,
      mutedScheduleIds = new Set(),
    } = meta;

    const tagOptions = tags.map((t) => ({
      text: {
        type: 'plain_text' as const,
        text: t.status === TagStatus.ACTIVE ? t.name : `⚪️ ${t.name}`,
      },
      value: t.id.toString(),
    }));

    const initialStatusOption = STATUS_OPTIONS.find(
      (o) => o.value === (selectedStatus ?? 'all'),
    );

    const initialTagOptions = selectedTagIds
      ? tagOptions.filter((opt) =>
          selectedTagIds.includes(parseInt(opt.value, 10)),
        )
      : [];

    const blocks: View['blocks'] = [
      {
        type: 'input',
        block_id: 'status_block',
        optional: true,
        element: {
          type: 'static_select',
          action_id: 'status_select',
          options: STATUS_OPTIONS,
          initial_option: initialStatusOption,
        },
        label: { type: 'plain_text', text: '상태' },
      },
    ];

    if (tagOptions.length > 0) {
      blocks.push({
        type: 'input',
        block_id: 'tags_block',
        optional: true,
        element: {
          type: 'multi_static_select',
          action_id: 'tags_select',
          placeholder: { type: 'plain_text', text: '태그 선택 (AND 조건)' },
          options: tagOptions,
          ...(initialTagOptions.length > 0
            ? { initial_options: initialTagOptions }
            : {}),
        },
        label: { type: 'plain_text', text: '태그' },
      });
    }

    blocks.push({ type: 'divider' });

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          total === 0
            ? '조건에 맞는 시간표가 없습니다.'
            : `*총 ${total}개 (${page + 1}/${totalPages}페이지)*`,
      },
    });

    for (const schedule of schedules) {
      const statusEmoji =
        schedule.status === ScheduleStatus.ACTIVE ? '🟢' : '⚪';
      const toggleText =
        schedule.status === ScheduleStatus.ACTIVE ? '비활성화' : '활성화';
      const toggleValue =
        schedule.status === ScheduleStatus.ACTIVE ? 'deactivate' : 'activate';
      const tagNames =
        schedule.tags.length > 0
          ? schedule.tags.map((t) => `\`${t.name}\``).join(' ')
          : '없음';
      const description = schedule.description
        ? `\n${schedule.description}`
        : '';

      const channelText =
        schedule.channels.length > 0
          ? `\n알림 채널: ${schedule.channels.map((id) => `<#${id}>`).join('  ')}`
          : '';
      const writerText =
        schedule.writers.length > 0
          ? `\n담당자: ${schedule.writers.map((id) => `<@${id}>`).join('  ')}`
          : '';

      blocks.push(
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${statusEmoji} *${schedule.name}*${description}\n태그: ${tagNames}\n상태: ${STATUS_LABELS[schedule.status]} | 생성자: ${schedule.createdBy.name} | 생성일: ${schedule.createdAt.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}${channelText}${writerText}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '수정/관리' },
              action_id: `schedule:list:edit:${schedule.id}`,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: toggleText },
              action_id: `schedule:list:toggle:${schedule.id}`,
              value: toggleValue,
            },
            mutedScheduleIds.has(schedule.id)
              ? {
                  type: 'button',
                  text: { type: 'plain_text', text: '🔔 알림 켜기' },
                  action_id: `schedule:list:unmute:${schedule.id}`,
                }
              : {
                  type: 'button',
                  text: { type: 'plain_text', text: '🔕 알림 끄기 (30분)' },
                  action_id: `schedule:list:mute:${schedule.id}`,
                },
            {
              type: 'button',
              text: { type: 'plain_text', text: '삭제' },
              action_id: `schedule:list:delete:${schedule.id}`,
              value: schedule.name,
              style: 'danger',
            },
          ],
        },
      );
    }

    const navElements: View['blocks'][number] = {
      type: 'actions',
      elements: [],
    };
    const elements = (navElements as { type: string; elements: object[] })
      .elements;

    if (page > 0) {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: '← 이전' },
        action_id: 'schedule:list:page:prev',
        value: (page - 1).toString(),
      });
    }
    if (page < totalPages - 1) {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: '다음 →' },
        action_id: 'schedule:list:page:next',
        value: (page + 1).toString(),
      });
    }

    if (elements.length > 0) {
      blocks.push({ type: 'divider' });
      blocks.push(navElements);
    }

    return {
      type: 'modal',
      callback_id: 'schedule:modal:list',
      private_metadata: JSON.stringify({
        page,
        status: selectedStatus ?? 'all',
        tagIds: selectedTagIds ?? [],
      }),
      title: { type: 'plain_text', text: '시간표 관리' },
      submit: { type: 'plain_text', text: '조회' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  // 시간표 수정 모달 (정보 수정 + 편집자 관리)
  static editModal(
    schedule: EditScheduleItem,
    tags: TagOption[],
    initialEditorSlackIds: string[] = [],
    notificationChannelIds: string[] = [],
  ): View {
    const activeTagOptions = tags
      .filter((t) => t.status === TagStatus.ACTIVE)
      .map((t) => ({
        text: { type: 'plain_text' as const, text: t.name },
        value: t.id.toString(),
      }));

    const initialTagOptions = activeTagOptions.filter((opt) =>
      schedule.tags.some((t) => t.id.toString() === opt.value),
    );

    const blocks: View['blocks'] = [
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
    ];

    if (activeTagOptions.length > 0) {
      blocks.push({
        type: 'input',
        block_id: 'tags_block',
        optional: true,
        element: {
          type: 'multi_static_select',
          action_id: 'tags_input',
          placeholder: { type: 'plain_text', text: '태그 선택' },
          options: activeTagOptions,
          ...(initialTagOptions.length > 0
            ? { initial_options: initialTagOptions }
            : {}),
        },
        label: { type: 'plain_text', text: '태그' },
      });
    }

    blocks.push(
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
    );

    blocks.push(
      { type: 'divider' },
      multiUsersSelectBlock({
        blockId: 'editors_block',
        actionId: 'editors_select',
        label: '수정자',
        placeholder: '수정자를 선택하세요',
        initialUsers: initialEditorSlackIds,
        optional: true,
      }),
    );

    return {
      type: 'modal',
      callback_id: 'schedule:modal:edit',
      private_metadata: schedule.id.toString(),
      title: { type: 'plain_text', text: '시간표 수정' },
      submit: { type: 'plain_text', text: '저장' },
      close: { type: 'plain_text', text: '취소' },
      blocks,
    };
  }

  // 시간표 생성 모달
  static createModal(tags: TagOption[]): View {
    const activeTagOptions = tags
      .filter((t) => t.status === TagStatus.ACTIVE)
      .map((t) => ({
        text: { type: 'plain_text' as const, text: t.name },
        value: t.id.toString(),
      }));

    const blocks: View['blocks'] = [
      {
        type: 'input',
        block_id: 'name_block',
        element: {
          type: 'plain_text_input',
          action_id: 'name_input',
          placeholder: {
            type: 'plain_text',
            text: '예: 데이터베이스, 알고리즘',
          },
        },
        label: {
          type: 'plain_text',
          text: '과목명',
        },
      },
      {
        type: 'input',
        block_id: 'description_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'description_input',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: '과목 설명 (선택사항)',
          },
        },
        label: {
          type: 'plain_text',
          text: '설명',
        },
      },
    ];

    if (activeTagOptions.length > 0) {
      blocks.push({
        type: 'input',
        block_id: 'tags_block',
        optional: true,
        element: {
          type: 'multi_static_select',
          action_id: 'tags_input',
          placeholder: {
            type: 'plain_text',
            text: '태그 선택 (선택사항)',
          },
          options: activeTagOptions,
        },
        label: {
          type: 'plain_text',
          text: '태그',
        },
      });
    }

    return {
      type: 'modal',
      callback_id: 'schedule:modal:create',
      title: {
        type: 'plain_text',
        text: '시간표 생성',
      },
      submit: {
        type: 'plain_text',
        text: '생성',
      },
      close: {
        type: 'plain_text',
        text: '취소',
      },
      blocks,
    };
  }

  // 시간표 상세 모달 (권한 관리용)
  static detailModal(
    schedule: ScheduleListItem & { calendarId: string },
    permissions: { email: string; role: string }[],
  ): View {
    const blocks: View['blocks'] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${schedule.name}*${schedule.description ? `\n${schedule.description}` : ''}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `상태: ${STATUS_LABELS[schedule.status]} | 생성자: ${schedule.createdBy.name}`,
          },
        ],
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*권한 목록*',
        },
      },
    ];

    if (permissions.length === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '공유된 사용자가 없습니다.',
        },
      });
    } else {
      for (const perm of permissions) {
        const roleLabel =
          perm.role === 'owner'
            ? '👑 소유자'
            : perm.role === 'writer'
              ? '✏️ 편집자'
              : '👁️ 읽기';
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${roleLabel}: ${perm.email}`,
          },
        });
      }
    }

    blocks.push(
      { type: 'divider' },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `캘린더 ID: \`${schedule.calendarId}\``,
          },
        ],
      },
    );

    return {
      type: 'modal',
      callback_id: 'schedule:modal:detail',
      private_metadata: schedule.id.toString(),
      title: {
        type: 'plain_text',
        text: '시간표 상세',
      },
      close: {
        type: 'plain_text',
        text: '닫기',
      },
      blocks,
    };
  }

  // 구독 검색 모달 (태그 선택 + 결과 + 페이지네이션)
  static subscribeSearchModal(
    tags: TagOption[],
    schedules?: SubscribeScheduleItem[],
    selectedTagIds?: number[],
    pagination?: { page: number; totalPages: number; total: number },
  ): View {
    const activeTagOptions = tags
      .filter((t) => t.status === TagStatus.ACTIVE)
      .map((t) => ({
        text: { type: 'plain_text' as const, text: `🏷️ ${t.name}` },
        value: t.id.toString(),
      }));

    const blocks: View['blocks'] = [];

    if (activeTagOptions.length === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '등록된 태그가 없습니다.',
        },
      });
    } else {
      const initialOptions = selectedTagIds
        ? activeTagOptions.filter((opt) =>
            selectedTagIds.includes(parseInt(opt.value, 10)),
          )
        : undefined;

      blocks.push({
        type: 'input',
        block_id: 'tags_block',
        optional: true,
        element: {
          type: 'multi_static_select',
          action_id: 'tags_select',
          placeholder: {
            type: 'plain_text',
            text: '원하는 태그를 모두 선택하세요 (AND 조건)',
            emoji: true,
          },
          options: activeTagOptions,
          ...(initialOptions && initialOptions.length > 0
            ? { initial_options: initialOptions }
            : {}),
        },
        label: {
          type: 'plain_text',
          text: '태그 선택',
          emoji: true,
        },
      });
    }

    if (schedules !== undefined) {
      blocks.push({ type: 'divider' });

      if (schedules.length === 0) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*검색 결과가 없습니다.*',
          },
        });
      } else {
        const {
          page = 0,
          totalPages = 1,
          total = schedules.length,
        } = pagination ?? {};

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*검색 결과 (총 ${total}개, ${page + 1}/${totalPages}페이지)*`,
          },
        });

        for (const schedule of schedules) {
          const buttonText = schedule.isSubscribed ? '구독 해제' : '구독하기';
          const buttonStyle = schedule.isSubscribed ? undefined : 'primary';
          const buttonValue = schedule.isSubscribed
            ? 'unsubscribe'
            : 'subscribe';
          const tagNames =
            schedule.tags.length > 0
              ? schedule.tags.map((t) => `\`${t.name}\``).join(' ')
              : '없음';

          const descriptionText = schedule.description
            ? `\n${schedule.description}`
            : '';

          const channelText =
            schedule.channels.length > 0
              ? `\n알림 채널: ${schedule.channels.map((id) => `<#${id}>`).join('  ')}`
              : '';
          const writerText =
            schedule.writers.length > 0
              ? `\n담당자: ${schedule.writers.map((id) => `<@${id}>`).join('  ')}`
              : '';

          const calendarUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(schedule.calendarId)}&ctz=Asia%2FSeoul&mode=WEEK`;
          blocks.push(
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${schedule.name}*${descriptionText}\n태그: ${tagNames}${channelText}${writerText}`,
              },
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: buttonText, emoji: true },
                  style: buttonStyle,
                  action_id: `schedule:subscribe:toggle:${schedule.id}`,
                  value: JSON.stringify({
                    action: buttonValue,
                    tagIds: selectedTagIds ?? [],
                  }),
                },
                {
                  type: 'button',
                  text: { type: 'plain_text', text: '일정 보기 ❐' },
                  url: calendarUrl,
                  action_id: `schedule:subscribe:open-url:${schedule.id}`,
                },
              ],
            },
          );
        }

        const navBlock: View['blocks'][number] = {
          type: 'actions',
          elements: [],
        };
        const navElements = (navBlock as { type: string; elements: object[] })
          .elements;
        if (page > 0) {
          navElements.push({
            type: 'button',
            text: { type: 'plain_text', text: '← 이전' },
            action_id: 'schedule:subscribe:page:prev',
            value: (page - 1).toString(),
          });
        }
        if (page < totalPages - 1) {
          navElements.push({
            type: 'button',
            text: { type: 'plain_text', text: '다음 →' },
            action_id: 'schedule:subscribe:page:next',
            value: (page + 1).toString(),
          });
        }
        if (navElements.length > 0) {
          blocks.push({ type: 'divider' });
          blocks.push(navBlock);
        }
      }

      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '💡 찾으시는 과목이 없나요? 조교에게 문의해 주세요.',
          },
        ],
      });
    }

    return {
      type: 'modal',
      callback_id: 'schedule:modal:subscribe:search',
      private_metadata: JSON.stringify({
        selectedTagIds: selectedTagIds ?? [],
        page: pagination?.page ?? 0,
      }),
      title: {
        type: 'plain_text',
        text: '시간표 구독',
      },
      submit:
        activeTagOptions.length > 0
          ? { type: 'plain_text', text: '검색' }
          : undefined,
      close: {
        type: 'plain_text',
        text: '닫기',
      },
      blocks,
    };
  }

  // 시간표 삭제 확인 모달
  static deleteConfirmModal(scheduleId: number, scheduleName: string): View {
    return {
      type: 'modal',
      callback_id: 'schedule:modal:delete',
      private_metadata: String(scheduleId),
      title: { type: 'plain_text', text: '시간표 삭제' },
      submit: { type: 'plain_text', text: '삭제' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${scheduleName}* 시간표를 삭제하시겠습니까?\n\n⚠️ Google Calendar도 함께 삭제되며 되돌릴 수 없습니다.`,
          },
        },
      ],
    };
  }
}
