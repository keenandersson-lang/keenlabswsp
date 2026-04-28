## Doktrin: WSP-systemets arkitektur (en gång för alla)

Detta blir den enda sanningen för hela kodbasen. All framtida utveckling ska respektera denna 5-modulskedja och får aldrig bryta mot den.

### Nuläge (verifierat just nu i DB)
- **10 653 symboler** i `symbols` (alla `us_equity`).
- Endast **2 644** har `canonical_industry` satt → 8 009 saknar industri.
- **40+ icke-kanoniska sektor-värden** finns idag i `canonical_sector` (t.ex. `Banking`, `Biotechnology`, `Healthcare`, `Technology`, `Stocks`, `ETF`, `Metals & Mining`, `N A`, `Media`, `Pharmaceuticals`). Detta bryter GICS 11-sektorskontraktet.
- **3 185 ETF:er** ligger med `canonical_sector='ETF'` — fel; de ska antingen vara `sector_benchmark_proxy` eller exkluderas helt.
- **782 symboler** har `Unknown` sektor + 100 har NULL.
- **9 670 har "någon" sektor men bara 2 025 är `eligible_for_full_wsp`** → enrichment har inte slutfört steg 5 (industri).

### Doktrinen — 5 moduler, sekventiellt beroende

```text
[1] DATA COLLECTOR        ──>  Polygon → Finnhub → Yahoo → Alpaca
        (multi-source)         OHLCV + corporate metadata, stabilized

[2] UNIVERSE BUILDER      ──>  Full US equity scan (NYSE+NASDAQ+AMEX)
        (symbols table)        is_active flagging, dedup, delisting cleanup

[3] COMPANY ENRICHMENT    ──>  Per ticker: name, market cap, description,
        (bolagsfakta)          SIC, primary exchange, asset type, news context

[4] GICS CLASSIFIER       ──>  STRICT 11 sectors / ~74 industries
        (kanonisk taxonomi)    NO aliases, NO legacy labels, NO "ETF" sector

[5] WSP PIPELINE          ──>  Indicators → Patterns → Scores → Scanner
        (existing engine)      Använder data från steg 1–4 som immutable input
```

**Hård regel:** Steg N får aldrig köras på data där steg N-1 är ofullständigt. Om en symbol saknar canonical industry → den får aldrig in i WSP-scannern.

### Vad som måste rensas / låsas (denna implementation)

#### A. Kanonisk GICS-tabell som enda källa
- `canonical_gics_sectors` (11 rader) och `canonical_gics_industries` (~74 rader) är redan skapade.
- Lägg en **CHECK-trigger** på `symbols.canonical_sector` som avvisar allt som inte finns i `canonical_gics_sectors.sector_name`. Samma för industri mot `canonical_gics_industries.industry_name`.
- Engångs-migration som mappar alla 40+ legacy-värden till korrekt GICS:
  - `Banking`, `Insurance` → `Financials`
  - `Biotechnology`, `Pharmaceuticals`, `Healthcare`, `Life Sciences Tools Services` → `Health Care`
  - `Technology`, `Semiconductors`, `Communications` → `Information Technology`
  - `Media`, `Telecommunication` → `Communication Services`
  - `Metals & Mining`, `Metals Mining`, `Chemicals`, `Paper Forest`, `Packaging` → `Materials`
  - `Retail`, `Hotels Restaurants Leisure`, `Automobiles`, `Auto Components`, `Leisure Products`, `Textiles Apparel Luxury Goods`, `Diversified Consumer Services` → `Consumer Discretionary`
  - `Food Products`, `Beverages`, `Consumer Products` → `Consumer Staples`
  - `Aerospace Defense`, `Machinery`, `Construction`, `Building`, `Marine`, `Airlines`, `Road Rail`, `Logistics Transportation`, `Transportation Infrastructure`, `Trading Companies Distributors`, `Distributors`, `Commercial Services Supplies`, `Professional Services`, `Electrical Equipment`, `Industrial Conglomerates` → `Industrials`
  - `Stocks`, `N A`, `ETF` → sätts till NULL och flaggas för omklassificering
- Industri-värden mappas via samma sweep mot `canonical_gics_industries`.

