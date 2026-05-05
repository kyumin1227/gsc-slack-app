import type { WebClient } from '@slack/web-api';
import type { View } from '@slack/types';

function buildResultModal(title: string, text: string): View {
  return {
    type: 'modal',
    title: { type: 'plain_text', text: title, emoji: true },
    close: { type: 'plain_text', text: '닫기' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text },
      },
    ],
  };
}

const processingModal: View = buildResultModal(
  '처리 중',
  '⏳ 처리하고 있습니다. 잠시만 기다려주세요...',
);

export async function withModalFeedback<T>(
  params: {
    ack: (response?: any) => Promise<void>;
    client: WebClient;
    viewId: string;
    userId: string;
  },
  operation: () => Promise<T>,
  handlers: {
    successTitle?: string;
    successText: (result: T) => string;
  },
): Promise<void> {
  const { ack, client, viewId, userId } = params;
  const successTitle = handlers.successTitle ?? '완료';

  await ack({ response_action: 'update', view: processingModal });

  const result = await operation();
  const text = handlers.successText(result);

  // 모달이 닫혀 있으면 DM으로 fallback
  await client.views
    .update({ view_id: viewId, view: buildResultModal(successTitle, text) })
    .catch(() => client.chat.postMessage({ channel: userId, text }));
}
