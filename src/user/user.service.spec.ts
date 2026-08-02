import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserService } from './service/user.service';
import { User, UserRole, UserStatus } from './user.entity';

describe('UserService', () => {
  let service: UserService;
  let userRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isAdmin', () => {
    it('should return true for an active professor', async () => {
      userRepo.findOne.mockResolvedValue({
        slackId: 'U123',
        role: UserRole.PROFESSOR,
        status: UserStatus.ACTIVE,
      });

      const result = await service.isAdmin('U123');

      expect(result).toBe(true);
    });

    it('should return false when user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);

      const result = await service.isAdmin('U123');

      expect(result).toBe(false);
    });

    it('should return false for an active student', async () => {
      userRepo.findOne.mockResolvedValue({
        slackId: 'U123',
        role: UserRole.STUDENT,
        status: UserStatus.ACTIVE,
      });

      const result = await service.isAdmin('U123');

      expect(result).toBe(false);
    });
  });
});
