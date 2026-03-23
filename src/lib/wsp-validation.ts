import { BLOCKED_REASON_ORDERED } from './wsp-assertions';
import { evaluateStock } from './wsp-engine';
import { runIndicatorFixtures } from './wsp-indicator-fixtures';
import { isBreakoutStale } from './wsp-indicators';
import type {
  EvaluatedStock,
  RecommendationCounts,
  ScreenerDebugSummary,
  StockIndicators,
  ValidationFixtureDefinition,
  ValidationFixtureResult,
  WSPBlockedReason,
  WSPPattern,
} from './wsp-types';

interface FixtureScenario {
  definition: ValidationFixtureDefinition;
  pattern: WSPPattern;
  sectorAligned: boolean;
  marketFavorable: boolean;
  price: number;
  prevClose: number;
  volume: number;
  indicators: StockIndicators;
}

function createIndicators(overrides: Partial<StockIndicators>): StockIndicators {
  return {
    sma20: 112,
    sma50: 110,
    sma150: 100,
    sma200: 95,
    sma50Slope: 2.4,
    sma50SlopeDirection: 'rising',
    resistanceZone: 118,
    resistanceTouches: 4,
    breakoutLevel: 118.59,
    currentClose: 121,
    breakoutCloseDelta: 2.41,
    breakoutConfirmed: true,
    barsSinceBreakout: 2,
    averageVolumeReference: 1_000_000,
    volumeMultiple: 2.6,
    mansfieldRS: 2.1,
    mansfieldRSTrend: 'rising',
    mansfieldTransition: false,
    indicatorWarnings: [],
    chronologyNormalized: false,
    ...overrides,
  };
}

