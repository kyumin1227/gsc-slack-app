import { Module } from '@nestjs/common';
import { ResourceModule } from '../resource/resource.module';
import { UserModule } from '../user/user.module';
import { BookingTool } from './booking.tool';
import { TimeTool } from './time.tool';
import { ToolsService } from './tools.service';

@Module({
  imports: [ResourceModule, UserModule],
  providers: [BookingTool, TimeTool, ToolsService],
  exports: [ToolsService],
})
export class ToolsModule {}
