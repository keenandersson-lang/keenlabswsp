// WSP Symbol Detail Edge Function — reads from daily_prices cache (Tier 1 source of truth)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  // daily_prices may have >1000 rows, use pagination
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
    if (error) { console.error(`Cache read error for ${symbol}:`, error.message); break; }
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
  // Return last `limit` bars
  return allBars.slice(-limit);
}

async function fetchSymbolMeta(supabase: any, symbol: string) {
  const { data } = await supabase
    .from('symbols')
    .select('name, company_name, sector, industry, exchange, asset_class, instrument_type, is_etf, support_level')
    .eq('symbol', symbol)
    .maybeSingle();
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase().trim();

    if (!symbol) {
      return json(400, { ok: false, data: null, error: { code: 'MISSING_SYMBOL', message: 'Query param "symbol" is required.' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch bars for the symbol and benchmark (SPY) in parallel
    const benchmarkSymbol = 'SPY';
    const [stockBars, benchmarkBars, symbolMeta] = await Promise.all([
      fetchBarsFromCache(supabase, symbol),
      fetchBarsFromCache(supabase, benchmarkSymbol),
      fetchSymbolMeta(supabase, symbol),
    ]);

    const allowedSupportLevels = new Set(['full_wsp_equity', 'limited_equity', 'sector_benchmark_proxy', 'metals_limited'])

    if (symbolMeta?.support_level && !allowedSupportLevels.has(symbolMeta.support_level)) {
      return json(403, {
        ok: false,
        data: null,
        error: { code: 'SYMBOL_NOT_PROMOTED', message: `${symbol} is not promoted for visible WSP product flows.` },
      });
    }

    if (stockBars.length === 0) {
      return json(200, {
        ok: false,
        data: null,
        error: { code: 'NO_CACHED_DATA', message: `No price data available for ${symbol}. Run Tier 1 backfill first.` },
      });
    }

    // Determine asset class from meta or symbol heuristics
    const isBenchmark = symbol === 'SPY' || symbol === 'QQQ';
    const isEtf = symbolMeta?.is_etf === true;
    const assetClass = symbolMeta?.asset_class === 'metals' ? 'metals'
      : symbolMeta?.asset_class === 'commodity' ? 'commodity' : 'equity';

    // Determine WSP support level
    const hasFullSupport = assetClass === 'equity' && !isEtf && !isBenchmark &&
      symbolMeta?.sector && symbolMeta?.industry;

    const payload = {
      ok: true,
      data: {
        symbol,
        name: symbolMeta?.company_name ?? symbolMeta?.name ?? symbol,
        sector: symbolMeta?.sector ?? (isBenchmark ? 'Benchmarks' : 'Unknown'),
        industry: symbolMeta?.industry ?? (isBenchmark ? 'Market Index ETF' : 'Unknown'),
        exchange: symbolMeta?.exchange ?? undefined,
        assetClass,
        supportsFullWsp: hasFullSupport,
        wspSupport: hasFullSupport ? 'full' : 'limited',
        barsDaily: stockBars,
        barsWeekly: aggregateBarsWeekly(stockBars),
        benchmarkDaily: benchmarkBars,
        benchmarkWeekly: aggregateBarsWeekly(benchmarkBars),
        fetchedAt: new Date().toISOString(),
      },
      error: null,
    };

    return json(200, payload);
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
