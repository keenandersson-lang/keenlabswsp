import { useQuery } from '@tanstack/react-query';
import type { StockDetailApiResponse } from '@/lib/chart-types';

async function safeFetchStockDetail(symbol: string): Promise<StockDetailApiResponse> {
  const response = await fetch(`/api/wsp-symbol-detail?symbol=${encodeURIComponent(symbol)}`);
  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    const text = await response.text().catch(() => '');
    return {
      ok: false,
      data: null,
      error: {
        code: 'NON_JSON_RESPONSE',
        message: `Expected JSON but received ${contentType || 'unknown'} (${response.status}). ${text.slice(0, 120)}`,
      },
    };
  }

  try {
    return await response.json() as StockDetailApiResponse;
  } catch {
    return {
      ok: false,
      data: null,
      error: { code: 'JSON_PARSE_ERROR', message: 'Server response could not be parsed.' },
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
