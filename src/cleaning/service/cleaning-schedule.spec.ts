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
import { Not } from 'typeorm';
import { content_v2_1 } from 'googleapis';
import { ScheduleClassRepController } from 'src/schedule/controller/schedule-class-rep.controller';

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
  let mockQb = {
    innerJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
  let tradeRepo: { createQueryBuilder: jest.Mock };
  let mockTradeQb = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
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

    mockQb = {
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
    tradeRepo = { createQueryBuilder: jest.fn() };
    mockTradeQb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    tradeRepo.createQueryBuilder.mockReturnValue(mockTradeQb);

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

      expect(result).toEqual({ count: 0, scheduleIds: [] });
    });

    it('담당인원 미설정 시 빈 배열 반환', async () => {
      ruleRepo.findOne.mockResolvedValue({
        id: 1,
        daysOfWeek: [1],
        needPeoples: 3,
      });
      ruleUserRepo.find.mockResolvedValue([]);

      const result = await service.generateSchedules(1);

      expect(result).toEqual({ count: 0, scheduleIds: [] });
    });

    it('담당인원이 필요 인원 수 보다 적은 경우 비즈니스 에러 처리', async () => {
      ruleRepo.findOne.mockResolvedValue({
        id: 1,
        daysOfWeek: [1],
        needPeoples: 3,
      });
      ruleUserRepo.find.mockResolvedValue([
        { id: 1, ruleId: 1, userId: 1 },
        { id: 2, ruleId: 1, userId: 2 },
      ]);

      await expect(service.generateSchedules(1)).rejects.toMatchObject({
        code: 'CLEANING:NOT_ENOUGH_USERS',
      });
    });

    it('동일 규칙에 생성할 일정이 중복되는 경우 겹치는 부분을 제외하고 생성', async () => {
      // 규칙
      ruleRepo.findOne.mockResolvedValue({
        id: 1,
        cycle: 1,
        daysOfWeek: [1],
        needPeoples: 3,
      });

      // 담당인원
      ruleUserRepo.find.mockResolvedValue([
        { id: 1, ruleId: 1, userId: 1 },
        { id: 2, ruldId: 1, userId: 2 },
        { id: 3, ruldId: 1, userId: 3 },
      ]);

      // 기존에 생성된 일정
      scheduleRepo.find.mockResolvedValue([
        { id: 1, ruleId: 1, cleaningDate: '2026-06-29' },
        { id: 2, ruleId: 1, cleaningDate: '2026-07-06' },
      ]);

      // 일정 저장
      scheduleRepo.save.mockResolvedValue({
        id: 10,
        ruleId: 1,
        cleaningDate: '2026-07-13',
      });
      // 기간 입력
      const result = await service.generateSchedules(
        1,
        '2026-06-29',
        '2026-07-13',
      );

      // 중복 일정 2개를 제외하고 1개 일정이 생성됨.
      expect(result.count).toBe(1);
    });

    it('기간 미입력시 담당 인원 / 필요 인원 수 만큼의 일정을 생성', async () => {
      // 날짜 고정 (mock)
      const RealDate = global.Date;
      jest
        .spyOn(global, 'Date')
        .mockImplementation(() => new RealDate('2026-06-29') as any);
      // 규칙
      ruleRepo.findOne.mockResolvedValue({
        id: 1,
        cycle: 1,
        daysOfWeek: [1],
        needPeoples: 3,
      });

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
      scheduleRepo.find.mockResolvedValue([]);
      // 일정 저장
      scheduleRepo.save
        .mockResolvedValueOnce({ id: 1, ruleId: 1, cleaningDate: '2026-06-29' })
        .mockResolvedValueOnce({ id: 2, ruleId: 1, cleaningDate: '2026-07-06' })
        .mockResolvedValueOnce({
          id: 3,
          ruleId: 1,
          cleaningDate: '2026-07-13',
        });

      // 기간 입력
      const result = await service.generateSchedules(1);

      // 담당 인원(9명) / 필요 인원 수(3명) = 3개의 일정 생성
      expect(result.count).toBe(3);

      // 날짜 원복
      jest.restoreAllMocks();
    });
    it('기간 미입력시 기존 일정 이후로 1사이클 배정', async () => {
      ruleRepo.findOne.mockResolvedValue({
        id: 1,
        daysOfWeek: [1],
        needPeoples: 3,
      });
      ruleUserRepo.find.mockResolvedValue([
        { id: 1, ruleId: 1, userId: 1 },
        { id: 2, ruleId: 1, userId: 2 },
        { id: 3, ruleId: 1, userId: 3 },
      ]);
      // lastSchedule = existing[0];
      scheduleRepo.find.mockResolvedValue([
        { id: 1, ruleId: 1, cleaningDate: '2026-06-22' },
      ]);
      scheduleRepo.save.mockResolvedValueOnce({
        id: 2,
        ruleId: 1,
        cleaningDate: '2026-06-29',
      });
      scheduleRepo.create.mockImplementation((v) => v);

      const result = await service.generateSchedules(1);

      expect(result.count).toBe(1);
    });
  });
  describe('findSchedulesByRule', () => {
    it('일정이 없으면 빈 배열 반환', async () => {
      scheduleRepo.find.mockResolvedValue([]);

      const result = await service.findSchedulesByRule(1);

      expect(result).toEqual([]);
    });

    it('일정이 있으면 담당자 포함 배열 반환', async () => {
      scheduleRepo.find.mockResolvedValue([
        {
          id: 1,
          ruleId: 1,
          cleaningDate: '2026-06-29',
          needPeoples: 2,
          status: CleaningScheduleStatus.SCHEDULED,
        },
      ]);

      mockQb.getRawMany.mockResolvedValue([
        {
          assignmentId: 1,
          scheduleId: 1,
          status: CleaningAssignmentStatus.ASSIGNED,
          userName: '테스트',
          userSlackId: 1,
        },
        {
          assignmentId: 2,
          scheduleId: 1,
          status: CleaningAssignmentStatus.ASSIGNED,
          userName: '테스트2',
          userSlackId: 2,
        },
      ]);
      const result = await service.findSchedulesByRule(1);

      expect(result).toEqual([
        {
          id: 1,
          cleaningDate: '2026-06-29',
          needPeoples: 2,
          status: CleaningScheduleStatus.SCHEDULED,
          assignees: [
            {
              assignmentId: 1,
              userSlackId: 1,
              userName: '테스트',
              status: CleaningAssignmentStatus.ASSIGNED,
            },
            {
              assignmentId: 2,
              userSlackId: 2,
              userName: '테스트2',
              status: CleaningAssignmentStatus.ASSIGNED,
            },
          ],
        },
      ]);
    });
  });
  describe('findOneScheduleWithAssignees', () => {
    it('존재하지 않는 일정 조회 시 null 반환', async () => {
      scheduleRepo.findOne.mockResolvedValue(null);

      const result = await service.findOneScheduleWithAssignees(1);

      expect(result).toBeNull();
    });

    it('일정이 있으면 담당자 포함 객체 반환', async () => {
      // 스케쥴 Mock
      scheduleRepo.findOne.mockResolvedValue({
        id: 1,
        ruldId: 1,
        cleaningDate: '2026-06-29',
        needPeoples: 2,
        status: CleaningScheduleStatus.SCHEDULED,
      });

      // 담당자 조회 쿼리 Mock
      mockQb.getRawMany.mockResolvedValue([
        {
          assignmentId: 1,
          scheduleId: 1,
          status: CleaningAssignmentStatus.ASSIGNED,
          userName: 'test',
          userSlackId: 1,
        },
        {
          assignmentId: 2,
          scheduleId: 1,
          status: CleaningAssignmentStatus.ASSIGNED,
          userName: 'test2',
          userSlackId: 2,
        },
      ]);

      // 메서드 실행 결과 저장
      const result = await service.findOneScheduleWithAssignees(1);

      // 담당자 목록 반환
      expect(result?.assignees).toEqual([
        {
          assignmentId: 1,
          status: CleaningAssignmentStatus.ASSIGNED,
          userName: 'test',
          userSlackId: 1,
        },
        {
          assignmentId: 2,
          status: CleaningAssignmentStatus.ASSIGNED,
          userName: 'test2',
          userSlackId: 2,
        },
      ]);
    });
  });

  describe('findSchedulesByIds', () => {
    it('ids가 빈 배열이면 조회 없이 빈 배열 반환', async () => {
      const result = await service.findSchedulesByIds([]);

      expect(result).toEqual([]);
      expect(scheduleRepo.find).not.toHaveBeenCalled();
    });

    it('일정이 있으면 담당자 포함 배열 반환', async () => {
      scheduleRepo.find.mockResolvedValue([
        {
          id: 1,
          ruleId: 1,
          cleaningDate: '2026-06-29',
          needPeoples: 2,
          status: CleaningScheduleStatus.SCHEDULED,
        },
      ]);

      mockQb.getRawMany.mockResolvedValue([
        {
          assignmentId: 1,
          scheduleId: 1,
          status: CleaningAssignmentStatus.ASSIGNED,
          userName: '테스트',
          userSlackId: 1,
        },
        {
          assignmentId: 2,
          scheduleId: 1,
          status: CleaningAssignmentStatus.ASSIGNED,
          userName: '테스트2',
          userSlackId: 2,
        },
      ]);

      const result = await service.findSchedulesByIds([1]);

      expect(result).toEqual([
        {
          id: 1,
          cleaningDate: '2026-06-29',
          needPeoples: 2,
          status: CleaningScheduleStatus.SCHEDULED,
          assignees: [
            {
              assignmentId: 1,
              userSlackId: 1,
              userName: '테스트',
              status: CleaningAssignmentStatus.ASSIGNED,
            },
            {
              assignmentId: 2,
              userSlackId: 2,
              userName: '테스트2',
              status: CleaningAssignmentStatus.ASSIGNED,
            },
          ],
        },
      ]);
    });
  });
  // 일정 수정 메서드 테스트
  describe('updateSchedule', () => {
    it('일정이 없으면 종료', async () => {
      scheduleRepo.findOne.mockResolvedValue(null);

      const result = await service.updateSchedule(1, {
        needPeoples: 2,
        status: CleaningScheduleStatus.SCHEDULED,
      });

      expect(result).toBeUndefined();
    });

    it('날짜 변경 시 같은 규칙 안에 동일 일정이 있으면 에러', async () => {
      scheduleRepo.findOne
        .mockResolvedValueOnce({
          ruleId: 1,
          cleaningDate: '2026-06-29',
        })
        .mockResolvedValueOnce({
          ruleId: 1,
          cleaningDate: '2026-07-06',
        });

      await expect(
        service.updateSchedule(1, {
          needPeoples: 2,
          status: CleaningScheduleStatus.SCHEDULED,
          cleaningDate: '2026-07-06',
        }),
      ).rejects.toMatchObject({ code: 'CLEANING:DUPLICATE_SCHEDULE_DATE' });
    });

    it('일정 취소 시 각 배정들을 CANCELED로 변경하고 cancelPendingTradesForAssignments호출', async () => {
      // 스케줄
      scheduleRepo.findOne.mockResolvedValue({
        id: 1,
        ruleId: 1,
        cleaningDate: '2026-06-29',
        needPeoples: 2,
        status: CleaningScheduleStatus.SCHEDULED,
      });

      // 배정된 인원
      assignmentRepo.find.mockResolvedValue([
        {
          id: 1,
          scheduleId: 1,
          userId: 1,
          status: CleaningAssignmentStatus.ASSIGNED,
        },
        {
          id: 2,
          scheduleId: 1,
          userId: 2,
          status: CleaningAssignmentStatus.ASSIGNED,
        },
      ]);

      // 일정 취소
      await service.updateSchedule(1, {
        needPeoples: 2,
        status: CleaningScheduleStatus.CANCELED,
      });

      // 결과 검증
      expect(assignmentRepo.update).toHaveBeenCalledWith([1, 2], {
        status: CleaningAssignmentStatus.CANCELED,
      });
      expect(tradeRepo.createQueryBuilder).toHaveBeenCalled();
      expect(mockTradeQb.andWhere).toHaveBeenCalledWith(expect.any(String), {
        ids: [1, 2],
      });
    });

    it('일정 취소 후 복원 시 CANCELED된 배정 ASSIGNED로 재활성화', async () => {
      // 취소된 스케줄
      scheduleRepo.findOne.mockResolvedValue({
        id: 1,
        ruleId: 1,
        cleaningDate: '2026-06-29',
        needPeoples: 2,
        status: CleaningScheduleStatus.CANCELED,
      });

      // 스케줄 CANCELED -> SCHEDULED
      await service.updateSchedule(1, {
        needPeoples: 2,
        status: CleaningScheduleStatus.SCHEDULED,
      });

      // 결과 검증
      expect(assignmentRepo.update).toHaveBeenCalledWith(
        { scheduleId: 1, status: CleaningAssignmentStatus.CANCELED },
        { status: CleaningAssignmentStatus.ASSIGNED },
      );
    });

    it('필요 인원 수 감소 시 뒤쪽 배정부터 초과분 CANCLE', async () => {
      // 스케줄
      scheduleRepo.findOne.mockResolvedValue({
        id: 1,
        ruleId: 1,
        cleaningDate: '2026-06-29',
        needPeoples: 2,
        status: CleaningScheduleStatus.SCHEDULED,
      });

      // 담당 인원
      assignmentRepo.find.mockResolvedValue([
        {
          id: 2,
          scheduleId: 1,
          userId: 2,
          status: CleaningAssignmentStatus.ASSIGNED,
        },
        {
          id: 1,
          scheduleId: 1,
          userId: 1,
          status: CleaningAssignmentStatus.ASSIGNED,
        },
      ]);

      // 인원 감소(updateSchedule)
      await service.updateSchedule(2, {
        needPeoples: 1,
        status: CleaningScheduleStatus.SCHEDULED,
      });

      // 결과 검증
      expect(assignmentRepo.update).toHaveBeenCalledWith([1], {
        status: CleaningAssignmentStatus.CANCELED,
      });
      expect(tradeRepo.createQueryBuilder).toHaveBeenCalled();
      expect(mockTradeQb.andWhere).toHaveBeenCalledWith(expect.any(String), {
        ids: [1],
      });
    });

    it('인원 증가 시 미배정 담당자 추가 배정(+ CANCELED 배정 재활성화)', async () => {
      // 스케줄
      scheduleRepo.findOne.mockResolvedValue({
        id: 1,
        ruleId: 1,
        cleaningDate: '2026-06-29',
        needPeoples: 1,
      });

      // 담당 인원
      assignmentRepo.find
        .mockResolvedValueOnce([
          {
            id: 1,
            scheduleId: 1,
            userId: 1,
            status: CleaningAssignmentStatus.ASSIGNED,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 2,
            scheduleId: 1,
            userId: 2,
            status: CleaningAssignmentStatus.CANCELED,
          },
        ]);

      // 신규 대상
      ruleUserRepo.find.mockResolvedValue([
        { ruleId: 1, userId: 1 }, // 기존 대상
        { ruleId: 1, userId: 2 }, // CANCELED된 인원
        { ruleId: 1, userId: 3 }, // 배정 대상
      ]);

      // 일정 수정
      await service.updateSchedule(1, {
        needPeoples: 3,
        status: CleaningScheduleStatus.SCHEDULED,
      });

      // 결과 검증
      expect(assignmentRepo.update).toHaveBeenCalledWith(2, {
        status: CleaningAssignmentStatus.ASSIGNED,
      });
      expect(assignmentRepo.create).toHaveBeenCalledWith({
        scheduleId: 1,
        userId: 3,
        status: CleaningAssignmentStatus.ASSIGNED,
      });
      expect(assignmentRepo.save).toHaveBeenCalled();
    });
  });

  // 배정 개별 수정
  describe('updateAssignmentStatuses', () => {
    it('배정 개별 수정', async () => {
      // 메서드 실행
      await service.updateAssignmentStatuses([
        { id: 1, status: CleaningAssignmentStatus.ASSIGNED },
        { id: 2, status: CleaningAssignmentStatus.CANCELED },
      ]);

      // 결과 검증
      expect(assignmentRepo.update).toHaveBeenCalledTimes(2);
      expect(assignmentRepo.update).toHaveBeenCalledWith(1, {
        status: CleaningAssignmentStatus.ASSIGNED,
      });
      expect(assignmentRepo.update).toHaveBeenCalledWith(2, {
        status: CleaningAssignmentStatus.CANCELED,
      });
    });
  });

  // 담당 인원 전원 배정
  describe('assignAllToSchedule', () => {
    it('취소된 일정에 전원 배정시 비즈니스 에러 처리', async () => {
      // 스케줄
      scheduleRepo.findOne.mockResolvedValue({
        id: 1,
        ruldId: 1,
        cleaningDate: '2026-06-29',
        needPeoples: 2,
        status: CleaningScheduleStatus.CANCELED,
      });

      // 결과 검증
      await expect(service.assignAllToSchedule(1)).rejects.toMatchObject({
        code: 'CLEANING:ASSIGNMENT_NOT_FOUND',
      });
    });

    it('담당 인원 전원 배정', async () => {
      // 스케줄
      scheduleRepo.findOne.mockResolvedValue({
        id: 1,
        ruldId: 1,
        cleaningDate: '2026-06-29',
        needPeoples: 1,
        status: CleaningScheduleStatus.SCHEDULED,
      });

      // 해당 규칙 담당인원
      ruleUserRepo.find.mockResolvedValue([
        { id: 1, ruleId: 1, userId: 1 },
        { id: 2, ruleId: 1, userId: 2 },
        { id: 3, ruleId: 1, userId: 3 },
      ]);

      // 배정된 인원
      assignmentRepo.find.mockResolvedValue([
        {
          id: 1,
          scheduleId: 1,
          userId: 1,
          status: CleaningAssignmentStatus.CANCELED,
        },
      ]);

      // 전원 배정 메서드
      await service.assignAllToSchedule(1);

      // 결과 검증
      // 1번 스케줄 필요 인원 수 1 -> 3(전체 담당 인원 수)
      expect(scheduleRepo.update).toHaveBeenCalledWith(1, {
        needPeoples: 3,
      });

      // CANCELED상태인 인원은 ASSIGNED로 변경
      expect(assignmentRepo.update).toHaveBeenCalledWith(1, {
        status: CleaningAssignmentStatus.ASSIGNED,
      });

      // 전체 담당 인원 배정
      expect(assignmentRepo.create).toHaveBeenCalledWith({
        scheduleId: 1,
        userId: 2,
        status: CleaningAssignmentStatus.ASSIGNED,
      });
      expect(assignmentRepo.create).toHaveBeenCalledWith({
        scheduleId: 1,
        userId: 3,
        status: CleaningAssignmentStatus.ASSIGNED,
      });
      expect(assignmentRepo.save).toHaveBeenCalledTimes(2);
    });
  });
});
