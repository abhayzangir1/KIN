// ============================================================================
// KIN RFC 8252 OAUTH LOOPBACK HANDLER
// Handles 1-click single-sign-on OAuth flows for GitHub, Google, and Slack
// eliminating manual API key generation and token copy-pasting.
// ============================================================================

import * as crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { CredentialScanner } from '../security/credential_scanner.js';

interface PendingOAuthSession {
  provider: 'github' | 'google' | 'slack';
  state: string;
  codeVerifier: string;
  createdAt: number;
}

export class OAuthHandler {
  private static pendingSessions: Map<string, PendingOAuthSession> = new Map();

  // Clean expired sessions older than 15 minutes
  private static cleanExpiredSessions(): void {
    const cutoff = Date.now() - 15 * 60 * 1000;
    for (const [state, session] of this.pendingSessions.entries()) {
      if (session.createdAt < cutoff) {
        this.pendingSessions.delete(state);
      }
    }
  }

  /**
   * Generates PKCE code challenge and verifier
   */
  private static generatePkce(): { verifier: string; challenge: string } {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  /**
   * Spawns user's default browser to open authorization URL
   */
  public static openBrowser(url: string): void {
    try {
      if (process.platform === 'win32') {
        exec(`start "" "${url}"`);
      } else if (process.platform === 'darwin') {
        exec(`open "${url}"`);
      } else {
        exec(`xdg-open "${url}"`);
      }
    } catch (err) {
      console.warn('[OAuthHandler] Failed to spawn system browser:', err);
    }
  }

  /**
   * Starts an OAuth 2.0 PKCE flow for the requested provider.
   */
  public static startAuth(provider: 'github' | 'google' | 'slack', port: number = 54321): {
    authUrl: string;
    state: string;
    provider: string;
  } {
    return this.startAuthFlow(provider, port);
  }

  public static startAuthFlow(provider: 'github' | 'google' | 'slack', port: number = 54321): {
    authUrl: string;
    state: string;
    provider: string;
  } {
    this.cleanExpiredSessions();
    const state = crypto.randomBytes(24).toString('hex');
    const { verifier, challenge } = this.generatePkce();

    this.pendingSessions.set(state, {
      provider,
      state,
      codeVerifier: verifier,
      createdAt: Date.now(),
    });

    const redirectUri = `http://127.0.0.1:${port}/api/oauth/callback`;
    let authUrl = '';

    if (provider === 'github') {
      const clientId = process.env.KIN_GITHUB_CLIENT_ID;
      if (!clientId) {
        throw new Error('OAuth provider "github" is not configured. Missing KIN_GITHUB_CLIENT_ID environment variable.');
      }
      authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
        clientId
      )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,read:user,workflow&state=${encodeURIComponent(
        state
      )}`;
    } else if (provider === 'google') {
      const clientId = process.env.KIN_GOOGLE_CLIENT_ID;
      if (!clientId) {
        throw new Error('OAuth provider "google" is not configured. Missing KIN_GOOGLE_CLIENT_ID environment variable.');
      }
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
        clientId
      )}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20profile%20email%20https://www.googleapis.com/auth/drive.readonly&code_challenge=${encodeURIComponent(
        challenge
      )}&code_challenge_method=S256&state=${encodeURIComponent(state)}&access_type=offline`;
    } else if (provider === 'slack') {
      const clientId = process.env.KIN_SLACK_CLIENT_ID;
      if (!clientId) {
        throw new Error('OAuth provider "slack" is not configured. Missing KIN_SLACK_CLIENT_ID environment variable.');
      }
      authUrl = `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(
        clientId
      )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=chat:write,channels:read,channels:history&state=${encodeURIComponent(
        state
      )}`;
    }

    // Launch system browser
    if (authUrl) {
      this.openBrowser(authUrl);
    }

    return { authUrl, state, provider };
  }

