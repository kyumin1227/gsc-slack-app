import { createErrorDomain } from './base.error';

const { codes, messages } = createErrorDomain('USER', {
  ADMIN_REQUIRED: '이 기능은 조교 이상 권한이 필요합니다.',
  ADMIN_OR_CLASS_REP_REQUIRED: '이 기능은 교수, 조교 또는 반대표만 사용할 수 있습니다.',
  ACTIVE_REQUIRED:
    '활성화된 사용자만 이용 가능합니다. 먼저 회원가입을 완료해주세요.',
  USER_NOT_FOUND: '사용자 정보를 찾을 수 없습니다.',
  CANNOT_EDIT_PENDING_USER:
    '승인 대기 또는 미가입 상태의 유저는 편집할 수 없습니다.\n가입 승인 관리에서 먼저 처리해주세요.',
});

export const UserErrorCode = codes;
export const USER_ERROR_MESSAGES = messages;