#### B. ETF-hantering (separat asset class)
- Alla 3 185 rader med `canonical_sector='ETF'` flyttas till `support_level='sector_benchmark_proxy'` om de är sektor-ETF:er (XLK, XLF, etc.) eller `support_level='etf_excluded'` annars.
- ETF:er får aldrig `canonical_sector='ETF'` — det är ett brott mot GICS.
- En whitelist av sektor-proxy-ETF:er (XLK, XLF, XLE, XLV, XLI, XLY, XLP, XLU, XLB, XLC, XLRE, SPY, QQQ, IWM, DIA) hårdkodas till `support_level='sector_benchmark_proxy'`.

#### C. Modul 3 (Company Enrichment) måste köra färdigt
- 8 009 symboler saknar industri → trigga `bulk-enrich-sectors` i kontinuerligt läge tills alla har **antingen** `canonical_industry` satt **eller** `classification_status='unresolvable'` permanent.
- Varje enrichment-call skriver: `name`, `market_cap` (ny kolumn), `description` (ny kolumn), `sic_code`, `is_etf`, `is_common_stock`, `canonical_sector`, `canonical_industry`, `classification_confidence_level`.
- Lägg till `market_cap bigint` och `description text` på `symbols` (saknas idag).

#### D. Modul 5 hård gate
- Skapa SQL-vy `wsp_eligible_universe` som **bara** returnerar symboler där:
  - `canonical_sector IN (SELECT sector_name FROM canonical_gics_sectors)` (strict 11)
  - `canonical_industry IN (SELECT industry_name FROM canonical_gics_industries)` (strict ~74)
  - `eligible_for_full_wsp = true`
  - `is_common_stock = true OR support_level = 'sector_benchmark_proxy'`
- `scan-market`, `wsp-screener`, alla downstream-RPC:er pekas om till denna vy. Inget annat får komma in.

#### E. Admin-doktrinpanel
- Ny komponent `DoctrineComplianceWidget` på `/admin` som visar:
  - Pipeline-funnel: Total → Universe Active → Enriched → Classified (GICS strict) → WSP Eligible.
  - Larm-pill röd om någon symbol har icke-kanonisk sektor/industri.
  - Per-modul status: senaste körning, success rate, blockers.

### Filer som ändras
- **Migration** (ny): kanoniska CHECK-triggers, legacy-mapping sweep, ETF-rensning, `market_cap`+`description` kolumner, vy `wsp_eligible_universe`.
- **`supabase/functions/bulk-enrich-sectors/index.ts`**: skriv `market_cap`, `description`; använd ENDAST kanoniska GICS-namn vid skrivning.
- **`supabase/functions/_shared/multi-source-enrich.ts`**: returnera kanoniska namn (mappa Polygon/Finnhub-värden internt).
- **`supabase/functions/scan-market/index.ts`** + **`wsp-screener/index.ts`**: läs från `wsp_eligible_universe`.
- **`src/components/DoctrineComplianceWidget.tsx`** (ny) + montering på `src/pages/Admin.tsx`.
- **`src/lib/market-normalization.ts`**: utöka alias-mappen att täcka alla 40+ legacy-värden.

### Förväntat utfall efter implementation
- **Steg 1 (omedelbart)**: Alla `canonical_sector`-värden tillhör de 11 GICS-sektorerna. Inga ETF:er ligger som "ETF"-sektor. Trigger förhindrar framtida drift.
- **Steg 2 (inom 24h)**: Modul 3 har körts färdigt → minst 90% av alla aktiva equities har både sektor OCH industri.
- **Steg 3 (kontinuerligt)**: Endast doktrintroget data flödar in i WSP-scannern. Doktrinpanelen visar grön status.

### Vad denna plan INTE gör
- Ingen ändring av WSP-logik (KÖP/BEVAKA-regler, MA50, Mansfield RS, etc.) — den är redan korrekt.
- Ingen UI-redesign utöver den nya admin-widgeten.
- Ingen ändring av asset classes utöver ETF-rensningen (crypto/metals fortsätter som tidigare).

Säg **godkänd** så implementerar jag hela kedjan: migration → enrichment-uppdatering → vy + gate → admin-widget. Detta cementerar doktrinen i databasen så ingen framtida kod kan bryta mot den.