import { Injectable } from '@nestjs/common';
import { calendar_v3 } from 'googleapis';
import { GoogleCalendarBaseService } from './base.service';
import { GoogleApiLimiter } from '../google-api-limiter.service';
import { AppMetrics } from '../../common/metrics/app.metrics';

export interface CreateCalendarResult {
  calendarId: string;
  summary: string;
}

@Injectable()
export class GoogleCalendarsService extends GoogleCalendarBaseService {
  constructor(limiter: GoogleApiLimiter, appMetrics: AppMetrics) {
    super(limiter, appMetrics);
  }

  async createCalendar(
    summary: string,
    description?: string,
  ): Promise<CreateCalendarResult> {
    const calendar = this.getCalendarClient();
    const response = await this.callApi('createCalendar', () =>
      calendar.calendars.insert({
        requestBody: { summary, description, timeZone: 'Asia/Seoul' },
      }),
    );

    if (!response.data.id) throw new Error('Failed to create calendar');

    return {
      calendarId: response.data.id,
      summary: response.data.summary ?? summary,
    };
  }

  async deleteCalendar(calendarId: string): Promise<void> {
    const calendar = this.getCalendarClient();
    await this.callApi('deleteCalendar', () =>
      calendar.calendars.delete({ calendarId }),
    );
  }

  async getCalendar(
    calendarId: string,
  ): Promise<calendar_v3.Schema$Calendar | null> {
    const calendar = this.getCalendarClient();
    try {
      const response = await this.callApi('getCalendar', () =>
        calendar.calendars.get({ calendarId }),
      );
      return response.data;
    } catch (error: any) {
      if (error.code === 404) return null;
      throw error;
    }
  }

  async updateCalendar(
    calendarId: string,
    summary: string,
    description?: string,
  ): Promise<void> {
    const calendar = this.getCalendarClient();
    await this.callApi('updateCalendar', () =>
      calendar.calendars.update({
        calendarId,
        requestBody: { summary, description },
      }),
    );
  }
}
