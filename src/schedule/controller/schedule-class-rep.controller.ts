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
import { ScheduleNotificationService } from '../service/schedule-notification.service';
import { ScheduleClassRepView } from '../view/schedule-class-rep.view';
import { ScheduleRecurringView } from '../view/schedule-recurring.view';
import { ChannelService } from '../../channel/channel.service';

@Controller()
export class ScheduleClassRepController {
  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly scheduleRecurringService: ScheduleRecurringService,
    private readonly scheduleNotificationService: ScheduleNotificationService,
    private readonly channelService: ChannelService,
  ) {}

  private async buildClassRepListModal(slackUserId: string) {
    const schedules =
      await this.scheduleService.findSchedulesByClassRepSlackId(slackUserId);
    const scheduleIds = schedules.map((s) => s.id);
    const [channelMap, mutedSet] = await Promise.all([
      Promise.all(
        scheduleIds.map(async (id) => ({
          id,
          channels: await this.channelService.getSlackChannelIds(id),
        })),
      ),
      this.scheduleNotificationService.getMutedSet(scheduleIds),
    ]);
    const channelsById = Object.fromEntries(
      channelMap.map(({ id, channels }) => [id, channels]),
    );

    return ScheduleClassRepView.scheduleListModal(
      schedules.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        channels: channelsById[s.id] ?? [],
      })),
      mutedSet,
    );
  }

  @Action('home:open-class-rep-schedules')
  async openClassRepSchedules({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    await client.views.open({
      trigger_id: body.trigger_id,
      view: await this.buildClassRepListModal(body.user.id),
    });
  }

  @Action(/^schedule:class-rep:edit:/)
  async classRepOpenEdit({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { action_id: string };
    const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);

    const authorized =
      await this.scheduleService.isClassRepAuthorizedForSchedule(
        body.user.id,
        scheduleId,
      );
    if (!authorized) return;

    const [schedule, notifChannelIds] = await Promise.all([
      this.scheduleService.findById(scheduleId),
      this.channelService.getSlackChannelIds(scheduleId),
    ]);
    if (!schedule) return;

    await client.views.push({
      trigger_id: body.trigger_id,
      view: ScheduleClassRepView.editModal(
        {
          id: schedule.id,
          name: schedule.name,
          description: schedule.description,
        },
        notifChannelIds,
      ),
    });
  }

  @View('schedule:modal:class-rep:edit')
  async classRepHandleEdit({
    ack,
    body,
    view,
    client,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const scheduleId = parseInt(view.private_metadata, 10);
    const values = view.state.values;

    const authorized =
      await this.scheduleService.isClassRepAuthorizedForSchedule(
        body.user.id,
        scheduleId,
      );
    if (!authorized) {
      await ack({ response_action: 'errors', errors: {} });
      return;
    }

    const name = values.name_block.name_input.value?.trim() ?? '';
    const description =
      values.description_block.description_input.value?.trim() || undefined;
    const channelIds =
      values.notification_channels_block.channels_select
        .selected_conversations ?? [];

    if (!name) {
      await ack({
        response_action: 'errors',
        errors: { name_block: '과목명을 입력해주세요.' },
      });
      return;
    }

    await ack();

    await this.scheduleService.updateSchedule(scheduleId, {
      name,
      description,
    });
    await this.channelService.setScheduleChannels(scheduleId, channelIds);

    if (body.view?.root_view_id) {
      await client.views.update({
        view_id: body.view.root_view_id,
        view: await this.buildClassRepListModal(body.user.id),
      });
    }
  }

  @Action(/^schedule:class-rep:mute:/)
  async classRepHandleMute({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { action_id: string };
    const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);

    const authorized =
      await this.scheduleService.isClassRepAuthorizedForSchedule(
        body.user.id,
        scheduleId,
      );
    if (!authorized) return;

    await this.scheduleNotificationService.mute(scheduleId);

    if (body.view?.id) {
      await client.views.update({
        view_id: body.view.id,
        view: await this.buildClassRepListModal(body.user.id),
      });
    }
  }

  @Action(/^schedule:class-rep:unmute:/)
  async classRepHandleUnmute({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { action_id: string };
    const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);

    const authorized =
      await this.scheduleService.isClassRepAuthorizedForSchedule(
        body.user.id,
        scheduleId,
      );
    if (!authorized) return;

    await this.scheduleNotificationService.unmute(scheduleId);

    if (body.view?.id) {
      await client.views.update({
        view_id: body.view.id,
        view: await this.buildClassRepListModal(body.user.id),
      });
    }
  }

  @Action(/^schedule:class-rep:create-recurring:/)
  async classRepOpenCreateRecurring({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { action_id: string };
    const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);

    const authorized =
      await this.scheduleService.isClassRepAuthorizedForSchedule(
        body.user.id,
        scheduleId,
      );
    if (!authorized) return;

    const schedule = await this.scheduleService.findById(scheduleId);
    if (!schedule) return;

    await client.views.push({
      trigger_id: body.trigger_id,
      view: ScheduleRecurringView.createRecurringModal(
        [{ id: schedule.id, name: schedule.name }],
        schedule.id,
      ),
    });
  }

  @Action(/^schedule:class-rep:edit-recurring:/)
  async classRepOpenEditRecurring({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { action_id: string };
    const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);

    const authorized =
      await this.scheduleService.isClassRepAuthorizedForSchedule(
        body.user.id,
        scheduleId,
      );
    if (!authorized) return;

    const [schedule, groups] = await Promise.all([
      this.scheduleService.findById(scheduleId),
      this.scheduleRecurringService.findRecurrenceGroupsBySchedule(scheduleId),
    ]);
    if (!schedule) return;

    if (groups.length === 0) {
      await client.views.push({
        trigger_id: body.trigger_id,
        view: {
          type: 'modal',
          callback_id: 'noop',
          title: { type: 'plain_text', text: '반복 일정 수정' },
          close: { type: 'plain_text', text: '닫기' },
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: '등록된 반복 일정이 없습니다.' },
            },
          ],
        },
      });
      return;
    }

    await client.views.push({
      trigger_id: body.trigger_id,
      view: ScheduleRecurringView.selectGroupForEditModal(
        groups,
        schedule.name,
        scheduleId,
      ),
    });
  }

  @Action(/^schedule:class-rep:delete-recurring:/)
  async classRepOpenDeleteRecurring({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { action_id: string };
    const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);

    const authorized =
      await this.scheduleService.isClassRepAuthorizedForSchedule(
        body.user.id,
        scheduleId,
      );
    if (!authorized) return;

    const [schedule, groups] = await Promise.all([
      this.scheduleService.findById(scheduleId),
      this.scheduleRecurringService.findRecurrenceGroupsBySchedule(scheduleId),
    ]);
    if (!schedule) return;

    if (groups.length === 0) {
      await client.views.push({
        trigger_id: body.trigger_id,
        view: {
          type: 'modal',
          callback_id: 'noop',
          title: { type: 'plain_text', text: '반복 일정 삭제' },
          close: { type: 'plain_text', text: '닫기' },
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: '등록된 반복 일정이 없습니다.' },
            },
          ],
        },
      });
      return;
    }

    await client.views.push({
      trigger_id: body.trigger_id,
      view: ScheduleRecurringView.deleteRecurringModal(groups, schedule.name),
    });
  }
}
