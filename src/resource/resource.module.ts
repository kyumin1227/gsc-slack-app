import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Resource } from './resource.entity';
import { ResourceService } from './resource.service';
import { ResourceMirrorService } from './resource-mirror.service';
import { ResourceController } from './resource.controller';
import { UserModule } from '../user/user.module';
import { GoogleModule } from '../google/google.module';

@Module({
  imports: [TypeOrmModule.forFeature([Resource]), UserModule, GoogleModule],
  controllers: [ResourceController],
  providers: [ResourceService, ResourceMirrorService],
  exports: [ResourceService, ResourceMirrorService],
})
export class ResourceModule {}
