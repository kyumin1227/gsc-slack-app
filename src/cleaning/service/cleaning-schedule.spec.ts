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
import { BusinessError, CleaningErrorCode } from 'src/common/errors';

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
});
