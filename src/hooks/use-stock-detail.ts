import { useQuery } from '@tanstack/react-query';
import type { StockDetailApiResponse } from '@/lib/chart-types';
import { sanitizeClientErrorMessage } from '@/lib/safe-messages';

function buildDetailUrl(symbol: string): string {
  // In production, use the Supabase edge function
  if (import.meta.env.DEV) {
    return `/api/wsp-symbol-detail?symbol=${encodeURIComponent(symbol)}`;
  }
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (supabaseUrl) {
    return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/wsp-symbol-detail?symbol=${encodeURIComponent(symbol)}`;
  }
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  if (projectId) {
    return `https://${projectId}.supabase.co/functions/v1/wsp-symbol-detail?symbol=${encodeURIComponent(symbol)}`;
  }
  return `/api/wsp-symbol-detail?symbol=${encodeURIComponent(symbol)}`;
}

function buildHeaders(): Record<string, string> {
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!anonKey) return {};
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
  };
}

async function safeFetchStockDetail(symbol: string): Promise<StockDetailApiResponse> {
  const url = buildDetailUrl(symbol);
  const headers = import.meta.env.DEV ? {} : buildHeaders();

  const response = await fetch(url, { headers });
  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    const text = await response.text().catch(() => '');
    return {
      ok: false,
      data: null,
      error: {
        code: 'NON_JSON_RESPONSE',
        message: sanitizeClientErrorMessage(`Expected JSON but received ${contentType || 'unknown'} (${response.status}). ${text.slice(0, 120)}`),
      },
    };
  }

  try {
    return await response.json() as StockDetailApiResponse;
  } catch {
    return {
      ok: false,
      data: null,
      error: { code: 'JSON_PARSE_ERROR', message: sanitizeClientErrorMessage('Server response could not be parsed.') },
    };
  }
}

export function useStockDetail(symbol: string | undefined) {
  return useQuery({
    queryKey: ['stock-detail', symbol],
    queryFn: () => safeFetchStockDetail(symbol ?? ''),
    enabled: Boolean(symbol),
    staleTime: 60_000,
    retry: 1,
  });
}
