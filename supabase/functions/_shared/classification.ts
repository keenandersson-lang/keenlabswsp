export type ClassificationStatus =
  | 'canonicalized'
  | 'ambiguous'
  | 'unresolved'
  | 'proxy_mapped'
  | 'manually_reviewed'

export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface ClassificationInput {
  symbol?: string | null
  rawSector?: string | null
  rawIndustry?: string | null
  sector?: string | null
  industry?: string | null
  sicCode?: string | null
  sicDescription?: string | null
  exchange?: string | null
  primaryExchange?: string | null
  instrumentType?: string | null
  isEtf?: boolean | null
  isAdr?: boolean | null
  isCommonStock?: boolean | null
  companyName?: string | null
  manualOverrideSector?: string | null
  manualOverrideIndustry?: string | null
  manuallyReviewed?: boolean | null
}

export interface ClassificationResult {
  rawSector: string | null
  rawIndustry: string | null
  canonicalSector: string | null
  canonicalIndustry: string | null
  confidenceScore: number
  confidenceLevel: ConfidenceLevel
  classificationSource: string
  classificationStatus: ClassificationStatus
  classificationReason: string | null
  reviewNeeded: boolean
}

const SECTOR_NORMALIZATION: Record<string, string> = {
  'consumer defensive': 'Consumer Staples',
  'consumer cyclical': 'Consumer Discretionary',
  'communication services': 'Communication Services',
  'real estate': 'Real Estate',
  'basic materials': 'Materials',
  'health care': 'Healthcare',
  industrials: 'Industrials',
  utilities: 'Utilities',
  'financial services': 'Financials',
  technology: 'Technology',
  energy: 'Energy',
  unknown: 'Unknown',
  index: 'Index',
}

const SIC_SECTOR_MAP: Record<string, string> = {
  '01': 'Materials','02': 'Materials','07': 'Materials','08': 'Materials','09': 'Materials',
  '10': 'Energy','12': 'Energy','13': 'Energy','14': 'Materials','15': 'Industrials','16': 'Industrials','17': 'Industrials',
  '20': 'Consumer Staples','21': 'Consumer Staples','22': 'Consumer Discretionary','23': 'Consumer Discretionary','24': 'Materials',
  '25': 'Consumer Discretionary','26': 'Materials','27': 'Communication Services','28': 'Healthcare','29': 'Energy','30': 'Materials',
  '31': 'Consumer Discretionary','32': 'Materials','33': 'Materials','34': 'Industrials','35': 'Technology','36': 'Technology',
  '37': 'Industrials','38': 'Healthcare','39': 'Consumer Discretionary','40': 'Industrials','41': 'Industrials','42': 'Industrials',
  '43': 'Communication Services','44': 'Industrials','45': 'Industrials','46': 'Industrials','47': 'Industrials','48': 'Communication Services',
  '49': 'Utilities','50': 'Consumer Discretionary','51': 'Consumer Staples','52': 'Consumer Discretionary','53': 'Consumer Discretionary',
  '54': 'Consumer Staples','55': 'Consumer Discretionary','56': 'Consumer Discretionary','57': 'Consumer Discretionary','58': 'Consumer Discretionary',
  '59': 'Consumer Discretionary','60': 'Financials','61': 'Financials','62': 'Financials','63': 'Financials','64': 'Financials','65': 'Real Estate',
  '67': 'Financials','70': 'Consumer Discretionary','72': 'Consumer Discretionary','73': 'Technology','75': 'Consumer Discretionary',
  '76': 'Industrials','78': 'Communication Services','79': 'Communication Services','80': 'Healthcare','81': 'Technology','82': 'Consumer Discretionary',
  '83': 'Consumer Discretionary','84': 'Consumer Discretionary','86': 'Consumer Discretionary','87': 'Technology','89': 'Technology',
  '91': 'Industrials','92': 'Industrials','93': 'Industrials','94': 'Industrials','95': 'Industrials','96': 'Industrials','97': 'Industrials','99': 'Industrials',
}

const EXCHANGE_TRUST = new Set(['NYSE', 'NASDAQ'])

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function titleCase(input: string): string {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 100)
}

function normalizeSector(raw: string | null | undefined): string | null {
  const normalized = normalizeText(raw)
  if (!normalized) return null
  const mapped = SECTOR_NORMALIZATION[normalized.toLowerCase()]
  return mapped ?? titleCase(normalized)
}

function normalizeIndustry(raw: string | null | undefined): string | null {
  const normalized = normalizeText(raw)
  if (!normalized) return null
  if (normalized.length < 2) return null
  return titleCase(normalized)
}

