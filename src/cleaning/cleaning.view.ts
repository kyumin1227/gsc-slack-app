import type { View } from '@slack/types';
import { StudentClass } from '../student-class/student-class.entity';
import { StudentClassStatus } from '../student-class/student-class.entity';
import { Resource } from '../resource/resource.entity';
import { formatClassLabel } from '../common/class-label.util';
import { RuleWithDetails } from './cleaning-rule.service';

type UserOption = { label: string; value: string };

// 0=일, 1=월, ..., 6=토 (JS Date.getDay() 기준)
const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

const DAY_OPTIONS = DAY_LABELS.map((label, index) => ({
  text: { type: 'plain_text' as const, text: `${label}요일` },
  value: String(index),
}));

function ruleLabel(rule: RuleWithDetails): string {
  return formatClassLabel({
    admissionYear: rule.studentClass.admissionYear,
    section: rule.studentClass.section,
    graduated: rule.studentClass.status === StudentClassStatus.GRADUATED,
  });
}

function ruleInfoText(rule: RuleWithDetails): string {
  const dayLabel = rule.daysOfWeek.map((d) => DAY_LABELS[d] ?? '?').join('/') + '요일';
  const resourceName = rule.ruleResource?.resource?.name ?? '미지정';
  return `*${ruleLabel(rule)}* | ${rule.cycle}주 주기 | ${rule.needPeoples}명 | ${dayLabel} | ${resourceName}`;
}

