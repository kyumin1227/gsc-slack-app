import { Test, TestingModule } from '@nestjs/testing';
import { SlackService } from 'nestjs-slack-bolt';
import { GoogleOAuthService } from '../google/oauth/google-oauth.service';
import { StudentClassService } from '../student-class/student-class.service';
import { UserController } from './controller/user.controller';
import { UserService } from './service/user.service';

describe('UserController', () => {
  let controller: UserController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: {} },
        { provide: SlackService, useValue: { client: {} } },
        { provide: StudentClassService, useValue: {} },
        { provide: GoogleOAuthService, useValue: {} },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
