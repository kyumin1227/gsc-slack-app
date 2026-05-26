import type { View } from '@slack/types';
import { ruleInfoText } from './cleaning-rule.view';
import { RuleWithDetails } from '../service/cleaning-rule.service';
import { ScheduleWithAssignees } from '../service/cleaning-schedule.service';
import { CleaningScheduleStatus } from '../entity/cleaning-schedule.entity';
import { CleaningAssignmentStatus } from '../entity/cleaning-assignment.entity';

export class CleaningScheduleView {
  // 규칙을 먼저 선택한 뒤 예정/지난 일정 목록으로 진입한다.
  static scheduleManageListModal(rules: RuleWithDetails[]): View {
    const blocks: View['blocks'] = [];

    if (rules.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '등록된 청소 규칙이 없습니다.' },
      });
    } else {
      for (const rule of rules) {
        blocks.push(
          {
            type: 'section',
            text: { type: 'mrkdwn', text: ruleInfoText(rule) },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '예정 일정' },
                action_id: 'cleaning:schedule:open-upcoming',
                value: String(rule.id),
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '지난 일정' },
                action_id: 'cleaning:schedule:open-past',
                value: String(rule.id),
              },
            ],
          },
          { type: 'divider' },
        );
      }
    }

    return {
      type: 'modal',
      callback_id: 'cleaning:modal:schedule-manage-list',
      title: { type: 'plain_text', text: '일정 관리' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  // 예정 일정은 active 배정자만, 지난 일정은 완료/미실시 상태까지 함께 보여준다.
  static scheduleDetailModal(
    schedules: ScheduleWithAssignees[],
    ruleLabel: string,
    ruleId: number,
    filter: 'upcoming' | 'past',
  ): View {
    const today = new Date().toISOString().split('T')[0];
    const isPast = filter === 'past';

    const filtered = isPast
      ? [...schedules]
          .filter((s) => s.cleaningDate < today)
          .sort((a, b) => b.cleaningDate.localeCompare(a.cleaningDate))
      : schedules.filter((s) => s.cleaningDate >= today);

    const blocks: View['blocks'] = [
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `*${ruleLabel}*` }],
      },
    ];

    if (filtered.length === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: isPast ? '지난 일정이 없습니다.' : '예정된 일정이 없습니다.',
        },
      });
    } else {
      for (const s of filtered) {
        const assignedAssignees = s.assignees.filter(
          (a) => a.status === CleaningAssignmentStatus.ASSIGNED,
        );
        const assigneeText = isPast
          ? s.assignees.length > 0
            ? s.assignees
                .map((a) =>
                  a.status !== CleaningAssignmentStatus.ASSIGNED
                    ? `${a.userName} (${a.status})`
                    : a.userName,
                )
                .join(', ')
            : '미배정'
          : assignedAssignees.length > 0
            ? assignedAssignees.map((a) => a.userName).join(', ')
            : '미배정';
        blocks.push(
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${s.cleaningDate}* | ${s.status} | ${s.needPeoples}명\n담당: ${assigneeText}`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '수정' },
                action_id: 'cleaning:schedule:open-edit',
                value: String(s.id),
              },
              ...(!isPast
                ? [
                    {
                      type: 'button' as const,
                      text: { type: 'plain_text' as const, text: '전원 배정' },
                      action_id: 'cleaning:schedule:assign-all',
                      value: String(s.id),
                    },
                  ]
                : []),
              {
                type: 'button',
                text: { type: 'plain_text', text: '배정 상태' },
                action_id: 'cleaning:schedule:open-assignment-status',
                value: String(s.id),
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '삭제' },
                action_id: 'cleaning:schedule:open-delete',
                value: String(s.id),
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
      callback_id: 'cleaning:modal:schedule-detail',
      private_metadata: JSON.stringify({ ruleId, filter }),
      title: { type: 'plain_text', text: isPast ? '지난 일정' : '예정 일정' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  // 개별 배정의 수행 결과를 관리자가 일정 단위로 변경하는 모달.
  static assignmentStatusModal(schedule: ScheduleWithAssignees): View {
    const statusOptions = [
      {
        text: { type: 'plain_text' as const, text: '배정' },
        value: CleaningAssignmentStatus.ASSIGNED,
      },
      {
        text: { type: 'plain_text' as const, text: '미실시' },
        value: CleaningAssignmentStatus.NON_COMPLIANT,
      },
    ];

    const blocks: View['blocks'] = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `날짜: *${schedule.cleaningDate}*` },
      },
    ];

    if (schedule.assignees.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '배정된 인원이 없습니다.' },
      });
    } else {
      for (const a of schedule.assignees) {
        const initialOption = statusOptions.find((o) => o.value === a.status);
        blocks.push({
          type: 'input',
          block_id: `assignment_${a.assignmentId}`,
          label: {
            type: 'plain_text',
            text: `${a.userName}${a.status === CleaningAssignmentStatus.COMPLETED ? ' ✅' : ''}`,
          },
          optional: true,
          element: {
            type: 'static_select',
            action_id: 'status_select',
            placeholder: { type: 'plain_text', text: '변경할 상태 선택' },
            options: statusOptions,
            ...(initialOption ? { initial_option: initialOption } : {}),
          },
        });
      }
    }

    return {
      type: 'modal',
      callback_id: 'cleaning:modal:assignment-status',
      private_metadata: String(schedule.id),
      title: { type: 'plain_text', text: '배정 상태 관리' },
      submit:
        schedule.assignees.length > 0
          ? { type: 'plain_text', text: '저장' }
          : undefined,
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  // 지난 일정은 기록 보존을 위해 필요 인원 수정을 막고 상태만 관리한다.
  static scheduleEditModal(
    schedule: ScheduleWithAssignees,
    ruleId: number,
    filter: 'upcoming' | 'past',
  ): View {
    const statusOptions = [
      {
        text: { type: 'plain_text' as const, text: '예정' },
        value: CleaningScheduleStatus.SCHEDULED,
      },
      {
        text: { type: 'plain_text' as const, text: '취소' },
        value: CleaningScheduleStatus.CANCELED,
      },
    ];

    return {
      type: 'modal',
      callback_id: 'cleaning:modal:schedule-edit',
      private_metadata: JSON.stringify({
        scheduleId: schedule.id,
        ruleId,
        filter,
      }),
      title: { type: 'plain_text', text: '일정 수정' },
      submit: { type: 'plain_text', text: '저장' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'input',
          block_id: 'cleaning_date_block',
          label: { type: 'plain_text', text: '날짜' },
          element: {
            type: 'datepicker',
            action_id: 'cleaning_date_input',
            initial_date: schedule.cleaningDate,
          },
        },
        ...(filter === 'upcoming'
          ? [
              {
                type: 'input' as const,
                block_id: 'need_peoples_block',
                label: { type: 'plain_text' as const, text: '필요 인원 (명)' },
                element: {
                  type: 'plain_text_input' as const,
                  action_id: 'need_peoples_input',
                  initial_value: String(schedule.needPeoples),
                },
              },
            ]
          : [
              {
                type: 'section' as const,
                text: {
                  type: 'mrkdwn' as const,
                  text: `필요 인원: *${schedule.needPeoples}명* (지난 일정은 수정 불가)`,
                },
              },
            ]),
        {
          type: 'input',
          block_id: 'status_block',
          label: { type: 'plain_text', text: '상태' },
          element: {
            type: 'static_select',
            action_id: 'status_select',
            options: statusOptions,
            initial_option: statusOptions.find(
              (o) => o.value === schedule.status,
            ),
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '⚠️ 상태를 *취소* 로 변경하면 이 일정의 배정이 모두 취소됩니다.',
            },
          ],
        },
      ],
    };
  }

  static scheduleDeleteConfirmModal(
    scheduleId: number,
    ruleId: number,
    filter: 'upcoming' | 'past',
    cleaningDate: string,
    errorMessage?: string,
  ): View {
    const blocks: View['blocks'] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${cleaningDate}* 일정을 삭제하시겠습니까?\n배정된 인원이 모두 취소됩니다.`,
        },
      },
    ];
    if (errorMessage) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `:warning: ${errorMessage}` },
      });
    }
    return {
      type: 'modal',
      callback_id: 'cleaning:modal:schedule-delete',
      private_metadata: JSON.stringify({ scheduleId, ruleId, filter }),
      title: { type: 'plain_text', text: '일정 삭제' },
      submit: { type: 'plain_text', text: '삭제' },
      close: { type: 'plain_text', text: '취소' },
      blocks,
    };
  }
}
