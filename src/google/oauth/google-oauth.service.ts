import { Injectable } from '@nestjs/common';

export interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture: string;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface OAuthState {
  slackUserId: string;
  timestamp: number;
}

@Injectable()
export class GoogleOAuthService {
  getGoogleAuthUrl(state: string): string {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const scopes = [
      'email',
      'profile',
      'https://www.googleapis.com/auth/calendar',
    ];
    const scope = encodeURIComponent(scopes.join(' '));

    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}&access_type=offline&prompt=consent`;
  }

  async exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? '',
        grant_type: 'authorization_code',
      }),
    });

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        grant_type: 'refresh_token',
      }),
    });

    const data = await response.json();
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    };
  }

  async getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    return response.json();
  }

  parseOAuthState(state: string): OAuthState {
    const decoded = Buffer.from(state, 'base64').toString('utf-8');
    return JSON.parse(decoded) as OAuthState;
  }

  createOAuthState(slackUserId: string): string {
    return Buffer.from(
      JSON.stringify({
        slackUserId,
        timestamp: Date.now(),
      }),
    ).toString('base64');
  }
}
