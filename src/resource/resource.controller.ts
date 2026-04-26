import { Controller, Logger } from '@nestjs/common';
import { Action, Command, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackCommandMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { ResourceService } from './resource.service';
import { ResourceView } from './resource.view';
import { ResourceStatus, ResourceType } from './resource.entity';
import { UserService } from '../user/user.service';
import { UserStatus } from '../user/user.entity';
import { GoogleCalendarService } from '../google/google-calendar.service';
import { CMD } from '../common/slack-commands';
import { PermissionService } from '../user/permission.service';

@Controller()
export class ResourceController {
  private readonly logger = new Logger(ResourceController.name);

  constructor(
    private readonly resourceService: ResourceService,
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  @Command(CMD.스터디룸생성)
  @Action('home:open-create-study-room')
  async openCreateModal({
    ack,
    client,
    body,
  }: (SlackCommandMiddlewareArgs | SlackActionMiddlewareArgs<BlockAction>) &
    AllMiddlewareArgs) {
    await ack();

    const userId = 'user_id' in body ? body.user_id : body.user.id;
    await this.permissionService.requireAdmin(userId);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: ResourceView.createModal(),
    });
  }

  @View('study-room:modal:create')
  async submitCreate({
    ack,
    client,
    body,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const values = body.view.state.values;
    const name = values.name_block.name_input.value ?? '';
    const type = (values.type_block.type_select.selected_option?.value ??
      'study_room') as ResourceType;
    const aliasesRaw = values.aliases_block.aliases_input.value ?? '';
    const aliases = aliasesRaw
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const description =
      values.description_block.description_input.value ?? undefined;
    const isDefault =
      (values.is_default_block?.is_default_checkbox?.selected_options ?? [])
        .length > 0;

    const resource = await this.resourceService.create({
      name,
      type,
      aliases,
      description,
      isDefault,
    });

    const typeLabel =
      type === ResourceType.CLASSROOM
        ? '교실'
        : type === ResourceType.PROFESSOR
          ? '교수 캘린더'
          : '스터디룸';

    let text = `✅ ${typeLabel}이 등록되었습니다.\n*${resource.name}*`;

    await client.chat.postMessage({
      channel: body.user.id,
      text,
    });
  }

  @Command(CMD.예약)
  @Action('home:open-booking')
  async openList({
    ack,
    client,
    body,
  }: (SlackCommandMiddlewareArgs | SlackActionMiddlewareArgs<BlockAction>) &
    AllMiddlewareArgs) {
    await ack();

    const userId = 'user_id' in body ? body.user_id : body.user.id;

    const user = await this.userService.findBySlackId(userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      if ('channel_id' in body) {
        await client.chat.postEphemeral({
          channel: body.channel_id,
          user: userId,
          text: '활성화된 사용자만 이용 가능합니다. 먼저 회원가입을 완료해주세요.',
        });
      }
      return;
    }

    const resources = await this.resourceService.findAllByType(
      ResourceType.STUDY_ROOM,
      true,
    );
    await client.views.open({
      trigger_id: body.trigger_id,
      view: ResourceView.listModal(resources),
    });
  }

  @Action(/^(start_time_select|duration_select)$/)
  async onTimeInputChanged({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const view = body.view;
    if (!view) return;

    const values = view.state.values;
    const startTimeStr =
      values.start_time_block?.start_time_select?.selected_time;
    const durationStr =
      values.duration_block?.duration_select?.selected_option?.value;
    const dateStr = values.date_block?.date_select?.selected_date;

    let calculatedEndTime: string | undefined;
    if (dateStr && startTimeStr && durationStr) {
      const startTime = new Date(`${dateStr}T${startTimeStr}:00+09:00`);
      const endTime = new Date(
        startTime.getTime() + parseInt(durationStr, 10) * 60 * 1000,
      );
      const kstMin =
        (endTime.getUTCHours() * 60 + endTime.getUTCMinutes() + 9 * 60) %
        (24 * 60);
      calculatedEndTime = `${String(Math.floor(kstMin / 60)).padStart(2, '0')}:${String(kstMin % 60).padStart(2, '0')}`;
    }

    if (view.callback_id === 'study-room:modal:modify-booking') {
      const { calendarId, eventId, roomName } = JSON.parse(
        view.private_metadata,
      ) as { calendarId: string; eventId: string; roomName: string };

      const summary = values.title_block?.title_input?.value ?? '';
      const attendeeSlackIds =
        values.attendees_block?.attendees_select?.selected_users ?? [];

      const startTime =
        dateStr && startTimeStr
          ? new Date(`${dateStr}T${startTimeStr}:00+09:00`)
          : new Date();
      const durationMin = durationStr ? parseInt(durationStr, 10) : 60;
      const endTime = new Date(startTime.getTime() + durationMin * 60 * 1000);

      await client.views.update({
        view_id: view.id,
        hash: view.hash,
        view: ResourceView.modifyBookingModal(
          { calendarId, eventId, roomName, summary, startTime, endTime },
          attendeeSlackIds,
        ),
      });
      return;
    }

    const { roomId } = JSON.parse(view.private_metadata) as { roomId: number };
    const resource = await this.resourceService.findById(roomId);
    if (!resource) return;

    await client.views.update({
      view_id: view.id,
      hash: view.hash,
      view: ResourceView.bookingModal(resource, calculatedEndTime),
    });
  }

  @Action('study-room:action:book')
  async openBookingModal({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const resourceId = parseInt((action as { value: string }).value, 10);
    const resource = await this.resourceService.findById(resourceId);
    if (!resource) return;

    await client.views.push({
      trigger_id: body.trigger_id,
      view: ResourceView.bookingModal(resource),
    });
  }

  @View('study-room:modal:book')
  async submitBooking({
    ack,
    client,
    body,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = body.view.state.values;
    const { roomId } = JSON.parse(body.view.private_metadata) as {
      roomId: number;
    };

    const title = values.title_block.title_input.value ?? '';
    const date = values.date_block.date_select.selected_date ?? '';
    const startTimeStr =
      values.start_time_block.start_time_select.selected_time ?? '';
    const durationMinutes = parseInt(
      values.duration_block.duration_select.selected_option?.value ?? '60',
      10,
    );
    const attendeeSlackIds =
      values.attendees_block.attendees_select.selected_users ?? [];

    const startMinutes = parseInt(startTimeStr.split(':')[1] ?? '0', 10);
    if (startMinutes % 15 !== 0) {
      await ack({
        response_action: 'errors',
        errors: {
          start_time_block:
            '시간은 15분 단위로 입력해주세요 (예: 09:00, 09:15, 09:30)',
        },
      });
      return;
    }

    await ack();

    const startTime = new Date(`${date}T${startTimeStr}:00+09:00`);
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    await this.resourceService.bookResource({
      resourceId: roomId,
      title,
      startTime,
      endTime,
      bookerSlackId: body.user.id,
      attendeeSlackIds,
    });

    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ 예약이 완료되었습니다.\n*${title}* | ${date} ${startTimeStr} (${durationMinutes}분)`,
    });
  }

  @Command(CMD.내예약)
  @Action('home:open-my-bookings')
  async openMyBookings({
    ack,
    client,
    body,
  }: (SlackCommandMiddlewareArgs | SlackActionMiddlewareArgs<BlockAction>) &
    AllMiddlewareArgs) {
    await ack();

    const userId = 'user_id' in body ? body.user_id : body.user.id;

    const [bookings, consultations] = await Promise.all([
      this.resourceService.getMyBookings(userId),
      this.resourceService.getProfessorConsultations(userId),
    ]);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: ResourceView.myBookingsModal(bookings, consultations),
    });
  }

  @Action('home:open-professor-booking-pages')
  async openProfessorBookingPages({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const professors = await this.resourceService.findAllByType(
      ResourceType.PROFESSOR,
      true,
    );
    await client.views.open({
      trigger_id: body.trigger_id,
      view: ResourceView.professorBookingPagesModal(professors),
    });
  }

  @Action('study-room:action:cancel')
  async cancelBooking({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const { calendarId, eventId, roomName } = JSON.parse(
      (action as { value: string }).value,
    ) as { calendarId: string; eventId: string; roomName: string };

    await this.resourceService.cancelBooking(calendarId, eventId);
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ *${roomName}* 예약이 취소되었습니다.`,
    });
  }

  @Action('study-room:action:modify')
  async openModifyModal({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const { calendarId, eventId, roomName, startIso, endIso } = JSON.parse(
      (action as { value: string }).value,
    ) as {
      calendarId: string;
      eventId: string;
      roomName: string;
      startIso: string;
      endIso: string;
    };

    const event = await this.googleCalendarService.getEventById(
      calendarId,
      eventId,
    );
    const attendeeEmails = event?.attendees?.map((a) => a.email ?? '') ?? [];
    const initialAttendeeSlackIds = (
      await Promise.all(
        attendeeEmails.map((email) => this.userService.findByEmail(email)),
      )
    )
      .filter((u): u is NonNullable<typeof u> => u !== null)
      .map((u) => u.slackId);

    await client.views.push({
      trigger_id: body.trigger_id,
      view: ResourceView.modifyBookingModal(
        {
          calendarId,
          eventId,
          roomName,
          summary: event?.summary ?? '',
          startTime: new Date(startIso),
          endTime: new Date(endIso),
        },
        initialAttendeeSlackIds,
      ),
    });
  }

  @View('study-room:modal:modify-booking')
  async submitModifyBooking({
    ack,
    client,
    body,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = body.view.state.values;
    const { calendarId, eventId, roomName } = JSON.parse(
      body.view.private_metadata,
    ) as { calendarId: string; eventId: string; roomName: string };

    const title = values.title_block.title_input.value ?? '';
    const date = values.date_block.date_select.selected_date ?? '';
    const startTimeStr =
      values.start_time_block.start_time_select.selected_time ?? '';
    const durationMinutes = parseInt(
      values.duration_block.duration_select.selected_option?.value ?? '60',
      10,
    );
    const attendeeSlackIds =
      values.attendees_block.attendees_select.selected_users ?? [];

    const startMinutes = parseInt(startTimeStr.split(':')[1] ?? '0', 10);
    if (startMinutes % 15 !== 0) {
      await ack({
        response_action: 'errors',
        errors: {
          start_time_block:
            '시간은 15분 단위로 입력해주세요 (예: 09:00, 09:15, 09:30)',
        },
      });
      return;
    }

    await ack();

    const startTime = new Date(`${date}T${startTimeStr}:00+09:00`);
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    const result = await this.resourceService.modifyBooking(
      calendarId,
      eventId,
      {
        title,
        startTime,
        endTime,
        attendeeSlackIds,
        resourceName: roomName,
      },
    );

    if (result === 'cancelled') {
      await client.chat.postMessage({
        channel: body.user.id,
        text: `🗑️ 참석자가 없어 *${roomName}* 예약이 취소되었습니다.\n${date} ${startTimeStr} (${durationMinutes}분)`,
      });
    } else {
      await client.chat.postMessage({
        channel: body.user.id,
        text: `✅ *${roomName}* 예약이 수정되었습니다.\n${date} ${startTimeStr} (${durationMinutes}분)`,
      });
    }
  }

  // URL 링크 버튼 — Slack 경고 방지용 ack
  @Action(/^space:action:view-|^study-room:action:view-calendar$|^professor:booking:|^consultation:view-/)
  async ackViewLinkButtons({
    ack,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
  }

  @Action(/^consultation:cancel:/)
  async cancelConsultation({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const userId = body.user.id;
    const eventId = (body.actions[0] as any).action_id.replace('consultation:cancel:', '');

    try {
      await this.resourceService.cancelConsultation(userId, eventId);
      await client.views.update({
        view_id: body.view!.id,
        view: await this.buildMyBookingsView(userId),
      });
    } catch (e) {
      this.logger.error('교수 상담 취소 실패', e);
    }
  }

  private async buildMyBookingsView(userId: string) {
    const [bookings, consultations] = await Promise.all([
      this.resourceService.getMyBookings(userId),
      this.resourceService.getProfessorConsultations(userId),
    ]);
    return ResourceView.myBookingsModal(bookings, consultations);
  }

  @Action('home:open-classroom-schedule')
  async openClassroomSchedule({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const classrooms = await this.resourceService.findAllByType(
      ResourceType.CLASSROOM,
      true,
    );
    await client.views.open({
      trigger_id: body.trigger_id,
      view: ResourceView.classroomScheduleModal(classrooms),
    });
  }

  @Action('home:open-professor-schedule')
  async openProfessorSchedule({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const professors = await this.resourceService.findAllByType(
      ResourceType.PROFESSOR,
      true,
    );
    await client.views.open({
      trigger_id: body.trigger_id,
      view: ResourceView.professorScheduleModal(professors),
    });
  }

  // ========== 리소스 관리 (어드민) ==========

  @Command(CMD.스터디룸)
  @Action('home:open-study-room-manage')
  async openManageModal({
    ack,
    client,
    body,
  }: (SlackCommandMiddlewareArgs | SlackActionMiddlewareArgs<BlockAction>) &
    AllMiddlewareArgs) {
    await ack();

    const userId = 'user_id' in body ? body.user_id : body.user.id;
    await this.permissionService.requireAdmin(userId);

    const resources = await this.resourceService.findAll();
    await client.views.open({
      trigger_id: body.trigger_id,
      view: ResourceView.manageModal(resources),
    });
  }

  @Action('study-room:admin:open-create')
  async adminOpenCreate({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    await client.views.push({
      trigger_id: body.trigger_id,
      view: ResourceView.createModal(),
    });
  }

  @Action('study-room:admin:open-edit')
  async adminOpenEdit({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const { roomId } = JSON.parse((action as { value: string }).value) as {
      roomId: number;
    };
    const resource = await this.resourceService.findById(roomId);
    if (!resource) return;
    await client.views.push({
      trigger_id: body.trigger_id,
      view: ResourceView.editModal(resource),
    });
  }

  @View('study-room:modal:edit')
  async submitEdit({
    ack,
    client,
    body,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    await ack();
    const values = body.view.state.values;
    const { roomId } = JSON.parse(body.view.private_metadata) as {
      roomId: number;
    };
    const name = values.name_block.name_input.value ?? '';
    const type = values.type_block.type_select.selected_option
      ?.value as ResourceType;
    const aliasesRaw = values.aliases_block.aliases_input.value ?? '';
    const aliases = aliasesRaw
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const description =
      values.description_block.description_input.value ?? null;
    const status = values.status_block.status_select.selected_option
      ?.value as ResourceStatus;
    const bookingUrl =
      values.booking_url_block?.booking_url_input?.value?.trim() || null;

    await this.resourceService.rename(roomId, name);
    await this.resourceService.updateInfo(roomId, {
      description,
      status,
      aliases,
      type,
      bookingUrl,
    });
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ *${name}* 정보가 수정되었습니다.`,
    });
  }

  @Action('study-room:admin:open-editors')
  async adminOpenEditors({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const { roomId, calendarId } = JSON.parse(
      (action as { value: string }).value,
    ) as { roomId: number; calendarId: string };

    const resource = await this.resourceService.findById(roomId);
    if (!resource) return;

    const acl = await this.googleCalendarService.getCalendarAcl(calendarId);
    const editorEmails = acl
      .filter((e) => e.role === 'writer')
      .map((e) => e.email);
    const initialEditorSlackIds =
      await this.userService.mapEmailsToSlackIds(editorEmails);

    await client.views.push({
      trigger_id: body.trigger_id,
      view: ResourceView.editorsModal(resource, initialEditorSlackIds),
    });
  }

  @View('study-room:modal:editors')
  async submitEditors({
    ack,
    body,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    await ack();
    const values = body.view.state.values;
    const { roomId, calendarId } = JSON.parse(body.view.private_metadata) as {
      roomId: number;
      calendarId: string;
    };

    const selectedIds =
      values['editors_block']?.['editors_select']?.selected_users ?? [];

    const acl = await this.googleCalendarService.getCalendarAcl(calendarId);
    const currentEditorEmails = acl
      .filter((e) => e.role === 'writer')
      .map((e) => e.email);
    const currentEditorSlackIds =
      await this.userService.mapEmailsToSlackIds(currentEditorEmails);

    const oldSet = new Set(currentEditorSlackIds);
    const newSet = new Set(selectedIds);
    const toAdd = selectedIds.filter((id) => !oldSet.has(id));
    const toRemove = currentEditorSlackIds.filter((id) => !newSet.has(id));

    await Promise.all([
      ...toAdd.map(async (slackId) => {
        const user = await this.userService.findBySlackId(slackId);
        if (user?.email) {
          await this.resourceService.addEditor(roomId, user.email);
        }
      }),
      ...toRemove.map(async (slackId) => {
        const user = await this.userService.findBySlackId(slackId);
        if (user?.email) {
          await this.resourceService.removeEditor(roomId, user.email);
        }
      }),
    ]);
  }

  @Action('study-room:admin:toggle-default')
  async adminToggleDefault({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const { roomId, roomName } = JSON.parse(
      (action as { value: string }).value,
    ) as { roomId: number; roomName: string };

    const resource = await this.resourceService.findById(roomId);
    if (!resource) return;

    if (resource.isDefault) {
      await this.resourceService.unsetDefault(roomId);
    } else {
      await this.resourceService.setDefault(roomId);
    }

    const resources = await this.resourceService.findAll();
    await client.views.update({
      view_id: body.view?.id ?? '',
      view: ResourceView.manageModal(resources),
    });
    const label = resource.isDefault ? '기본 공간 해제' : '기본 공간으로 지정';
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ *${roomName}* 이 ${label}되었습니다.`,
    });
  }

  @Action('study-room:admin:toggle-status')
  async adminToggleStatus({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const { roomId, roomName } = JSON.parse(
      (action as { value: string }).value,
    ) as { roomId: number; roomName: string };

    const resource = await this.resourceService.findById(roomId);
    if (!resource) return;

    const newStatus =
      resource.status === ResourceStatus.ACTIVE
        ? ResourceStatus.INACTIVE
        : ResourceStatus.ACTIVE;

    await this.resourceService.updateInfo(roomId, { status: newStatus });

    const resources = await this.resourceService.findAll();
    await client.views.update({
      view_id: body.view?.id ?? '',
      view: ResourceView.manageModal(resources),
    });
    const label = newStatus === ResourceStatus.ACTIVE ? '활성화' : '비활성화';
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ *${roomName}* 이 ${label}되었습니다.`,
    });
  }

  @Action('study-room:admin:open-delete')
  async adminOpenDelete({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const { roomId, roomName } = JSON.parse(
      (action as { value: string }).value,
    ) as { roomId: number; roomName: string };

    await client.views.push({
      trigger_id: body.trigger_id,
      view: ResourceView.deleteConfirmModal(roomId, roomName),
    });
  }

  @View('study-room:modal:delete')
  async submitDelete({
    ack,
    body,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const roomId = parseInt(body.view.private_metadata, 10);
    await this.resourceService.remove(roomId);

    logger.info(`Resource ${roomId} deleted by ${body.user.id}`);
    await client.chat.postMessage({
      channel: body.user.id,
      text: '✅ 리소스가 삭제되었습니다.',
    });
  }
}
