import { Controller, Logger } from '@nestjs/common';
import { Action, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
  ButtonAction,
} from '@slack/bolt';
import { AnnouncementService } from './announcement.service';
import { AnnouncementView } from './view/announcement.view';
import { PermissionService } from '../user/service/permission.service';
import { UserService } from '../user/service/user.service';
import { BusinessError } from '../common/errors';

@Controller()
export class AnnouncementController {
  private readonly logger = new Logger(AnnouncementController.name);

  constructor(
    private readonly announcementService: AnnouncementService,
    private readonly permissionService: PermissionService,
    private readonly userService: UserService,
  ) {}

  /** 공지 목록 모달 열기 */
  @Action('announcement:list:open-modal')
  async openListModal({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const userId = body.user.id;

    try {
      await this.permissionService.requireAdmin(userId);
    } catch (e) {
      if (e instanceof BusinessError) {
        await client.chat.postEphemeral({
          channel: userId,
          user: userId,
          text: e.message,
        });
        return;
      }
      throw e;
    }

    const limit = AnnouncementView.PAGE_SIZE;
    const { items, total } = await this.announcementService.findPage(0, limit);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: AnnouncementView.listModal(items, 0, total),
    });
  }

  /** 공지 작성 모달 열기 (Home 또는 목록 모달 내 버튼) */
  @Action('announcement:create:open-modal')
  async openCreateModal({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const userId = body.user.id;

    try {
      await this.permissionService.requireAdmin(userId);
    } catch (e) {
      if (e instanceof BusinessError) {
        await client.chat.postEphemeral({
          channel: userId,
          user: userId,
          text: e.message,
        });
        return;
      }
      throw e;
    }

    // 봇이 참여 중인 public/private 채널만 가져옴 (DM/MPIM 제외)
    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
    });
    const channels = (result.channels ?? []).filter((ch) => ch.is_member);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: AnnouncementView.createModal(channels),
    });
  }

  /** 공지 삭제 — action.value = announcement.id */
  @Action('announcement:delete')
  async handleDelete({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction<ButtonAction>> & AllMiddlewareArgs) {
    await ack();

    const userId = body.user.id;

    try {
      await this.permissionService.requireAdmin(userId);
    } catch (e) {
      if (e instanceof BusinessError) {
        await client.chat.postEphemeral({
          channel: userId,
          user: userId,
          text: e.message,
        });
        return;
      }
      throw e;
    }

    const id = Number(action.value);
    const announcement = await this.announcementService.findOne(id);

    if (!announcement) {
      await client.chat.postEphemeral({
        channel: userId,
        user: userId,
        text: '해당 공지를 찾을 수 없습니다.',
      });
      return;
    }

    try {
      await client.chat.delete({
        channel: announcement.channelId,
        ts: announcement.messageTs,
      });
    } catch (error: unknown) {
      const code = extractSlackErrorCode(error);
      if (code !== 'message_not_found') {
        this.logger.error(`채널 메시지 삭제 실패 — id: ${id}, error: ${code}`);
        await client.chat.postEphemeral({
          channel: userId,
          user: userId,
          text: `채널 메시지 삭제에 실패했습니다: ${code}`,
        });
        return;
      }
    }

    await this.announcementService.softDelete(id);
    this.logger.log(`공지 삭제 완료 — id: ${id}, by: ${userId}`);

    const limit = AnnouncementView.PAGE_SIZE;
    const offset = Number(body.view?.private_metadata ?? '0');
    const { items, total } = await this.announcementService.findPage(offset, limit);
    // 삭제 후 현재 페이지 항목이 없으면 이전 페이지로 이동
    const adjustedOffset = items.length === 0 && offset > 0 ? offset - limit : offset;
    const page =
      adjustedOffset !== offset
        ? await this.announcementService.findPage(adjustedOffset, limit)
        : { items, total };

    const viewId = body.view?.id;
    if (!viewId) {
      this.logger.error('삭제 후 목록 갱신 실패: view_id 없음');
      return;
    }

    await client.views.update({
      view_id: viewId,
      hash: body.view?.hash,
      view: AnnouncementView.listModal(page.items, adjustedOffset, page.total),
    });
  }

  /** 이전 페이지 — action.value = 이동할 offset */
  @Action('announcement:list:prev')
  async handleListPrev(
    args: SlackActionMiddlewareArgs<BlockAction<ButtonAction>> & AllMiddlewareArgs,
  ) {
    return this.handleListPage(args);
  }

  /** 다음 페이지 — action.value = 이동할 offset */
  @Action('announcement:list:next')
  async handleListNext(
    args: SlackActionMiddlewareArgs<BlockAction<ButtonAction>> & AllMiddlewareArgs,
  ) {
    return this.handleListPage(args);
  }

  private async handleListPage({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction<ButtonAction>> & AllMiddlewareArgs) {
    await ack();

    const offset = Number(action.value);
    const limit = AnnouncementView.PAGE_SIZE;
    const { items, total } = await this.announcementService.findPage(offset, limit);

    const viewId = body.view?.id;
    if (!viewId) {
      this.logger.error('페이지 이동 실패: view_id 없음');
      return;
    }

    await client.views.update({
      view_id: viewId,
      hash: body.view?.hash,
      view: AnnouncementView.listModal(items, offset, total),
    });
  }

  /** 수정 모달 열기 — action.value = announcement.id */
  @Action('announcement:edit:open-modal')
  async openEditModal({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction<ButtonAction>> & AllMiddlewareArgs) {
    await ack();

    const userId = body.user.id;

    try {
      await this.permissionService.requireAdmin(userId);
    } catch (e) {
      if (e instanceof BusinessError) {
        await client.chat.postEphemeral({
          channel: userId,
          user: userId,
          text: e.message,
        });
        return;
      }
      throw e;
    }

    const id = Number(action.value);
    const announcement = await this.announcementService.findOne(id);

    if (!announcement) {
      await client.chat.postEphemeral({
        channel: userId,
        user: userId,
        text: '해당 공지를 찾을 수 없습니다.',
      });
      return;
    }

    await client.views.push({
      trigger_id: body.trigger_id,
      view: AnnouncementView.editModal(announcement),
    });
  }

  /** 공지 작성 제출 */
  @View('announcement:modal:create')
  async handleCreate({
    ack,
    body,
    view,
    client,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const userId = body.user.id;

    // 제출 시점 권한 재확인
    try {
      await this.permissionService.requireAdmin(userId);
    } catch (e) {
      if (e instanceof BusinessError) {
        await ack({
          response_action: 'errors',
          errors: { channel_block: e.message },
        });
        return;
      }
      throw e;
    }

    const values = view.state.values;
    const channelId =
      values.channel_block.channel_input.selected_option?.value ?? '';
    const title = values.title_block.title_input.value ?? '';
    // rich_text_input은 rich_text_value로 읽음 (Slack Block Kit 타입 미지원 → any 캐스팅)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const richTextBlock = (values.content_block?.content_input as any)?.rich_text_value ?? null;

    if (!channelId) {
      await ack({
        response_action: 'errors',
        errors: { channel_block: '채널을 선택해주세요.' },
      });
      return;
    }
    if (!richTextBlock) {
      await ack({
        response_action: 'errors',
        errors: { content_block: '공지 내용을 입력해주세요.' },
      });
      return;
    }

    await ack();

    const contentJson = JSON.stringify(richTextBlock);

    try {
      const message = AnnouncementView.announcementMessage(title, richTextBlock);
      const result = await client.chat.postMessage({
        channel: channelId,
        text: message.text,
        blocks: message.blocks,
      });

      const messageTs = result.ts ?? '';

      const author = await this.userService.findBySlackId(userId);
      if (!author) {
        this.logger.error(`공지 작성자를 찾을 수 없음 — slackId: ${userId}`);
        return;
      }

      await this.announcementService.create({
        channelId,
        messageTs,
        title,
        content: contentJson,
        authorId: author.id,
      });

      this.logger.log(
        `공지 발송 완료 — channel: ${channelId}, ts: ${messageTs}, by: ${userId}`,
      );
    } catch (error: unknown) {
      this.logger.error('공지 발송 실패:', error);
      await client.chat.postEphemeral({
        channel: userId,
        user: userId,
        text: `공지 발송에 실패했습니다: ${extractSlackErrorMessage(error)}`,
      });
    }
  }

  /** 공지 수정 제출 — private_metadata = announcement.id */
  @View('announcement:modal:edit')
  async handleEdit({
    ack,
    body,
    view,
    client,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const userId = body.user.id;

    // 제출 시점 권한 재확인
    try {
      await this.permissionService.requireAdmin(userId);
    } catch (e) {
      if (e instanceof BusinessError) {
        await ack({
          response_action: 'errors',
          errors: { title_block: e.message },
        });
        return;
      }
      throw e;
    }

    const id = Number(view.private_metadata);
    const values = view.state.values;
    const title = values.title_block.title_input.value ?? '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const richTextBlock = (values.content_block?.content_input as any)?.rich_text_value ?? null;

    if (!richTextBlock) {
      await ack({
        response_action: 'errors',
        errors: { content_block: '공지 내용을 입력해주세요.' },
      });
      return;
    }

    await ack();

    const contentJson = JSON.stringify(richTextBlock);
    const announcement = await this.announcementService.findOne(id);

    if (!announcement) {
      await client.chat.postEphemeral({
        channel: userId,
        user: userId,
        text: '해당 공지를 찾을 수 없습니다.',
      });
      return;
    }

    try {
      const message = AnnouncementView.announcementMessage(title, richTextBlock);
      await client.chat.update({
        channel: announcement.channelId,
        ts: announcement.messageTs,
        text: message.text,
        blocks: message.blocks,
      });

      await this.announcementService.update(id, { title, content: contentJson });

      this.logger.log(
        `공지 수정 완료 — id: ${id}, channel: ${announcement.channelId}`,
      );
    } catch (error: unknown) {
      const errorCode = extractSlackErrorCode(error);
      this.logger.error(`공지 수정 실패 — id: ${id}, error: ${errorCode}`);

      if (errorCode === 'message_not_found') {
        await client.chat.postEphemeral({
          channel: userId,
          user: userId,
          text: '채널에서 원본 메시지를 찾을 수 없습니다. 메시지가 삭제되었을 수 있습니다.',
        });
      } else {
        await client.chat.postEphemeral({
          channel: userId,
          user: userId,
          text: `공지 수정에 실패했습니다: ${extractSlackErrorMessage(error)}`,
        });
      }
    }
  }
}

/** Slack API 에러 코드 추출 헬퍼 */
function extractSlackErrorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === 'object' &&
    'data' in error &&
    error.data !== null &&
    typeof error.data === 'object' &&
    'error' in error.data
  ) {
    return String(error.data.error);
  }
  return '';
}

/** 에러 메시지 추출 헬퍼 */
function extractSlackErrorMessage(error: unknown): string {
  const code = extractSlackErrorCode(error);
  if (code) return code;
  if (error instanceof Error) return error.message;
  return '알 수 없는 오류';
}
