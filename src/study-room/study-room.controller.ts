import { Controller, Logger } from '@nestjs/common';
import { Action, Command, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackCommandMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { StudyRoomService } from './study-room.service';
import { StudyRoomView } from './study-room.view';
import { StudyRoomStatus } from './study-room.entity';
import { UserService } from '../user/user.service';
import { UserStatus } from '../user/user.entity';
import { GoogleCalendarUtil } from '../google/google-calendar.util';
import { CMD } from '../common/slack-commands';
import { requireAdmin } from '../common/slack-permission';

@Controller()
export class StudyRoomController {
  private readonly logger = new Logger(StudyRoomController.name);

  constructor(
    private readonly studyRoomService: StudyRoomService,
    private readonly userService: UserService,
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
    if (
      !(await requireAdmin(
        this.userService,
        userId,
        client,
        'channel_id' in body ? body.channel_id : undefined,
      ))
    )
      return;

    await client.views.open({
      trigger_id: body.trigger_id,
      view: StudyRoomView.createModal(),
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

    try {
      const room = await this.studyRoomService.create({ name });
      await client.chat.postMessage({
        channel: body.user.id,
        text: `✅ 스터디룸이 등록되었습니다.\n*${room.name}*`,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : '등록 중 오류가 발생했습니다.';
      this.logger.error(`Study room create failed: ${message}`);
      await client.chat.postMessage({
        channel: body.user.id,
        text: `❌ 등록에 실패했습니다: ${message}`,
      });
    }
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

    const rooms = await this.studyRoomService.findAll(true);
    await client.views.open({
      trigger_id: body.trigger_id,
      view: StudyRoomView.listModal(rooms),
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

    // TODO: 로직 통합
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
        view: StudyRoomView.modifyBookingModal(
          { calendarId, eventId, roomName, summary, startTime, endTime },
          attendeeSlackIds,
        ),
      });
      return;
    }

    const { roomId } = JSON.parse(view.private_metadata) as { roomId: number };
    const room = await this.studyRoomService.findById(roomId);
    if (!room) return;

    await client.views.update({
      view_id: view.id,
      hash: view.hash,
      view: StudyRoomView.bookingModal(room, calculatedEndTime),
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

    const roomId = parseInt((action as { value: string }).value, 10);
    const room = await this.studyRoomService.findById(roomId);
    if (!room) return;

    await client.views.push({
      trigger_id: body.trigger_id,
      view: StudyRoomView.bookingModal(room),
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

    try {
      await this.studyRoomService.bookStudyRoom({
        studyRoomId: roomId,
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
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : '예약 중 오류가 발생했습니다.';
      this.logger.error(`Study room booking failed: ${message}`);

      await client.chat.postMessage({
        channel: body.user.id,
        text: `❌ 예약에 실패했습니다: ${message}`,
      });
    }
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
    const bookings = await this.studyRoomService.getMyBookings(userId);
    await client.views.open({
      trigger_id: body.trigger_id,
      view: StudyRoomView.myBookingsModal(bookings),
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

    try {
      await this.studyRoomService.cancelBooking(calendarId, eventId);
      await client.chat.postMessage({
        channel: body.user.id,
        text: `✅ *${roomName}* 예약이 취소되었습니다.`,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : '취소 중 오류가 발생했습니다.';
      this.logger.error(`Study room cancel failed: ${message}`);
      await client.chat.postMessage({
        channel: body.user.id,
        text: `❌ 예약 취소에 실패했습니다: ${message}`,
      });
    }
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
      view: StudyRoomView.modifyBookingModal(
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

    try {
      await this.studyRoomService.modifyBooking(calendarId, eventId, {
        title,
        startTime,
        endTime,
        attendeeSlackIds,
        roomName,
      });

      await client.chat.postMessage({
        channel: body.user.id,
        text: `✅ *${roomName}* 예약이 수정되었습니다.\n${date} ${startTimeStr} (${durationMinutes}분)`,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : '수정 중 오류가 발생했습니다.';
      this.logger.error(`Study room modify failed: ${message}`);
      await client.chat.postMessage({
        channel: body.user.id,
        text: `❌ 예약 수정에 실패했습니다: ${message}`,
      });
    }
  }

  // ========== 스터디룸 관리 (어드민) ==========

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
    if (
      !(await requireAdmin(
        this.userService,
        userId,
        client,
        'channel_id' in body ? body.channel_id : undefined,
      ))
    )
      return;

    const rooms = await this.studyRoomService.findAll();
    await client.views.open({
      trigger_id: body.trigger_id,
      view: StudyRoomView.manageModal(rooms),
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
      view: StudyRoomView.createModal(),
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
    const room = await this.studyRoomService.findById(roomId);
    if (!room) return;
    await client.views.push({
      trigger_id: body.trigger_id,
      view: StudyRoomView.editModal(room),
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
    const description =
      values.description_block.description_input.value ?? null;
    const status = values.status_block.status_select.selected_option
      ?.value as import('./study-room.entity').StudyRoomStatus;

    try {
      await this.studyRoomService.rename(roomId, name);
      await this.studyRoomService.updateInfo(roomId, { description, status });
      await client.chat.postMessage({
        channel: body.user.id,
        text: `✅ *${name}* 정보가 수정되었습니다.`,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : '수정 중 오류가 발생했습니다.';
      this.logger.error(`Study room edit failed: ${message}`);
      await client.chat.postMessage({
        channel: body.user.id,
        text: `❌ 수정에 실패했습니다: ${message}`,
      });
    }
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

    const room = await this.studyRoomService.findById(roomId);
    if (!room) return;

    const acl = await GoogleCalendarUtil.getCalendarAcl(calendarId);
    const editorEmails = acl
      .filter((e) => e.role === 'writer')
      .map((e) => e.email);
    const initialEditorSlackIds =
      await this.userService.mapEmailsToSlackIds(editorEmails);

    await client.views.push({
      trigger_id: body.trigger_id,
      view: StudyRoomView.editorsModal(room, initialEditorSlackIds),
    });
  }

  @View('study-room:modal:editors')
  async submitEditors({
    ack,
    client,
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

    try {
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
            await this.studyRoomService.addEditor(roomId, user.email);
          }
        }),
        ...toRemove.map(async (slackId) => {
          const user = await this.userService.findBySlackId(slackId);
          if (user?.email) {
            await this.studyRoomService.removeEditor(roomId, user.email);
          }
        }),
      ]);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : '오류가 발생했습니다.';
      this.logger.error(`Study room editors update failed: ${message}`);
      await client.chat.postMessage({
        channel: body.user.id,
        text: `❌ 수정자 변경에 실패했습니다: ${message}`,
      });
    }
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

    const room = await this.studyRoomService.findById(roomId);
    if (!room) return;

    const newStatus =
      room.status === StudyRoomStatus.ACTIVE
        ? StudyRoomStatus.INACTIVE
        : StudyRoomStatus.ACTIVE;

    try {
      await this.studyRoomService.updateInfo(roomId, { status: newStatus });

      const rooms = await this.studyRoomService.findAll();
      await client.views.update({
        view_id: body.view?.id ?? '',
        view: StudyRoomView.manageModal(rooms),
      });
      const label =
        newStatus === StudyRoomStatus.ACTIVE ? '활성화' : '비활성화';
      await client.chat.postMessage({
        channel: body.user.id,
        text: `✅ *${roomName}* 이 ${label}되었습니다.`,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : '상태 변경 중 오류가 발생했습니다.';
      this.logger.error(`Study room toggle-status failed: ${message}`);
      await client.chat.postMessage({
        channel: body.user.id,
        text: `❌ 상태 변경에 실패했습니다: ${message}`,
      });
    }
  }
}
