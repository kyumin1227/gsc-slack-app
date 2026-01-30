import { Controller } from '@nestjs/common';
import { Action, Command, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackCommandMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { ScheduleService } from './schedule.service';
import { ScheduleView } from './schedule.view';
import { UserService } from '../user/user.service';
import { TagService } from '../tag/tag.service';
import { UserRole } from '../user/user.entity';

@Controller()
export class ScheduleController {
  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly userService: UserService,
    private readonly tagService: TagService,
  ) {}

  // 권한 확인 헬퍼
  private async checkPermission(
    slackUserId: string,
  ): Promise<{ hasPermission: boolean; user?: any; message?: string }> {
    const user = await this.userService.findBySlackId(slackUserId);
    const allowedRoles = [UserRole.PROFESSOR, UserRole.TA];

    if (!user || !allowedRoles.includes(user.role)) {
      return {
        hasPermission: false,
        message: '이 명령어는 조교 이상 권한이 필요합니다.',
      };
    }
    return { hasPermission: true, user };
  }

  // /시간표 - 시간표 목록 조회
  @Command('/시간표')
  async listSchedules({
    ack,
    client,
    body,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const { hasPermission, message } = await this.checkPermission(body.user_id);
    if (!hasPermission) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: message!,
      });
      return;
    }

    const schedules = await this.scheduleService.findAllSchedules();

    await client.views.open({
      trigger_id: body.trigger_id,
      view: ScheduleView.listModal(
        schedules.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          status: s.status,
          tags: s.tags.map((t) => ({ id: t.id, name: t.name })),
          createdBy: { name: s.createdBy?.name ?? '알 수 없음' },
        })),
      ),
    });
  }

  // /시간표생성 - 시간표 생성 모달
  @Command('/시간표생성')
  async openCreateModal({
    ack,
    client,
    body,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const { hasPermission, message } = await this.checkPermission(body.user_id);
    if (!hasPermission) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: message!,
      });
      return;
    }

    const tags = await this.tagService.findAllTags();

    await client.views.open({
      trigger_id: body.trigger_id,
      view: ScheduleView.createModal(
        tags.map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
        })),
      ),
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
    try {
      const values = view.state.values;
      const name = values.name_block.name_input.value ?? '';
      const description =
        values.description_block?.description_input?.value ?? undefined;
      const selectedTags =
        values.tags_block?.tags_input?.selected_options ?? [];

      // 유효성 검사
      if (!name.trim()) {
        await ack({
          response_action: 'errors',
          errors: { name_block: '과목명을 입력해주세요.' },
        });
        return;
      }

      // 사용자 조회
      const user = await this.userService.findBySlackId(body.user.id);
      if (!user) {
        await ack({
          response_action: 'errors',
          errors: { name_block: '사용자 정보를 찾을 수 없습니다.' },
        });
        return;
      }

      const tagIds = selectedTags.map((opt: { value: string }) =>
        parseInt(opt.value, 10),
      );

      await this.scheduleService.createSchedule({
        name: name.trim(),
        description: description?.trim(),
        tagIds,
        createdById: user.id,
      });

      await ack();

      // 생성 완료 메시지
      await client.chat.postMessage({
        channel: body.user.id,
        text: `시간표 "${name}"이(가) 생성되었습니다. Google Calendar가 함께 생성되었습니다.`,
      });

      logger.info(`Schedule created: ${name} by ${user.name}`);
    } catch (error) {
      logger.error('Create schedule error:', error);

      const err = error as { code?: string; message?: string };
      if (err.code === '23505') {
        // unique violation
        await ack({
          response_action: 'errors',
          errors: { name_block: '이미 존재하는 과목명입니다.' },
        });
      } else {
        await ack({
          response_action: 'errors',
          errors: {
            name_block: `시간표 생성 중 오류가 발생했습니다: ${err.message ?? '알 수 없는 오류'}`,
          },
        });
      }
    }
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

    try {
      const action = body.actions[0] as { action_id: string; value: string };
      const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);
      const toggleAction = action.value;

      if (toggleAction === 'deactivate') {
        await this.scheduleService.deactivateSchedule(scheduleId);
      } else if (toggleAction === 'activate') {
        await this.scheduleService.activateSchedule(scheduleId);
      }

      // 목록 새로고침
      const schedules = await this.scheduleService.findAllSchedules();

      if (body.view?.id) {
        await client.views.update({
          view_id: body.view.id,
          view: ScheduleView.listModal(
            schedules.map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description,
              status: s.status,
              tags: s.tags.map((t) => ({ id: t.id, name: t.name })),
              createdBy: { name: s.createdBy?.name ?? '알 수 없음' },
            })),
          ),
        });
      }

      logger.info(`Schedule ${scheduleId} toggled to ${toggleAction}`);
    } catch (error) {
      logger.error('Toggle schedule error:', error);
    }
  }
}
