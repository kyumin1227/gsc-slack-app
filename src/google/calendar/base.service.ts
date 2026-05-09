import { google, calendar_v3 } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

export abstract class GoogleCalendarBaseService {
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
}
