import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import { Action, SlackService, View } from 'nestjs-slack-bolt';
import type { Response } from 'express';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { UserService } from '../service/user.service';
import { UserView } from '../view/user.view';
import { GoogleOAuthService } from '../../google/oauth/google-oauth.service';
import { UserRole } from '../user.entity';
import { StudentClassService } from '../../student-class/student-class.service';

const PAGE_SIZE = 10;

@Controller()
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    private readonly userService: UserService,
    private readonly slackService: SlackService,
    private readonly studentClassService: StudentClassService,
    private readonly googleOAuthService: GoogleOAuthService,
  ) {}

  // 회원가입 모달 열기
  @Action('user:home:open_register_modal')
  async openRegisterModal({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const slackUserId = body.user.id;

    const state = this.googleOAuthService.createOAuthState(slackUserId);
    const googleAuthUrl = this.googleOAuthService.getGoogleAuthUrl(state);

    const result = await client.views.open({
      trigger_id: body.trigger_id,
      view: UserView.registerModal(googleAuthUrl),
    });

    if (result.view?.id) {
      await this.userService.saveViewId(slackUserId, result.view.id);
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
      const { slackUserId } = this.googleOAuthService.parseOAuthState(state);

      // 2. Google 토큰 교환
      const { accessToken, refreshToken } =
        await this.googleOAuthService.exchangeCodeForTokens(code);

      // 3. Google 유저 정보 가져오기
      const googleUser =
        await this.googleOAuthService.getGoogleUserInfo(accessToken);

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

      const code = values.code_block.code_input.value ?? '';
      const role = values.role_block.role_input.selected_option
        ?.value as UserRole;
      const classValue = values.class_block.class_input.selected_option?.value;
      const studentClassId =
        classValue && classValue !== 'none' ? Number(classValue) : undefined;

      // 슬랙 프로필 조회 (이름 동기화 + 소유자 여부 확인)
      const userInfo = await this.slackService.client.users.info({
        user: slackUserId,
      });
      const isOwner = userInfo.user?.is_owner ?? false;
      const slackName =
        userInfo.user?.profile?.display_name ||
        userInfo.user?.real_name ||
        undefined;

      const needsApproval = role !== UserRole.STUDENT && !isOwner;

      const registrationData = {
        code,
        role,
        name: slackName,
        studentClassId,
      };

      if (needsApproval) {
        await this.userService.submitRegistration(
          slackUserId,
          registrationData,
        );
      } else {
        await this.userService.activateWithRole(slackUserId, registrationData);
        await this.inviteToClassChannel(slackUserId, studentClassId);
      }

      await ack();

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

  // 내 정보 수정 모달 열기
  @Action('home:open-my-info')
  async openMyInfoModal({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const userId = body.user.id;
    const [user, activeClasses] = await Promise.all([
      this.userService.findBySlackIdWithClass(userId),
      this.studentClassService.findActiveClasses(),
    ]);
    if (!user) return;

    await client.views.open({
      trigger_id: body.trigger_id,
      view: UserView.myInfoModal({
        code: user.code,
        role: user.role,
        status: user.status,
        studentClassId: user.studentClassId,
        classes: activeClasses.map((c) => ({
          id: c.id,
          name: c.name,
          admissionYear: c.admissionYear,
          section: c.section,
        })),
      }),
    });
  }

  // 내 정보 수정 제출
  @View('user:modal:my-info')
  async handleMyInfo({
    ack,
    body,
    view,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const slackId = body.user.id;
    const values = view.state.values;

    const code = values.code_block.code_input.value ?? undefined;
    const classValue = values.class_block?.class_input?.selected_option?.value;
    const studentClassId =
      classValue && classValue !== 'none' ? Number(classValue) : null;

    await ack();

    await this.userService.updateMyInfo(slackId, { code, studentClassId });
  }

  // 반의 Slack 채널에 유저 초대 (채널 없거나 이미 가입된 경우 조용히 무시)
  async inviteToClassChannel(
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
      if (error?.data?.error !== 'already_in_channel') {
        this.logger.warn(
          `Failed to invite ${slackUserId} to channel ${studentClass.slackChannelId}: ${error?.message}`,
        );
      }
    }
  }
}
