import { Injectable } from '@nestjs/common';
import { calendar_v3 } from 'googleapis';
import { GoogleCalendarBaseService } from './base.service';

@Injectable()
export class GoogleEventsService extends GoogleCalendarBaseService {
  // ========== 서비스 계정 기반 이벤트 ==========

  async createEventAsServiceAccount(
    calendarId: string,
    params: {
      summary: string;
      startDateTime: string;
      endDateTime: string;
      description?: string;
      location?: string;
      groupId: string;
    },
  ): Promise<string> {
    const calendar = this.getCalendarClient();
    const response = await calendar.events.insert({
      calendarId,
      sendUpdates: 'none',
      requestBody: {
        summary: params.summary,
        description: params.description,
        location: params.location,
        start: { dateTime: params.startDateTime, timeZone: 'Asia/Seoul' },
        end: { dateTime: params.endDateTime, timeZone: 'Asia/Seoul' },
        extendedProperties: { private: { groupId: params.groupId } },
      },
    });

    if (!response.data.id) throw new Error('Failed to create calendar event');
    return response.data.id;
  }

  async listEventsByGroupId(
    calendarId: string,
    groupId: string,
  ): Promise<calendar_v3.Schema$Event[]> {
    const calendar = this.getCalendarClient();
    const events: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;

    do {
      const response = await calendar.events.list({
        calendarId,
        privateExtendedProperty: [`groupId=${groupId}`],
        showDeleted: false,
        singleEvents: true,
        maxResults: 2500,
        ...(pageToken ? { pageToken } : {}),
      });
      events.push(...(response.data.items ?? []));
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return events;
  }

  async deleteEventAsServiceAccount(
    calendarId: string,
    eventId: string,
  ): Promise<void> {
    const calendar = this.getCalendarClient();
    await calendar.events.delete({ calendarId, eventId, sendUpdates: 'none' });
  }

  async updateEventAsServiceAccount(
    calendarId: string,
    eventId: string,
    params: {
      summary?: string;
      description?: string;
      location?: string;
      startDateTime?: string;
      endDateTime?: string;
    },
  ): Promise<void> {
    const calendar = this.getCalendarClient();
    const body: calendar_v3.Schema$Event = {};
    if (params.summary !== undefined) body.summary = params.summary;
    if (params.description !== undefined) body.description = params.description;
    if (params.location !== undefined) body.location = params.location;
    if (params.startDateTime)
      body.start = { dateTime: params.startDateTime, timeZone: 'Asia/Seoul' };
    if (params.endDateTime)
      body.end = { dateTime: params.endDateTime, timeZone: 'Asia/Seoul' };
    await calendar.events.patch({
      calendarId,
      eventId,
      sendUpdates: 'none',
      requestBody: body,
    });
  }

  async patchEventPrivateExtendedProperty(
    calendarId: string,
    eventId: string,
    privateProps: Record<string, string>,
  ): Promise<void> {
    const calendar = this.getCalendarClient();
    await calendar.events.patch({
      calendarId,
      eventId,
      sendUpdates: 'none',
      requestBody: { extendedProperties: { private: privateProps } },
    });
  }

  async searchByExtendedProperty(
    calendarId: string,
    key: string,
    value: string,
  ): Promise<calendar_v3.Schema$Event[]> {
    const calendar = this.getCalendarClient();
    const response = await calendar.events.list({
      calendarId,
      privateExtendedProperty: [`${key}=${value}`],
      maxResults: 1,
      showDeleted: false,
    });
    return response.data.items ?? [];
  }

  async createMirrorEventAsServiceAccount(
    calendarId: string,
    params: {
      summary: string;
      startDateTime: string;
      endDateTime: string;
      description?: string;
      location?: string;
      extendedProperties?: calendar_v3.Schema$Event['extendedProperties'];
    },
  ): Promise<string> {
    const calendar = this.getCalendarClient();
    const response = await calendar.events.insert({
      calendarId,
      sendUpdates: 'none',
      requestBody: {
        summary: params.summary,
        description: params.description,
        location: params.location,
        start: { dateTime: params.startDateTime, timeZone: 'Asia/Seoul' },
        end: { dateTime: params.endDateTime, timeZone: 'Asia/Seoul' },
        extendedProperties: params.extendedProperties,
      },
    });
    if (!response.data.id)
      throw new Error('Failed to create mirror calendar event');
    return response.data.id;
  }

  async updateMirrorEventAsServiceAccount(
    calendarId: string,
    eventId: string,
    params: {
      summary?: string;
      description?: string;
      location?: string;
      startDateTime?: string;
      endDateTime?: string;
      extendedProperties?: calendar_v3.Schema$Event['extendedProperties'];
    },
  ): Promise<void> {
    const calendar = this.getCalendarClient();
    const body: calendar_v3.Schema$Event = {};
    if (params.summary !== undefined) body.summary = params.summary;
    if (params.description !== undefined) body.description = params.description;
    if (params.location !== undefined) body.location = params.location;
    if (params.startDateTime)
      body.start = { dateTime: params.startDateTime, timeZone: 'Asia/Seoul' };
    if (params.endDateTime)
      body.end = { dateTime: params.endDateTime, timeZone: 'Asia/Seoul' };
    if (params.extendedProperties)
      body.extendedProperties = params.extendedProperties;
    await calendar.events.patch({
      calendarId,
      eventId,
      sendUpdates: 'none',
      requestBody: body,
    });
  }

  // ========== 공통 조회 ==========

  async getEventById(
    calendarId: string,
    eventId: string,
  ): Promise<calendar_v3.Schema$Event | null> {
    const calendar = this.getCalendarClient();
    try {
      const response = await calendar.events.get({ calendarId, eventId });
      return response.data;
    } catch (error: any) {
      if (error.code === 404 || error.code === 410) return null;
      throw error;
    }
  }

  async listEventsInRange(
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
  ): Promise<calendar_v3.Schema$Event[]> {
    const calendar = this.getCalendarClient();
    const events: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;

    while (true) {
      const response = await calendar.events.list({
        calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        showDeleted: false,
        singleEvents: true,
        maxResults: 2500,
        ...(pageToken ? { pageToken } : {}),
      });
      events.push(...(response.data.items ?? []));
      if (!response.data.nextPageToken) break;
      pageToken = response.data.nextPageToken;
    }

    return events;
  }

  async listMirrorEventsInRange(
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
  ): Promise<calendar_v3.Schema$Event[]> {
    const calendar = this.getCalendarClient();
    const events: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;

    while (true) {
      const response = await calendar.events.list({
        calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        privateExtendedProperty: ['mirroredBy=gsc-bot'],
        showDeleted: false,
        singleEvents: true,
        maxResults: 2500,
        ...(pageToken ? { pageToken } : {}),
      });
      events.push(...(response.data.items ?? []));
      if (!response.data.nextPageToken) break;
      pageToken = response.data.nextPageToken;
    }

    return events;
  }

  async getRecentChangedEvents(
    calendarId: string,
  ): Promise<calendar_v3.Schema$Event[]> {
    const calendar = this.getCalendarClient();
    const updatedMin = new Date(Date.now() - 30_000);
    const response = await calendar.events.list({
      calendarId,
      updatedMin: updatedMin.toISOString(),
      showDeleted: true,
      singleEvents: true,
      maxResults: 10,
    });
    return response.data.items ?? [];
  }

  // syncToken 관련 (watch push notification 처리용)

  async getInitialSyncToken(calendarId: string): Promise<string> {
    const calendar = this.getCalendarClient();
    let pageToken: string | undefined;

    while (true) {
      const response = await calendar.events.list({
        calendarId,
        showDeleted: true,
        singleEvents: true,
        maxResults: 2500,
        ...(pageToken ? { pageToken } : {}),
      });

      if (response.data.nextSyncToken) return response.data.nextSyncToken;
      if (!response.data.nextPageToken)
        throw new Error('Failed to get initial sync token');

      pageToken = response.data.nextPageToken;
    }
  }

  // 410 Gone 시 getInitialSyncToken으로 fallback
  async getChangedEventsBySyncToken(
    calendarId: string,
    syncToken: string,
  ): Promise<{ events: calendar_v3.Schema$Event[]; nextSyncToken: string }> {
    const calendar = this.getCalendarClient();
    try {
      const response = await calendar.events.list({
        calendarId,
        syncToken,
        showDeleted: true,
        singleEvents: true,
      });
      return {
        events: response.data.items ?? [],
        nextSyncToken: response.data.nextSyncToken!,
      };
    } catch (error: any) {
      if (error.code === 410) {
        const newToken = await this.getInitialSyncToken(calendarId);
        return { events: [], nextSyncToken: newToken };
      }
      throw error;
    }
  }

  // ========== 사용자 OAuth 기반 이벤트 ==========

  async createEvent(
    calendarId: string,
    refreshToken: string,
    params: {
      summary: string;
      startTime: Date;
      endTime: Date;
      attendeeEmails?: string[];
      location?: string;
      description?: string;
    },
  ): Promise<string> {
    const calendar = this.getUserCalendarClient(refreshToken);
    const response = await calendar.events.insert({
      calendarId,
      sendUpdates: 'none',
      requestBody: {
        summary: params.summary,
        description: params.description,
        location: params.location,
        start: {
          dateTime: params.startTime.toISOString(),
          timeZone: 'Asia/Seoul',
        },
        end: { dateTime: params.endTime.toISOString(), timeZone: 'Asia/Seoul' },
        attendees: params.attendeeEmails?.map((email) => ({ email })),
      },
    });

    if (!response.data.id) throw new Error('Failed to create calendar event');
    return response.data.id;
  }

  async deleteEvent(
    calendarId: string,
    refreshToken: string,
    eventId: string,
  ): Promise<void> {
    const calendar = this.getUserCalendarClient(refreshToken);
    await calendar.events.delete({ calendarId, eventId, sendUpdates: 'none' });
  }

  // primary 캘린더에서 삭제하고 교수에게 취소 알림 발송
  async cancelConsultationEvent(
    refreshToken: string,
    eventId: string,
  ): Promise<void> {
    const calendar = this.getUserCalendarClient(refreshToken);
    await calendar.events.delete({
      calendarId: 'primary',
      eventId,
      sendUpdates: 'all',
    });
  }

  async updateEvent(
    calendarId: string,
    refreshToken: string,
    eventId: string,
    params: {
      summary?: string;
      description?: string;
      startTime?: Date;
      endTime?: Date;
      attendeeEmails?: string[];
      location?: string;
    },
  ): Promise<void> {
    const calendar = this.getUserCalendarClient(refreshToken);
    const requestBody: calendar_v3.Schema$Event = {};
    if (params.summary !== undefined) requestBody.summary = params.summary;
    if (params.description !== undefined)
      requestBody.description = params.description;
    if (params.location !== undefined) requestBody.location = params.location;
    if (params.startTime !== undefined)
      requestBody.start = {
        dateTime: params.startTime.toISOString(),
        timeZone: 'Asia/Seoul',
      };
    if (params.endTime !== undefined)
      requestBody.end = {
        dateTime: params.endTime.toISOString(),
        timeZone: 'Asia/Seoul',
      };
    if (params.attendeeEmails !== undefined)
      requestBody.attendees = params.attendeeEmails.map((email) => ({ email }));

    await calendar.events.update({
      calendarId,
      eventId,
      sendUpdates: 'none',
      requestBody,
    });
  }

  async listUserPrimaryEvents(
    refreshToken: string,
    timeMin: Date,
    timeMax: Date,
  ): Promise<calendar_v3.Schema$Event[]> {
    const calendar = this.getUserCalendarClient(refreshToken);
    const events: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;

    while (true) {
      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        showDeleted: false,
        singleEvents: true,
        maxResults: 2500,
        ...(pageToken ? { pageToken } : {}),
      });
      events.push(...(response.data.items ?? []));
      if (!response.data.nextPageToken) break;
      pageToken = response.data.nextPageToken;
    }

    return events;
  }

  async getUserBookings(
    calendarIds: string[],
    userEmail: string,
  ): Promise<Array<{ calendarId: string; event: calendar_v3.Schema$Event }>> {
    const calendar = this.getCalendarClient();
    const now = new Date().toISOString();
    const results: Array<{
      calendarId: string;
      event: calendar_v3.Schema$Event;
    }> = [];

    await Promise.all(
      calendarIds.map(async (calendarId) => {
        const response = await calendar.events.list({
          calendarId,
          q: userEmail,
          timeMin: now,
          singleEvents: true,
          orderBy: 'startTime',
        });
        for (const event of response.data.items ?? []) {
          if (event.attendees?.some((a) => a.email === userEmail)) {
            results.push({ calendarId, event });
          }
        }
      }),
    );

    results.sort((a, b) => {
      const aTime = a.event.start?.dateTime ?? '';
      const bTime = b.event.start?.dateTime ?? '';
      return aTime.localeCompare(bTime);
    });

    return results;
  }
}
