import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CleaningAssignment,
  CleaningAssignmentStatus,
} from '../entity/cleaning-assignment.entity';
import { CleaningTrade, CleaningTradeStatus } from '../entity/cleaning-trade.entity';
import { CleaningScheduleStatus } from '../entity/cleaning-schedule.entity';
import { BusinessError, CleaningErrorCode } from '../../common/errors';

export interface AssignmentDetail {
  id: number;
  scheduleId: number;
  userId: number;
  userName: string;
  userCode?: string;
  userSlackId: string;
  cleaningDate: string;
  resourceName: string;
  coAssignees?: string[];
}

@Injectable()
export class CleaningTradeService {
  constructor(
    @InjectRepository(CleaningAssignment)
    private readonly assignmentRepo: Repository<CleaningAssignment>,
    @InjectRepository(CleaningTrade)
    private readonly tradeRepo: Repository<CleaningTrade>,
  ) {}

  // 내 예정 배정만 조회하고, 같은 일정의 다른 담당자 이름도 함께 보여준다.
  async getMyAssignments(userId: number): Promise<AssignmentDetail[]> {
    const today = localTodayStr();
    const rows = await this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoin('a.schedule', 's')
      .innerJoin('s.rule', 'r')
      .innerJoin('a.user', 'u')
      .leftJoin('r.ruleResource', 'rr')
      .leftJoin('rr.resource', 'res')
      .select([
        'a.id AS id',
        'a.scheduleId AS "scheduleId"',
        'a.userId AS "userId"',
        'u.name AS "userName"',
        'u.code AS "userCode"',
        'u.slackId AS "userSlackId"',
        's.cleaningDate AS "cleaningDate"',
        'res.name AS "resourceName"',
      ])
      .where('a.userId = :userId', { userId })
      .andWhere('a.status = :status', { status: CleaningAssignmentStatus.ASSIGNED })
      .andWhere('s.cleaningDate >= :today', { today })
      .andWhere('s.status = :schedStatus', { schedStatus: CleaningScheduleStatus.SCHEDULED })
      .andWhere('r.deletedAt IS NULL')
      .orderBy('s.cleaningDate', 'ASC')
      .getRawMany<{
        id: number;
        scheduleId: number;
        userId: number;
        userName: string;
        userCode: string;
        userSlackId: string;
        cleaningDate: string;
        resourceName: string;
      }>();

    const result: AssignmentDetail[] = [];
    for (const row of rows) {
      const coAssignees = await this.getCoAssigneeNames(row.scheduleId, userId);
      result.push({
        id: Number(row.id),
        scheduleId: Number(row.scheduleId),
        userId: Number(row.userId),
        userName: row.userName,
        userCode: row.userCode ?? undefined,
        userSlackId: row.userSlackId,
        cleaningDate: toDateStr(row.cleaningDate),
        resourceName: row.resourceName ?? '미지정',
        coAssignees,
      });
    }
    return result;
  }

  // 요청자가 보낸 PENDING 교환만 모아 요청/대상 배정 정보를 함께 반환한다.
  async getMyPendingRequests(userId: number): Promise<
    {
      trade: { id: number };
      myAssignment: AssignmentDetail;
      targetAssignment: AssignmentDetail;
    }[]
  > {
    const trades = await this.tradeRepo
      .createQueryBuilder('t')
      .innerJoin('t.requesterAssignment', 'ra')
      .where('ra.userId = :userId', { userId })
      .andWhere('t.status = :status', { status: CleaningTradeStatus.PENDING })
      .select('t.id')
      .getRawMany<{ t_id: number }>();

    const result: { trade: { id: number }; myAssignment: AssignmentDetail; targetAssignment: AssignmentDetail }[] = [];
    for (const { t_id } of trades) {
      const detail = await this.getTradeWithDetails(t_id);
      if (detail)
        result.push({
          trade: { id: t_id },
          myAssignment: detail.requester,
          targetAssignment: detail.target,
        });
    }
    return result;
  }

