import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  CleaningAssignment,
  CleaningAssignmentStatus,
} from '../entity/cleaning-assignment.entity';
import {
  CleaningTrade,
  CleaningTradeStatus,
} from '../entity/cleaning-trade.entity';
import { CleaningTradeService } from './cleaning-trade.service';

describe('CleaningTradeService', () => {
  let service: CleaningTradeService;
  let assignmentRepo: {
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let assignMockQb = {
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
    getRawOne: jest.fn().mockResolvedValue([]),
  };
  let tradeRepo: {
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
  };
  let tradeMockQb = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  beforeEach(async () => {
    assignmentRepo = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };
    assignMockQb = {
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue([]),
    };
    assignmentRepo.createQueryBuilder.mockReturnValue(assignMockQb);
    tradeRepo = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    };
    tradeMockQb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
      execute: jest.fn().mockResolvedValue([]),
    };
    tradeRepo.createQueryBuilder.mockReturnValue(tradeMockQb);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CleaningTradeService,
        {
          provide: getRepositoryToken(CleaningAssignment),
          useValue: assignmentRepo,
        },
        {
          provide: getRepositoryToken(CleaningTrade),
          useValue: tradeRepo,
        },
      ],
    }).compile();

    service = module.get<CleaningTradeService>(CleaningTradeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getMyAssignments', () => {
    it('배정이 없으면 빈 배열 반환', async () => {
      const result = await service.getMyAssignments(1);

      expect(result).toEqual([]);
    });

    it('내 예정 배정을 함께하는 인원 이름과 함께 반환', async () => {
      // 첫 호출: 내 배정 목록, 이후 호출: 같은 일정의 다른 담당자 이름
      assignMockQb.getRawMany
        .mockResolvedValueOnce([
          {
            id: 1,
            scheduleId: 10,
            userId: 1,
            userName: '테스트',
            userCode: '20240001',
            userSlackId: 'U1',
            cleaningDate: '2026-07-13',
            resourceName: '강의실',
          },
        ])
        .mockResolvedValueOnce([{ name: '테스트2' }]);

      const result = await service.getMyAssignments(1);

      expect(result).toEqual([
        {
          id: 1,
          scheduleId: 10,
          userId: 1,
          userName: '테스트',
          userCode: '20240001',
          userSlackId: 'U1',
          cleaningDate: '2026-07-13',
          resourceName: '강의실',
          coAssignees: ['테스트2'],
        },
      ]);
    });
  });

  describe('getMyPendingRequests', () => {
    it('요청한 교환/대상 배정 정보를 반환한다.', async () => {
      // 교환 요청 2개
      tradeMockQb.getRawMany.mockResolvedValueOnce([{ t_id: 1 }, { t_id: 2 }]);

      // 교환 정보
      tradeRepo.findOne.mockResolvedValueOnce({
        id: 1,
        requesterAssignmentId: 1,
        targetAssignmentId: 3,
        status: CleaningTradeStatus.PENDING,
      });

      // 배정 정보 ( getTradeWithDetails -> getAssignmentDetail)
      assignMockQb.getRawOne
        .mockResolvedValueOnce({
          id: 1,
          scheduleId: 1,
          userId: 1,
          userName: '요청한놈',
          userCode: '1234',
          userSlackId: 'S1',
          cleaningDate: '2026-07-13',
          resourceName: '511호',
        })
        .mockResolvedValueOnce({
          id: 4,
          scheduleId: 2,
          userId: 4,
          userName: '요청받은 놈',
          userCode: '5678',
          userSlackId: 'S2',
          cleaningDate: '2026-07-20',
          resourceName: '511호',
        });

      // 메서드 호출
      const result = await service.getMyPendingRequests(1);

      // 결과 검증
      expect(result).toEqual([
        {
          trade: { id: 1 },
          myAssignment: {
            id: 1,
            scheduleId: 1,
            userId: 1,
            userName: '요청한놈',
            userCode: '1234',
            userSlackId: 'S1',
            cleaningDate: '2026-07-13',
            resourceName: '511호',
          },
          targetAssignment: {
            id: 4,
            scheduleId: 2,
            userId: 4,
            userName: '요청받은 놈',
            userCode: '5678',
            userSlackId: 'S2',
            cleaningDate: '2026-07-20',
            resourceName: '511호',
          },
        },
      ]);
    });
  });
});
