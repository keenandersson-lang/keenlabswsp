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

type SymbolSelection = {
  symbols: string[]
  selectedFrom: 'eligible_for_backfill' | 'active_fallback'
  eligibleCount: number
  activeCount: number
}

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
  const selection = await selectDailySyncSymbols()
  const symbols = selection.symbols

  if (symbols.length === 0) {
    return jsonRes({
      ok: false,
      error: 'No active symbols found for daily sync.',
      date: targetDate,
      symbolsSelected: 0,
      symbolsSkipped: 0,
      skipReasons: {
        no_active_symbols: 1,
      },
      selection,
    })
  }

  const { data: logRow } = await supabase
    .from('data_sync_log')
    .insert({
      sync_type: 'daily',
      status: 'running',
      data_source: 'polygon',
      metadata: {
        symbols_total: symbols.length,
        target_date: targetDate,
        symbol_selection: selection,
      },
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  let symbolsFetched = 0
  let symbolsFailed = 0
  let rowsFetched = 0
  let rowsAttempted = 0
  let rowsWritten = 0
  let symbolsSkipped = 0
  const skipReasons: Record<string, number> = {}

  const addSkipReason = (reason: string, count = 1) => {
    symbolsSkipped += count
    skipReasons[reason] = (skipReasons[reason] ?? 0) + count
  }

  try {
    const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${targetDate}?adjusted=true&apiKey=${POLYGON_KEY}`
    const res = await fetch(url)

    if (!res.ok) {
      throw new Error(`Polygon grouped endpoint: ${res.status}`)
    }

    const data = await res.json()

    if (!Array.isArray(data.results) || data.results.length === 0) {
      addSkipReason('empty_grouped_response')
    } else {
      const polygonMap: Record<string, any> = {}
      for (const r of data.results) {
        polygonMap[r.T] = r
      }

      const upserts: any[] = []
      for (const symbol of symbols) {
        const r = polygonMap[symbol]
        if (!r) {
          symbolsFailed++
          addSkipReason('missing_from_polygon_grouped_response')
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

      rowsFetched = upserts.length
      rowsAttempted = upserts.length

      if (upserts.length > 0) {
        const batches = chunkArray(upserts, 500)
        for (const batch of batches) {
          const { error: upsertErr, count } = await supabase
            .from('daily_prices')
            .upsert(batch, {
              onConflict: 'symbol,date',
              ignoreDuplicates: false,
              count: 'exact',
            })
          if (upsertErr) {
            console.error('Daily prices upsert error:', upsertErr.message, upsertErr.details, upsertErr.hint)
            symbolsFailed += batch.length
            addSkipReason('daily_prices_upsert_error', batch.length)
          } else {
            rowsWritten += count ?? 0
            console.log(`Upserted batch of ${batch.length} daily prices`) 
          }
        }
      }
    }

    // NOTE: WSP indicator calculation moved to a separate pass
    // to avoid edge function timeout. The backfill must complete first.
    console.log(`Daily sync complete: selected=${symbols.length} rowsFetched=${rowsFetched} rowsAttempted=${rowsAttempted} rowsWritten=${rowsWritten} symbolsSkipped=${symbolsSkipped}`)
  } catch (err) {
    console.error('Daily sync error:', err)
    symbolsFailed = symbols.length
    addSkipReason('grouped_endpoint_fetch_failed')
  }

  let broadScanRunId: number | null = null
  let broadScanError: string | null = null
  try {
    const { data: scanRunId, error: scanErr } = await supabase.rpc('run_broad_market_scan', {
      p_as_of_date: targetDate,
      p_run_label: 'daily_sync',
    })
    if (scanErr) {
      broadScanError = scanErr.message
      console.error('Broad market scan RPC error:', scanErr)
    } else {
      broadScanRunId = scanRunId ?? null
    }
  } catch (scanRuntimeErr) {
    broadScanError = scanRuntimeErr instanceof Error ? scanRuntimeErr.message : String(scanRuntimeErr)
    console.error('Broad market scan runtime error:', scanRuntimeErr)
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
        symbols_selected: symbols.length,
        symbols_fetched: symbolsFetched,
        symbols_skipped: symbolsSkipped,
        skip_reasons: skipReasons,
        rows_fetched: rowsFetched,
        rows_attempted: rowsAttempted,
        rows_written: rowsWritten,
        target_date: targetDate,
        symbol_selection: selection,
        broad_scan_run_id: broadScanRunId,
        broad_scan_error: broadScanError,
      },
    })
    .eq('id', logRow?.id)

  return jsonRes({
    ok: true,
    date: targetDate,
    symbolsSelected: symbols.length,
    symbolsFetched,
    symbolsFailed,
    symbolsSkipped,
    skipReasons: skipReasons,
    rowsFetched,
    rowsAttempted,
    rowsWritten,
    selection,
    broadScanRunId,
    broadScanError,
  })
})

async function selectDailySyncSymbols(): Promise<SymbolSelection> {
  const eligibleSymbols = await fetchSymbols({ eligibleOnly: true })
  if (eligibleSymbols.length > 0) {
    return {
      symbols: eligibleSymbols,
      selectedFrom: 'eligible_for_backfill',
      eligibleCount: eligibleSymbols.length,
      activeCount: eligibleSymbols.length,
    }
  }

  const activeSymbols = await fetchSymbols({ eligibleOnly: false })
  return {
    symbols: activeSymbols,
    selectedFrom: 'active_fallback',
    eligibleCount: 0,
    activeCount: activeSymbols.length,
  }
}

async function fetchSymbols({ eligibleOnly }: { eligibleOnly: boolean }): Promise<string[]> {
  const allSymbols: string[] = []
  let from = 0
  while (true) {
    let query = supabase
      .from('symbols')
      .select('symbol')
      .eq('is_active', true)

    if (eligibleOnly) {
      query = query.eq('eligible_for_backfill', true)
    }

    const { data: page } = await query.order('symbol').range(from, from + 999)

    if (!page || page.length === 0) break

    allSymbols.push(
      ...page
        .map((r: any) => String(r.symbol ?? '').toUpperCase().trim())
        .filter((symbol: string) => symbol.length > 0 && symbol.length <= 8)
    )

    if (page.length < 1000) break
    from += 1000
  }

  return Array.from(new Set(allSymbols))
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
