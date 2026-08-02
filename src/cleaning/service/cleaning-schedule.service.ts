import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Not, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import {
  CleaningSchedule,
  CleaningScheduleStatus,
} from '../entity/cleaning-schedule.entity';
import {
  CleaningAssignment,
  CleaningAssignmentStatus,
} from '../entity/cleaning-assignment.entity';
import { CleaningRule } from '../entity/cleaning-rule.entity';
import { CleaningRuleUser } from '../entity/cleaning-rule-user.entity';
import {
  CleaningTrade,
  CleaningTradeStatus,
} from '../entity/cleaning-trade.entity';
import { BusinessError, CleaningErrorCode } from '../../common/errors';

export interface ScheduleWithAssignees {
  id: number;
  cleaningDate: string;
  needPeoples: number;
  status: CleaningScheduleStatus;
  assignees: {
    assignmentId: number;
    userName: string;
    userSlackId: string;
    status: CleaningAssignmentStatus;
  }[];
}

@Injectable()
export class CleaningScheduleService {
  private readonly logger = new Logger(CleaningScheduleService.name);

  constructor(
    @InjectRepository(CleaningSchedule)
    private readonly scheduleRepo: Repository<CleaningSchedule>,
    @InjectRepository(CleaningAssignment)
    private readonly assignmentRepo: Repository<CleaningAssignment>,
    @InjectRepository(CleaningRule)
    private readonly ruleRepo: Repository<CleaningRule>,
    @InjectRepository(CleaningRuleUser)
    private readonly ruleUserRepo: Repository<CleaningRuleUser>,
    @InjectRepository(CleaningTrade)
    private readonly tradeRepo: Repository<CleaningTrade>,
  ) {}

