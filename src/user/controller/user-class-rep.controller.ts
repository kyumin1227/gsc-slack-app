import { Controller } from '@nestjs/common';
import { Action, SlackService } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { UserService } from '../service/user.service';
import { UserClassRepService } from '../service/user-class-rep.service';
import { UserClassRepView } from '../view/user-class-rep.view';
import { UserRole } from '../user.entity';
import { StudentClassService } from '../../student-class/student-class.service';

const PAGE_SIZE = 10;

@Controller()
export class UserClassRepController {
  constructor(
    private readonly userService: UserService,
    private readonly userClassRepService: UserClassRepService,
    private readonly slackService: SlackService,
    private readonly studentClassService: StudentClassService,
  ) {}

  // 반대표 권한 확인 후 자신의 studentClassId 반환
  private async getClassRepStudentClassId(
    slackUserId: string,
  ): Promise<number | null> {
    const user = await this.userService.findBySlackIdWithClass(slackUserId);
    if (!user || user.role !== UserRole.CLASS_REP || !user.studentClassId)
      return null;
    return user.studentClassId;
  }

  // 반대표: 자기 반 유저 목록 모달 열기
  @Action('home:open-class-rep-user-list')
  async classRepOpenUserList({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const studentClassId = await this.getClassRepStudentClassId(body.user.id);
    if (!studentClassId) return;

    const user = await this.userService.findBySlackIdWithClass(body.user.id);
    const className = user?.studentClass?.name ?? '';
    const { users, total } = await this.userClassRepService.findByStudentClassId(
      studentClassId,
      0,
      PAGE_SIZE,
    );

    await client.views.open({
      trigger_id: body.trigger_id,
      view: UserClassRepView.userListModal(
        users.map((u) => ({
          slackId: u.slackId,
          name: u.name,
          code: u.code,
          role: u.role,
          status: u.status,
          className: u.studentClass?.name,
        })),
        { page: 0, pageSize: PAGE_SIZE, total },
        className,
      ),
    });
  }

  // 반대표: 자기 반 유저 목록 페이지 이동
  @Action('user:class-rep:page-prev')
  @Action('user:class-rep:page-next')
  async classRepPageUserList({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const studentClassId = await this.getClassRepStudentClassId(body.user.id);
    if (!studentClassId) return;

    const action = body.actions[0] as { value: string };
    const page = parseInt(action.value, 10);

    const user = await this.userService.findBySlackIdWithClass(body.user.id);
    const className = user?.studentClass?.name ?? '';
    const { users, total } = await this.userClassRepService.findByStudentClassId(
      studentClassId,
      page * PAGE_SIZE,
      PAGE_SIZE,
    );

    if (body.view?.id) {
      await client.views.update({
        view_id: body.view.id,
        view: UserClassRepView.userListModal(
          users.map((u) => ({
            slackId: u.slackId,
            name: u.name,
            code: u.code,
            role: u.role,
            status: u.status,
            className: u.studentClass?.name,
          })),
          { page, pageSize: PAGE_SIZE, total },
          className,
        ),
      });
    }
  }

  // 반대표: 자기 반 승인 대기 목록 모달 열기
  @Action('home:open-class-rep-approval')
  async classRepOpenApproval({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const studentClassId = await this.getClassRepStudentClassId(body.user.id);
    if (!studentClassId) return;

    const pendingUsers =
      await this.userClassRepService.findPendingApprovalByStudentClassId(
        studentClassId,
      );

    await client.views.open({
      trigger_id: body.trigger_id,
      view: UserClassRepView.pendingApprovalModal(
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

  // 반대표: 자기 반 유저 승인
  @Action(/^user:class-rep:approve:/)
  async classRepApproveUser({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const studentClassId = await this.getClassRepStudentClassId(body.user.id);
    if (!studentClassId) return;

    const action = body.actions[0] as { action_id: string };
    const targetSlackId = action.action_id.split(':').pop()!;

    // 해당 유저가 자기 반인지 확인
    const targetUser = await this.userService.findBySlackId(targetSlackId);
    if (!targetUser || targetUser.studentClassId !== studentClassId) return;

    await this.userService.approveUser(targetSlackId);
    await this.inviteToClassChannel(targetSlackId, targetUser.studentClassId);

    await this.slackService.client.chat.postMessage({
      channel: targetSlackId,
      text: '가입이 승인되었습니다! 이제 서비스를 이용할 수 있습니다.',
    });

    if (body.view?.id) {
      const pendingUsers =
        await this.userClassRepService.findPendingApprovalByStudentClassId(
          studentClassId,
        );
      await client.views.update({
        view_id: body.view.id,
        view: UserClassRepView.pendingApprovalModal(
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
