import {
  EQUITY_MARKET_UNIVERSE,
  MARKET_UNIVERSE,
  METALS_MARKET_UNIVERSE,
  type AssetClass,
  type MarketUniverseStock,
  type WspSupportLevel,
} from './market-universe';
import {
  classifyCuratedSymbol,
  type WspSymbolClass,
  WSP_SYMBOL_CLASS_META,
} from './wsp-data-contract';

export interface TrackedSymbolMeta extends MarketUniverseStock {
  supportsFullWsp: boolean;
  symbolClass: WspSymbolClass;
  scannerEligible: boolean;
  discoveryEligible: boolean;
}

function toTrackedMeta(item: MarketUniverseStock): TrackedSymbolMeta {
  const symbolClass = classifyCuratedSymbol(item);
  const classMeta = WSP_SYMBOL_CLASS_META[symbolClass];
  return {
    ...item,
    supportsFullWsp: symbolClass === 'full_wsp_equity',
    symbolClass,
    scannerEligible: classMeta.scannerEligible,
    discoveryEligible: classMeta.discoveryEligible,
  };
}

export const TRACKED_SYMBOLS: TrackedSymbolMeta[] = MARKET_UNIVERSE.map(toTrackedMeta);

export const TRACKED_SYMBOL_LOOKUP = Object.fromEntries(
  TRACKED_SYMBOLS.map((item) => [item.symbol, item]),
) as Record<string, TrackedSymbolMeta>;

export const EQUITY_SYMBOLS = EQUITY_MARKET_UNIVERSE.map(toTrackedMeta);
export const METALS_SYMBOLS = METALS_MARKET_UNIVERSE.map(toTrackedMeta);

/** Only symbols eligible for the WSP scanner */
export const SCANNER_ELIGIBLE_SYMBOLS = TRACKED_SYMBOLS.filter((s) => s.scannerEligible);

/** Only symbols eligible for discovery buckets */
export const DISCOVERY_ELIGIBLE_SYMBOLS = TRACKED_SYMBOLS.filter((s) => s.discoveryEligible);

export type { AssetClass, WspSupportLevel };
