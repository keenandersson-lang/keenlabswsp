import { createClient } from 'npm:@supabase/supabase-js@2'

const NASDAQ_CSV_URL = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&offset=0&download=true'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

type NasdaqRow = {
  Symbol?: string
  Sector?: string
  Industry?: string
  [key: string]: string | undefined
}

function parseCsv(text: string): NasdaqRow[] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentCell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]

    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        currentCell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && ch === ',') {
      currentRow.push(currentCell)
      currentCell = ''
      continue
    }

    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      currentRow.push(currentCell)
      rows.push(currentRow)
      currentRow = []
      currentCell = ''
      continue
    }

    currentCell += ch
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell)
    rows.push(currentRow)
  }

  if (rows.length === 0) return []

  const headers = rows[0].map((value) => value.trim())
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .map((row) => {
      const entry: NasdaqRow = {}
      headers.forEach((header, index) => {
        entry[header] = (row[index] ?? '').trim()
      })
      return entry
    })
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

  const summary = { updated: 0, skipped: 0, errors: 0 }

  try {
    const response = await fetch(NASDAQ_CSV_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; supabase-edge-function/1.0)',
        Accept: 'text/csv,application/json;q=0.9,*/*;q=0.8',
        Referer: 'https://www.nasdaq.com/',
      },
    })

    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'Failed to download NASDAQ CSV', status: response.status }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const csv = await response.text()
    const rows = parseCsv(csv)

    for (const row of rows) {
      const symbol = row.Symbol?.trim().toUpperCase()
      const sector = row.Sector?.trim()
      const industry = row.Industry?.trim() ?? ''

      if (!symbol || !sector) {
        summary.skipped += 1
        continue
      }

      const { data, error } = await supabase
        .from('symbols')
        .update({
          canonical_sector: sector,
          canonical_industry: industry || null,
          classification_confidence_level: 'medium',
          classification_status: 'canonicalized',
        })
        .eq('symbol', symbol)
        .or('canonical_sector.is.null,canonical_sector.eq.Unknown,canonical_sector.eq.')
        .select('symbol')

      if (error) {
        summary.errors += 1
        continue
      }

      if (data && data.length > 0) {
        summary.updated += data.length
      } else {
        summary.skipped += 1
      }
    }

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (_error) {
    return new Response(JSON.stringify({ error: 'Unexpected failure', ...summary }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
