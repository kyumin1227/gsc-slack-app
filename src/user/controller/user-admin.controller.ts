import { Controller } from '@nestjs/common';
import { Action, SlackService, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { UserService } from '../service/user.service';
import { UserAdminService } from '../service/user-admin.service';
import { UserAdminView } from '../view/user-admin.view';
import { UserListFilter, UserListModalState } from '../view/user.view';
import { UserRole, UserStatus } from '../user.entity';
import { BusinessError, UserErrorCode } from '../../common/errors';
import { StudentClassService } from '../../student-class/student-class.service';
import { PermissionService } from '../service/permission.service';

const PAGE_SIZE = 10;

@Controller()
export class UserAdminController {
  constructor(
    private readonly userService: UserService,
    private readonly userAdminService: UserAdminService,
    private readonly slackService: SlackService,
    private readonly studentClassService: StudentClassService,
    private readonly permissionService: PermissionService,
  ) {}

  // 승인 대기 목록 모달 열기
  @Action('home:open-approval')
  async openApprovalModal({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    await this.permissionService.requireAdmin(body.user.id);

    const pendingUsers = await this.userAdminService.findPendingApproval();

    await client.views.open({
      trigger_id: body.trigger_id,
      view: UserAdminView.pendingApprovalModal(
        pendingUsers.map((u) => ({
          slackId: u.slackId,
          name: u.name,
          email: u.email,
          code: u.code,
          role: u.role,
          className: u.studentClass?.name,
        })),
      ),
    });
  }

  // 승인/거절 overflow 액션 처리
  @Action(/^user:admin:overflow:/)
  async handleApprovalAction({
    ack,
    body,
    client,
    logger,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { selected_option: { value: string } };
    const [actionType, targetSlackId] = action.selected_option.value.split(':');

    if (actionType === 'approve') {
      await this.userService.approveUser(targetSlackId);

      const approvedUser = await this.userService.findBySlackId(targetSlackId);
      await this.inviteToClassChannel(
        targetSlackId,
        approvedUser?.studentClassId,
      );

      await client.chat.postMessage({
        channel: targetSlackId,
        text: '가입이 승인되었습니다! 이제 서비스를 이용할 수 있습니다.',
      });

      logger.info(`User approved: ${targetSlackId}`);
    } else if (actionType === 'reject') {
      await this.userAdminService.rejectUser(targetSlackId);

      await client.chat.postMessage({
        channel: targetSlackId,
        text: '가입 신청이 거절되었습니다. 문의사항이 있으면 관리자에게 연락해주세요.',
      });

      logger.info(`User rejected: ${targetSlackId}`);
    }

    if (body.view?.id) {
      const pendingUsers = await this.userAdminService.findPendingApproval();
      await client.views.update({
        view_id: body.view.id,
        view: UserAdminView.pendingApprovalModal(
          pendingUsers.map((u) => ({
            slackId: u.slackId,
            name: u.name,
            email: u.email,
            code: u.code,
            role: u.role,
            className: u.studentClass?.name,
          })),
        ),
      });
    }
  }

  // 유저 관리 목록 모달 열기
  @Action('home:open-user-management')
  async openUserManagement({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    await this.permissionService.requireAdmin(body.user.id);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: await this.buildUserListView({}, 0),
    });
  }

  // 역할 필터 변경
  @Action('user:admin:filter-role')
  async handleFilterRole({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const state: UserListModalState = JSON.parse(
      body.view?.private_metadata || '{}',
    );
    const action = body.actions[0] as { selected_option: { value: string } };
    const value = action.selected_option.value;
    const filter: UserListFilter = {
      ...state.filter,
      role: value === 'all' ? undefined : (value as UserRole),
    };
    await client.views.update({
      view_id: body.view!.id,
      view: await this.buildUserListView(filter, 0),
    });
  }

  // 상태 필터 변경
  @Action('user:admin:filter-status')
  async handleFilterStatus({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const state: UserListModalState = JSON.parse(
      body.view?.private_metadata || '{}',
    );
    const action = body.actions[0] as { selected_option: { value: string } };
    const value = action.selected_option.value;
    const filter: UserListFilter = {
      ...state.filter,
      status: value === 'all' ? undefined : (value as UserStatus),
    };
    await client.views.update({
      view_id: body.view!.id,
      view: await this.buildUserListView(filter, 0),
    });
  }

  // 반 필터 변경
  @Action('user:admin:filter-class')
  async handleFilterClass({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const state: UserListModalState = JSON.parse(
      body.view?.private_metadata || '{}',
    );
    const action = body.actions[0] as { selected_option: { value: string } };
    const value = action.selected_option.value;
    const filter: UserListFilter = {
      ...state.filter,
      studentClassId: value === 'all' ? undefined : Number(value),
    };
    await client.views.update({
      view_id: body.view!.id,
      view: await this.buildUserListView(filter, 0),
    });
  }

  // 이전 페이지
  @Action('user:admin:page-prev')
  async handlePagePrev({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const state: UserListModalState = JSON.parse(
      body.view?.private_metadata || '{}',
    );
    const action = body.actions[0] as { value: string };
    const page = Number(action.value);
    await client.views.update({
      view_id: body.view!.id,
      view: await this.buildUserListView(state.filter ?? {}, page),
    });
  }

  // 다음 페이지
  @Action('user:admin:page-next')
  async handlePageNext({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const state: UserListModalState = JSON.parse(
      body.view?.private_metadata || '{}',
    );
    const action = body.actions[0] as { value: string };
    const page = Number(action.value);
    await client.views.update({
      view_id: body.view!.id,
      view: await this.buildUserListView(state.filter ?? {}, page),
    });
  }

  // 유저 편집 모달 열기
  @Action('user:admin:user-overflow')
  async handleUserOverflow({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { selected_option: { value: string } };
    const [op, targetSlackId] = action.selected_option.value.split(':');

    if (op !== 'edit') return;

    const [targetUser, activeClasses] = await Promise.all([
      this.userService.findBySlackIdWithClass(targetSlackId),
      this.studentClassService.findActiveClasses(),
    ]);
    if (!targetUser) return;

    if (
      targetUser.status !== UserStatus.ACTIVE &&
      targetUser.status !== UserStatus.INACTIVE
    ) {
      throw new BusinessError(UserErrorCode.CANNOT_EDIT_PENDING_USER);
    }

    await client.views.push({
      trigger_id: body.trigger_id,
      view: UserAdminView.editUserModal({
        targetSlackId,
        name: targetUser.name,
        code: targetUser.code,
        role: targetUser.role,
        status: targetUser.status,
        studentClassId: targetUser.studentClassId,
        classes: activeClasses.map((c) => ({
          id: c.id,
          name: c.name,
          admissionYear: c.admissionYear,
          section: c.section,
        })),
      }),
    });
  }

  // 유저 정보 수정 제출
  @View('user:modal:edit')
  async handleEditUser({
    ack,
    view,
    client,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const { targetSlackId } = JSON.parse(view.private_metadata || '{}') as {
      targetSlackId: string;
    };
    const values = view.state.values;

    const name = values.name_block.name_input.value ?? undefined;
    const code = values.code_block.code_input.value ?? undefined;
    const role = values.role_block.role_input.selected_option?.value as
      | UserRole
      | undefined;
    const classValue = values.class_block?.class_input?.selected_option?.value;
    const studentClassId =
      classValue && classValue !== 'none' ? Number(classValue) : null;
    const status = values.status_block.status_input.selected_option?.value as
      | UserStatus
      | undefined;

    await ack();

    await this.userAdminService.updateUserInfo(targetSlackId, {
      name,
      code,
      role,
      studentClassId,
      status,
    });

    await client.chat.postMessage({
      channel: targetSlackId,
      text: '관리자에 의해 회원 정보가 수정되었습니다.',
    });
  }

  // 유저 목록 모달 빌드 헬퍼
  private async buildUserListView(filter: UserListFilter, page: number) {
    const { users, total } = await this.userAdminService.findFiltered(
      filter,
      page * PAGE_SIZE,
      PAGE_SIZE,
    );
    const activeClasses = await this.studentClassService.findActiveClasses();

    return UserAdminView.userListModal(
      users.map((u) => ({
        slackId: u.slackId,
        name: u.name,
        code: u.code,
        role: u.role,
        status: u.status,
        className: u.studentClass?.name,
      })),
      { page, pageSize: PAGE_SIZE, total },
      filter,
      activeClasses.map((c) => ({
        id: c.id,
        name: c.name,
        admissionYear: c.admissionYear,
        section: c.section,
      })),
    );
  }

  // 반의 Slack 채널에 유저 초대
  private async inviteToClassChannel(
    slackUserId: string,
    studentClassId: number | null | undefined,
  ): Promise<void> {
    if (!studentClassId) return;

    const studentClass =
      await this.studentClassService.findById(studentClassId);
    if (!studentClass?.slackChannelId) return;

    try {
      await this.slackService.client.conversations.invite({
        channel: studentClass.slackChannelId,
        users: slackUserId,
      });
    } catch (error: any) {
      if (error?.data?.error !== 'already_in_channel') throw error;
    }
  }
}
