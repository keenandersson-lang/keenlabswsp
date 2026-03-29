import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

type TickerItem = {
  key: string;
  label: string;
  price: number;
  changePercent: number | null;
};

const MARKET_TICKERS = [
  { key: 'sp500', label: 'S&P 500', symbol: 'SPY' },
  { key: 'nasdaq', label: 'NASDAQ', symbol: 'QQQ' },
  { key: 'gold', label: 'Gold', symbol: 'GC=F' },
  { key: 'silver', label: 'Silver', symbol: 'SI=F' },
] as const;

const CRYPTO_TICKERS = [
  { key: 'bitcoin', label: 'Bitcoin', id: 'bitcoin' },
  { key: 'ethereum', label: 'Ethereum', id: 'ethereum' },
  { key: 'solana', label: 'Solana', id: 'solana' },
] as const;

const formatPrice = (value: number) =>
  value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value >= 1000 ? 0 : 2,
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  });

const formatChange = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return 'N/A';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

async function fetchMarketTickersFromFmp() {
  const response = await fetch(
    'https://financialmodelingprep.com/api/v3/quote/SPY,QQQ,GC=F,SI=F?apikey=demo',
  );
  if (!response.ok) {
    throw new Error('Failed to load FMP ticker feed');
  }

  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('FMP returned no ticker data');
  }

  const rowsBySymbol = new Map<string, any>();
  for (const row of payload) {
    if (row && typeof row.symbol === 'string') {
      rowsBySymbol.set(row.symbol, row);
    }
  }

  return MARKET_TICKERS.map((ticker) => {
    const row = rowsBySymbol.get(ticker.symbol);
    const price = Number(row?.price);
    const changePercent = typeof row?.changesPercentage === 'number'
      ? Number(row.changesPercentage)
      : (Number.isFinite(Number(row?.change)) && Number.isFinite(Number(row?.previousClose)) && Number(row.previousClose) !== 0
        ? (Number(row.change) / Number(row.previousClose)) * 100
        : null);

    if (!Number.isFinite(price)) {
      throw new Error(`FMP row missing price for ${ticker.symbol}`);
    }

    return {
      key: ticker.key,
      label: ticker.label,
      price,
      changePercent: typeof changePercent === 'number' && Number.isFinite(changePercent) ? changePercent : null,
    } satisfies TickerItem;
  });
}

async function fetchMarketTickersFromSupabaseFallback() {
  const { data: latestDateRows, error: latestDateError } = await (supabase as any)
    .from('wsp_indicators')
    .select('calc_date')
    .order('calc_date', { ascending: false })
    .limit(1);

  if (latestDateError) throw new Error(latestDateError.message);
  const latestDate = latestDateRows?.[0]?.calc_date;
  if (!latestDate) throw new Error('No calc_date available in wsp_indicators');

  const { data, error } = await (supabase as any)
    .from('wsp_indicators')
    .select('symbol, close, pct_change_1d')
    .in('symbol', ['SPY', 'QQQ', 'GLD', 'SLV'])
    .eq('calc_date', latestDate);

  if (error) throw new Error(error.message);

  const rowsBySymbol = new Map<string, any>();
  for (const row of data ?? []) {
    if (row && typeof row.symbol === 'string') {
      rowsBySymbol.set(row.symbol, row);
    }
  }

  const fallbackMap: Record<string, string> = {
    SPY: 'SPY',
    QQQ: 'QQQ',
    'GC=F': 'GLD',
    'SI=F': 'SLV',
  };

  return MARKET_TICKERS.map((ticker) => {
    const fallbackSymbol = fallbackMap[ticker.symbol];
    const row = rowsBySymbol.get(fallbackSymbol);
    const price = Number(row?.close);
    const changePercent = Number(row?.pct_change_1d);
    if (!Number.isFinite(price)) {
      throw new Error(`Fallback row missing close for ${fallbackSymbol}`);
    }

    return {
      key: ticker.key,
      label: ticker.label,
      price,
      changePercent: Number.isFinite(changePercent) ? changePercent : null,
    } satisfies TickerItem;
  });
}

export function MarketTickerStrip() {
  const [items, setItems] = useState<TickerItem[]>([]);

  const fetchTickerData = useCallback(async () => {
    let marketResults: TickerItem[];
    try {
      marketResults = await fetchMarketTickersFromFmp();
    } catch {
      marketResults = await fetchMarketTickersFromSupabaseFallback();
    }

    const cryptoResponse = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true',
    );
    if (!cryptoResponse.ok) throw new Error('Failed to load crypto prices');

    const cryptoPayload = await cryptoResponse.json();
    const cryptoResults = CRYPTO_TICKERS.map((ticker) => ({
      key: ticker.key,
      label: ticker.label,
      price: Number(cryptoPayload?.[ticker.id]?.usd),
      changePercent:
        typeof cryptoPayload?.[ticker.id]?.usd_24h_change === 'number'
          ? Number(cryptoPayload[ticker.id].usd_24h_change)
          : null,
    } satisfies TickerItem));

    setItems([...marketResults, ...cryptoResults].filter((item) => Number.isFinite(item.price)));
  }, []);

  useEffect(() => {
    fetchTickerData().catch(() => {
      setItems([]);
    });

    const interval = window.setInterval(() => {
      fetchTickerData().catch(() => {
        setItems((prev) => prev);
      });
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [fetchTickerData]);

  const scrollingItems = useMemo(() => {
    if (items.length === 0) {
      return (
        <span className="px-4 text-[11px] text-muted-foreground font-mono tracking-wide">
          Loading market data...
        </span>
      );
    }

    const loop = [...items, ...items];
    return loop.map((item, index) => {
      const positive = item.changePercent !== null && item.changePercent >= 0;
      const negative = item.changePercent !== null && item.changePercent < 0;

      return (
        <div key={`${item.key}-${index}`} className="inline-flex items-center gap-2 px-4">
          <span className="text-[11px] uppercase tracking-wide text-foreground/90">{item.label}</span>
          <span className="text-[11px] font-semibold text-foreground">{formatPrice(item.price)}</span>
          <span className={`text-[11px] font-semibold ${positive ? 'text-signal-buy' : negative ? 'text-signal-sell' : 'text-muted-foreground'}`}>
            {formatChange(item.changePercent)}
          </span>
        </div>
      );
    });
  }, [items]);

  return (
    <div className="h-10 max-h-10 overflow-hidden border-b border-border bg-sidebar/95">
      <div className="market-ticker-track inline-flex h-full min-w-full items-center whitespace-nowrap">
        {scrollingItems}
      </div>
    </div>
  );
}
