const SECRET_PATTERNS: RegExp[] = [
  /FINNHUB_API_KEY/gi,
  /token\s*=\s*[^\s&]+/gi,
  /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._-]+/gi,
  /apikey\s*[=:]\s*[A-Za-z0-9._-]+/gi,
  /https?:\/\/[^\s]+/gi,
  /stack\s*trace/gi,
];

function scrubSecrets(input: string): string {
  return SECRET_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, '[redacted]'), input);
}

export function sanitizeClientErrorMessage(raw: unknown, fallback = 'Market data temporarily unavailable.'): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;

  const cleaned = scrubSecrets(raw).trim();

  if (/auth|unauthorized|forbidden|invalid api key|api key|credential|token/i.test(cleaned)) {
    return 'Provider authentication failed. Check server configuration.';
  }

  if (/network|timeout|fetch|temporarily|unavailable|failed/i.test(cleaned)) {
    return 'Market data temporarily unavailable.';
  }

  if (/fallback|demo|stale/i.test(cleaned)) {
    return 'Live provider unavailable. Demo mode active.';
  }

  return fallback;
}

export function sanitizeProviderNotice(uiState: 'LIVE' | 'STALE' | 'FALLBACK' | 'ERROR', raw?: string | null): string {
  if (uiState === 'LIVE') return 'Live provider connected.';
  if (uiState === 'STALE') return 'Live provider unavailable. Showing latest safe snapshot.';
  if (uiState === 'FALLBACK') return 'Live provider unavailable. Demo mode active.';
  return sanitizeClientErrorMessage(raw, 'Market data temporarily unavailable.');
}