  // 이미 같은 일정에 있는 유저나 대기 중인 교환 배정은 교환 후보에서 제외한다.
  async getTradeTargets(
    assignmentId: number,
    myUserId: number,
  ): Promise<AssignmentDetail[]> {
    const myAssignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId },
    });
    if (!myAssignment) return [];

    const today = localTodayStr();

    // 요청자의 일정에 이미 있는 유저 ID 목록
    const myScheduleUsers = await this.assignmentRepo
      .createQueryBuilder('a')
      .select('a.userId', 'userId')
      .where('a.scheduleId = :schedId', { schedId: myAssignment.scheduleId })
      .andWhere('a.status != :canceled', { canceled: CleaningAssignmentStatus.CANCELED })
      .getRawMany<{ userId: number }>();
    const myScheduleUserIds = new Set(myScheduleUsers.map((r) => Number(r.userId)));

    // 이미 처리 대기 중인 배정은 중복 교환 요청을 막기 위해 후보에서 제외한다.
    const pendingTrades = await this.tradeRepo
      .createQueryBuilder('t')
      .select(['t.requesterAssignmentId', 't.targetAssignmentId'])
      .where('t.status = :status', { status: CleaningTradeStatus.PENDING })
      .getRawMany<{ t_requesterAssignmentId: number; t_targetAssignmentId: number }>();
    const pendingIds = new Set<number>();
    for (const { t_requesterAssignmentId, t_targetAssignmentId } of pendingTrades) {
      pendingIds.add(Number(t_requesterAssignmentId));
      pendingIds.add(Number(t_targetAssignmentId));
    }

    const rows = await this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoin('a.schedule', 's')
      .innerJoin('s.rule', 'r')
      .innerJoin('a.user', 'u')
      .leftJoin('r.ruleResource', 'rr')
      .leftJoin('rr.resource', 'res')
      .select([
        'a.id AS id',
        'a.scheduleId AS "scheduleId"',
        'a.userId AS "userId"',
        'u.name AS "userName"',
        'u.code AS "userCode"',
        'u.slackId AS "userSlackId"',
        's.cleaningDate AS "cleaningDate"',
        'res.name AS "resourceName"',
      ])
      .where('a.status = :status', { status: CleaningAssignmentStatus.ASSIGNED })
      .andWhere('a.scheduleId != :mySchedule', { mySchedule: myAssignment.scheduleId })
      .andWhere('s.cleaningDate >= :today', { today })
      .andWhere('s.status = :schedStatus', { schedStatus: CleaningScheduleStatus.SCHEDULED })
      .andWhere('r.deletedAt IS NULL')
      .orderBy('s.cleaningDate', 'ASC')
      .getRawMany<{
        id: number;
        scheduleId: number;
        userId: number;
        userName: string;
        userCode: string;
        userSlackId: string;
        cleaningDate: string;
        resourceName: string;
      }>();

    return rows
      .filter(
        (r) =>
          !pendingIds.has(Number(r.id)) &&
          // 교환 후 내 일정에 같은 사람이 중복 배정되는 후보도 제외한다.
          !myScheduleUserIds.has(Number(r.userId)),
      )
      .map((r) => ({
        id: Number(r.id),
        scheduleId: Number(r.scheduleId),
        userId: Number(r.userId),
        userName: r.userName,
        userCode: r.userCode ?? undefined,
        userSlackId: r.userSlackId,
        cleaningDate: toDateStr(r.cleaningDate),
        resourceName: r.resourceName ?? '미지정',
      }));
  }

  // 같은 대상에 대해 이미 대기 중인 요청이 있으면 중복 요청을 만들지 않는다.
  async requestTrade(
    requesterAssignmentId: number,
    targetAssignmentId: number,
  ): Promise<CleaningTrade> {
    const existing = await this.tradeRepo.findOne({
      where: {
        requesterAssignmentId,
        targetAssignmentId,
        status: CleaningTradeStatus.PENDING,
      },
    });
    if (existing) throw new BusinessError(CleaningErrorCode.TRADE_ALREADY_PENDING);

    return this.tradeRepo.save(
      this.tradeRepo.create({
        requesterAssignmentId,
        targetAssignmentId,
        status: CleaningTradeStatus.PENDING,
      }),
    );
  }

  // 수락 시 실제 배정의 userId를 맞바꾸고, 거절 시 요청 상태만 변경한다.
  async respondTrade(
    tradeId: number,
    targetUserId: number,
    accept: boolean,
  ): Promise<void> {
    const trade = await this.tradeRepo.findOne({ where: { id: tradeId } });
    if (!trade) throw new BusinessError(CleaningErrorCode.TRADE_NOT_FOUND);
    if (trade.status !== CleaningTradeStatus.PENDING)
      throw new BusinessError(CleaningErrorCode.TRADE_NOT_PENDING);

    // 대상 배정의 담당자만 수락/거절할 수 있다.
    const targetAssignment = await this.assignmentRepo.findOne({
      where: { id: trade.targetAssignmentId },
    });
    if (!targetAssignment || targetAssignment.userId !== targetUserId)
      throw new BusinessError(CleaningErrorCode.TRADE_FORBIDDEN);

    if (!accept) {
      await this.tradeRepo.update(tradeId, { status: CleaningTradeStatus.REJECTED });
      return;
    }

    await this.swapAssignments(
      trade.requesterAssignmentId,
      trade.targetAssignmentId,
    );
    await this.tradeRepo.update(tradeId, { status: CleaningTradeStatus.ACCEPTED });
  }

  // 두 배정의 담당자를 바꾸기 전에 같은 일정/중복 담당자 충돌을 먼저 막는다.
  async swapAssignments(id1: number, id2: number): Promise<void> {
    const [a1, a2] = await Promise.all([
      this.assignmentRepo.findOne({ where: { id: id1 } }),
      this.assignmentRepo.findOne({ where: { id: id2 } }),
    ]);
    if (!a1 || !a2) throw new BusinessError(CleaningErrorCode.ASSIGNMENT_NOT_FOUND);
    if (a1.scheduleId === a2.scheduleId)
      throw new BusinessError(CleaningErrorCode.TRADE_SAME_SCHEDULE);

    // 스왑 후 같은 일정에 같은 유저가 두 번 배정되는지 체크한다.
    const [conflict1, conflict2] = await Promise.all([
      this.assignmentRepo.findOne({
        where: { scheduleId: a2.scheduleId, userId: a1.userId },
      }),
      this.assignmentRepo.findOne({
        where: { scheduleId: a1.scheduleId, userId: a2.userId },
      }),
    ]);
    if (conflict1 || conflict2)
      throw new BusinessError(CleaningErrorCode.TRADE_DUPLICATE_ASSIGNEE);

    // 두 배정과 관련된 다른 PENDING 교환은 스왑 이후 의미가 없어져 취소한다.
    await this.tradeRepo
      .createQueryBuilder()
      .update(CleaningTrade)
      .set({ status: CleaningTradeStatus.CANCELED })
      .where('status = :status', { status: CleaningTradeStatus.PENDING })
      .andWhere(
        '(requesterAssignmentId IN (:...ids) OR targetAssignmentId IN (:...ids))',
        { ids: [id1, id2] },
      )
      .execute();

    // assignment 자체는 유지하고 담당 userId만 교환한다.
    await Promise.all([
      this.assignmentRepo.update(id1, { userId: a2.userId }),
      this.assignmentRepo.update(id2, { userId: a1.userId }),
    ]);
  }

  // 알림/모달에서 공통으로 쓰는 배정 상세 정보를 조인해서 가져온다.
  async getAssignmentDetail(
    assignmentId: number,
  ): Promise<AssignmentDetail | null> {
    const row = await this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoin('a.schedule', 's')
      .innerJoin('a.user', 'u')
      .leftJoin('s.rule', 'r')
      .leftJoin('r.ruleResource', 'rr')
      .leftJoin('rr.resource', 'res')
      .select([
        'a.id AS id',
        'a.scheduleId AS "scheduleId"',
        'a.userId AS "userId"',
        'u.name AS "userName"',
        'u.code AS "userCode"',
        'u.slackId AS "userSlackId"',
        's.cleaningDate AS "cleaningDate"',
        'res.name AS "resourceName"',
      ])
      .where('a.id = :id', { id: assignmentId })
      .getRawOne<{
        id: number;
        scheduleId: number;
        userId: number;
        userName: string;
        userCode: string;
        userSlackId: string;
        cleaningDate: string;
        resourceName: string;
      }>();

    if (!row) return null;
    return {
      id: Number(row.id),
      scheduleId: Number(row.scheduleId),
      userId: Number(row.userId),
      userName: row.userName,
      userCode: row.userCode ?? undefined,
      userSlackId: row.userSlackId,
      cleaningDate: toDateStr(row.cleaningDate),
      resourceName: row.resourceName ?? '미지정',
    };
  }

  // 관리자가 직접 교환할 수 있도록 특정 규칙의 예정 배정만 조회한다.
  async getAssignmentsByRule(ruleId: number): Promise<AssignmentDetail[]> {
    const today = localTodayStr();
    const rows = await this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoin('a.schedule', 's')
      .innerJoin('a.user', 'u')
      .innerJoin('s.rule', 'r')
      .leftJoin('r.ruleResource', 'rr')
      .leftJoin('rr.resource', 'res')
      .select([
        'a.id AS id',
        'a.scheduleId AS "scheduleId"',
        'a.userId AS "userId"',
        'u.name AS "userName"',
        'u.code AS "userCode"',
        'u.slackId AS "userSlackId"',
        's.cleaningDate AS "cleaningDate"',
        'res.name AS "resourceName"',
      ])
      .where('s.ruleId = :ruleId', { ruleId })
      .andWhere('a.status = :status', { status: CleaningAssignmentStatus.ASSIGNED })
      .andWhere('s.cleaningDate >= :today', { today })
      .andWhere('s.status = :schedStatus', { schedStatus: CleaningScheduleStatus.SCHEDULED })
      .orderBy('s.cleaningDate', 'ASC')
      .getRawMany<{
        id: number;
        scheduleId: number;
        userId: number;
        userName: string;
        userCode: string;
        userSlackId: string;
        cleaningDate: string;
        resourceName: string;
      }>();

    return rows.map((r) => ({
      id: Number(r.id),
      scheduleId: Number(r.scheduleId),
      userId: Number(r.userId),
      userName: r.userName,
      userCode: r.userCode ?? undefined,
      userSlackId: r.userSlackId,
      cleaningDate: toDateStr(r.cleaningDate),
      resourceName: r.resourceName ?? '미지정',
    }));
  }

  async getTradeWithDetails(
    tradeId: number,
  ): Promise<{ requester: AssignmentDetail; target: AssignmentDetail } | null> {
    const trade = await this.tradeRepo.findOne({ where: { id: tradeId } });
    if (!trade) return null;

    const [requester, target] = await Promise.all([
      this.getAssignmentDetail(trade.requesterAssignmentId),
      this.getAssignmentDetail(trade.targetAssignmentId),
    ]);
    if (!requester || !target) return null;
    return { requester, target };
  }

  async cancelTrade(tradeId: number, userId: number): Promise<void> {
    const trade = await this.tradeRepo.findOne({ where: { id: tradeId } });
    if (!trade) throw new BusinessError(CleaningErrorCode.TRADE_NOT_FOUND);
    if (trade.status !== CleaningTradeStatus.PENDING)
      throw new BusinessError(CleaningErrorCode.TRADE_NOT_PENDING);

    const requester = await this.assignmentRepo.findOne({
      where: { id: trade.requesterAssignmentId },
    });
    if (!requester || requester.userId !== userId)
      throw new BusinessError(CleaningErrorCode.TRADE_FORBIDDEN);

    await this.tradeRepo.update(tradeId, { status: CleaningTradeStatus.CANCELED });
  }

  private async getCoAssigneeNames(
    scheduleId: number,
    excludeUserId: number,
  ): Promise<string[]> {
    const rows = await this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoin('a.user', 'u')
      .select('u.name', 'name')
      .where('a.scheduleId = :scheduleId', { scheduleId })
      .andWhere('a.userId != :excludeUserId', { excludeUserId })
      .andWhere('a.status = :status', { status: CleaningAssignmentStatus.ASSIGNED })
      .getRawMany<{ name: string }>();
    return rows.map((r) => r.name);
  }
}

function toDateStr(date: Date | string): string {
  if (!(date instanceof Date)) return String(date);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function localTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
