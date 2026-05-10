import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ToolsService } from '../tools/tools.service';
import { UserService } from '../user/service/user.service';

const MODEL = 'claude-haiku-4-5-20251001';
const HISTORY_TTL_MS = 60 * 60 * 1000; // 1시간
const MAX_HISTORY_MESSAGES = 20; // 최근 10턴

const buildSystemPrompt = (userName: string | null) => {
  const now = new Date().toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  return `당신은 GSC 스터디룸 예약 관리 어시스턴트입니다.
${userName ? `현재 대화 중인 사용자의 이름은 "${userName}"입니다.` : ''}
현재 날짜: ${now}
사용자의 요청에 맞는 툴을 호출하고, 결과를 친절하고 간결하게 한국어로 안내하세요.
모든 날짜와 시간은 한국 표준시(KST, UTC+9) 기준으로 해석하고 표시하세요.
날짜와 시간 표시 형식은 "2025년 5월 10일 오후 2시" 형식을 사용하세요.
calendarId, eventId 등 내부 식별자는 절대 사용자에게 노출하지 마세요. 
예약을 찾을 수 없거나 수정·취소 권한이 없는 경우 "해당 예약에 대한 권한이 없습니다" 형식으로 안내하세요.`;
};

@Injectable()
export class SlackAiService {
  private readonly logger = new Logger(SlackAiService.name);
  private readonly anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  constructor(
    private readonly toolsService: ToolsService,
    private readonly userService: UserService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  private historyKey(slackId: string): string {
    return `slack-ai:history:${slackId}`;
  }

  private async loadHistory(
    slackId: string,
  ): Promise<Anthropic.MessageParam[]> {
    const history =
      (await this.cache.get<Anthropic.MessageParam[]>(
        this.historyKey(slackId),
      )) ?? [];
    const sliced = history.slice(-MAX_HISTORY_MESSAGES);
    // 슬라이스로 tool_use/tool_result 쌍이 끊기면 첫 번째 일반 user 텍스트 메시지부터 시작하도록 앞부분을 제거
    const firstCleanIdx = sliced.findIndex(
      (m) => m.role === 'user' && typeof m.content === 'string',
    );
    return firstCleanIdx > 0 ? sliced.slice(firstCleanIdx) : sliced;
  }

  private async saveHistory(
    slackId: string,
    messages: Anthropic.MessageParam[],
  ): Promise<void> {
    await this.cache.set(this.historyKey(slackId), messages, HISTORY_TTL_MS);
  }

  async handleMessage(slackId: string, text: string): Promise<string> {
    const tools = this.toolsService.getDefinitions();
    const user = await this.userService.findBySlackId(slackId);
    const systemPrompt = buildSystemPrompt(user?.name ?? null);

    const history = await this.loadHistory(slackId);
    const messages: Anthropic.MessageParam[] = [
      ...history,
      { role: 'user', content: text },
    ];

    const MAX_ROUNDS = 10;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        tools,
        messages,
      });

      if (response.stop_reason !== 'tool_use') {
        const replyText = this.extractText(response.content);
        await this.saveHistory(slackId, [
          ...messages,
          { role: 'assistant', content: replyText },
        ]);
        this.logger.log(
          `[handleMessage] 완료 (${round + 1}라운드) length=${replyText.length}`,
        );
        return replyText;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        this.logger.log(
          `[handleMessage] 툴 실행: ${block.name} (${round + 1}라운드)`,
        );
        const result = await this.toolsService.execute(
          block.name,
          block.input,
          slackId,
        );

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }

      messages.push(
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      );
    }

    return '요청 처리 중 오류가 발생했습니다. 다시 시도해 주세요.';
  }

  private extractText(content: Anthropic.ContentBlock[]): string {
    return content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
}
