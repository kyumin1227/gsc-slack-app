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
    update: jest.fn().mockReturnThis(),
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
      update: jest.fn().mockReturnThis(),
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

  describe('respondTrade', () => {
    it('수락 시 교환 요청을 찾을 수 없거나 PENDING상태가 아니면 비즈니스 에러 처리', async () => {
      tradeRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
        status: CleaningTradeStatus.CANCELED,
      });

      await expect(service.respondTrade(1, 1, true)).rejects.toMatchObject({
        // tradeId, tergetUserId, accept
        code: 'CLEANING:TRADE_NOT_FOUND',
      });

      await expect(service.respondTrade(2, 1, true)).rejects.toMatchObject({
        code: 'CLEANING:TRADE_NOT_PENDING',
      });
    });

    it('대상 배정을 찾지 못했거나 대상자와 수락한 인원이 다른 경우 비즈니스 에러 처리', async () => {
      // 교환 요청
      tradeRepo.findOne.mockResolvedValue({
        targetAssignmentId: 4,
        status: CleaningTradeStatus.PENDING,
      });

      // 배정
      assignmentRepo.findOne.mockResolvedValueOnce(null).mockResolvedValue({
        id: 4,
        userId: 2,
      });

      // tradeId, targetUserId, accept
      // 배정을 못찾은 경우 (null)
      await expect(service.respondTrade(999, 999, true)).rejects.toMatchObject({
        code: 'CLEANING:TRADE_FORBIDDEN',
      });
      // id: 4인 배정의 유저id는 2. 수락을 시도한 인원의 id는 1이므로 비즈니스 에러 처리
      await expect(service.respondTrade(5, 1, true)).rejects.toMatchObject({
        code: 'CLEANING:TRADE_FORBIDDEN',
      });

      // 거절 시 상태값만 변경 ( PENDING -> REJECTED )
      await service.respondTrade(1, 2, false);

      expect(tradeRepo.update).toHaveBeenCalledWith(1, {
        status: CleaningTradeStatus.REJECTED,
      });
    });

    it('정상적인 요청 수락 시 교환 상태값 PENDING -> ACCEPTED', async () => {
      // 교환 요청
      tradeRepo.findOne.mockResolvedValue({
        requesterAssignmentId: 1,
        targetAssignmentId: 4,
        status: CleaningTradeStatus.PENDING,
      });

      // 요청 배정 -> 대상 배정
      assignmentRepo.findOne.mockResolvedValueOnce({
        id: 4,
        userId: 2,
      });
      // swapAssignments
      const swapAssignmentsSpy = jest
        .spyOn(service, 'swapAssignments')
        .mockResolvedValueOnce();

      await service.respondTrade(1, 2, true);

      expect(swapAssignmentsSpy).toHaveBeenCalledWith(1, 4); // requester, target id

      expect(tradeRepo.update).toHaveBeenCalledWith(1, {
        status: CleaningTradeStatus.ACCEPTED,
      });
    });
  });

  describe('swapAssignments', () => {
    it('배정을 찾을 수 없거나 일정id가 동일하면 비즈니스 에러 처리', async () => {
      assignmentRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 1,
          scheduleId: 1,
          userId: 1,
        })
        .mockResolvedValueOnce({
          id: 3,
          scheduleId: 1,
          userId: 3,
        });

      // 배정이 존재하지 않는 경우
      await expect(service.swapAssignments(9, 17)).rejects.toMatchObject({
        code: 'CLEANING:ASSIGNMENT_NOT_FOUND',
      });

      // 동일 일정id에 대한 교환 요청을 수락한 경우
      await expect(service.swapAssignments(1, 3)).rejects.toMatchObject({
        code: 'CLEANING:TRADE_SAME_SCHEDULE',
      });
    });

    it('스왑 후 유저가 중복되면 비즈니스 에러 처리', async () => {
      assignmentRepo.findOne
        // a1, a2
        .mockResolvedValueOnce({
          id: 1,
          scheduleId: 1,
          userId: 1,
        })
        .mockResolvedValueOnce({
          id: 4,
          scheduleId: 2,
          userId: 2,
        })
        // conflict1
        .mockResolvedValueOnce({
          id: 5,
          scheduleId: 2,
          userId: 1,
        })
        .mockResolvedValueOnce(null);

      // 스왑 후 중복되면 비즈니스 에러 처리
      await expect(service.swapAssignments(1, 4)).rejects.toMatchObject({
        code: 'CLEANING:TRADE_DUPLICATE_ASSIGNEE',
      });
    });

    it('정상 동작시 userId를 교환하고 관련 다른 요청은 PENDING에서 CANCELED로 변경', async () => {
      assignmentRepo.findOne
        // a1, a2
        .mockResolvedValueOnce({
          id: 1,
          scheduleId: 1,
          userId: 1,
        })
        .mockResolvedValueOnce({
          id: 4,
          scheduleId: 2,
          userId: 2,
        })
        // conflict
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      await service.swapAssignments(1, 4);

      // 두 배정(1, 4)과 관련된 다른 PENDING교환 CANCELED 처리
      expect(tradeMockQb.update).toHaveBeenCalledWith(CleaningTrade);

      expect(tradeMockQb.set).toHaveBeenCalledWith({
        status: CleaningTradeStatus.CANCELED,
      });

      expect(tradeMockQb.where).toHaveBeenCalledWith('status = :status', {
        status: CleaningTradeStatus.PENDING,
      });

      expect(tradeMockQb.andWhere).toHaveBeenCalledWith(
        '(requesterAssignmentId IN (:...ids) OR targetAssignmentId IN (:...ids))',
        { ids: [1, 4] },
      );

      expect(tradeMockQb.execute).toHaveBeenCalledTimes(1);

      // assginment는 유지하고 userId만 교환
      expect(assignmentRepo.update).toHaveBeenCalledWith(1, { userId: 2 });
      expect(assignmentRepo.update).toHaveBeenCalledWith(4, { userId: 1 });
    });
  });

  describe('getAssignmentDetail', () => {
    it('배정을 찾을 수 없는 경우 null 반환', async () => {
      assignMockQb.getRawOne.mockResolvedValueOnce(null);

      const result = await service.getAssignmentDetail(1);

      expect(result).toBeNull();
    });

    it('알림/모달에서 사용할 배정 상세 정보 반환', async () => {
      assignMockQb.getRawOne.mockResolvedValueOnce({
        id: 1,
        scheduleId: 1,
        userId: 1,
        userName: '테스트',
        userCode: '1234',
        userSlackId: 'U1',
        cleaningDate: '2026-07-13',
        resourceName: '511호',
      });

      const result = await service.getAssignmentDetail(1);

      expect(result).toEqual({
        id: 1,
        scheduleId: 1,
        userId: 1,
        userName: '테스트',
        userCode: '1234',
        userSlackId: 'U1',
        cleaningDate: '2026-07-13',
        resourceName: '511호',
      });
    });
  });

  describe('getAssignmentsByRule', () => {
    it('특정 규칙의 예정 배정만 반환한다.', async () => {
      // 예정 배정 조회 테스트를 위해 시간 고정
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2026, 6, 12));

      assignMockQb.getRawMany.mockResolvedValueOnce([
        {
          id: 1,
          scheduleId: 1,
          userId: 1,
          userName: '테스트',
          userCode: '1234',
          userSlackId: 'U1',
          cleaningDate: '2026-07-13',
          resourceName: '511호',
        },
      ]);

      const result = await service.getAssignmentsByRule(1);

      // 오늘 이후의 일정을 조회하는지 검증
      expect(assignMockQb.andWhere).toHaveBeenCalledWith(
        's.cleaningDate >= :today',
        { today: '2026-07-12' },
      );

      // 조건에 맞는 배정 반환
      await expect(result).toEqual([
        {
          id: 1,
          scheduleId: 1,
          userId: 1,
          userName: '테스트',
          userCode: '1234',
          userSlackId: 'U1',
          cleaningDate: '2026-07-13',
          resourceName: '511호',
        },
      ]);

      // 시간 정상화
      jest.useRealTimers();
    });
  });

  describe('getTradeWithDetails', () => {
    const requester = {
      id: 1,
      scheduleId: 10,
      userId: 1,
      userName: '요청한놈',
      userCode: '1234',
      userSlackId: 'U1',
      cleaningDate: '2026-07-13',
      resourceName: '511호',
    };

    const target = {
      id: 4,
      scheduleId: 2,
      userId: 2,
      userName: '요청받은 놈',
      userCode: '5678',
      userSlackId: 'U2',
      cleaningDate: '2026-07-20',
      resourceName: '511호',
    };

    it('교환 요청을 찾을 수 없으면 null 반환', async () => {
      tradeRepo.findOne.mockResolvedValueOnce(null);

      // 메서드 호출
      const result = await service.getTradeWithDetails(1);

      // null 반환
      expect(result).toBeNull();

      // tradeId 1로 조회했는지 확인
      expect(tradeRepo.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });
  });
});
