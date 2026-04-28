// Strict GICS classification — output values MUST match canonical_gics_sectors
// and canonical_gics_industries tables, otherwise the DB trigger
// `enforce_canonical_gics_taxonomy` will reject the row.

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

// ============================================================
// Strict GICS canonical lists (mirrors DB tables)
// ============================================================
const GICS_SECTORS = new Set([
  'Energy','Materials','Industrials','Consumer Discretionary','Consumer Staples',
  'Health Care','Financials','Information Technology','Communication Services',
  'Utilities','Real Estate',
])

const GICS_INDUSTRIES = new Set([
  // Energy (10)
  'Energy Equipment & Services','Oil, Gas & Consumable Fuels',
  // Materials (15)
  'Chemicals','Construction Materials','Containers & Packaging','Metals & Mining','Paper & Forest Products',
  // Industrials (20)
  'Aerospace & Defense','Air Freight & Logistics','Building Products','Commercial Services & Supplies',
  'Construction & Engineering','Electrical Equipment','Ground Transportation','Industrial Conglomerates',
  'Machinery','Marine Transportation','Passenger Airlines','Professional Services',
  'Trading Companies & Distributors','Transportation Infrastructure',
  // Consumer Discretionary (25)
  'Automobile Components','Automobiles','Broadline Retail','Distributors','Diversified Consumer Services',
  'Hotels, Restaurants & Leisure','Household Durables','Leisure Products','Specialty Retail',
  'Textiles, Apparel & Luxury Goods',
  // Consumer Staples (30)
  'Beverages','Consumer Staples Distribution & Retail','Food Products','Household Products',
  'Personal Care Products','Tobacco',
  // Health Care (35)
  'Biotechnology','Health Care Equipment & Supplies','Health Care Providers & Services',
  'Health Care Technology','Life Sciences Tools & Services','Pharmaceuticals',
  // Financials (40)
  'Banks','Capital Markets','Consumer Finance','Diversified Financial Services','Financial Services',
  'Insurance','Mortgage Real Estate Investment Trusts (Mortgage REITs)','Thrifts & Mortgage Finance',
  // Information Technology (45)
  'Communications Equipment','Electronic Equipment, Instruments & Components','IT Services',
  'Semiconductors & Semiconductor Equipment','Software','Technology Hardware, Storage & Peripherals',
  // Communication Services (50)
  'Diversified Telecommunication Services','Entertainment','Interactive Media & Services','Media',
  'Wireless Telecommunication Services',
  // Utilities (55)
  'Electric Utilities','Gas Utilities','Independent Power and Renewable Electricity Producers',
  'Multi-Utilities','Water Utilities',
  // Real Estate (60)
  'Equity Real Estate Investment Trusts (Equity REITs)','Real Estate Management & Development',
])

// Maps any incoming sector label (lowercase) to canonical GICS sector
const SECTOR_TO_GICS: Record<string, string> = {
  // Direct
  'energy': 'Energy',
  'materials': 'Materials',
  'basic materials': 'Materials',
  'industrials': 'Industrials',
  'consumer discretionary': 'Consumer Discretionary',
  'consumer cyclical': 'Consumer Discretionary',
  'consumer staples': 'Consumer Staples',
  'consumer defensive': 'Consumer Staples',
  'health care': 'Health Care',
  'healthcare': 'Health Care',
  'financials': 'Financials',
  'financial services': 'Financials',
  'information technology': 'Information Technology',
  'technology': 'Information Technology',
  'communication services': 'Communication Services',
  'communications': 'Communication Services',
  'utilities': 'Utilities',
  'real estate': 'Real Estate',
  // Sub-labels
  'banking': 'Financials',
  'banks': 'Financials',
  'insurance': 'Financials',
  'biotechnology': 'Health Care',
  'pharmaceuticals': 'Health Care',
  'semiconductors': 'Information Technology',
  'software': 'Information Technology',
  'media': 'Communication Services',
  'telecommunication': 'Communication Services',
  'telecom': 'Communication Services',
  'metals & mining': 'Materials',
  'metals mining': 'Materials',
  'chemicals': 'Materials',
  'retail': 'Consumer Discretionary',
  'automobiles': 'Consumer Discretionary',
  'food products': 'Consumer Staples',
  'beverages': 'Consumer Staples',
  'aerospace defense': 'Industrials',
  'machinery': 'Industrials',
}

