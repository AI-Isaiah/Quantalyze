# Phase 210: PUBLICTRUTH — public factsheet cues come from real data only - Context

**Gathered:** 2026-11-14
**Status:** Ready for planning
**Mode:** autonomous smart discuss, run by a phase agent that cannot ask the founder. Every answer below is the recommended default, taken because it needs no founder judgement: each one follows the ROADMAP success criteria, the closing TODOS entry's own "Action" text, or an existing pattern in the code.

<domain>
## Phase Boundary

Three fixes to what a public factsheet and Discovery show. Each one stops a cue that is not backed by real data:

1. **Venues (`170.6.1-VENUES-CLOSED-KEY-WINDOWS`).** `get_published_trade_venues(uuid[])` (migration `20261019120000`) stops returning the venue of a `strategy_keys` member whose window has closed. A key rotation then cannot raise a false `Listed as X; trades come from Y, X.` cue.
2. **Demo payload (`193-DEMO-PAYLOAD-PRODUCERS`).** The factsheet payload's api arm stops computing and shipping `peerPercentile` (the seeded demo cohort) and `allocatorPortfolios` (demo blends). QUIETVIEW (Phase 193) removed only their render; the invented numbers still reach the client in the RSC payload and the cached payload.
3. **Gap record (`167.1.2.2.2-GAP-RECORD-SILENT-PARSE`).** A malformed `series_provenance.unrecovered_gaps` record is reported to Sentry, and the factsheet and tear sheet show an "unavailable" line. Today the page reads as if there were no gaps.

ROADMAP success criteria (quoted):
1. `get_published_trade_venues` filters closed key windows, so a key rotation does not raise a false venue-mismatch cue (migration reviewed by migration-reviewer and rls-policy-auditor).
2. No public payload carries invented peer or allocator data.
3. A malformed gap record reaches Sentry and the tear sheet withholds instead of claiming no gaps.
4. Each fix has a test that goes RED when it is reverted.

Out of scope: `eventSignatures` / `benchEventSignatures` (driven by real strategy and benchmark events, not demo data). The csv arm's `scenarioPeer` and `scenarioOwnBookDelta` (they rank against the real verified universe and the allocator's own book). Discovery's `getPercentiles` / `PeerRanksSection`.

</domain>

<decisions>
## Implementation Decisions

### D-01..D-06 — Venues: closed windows (SC-1)
- **D-01:** Restrict the `strategy_keys` arm to open windows: `sk.window_end IS NULL OR sk.window_end > current_date`. `strategy_keys.window_end` is the EXCLUSIVE end of a half-open `[window_start, window_end)` DATE window (migration `20260710120000`, COMP-02), and NULL means still active. A window whose `window_end` is today or earlier has closed. This is the first option in the TODOS entry, and SC-1 says "filters". The alternative (keep the historical union and reword the tooltip) is rejected.
- **D-02:** The single-key arm (`strategies.api_key_id`) is unchanged; it has no window. A future-dated window (`window_start > current_date`) is not filtered: it is not a closed window, the TODOS entry does not ask for it, and the wizard does not write one.
- **D-03:** A new forward migration (`CREATE OR REPLACE FUNCTION`, same signature, same `RETURNS TABLE (strategy_id uuid, exchange text)`, same SECURITY DEFINER, `SET search_path = public, pg_temp`, `LANGUAGE sql STABLE`). Re-base the body on the latest definition: only `20261019120000` defines it (measured: no later migration touches it). Re-assert `REVOKE ALL ... FROM PUBLIC` and `GRANT EXECUTE ... TO anon, authenticated, service_role`. A `CREATE OR REPLACE` keeps the ACL, but the explicit re-grant costs nothing and matches house style.
- **D-04:** The self-verify is CATALOGUE-ONLY, as in `20261019120000`: pg_proc, the privilege functions, and the function body text (`prosrc` contains the window predicate). It reads no table, so it applies on TEST's empty tables ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). No data-reading `DO` block that RAISEs on counts.
- **D-05:** The rollback file `supabase/migrations/down/<new>-rollback.sql` restores the `20261019120000` body with `CREATE OR REPLACE`. It does not DROP, so readers keep working after a rollback.
- **D-06:** An all-windows-closed published composite now returns zero rows for that strategy. `readPublishedTradeVenues` then sets no `tradeVenues` on the row, and `SyncBadge` shows the listed exchange with no mismatch cue. That is the honest result: no key currently supplies its trades. A test pins it.

