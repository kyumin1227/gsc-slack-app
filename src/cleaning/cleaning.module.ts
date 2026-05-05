import { Module } from '@nestjs/common';
import { CleaningController } from './cleaning.controller';
import { CleaningService } from './cleaning.service';

@Module({
  controllers: [CleaningController],
  providers: [CleaningService]
})
export class CleaningModule {}
