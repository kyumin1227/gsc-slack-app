import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudyRoom } from './study-room.entity';
import { StudyRoomService } from './study-room.service';
import { StudyRoomController } from './study-room.controller';
import { UserModule } from '../user/user.module';

@Module({
  imports: [TypeOrmModule.forFeature([StudyRoom]), UserModule],
  controllers: [StudyRoomController],
  providers: [StudyRoomService],
  exports: [StudyRoomService],
})
export class StudyRoomModule {}
