import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './use-auth';

export interface CreditBalance {
  balance: number;
  lifetimePurchased: number;
  lifetimeUsed: number;
}

export const CREDIT_COSTS = {
  industryScan: 1,
  fullStockScan: 2,
} as const;

export const CREDIT_PACKS: readonly { id: string; credits: number; price: number; label: string; priceLabel: string; popular?: boolean }[] = [
  { id: 'starter', credits: 10, price: 499, label: '10 Scans', priceLabel: '$4.99' },
  { id: 'pro', credits: 50, price: 1999, label: '50 Scans', priceLabel: '$19.99', popular: true },
  { id: 'power', credits: 200, price: 4999, label: '200 Scans', priceLabel: '$49.99' },
];

export function useCredits() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: credits, isLoading } = useQuery({
    queryKey: ['user-credits', user?.id],
    queryFn: async (): Promise<CreditBalance> => {
      if (!user) return { balance: 0, lifetimePurchased: 0, lifetimeUsed: 0 };
      const { data, error } = await supabase
        .from('user_credits')
        .select('balance, lifetime_purchased, lifetime_used')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return { balance: 0, lifetimePurchased: 0, lifetimeUsed: 0 };
      return {
        balance: data.balance,
        lifetimePurchased: data.lifetime_purchased,
        lifetimeUsed: data.lifetime_used,
      };
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  const consumeCredit = useMutation({
    mutationFn: async ({ amount, description }: { amount: number; description: string }) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase.rpc('consume_credit', {
        p_user_id: user.id,
        p_amount: amount,
        p_description: description,
      });
      if (error) throw error;
      const result = data as unknown as { ok: boolean; error?: string; balance?: number };
      if (!result.ok) throw new Error(result.error ?? 'Failed to consume credit');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-credits', user?.id] });
    },
  });

  return {
    credits: credits ?? { balance: 0, lifetimePurchased: 0, lifetimeUsed: 0 },
    isLoading,
    consumeCredit,
    hasCredits: (amount: number) => (credits?.balance ?? 0) >= amount,
    isAuthenticated: !!user,
  };
}
