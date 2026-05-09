import { Injectable } from '@nestjs/common';
import { GoogleCalendarBaseService } from './base.service';

@Injectable()
export class GoogleCalendarListService extends GoogleCalendarBaseService {
  async addCalendarToUserList(
    calendarId: string,
    userRefreshToken: string,
  ): Promise<void> {
    const calendar = this.getUserCalendarClient(userRefreshToken);
    try {
      await calendar.calendarList.insert({ requestBody: { id: calendarId } });
    } catch (error: unknown) {
      const err = error as { code?: number };
      if (err.code === 409) return; // 이미 추가된 경우 무시
      throw error;
    }
  }

  async removeCalendarFromUserList(
    calendarId: string,
    userRefreshToken: string,
  ): Promise<void> {
    const calendar = this.getUserCalendarClient(userRefreshToken);
    try {
      await calendar.calendarList.delete({ calendarId });
    } catch (error: unknown) {
      const err = error as { code?: number };
      if (err.code === 404) return; // 이미 제거된 경우 무시
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
