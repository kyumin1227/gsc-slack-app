import {
  All,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Redirect,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpService } from './mcp.service';

@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(private readonly mcpService: McpService) {}

  // ─── OAuth 2.0 Authorization Endpoint ────────────────────────────────────

  @Get('auth/authorize')
  @Redirect()
  async authorize(
    @Query('code_challenge') codeChallenge: string,
    @Query('code_challenge_method') codeChallengeMethod: string,
    @Query('redirect_uri') clientRedirectUri: string,
    @Query('state') clientState: string,
  ) {
    const url = await this.mcpService.startAuthorize({
      codeChallenge,
      codeChallengeMethod,
      clientRedirectUri,
      clientState,
    });
    return { url };
  }

  // ─── Google OAuth Callback ────────────────────────────────────────────────

  @Get('auth/callback')
  @Redirect()
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const result = await this.mcpService.handleGoogleCallback(code, state);

    if (!result) {
      res.status(403).send(
        '<p>가입된 유저를 찾을 수 없거나 인증 세션이 만료되었습니다. 다시 시도해 주세요.</p>',
      );
      return;
    }

    return { url: result.clientRedirectUri };
  }

  // ─── Dynamic Client Registration (RFC 7591) ──────────────────────────────

  @Post('auth/register')
  registerClient(@Body() body: Record<string, unknown>, @Res() res: Response) {
    const client = this.mcpService.registerClient(body);
    res.status(201).json(client);
  }

  // ─── OAuth 2.0 Token Endpoint ─────────────────────────────────────────────

  @Post('auth/token')
  async token(
    @Body('code') code: string,
    @Body('code_verifier') codeVerifier: string,
    @Res() res: Response,
  ) {
    const accessToken = await this.mcpService.issueToken(code, codeVerifier);

    if (!accessToken) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }

    res.json({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 7 * 24 * 60 * 60, // 7일 (초)
    });
  }

  // ─── MCP Protocol Handler ─────────────────────────────────────────────────

  @All()
  async handleMcp(@Req() req: Request, @Res() res: Response): Promise<void> {
    const slackId = await this.mcpService.resolveSlackId(
      req.headers.authorization,
    );

    if (!slackId) {
      const baseUrl = process.env.MCP_BASE_URL ?? `${req.protocol}://${req.get('host')}`;
      res.status(401)
        .set('WWW-Authenticate', `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`)
        .json({ error: 'Unauthorized' });
      return;
    }

    this.logger.log(`[MCP] ${req.method} slackId=${slackId}`);
    await this.mcpService.handleRequest(req, res, req.body as unknown, slackId);
  }
}
