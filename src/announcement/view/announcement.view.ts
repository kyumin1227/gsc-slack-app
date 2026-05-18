import type { View, KnownBlock } from '@slack/types';
import type { Channel } from '@slack/web-api/dist/types/response/ConversationsListResponse';
import type { Announcement } from '../announcement.entity';

export class AnnouncementView {
  /** 공지 목록 모달 */
  static listModal(announcements: Announcement[]): View {
    const announcementBlocks: KnownBlock[] =
      announcements.length === 0
        ? [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '아직 등록된 공지가 없습니다.',
              },
            },
          ]
        : announcements.flatMap<KnownBlock>((a) => [
            { type: 'divider' },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: [
                  `*${a.title}*`,
                  `채널: <#${a.channelId}>`,
                  `작성자: ${a.author?.slackId ? `<@${a.author.slackId}>` : (a.author?.name ?? '알 수 없음')}  |  ${formatDate(a.createdAt)}`,
                ].join('\n'),
              },
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: '수정' },
                  action_id: 'announcement:edit:open-modal',
                  value: String(a.id),
                },
                {
                  type: 'button',
                  text: { type: 'plain_text', text: '삭제' },
                  action_id: 'announcement:delete',
                  style: 'danger',
                  value: String(a.id),
                  confirm: {
                    title: { type: 'plain_text', text: '공지 삭제' },
                    text: { type: 'mrkdwn', text: '정말 삭제하시겠습니까?\n채널의 원본 메시지도 함께 삭제됩니다.' },
                    confirm: { type: 'plain_text', text: '삭제' },
                    deny: { type: 'plain_text', text: '취소' },
                    style: 'danger',
                  },
                },
              ],
            },
          ]);

    return {
      type: 'modal',
      callback_id: 'announcement:modal:list',
      title: { type: 'plain_text', text: '공지 목록' },
      close: { type: 'plain_text', text: '닫기' },
      blocks: [...announcementBlocks],
    };
  }

  /** 공지 작성 모달 — channels: 봇이 참여 중인 채널 목록 */
  static createModal(channels: Channel[]): View {
    const options = channels.map((ch) => ({
      text: { type: 'plain_text' as const, text: `# ${ch.name ?? ch.id}` },
      value: ch.id ?? '',
    }));

    return {
      type: 'modal',
      callback_id: 'announcement:modal:create',
      title: { type: 'plain_text', text: '공지 작성' },
      submit: { type: 'plain_text', text: '발송' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'input',
          block_id: 'channel_block',
          label: { type: 'plain_text', text: '채널 선택' },
          element: {
            type: 'static_select',
            action_id: 'channel_input',
            placeholder: { type: 'plain_text', text: '채널을 선택하세요' },
            options,
          },
        },
        {
          type: 'input',
          block_id: 'title_block',
          label: { type: 'plain_text', text: '공지 제목' },
          element: {
            type: 'plain_text_input',
            action_id: 'title_input',
            placeholder: { type: 'plain_text', text: '공지 제목을 입력하세요' },
            max_length: 100,
          },
        },
        {
          type: 'input',
          block_id: 'content_block',
          label: { type: 'plain_text', text: '공지 내용' },
          hint: {
            type: 'plain_text',
            text: '@멘션, 굵게(Ctrl+B), 기울임(Ctrl+I), 코드블록 등을 사용할 수 있어요.',
          },
          element: {
            type: 'rich_text_input',
            action_id: 'content_input',
          } as unknown as import('@slack/types').RichTextInput,
        },
      ],
    };
  }

  /** 공지 수정 모달 */
  static editModal(announcement: Announcement): View {
    return {
      type: 'modal',
      callback_id: 'announcement:modal:edit',
      private_metadata: String(announcement.id),
      title: { type: 'plain_text', text: '공지 수정' },
      submit: { type: 'plain_text', text: '수정' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `채널: <#${announcement.channelId}>`,
          },
        },
        {
          type: 'input',
          block_id: 'title_block',
          label: { type: 'plain_text', text: '공지 제목' },
          element: {
            type: 'plain_text_input',
            action_id: 'title_input',
            initial_value: announcement.title,
            max_length: 100,
          },
        },
        {
          type: 'input',
          block_id: 'content_block',
          label: { type: 'plain_text', text: '공지 내용' },
          hint: {
            type: 'plain_text',
            text: '@멘션, 굵게(Ctrl+B), 기울임(Ctrl+I), 코드블록 등을 사용할 수 있어요.',
          },
          element: {
            type: 'rich_text_input',
            action_id: 'content_input',
            initial_value: parseContentJson(announcement.content),
          } as unknown as import('@slack/types').RichTextInput,
        },
      ],
    };
  }

  /** 채널에 발송되는 공지 메시지 블록 */
  static announcementMessage(
    title: string,
    richTextBlock: KnownBlock,
  ): { text: string; blocks: KnownBlock[] } {
    return {
      text: `[공지] ${title}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `📢 ${title}`, emoji: true },
        },
        { type: 'divider' },
        richTextBlock,
      ],
    };
  }

  /** Home 탭 공지 관리 섹션 (admin 전용) */
  static homeSection(): KnownBlock[] {
    return [
      { type: 'divider' },
      {
        type: 'header',
        text: { type: 'plain_text', text: '📢 공지 관리', emoji: true },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '봇을 통해 채널에 공식 공지를 발송하거나 기존 공지를 수정할 수 있어요.',
          },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '공지 목록 보기' },
            action_id: 'announcement:list:open-modal',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '공지 작성' },
            style: 'primary',
            action_id: 'announcement:create:open-modal',
          },
        ],
      },
    ];
  }
}

/** DB에 저장된 rich_text JSON을 파싱. 파싱 실패 시 빈 rich_text 블록 반환 */
function parseContentJson(json: string): object {
  try {
    return JSON.parse(json);
  } catch {
    return { type: 'rich_text', elements: [] };
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
