import { Controller } from '@nestjs/common';
import { Action, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { ScheduleService } from '../service/schedule.service';
import { ScheduleRecurringService } from '../service/schedule-recurring.service';
import { ScheduleRecurringView } from '../view/schedule-recurring.view';
import { PermissionService } from '../../user/permission.service';

@Controller()
export class ScheduleRecurringController {
  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly scheduleRecurringService: ScheduleRecurringService,
    private readonly permissionService: PermissionService,
  ) {}

  // 반복 일정 생성 모달 열기
  @Action('home:open-create-recurrence')
  async openCreateRecurringModal({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const userId = body.user.id;
    await this.permissionService.requireAdmin(userId);

    const schedules = await this.scheduleService.findActiveSchedules();

    await client.views.open({
      trigger_id: body.trigger_id,
      view: ScheduleRecurringView.createRecurringModal(
        schedules.map((s) => ({ id: s.id, name: s.name })),
      ),
    });
  }

  // 반복 일정 생성 폼 제출
  @View('schedule:modal:create_recurring')
  async handleCreateRecurring({
    ack,
    body,
    view,
    client,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;

    const scheduleId = parseInt(
      values.schedule_block.schedule_input.selected_option?.value ?? '',
      10,
    );
    const title = values.title_block.title_input.value ?? '';
    const description =
      values.description_block?.description_input?.value ?? undefined;
    const roomVal = values.location_block?.location_input?.value?.trim() ?? '';
    const professorVal =
      values.professor_block?.professor_input?.value?.trim() ?? '';
    const location = professorVal
      ? `${roomVal} / ${professorVal}`
      : roomVal || undefined;
    const startDate =
      values.start_date_block.start_date_input.selected_date ?? '';
    const endDate = values.end_date_block.end_date_input.selected_date ?? '';
    const startTime =
      values.start_time_block.start_time_input.selected_time ?? '';
    const endTime = values.end_time_block.end_time_input.selected_time ?? '';
    const recurrenceType = (values.recurrence_block.recurrence_input
      .selected_option?.value ?? 'weekly') as 'weekly' | 'biweekly' | 'monthly';
    const selectedDays =
      values.days_of_week_block?.days_of_week_input?.selected_options ?? [];
    const daysOfWeek = selectedDays.map((opt: { value: string }) =>
      parseInt(opt.value, 10),
    );

    if (!title.trim()) {
      await ack({
        response_action: 'errors',
        errors: { title_block: '이벤트 제목을 입력해주세요.' },
      });
      return;
    }
    if (!startDate || !endDate) {
      await ack({
        response_action: 'errors',
        errors: { start_date_block: '시작일과 종료일을 선택해주세요.' },
      });
      return;
    }
    if (endDate < startDate) {
      await ack({
        response_action: 'errors',
        errors: { end_date_block: '종료일은 시작일 이후여야 합니다.' },
      });
      return;
    }
    if (endTime <= startTime) {
      await ack({
        response_action: 'errors',
        errors: { end_time_block: '종료 시각은 시작 시각 이후여야 합니다.' },
      });
      return;
    }
    if (recurrenceType !== 'monthly' && daysOfWeek.length === 0) {
      await ack({
        response_action: 'errors',
        errors: {
          days_of_week_block: '매주/격주 반복 시 요일을 선택해주세요.',
        },
      });
      return;
    }

    await ack();

    await this.scheduleRecurringService.createRecurringEvents(
      {
        scheduleId,
        title: title.trim(),
        description: description?.trim(),
        location: location?.trim(),
        startDate,
        endDate,
        startTime,
        endTime,
        recurrenceType,
        daysOfWeek: recurrenceType !== 'monthly' ? daysOfWeek : undefined,
      },
      body.user.id,
    );

    await client.chat.postMessage({
      channel: body.user.id,
      text: `"${title}" 반복 일정 생성이 완료되었습니다.`,
    });
  }

  // 반복 일정 삭제 모달 열기 (시간표 선택)
  @Action('home:open-delete-recurrence')
  async openDeleteRecurringModal({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const userId = body.user.id;
    await this.permissionService.requireAdmin(userId);

    const schedules =
      await this.scheduleRecurringService.findSchedulesWithRecurrenceGroups();

    if (schedules.length === 0) {
      return;
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: ScheduleRecurringView.selectScheduleForRecurringModal(
        schedules,
        'delete',
      ),
    });
  }

  // 반복 일정 삭제 step1 — 시간표 선택 후 반복 그룹 목록 표시
  @View('recurring:modal:step1:delete')
  async handleStep1DeleteRecurring({
    ack,
    view,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;
    const scheduleId = parseInt(
      values.schedule_block.schedule_input.selected_option?.value ?? '',
      10,
    );

    if (isNaN(scheduleId)) {
      await ack({
        response_action: 'errors',
        errors: { schedule_block: '시간표를 선택해주세요.' },
      });
      return;
    }

    const [groups, schedules] = await Promise.all([
      this.scheduleRecurringService.findRecurrenceGroupsBySchedule(scheduleId),
      this.scheduleService.findActiveSchedules(),
    ]);
    const scheduleName = schedules.find((s) => s.id === scheduleId)?.name ?? '';

    if (groups.length === 0) {
      await ack({
        response_action: 'errors',
        errors: { schedule_block: '해당 시간표에 반복 일정이 없습니다.' },
      });
      return;
    }

    await ack({
      response_action: 'push',
      view: ScheduleRecurringView.deleteRecurringModal(groups, scheduleName),
    });
  }

  // 반복 일정 삭제 폼 제출
  @View('recurring:modal:delete')
  async handleDeleteRecurring({
    ack,
    body,
    view,
    client,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;
    const groupDbId = parseInt(
      values.group_block.group_input.selected_option?.value ?? '',
      10,
    );
    const scope = (values.scope_block.scope_input.selected_option?.value ??
      'all') as 'all' | 'future';
    const filterOriginal =
      (values.filter_block.filter_input.selected_option?.value ??
        'original') === 'original';

    await ack();

    const { deleted, total } =
      await this.scheduleRecurringService.deleteRecurringGroup(
        groupDbId,
        scope,
        filterOriginal,
        body.user.id,
      );
    await client.chat.postMessage({
      channel: body.user.id,
      text: `반복 일정 삭제 완료: ${deleted}/${total}개`,
    });
  }

  // 반복 일정 수정 모달 열기 (시간표 선택)
  @Action('home:open-edit-recurrence')
  async openEditRecurringModal({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const userId = body.user.id;
    await this.permissionService.requireAdmin(userId);

    const schedules =
      await this.scheduleRecurringService.findSchedulesWithRecurrenceGroups();

    if (schedules.length === 0) {
      return;
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: ScheduleRecurringView.selectScheduleForRecurringModal(
        schedules,
        'edit',
      ),
    });
  }

  // 반복 일정 수정 step1 — 시간표 선택 후 반복 그룹 목록 표시
  @View('recurring:modal:step1:edit')
  async handleStep1EditRecurring({
    ack,
    view,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;
    const scheduleId = parseInt(
      values.schedule_block.schedule_input.selected_option?.value ?? '',
      10,
    );

    if (isNaN(scheduleId)) {
      await ack({
        response_action: 'errors',
        errors: { schedule_block: '시간표를 선택해주세요.' },
      });
      return;
    }

    const [groups, schedules] = await Promise.all([
      this.scheduleRecurringService.findRecurrenceGroupsBySchedule(scheduleId),
      this.scheduleService.findActiveSchedules(),
    ]);
    const scheduleName = schedules.find((s) => s.id === scheduleId)?.name ?? '';

    if (groups.length === 0) {
      await ack({
        response_action: 'errors',
        errors: { schedule_block: '해당 시간표에 반복 일정이 없습니다.' },
      });
      return;
    }

    await ack({
      response_action: 'push',
      view: ScheduleRecurringView.selectGroupForEditModal(
        groups,
        scheduleName,
        scheduleId,
      ),
    });
  }

  // 반복 일정 수정 step2 — 그룹 선택 후 프리필 폼 표시
  @View('recurring:modal:step2:edit')
  async handleStep2EditRecurring({
    ack,
    view,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const { scheduleName } = JSON.parse(view.private_metadata || '{}') as {
      scheduleName: string;
    };
    const groupDbId = parseInt(
      view.state.values.group_block.group_input.selected_option?.value ?? '',
      10,
    );

    if (isNaN(groupDbId)) {
      await ack({
        response_action: 'errors',
        errors: { group_block: '반복 일정을 선택해주세요.' },
      });
      return;
    }

    const group =
      await this.scheduleRecurringService.findRecurrenceGroupById(groupDbId);
    if (!group) {
      await ack({
        response_action: 'errors',
        errors: { group_block: '반복 일정을 찾을 수 없습니다.' },
      });
      return;
    }

    await ack({
      response_action: 'push',
      view: ScheduleRecurringView.editRecurringModal(group, scheduleName),
    });
  }

  // 반복 일정 수정 폼 제출
  @View('recurring:modal:edit')
  async handleEditRecurring({
    ack,
    body,
    view,
    client,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const { groupDbId } = JSON.parse(view.private_metadata || '{}') as {
      groupDbId: number;
    };
    const values = view.state.values;
    const title = values.title_block.title_input.value ?? undefined;
    const description =
      values.description_block.description_input.value ?? undefined;
    const roomVal2 = values.location_block?.location_input?.value?.trim() ?? '';
    const professorVal2 =
      values.professor_block?.professor_input?.value?.trim() ?? '';
    const location = professorVal2
      ? `${roomVal2} / ${professorVal2}`
      : roomVal2 || undefined;
    const startTime =
      values.start_time_block.start_time_input.selected_time ?? undefined;
    const endTime =
      values.end_time_block.end_time_input.selected_time ?? undefined;
    const scope = (values.scope_block.scope_input.selected_option?.value ??
      'all') as 'all' | 'future';
    const rawDays =
      values.days_of_week_block?.days_of_week_input?.selected_options;
    const daysOfWeek =
      rawDays && rawDays.length > 0
        ? rawDays.map((o) => parseInt(o.value, 10))
        : undefined;
    const startDate =
      values.start_date_block?.start_date_input?.selected_date ?? undefined;
    const endDate =
      values.end_date_block?.end_date_input?.selected_date ?? undefined;

    if (startDate && endDate && startDate > endDate) {
      await ack({
        response_action: 'errors',
        errors: { end_date_block: '종료일이 시작일보다 앞입니다.' },
      });
      return;
    }

    if (startTime && !endTime) {
      await ack({
        response_action: 'errors',
        errors: { end_time_block: '종료 시각도 함께 입력해주세요.' },
      });
      return;
    }
    if (!startTime && endTime) {
      await ack({
        response_action: 'errors',
        errors: { start_time_block: '시작 시각도 함께 입력해주세요.' },
      });
      return;
    }

    await ack();

    const { updated, total } =
      await this.scheduleRecurringService.updateRecurringGroup(
        groupDbId,
        {
          title,
          description,
          location,
          startTime,
          endTime,
          daysOfWeek,
          startDate,
          endDate,
        },
        scope,
        body.user.id,
      );
    await client.chat.postMessage({
      channel: body.user.id,
      text: `반복 일정 수정 완료: ${updated}/${total}개`,
    });
  }
}
