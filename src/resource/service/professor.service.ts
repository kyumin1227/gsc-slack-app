import { Injectable } from '@nestjs/common';
import { GoogleCalendarService } from '../../google/google-calendar.service';
import { UserService } from '../../user/user.service';
import { BusinessError, ErrorCode } from '../../common/errors';
import { ConsultationItem } from '../dto/professor.dto';

@Injectable()
export class ProfessorService {
  constructor(
    private readonly userService: UserService,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  // 교수의 향후 상담 예약 목록 조회 (Google Appointments 이벤트만 필터)
  async getConsultations(slackId: string): Promise<ConsultationItem[]> {
    const user = await this.userService.findBySlackId(slackId);
    if (!user) return [];

    const refreshToken = this.userService.getDecryptedRefreshToken(user);
    if (!refreshToken) return [];

    const CONSULTATION_LOOKAHEAD_MS = 90 * 24 * 60 * 60 * 1000; // 90일
    const now = new Date();
    const future = new Date(now.getTime() + CONSULTATION_LOOKAHEAD_MS);

    const events = await this.googleCalendarService.listUserPrimaryEvents(
      refreshToken,
      now,
      future,
    );

    const results: ConsultationItem[] = [];
    for (const ev of events) {
      if (ev.status === 'cancelled') continue;
      if (
        ev.extendedProperties?.shared?.['goo.createdBySet'] !== 'default_cita'
      )
        continue;
      const start = new Date(ev.start?.dateTime ?? ev.start?.date ?? '');
      const end = new Date(ev.end?.dateTime ?? ev.end?.date ?? '');
      results.push({
        eventId: ev.id!,
        summary: ev.summary ?? '(제목 없음)',
        startTime: start,
        endTime: end,
        htmlLink: ev.htmlLink ?? undefined,
      });
    }

    return results.sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime(),
    );
  }

  // 교수 상담 예약 취소
  async cancelConsultation(slackId: string, eventId: string): Promise<void> {
    const user = await this.userService.findBySlackId(slackId);
    if (!user) throw new BusinessError(ErrorCode.USER_NOT_FOUND);

    const refreshToken = this.userService.getDecryptedRefreshToken(user);
    if (!refreshToken)
      throw new BusinessError(ErrorCode.CALENDAR_WRITER_NO_TOKEN);

    await this.googleCalendarService.cancelConsultationEvent(
      refreshToken,
      eventId,
    );
  }
}
