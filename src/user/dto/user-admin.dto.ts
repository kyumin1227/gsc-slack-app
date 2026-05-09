import { UserRole, UserStatus, User } from '../user.entity';

// 관리자가 유저 정보를 수정할 때 사용 (역할·상태·반 변경 포함)
export interface UpdateUserInfoDto {
  name?: string;
  code?: string;
  role?: UserRole;
  studentClassId?: number | null;
  status?: UserStatus;
}

// 유저 목록 조회 시 적용할 필터 조건
export interface UserListFilter {
  role?: UserRole;
  status?: UserStatus;
  studentClassId?: number;
}

// 필터+페이지네이션 조회 결과 (유저 배열 + 전체 건수)
export interface FindFilteredResult {
  users: User[];
  total: number;
}
