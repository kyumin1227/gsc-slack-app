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

export class GoogleCalendarUtil {
  // Service Account 인증 (캘린더 생성/관리용)
  private static getServiceAccountAuth() {
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
  private static getUserAuth(refreshToken: string) {
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

  private static getCalendarClient(): calendar_v3.Calendar {
    const auth = this.getServiceAccountAuth();
    return google.calendar({ version: 'v3', auth });
  }

  private static getUserCalendarClient(
    refreshToken: string,
  ): calendar_v3.Calendar {
    const auth = this.getUserAuth(refreshToken);
    return google.calendar({ version: 'v3', auth });
  }

  // 캘린더 생성
  static async createCalendar(
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
  static async deleteCalendar(calendarId: string): Promise<void> {
    const calendar = this.getCalendarClient();
    await calendar.calendars.delete({ calendarId });
  }

  // 캘린더 공유 (유저에게 권한 부여)
  static async shareCalendar(options: ShareCalendarOptions): Promise<void> {
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
  }

  // 캘린더 공유 제거 (권한 삭제)
  static async unshareCalendar(
    calendarId: string,
    email: string,
  ): Promise<void> {
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
        return;
      }
      throw error;
    }
  }

  // 캘린더 공개 설정 (읽기 전용)
  static async makeCalendarPublic(calendarId: string): Promise<void> {
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
  static async getCalendar(
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
  static async updateCalendar(
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

  // 캘린더 ACL 조회 (권한 목록)
  static async getCalendarAcl(calendarId: string): Promise<CalendarAclEntry[]> {
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
  static async addCalendarToUserList(
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

  static isWatchConfigured(): boolean {
    return !!process.env.GOOGLE_WEBHOOK_URL;
  }

  // 캘린더 이벤트 변경 watch 등록
  static async watchCalendarEvents(
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
  static async stopCalendarWatch(
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

  // 최근 변경된 이벤트 조회 (웹훅 수신 후 상세 조회용)
  static async getRecentChangedEvents(
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

  // 사용자 캘린더 목록에서 캘린더 제거
  static async removeCalendarFromUserList(
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
}
