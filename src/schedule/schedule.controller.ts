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
import { UserRole, UserStatus, User } from '../user/user.entity';

@Controller()
export class ScheduleController {
  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly userService: UserService,
    private readonly tagService: TagService,
  ) {}

  // 조교 이상 권한 확인 헬퍼
  private async checkAdminPermission(
    slackUserId: string,
  ): Promise<{ hasPermission: boolean; user?: User; message?: string }> {
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

  // 활성 사용자 확인 헬퍼
  private async checkActiveUser(
    slackUserId: string,
  ): Promise<{ isActive: boolean; user?: User; message?: string }> {
    const user = await this.userService.findBySlackId(slackUserId);

    if (!user || user.status !== UserStatus.ACTIVE) {
      return {
        isActive: false,
        message:
          '활성화된 사용자만 이용 가능합니다. 먼저 회원가입을 완료해주세요.',
      };
    }
    return { isActive: true, user };
  }

  // /시간표 - 시간표 목록 조회
  @Command('/시간표')
  async listSchedules({
    ack,
    client,
    body,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const { hasPermission, message } = await this.checkAdminPermission(
      body.user_id,
    );
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

    const { hasPermission, message } = await this.checkAdminPermission(
      body.user_id,
    );
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
    const values = view.state.values;
    const name = values.name_block.name_input.value ?? '';
    const description =
      values.description_block?.description_input?.value ?? undefined;
    const selectedTags = values.tags_block?.tags_input?.selected_options ?? [];

    // 빠른 유효성 검사 (ack 전)
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

    // 3초 제한 내에 ack 처리 — 이후 작업은 DM으로 결과 전달
    await ack();

    try {
      const tagIds = selectedTags.map((opt: { value: string }) =>
        parseInt(opt.value, 10),
      );

      const creatorRefreshToken =
        this.userService.getDecryptedRefreshToken(user);

      await this.scheduleService.createSchedule({
        name: name.trim(),
        description: description?.trim(),
        tagIds,
        createdById: user.id,
        creatorEmail: user.email,
        creatorRefreshToken: creatorRefreshToken ?? undefined,
      });

      await client.chat.postMessage({
        channel: body.user.id,
        text: `시간표 "${name}"이(가) 생성되었습니다. Google Calendar가 함께 생성되었습니다.`,
      });

      logger.info(`Schedule created: ${name} by ${user.name}`);
    } catch (error) {
      logger.error('Create schedule error:', error);

      const err = error as { message?: string };
      await client.chat.postMessage({
        channel: body.user.id,
        text: `시간표 생성 중 오류가 발생했습니다: ${err.message ?? '알 수 없는 오류'}`,
      });
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

  // /구독 - 시간표 구독 (태그 선택)
  @Command('/구독')
  async openSubscribeModal({
    ack,
    client,
    body,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const { isActive, message } = await this.checkActiveUser(body.user_id);
    if (!isActive) {
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
      view: ScheduleView.subscribeSearchModal(
        tags.map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
        })),
      ),
    });
  }

  // 구독 태그 검색
  @View('schedule:modal:subscribe:search')
  async handleTagSearch({
    ack,
    body,
    view,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    try {
      const values = view.state.values;
      const selectedTags = values.tags_block?.tags_select?.selected_options;

      if (!selectedTags || selectedTags.length === 0) {
        await ack({
          response_action: 'errors',
          errors: { tags_block: '태그를 하나 이상 선택해주세요.' },
        });
        return;
      }

      const tagIds = selectedTags.map((opt: { value: string }) =>
        parseInt(opt.value, 10),
      );

      // 사용자 정보 조회
      const user = await this.userService.findBySlackId(body.user.id);
      if (!user) {
        await ack({
          response_action: 'errors',
          errors: { tags_block: '사용자 정보를 찾을 수 없습니다.' },
        });
        return;
      }

      // 선택한 태그들의 활성 스케줄 조회
      const schedules =
        await this.scheduleService.findActiveSchedulesByTagIds(tagIds);

      // 각 스케줄에 대해 구독 여부 확인
      const schedulesWithSubscription = await Promise.all(
        schedules.map(async (s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          tags: s.tags.map((t) => ({ id: t.id, name: t.name })),
          createdBy: { name: s.createdBy?.name ?? '알 수 없음' },
          isSubscribed: await this.scheduleService.isSubscribed(
            s.id,
            user.email,
          ),
        })),
      );

      // 태그 목록 다시 조회
      const tags = await this.tagService.findAllTags();

      await ack({
        response_action: 'update',
        view: ScheduleView.subscribeSearchModal(
          tags.map((t) => ({
            id: t.id,
            name: t.name,
            status: t.status,
          })),
          schedulesWithSubscription,
          tagIds,
        ),
      });

      logger.info(
        `User ${user.name} searched schedules for tags: ${tagIds.join(', ')}`,
      );
    } catch (error) {
      logger.error('Tag search error:', error);
      await ack({
        response_action: 'errors',
        errors: { tags_block: '검색 중 오류가 발생했습니다.' },
      });
    }
  }

  // 구독/구독해제 토글
  @Action(/^schedule:subscribe:toggle:/)
  async handleSubscribeToggle({
    ack,
    body,
    client,
    logger,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    try {
      const action = body.actions[0] as { action_id: string; value: string };
      const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);
      const { action: toggleAction, tagIds } = JSON.parse(action.value) as {
        action: string;
        tagIds: number[];
      };

      // 사용자 정보 조회
      const user = await this.userService.findBySlackId(body.user.id);
      if (!user) {
        logger.error('User not found for subscribe toggle');
        return;
      }

      // refresh token 확인 및 복호화
      const refreshToken = this.userService.getDecryptedRefreshToken(user);
      if (!refreshToken) {
        logger.error('User has no valid refresh token for subscribe toggle');
        await client.chat.postMessage({
          channel: body.user.id,
          text: '구독 기능을 사용하려면 Google 계정 재연동이 필요합니다. 회원정보를 다시 등록해주세요.',
        });
        return;
      }

      // 구독/구독해제 실행
      if (toggleAction === 'subscribe') {
        await this.scheduleService.subscribe(
          scheduleId,
          user.email,
          refreshToken,
        );
        logger.info(`User ${user.name} subscribed to schedule ${scheduleId}`);
      } else {
        await this.scheduleService.unsubscribe(
          scheduleId,
          user.email,
          refreshToken,
        );
        logger.info(
          `User ${user.name} unsubscribed from schedule ${scheduleId}`,
        );
      }

      // 목록 새로고침
      const schedules =
        await this.scheduleService.findActiveSchedulesByTagIds(tagIds);

      const schedulesWithSubscription = await Promise.all(
        schedules.map(async (s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          tags: s.tags.map((t) => ({ id: t.id, name: t.name })),
          createdBy: { name: s.createdBy?.name ?? '알 수 없음' },
          isSubscribed: await this.scheduleService.isSubscribed(
            s.id,
            user.email,
          ),
        })),
      );

      // 태그 목록 조회
      const tags = await this.tagService.findAllTags();

      if (body.view?.id) {
        await client.views.update({
          view_id: body.view.id,
          view: ScheduleView.subscribeSearchModal(
            tags.map((t) => ({
              id: t.id,
              name: t.name,
              status: t.status,
            })),
            schedulesWithSubscription,
            tagIds,
          ),
        });
      }
    } catch (error) {
      logger.error('Subscribe toggle error:', error);
    }
  }
}
