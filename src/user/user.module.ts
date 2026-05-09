import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserService } from './service/user.service';
import { UserAdminService } from './service/user-admin.service';
import { UserClassRepService } from './service/user-class-rep.service';
import { UserController } from './user.controller';
import { User } from './user.entity';
import { StudentClassModule } from '../student-class/student-class.module';
import { PermissionService } from './service/permission.service';
import { GoogleModule } from '../google/google.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), StudentClassModule, GoogleModule],
  controllers: [UserController],
  providers: [UserService, UserAdminService, UserClassRepService, PermissionService],
  exports: [UserService, UserAdminService, UserClassRepService, PermissionService],
})
export class UserModule {}
