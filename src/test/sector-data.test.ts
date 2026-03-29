import { describe, expect, it } from 'vitest';
import { getIndustryChangeForTimeframe, getSectorAvgChangeForTimeframe, sectorData } from '@/lib/sector-data';

describe('sector timeframe calculations', () => {
  it('returns raw daily change for eod timeframe', () => {
    const industry = sectorData[0].industries[0];
    expect(getIndustryChangeForTimeframe(industry, 'eod')).toBe(industry.changePercent);
  });

  it('scales sector average for non-eod timeframes', () => {
    const sector = sectorData[0];
    const eod = getSectorAvgChangeForTimeframe(sector, 'eod');
    const oneMonth = getSectorAvgChangeForTimeframe(sector, '1m');

    expect(oneMonth).not.toBe(eod);
  });
});
