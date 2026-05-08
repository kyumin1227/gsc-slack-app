import type { View } from '@slack/types';
import { KnownBlock } from '@slack/web-api';
import { RecurrenceGroup } from '../recurrence-group.entity';
import {
  RecurrenceType,
  CreateRecurringEventsDto,
  UpdateRecurringEventsDto,
} from '../dto/recurring.dto';

export class ScheduleRecurringView {
  // 반복 일정 생성 모달
  static createRecurringModal(
    schedules: { id: number; name: string }[],
    initialScheduleId?: number,
  ): View {
    const options = schedules.map((s) => ({
      text: { type: 'plain_text' as const, text: s.name },
      value: String(s.id),
    }));
    const initialOption =
      initialScheduleId !== undefined
        ? options.find((o) => o.value === String(initialScheduleId))
        : undefined;

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
            options,
            ...(initialOption ? { initial_option: initialOption } : {}),
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
}

// 반복 일정 생성 알림 블록
export function buildRecurringCreationBlocks(
  scheduleName: string,
  dto: CreateRecurringEventsDto,
  totalCount: number,
  successCount: number,
  executorDisplay: string,
  writerDisplay: string,
): KnownBlock[] {
  const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
  const recurrenceLabel: Record<RecurrenceType, string> = {
    weekly: '매주',
    biweekly: '격주',
    monthly: '매월',
  };
  const fmtDays = (days: number[] | undefined) =>
    days && days.length > 0
      ? [...days]
          .sort((a, b) => a - b)
          .map((d) => DAY_LABELS[d])
          .join('·')
      : '미지정';
  const fmtTime = (s: string, e: string) => `${s} - ${e}`;
  const fmtPeriod = (s: string, e: string) => `${s} - ${e}`;

  const recurrenceText =
    dto.recurrenceType !== 'monthly' && dto.daysOfWeek?.length
      ? `${recurrenceLabel[dto.recurrenceType]} ${fmtDays(dto.daysOfWeek)}요일`
      : recurrenceLabel[dto.recurrenceType];

  const statusText =
    successCount < totalCount
      ? `⚠️ ${successCount}/${totalCount}개 생성 완료`
      : `총 ${successCount}개 생성`;

  const { room: crtRoom, professor: crtProfessor } = parseLocationParts(
    dto.location ?? '',
  );

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `✨ [${scheduleName}] 반복 일정 추가 안내`,
        emoji: true,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `📌 *일정 제목*\n*${dto.title}*` },
        {
          type: 'mrkdwn',
          text: `🕐 *시간*\n${fmtTime(dto.startTime, dto.endTime)}`,
        },
      ],
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `🗓️ *기간*\n${fmtPeriod(dto.startDate, dto.endDate)}`,
        },
        {
          type: 'mrkdwn',
          text: `📅 *요일*\n${fmtDays(dto.daysOfWeek)}`,
        },
      ],
    },
    crtProfessor
      ? {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `📍 *장소*\n${crtRoom || '_미지정_'}` },
            { type: 'mrkdwn', text: `👨‍🏫 *교수*\n${crtProfessor}` },
          ],
        }
      : {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📍 *장소*\n${crtRoom || '_미지정_'}`,
          },
        },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `👤 *실행자*\n${executorDisplay}` },
        { type: 'mrkdwn', text: `👥 *담당자*\n${writerDisplay}` },
      ],
    },
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `🔁 *반복:* ${recurrenceText} | 📊 *처리 결과:* ${statusText} | *Bannote Bot*`,
        },
      ],
    },
  ] as unknown as KnownBlock[];
}

// 반복 일정 삭제 알림 블록
export function buildRecurringDeleteBlocks(
  scheduleName: string,
  group: RecurrenceGroup,
  scope: 'all' | 'future',
  filterOriginal: boolean,
  deletedCount: number,
  totalCount: number,
  executorDisplay: string,
  writerDisplay: string,
): KnownBlock[] {
  const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
  const fmtDays = (days: number[] | null) =>
    days && days.length > 0
      ? [...days]
          .sort((a, b) => a - b)
          .map((d) => DAY_LABELS[d])
          .join('·')
      : '미지정';
  const fmtTime = (s: string, e: string) => `${s} - ${e}`;
  const fmtPeriod = (s: string, e: string) => `${s} - ${e}`;

  const scopeText = scope === 'all' ? '전체' : '오늘 이후';
  const filterText = filterOriginal ? '원본만' : '전체';
  const statusText =
    deletedCount < totalCount
      ? `⚠️ ${deletedCount}/${totalCount}개 삭제 완료`
      : `총 ${deletedCount}개 삭제`;

  const { room: delRoom, professor: delProfessor } = parseLocationParts(
    group.location ?? '',
  );

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🗑️ [${scheduleName}] 반복 일정 삭제 안내`,
        emoji: true,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `📌 *일정 제목*\n*${group.title}*` },
        {
          type: 'mrkdwn',
          text: `🕐 *시간*\n${fmtTime(group.startTime, group.endTime)}`,
        },
      ],
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `🗓️ *기간*\n${fmtPeriod(group.startDate, group.endDate)}`,
        },
        {
          type: 'mrkdwn',
          text: `📅 *요일*\n${fmtDays(group.daysOfWeek)}`,
        },
      ],
    },
    delProfessor
      ? {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `📍 *장소*\n${delRoom || '_미지정_'}`,
            },
            { type: 'mrkdwn', text: `👨‍🏫 *교수*\n${delProfessor}` },
          ],
        }
      : {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📍 *장소*\n${delRoom || '_미지정_'}`,
          },
        },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `👤 *실행자*\n${executorDisplay}` },
        { type: 'mrkdwn', text: `👥 *담당자*\n${writerDisplay}` },
      ],
    },
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `🔍 *삭제 범위:* ${scopeText} (${filterText}) | 📊 *처리 결과:* ${statusText} | *Bannote Bot*`,
        },
      ],
    },
  ] as unknown as KnownBlock[];
}

// 반복 일정 수정 알림 블록
export function buildRecurringUpdateBlocks(
  scheduleName: string,
  group: RecurrenceGroup,
  dto: UpdateRecurringEventsDto,
  scope: 'all' | 'future',
  updatedCount: number,
  totalCount: number,
  executorDisplay: string,
  writerDisplay: string,
): KnownBlock[] {
  const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
  const fmtDays = (days: number[] | null) =>
    days && days.length > 0
      ? [...days]
          .sort((a, b) => a - b)
          .map((d) => DAY_LABELS[d])
          .join('·')
      : '미지정';
  const fmtTime = (s: string | null, e: string | null) =>
    s && e ? `${s} - ${e}` : '미지정';
  const fmtPeriod = (s: string | null, e: string | null) =>
    s && e ? `${s} - ${e}` : '미지정';

  const titleChanged = dto.title !== undefined && dto.title !== group.title;
  const titleText = titleChanged
    ? `📌 *일정 제목* ✏️\n~${group.title}~ → *${dto.title}*`
    : `📌 *일정 제목*\n*${group.title}*`;

  const newStart = dto.startTime ?? group.startTime;
  const newEnd = dto.endTime ?? group.endTime;
  const timeChanged =
    (dto.startTime !== undefined && dto.startTime !== group.startTime) ||
    (dto.endTime !== undefined && dto.endTime !== group.endTime);
  const timeText = timeChanged
    ? `🕐 *시간* ✏️\n~${fmtTime(group.startTime, group.endTime)}~ → *${fmtTime(newStart, newEnd)}*`
    : `🕐 *시간*\n${fmtTime(group.startTime, group.endTime)}`;

  const daysChanged =
    dto.daysOfWeek !== undefined &&
    fmtDays(dto.daysOfWeek) !== fmtDays(group.daysOfWeek);
  const daysText = daysChanged
    ? `📅 *요일* ✏️\n~${fmtDays(group.daysOfWeek)}~ → *${fmtDays(dto.daysOfWeek!)}*`
    : `📅 *요일*\n${fmtDays(group.daysOfWeek)}`;

  const newStartDate = dto.startDate ?? group.startDate;
  const newEndDate = dto.endDate ?? group.endDate;
  const periodChanged =
    (dto.startDate !== undefined && dto.startDate !== group.startDate) ||
    (dto.endDate !== undefined && dto.endDate !== group.endDate);
  const periodText = periodChanged
    ? `🗓️ *기간* ✏️\n~${fmtPeriod(group.startDate, group.endDate)}~ \n→ *${fmtPeriod(newStartDate, newEndDate)}*`
    : `🗓️ *기간*\n${fmtPeriod(group.startDate, group.endDate)}`;

  const locationChanged =
    dto.location !== undefined && dto.location !== group.location;
  const afterLocation = dto.location ?? group.location ?? '';
  const { room: afterRoom, professor: afterProfessor } =
    parseLocationParts(afterLocation);

  let roomText: string;
  let professorText: string | null = null;

  if (locationChanged) {
    const { room: beforeRoom, professor: beforeProfessor } = parseLocationParts(
      group.location ?? '',
    );
    roomText =
      beforeRoom !== afterRoom
        ? `📍 *장소* ✏️\n~${beforeRoom || '미지정'}~ → *${afterRoom || '미지정'}*`
        : `📍 *장소*\n${afterRoom || '_미지정_'}`;
    if (beforeProfessor !== afterProfessor) {
      professorText = `👨‍🏫 *교수* ✏️\n~${beforeProfessor || '미지정'}~ → *${afterProfessor || '미지정'}*`;
    } else if (afterProfessor) {
      professorText = `👨‍🏫 *교수*\n${afterProfessor}`;
    }
  } else {
    roomText = `📍 *장소*\n${afterRoom || '_미지정_'}`;
    if (afterProfessor) {
      professorText = `👨‍🏫 *교수*\n${afterProfessor}`;
    }
  }

  const scopeText = scope === 'all' ? '전체' : '오늘 이후';
  const statusText =
    updatedCount < totalCount
      ? `⚠️ ${updatedCount}/${totalCount}개 수정 완료`
      : `총 ${updatedCount}개 수정`;

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🔄 [${scheduleName}] 반복 일정 수정 안내`,
        emoji: true,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: titleText },
        { type: 'mrkdwn', text: timeText },
      ],
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: periodText },
        { type: 'mrkdwn', text: daysText },
      ],
    },
    professorText
      ? {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: roomText },
            { type: 'mrkdwn', text: professorText },
          ],
        }
      : {
          type: 'section',
          text: { type: 'mrkdwn', text: roomText },
        },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `👤 *실행자*\n${executorDisplay}` },
        { type: 'mrkdwn', text: `👥 *담당자*\n${writerDisplay}` },
      ],
    },
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `🔍 *수정 범위:* ${scopeText} | 📊 *처리 결과:* ${statusText} | *Bannote Bot*`,
        },
      ],
    },
  ] as unknown as KnownBlock[];
}

function parseLocationParts(location: string): {
  room: string;
  professor: string | null;
} {
  const slashIdx = location.indexOf('/');
  if (slashIdx === -1) return { room: location.trim(), professor: null };
  return {
    room: location.slice(0, slashIdx).trim(),
    professor: location.slice(slashIdx + 1).trim() || null,
  };
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
