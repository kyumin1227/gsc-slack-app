import { Controller, Logger } from '@nestjs/common';
import { Message } from 'nestjs-slack-bolt';
import type { AllMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';
import { SlackAiService } from './slack-ai.service';

function toSlackMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '*$1*') // **bold** → *bold*
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*') // # heading → *heading*
    .replace(/^- /gm, '• '); // - list → • list
}

@Controller()
export class SlackAiHandler {
  private readonly logger = new Logger(SlackAiHandler.name);

  constructor(private readonly slackAiService: SlackAiService) {}

  @Message(/.*/)
  async handleDm({
    body,
    say,
    client,
  }: SlackEventMiddlewareArgs<'message'> & AllMiddlewareArgs) {
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

    const channel = event.channel as string;
    const loadingMsg = await say('🤔 생각 중...');

    try {
      const reply = await this.slackAiService.handleMessage(
        slackId,
        text,
        async (msg) => {
          await client.chat.update({
            channel,
            ts: loadingMsg.ts as string,
            text: msg,
          });
        },
      );
      await client.chat.update({
        channel,
        ts: loadingMsg.ts as string,
        text: reply,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: toSlackMrkdwn(reply) },
          },
        ],
      });
    } catch (e) {
      this.logger.error(
        `[handleDm] slackId=${slackId} error=${String(e)}`,
        e instanceof Error ? e.stack : undefined,
      );
      await client.chat.update({
        channel,
        ts: loadingMsg.ts as string,
        text: '죄송합니다. 요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
  }
}
