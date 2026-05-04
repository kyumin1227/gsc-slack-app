import { Module } from '@nestjs/common';
import { CleaningService } from './cleaning.service';
import { CleaningController } from './cleaning.controller';

@Module({
  controllers: [CleaningController],
  providers: [CleaningService],
})
export class CleaningModule {}
