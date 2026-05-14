import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../user.entity';
import {
  UpdateUserInfoDto,
  UserListFilter,
  FindFilteredResult,
} from '../dto/user-admin.dto';
import { UserService } from './user.service';

@Injectable()
export class UserAdminService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly userService: UserService,
  ) {}

  // 전체 승인 대기 유저 목록 조회 (가입 신청 순)
  async findPendingApproval(): Promise<User[]> {
    return this.userRepository.find({
      where: { status: UserStatus.PENDING_APPROVAL },
      relations: ['studentClass'],
      order: { createdAt: 'ASC' },
    });
  }

  // 가입 거절 — 유저 데이터를 hard delete하여 재가입 가능하게 처리
  async rejectUser(slackId: string): Promise<void> {
    await this.userRepository.delete({ slackId });
  }

  // 전체 유저 목록 조회 (이름 오름차순)
  async findAll(): Promise<User[]> {
    return this.userRepository.find({
      relations: ['studentClass'],
      order: { name: 'ASC' },
    });
  }

  // 역할·상태·반 필터와 페이지네이션을 적용한 유저 목록 조회
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

  // 관리자 권한으로 유저 정보 수정 (역할·상태·반 변경 포함)
  async updateUserInfo(
    targetSlackId: string,
    dto: UpdateUserInfoDto,
  ): Promise<User | null> {
    await this.userRepository.update(
      { slackId: targetSlackId },
      dto as Parameters<typeof this.userRepository.update>[1],
    );
    return this.userService.findBySlackIdWithClass(targetSlackId);
  }

  // 유저를 INACTIVE 상태로 비활성화
  async deactivateUser(slackId: string): Promise<User | null> {
    await this.userRepository.update(
      { slackId },
      { status: UserStatus.INACTIVE },
    );
    return this.userService.findBySlackId(slackId);
  }
}
