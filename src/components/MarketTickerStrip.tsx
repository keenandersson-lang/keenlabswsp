import { useCallback, useEffect, useMemo, useState } from 'react';

type TickerItem = {
  key: string;
  label: string;
  price: number;
  changePercent: number | null;
};

const YAHOO_TICKERS = [
  { key: 'sp500', label: 'S&P 500', symbol: 'SPY' },
  { key: 'nasdaq', label: 'NASDAQ', symbol: 'QQQ' },
  { key: 'omx30', label: 'OMX30', symbol: '^OMX' },
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

async function fetchYahooTicker(symbol: string) {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  if (!response.ok) throw new Error(`Failed to load ${symbol}`);

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta;

  const price = meta?.regularMarketPrice;
  const previousClose = meta?.chartPreviousClose ?? meta?.previousClose;

  if (typeof price !== 'number') {
    throw new Error(`No price returned for ${symbol}`);
  }

  const changePercent = typeof previousClose === 'number' && previousClose !== 0
    ? ((price - previousClose) / previousClose) * 100
    : null;

  return { price, changePercent };
}

export function MarketTickerStrip() {
  const [items, setItems] = useState<TickerItem[]>([]);

  const fetchTickerData = useCallback(async () => {
    const yahooResults = await Promise.all(
      YAHOO_TICKERS.map(async (ticker) => {
        const data = await fetchYahooTicker(ticker.symbol);
        return {
          key: ticker.key,
          label: ticker.label,
          price: data.price,
          changePercent: data.changePercent,
        } satisfies TickerItem;
      }),
    );

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

    setItems([...yahooResults, ...cryptoResults].filter((item) => Number.isFinite(item.price)));
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
