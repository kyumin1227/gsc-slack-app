import type { AnyMiddlewareArgs } from '@slack/bolt';
import { Logger } from '@nestjs/common';
import { BusinessError } from './errors';
import { ErrorView } from './error.view';

const logger = new Logger('SlackErrorMiddleware');

export const slackErrorMiddleware = async (
  // next is present at runtime but not in the AnyMiddlewareArgs union type

  args: AnyMiddlewareArgs & { next: () => Promise<void> },
) => {
  const { next } = args;
  try {
    await next();
  } catch (err) {
    const body = (args as any).body;

    const client = (args as any).client;

    if (err instanceof BusinessError) {
      logger.warn(`[BusinessError] ${err.code}: ${err.message}`);
    } else {
      logger.error('[SlackError]', err);
    }

    if (!client) return;

    const triggerId: string | undefined = body?.trigger_id;
    logger.debug(
      `[ErrorModal] triggerId=${triggerId}, userId=${body && 'user' in body ? body.user?.id : body?.user_id}`,
    );
    const userId: string | undefined =
      body && 'user' in body && body.user
        ? (body.user as { id?: string }).id
        : body?.user_id;
    const blocks = ErrorView.fromError(err);
    // text는 알림 fallback용 — blocks와 함께 쓸 때 Slack이 text만 렌더링하지 않도록 분리
    const text =
      err instanceof Error ? `❌ ${err.message}` : '❌ 오류가 발생했습니다.';

    const errorView = {
      type: 'modal' as const,
      title: { type: 'plain_text' as const, text: '오류' },
      close: { type: 'plain_text' as const, text: '닫기' },
      blocks,
    };

    const viewId: string | undefined = body?.view?.id;

    // 모달이 열려 있으면 현재 뷰를 에러 모달로 교체 (ack 후 trigger_id 만료 케이스 포함)
    if (viewId) {
      const updated = await client.views
        .update({ view_id: viewId, view: errorView })
        .then(() => true)
        .catch(() => false);
      if (updated) return;
    }

    // viewId 없거나 update 실패 → trigger_id로 push/open 시도
    if (triggerId) {
      const isInsideModal = body?.view?.type === 'modal';
      const openOrPush = isInsideModal ? client.views.push : client.views.open;
      const opened = await openOrPush({
        trigger_id: triggerId,
        view: errorView,
      })
        .then(() => true)
        .catch((e: unknown) => {
          logger.warn('[ErrorModal] views failed, fallback to DM', e);
          return false;
        });
      if (opened) return;
    }

    if (userId) {
      await client.chat
        .postMessage({ channel: userId, text, blocks })
        .catch(() => {});
    }
  }
};
