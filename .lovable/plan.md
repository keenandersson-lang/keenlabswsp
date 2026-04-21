

## Plan: lås upp universe-pipelinen + admin-observability

### Rotorsak (verifierad nu)
- **10 034 av 10 653 symboler har redan `canonical_sector`** men `eligible_for_backfill = NULL`. Kandidat­filtret matchar dem ändå (via `eligible_for_backfill.is.null`), så loopen plockar samma rader varje varv.
- Av varje batch på 100 lyckas bara **5** (warrants/preferreds som AAPB/AAPD/etc har ingen källa). Resterande 95 markeras inte som "försökt" → hämtas igen om 2 min för evigt.
- Ingen `enriched_at`-touch vid fail → ingen "tail-skip".
- GLD/SLV/COPX m.fl. har `canonical_sector` men `support_level=NULL` → faller utanför daily-sync universe.

### Fixar (datalager + edge functions)

**1. Backfill-promotion-sweep (engångs-SQL via insert tool)**
- För alla rader med `canonical_sector NOT NULL/Unknown` och `eligible_for_backfill IS NULL`: kör om `classifyPromotion`-logiken i SQL → sätt `support_level`, `eligible_for_backfill`, `eligible_for_full_wsp`. Detta kommer omedelbart flytta ~7 800 symboler in i pipelinen utan en enda extern API-call.
- Sätt explicit `support_level='metals_limited'`, `eligible_for_backfill=true` på {GLD, SLV, COPX, GDX, PPLT, NEM, FCX} och liknande metals-tickers.

**2. `bulk-enrich-sectors`: stoppa retry-loopen**
- Snäva kandidatfiltret till **endast `canonical_sector IS NULL OR canonical_sector IN ('Unknown','','Stocks')`** (ta bort `eligible_for_backfill IS NULL`-klausulen — den räknas separat av promotion-sweepen).
- Vid `failed`: sätt `enriched_at = now()` och `classification_status='unresolvable_temp'` så att samma rader inte hämtas igen direkt.
- Lägg till en `.lt('enriched_at', now() - 24h)` ELLER `enriched_at IS NULL`-klausul för att respektera tail-skip.
- Efter **3 misslyckade försök** (spåras via `metadata.attempts` i en lättviktig `enrichment_attempts`-tabell): markera `classification_status='unresolvable'`, `eligible_for_backfill=false` permanent.

**3. `daily-sync`: höj fallback-cap + metals**
- `FALLBACK_CAP: 500 → 2000`.
- Inkludera alla `support_level IN ('metals_limited','sector_benchmark_proxy','full_wsp_equity','limited_equity')` i universe-querien (idag exkluderas metals tyst).
- Lägg till explicit metrik i `data_sync_log.metadata.fallback_recovered_per_source`.

**4. Watchdog + heartbeat (verifiering)**
- `bootstrap_jobs_watchdog` är redan skapad. Verifiera att `bootstrap-orchestrator` skriver `updated_at = now()` i en tight loop (var 30:e sek), inte bara vid stegbyte. Lägg till `heartbeat_at` om det saknas.

**5. Source Attribution-vy i admin**
- Ny RPC `get_source_attribution_24h()` läser `data_sync_log` för senaste 24h, summerar `metadata.source_attribution.{polygon,finnhub,yahoo,alpaca,none}` per dygn, returnerar success/total per källa.
- Ny komponent `SourceAttributionPanel.tsx` på `/admin`:
  - Stapeldiagram: symboler/källa senaste 24h.
  - Larm-pill (röd) om `failed/(success+failed) > 0.20` för en källa under senaste timmen.
  - Per-källa: senaste lyckade timestamp, total försök, success rate.

**6. Verifiering**
- Efter promotion-sweepen: `eligible_for_backfill=true` ska hoppa från 2 198 → ~9 800 omedelbart.
- Trigga ett `daily-sync`-anrop, kontrollera att `metadata.fallback_recovered_per_source` visar Alpaca + Yahoo träffar.
- Vänta 10 min, kontrollera att `bulk-enrich-sectors` nu landar på en ny uppsättning symboler (inte AAPB/AAPD igen) och att `unresolvable`-räknaren stiger.

### Tekniska detaljer
- Filer: `supabase/functions/bulk-enrich-sectors/index.ts`, `supabase/functions/daily-sync/index.ts`, `supabase/functions/bootstrap-orchestrator/index.ts`, `src/components/SourceAttributionPanel.tsx` (ny), `src/pages/Admin.tsx` (mountar panelen).
- Migrations: ny tabell `enrichment_attempts(symbol pk, attempts int, last_attempt_at, last_error)`; ny RPC `get_source_attribution_24h()`; engångs-UPDATE som promotion-sweepar 7 800 rader.
- Ingen UI-redesign, ingen WSP-logikändring.

### Förväntat utfall
- Inom **5 min**: `eligible_for_backfill=true` går från 2 198 → ~9 800.
- Inom **30 min**: `bulk-enrich-sectors` har slutat loopa AAPB/AAPD och betar av nya kandidater; `unresolvable`-räknaren stiger snabbt.
- Inom **24 h**: Source Attribution-panelen visar fördelning Polygon/Finnhub/Yahoo/Alpaca + larmar om någon källa går ner.
- Daily-sync återhämtar nu upp till 2 000 saknade symboler/dag via Alpaca+Yahoo, inkl. metals (GLD/SLV/COPX dagligen).

