# WSP Diagnostic Fix Package
**Datum:** 2026-05-06 · **Mål:** Få wsp.keenlabs.pro från "data flödar men inga signaler" → "actionable produkt"

---

## Hur du använder det här dokumentet

Fem prompts. Varje är självständig och kan klistras in direkt i Lovable. **Kör dem en åt gången** och verifiera resultatet innan nästa.

**Rekommenderad ordning:**
1. **Fix #1** (KÖP-gates) — högst impact, ingen ny infrastruktur
2. **Fix #3** ("Ledande sektorer") — snabb diagnos, troligen 1-rads-fix
3. **Fix #2** (Konsolidera sektor-RPCs) — kräver lite mer omsorg
4. **Fix #5** (GICS coverage push) — bara körning, ingen kodändring
5. **Fix #4** (Parity validation) — diagnostiskt, kan ta längst

**Innan du kör någon prompt:** verifiera att senaste Hard Refresh gick igenom (Admin-sidan, sektion A). Om partial_rebuild:s parity-fel blockerar kanonisk publish behöver Fix #4 köras först.

---

## Kritisk kontext att klistra in högst upp i varje Lovable-session

```
Det här projektet har 137 SQL-migreringar och tre parallella sektor-RPCs som returnerar olika tal. Det är resultat av att Lovable tidigare lagt till nya implementationer istället för att modifiera befintliga.

REGLER FÖR DEN HÄR SESSIONEN:
1. Skapa INGA nya RPCs eller edge functions om en befintlig kan modifieras
2. Skapa INGA filer med suffix "_v2", "_new", "_fixed"
3. Om en befintlig funktion har fel logik — skriv om den IN PLACE med CREATE OR REPLACE
4. Lägg INTE till nya kolumner till tabeller om problemet kan lösas i en RPC
5. Om jag ber dig fixa en sak, ändra INGET annat. Behåll alla andra funktioner och policies exakt som de är.
6. Visa ALLTID den fullständiga gamla CREATE OR REPLACE och den nya så jag kan diffa
```

---

# FIX #1 — Lossa KÖP-gates (HÖGST IMPACT)

## Problem

Screener visar 1 015 aktier. **Noll har KÖP-signal.** Topp-aktier (ADEA, ANDE, ASTE) har 5/5 WSP-score, mönster CLIMBING, men signal = BEVAKA.

## Diagnos

I `run_broad_market_scan` (senaste i `supabase/migrations/20260413104533_*.sql`):

```sql
ELSIF v_pattern IN ('climbing', 'base')
      AND v_score = 5
      AND v_breakout_detected
      AND v_breakout_status IN ('FRESH_BREAKOUT', 'AGING_BREAKOUT')
THEN
  v_recommendation := 'KÖP';
```

Och `v_breakout_detected` kräver:
- `v_close > v_resistance_level * 1.02` (close minst 2% över resistance)
- `v_volume_ratio >= 2.0` (volym minst 2x snitt)

I nuvarande marknad träffar nästan ingen aktie alla tre samtidigt: score=5, breakout-confirmed, OCH volume 2x. Stocks som ADEA (score 5/5, climbing, vol 4.7x men close ej över resistance*1.02) blir BEVAKA istället för KÖP.

## Beslut taget (2026-05-06, efter doktrin-genomgång)

Efter genomläsning av WSP-doktrinen (Ultimate Checklist + Workbook): **KÖP-gaten är doktrinellt KORREKT som den är.** Doktrin §2.2 kräver alla entry criteria inklusive confirmed breakout med 2x+ volym. Att 0 KÖP visas idag betyder antingen att marknaden saknar färska breakouts (vilket doktrin §2.7 explicit accepterar — "better to be late than chase"), eller att breakout-detektionen själv har en bug.

**Det viktiga jag missade i förra prompten:** doktrin §2.3 specificerar en operativ workflow med **Buy Stop Limit Order GTC** — du sätter köpordern OVAN resistance och låter den triggea automatiskt när breakout sker. Det betyder att "PRIMED setups som du sätter buy stop på i förväg" är operationellt lika viktiga som "redan triggade breakouts". Scannerns saknade tier är inte en uppmjukad KÖP — det är en separat operativ kategori som doktrinen explicit kräver.

