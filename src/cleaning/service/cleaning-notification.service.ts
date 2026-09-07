import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { SlackService } from 'nestjs-slack-bolt';
import { Repository } from 'typeorm';
import { toKST } from '../../common/date.util';
import { UserStatus } from '../../user/user.entity';
import {
  CleaningAssignment,
  CleaningAssignmentStatus,
} from '../entity/cleaning-assignment.entity';
import { CleaningScheduleStatus } from '../entity/cleaning-schedule.entity';

@Injectable()
export class CleaningNotificationService {
  private readonly logger = new Logger(CleaningNotificationService.name);

  constructor(
    @InjectRepository(CleaningAssignment)
    private readonly assignmentRepo: Repository<CleaningAssignment>,
    private readonly slackService: SlackService,
  ) {}

  @Cron('0 9 * * *', { timeZone: 'Asia/Seoul', waitForCompletion: true })
  async sendDailyReminders(): Promise<void> {
    const today = toKST(new Date()).toISOString().split('T')[0];

    // 교환·재배정 이후의 현재 담당자를 기준으로 당일 유효한 배정만 조회한다.
    const assignments = await this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoin('a.schedule', 's')
      .innerJoin('s.rule', 'r')
      .innerJoin('a.user', 'u')
      .leftJoin('r.ruleResource', 'rr')
      .leftJoin('rr.resource', 'res')
      .select([
        'a.id AS "assignmentId"',
        'u.slackId AS "userSlackId"',
        'res.name AS "resourceName"',
      ])
      .where('s.cleaningDate = :today', { today })
      .andWhere('s.status = :scheduleStatus', {
        scheduleStatus: CleaningScheduleStatus.SCHEDULED,
      })
      .andWhere('a.status = :assignmentStatus', {
        assignmentStatus: CleaningAssignmentStatus.ASSIGNED,
      })
      .andWhere('u.status = :userStatus', { userStatus: UserStatus.ACTIVE })
      .andWhere('r.deletedAt IS NULL')
      .getRawMany<{
        assignmentId: number;
        userSlackId: string;
        resourceName: string | null;
      }>();

    let sent = 0;
    for (const assignment of assignments) {
      try {
        await this.slackService.client.chat.postMessage({
          channel: assignment.userSlackId,
          text: `🧹 *오늘(${today}) 청소 당번 안내*\n청소 구역: *${assignment.resourceName ?? '미지정'}*\n오늘 청소 담당으로 배정되어 있습니다. 청소를 진행해주세요.`,
        });
        sent++;
      } catch (error) {
        // 한 명의 DM 실패로 나머지 담당자 알림이 중단되지 않게 한다.
        this.logger.warn(
          `Cleaning reminder failed for assignment ${assignment.assignmentId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.log(
      `Daily cleaning reminders (${today}): ${sent} sent, ${assignments.length - sent} failed`,
    );
  }
}
