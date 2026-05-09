import { Injectable } from '@nestjs/common';
import { calendar_v3 } from 'googleapis';
import { GoogleCalendarBaseService } from './base.service';

export interface CreateCalendarResult {
  calendarId: string;
  summary: string;
}

@Injectable()
export class GoogleCalendarsService extends GoogleCalendarBaseService {
  async createCalendar(
    summary: string,
    description?: string,
  ): Promise<CreateCalendarResult> {
    const calendar = this.getCalendarClient();
    const response = await calendar.calendars.insert({
      requestBody: { summary, description, timeZone: 'Asia/Seoul' },
    });

    if (!response.data.id) throw new Error('Failed to create calendar');

    return {
      calendarId: response.data.id,
      summary: response.data.summary ?? summary,
    };
  }

  async deleteCalendar(calendarId: string): Promise<void> {
    const calendar = this.getCalendarClient();
    await calendar.calendars.delete({ calendarId });
  }

  async getCalendar(
    calendarId: string,
  ): Promise<calendar_v3.Schema$Calendar | null> {
    const calendar = this.getCalendarClient();
    try {
      const response = await calendar.calendars.get({ calendarId });
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
    await calendar.calendars.update({
      calendarId,
      requestBody: { summary, description },
    });
  }
}
