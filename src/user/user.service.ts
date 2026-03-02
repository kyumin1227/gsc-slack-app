import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus, UserRole } from './user.entity';
import { CryptoUtil } from '../utils/crypto.util';

export interface CreateUserDto {
  slackId: string;
  email: string;
  name: string;
  refreshToken: string;
}

export interface SubmitRegistrationDto {
  code: string; // 학번 / 사번
  role: UserRole;
  name?: string;
  studentClassId?: number; // 반 ID (학생/키지기/반대표만)
}

@Injectable()
export class UserService {
  // 임시 저장소 (모달 업데이트용)
  private viewIdStore = new Map<string, string>();

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async findBySlackId(slackId: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { slackId } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  // 1단계: Google 로그인 완료 → REGISTERED
  async createUser(dto: CreateUserDto): Promise<User> {
    const user = this.userRepository.create({
      ...dto,
      refreshToken: CryptoUtil.encrypt(dto.refreshToken),
      status: UserStatus.REGISTERED,
    });
    return this.userRepository.save(user);
  }

  // refresh token 업데이트 (재인증 시)
  async updateRefreshToken(
    slackId: string,
    refreshToken: string,
  ): Promise<void> {
    await this.userRepository.update(
      { slackId },
      { refreshToken: CryptoUtil.encrypt(refreshToken) },
    );
  }

  // 복호화된 refresh token 조회
  getDecryptedRefreshToken(user: User): string | null {
    if (!user.refreshToken) return null;
    try {
      return CryptoUtil.decrypt(user.refreshToken);
    } catch {
      // 복호화 실패 시 (암호화되지 않은 이전 데이터일 수 있음)
      return null;
    }
  }

  // 2단계: 정보 입력 완료 → PENDING_APPROVAL
  async submitRegistration(
    slackId: string,
    dto: SubmitRegistrationDto,
  ): Promise<User | null> {
    await this.userRepository.update(
      { slackId },
      {
        ...dto,
        status: UserStatus.PENDING_APPROVAL,
      },
    );
    return this.findBySlackId(slackId);
  }

  // 학생: 바로 ACTIVE (승인 불필요)
  async activateWithRole(
    slackId: string,
    dto: SubmitRegistrationDto,
  ): Promise<User | null> {
    await this.userRepository.update(
      { slackId },
      {
        ...dto,
        status: UserStatus.ACTIVE,
      },
    );
    return this.findBySlackId(slackId);
  }

  // 승인 대기 유저 목록 조회
  async findPendingApproval(): Promise<User[]> {
    return this.userRepository.find({
      where: { status: UserStatus.PENDING_APPROVAL },
      relations: ['studentClass'],
      order: { createdAt: 'ASC' },
    });
  }

  // 3단계: 관리자 승인 → ACTIVE
  async approveUser(slackId: string): Promise<User | null> {
    await this.userRepository.update(
      { slackId },
      { status: UserStatus.ACTIVE },
    );
    return this.findBySlackId(slackId);
  }

  // 가입 거절 (soft delete)
  async rejectUser(slackId: string): Promise<void> {
    await this.userRepository.softDelete({ slackId });
  }

  // 비활성화
  async deactivateUser(slackId: string): Promise<User | null> {
    await this.userRepository.update(
      { slackId },
      { status: UserStatus.INACTIVE },
    );
    return this.findBySlackId(slackId);
  }

  // 모달 view_id 임시 저장 (Google OAuth callback에서 모달 업데이트용)
  async saveViewId(slackUserId: string, viewId: string): Promise<void> {
    this.viewIdStore.set(slackUserId, viewId);
  }

  async getViewId(slackUserId: string): Promise<string | undefined> {
    return this.viewIdStore.get(slackUserId);
  }

  async deleteViewId(slackUserId: string): Promise<void> {
    this.viewIdStore.delete(slackUserId);
  }
}
