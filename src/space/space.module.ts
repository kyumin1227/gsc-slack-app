import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Space } from './space.entity';
import { SpaceService } from './space.service';
import { SpaceMirrorService } from './space-mirror.service';
import { SpaceController } from './space.controller';
import { UserModule } from '../user/user.module';

@Module({
  imports: [TypeOrmModule.forFeature([Space]), UserModule],
  controllers: [SpaceController],
  providers: [SpaceService, SpaceMirrorService],
  exports: [SpaceService, SpaceMirrorService],
})
export class SpaceModule {}
