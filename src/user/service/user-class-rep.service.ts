import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../user.entity';

@Injectable()
export class UserClassRepService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  // 해당 반의 승인 대기 유저 목록 조회 (가입 신청 순)
  async findPendingApprovalByStudentClassId(
    studentClassId: number,
  ): Promise<User[]> {
    return this.userRepository.find({
      where: { status: UserStatus.PENDING_APPROVAL, studentClassId },
      relations: ['studentClass'],
      order: { createdAt: 'ASC' },
    });
  }

  // 해당 반의 전체 유저 목록을 페이지네이션하여 조회
  async findByStudentClassId(
    studentClassId: number,
    skip: number,
    take: number,
  ) {
    const [users, total] = await this.userRepository.findAndCount({
      where: { studentClassId },
      relations: ['studentClass'],
      order: { name: 'ASC' },
      skip,
      take,
    });
    return { users, total };
  }
}
