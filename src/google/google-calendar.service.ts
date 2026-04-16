import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { google, calendar_v3 } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

export interface CreateCalendarResult {
  calendarId: string;
  summary: string;
}

export interface ShareCalendarOptions {
  calendarId: string;
  email: string;
  role: 'reader' | 'writer' | 'owner';
}

export interface CalendarAclEntry {
  email: string;
  role: 'reader' | 'writer' | 'owner';
}

@Injectable()
export class GoogleCalendarService {
  private readonly ACL_CACHE_KEY = (id: string) => `google:acl:${id}`;
  private readonly ACL_TTL_MS = 15 * 60 * 1000; // 15분

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  // Service Account 인증 (캘린더 생성/관리용)
  private getServiceAccountAuth() {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(
      /\\n/g,
      '\n',
    );

    if (!email || !privateKey) {
      throw new Error(
        'Google service account credentials not configured. ' +
          'Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.',
      );
    }

    return new google.auth.JWT({
      email,
      key: privateKey,
      scopes: SCOPES,
    });
  }

  // 사용자 OAuth 인증 (사용자 캘린더 목록 관리용)
  private getUserAuth(refreshToken: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        'Google OAuth credentials not configured. ' +
          'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      );
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    return oauth2Client;
  }

  private getCalendarClient(): calendar_v3.Calendar {
    const auth = this.getServiceAccountAuth();
    return google.calendar({ version: 'v3', auth });
  }

  private getUserCalendarClient(refreshToken: string): calendar_v3.Calendar {
    const auth = this.getUserAuth(refreshToken);
    return google.calendar({ version: 'v3', auth });
  }

  // 캘린더 생성
  async createCalendar(
    summary: string,
    description?: string,
  ): Promise<CreateCalendarResult> {
    const calendar = this.getCalendarClient();

    const response = await calendar.calendars.insert({
      requestBody: {
        summary,
        description,
        timeZone: 'Asia/Seoul',
      },
    });

    if (!response.data.id) {
      throw new Error('Failed to create calendar');
    }

    return {
      calendarId: response.data.id,
      summary: response.data.summary ?? summary,
    };
  }

  // 캘린더 삭제
  async deleteCalendar(calendarId: string): Promise<void> {
    const calendar = this.getCalendarClient();
    await calendar.calendars.delete({ calendarId });
  }

  // 캘린더 공유 (유저에게 권한 부여)
  async shareCalendar(options: ShareCalendarOptions): Promise<void> {
    const calendar = this.getCalendarClient();

    await calendar.acl.insert({
      calendarId: options.calendarId,
      requestBody: {
        role: options.role,
        scope: {
          type: 'user',
          value: options.email,
        },
      },
    });

    await this.cache.del(this.ACL_CACHE_KEY(options.calendarId));
  }

  // 캘린더 공유 제거 (권한 삭제)
  async unshareCalendar(calendarId: string, email: string): Promise<void> {
    const calendar = this.getCalendarClient();

    // 구글 캘린더 ACL에서 유저 권한의 ruleId는 보통 "user:이메일주소" 형식
    const ruleId = `user:${email}`;

    try {
      await calendar.acl.delete({
        calendarId,
        ruleId,
      });
    } catch (error: any) {
      if (error.code === 404) {
        await this.cache.del(this.ACL_CACHE_KEY(calendarId));
        return;
      }
      throw error;
    }

    await this.cache.del(this.ACL_CACHE_KEY(calendarId));
  }

  // 캘린더 공개 설정 (읽기 전용)
  async makeCalendarPublic(calendarId: string): Promise<void> {
    const calendar = this.getCalendarClient();

    await calendar.acl.insert({
      calendarId,
      requestBody: {
        role: 'reader',
        scope: {
          type: 'default', // 모든 사람
        },
      },
    });
  }

  // 캘린더 정보 조회
  async getCalendar(
    calendarId: string,
  ): Promise<calendar_v3.Schema$Calendar | null> {
    const calendar = this.getCalendarClient();

    try {
      const response = await calendar.calendars.get({ calendarId });
      return response.data;
    } catch (error: any) {
      if (error.code === 404) {
        return null;
      }
      throw error;
    }
  }

  // 캘린더 이름 변경
  async updateCalendar(
    calendarId: string,
    summary: string,
    description?: string,
  ): Promise<void> {
    const calendar = this.getCalendarClient();

    await calendar.calendars.update({
      calendarId,
      requestBody: {
        summary,
        description,
      },
    });
  }

