import { Controller } from '@nestjs/common';
import { Action, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { CleaningRuleService } from '../service/cleaning-rule.service';
import { CleaningScheduleService } from '../service/cleaning-schedule.service';
import { CleaningView } from '../view/cleaning-rule.view';
import { PermissionService } from '../../user/service/permission.service';
import { StudentClassService } from '../../student-class/student-class.service';
import { ResourceService } from '../../resource/service/resource.service';
import { formatClassLabel } from '../../common/class-label.util';
import { StudentClassStatus } from '../../student-class/student-class.entity';
import { UserRole } from '../../user/user.entity';
import { CleaningAssignmentStatus } from '../entity/cleaning-assignment.entity';

@Controller()
export class CleaningRuleController {
  constructor(
    private readonly cleaningRuleService: CleaningRuleService,
    private readonly cleaningScheduleService: CleaningScheduleService,
    private readonly permissionService: PermissionService,
    private readonly studentClassService: StudentClassService,
    private readonly resourceService: ResourceService,
  ) {}

  @Action('cleaning:rule:open-create')
  async openCreate({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const user = await this.permissionService.requireAdminOrClassRep(
      body.user.id,
    );
    const resources = await this.resourceService.findSpaces();

    if (resources.length === 0) {
      await client.chat.postMessage({
        channel: body.user.id,
        text: '청소 구역(리소스)이 등록되어 있지 않습니다. 먼저 리소스를 등록해주세요.',
      });
      return;
    }

    if (user.role === UserRole.CLASS_REP) {
      // 반대표는 자기 반 기준으로만 규칙을 만들 수 있게 반 선택을 고정한다.
      const cls = user.studentClass;
      const label = formatClassLabel({
        admissionYear: cls.admissionYear,
        section: cls.section,
        graduated: cls.status === StudentClassStatus.GRADUATED,
      });
      const userOptions = await this.cleaningRuleService.getUserOptions(
        user.studentClassId,
      );
      await client.views.open({
        trigger_id: body.trigger_id,
        view: CleaningView.createModal(resources, userOptions, undefined, {
          id: user.studentClassId,
          label,
        }),
      });
    } else {
      // 교수/조교는 먼저 반을 고른 뒤 담당자 후보를 해당 반으로 필터링한다.
      const [classes, userOptions] = await Promise.all([
        this.studentClassService.findActiveClasses(),
        this.cleaningRuleService.getUserOptions(),
      ]);
      if (classes.length === 0) {
        await client.chat.postMessage({
          channel: body.user.id,
          text: '활성화된 반이 없습니다. 먼저 반을 생성해주세요.',
        });
        return;
      }
      await client.views.open({
        trigger_id: body.trigger_id,
        view: CleaningView.createModal(resources, userOptions, classes),
      });
    }
  }

  // 반 선택 시 해당 반의 활성 유저만 담당자 후보로 다시 불러온다.
  @Action('cleaning:rule:class-select')
  async handleClassSelect({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const selectedClassId = parseInt(
      (action as any).selected_option?.value ?? '',
      10,
    );
    if (isNaN(selectedClassId)) return;

    const [classes, resources, userOptions] = await Promise.all([
      this.studentClassService.findActiveClasses(),
      this.resourceService.findSpaces(),
      this.cleaningRuleService.getUserOptions(selectedClassId),
    ]);

    await client.views.update({
      view_id: body.view!.id,
      view: CleaningView.createModal(
        resources,
        userOptions,
        classes,
        undefined,
        selectedClassId,
      ),
    });
  }

  @Action('cleaning:rule:open-edit-list')
  async openEditList({
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
      view: CleaningView.editListModal(rules),
    });
  }

  // ── 홈 버튼: 삭제 (목록) ──
  @Action('cleaning:rule:open-delete-list')
  async openDeleteList({
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
      view: CleaningView.deleteListModal(rules),
    });
  }

  // ── 수정 목록 → 수정 모달 ──
  @Action('cleaning:rule:edit')
  async selectEdit({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const user = await this.permissionService.requireAdminOrClassRep(
      body.user.id,
    );
    const action = body.actions[0] as { value: string };
    const ruleId = parseInt(action.value, 10);

    const [rule, resources, slackIds] = await Promise.all([
      this.cleaningRuleService.findOneWithDetails(ruleId),
      this.resourceService.findSpaces(true),
      this.cleaningRuleService.getUserSlackIds(ruleId),
    ]);
    if (!rule) return;
    if (
      user.role === UserRole.CLASS_REP &&
      rule.studentClassId !== user.studentClassId
    )
      return;

    const userOptions = await this.cleaningRuleService.getUserOptions(
      rule.studentClassId,
    );

    await client.views.push({
      trigger_id: body.trigger_id,
      view: CleaningView.editModal(rule, resources, slackIds, userOptions),
    });
  }

  // ── 삭제 목록 → 삭제 확인 모달 ──
  @Action('cleaning:rule:delete')
  async selectDelete({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
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
      return;

    const label = formatClassLabel({
      admissionYear: rule.studentClass.admissionYear,
      section: rule.studentClass.section,
      graduated: rule.studentClass.status === StudentClassStatus.GRADUATED,
    });

    await client.views.push({
      trigger_id: body.trigger_id,
      view: CleaningView.deleteConfirmModal(ruleId, label),
    });
  }

  // ── 생성 모달 제출 ──
  @View('cleaning:modal:create')
  async handleCreate({
    ack,
    body,
    view,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;

    const studentClassId = view.private_metadata
      ? parseInt(view.private_metadata, 10)
      : NaN;

    if (isNaN(studentClassId)) {
      await ack({
        response_action: 'errors',
        errors: { class_block: '반을 선택해주세요.' } as Record<string, string>,
      });
      return;
    }

    const cycle = parseInt(values.cycle_block.cycle_input.value ?? '', 10);
    const needPeoples = parseInt(
      values.need_peoples_block.need_peoples_input.value ?? '',
      10,
    );
    const daysOfWeek: number[] = (
      (values.day_of_week_block.day_of_week_select as any).selected_options ??
      []
    ).map((o: { value: string }) => parseInt(o.value, 10));
    const resourceId = parseInt(
      values.resource_block.resource_select.selected_option?.value ?? '',
      10,
    );
    const slackUserIds: string[] = (
      (values.users_block?.users_select as any)?.selected_options ?? []
    ).map((o: { value: string }) => o.value);

    if (isNaN(cycle) || cycle < 1) {
      await ack({
        response_action: 'errors',
        errors: { cycle_block: '1 이상의 숫자를 입력해주세요.' },
      });
      return;
    }
    if (isNaN(needPeoples) || needPeoples < 1) {
      await ack({
        response_action: 'errors',
        errors: { need_peoples_block: '1 이상의 숫자를 입력해주세요.' },
      });
      return;
    }

    await ack();

    await this.cleaningRuleService.create({
      studentClassId,
      cycle,
      needPeoples,
      daysOfWeek,
      resourceId,
      slackUserIds,
    });

    logger.info(`CleaningRule created by ${body.user.id}`);
  }

  // ── 수정 모달 제출 ──
  @View('cleaning:modal:edit')
  async handleEdit({
    ack,
    body,
    view,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const ruleId = parseInt(view.private_metadata, 10);
    const values = view.state.values;

    const cycle = parseInt(values.cycle_block.cycle_input.value ?? '', 10);
    const needPeoples = parseInt(
      values.need_peoples_block.need_peoples_input.value ?? '',
      10,
    );
    const daysOfWeek: number[] = (
      (values.day_of_week_block.day_of_week_select as any).selected_options ??
      []
    ).map((o: { value: string }) => parseInt(o.value, 10));
    const resourceId = parseInt(
      values.resource_block.resource_select.selected_option?.value ?? '',
      10,
    );

    if (isNaN(cycle) || cycle < 1) {
      await ack({
        response_action: 'errors',
        errors: { cycle_block: '1 이상의 숫자를 입력해주세요.' },
      });
      return;
    }
    if (isNaN(needPeoples) || needPeoples < 1) {
      await ack({
        response_action: 'errors',
        errors: { need_peoples_block: '1 이상의 숫자를 입력해주세요.' },
      });
      return;
    }

    await ack();

    const slackUserIds: string[] = (
      (values.users_block.users_select as any).selected_options ?? []
    ).map((o: { value: string }) => o.value);

    await Promise.all([
      this.cleaningRuleService.update(ruleId, {
        cycle,
        needPeoples,
        daysOfWeek,
        resourceId,
      }),
      this.cleaningRuleService.setUsers(ruleId, slackUserIds),
    ]);

    const user = await this.permissionService.requireAdminOrClassRep(
      body.user.id,
    );
    const classId =
      user.role === UserRole.CLASS_REP ? user.studentClassId : undefined;
    const rules = await this.cleaningRuleService.findAllWithDetails(classId);

    if (body.view?.root_view_id) {
      await client.views.update({
        view_id: body.view.root_view_id,
        view: CleaningView.editListModal(rules),
      });
    }

    logger.info(`CleaningRule ${ruleId} updated by ${body.user.id}`);
  }

  // ── 삭제 확인 모달 제출 ──
  @View('cleaning:modal:delete')
  async handleDelete({
    ack,
    body,
    view,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const ruleId = parseInt(view.private_metadata, 10);
    await this.cleaningRuleService.delete(ruleId);

    const user = await this.permissionService.requireAdminOrClassRep(
      body.user.id,
    );
    const classId =
      user.role === UserRole.CLASS_REP ? user.studentClassId : undefined;
    const rules = await this.cleaningRuleService.findAllWithDetails(classId);

    if (body.view?.root_view_id) {
      await client.views.update({
        view_id: body.view.root_view_id,
        view: CleaningView.deleteListModal(rules),
      });
    }

    logger.info(`CleaningRule ${ruleId} deleted by ${body.user.id}`);
  }

  // 배정 생성 대상이 될 청소 규칙 목록을 연다.
  @Action('cleaning:rule:open-schedule-list')
  async openScheduleList({
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
      view: CleaningView.scheduleListModal(rules),
    });
  }

  // 선택한 규칙의 배정 생성 모달을 연다.
  @Action('cleaning:rule:schedule')
  async selectSchedule({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    await this.permissionService.requireAdminOrClassRep(body.user.id);

    const action = body.actions[0] as { value: string };
    const ruleId = parseInt(action.value, 10);

    const rule = await this.cleaningRuleService.findOneWithDetails(ruleId);
    if (!rule) return;

    const label = formatClassLabel({
      admissionYear: rule.studentClass.admissionYear,
      section: rule.studentClass.section,
      graduated: rule.studentClass.status === StudentClassStatus.GRADUATED,
    });

    await client.views.push({
      trigger_id: body.trigger_id,
      view: CleaningView.scheduleModal(ruleId, label),
    });
  }

  // 규칙 기준으로 청소 일정을 만들고 생성된 배정 대상자에게 DM 알림을 보낸다.
  @View('cleaning:modal:schedule')
  async handleSchedule({
    ack,
    view,
    client,
    body,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const { ruleId, label } = JSON.parse(view.private_metadata) as {
      ruleId: number;
      label: string;
    };
    const values = view.state.values;

    const startDate =
      values.start_date_block?.start_date_input?.selected_date ?? undefined;
    const endDate =
      values.end_date_block?.end_date_input?.selected_date ?? undefined;

    if (startDate && !endDate) {
      await ack({
        response_action: 'errors',
        errors: { end_date_block: '시작일과 종료일을 모두 입력해주세요.' },
      });
      return;
    }
    if (!startDate && endDate) {
      await ack({
        response_action: 'errors',
        errors: { start_date_block: '시작일과 종료일을 모두 입력해주세요.' },
      });
      return;
    }

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 과거 일정 생성은 허용하지 않고 Slack 모달 validation으로 바로 돌려보낸다.
    if (startDate && startDate < todayStr) {
      await ack({
        response_action: 'errors',
        errors: { start_date_block: '시작일은 오늘 이후여야 합니다.' },
      });
      return;
    }
    if (endDate && endDate < todayStr) {
      await ack({
        response_action: 'errors',
        errors: { end_date_block: '종료일은 오늘 이후여야 합니다.' },
      });
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      await ack({
        response_action: 'errors',
        errors: { end_date_block: '종료일은 시작일 이후여야 합니다.' },
      });
      return;
    }

    const { count, scheduleIds } =
      await this.cleaningScheduleService.generateSchedules(
        ruleId,
        startDate,
        endDate,
      );

    if (count === 0) {
      // 중복 날짜이거나 규칙 요일과 기간이 맞지 않으면 모달을 닫지 않고 안내한다.
      await ack({
        response_action: 'update',
        view: CleaningView.scheduleModal(
          ruleId,
          label,
          '생성할 새 일정이 없습니다. 이미 배정된 날짜이거나 해당 기간에 청소 요일이 없습니다.',
        ),
      });
      return;
    }

    await ack();

    await client.chat.postMessage({
      channel: body.user.id,
      text: `청소 배정이 완료되었습니다. ${count}개의 일정이 생성되었어요.`,
    });

    const newSchedules =
      await this.cleaningScheduleService.findSchedulesByIds(scheduleIds);
    const rule = await this.cleaningRuleService.findOneWithDetails(ruleId);
    const resourceName = rule?.ruleResource?.resource?.name ?? '미지정';

    // 생성 직후 새 배정자에게만 DM을 보내 사용자가 배정 사실을 바로 알 수 있게 한다.
    const notifications: Promise<unknown>[] = [];
    for (const schedule of newSchedules) {
      for (const assignee of schedule.assignees) {
        if (assignee.status === CleaningAssignmentStatus.ASSIGNED) {
          notifications.push(
            client.chat.postMessage({
              channel: assignee.userSlackId,
              text: `🧹 *${schedule.cleaningDate}* (${dayLabel(schedule.cleaningDate)}) | ${resourceName}\n청소 일정에 배정되었습니다.`,
            }),
          );
        }
      }
    }
    await Promise.allSettled(notifications);

    logger.info(
      `CleaningSchedule generated for rule ${ruleId} by ${body.user.id}: ${count} created`,
    );
  }
}

function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return (
    ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()] +
    '요일'
  );
}
