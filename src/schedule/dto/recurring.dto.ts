// 반복 주기 타입
export type RecurrenceType = 'weekly' | 'biweekly' | 'monthly';

// 반복 일정 생성 요청
export interface CreateRecurringEventsDto {
  scheduleId: number;
  title: string;
  description?: string;
  location?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  recurrenceType: RecurrenceType;
  daysOfWeek?: number[]; // 0=일, 1=월 ... 6=토 (weekly/biweekly 시 사용)
}

// 반복 일정 수정 요청
export interface UpdateRecurringEventsDto {
  title?: string;
  description?: string;
  location?: string;
  startTime?: string; // HH:MM
  endTime?: string; // HH:MM
  daysOfWeek?: number[]; // 변경 시 전체 삭제 후 재생성
  startDate?: string; // YYYY-MM-DD — 변경 시 전체 삭제 후 재생성
  endDate?: string; // YYYY-MM-DD
}
