import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudentClass } from './student-class.entity';
import { StudentClassService } from './student-class.service';
import { TagModule } from '../tag/tag.module';

@Module({
  imports: [TypeOrmModule.forFeature([StudentClass]), TagModule],
  providers: [StudentClassService],
  exports: [StudentClassService],
})
export class StudentClassModule {}
