import type { View } from '@slack/types';
import { UserStatus } from '../user.entity';
import { formatClassLabel } from '../../common/class-label.util';
import {
  ClassOption,
  EditUserPrefill,
  PendingUser,
  ROLE_LABELS,
  STATUS_LABELS,
  UserListFilter,
  UserListItem,
  UserListModalState,
  UserListPagination,
} from './user.view';

export class UserAdminView {
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
            text: `<@${user.slackId}> (${user.email})\n${user.code} | ${ROLE_LABELS[user.role]}${classInfo}`,
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

    const roleOptions = [
      {
        text: { type: 'plain_text' as const, text: '역할 전체' },
        value: 'all',
      },
      ...Object.values(ROLE_LABELS).map((label, i) => ({
        text: { type: 'plain_text' as const, text: label },
        value: Object.keys(ROLE_LABELS)[i],
      })),
    ];
    const statusOptions = [
      {
        text: { type: 'plain_text' as const, text: '상태 전체' },
        value: 'all',
      },
      ...Object.entries(STATUS_LABELS).map(([value, label]) => ({
        text: { type: 'plain_text' as const, text: label },
        value,
      })),
    ];
    const classFilterOptions = [
      { text: { type: 'plain_text' as const, text: '반 전체' }, value: 'all' },
      ...classOptions.map((c) => ({
        text: {
          type: 'plain_text' as const,
          text: formatClassLabel(c),
        },
        value: String(c.id),
      })),
    ];

    const blocks: View['blocks'] = [
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
            options: Object.entries(ROLE_LABELS).map(([value, label]) => ({
              text: { type: 'plain_text' as const, text: label },
              value,
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
            ...(prefill.status === UserStatus.ACTIVE ||
            prefill.status === UserStatus.INACTIVE
              ? {
                  initial_option: {
                    text: {
                      type: 'plain_text' as const,
                      text: STATUS_LABELS[prefill.status],
                    },
                    value: prefill.status,
                  },
                }
              : {}),
          },
        },
      ],
    };
  }
}
