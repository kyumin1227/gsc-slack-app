import { Injectable } from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { HomeView } from './slack-home.view';

@Injectable()
export class SlackHomeService {
  constructor(private readonly userService: UserService) {}

  async getHomeView(slackUserId: string) {
    const user = await this.userService.findBySlackId(slackUserId);
    return user ? HomeView.registered() : HomeView.registration();
  }
}