**Vald väg: PRIMED-tier med doktrin-aligned schema** (suggested_buy_stop_price + suggested_stop_loss). Doktrin-citationer: §2.3 (Buy Stop Limit GTC), §2.5 (Stop Loss Placement).

---

## Prompten (PRIMED-tier, doktrin-aligned)

```
DOKTRIN-CONTEXT: Wall Street Protocol §2.3 specificerar workflow där traders sätter Buy Stop Limit Order GTC OVAN resistance och låter ordern triggea när breakout sker. För att stödja det måste scannern surfacera "PRIMED setups" — stocks som möter alla doktrin-criteria UTOM confirmed breakout, plus suggested buy stop + suggested stop loss per §2.5.

ÄNDRING 1: SQL — `run_broad_market_scan` i public-schemat (CREATE OR REPLACE).

Lägg till ny gren i CASE-uttrycket som sätter v_recommendation. Placera den EFTER 'KÖP'-grenen och FÖRE 'tired'→'SÄLJ'-grenen:

ELSIF v_pattern IN ('climbing', 'base')
      AND v_score >= 4
      AND COALESCE(v_above_ma50, false)
      AND COALESCE(v_above_ma150, false)
      AND v_ma50_slope = 'rising'
      AND COALESCE(v_mansfield_rs, 0) > 0
      AND v_breakout_status IN ('APPROACHING', 'NONE')
THEN
  v_recommendation := 'PRIMED';

DOKTRIN-MAPPNING (citera i SQL-kommentar):
- pattern climbing/base → §2.1 (never buy in tired/downhill)
- score >= 4 → strukturell kvalitetsfilter
- above_ma50 + above_ma150 + ma50_slope=rising → §2.2.2
- mansfield_rs > 0 → §2.2.4
- breakout_status APPROACHING/NONE → distinguishes from KÖP (which requires FRESH/AGING_BREAKOUT)

KÖP-grenen är OFÖRÄNDRAD. Den fortsätter att kräva v_score = 5 + v_breakout_detected + status FRESH/AGING_BREAKOUT.

ÄNDRING 2: SQL — utöka market_scan_results-schemat med två nya kolumner.

Doktrin §2.5 stop placement måste exponeras direkt i UI:n. Lägg till i NY migration:

ALTER TABLE public.market_scan_results 
  ADD COLUMN IF NOT EXISTS suggested_buy_stop numeric,
  ADD COLUMN IF NOT EXISTS suggested_stop_loss numeric;

I `run_broad_market_scan`-loopen, beräkna och inkludera båda i INSERT:

-- Doktrin §2.3: buy stop slightly above resistance (0.5% buffer)
-- Doktrin §2.5: stop loss 5% below entry (mid-range of doctrine 4-6%)
IF v_recommendation IN ('PRIMED', 'KÖP') AND v_resistance_level IS NOT NULL AND v_resistance_level > 0 THEN
  v_suggested_buy_stop := ROUND((v_resistance_level * 1.005)::numeric, 2);
  IF v_recommendation = 'PRIMED' THEN
    v_suggested_stop_loss := ROUND((v_suggested_buy_stop * 0.95)::numeric, 2);
  ELSE  -- KÖP, redan triggat: stop relativt nuvarande close
    v_suggested_stop_loss := ROUND((v_close * 0.95)::numeric, 2);
  END IF;
END IF;

Lägg till `v_suggested_buy_stop numeric` och `v_suggested_stop_loss numeric` i DECLARE-blocket. Lägg till båda kolumnerna i INSERT INTO market_scan_results-statementet.

ÄNDRING 3: Frontend — RecommendationBadge.

I src/components/RecommendationBadge.tsx, lägg till variant för 'PRIMED':
- Färg: blå (text-blue-500 bg-blue-500/10 border-blue-500/30)
- Tooltip: "Möter alla doktrin-villkor utom confirmed breakout. Placera Buy Stop Limit GTC ovanför resistance per §2.3."
- Visuell hierarki (top→bottom): KÖP (grön) → PRIMED (blå) → BEVAKA (gul) → UNDVIK (grå) → SÄLJ (röd)

I src/lib/wsp-types.ts, om Recommendation är en union type, lägg till 'PRIMED' som giltigt värde.

ÄNDRING 4: Frontend — Screener-tabellens kolumner.

I src/components/StockTable.tsx, för rader med signal PRIMED eller KÖP där suggested_buy_stop IS NOT NULL, visa under SIGNAL-badgen:
- "BUY @ $XXX.XX" (suggested_buy_stop) i mindre text
- "STOP @ $XXX.XX" (suggested_stop_loss) i mindre text, röd

Visa endast om värdena finns. För andra signaler (BEVAKA, UNDVIK, SÄLJ): inga extra rader.

DO NOT:
- Ändra KÖP-kriterierna
- Ändra v_breakout_detected-beräkningen
- Ändra blockers-arrayen (den ska fortfarande visa "no_breakout" som upplysande info för PRIMED-rader — det är inte ett fel, det är "därför det är PRIMED och inte KÖP")
- Skapa en ny migration för att skapa en ny funktion — använd CREATE OR REPLACE
- Lägg till intraday-data i beräkningarna (doktrinen är daily-close-baserad per §4 i context.md)
- Sätta hårda position size-rekommendationer i scannern — det tillhör Micro Agent (ej byggd än, se agents.md)

VERIFIKATION efter deploy:
1. Kör Hard Refresh på Admin-sidan
2. Räkna signaler:
   SELECT recommendation, COUNT(*) FROM market_scan_results_latest GROUP BY recommendation ORDER BY 2 DESC;
   Förväntat: PRIMED > 50 (sannolikt 100-300). KÖP fortsatt 0 eller låg (det är doktrin-korrekt).
3. Verifiera buy stop / stop loss för 20 rader:
   SELECT symbol, recommendation, close, resistance_level, suggested_buy_stop, suggested_stop_loss
   FROM market_scan_results_latest
   WHERE recommendation IN ('PRIMED', 'KÖP')
   LIMIT 20;
   Förväntat: suggested_buy_stop ≈ resistance * 1.005, suggested_stop_loss ≈ buy_stop * 0.95
4. UI: filtrera Screener på Signal=PRIMED. Förväntat: ADEA, ANDE, ASTE etc visas med "BUY @ $XX" och "STOP @ $XX" raderna.
```

