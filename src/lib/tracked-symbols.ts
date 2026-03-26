import {
  EQUITY_MARKET_UNIVERSE,
  MARKET_UNIVERSE,
  METALS_MARKET_UNIVERSE,
  type AssetClass,
  type MarketUniverseStock,
  type WspSupportLevel,
} from './market-universe';

export interface TrackedSymbolMeta extends MarketUniverseStock {
  supportsFullWsp: boolean;
}

function toTrackedMeta(item: MarketUniverseStock): TrackedSymbolMeta {
  return {
    ...item,
    supportsFullWsp: item.wspSupport === 'full',
  };
}

export const TRACKED_SYMBOLS: TrackedSymbolMeta[] = MARKET_UNIVERSE.map(toTrackedMeta);

export const TRACKED_SYMBOL_LOOKUP = Object.fromEntries(
  TRACKED_SYMBOLS.map((item) => [item.symbol, item]),
) as Record<string, TrackedSymbolMeta>;

export const EQUITY_SYMBOLS = EQUITY_MARKET_UNIVERSE.map(toTrackedMeta);
export const METALS_SYMBOLS = METALS_MARKET_UNIVERSE.map(toTrackedMeta);

export type { AssetClass, WspSupportLevel };
