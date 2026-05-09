import { Controller, Logger } from '@nestjs/common';
import { Action, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { ResourceService } from '../service/resource.service';
import { StudyRoomService } from '../service/study-room.service';
import { ProfessorService } from '../service/professor.service';
import { StudyRoomView } from '../view/study-room.view';
import { ResourceView } from '../view/resource.view';
import { UserService } from '../../user/service/user.service';
import { UserStatus } from '../../user/user.entity';
import { GoogleEventsService } from '../../google/calendar/events.service';
import { ResourceType } from '../resource.entity';
import { withModalFeedback } from '../../common/modal-feedback.util';

@Controller()
export class StudyRoomController {
  private readonly logger = new Logger(StudyRoomController.name);

  constructor(
    private readonly resourceService: ResourceService,
    private readonly studyRoomService: StudyRoomService,
    private readonly professorService: ProfessorService,
    private readonly userService: UserService,
    private readonly googleEventsService: GoogleEventsService,
  ) {}

  // 스터디룸 예약 목록 모달 열기 (활성 유저만)
  @Action('home:open-booking')
  async openList({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const userId = body.user.id;

    const user = await this.userService.findBySlackId(userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      return;
    }

    const resources = await this.resourceService.findAllByType(
      ResourceType.STUDY_ROOM,
      true,
    );
    await client.views.open({
      trigger_id: body.trigger_id,
      view: StudyRoomView.listModal(resources),
    });
  }

  // 특정 스터디룸 예약 모달 열기
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
      view: StudyRoomView.bookingModal(resource),
    });
  }

  // 예약 모달 제출 처리 (15분 단위 검증 포함)
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

    const viewId = body.view.id;
    const startTime = new Date(`${date}T${startTimeStr}:00+09:00`);
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    await withModalFeedback(
      { ack, client, viewId, userId: body.user.id },
      () =>
        this.studyRoomService.bookResource({
          resourceId: roomId,
          title,
          startTime,
          endTime,
          bookerSlackId: body.user.id,
          attendeeSlackIds,
        }),
      {
        successTitle: '예약 완료',
        successText: () =>
          `✅ 예약이 완료되었습니다!\n\n*${title}*\n📅 ${date} ${startTimeStr} (${durationMinutes}분)`,
      },
    );
  }

  // 시작 시간 및 이용 시간 변경 시 종료 시간 실시간 계산 및 모달 업데이트
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
        view: StudyRoomView.modifyBookingModal(
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
      view: StudyRoomView.bookingModal(resource, calculatedEndTime),
    });
  }

  // 예약 수정 모달 열기 (기존 참석자 목록 초기값 세팅)
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

    const event = await this.googleEventsService.getEventById(
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

  // 예약 수정 모달 제출 처리 (취소 또는 수정 결과에 따라 메시지 분기)
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

    const result = await this.studyRoomService.modifyBooking(
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

  // 예약 취소 처리
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

    await this.studyRoomService.cancelBooking(calendarId, eventId);
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ *${roomName}* 예약이 취소되었습니다.`,
    });
  }

  // 내 예약 모달 열기 (스터디룸 예약 + 교수 상담 통합)
  @Action('home:open-my-bookings')
  async openMyBookings({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const userId = body.user.id;

    const [bookings, consultations] = await Promise.all([
      this.studyRoomService.getMyBookings(userId),
      this.professorService.getConsultations(userId),
    ]);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: ResourceView.myBookingsModal(bookings, consultations),
    });
  }

  // URL 링크 버튼 — Slack 경고 방지용 ack
  @Action(/^study-room:action:view-calendar$/)
  async ackCalendarLinkButtons({
    ack,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
  }
}