  // 캘린더 ACL 조회 (권한 목록) — Redis 15분 캐싱
  async getCalendarAcl(calendarId: string): Promise<CalendarAclEntry[]> {
    const key = this.ACL_CACHE_KEY(calendarId);
    const cached = await this.cache.get<CalendarAclEntry[]>(key);
    if (cached) return cached;

    const data = await this.fetchCalendarAcl(calendarId);
    await this.cache.set(key, data, this.ACL_TTL_MS);
    return data;
  }

  private async fetchCalendarAcl(
    calendarId: string,
  ): Promise<CalendarAclEntry[]> {
    const calendar = this.getCalendarClient();

    const response = await calendar.acl.list({ calendarId });
    const items = response.data.items ?? [];

    return items
      .filter(
        (item) =>
          item.scope?.type === 'user' &&
          item.scope?.value &&
          item.role &&
          ['reader', 'writer', 'owner'].includes(item.role),
      )
      .map((item) => ({
        email: item.scope!.value!,
        role: item.role as 'reader' | 'writer' | 'owner',
      }));
  }

  // ========== 사용자 캘린더 목록 관리 (OAuth 토큰 사용) ==========

  // 사용자 캘린더 목록에 캘린더 추가
  async addCalendarToUserList(
    calendarId: string,
    userRefreshToken: string,
  ): Promise<void> {
    const calendar = this.getUserCalendarClient(userRefreshToken);

    try {
      await calendar.calendarList.insert({
        requestBody: {
          id: calendarId,
        },
      });
    } catch (error: unknown) {
      const err = error as { code?: number };
      // 이미 추가된 경우 (409 Conflict) 무시
      if (err.code === 409) {
        return;
      }
      throw error;
    }
  }

  // ========== Google Calendar Watch (Push Notification) ==========

  isWatchConfigured(): boolean {
    return !!process.env.GOOGLE_WEBHOOK_URL;
  }

  // 캘린더 이벤트 변경 watch 등록
  async watchCalendarEvents(
    calendarId: string,
    channelId: string,
  ): Promise<{ resourceId: string }> {
    const callbackUrl = `${process.env.GOOGLE_WEBHOOK_URL}/google/calendar/webhook`;
    const watchDurationMs = 7 * 24 * 60 * 60 * 1000;
    const calendar = this.getCalendarClient();

    const response = await calendar.events.watch({
      calendarId,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: callbackUrl,
        expiration: String(Date.now() + watchDurationMs),
      },
    });

    if (!response.data.resourceId) {
      throw new Error(
        'Failed to register calendar watch: no resourceId returned',
      );
    }

