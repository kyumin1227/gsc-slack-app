import { Injectable } from '@nestjs/common';
import { UserService } from './user.service';
import { User, UserStatus } from './user.entity';
import { BusinessError, ErrorCode } from '../common/errors';

@Injectable()
export class PermissionService {
  constructor(private readonly userService: UserService) {}

  /** 관리자(교수/조교) 권한 확인 — 없으면 BusinessError throw */
  async requireAdmin(userId: string): Promise<void> {
    if (!(await this.userService.isAdmin(userId))) {
      throw new BusinessError(ErrorCode.ADMIN_REQUIRED);
    }
  }

  /** 활성 회원 확인 — User 반환, 없으면 BusinessError throw */
  async requireActive(userId: string): Promise<User> {
    const user = await this.userService.findBySlackIdWithClass(userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new BusinessError(ErrorCode.ACTIVE_REQUIRED);
    }
    return user;
  }
}
