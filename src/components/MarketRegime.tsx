import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Bitcoin, CircleDollarSign, Coins, Minus, Shield, TrendingDown, TrendingUp } from 'lucide-react';
import type { MarketOverview } from '@/lib/wsp-types';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

interface MarketRegimeProps {
  market: MarketOverview;
}

type RegimeState = 'bullish' | 'neutral' | 'bearish';

type MetalIndicator = {
  symbol: 'GLD' | 'SLV';
  close: number | null;
  ma50: number | null;
};

type CryptoIndicator = {
  id: 'bitcoin' | 'ethereum' | 'solana';
  symbol: 'BTC' | 'ETH' | 'SOL';
  price: number | null;
  change24h: number | null;
};

const wspRegimeConfig = {
  bullish: {
    label: 'BULLISH',
    icon: TrendingUp,
    colorClass: 'text-signal-buy',
    bgClass: 'bg-signal-buy/8',
    borderClass: 'border-signal-buy/25',
    guidance: 'Aggressive long setups favored. WSP breakout entries are high-probability.',
    context: 'Both benchmarks trading above rising 50MA with 50MA > 200MA.',
  },
  bearish: {
    label: 'BEARISH',
    icon: TrendingDown,
    colorClass: 'text-signal-sell',
    bgClass: 'bg-signal-sell/8',
    borderClass: 'border-signal-sell/25',
    guidance: 'Protect capital. Avoid breakout exposure. Reduce sizing.',
    context: 'Both benchmarks below key moving averages — broad weakness.',
  },
  neutral: {
    label: 'NEUTRAL',
    icon: Minus,
    colorClass: 'text-signal-caution',
    bgClass: 'bg-signal-caution/8',
    borderClass: 'border-signal-caution/25',
    guidance: 'Selective. Only highest-quality setups with strong volume.',
    context: 'Mixed signals — one index strong, other weak.',
  },
} as const;

const metalTheme = {
  bullish: { colorClass: 'text-amber-600', bgClass: 'bg-amber-500/10', borderClass: 'border-amber-500/30' },
  neutral: { colorClass: 'text-amber-500', bgClass: 'bg-amber-500/8', borderClass: 'border-amber-400/30' },
  bearish: { colorClass: 'text-amber-700', bgClass: 'bg-amber-900/15', borderClass: 'border-amber-700/30' },
} as const;

const cryptoTheme = {
  bullish: { colorClass: 'text-violet-400', bgClass: 'bg-violet-500/10', borderClass: 'border-violet-500/30' },
  neutral: { colorClass: 'text-violet-300', bgClass: 'bg-violet-500/8', borderClass: 'border-violet-400/30' },
  bearish: { colorClass: 'text-fuchsia-300', bgClass: 'bg-fuchsia-500/10', borderClass: 'border-fuchsia-500/30' },
} as const;

const disclaimerText = 'Metals/Crypto analysis is indicative only — WSP logic applies to US equities exclusively';

const formatUsd = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value >= 1000 ? 0 : 2,
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  });
};

