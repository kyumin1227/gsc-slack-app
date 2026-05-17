import { Injectable } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';

@Injectable()
export class TimeTool {
  readonly definitions: Anthropic.Tool[] = [
    {
      name: 'get_current_time',
      description:
        '현재 날짜와 시간을 반환합니다. 예약 등 날짜/시간 관련 작업 전에 반드시 호출하세요.',
      input_schema: { type: 'object' as const, properties: {}, required: [] },
    },
  ];

  async execute(name: string): Promise<unknown> {
    if (name !== 'get_current_time') return null;

    const now = new Date();
    return {
      iso: now.toISOString(),
      timezone: 'Asia/Seoul',
      formatted: now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
    };
  }
}
