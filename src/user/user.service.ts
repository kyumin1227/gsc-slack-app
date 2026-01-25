import { Injectable } from '@nestjs/common';

@Injectable()
export class UserService {
  // TODO 유저 객체 반환 예정
  async findBySlackId(slackUserId: string) {
    return false;
  }
}
