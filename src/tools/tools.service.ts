import { Injectable } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import type { Tool, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { BookingTool } from './booking.tool';
import { TimeTool } from './time.tool';
import { BusinessError } from '../common/errors/base.error';
import { AppMetrics } from '../common/metrics/app.metrics';

type McpToolMetadata = {
  title: string;
  annotations: ToolAnnotations;
};

const DEFAULT_OUTPUT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: true,
};

const MCP_TOOL_METADATA: Record<string, McpToolMetadata> = {
  get_my_bookings: {
    title: 'Get My Bookings',
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  find_user: {
    title: 'Find User',
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  get_study_rooms: {
    title: 'Get Study Rooms',
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  check_room_availability: {
    title: 'Check Room Availability',
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  book_room: {
    title: 'Book Room',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  cancel_booking: {
    title: 'Cancel Booking',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  modify_booking: {
    title: 'Modify Booking',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  get_current_time: {
    title: 'Get Current Time',
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
};

@Injectable()
export class ToolsService {
  private readonly tools: (BookingTool | TimeTool)[];

  constructor(
    bookingTool: BookingTool,
    timeTool: TimeTool,
    private readonly appMetrics: AppMetrics,
  ) {
    this.tools = [bookingTool, timeTool];
  }

  getDefinitions(): Anthropic.Tool[] {
    return this.tools.flatMap((tool) =>
      tool.definitions.map((definition) => ({
        name: definition.name,
        description: definition.description,
        input_schema: definition.input_schema,
      })),
    );
  }

  getMcpDefinitions(): Tool[] {
    return this.tools.flatMap((tool) =>
      tool.definitions.map((definition) => {
        const metadata = MCP_TOOL_METADATA[definition.name] ?? {
          title: definition.name,
          annotations: {},
        };
        return {
          name: definition.name,
          title: metadata.title,
          description: definition.description ?? '',
          inputSchema: definition.input_schema as Tool['inputSchema'],
          outputSchema: DEFAULT_OUTPUT_SCHEMA as Tool['outputSchema'],
          annotations: metadata.annotations,
        };
      }),
    );
  }

  async execute(
    name: string,
    input: unknown,
    slackId: string,
  ): Promise<unknown> {
    try {
      for (const tool of this.tools) {
        const result = await tool.execute(name, input, slackId);
        if (result !== null) {
          this.appMetrics.toolExecutionsTotal.inc({
            tool_name: name,
            success: 'true',
          });
          return result;
        }
      }
      this.appMetrics.toolExecutionsTotal.inc({
        tool_name: name,
        success: 'false',
      });
      return { error: `알 수 없는 툴: ${name}` };
    } catch (e) {
      this.appMetrics.toolExecutionsTotal.inc({
        tool_name: name,
        success: 'false',
      });
      if (e instanceof BusinessError)
        return { success: false, error: e.message };
      throw e;
    }
  }

  toStructuredContent(result: unknown): Record<string, unknown> {
    if (
      result !== null &&
      typeof result === 'object' &&
      !Array.isArray(result)
    ) {
      return result as Record<string, unknown>;
    }
    return { result };
  }
}
