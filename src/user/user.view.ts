import type { View } from '@slack/types';
import { UserRole } from './user.entity';

export interface RegisterFormPrefill {
  name: string;
  email: string;
  refreshToken: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.PROFESSOR]: '교수',
  [UserRole.TA]: '조교',
  [UserRole.CLASS_REP]: '반대표',
  [UserRole.KEY_KEEPER]: '키지기',
  [UserRole.STUDENT]: '학생',
};

export class UserView {
  // 1단계: 구글 로그인
  static registerModal(googleAuthUrl: string): View {
    return {
      type: 'modal',
      callback_id: 'user:modal:register',
      title: {
        type: 'plain_text',
        text: '회원 가입',
      },
      close: {
        type: 'plain_text',
        text: '취소',
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Google 계정으로 로그인해주세요.*\n\n로그인 후 추가 정보를 입력할 수 있습니다.',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Google 로그인',
                emoji: true,
              },
              style: 'primary',
              url: googleAuthUrl,
              action_id: 'user:modal:google_login',
            },
          ],
        },
      ],
    };
  }

  // 2단계: 구글 로그인 후 정보 입력
  // TODO 학반 입력 추가
  static registerFormModal(prefill: RegisterFormPrefill): View {
    return {
      type: 'modal',
      callback_id: 'user:modal:submit_register',
      private_metadata: JSON.stringify({ refreshToken: prefill.refreshToken }),
      title: {
        type: 'plain_text',
        text: '회원 가입',
      },
      submit: {
        type: 'plain_text',
        text: '가입 신청',
      },
      close: {
        type: 'plain_text',
        text: '취소',
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Google 로그인 완료!\n아래 정보를 입력해주세요.',
          },
        },
        {
          type: 'input',
          block_id: 'name_block',
          element: {
            type: 'plain_text_input',
            action_id: 'name_input',
            initial_value: prefill.name,
            placeholder: {
              type: 'plain_text',
              text: '이름을 입력하세요',
            },
          },
          label: {
            type: 'plain_text',
            text: '이름',
          },
        },
        {
          type: 'input',
          block_id: 'email_block',
          element: {
            type: 'email_text_input',
            action_id: 'email_input',
            initial_value: prefill.email,
          },
          label: {
            type: 'plain_text',
            text: '이메일 (Google)',
          },
        },
        {
          type: 'input',
          block_id: 'code_block',
          element: {
            type: 'plain_text_input',
            action_id: 'code_input',
            placeholder: {
              type: 'plain_text',
              text: '학번 또는 사번을 입력하세요',
            },
          },
          label: {
            type: 'plain_text',
            text: '학번 / 사번',
          },
        },
        {
          type: 'input',
          block_id: 'role_block',
          element: {
            type: 'static_select',
            action_id: 'role_input',
            placeholder: {
              type: 'plain_text',
              text: '역할을 선택하세요',
            },
            options: Object.values(UserRole).map((role) => ({
              text: {
                type: 'plain_text' as const,
                text: ROLE_LABELS[role],
              },
              value: role,
            })),
          },
          label: {
            type: 'plain_text',
            text: '역할',
          },
        },
      ],
    };
  }
}
