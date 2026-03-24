import { useState } from 'react';
import { Zap, Lock, Coins, Scan } from 'lucide-react';
import { useCredits, CREDIT_COSTS } from '@/hooks/use-credits';
import { useAuth } from '@/hooks/use-auth';
import { AuthModal } from './AuthModal';

interface PremiumScanCTAProps {
  industryName: string;
  onScanTriggered: () => void;
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
      setError('Otillräckliga credits. Köp fler för att fortsätta.');
      return;
    }

    setError(null);
    try {
      await consumeCredit.mutateAsync({
        amount: cost,
        description: `Deep scan: ${industryName}`,
      });
      onScanTriggered();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <>
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Scan className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Deep Stock Scan</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Kör WSP-motorn på alla aktier i <span className="text-accent font-medium">{industryName}</span> för att hitta KÖP-signaler, breakouts och entry-setups.
            </p>
          </div>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 whitespace-nowrap"
          >
            {scanning ? (
              'Scanning...'
            ) : !user ? (
              <>
                <Lock className="h-3 w-3" /> Logga in
              </>
            ) : (
              <>
                <Zap className="h-3 w-3" /> Scanna ({cost} credit)
              </>
            )}
          </button>
        </div>

        {user && (
          <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
            <Coins className="h-3 w-3" />
            <span>Ditt saldo: <span className="font-mono font-semibold text-foreground">{credits.balance}</span> credits</span>
          </div>
        )}

        {error && (
          <p className="mt-2 rounded border border-signal-sell/30 bg-signal-sell/10 px-2 py-1 text-xs text-signal-sell">{error}</p>
        )}
      </div>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} defaultTab="signup" />
    </>
  );
}
