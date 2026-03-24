import { useState } from 'react';
import { Coins, LogIn, LogOut, ShoppingCart } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useCredits, CREDIT_PACKS } from '@/hooks/use-credits';
import { AuthModal } from './AuthModal';

export function CreditsBadge() {
  const { user, signOut } = useAuth();
  const { credits } = useCredits();
  const [authOpen, setAuthOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);

  if (!user) {
    return (
      <>
        <button
          onClick={() => setAuthOpen(true)}
          className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          <LogIn className="h-3.5 w-3.5" /> Logga in
        </button>
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShopOpen(!shopOpen)}
          className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
        >
          <Coins className="h-3.5 w-3.5" />
          <span className="font-mono">{credits.balance}</span>
          <span className="text-muted-foreground">credits</span>
        </button>
        <button
          onClick={() => signOut()}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          title="Logga ut"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>

      {shopOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-border bg-card p-4 shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <ShoppingCart className="h-4 w-4 text-primary" /> Köp Credits
            </h3>
            <button onClick={() => setShopOpen(false)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
          </div>
          <div className="space-y-2">
            {CREDIT_PACKS.map(pack => (
              <button
                key={pack.id}
                className={`w-full flex items-center justify-between rounded-lg border p-3 text-left transition-colors hover:border-primary/40 ${pack.popular ? 'border-primary/30 bg-primary/5' : 'border-border'}`}
              >
                <div>
                  <span className="text-sm font-semibold text-foreground">{pack.label}</span>
                  {pack.popular && <span className="ml-2 rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-bold text-primary">POPULÄR</span>}
                  <span className="block text-[10px] text-muted-foreground mt-0.5">
                    {(pack.price / pack.credits / 100).toFixed(2)} kr/scan
                  </span>
                </div>
                <span className="font-mono text-sm font-bold text-primary">{pack.priceLabel}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground text-center">
            Stripe-betalning kommer snart. Credits-arkitekturen är redo.
          </p>
        </div>
      )}
    </>
  );
}
