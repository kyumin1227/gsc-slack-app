import { All, Controller, Logger, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpService } from './mcp.service';

@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(private readonly mcpService: McpService) {}

  @All()
  async handleMcp(@Req() req: Request, @Res() res: Response): Promise<void> {
    const slackId = await this.mcpService.resolveSlackId(
      req.headers.authorization,
    );

    if (!slackId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    this.logger.log(`[MCP] ${req.method} slackId=${slackId}`);

    await this.mcpService.handleRequest(req, res, req.body as unknown, slackId);
  }
}
