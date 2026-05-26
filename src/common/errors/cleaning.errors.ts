import { createErrorDomain } from './base.error';

const { codes, messages } = createErrorDomain('CLEANING', {
  ASSIGNMENT_NOT_FOUND: '배정 정보를 찾을 수 없습니다.',
  DUPLICATE_RULE: '해당 반의 동일 구역에 이미 청소 규칙이 존재합니다.',
  DUPLICATE_SCHEDULE_DATE: '해당 날짜에 이미 일정이 존재합니다.',
  TRADE_NOT_FOUND: '교환 요청을 찾을 수 없습니다.',
  TRADE_FORBIDDEN: '본인과 관련된 교환 요청만 처리할 수 있습니다.',
  TRADE_ALREADY_PENDING: '이미 대기 중인 교환 요청이 있습니다.',
  TRADE_NOT_PENDING: '대기 중인 교환 요청만 처리할 수 있습니다.',
  TRADE_DUPLICATE_ASSIGNEE:
    '교환 후 같은 날짜에 중복 배정이 발생합니다. 다른 배정을 선택해주세요.',
  TRADE_SAME_SCHEDULE:
    '같은 날짜의 배정끼리는 교환할 수 없습니다. 다른 배정을 선택해주세요.',
  SCHEDULE_HAS_ACTIVE_TRADES:
    '교환 요청이 있는 배정이 포함된 일정은 삭제할 수 없습니다. 교환 요청을 먼저 처리해주세요.',
});

export const CleaningErrorCode = codes;
export const CLEANING_ERROR_MESSAGES = messages;
