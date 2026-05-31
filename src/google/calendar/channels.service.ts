import { Injectable } from '@nestjs/common';
import { GoogleCalendarBaseService } from './base.service';
import { GoogleApiLimiter } from '../google-api-limiter.service';
import { AppMetrics } from '../../common/metrics/app.metrics';

@Injectable()
export class GoogleChannelsService extends GoogleCalendarBaseService {
  constructor(limiter: GoogleApiLimiter, appMetrics: AppMetrics) {
    super(limiter, appMetrics);
  }

  isWatchConfigured(): boolean {
    return !!process.env.GOOGLE_WEBHOOK_URL;
  }

  async watchCalendarEvents(
    calendarId: string,
    channelId: string,
  ): Promise<{ resourceId: string }> {
    const callbackUrl = `${process.env.GOOGLE_WEBHOOK_URL}/google/calendar/webhook`;
    const watchDurationMs = 7 * 24 * 60 * 60 * 1000;
    const calendar = this.getCalendarClient();

    const response = await this.callApi('watchCalendarEvents', () =>
      calendar.events.watch({
        calendarId,
        requestBody: {
          id: channelId,
          type: 'web_hook',
          address: callbackUrl,
          expiration: String(Date.now() + watchDurationMs),
        },
      }),
    );

    if (!response.data.resourceId) {
      throw new Error(
        'Failed to register calendar watch: no resourceId returned',
      );
    }

    return { resourceId: response.data.resourceId };
  }

  async stopCalendarWatch(
    channelId: string,
    resourceId: string,
  ): Promise<void> {
    const calendar = this.getCalendarClient();
    try {
      await this.callApi('stopCalendarWatch', () =>
        calendar.channels.stop({
          requestBody: { id: channelId, resourceId },
        }),
      );
    } catch (error: any) {
      if (error.code === 404 || error.code === 400) return;
      throw error;
    }
  }
}