    return { resourceId: response.data.resourceId };
  }

  // watch 해제
  async stopCalendarWatch(
    channelId: string,
    resourceId: string,
  ): Promise<void> {
    const calendar = this.getCalendarClient();

    try {
      await calendar.channels.stop({
        requestBody: { id: channelId, resourceId },
      });
    } catch (error: any) {
      // 이미 만료됐거나 존재하지 않는 채널이면 무시
      if (error.code === 404 || error.code === 400) {
        return;
      }
      throw error;
    }
  }

  // 초기 syncToken 발급 (watch 등록 시 호출)
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

      if (response.data.nextSyncToken) {
        return response.data.nextSyncToken;
      }

      if (!response.data.nextPageToken) {
        throw new Error('Failed to get initial sync token');
      }

      pageToken = response.data.nextPageToken;
    }
  }

  // syncToken으로 변경된 이벤트 조회 (웹훅 수신 후 사용)
  // 410 Gone 시 getInitialSyncToken으로 fallback → { events: [], nextSyncToken }
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
      // syncToken 만료 (410 Gone) → 전체 재동기화
      if (error.code === 410) {
        const newToken = await this.getInitialSyncToken(calendarId);
        return { events: [], nextSyncToken: newToken };
      }
      throw error;
    }
  }

  // 최근 변경된 이벤트 조회 (레거시 — syncToken 없는 경우 fallback용)
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

  // 특정 기간의 이벤트 전체 조회 (동기화용)
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

  // 단일 이벤트 조회 (디바운스 발송 시점에 최신 상태 확인용)
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

  // ========== 반복 일정 (서비스 계정 기반) ==========

  // 서비스 계정으로 이벤트 생성 (groupId extendedProperties 포함)
  async createEventAsServiceAccount(
    calendarId: string,
    params: {
      summary: string;
      startDateTime: string; // ISO8601
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
        extendedProperties: {
          private: { groupId: params.groupId },
        },
      },
    });

    if (!response.data.id) {
      throw new Error('Failed to create calendar event');
    }

    return response.data.id;
  }

  // groupId로 이벤트 목록 조회 (전체 삭제/수정용)
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

  // 서비스 계정으로 이벤트 삭제
  async deleteEventAsServiceAccount(
    calendarId: string,
    eventId: string,
  ): Promise<void> {
    const calendar = this.getCalendarClient();
    await calendar.events.delete({ calendarId, eventId, sendUpdates: 'none' });
  }

  // 서비스 계정으로 이벤트 수정 (patch: undefined 필드는 변경 안 함)
  async updateEventAsServiceAccount(
    calendarId: string,
    eventId: string,
    params: {
      summary?: string;
      description?: string;
      location?: string;
      startDateTime?: string; // ISO8601
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

  // 서비스 계정으로 이벤트의 private extendedProperties 일부 패치
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
      requestBody: {
        extendedProperties: { private: privateProps },
      },
    });
  }

  // extendedProperties.private 필터로 이벤트 검색 (미러 이벤트 추적용)
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

  // 특정 기간의 미러 이벤트 전체 조회 (mirroredBy=gsc-bot 필터)
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

  // 서비스 계정으로 미러 이벤트 생성 (extendedProperties 포함)
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
    if (!response.data.id) {
      throw new Error('Failed to create mirror calendar event');
    }
    return response.data.id;
  }

  // 서비스 계정으로 미러 이벤트 수정 (extendedProperties 포함)
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

  // ========== 스터디룸 예약 ==========

  // 이벤트 생성 (참석자 포함, 메일 발송 없음)
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
        end: {
          dateTime: params.endTime.toISOString(),
          timeZone: 'Asia/Seoul',
        },
        attendees: params.attendeeEmails?.map((email) => ({ email })),
      },
    });

    if (!response.data.id) {
      throw new Error('Failed to create calendar event');
    }

    return response.data.id;
  }

  // FreeBusy API로 시간대 사용 여부 확인
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

  // 특정 사용자가 참석자인 이벤트 목록 조회 (여러 캘린더, 서비스 계정 사용)
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

        const events = response.data.items ?? [];
        for (const event of events) {
          const isAttendee = event.attendees?.some(
            (a) => a.email === userEmail,
          );
          if (isAttendee) {
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

  // 이벤트 삭제
  async deleteEvent(
    calendarId: string,
    refreshToken: string,
    eventId: string,
  ): Promise<void> {
    const calendar = this.getUserCalendarClient(refreshToken);
    await calendar.events.delete({ calendarId, eventId, sendUpdates: 'none' });
  }

  // 이벤트 수정 (부분 업데이트)
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
    if (params.startTime !== undefined) {
      requestBody.start = {
        dateTime: params.startTime.toISOString(),
        timeZone: 'Asia/Seoul',
      };
    }
    if (params.endTime !== undefined) {
      requestBody.end = {
        dateTime: params.endTime.toISOString(),
        timeZone: 'Asia/Seoul',
      };
    }
    if (params.attendeeEmails !== undefined) {
      requestBody.attendees = params.attendeeEmails.map((email) => ({ email }));
    }

    await calendar.events.update({
      calendarId,
      eventId,
      sendUpdates: 'none',
      requestBody,
    });
  }

  // 사용자 캘린더 목록에서 캘린더 제거
  async removeCalendarFromUserList(
    calendarId: string,
    userRefreshToken: string,
  ): Promise<void> {
    const calendar = this.getUserCalendarClient(userRefreshToken);

    try {
      await calendar.calendarList.delete({ calendarId });
    } catch (error: unknown) {
      const err = error as { code?: number };
      // 이미 제거된 경우 (404) 무시
      if (err.code === 404) {
        return;
      }
      throw error;
    }
  }

  async getUserCalendarIds(userRefreshToken: string): Promise<Set<string>> {
    const calendar = this.getUserCalendarClient(userRefreshToken);
    const ids = new Set<string>();
    let pageToken: string | undefined;

    do {
      const res = await calendar.calendarList.list({
        maxResults: 250,
        pageToken,
      });
      for (const item of res.data.items ?? []) {
        if (item.id) ids.add(item.id);
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return ids;
  }
}
