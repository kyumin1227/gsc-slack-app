import type { View } from '@slack/types';
import { ScheduleStatus } from './schedule.entity';
import { TagStatus } from '../tag/tag.entity';

export interface ScheduleListItem {
  id: number;
  name: string;
  description?: string;
  status: ScheduleStatus;
  tags: { id: number; name: string }[];
  createdBy: { name: string };
}

export interface SubscribeScheduleItem {
  id: number;
  name: string;
  description?: string;
  tags: { id: number; name: string }[];
  createdBy: { name: string };
  isSubscribed: boolean;
}

export interface TagOption {
  id: number;
  name: string;
  status: TagStatus;
}

const STATUS_LABELS: Record<ScheduleStatus, string> = {
  [ScheduleStatus.ACTIVE]: '활성',
  [ScheduleStatus.INACTIVE]: '비활성',
};

export class ScheduleView {
  // 시간표 목록 모달
  static listModal(schedules: ScheduleListItem[]): View {
    const blocks: View['blocks'] = [];

    if (schedules.length === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '등록된 시간표가 없습니다.',
        },
      });
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*등록된 시간표: ${schedules.length}개*`,
        },
      });

      blocks.push({ type: 'divider' });

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

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${statusEmoji} *${schedule.name}*${description}\n태그: ${tagNames}\n상태: ${STATUS_LABELS[schedule.status]} | 생성자: ${schedule.createdBy.name}`,
          },
          accessory: {
            type: 'button',
            text: {
              type: 'plain_text',
              text: toggleText,
            },
            action_id: `schedule:list:toggle:${schedule.id}`,
            value: toggleValue,
          },
        });
      }
    }

    return {
      type: 'modal',
      callback_id: 'schedule:modal:list',
      title: {
        type: 'plain_text',
        text: '시간표 관리',
      },
      close: {
        type: 'plain_text',
        text: '닫기',
      },
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

    // 태그가 있는 경우에만 태그 선택 옵션 추가
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

  // 구독 검색 모달 (태그 선택 + 결과)
  static subscribeSearchModal(
    tags: TagOption[],
    schedules?: SubscribeScheduleItem[],
    selectedTagIds?: number[],
  ): View {
    const activeTagOptions = tags
      .filter((t) => t.status === TagStatus.ACTIVE)
      .map((t) => ({
        text: { type: 'plain_text' as const, text: `🏷️ ${t.name}` },
        value: t.id.toString(),
      }));

    const blocks: View['blocks'] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🔍 시간표 통합 검색',
          emoji: true,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*조회하고 싶은 태그를 모두 선택해 주세요.* (반, 과목 등)',
        },
      },
    ];

    if (activeTagOptions.length === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '등록된 태그가 없습니다.',
        },
      });
    } else {
      // 선택된 태그가 있으면 initial_options 설정
      const initialOptions = selectedTagIds
        ? activeTagOptions.filter((opt) =>
            selectedTagIds.includes(parseInt(opt.value, 10)),
          )
        : undefined;

      blocks.push({
        type: 'input',
        block_id: 'tags_block',
        element: {
          type: 'multi_static_select',
          action_id: 'tags_select',
          placeholder: {
            type: 'plain_text',
            text: '태그를 선택하세요',
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

    // 검색 결과가 있으면 표시
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
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*검색 결과 (${schedules.length}건)*`,
          },
        });

        for (const schedule of schedules) {
          const buttonText = schedule.isSubscribed ? '구독 해제' : '구독하기';
          const buttonStyle = schedule.isSubscribed ? undefined : 'primary';
          const buttonValue = schedule.isSubscribed
            ? 'unsubscribe'
            : 'subscribe';
          const tagLabels = schedule.tags.map((t) => t.name).join(', ');

          const descriptionText = schedule.description
            ? `\n${schedule.description}`
            : '';

          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📅 *[${tagLabels}] ${schedule.name}*${descriptionText}\n생성자: ${schedule.createdBy.name}`,
            },
            accessory: {
              type: 'button',
              text: {
                type: 'plain_text',
                text: buttonText,
                emoji: true,
              },
              style: buttonStyle,
              action_id: `schedule:subscribe:toggle:${schedule.id}`,
              value: JSON.stringify({
                action: buttonValue,
                tagIds: selectedTagIds,
              }),
            },
          });
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
      }),
      title: {
        type: 'plain_text',
        text: '시간표 구독',
      },
      submit:
        activeTagOptions.length > 0
          ? {
              type: 'plain_text',
              text: '검색',
            }
          : undefined,
      close: {
        type: 'plain_text',
        text: '닫기',
      },
      blocks,
    };
  }
}
