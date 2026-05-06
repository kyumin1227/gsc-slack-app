import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CleaningController } from './cleaning.controller';
import { CleaningService } from './cleaning.service';
import { CleaningArea } from './cleaning-area.entity';
import { CleaningSchedule } from './cleaning-schedule.entity';
import { CleaningAssignment } from './cleaning-assignment.entity';
import { CleaningTrade } from './cleaning-trade.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CleaningArea,
      CleaningSchedule,
      CleaningAssignment,
      CleaningTrade,
    ]),
  ],
  controllers: [CleaningController],
  providers: [CleaningService],
})
export class CleaningModule {}
