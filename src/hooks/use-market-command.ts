import { useQuery } from '@tanstack/react-query';
import { WSP_CONFIG } from '@/lib/wsp-config';
import { fetchMarketCommandSnapshot, type MarketCommandSnapshotRequest } from '@/features/market-command/snapshot';

export function useMarketCommand(request: MarketCommandSnapshotRequest = {}) {
  const intervalMs = request.intervalMs ?? WSP_CONFIG.refreshInterval;

  return useQuery({
    queryKey: [
      'market-command',
      intervalMs,
      request.page ?? 0,
      request.pageSize ?? null,
      request.forceRefresh ?? false,
      request.sector ?? null,
      request.industry ?? null,
      request.symbol ?? null,
    ],
    queryFn: () => fetchMarketCommandSnapshot({ ...request, intervalMs }),
    refetchInterval: intervalMs,
    staleTime: Math.max(15_000, intervalMs / 2),
    retry: 1,
  });
}