### D-07..D-09 — Venues: gates (SC-1, SC-4)
- **D-07:** `supabase/tests/test_get_published_trade_venues.sql` gains a closed-window arm. A published strategy listed `okx` has a closed `binance` `strategy_keys` member (window ended in the past) and an open `okx` member. Anon gets exactly one row, `okx`. Its `RED-UNDER-M` drops the window predicate from the NEW migration, so the arm bites when the fix is reverted. Add an arm (or fold into this one) for the window that ends exactly today: `window_end = current_date` counts as closed.
- **D-08:** Every existing body-mutating `RED-UNDER-M` arm in that file edits `20261019120000_…sql` by `file`/`find`/`occurrences`. Once the new migration replaces the body, those edits are masked and the arms stop biting, which reds `sql-mutation`. Re-point every body-editing arm (TV-shape, TV-1, TV-unpublished, TV-unpublished-composite, TV-strategy-keys, TV-distinct-lower) at the new migration file, and add the new migration to `RED-UNDER-SETUP`. TV-shape's fourth step re-baselines the self-verify string in the file that holds it. The new file's comments must not repeat any `find` string, or the `occurrences` counts break.
- **D-09:** Move the mutation census in the same commit as the new arm(s): `ARMS_FLOOR` in `scripts/mutation-floors.mjs` and its `gate-family-meta.test.ts` registry key, plus any other census that counts arms or migrations (grep them all). Use `node scripts/mutation-runner/run.mjs --parse-only` and a SUBSET run of the one gate file as the measurement. A `SyncBadge` test covers the TODOS case: a strategy listed `okx` whose venues are `[okx]` after the filter shows no mismatch, while `[binance, okx]` still shows one. That pins the badge contract the SQL fix relies on.

### D-10..D-15 — Demo payload removal (SC-2)
- **D-10:** Drop `peerPercentile` and `allocatorPortfolios` from `FactsheetApiPayload` in `src/lib/factsheet/types.ts`, and drop their assembly in `buildFactsheetPayload` (`src/lib/factsheet/build-payload.ts`). This follows the TODOS entry's Action text.
- **D-11:** Delete the producers that become dead: `src/lib/factsheet/peer-cohort.ts` (`computePeerPercentile`, the seeded cohort) and `src/lib/factsheet/allocator.ts` (`alignBlend`, `buildAllocatorMetrics`, `comparatorLeg`, `blend`), with their unit tests. Measured: their only non-test importer is `build-payload.ts`. Delete `AllocatorPortfolioPayload` and the SPX/IEF/GLD/ETH daily fixture series only if nothing else imports them. The planner measures that. KEEP `PeerPercentilePayload`, which the csv arm's `scenarioPeer` uses.
- **D-12:** Census and parity tests that import the deleted producers (`return-stats.sites.test.ts`, `return-stats.sites-joint.test.ts`, `return-stats.single-source.test.ts`, and any figure-gate census) are updated to drop the retired sites, not loosened. A site census that loses a site loses a row; it does not gain an exclusion.
- **D-13:** Remove `FactsheetBodyOptions.hideAllocatorSection` / the `hideAllocatorSection` prop in `FactsheetView.tsx`, and its two callers (`AllocationDashboardV2.tsx`, `ScenarioFactsheetChart.tsx`). The TODOS Action asks for this; it has been a documented no-op since QUIETVIEW.
- **D-14:** Bump the factsheet `unstable_cache` key in `src/app/factsheet/[id]/v2/page.tsx` ONCE for the whole phase (`factsheet-v2-payload-v24` → `v25` at planning time), with a dated comment naming both payload changes (D-10 and D-17). Grep every other cache key that stores a factsheet payload (OG route, scenario share, allocator portfolio payload) and bump any that stores the api arm. ⚠️ Re-pick the number from origin/main right before pushing: parallel phases bump it too.
- **D-15:** The RED-on-revert test is a RUNTIME assertion on a built api-arm payload: `"peerPercentile" in payload` and `"allocatorPortfolios" in payload` are both false, plus a serialized-payload check that no demo cohort or blend name (for example "60/40 Stocks/Bonds") appears. A type-only removal cannot fail at runtime, so it does not count. Update the `build-payload.test.ts.snap` snapshot and every test that read the fields. Measured: about 60 files mention the fields or the prop, not the "about 13" the TODOS entry estimated. Most only build a payload fixture.

