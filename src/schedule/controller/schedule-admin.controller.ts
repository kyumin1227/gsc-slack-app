import { Controller } from '@nestjs/common';
import { Action, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { ScheduleService } from '../service/schedule.service';
import { ScheduleView } from '../view/schedule.view';
import { UserService } from '../../user/user.service';
import { TagService } from '../../tag/tag.service';
import { ChannelService } from '../../channel/channel.service';
import { PermissionService } from '../../user/permission.service';
import { GoogleAclService } from '../../google/calendar/acl.service';
import { ScheduleNotificationService } from '../service/schedule-notification.service';
import { SCHEDULE_PAGE_SIZE } from '../constants';

@Controller()
export class ScheduleAdminController {
  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly userService: UserService,
    private readonly tagService: TagService,
    private readonly channelService: ChannelService,
    private readonly permissionService: PermissionService,
    private readonly googleAclService: GoogleAclService,
    private readonly scheduleNotificationService: ScheduleNotificationService,
  ) {}

  private async buildListModal(page: number, status: string, tagIds: number[]) {
    const statusFilter =
      status === 'all' ? undefined : (status as 'active' | 'inactive');
    const tagFilter = tagIds.length > 0 ? tagIds : undefined;

    const [{ schedules: rawSchedules, total }, displayTags] = await Promise.all(
      [
        this.scheduleService.findSchedulesPaginated({
          page,
          pageSize: SCHEDULE_PAGE_SIZE,
          status: statusFilter,
          tagIds: tagFilter,
        }),
        this.tagService.findDisplayTags(),
      ],
    );

    const totalPages = Math.max(1, Math.ceil(total / SCHEDULE_PAGE_SIZE));
    const safePage = Math.min(page, totalPages - 1);
    const schedules =
      safePage !== page
        ? (
            await this.scheduleService.findSchedulesPaginated({
              page: safePage,
              pageSize: SCHEDULE_PAGE_SIZE,
              status: statusFilter,
              tagIds: tagFilter,
            })
          ).schedules
        : rawSchedules;
    const displayTagMap = new Map(displayTags.map((t) => [t.id, t.name]));

    const [schedulesWithMeta, mutedScheduleIds] = await Promise.all([
      Promise.all(
        schedules.map(async (s) => {
          const [channels, acl] = await Promise.all([
            this.channelService.getSlackChannelIds(s.id),
            this.googleAclService.getCalendarAcl(s.calendarId).catch(() => []),
          ]);
          const writerEmails = acl
            .filter((e) => e.role === 'writer' || e.role === 'owner')
            .map((e) => e.email);
          const writers =
            await this.userService.mapEmailsToSlackIds(writerEmails);
          return {
            id: s.id,
            name: s.name,
            description: s.description,
            status: s.status,
            tags: s.tags.map((t) => ({
              id: t.id,
              name: displayTagMap.get(t.id) ?? t.name,
            })),
            createdBy: { name: s.createdBy?.name ?? '알 수 없음' },
            channels,
            writers,
            createdAt: s.createdAt,
          };
        }),
      ),
      this.scheduleNotificationService.getMutedSet(schedules.map((s) => s.id)),
    ]);

    return ScheduleView.listModal(schedulesWithMeta, displayTags, {
      page: safePage,
      totalPages,
      total,
      selectedStatus: status,
      selectedTagIds: tagIds,
      mutedScheduleIds,
    });
  }

  // 시간표 목록 모달 열기
  @Action('home:open-schedule-list')
  async listSchedules({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    await this.permissionService.requireAdmin(body.user.id);
    await client.views.open({
      trigger_id: body.trigger_id,
      view: await this.buildListModal(0, 'all', []),
    });
  }

  // 시간표 생성 모달 열기
  @Action('home:open-create-schedule')
  async openCreateModal({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    await this.permissionService.requireAdmin(body.user.id);
    const tags = await this.tagService.findDisplayTags();
    await client.views.open({
      trigger_id: body.trigger_id,
      view: ScheduleView.createModal(tags),
    });
  }

  // 시간표 생성 폼 제출
  @View('schedule:modal:create')
  async handleCreate({
    ack,
    body,
    view,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;
    const name = values.name_block.name_input.value ?? '';
    const description =
      values.description_block?.description_input?.value ?? undefined;
    const selectedTags = values.tags_block?.tags_input?.selected_options ?? [];

    if (!name.trim()) {
      await ack({
        response_action: 'errors',
        errors: { name_block: '과목명을 입력해주세요.' },
      });
      return;
    }

    const user = await this.userService.findBySlackId(body.user.id);
    if (!user) {
      await ack({
        response_action: 'errors',
        errors: { name_block: '사용자 정보를 찾을 수 없습니다.' },
      });
      return;
    }

    await ack();

    const tagIds = selectedTags.map((opt: { value: string }) =>
      parseInt(opt.value, 10),
    );
    const creatorRefreshToken = this.userService.getDecryptedRefreshToken(user);
    const created = await this.scheduleService.createSchedule({
      name: name.trim(),
      description: description?.trim(),
      tagIds,
      createdById: user.id,
      creatorEmail: user.email,
      creatorRefreshToken: creatorRefreshToken ?? undefined,
    });

    const studentClassIds = (created.tags ?? [])
      .filter((t) => t.studentClassId)
      .map((t) => t.studentClassId);
    await this.channelService.syncClassChannels(created.id, studentClassIds);

    await client.chat.postMessage({
      channel: body.user.id,
      text: `시간표 "${name}"이(가) 생성되었습니다. Google Calendar가 함께 생성되었습니다.`,
    });
    logger.info(`Schedule created: ${name} by ${user.name}`);
  }

  // 시간표 상태 토글 (활성화/비활성화)
  @Action(/^schedule:list:toggle:/)
  async handleToggle({
    ack,
    body,
    client,
    logger,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { action_id: string; value: string };
    const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);
    const toggleAction = action.value;

    if (toggleAction === 'deactivate') {
      await this.scheduleService.deactivateSchedule(scheduleId);
    } else if (toggleAction === 'activate') {
      await this.scheduleService.activateSchedule(scheduleId);
    }

    if (body.view?.id) {
      const meta = JSON.parse(body.view.private_metadata || '{}') as {
        page?: number;
        status?: string;
        tagIds?: number[];
      };
      await client.views.update({
        view_id: body.view.id,
        view: await this.buildListModal(
          meta.page ?? 0,
          meta.status ?? 'all',
          meta.tagIds ?? [],
        ),
      });
    }

    logger.info(`Schedule ${scheduleId} toggled to ${toggleAction}`);
  }

  // 필터 조회 제출 → 모달 내 목록 갱신
  @View('schedule:modal:list')
  async handleSearch({
    ack,
    view,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;
    const status =
      values['status_block']?.['status_select']?.selected_option?.value ??
      'all';
    const tagIds = (
      values['tags_block']?.['tags_select']?.selected_options ?? []
    ).map((opt: { value: string }) => parseInt(opt.value, 10));

    await ack({
      response_action: 'update',
      view: await this.buildListModal(0, status, tagIds),
    });
  }

  // 목록 페이지 이동
  @Action(/^schedule:list:page:/)
  async handlePageChange({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { value: string };
    const page = parseInt(action.value, 10);
    const meta = JSON.parse(body.view?.private_metadata || '{}') as {
      status?: string;
      tagIds?: number[];
    };

    if (body.view?.id) {
      await client.views.update({
        view_id: body.view.id,
        view: await this.buildListModal(
          page,
          meta.status ?? 'all',
          meta.tagIds ?? [],
        ),
      });
    }
  }

  // 수정 모달 열기
  @Action(/^schedule:list:edit:/)
  async handleOpenEdit({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { action_id: string };
    const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);

    const [schedule, displayTags, permissions, notifChannelIds] =
      await Promise.all([
        this.scheduleService.findById(scheduleId),
        this.tagService.findDisplayTags(),
        this.scheduleService.getCalendarPermissions(scheduleId),
        this.channelService.getSlackChannelIds(scheduleId),
      ]);

    if (!schedule) return;

    const editorEmails = (permissions ?? [])
      .filter((p) => p.role === 'writer')
      .map((p) => p.email);
    const initialEditorSlackIds =
      await this.userService.mapEmailsToSlackIds(editorEmails);

    await client.views.push({
      trigger_id: body.trigger_id,
      view: ScheduleView.editModal(
        {
          id: schedule.id,
          name: schedule.name,
          description: schedule.description,
          tags: schedule.tags,
        },
        displayTags,
        initialEditorSlackIds,
        notifChannelIds,
      ),
    });
  }

  // 알림 뮤트
  @Action(/^schedule:list:mute:/)
  async handleMute({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const action = body.actions[0] as { action_id: string };
    const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);
    await this.scheduleNotificationService.mute(scheduleId);
    if (body.view?.id) {
      await client.views.update({
        view_id: body.view.id,
        view: await this.buildListModal(0, 'all', []),
      });
    }
  }

  // 알림 뮤트 해제
  @Action(/^schedule:list:unmute:/)
  async handleUnmute({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const action = body.actions[0] as { action_id: string };
    const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);
    await this.scheduleNotificationService.unmute(scheduleId);
    if (body.view?.id) {
      await client.views.update({
        view_id: body.view.id,
        view: await this.buildListModal(0, 'all', []),
      });
    }
  }

  // 삭제 확인 모달 열기
  @Action(/^schedule:list:delete:/)
  async handleOpenDelete({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const action = body.actions[0] as { action_id: string; value: string };
    const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);
    const scheduleName = action.value;
    await client.views.push({
      trigger_id: body.trigger_id,
      view: ScheduleView.deleteConfirmModal(scheduleId, scheduleName),
    });
  }

  // 삭제 확인 제출 → 소프트 삭제
  @View('schedule:modal:delete')
  async handleDelete({
    ack,
    body,
    view,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    await ack();
    const scheduleId = parseInt(view.private_metadata, 10);
    await this.scheduleService.deleteSchedule(scheduleId);
    logger.info(`Schedule ${scheduleId} deleted by ${body.user.id}`);
    await client.chat.postMessage({
      channel: body.user.id,
      text: '✅ 시간표가 삭제되었습니다.',
    });
  }

  // 수정 폼 제출 → 시간표 정보 업데이트
  @View('schedule:modal:edit')
  async handleEdit({
    ack,
    body,
    view,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;
    const name = values.name_block.name_input.value ?? '';
    const description =
      values.description_block?.description_input?.value ?? undefined;
    const selectedTags = values.tags_block?.tags_input?.selected_options ?? [];
    const scheduleId = parseInt(view.private_metadata, 10);

    if (!name.trim()) {
      await ack({
        response_action: 'errors',
        errors: { name_block: '과목명을 입력해주세요.' },
      });
      return;
    }

    await ack();

    const tagIds = selectedTags.map((opt: { value: string }) =>
      parseInt(opt.value, 10),
    );

    const beforeSchedule = await this.scheduleService.findById(scheduleId);
    const oldStudentClassIds = (beforeSchedule?.tags ?? [])
      .filter((t) => t.studentClassId)
      .map((t) => t.studentClassId);

    const updated = await this.scheduleService.updateSchedule(scheduleId, {
      name: name.trim(),
      description: description?.trim(),
      tagIds,
    });

    const selectedChannelIds =
      (
        values['notification_channels_block']?.['channels_select'] as
          | { selected_channels?: string[] }
          | undefined
      )?.selected_channels ?? [];

    const newStudentClassIds = (updated?.tags ?? [])
      .filter((t) => t.studentClassId)
      .map((t) => t.studentClassId);
    const removedStudentClassIds = oldStudentClassIds.filter(
      (id) => !newStudentClassIds.includes(id),
    );
    const removedChannelIds = await this.channelService.getClassSlackChannelIds(
      removedStudentClassIds,
    );
    const filteredChannelIds = selectedChannelIds.filter(
      (id) => !removedChannelIds.includes(id),
    );

    await this.channelService.setScheduleChannels(
      scheduleId,
      filteredChannelIds,
    );
    await this.channelService.syncClassChannels(scheduleId, newStudentClassIds);

    const selectedEditorIds =
      (
        values['editors_block']?.['editors_select'] as
          | { selected_users?: string[] }
          | undefined
      )?.selected_users ?? [];

    const currentPermissions =
      await this.scheduleService.getCalendarPermissions(scheduleId);
    const currentEditorEmails = (currentPermissions ?? [])
      .filter((p) => p.role === 'writer')
      .map((p) => p.email);
    const currentEditorSlackIds =
      await this.userService.mapEmailsToSlackIds(currentEditorEmails);

    const oldSet = new Set(currentEditorSlackIds);
    const newSet = new Set(selectedEditorIds);
    const toAdd = selectedEditorIds.filter((id) => !oldSet.has(id));
    const toRemove = currentEditorSlackIds.filter((id) => !newSet.has(id));

    await Promise.all([
      ...toAdd.map(async (slackId) => {
        const user = await this.userService.findBySlackId(slackId);
        if (user?.email) {
          await this.scheduleService.shareCalendar(
            scheduleId,
            user.email,
            'writer',
          );
        }
      }),
      ...toRemove.map(async (slackId) => {
        const user = await this.userService.findBySlackId(slackId);
        if (user?.email) {
          await this.scheduleService.unshareCalendar(scheduleId, user.email);
        }
      }),
    ]);

    await client.chat.postMessage({
      channel: body.user.id,
      text: `시간표 "${name}"이(가) 수정되었습니다.`,
    });
    logger.info(`Schedule ${scheduleId} updated by ${body.user.id}`);
  }
}
