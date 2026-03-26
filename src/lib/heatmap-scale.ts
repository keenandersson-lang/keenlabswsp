export const HEATMAP_BANDS = [-3, -2, -1, 0, 1, 2, 3] as const;

export function clampHeatPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > 3) return 3;
  if (value < -3) return -3;
  return value;
}

export function heatmapBand(value: number): number {
  const clamped = clampHeatPercent(value);
  if (clamped >= 2.5) return 3;
  if (clamped >= 1.5) return 2;
  if (clamped >= 0.5) return 1;
  if (clamped > -0.5) return 0;
  if (clamped > -1.5) return -1;
  if (clamped > -2.5) return -2;
  return -3;
}

export function heatmapCellClass(value: number): string {
  const band = heatmapBand(value);
  switch (band) {
    case 3: return 'border-emerald-500/40 bg-emerald-500/35';
    case 2: return 'border-emerald-500/35 bg-emerald-500/25';
    case 1: return 'border-emerald-500/25 bg-emerald-500/15';
    case -1: return 'border-rose-500/25 bg-rose-500/15';
    case -2: return 'border-rose-500/35 bg-rose-500/25';
    case -3: return 'border-rose-500/40 bg-rose-500/35';
    default: return 'border-zinc-500/20 bg-zinc-500/10';
  }
}
