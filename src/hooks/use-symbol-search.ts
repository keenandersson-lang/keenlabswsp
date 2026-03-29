import { useQuery } from '@tanstack/react-query';
import { searchSearchableSymbols } from '@/lib/searchable-universe';

export function useSymbolSearch(query: string) {
  const normalizedQuery = query.trim();

  return useQuery({
    queryKey: ['searchable-symbols', normalizedQuery],
    queryFn: () => searchSearchableSymbols(normalizedQuery, 20),
    enabled: normalizedQuery.length >= 2,
    staleTime: 30_000,
  });
}
