import { Controller, Logger } from '@nestjs/common';
import { Message } from 'nestjs-slack-bolt';
import type { SlackEventMiddlewareArgs } from '@slack/bolt';
import { SlackAiService } from './slack-ai.service';

@Controller()
export class SlackAiHandler {
  private readonly logger = new Logger(SlackAiHandler.name);

  constructor(private readonly slackAiService: SlackAiService) {}

  @Message(/.*/)
  async handleDm({ body, say }: SlackEventMiddlewareArgs<'message'>) {
    const event = body.event as unknown as Record<string, unknown>;

    // DM 채널만 처리
    if (event?.channel_type !== 'im') return;

    // 봇 메시지 무시 (무한 루프 방지)
    if (event?.bot_id) return;

    const slackId = event.user as string;
    const text = (event.text as string) ?? '';

    if (!slackId || !text.trim()) return;

    // 기존 키워드 핸들러가 처리하는 명령어 제외
    if (/^health$/i.test(text.trim())) return;

    try {
      const reply = await this.slackAiService.handleMessage(slackId, text);
      await say(reply);
    } catch (e) {
      this.logger.error(`[handleDm] slackId=${slackId} error=${String(e)}`, e instanceof Error ? e.stack : undefined);
      await say(
        '죄송합니다. 요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      );
    }
  }
}
