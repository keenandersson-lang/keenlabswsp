interface WSPScoreRingProps {
  score: number;
  maxScore: number;
  size?: number;
}

export function WSPScoreRing({ score, maxScore, size = 48 }: WSPScoreRingProps) {
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  const color =
    pct >= 70
      ? 'hsl(var(--signal-buy))'
      : pct >= 40
      ? 'hsl(var(--signal-caution))'
      : 'hsl(var(--signal-sell))';

  return (
    <div className="relative inline-flex flex-col items-center" style={{ width: size, height: size + 14 }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={3}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-500"
        />
      </svg>
      <span
        className="absolute font-mono font-bold"
        style={{
          top: size / 2 - 7,
          fontSize: size > 40 ? 13 : 10,
          color,
        }}
      >
        {score}/{maxScore}
      </span>
      <span className="text-[8px] font-mono text-muted-foreground mt-0.5">WSP</span>
    </div>
  );
}
