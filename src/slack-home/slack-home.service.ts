import { Injectable } from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { UserRole, UserStatus } from 'src/user/user.entity';
import { HomeView } from './slack-home.view';

@Injectable()
export class SlackHomeService {
  constructor(private readonly userService: UserService) {}

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
