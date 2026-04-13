import { Controller } from '@nestjs/common';
import { Action, Command, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackCommandMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { SpaceService } from './space.service';
import { SpaceView } from './space.view';
import { SpaceStatus, SpaceType } from './space.entity';
import { UserService } from '../user/user.service';
import { UserStatus } from '../user/user.entity';
import { GoogleCalendarUtil } from '../google/google-calendar.util';
import { CMD } from '../common/slack-commands';
import { PermissionService } from '../user/permission.service';

@Controller()
export class SpaceController {
  constructor(
    private readonly spaceService: SpaceService,
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
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
      view: SpaceView.createModal(),
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
      'study_room') as SpaceType;
    const aliasesRaw = values.aliases_block.aliases_input.value ?? '';
    const aliases = aliasesRaw
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const description = values.description_block.description_input.value ?? undefined;
    const isDefault =
      (values.is_default_block?.is_default_checkbox?.selected_options ?? []).length > 0;

    const space = await this.spaceService.create({ name, type, aliases, description, isDefault });
    const typeLabel = type === SpaceType.CLASSROOM ? '교실' : '스터디룸';
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ ${typeLabel}이 등록되었습니다.\n*${space.name}*`,
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

    const spaces = await this.spaceService.findAllByType(
      SpaceType.STUDY_ROOM,
      true,
    );
    await client.views.open({
      trigger_id: body.trigger_id,
      view: SpaceView.listModal(spaces),
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
        view: SpaceView.modifyBookingModal(
          { calendarId, eventId, roomName, summary, startTime, endTime },
          attendeeSlackIds,
        ),
      });
      return;
    }

    const { roomId } = JSON.parse(view.private_metadata) as { roomId: number };
    const space = await this.spaceService.findById(roomId);
    if (!space) return;

    await client.views.update({
      view_id: view.id,
      hash: view.hash,
      view: SpaceView.bookingModal(space, calculatedEndTime),
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

    const spaceId = parseInt((action as { value: string }).value, 10);
    const space = await this.spaceService.findById(spaceId);
    if (!space) return;

    await client.views.push({
      trigger_id: body.trigger_id,
      view: SpaceView.bookingModal(space),
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

    await this.spaceService.bookSpace({
      spaceId: roomId,
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
    const bookings = await this.spaceService.getMyBookings(userId);
    await client.views.open({
      trigger_id: body.trigger_id,
      view: SpaceView.myBookingsModal(bookings),
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

    await this.spaceService.cancelBooking(calendarId, eventId);
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

    const event = await GoogleCalendarUtil.getEventById(calendarId, eventId);
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
      view: SpaceView.modifyBookingModal(
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

    const result = await this.spaceService.modifyBooking(calendarId, eventId, {
      title,
      startTime,
      endTime,
      attendeeSlackIds,
      spaceName: roomName,
    });

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

  // URL 링크 버튼 — Slack 경고 방지용 ack (study-room:action:view-calendar 포함)
  @Action(/^space:action:view-|^study-room:action:view-calendar$/)
  async ackViewLinkButtons({
    ack,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
  }

  @Action('home:open-classroom-schedule')
  async openClassroomSchedule({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const classrooms = await this.spaceService.findAllByType(
      SpaceType.CLASSROOM,
      true,
    );
    await client.views.open({
      trigger_id: body.trigger_id,
      view: SpaceView.classroomScheduleModal(classrooms),
    });
  }

  // ========== 공간 관리 (어드민) ==========

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

    const spaces = await this.spaceService.findAll();
    await client.views.open({
      trigger_id: body.trigger_id,
      view: SpaceView.manageModal(spaces),
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
      view: SpaceView.createModal(),
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
    const space = await this.spaceService.findById(roomId);
    if (!space) return;
    await client.views.push({
      trigger_id: body.trigger_id,
      view: SpaceView.editModal(space),
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
    const type = values.type_block.type_select.selected_option?.value as SpaceType;
    const aliasesRaw = values.aliases_block.aliases_input.value ?? '';
    const aliases = aliasesRaw
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const description =
      values.description_block.description_input.value ?? null;
    const status = values.status_block.status_select.selected_option
      ?.value as SpaceStatus;

    await this.spaceService.rename(roomId, name);
    await this.spaceService.updateInfo(roomId, { description, status, aliases, type });
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

    const space = await this.spaceService.findById(roomId);
    if (!space) return;

    const acl = await GoogleCalendarUtil.getCalendarAcl(calendarId);
    const editorEmails = acl
      .filter((e) => e.role === 'writer')
      .map((e) => e.email);
    const initialEditorSlackIds =
      await this.userService.mapEmailsToSlackIds(editorEmails);

    await client.views.push({
      trigger_id: body.trigger_id,
      view: SpaceView.editorsModal(space, initialEditorSlackIds),
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

    const acl = await GoogleCalendarUtil.getCalendarAcl(calendarId);
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
          await this.spaceService.addEditor(roomId, user.email);
        }
      }),
      ...toRemove.map(async (slackId) => {
        const user = await this.userService.findBySlackId(slackId);
        if (user?.email) {
          await this.spaceService.removeEditor(roomId, user.email);
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

    const space = await this.spaceService.findById(roomId);
    if (!space) return;

    if (space.isDefault) {
      await this.spaceService.unsetDefault(roomId);
    } else {
      await this.spaceService.setDefault(roomId);
    }

    const spaces = await this.spaceService.findAll();
    await client.views.update({
      view_id: body.view?.id ?? '',
      view: SpaceView.manageModal(spaces),
    });
    const label = space.isDefault ? '기본 공간 해제' : '기본 공간으로 지정';
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

    const space = await this.spaceService.findById(roomId);
    if (!space) return;

    const newStatus =
      space.status === SpaceStatus.ACTIVE
        ? SpaceStatus.INACTIVE
        : SpaceStatus.ACTIVE;

    await this.spaceService.updateInfo(roomId, { status: newStatus });

    const spaces = await this.spaceService.findAll();
    await client.views.update({
      view_id: body.view?.id ?? '',
      view: SpaceView.manageModal(spaces),
    });
    const label = newStatus === SpaceStatus.ACTIVE ? '활성화' : '비활성화';
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ *${roomName}* 이 ${label}되었습니다.`,
    });
  }
}
