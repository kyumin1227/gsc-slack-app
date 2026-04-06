import type { KnownBlock } from '@slack/types';
import { BusinessError, ErrorCode } from './errors';

export class ErrorView {
  static blocks(code: ErrorCode | undefined, message: string): KnownBlock[] {
    return [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🚫 요청을 처리할 수 없습니다',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: code ? `*에러 코드:* \`${code}\`\n\n${message}` : message,
        },
      },
    ];
  }

  static fromError(err: unknown): KnownBlock[] {
    if (err instanceof BusinessError) {
      return ErrorView.blocks(err.code, err.message);
    }
    const message = err instanceof Error ? err.message : '오류가 발생했습니다.';
    return ErrorView.blocks(undefined, message);
  }
}
