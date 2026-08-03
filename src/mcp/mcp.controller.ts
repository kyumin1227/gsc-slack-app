import {
  All,
  BadRequestException,
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
    @Req() req: Request,
    @Query('client_id') clientId: string,
    @Query('response_type') responseType: string,
    @Query('code_challenge') codeChallenge: string,
    @Query('code_challenge_method') codeChallengeMethod: string,
    @Query('redirect_uri') clientRedirectUri: string,
    @Query('state') clientState: string,
    @Query('resource') resource?: string,
    @Query('scope') scope?: string,
  ) {
    const baseUrl = this.getBaseUrl(req);
    const url = await this.mcpService.startAuthorize({
      baseUrl,
      clientId,
      responseType,
      codeChallenge,
      codeChallengeMethod,
      clientRedirectUri,
      clientState,
      resource,
      scope,
    });
    if (!url) {
      throw new BadRequestException('invalid_request');
    }
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
      res
        .status(403)
        .send(
          '<p>가입된 유저를 찾을 수 없거나 인증 세션이 만료되었습니다. 다시 시도해 주세요.</p>',
        );
      return;
    }

    return { url: result.clientRedirectUri };
  }

  // ─── Dynamic Client Registration (RFC 7591) ──────────────────────────────

  @Post('auth/register')
  async registerClient(
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const client = await this.mcpService.registerClient(body);
    if (!client) {
      res.status(400).json({ error: 'invalid_client_metadata' });
      return;
    }
    res.status(201).json(client);
  }

  // ─── OAuth 2.0 Token Endpoint ─────────────────────────────────────────────

  @Post('auth/token')
  async token(@Body() body: Record<string, string>, @Res() res: Response) {
    let result: { accessToken: string; refreshToken: string } | null;

    if (body.grant_type === 'refresh_token') {
      result = await this.mcpService.refreshToken(body.refresh_token);
    } else {
      result = await this.mcpService.issueToken(
        body.code,
        body.code_verifier,
        body.client_id,
        body.redirect_uri,
      );
    }

    if (!result) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }

    res.json({
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      token_type: 'bearer',
      expires_in: 60 * 60, // 1시간 (초)
    });
  }

  // ─── MCP Protocol Handler ─────────────────────────────────────────────────

  @All()
  async handleMcp(@Req() req: Request, @Res() res: Response): Promise<void> {
    const baseUrl = this.getBaseUrl(req);
    if (!this.mcpService.isOriginAllowed(req.headers.origin, baseUrl)) {
      res.status(403).json({ error: 'Forbidden origin' });
      return;
    }

    const slackId = await this.mcpService.resolveSlackId(
      req.headers.authorization,
    );

    if (!slackId) {
      res
        .status(401)
        .set(
          'WWW-Authenticate',
          `Bearer resource_metadata="${this.mcpService.getProtectedResourceMetadataUrl(baseUrl)}"`,
        )
        .json({ error: 'Unauthorized' });
      return;
    }

    await this.mcpService.handleRequest(req, res, req.body as unknown, slackId);
  }

  private getBaseUrl(req: Request): string {
    return process.env.MCP_BASE_URL ?? `${req.protocol}://${req.get('host')}`;
  }
}
