import { Injectable } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { BookingTool } from './booking.tool';
import { BusinessError } from '../common/errors/base.error';

@Injectable()
export class ToolsService {
  private readonly tools: BookingTool[];

  constructor(private readonly bookingTool: BookingTool) {
    this.tools = [bookingTool];
  }

  getDefinitions(): Anthropic.Tool[] {
    return this.tools.flatMap((t) => t.definitions);
  }

  async execute(
    name: string,
    input: unknown,
    slackId: string,
  ): Promise<unknown> {
    try {
      for (const tool of this.tools) {
        const result = await tool.execute(name, input, slackId);
        if (result !== null) return result;
      }
      return { error: `알 수 없는 툴: ${name}` };
    } catch (e) {
      if (e instanceof BusinessError)
        return { success: false, error: e.message };
      throw e;
    }
  }
}
