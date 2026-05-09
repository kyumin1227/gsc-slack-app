import { Injectable } from '@nestjs/common';
import { GoogleCalendarBaseService } from './base.service';
import { GoogleEventsService } from './events.service';

@Injectable()
export class GoogleFreebusyService extends GoogleCalendarBaseService {
  constructor(private readonly eventsService: GoogleEventsService) {
    super();
  }

  async isTimeSlotBusy(
    calendarId: string,
    refreshToken: string,
    startTime: Date,
    endTime: Date,
  ): Promise<boolean> {
    const calendar = this.getUserCalendarClient(refreshToken);
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        timeZone: 'Asia/Seoul',
        items: [{ id: calendarId }],
      },
    });
    const busy = response.data.calendars?.[calendarId]?.busy ?? [];
    return busy.length > 0;
  }

  async isTimeSlotBusyExcluding(
    calendarId: string,
    startTime: Date,
    endTime: Date,
    excludeEventId: string,
  ): Promise<boolean> {
    const events = await this.eventsService.listEventsInRange(
      calendarId,
      startTime,
      endTime,
    );
    return events.some(
      (e) => e.id !== excludeEventId && e.status !== 'cancelled',
    );
  }
}
