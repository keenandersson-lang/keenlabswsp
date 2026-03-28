import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { WSP_CONFIG } from '../src/lib/wsp-config';
import { normalizeBarsChronologically } from '../src/lib/wsp-indicators';
import { aggregateBarsWeekly } from '../src/lib/charting';
import type { StockDetailApiResponse } from '../src/lib/chart-types';
import { sanitizeClientErrorMessage } from '../src/lib/safe-messages';
import { BENCHMARK_LOOKUP } from '../src/lib/benchmarks';
import { createMarketDataProvider } from './market-data-provider';

const MAX_HISTORY_BARS = 756;

function inferMetadataCompleteness(meta: {
  sector?: string;
  industry?: string;
  exchange?: string;
} | null): 'complete' | 'partial' | 'missing' {
  if (!meta) return 'missing';
  const fields = [meta.sector, meta.industry, meta.exchange].filter(Boolean);
  if (fields.length === 3) return 'complete';
  if (fields.length > 0) return 'partial';
  return 'missing';
}

export async function handleWspSymbolDetailRequest(req: IncomingMessage, res: ServerResponse) {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const symbol = requestUrl.searchParams.get('symbol')?.toUpperCase().trim();

  if (!symbol) {
    return sendJson(res, 400, { ok: false, data: null, error: { code: 'MISSING_SYMBOL', message: 'Query param "symbol" is required.' } } satisfies StockDetailApiResponse);
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

    if (barsDaily.length === 0) {
      return sendJson(res, 200, {
        ok: false,
        data: null,
        error: { code: 'NO_PRICE_HISTORY', message: `No price data available for ${symbol}.` },
      } satisfies StockDetailApiResponse);
    }

    const benchmarkMeta = BENCHMARK_LOOKUP[symbol];
    const inferredMeta = benchmarkMeta
      ? { name: benchmarkMeta.name, sector: 'Benchmarks', industry: 'Market Index ETF', exchange: undefined }
      : { name: symbol, sector: 'Unknown', industry: 'Unknown', exchange: undefined };

    const payload: StockDetailApiResponse = {
      ok: true,
      data: {
        symbol,
        name: inferredMeta.name,
        sector: inferredMeta.sector,
        industry: inferredMeta.industry,
        exchange: inferredMeta.exchange,
        assetClass: benchmarkMeta ? 'commodity' : 'equity',
        supportsFullWsp: false,
        wspSupport: 'limited',
        supportLevel: null,
        isApprovedLiveCohort: false,
        metadataCompleteness: inferMetadataCompleteness(inferredMeta),
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