const FIXTURE_SCENARIOS: FixtureScenario[] = [
  {
    definition: {
      id: 'valid_buy_candidate',
      description: 'Clean CLIMBING breakout that satisfies every hard rule.',
      expectedPattern: 'CLIMBING',
      expectedIsValidWspEntry: true,
      expectedRecommendation: 'KÖP',
      expectedBlockedReasons: [],
    },
    pattern: 'CLIMBING',
    sectorAligned: true,
    marketFavorable: true,
    price: 121,
    prevClose: 119,
    volume: 2_600_000,
    indicators: createIndicators({}),
  },
  {
    definition: {
      id: 'climbing_but_below_50ma',
      description: 'Climbing structure but price has slipped below the 50-day MA.',
      expectedPattern: 'CLIMBING',
      expectedIsValidWspEntry: false,
      expectedRecommendation: 'BEVAKA',
      expectedBlockedReasons: ['below_50ma'],
    },
    pattern: 'CLIMBING',
    sectorAligned: true,
    marketFavorable: true,
    price: 108,
    prevClose: 109,
    volume: 2_600_000,
    indicators: createIndicators({ sma50: 110, sma150: 100, currentClose: 108, breakoutCloseDelta: 108 - 118.59 }),
  },
  {
    definition: {
      id: 'base_without_breakout',
      description: 'Base pattern above moving averages but without a valid breakout.',
      expectedPattern: 'BASE',
      expectedIsValidWspEntry: false,
      expectedRecommendation: 'BEVAKA',
      expectedBlockedReasons: ['breakout_not_valid', 'pattern_not_climbing'],
    },
    pattern: 'BASE',
    sectorAligned: true,
    marketFavorable: true,
    price: 116,
    prevClose: 116,
    volume: 2_300_000,
    indicators: createIndicators({ breakoutConfirmed: false, barsSinceBreakout: null, currentClose: 116, breakoutCloseDelta: -2.59, volumeMultiple: 2.3 }),
  },
  {
    definition: {
      id: 'tired_above_mas',
      description: 'Tired pattern that remains above both major moving averages.',
      expectedPattern: 'TIRED',
      expectedIsValidWspEntry: false,
      expectedRecommendation: 'SÄLJ',
      expectedBlockedReasons: ['pattern_not_climbing'],
    },
    pattern: 'TIRED',
    sectorAligned: true,
    marketFavorable: true,
    price: 117,
    prevClose: 116,
    volume: 2_100_000,
    indicators: createIndicators({ sma50Slope: 0.2, sma50SlopeDirection: 'rising', currentClose: 117, breakoutCloseDelta: -1.59, volumeMultiple: 2.1 }),
  },
  {
    definition: {
      id: 'downhill_case',
      description: 'Broken downhill setup underneath both moving averages.',
      expectedPattern: 'DOWNHILL',
      expectedIsValidWspEntry: false,
      expectedRecommendation: 'SÄLJ',
      expectedBlockedReasons: [
        'below_50ma',
        'below_150ma',
        'slope_50_not_positive',
        'breakout_not_valid',
        'volume_below_threshold',
        'mansfield_not_valid',
        'sector_not_aligned',
        'market_not_aligned',
        'pattern_not_climbing',
      ],
    },
    pattern: 'DOWNHILL',
    sectorAligned: false,
    marketFavorable: false,
    price: 82,
    prevClose: 84,
    volume: 1_000_000,
    indicators: createIndicators({
      sma50: 95,
      sma150: 110,
      sma200: 118,
      sma50Slope: -3.2,
      sma50SlopeDirection: 'falling',
      resistanceZone: 97,
      breakoutLevel: 97.49,
      breakoutConfirmed: false,
      barsSinceBreakout: null,
      currentClose: 82,
      breakoutCloseDelta: -15.49,
      averageVolumeReference: 1_250_000,
      volumeMultiple: 0.8,
      mansfieldRS: -3.7,
      mansfieldRSTrend: 'falling',
      mansfieldTransition: false,
    }),
  },
  {
    definition: {
      id: 'breakout_with_weak_volume',
      description: 'Valid breakout structure but insufficient volume follow-through.',
      expectedPattern: 'CLIMBING',
      expectedIsValidWspEntry: false,
      expectedRecommendation: 'BEVAKA',
      expectedBlockedReasons: ['volume_below_threshold'],
    },
    pattern: 'CLIMBING',
    sectorAligned: true,
    marketFavorable: true,
    price: 121,
    prevClose: 120,
    volume: 1_600_000,
    indicators: createIndicators({ averageVolumeReference: 1_142_857.142857, volumeMultiple: 1.4 }),
  },
  {
    definition: {
      id: 'weak_sector_alignment',
      description: 'Strong individual chart but sector trend is not aligned.',
      expectedPattern: 'CLIMBING',
      expectedIsValidWspEntry: false,
      expectedRecommendation: 'BEVAKA',
      expectedBlockedReasons: ['sector_not_aligned'],
    },
    pattern: 'CLIMBING',
    sectorAligned: false,
    marketFavorable: true,
    price: 121,
    prevClose: 120,
    volume: 2_600_000,
    indicators: createIndicators({}),
  },
  {
    definition: {
      id: 'stale_breakout_case',
      description: 'Breakout happened too long ago to qualify as a fresh WSP entry.',
      expectedPattern: 'CLIMBING',
      expectedIsValidWspEntry: false,
      expectedRecommendation: 'BEVAKA',
      expectedBlockedReasons: ['breakout_stale'],
    },
    pattern: 'CLIMBING',
    sectorAligned: true,
    marketFavorable: true,
    price: 123,
    prevClose: 122,
    volume: 2_900_000,
    indicators: createIndicators({ currentClose: 123, breakoutCloseDelta: 4.41, barsSinceBreakout: 18, volumeMultiple: 2.9 }),
  },
];

function sameBlockedReasons(actual: WSPBlockedReason[], expected: WSPBlockedReason[]) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function createRecommendationCounts(stocks: EvaluatedStock[]): RecommendationCounts {
  return stocks.reduce<RecommendationCounts>((counts, stock) => {
    counts[stock.finalRecommendation] += 1;
    return counts;
  }, {
    'KÖP': 0,
    'BEVAKA': 0,
    'SÄLJ': 0,
    'UNDVIK': 0,
  });
}

function buildFormulaWarnings(stocks: EvaluatedStock[]): string[] {
  const warnings = new Set<string>();

  for (const stock of stocks) {
    const { indicators } = stock;

    if (indicators.breakoutConfirmed && indicators.resistanceZone === null) {
      warnings.add(`${stock.symbol}: breakoutConfirmed=true but resistanceZone is null`);
    }
    if (indicators.breakoutConfirmed && indicators.breakoutLevel === null) {
      warnings.add(`${stock.symbol}: breakoutConfirmed=true but breakoutLevel is null`);
    }
    if (!indicators.breakoutConfirmed && indicators.barsSinceBreakout !== null) {
      warnings.add(`${stock.symbol}: barsSinceBreakout is set while breakoutConfirmed=false`);
    }
    if (isBreakoutStale(indicators.barsSinceBreakout) && stock.gate.breakoutFresh) {
      warnings.add(`${stock.symbol}: stale breakout still marked as fresh`);
    }
    if (indicators.volumeMultiple !== null && indicators.averageVolumeReference === null) {
      warnings.add(`${stock.symbol}: volumeMultiple exists without an averageVolumeReference`);
    }
  }

  return [...warnings];
}