  // 기간 지정 시 해당 범위의 요일만, 미지정 시 마지막 일정 이후 전원 1사이클만 생성한다.
  async generateSchedules(
    ruleId: number,
    startDateStr?: string,
    endDateStr?: string,
  ): Promise<{ count: number; scheduleIds: number[] }> {
    if (!!startDateStr !== !!endDateStr) {
      return { count: 0, scheduleIds: [] };
    }

    const rule = await this.ruleRepo.findOne({ where: { id: ruleId } });
    if (!rule) return { count: 0, scheduleIds: [] };

    const ruleUsers = await this.ruleUserRepo.find({ where: { ruleId } });
    if (ruleUsers.length === 0) return { count: 0, scheduleIds: [] };
  
    // 담당인원이 필요 인원 수 보다 적은 경우 비즈니스 에러 처리
    if (ruleUsers.length < rule.needPeoples) {
      throw new BusinessError(CleaningErrorCode.NOT_ENOUGH_USERS);
    };
    
    const existing = await this.scheduleRepo.find({
      where: { ruleId },
      order: { cleaningDate: 'DESC' },
    });
    // 같은 규칙/날짜 unique 제약을 피하기 위해 이미 생성된 날짜는 제외한다.
    const existingDates = new Set(
      existing.map((s) => toDateStr(s.cleaningDate)),
    );

    // 배정 횟수가 적은 사람부터 배정해 장기적으로 담당 횟수를 맞춘다.
    const assignmentCounts = await this.getAssignmentCounts(
      ruleUsers.map((u) => u.userId),
      ruleId,
    );
    // 동률 그룹만 랜덤 셔플해 공정성은 유지하면서 같은 조합 반복을 줄인다.
    const usersByCnt = ruleUsers.map((ru) => ({
      userId: ru.userId,
      count: assignmentCounts.get(ru.userId) ?? 0,
    }));
    usersByCnt.sort((a, b) => a.count - b.count);

    let si = 0;
    while (si < usersByCnt.length) {
      let ei = si;
      while (
        ei < usersByCnt.length &&
        usersByCnt[ei].count === usersByCnt[si].count
      )
        ei++;
      for (let k = ei - 1; k > si; k--) {
        const r = si + Math.floor(Math.random() * (k - si + 1));
        [usersByCnt[k], usersByCnt[r]] = [usersByCnt[r], usersByCnt[k]];
      }
      si = ei;
    }

    const sortedUserIds = usersByCnt.map((u) => u.userId);

    let cleaningDates: string[];

    if (startDateStr && endDateStr) {
      // 관리자가 기간을 지정하면 해당 기간 안의 청소 요일만 골라 생성한다.
      const start = parseLocalDate(startDateStr);
      const end = parseLocalDate(endDateStr);
      cleaningDates = getDatesInRange(start, end, rule.daysOfWeek);
    } else {
      // 마지막 일정 이후부터 전원 1사이클 생성
      const lastSchedule = existing[0];
      const startFrom = lastSchedule
        ? nextDayAfter(
            parseLocalDate(toDateStr(lastSchedule.cleaningDate)),
            rule.daysOfWeek,
          )
        : localToday();
      const totalSchedules = Math.ceil(sortedUserIds.length / rule.needPeoples);
      cleaningDates = getNDates(startFrom, rule.daysOfWeek, totalSchedules);
    }

    const newDates = cleaningDates.filter((d) => !existingDates.has(d));
    if (newDates.length === 0) return { count: 0, scheduleIds: [] };

    const scheduleIds: number[] = [];
    let userIndex = 0;
    const cycleSchedules = Math.ceil(sortedUserIds.length / rule.needPeoples);
    let schedulesInCycle = 0;

    for (const date of newDates) {
      // 모든 담당자가 한 번씩 배정된 뒤에는 다음 사이클 조합을 다시 섞는다.
      if (schedulesInCycle > 0 && schedulesInCycle % cycleSchedules === 0) {
        for (let k = sortedUserIds.length - 1; k > 0; k--) {
          const r = Math.floor(Math.random() * (k + 1));
          [sortedUserIds[k], sortedUserIds[r]] = [
            sortedUserIds[r],
            sortedUserIds[k],
          ];
        }
        userIndex = 0;
      }

      const schedule = await this.scheduleRepo.save(
        this.scheduleRepo.create({
          ruleId,
          cleaningDate: date,
          needPeoples: rule.needPeoples,
          status: CleaningScheduleStatus.SCHEDULED,
        }),
      );
      scheduleIds.push(schedule.id);

      // needPeoples 단위로 순회하며 한 일정에 필요한 인원을 채운다.
      const assignees = Array.from(
        { length: rule.needPeoples },
        (_, i) => sortedUserIds[(userIndex + i) % sortedUserIds.length],
      );
      userIndex = (userIndex + rule.needPeoples) % sortedUserIds.length;
      schedulesInCycle++;

      await this.assignmentRepo.save(
        assignees.map((userId) =>
          this.assignmentRepo.create({
            scheduleId: schedule.id,
            userId,
            status: CleaningAssignmentStatus.ASSIGNED,
          }),
        ),
      );
    }

    return { count: scheduleIds.length, scheduleIds };
  }

  async findSchedulesByRule(ruleId: number): Promise<ScheduleWithAssignees[]> {
    const schedules = await this.scheduleRepo.find({
      where: { ruleId },
      order: { cleaningDate: 'ASC' },
    });
    return this.attachAssignees(schedules);
  }

  async findSchedulesByIds(ids: number[]): Promise<ScheduleWithAssignees[]> {
    if (ids.length === 0) return [];
    const schedules = await this.scheduleRepo.find({ where: { id: In(ids) } });
    return this.attachAssignees(schedules);
  }

  async findOneScheduleWithAssignees(
    scheduleId: number,
  ): Promise<ScheduleWithAssignees | null> {
    const schedule = await this.scheduleRepo.findOne({
      where: { id: scheduleId },
    });
    if (!schedule) return null;
    const [result] = await this.attachAssignees([schedule]);
    return result ?? null;
  }