---

# FIX #2 — Konsolidera sektor-RPCs

## Problem

Tre RPCs aggregerar samma underliggande data men returnerar olika antal aktier per sektor:

| RPC | Financials count | Filter |
|---|---|---|
| `get_sector_ranking` (wrapper) | 930 | wrappar get_market_summary |
| `get_market_summary` | 1 918 | inkluderar troligen ETFs/benchmarks |
| `get_sector_performance` | (egen) | exkluderar ETFs och universe_tier='benchmark' |

Dashboard, Sectors-sidan, och Market Summary-sidan visar olika tal för samma sektor. Användaren tappar förtroendet.

## Prompten

```
Vi har tre RPCs som aggregerar sektordata och returnerar olika tal för samma sektor:
- get_sector_ranking (wrapper runt get_market_summary)
- get_market_summary
- get_sector_performance (egen filterlogik som exkluderar ETFs/benchmarks)

MÅL: get_sector_performance har den korrekta filterlogiken (exkluderar ETFs och benchmarks). Vi vill att alla tre RPCs returnerar samma underliggande aktiepopulation.

KONKRETA ÄNDRINGAR:

1. Modifiera `get_market_summary` (CREATE OR REPLACE i ny migration) så att dess WITH-klausul använder samma filter som get_sector_performance:
   - WHERE s.canonical_sector IN (SELECT sector_name FROM canonical_gics_sectors)
   - AND s.is_etf IS NOT TRUE
   - AND s.universe_tier != 'benchmark'
   
   Behåll alla returkolumner exakt som de är (sector_name, stock_count, avg_pct_today, pct_above_ma50, wsp_regime, wsp_setups, avg_score, dominant_pattern). Ändra BARA filtret i WITH-klausulen.

2. get_sector_ranking är redan en wrapper runt get_market_summary — den ärver fixen automatiskt och behöver INTE modifieras.

3. get_sector_performance har redan rätt filter — lämna oförändrad.

4. EFTER ändringen: bekräfta att alla tre RPCs returnerar samma stock_count per sektor genom att köra:

```sql
SELECT 
  ms.sector_name,
  ms.stock_count AS market_summary_count,
  sp.stock_count AS sector_performance_count,
  sr.symbol_count AS sector_ranking_count
