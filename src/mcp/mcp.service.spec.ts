import { createHash } from 'node:crypto';
import type { Cache } from 'cache-manager';
import { McpService } from './mcp.service';

class MemoryCache {
  readonly store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<T> {
    this.store.set(key, value);
    return value;
  }

  async del(key: string): Promise<boolean> {
    return this.store.delete(key);
  }
}

describe('McpService auth hardening', () => {
  const baseUrl = 'https://bannote.example.com';
  let cache: MemoryCache;
  let service: McpService;
  let googleOAuthService: {
    getGoogleAuthUrl: jest.Mock;
    exchangeCodeForTokens: jest.Mock;
    getGoogleUserInfo: jest.Mock;
  };
  let userService: {
    findByEmail: jest.Mock;
  };

  beforeEach(() => {
    cache = new MemoryCache();
    googleOAuthService = {
      getGoogleAuthUrl: jest.fn(
        (state: string) => `https://google.test/${state}`,
      ),
      exchangeCodeForTokens: jest.fn(async () => ({
        accessToken: 'google-token',
      })),
      getGoogleUserInfo: jest.fn(async () => ({
        email: 'student@example.com',
      })),
    };
    userService = {
      findByEmail: jest.fn(async () => ({ slackId: 'U123' })),
    };

    service = new McpService(
      { getDefinitions: jest.fn(), execute: jest.fn() } as never,
      userService as never,
      googleOAuthService as never,
      cache as unknown as Cache,
    );
  });

  it('requires dynamic client registrations to include redirect URIs', async () => {
    await expect(service.registerClient({})).resolves.toBeNull();
  });

  it('validates registered redirect URIs, PKCE, and resource binding', async () => {
    const registered = await service.registerClient({
      redirect_uris: ['https://client.example.com/callback'],
      client_name: 'Test Client',
    });
    const clientId = registered?.client_id as string;

    await expect(
      service.startAuthorize({
        baseUrl,
        clientId,
        responseType: 'code',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'plain',
        clientRedirectUri: 'https://client.example.com/callback',
        clientState: 'state',
      }),
    ).resolves.toBeNull();

    await expect(
      service.startAuthorize({
        baseUrl,
        clientId,
        responseType: 'code',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        clientRedirectUri: 'https://evil.example.com/callback',
        clientState: 'state',
      }),
    ).resolves.toBeNull();

    await expect(
      service.startAuthorize({
        baseUrl,
        clientId,
        responseType: 'code',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        clientRedirectUri: 'https://client.example.com/callback',
        clientState: 'state',
        resource: 'https://other.example.com/mcp',
      }),
    ).resolves.toBeNull();
  });

  it('issues tokens only for matching clients and PKCE verifiers', async () => {
    const verifier = 'correct-verifier';
    const codeChallenge = createHash('sha256')
      .update(verifier)
      .digest('base64url');
    const registered = await service.registerClient({
      redirect_uris: ['https://client.example.com/callback'],
    });
    const clientId = registered?.client_id as string;

    const authUrl = await service.startAuthorize({
      baseUrl,
      clientId,
      responseType: 'code',
      codeChallenge,
      codeChallengeMethod: 'S256',
      clientRedirectUri: 'https://client.example.com/callback',
      clientState: 'client-state',
    });
    expect(authUrl).toMatch(/^https:\/\/google\.test\//);

    const state = googleOAuthService.getGoogleAuthUrl.mock
      .calls[0][0] as string;
    const callback = await service.handleGoogleCallback('google-code', state);
    expect(callback?.clientRedirectUri).toContain(
      'https://client.example.com/callback?code=',
    );
    const code = new URL(callback!.clientRedirectUri).searchParams.get('code')!;

    await expect(
      service.issueToken(code, 'wrong-verifier', clientId),
    ).resolves.toBeNull();

    const retry = await service.startAuthorize({
      baseUrl,
      clientId,
      responseType: 'code',
      codeChallenge,
      codeChallengeMethod: 'S256',
      clientRedirectUri: 'https://client.example.com/callback',
      clientState: 'client-state',
    });
    expect(retry).toBeTruthy();
    const retryState = googleOAuthService.getGoogleAuthUrl.mock
      .calls[1][0] as string;
    const retryCallback = await service.handleGoogleCallback(
      'google-code',
      retryState,
    );
    const retryCode = new URL(
      retryCallback!.clientRedirectUri,
    ).searchParams.get('code')!;

    const tokenPair = await service.issueToken(
      retryCode,
      verifier,
      clientId,
      'https://client.example.com/callback',
    );
    expect(tokenPair?.accessToken).toBeTruthy();
    await expect(
      service.resolveSlackId(`Bearer ${tokenPair!.accessToken}`),
    ).resolves.toBe('U123');
  });

  it('checks Origin against the MCP base URL and optional allowlist', () => {
    expect(service.isOriginAllowed(undefined, baseUrl)).toBe(true);
    expect(service.isOriginAllowed(baseUrl, baseUrl)).toBe(true);
    expect(service.isOriginAllowed('https://evil.example.com', baseUrl)).toBe(
      false,
    );

    process.env.MCP_ALLOWED_ORIGINS = 'https://chat.openai.com';
    expect(
      service.isOriginAllowed('https://chat.openai.com/session', baseUrl),
    ).toBe(true);
    delete process.env.MCP_ALLOWED_ORIGINS;
  });
});