  // 일정 수정 시 상태와 필요 인원 변경에 맞춰 연결된 배정 상태도 함께 보정한다.
  async updateSchedule(
    scheduleId: number,
    dto: {
      cleaningDate?: string;
      needPeoples: number;
      status: CleaningScheduleStatus;
    },
  ): Promise<void> {
    const schedule = await this.scheduleRepo.findOne({
      where: { id: scheduleId },
    });
    if (!schedule) return;

    if (dto.cleaningDate && dto.cleaningDate !== schedule.cleaningDate) {
      // 같은 규칙 안에서는 같은 날짜의 청소 일정이 하나만 존재해야 한다.
      const conflict = await this.scheduleRepo.findOne({
        where: {
          ruleId: schedule.ruleId,
          cleaningDate: dto.cleaningDate,
          id: Not(scheduleId),
        },
      });
      if (conflict) {
        throw new BusinessError(CleaningErrorCode.DUPLICATE_SCHEDULE_DATE);
      }
    }

    const wasCanceled = schedule.status === CleaningScheduleStatus.CANCELED;
    const nowCanceled = dto.status === CleaningScheduleStatus.CANCELED;

    await this.scheduleRepo.update(scheduleId, {
      ...(dto.cleaningDate ? { cleaningDate: dto.cleaningDate } : {}),
      needPeoples: dto.needPeoples,
      status: dto.status,
    });

    if (!wasCanceled && nowCanceled) {
      // 취소: ASSIGNED 배정 → CANCELED, PENDING 교환 → CANCELED
      const assignments = await this.assignmentRepo.find({
        where: { scheduleId, status: CleaningAssignmentStatus.ASSIGNED },
        select: ['id'],
      });
      if (assignments.length > 0) {
        const ids = assignments.map((a) => a.id);
        await this.assignmentRepo.update(ids, {
          status: CleaningAssignmentStatus.CANCELED,
        });
        await this.cancelPendingTradesForAssignments(ids);
      }
    } else if (wasCanceled && dto.status === CleaningScheduleStatus.SCHEDULED) {
      // 복원: CANCELED 배정 → ASSIGNED
      await this.assignmentRepo.update(
        { scheduleId, status: CleaningAssignmentStatus.CANCELED },
        { status: CleaningAssignmentStatus.ASSIGNED },
      );
    }

    if (!nowCanceled && dto.needPeoples < schedule.needPeoples) {
      // 필요 인원이 줄면 뒤쪽 배정부터 취소해 현재 일정의 active 인원을 맞춘다.
      const active = await this.assignmentRepo.find({
        where: { scheduleId, status: CleaningAssignmentStatus.ASSIGNED },
        order: { id: 'DESC' },
      });
      const excess = active.slice(dto.needPeoples);
      if (excess.length > 0) {
        const ids = excess.map((a) => a.id);
        await this.assignmentRepo.update(ids, {
          status: CleaningAssignmentStatus.CANCELED,
        });
        await this.cancelPendingTradesForAssignments(ids);
      }
    }

    if (!nowCanceled && dto.needPeoples > schedule.needPeoples) {
      // 필요 인원이 늘면 규칙 담당자 중 아직 이 일정에 없는 사람을 추가 배정한다.
      const currentAssigned = await this.assignmentRepo.find({
        where: { scheduleId, status: CleaningAssignmentStatus.ASSIGNED },
      });
      const deficit = dto.needPeoples - currentAssigned.length;

      if (deficit > 0) {
        const assignedUserIds = new Set(currentAssigned.map((a) => a.userId));
        const ruleUsers = await this.ruleUserRepo.find({
          where: { ruleId: schedule.ruleId },
        });
        const canceled = await this.assignmentRepo.find({
          where: { scheduleId, status: CleaningAssignmentStatus.CANCELED },
        });
        const canceledByUser = new Map(canceled.map((a) => [a.userId, a.id]));
        const candidates = ruleUsers.filter(
          (ru) => !assignedUserIds.has(ru.userId),
        );

        let added = 0;
        for (const ru of candidates) {
          if (added >= deficit) break;
          if (canceledByUser.has(ru.userId)) {
            await this.assignmentRepo.update(canceledByUser.get(ru.userId)!, {
              status: CleaningAssignmentStatus.ASSIGNED,
            });
          } else {
            await this.assignmentRepo.save(
              this.assignmentRepo.create({
                scheduleId,
                userId: ru.userId,
                status: CleaningAssignmentStatus.ASSIGNED,
              }),
            );
          }
          added++;
        }
      }
    }
  }

