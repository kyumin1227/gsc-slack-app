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

export class GoogleCalendarUtil {
  private static getAuth() {
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

  private static getCalendarClient(): calendar_v3.Calendar {
    const auth = this.getAuth();
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
}
