import type { View } from '@slack/types';
import {
  PendingUser,
  ROLE_LABELS,
  STATUS_LABELS,
  UserListItem,
} from './user.view';

export class UserClassRepView {
  // 반대표: 자기 반 승인 대기 모달 (승인만, 거절 없음)
  static pendingApprovalModal(pendingUsers: PendingUser[]): View {
    const blocks: View['blocks'] = [];

    if (pendingUsers.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '승인 대기 중인 반원이 없습니다.' },
      });
    } else {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*승인 대기: ${pendingUsers.length}명*` },
      });
      blocks.push({ type: 'divider' });

      for (const user of pendingUsers) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `<@${user.slackId}> (${user.email})\n${user.code} | ${ROLE_LABELS[user.role]}`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '승인' },
            style: 'primary',
            action_id: `user:class-rep:approve:${user.slackId}`,
          },
        } as any);
      }
    }

    return {
      type: 'modal',
      callback_id: 'user:modal:class-rep:approval',
      title: { type: 'plain_text', text: '가입 승인' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  // 반대표: 자기 반 유저 목록 모달 (조회 전용)
  static userListModal(
    users: UserListItem[],
    pagination: { page: number; pageSize: number; total: number },
    className: string,
  ): View {
    const { page, pageSize, total } = pagination;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const blocks: View['blocks'] = [
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
        text: { type: 'mrkdwn', text: '반원이 없습니다.' },
      });
    } else {
      for (const user of users) {
        const roleLabel = user.role ? ROLE_LABELS[user.role] : '미지정';
        const statusLabel = STATUS_LABELS[user.status];
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `<@${user.slackId}>\n${roleLabel}  ·  ${statusLabel}${user.code ? `  ·  ${user.code}` : ''}`,
          },
        });
      }
    }

    blocks.push({ type: 'divider' });
    const pageElements: any[] = [];
    if (page > 0) {
      pageElements.push({
        type: 'button',
        action_id: 'user:class-rep:page-prev',
        text: { type: 'plain_text', text: '← 이전' },
        value: String(page - 1),
      });
    }
    if (page < totalPages - 1) {
      pageElements.push({
        type: 'button',
        action_id: 'user:class-rep:page-next',
        text: { type: 'plain_text', text: '다음 →' },
        value: String(page + 1),
      });
    }
    if (pageElements.length > 0) {
      blocks.push({ type: 'actions', elements: pageElements } as any);
    }

    return {
      type: 'modal',
      callback_id: 'user:modal:class-rep:list',
      private_metadata: String(page),
      title: { type: 'plain_text', text: `${className} 반원 목록` },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }
}