  async updateAssignmentStatuses(
    updates: { id: number; status: CleaningAssignmentStatus }[],
  ): Promise<void> {
    await Promise.all(
      updates.map(({ id, status }) =>
        this.assignmentRepo.update(id, { status }),
      ),
    );
  }

  // 규칙의 담당자를 이 일정에 전원 배정하고 필요 인원도 담당자 수에 맞춘다.
  async assignAllToSchedule(scheduleId: number): Promise<void> {
    const schedule = await this.scheduleRepo.findOne({
      where: { id: scheduleId },
    });
    if (!schedule || schedule.status === CleaningScheduleStatus.CANCELED) {
      throw new BusinessError(CleaningErrorCode.ASSIGNMENT_NOT_FOUND);
    }

    const ruleUsers = await this.ruleUserRepo.find({
      where: { ruleId: schedule.ruleId },
    });

    const existing = await this.assignmentRepo.find({ where: { scheduleId } });
    const existingUserIds = new Set(existing.map((a) => a.userId));
    // unique(scheduleId, userId) 때문에 취소 이력이 있으면 insert 대신 상태만 복원한다.
    const canceledByUser = new Map(
      existing
        .filter((a) => a.status === CleaningAssignmentStatus.CANCELED)
        .map((a) => [a.userId, a.id]),
    );

    for (const ru of ruleUsers) {
      if (canceledByUser.has(ru.userId)) {
        // CANCELED → ASSIGNED (unique 제약 때문에 INSERT 불가)
        await this.assignmentRepo.update(canceledByUser.get(ru.userId)!, {
          status: CleaningAssignmentStatus.ASSIGNED,
        });
      } else if (!existingUserIds.has(ru.userId)) {
        await this.assignmentRepo.save(
          this.assignmentRepo.create({
            scheduleId,
            userId: ru.userId,
            status: CleaningAssignmentStatus.ASSIGNED,
          }),
        );
      }
    }

    await this.scheduleRepo.update(scheduleId, {
      needPeoples: ruleUsers.length,
    });
  }

  // 대기 중인 교환 요청이 있으면 삭제를 막아 배정 교환 흐름이 꼬이지 않게 한다.
  async deleteSchedule(scheduleId: number): Promise<void> {
    const assignments = await this.assignmentRepo.find({
      where: { scheduleId },
      select: ['id'],
    });

    if (assignments.length > 0) {
      const assignmentIds = assignments.map((a) => a.id);

      const pendingCount = await this.tradeRepo
        .createQueryBuilder('t')
        .where('t.status = :status', { status: CleaningTradeStatus.PENDING })
        .andWhere(
          '(t.requesterAssignmentId IN (:...ids) OR t.targetAssignmentId IN (:...ids))',
          { ids: assignmentIds },
        )
        .getCount();

      if (pendingCount > 0) {
        throw new BusinessError(CleaningErrorCode.SCHEDULE_HAS_ACTIVE_TRADES);
      }

      await this.tradeRepo
        .createQueryBuilder()
        .delete()
        .from(CleaningTrade)
        .where(
          '(requesterAssignmentId IN (:...ids) OR targetAssignmentId IN (:...ids))',
          { ids: assignmentIds },
        )
        .execute();
    }

    await this.assignmentRepo.delete({ scheduleId });
    await this.scheduleRepo.delete(scheduleId);
  }

