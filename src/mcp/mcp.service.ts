import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  GetPromptResult,
  ListPromptsResult,
  ListResourcesResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ToolsService } from '../tools/tools.service';
import { UserService } from '../user/service/user.service';
import { GoogleOAuthService } from '../google/oauth/google-oauth.service';

interface McpSession {
  server: Server;
  transport: StreamableHTTPServerTransport;
}

interface PkceSession {
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  clientRedirectUri: string;
  clientState: string;
  resource: string;
}

interface AuthCode {
  slackId: string;
  clientId: string;
  codeChallenge: string;
  clientRedirectUri: string;
  resource: string;
}

interface McpRegisteredClient {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
  scope?: string;
}

interface McpTokenSession {
  slackId: string;
  clientId: string;
  resource: string;
}

const ACCESS_TOKEN_TTL = 60 * 60 * 1000; // 1시간
const REFRESH_TOKEN_TTL = 365 * 24 * 60 * 60 * 1000; // 365일
const PKCE_TTL = 10 * 60 * 1000; // 10분
const AUTH_CODE_TTL = 5 * 60 * 1000; // 5분
const CLIENT_TTL = 365 * 24 * 60 * 60 * 1000; // 365일

const BOOKING_GUIDE = `# Bannote study room booking guide

- Interpret all dates and times in Asia/Seoul.
- Call get_current_time before relative date/time work.
- Call get_study_rooms before using a roomId.
- Call check_room_availability before creating or changing a booking.
- Use find_user to resolve attendee Slack IDs.
- Booking start and end times must be 15-minute aligned.
- Do not expose calendarId or eventId to the user unless the client needs them for a tool call.`;

const TOOL_WORKFLOW_GUIDE = `# Bannote MCP workflow guide

Reserve a room:
1. get_current_time
2. get_study_rooms
3. check_room_availability
4. find_user, when attendees are named
5. book_room

Change a booking:
1. get_my_bookings
2. get_study_rooms, if changing rooms
3. check_room_availability, if changing time or room
4. modify_booking

Cancel a booking:
1. get_my_bookings
2. cancel_booking after the user confirms the target booking.`;

@Injectable()
export class McpService {
  private readonly sessions = new Map<string, McpSession>();

  constructor(
    private readonly toolsService: ToolsService,
    private readonly userService: UserService,
    private readonly googleOAuthService: GoogleOAuthService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // ─── OAuth 2.0 메타데이터 ────────────────────────────────────────────────

  getAuthorizationServerMetadata(baseUrl: string) {
    return {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/mcp/auth/authorize`,
      token_endpoint: `${baseUrl}/mcp/auth/token`,
      registration_endpoint: `${baseUrl}/mcp/auth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp:tools'],
    };
  }

  async registerClient(
    clientMetadata: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const redirectUris = this.normalizeRedirectUris(
      clientMetadata.redirect_uris,
    );
    if (redirectUris.length === 0) return null;

    const clientId = randomUUID();
    const client: McpRegisteredClient = {
      clientId,
      redirectUris,
      clientName:
        typeof clientMetadata.client_name === 'string'
          ? clientMetadata.client_name
          : undefined,
      scope:
        typeof clientMetadata.scope === 'string'
          ? clientMetadata.scope
          : undefined,
    };

    await this.cache.set(`mcp:client:${clientId}`, client, CLIENT_TTL);

    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      ...(client.clientName ? { client_name: client.clientName } : {}),
      ...(client.scope ? { scope: client.scope } : {}),
    };
  }

  getProtectedResourceMetadata(baseUrl: string) {
    return {
      resource: this.getResourceUrl(baseUrl),
      authorization_servers: [baseUrl],
      scopes_supported: ['mcp:tools'],
      bearer_methods_supported: ['header'],
    };
  }

  // ─── OAuth 2.0 Authorization Endpoint ───────────────────────────────────

