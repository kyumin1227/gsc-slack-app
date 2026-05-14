import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserService } from './service/user.service';
import { UserAdminService } from './service/user-admin.service';
import { UserClassRepService } from './service/user-class-rep.service';
import { PermissionService } from './service/permission.service';
import { UserController } from './controller/user.controller';
import { UserAdminController } from './controller/user-admin.controller';
import { UserClassRepController } from './controller/user-class-rep.controller';
import { User } from './user.entity';
import { StudentClassModule } from '../student-class/student-class.module';
import { GoogleModule } from '../google/google.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), StudentClassModule, GoogleModule],
  controllers: [UserController, UserAdminController, UserClassRepController],
  providers: [
    UserService,
    UserAdminService,
    UserClassRepService,
    PermissionService,
  ],
  exports: [
    UserService,
    UserAdminService,
    UserClassRepService,
    PermissionService,
  ],
})
export class UserModule {}