// SIC 2-digit prefix → canonical GICS sector
const SIC_SECTOR_MAP: Record<string, string> = {
  '01':'Materials','02':'Materials','07':'Materials','08':'Materials','09':'Materials',
  '10':'Energy','12':'Energy','13':'Energy','14':'Materials',
  '15':'Industrials','16':'Industrials','17':'Industrials',
  '20':'Consumer Staples','21':'Consumer Staples',
  '22':'Consumer Discretionary','23':'Consumer Discretionary',
  '24':'Materials','25':'Consumer Discretionary','26':'Materials',
  '27':'Communication Services','28':'Health Care','29':'Energy','30':'Materials',
  '31':'Consumer Discretionary','32':'Materials','33':'Materials',
  '34':'Industrials','35':'Information Technology','36':'Information Technology',
  '37':'Industrials','38':'Health Care','39':'Consumer Discretionary',
  '40':'Industrials','41':'Industrials','42':'Industrials',
  '43':'Communication Services','44':'Industrials','45':'Industrials',
  '46':'Industrials','47':'Industrials','48':'Communication Services',
  '49':'Utilities','50':'Consumer Discretionary','51':'Consumer Staples',
  '52':'Consumer Discretionary','53':'Consumer Discretionary','54':'Consumer Staples',
  '55':'Consumer Discretionary','56':'Consumer Discretionary','57':'Consumer Discretionary',
  '58':'Consumer Discretionary','59':'Consumer Discretionary',
  '60':'Financials','61':'Financials','62':'Financials','63':'Financials','64':'Financials',
  '65':'Real Estate','67':'Financials',
  '70':'Consumer Discretionary','72':'Consumer Discretionary','73':'Information Technology',
  '75':'Consumer Discretionary','76':'Industrials','78':'Communication Services',
  '79':'Communication Services','80':'Health Care','81':'Information Technology',
  '82':'Consumer Discretionary','83':'Consumer Discretionary','84':'Consumer Discretionary',
  '86':'Consumer Discretionary','87':'Information Technology','89':'Information Technology',
  '91':'Industrials','92':'Industrials','93':'Industrials','94':'Industrials',
  '95':'Industrials','96':'Industrials','97':'Industrials','99':'Industrials',
}

// Industry label aliases (incoming raw → canonical GICS industry)
const INDUSTRY_ALIASES: Record<string, string> = {
  'metals mining': 'Metals & Mining',
  'oil gas consumable fuels': 'Oil, Gas & Consumable Fuels',
  'aerospace defense': 'Aerospace & Defense',
  'hotels restaurants leisure': 'Hotels, Restaurants & Leisure',
  'textiles apparel luxury goods': 'Textiles, Apparel & Luxury Goods',
  'paper forest products': 'Paper & Forest Products',
  'paper forest': 'Paper & Forest Products',
  'building products': 'Building Products',
  'commercial services supplies': 'Commercial Services & Supplies',
  'construction engineering': 'Construction & Engineering',
  'electrical equipment': 'Electrical Equipment',
  'ground transportation': 'Ground Transportation',
  'road rail': 'Ground Transportation',
  'industrial conglomerates': 'Industrial Conglomerates',
  'machinery': 'Machinery',
  'marine transportation': 'Marine Transportation',
  'marine': 'Marine Transportation',
  'passenger airlines': 'Passenger Airlines',
  'airlines': 'Passenger Airlines',
  'professional services': 'Professional Services',
  'trading companies distributors': 'Trading Companies & Distributors',
  'transportation infrastructure': 'Transportation Infrastructure',
  'logistics transportation': 'Air Freight & Logistics',
  'air freight logistics': 'Air Freight & Logistics',
  'automobile components': 'Automobile Components',
  'auto components': 'Automobile Components',
  'automobiles': 'Automobiles',
  'broadline retail': 'Broadline Retail',
  'retail': 'Specialty Retail',
  'distributors': 'Distributors',
  'diversified consumer services': 'Diversified Consumer Services',
  'household durables': 'Household Durables',
  'leisure products': 'Leisure Products',
  'specialty retail': 'Specialty Retail',
  'beverages': 'Beverages',
  'consumer staples distribution retail': 'Consumer Staples Distribution & Retail',
  'food products': 'Food Products',
  'household products': 'Household Products',
  'personal care products': 'Personal Care Products',
  'tobacco': 'Tobacco',
  'biotechnology': 'Biotechnology',
  'health care equipment supplies': 'Health Care Equipment & Supplies',
  'health care providers services': 'Health Care Providers & Services',
  'health care technology': 'Health Care Technology',
  'life sciences tools services': 'Life Sciences Tools & Services',
  'pharmaceuticals': 'Pharmaceuticals',
  'banks': 'Banks',
  'banking': 'Banks',
  'capital markets': 'Capital Markets',
  'consumer finance': 'Consumer Finance',
  'diversified financial services': 'Diversified Financial Services',
  'financial services': 'Financial Services',
  'insurance': 'Insurance',
  'communications equipment': 'Communications Equipment',
  'communications': 'Communications Equipment',
  'electronic equipment instruments components': 'Electronic Equipment, Instruments & Components',
  'it services': 'IT Services',
  'semiconductors semiconductor equipment': 'Semiconductors & Semiconductor Equipment',
  'semiconductors': 'Semiconductors & Semiconductor Equipment',
  'software': 'Software',
  'technology hardware storage peripherals': 'Technology Hardware, Storage & Peripherals',
  'technology': 'Software',
  'diversified telecommunication services': 'Diversified Telecommunication Services',
  'telecommunication': 'Diversified Telecommunication Services',
  'entertainment': 'Entertainment',
  'interactive media services': 'Interactive Media & Services',
  'media': 'Media',
  'wireless telecommunication services': 'Wireless Telecommunication Services',
  'electric utilities': 'Electric Utilities',
  'gas utilities': 'Gas Utilities',
  'multi utilities': 'Multi-Utilities',
  'water utilities': 'Water Utilities',
  'real estate management development': 'Real Estate Management & Development',
  'real estate': 'Real Estate Management & Development',
  'utilities': 'Electric Utilities',
  'energy': 'Oil, Gas & Consumable Fuels',
  'chemicals': 'Chemicals',
  'construction': 'Construction & Engineering',
  'building': 'Building Products',
  'packaging': 'Containers & Packaging',
  'consumer products': 'Household Products',
  'health care': 'Health Care Providers & Services',
  'healthcare': 'Health Care Providers & Services',
}

