import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { WSP_CONFIG } from '../src/lib/wsp-config';
import { TRACKED_SYMBOLS } from '../src/lib/tracked-symbols';
import { normalizeBarsChronologically } from '../src/lib/wsp-indicators';
import { aggregateBarsWeekly } from '../src/lib/charting';
import type { StockDetailApiResponse } from '../src/lib/chart-types';
import { sanitizeClientErrorMessage } from '../src/lib/safe-messages';
import { BENCHMARK_LOOKUP } from '../src/lib/benchmarks';
import { createMarketDataProvider } from './market-data-provider';

const MAX_HISTORY_BARS = 756;

export async function handleWspSymbolDetailRequest(req: IncomingMessage, res: ServerResponse) {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const symbol = requestUrl.searchParams.get('symbol')?.toUpperCase().trim();

  if (!symbol) {
    return sendJson(res, 400, { ok: false, data: null, error: { code: 'MISSING_SYMBOL', message: 'Query param "symbol" is required.' } } satisfies StockDetailApiResponse);
  }

  const meta = TRACKED_SYMBOLS.find((item) => item.symbol === symbol);
  const benchmarkMeta = BENCHMARK_LOOKUP[symbol];
  if (!meta && !benchmarkMeta) {
    return sendJson(res, 404, { ok: false, data: null, error: { code: 'UNKNOWN_SYMBOL', message: `${symbol} is not configured in TRACKED_SYMBOLS.` } } satisfies StockDetailApiResponse);
  }

  const providerSelection = createMarketDataProvider();
  if (!providerSelection.envVarPresent) {
    return sendJson(res, 503, { ok: false, data: null, error: { code: 'MISSING_API_KEY', message: 'Provider authentication failed. Check server configuration.' } } satisfies StockDetailApiResponse);
  }

  try {
    const provider = providerSelection.provider;
    const [stockDailyResult, benchmarkDailyResult] = await Promise.all([
      provider.fetchDailyHistory(symbol),
      provider.fetchDailyHistory(WSP_CONFIG.benchmark),
    ]);

    const barsDaily = normalizeBarsChronologically(stockDailyResult.bars).bars.slice(-MAX_HISTORY_BARS);
    const benchmarkDaily = normalizeBarsChronologically(benchmarkDailyResult.bars).bars.slice(-MAX_HISTORY_BARS);

    const payload: StockDetailApiResponse = {
      ok: true,
      data: {
        symbol,
        name: meta?.name ?? benchmarkMeta.name,
        sector: meta?.sector ?? 'Benchmarks',
        industry: meta?.industry ?? 'Market Index ETF',
        barsDaily,
        barsWeekly: aggregateBarsWeekly(barsDaily),
        benchmarkDaily,
        benchmarkWeekly: aggregateBarsWeekly(benchmarkDaily),
        fetchedAt: new Date().toISOString(),
      },
      error: null,
    };

    return sendJson(res, 200, payload);
  } catch (error) {
    const message = sanitizeClientErrorMessage(error instanceof Error ? error.message : 'Failed to fetch symbol detail');
    return sendJson(res, 500, { ok: false, data: null, error: { code: 'DETAIL_FETCH_FAILED', message } } satisfies StockDetailApiResponse);
  }
}

function sendJson(res: ServerResponse, statusCode: number, payload: StockDetailApiResponse) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}
