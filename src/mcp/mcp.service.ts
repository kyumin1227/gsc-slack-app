import { Inject, Injectable } from '@nestjs/common';
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
  codeChallenge: string;
  codeChallengeMethod: string;
  clientRedirectUri: string;
  clientState: string;
}

interface AuthCode {
  slackId: string;
  codeChallenge: string;
}

const ACCESS_TOKEN_TTL = 60 * 60 * 1000; // 1시간
const REFRESH_TOKEN_TTL = 365 * 24 * 60 * 60 * 1000; // 365일
const PKCE_TTL = 10 * 60 * 1000; // 10분
const AUTH_CODE_TTL = 5 * 60 * 1000; // 5분

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
    };
  }

  registerClient(
    clientMetadata: Record<string, unknown>,
  ): Record<string, unknown> {
    const clientId = randomUUID();
    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...clientMetadata,
    };
  }

  getProtectedResourceMetadata(baseUrl: string) {
    return {
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl],
    };
  }

  // ─── OAuth 2.0 Authorization Endpoint ───────────────────────────────────

  async startAuthorize(params: {
    codeChallenge: string;
    codeChallengeMethod: string;
    clientRedirectUri: string;
    clientState: string;
  }): Promise<string> {
    const ourState = randomUUID();
    await this.cache.set(
      `mcp:pkce:${ourState}`,
      params satisfies PkceSession,
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
        codeChallenge: pkce.codeChallenge,
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
  ): Promise<{ accessToken: string; refreshToken: string } | null> {
    const authCode = await this.cache.get<AuthCode>(`mcp:authcode:${code}`);
    if (!authCode) return null;

    await this.cache.del(`mcp:authcode:${code}`);

    const computed = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    if (computed !== authCode.codeChallenge) return null;

    return this.mintTokenPair(authCode.slackId);
  }

  async refreshToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string } | null> {
    const slackId = await this.cache.get<string>(`mcp:refresh:${refreshToken}`);
    if (!slackId) return null;

    await this.cache.del(`mcp:refresh:${refreshToken}`);
    return this.mintTokenPair(slackId);
  }

  private async mintTokenPair(
    slackId: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = randomUUID();
    const refreshToken = randomUUID();
    await Promise.all([
      this.cache.set(`mcp:session:${accessToken}`, slackId, ACCESS_TOKEN_TTL),
      this.cache.set(`mcp:refresh:${refreshToken}`, slackId, REFRESH_TOKEN_TTL),
    ]);
    return { accessToken, refreshToken };
  }

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

    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, body);
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
    transport.onclose = () => this.sessions.delete(newSessionId);

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async resolveSlackId(authHeader: string | undefined): Promise<string | null> {
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    if (!token) return null;

    const slackId = await this.cache.get<string>(`mcp:session:${token}`);
    return slackId ?? null;
  }
}
