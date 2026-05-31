import type { Request, Response } from 'express';
import { McpController } from './mcp.controller';

describe('McpController', () => {
  function createResponse() {
    const res = {
      status: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    return res as unknown as Response & typeof res;
  }

  function createRequest(headers: Record<string, string | undefined>) {
    return {
      headers,
      protocol: 'https',
      get: jest.fn(() => 'bannote.example.com'),
      body: {},
    } as unknown as Request;
  }

  it('rejects MCP requests from disallowed origins before auth', async () => {
    const controller = new McpController({
      isOriginAllowed: jest.fn(() => false),
      resolveSlackId: jest.fn(),
      getProtectedResourceMetadataUrl: jest.fn(),
      handleRequest: jest.fn(),
    } as never);
    const res = createResponse();

    await controller.handleMcp(
      createRequest({ origin: 'https://evil.example.com' }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden origin' });
  });

  it('returns protected resource metadata in the auth challenge', async () => {
    const controller = new McpController({
      isOriginAllowed: jest.fn(() => true),
      resolveSlackId: jest.fn(async () => null),
      getProtectedResourceMetadataUrl: jest.fn(
        () =>
          'https://bannote.example.com/.well-known/oauth-protected-resource/mcp',
      ),
      handleRequest: jest.fn(),
    } as never);
    const res = createResponse();

    await controller.handleMcp(createRequest({}), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.set).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer resource_metadata="https://bannote.example.com/.well-known/oauth-protected-resource/mcp"',
    );
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });
});
