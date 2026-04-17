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

export interface UpdateUserInfoDto {
  name?: string;
  code?: string;
  role?: UserRole;
  studentClassId?: number | null;
  status?: UserStatus;
}

export interface UpdateMyInfoDto {
  name?: string;
  code?: string;
  studentClassId?: number | null;
}

export interface UserListFilter {
  role?: UserRole;
  status?: UserStatus;
  studentClassId?: number;
}

export interface FindFilteredResult {
  users: User[];
  total: number;
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

  async findBySlackIdWithClass(slackId: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { slackId },
      relations: { studentClass: true },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  async isAdmin(slackUserId: string): Promise<boolean> {
    const user = await this.findBySlackId(slackUserId);
    const allowed = [UserRole.PROFESSOR, UserRole.TA];
    return (
      !!user && user.status === UserStatus.ACTIVE && allowed.includes(user.role)
    );
  }

  async mapEmailsToSlackIds(emails: string[]): Promise<string[]> {
    const users = await Promise.all(emails.map((e) => this.findByEmail(e)));
    return users.filter((u): u is User => u !== null).map((u) => u.slackId);
  }

  async findActiveByEmails(emails: string[]): Promise<User | null> {
    if (emails.length === 0) return null;
    return this.userRepository
      .createQueryBuilder('user')
      .where('user.email IN (:...emails)', { emails })
      .andWhere('user.status = :status', { status: UserStatus.ACTIVE })
      .andWhere('user.refreshToken IS NOT NULL')
      .getOne();
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

  // 가입 거절 (hard delete → 재가입 가능)
  async rejectUser(slackId: string): Promise<void> {
    await this.userRepository.delete({ slackId });
  }

  // 전체 유저 목록 (soft-delete 제외, 이름 오름차순)
  async findAll(): Promise<User[]> {
    return this.userRepository.find({
      relations: ['studentClass'],
      order: { name: 'ASC' },
    });
  }

  // 필터 + 페이지네이션 유저 목록
  async findFiltered(
    filter: UserListFilter,
    skip: number,
    take: number,
  ): Promise<FindFilteredResult> {
    const qb = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.studentClass', 'studentClass')
      .orderBy('user.name', 'ASC');

    if (filter.role) {
      qb.andWhere('user.role = :role', { role: filter.role });
    }
    if (filter.status) {
      qb.andWhere('user.status = :status', { status: filter.status });
    }
    if (filter.studentClassId) {
      qb.andWhere('user.studentClassId = :classId', {
        classId: filter.studentClassId,
      });
    }

    const [users, total] = await qb.skip(skip).take(take).getManyAndCount();
    return { users, total };
  }

  // 유저 정보 수정 (관리자용: 역할·상태 포함)
  async updateUserInfo(
    targetSlackId: string,
    dto: UpdateUserInfoDto,
  ): Promise<User | null> {
    await this.userRepository.update(
      { slackId: targetSlackId },
      dto as Parameters<typeof this.userRepository.update>[1],
    );
    return this.findBySlackIdWithClass(targetSlackId);
  }

  // 내 정보 수정 (본인용: 이름·학번·반만)
  async updateMyInfo(
    slackId: string,
    dto: UpdateMyInfoDto,
  ): Promise<User | null> {
    await this.userRepository.update(
      { slackId },
      dto as Parameters<typeof this.userRepository.update>[1],
    );
    return this.findBySlackIdWithClass(slackId);
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
