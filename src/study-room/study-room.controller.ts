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
import { UserService } from '../user/user.service';
import { UserRole, UserStatus } from '../user/user.entity';

@Controller()
export class StudyRoomController {
  private readonly logger = new Logger(StudyRoomController.name);

  constructor(
    private readonly studyRoomService: StudyRoomService,
    private readonly userService: UserService,
  ) {}

  @Command('/스터디룸생성')
  async openCreateModal({
    ack,
    client,
    body,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const user = await this.userService.findBySlackId(body.user_id);
    // TODO 스케줄 서비스의 조교 이상 권한 확인 메소드랑 통합 필요
    const allowed = [UserRole.PROFESSOR, UserRole.TA];
    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      !allowed.includes(user.role)
    ) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: '조교 이상 권한이 필요합니다.',
      });
      return;
    }

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

  @Command('/예약')
  async openList({
    ack,
    client,
    body,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const user = await this.userService.findBySlackId(body.user_id);
    if (!user || user.status !== UserStatus.ACTIVE) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: '활성화된 사용자만 이용 가능합니다. 먼저 회원가입을 완료해주세요.',
      });
      return;
    }

    const rooms = await this.studyRoomService.findAll();
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
}
