// 스터디룸 예약 요청
export interface BookResourceDto {
  resourceId: number;
  title: string;
  startTime: Date;
  endTime: Date;
  bookerSlackId: string;
  attendeeSlackIds: string[];
}

// 스터디룸 예약 수정 요청
export interface ModifyBookingDto {
  title: string;
  startTime: Date;
  endTime: Date;
  attendeeSlackIds: string[];
  resourceName: string;
}

// 내 예약 목록 항목
export interface BookingItem {
  calendarId: string;
  eventId: string;
  resourceName: string;
  summary: string;
  startTime: Date;
  endTime: Date;
  attendeeEmails: string[];
}