export function MarketRegime({ market }: MarketRegimeProps) {
  const [metals, setMetals] = useState<MetalIndicator[]>([]);
  const [crypto, setCrypto] = useState<CryptoIndicator[]>([]);

  useEffect(() => {
    const loadMetals = async () => {
      const { data: latestDateRows, error: latestDateError } = await (supabase as any)
        .from('wsp_indicators')
        .select('calc_date')
        .in('symbol', ['GLD', 'SLV'])
        .order('calc_date', { ascending: false })
        .limit(1);

      if (latestDateError) throw latestDateError;
      const latestDate = latestDateRows?.[0]?.calc_date;
      if (!latestDate) {
        setMetals([]);
        return;
      }

      const { data, error } = await (supabase as any)
        .from('wsp_indicators')
        .select('symbol, close, ma50')
        .in('symbol', ['GLD', 'SLV'])
        .eq('calc_date', latestDate);

      if (error) throw error;

      const bySymbol = new Map<string, any>();
      for (const row of data ?? []) bySymbol.set(row.symbol, row);

      setMetals([
        {
          symbol: 'GLD',
          close: Number.isFinite(Number(bySymbol.get('GLD')?.close)) ? Number(bySymbol.get('GLD')?.close) : null,
          ma50: Number.isFinite(Number(bySymbol.get('GLD')?.ma50)) ? Number(bySymbol.get('GLD')?.ma50) : null,
        },
        {
          symbol: 'SLV',
          close: Number.isFinite(Number(bySymbol.get('SLV')?.close)) ? Number(bySymbol.get('SLV')?.close) : null,
          ma50: Number.isFinite(Number(bySymbol.get('SLV')?.ma50)) ? Number(bySymbol.get('SLV')?.ma50) : null,
        },
      ]);
    };

    loadMetals().catch(() => setMetals([]));
  }, []);

  useEffect(() => {
    const loadCrypto = async () => {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true');
      if (!response.ok) throw new Error('Failed to load crypto prices');
      const payload = await response.json();

      setCrypto([
        { id: 'bitcoin', symbol: 'BTC', price: Number(payload?.bitcoin?.usd), change24h: Number(payload?.bitcoin?.usd_24h_change) },
        { id: 'ethereum', symbol: 'ETH', price: Number(payload?.ethereum?.usd), change24h: Number(payload?.ethereum?.usd_24h_change) },
        { id: 'solana', symbol: 'SOL', price: Number(payload?.solana?.usd), change24h: Number(payload?.solana?.usd_24h_change) },
      ].map((item) => ({
        ...item,
        price: Number.isFinite(item.price) ? item.price : null,
        change24h: Number.isFinite(item.change24h) ? item.change24h : null,
      })));
    };

    loadCrypto().catch(() => setCrypto([]));
  }, []);

  const metalsRegime = useMemo<RegimeState>(() => {
    const aboveCount = metals.filter((item) => item.close !== null && item.ma50 !== null && item.close > item.ma50).length;
    if (aboveCount === 2) return 'bullish';
    if (aboveCount === 1) return 'neutral';
    return 'bearish';
  }, [metals]);

  const cryptoRegime = useMemo<RegimeState>(() => {
    const btc = crypto.find((c) => c.id === 'bitcoin')?.change24h;
    const eth = crypto.find((c) => c.id === 'ethereum')?.change24h;

    if (typeof btc !== 'number' || typeof eth !== 'number') return 'neutral';
    if (btc > 0 && eth > 0) return 'bullish';
    if (btc < 0 && eth < 0) return 'bearish';
    return 'neutral';
  }, [crypto]);

  const wspConfig = wspRegimeConfig[market.marketTrend];

  return (
    <div className="space-y-2.5">
      <RegimeCard
        title="METALS MARKET REGIME"
        subtitle="METALS · Gold & Silver"
        regime={metalsRegime}
        theme={metalTheme[metalsRegime]}
        icon={<Coins className="h-4 w-4" />}
        context="Based on GLD/SLV vs MA50 from wsp_indicators."
        disclaimer
      >
        <div className="grid grid-cols-1 gap-2 px-4 sm:grid-cols-2">
          {metals.map((item) => (
            <AssetCard
              key={item.symbol}
              label={item.symbol === 'GLD' ? 'Gold ETF' : 'Silver ETF'}
              symbol={item.symbol}
              price={item.close}
              detail={item.close !== null && item.ma50 !== null ? `MA50 ${item.close > item.ma50 ? '↑' : '↓'} ${formatUsd(item.ma50)}` : 'MA50 unavailable'}
              to={`/stock/${item.symbol}`}
            />
          ))}
        </div>
      </RegimeCard>

      <RegimeCard
        title="CRYPTO MARKET REGIME"
        subtitle="CRYPTO · BTC, ETH, SOL"
        regime={cryptoRegime}
        theme={cryptoTheme[cryptoRegime]}
        icon={<Bitcoin className="h-4 w-4" />}
        context="BTC/ETH 24h momentum drives regime. SOL shown as supporting indicator."
        disclaimer
      >
        <div className="grid grid-cols-1 gap-2 px-4 sm:grid-cols-3">
          {crypto.map((item) => (
            <AssetCard
              key={item.id}
              label={item.id === 'bitcoin' ? 'Bitcoin' : item.id === 'ethereum' ? 'Ethereum' : 'Solana'}
              symbol={item.symbol}
              price={item.price}
              detail={formatPct(item.change24h)}
              detailClass={typeof item.change24h === 'number' ? (item.change24h >= 0 ? 'text-signal-buy' : 'text-signal-sell') : 'text-muted-foreground'}
            />
          ))}
        </div>
      </RegimeCard>

      <section className={`rounded border ${wspConfig.borderClass} ${wspConfig.bgClass} overflow-hidden`}>
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-8 w-8 items-center justify-center rounded border ${wspConfig.borderClass} bg-background/60`}>
              <wspConfig.icon className={`h-4 w-4 ${wspConfig.colorClass}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[10px] font-mono font-bold uppercase tracking-widest text-foreground">WSP MARKET REGIME</h2>
                <span className="text-[9px] text-muted-foreground font-mono">WSP EQUITY · S&amp;P 500 &amp; NASDAQ</span>
                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-mono font-bold ${wspConfig.colorClass} ${wspConfig.borderClass} bg-background/40`}>
                  {wspConfig.label}
                </span>
              </div>
              <p className="text-[9px] text-muted-foreground font-mono mt-0.5 max-w-md">{wspConfig.context}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 px-4 sm:grid-cols-2">
          <BenchmarkCard label="S&P 500" symbol={market.sp500Symbol} change={market.sp500Change} price={market.sp500Price} />
          <BenchmarkCard label="NASDAQ 100" symbol={market.nasdaqSymbol} change={market.nasdaqChange} price={market.nasdaqPrice} />
        </div>

        <div className="flex items-start gap-2 px-4 py-3 mt-1">
          <Shield className={`mt-0.5 h-3 w-3 flex-shrink-0 ${wspConfig.colorClass}`} />
          <p className="text-[9px] text-muted-foreground font-mono leading-relaxed">
            <span className="font-semibold text-foreground">WSP:</span> {wspConfig.guidance}
          </p>
        </div>
      </section>
    </div>
  );
}

function RegimeCard({
  title,
  subtitle,
  regime,
  theme,
  icon,
  context,
  children,
  disclaimer = false,
}: {
  title: string;
  subtitle: string;
  regime: RegimeState;
  theme: { colorClass: string; bgClass: string; borderClass: string };
  icon: ReactNode;
  context: string;
  children: ReactNode;
  disclaimer?: boolean;
}) {
  const badge = regime === 'bullish' ? 'BULLISH' : regime === 'bearish' ? 'BEARISH' : 'NEUTRAL';
  return (
    <section className={`rounded border ${theme.borderClass} ${theme.bgClass} overflow-hidden`}>
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-8 w-8 items-center justify-center rounded border ${theme.borderClass} bg-background/60 ${theme.colorClass}`}>
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[10px] font-mono font-bold uppercase tracking-widest text-foreground">{title}</h2>
              <span className="text-[9px] text-muted-foreground font-mono">{subtitle}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[9px] font-mono font-bold ${theme.colorClass} ${theme.borderClass} bg-background/40`}>
                {badge}
              </span>
            </div>
            <p className="text-[9px] text-muted-foreground font-mono mt-0.5 max-w-md">{context}</p>
          </div>
        </div>
      </div>
      {children}
      {disclaimer && (
        <p className="px-4 pb-3 pt-2 text-[9px] font-mono text-muted-foreground leading-relaxed">
          {disclaimerText}
        </p>
      )}
    </section>
  );
}

function BenchmarkCard({ label, symbol, change, price }: { label: string; symbol: string; change: number; price: number | null }) {
  const positive = change >= 0;
  return (
    <Link
      to={`/stock/${symbol}`}
      className="group flex items-center justify-between rounded border border-border/60 bg-card/80 px-3 py-2.5 transition-all hover:border-primary/30"
    >
      <div>
        <div className="text-[8px] font-mono text-muted-foreground tracking-wider">{label} <span className="opacity-60">({symbol})</span></div>
        <div className="font-mono text-base font-bold text-foreground mt-0.5">
          {price === null ? '—' : `$${price.toFixed(2)}`}
        </div>
      </div>
      <div className={`flex items-center gap-0.5 font-mono text-sm font-bold ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
        {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
        {positive ? '+' : ''}{change.toFixed(2)}%
      </div>
    </Link>
  );
}

function AssetCard({
  label,
  symbol,
  price,
  detail,
  to,
  detailClass,
}: {
  label: string;
  symbol: string;
  price: number | null;
  detail: string;
  to?: string;
  detailClass?: string;
}) {
  const content = (
    <>
      <div>
        <div className="text-[8px] font-mono text-muted-foreground tracking-wider">{label} <span className="opacity-60">({symbol})</span></div>
        <div className="font-mono text-base font-bold text-foreground mt-0.5">{formatUsd(price)}</div>
      </div>
      <div className={`flex items-center gap-1 font-mono text-[10px] font-semibold ${detailClass ?? 'text-muted-foreground'}`}>
        <CircleDollarSign className="h-3 w-3" />
        {detail}
      </div>
    </>
  );

  if (!to) {
    return <div className="group flex items-center justify-between rounded border border-border/60 bg-card/80 px-3 py-2.5">{content}</div>;
  }

  return (
    <Link to={to} className="group flex items-center justify-between rounded border border-border/60 bg-card/80 px-3 py-2.5 transition-all hover:border-primary/30">
      {content}
    </Link>
  );
}

function formatPct(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '24h N/A';
  const sign = value >= 0 ? '+' : '';
  return `24h ${sign}${value.toFixed(2)}%`;
}