  // 비활성화된 유저를 규칙에서 제거하고 예정된 배정은 남은 담당자로 대체한다.
  async handleUserDeactivation(userId: number): Promise<void> {
    const ruleUserRows = await this.ruleUserRepo.find({ where: { userId } });
    if (ruleUserRows.length === 0) return;

    const ruleIds = ruleUserRows.map((ru) => ru.ruleId);
    await this.ruleUserRepo.delete({ userId });

    const today = localTodayStr();

    for (const ruleId of ruleIds) {
      const remainingUsers = await this.ruleUserRepo.find({
        where: { ruleId },
      });
      if (remainingUsers.length === 0) continue;

      const remainingUserIds = remainingUsers.map((ru) => ru.userId);

      const futureAssignments = await this.assignmentRepo
        .createQueryBuilder('a')
        .innerJoin('a.schedule', 's')
        .where('a.userId = :userId', { userId })
        .andWhere('s.ruleId = :ruleId', { ruleId })
        .andWhere('s.status = :sStatus', {
          sStatus: CleaningScheduleStatus.SCHEDULED,
        })
        .andWhere('s.cleaningDate >= :today', { today })
        .andWhere('a.status = :aStatus', {
          aStatus: CleaningAssignmentStatus.ASSIGNED,
        })
        .select(['a.id AS id', 'a.scheduleId AS "scheduleId"'])
        .getRawMany<{ id: number; scheduleId: number }>();

      if (futureAssignments.length === 0) continue;

      // 기존 배정은 취소 처리하고, 관련 교환 요청도 더 이상 유효하지 않으므로 취소한다.
      const assignmentIds = futureAssignments.map((a) => a.id);
      await this.assignmentRepo.update(assignmentIds, {
        status: CleaningAssignmentStatus.CANCELED,
      });
      await this.cancelPendingTradesForAssignments(assignmentIds);

      const counts = await this.getAssignmentCounts(remainingUserIds, ruleId);

      for (const fa of futureAssignments) {
        // 같은 일정에 이미 배정된 사람을 제외하고 가장 적게 배정된 담당자를 대체자로 고른다.
        const alreadyAssigned = await this.assignmentRepo.find({
          where: {
            scheduleId: fa.scheduleId,
            status: CleaningAssignmentStatus.ASSIGNED,
          },
          select: ['userId'],
        });
        const assignedSet = new Set(alreadyAssigned.map((a) => a.userId));

        const canceledRecords = await this.assignmentRepo.find({
          where: {
            scheduleId: fa.scheduleId,
            status: CleaningAssignmentStatus.CANCELED,
          },
          select: ['id', 'userId'],
        });
        const canceledByUser = new Map(
          canceledRecords.map((a) => [a.userId, a.id]),
        );

        const candidates = remainingUserIds.filter(
          (uid) => !assignedSet.has(uid),
        );
        if (candidates.length === 0) continue;

        const replacement = candidates.reduce((best, uid) =>
          (counts.get(uid) ?? 0) < (counts.get(best) ?? 0) ? uid : best,
        );

        if (canceledByUser.has(replacement)) {
          await this.assignmentRepo.update(canceledByUser.get(replacement)!, {
            status: CleaningAssignmentStatus.ASSIGNED,
          });
        } else {
          await this.assignmentRepo.save(
            this.assignmentRepo.create({
              scheduleId: fa.scheduleId,
              userId: replacement,
              status: CleaningAssignmentStatus.ASSIGNED,
            }),
          );
        }

        counts.set(replacement, (counts.get(replacement) ?? 0) + 1);
      }
    }
  }

  // 지난 예정 일정을 매일 완료 처리하고 남아 있는 배정도 완료로 맞춘다.
  @Cron('0 0 * * *')
  async completePastSchedules(): Promise<void> {
    const today = localTodayStr();
    const toComplete = await this.scheduleRepo.find({
      where: {
        status: CleaningScheduleStatus.SCHEDULED,
        cleaningDate: LessThan(today),
      },
      select: ['id'],
    });
    if (toComplete.length > 0) {
      const ids = toComplete.map((s) => s.id);
      await this.scheduleRepo.update(ids, {
        status: CleaningScheduleStatus.COMPLETED,
      });
      await this.assignmentRepo.update(
        { scheduleId: In(ids), status: CleaningAssignmentStatus.ASSIGNED },
        { status: CleaningAssignmentStatus.COMPLETED },
      );
    }
    this.logger.log(
      `completePastSchedules: ${toComplete.length} schedules completed`,
    );
  }

