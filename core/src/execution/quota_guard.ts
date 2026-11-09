// ============================================================================
// KIN 429 QUOTA GUARD & EXPONENTIAL JITTER BACKOFF
// RFC-compliant retry-after parsing, non-destructive pause, and full jitter.
// Aligned with PRD § 8 and TRD § 7.
// ============================================================================

export class QuotaGuard {
  /**
   * Parses the Retry-After HTTP header value.
   * Supports both integer seconds (e.g. "120") and RFC 7231 HTTP-Date (e.g. "Wed, 21 Oct 2026 07:28:00 GMT").
   */
  public static parseRetryAfter(header: string | null | undefined): number | undefined {
    if (!header || typeof header !== 'string') return undefined;
    const trimmed = header.trim();
    const asNum = parseInt(trimmed, 10);
    if (!isNaN(asNum) && asNum >= 0 && /^\d+$/.test(trimmed)) {
      return asNum;
    }
    // Parse RFC 7231 HTTP-Date
    const parsedDate = Date.parse(trimmed);
    if (!isNaN(parsedDate)) {
      const diffSec = Math.max(1, Math.ceil((parsedDate - Date.now()) / 1000));
      return diffSec;
    }
    return undefined;
  }

  /**
   * Computes randomized exponential backoff with full jitter to prevent thundering herd.
   */
  public static computeExponentialJitterBackoff(
    retryCount: number,
    instructedSec?: number,
    baseMs: number = 1500,
    maxMs: number = 60000
  ): number {
    if (instructedSec !== undefined && instructedSec > 0) {
      // Add 10-25% random jitter to instructed delay
      const baseDelay = instructedSec * 1000;
      const jitter = baseDelay * (0.1 + Math.random() * 0.15);
      return Math.min(maxMs, baseDelay + jitter);
    }
    // Full jitter: Math.random() * (base * 2^retry)
    const exponential = Math.min(maxMs, baseMs * Math.pow(2, retryCount));
    return Math.floor(Math.random() * exponential) + Math.floor(baseMs / 2);
  }

  /**
   * Evaluates if an error is an HTTP 429 or quota limit exhaustion.
   */
  public static isQuotaError(errorText: string, status?: number): boolean {
    if (status === 429) return true;
    if (!errorText) return false;
    const lower = errorText.toLowerCase();
    return (
      lower.includes('429') ||
      lower.includes('rate limit') ||
      lower.includes('rate_limit') ||
      lower.includes('quota') ||
      lower.includes('resource_exhausted') ||
      lower.includes('tokens per minute') ||
      lower.includes('tpm') ||
      lower.includes('rpm') ||
      lower.includes('insufficient_quota')
    );
  }
}
