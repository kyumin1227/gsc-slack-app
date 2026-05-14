import { createErrorDomain } from './base.error';

const { codes, messages } = createErrorDomain('SCHEDULE', {
  SCHEDULE_NOT_FOUND: '시간표를 찾을 수 없습니다.',
  RECURRENCE_GROUP_NOT_FOUND: '반복 그룹을 찾을 수 없습니다.',
  NO_EVENTS_TO_CREATE: '생성할 일정이 없습니다.',
  CHANNEL_NAME_TAKEN:
    '이미 존재하는 Slack 채널 이름입니다. 채널을 직접 연결해주세요.',
  INVALID_WEEKDAY: '유효하지 않은 요일 값입니다.',
});

export const ScheduleErrorCode = codes;
export const SCHEDULE_ERROR_MESSAGES = messages;
