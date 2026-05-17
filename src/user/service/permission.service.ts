import { Injectable } from '@nestjs/common';
import { UserService } from './user.service';
import { User, UserRole, UserStatus } from '../user.entity';
import { BusinessError, UserErrorCode } from '../../common/errors';

@Injectable()
export class PermissionService {
  constructor(private readonly userService: UserService) {}

  /** 관리자(교수/조교) 권한 확인 — 없으면 BusinessError throw */
  async requireAdmin(userId: string): Promise<void> {
    if (!(await this.userService.isAdmin(userId))) {
      throw new BusinessError(UserErrorCode.ADMIN_REQUIRED);
    }
  }

  /** 활성 회원 확인 — User 반환, 없으면 BusinessError throw */
  async requireActive(userId: string): Promise<User> {
    const user = await this.userService.findBySlackIdWithClass(userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new BusinessError(UserErrorCode.ACTIVE_REQUIRED);
    }
    return user;
  }

  /** 청소 시스템 접근 권한 확인 (교수/조교/반대표) — User 반환, 없으면 BusinessError throw */
  async requireCleaningAccess(slackId: string): Promise<User> {
    const user = await this.userService.findBySlackIdWithClass(slackId);
    const allowed = [UserRole.PROFESSOR, UserRole.TA, UserRole.CLASS_REP];
    if (!user || user.status !== UserStatus.ACTIVE || !allowed.includes(user.role)) {
      throw new BusinessError(UserErrorCode.ADMIN_REQUIRED);
    }
    return user;
  }
}
