import type { View } from '@slack/types';
import { StudentClassStatus } from './student-class.entity';

export interface StudentClassListItem {
  id: number;
  name: string;
  graduationYear: number;
  status: StudentClassStatus;
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

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${statusEmoji} *${cls.name}*\n졸업연도: ${cls.graduationYear} | 상태: ${STATUS_LABELS[cls.status]}`,
          },
          accessory: {
            type: 'button',
            text: {
              type: 'plain_text',
              text: toggleText,
            },
            action_id: `student-class:list:toggle:${cls.id}`,
            value: toggleValue,
          },
        });
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
          block_id: 'name_block',
          element: {
            type: 'plain_text_input',
            action_id: 'name_input',
            placeholder: {
              type: 'plain_text',
              text: '예: 2024-A반',
            },
          },
          label: {
            type: 'plain_text',
            text: '반 이름',
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
            text: '졸업연도',
          },
          hint: {
            type: 'plain_text',
            text: '숫자만 입력하세요 (예: 2026)',
          },
        },
      ],
    };
  }
}