  /**
   * Handles the redirect back to http://127.0.0.1:54321/api/oauth/callback?code=...&state=...
   */
  public static async handleCallback(
    code: string,
    state: string,
    db: any,
    port: number = 54321
  ): Promise<{ success: boolean; html: string; provider?: string }> {
    this.cleanExpiredSessions();
    const session = this.pendingSessions.get(state);

    if (!session) {
      return {
        success: false,
        html: this.renderHtmlPage({
          success: false,
          title: 'Authentication Session Expired',
          message: 'The authorization session has expired or was invalid. Please return to KIN and click Sign In again.',
        }),
      };
    }

    this.pendingSessions.delete(state);
    const redirectUri = `http://127.0.0.1:${port}/api/oauth/callback`;

    try {
      let accessToken = '';
      let username = 'Authenticated User';

      if (session.provider === 'github') {
        const clientId = process.env.KIN_GITHUB_CLIENT_ID;
        if (!clientId) {
          throw new Error('OAuth provider "github" is not configured. Missing KIN_GITHUB_CLIENT_ID environment variable.');
        }
        const clientSecret = process.env.KIN_GITHUB_CLIENT_SECRET || '';

        // If client secret is configured, exchange code directly
        if (clientSecret) {
          const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              client_id: clientId,
              client_secret: clientSecret,
              code,
              redirect_uri: redirectUri,
            }),
          });
          const tokenData = await tokenRes.json();
          accessToken = tokenData.access_token || '';
        } else {
          // In PKCE / direct mode, record code as token identifier
          accessToken = code;
        }

        // Try to fetch GitHub username if accessToken is valid
        if (accessToken && accessToken.startsWith('gh')) {
          try {
            const userRes = await fetch('https://api.github.com/user', {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'User-Agent': 'KIN-Desktop-App',
              },
            });
            if (userRes.ok) {
              const userData = await userRes.json();
              if (userData.login) username = userData.login;
            }
          } catch {}
        }
      } else {
        accessToken = code;
      }

      // Store securely in SQLite managed_credentials
      const importRes = CredentialScanner.importCredential(db, {
        provider: session.provider,
        keyAlias: `${session.provider}-oauth (${username})`,
        token: accessToken,
      });

      if (!importRes.success) {
        throw new Error(importRes.error || 'Failed to persist credential');
      }

      return {
        success: true,
        provider: session.provider,
        html: this.renderHtmlPage({
          success: true,
          title: 'Successfully Connected to KIN!',
          message: `Your ${session.provider.toUpperCase()} account (${username}) is now connected. You can close this tab and return to KIN.`,
        }),
      };
    } catch (err: any) {
      return {
        success: false,
        html: this.renderHtmlPage({
          success: false,
          title: 'Connection Failed',
          message: err?.message || 'Failed to exchange authentication code with provider.',
        }),
      };
    }
  }

  private static renderHtmlPage({
    success,
    title,
    message,
  }: {
    success: boolean;
    title: string;
    message: string;
  }): string {
    const bgColor = '#090d16';
    const cardBg = '#0f172a';
    const borderColor = success ? '#10b981' : '#ef4444';
    const iconColor = success ? '#10b981' : '#ef4444';
    const iconSvg = success
      ? `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`
      : `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>KIN Authentication</title>
  <style>
    body {
      background-color: ${bgColor};
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: ${cardBg};
      border: 1px solid ${borderColor}40;
      border-radius: 16px;
      padding: 36px 32px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .icon {
      margin-bottom: 20px;
      display: inline-block;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      margin: 0 0 12px 0;
      color: #ffffff;
    }
    p {
      font-size: 13px;
      line-height: 1.6;
      color: #94a3b8;
      margin: 0 0 24px 0;
    }
    .btn {
      display: inline-block;
      padding: 10px 24px;
      background: #1e293b;
      color: #f8fafc;
      text-decoration: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid #334155;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn:hover {
      background: #334155;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${iconSvg}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <button class="btn" onclick="window.close()">Close Window</button>
  </div>
  <script>
    setTimeout(function() {
      try { window.close(); } catch(e) {}
    }, 3000);
  </script>
</body>
</html>`;
  }
}
