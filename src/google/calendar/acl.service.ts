import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { GoogleCalendarBaseService } from './base.service';

export interface CalendarAclEntry {
  email: string;
  role: 'reader' | 'writer' | 'owner';
}

export interface ShareCalendarOptions {
  calendarId: string;
  email: string;
  role: 'reader' | 'writer' | 'owner';
}

@Injectable()
export class GoogleAclService extends GoogleCalendarBaseService {
  private readonly ACL_CACHE_KEY = (id: string) => `google:acl:${id}`;
  private readonly ACL_TTL_MS = 15 * 60 * 1000;

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {
    super();
  }

  async shareCalendar(options: ShareCalendarOptions): Promise<void> {
    const calendar = this.getCalendarClient();
    await calendar.acl.insert({
      calendarId: options.calendarId,
      requestBody: {
        role: options.role,
        scope: { type: 'user', value: options.email },
      },
    });
    await this.cache.del(this.ACL_CACHE_KEY(options.calendarId));
  }

  async unshareCalendar(calendarId: string, email: string): Promise<void> {
    const calendar = this.getCalendarClient();
    const ruleId = `user:${email}`;
    try {
      await calendar.acl.delete({ calendarId, ruleId });
    } catch (error: any) {
      if (error.code === 404) {
        await this.cache.del(this.ACL_CACHE_KEY(calendarId));
        return;
      }
      throw error;
    }
    await this.cache.del(this.ACL_CACHE_KEY(calendarId));
  }

  async makeCalendarPublic(calendarId: string): Promise<void> {
    const calendar = this.getCalendarClient();
    await calendar.acl.insert({
      calendarId,
      requestBody: {
        role: 'reader',
        scope: { type: 'default' },
      },
    });
  }

  // Redis 15분 캐싱
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
}
