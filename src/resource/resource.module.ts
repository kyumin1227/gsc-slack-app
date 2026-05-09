import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Resource } from './resource.entity';
import { ResourceService } from './service/resource.service';
import { StudyRoomService } from './service/study-room.service';
import { ProfessorService } from './service/professor.service';
import { ResourceMirrorService } from './resource-mirror.service';
import { ResourceController } from './controller/resource.controller';
import { StudyRoomController } from './controller/study-room.controller';
import { ProfessorController } from './controller/professor.controller';
import { ClassroomController } from './controller/classroom.controller';
import { UserModule } from '../user/user.module';
import { GoogleModule } from '../google/google.module';

@Module({
  imports: [TypeOrmModule.forFeature([Resource]), UserModule, GoogleModule],
  controllers: [
    ResourceController,
    StudyRoomController,
    ProfessorController,
    ClassroomController,
  ],
  providers: [
    ResourceService,
    StudyRoomService,
    ProfessorService,
    ResourceMirrorService,
  ],
  exports: [ResourceService, StudyRoomService, ResourceMirrorService],
})
export class ResourceModule {}
