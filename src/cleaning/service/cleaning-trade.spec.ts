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

  describe('getTradeTargets', () => {
    it('내 배정이 없으면 빈 배열 반환', async () => {
      assignmentRepo.findOne.mockResolvedValue(null);

      const result = await service.getTradeTargets(1, 1);

      expect(result).toEqual([]);
    });

    it('교환 요청 대상이 중복되거나 같은 일정에 있는 대상은 목록에서 제외', async () => {
      // 내 배정
      assignmentRepo.findOne.mockResolvedValue({ id: 1, scheduleId: 1 });

      // 내 일정에 배정된 유저 목록
      // 교환 후보 배정 목록
      assignMockQb.getRawMany
        .mockResolvedValueOnce([{ userId: 1 }, { userId: 2 }]) // myScheduleUsers
        .mockResolvedValueOnce([
          // rows
          {
            id: 4,
            scheduleId: 2,
            userId: 4,
            userName: '정상후보',
            userCode: '1',
            userSlackId: 'S4',
            cleaningDate: '2026-07-20',
            resourceName: '511호',
          },
          {
            id: 6,
            scheduleId: 3,
            userId: 5,
            userName: '교환대기중',
            userCode: '2',
            userSlackId: 'S5',
            cleaningDate: '2026-07-27',
            resourceName: '511호',
          },
          {
            id: 7,
            scheduleId: 4,
            userId: 2,
            userName: '같은일정',
            userCode: '3',
            userSlackId: 'S2',
            cleaningDate: '2026-08-03',
            resourceName: '511호',
          },
        ]);

      // PENDING 교환에 걸려있는 배정: 5번, 6번
      tradeMockQb.getRawMany.mockResolvedValueOnce([
        { t_requesterAssignmentId: 5, t_targetAssignmentId: 6 },
      ]);

      const result = await service.getTradeTargets(1, 1);

      // 6번(교환 대기 중), 7번(내 일정에 이미 있는 유저)은 제외되고 4번만 남는다
      expect(result).toEqual([
        {
          id: 4,
          scheduleId: 2,
          userId: 4,
          userName: '정상후보',
          userCode: '1',
          userSlackId: 'S4',
          cleaningDate: '2026-07-20',
          resourceName: '511호',
        },
      ]);
    });
  });

  describe('requestTrade', () => {
    it('동일 대상 중복 요청시 비즈니스 에러 처리', async () => {
      tradeRepo.findOne.mockResolvedValueOnce({
        requesterAssignmentId: 1,
        targetAssignmentId: 4,
        status: CleaningTradeStatus.PENDING,
      });

      // 결과 검증
      await expect(service.requestTrade(1, 4)).rejects.toMatchObject({
        code: 'CLEANING:TRADE_ALREADY_PENDING',
      });

      // 매개변수를 해당 조건으로 전달받았는지 확인
      expect(tradeRepo.findOne).toHaveBeenCalledWith({
        where: {
          requesterAssignmentId: 1,
          targetAssignmentId: 4,
          status: CleaningTradeStatus.PENDING,
        },
      });

      // 비즈니스 에러처리 후엔 create, save 작동 X
      expect(tradeRepo.create).not.toHaveBeenCalled();
      expect(tradeRepo.save).not.toHaveBeenCalled();
    });

    it('중복 요청이 없으면 교환 요청을 생성하고 저장한 뒤 반환', async () => {
      // 중복 체크
      tradeRepo.findOne.mockResolvedValue(undefined);

      // 생성할거
      const createdTrade = {
        requesterAssignmentId: 1,
        targetAssignmentId: 4,
        status: CleaningTradeStatus.PENDING,
      };

      // 저장할거
      const savedTrade = {
        id: 1,
        createdTrade,
      };

      // 메서드 호출 시 반환시킬거
      tradeRepo.create.mockReturnValueOnce(createdTrade);
      tradeRepo.save.mockResolvedValueOnce(savedTrade);

      const result = await service.requestTrade(1, 4);

      // 결과 검증
      expect(tradeRepo.create).toHaveBeenCalledWith({
        requesterAssignmentId: 1,
        targetAssignmentId: 4,
        status: CleaningTradeStatus.PENDING,
      });

      expect(tradeRepo.save).toHaveBeenLastCalledWith(createdTrade);

      expect(result).toEqual(savedTrade);
    });
  });
});
