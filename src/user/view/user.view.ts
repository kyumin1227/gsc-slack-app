import type { View } from '@slack/types';
import { UserRole, UserStatus } from '../user.entity';
import { formatClassLabel } from '../../common/class-label.util';

export interface ClassOption {
  id: number;
  name: string;
  admissionYear: number;
  section: string;
}

export interface RegisterFormPrefill {
  email: string;
  refreshToken: string;
  classes: ClassOption[];
}

export interface MyInfoPrefill {
  code: string | null;
  role: UserRole | null;
  status: UserStatus;
  studentClassId?: number | null;
  classes: ClassOption[];
}

export interface PendingUser {
  slackId: string;
  name: string;
  email: string;
  code: string;
  role: UserRole;
  className?: string;
}

export interface UserListItem {
  slackId: string;
  name: string;
  code: string | null;
  role: UserRole | null;
  status: UserStatus;
  className?: string | null;
}

export interface UserListFilter {
  role?: UserRole;
  status?: UserStatus;
  studentClassId?: number;
}

export interface UserListPagination {
  page: number; // 0-based
  pageSize: number;
  total: number;
}

export interface UserListModalState {
  filter: UserListFilter;
  page: number;
}

export interface EditUserPrefill {
  targetSlackId: string;
  name: string;
  code: string | null;
  role: UserRole | null;
  status: UserStatus;
  studentClassId?: number | null;
  classes: ClassOption[];
}

export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.PROFESSOR]: '교수',
  [UserRole.TA]: '조교',
  [UserRole.CLASS_REP]: '반대표',
  [UserRole.KEY_KEEPER]: '키지기',
  [UserRole.STUDENT]: '학생',
};

export const STATUS_LABELS: Record<UserStatus, string> = {
  [UserStatus.REGISTERED]: '미가입',
  [UserStatus.PENDING_APPROVAL]: '승인 대기',
  [UserStatus.ACTIVE]: '활성',
  [UserStatus.INACTIVE]: '비활성',
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
            text: 'Google 로그인 완료!\n아래 정보를 입력해주세요.\n이름은 Slack 프로필 이름으로 자동 설정됩니다.',
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
          hint: {
            type: 'plain_text',
            text: '학생 이외의 역할은 가입 신청 후 관리자(교수|조교)의 승인이 필요합니다.',
          },
        },
        {
          type: 'input',
          block_id: 'class_block',
          optional: true,
          element: {
            type: 'static_select',
            action_id: 'class_input',
            placeholder: {
              type: 'plain_text',
              text: '반을 선택하세요',
            },
            options:
              prefill.classes.length > 0
                ? prefill.classes.map((cls) => {
                    return {
                      text: {
                        type: 'plain_text' as const,
                        text: formatClassLabel(cls),
                      },
                      value: String(cls.id),
                    };
                  })
                : [
                    {
                      text: {
                        type: 'plain_text' as const,
                        text: '등록된 반 없음',
                      },
                      value: 'none',
                    },
                  ],
          },
          label: {
            type: 'plain_text',
            text: '반',
          },
          hint: {
            type: 'plain_text',
            text: "학생/키지기/반대표만 선택 (예: 2024년 입학의 경우 '2024-A반' 선택)",
          },
        },
      ],
    };
  }

  // 일반 유저: 내 정보 수정 모달
  static myInfoModal(prefill: MyInfoPrefill): View {
    const classOptions =
      prefill.classes.length > 0
        ? prefill.classes.map((cls) => ({
            text: {
              type: 'plain_text' as const,
              text: formatClassLabel(cls),
            },
            value: String(cls.id),
          }))
        : [
            {
              text: { type: 'plain_text' as const, text: '등록된 반 없음' },
              value: 'none',
            },
          ];

    const initialClass = prefill.studentClassId
      ? classOptions.find((o) => o.value === String(prefill.studentClassId))
      : undefined;

    const roleLabel = prefill.role ? ROLE_LABELS[prefill.role] : '미지정';
    const statusLabel = STATUS_LABELS[prefill.status];

    return {
      type: 'modal',
      callback_id: 'user:modal:my-info',
      title: { type: 'plain_text', text: '내 정보 수정' },
      submit: { type: 'plain_text', text: '저장' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `역할: *${roleLabel}*  |  상태: *${statusLabel}*`,
            },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '이름은 Slack 프로필과 자동으로 동기화됩니다.',
            },
          ],
        },
        {
          type: 'input',
          block_id: 'code_block',
          label: { type: 'plain_text', text: '학번 / 사번' },
          element: {
            type: 'plain_text_input',
            action_id: 'code_input',
            ...(prefill.code ? { initial_value: prefill.code } : {}),
            placeholder: { type: 'plain_text', text: '학번 또는 사번' },
          },
        },
        {
          type: 'input',
          block_id: 'class_block',
          label: { type: 'plain_text', text: '반' },
          optional: true,
          element: {
            type: 'static_select',
            action_id: 'class_input',
            placeholder: {
              type: 'plain_text',
              text: '반 선택',
            },
            options: classOptions,
            ...(initialClass ? { initial_option: initialClass } : {}),
          },
        },
      ],
    };
  }
}
