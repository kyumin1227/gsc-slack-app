import { Controller } from '@nestjs/common';
import { Action, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { CleaningRuleService } from './cleaning-rule.service';
import { CleaningView } from './cleaning.view';
import { PermissionService } from '../user/service/permission.service';
import { StudentClassService } from '../student-class/student-class.service';
import { ResourceService } from '../resource/service/resource.service';
import { formatClassLabel } from '../common/class-label.util';
import { StudentClassStatus } from '../student-class/student-class.entity';
import { UserRole } from '../user/user.entity';

@Controller()
export class CleaningController {
  constructor(
    private readonly cleaningRuleService: CleaningRuleService,
    private readonly permissionService: PermissionService,
    private readonly studentClassService: StudentClassService,
    private readonly resourceService: ResourceService,
  ) {}

  // ── 홈 버튼: 추가 ──────────────────────────────────────────────
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

  // ── 홈 버튼: 수정 (목록) ────────────────────────────────────────
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

  // ── 홈 버튼: 삭제 (목록) ────────────────────────────────────────
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

  // ── 수정 목록 → 수정 모달 ───────────────────────────────────────
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

  // ── 삭제 목록 → 삭제 확인 모달 ─────────────────────────────────
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

  // ── 생성 모달 제출 ──────────────────────────────────────────────
  @View('cleaning:modal:create')
  async handleCreate({
    ack,
    body,
    view,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;

    const fixedClassId = view.private_metadata
      ? parseInt(view.private_metadata, 10)
      : NaN;
    const studentClassId = !isNaN(fixedClassId)
      ? fixedClassId
      : parseInt(
          values.class_block?.class_select?.selected_option?.value ?? '',
          10,
        );

    const cycle = parseInt(values.cycle_block.cycle_input.value ?? '', 10);
    const needPeoples = parseInt(
      values.need_peoples_block.need_peoples_input.value ?? '',
      10,
    );
    const daysOfWeek: number[] = (
      (values.day_of_week_block.day_of_week_select as any).selected_options ?? []
    ).map((o: { value: string }) => parseInt(o.value, 10));
    const resourceId = parseInt(
      values.resource_block.resource_select.selected_option?.value ?? '',
      10,
    );
    const slackUserIds: string[] = (
      (values.users_block.users_select as any).selected_options ?? []
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

  // ── 수정 모달 제출 ──────────────────────────────────────────────
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
      (values.day_of_week_block.day_of_week_select as any).selected_options ?? []
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

  // ── 삭제 확인 모달 제출 ─────────────────────────────────────────
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
}
