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
import { CMD } from '../common/slack-commands';
import { PermissionService } from '../user/permission.service';

@Controller()
export class TagController {
  constructor(
    private readonly tagService: TagService,
    private readonly permissionService: PermissionService,
  ) {}

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
    await this.permissionService.requireAdmin(userId);

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
    await this.permissionService.requireAdmin(userId);

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
  }

  // 태그 시간표 — 구글 캘린더 URL 버튼 ack
  @Action('tag:schedule:open-calendar')
  async ackTagCalendarLink({
    ack,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
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
  }

  // 삭제 버튼 → 확인 모달 열기
  @Action(/^tag:list:delete:/)
  async handleOpenDelete({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { action_id: string; value: string };
    const tagId = parseInt(action.action_id.split(':').pop()!, 10);
    const tagName = action.value;

    await client.views.push({
      trigger_id: body.trigger_id,
      view: TagView.deleteConfirmModal(tagId, tagName),
    });
  }

  // 삭제 확인 모달 제출 → 소프트 삭제
  @View('tag:modal:delete')
  async handleDelete({
    ack,
    body,
    view,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const tagId = parseInt(view.private_metadata, 10);
    await this.tagService.deleteTag(tagId);

    logger.info(`Tag ${tagId} deleted by ${body.user.id}`);
    await client.chat.postMessage({
      channel: body.user.id,
      text: '✅ 태그가 삭제되었습니다.',
    });
  }
}
