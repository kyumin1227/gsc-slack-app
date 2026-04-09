export enum ErrorCode {
  // 권한
  ADMIN_REQUIRED = 'ADMIN_REQUIRED',
  ACTIVE_REQUIRED = 'ACTIVE_REQUIRED',
  // 리소스 없음
  SCHEDULE_NOT_FOUND = 'SCHEDULE_NOT_FOUND',
  RECURRENCE_GROUP_NOT_FOUND = 'RECURRENCE_GROUP_NOT_FOUND',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  STUDY_ROOM_NOT_FOUND = 'STUDY_ROOM_NOT_FOUND',
  // 비즈니스 규칙
  NO_EVENTS_TO_CREATE = 'NO_EVENTS_TO_CREATE',
  SUBSCRIPTION_REQUIRES_REAUTH = 'SUBSCRIPTION_REQUIRES_REAUTH',
  BOOKING_CONFLICT = 'BOOKING_CONFLICT',
  CALENDAR_WRITER_NOT_FOUND = 'CALENDAR_WRITER_NOT_FOUND',
  CALENDAR_WRITER_NO_TOKEN = 'CALENDAR_WRITER_NO_TOKEN',
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.ADMIN_REQUIRED]: '이 기능은 조교 이상 권한이 필요합니다.',
  [ErrorCode.ACTIVE_REQUIRED]:
    '활성화된 사용자만 이용 가능합니다. 먼저 회원가입을 완료해주세요.',
  [ErrorCode.SCHEDULE_NOT_FOUND]: '시간표를 찾을 수 없습니다.',
  [ErrorCode.RECURRENCE_GROUP_NOT_FOUND]: '반복 그룹을 찾을 수 없습니다.',
  [ErrorCode.USER_NOT_FOUND]: '사용자 정보를 찾을 수 없습니다.',
  [ErrorCode.STUDY_ROOM_NOT_FOUND]: '스터디룸을 찾을 수 없습니다.',
  [ErrorCode.NO_EVENTS_TO_CREATE]: '생성할 일정이 없습니다.',
  [ErrorCode.SUBSCRIPTION_REQUIRES_REAUTH]:
    '구독 기능을 사용하려면 Google 계정 재연동이 필요합니다. 회원정보를 다시 등록해주세요.',
  [ErrorCode.BOOKING_CONFLICT]: '해당 시간대에 이미 예약이 있습니다.',
  [ErrorCode.CALENDAR_WRITER_NOT_FOUND]:
    '캘린더 수정 권한을 가진 활성 유저를 찾을 수 없습니다. \n관리자에게 문의해주세요.',
  [ErrorCode.CALENDAR_WRITER_NO_TOKEN]:
    '캘린더 수정 권한자의 인증 정보가 없습니다. \n관리자에게 문의해주세요.',
};

export class BusinessError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = 'BusinessError';
  }
}
