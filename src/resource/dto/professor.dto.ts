// 교수 상담 예약 목록 항목
export interface ConsultationItem {
  eventId: string;
  summary: string;
  startTime: Date;
  endTime: Date;
  htmlLink?: string;
}
