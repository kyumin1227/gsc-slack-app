import { createErrorDomain } from './base.error';

const { codes, messages } = createErrorDomain('GOOGLE', {
  SUBSCRIPTION_REQUIRES_REAUTH:
    '구독 기능을 사용하려면 Google 계정 재연동이 필요합니다. 회원정보를 다시 등록해주세요.',
  CALENDAR_WRITER_NOT_FOUND:
    '캘린더 수정 권한을 가진 활성 유저를 찾을 수 없습니다. \n관리자에게 문의해주세요.',
  CALENDAR_WRITER_NO_TOKEN:
    '캘린더 수정 권한자의 인증 정보가 없습니다. \n관리자에게 문의해주세요.',
  GOOGLE_TOKEN_EXPIRED:
    'Google 계정 연동이 만료되었습니다. 회원정보를 다시 등록해주세요.',
});

export const GoogleErrorCode = codes;
export const GOOGLE_ERROR_MESSAGES = messages;
