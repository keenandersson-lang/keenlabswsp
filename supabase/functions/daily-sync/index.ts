import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const POLYGON_KEY = Deno.env.get('POLYGON_API_KEY')!

// Tier 1 symbols always synced
const TIER1_SYMBOLS = [
  'SPY','QQQ','DIA','IWM',
  'XLK','XLV','XLF','XLE','XLY','XLI','XLC','XLP','XLB','XLRE','XLU',
  'AAPL','MSFT','NVDA','AVGO','AMD','ORCL','CRM',
  'GOOGL','META','NFLX','DIS','TMUS','VZ',
  'AMZN','TSLA','HD','MCD','NKE','BKNG',
  'COST','WMT','PG','KO','PEP','PM',
  'JPM','BAC','WFC','V','MA',
  'LLY','UNH','JNJ','ABBV','MRK','ISRG',
  'CAT','BA','GE','HON','UPS','DE',
  'XOM','CVX','COP','SLB','EOG',
  'LIN','APD','ECL','NUE','DD',
  'PLD','AMT','EQIX','O',
  'NEE','SO','DUK','SRE',
  'GLD','SLV','COPX','GDX','NEM','FCX','PPLT',
]

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${Deno.env.get('SYNC_SECRET_KEY')}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const targetDate = getLastTradingDay()

  // Use Tier 1 symbols + any additional active symbols from DB
  const symbols = await selectDailySyncSymbols()

  if (symbols.length === 0) {
    return jsonRes({ ok: false, error: 'No symbols found for daily sync.', date: targetDate })
  }

  const { data: logRow } = await supabase
    .from('data_sync_log')
    .insert({
      sync_type: 'daily',
      status: 'running',
      data_source: 'polygon',
      metadata: { symbols_total: symbols.length, target_date: targetDate },
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  let symbolsFetched = 0
  let symbolsFailed = 0
  let rowsWritten = 0
  let indicatorMaterialization: Record<string, unknown> | null = null
  const skipReasons: Record<string, number> = {}

  try {
    // Use Polygon grouped daily endpoint — one API call for ALL symbols
    const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${targetDate}?adjusted=true&apiKey=${POLYGON_KEY}`
    const res = await fetch(url)

    if (!res.ok) throw new Error(`Polygon grouped endpoint: ${res.status}`)

    const data = await res.json()

    if (!Array.isArray(data.results) || data.results.length === 0) {
      skipReasons['empty_grouped_response'] = 1
    } else {
      const polygonMap: Record<string, any> = {}
      for (const r of data.results) polygonMap[r.T] = r

      const upserts: any[] = []
      for (const symbol of symbols) {
        const r = polygonMap[symbol]
        if (!r) {
          symbolsFailed++
          skipReasons['missing_from_polygon'] = (skipReasons['missing_from_polygon'] ?? 0) + 1
          continue
        }
        upserts.push({
          symbol,
          date: targetDate,
          open: r.o,
          high: r.h,
          low: r.l,
          close: r.c,
          volume: Math.round(r.v),
          data_source: 'polygon',
          has_full_volume: true,
        })
        symbolsFetched++
      }

      if (upserts.length > 0) {
        const batches = chunkArray(upserts, 500)
        for (const batch of batches) {
          const { error: upsertErr, count } = await supabase
            .from('daily_prices')
            .upsert(batch, { onConflict: 'symbol,date', ignoreDuplicates: false, count: 'exact' })
          if (upsertErr) {
            console.error('Daily prices upsert error:', upsertErr.message)
            symbolsFailed += batch.length
          } else {
            rowsWritten += count ?? 0
          }
        }
      }
    }
  } catch (err) {
    console.error('Daily sync error:', err)
    symbolsFailed = symbols.length
    skipReasons['grouped_endpoint_fetch_failed'] = 1
  }

  const { data: materializationData, error: materializationError } = await supabase.rpc('materialize_wsp_indicators_from_prices', {
    p_symbols: symbols,
    p_as_of_date: targetDate,
    p_min_bars: 200,
  })

  if (materializationError) {
    indicatorMaterialization = { ok: false, error: materializationError.message }
    console.error('Indicator materialization failed:', materializationError.message)
  } else {
    indicatorMaterialization = { ok: true, ...(materializationData as Record<string, unknown>) }
  }

  await supabase
    .from('data_sync_log')
    .update({
      status: symbolsFailed === 0 ? 'success' : 'partial',
      symbols_processed: symbolsFetched,
      symbols_failed: symbolsFailed,
      completed_at: new Date().toISOString(),
      metadata: {
        symbols_total: symbols.length,
        symbols_fetched: symbolsFetched,
        rows_written: rowsWritten,
        target_date: targetDate,
        skip_reasons: skipReasons,
        indicator_materialization: indicatorMaterialization,
      },
    })
    .eq('id', logRow?.id)

  return jsonRes({
    ok: true,
    date: targetDate,
    symbolsTotal: symbols.length,
    symbolsFetched,
    symbolsFailed,
    rowsWritten,
    skipReasons,
    indicatorMaterialization,
  })
})

async function selectDailySyncSymbols(): Promise<string[]> {
  // Start with Tier 1
  const symbolSet = new Set(TIER1_SYMBOLS)

  // Add any active symbols that already have price data (they were previously backfilled)
  const allSymbols: string[] = []
  let from = 0
  while (true) {
    const { data: page } = await supabase
      .from('symbols')
      .select('symbol')
      .eq('is_active', true)
      .order('symbol')
      .range(from, from + 999)

    if (!page || page.length === 0) break
    for (const r of page) {
      const sym = String(r.symbol ?? '').toUpperCase().trim()
      if (sym.length > 0 && sym.length <= 5) symbolSet.add(sym)
    }
    if (page.length < 1000) break
    from += 1000
  }

  return Array.from(symbolSet)
}

function getLastTradingDay(): string {
  const now = new Date()
  const et = new Date(now.getTime() - 5 * 60 * 60 * 1000)
  const day = et.getDay()
  if (day === 0) et.setDate(et.getDate() - 2)
  else if (day === 6) et.setDate(et.getDate() - 1)
  else et.setDate(et.getDate() - 1)
  return et.toISOString().slice(0, 10)
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, (i + 1) * size)
  )
}

function jsonRes(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
