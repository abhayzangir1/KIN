// ============================================================================
// KIN FINANCIAL SAFETY SHIELD & HUMAN AUTHORIZATION PROTOCOL
// Zero-trust financial gates, sensitive credential scrubbing, and interactive
// human authorization protocols for protected logins, MFA, and commerce actions.
// ============================================================================

import { RiskLevel } from '../domain/types.js';

export interface FinancialCheckResult {
  isFinancialAction: boolean;
  isDestructiveAction: boolean;
  requiresHardStop: boolean;
  riskLevel: RiskLevel;
  reasons: string[];
}

export interface AuthProtocolCheckResult {
  requiresUserAuth: boolean;
  authType?: 'login' | 'mfa' | 'captcha' | 'oauth_sso' | 'payment_authorization';
  promptInstructions?: string;
}

export class FinancialSafetyShield {
  // Financial operation keywords and patterns
  private static readonly FINANCIAL_PATTERNS = [
    /\b(checkout|buy|purchase|payment|pay\s+now|place\s+order|order\s+now)\b/i,
    /(credit[\s_-]*card|debit[\s_-]*card|card[\s_-]*number|cvv|cvc|exp[\s_-]*date)/i,
    /\b(stripe|paypal|venmo|cashapp|apple\s*pay|google\s*pay|razorpay|plaid)\b/i,
    /\b(wire\s*transfer|bank\s*transfer|transfer\s*funds|send\s*money|crypto|bitcoin|ethereum|wallet|solana|usdc|usdt)\b/i,
    /\b(billing\s*info|invoice\s*payment|subscription\s*upgrade|charge\s*card|refund|payout)\b/i,
    /\b(financial|funds\s*transfer|make\s*payment|authorize\s*transaction|execute\s*trade|stock\s*purchase)\b/i,
  ];

  // Destructive system/storage operation keywords
  private static readonly DESTRUCTIVE_PATTERNS = [
    /\b(format\s+[a-z]:|fdisk|mkfs|diskpart|del\s+\/f\s+\/s\s+\/q\s+[a-z]:\\|rm\s+-rf\s+\/(?:\s|$))/i,
    /\b(reg\s+delete\s+hklm|regedit\s+\/s|drop\s+database|drop\s+table|truncate\s+table)\b/i,
  ];

  // Sensitive login / authentication patterns
  private static readonly AUTH_PATTERNS = [
    /\b(login|sign\s*in|log\s*in|authenticate|enter\s*password)\b/i,
    /\b(captcha|recaptcha|hcaptcha|cloudflare\s*turnstile|verify\s*you\s*are\s*human)\b/i,
    /\b(two-factor|2fa|mfa|one-time\s*password|otp|authenticator\s*code|sms\s*code)\b/i,
    /\b(sso|oauth|continue\s*with\s*google|sign\s*in\s*with\s*apple|okta)\b/i,
  ];

  /**
   * Assesses an action for financial and destructive risk.
   * Hard financial gates CANNOT be bypassed under any autonomy mode (including FULL_ACCESS).
   */
  public evaluateFinancialRisk(toolName: string, params: Record<string, any>): FinancialCheckResult {
    const serialized = JSON.stringify(params || {}).toLowerCase();
    const commandText = (params?.command || params?.url || params?.selector || params?.text || '').toLowerCase();
    const fullText = `${toolName} ${serialized} ${commandText}`;

    const reasons: string[] = [];
    let isFinancial = false;
    let isDestructive = false;

    // Check financial patterns
    for (const pat of FinancialSafetyShield.FINANCIAL_PATTERNS) {
      if (pat.test(fullText)) {
        isFinancial = true;
        reasons.push(`Financial transaction trigger detected: matched pattern '${pat.source}'`);
        break;
      }
    }

    // Check destructive patterns
    for (const pat of FinancialSafetyShield.DESTRUCTIVE_PATTERNS) {
      if (pat.test(fullText)) {
        isDestructive = true;
        reasons.push(`Destructive system operation detected: matched pattern '${pat.source}'`);
        break;
      }
    }

    const requiresHardStop = isFinancial || isDestructive;
    const riskLevel: RiskLevel = requiresHardStop ? 'CRITICAL' : 'LOW';

    return {
      isFinancialAction: isFinancial,
      isDestructiveAction: isDestructive,
      requiresHardStop,
      riskLevel,
      reasons,
    };
  }

  /**
   * Assesses if a web inspection or page state requires pausing for Human Authorization.
   */
  public checkAuthProtocolRequirement(pageUrl: string, pageTextSnippet: string): AuthProtocolCheckResult {
    const combined = `${pageUrl} ${pageTextSnippet}`.toLowerCase();

    // 1. CAPTCHA / Bot check
    if (/captcha|cloudflare|turnstile|verify\s*you\s*are\s*human|bot\s*detection/i.test(combined)) {
      return {
        requiresUserAuth: true,
        authType: 'captcha',
        promptInstructions: 'A bot verification / CAPTCHA challenge was detected. Human takeover required to complete the verification challenge.',
      };
    }

    // 2. 2FA / MFA / OTP
    if (/two-factor|2fa|mfa|authenticator|enter\s*code|sms\s*verification|otp/i.test(combined)) {
      return {
        requiresUserAuth: true,
        authType: 'mfa',
        promptInstructions: 'Two-factor authentication (MFA/OTP) required. Please approve the prompt on your device or enter the security code.',
      };
    }

    // 3. Login / Sign In
    if (/sign\s*in|log\s*in|login\s*to\s*your\s*account|password/i.test(combined) && !/welcome\s*back,\s*\w+/i.test(combined)) {
      return {
        requiresUserAuth: true,
        authType: 'login',
        promptInstructions: 'Protected authentication boundary encountered. Please sign into your account in the browser session. Credentials will remain safely in the browser profile.',
      };
    }

    // 4. Payment authorization
    if (/enter\s*payment|confirm\s*purchase|cvv|card\s*number|billing\s*address/i.test(combined)) {
      return {
        requiresUserAuth: true,
        authType: 'payment_authorization',
        promptInstructions: 'Real-world commerce checkout encountered. Human authorization required before any payment or transaction is finalized.',
      };
    }

    return { requiresUserAuth: false };
  }

  /**
   * Redacts payment details, credentials, and authentication tokens from strings
   * ensuring that private sensitive values are never logged or fed to LLM context.
   */
  public scrubSensitiveContext(content: string): string {
    if (!content) return '';

    return (
      content
        // Credit card numbers (13-19 digits with optional dashes/spaces)
        .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED_CARD_NUMBER]')
        // CVV / CVC (3-4 digits following keywords)
        .replace(/(cvv|cvc|security\s*code)[\s:=]+(\d{3,4})\b/gi, '$1: [REDACTED_CVV]')
        // Expiration dates (MM/YY or MM/YYYY)
        .replace(/(exp|expires|expiry)[\s:=]+(\d{1,2}\/\d{2,4})\b/gi, '$1: [REDACTED_EXP]')
        // Passwords and API keys
        .replace(/(password|passwd|api[_-]?key|secret|token)[\s:=]+(["']?[a-zA-Z0-9_\-.~+]{8,}["']?)/gi, '$1: "[REDACTED_SECRET]"')
        // Private keys
        .replace(/-----BEGIN[ A-Z0-9_-]+PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]+PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    );
  }
}