  private async cancelPendingTradesForAssignments(
    assignmentIds: number[],
  ): Promise<void> {
    if (assignmentIds.length === 0) return;
    await this.tradeRepo
      .createQueryBuilder()
      .update(CleaningTrade)
      .set({ status: CleaningTradeStatus.CANCELED })
      .where('status = :status', { status: CleaningTradeStatus.PENDING })
      .andWhere(
        '(requesterAssignmentId IN (:...ids) OR targetAssignmentId IN (:...ids))',
        { ids: assignmentIds },
      )
      .execute();
  }

  private async attachAssignees(
    schedules: CleaningSchedule[],
  ): Promise<ScheduleWithAssignees[]> {
    if (schedules.length === 0) return [];

    const scheduleIds = schedules.map((s) => s.id);
    const assignments = await this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoin('a.user', 'u')
      .select([
        'a.id AS "assignmentId"',
        'a.scheduleId AS "scheduleId"',
        'a.status AS "status"',
        'u.name AS "userName"',
        'u.slackId AS "userSlackId"',
      ])
      .where('a.scheduleId IN (:...ids)', { ids: scheduleIds })
      .getRawMany<{
        assignmentId: number;
        scheduleId: number;
        status: CleaningAssignmentStatus;
        userName: string;
        userSlackId: string;
      }>();

    const bySchedule = new Map<number, typeof assignments>();
    for (const a of assignments) {
      if (!bySchedule.has(a.scheduleId)) bySchedule.set(a.scheduleId, []);
      bySchedule.get(a.scheduleId)!.push(a);
    }

    return schedules.map((s) => ({
      id: s.id,
      cleaningDate: toDateStr(s.cleaningDate),
      needPeoples: s.needPeoples,
      status: s.status,
      assignees: (bySchedule.get(s.id) ?? []).map((a) => ({
        assignmentId: a.assignmentId,
        userName: a.userName,
        userSlackId: a.userSlackId,
        status: a.status,
      })),
    }));
  }

  private async getAssignmentCounts(
    userIds: number[],
    ruleId: number,
  ): Promise<Map<number, number>> {
    if (userIds.length === 0) return new Map();

    const rows = await this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoin('a.schedule', 's')
      .select('a.userId', 'userId')
      .addSelect('COUNT(*)', 'cnt')
      .where('s.ruleId = :ruleId', { ruleId })
      .andWhere('a.userId IN (:...ids)', { ids: userIds })
      .andWhere('a.status NOT IN (:...excluded)', {
        excluded: [
          CleaningAssignmentStatus.CANCELED,
          CleaningAssignmentStatus.NON_COMPLIANT,
        ],
      })
      .groupBy('a.userId')
      .getRawMany<{ userId: number; cnt: string }>();

    const map = new Map<number, number>(userIds.map((id) => [id, 0]));
    for (const row of rows) map.set(Number(row.userId), Number(row.cnt));
    return map;
  }
}

function localTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, day] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, day);
}

function toDateStr(date: Date | string): string {
  if (!(date instanceof Date)) return String(date);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDatesInRange(
  start: Date,
  end: Date,
  daysOfWeek: number[],
): string[] {
  const daySet = new Set(daysOfWeek);
  const dates: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    if (daySet.has(cur.getDay())) dates.push(toDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function nextDayAfter(date: Date, daysOfWeek: number[]): Date {
  const daySet = new Set(daysOfWeek);
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  while (!daySet.has(next.getDay())) next.setDate(next.getDate() + 1);
  return next;
}

function getNDates(start: Date, daysOfWeek: number[], n: number): string[] {
  const daySet = new Set(daysOfWeek);
  const dates: string[] = [];
  const cur = new Date(start);
  // 시작일이 요일에 맞지 않으면 다음 해당 요일로
  while (!daySet.has(cur.getDay())) cur.setDate(cur.getDate() + 1);
  while (dates.length < n) {
    dates.push(toDateStr(cur));
    cur.setDate(cur.getDate() + 1);
    while (!daySet.has(cur.getDay())) cur.setDate(cur.getDate() + 1);
  }
  return dates;
}
