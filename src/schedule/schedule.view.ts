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
  createdAt: Date;
}

export interface EditScheduleItem {
  id: number;
  name: string;
  description?: string;
  tags: { id: number; name: string }[];
}

export interface WriterItem {
  email: string;
  role: string;
  name?: string; // DB에서 조회된 슬랙 이름
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
    },
  ): View {
    const { page, totalPages, total, selectedStatus, selectedTagIds } = meta;

    const activeTagOptions = tags
      .filter((t) => t.status === TagStatus.ACTIVE)
      .map((t) => ({
        text: { type: 'plain_text' as const, text: t.name },
        value: t.id.toString(),
      }));

    const initialStatusOption = STATUS_OPTIONS.find(
      (o) => o.value === (selectedStatus ?? 'all'),
    );

    const initialTagOptions = selectedTagIds
      ? activeTagOptions.filter((opt) =>
          selectedTagIds.includes(parseInt(opt.value, 10)),
        )
      : [];

    const blocks: View['blocks'] = [
      // 상태 필터
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

    // 태그 필터 (태그 있을 때만)
    if (activeTagOptions.length > 0) {
      blocks.push({
        type: 'input',
        block_id: 'tags_block',
        optional: true,
        element: {
          type: 'multi_static_select',
          action_id: 'tags_select',
          placeholder: { type: 'plain_text', text: '태그 선택 (AND 조건)' },
          options: activeTagOptions,
          ...(initialTagOptions.length > 0
            ? { initial_options: initialTagOptions }
            : {}),
        },
        label: { type: 'plain_text', text: '태그' },
      });
    }

    blocks.push({ type: 'divider' });

    // 결과 요약
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

    // 시간표 목록
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

      blocks.push(
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${statusEmoji} *${schedule.name}*${description}\n태그: ${tagNames}\n상태: ${STATUS_LABELS[schedule.status]} | 생성자: ${schedule.createdBy.name} | 생성일: ${schedule.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
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
          ],
        },
      );
    }

    // 페이지 네비게이션
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
    writers: WriterItem[],
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

    // 편집자 관리 섹션
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*수정 권한 관리*' },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: '편집자 추가' },
          action_id: 'schedule:manage:writer:open:add',
          value: schedule.id.toString(),
        },
      },
    );

    const editorList = writers.filter((w) => w.role === 'writer');
    if (editorList.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '편집자가 없습니다.' },
      });
    } else {
      for (const writer of editorList) {
        const displayName = writer.name
          ? `${writer.name} (${writer.email})`
          : writer.email;
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `✏️ ${displayName}` },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '제거' },
            action_id: `schedule:manage:writer:remove:${schedule.id}`,
            value: writer.email,
            style: 'danger',
            confirm: {
              title: { type: 'plain_text', text: '편집자 제거' },
              text: {
                type: 'mrkdwn',
                text: `*${displayName}*의 수정 권한을 제거하시겠습니까?`,
              },
              confirm: { type: 'plain_text', text: '제거' },
              deny: { type: 'plain_text', text: '취소' },
            },
          },
        });
      }
    }

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

  // 편집자 추가 모달 (슬랙 사용자 선택)
  static addWriterModal(scheduleId: number, editViewId: string): View {
    return {
      type: 'modal',
      callback_id: 'schedule:modal:add:writer',
      private_metadata: JSON.stringify({ scheduleId, editViewId }),
      title: { type: 'plain_text', text: '편집자 추가' },
      submit: { type: 'plain_text', text: '추가' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'input',
          block_id: 'user_block',
          element: {
            type: 'users_select',
            action_id: 'user_input',
            placeholder: {
              type: 'plain_text',
              text: '이름으로 검색하세요',
            },
          },
          label: { type: 'plain_text', text: '편집자 선택' },
        },
      ],
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