FROM get_market_summary() ms
LEFT JOIN get_sector_performance() sp ON sp.sector_name = ms.sector_name
LEFT JOIN get_sector_ranking() sr ON sr.sector_name = ms.sector_name
ORDER BY ms.sector_name;
```

Alla tre count-kolumner ska vara identiska per sektor.

DO NOT:
- Skapa get_market_summary_v2 eller liknande — använd CREATE OR REPLACE
- Skapa en ny "kanonisk" RPC. Vi behåller alla tre, men de delar nu samma underliggande population.
- Ändra något i frontend (Sectors.tsx, Index.tsx, MarketSummary.tsx) — UI-koden förblir densamma
- Lägg till nya kolumner till någon RPC

VERIFIKATION:
1. Hard Refresh på Admin
2. Jämför Dashboard "Sektorranking" Financials count med Market Summary "Financials" — ska vara samma siffra
3. Jämför Sectors-sidans Financials count — ska också vara samma
```

---

# FIX #3 — "Ledande sektorer" säger 0 trots Bullish-sektorer

## Problem

Dashboard visar "**0 av 11 sektorer ledande**" trots att Energy, Materials är klassade Bullish och har bredd över 70%.

## Diagnos

`get_sector_ranking()` returnerar `is_leading`:

```sql
(b.wsp_regime IN ('Bullish','Neutral') AND b.pct_above_ma50 >= 45) AS is_leading
```

Sectors-sidan visar:
- Utilities: Neutral, 68% bredd → ska vara `is_leading=true` ✓
- Materials: Bullish, 71% bredd → ska vara `is_leading=true` ✓
- Energy: Bullish, 72% bredd → ska vara `is_leading=true` ✓
- IT: Neutral, 60% bredd → ska vara `is_leading=true` ✓

Minst 4 ska vara leading. Dashboard visar 0. Antingen:
- (a) `useSectorRanking()` hook tappar bort `is_leading`-fältet i mappingen
- (b) Dashboard läser från fel källa
- (c) `get_sector_ranking` returnerar faktiskt 0 leading (regimkriteriet 'Neutral' kanske är för strikt om de flesta nu är Neutral)

## Prompten

```
Dashboard-sidan (src/pages/Index.tsx) visar "0 av 11 sektorer ledande" trots att Sectors-sidan visar 4+ sektorer som ska vara leading enligt definitionen i get_sector_ranking (wsp_regime IN Bullish/Neutral AND pct_above_ma50 >= 45).

DIAGNOS-STEG som du ska köra och rapportera tillbaka INNAN du ändrar något:

1. Kör i SQL editor: 
   SELECT sector_name, wsp_regime, pct_above_ma50, is_leading 
   FROM get_sector_ranking() 
   ORDER BY rank_position;
   
   Visa output. Hur många rader har is_leading=true?

2. Öppna src/hooks/use-sector-ranking.ts. Visa innehållet. Mappar hooken `is_leading` korrekt från RPC-responsen?

3. Öppna src/pages/Index.tsx, hitta raden:
   `const leadingSectors = useMemo(() => sectorRanking.filter((s) => s.is_leading), [sectorRanking]);`
   
   Är `s.is_leading` rätt fältnamn givet vad hooken returnerar?

NÄR DU HAR DIAGNOSEN: rapportera fyndet. Föreslå sedan en minimal fix som matchar fyndet:

- Om RPC returnerar 0 leading: definitionen i get_sector_ranking måste justeras — sannolikt lägga till "OR (regime='Neutral' AND avg_pct_today > 0)" eller liknande
- Om hooken tappar is_leading: fixa mappingen i use-sector-ranking.ts
- Om Index.tsx läser fel fält: fixa fältnamnet

DO NOT:
- Skapa en ny "leading sectors"-RPC
- Ändra definitionen av is_leading om diagnos visar att hooken tappar fältet
- Ändra något i Sectors.tsx (den fungerar redan)
- Lägga till nya kolumner till någon tabell

VERIFIKATION efter fix:
- Dashboard-sidan visar "X av 11 sektorer ledande" där X >= 3 i nuvarande marknad
- Listan av leading sectors innehåller åtminstone Energy och Materials (de är Bullish med högst bredd)
```

