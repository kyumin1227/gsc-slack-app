import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { ToolsModule } from '../tools/tools.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [ToolsModule, UserModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
