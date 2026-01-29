import type { View } from '@slack/types';

export class HomeView {
  static registration(userId?: string): View {
    return {
      type: 'home',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*회원 가입이 필요합니다* 🔐',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '가입하기',
                emoji: true,
              },
              style: 'primary',
              action_id: 'user:home:open_register_modal',
            },
          ],
        },
      ],
    };
  }

  static registered(userId?: string): View {
    return {
      type: 'home',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*가입 되었습니다* ✅',
          },
        },
      ],
    };
  }

  static error(): View {
    return {
      type: 'home',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*오류가 발생했습니다* ❌\n잠시 후 다시 시도해주세요.',
          },
        },
      ],
    };
  }
}
