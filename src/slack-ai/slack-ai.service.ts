import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ToolsService } from '../tools/tools.service';
import { UserService } from '../user/service/user.service';

const MODEL = 'claude-haiku-4-5-20251001';
const HISTORY_TTL_MS = 60 * 60 * 1000; // 1시간
const MAX_HISTORY_MESSAGES = 50; // 최근 25턴

const buildSystemPrompt = (userName: string | null) => {
  const now = new Date().toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return `당신은 GSC 스터디룸 예약 관리 어시스턴트입니다.
${userName ? `현재 대화 중인 사용자의 이름은 "${userName}"입니다.` : ''}
현재 날짜 및 시각: ${now}
사용자의 요청에 맞는 툴을 호출하고, 결과를 친절하고 귀엽고 간결하게 안내하세요. 사용자가 사용하는 언어로 응답하세요.
모든 날짜와 시간은 한국 표준시(KST, UTC+9) 기준으로 해석하고 표시하세요.
id, calendarId, eventId 등 내부 식별자는 절대 사용자에게 노출하지 마세요.
예약을 찾을 수 없거나 수정·취소 권한이 없는 경우 "해당 예약에 대한 권한이 없습니다" 형식으로 안내하세요.
예약 생성·수정·취소는 반드시 해당 툴을 실제로 호출해야 완료됩니다. 툴 호출 없이 완료되었다고 응답하지 마세요.`;
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

  private processingKey(slackId: string): string {
    return `slack-ai:processing:${slackId}`;
  }

  async isProcessing(slackId: string): Promise<boolean> {
    return (await this.cache.get(this.processingKey(slackId))) === true;
  }

  async setProcessing(slackId: string): Promise<void> {
    // 3분 TTL: 서버 크래시 시 플래그가 영구적으로 남지 않도록
    await this.cache.set(this.processingKey(slackId), true, 3 * 60 * 1000);
  }

  async clearProcessing(slackId: string): Promise<void> {
    await this.cache.del(this.processingKey(slackId));
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

  private readonly TOOL_LABELS: Record<string, string> = {
    get_my_bookings: '📋 내 예약 조회 중...',
    find_user: '🔍 참석자 검색 중...',
    get_study_rooms: '🏫 스터디룸 목록 조회 중...',
    check_room_availability: '🗓️ 가용 여부 확인 중...',
    book_room: '✏️ 예약 생성 중...',
    cancel_booking: '🗑️ 예약 취소 중...',
    modify_booking: '🔄 예약 수정 중...',
  };

  async handleMessage(
    slackId: string,
    text: string,
    onProgress?: (msg: string) => Promise<void>,
  ): Promise<string> {
    const tools = this.toolsService
      .getDefinitions()
      .filter((t) => t.name !== 'get_current_time'); // 프롬프트에 시간이 있으므로 툴 제외
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
        if (onProgress) {
          const label = this.TOOL_LABELS[block.name] ?? '⚙️ 처리 중...';
          await onProgress(label);
        }
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
