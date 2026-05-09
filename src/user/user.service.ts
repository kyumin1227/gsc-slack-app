import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus, UserRole } from './user.entity';
import { CryptoUtil } from '../utils/crypto.util';
import {
  CreateUserDto,
  SubmitRegistrationDto,
  UpdateMyInfoDto,
} from './dto/user.dto';

@Injectable()
export class UserService {
  private viewIdStore = new Map<string, string>();

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  // slackId로 유저 단순 조회
  async findBySlackId(slackId: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { slackId } });
  }

  // slackId로 유저 조회 (studentClass 관계 포함)
  async findBySlackIdWithClass(slackId: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { slackId },
      relations: { studentClass: true },
    });
  }

  // 이메일로 유저 조회
  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  // 해당 슬랙 유저가 관리자(교수/조교) 권한인지 확인
  async isAdmin(slackUserId: string): Promise<boolean> {
    const user = await this.findBySlackId(slackUserId);
    const allowed = [UserRole.PROFESSOR, UserRole.TA];
    return (
      !!user && user.status === UserStatus.ACTIVE && allowed.includes(user.role)
    );
  }

  // 이메일 목록을 slackId 목록으로 변환
  async mapEmailsToSlackIds(emails: string[]): Promise<string[]> {
    const users = await Promise.all(emails.map((e) => this.findByEmail(e)));
    return users.filter((u): u is User => u !== null).map((u) => u.slackId);
  }

  // 이메일 목록 중 ACTIVE 상태이고 refreshToken이 있는 유저 조회 (Google Calendar 위임용)
  async findActiveByEmails(emails: string[]): Promise<User | null> {
    if (emails.length === 0) return null;
    return this.userRepository
      .createQueryBuilder('user')
      .where('user.email IN (:...emails)', { emails })
      .andWhere('user.status = :status', { status: UserStatus.ACTIVE })
      .andWhere('user.refreshToken IS NOT NULL')
      .getOne();
  }

  // 1단계: Google 로그인 완료 → REGISTERED 상태로 유저 생성
  async createUser(dto: CreateUserDto): Promise<User> {
    const user = this.userRepository.create({
      ...dto,
      refreshToken: CryptoUtil.encrypt(dto.refreshToken),
      status: UserStatus.REGISTERED,
    });
    return this.userRepository.save(user);
  }

  // refresh token 갱신 (재인증 시 암호화하여 저장)
  async updateRefreshToken(
    slackId: string,
    refreshToken: string,
  ): Promise<void> {
    await this.userRepository.update(
      { slackId },
      { refreshToken: CryptoUtil.encrypt(refreshToken) },
    );
  }

  // 저장된 refresh token을 복호화하여 반환 (복호화 실패 시 null)
  getDecryptedRefreshToken(user: User): string | null {
    if (!user.refreshToken) return null;
    try {
      return CryptoUtil.decrypt(user.refreshToken);
    } catch {
      return null;
    }
  }

  // 2단계: 역할·학번 입력 완료 → PENDING_APPROVAL 상태로 전환
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

  // 학생 역할 선택 시 승인 없이 바로 ACTIVE로 활성화
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

  // 3단계: 관리자 또는 반대표 승인 → ACTIVE 상태로 전환
  async approveUser(slackId: string): Promise<User | null> {
    await this.userRepository.update(
      { slackId },
      { status: UserStatus.ACTIVE },
    );
    return this.findBySlackId(slackId);
  }

  // 본인 정보 수정 (학번·반 변경만 허용, 역할·상태 변경 불가)
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

  // Google OAuth 콜백에서 모달 업데이트에 사용할 view_id를 인메모리에 임시 저장
  async saveViewId(slackUserId: string, viewId: string): Promise<void> {
    this.viewIdStore.set(slackUserId, viewId);
  }

  // 저장된 view_id 조회
  async getViewId(slackUserId: string): Promise<string | undefined> {
    return this.viewIdStore.get(slackUserId);
  }

  // 사용 완료된 view_id 삭제
  async deleteViewId(slackUserId: string): Promise<void> {
    this.viewIdStore.delete(slackUserId);
  }
}
