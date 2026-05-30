import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
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
      const tool = req.params.name;
      try {
        const result = await this.toolsService.execute(
          tool,
          req.params.arguments ?? {},
          slackId,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (e) {
        this.logger.error(
          `Tool execution failed — tool=${tool} slackId=${slackId} error=${e instanceof Error ? e.message : String(e)}`,
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: e instanceof Error ? e.message : String(e),
              }),
            },
          ],
          isError: true,
        };
      }
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
}