### D-16..D-20 — Gap record (SC-3)
- **D-16:** Change the gap reader to mirror `readReconstructedRanges` in the same module: `readUnrecoveredGaps(seriesProvenance)` returns `{ gaps, malformed: string | null }`, where `malformed` is null for absent or valid and a short reason string otherwise. It stays pure and total, and one bad entry still voids the whole record. Keep or replace `parseUnrecoveredGaps` as the planner sees fit, with no second parser.
- **D-17:** The caller in `src/lib/factsheet/fetch-and-build-payload.ts` reports a non-null `malformed` with `captureToSentry(new Error("factsheet: series_provenance.unrecovered_gaps is malformed"), { tags: { stage: "factsheet-unrecovered-gaps", reason: "unrecovered_gaps_malformed", strategy_id }, extra: { detail: <reason string> } })`. Only the reason string goes into `extra`, never the raw provenance (Phase 209 SCRUBLEAKS is removing raw data from error reports). It sets an optional payload flag `unrecoveredGapsUnavailable?: true` beside `reconstructedRangesUnavailable`, threaded through `build-payload.ts`'s strategy input like that flag.
- **D-18:** `UnrecoveredGapLines` takes `unavailable?: boolean`. When true it renders one muted-secondary sentence instead of the gap lines, in the posture of `RECONSTRUCTED_UNAVAILABLE_SENTENCE` (DESIGN.md: declarative, sentence case, states the limit, muted rather than warning, because the page admits it does not know and makes no finding). Copy: **"Record of days without trade data unavailable. Some days may be missing from the record."** It names no dates and makes no claim about the exchange (F1 rule). The tear sheet renders `FactsheetView` from the same builder, so this one path covers both surfaces.
- **D-19:** Tests that go RED on today's code: (a) a reader unit test where a malformed record yields `malformed !== null`; (b) a fetch-and-build test where a malformed record calls `captureToSentry` once with the stage tag and sets the flag; (c) a render test where `unavailable` shows the sentence and no gap line, and a valid empty record shows nothing.
- **D-20:** The cache key bump in D-14 covers this field. One bump for the phase.

### Claude's Discretion
- Exact migration timestamp, file names and arm ids (house pattern `TV-<name>`).
- Whether `parseUnrecoveredGaps` is renamed or wrapped (D-16), as long as one parser remains.
- Plan split (recommended: one plan per fix, all wave 1, all independent; the venues plan carries the migration and the mutation census).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `readReconstructedRanges` + `malformedReconstructed` (`src/lib/factsheet/trade-fetch-provenance.ts`), with its caller's Sentry report and `reconstructedRangesUnavailable` flag (`fetch-and-build-payload.ts` about :986-1026). This is the exact template for D-16..D-18.
- `ReconstructedRangeLines` with its `unavailable` prop and `RECONSTRUCTED_UNAVAILABLE_SENTENCE` (`src/app/factsheet/[id]/trade-fetch-lines.tsx`), the template for D-18.
- `supabase/tests/test_get_published_trade_venues.sql`: Part 2 seeding and the AS-anon assertion shape for the new arm.
- `SyncBadge.venue.test.tsx`: the existing venue-cue tests for D-09.

### Established Patterns
- SECDEF public primitives: RETURNS TABLE as the column allow-list, a published gate, a pinned search_path, explicit grants, and a catalogue-only self-verify.
- Mutation arms: `RED-UNDER-M` JSON with `edit` steps against the migration file, or `sql` steps against the live database. Floors are ratchets in `scripts/mutation-floors.mjs`, registered in `gate-family-meta.test.ts`.
- Factsheet cache-key bumps carry a dated comment in `v2/page.tsx`.

### Integration Points
- `readPublishedTradeVenues` (`src/lib/queries.ts` about :1630) → Discovery rows → `SyncBadge` mismatch cue.
- `buildFactsheetPayload` api arm (`build-payload.ts` about :1210-1260) → `FactsheetApiPayload` → RSC and the cached payload.
- `fetchAndBuildPayloadWithReason` → `FactsheetView` → the factsheet `v2` page AND the `tearsheet` page.

### Measured on PROD 2026-11-14 (read via MCP, marker query first)
- `strategy_keys`: 6 rows in total, 0 on published strategies, 0 closed windows on published strategies. The fix changes no live output at deploy. Its value is the first rotation.

</code_context>

<specifics>
## Specific Ideas

- The TODOS badge case: a strategy listed `okx` that moved from a Binance key to an OKX key must not show `Listed as OKX; trades come from Binance, OKX.`
- Gap copy (D-18) is new. It is modelled on the shipped reconstructed-unavailable sentence and was taken as the recommended default.

</specifics>

<deferred>
## Deferred Ideas

- Future-dated `strategy_keys` windows (not yet active) are still returned by the venue function. The TODOS entry did not ask for this, the wizard does not write them, and there are 0 on PROD.

</deferred>
