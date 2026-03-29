// WSP Symbol Detail Edge Function — reads from daily_prices cache
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APPROVED_LIVE_COHORT_STATUSES = ['tier1_default', 'approved_for_live_scanner'];

interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function aggregateBarsWeekly(dailyBars: Bar[]): Bar[] {
  if (dailyBars.length === 0) return [];
  const weeks: Bar[] = [];
  let currentWeek: { key: string; bars: Bar[] } | null = null;
  for (const bar of dailyBars) {
    const d = new Date(`${bar.date}T00:00:00Z`);
    const weekday = (d.getUTCDay() + 6) % 7;
    const weekStart = new Date(d);
    weekStart.setUTCDate(d.getUTCDate() - weekday);
    const key = weekStart.toISOString().slice(0, 10);
    if (!currentWeek || currentWeek.key !== key) {
      if (currentWeek) weeks.push(combineWeek(currentWeek.bars));
      currentWeek = { key, bars: [bar] };
    } else {
      currentWeek.bars.push(bar);
    }
  }
  if (currentWeek) weeks.push(combineWeek(currentWeek.bars));
  return weeks;
}

function combineWeek(bars: Bar[]): Bar {
  const first = bars[0], last = bars[bars.length - 1];
  return {
    date: last.date,
    open: first.open,
    high: Math.max(...bars.map(b => b.high)),
    low: Math.min(...bars.map(b => b.low)),
    close: last.close,
    volume: bars.reduce((s, b) => s + b.volume, 0),
  };
}

async function fetchBarsFromCache(supabase: any, symbol: string, limit = 756): Promise<Bar[]> {
  const allBars: Bar[] = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('daily_prices')
      .select('date, open, high, low, close, volume')
      .eq('symbol', symbol)
      .order('date', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error(`Cache read error for ${symbol}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;

    allBars.push(...data.map((r: any) => ({
      date: r.date,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    })));

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return allBars.slice(-limit);
}

async function fetchSearchableSymbolMeta(supabase: any, symbol: string) {
  const { data } = await supabase
    .from('symbols')
    .select('name, company_name, sector, industry, exchange, asset_class, instrument_type, is_active, is_etf, is_adr, support_level')
    .eq('symbol', symbol)
    .maybeSingle();
  return data;
}

function isActiveSymbol(meta: any): boolean {
  if (!meta) return false;
  return meta.is_active !== false;
}

function inferMetadataCompleteness(meta: any): 'complete' | 'partial' | 'missing' {
  if (!meta) return 'missing';
  const fields = [meta.sector, meta.industry, meta.exchange].filter(Boolean);
  if (fields.length === 3) return 'complete';
  if (fields.length > 0) return 'partial';
  return 'missing';
}

async function isApprovedLiveCohort(supabase: any, symbol: string): Promise<boolean> {
  const { data } = await supabase
    .from('market_scan_results_latest')
    .select('symbol, promotion_status')
    .eq('symbol', symbol)
    .in('promotion_status', APPROVED_LIVE_COHORT_STATUSES)
    .limit(1)
    .maybeSingle();

  return Boolean(data?.symbol);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase().trim();

    if (!symbol) {
      return json(400, { ok: false, data: null, error: { code: 'MISSING_SYMBOL', message: 'Query param "symbol" is required.' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const benchmarkSymbol = 'SPY';
    const [stockBars, benchmarkBars, symbolMeta, approvedLive] = await Promise.all([
      fetchBarsFromCache(supabase, symbol),
      fetchBarsFromCache(supabase, benchmarkSymbol),
      fetchSearchableSymbolMeta(supabase, symbol),
      isApprovedLiveCohort(supabase, symbol),
    ]);

    if (!isActiveSymbol(symbolMeta)) {
      return json(404, {
        ok: false,
        data: null,
        error: { code: 'SYMBOL_NOT_ACTIVE', message: `${symbol} is not an active symbol.` },
      });
    }

    if (stockBars.length === 0) {
      return json(200, {
        ok: false,
        data: null,
        error: { code: 'NO_CACHED_DATA', message: `No price data available for ${symbol}.` },
      });
    }

    const assetClass = symbolMeta?.asset_class === 'metals'
      ? 'metals'
      : symbolMeta?.asset_class === 'commodity'
      ? 'commodity'
      : 'equity';

    const hasFullSupport = assetClass === 'equity' && symbolMeta?.sector && symbolMeta?.industry;

    return json(200, {
      ok: true,
      data: {
        symbol,
        name: symbolMeta?.company_name ?? symbolMeta?.name ?? symbol,
        sector: symbolMeta?.sector ?? 'Unknown',
        industry: symbolMeta?.industry ?? 'Unknown',
        exchange: symbolMeta?.exchange ?? undefined,
        assetClass,
        supportsFullWsp: Boolean(hasFullSupport),
        wspSupport: hasFullSupport ? 'full' : 'limited',
        supportLevel: symbolMeta?.support_level ?? null,
        isApprovedLiveCohort: approvedLive,
        metadataCompleteness: inferMetadataCompleteness(symbolMeta),
        barsDaily: stockBars,
        barsWeekly: aggregateBarsWeekly(stockBars),
        benchmarkDaily: benchmarkBars,
        benchmarkWeekly: aggregateBarsWeekly(benchmarkBars),
        fetchedAt: new Date().toISOString(),
      },
      error: null,
    });
  } catch (err) {
    console.error('wsp-symbol-detail error:', err);
    return json(500, {
      ok: false,
      data: null,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch symbol detail.' },
    });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
