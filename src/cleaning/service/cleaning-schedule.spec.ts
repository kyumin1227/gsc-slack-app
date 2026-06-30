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
    
    const mockQb = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    assignmentRepo.createQueryBuilder.mockReturnValue(mockQb);

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

    it('동일 규칙에 생성할 일정이 중복되는 경우 겹치는 부분을 제외하고 생성', async () => {
      // 규칙
      ruleRepo.findOne.mockResolvedValue({ id: 1, cycle: 1, daysOfWeek: [1], needPeoples: 3})
      
      // 담당인원
      ruleUserRepo.find.mockResolvedValue([
        { id: 1, ruleId: 1, userId: 1 }, 
        { id: 2, ruldId: 1, userId: 2 },
        { id: 3, ruldId: 1, userId: 3 }
      ]);
      
      // 기존에 생성된 일정
      scheduleRepo.find.mockResolvedValue([
        {id: 1, ruleId: 1, cleaningDate: '2026-06-29'},
        {id: 2, ruleId: 1, cleaningDate: '2026-07-06'}
      ])
      
      // 일정 저장
      scheduleRepo.save.mockResolvedValue({
        id: 10, ruleId: 1, cleaningDate: '2026-07-13'
      })
      // 기간 입력
      const result = await service.generateSchedules(1, '2026-06-29', '2026-07-13')
      
      // 중복 일정 2개를 제외하고 1개 일정이 생성됨.
      expect(result.count).toBe(1);
    })

    it('기간 미입력시 담당 인원 / 필요 인원 수 만큼의 일정을 생성', async () => {
      // 날짜 고정 (mock)
      const RealDate = global.Date;
      jest.spyOn(global, 'Date').mockImplementation(() => new RealDate('2026-06-29') as any);
      // 규칙
      ruleRepo.findOne.mockResolvedValue({ id: 1, cycle: 1, daysOfWeek: [1], needPeoples: 3})

      // 담당인원
      ruleUserRepo.find.mockResolvedValue([
        { id: 1, ruleId: 1, userId: 1 }, 
        { id: 2, ruldId: 1, userId: 2 },
        { id: 3, ruldId: 1, userId: 3 },
        { id: 4, ruldId: 1, userId: 4 },
        { id: 5, ruldId: 1, userId: 5 },
        { id: 6, ruldId: 1, userId: 6 },
        { id: 7, ruldId: 1, userId: 7 },
        { id: 8, ruldId: 1, userId: 8 },
        { id: 9, ruldId: 1, userId: 9 },
      ]);
      // 일정
      scheduleRepo.find.mockResolvedValue([])
      // 일정 저장
      scheduleRepo.save
      .mockResolvedValueOnce({id: 1, ruleId: 1, cleaningDate: '2026-06-29'})
      .mockResolvedValueOnce({id: 2, ruleId: 1, cleaningDate: '2026-07-06'})
      .mockResolvedValueOnce({id: 3, ruleId: 1, cleaningDate: '2026-07-13'});
      
      // 기간 입력
      const result = await service.generateSchedules(1)
      
      // 담당 인원(9명) / 필요 인원 수(3명) = 3개의 일정 생성
      expect(result.count).toBe(3);
      
      // 날짜 원복
      jest.restoreAllMocks();
    })
    it('기간 미입력시 기존 일정 이후로 1사이클 배정', async () => {
      ruleRepo.findOne.mockResolvedValue({ id: 1, daysOfWeek: [1], needPeoples: 3 });
      ruleUserRepo.find.mockResolvedValue([
        { id: 1, ruleId: 1, userId: 1 },
        { id: 2, ruleId: 1, userId: 2 },
        { id: 3, ruleId: 1, userId: 3 },
      ]);
      // lastSchedule = existing[0];
      scheduleRepo.find.mockResolvedValue([
        { id: 1, ruleId: 1, cleaningDate: '2026-06-22'},
      ]);
      scheduleRepo.save
        .mockResolvedValueOnce({ id: 2, ruleId: 1, cleaningDate: '2026-06-29'});
      scheduleRepo.create.mockImplementation((v) => v);

      const result = await service.generateSchedules(1);

      expect(result.count).toBe(1);
    })
  })
});