import { Controller } from '@nestjs/common';
import { Action, Command, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackCommandMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { TagService } from './tag.service';
import { TagView } from './tag.view';
import { UserService } from '../user/user.service';
import { UserRole } from '../user/user.entity';
import { CMD } from '../common/slack-commands';

@Controller()
export class TagController {
  constructor(
    private readonly tagService: TagService,
    private readonly userService: UserService,
  ) {}

  // 권한 확인 헬퍼
  private async checkPermission(
    slackUserId: string,
  ): Promise<{ hasPermission: boolean; message?: string }> {
    const user = await this.userService.findBySlackId(slackUserId);
    const allowedRoles = [UserRole.PROFESSOR, UserRole.TA];

    if (!user || !allowedRoles.includes(user.role)) {
      return {
        hasPermission: false,
        message: '이 명령어는 조교 이상 권한이 필요합니다.',
      };
    }
    return { hasPermission: true };
  }

  // /태그 - 태그 목록 조회
  @Command(CMD.태그)
  @Action('home:open-tags')
  async listTags({
    ack,
    client,
    body,
  }: (SlackCommandMiddlewareArgs | SlackActionMiddlewareArgs<BlockAction>) &
    AllMiddlewareArgs) {
    await ack();

    const userId = 'user_id' in body ? body.user_id : body.user.id;
    const { hasPermission, message } = await this.checkPermission(userId);
    if (!hasPermission) {
      if ('channel_id' in body) {
        await client.chat.postEphemeral({
          channel: body.channel_id,
          user: userId,
          text: message!,
        });
      }
      return;
    }

    const tags = await this.tagService.findDisplayTags();

    await client.views.open({
      trigger_id: body.trigger_id,
      view: TagView.listModal(tags),
    });
  }

  // /태그생성 - 태그 생성 모달
  @Command(CMD.태그생성)
  @Action('home:open-create-tag')
  async openCreateModal({
    ack,
    client,
    body,
  }: (SlackCommandMiddlewareArgs | SlackActionMiddlewareArgs<BlockAction>) &
    AllMiddlewareArgs) {
    await ack();

    const userId = 'user_id' in body ? body.user_id : body.user.id;
    const { hasPermission, message } = await this.checkPermission(userId);
    if (!hasPermission) {
      if ('channel_id' in body) {
        await client.chat.postEphemeral({
          channel: body.channel_id,
          user: userId,
          text: message!,
        });
      }
      return;
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: TagView.createModal(),
    });
  }

  // 태그 생성 폼 제출
  @View('tag:modal:create')
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

      // 유효성 검사
      if (!name.trim()) {
        await ack({
          response_action: 'errors',
          errors: { name_block: '태그 이름을 입력해주세요.' },
        });
        return;
      }

      await this.tagService.createTag({ name: name.trim() });

      await ack();

      // 생성 완료 메시지
      await client.chat.postMessage({
        channel: body.user.id,
        text: `태그 "${name}"이(가) 생성되었습니다.`,
      });

      logger.info(`Tag created: ${name}`);
    } catch (error: any) {
      logger.error('Create tag error:', error);

      if (error.code === '23505') {
        // unique violation
        await ack({
          response_action: 'errors',
          errors: { name_block: '이미 존재하는 태그 이름입니다.' },
        });
      } else {
        await ack({
          response_action: 'errors',
          errors: { name_block: '태그 생성 중 오류가 발생했습니다.' },
        });
      }
    }
  }

  // 태그 상태 토글 (활성화/비활성화)
  @Action(/^tag:list:toggle:/)
  async handleToggle({
    ack,
    body,
    client,
    logger,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    try {
      const action = body.actions[0] as { action_id: string; value: string };
      const tagId = parseInt(action.action_id.split(':').pop()!, 10);
      const toggleAction = action.value;

      if (toggleAction === 'deactivate') {
        await this.tagService.deactivateTag(tagId);
      } else if (toggleAction === 'activate') {
        await this.tagService.activateTag(tagId);
      }

      // 목록 새로고침
      const tags = await this.tagService.findDisplayTags();

      if (body.view?.id) {
        await client.views.update({
          view_id: body.view.id,
          view: TagView.listModal(tags),
        });
      }

      logger.info(`Tag ${tagId} toggled to ${toggleAction}`);
    } catch (error) {
      logger.error('Toggle tag error:', error);
    }
  }
}
