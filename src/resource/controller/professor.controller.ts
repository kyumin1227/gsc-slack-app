import { Controller, Logger } from '@nestjs/common';
import { Action } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { ResourceService } from '../service/resource.service';
import { StudyRoomService } from '../service/study-room.service';
import { ProfessorService } from '../service/professor.service';
import { ProfessorView } from '../view/professor.view';
import { ResourceView } from '../view/resource.view';
import { ResourceType } from '../resource.entity';

@Controller()
export class ProfessorController {
  private readonly logger = new Logger(ProfessorController.name);

  constructor(
    private readonly resourceService: ResourceService,
    private readonly bookingService: StudyRoomService,
    private readonly professorService: ProfessorService,
  ) {}

  // 교수 상담 예약 페이지 목록 모달 열기
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
      view: ProfessorView.professorBookingPagesModal(professors),
    });
  }

  // 교수 시간표 모달 열기
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
      view: ProfessorView.professorScheduleModal(professors),
    });
  }

  // 교수 상담 예약 취소 후 내 예약 모달 갱신
  @Action(/^consultation:cancel:/)
  async cancelConsultation({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const userId = body.user.id;
    const action = body.actions[0] as { action_id: string };
    const eventId = action.action_id.replace('consultation:cancel:', '');

    try {
      await this.professorService.cancelConsultation(userId, eventId);
      const [bookings, consultations] = await Promise.all([
        this.bookingService.getMyBookings(userId),
        this.professorService.getConsultations(userId),
      ]);
      await client.views.update({
        view_id: body.view!.id,
        view: ResourceView.myBookingsModal(bookings, consultations),
      });
    } catch (e) {
      this.logger.error('교수 상담 취소 실패', e);
    }
  }

  // URL 링크 버튼 — Slack 경고 방지용 ack
  @Action(
    /^space:action:view-professor-|^professor:booking:|^consultation:view-/,
  )
  async ackViewLinkButtons({
    ack,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
  }
}