---

# FIX #4 — Parity Validation Failed (diagnostisk)

## Problem

Admin → sektion E "Pipeline Runs" visar:
- Alla 5 senaste `partial_rebuild`-körningar har failed med "Parity validation failed"
- Senaste lyckade rebuild är okänt (visas inte i listan)

Det betyder att inkrementella publiceringar är trasiga. Du är beroende av Hard Refresh varje gång, vilket tappar fördelen med doctrine-pipelinen.

## Prompten (diagnostisk — denna kanske kräver två rundor)

```
Pipeline-runs av typen `partial_rebuild` har failat 5 gånger i rad med error "Parity validation failed". Vi behöver först förstå exakt vilken parity-check som triggar.

DIAGNOS-STEG (rapportera tillbaka, ändra inget än):

1. Hitta filen som implementerar partial_rebuild. Sannolikt en av:
   - supabase/functions/admin-pipeline/index.ts
   - supabase/functions/bootstrap-orchestrator/index.ts
   - Eller en SQL-funktion som heter något i stil med partial_rebuild_snapshot eller validate_canonical_parity

2. Hitta den specifika parity-checken som kastar "Parity validation failed". Visa kodblocket.

3. Lista vilka tabeller/views/RPCs som jämförs i parity-checken. Typiskt jämförs:
   - Public snapshot vs underlying source (typ market_scan_results_latest vs equity_canonical_snapshot)
   - Counts per dimension (sektor, industri, recommendation)
   - Hash av key fields per row

4. Kör manuellt det jämförelse-query som parity-checken använder OCH visa diff. Var skiljer sig public snapshot från source?

NÄR DU HAR DIAGNOSEN: föreslå en fix som antingen:
(a) Reparerar källan om snapshotten är korrekt
(b) Republicerar snapshotten om källan är korrekt  
(c) Justerar parity-toleransen om diff är legitim (typ: 1-2 row drift accepterat)

DO NOT:
- Ta bort parity-checken
- Marka partial_rebuild som "deprecated" och rekommendera Hard Refresh — det skulle vara kapitulation
- Skapa en ny edge function — modifiera den befintliga
- Disabla validation överlag

VERIFIKATION efter fix:
- Trigga manuellt en partial_rebuild
- Status ska bli "success", inte "failed"
- Sektion E ska visa minst 1 lyckad rebuild i listan
```

---

# FIX #5 — GICS Coverage Push (5 613 oklassificerade)

## Problem

Pipeline Coverage på Admin-sidan visar:
- 7 356 equity i universe (ej ETF/benchmark)
- 1 743 har canonical industry (24%)
- **5 613 saknar canonical GICS industry**
- Resultat: bara 1 289 (18%) når "publicly eligible"

Doctrine-modulerna i Module Dataflow Tracker visar `0 runs / 24h` för GICS Classifier — den körs inte automatiskt.

## Prompten

