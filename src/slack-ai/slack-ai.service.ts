import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ToolsService } from '../tools/tools.service';

const MODEL = 'claude-haiku-4-5-20251001';
const HISTORY_TTL_MS = 60 * 60 * 1000; // 1시간

const SYSTEM_PROMPT = `당신은 GSC 스터디룸 예약 관리 어시스턴트입니다.
사용자의 요청에 맞는 툴을 호출하고, 결과를 친절하고 간결하게 한국어로 안내하세요.
모든 날짜와 시간은 한국 표준시(KST, UTC+9) 기준으로 해석하고 표시하세요.
날짜와 시간 표시 형식은 "2025년 5월 10일 오후 2시" 형식을 사용하세요.`;

@Injectable()
export class SlackAiService {
  private readonly logger = new Logger(SlackAiService.name);
  private readonly anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  constructor(
    private readonly toolsService: ToolsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  private historyKey(slackId: string): string {
    return `slack-ai:history:${slackId}`;
  }

  private async loadHistory(slackId: string): Promise<Anthropic.MessageParam[]> {
    return (await this.cache.get<Anthropic.MessageParam[]>(this.historyKey(slackId))) ?? [];
  }

  private async saveHistory(slackId: string, messages: Anthropic.MessageParam[]): Promise<void> {
    await this.cache.set(this.historyKey(slackId), messages, HISTORY_TTL_MS);
  }

  async handleMessage(slackId: string, text: string): Promise<string> {
    const tools = this.toolsService.getDefinitions();
    const history = await this.loadHistory(slackId);
    const messages: Anthropic.MessageParam[] = [
      ...history,
      { role: 'user', content: text },
    ];

    const response = await this.anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    if (response.stop_reason !== 'tool_use') {
      const text = this.extractText(response.content);
      await this.saveHistory(slackId, [
        ...messages,
        { role: 'assistant', content: text },
      ]);
      return text;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      this.logger.log(`[handleMessage] 툴 실행: ${block.name}`);
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

    const finalResponse = await this.anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages: [
        ...messages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      ],
    });

    const finalText = this.extractText(finalResponse.content);
    await this.saveHistory(slackId, [
      ...messages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults },
      { role: 'assistant', content: finalText },
    ]);
    this.logger.log(`[handleMessage] 최종 응답 완료 length=${finalText.length}`);
    return finalText;
  }

  private extractText(content: Anthropic.ContentBlock[]): string {
    return content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
}