export function runValidationFixtures(): ValidationFixtureResult[] {
  return FIXTURE_SCENARIOS.map((fixture, index) => {
    const stock = evaluateStock(
      `FIX${index + 1}`,
      fixture.definition.id,
      'Validation',
      'Fixture',
      [],
      [],
      fixture.sectorAligned,
      fixture.marketFavorable,
      'fallback',
      {
        overrideAnalysis: {
          pattern: fixture.pattern,
          indicators: fixture.indicators,
          price: fixture.price,
          prevClose: fixture.prevClose,
          volume: fixture.volume,
          lastUpdated: '2026-03-23T00:00:00.000Z',
        },
      },
    );

    const mismatches: string[] = [];

    if (stock.pattern !== fixture.definition.expectedPattern) {
      mismatches.push(`pattern expected ${fixture.definition.expectedPattern} got ${stock.pattern}`);
    }
    if (stock.isValidWspEntry !== fixture.definition.expectedIsValidWspEntry) {
      mismatches.push(`isValidWspEntry expected ${fixture.definition.expectedIsValidWspEntry} got ${stock.isValidWspEntry}`);
    }
    if (stock.finalRecommendation !== fixture.definition.expectedRecommendation) {
      mismatches.push(`recommendation expected ${fixture.definition.expectedRecommendation} got ${stock.finalRecommendation}`);
    }
    if (!sameBlockedReasons(stock.blockedReasons, fixture.definition.expectedBlockedReasons)) {
      mismatches.push(`blockedReasons expected [${fixture.definition.expectedBlockedReasons.join(', ')}] got [${stock.blockedReasons.join(', ')}]`);
    }

    return {
      ...fixture.definition,
      actualPattern: stock.pattern,
      actualIsValidWspEntry: stock.isValidWspEntry,
      actualRecommendation: stock.finalRecommendation,
      actualBlockedReasons: stock.blockedReasons,
      passed: mismatches.length === 0,
      mismatches,
    };
  });
}

export function buildScreenerDebugSummary(stocks: EvaluatedStock[]): ScreenerDebugSummary {
  const fixtureResults = runValidationFixtures();
  const indicatorFixtureResults = runIndicatorFixtures();
  const logicViolations = stocks
    .filter((stock) => stock.logicViolations.length > 0)
    .map((stock) => ({
      symbol: stock.symbol,
      finalRecommendation: stock.finalRecommendation,
      pattern: stock.pattern,
      violatedRules: stock.logicViolations,
    }));

  const blockedCounts = Object.fromEntries(
    BLOCKED_REASON_ORDERED.map((reason) => [reason, 0]),
  ) as Record<WSPBlockedReason, number>;

  for (const stock of stocks) {
    for (const blockedReason of stock.blockedReasons) {
      blockedCounts[blockedReason] += 1;
    }
  }

  return {
    fixturePassCount: fixtureResults.filter((result) => result.passed).length,
    fixtureFailCount: fixtureResults.filter((result) => !result.passed).length,
    indicatorTestPassCount: indicatorFixtureResults.filter((result) => result.passed).length,
    indicatorTestFailCount: indicatorFixtureResults.filter((result) => !result.passed).length,
    logicViolationCount: logicViolations.length,
    logicViolations,
    fixtureResults,
    indicatorFixtureResults,
    blockedCounts,
    validBuyCandidates: stocks.filter((stock) => stock.finalRecommendation === 'KÖP' && stock.isValidWspEntry).length,
    validEntryCount: stocks.filter((stock) => stock.isValidWspEntry).length,
    totalStocks: stocks.length,
    recommendationCounts: createRecommendationCounts(stocks),
    formulaInconsistencyWarnings: buildFormulaWarnings(stocks),
    insufficientHistoryCases: stocks.filter((stock) => stock.indicators.indicatorWarnings.some((warning) => warning.startsWith('insufficient_'))).length,
  };
}
