import { Controller } from '@nestjs/common';
import { Action } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { ResourceService } from '../service/resource.service';
import { ClassroomView } from '../view/classroom.view';
import { ResourceType } from '../resource.entity';

@Controller()
export class ClassroomController {
  constructor(private readonly resourceService: ResourceService) {}

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
      view: ClassroomView.classroomScheduleModal(classrooms),
    });
  }

  // URL 링크 버튼 — Slack 경고 방지용 ack
  @Action(/^space:action:view-classroom-/)
  async ackViewLinkButtons({
    ack,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
  }
}
