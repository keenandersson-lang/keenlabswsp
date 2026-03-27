import { useState, useEffect, useMemo } from 'react';
import type { EvaluatedStock } from '@/lib/wsp-types';

interface PositionSizerProps {
  stock: EvaluatedStock;
}

const RISK_OPTIONS = [0.01, 0.015, 0.02];
const STOP_PCT_OPTIONS = [0.04, 0.06, 0.08];
const LS_KEY = 'wsp-portfolio-size';

function PillButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs font-mono font-semibold transition-colors ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}
    >
      {children}
    </button>
  );
}

function ResultCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border p-4 last:border-b-0">
      <div className="text-xs font-mono font-semibold text-muted-foreground mb-2">{icon}  {title}</div>
      {children}
    </div>
  );
}

export function PositionSizer({ stock }: PositionSizerProps) {
  const [portfolio, setPortfolio] = useState(() => {
    const saved = localStorage.getItem(LS_KEY);
    return saved ? Number(saved) : 100000;
  });
  const [riskPct, setRiskPct] = useState(0.01);
  const [entryPrice, setEntryPrice] = useState(stock.price);
  const [stopMethod, setStopMethod] = useState<'percent' | 'manual'>('percent');
  const [stopPct, setStopPct] = useState(0.06);
  const [manualStop, setManualStop] = useState(stock.price * 0.94);

  useEffect(() => {
    localStorage.setItem(LS_KEY, String(portfolio));
  }, [portfolio]);

  useEffect(() => {
    setEntryPrice(stock.price);
    setManualStop(stock.price * 0.94);
  }, [stock.price]);

  const calc = useMemo(() => {
    const maxRisk = portfolio * riskPct;
    const stopLossPrice = stopMethod === 'percent'
      ? entryPrice * (1 - stopPct)
      : manualStop;
    const riskPerShare = entryPrice - stopLossPrice;
    if (riskPerShare <= 0) return null;

    const shares = Math.floor(maxRisk / riskPerShare);
    const positionValue = shares * entryPrice;
    const actualRisk = shares * riskPerShare;
    const portfolioPct = (positionValue / portfolio) * 100;
    const riskOfPortfolio = (actualRisk / portfolio) * 100;
    const stopPctActual = ((entryPrice - stopLossPrice) / entryPrice) * 100;

    const resistance = stock.audit.resistanceLevel;
    let potentialGain: number | null = null;
    let riskReward: number | null = null;
    let gainPct: number | null = null;
    if (resistance && resistance > entryPrice) {
      potentialGain = shares * (resistance - entryPrice);
      riskReward = potentialGain / actualRisk;
      gainPct = ((resistance - entryPrice) / entryPrice) * 100;
    }

    const buyStopPrice = entryPrice * 1.005;
    const buyLimitPrice = buyStopPrice + 0.50;

    return { shares, positionValue, actualRisk, portfolioPct, riskOfPortfolio, stopLossPrice, stopPctActual, potentialGain, riskReward, gainPct, resistance, buyStopPrice, buyLimitPrice };
  }, [portfolio, riskPct, entryPrice, stopMethod, stopPct, manualStop, stock.audit.resistanceLevel]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Inputs */}
      <div className="space-y-5">
        <div>
          <label className="text-xs font-mono text-muted-foreground mb-1.5 block">Portföljstorlek</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input
              type="number"
              value={portfolio}
              onChange={(e) => setPortfolio(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-border bg-card py-2.5 pl-7 pr-3 font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-mono text-muted-foreground mb-1.5 block">Risk per affär</label>
          <div className="flex gap-2">
            {RISK_OPTIONS.map(r => (
              <PillButton key={r} active={riskPct === r} onClick={() => setRiskPct(r)}>
                {(r * 100).toFixed(1)}%
              </PillButton>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-mono text-muted-foreground mb-1.5 block">Entry-pris</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input
              type="number"
              step="0.01"
              value={entryPrice}
              onChange={(e) => setEntryPrice(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-border bg-card py-2.5 pl-7 pr-3 font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-mono text-muted-foreground mb-1.5 block">Stop-loss metod</label>
          <div className="flex gap-2 mb-3">
            <PillButton active={stopMethod === 'percent'} onClick={() => setStopMethod('percent')}>Procentregel</PillButton>
            <PillButton active={stopMethod === 'manual'} onClick={() => setStopMethod('manual')}>Manuell nivå</PillButton>
          </div>
          {stopMethod === 'percent' ? (
            <div className="flex gap-2">
              {STOP_PCT_OPTIONS.map(p => (
                <PillButton key={p} active={stopPct === p} onClick={() => setStopPct(p)}>
                  {(p * 100)}%
                </PillButton>
              ))}
            </div>
          ) : (
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <input
                type="number"
                step="0.01"
                value={manualStop}
                onChange={(e) => setManualStop(Number(e.target.value) || 0)}
                className="w-full rounded-lg border border-border bg-card py-2.5 pl-7 pr-3 font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="rounded-lg border border-border bg-card">
        {calc ? (
          <>
            <ResultCard icon="📊" title="POSITIONSSTORLEK">
              <div className="text-2xl font-mono font-bold text-foreground">{calc.shares} aktier</div>
              <div className="text-sm font-mono text-primary">${calc.positionValue.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">({calc.portfolioPct.toFixed(1)}% av portfölj)</div>
            </ResultCard>

            <ResultCard icon="🛑" title="STOP-LOSS">
              <div className="text-xl font-mono font-bold text-foreground">${calc.stopLossPrice.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground">(−{calc.stopPctActual.toFixed(1)}% under entry)</div>
            </ResultCard>

            <ResultCard icon="⚠️" title="MAX FÖRLUST OM STOP TRÄFFAS">
              <div className="text-xl font-mono font-bold text-signal-sell">${calc.actualRisk.toFixed(0)}</div>
              <div className="text-xs text-muted-foreground">({calc.riskOfPortfolio.toFixed(1)}% av portfölj)</div>
            </ResultCard>

            {calc.potentialGain != null && calc.resistance != null && (
              <ResultCard icon="🎯" title="POTENTIELL VINST (till resistance)">
                <div className="text-xl font-mono font-bold text-signal-buy">${calc.potentialGain.toFixed(0)}</div>
                <div className="text-xs text-muted-foreground">(+{calc.gainPct?.toFixed(1)}% till ${calc.resistance.toFixed(2)})</div>
                <div className="text-xs font-mono text-primary mt-1">Risk/Reward: 1:{calc.riskReward?.toFixed(1)}</div>
              </ResultCard>
            )}

            <ResultCard icon="📋" title="ORDER-FÖRSLAG (WSP Buy Stop Limit)">
              <div className="space-y-1 text-sm font-mono">
                <div className="flex justify-between"><span className="text-muted-foreground">Stop:</span><span>${calc.buyStopPrice.toFixed(2)} (entry + 0.5%)</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Limit:</span><span>${calc.buyLimitPrice.toFixed(2)} (stop + $0.50)</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">GTC:</span><span>Ja (Good Till Cancelled)</span></div>
              </div>
            </ResultCard>
          </>
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Ogiltig beräkning — kontrollera entry-pris och stop-loss.
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="lg:col-span-2 text-xs text-muted-foreground font-mono leading-relaxed">
        Per WSP: Stop-loss bör aldrig överstiga 8%. Standard 4–6% rekommenderas.<br />
        "Everyone is a genius until the market crashes..." — Sätt alltid stop-loss direkt vid köp.
      </div>
    </div>
  );
}