function sectorFromSic(sic: string | null | undefined): string | null {
  if (!sic) return null
  const prefix = sic.slice(0, 2)
  return SIC_SECTOR_MAP[prefix] ?? null
}

function industryFromSicDesc(sicDesc: string | null | undefined): string | null {
  const normalized = normalizeText(sicDesc)
  if (!normalized || normalized.length < 3) return null
  return titleCase(normalized)
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(1, Number(score.toFixed(2))))
}

function scoreToLevel(score: number): ConfidenceLevel {
  if (score >= 0.8) return 'high'
  if (score >= 0.55) return 'medium'
  return 'low'
}

export function computeSectorIndustryClassification(input: ClassificationInput): ClassificationResult {
  const manualSector = normalizeSector(input.manualOverrideSector)
  const manualIndustry = normalizeIndustry(input.manualOverrideIndustry)
  if (manualSector && manualIndustry) {
    return {
      rawSector: normalizeText(input.rawSector ?? input.sector),
      rawIndustry: normalizeText(input.rawIndustry ?? input.industry),
      canonicalSector: manualSector,
      canonicalIndustry: manualIndustry,
      confidenceScore: 1,
      confidenceLevel: 'high',
      classificationSource: 'manual_override',
      classificationStatus: 'manually_reviewed',
      classificationReason: null,
      reviewNeeded: false,
    }
  }

  const rawSector = normalizeText(input.rawSector ?? input.sector)
  const rawIndustry = normalizeText(input.rawIndustry ?? input.industry)
  const canonicalSector = normalizeSector(rawSector)
  const canonicalIndustry = normalizeIndustry(rawIndustry)

  const sicSector = sectorFromSic(input.sicCode)
  const sicIndustry = industryFromSicDesc(input.sicDescription)
  const fallbackSector = canonicalSector ?? sicSector
  const fallbackIndustry = canonicalIndustry ?? sicIndustry

  const exchange = String(input.primaryExchange ?? input.exchange ?? '').toUpperCase()
  const isCommonStock = Boolean(input.isCommonStock)
  const isEtf = Boolean(input.isEtf)
  const isAdr = Boolean(input.isAdr)

  let score = 0
  const reasons: string[] = []
  let source = 'provider_raw'
  let status: ClassificationStatus = 'unresolved'

  if (fallbackSector) score += 0.35
  else reasons.push('missing_sector')

  if (fallbackIndustry) score += 0.35
  else reasons.push('missing_industry')

  if (isCommonStock) score += 0.1
  if (EXCHANGE_TRUST.has(exchange)) score += 0.08

  if (canonicalSector && sicSector && canonicalSector !== sicSector) {
    score -= 0.25
    reasons.push('sector_conflict_provider_vs_sic')
    status = 'ambiguous'
  }

  if (canonicalIndustry && sicIndustry && canonicalIndustry !== sicIndustry) {
    score -= 0.15
    reasons.push('industry_conflict_provider_vs_sic')
    status = 'ambiguous'
  }

  if (!canonicalSector && sicSector) {
    source = 'sic_proxy'
    score += 0.05
  }

  const canProxyMap = Boolean(!canonicalIndustry && fallbackSector && (sicIndustry || isCommonStock || EXCHANGE_TRUST.has(exchange)))
  let resolvedSector = fallbackSector
  let resolvedIndustry = fallbackIndustry

  if (!resolvedSector) {
    status = 'unresolved'
  } else if (!resolvedIndustry && canProxyMap) {
    resolvedIndustry = `${resolvedSector} Proxy Basket`
    source = source === 'provider_raw' ? 'proxy_rule' : `${source}+proxy_rule`
    status = status === 'ambiguous' ? 'ambiguous' : 'proxy_mapped'
    reasons.push('industry_proxy_fallback')
    score -= 0.1
  } else if (!resolvedIndustry) {
    status = status === 'ambiguous' ? 'ambiguous' : 'unresolved'
  } else if (status !== 'ambiguous') {
    status = 'canonicalized'
  }

  if (isEtf || isAdr) {
    score -= 0.1
    reasons.push(isEtf ? 'etf_instrument' : 'adr_instrument')
  }

  score = clampScore(score)
  const level = scoreToLevel(score)

  if (level === 'low' && status === 'canonicalized') {
    status = 'ambiguous'
    reasons.push('low_confidence_score')
  }

  const reviewNeeded = status === 'unresolved' || status === 'ambiguous' || level === 'low'

  return {
    rawSector,
    rawIndustry,
    canonicalSector: resolvedSector,
    canonicalIndustry: resolvedIndustry,
    confidenceScore: score,
    confidenceLevel: level,
    classificationSource: source,
    classificationStatus: status,
    classificationReason: reasons.length ? reasons.join(',') : null,
    reviewNeeded,
  }
}
