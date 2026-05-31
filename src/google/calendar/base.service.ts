import { Injectable } from '@nestjs/common';
import { google, calendar_v3 } from 'googleapis';
import { GaxiosError } from 'gaxios';
import { GoogleApiLimiter } from '../google-api-limiter.service';
import { AppMetrics } from '../../common/metrics/app.metrics';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

// 사용자 액션은 크론보다 높은 우선순위
export const API_PRIORITY = {
  USER: 5,
  CRON: 9,
} as const;

@Injectable()
export abstract class GoogleCalendarBaseService {
  constructor(
    protected readonly limiter: GoogleApiLimiter,
    protected readonly appMetrics: AppMetrics,
  ) {}

  protected getServiceAccountAuth() {
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

    return new google.auth.JWT({ email, key: privateKey, scopes: SCOPES });
  }

  protected getUserAuth(refreshToken: string) {
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

  protected getCalendarClient(): calendar_v3.Calendar {
    return google.calendar({
      version: 'v3',
      auth: this.getServiceAccountAuth(),
    });
  }

  protected getUserCalendarClient(refreshToken: string): calendar_v3.Calendar {
    return google.calendar({
      version: 'v3',
      auth: this.getUserAuth(refreshToken),
    });
  }

  protected async withRetry<T>(
    fn: () => Promise<T>,
    operation: string,
    maxRetries = 3,
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof GaxiosError)) throw err;

        const status = err.response?.status;
        const isRetryable = status === 429 || status === 500 || status === 503;

        if (!isRetryable || attempt === maxRetries) throw err;

        if (status === 429) {
          this.appMetrics.googleApiRateLimitTotal.inc({ operation });
        }
        this.appMetrics.googleApiRetryTotal.inc({ operation });

        const retryAfterHeader = err.response?.headers['retry-after'];
        const delayMs = retryAfterHeader
          ? parseInt(retryAfterHeader as string, 10) * 1000
          : 1000 * 2 ** attempt; // 1s → 2s → 4s

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw new Error('unreachable');
  }

  protected async callApi<T>(
    operation: string,
    fn: () => Promise<T>,
    priority: number = API_PRIORITY.USER,
  ): Promise<T> {
    this.appMetrics.googleApiRequestsTotal.inc({ operation });
    return this.limiter.schedule({ priority }, () =>
      this.withRetry(fn, operation).catch((err) => {
        this.appMetrics.googleApiErrorsTotal.inc({ operation });
        throw err;
      }),
    );
  }
}
