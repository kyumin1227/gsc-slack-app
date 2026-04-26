import type { View } from '@slack/types';
import { ScheduleStatus } from './schedule.entity';
import { TagStatus } from '../tag/tag.entity';
import { multiUsersSelectBlock } from '../common/blocks';

export interface ScheduleListItem {
  id: number;
  name: string;
  description?: string;
  status: ScheduleStatus;
  tags: { id: number; name: string }[];
  createdBy: { name: string };
  channels: string[]; // Slack 채널 ID 목록
  writers: string[]; // 담당자 Slack 유저 ID 목록
  createdAt: Date;
}

export interface EditScheduleItem {
  id: number;
  name: string;
  description?: string;
  tags: { id: number; name: string }[];
}

export interface SubscribeScheduleItem {
  id: number;
  name: string;
  description?: string;
  calendarId: string;
  tags: { id: number; name: string }[];
  channels: string[]; // Slack 채널 ID 목록
  writers: string[]; // 담당자 Slack 유저 ID 목록
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

    // 알림 채널 섹션
    blocks.push(
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'notification_channels_block',
        optional: true,
        element: {
          type: 'multi_channels_select',
          action_id: 'channels_select',
          placeholder: { type: 'plain_text', text: '알림 받을 채널 선택' },
          ...(notificationChannelIds.length > 0
            ? { initial_channels: notificationChannelIds }
            : {}),
        },
        label: { type: 'plain_text', text: '알림 채널' },
      },
    );

    // 편집자 관리 섹션
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
                  action_id: `schedule:subscribe:view-calendar:${schedule.id}`,
                },
              ],
            },
          );
        }

        // 페이지 네비게이션
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

  static createRecurringModal(schedules: { id: number; name: string }[]): View {
    return {
      type: 'modal',
      callback_id: 'schedule:modal:create_recurring',
      title: { type: 'plain_text', text: '반복 일정 생성' },
      submit: { type: 'plain_text', text: '생성' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'input',
          block_id: 'schedule_block',
          label: { type: 'plain_text', text: '시간표' },
          element: {
            type: 'static_select',
            action_id: 'schedule_input',
            placeholder: { type: 'plain_text', text: '시간표 선택' },
            options: schedules.map((s) => ({
              text: { type: 'plain_text', text: s.name },
              value: String(s.id),
            })),
          },
        },
        {
          type: 'input',
          block_id: 'title_block',
          label: { type: 'plain_text', text: '이벤트 제목' },
          element: {
            type: 'plain_text_input',
            action_id: 'title_input',
            placeholder: { type: 'plain_text', text: '예: 운영체제 강의' },
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
          },
        },
        {
          type: 'input',
          block_id: 'location_block',
          label: { type: 'plain_text', text: '장소' },
          optional: true,
          element: {
            type: 'plain_text_input',
            action_id: 'location_input',
            placeholder: { type: 'plain_text', text: '예: 세미나실 A' },
          },
        },
        {
          type: 'input',
          block_id: 'professor_block',
          label: { type: 'plain_text', text: '교수' },
          optional: true,
          element: {
            type: 'plain_text_input',
            action_id: 'professor_input',
            placeholder: { type: 'plain_text', text: '예: 홍길동' },
          },
        },
        {
          type: 'input',
          block_id: 'start_date_block',
          label: { type: 'plain_text', text: '시작일' },
          element: {
            type: 'datepicker',
            action_id: 'start_date_input',
            placeholder: { type: 'plain_text', text: '시작일 선택' },
          },
        },
        {
          type: 'input',
          block_id: 'end_date_block',
          label: { type: 'plain_text', text: '종료일' },
          element: {
            type: 'datepicker',
            action_id: 'end_date_input',
            placeholder: { type: 'plain_text', text: '종료일 선택' },
          },
        },
        {
          type: 'input',
          block_id: 'start_time_block',
          label: { type: 'plain_text', text: '시작 시각' },
          element: {
            type: 'timepicker',
            action_id: 'start_time_input',
            placeholder: { type: 'plain_text', text: '시작 시각 선택' },
          },
        },
        {
          type: 'input',
          block_id: 'end_time_block',
          label: { type: 'plain_text', text: '종료 시각' },
          element: {
            type: 'timepicker',
            action_id: 'end_time_input',
            placeholder: { type: 'plain_text', text: '종료 시각 선택' },
          },
        },
        {
          type: 'input',
          block_id: 'recurrence_block',
          label: { type: 'plain_text', text: '반복 주기' },
          element: {
            type: 'static_select',
            action_id: 'recurrence_input',
            options: [
              { text: { type: 'plain_text', text: '매주' }, value: 'weekly' },
              {
                text: { type: 'plain_text', text: '격주' },
                value: 'biweekly',
              },
              {
                text: { type: 'plain_text', text: '매월' },
                value: 'monthly',
              },
            ],
          },
        },
        {
          type: 'input',
          block_id: 'days_of_week_block',
          label: {
            type: 'plain_text',
            text: '반복 요일 (매주/격주 선택 시)',
          },
          optional: true,
          element: {
            type: 'multi_static_select',
            action_id: 'days_of_week_input',
            placeholder: { type: 'plain_text', text: '요일 선택' },
            options: [
              { text: { type: 'plain_text', text: '월' }, value: '1' },
              { text: { type: 'plain_text', text: '화' }, value: '2' },
              { text: { type: 'plain_text', text: '수' }, value: '3' },
              { text: { type: 'plain_text', text: '목' }, value: '4' },
              { text: { type: 'plain_text', text: '금' }, value: '5' },
              { text: { type: 'plain_text', text: '토' }, value: '6' },
              { text: { type: 'plain_text', text: '일' }, value: '0' },
            ],
          },
        },
      ],
    };
  }

  // Step 1: 캘린더(시간표) 선택 모달 — 수정/삭제 공통
  static selectScheduleForRecurringModal(
    schedules: { id: number; name: string }[],
    mode: 'edit' | 'delete',
  ): View {
    const isEdit = mode === 'edit';
    return {
      type: 'modal',
      callback_id: isEdit
        ? 'recurring:modal:step1:edit'
        : 'recurring:modal:step1:delete',
      title: {
        type: 'plain_text',
        text: isEdit ? '반복 일정 수정' : '반복 일정 삭제',
      },
      submit: { type: 'plain_text', text: '다음' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'input',
          block_id: 'schedule_block',
          label: { type: 'plain_text', text: '시간표 선택' },
          element: {
            type: 'static_select',
            action_id: 'schedule_input',
            placeholder: { type: 'plain_text', text: '시간표를 선택하세요' },
            options: schedules.map((s) => ({
              text: { type: 'plain_text' as const, text: s.name },
              value: String(s.id),
            })),
          },
        },
      ],
    };
  }

  // Step 2: 반복 일정 삭제 모달 (특정 시간표 필터링 후)
  static deleteRecurringModal(
    groups: {
      id: number;
      title: string;
      daysOfWeek: number[] | null;
      startTime: string | null;
      endTime: string | null;
    }[],
    scheduleName: string,
  ): View {
    return {
      type: 'modal',
      callback_id: 'recurring:modal:delete',
      title: { type: 'plain_text', text: '반복 일정 삭제' },
      submit: { type: 'plain_text', text: '삭제' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `📅 *${scheduleName}*`,
            },
          ],
        },
        {
          type: 'input',
          block_id: 'group_block',
          label: { type: 'plain_text', text: '삭제할 반복 일정' },
          element: {
            type: 'static_select',
            action_id: 'group_input',
            placeholder: { type: 'plain_text', text: '반복 일정 선택' },
            options: groups.map((g) => ({
              text: {
                type: 'plain_text' as const,
                text: formatRecurrenceGroupLabel(g),
              },
              value: String(g.id),
            })),
          },
        },
        {
          type: 'input',
          block_id: 'scope_block',
          label: { type: 'plain_text', text: '삭제 범위' },
          element: {
            type: 'static_select',
            action_id: 'scope_input',
            options: [
              { text: { type: 'plain_text', text: '전체' }, value: 'all' },
              {
                text: { type: 'plain_text', text: '오늘 이후만' },
                value: 'future',
              },
            ],
          },
        },
        {
          type: 'input',
          block_id: 'filter_block',
          label: { type: 'plain_text', text: '삭제 대상' },
          hint: {
            type: 'plain_text',
            text: '원본만: 생성 후 개별 수정된 일정은 제외합니다',
          },
          element: {
            type: 'static_select',
            action_id: 'filter_input',
            initial_option: {
              text: { type: 'plain_text', text: '원본만 삭제' },
              value: 'original',
            },
            options: [
              {
                text: { type: 'plain_text', text: '원본만 삭제' },
                value: 'original',
              },
              {
                text: {
                  type: 'plain_text',
                  text: '전체 삭제 (수정된 것 포함)',
                },
                value: 'all',
              },
            ],
          },
        },
      ],
    };
  }

  // Step 2: 반복 일정 선택 모달 (그룹 드롭다운만, 다음 → 프리필 폼)
  static selectGroupForEditModal(
    groups: {
      id: number;
      title: string;
      daysOfWeek: number[] | null;
      startTime: string | null;
      endTime: string | null;
    }[],
    scheduleName: string,
    scheduleId: number,
  ): View {
    return {
      type: 'modal',
      callback_id: 'recurring:modal:step2:edit',
      private_metadata: JSON.stringify({ scheduleName, scheduleId }),
      title: { type: 'plain_text', text: '반복 일정 수정' },
      submit: { type: 'plain_text', text: '다음' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `📅 *${scheduleName}*` }],
        },
        {
          type: 'input',
          block_id: 'group_block',
          label: { type: 'plain_text', text: '수정할 반복 일정' },
          element: {
            type: 'static_select',
            action_id: 'group_input',
            placeholder: { type: 'plain_text', text: '반복 일정 선택' },
            options: groups.map((g) => ({
              text: {
                type: 'plain_text' as const,
                text: formatRecurrenceGroupLabel(g),
              },
              value: String(g.id),
            })),
          },
        },
      ],
    };
  }

  // Step 3: 반복 일정 수정 폼 (선택된 그룹 기본값 프리필)
  static editRecurringModal(
    group: {
      id: number;
      title: string;
      daysOfWeek: number[] | null;
      startTime: string | null;
      endTime: string | null;
      location: string | null;
      startDate: string | null;
      endDate: string | null;
    },
    scheduleName: string,
  ): View {
    const DAY_OPTIONS = [
      { text: { type: 'plain_text' as const, text: '일' }, value: '0' },
      { text: { type: 'plain_text' as const, text: '월' }, value: '1' },
      { text: { type: 'plain_text' as const, text: '화' }, value: '2' },
      { text: { type: 'plain_text' as const, text: '수' }, value: '3' },
      { text: { type: 'plain_text' as const, text: '목' }, value: '4' },
      { text: { type: 'plain_text' as const, text: '금' }, value: '5' },
      { text: { type: 'plain_text' as const, text: '토' }, value: '6' },
    ];
    const initialDays = group.daysOfWeek
      ? DAY_OPTIONS.filter((o) => group.daysOfWeek!.includes(parseInt(o.value)))
      : undefined;
    const locationSlash = (group.location ?? '').indexOf('/');
    const initialRoom =
      locationSlash === -1
        ? (group.location ?? '').trim()
        : (group.location ?? '').slice(0, locationSlash).trim();
    const initialProfessor =
      locationSlash === -1
        ? ''
        : (group.location ?? '').slice(locationSlash + 1).trim();

    return {
      type: 'modal',
      callback_id: 'recurring:modal:edit',
      private_metadata: JSON.stringify({ groupDbId: group.id }),
      title: { type: 'plain_text', text: '반복 일정 수정' },
      submit: { type: 'plain_text', text: '수정' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `📅 *${scheduleName}*` }],
        },
        {
          type: 'input',
          block_id: 'title_block',
          label: { type: 'plain_text', text: '제목' },
          element: {
            type: 'plain_text_input',
            action_id: 'title_input',
            initial_value: group.title,
            placeholder: { type: 'plain_text', text: '제목' },
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
            placeholder: { type: 'plain_text', text: '설명' },
          },
        },
        {
          type: 'input',
          block_id: 'location_block',
          label: { type: 'plain_text', text: '장소' },
          optional: true,
          element: {
            type: 'plain_text_input',
            action_id: 'location_input',
            ...(initialRoom ? { initial_value: initialRoom } : {}),
            placeholder: { type: 'plain_text', text: '예: 세미나실 A' },
          },
        },
        {
          type: 'input',
          block_id: 'professor_block',
          label: { type: 'plain_text', text: '교수' },
          optional: true,
          element: {
            type: 'plain_text_input',
            action_id: 'professor_input',
            ...(initialProfessor ? { initial_value: initialProfessor } : {}),
            placeholder: { type: 'plain_text', text: '예: 홍길동' },
          },
        },
        {
          type: 'input',
          block_id: 'start_time_block',
          label: { type: 'plain_text', text: '시작 시각' },
          element: {
            type: 'timepicker',
            action_id: 'start_time_input',
            ...(group.startTime ? { initial_time: group.startTime } : {}),
            placeholder: { type: 'plain_text', text: '시작 시각' },
          },
        },
        {
          type: 'input',
          block_id: 'end_time_block',
          label: { type: 'plain_text', text: '종료 시각' },
          element: {
            type: 'timepicker',
            action_id: 'end_time_input',
            ...(group.endTime ? { initial_time: group.endTime } : {}),
            placeholder: { type: 'plain_text', text: '종료 시각' },
          },
        },
        {
          type: 'input',
          block_id: 'days_of_week_block',
          label: { type: 'plain_text', text: '요일' },
          hint: {
            type: 'plain_text',
            text: '제거된 요일의 원본 일정은 삭제, 추가된 요일에는 같은 기간으로 신규 생성',
          },
          element: {
            type: 'multi_static_select',
            action_id: 'days_of_week_input',
            placeholder: { type: 'plain_text', text: '요일 선택' },
            options: DAY_OPTIONS,
            ...(initialDays && initialDays.length > 0
              ? { initial_options: initialDays }
              : {}),
          },
        },
        {
          type: 'input',
          block_id: 'start_date_block',
          label: { type: 'plain_text', text: '시작일' },
          element: {
            type: 'datepicker',
            action_id: 'start_date_input',
            ...(group.startDate ? { initial_date: group.startDate } : {}),
            placeholder: { type: 'plain_text', text: '시작일' },
          },
        },
        {
          type: 'input',
          block_id: 'end_date_block',
          label: { type: 'plain_text', text: '종료일' },
          element: {
            type: 'datepicker',
            action_id: 'end_date_input',
            ...(group.endDate ? { initial_date: group.endDate } : {}),
            placeholder: { type: 'plain_text', text: '종료일' },
          },
        },
        {
          type: 'input',
          block_id: 'scope_block',
          label: { type: 'plain_text', text: '수정 범위' },
          element: {
            type: 'static_select',
            action_id: 'scope_input',
            options: [
              { text: { type: 'plain_text', text: '전체' }, value: 'all' },
              {
                text: { type: 'plain_text', text: '오늘 이후만' },
                value: 'future',
              },
            ],
          },
        },
      ],
    };
  }

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

// 반복 일정 그룹 표시 라벨 포맷: "운영체제 강의 (월수 09:00-11:00)"
function formatRecurrenceGroupLabel(g: {
  title: string;
  daysOfWeek: number[] | null;
  startTime: string | null;
  endTime: string | null;
}): string {
  const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
  const parts: string[] = [];
  if (g.daysOfWeek && g.daysOfWeek.length > 0) {
    parts.push(
      [...g.daysOfWeek]
        .sort((a, b) => a - b)
        .map((d) => DAY_LABELS[d])
        .join('·'),
    );
  }
  if (g.startTime && g.endTime) {
    parts.push(`${g.startTime}-${g.endTime}`);
  }
  return parts.length > 0 ? `${g.title} (${parts.join(' ')})` : g.title;
}
