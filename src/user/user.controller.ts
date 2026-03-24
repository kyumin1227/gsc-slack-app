import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import { UserService } from './user.service';
import { Action, Command, SlackService, View } from 'nestjs-slack-bolt';
import type { Response } from 'express';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  SlackCommandMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { UserView } from './user.view';
import { OAuthUtil } from './google-oauth.util';
import { UserRole } from './user.entity';
import { StudentClassService } from '../student-class/student-class.service';
import { CMD } from '../common/slack-commands';

@Controller()
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    private readonly userService: UserService,
    private readonly slackService: SlackService,
    private readonly studentClassService: StudentClassService,
  ) {}

  // 회원가입 모달 열기
  @Action('user:home:open_register_modal')
  async openRegisterModal({
    ack,
    client,
    body,
    logger,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    try {
      await ack();

      const slackUserId = body.user.id;

      // Google OAuth URL 생성
      const state = OAuthUtil.createOAuthState(slackUserId);
      const googleAuthUrl = OAuthUtil.getGoogleAuthUrl(state);

      const result = await client.views.open({
        trigger_id: body.trigger_id,
        view: UserView.registerModal(googleAuthUrl),
      });

      // view_id 저장 (모달 업데이트용)
      if (result.view?.id) {
        await this.userService.saveViewId(slackUserId, result.view.id);
      }
    } catch (error) {
      logger.error(error);
    }
  }

  // Google OAuth 콜백 → 유저 생성 (REGISTERED) + 모달 업데이트
  @Get('auth/google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      // 1. state 파싱
      const { slackUserId } = OAuthUtil.parseOAuthState(state);

      // 2. Google 토큰 교환
      const { accessToken, refreshToken } =
        await OAuthUtil.exchangeCodeForTokens(code);

      // 3. Google 유저 정보 가져오기
      const googleUser = await OAuthUtil.getGoogleUserInfo(accessToken);

      // 4. 유저 생성 (또는 기존 유저 조회)
      let user = await this.userService.findBySlackId(slackUserId);
      if (!user) {
        user = await this.userService.createUser({
          slackId: slackUserId,
          email: googleUser.email,
          name: googleUser.name,
          refreshToken,
        });
        this.logger.log(`New user created: ${slackUserId}`);
      }

      // 5. 활성 반 목록 조회
      const activeClasses = await this.studentClassService.findActiveClasses();

      // 6. 저장된 view_id로 모달 업데이트
      const viewId = await this.userService.getViewId(slackUserId);
      if (viewId) {
        await this.slackService.client.views.update({
          view_id: viewId,
          view: UserView.registerFormModal({
            name: googleUser.name,
            email: googleUser.email,
            refreshToken,
            classes: activeClasses.map((c) => ({
              id: c.id,
              name: c.name,
              admissionYear: c.admissionYear,
              section: c.section,
            })),
          }),
        });
        await this.userService.deleteViewId(slackUserId);
      }

      // 6. 브라우저 창 닫기
      res.send(`
        <html>
          <body>
            <script>window.close();</script>
            <p>Google 로그인 완료! 이 창을 닫고 Slack으로 돌아가세요.</p>
          </body>
        </html>
      `);
    } catch (error) {
      this.logger.error('Google OAuth error:', error);
      res.status(500).send('로그인 처리 중 오류가 발생했습니다.');
    }
  }

  // 회원가입 폼 제출
  // 바로 승인: 학생 OR 워크스페이스 소유자
  // 승인 대기: 키지기 이상 (소유자 제외)
  @View('user:modal:submit_register')
  async submitRegister({
    ack,
    body,
    view,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    try {
      const slackUserId = body.user.id;
      const values = view.state.values;

      // 폼 데이터 추출
      const name = values.name_block.name_input.value ?? '';
      const code = values.code_block.code_input.value ?? '';
      const role = values.role_block.role_input.selected_option
        ?.value as UserRole;
      const classValue = values.class_block.class_input.selected_option?.value;
      const studentClassId =
        classValue && classValue !== 'none' ? Number(classValue) : undefined;

      // 워크스페이스 소유자 여부 확인
      const userInfo = await this.slackService.client.users.info({
        user: slackUserId,
      });
      const isOwner = userInfo.user?.is_owner ?? false;

      // 학생이거나 워크스페이스 소유자면 바로 승인
      const needsApproval = role !== UserRole.STUDENT && !isOwner;

      const registrationData = {
        code,
        role,
        name: name || undefined,
        studentClassId,
      };

      if (needsApproval) {
        await this.userService.submitRegistration(
          slackUserId,
          registrationData,
        );
      } else {
        // 학생 또는 워크스페이스 소유자는 바로 ACTIVE
        await this.userService.activateWithRole(slackUserId, registrationData);
        await this.inviteToClassChannel(slackUserId, studentClassId);
      }

      await ack();

      // 완료 메시지 전송
      const message = needsApproval
        ? '가입 신청이 완료되었습니다. 관리자 승인을 기다려주세요.'
        : '가입이 완료되었습니다!';

      await this.slackService.client.chat.postMessage({
        channel: slackUserId,
        text: message,
      });

      logger.info(
        `Registration ${needsApproval ? 'submitted' : 'completed'}: ${slackUserId}`,
      );
    } catch (error) {
      logger.error('Submit registration error:', error);
      await ack({
        response_action: 'errors',
        errors: {
          code_block: '가입 처리 중 오류가 발생했습니다.',
        },
      });
    }
  }

  // 관리자: /승인 명령어 - 승인 대기 목록 모달
  // 조교(TA) 이상 권한 필요
  @Command(CMD.승인)
  async openApprovalModal({
    ack,
    client,
    body,
    logger,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    try {
      await ack();

      // 조교 이상 권한 확인
      const currentUser = await this.userService.findBySlackId(body.user_id);
      const allowedRoles = [UserRole.PROFESSOR, UserRole.TA];
      const hasPermission =
        currentUser && allowedRoles.includes(currentUser.role);

      if (!hasPermission) {
        await client.chat.postEphemeral({
          channel: body.channel_id,
          user: body.user_id,
          text: '이 명령어는 조교 이상 권한이 필요합니다.',
        });
        return;
      }

      // 승인 대기 유저 목록 조회
      const pendingUsers = await this.userService.findPendingApproval();

      await client.views.open({
        trigger_id: body.trigger_id,
        view: UserView.pendingApprovalModal(
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
    } catch (error) {
      logger.error('Open approval modal error:', error);
    }
  }

  // 관리자: 승인/거절 액션 처리
  @Action(/^user:admin:overflow:/)
  async handleApprovalAction({
    ack,
    body,
    client,
    logger,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    try {
      await ack();

      const action = body.actions[0] as { selected_option: { value: string } };
      const [actionType, targetSlackId] =
        action.selected_option.value.split(':');

      if (actionType === 'approve') {
        await this.userService.approveUser(targetSlackId);

        const approvedUser =
          await this.userService.findBySlackId(targetSlackId);
        await this.inviteToClassChannel(
          targetSlackId,
          approvedUser?.studentClassId,
        );

        // 승인된 유저에게 알림
        await client.chat.postMessage({
          channel: targetSlackId,
          text: '가입이 승인되었습니다! 이제 서비스를 이용할 수 있습니다.',
        });

        logger.info(`User approved: ${targetSlackId}`);
      } else if (actionType === 'reject') {
        await this.userService.rejectUser(targetSlackId);

        // 거절된 유저에게 알림
        await client.chat.postMessage({
          channel: targetSlackId,
          text: '가입 신청이 거절되었습니다. 문의사항이 있으면 관리자에게 연락해주세요.',
        });

        logger.info(`User rejected: ${targetSlackId}`);
      }

      // 모달 업데이트 (목록 새로고침)
      if (body.view?.id) {
        const pendingUsers = await this.userService.findPendingApproval();
        await client.views.update({
          view_id: body.view.id,
          view: UserView.pendingApprovalModal(
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
    } catch (error) {
      logger.error('Approval action error:', error);
    }
  }

  // 반의 Slack 채널에 유저 초대 (채널 없거나 이미 가입된 경우 조용히 무시)
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
      // 이미 채널 멤버인 경우 무시
      if (error?.data?.error !== 'already_in_channel') {
        this.logger.warn(
          `Failed to invite ${slackUserId} to channel ${studentClass.slackChannelId}: ${error?.message}`,
        );
      }
    }
  }
}
