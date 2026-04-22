import { Injectable } from '@nestjs/common';
import type { WebClient } from '@slack/web-api';
import { UserService } from 'src/user/user.service';
import { UserRole, UserStatus } from 'src/user/user.entity';
import { HomeView } from './slack-home.view';

@Injectable()
export class SlackHomeService {
  constructor(private readonly userService: UserService) {}

  async syncSlackName(client: WebClient, slackUserId: string): Promise<void> {
    try {
      const user = await this.userService.findBySlackId(slackUserId);
      if (!user || user.status === UserStatus.REGISTERED) return;

      const info = await client.users.info({ user: slackUserId });
      const slackName =
        info.user?.profile?.display_name || info.user?.real_name;
      if (!slackName || slackName === user.name) return;

      await this.userService.updateMyInfo(slackUserId, { name: slackName });
    } catch {}
  }

  async getHomeView(slackUserId: string) {
    const user = await this.userService.findBySlackIdWithClass(slackUserId);

    if (!user) return HomeView.registration();

    switch (user.status) {
      case UserStatus.PENDING_APPROVAL:
        return HomeView.pendingApproval();
      case UserStatus.ACTIVE:
        switch (user.role) {
          case UserRole.STUDENT:
          case UserRole.KEY_KEEPER:
          case UserRole.CLASS_REP:
            return HomeView.activeStudent(user);
          case UserRole.PROFESSOR:
          case UserRole.TA:
            return HomeView.activeStaff(user);
          default:
            return HomeView.registered();
        }
      case UserStatus.INACTIVE:
        return HomeView.inactive();
      default:
        return HomeView.registered();
    }
  }
}