```
Vi behöver klassificera de 5 613 equity-symbolerna som saknar canonical_industry. bulk-enrich-sectors edge function finns redan och har en multi-source fallback chain (Polygon → Finnhub → Yahoo → Alpaca).

KONKRET HANDLING:

1. Kontrollera att Admin-sidan har en "Bulk Enrich" knapp (sektion F → "Bulk Metadata Enrichment (Polygon)" → "Starta Bulk Enrich"). Om den finns: testa att köra den manuellt och rapportera vad responsen säger.

2. Om bulk-enrich behöver veta vilka symboler den ska processa, kontrollera urvalslogiken i supabase/functions/bulk-enrich-sectors/index.ts. Den ska prioritera symboler där:
   - is_active = true
   - is_etf IS NOT true
   - canonical_industry IS NULL
   - support_level NOT IN ('excluded', 'etf_excluded')

3. bulk-enrich processerar 100 symboler per invocation (DB_BATCH_SIZE = 100, MAX_EXECUTION_MS = 55_000). För 5 613 symboler behövs ~57 invocations. 

4. Lägg till en "Auto-loop" toggle i Admin-sidan bredvid Bulk Enrich-knappen. När aktiverad, anropar UI:n bulk-enrich-sectors var 60:e sekund tills SQL-räknaren visar att alla 5 613 är processade. Visa progress: "Processed X / 5613 (Y new classified)".

5. Lägg till SQL för progress-räknare:

```sql
CREATE OR REPLACE FUNCTION public.get_classification_coverage()
RETURNS TABLE(
  total_equity bigint,
  classified bigint,
  unclassified bigint,
  pct_classified numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COUNT(*) FILTER (WHERE is_active = true AND is_etf IS NOT true AND support_level NOT IN ('excluded','etf_excluded'))::bigint AS total_equity,
    COUNT(*) FILTER (WHERE is_active = true AND is_etf IS NOT true AND canonical_industry IS NOT NULL AND support_level NOT IN ('excluded','etf_excluded'))::bigint AS classified,
    COUNT(*) FILTER (WHERE is_active = true AND is_etf IS NOT true AND canonical_industry IS NULL AND support_level NOT IN ('excluded','etf_excluded'))::bigint AS unclassified,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE is_active = true AND is_etf IS NOT true AND canonical_industry IS NOT NULL AND support_level NOT IN ('excluded','etf_excluded'))::numeric
      / NULLIF(COUNT(*) FILTER (WHERE is_active = true AND is_etf IS NOT true AND support_level NOT IN ('excluded','etf_excluded')), 0)::numeric,
      1
    ) AS pct_classified
  FROM symbols;
$$;
```

DO NOT:
- Skapa en ny edge function (bulk-enrich-sectors finns redan)
- Ändra classification-mappingen i _shared/classification.ts (det är doctrine-källkod)
- Disabla guard-triggern trg_enforce_canonical_gics — symboler som inte kan mappas ska landa i doctrine_failures, inte tvingas in
- Köra på alla 10 653 active symbols — bara på equity (is_etf IS NOT true)

VERIFIKATION:
- Före: SELECT * FROM get_classification_coverage(); — pct_classified ~24%
- Efter auto-loop kört klart: pct_classified > 75%
- Pipeline Coverage på Admin-sidan: "Med indikatorer" / "WSP-utvärderad" / "Publik Eligible" siffror ska öka proportionellt
- Doctrine Failures-widgeten kan visa fler failures (det är förväntat — symbols som inte kan klassificeras genom någon källa landar där och behöver manuell granskning)
```

---

## Efter alla fem fixes — verifieringschecklista

Kör Hard Refresh på Admin-sidan, vänta tills alla 6 steg gröna, gå sedan igenom:

| Vad | Förväntat efter fix | Före fix |
|---|---|---|
| Screener: rader med signal PRIMED eller KÖP | > 50 (sannolikt 100-300 PRIMED) | 0 |
| Screener: BUY @ och STOP @ visas under PRIMED-rader | ✓ | saknas |
| Dashboard: "X av 11 sektorer ledande" | X >= 3 | 0 av 11 |
| Dashboard Financials count vs Sectors-sidan vs Market Summary | identiska | 1918 / 930 / 930 |
| Pipeline Coverage: kanonisk industri-täckning | > 75% | 24% |
| Pipeline Coverage: publik eligible-population | > 4000 | 1289 |
| Sektion E Pipeline Runs: minst 1 successful partial_rebuild | ✓ | 5 failed i rad |

---

## Vad du INTE ska göra efter detta

När de fem fixes är inne — **stanna**. Sluta lägga till features. Använd produkten själv i två veckor och samla en lista över vad som faktiskt stör dig i daglig användning. Den listan blir nästa iteration. 

Lägg inte till:
- Backtest-modulen i UI (den finns i Python-koden — låt den vara där)
- Watchlist-funktionalitet (sidan finns men är värdelös utan beslutsstöd)
- Ny "doctrine"-infrastruktur (compliance score är redan 100/100)
- Nya datakällor (du har Polygon, Finnhub, Yahoo, Alpaca — det räcker)
- Användarautentisering eller credits-system (om du inte har tre betalande användare som väntar)

**Strategiska påminnelsen:** ai.keenlabs.pro:s build-debug är fortfarande den mest brådskande grejen. WSP är "personligt verktyg som funkar bra nog" efter dessa fem fixes. Inte mer.