  async startAuthorize(params: {
    baseUrl: string;
    clientId: string;
    responseType: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    clientRedirectUri: string;
    clientState: string;
    resource?: string;
    scope?: string;
  }): Promise<string | null> {
    if (
      params.responseType !== 'code' ||
      params.codeChallengeMethod !== 'S256' ||
      !params.codeChallenge ||
      !params.clientState
    ) {
      return null;
    }

    const client = await this.cache.get<McpRegisteredClient>(
      `mcp:client:${params.clientId}`,
    );
    if (!client) return null;

    if (!client.redirectUris.includes(params.clientRedirectUri)) return null;

    const resource = params.resource ?? this.getResourceUrl(params.baseUrl);
    if (resource !== this.getResourceUrl(params.baseUrl)) return null;

    const ourState = randomUUID();
    await this.cache.set(
      `mcp:pkce:${ourState}`,
      {
        clientId: params.clientId,
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: params.codeChallengeMethod,
        clientRedirectUri: params.clientRedirectUri,
        clientState: params.clientState,
        resource,
      } satisfies PkceSession,
      PKCE_TTL,
    );

    const redirectUri = process.env.MCP_GOOGLE_REDIRECT_URI ?? '';
    return this.googleOAuthService.getGoogleAuthUrl(ourState, redirectUri);
  }

  // ─── Google OAuth Callback ───────────────────────────────────────────────

  async handleGoogleCallback(
    code: string,
    ourState: string,
  ): Promise<{ clientRedirectUri: string; clientState: string } | null> {
    const pkce = await this.cache.get<PkceSession>(`mcp:pkce:${ourState}`);
    if (!pkce) return null;

    await this.cache.del(`mcp:pkce:${ourState}`);

    const redirectUri = process.env.MCP_GOOGLE_REDIRECT_URI ?? '';
    const { accessToken } = await this.googleOAuthService.exchangeCodeForTokens(
      code,
      redirectUri,
    );
    const { email } =
      await this.googleOAuthService.getGoogleUserInfo(accessToken);

    const user = await this.userService.findByEmail(email);
    if (!user) return null;

    const authCode = randomUUID();
    await this.cache.set(
      `mcp:authcode:${authCode}`,
      {
        slackId: user.slackId,
        clientId: pkce.clientId,
        codeChallenge: pkce.codeChallenge,
        clientRedirectUri: pkce.clientRedirectUri,
        resource: pkce.resource,
      } satisfies AuthCode,
      AUTH_CODE_TTL,
    );

    return {
      clientRedirectUri: `${pkce.clientRedirectUri}?code=${authCode}&state=${encodeURIComponent(pkce.clientState)}`,
      clientState: pkce.clientState,
    };
  }

  // ─── OAuth 2.0 Token Endpoint ────────────────────────────────────────────

  async issueToken(
    code: string,
    codeVerifier: string,
    clientId: string,
    clientRedirectUri?: string,
  ): Promise<{ accessToken: string; refreshToken: string } | null> {
    if (!code || !codeVerifier || !clientId) return null;

    const authCode = await this.cache.get<AuthCode>(`mcp:authcode:${code}`);
    if (!authCode) return null;

    await this.cache.del(`mcp:authcode:${code}`);
    if (authCode.clientId !== clientId) return null;
    if (
      clientRedirectUri !== undefined &&
      authCode.clientRedirectUri !== clientRedirectUri
    ) {
      return null;
    }

    const computed = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    if (computed !== authCode.codeChallenge) return null;

    return this.mintTokenPair(
      authCode.slackId,
      authCode.clientId,
      authCode.resource,
    );
  }

