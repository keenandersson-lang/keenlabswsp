

## Diagnos: Varför universe coverage inte ökar

### Aktuell situation
- **10 653 aktiva symboler** totalt i `symbols`
- **Endast 2 136** har `eligible_for_backfill = true`
- **8 048 symboler** har `eligible_for_backfill = NULL` (aldrig klassificerade)
- **469** är explicit `false`
- **13 616 symboler** har redan priser i `daily_prices` (inkl. inaktiva/historiska)

### Rotorsaken
**`get_symbols_needing_backfill()` filtrerar på `eligible_for_backfill = true`**, så den ser bara ~2136 symboler som "kandidater". De flesta av dessa har redan priser → backfill-loopen gör ingenting nytt.

Bevis: De senaste 10 körningarna av `wsp_auto_backfill_loop` returnerar `status = 'skipped'` med 0 processed (inga symboler matchar kriterierna trots att 8000+ saknar data).

**Sekundär flaskhals**: Bootstrap-jobb #1 har stått fast på "2. Historical Backfill" sedan 22:57 (>22 timmar) — orkestratorn dispatchade 5 batches och väntar på att backfill-loopen ska bli klar, men loopen "skippar" hela tiden eftersom inga eligible-symboler saknar data.

### Pipeline för att fixa coverage

```text
[symbols] 10653 active
   ├── 2136 eligible=true   ← ENDAST dessa körs av backfill
   ├── 8048 eligible=NULL   ← BLOCKERAS (måste klassificeras först)
   └──  469 eligible=false  ← korrekt exkluderade

Lösning: kör enrich-symbols över NULL-batchen → sätt eligible_for_backfill
         → backfill-loopen plockar upp dem automatiskt
```

### Plan (3 steg)

**1. Lås upp universumet via metadata-enrichment**
- Skapa migration som expanderar `enrich_symbols_batch()`-loopen så NULL-symboler klassificeras (sätter `is_common_stock`, `canonical_sector`, `eligible_for_backfill`).
- Lägg till pg_cron-jobb `wsp_auto_enrich_loop` som var 5:e min kör enrichment över NULL-symboler tills 0 kvar (precis som backfill-loopen).

**2. Reparera fastnat bootstrap-jobb**
- Markera nuvarande job #1 som `failed` med felmeddelande "stuck on backfill — see auto-loop".
- Justera `bootstrap-orchestrator` så "Historical Backfill"-steget inte väntar oändligt: poll max 30 min, sen gå vidare till nästa steg om coverage > 95% av eligible-universumet (inte 100% av alla symboler).
- Lägg till "0. Universe Enrichment"-steg före backfill i `full`-mode så NULL-symboler klassificeras innan backfill startar.

**3. Visualisera blockad coverage i admin**
- Uppdatera `BootstrapPanel.tsx` så det visar 3 separata staplar:
  - `Klassificerade: 2605/10653` (eligible-beslut taget)
  - `Med priser: X/2136 eligible`
  - `Med indikatorer: Y/2136 eligible`
- Då blir det omedelbart synligt att flaskhalsen är klassificering, inte backfill.

### Tekniska detaljer
- Migration: ny `cron.schedule('wsp_auto_enrich_loop', '*/5 * * * *', ...)` som anropar `bulk-enrich-sectors` edge function via `net.http_post` med batch=100.
- Edge function `bootstrap-orchestrator/index.ts`: lägg till `enrich_universe`-steg och timeout-skydd på backfill-poll.
- `BootstrapPanel.tsx`: läs `symbols GROUP BY eligible_for_backfill` för coverage-staplar.

