import { useQuery } from '@tanstack/react-query';
import type { ScreenerApiResponse } from '@/lib/wsp-types';
import { WSP_CONFIG } from '@/lib/wsp-config';

export async function fetchWspScreenerData(options?: { intervalMs?: number; forceRefresh?: boolean }): Promise<ScreenerApiResponse> {
  const params = new URLSearchParams();
  if (options?.intervalMs) params.set('intervalMs', String(options.intervalMs));
  if (options?.forceRefresh) params.set('forceRefresh', '1');

  const response = await fetch(`/api/wsp-screener${params.size > 0 ? `?${params.toString()}` : ''}`);
  const payload = await response.json() as ScreenerApiResponse;

  if (!response.ok && !payload?.providerStatus) {
    throw new Error('Failed to load WSP screener data');
  }

  return payload;
}

export function useWspScreener(intervalMs: number = WSP_CONFIG.refreshInterval) {
  return useQuery({
    queryKey: ['wsp-screener', intervalMs],
    queryFn: () => fetchWspScreenerData({ intervalMs }),
    refetchInterval: intervalMs,
    staleTime: Math.max(15_000, intervalMs / 2),
    retry: false,
  });
}
