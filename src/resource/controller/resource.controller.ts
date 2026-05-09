import { Controller } from '@nestjs/common';
import { Action, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { ResourceService } from '../service/resource.service';
import { ResourceView } from '../view/resource.view';
import { ResourceStatus, ResourceType } from '../resource.entity';
import { UserService } from '../../user/service/user.service';
import { GoogleAclService } from '../../google/calendar/acl.service';
import { PermissionService } from '../../user/service/permission.service';

@Controller()
export class ResourceController {
  constructor(
    private readonly resourceService: ResourceService,
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
    private readonly googleAclService: GoogleAclService,
  ) {}

  // 리소스 생성 모달 열기 (어드민 전용)
  @Action('home:open-create-study-room')
  async openCreateModal({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const userId = body.user.id;
    await this.permissionService.requireAdmin(userId);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: ResourceView.createModal(),
    });
  }

  // 리소스 생성 모달 제출 처리
  @View('study-room:modal:create')
  async submitCreate({
    ack,
    client,
    body,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const values = body.view.state.values;
    const name = values.name_block.name_input.value ?? '';
    const type = (values.type_block.type_select.selected_option?.value ??
      'study_room') as ResourceType;
    const aliasesRaw = values.aliases_block.aliases_input.value ?? '';
    const aliases = aliasesRaw
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const description =
      values.description_block.description_input.value ?? undefined;
    const isDefault =
      (values.is_default_block?.is_default_checkbox?.selected_options ?? [])
        .length > 0;

    const resource = await this.resourceService.create({
      name,
      type,
      aliases,
      description,
      isDefault,
    });

    const typeLabel =
      type === ResourceType.CLASSROOM
        ? '교실'
        : type === ResourceType.PROFESSOR
          ? '교수 캘린더'
          : '스터디룸';

    const text = `✅ ${typeLabel}이 등록되었습니다.\n*${resource.name}*`;

    await client.chat.postMessage({
      channel: body.user.id,
      text,
    });
  }

  // 리소스 관리 모달 열기 (어드민 전용)
  @Action('home:open-study-room-manage')
  async openManageModal({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const userId = body.user.id;
    await this.permissionService.requireAdmin(userId);

    const resources = await this.resourceService.findAll();
    await client.views.open({
      trigger_id: body.trigger_id,
      view: ResourceView.manageModal(resources),
    });
  }

  // 관리 모달 내 생성 서브모달 열기
  @Action('study-room:admin:open-create')
  async adminOpenCreate({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    await client.views.push({
      trigger_id: body.trigger_id,
      view: ResourceView.createModal(),
    });
  }

  // 리소스 수정 서브모달 열기
  @Action('study-room:admin:open-edit')
  async adminOpenEdit({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const { roomId } = JSON.parse((action as { value: string }).value) as {
      roomId: number;
    };
    const resource = await this.resourceService.findById(roomId);
    if (!resource) return;
    await client.views.push({
      trigger_id: body.trigger_id,
      view: ResourceView.editModal(resource),
    });
  }

  // 리소스 수정 모달 제출 처리
  @View('study-room:modal:edit')
  async submitEdit({
    ack,
    client,
    body,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    await ack();
    const values = body.view.state.values;
    const { roomId } = JSON.parse(body.view.private_metadata) as {
      roomId: number;
    };
    const name = values.name_block.name_input.value ?? '';
    const type = values.type_block.type_select.selected_option
      ?.value as ResourceType;
    const aliasesRaw = values.aliases_block.aliases_input.value ?? '';
    const aliases = aliasesRaw
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const description =
      values.description_block.description_input.value ?? null;
    const status = values.status_block.status_select.selected_option
      ?.value as ResourceStatus;
    const bookingUrl =
      values.booking_url_block?.booking_url_input?.value?.trim() || null;

    await this.resourceService.rename(roomId, name);
    await this.resourceService.updateInfo(roomId, {
      description,
      status,
      aliases,
      type,
      bookingUrl,
    });
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ *${name}* 정보가 수정되었습니다.`,
    });
  }

  // 캘린더 편집자 관리 서브모달 열기 (현재 ACL 조회 후 초기값 세팅)
  @Action('study-room:admin:open-editors')
  async adminOpenEditors({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const { roomId, calendarId } = JSON.parse(
      (action as { value: string }).value,
    ) as { roomId: number; calendarId: string };

    const resource = await this.resourceService.findById(roomId);
    if (!resource) return;

    const acl = await this.googleAclService.getCalendarAcl(calendarId);
    const editorEmails = acl
      .filter((e) => e.role === 'writer')
      .map((e) => e.email);
    const initialEditorSlackIds =
      await this.userService.mapEmailsToSlackIds(editorEmails);

    await client.views.push({
      trigger_id: body.trigger_id,
      view: ResourceView.editorsModal(resource, initialEditorSlackIds),
    });
  }

  // 편집자 변경 사항 적용 (추가/제거 diff 계산 후 ACL 업데이트)
  @View('study-room:modal:editors')
  async submitEditors({
    ack,
    body,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    await ack();
    const values = body.view.state.values;
    const { roomId, calendarId } = JSON.parse(body.view.private_metadata) as {
      roomId: number;
      calendarId: string;
    };

    const selectedIds =
      values['editors_block']?.['editors_select']?.selected_users ?? [];

    const acl = await this.googleAclService.getCalendarAcl(calendarId);
    const currentEditorEmails = acl
      .filter((e) => e.role === 'writer')
      .map((e) => e.email);
    const currentEditorSlackIds =
      await this.userService.mapEmailsToSlackIds(currentEditorEmails);

    const oldSet = new Set(currentEditorSlackIds);
    const newSet = new Set(selectedIds);
    const toAdd = selectedIds.filter((id) => !oldSet.has(id));
    const toRemove = currentEditorSlackIds.filter((id) => !newSet.has(id));

    await Promise.all([
      ...toAdd.map(async (slackId) => {
        const user = await this.userService.findBySlackId(slackId);
        if (user?.email) {
          await this.resourceService.addEditor(roomId, user.email);
        }
      }),
      ...toRemove.map(async (slackId) => {
        const user = await this.userService.findBySlackId(slackId);
        if (user?.email) {
          await this.resourceService.removeEditor(roomId, user.email);
        }
      }),
    ]);
  }

  // 기본 공간 지정/해제 토글
  @Action('study-room:admin:toggle-default')
  async adminToggleDefault({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const { roomId, roomName } = JSON.parse(
      (action as { value: string }).value,
    ) as { roomId: number; roomName: string };

    const resource = await this.resourceService.findById(roomId);
    if (!resource) return;

    if (resource.isDefault) {
      await this.resourceService.unsetDefault(roomId);
    } else {
      await this.resourceService.setDefault(roomId);
    }

    const resources = await this.resourceService.findAll();
    await client.views.update({
      view_id: body.view?.id ?? '',
      view: ResourceView.manageModal(resources),
    });
    const label = resource.isDefault ? '기본 공간 해제' : '기본 공간으로 지정';
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ *${roomName}* 이 ${label}되었습니다.`,
    });
  }

  // 활성/비활성 상태 토글
  @Action('study-room:admin:toggle-status')
  async adminToggleStatus({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const { roomId, roomName } = JSON.parse(
      (action as { value: string }).value,
    ) as { roomId: number; roomName: string };

    const resource = await this.resourceService.findById(roomId);
    if (!resource) return;

    const newStatus =
      resource.status === ResourceStatus.ACTIVE
        ? ResourceStatus.INACTIVE
        : ResourceStatus.ACTIVE;

    await this.resourceService.updateInfo(roomId, { status: newStatus });

    const resources = await this.resourceService.findAll();
    await client.views.update({
      view_id: body.view?.id ?? '',
      view: ResourceView.manageModal(resources),
    });
    const label = newStatus === ResourceStatus.ACTIVE ? '활성화' : '비활성화';
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ *${roomName}* 이 ${label}되었습니다.`,
    });
  }

  // 리소스 삭제 확인 서브모달 열기
  @Action('study-room:admin:open-delete')
  async adminOpenDelete({
    ack,
    client,
    body,
    action,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const { roomId, roomName } = JSON.parse(
      (action as { value: string }).value,
    ) as { roomId: number; roomName: string };

    await client.views.push({
      trigger_id: body.trigger_id,
      view: ResourceView.deleteConfirmModal(roomId, roomName),
    });
  }

  // 리소스 삭제 확정 처리
  @View('study-room:modal:delete')
  async submitDelete({
    ack,
    body,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const roomId = parseInt(body.view.private_metadata, 10);
    await this.resourceService.remove(roomId);

    logger.info(`Resource ${roomId} deleted by ${body.user.id}`);
    await client.chat.postMessage({
      channel: body.user.id,
      text: '✅ 리소스가 삭제되었습니다.',
    });
  }
}
