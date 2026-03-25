import { useState } from 'react';
import { Zap, Lock, Coins, Scan, ArrowRight } from 'lucide-react';
import { useCredits, CREDIT_COSTS } from '@/hooks/use-credits';
import { useAuth } from '@/hooks/use-auth';
import { AuthModal } from './AuthModal';

interface PremiumScanCTAProps {
  industryName: string;
  onScanTriggered?: () => void;
  scanning?: boolean;
}

export function PremiumScanCTA({ industryName, onScanTriggered, scanning }: PremiumScanCTAProps) {
  const { user } = useAuth();
  const { credits, hasCredits, consumeCredit } = useCredits();
  const [authOpen, setAuthOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cost = CREDIT_COSTS.industryScan;

  const handleScan = async () => {
    if (!user) {
      setAuthOpen(true);
      return;
    }

    if (!hasCredits(cost)) {
      setError('Insufficient credits. Purchase more to continue.');
      return;
    }

    setError(null);
    try {
      await consumeCredit.mutateAsync({
        amount: cost,
        description: `Deep scan: ${industryName}`,
      });
      onScanTriggered?.();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <>
      <div className="rounded-lg border border-primary/20 bg-gradient-to-r from-primary/5 to-transparent p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Scan className="h-4 w-4 text-primary flex-shrink-0" />
            <div className="min-w-0">
              <h4 className="text-xs font-semibold text-foreground">Unlock Deep Analysis</h4>
              <p className="text-[10px] text-muted-foreground truncate">
                Full WSP scan for <span className="text-foreground font-medium">{industryName}</span>
              </p>
            </div>
          </div>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 whitespace-nowrap"
          >
            {scanning ? (
              'Scanning...'
            ) : !user ? (
              <><Lock className="h-3 w-3" /> Sign in</>
            ) : (
              <><Zap className="h-3 w-3" /> Scan · {cost} cr</>
            )}
          </button>
        </div>

        {user && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Coins className="h-2.5 w-2.5" />
            <span>Balance: <span className="font-mono font-semibold text-foreground">{credits.balance}</span> credits</span>
          </div>
        )}

        {error && (
          <p className="mt-1.5 rounded border border-signal-sell/30 bg-signal-sell/10 px-2 py-1 text-[10px] text-signal-sell">{error}</p>
        )}
      </div>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} defaultTab="signup" />
    </>
  );
}
