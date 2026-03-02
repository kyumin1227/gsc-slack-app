import type { View } from '@slack/types';
import { TagStatus } from './tag.entity';

export interface TagListItem {
  id: number;
  name: string;
  status: TagStatus;
  isClassTag: boolean; // 반에서 자동 생성된 태그 여부
}

const STATUS_LABELS: Record<TagStatus, string> = {
  [TagStatus.ACTIVE]: '활성',
  [TagStatus.INACTIVE]: '비활성',
};

export class TagView {
  // 태그 목록 모달
  static listModal(tags: TagListItem[]): View {
    const blocks: View['blocks'] = [];

    if (tags.length === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '등록된 태그가 없습니다.',
        },
      });
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*등록된 태그: ${tags.length}개*`,
        },
      });

      blocks.push({ type: 'divider' });

      for (const tag of tags) {
        const statusEmoji = tag.status === TagStatus.ACTIVE ? '🟢' : '⚪';
        const toggleText =
          tag.status === TagStatus.ACTIVE ? '비활성화' : '활성화';
        const toggleValue =
          tag.status === TagStatus.ACTIVE ? 'deactivate' : 'activate';
        const typeLabel = tag.isClassTag ? '(반)' : '';

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${statusEmoji} *${tag.name}* ${typeLabel}\n상태: ${STATUS_LABELS[tag.status]}`,
          },
          accessory: {
            type: 'button',
            text: {
              type: 'plain_text',
              text: toggleText,
            },
            action_id: `tag:list:toggle:${tag.id}`,
            value: toggleValue,
          },
        });
      }
    }

    return {
      type: 'modal',
      callback_id: 'tag:modal:list',
      title: {
        type: 'plain_text',
        text: '태그 관리',
      },
      close: {
        type: 'plain_text',
        text: '닫기',
      },
      blocks,
    };
  }

  // 태그 생성 모달
  static createModal(): View {
    return {
      type: 'modal',
      callback_id: 'tag:modal:create',
      title: {
        type: 'plain_text',
        text: '태그 생성',
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
              text: '예: 전공, 일본어, 특강',
            },
          },
          label: {
            type: 'plain_text',
            text: '태그 이름',
          },
        },
      ],
    };
  }
}
