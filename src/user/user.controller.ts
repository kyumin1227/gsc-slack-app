import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import { UserService } from './user.service';
import { Action, SlackService, View } from 'nestjs-slack-bolt';
import type { Response } from 'express';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { UserView } from './user.view';
import { OAuthUtil } from './google-oauth.util';
import { UserRole } from './user.entity';

@Controller()
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    private readonly userService: UserService,
    private readonly slackService: SlackService,
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

      // 5. 저장된 view_id로 모달 업데이트
      const viewId = await this.userService.getViewId(slackUserId);
      if (viewId) {
        await this.slackService.client.views.update({
          view_id: viewId,
          view: UserView.registerFormModal({
            name: googleUser.name,
            email: googleUser.email,
            refreshToken,
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
  // 학생: 바로 ACTIVE / 키지기 이상: PENDING_APPROVAL
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

      // 학생은 바로 승인, 키지기 이상은 승인 대기
      const needsApproval = role !== UserRole.STUDENT;

      if (needsApproval) {
        await this.userService.submitRegistration(slackUserId, {
          code,
          role,
          name: name || undefined,
        });
      } else {
        // 학생은 바로 ACTIVE
        await this.userService.activateWithRole(slackUserId, {
          code,
          role,
          name: name || undefined,
        });
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
}