const EXCHANGE_TRUST = new Set(['NYSE', 'NASDAQ'])

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function toCanonicalSector(raw: string | null | undefined): string | null {
  const normalized = normalizeText(raw)
  if (!normalized) return null
  if (GICS_SECTORS.has(normalized)) return normalized
  const slug = slugify(normalized)
  const mapped = SECTOR_TO_GICS[slug]
  return mapped && GICS_SECTORS.has(mapped) ? mapped : null
}

function toCanonicalIndustry(raw: string | null | undefined): string | null {
  const normalized = normalizeText(raw)
  if (!normalized) return null
  if (GICS_INDUSTRIES.has(normalized)) return normalized
  const slug = slugify(normalized)
  const mapped = INDUSTRY_ALIASES[slug]
  return mapped && GICS_INDUSTRIES.has(mapped) ? mapped : null
}

function sectorFromSic(sic: string | null | undefined): string | null {
  if (!sic) return null
  const prefix = String(sic).slice(0, 2)
  return SIC_SECTOR_MAP[prefix] ?? null
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
  const manualSector = toCanonicalSector(input.manualOverrideSector)
  const manualIndustry = toCanonicalIndustry(input.manualOverrideIndustry)

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

  // Strict GICS resolution
  const providerSector = toCanonicalSector(rawSector)
  const providerIndustry = toCanonicalIndustry(rawIndustry)
  const sicSector = sectorFromSic(input.sicCode)
  const sicIndustry = toCanonicalIndustry(input.sicDescription)

  const resolvedSector = providerSector ?? sicSector ?? null
  const resolvedIndustry = providerIndustry ?? sicIndustry ?? null

  const exchange = String(input.primaryExchange ?? input.exchange ?? '').toUpperCase()
  const isCommonStock = Boolean(input.isCommonStock)
  const isEtf = Boolean(input.isEtf)
  const isAdr = Boolean(input.isAdr)

  let score = 0
  const reasons: string[] = []
  let source = 'provider_raw'
  let status: ClassificationStatus = 'unresolved'

  if (resolvedSector) score += 0.4
  else reasons.push('missing_sector')

  if (resolvedIndustry) score += 0.4
  else reasons.push('missing_industry')

  if (isCommonStock) score += 0.1
  if (EXCHANGE_TRUST.has(exchange)) score += 0.08

  if (providerSector && sicSector && providerSector !== sicSector) {
    score -= 0.2
    reasons.push('sector_conflict_provider_vs_sic')
    status = 'ambiguous'
  }

  if (!providerSector && sicSector) {
    source = 'sic_proxy'
  }

  if (!resolvedSector) {
    status = 'unresolved'
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
