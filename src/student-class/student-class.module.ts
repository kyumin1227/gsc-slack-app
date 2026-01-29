import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudentClass } from './student-class.entity';
import { StudentClassService } from './student-class.service';
import { StudentClassController } from './student-class.controller';
import { TagModule } from '../tag/tag.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([StudentClass]),
    TagModule,
    forwardRef(() => UserModule),
  ],
  controllers: [StudentClassController],
  providers: [StudentClassService],
  exports: [StudentClassService],
})
export class StudentClassModule {}
