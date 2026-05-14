import { Controller, Logger } from '@nestjs/common';
import { Message } from 'nestjs-slack-bolt';
import type { AllMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { SlackAiService } from './slack-ai.service';
import { UserService } from '../user/service/user.service';

function toSlackMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '*$1*') // **bold** → *bold*
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*') // # heading → *heading*
    .replace(/^- /gm, '• '); // - list → • list
}

const HOME_GUIDE_IMAGE_URL =
  'https://gsc-slack-app-045861054142-ap-northeast-2-an.s3.ap-northeast-2.amazonaws.com/assets/images/home-tab-guide.png';
const USER_GUIDE_URL =
  'https://www.kyumin.dev/ko/posts/bannote-slack/user-guide';

@Controller()
export class SlackAiHandler {
  private readonly logger = new Logger(SlackAiHandler.name);

  constructor(
    private readonly slackAiService: SlackAiService,
    private readonly userService: UserService,
  ) {}

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

    const user = await this.userService.findBySlackId(slackId);
    if (!user) {
      const adminSlackId = process.env.ADMIN_SLACK_ID;
      const blocks: KnownBlock[] = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '안녕하세요! 저는 GSC의 어시스턴트 *Bannote Bot* 이에요, 우선 회원가입이 필요해요 😊\n아래 *가입하기* 버튼을 눌러 회원가입 후 언제든지 편하게 말을 걸어 주세요! 자세한 설명은 유저 가이드를 참고해 주세요.',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '가입하기' },
              action_id: 'user:home:open_register_modal',
              style: 'primary',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '유저 가이드' },
              action_id: 'slack-ai:unregistered:user-guide:open-url',
              url: USER_GUIDE_URL,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '상단의 *홈* 탭(아래 사진 참고)에서 더 많은 기능을 이용할 수 있어요‼️',
          },
        },
        {
          type: 'image',
          image_url: HOME_GUIDE_IMAGE_URL,
          alt_text: '슬랙 홈 탭 위치 안내',
        },
      ];

      if (adminSlackId) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🚨 문의 사항은 <@${adminSlackId}>에게 연락 해주세요`,
          },
        });
      }

      await say({
        text: '서비스를 이용하려면 먼저 회원가입을 진행해 주세요.',
        blocks,
      });
      return;
    }

    // 기존 키워드 핸들러가 처리하는 명령어 제외
    if (/^health$/i.test(text.trim())) return;

    if (await this.slackAiService.isProcessing(slackId)) {
      await say('⏳ 이전 답변을 생성하고 있어요! 잠시만 기다려 주세요 😊');
      return;
    }

    const channel = event.channel as string;
    const loadingMsg = await say('🤔 생각 중...');

    await this.slackAiService.setProcessing(slackId);
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
    } finally {
      await this.slackAiService.clearProcessing(slackId);
    }
  }
}
