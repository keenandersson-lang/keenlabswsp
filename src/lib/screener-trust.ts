import type { ScreenerDataProvenance, ScreenerTrustContract, ScreenerUiState } from './wsp-types';

export const CANONICAL_SCREENER_RUNTIME_PATH: ScreenerDataProvenance = 'direct_db';

export function resolveScreenerTrustState(input: {
  uiState: ScreenerUiState;
  benchmarkFetchStatus: 'success' | 'stale' | 'failed';
  fallbackActive: boolean;
  dataProvenance: ScreenerDataProvenance;
}): ScreenerTrustContract {
  const fallbackProvenance = input.dataProvenance === 'demo_fallback';
  const isFallback = input.uiState === 'FALLBACK' || input.fallbackActive || fallbackProvenance;
  const isError = input.uiState === 'ERROR';
  const isStale = input.uiState === 'STALE';

  if (isError) {
    return {
      uiState: 'ERROR',
      displayState: 'ERROR',
      isLive: false,
      fallbackActive: true,
      benchmarkState: 'fallback',
      dataProvenance: input.dataProvenance,
    };
  }

  if (isFallback) {
    return {
      uiState: 'FALLBACK',
      displayState: 'FALLBACK',
      isLive: false,
      fallbackActive: true,
      benchmarkState: 'fallback',
      dataProvenance: input.dataProvenance,
    };
  }

  if (isStale || input.benchmarkFetchStatus === 'stale') {
    return {
      uiState: 'STALE',
      displayState: 'STALE',
      isLive: false,
      fallbackActive: false,
      benchmarkState: 'stale',
      dataProvenance: input.dataProvenance,
    };
  }

  return {
    uiState: 'LIVE',
    displayState: 'LIVE',
    isLive: true,
    fallbackActive: false,
    benchmarkState: 'live',
    dataProvenance: input.dataProvenance,
  };
}
