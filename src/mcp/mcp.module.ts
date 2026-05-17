import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { ToolsModule } from '../tools/tools.module';
import { UserModule } from '../user/user.module';
import { GoogleModule } from '../google/google.module';

@Module({
  imports: [ToolsModule, UserModule, GoogleModule],
  controllers: [McpController],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
