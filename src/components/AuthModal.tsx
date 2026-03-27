import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { lovable } from '@/integrations/lovable/index';
import { X, Mail, Lock, LogIn, UserPlus } from 'lucide-react';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  defaultTab?: 'login' | 'signup';
}

export function AuthModal({ open, onClose, defaultTab = 'login' }: AuthModalProps) {
  const [tab, setTab] = useState<'login' | 'signup'>(defaultTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (tab === 'login') {
        const { error } = await signIn(email, password);
        if (error) throw error;
        onClose();
      } else {
        const { error } = await signUp(email, password);
        if (error) throw error;
        setSuccess('Konto skapat! Kontrollera din e-post för verifiering.');
      }
    } catch (err: any) {
      setError(err.message ?? 'Ett fel uppstod');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>

        <div className="mb-6 text-center">
          <h2 className="text-lg font-bold">WSP Screener</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {tab === 'login' ? 'Logga in för att använda premium-funktioner' : 'Skapa konto — 3 gratis scans ingår'}
          </p>
        </div>

        <div className="flex mb-4 rounded-lg border border-border bg-background p-0.5">
          <button
            onClick={() => setTab('login')}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${tab === 'login' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <LogIn className="inline h-3 w-3 mr-1" /> Logga in
          </button>
          <button
            onClick={() => setTab('signup')}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${tab === 'signup' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <UserPlus className="inline h-3 w-3 mr-1" /> Skapa konto
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="email"
              placeholder="E-postadress"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="password"
              placeholder="Lösenord"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {error && <p className="rounded-md border border-signal-sell/30 bg-signal-sell/10 px-3 py-2 text-xs text-signal-sell">{error}</p>}
          {success && <p className="rounded-md border border-signal-buy/30 bg-signal-buy/10 px-3 py-2 text-xs text-signal-buy">{success}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? '...' : tab === 'login' ? 'Logga in' : 'Skapa konto'}
          </button>

          <div className="relative my-2">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center"><span className="bg-card px-2 text-[10px] text-muted-foreground">eller</span></div>
          </div>

          <button
            type="button"
            onClick={async () => {
              setError(null);
              const result = await lovable.auth.signInWithOAuth('apple', {
                redirect_uri: window.location.origin,
              });
              if (result?.error) {
                setError(result.error.message ?? 'Apple sign-in misslyckades');
              }
            }}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
            Logga in med Apple
          </button>
        </form>
      </div>
    </div>
  );
}
