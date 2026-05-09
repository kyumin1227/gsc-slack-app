import { UserRole } from '../user.entity';

// Google 로그인 완료 후 유저 레코드 최초 생성 시 사용
export interface CreateUserDto {
  slackId: string;
  email: string;
  name: string;
  refreshToken: string;
}

// 역할·학번 입력 완료 후 가입 신청 시 사용
export interface SubmitRegistrationDto {
  code: string;
  role: UserRole;
  name?: string;
  studentClassId?: number;
}

// 본인이 수정 가능한 정보 (학번·반만 허용, 역할·상태 제외)
export interface UpdateMyInfoDto {
  name?: string;
  code?: string;
  studentClassId?: number | null;
}
