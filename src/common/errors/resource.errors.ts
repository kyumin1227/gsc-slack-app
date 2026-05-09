import { createErrorDomain } from './base.error';

const { codes, messages } = createErrorDomain('RESOURCE', {
  STUDY_ROOM_NOT_FOUND: '스터디룸을 찾을 수 없습니다.',
  BOOKING_CONFLICT: '해당 시간대에 이미 예약이 있습니다.',
});

export const ResourceErrorCode = codes;
export const RESOURCE_ERROR_MESSAGES = messages;