  async refreshToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string } | null> {
    if (!refreshToken) return null;

    const session = await this.cache.get<McpTokenSession | string>(
      `mcp:refresh:${refreshToken}`,
    );
    if (!session) return null;

    await this.cache.del(`mcp:refresh:${refreshToken}`);
    if (typeof session === 'string') {
      return this.mintTokenPair(session, 'legacy-client', '');
    }
    return this.mintTokenPair(
      session.slackId,
      session.clientId,
      session.resource,
    );
  }

  private async mintTokenPair(
    slackId: string,
    clientId: string,
    resource: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = randomUUID();
    const refreshToken = randomUUID();
    const session = { slackId, clientId, resource } satisfies McpTokenSession;
    await Promise.all([
      this.cache.set(`mcp:session:${accessToken}`, session, ACCESS_TOKEN_TTL),
      this.cache.set(`mcp:refresh:${refreshToken}`, session, REFRESH_TOKEN_TTL),
    ]);
    return { accessToken, refreshToken };
  }

  private readonly logger = new Logger(McpService.name);

  // ─── MCP 요청 처리 ───────────────────────────────────────────────────────

  private buildServer(slackId: string): Server {
    const server = new Server(
      { name: 'gsc-slack-app', version: '1.0.0' },
      { capabilities: { tools: {}, prompts: {}, resources: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.toolsService.getMcpDefinitions(),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const tool = req.params.name;
      try {
        const result = await this.toolsService.execute(
          tool,
          req.params.arguments ?? {},
          slackId,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: this.toolsService.toStructuredContent(result),
        };
      } catch (e) {
        const structuredContent = {
          success: false,
          error: e instanceof Error ? e.message : String(e),
        };
        this.logger.error(
          `Tool execution failed — tool=${tool} slackId=${slackId} error=${e instanceof Error ? e.message : String(e)}`,
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(structuredContent),
            },
          ],
          structuredContent,
          isError: true,
        };
      }
    });

    server.setRequestHandler(ListPromptsRequestSchema, async () =>
      this.listPrompts(),
    );

    server.setRequestHandler(GetPromptRequestSchema, async (req) =>
      this.getPrompt(req.params.name, req.params.arguments ?? {}),
    );

    server.setRequestHandler(ListResourcesRequestSchema, async () =>
      this.listResources(),
    );

    server.setRequestHandler(ReadResourceRequestSchema, async (req) =>
      this.readResource(req.params.uri, slackId),
    );

    return server;
  }

  listPrompts(): ListPromptsResult {
    return {
      prompts: [
        {
          name: 'reserve_study_room',
          title: 'Reserve Study Room',
          description:
            'Plan and create a study room booking with the required availability checks.',
          arguments: [
            { name: 'date', description: 'Requested date', required: false },
            {
              name: 'start_time',
              description: 'Requested start time',
              required: false,
            },
            {
              name: 'end_time',
              description: 'Requested end time',
              required: false,
            },
            {
              name: 'room_preference',
              description: 'Preferred room name or alias',
              required: false,
            },
            {
              name: 'attendees',
              description: 'Comma-separated attendee names, codes, or emails',
              required: false,
            },
            {
              name: 'title',
              description: 'Booking title or purpose',
              required: false,
            },
          ],
        },
        {
          name: 'change_study_room_booking',
          title: 'Change Study Room Booking',
          description:
            'Find an existing booking and safely change its time, room, title, or attendees.',
        },
        {
          name: 'cancel_study_room_booking',
          title: 'Cancel Study Room Booking',
          description:
            'Find an existing booking and cancel it after user confirmation.',
        },
        {
          name: 'find_available_study_room',
          title: 'Find Available Study Room',
          description:
            'Search room availability for a requested date and time window.',
        },
      ],
    };
  }

  getPrompt(name: string, args: Record<string, string>): GetPromptResult {
    const argLines = Object.entries(args)
      .filter(([, value]) => value.trim().length > 0)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join('\n');
    const context = argLines ? `\n\nUser-provided details:\n${argLines}` : '';
    const workflows: Record<string, { title: string; body: string }> = {
      reserve_study_room: {
        title: 'Reserve Study Room',
        body: 'Help the user reserve a study room. Use get_current_time first for relative dates, then get_study_rooms, check_room_availability, find_user when attendees are named, and finally book_room only after the target room and time are clear.',
      },
      change_study_room_booking: {
        title: 'Change Study Room Booking',
        body: 'Help the user change an existing study room booking. Use get_my_bookings to identify the target booking. If the room or time changes, use get_study_rooms and check_room_availability before calling modify_booking.',
      },
      cancel_study_room_booking: {
        title: 'Cancel Study Room Booking',
        body: 'Help the user cancel an existing study room booking. Use get_my_bookings to identify the target booking and call cancel_booking only after the user confirms which booking should be cancelled.',
      },
      find_available_study_room: {
        title: 'Find Available Study Room',
        body: 'Help the user find an available study room. Use get_current_time for relative dates, get_study_rooms to understand room IDs, and check_room_availability for the requested time window.',
      },
    };
    const prompt = workflows[name];
    if (!prompt) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${name}`);
    }

    return {
      description: prompt.title,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `${prompt.body}${context}`,
          },
        },
      ],
    };
  }

  listResources(): ListResourcesResult {
    return {
      resources: [
        {
          uri: 'bannote://guide/study-room-booking',
          name: 'study-room-booking-guide',
          title: 'Study Room Booking Guide',
          description: 'Rules and tool ordering guidance for booking rooms.',
          mimeType: 'text/markdown',
        },
        {
          uri: 'bannote://guide/tool-workflows',
          name: 'tool-workflows-guide',
          title: 'Tool Workflow Guide',
          description: 'Recommended MCP tool call order for common tasks.',
          mimeType: 'text/markdown',
        },
        {
          uri: 'bannote://rooms',
          name: 'study-room-catalog',
          title: 'Study Room Catalog',
          description: 'Current study room IDs, names, and aliases.',
          mimeType: 'application/json',
        },
        {
          uri: 'bannote://me/bookings',
          name: 'my-bookings',
          title: 'My Bookings',
          description: 'Current user study room bookings.',
          mimeType: 'application/json',
        },
      ],
    };
  }

  async readResource(
    uri: string,
    slackId: string,
  ): Promise<ReadResourceResult> {
    if (uri === 'bannote://guide/study-room-booking') {
      return this.textResource(uri, 'text/markdown', BOOKING_GUIDE);
    }
    if (uri === 'bannote://guide/tool-workflows') {
      return this.textResource(uri, 'text/markdown', TOOL_WORKFLOW_GUIDE);
    }
    if (uri === 'bannote://rooms') {
      const rooms = await this.toolsService.execute(
        'get_study_rooms',
        {},
        slackId,
      );
      return this.textResource(uri, 'application/json', rooms);
    }
    if (uri === 'bannote://me/bookings') {
      const bookings = await this.toolsService.execute(
        'get_my_bookings',
        {},
        slackId,
      );
      return this.textResource(uri, 'application/json', bookings);
    }
    throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${uri}`);
  }

  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
    slackId: string,
  ): Promise<void> {
    const sessionId = (req.headers['mcp-session-id'] as string) ?? undefined;

    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, body);
      return;
    }

    // 세션 ID가 있지만 서버에 없는 경우 (재시작 등) → 404로 클라이언트 재연결 유도
    if (sessionId) {
      this.logger.warn(
        `Session not found (expired or server restarted) — sessionId=${sessionId} slackId=${slackId}`,
      );
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: 'Session not found. Please reinitialize.' }),
      );
      return;
    }

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

    const newSessionId = randomUUID();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => newSessionId,
    });
    const server = this.buildServer(slackId);

    this.sessions.set(newSessionId, { server, transport });
    this.logger.log(
      `Session created — sessionId=${newSessionId} slackId=${slackId}`,
    );
    transport.onclose = () => {
      this.sessions.delete(newSessionId);
      this.logger.log(
        `Session closed — sessionId=${newSessionId} slackId=${slackId}`,
      );
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async resolveSlackId(authHeader: string | undefined): Promise<string | null> {
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    if (!token) return null;

    const session = await this.cache.get<McpTokenSession | string>(
      `mcp:session:${token}`,
    );
    if (!session) return null;
    return typeof session === 'string' ? session : session.slackId;
  }

  isOriginAllowed(originHeader: string | undefined, baseUrl: string): boolean {
    if (!originHeader) return true;

    const configuredOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (configuredOrigins.includes('*')) return true;

    const allowedOrigins = new Set([
      new URL(baseUrl).origin,
      ...configuredOrigins.flatMap((origin) => {
        try {
          return [new URL(origin).origin];
        } catch {
          return [];
        }
      }),
    ]);

    try {
      return allowedOrigins.has(new URL(originHeader).origin);
    } catch {
      return false;
    }
  }

  getResourceUrl(baseUrl: string): string {
    return `${baseUrl}/mcp`;
  }

  getProtectedResourceMetadataUrl(baseUrl: string): string {
    return `${baseUrl}/.well-known/oauth-protected-resource/mcp`;
  }

  private normalizeRedirectUris(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return value
      .filter((uri): uri is string => typeof uri === 'string')
      .filter((uri) => {
        try {
          const parsed = new URL(uri);
          return parsed.protocol === 'https:' || parsed.protocol === 'http:';
        } catch {
          return false;
        }
      });
  }

  private textResource(
    uri: string,
    mimeType: string,
    value: unknown,
  ): ReadResourceResult {
    return {
      contents: [
        {
          uri,
          mimeType,
          text:
            typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        },
      ],
    };
  }
}
