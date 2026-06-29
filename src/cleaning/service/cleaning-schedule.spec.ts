// /<reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { CleaningScheduleService } from './cleaning-schedule.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  CleaningSchedule,
  CleaningScheduleStatus,
} from '../entity/cleaning-schedule.entity';
import { CleaningRule } from '../entity/cleaning-rule.entity';
import { CleaningRuleUser } from '../entity/cleaning-rule-user.entity';
import {
  CleaningAssignment,
  CleaningAssignmentStatus,
} from '../entity/cleaning-assignment.entity';
import {
  CleaningTrade,
  CleaningTradeStatus,
} from '../entity/cleaning-trade.entity';
import { BusinessError, CleaningErrorCode } from '../../common/errors';

describe('CleaningScheduleService', () => {
  let service: CleaningScheduleService;
  let scheduleRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let assignmentRepo: {
    find: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let ruleRepo: {
    findOne: jest.Mock;
  };
  let ruleUserRepo: {
    find: jest.Mock;
    delete: jest.Mock;
  };
  let tradeRepo: {
    createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    scheduleRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };
    assignmentRepo = {
      find: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    ruleRepo = {
      findOne: jest.fn(),
    };
    ruleUserRepo = {
      find: jest.fn(),
      delete: jest.fn(),
    };
    tradeRepo = {
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CleaningScheduleService,
        {
          provide: getRepositoryToken(CleaningSchedule),
          useValue: scheduleRepo,
        },
        {
          provide: getRepositoryToken(CleaningAssignment),
          useValue: assignmentRepo,
        },
        {
          provide: getRepositoryToken(CleaningRule),
          useValue: ruleRepo,
        },
        {
          provide: getRepositoryToken(CleaningRuleUser),
          useValue: ruleUserRepo,
        },
        {
          provide: getRepositoryToken(CleaningTrade),
          useValue: tradeRepo,
        },
      ],
    }).compile();

    service = module.get<CleaningScheduleService>(CleaningScheduleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateSchedules', () => {
    it('배정 중 규칙이 삭제 된 경우 빈 배열 반환', async () => {
      ruleRepo.findOne.mockResolvedValue(null);

      const result = await service.generateSchedules(1);

      expect(result).toEqual({count: 0, scheduleIds: []});
    })

    it('담당인원 미설정 시 빈 배열 반환', async () => {
      ruleRepo.findOne.mockResolvedValue({ id: 1, daysOfWeek: [1], needPeoples: 3 });
      ruleUserRepo.find.mockResolvedValue([]);

      const result = await service.generateSchedules(1);

      expect(result).toEqual({count: 0, scheduleIds: []});
    })

    it('담당인원이 필요 인원 수 보다 적은 경우 비즈니스 에러 처리', async () => {
      ruleRepo.findOne.mockResolvedValue({ id: 1, daysOfWeek: [1], needPeoples: 3})
      ruleUserRepo.find.mockResolvedValue([
        { id: 1, ruleId: 1, userId: 1 }, 
        { id: 2, ruleId: 1, userId: 2 }
      ]);

      await expect(service.generateSchedules(1)).rejects.toMatchObject({
        code: 'CLEANING:NOT_ENOUGH_USERS',
      });
    })
  })
});
