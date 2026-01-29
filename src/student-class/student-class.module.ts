import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudentClass } from './student-class.entity';
import { StudentClassService } from './student-class.service';

@Module({
  imports: [TypeOrmModule.forFeature([StudentClass])],
  providers: [StudentClassService],
  exports: [StudentClassService],
})
export class StudentClassModule {}
