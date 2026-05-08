import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CleaningController } from './cleaning.controller';
import { CleaningService } from './cleaning.service';
import { CleaningSchedule } from './cleaning-schedule.entity';
import { CleaningAssignment } from './cleaning-assignment.entity';
import { CleaningTrade } from './cleaning-trade.entity';
import { Resource } from '../resource/resource.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Resource,
      CleaningSchedule,
      CleaningAssignment,
      CleaningTrade,
    ]),
  ],
  controllers: [CleaningController],
  providers: [CleaningService],
})
export class CleaningModule {}
