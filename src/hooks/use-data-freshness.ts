export function useDataFreshness(dataDate: string | null) {
  if (!dataDate) return { label: 'Laddar...', color: 'gray' as const, isStale: false }

  const date = new Date(dataDate)
  const now = new Date()
  const dayOfWeek = now.getDay()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000)

  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
  const effectiveDiff = isWeekend ? Math.max(0, diffDays - 2) : diffDays

  const formatted = date.toLocaleDateString('sv-SE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  if (effectiveDiff <= 1)
    return { label: `Data per: ${formatted} (stängningskurs)`, color: 'green' as const, isStale: false }
  if (effectiveDiff <= 3)
    return { label: `Data per: ${formatted}`, color: 'yellow' as const, isStale: false }
  return { label: `Data per: ${formatted} ⚠️ Gammal data`, color: 'red' as const, isStale: true }
}
