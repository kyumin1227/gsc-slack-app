import type { View } from '@slack/types';
import { UserRole, UserStatus } from './user.entity';

export interface ClassOption {
  id: number;
  name: string;
  admissionYear: number;
  section: string;
}

export interface RegisterFormPrefill {
  name: string;
  email: string;
  refreshToken: string;
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

export interface MyInfoPrefill {
  name: string;
  code: string | null;
  role: UserRole | null;
  status: UserStatus;
  studentClassId?: number | null;
  classes: ClassOption[];
}

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
                    const grade =
                      new Date().getFullYear() - cls.admissionYear + 1;
                    return {
                      text: {
                        type: 'plain_text' as const,
                        text: `${grade}학년 ${cls.section}반`,
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

  // 관리자: 승인 대기 목록 모달
  static pendingApprovalModal(pendingUsers: PendingUser[]): View {
    const blocks: View['blocks'] = [];

    if (pendingUsers.length === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '승인 대기 중인 사용자가 없습니다.',
        },
      });
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*승인 대기 중인 사용자: ${pendingUsers.length}명*`,
        },
      });

      blocks.push({ type: 'divider' });

      for (const user of pendingUsers) {
        const classInfo = user.className ? ` | ${user.className}` : '';
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${user.name}* (${user.email})\n${user.code} | ${ROLE_LABELS[user.role]}${classInfo}`,
          },
          accessory: {
            type: 'overflow',
            action_id: `user:admin:overflow:${user.slackId}`,
            options: [
              {
                text: { type: 'plain_text', text: '승인' },
                value: `approve:${user.slackId}`,
              },
              {
                text: { type: 'plain_text', text: '거절' },
                value: `reject:${user.slackId}`,
              },
            ],
          },
        });
      }
    }

    return {
      type: 'modal',
      callback_id: 'user:modal:admin_approval',
      title: {
        type: 'plain_text',
        text: '가입 승인 관리',
      },
      close: {
        type: 'plain_text',
        text: '닫기',
      },
      blocks,
    };
  }

  // 관리자: 전체 유저 목록 모달 (필터 + 페이지네이션)
  static userListModal(
    users: UserListItem[],
    pagination: UserListPagination,
    filter: UserListFilter,
    classOptions: ClassOption[],
  ): View {
    const { page, pageSize, total } = pagination;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const state: UserListModalState = { filter, page };

    // 필터 옵션 — '전체' 포함
    const roleOptions = [
      {
        text: { type: 'plain_text' as const, text: '역할 전체' },
        value: 'all',
      },
      ...Object.values(UserRole).map((r) => ({
        text: { type: 'plain_text' as const, text: ROLE_LABELS[r] },
        value: r,
      })),
    ];
    const statusOptions = [
      {
        text: { type: 'plain_text' as const, text: '상태 전체' },
        value: 'all',
      },
      ...Object.values(UserStatus).map((s) => ({
        text: { type: 'plain_text' as const, text: STATUS_LABELS[s] },
        value: s,
      })),
    ];
    const classFilterOptions = [
      { text: { type: 'plain_text' as const, text: '반 전체' }, value: 'all' },
      ...classOptions.map((c) => {
        const grade = new Date().getFullYear() - c.admissionYear + 1;
        return {
          text: {
            type: 'plain_text' as const,
            text: `${grade}학년 ${c.section}반`,
          },
          value: String(c.id),
        };
      }),
    ];

    const blocks: View['blocks'] = [
      // 필터 행
      {
        type: 'actions',
        block_id: 'filter_block',
        elements: [
          {
            type: 'static_select',
            action_id: 'user:admin:filter-role',
            placeholder: { type: 'plain_text', text: '역할 전체' },
            options: roleOptions,
            ...(filter.role
              ? {
                  initial_option: roleOptions.find(
                    (o) => o.value === filter.role,
                  ),
                }
              : {}),
          },
          {
            type: 'static_select',
            action_id: 'user:admin:filter-status',
            placeholder: { type: 'plain_text', text: '상태 전체' },
            options: statusOptions,
            ...(filter.status
              ? {
                  initial_option: statusOptions.find(
                    (o) => o.value === filter.status,
                  ),
                }
              : {}),
          },
          {
            type: 'static_select',
            action_id: 'user:admin:filter-class',
            placeholder: { type: 'plain_text', text: '반 전체' },
            options: classFilterOptions,
            ...(filter.studentClassId
              ? {
                  initial_option: classFilterOptions.find(
                    (o) => o.value === String(filter.studentClassId),
                  ),
                }
              : {}),
          },
        ],
      } as any,
      // 결과 요약
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `총 *${total}명*  ·  ${page + 1} / ${totalPages} 페이지`,
          },
        ],
      },
      { type: 'divider' },
    ];

    // 유저 목록
    if (users.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '조건에 맞는 회원이 없습니다.' },
      });
    } else {
      for (const user of users) {
        const roleLabel = user.role ? ROLE_LABELS[user.role] : '미지정';
        const statusLabel = STATUS_LABELS[user.status];
        const parts = [roleLabel, statusLabel];
        if (user.code) parts.push(user.code);
        if (user.className) parts.push(user.className);

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `<@${user.slackId}>\n${parts.join('  ·  ')}`,
          },
          accessory: {
            type: 'overflow',
            action_id: 'user:admin:user-overflow',
            options: [
              {
                text: { type: 'plain_text', text: '✏️ 편집' },
                value: `edit:${user.slackId}`,
              },
            ],
          },
        } as any);
      }
    }

    // 페이지네이션 버튼
    blocks.push({ type: 'divider' });
    const pageElements: any[] = [];
    if (page > 0) {
      pageElements.push({
        type: 'button',
        action_id: 'user:admin:page-prev',
        text: { type: 'plain_text', text: '← 이전' },
        value: String(page - 1),
      });
    }
    if (page < totalPages - 1) {
      pageElements.push({
        type: 'button',
        action_id: 'user:admin:page-next',
        text: { type: 'plain_text', text: '다음 →' },
        value: String(page + 1),
      });
    }
    if (pageElements.length > 0) {
      blocks.push({ type: 'actions', elements: pageElements } as any);
    }

    return {
      type: 'modal',
      callback_id: 'user:modal:list',
      private_metadata: JSON.stringify(state),
      title: { type: 'plain_text', text: '유저 관리' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  // 관리자: 특정 유저 정보 편집 모달
  static editUserModal(prefill: EditUserPrefill): View {
    const classOptions =
      prefill.classes.length > 0
        ? prefill.classes.map((cls) => {
            const grade = new Date().getFullYear() - cls.admissionYear + 1;
            return {
              text: {
                type: 'plain_text' as const,
                text: `${grade}학년 ${cls.section}반`,
              },
              value: String(cls.id),
            };
          })
        : [
            {
              text: { type: 'plain_text' as const, text: '등록된 반 없음' },
              value: 'none',
            },
          ];

    const initialClass = prefill.studentClassId
      ? classOptions.find((o) => o.value === String(prefill.studentClassId))
      : undefined;

    return {
      type: 'modal',
      callback_id: 'user:modal:edit',
      private_metadata: JSON.stringify({
        targetSlackId: prefill.targetSlackId,
      }),
      title: { type: 'plain_text', text: '회원 정보 수정' },
      submit: { type: 'plain_text', text: '저장' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'input',
          block_id: 'name_block',
          label: { type: 'plain_text', text: '이름' },
          element: {
            type: 'plain_text_input',
            action_id: 'name_input',
            initial_value: prefill.name,
          },
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
          block_id: 'role_block',
          label: { type: 'plain_text', text: '역할' },
          element: {
            type: 'static_select',
            action_id: 'role_input',
            options: Object.values(UserRole).map((role) => ({
              text: { type: 'plain_text' as const, text: ROLE_LABELS[role] },
              value: role,
            })),
            ...(prefill.role
              ? {
                  initial_option: {
                    text: {
                      type: 'plain_text' as const,
                      text: ROLE_LABELS[prefill.role],
                    },
                    value: prefill.role,
                  },
                }
              : {}),
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
              text: '반 선택 (학생/키지기/반대표)',
            },
            options: classOptions,
            ...(initialClass ? { initial_option: initialClass } : {}),
          },
        },
        {
          type: 'input',
          block_id: 'status_block',
          label: { type: 'plain_text', text: '상태' },
          element: {
            type: 'static_select',
            action_id: 'status_input',
            options: [UserStatus.ACTIVE, UserStatus.INACTIVE].map((s) => ({
              text: { type: 'plain_text' as const, text: STATUS_LABELS[s] },
              value: s,
            })),
            initial_option: {
              text: {
                type: 'plain_text' as const,
                text: STATUS_LABELS[prefill.status],
              },
              value: prefill.status,
            },
          },
        },
      ],
    };
  }

  // 일반 유저: 내 정보 수정 모달
  static myInfoModal(prefill: MyInfoPrefill): View {
    const classOptions =
      prefill.classes.length > 0
        ? prefill.classes.map((cls) => {
            const grade = new Date().getFullYear() - cls.admissionYear + 1;
            return {
              text: {
                type: 'plain_text' as const,
                text: `${grade}학년 ${cls.section}반`,
              },
              value: String(cls.id),
            };
          })
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
          type: 'input',
          block_id: 'name_block',
          label: { type: 'plain_text', text: '이름' },
          element: {
            type: 'plain_text_input',
            action_id: 'name_input',
            initial_value: prefill.name,
          },
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