export class CleaningView {
  static editListModal(rules: RuleWithDetails[]): View {
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
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: '수정' },
              action_id: 'cleaning:rule:edit',
              value: String(rule.id),
            },
          },
          { type: 'divider' },
        );
      }
    }

    return {
      type: 'modal',
      callback_id: 'cleaning:modal:edit-list',
      title: { type: 'plain_text', text: '청소 규칙 수정' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  static deleteListModal(rules: RuleWithDetails[]): View {
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
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: '삭제' },
              action_id: 'cleaning:rule:delete',
              style: 'danger',
              value: String(rule.id),
            },
          },
          { type: 'divider' },
        );
      }
    }

    return {
      type: 'modal',
      callback_id: 'cleaning:modal:delete-list',
      title: { type: 'plain_text', text: '청소 규칙 삭제' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  static createModal(
    resources: Resource[],
    userOptions: UserOption[],
    classes?: StudentClass[],
    fixedClass?: { id: number; label: string },
  ): View {
    const resourceOptions = resources.map((r) => ({
      text: { type: 'plain_text' as const, text: r.name },
      value: String(r.id),
    }));

    const classBlock: View['blocks'] = fixedClass
      ? [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*반:* ${fixedClass.label}` },
          },
        ]
      : [
          {
            type: 'input',
            block_id: 'class_block',
            label: { type: 'plain_text', text: '반' },
            element: {
              type: 'static_select',
              action_id: 'class_select',
              placeholder: { type: 'plain_text', text: '반을 선택하세요' },
              options: (classes ?? []).map((c) => ({
                text: {
                  type: 'plain_text' as const,
                  text: formatClassLabel({
                    admissionYear: c.admissionYear,
                    section: c.section,
                    graduated: c.status === StudentClassStatus.GRADUATED,
                  }),
                },
                value: String(c.id),
              })),
            },
          },
        ];

    return {
      type: 'modal',
      callback_id: 'cleaning:modal:create',
      private_metadata: fixedClass ? String(fixedClass.id) : '',
      title: { type: 'plain_text', text: '청소 규칙 추가' },
      submit: { type: 'plain_text', text: '추가' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        ...classBlock,
        {
          type: 'input',
          block_id: 'cycle_block',
          label: { type: 'plain_text', text: '주기 (주)' },
          hint: {
            type: 'plain_text',
            text: '몇 주마다 청소하는지 입력하세요 (예: 2)',
          },
          element: {
            type: 'plain_text_input',
            action_id: 'cycle_input',
            placeholder: { type: 'plain_text', text: '2' },
          },
        },
        {
          type: 'input',
          block_id: 'need_peoples_block',
          label: { type: 'plain_text', text: '필요 인원 (명)' },
          element: {
            type: 'plain_text_input',
            action_id: 'need_peoples_input',
            placeholder: { type: 'plain_text', text: '2' },
          },
        },
        {
          type: 'input',
          block_id: 'day_of_week_block',
          label: { type: 'plain_text', text: '청소 요일' },
          element: {
            type: 'multi_static_select',
            action_id: 'day_of_week_select',
            placeholder: { type: 'plain_text', text: '요일을 선택하세요' },
            options: DAY_OPTIONS,
          },
        },
        {
          type: 'input',
          block_id: 'resource_block',
          label: { type: 'plain_text', text: '청소 구역' },
          element: {
            type: 'static_select',
            action_id: 'resource_select',
            placeholder: { type: 'plain_text', text: '구역을 선택하세요' },
            options: resourceOptions,
          },
        },
        {
          type: 'input',
          block_id: 'users_block',
          optional: true,
          label: { type: 'plain_text', text: '담당자' },
          element: {
            type: 'multi_static_select',
            action_id: 'users_select',
            placeholder: { type: 'plain_text', text: '담당자를 선택하세요' },
            options: userOptions.map((u) => ({
              text: { type: 'plain_text' as const, text: u.label },
              value: u.value,
            })),
          },
        },
      ],
    };
  }

  static editModal(
    rule: RuleWithDetails,
    resources: Resource[],
    currentSlackIds: string[],
    userOptions: UserOption[],
  ): View {
    const resourceOptions = resources.map((r) => ({
      text: { type: 'plain_text' as const, text: r.name },
      value: String(r.id),
    }));

    const currentResource = rule.ruleResource?.resource;

    return {
      type: 'modal',
      callback_id: 'cleaning:modal:edit',
      private_metadata: String(rule.id),
      title: { type: 'plain_text', text: '청소 규칙 수정' },
      submit: { type: 'plain_text', text: '저장' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'input',
          block_id: 'cycle_block',
          label: { type: 'plain_text', text: '주기 (주)' },
          element: {
            type: 'plain_text_input',
            action_id: 'cycle_input',
            initial_value: String(rule.cycle),
          },
        },
        {
          type: 'input',
          block_id: 'need_peoples_block',
          label: { type: 'plain_text', text: '필요 인원 (명)' },
          element: {
            type: 'plain_text_input',
            action_id: 'need_peoples_input',
            initial_value: String(rule.needPeoples),
          },
        },
        {
          type: 'input',
          block_id: 'day_of_week_block',
          label: { type: 'plain_text', text: '청소 요일' },
          element: {
            type: 'multi_static_select',
            action_id: 'day_of_week_select',
            options: DAY_OPTIONS,
            initial_options: rule.daysOfWeek.map((d) => ({
              text: { type: 'plain_text' as const, text: `${DAY_LABELS[d]}요일` },
              value: String(d),
            })),
          },
        },
        {
          type: 'input',
          block_id: 'resource_block',
          label: { type: 'plain_text', text: '청소 구역' },
          element: {
            type: 'static_select',
            action_id: 'resource_select',
            options: resourceOptions,
            ...(currentResource
              ? {
                  initial_option: {
                    text: { type: 'plain_text', text: currentResource.name },
                    value: String(currentResource.id),
                  },
                }
              : {}),
          },
        },
        {
          type: 'input',
          block_id: 'users_block',
          optional: true,
          label: { type: 'plain_text', text: '담당자' },
          element: {
            type: 'multi_static_select',
            action_id: 'users_select',
            placeholder: { type: 'plain_text', text: '담당자를 선택하세요' },
            options: userOptions.map((u) => ({
              text: { type: 'plain_text' as const, text: u.label },
              value: u.value,
            })),
            ...(currentSlackIds.length > 0
              ? {
                  initial_options: userOptions
                    .filter((u) => currentSlackIds.includes(u.value))
                    .map((u) => ({
                      text: { type: 'plain_text' as const, text: u.label },
                      value: u.value,
                    })),
                }
              : {}),
          },
        },
      ],
    };
  }

  static deleteConfirmModal(ruleId: number, label: string): View {
    return {
      type: 'modal',
      callback_id: 'cleaning:modal:delete',
      private_metadata: String(ruleId),
      title: { type: 'plain_text', text: '규칙 삭제' },
      submit: { type: 'plain_text', text: '삭제' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${label}* 청소 규칙을 삭제하시겠습니까?\n\n⚠️ 되돌릴 수 없습니다.`,
          },
        },
      ],
    };
  }
}
