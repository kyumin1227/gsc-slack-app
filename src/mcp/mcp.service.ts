import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ToolsService } from '../tools/tools.service';
import { UserService } from '../user/service/user.service';

interface McpSession {
  server: Server;
  transport: StreamableHTTPServerTransport;
}

@Injectable()
export class McpService {
  // sessionId → { server, transport }
  private readonly sessions = new Map<string, McpSession>();

  constructor(
    private readonly toolsService: ToolsService,
    private readonly userService: UserService,
  ) {}

  private buildServer(slackId: string): Server {
    const server = new Server(
      { name: 'gsc-slack-app', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.toolsService.getDefinitions().map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.input_schema,
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const result = await this.toolsService.execute(
        req.params.name,
        req.params.arguments ?? {},
        slackId,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    });

    return server;
  }

  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
    slackId: string,
  ): Promise<void> {
    const sessionId = (req.headers['mcp-session-id'] as string) ?? undefined;

    // 기존 세션 재사용
    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, body);
      return;
    }

    // initialize 요청인지 확인 (새 세션 생성 가능)
    const isInit =
      body !== null &&
      typeof body === 'object' &&
      'method' in body &&
      (body as Record<string, unknown>).method === 'initialize';

    if (!isInit) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: 'No active session. Send initialize first.' }),
      );
      return;
    }

    // 새 세션 생성
    const newSessionId = randomUUID();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => newSessionId,
    });
    const server = this.buildServer(slackId);

    this.sessions.set(newSessionId, { server, transport });

    transport.onclose = () => {
      this.sessions.delete(newSessionId);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async resolveSlackId(authHeader: string | undefined): Promise<string | null> {
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    if (!token) return null;

    // POC: Bearer 토큰 = slackId 직접 사용
    // TODO: Google OAuth 세션 토큰으로 교체
    const user = await this.userService.findBySlackId(token);
    return user ? token : null;
  }
}
