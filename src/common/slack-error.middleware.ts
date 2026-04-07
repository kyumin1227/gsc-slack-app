import type { AnyMiddlewareArgs } from '@slack/bolt';
import { Logger } from '@nestjs/common';
import { BusinessError } from './errors';
import { ErrorView } from './error.view';

const logger = new Logger('SlackErrorMiddleware');

export const slackErrorMiddleware = async (
  // next is present at runtime but not in the AnyMiddlewareArgs union type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: AnyMiddlewareArgs & { next: () => Promise<void> },
) => {
  const { next } = args;
  try {
    await next();
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (args as any).body;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = (args as any).client;

    if (err instanceof BusinessError) {
      logger.warn(`[BusinessError] ${err.code}: ${err.message}`);
    } else {
      logger.error('[SlackError]', err);
    }

    if (!client) return;

    const userId: string | undefined =
      body && 'user' in body && body.user
        ? (body.user as { id?: string }).id
        : body?.user_id;
    const channelId: string | undefined = body?.channel_id ?? body?.channel?.id;
    const blocks = ErrorView.fromError(err);
    // text는 알림 fallback용 — blocks와 함께 쓸 때 Slack이 text만 렌더링하지 않도록 분리
    const text =
      err instanceof Error ? `❌ ${err.message}` : '❌ 오류가 발생했습니다.';

    if (channelId && userId) {
      await client.chat
        .postEphemeral({ channel: channelId, user: userId, text, blocks })
        .catch(() => {});
    } else if (userId) {
      await client.chat
        .postMessage({ channel: userId, text, blocks })
        .catch(() => {});
    }
  }
};
