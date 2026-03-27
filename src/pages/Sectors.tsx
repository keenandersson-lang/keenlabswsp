import { SectorAnalysis } from '@/components/SectorAnalysis';
import { BarChart3 } from 'lucide-react';

export default function Sectors() {
  return (
    <div className="space-y-3 px-2 py-2 sm:px-4 sm:py-4 max-w-7xl mx-auto pb-20 md:pb-4">
      <div className="flex items-start gap-3">
        <BarChart3 className="mt-0.5 h-4 w-4 text-primary flex-shrink-0" />
        <div>
          <h2 className="text-xs font-bold text-foreground font-mono tracking-wider">SEKTORER</h2>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
            GICS sector overview · ETF-baserad analys
          </p>
        </div>
      </div>
      <SectorAnalysis />
    </div>
  );
}
