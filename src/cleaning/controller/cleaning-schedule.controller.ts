import { Controller } from '@nestjs/common';
import { Action, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { CleaningRuleService } from '../service/cleaning-rule.service';
import {
  CleaningScheduleService,
  ScheduleWithAssignees,
} from '../service/cleaning-schedule.service';
import { CleaningScheduleView } from '../view/cleaning-schedule.view';
import { PermissionService } from '../../user/service/permission.service';
import { formatClassLabel } from '../../common/class-label.util';
import { StudentClassStatus } from '../../student-class/student-class.entity';
import { UserRole } from '../../user/user.entity';
import { BusinessError, CleaningErrorCode } from '../../common/errors';
import { CleaningAssignmentStatus } from '../entity/cleaning-assignment.entity';
import { CleaningScheduleStatus } from '../entity/cleaning-schedule.entity';

const SCHEDULES_PER_PAGE = 4;

@Controller()
export class CleaningScheduleController {
  constructor(
    private readonly cleaningRuleService: CleaningRuleService,
    private readonly cleaningScheduleService: CleaningScheduleService,
    private readonly permissionService: PermissionService,
  ) {}

  // 규칙별 일정 관리 진입 목록을 연다.
  @Action('cleaning:schedule:open-manage')
  async openScheduleManage({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const user = await this.permissionService.requireAdminOrClassRep(
      body.user.id,
    );
    const classId =
      user.role === UserRole.CLASS_REP ? user.studentClassId : undefined;
    const rules = await this.cleaningRuleService.findAllWithDetails(classId);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: CleaningScheduleView.scheduleManageListModal(rules),
    });
  }

  @Action('cleaning:schedule:open-upcoming')
  async openUpcomingSchedules(
    args: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs,
  ) {
    return this.openScheduleDetail(args, 'upcoming');
  }

  @Action('cleaning:schedule:open-past')
  async openPastSchedules(
    args: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs,
  ) {
    return this.openScheduleDetail(args, 'past');
  }

  @Action('cleaning:schedule:previous-page')
  async openPreviousSchedulePage(
    args: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs,
  ) {
    return this.changeSchedulePage(args);
  }

  @Action('cleaning:schedule:next-page')
  async openNextSchedulePage(
    args: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs,
  ) {
    return this.changeSchedulePage(args);
  }

  private async changeSchedulePage({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const user = await this.permissionService.requireAdminOrClassRep(
      body.user.id,
    );
    const action = body.actions[0] as { value: string };
    const page = parseInt(action.value, 10);
    const { ruleId, filter } = JSON.parse(
      body.view?.private_metadata ?? '{}',
    ) as { ruleId: number; filter: 'upcoming' | 'past' };

    const rule = await this.cleaningRuleService.findOneWithDetails(ruleId);
    if (!rule || !body.view?.id) return;
    if (
      user.role === UserRole.CLASS_REP &&
      rule.studentClassId !== user.studentClassId
    )
      return;

    const schedules =
      await this.cleaningScheduleService.findSchedulesByRule(ruleId);
    const schedulePage = paginateSchedules(schedules, filter, page);
    const label = formatClassLabel({
      admissionYear: rule.studentClass.admissionYear,
      section: rule.studentClass.section,
      graduated: rule.studentClass.status === StudentClassStatus.GRADUATED,
    });

    await client.views.update({
      view_id: body.view.id,
      view: CleaningScheduleView.scheduleDetailModal(
        schedulePage.schedules,
        label,
        ruleId,
        filter,
        schedulePage.page,
        schedulePage.totalPages,
      ),
    });
  }

  // 예정/지난 일정 상세 목록 렌더링을 공통 처리한다.
  private async openScheduleDetail(
    {
      ack,
      client,
      body,
    }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs,
    filter: 'upcoming' | 'past',
  ) {
    await ack();

    const user = await this.permissionService.requireAdminOrClassRep(
      body.user.id,
    );
    const action = body.actions[0] as { value: string };
    const ruleId = parseInt(action.value, 10);

    const rule = await this.cleaningRuleService.findOneWithDetails(ruleId);
    if (!rule) return;
    if (
      user.role === UserRole.CLASS_REP &&
      rule.studentClassId !== user.studentClassId
    )
      // 반대표는 자기 반 규칙의 일정만 조회/관리할 수 있다.
      return;

    const schedules =
      await this.cleaningScheduleService.findSchedulesByRule(ruleId);
    const schedulePage = paginateSchedules(schedules, filter, 0);
    const label = formatClassLabel({
      admissionYear: rule.studentClass.admissionYear,
      section: rule.studentClass.section,
      graduated: rule.studentClass.status === StudentClassStatus.GRADUATED,
    });

    await client.views.push({
      trigger_id: body.trigger_id,
      view: CleaningScheduleView.scheduleDetailModal(
        schedulePage.schedules,
        label,
        ruleId,
        filter,
        schedulePage.page,
        schedulePage.totalPages,
      ),
    });
  }

  @Action('cleaning:schedule:open-edit')
  async openScheduleEdit({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    await this.permissionService.requireAdminOrClassRep(body.user.id);
    const action = body.actions[0] as { value: string };
    const scheduleId = parseInt(action.value, 10);
    const {
      ruleId,
      filter,
      page = 0,
    } = JSON.parse(body.view?.private_metadata ?? '{}') as {
      ruleId: number;
      filter: 'upcoming' | 'past';
      page?: number;
    };

    const schedule =
      await this.cleaningScheduleService.findOneScheduleWithAssignees(
        scheduleId,
      );
    if (!schedule) return;

    await client.views.push({
      trigger_id: body.trigger_id,
      view: CleaningScheduleView.scheduleEditModal(
        schedule,
        ruleId,
        filter,
        page,
      ),
    });
  }

  @Action('cleaning:schedule:open-delete')
  async openScheduleDelete({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    await this.permissionService.requireAdminOrClassRep(body.user.id);
    const action = body.actions[0] as { value: string };
    const scheduleId = parseInt(action.value, 10);
    const {
      ruleId,
      filter,
      page = 0,
    } = JSON.parse(body.view?.private_metadata ?? '{}') as {
      ruleId: number;
      filter: 'upcoming' | 'past';
      page?: number;
    };

    const schedule =
      await this.cleaningScheduleService.findOneScheduleWithAssignees(
        scheduleId,
      );
    if (!schedule) return;

    await client.views.push({
      trigger_id: body.trigger_id,
      view: CleaningScheduleView.scheduleDeleteConfirmModal(
        scheduleId,
        ruleId,
        filter,
        schedule.cleaningDate,
        page,
      ),
    });
  }

  // 일정 삭제 후 기존 배정자에게 삭제 알림을 보낸다.
  @View('cleaning:modal:schedule-delete')
  async handleScheduleDelete({
    ack,
    view,
    body,
    client,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const {
      scheduleId,
      ruleId,
      filter,
      page = 0,
    } = JSON.parse(view.private_metadata) as {
      scheduleId: number;
      ruleId: number;
      filter: 'upcoming' | 'past';
      page?: number;
    };

    const [scheduleBefore, rule] = await Promise.all([
      this.cleaningScheduleService.findOneScheduleWithAssignees(scheduleId),
      ruleId
        ? this.cleaningRuleService.findOneWithDetails(ruleId)
        : Promise.resolve(null),
    ]);

    try {
      await this.cleaningScheduleService.deleteSchedule(scheduleId);
    } catch (e) {
      if (
        e instanceof BusinessError &&
        e.code === CleaningErrorCode.SCHEDULE_HAS_ACTIVE_TRADES
      ) {
        await ack({
          response_action: 'update',
          view: CleaningScheduleView.scheduleDeleteConfirmModal(
            scheduleId,
            ruleId,
            filter,
            scheduleBefore?.cleaningDate ?? '',
            page,
            e.message,
          ),
        } as any);
        return;
      }
      throw e;
    }

    await ack();

    if (scheduleBefore) {
      const resourceName = rule?.ruleResource?.resource?.name ?? '미지정';
      const slackIds = scheduleBefore.assignees
        .filter((a) => a.status === CleaningAssignmentStatus.ASSIGNED)
        .map((a) => a.userSlackId);
      await Promise.allSettled(
        slackIds.map((id) =>
          client.chat.postMessage({
            channel: id,
            text: `🗑️ *${scheduleBefore.cleaningDate}* (${dayLabel(scheduleBefore.cleaningDate)}) | ${resourceName}\n청소 일정이 삭제되었습니다.`,
          }),
        ),
      );
    }

    if (rule && body.view?.previous_view_id) {
      const schedules =
        await this.cleaningScheduleService.findSchedulesByRule(ruleId);
      const schedulePage = paginateSchedules(schedules, filter, page);
      const label = formatClassLabel({
        admissionYear: rule.studentClass.admissionYear,
        section: rule.studentClass.section,
        graduated: rule.studentClass.status === StudentClassStatus.GRADUATED,
      });
      await client.views.update({
        view_id: body.view.previous_view_id,
        view: CleaningScheduleView.scheduleDetailModal(
          schedulePage.schedules,
          label,
          ruleId,
          filter,
          schedulePage.page,
          schedulePage.totalPages,
        ),
      });
    }
  }

  // 선택 일정에 규칙 담당자 전원을 배정하고 신규 배정자에게 알린다.
  @Action('cleaning:schedule:assign-all')
  async assignAllToSchedule({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    await this.permissionService.requireAdminOrClassRep(body.user.id);
    const action = body.actions[0] as { value: string };
    const scheduleId = parseInt(action.value, 10);
    const {
      ruleId,
      filter,
      page = 0,
    } = JSON.parse(body.view?.private_metadata ?? '{}') as {
      ruleId: number;
      filter: 'upcoming' | 'past';
      page?: number;
    };

    const [scheduleBefore, rule] = await Promise.all([
      this.cleaningScheduleService.findOneScheduleWithAssignees(scheduleId),
      ruleId
        ? this.cleaningRuleService.findOneWithDetails(ruleId)
        : Promise.resolve(null),
    ]);
    await this.cleaningScheduleService.assignAllToSchedule(scheduleId);
    const scheduleAfter =
      await this.cleaningScheduleService.findOneScheduleWithAssignees(
        scheduleId,
      );

    if (scheduleAfter) {
      const resourceName = rule?.ruleResource?.resource?.name ?? '미지정';
      const beforeIds = new Set(
        (scheduleBefore?.assignees ?? [])
          .filter((a) => a.status === CleaningAssignmentStatus.ASSIGNED)
          .map((a) => a.userSlackId),
      );
      const newlyAssigned = scheduleAfter.assignees
        .filter(
          (a) =>
            a.status === CleaningAssignmentStatus.ASSIGNED &&
            !beforeIds.has(a.userSlackId),
        )
        .map((a) => a.userSlackId);
      await Promise.allSettled(
        newlyAssigned.map((id) =>
          client.chat.postMessage({
            channel: id,
            text: `🧹 *${scheduleAfter.cleaningDate}* (${dayLabel(scheduleAfter.cleaningDate)}) | ${resourceName}\n청소 일정에 배정되었습니다.`,
          }),
        ),
      );
    }

    if (rule && body.view?.id) {
      const schedules =
        await this.cleaningScheduleService.findSchedulesByRule(ruleId);
      const schedulePage = paginateSchedules(schedules, filter, page);
      const label = formatClassLabel({
        admissionYear: rule.studentClass.admissionYear,
        section: rule.studentClass.section,
        graduated: rule.studentClass.status === StudentClassStatus.GRADUATED,
      });
      await client.views.update({
        view_id: body.view.id,
        view: CleaningScheduleView.scheduleDetailModal(
          schedulePage.schedules,
          label,
          ruleId,
          filter,
          schedulePage.page,
          schedulePage.totalPages,
        ),
      });
    }
  }

  @Action('cleaning:schedule:open-assignment-status')
  async openAssignmentStatus({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    await this.permissionService.requireAdminOrClassRep(body.user.id);
    const action = body.actions[0] as { value: string };
    const scheduleId = parseInt(action.value, 10);

    const schedule =
      await this.cleaningScheduleService.findOneScheduleWithAssignees(
        scheduleId,
      );
    if (!schedule) return;

    await client.views.push({
      trigger_id: body.trigger_id,
      view: CleaningScheduleView.assignmentStatusModal(schedule),
    });
  }

  // 모달에서 선택한 배정 상태만 모아 일괄 저장한다.
  @View('cleaning:modal:assignment-status')
  async handleAssignmentStatus({
    ack,
    view,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const updates = Object.entries(view.state.values)
      .filter(([blockId]) => blockId.startsWith('assignment_'))
      .flatMap(([blockId, field]) => {
        const value = field.status_select.selected_option?.value;
        if (!value) return [];
        return [
          {
            id: parseInt(blockId.replace('assignment_', ''), 10),
            status: value as CleaningAssignmentStatus,
          },
        ];
      });

    await this.cleaningScheduleService.updateAssignmentStatuses(updates);

    logger.info(
      `Assignment statuses updated: ${updates.map((u) => `${u.id}→${u.status}`).join(', ')}`,
    );
  }

  // 일정 날짜/상태/필요 인원 변경 후 대상자에게 변경 내용을 알린다.
  @View('cleaning:modal:schedule-edit')
  async handleScheduleEdit({
    ack,
    client,
    view,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const {
      scheduleId,
      ruleId,
      filter,
      page = 0,
    } = JSON.parse(view.private_metadata) as {
      scheduleId: number;
      ruleId: number;
      filter: 'upcoming' | 'past';
      page?: number;
    };
    const values = view.state.values;

    const cleaningDate =
      values.cleaning_date_block.cleaning_date_input.selected_date ?? undefined;

    const status = values.status_block.status_select.selected_option
      ?.value as CleaningScheduleStatus;

    const [scheduleBefore, rule] = await Promise.all([
      this.cleaningScheduleService.findOneScheduleWithAssignees(scheduleId),
      this.cleaningRuleService.findOneWithDetails(ruleId),
    ]);

    let needPeoples: number;
    if (filter === 'upcoming') {
      // 예정 일정만 필요 인원을 수정할 수 있고, 지난 일정은 당시 값을 유지한다.
      const raw = values.need_peoples_block?.need_peoples_input?.value;
      const parsed = parseInt(raw ?? '', 10);
      if (isNaN(parsed) || parsed < 1) {
        await ack({
          response_action: 'errors',
          errors: { need_peoples_block: '1 이상의 숫자를 입력해주세요.' },
        });
        return;
      }
      needPeoples = parsed;
    } else {
      needPeoples = scheduleBefore?.needPeoples ?? 1;
    }

    try {
      await this.cleaningScheduleService.updateSchedule(scheduleId, {
        cleaningDate,
        needPeoples,
        status,
      });
    } catch (e) {
      if (
        e instanceof BusinessError &&
        e.code === CleaningErrorCode.DUPLICATE_SCHEDULE_DATE
      ) {
        await ack({
          response_action: 'errors',
          errors: { cleaning_date_block: e.message },
        });
        return;
      }
      throw e;
    }

    if (scheduleBefore) {
      const resourceName = rule?.ruleResource?.resource?.name ?? '미지정';
      const assignedSlackIds = scheduleBefore.assignees
        .filter((a) => a.status === CleaningAssignmentStatus.ASSIGNED)
        .map((a) => a.userSlackId);

      let notifyText: string | null = null;
      const dateInfo = `*${scheduleBefore.cleaningDate}* (${dayLabel(scheduleBefore.cleaningDate)}) | ${resourceName}`;
      if (status === CleaningScheduleStatus.CANCELED) {
        notifyText = `❌ ${dateInfo}\n청소 일정이 취소되었습니다.`;
      } else if (
        status === CleaningScheduleStatus.SCHEDULED &&
        scheduleBefore.status === CleaningScheduleStatus.CANCELED
      ) {
        notifyText = `✅ ${dateInfo}\n청소 일정이 복원되었습니다.`;
      } else if (cleaningDate && cleaningDate !== scheduleBefore.cleaningDate) {
        notifyText = `📅 ${resourceName} | 청소 일정 날짜가 변경되었습니다.\n*${scheduleBefore.cleaningDate}* (${dayLabel(scheduleBefore.cleaningDate)}) → *${cleaningDate}* (${dayLabel(cleaningDate)})`;
      }

      // 실제 사용자에게 영향이 있는 변경만 DM으로 알린다.
      if (notifyText) {
        await Promise.allSettled(
          assignedSlackIds.map((id) =>
            client.chat.postMessage({ channel: id, text: notifyText! }),
          ),
        );
      }
    }

    const schedules =
      await this.cleaningScheduleService.findSchedulesByRule(ruleId);
    const schedulePage = paginateSchedules(schedules, filter, page);

    if (rule && view.previous_view_id) {
      const label = formatClassLabel({
        admissionYear: rule.studentClass.admissionYear,
        section: rule.studentClass.section,
        graduated: rule.studentClass.status === StudentClassStatus.GRADUATED,
      });
      await client.views.update({
        view_id: view.previous_view_id,
        view: CleaningScheduleView.scheduleDetailModal(
          schedulePage.schedules,
          label,
          ruleId,
          filter,
          schedulePage.page,
          schedulePage.totalPages,
        ),
      });
    }

    await ack();

    logger.info(
      `Schedule ${scheduleId} updated: needPeoples=${needPeoples}, status=${status}`,
    );
  }
}

function paginateSchedules(
  schedules: ScheduleWithAssignees[],
  filter: 'upcoming' | 'past',
  page: number,
) {
  const today = new Date().toISOString().split('T')[0];
  const filtered =
    filter === 'past'
      ? schedules
          .filter((schedule) => schedule.cleaningDate < today)
          .sort((a, b) => b.cleaningDate.localeCompare(a.cleaningDate))
      : schedules.filter((schedule) => schedule.cleaningDate >= today);
  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / SCHEDULES_PER_PAGE),
  );
  const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = currentPage * SCHEDULES_PER_PAGE;

  return {
    schedules: filtered.slice(start, start + SCHEDULES_PER_PAGE),
    page: currentPage,
    totalPages,
  };
}

function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return (
    ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()] +
    '요일'
  );
}
