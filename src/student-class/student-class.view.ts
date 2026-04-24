import type { View } from '@slack/types';
import { StudentClassStatus } from './student-class.entity';
import { formatClassLabel } from '../common/class-label.util';

export interface StudentClassEditPrefill {
  id: number;
  name: string;
  graduationYear: number;
  slackChannelId?: string | null;
}

export interface StudentClassListItem {
  id: number;
  name: string;
  section: string;
  admissionYear: number;
  graduationYear: number;
  status: StudentClassStatus;
  slackChannelId?: string;
}

const STATUS_LABELS: Record<StudentClassStatus, string> = {
  [StudentClassStatus.ACTIVE]: '활성',
  [StudentClassStatus.GRADUATED]: '졸업',
};

export class StudentClassView {
  // 반 목록 모달
  static listModal(classes: StudentClassListItem[]): View {
    const blocks: View['blocks'] = [];

    if (classes.length === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '등록된 반이 없습니다.',
        },
      });
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*등록된 반: ${classes.length}개*`,
        },
      });

      blocks.push({ type: 'divider' });

      for (const cls of classes) {
        const statusEmoji =
          cls.status === StudentClassStatus.ACTIVE ? '🟢' : '⚪';
        const toggleText =
          cls.status === StudentClassStatus.ACTIVE ? '졸업 처리' : '활성화';
        const toggleValue =
          cls.status === StudentClassStatus.ACTIVE ? 'graduate' : 'activate';

        const gradeLabel = formatClassLabel({
          admissionYear: cls.admissionYear,
          section: cls.section,
          graduated: cls.status === StudentClassStatus.GRADUATED,
        });
        const channelInfo = cls.slackChannelId
          ? ` | 채널: <#${cls.slackChannelId}>`
          : '';

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${statusEmoji} *${gradeLabel}*\n졸업 연도: ${cls.graduationYear} | 상태: ${STATUS_LABELS[cls.status]}${channelInfo}`,
          },
          accessory: {
            type: 'overflow',
            action_id: 'student-class:list:overflow',
            options: [
              {
                text: { type: 'plain_text', text: '✏️ 편집' },
                value: `edit:${cls.id}`,
              },
              {
                text: { type: 'plain_text', text: toggleText },
                value: `${toggleValue}:${cls.id}`,
              },
              {
                text: { type: 'plain_text', text: '🗑️ 삭제' },
                value: `delete:${cls.id}`,
              },
            ],
          },
        } as any);
      }
    }

    return {
      type: 'modal',
      callback_id: 'student-class:modal:list',
      title: {
        type: 'plain_text',
        text: '반 관리',
      },
      close: {
        type: 'plain_text',
        text: '닫기',
      },
      blocks,
    };
  }

  // 반 편집 모달
  static editModal(prefill: StudentClassEditPrefill): View {
    return {
      type: 'modal',
      callback_id: 'student-class:modal:edit',
      private_metadata: JSON.stringify({ classId: prefill.id }),
      title: { type: 'plain_text', text: '반 편집' },
      submit: { type: 'plain_text', text: '저장' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${prefill.name}*` },
        },
        {
          type: 'input',
          block_id: 'graduation_year_block',
          label: { type: 'plain_text', text: '졸업 연도' },
          element: {
            type: 'plain_text_input',
            action_id: 'graduation_year_input',
            initial_value: String(prefill.graduationYear),
            placeholder: { type: 'plain_text', text: '숫자만 입력 (예: 2027)' },
          },
          hint: { type: 'plain_text', text: '숫자만 입력하세요 (예: 2027)' },
        },
        {
          type: 'input',
          block_id: 'slack_channel_block',
          label: { type: 'plain_text', text: 'Slack 채널' },
          optional: true,
          element: {
            type: 'conversations_select',
            action_id: 'slack_channel_input',
            placeholder: { type: 'plain_text', text: '채널을 선택하세요' },
            filter: { include: ['public'], exclude_bot_users: true },
            ...(prefill.slackChannelId
              ? { initial_conversation: prefill.slackChannelId }
              : {}),
          },
        },
      ],
    };
  }

  // 반 생성 모달
  static createModal(): View {
    const currentYear = new Date().getFullYear();

    return {
      type: 'modal',
      callback_id: 'student-class:modal:create',
      title: {
        type: 'plain_text',
        text: '반 생성',
      },
      submit: {
        type: 'plain_text',
        text: '생성',
      },
      close: {
        type: 'plain_text',
        text: '취소',
      },
      blocks: [
        {
          type: 'input',
          block_id: 'admission_year_block',
          element: {
            type: 'plain_text_input',
            action_id: 'admission_year_input',
            initial_value: String(currentYear),
            placeholder: {
              type: 'plain_text',
              text: String(currentYear),
            },
          },
          label: {
            type: 'plain_text',
            text: '입학 연도',
          },
          hint: {
            type: 'plain_text',
            text: '숫자만 입력하세요 (예: 2024)',
          },
        },
        {
          type: 'input',
          block_id: 'section_block',
          element: {
            type: 'static_select',
            action_id: 'section_select',
            placeholder: {
              type: 'plain_text',
              text: '반 선택',
            },
            options: [
              {
                text: { type: 'plain_text', text: 'A반' },
                value: 'A',
              },
              {
                text: { type: 'plain_text', text: 'B반' },
                value: 'B',
              },
            ],
          },
          label: {
            type: 'plain_text',
            text: '반 구분',
          },
        },
        {
          type: 'input',
          block_id: 'graduation_year_block',
          element: {
            type: 'plain_text_input',
            action_id: 'graduation_year_input',
            initial_value: String(currentYear + 3),
            placeholder: {
              type: 'plain_text',
              text: '졸업 예정 연도',
            },
          },
          label: {
            type: 'plain_text',
            text: '졸업 연도',
          },
          hint: {
            type: 'plain_text',
            text: '숫자만 입력하세요 (예: 2027)',
          },
        },
      ],
    };
  }

  static deleteConfirmModal(classId: number, className: string): View {
    return {
      type: 'modal',
      callback_id: 'student-class:modal:delete',
      private_metadata: String(classId),
      title: { type: 'plain_text', text: '반 삭제' },
      submit: { type: 'plain_text', text: '삭제' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${className}* 반을 삭제하시겠습니까?\n\n⚠️ 연결된 태그도 함께 삭제되며 되돌릴 수 없습니다.`,
          },
        },
      ],
    };
  }
}
