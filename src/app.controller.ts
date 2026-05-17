import { Controller, Get, Redirect, Req } from '@nestjs/common';
import { AppService } from './app.service';
import { Action, Message } from 'nestjs-slack-bolt';
import type {
  SlackEventMiddlewareArgs,
  SlackActionMiddlewareArgs,
  BlockAction,
  AllMiddlewareArgs,
} from '@slack/bolt';
import type { Request } from 'express';
import { McpService } from './mcp/mcp.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly mcpService: McpService,
  ) {}

  @Get()
  @Redirect('health')
  getRoot() {}

  @Get('health')
  getHealth() {
    return this.appService.getHealthInfo();
  }

  @Message('health')
  async healthMessage({ say }: SlackEventMiddlewareArgs<'message'>) {
    const info = this.appService.getDetailedHealthInfo();
    await say(
      `*GSC Slack App* v${info.version}\n` +
        `호스트: ${info.hostname} (${info.ip})\n` +
        `시작: ${info.startedAt}`,
    );
  }

  @Get('.well-known/oauth-authorization-server')
  getOAuthMeta(@Req() req: Request) {
    const baseUrl = process.env.MCP_BASE_URL ?? `${req.protocol}://${req.get('host')}`;
    return this.mcpService.getAuthorizationServerMetadata(baseUrl);
  }

  @Get('.well-known/oauth-protected-resource')
  getProtectedResourceMeta(@Req() req: Request) {
    const baseUrl = process.env.MCP_BASE_URL ?? `${req.protocol}://${req.get('host')}`;
    return this.mcpService.getProtectedResourceMetadata(baseUrl);
  }

  // 외부 URL 버튼 공통 ack 핸들러 — action_id에 `:open-url`이 포함된 모든 버튼
  @Action(/open-url/)
  async ackExternalUrlButtons({
    ack,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
  }
}
