---
phase: 147-scen-01-the-scenario-engine-receives-the-real-series
verified: 2026-08-05T09:02:00Z
status: human_needed
score: 9/9 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
human_verification:
  - test: "PROD founder walkthrough — add MT5 strategy `4eab92b0` to a scenario in the live composer; then REFRESH the page mid-walkthrough."
    expected: "Overlapping-days matches the stored span at N−1 (≈135 vs 136 stored — differencing consumes day one; never assert 136); every metric non-zero; the anchor SURVIVES the refresh (the P6 hydration effect)."
    why_human: "PROD data + live authed composer. No automated harness reaches the founder's own-portfolio book row on production."
  - test: "A1 composite check — `SELECT data_quality_flags->'composite' FROM strategy_analytics WHERE strategy_id='4eab92b0…';`"
    expected: "If `true`, the factsheet renders the composite `csv_daily_returns` arithmetic curve while the composer gets the differenced `returns_series` (RESEARCH P8) — re-derive the expected day-count BEFORE judging SC1 and record the divergence as known/reviewed, not a defect."
    why_human: "PROD read; MCP is stripped from subagents. Orchestrator-only."
  - test: "A2 missing-row census — `SELECT count(*) FROM strategies s LEFT JOIN strategy_analytics a ON a.strategy_id=s.id WHERE a.strategy_id IS NULL;`"
    expected: "Record the count in the acceptance write-up. The 16h age bound is correct defence-in-depth regardless of the number."
    why_human: "PROD read; orchestrator-only."
  - test: "OG re-unfurl — request the factsheet OG card with a cache-busting query string."
    expected: "The corrected card (real metrics, finite sparkline) appears. A stale unfurl within the 24h CDN TTL / 7d SWR window is NOT a regression (P10)."
    why_human: "CDN-owned staleness; cannot be observed from the repo."
---

# Phase 147: SCEN-01 — The scenario engine receives the real series — Verification Report

**Phase Goal:** A strategy added to a scenario contributes its actual return series — never silent zeros
**Verified:** 2026-08-05T09:02:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | **SC1** — Adding any REAL strategy to a scenario projects non-zero metrics from its actual stored series (all four readers) | ✓ VERIFIED (code+test); PROD anchor → human | All 4 readers widened AND resolving: `returns/route.ts:251-254` select + `:299` resolve; `queries.ts:3426-3430` embed + `:3569` resolve; `og/factsheet/[id]/route.tsx:52` + `:90`; `scenario-share/[token]/page.tsx:238` sibling read + `share-resolve.ts:208`. Behavioural tests green: `route.test.ts` R12, `queries.my-allocation.test.ts:2604`, `share-resolve.test.ts` SC1-share, OG O1 — 144/144 across the 4 wave-2 files. |
| 2 | **SC2** — ONE mechanism (`resolveDailyReturnSeries`), no third minted — **structurally asserted** | ✓ VERIFIED (independently falsified) | `src/__tests__/phase-147-series-resolution-guards.test.ts` (375 lines, 12/12 green). **I planted my own bare reader** (`src/lib/__verifier_probe_tmp.ts` with `.select("daily_returns, cagr")`) — Layer A went RED and named the offending file and full select payload verbatim. Probe removed; gate back to 12/12; `git status` clean. Layer A is genuinely repo-walking (`productionSources()`), not an allowlist; its own non-vacuity test pins ≥4 real two-column payloads. Layer B pins all 4 fixed readers + both REFERENCE detail pages on the resolver **call**, not the import specifier. |
| 3 | **SC3** — a wealth-index `returns_series` is never forwarded raw; a test feeds a series starting at exactly 1.0 and proves differencing | ✓ VERIFIED | `route.test.ts:718` `WEALTH_INDEX` starts at `{date:"2026-01-01", value:1.0}`; R13 (`:785`) asserts `body.daily_returns[0].value` **not** ≈1.0 and length **≠** N. Resolver itself (`resolve-series.ts:56`) routes `returns_series` through `equityCurveToDailyReturns` (successive ratios, N−1). WR-01 fix ADDED production-shaped companions (R12b `:751`, O1c, SC1b-share, page.test.tsx) — it did not remove the 1.0-anchored SC3 oracle. |
| 4 | **SC4** — no-series strategies render an honest empty/degraded state, never silent 0.00 | ✓ VERIFIED | `CoverageStateChip.tsx:35-53` extends the ONE union with `syncing` + `no-series` (muted, never red). `ScenarioComposer.tsx:5722-5765` chip precedence + `data-series-state` attr, `:5834/:5844` both notes (`role=status` on syncing only). Test matrix SC4-1…SC4-10 plus **UI-SPEC #1–#8** all present and green (239/239 with the chip + payload files), incl. `UI-SPEC #7` "zero contributing constituents → em-dash, never the literal 0.00" and `UI-SPEC #6` one-chip-per-row. |
| 5 | **147-01** — leaf module extraction, zero-diff back-compat, 16h age bound | ✓ VERIFIED | `resolve-series.ts` (57 lines, both exports); `allocator-portfolio-payload.ts:10` re-export keeps `factsheet/[id]/v2/page.tsx:13` and `discovery/[slug]/[strategyId]/page.tsx:15` specifiers unchanged. `closed-sets.ts:455-505` — `SERIES_STATES`, `MISSING_ROW_COMPUTING_WINDOW_MS = 16*60*60*1000`, `deriveEmptySeriesState` with injectable `nowMs`. `closed-sets.series-state.test.ts` 7/7 green; oracle is an independently declared literal (`SIXTEEN_HOURS_MS = 57600000`), not the imported constant. |
| 6 | **147-04** — raw `returns_series` / `computation_status` never cross to the client; a derived `series_state` does | ✓ VERIFIED | `queries.ts:3578-3583` destructure-strip idiom (`_dqf, _rs, _cs`); `:3611-3614` derives `series_state`. Test `queries.my-allocation.test.ts:2626-2638` asserts `"returns_series" in analytics === false` AND `JSON.stringify(row)` does not contain it. |
| 7 | **147-03** — the share fix ships with ZERO new migrations (frozen-spine gate) | ✓ VERIFIED | `git diff --name-only d05f1e20..HEAD -- supabase/migrations/` → **0 files**. Fix is a caller-side Phase-84-shaped sibling read (`page.tsx:238-239`, bounded `.in("strategy_id", seriesIds)` to the RPC's own output) + a third optional param on the pure resolver. |
| 8 | **147-06 / P6** — reopening a saved scenario or refreshing re-fetches every added strategy's series | ✓ VERIFIED | `ScenarioComposer.tsx:2172-2182` hydration `useEffect` reusing the add-seam guard predicate **verbatim** (`!strategyById.has(id) && addedReturnsById[id] === undefined`), deduped by `fetchAddedReturns`' own `lazyAbortRef` — no second dedup mechanism. Tests HYD-1…HYD-4 (`:10446`, `:10502`, `:10547`, `:10626`) cover reopen, book-skip, idempotence, and failure-surface. |
| 9 | **147-06** — `getPortfolioStrategies` consumers audited, findings logged to TODOS.md, no scope expansion | ✓ VERIFIED | `getPortfolioStrategies` (`queries.ts:1299`) select carries `returns_series, daily_returns`. Audit findings booked in `TODOS.md:1185` (`DEF-147-A`) and `:1197` (`DEF-147-B`). No production files outside the 6 plans' declared surfaces were touched. |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/factsheet/resolve-series.ts` | Leaf module, both exports | ✓ VERIFIED | 57 lines; imports only `portfolio-math-utils` + local types (leaf-clean) |
| `src/lib/closed-sets.ts` | SERIES_STATES + deriveEmptySeriesState | ✓ VERIFIED | `:455-505` |
| `src/lib/closed-sets.series-state.test.ts` | 16h bound unit tests | ✓ VERIFIED | 119 lines, green |
| `src/app/api/strategies/[id]/returns/route.ts` | Widened select + resolver + series_state | ✓ VERIFIED | `:251-254`, `:299`, `:341`, `:366-372` |
| `src/app/api/og/factsheet/[id]/route.tsx` | Widened embed + resolver | ✓ VERIFIED | `:52`, `:90-92` |
| `src/app/api/og/factsheet/[id]/route.test.tsx` | Wave-0 gap: first OG test file | ✓ VERIFIED | 349 lines, green |
| `src/app/scenario-share/[token]/share-resolve.ts` | Pure resolver widened | ✓ VERIFIED | `:48`, `:208` |
| `src/app/scenario-share/[token]/page.tsx` | Bounded sibling read | ✓ VERIFIED | `:238-239`, `:270` |
| `src/lib/queries.ts` | Book path widen + resolve + strip + series_state | ✓ VERIFIED | `:3426-3430`, `:3569`, `:3578`, `:3611` |
| `src/app/(dashboard)/allocations/components/CoverageStateChip.tsx` | Union extended in place | ✓ VERIFIED | `:35-53`; no second chip component minted |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | Tolerance + precedence + notes + hydration | ✓ VERIFIED | `:628`, `:1398`, `:2138`, `:2172`, `:3052`, `:5722`, `:5834` |
| `src/__tests__/phase-147-series-resolution-guards.test.ts` | SC2 structural gate (min 60 lines) | ✓ VERIFIED | 375 lines; independently falsified |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `allocator-portfolio-payload.ts` | `resolve-series.ts` | re-export | ✓ WIRED | `:10` — both reference pages' specifiers unchanged |
| `returns/route.ts` | `resolve-series.ts` | `resolveDailyReturnSeries(row?.daily_returns, row?.returns_series)` | ✓ WIRED | `:60` import, `:299` call |
| `returns/route.ts` | `closed-sets.ts` | `deriveEmptySeriesState` on the empty arm | ✓ WIRED | `:341`; lazy age read only when `analyticsRow === null` |
| `og/factsheet/[id]/route.tsx` | `strategy_analytics(daily_returns, returns_series)` | widened embed | ✓ WIRED | `:52` |
| `scenario-share/page.tsx` | `strategy_analytics` | `.select("strategy_id, returns_series").in("strategy_id", seriesIds)` | ✓ WIRED | `:238-239`; disclosure bound to RPC's own id universe |
| `scenario-share/page.tsx` | `share-resolve.ts` | `resolveSharedScenario(row, assetClassById, returnsSeriesById)` | ✓ WIRED | `:270` |
| `queries.ts:3405` embed | `strategy_analytics(… returns_series, computation_status)` | widened embed inside pinned phase-84 slice | ✓ WIRED | `:3426-3430` |
| `queries.ts:3569` | `resolve-series.ts` | `resolveDailyReturnSeries(analyticsObj.daily_returns, analyticsObj.returns_series)` | ✓ WIRED | `:13` import, `:3569` call |
| ScenarioComposer lazy `.then` | route `series_state` | `narrowSeriesState(d.series_state)` | ✓ WIRED | `:1398` |
| ScenarioComposer book merge | payload `strategy.series_state` | same `narrowSeriesState` — ONE derivation table | ✓ WIRED | `:2138` |
| ScenarioComposer added row | `CoverageStateChip` | precedence ternary | ✓ WIRED | `:5722-5765` |
| ScenarioComposer hydration effect | `fetchAddedReturns` | add-seam guard verbatim | ✓ WIRED | `:2172-2182` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ScenarioComposer.tsx` | `addedStrategyReturnsLookup` (`:2102`) | book payload `normalizeBookReturns(raw)` **first**, else `addedReturnsById[id]` from the lazy fetch (`:2116-2117`) | Yes — both supply lines now carry the RESOLVED series | ✓ FLOWING |
| `ScenarioComposer.tsx` | `addedReturnsById` | `fetchAddedReturns` → `settle(d.daily_returns, …)` (`:1398-1407`); non-array body **throws** (retryable, not a fake empty) | Yes | ✓ FLOWING |
| engine input | `addedStrategyReturnsLookup` passed to the blend engine | `:2424` | Yes | ✓ FLOWING |
| `queries.ts` payload | `strategy_analytics.daily_returns` | `resolvedDailyReturns` (`:3569`), NOT the raw column | Yes | ✓ FLOWING |
| `og/factsheet` card | `rows` | `resolveDailyReturnSeries(analytics?.daily_returns, analytics?.returns_series)` (`:90`) | Yes | ✓ FLOWING |
| share page | `returnsSeriesById` | live `.in()` read on `strategy_analytics`, threaded into the pure layer | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| SC2 gate is non-vacuous (independent falsification) | plant `src/lib/__verifier_probe_tmp.ts` with `.select("daily_returns, cagr")` → `npx vitest run src/__tests__/phase-147-series-resolution-guards.test.ts` | `1 failed / 11 passed`; offender named: `"src/lib/__verifier_probe_tmp.ts — .select(\"daily_returns, cagr\")"` | ✓ PASS |
| Gate green on clean tree after probe removal | same command; `git status --porcelain` | `12 passed`; git status **empty** | ✓ PASS |
| Wave-2 reader tests | `npx vitest run returns/route.test.ts og/route.test.tsx share-resolve.test.ts queries.my-allocation.test.ts` | `4 files / 144 tests passed` | ✓ PASS |
| Composer + chip + payload | `npx vitest run ScenarioComposer.test.tsx CoverageStateChip.test.tsx allocator-portfolio-payload.test.ts` | `3 files / 239 tests passed` | ✓ PASS |
| Full frontend suite | `npm test -- --no-file-parallelism` | **740 files passed / 19 skipped; 10666 passed / 287 skipped; 0 failed** (392.9s) | ✓ PASS |
| Typecheck | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| Lint + route/admin manifests | `npm run lint` | 0 errors, 1 pre-existing warning (`EquityChart.tsx:1119`, untouched file, booked `DEF-142.2-11`); both manifest checks OK | ✓ PASS |
| Zero migrations (frozen-spine) | `git diff --name-only d05f1e20..HEAD -- supabase/migrations/` | 0 files | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| n/a | — | No `scripts/*/tests/probe-*.sh` declared or implied by this phase (TS/vitest phase) | ? SKIP |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SCEN-01 | 147-01…147-06 (all six declare `requirements: [SCEN-01]`) | A strategy added to a scenario contributes its actual return series; the READER is fixed, not the writer; `returns_series` differenced never forwarded raw | ✓ SATISFIED (code) — PROD acceptance pending founder walkthrough | All four readers resolve through the ONE mechanism; SC2 gate independently falsified; SC3 differencing pinned; SC4 honest states pinned; full suite green |

**Orphan check:** ROADMAP `| 147 | SCEN-01 |` maps exactly one requirement to this phase, and all six plans claim it. **No orphaned requirements.**

**Note (informational):** `REQUIREMENTS.md:696` still shows `- [ ] **SCEN-01**`. That is *correct* — the checkbox tracks founder acceptance, which is the outstanding manual walkthrough below, not code completion.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | `TBD` / `FIXME` / `XXX` across all 10 modified production files | — | **Zero found.** No unreferenced debt markers; the debt gate passes. |
| `src/lib/queries.my-allocation.test.ts` | mock `select` at `:267-272` | Harness records the select string but does **not** project the fixture to the selected columns (unlike `returns/route.test.ts:296-308`, which does) | ⚠️ Warning (test hygiene) | Narrowing `queries.ts`'s embed back to bare `daily_returns` would **not** redden this behavioural file. Not a goal gap: (a) the 147-04 SC-1 ledger mutation targeted the resolver *call argument*, which IS falsifiable in this harness (observed 2 failed / 2 passed); (b) the select-width regression is held structurally by **Layer B** of the SC2 gate, which I independently confirmed red under exactly that mutation. Per the founder blast-radius bar (2026-07-29) this is log-only — suggest booking as `DEF-147-C` in TODOS.md. |
| `src/lib/types.ts:327` / `queries.ts:1682` | — | `IN-01` — `daily_returns` payload type now a runtime lie (`Record<…>` typed, `DailyPoint[]` emitted) | ℹ️ Info | Already ACKNOWLEDGED in 147-REVIEW.md; same latent class as `DEF-147-B`. Consumers survive via `normalizeBookReturns(raw: unknown)`. |

### Review-Finding Fix Verification (not trusted from the report)

| Finding | Claimed | Verified in code |
|---------|---------|------------------|
| WR-01 | FIXED `a079638f` — production-shaped companion oracles per surface | ✓ `route.test.ts:751` R12b (`PROD_WEALTH_INDEX = WEALTH_INDEX.slice(1)`, asserts N−1 and day-one's return **unrecoverable**); companions present in OG, share-resolve, and `page.test.tsx`. The 1.0-anchored SC3 oracle (R13) was **retained**, so ROADMAP SC3's literal wording still holds. |
| WR-02 | FIXED `efb1ef77` — `autoExcluded` skips non-`available` rows | ✓ `ScenarioComposer.tsx:3052` — `if ((addedSeriesStateByRef[s.id] ?? "available") !== "available") continue;` with the pre-147-preserving `?? "available"` default. Regression pin `SC4-10` at `:10079` present and green. |

### Human Verification Required

Automated verification is complete and green — but it cannot prove the founder's PROD strategy renders its real day-count. Four items, all orchestrator/founder work, all already declared Manual-Only in 147-VALIDATION.md:

#### 1. PROD founder walkthrough (the acceptance anchor)

**Test:** Add MT5 strategy `4eab92b0` to a scenario in the live composer. **Refresh the page mid-walkthrough.**
**Expected:** Overlapping-days matches the stored span at **N−1** (≈135 vs 136 stored — differencing consumes day one; **never assert 136**). Every metric non-zero. The anchor survives the refresh (that is what the P6 hydration effect exists for).
**Why human:** PROD data + live authed composer; the founder's own-portfolio book row has no automated PROD harness.

#### 2. A1 composite check (run BEFORE judging SC1)

**Test:** `SELECT data_quality_flags->'composite' FROM strategy_analytics WHERE strategy_id='4eab92b0…';`
**Expected:** If `true`, the factsheet renders the composite `csv_daily_returns` arithmetic curve while the composer gets the differenced `returns_series` (RESEARCH P8). Re-derive the expected day-count first, and record the divergence as known/reviewed — **not** a defect.
**Why human:** PROD read; MCP is stripped from subagents.

#### 3. A2 missing-row census

**Test:** `SELECT count(*) FROM strategies s LEFT JOIN strategy_analytics a ON a.strategy_id=s.id WHERE a.strategy_id IS NULL;`
**Expected:** Record the count in the acceptance write-up. The 16h age bound is correct defence-in-depth regardless of the number.
**Why human:** PROD read; orchestrator-only.

#### 4. OG re-unfurl

**Test:** Request the factsheet OG card with a cache-busting query string.
**Expected:** The corrected card appears. A stale unfurl inside the 24h CDN TTL / 7d SWR window is **not** a regression (P10).
**Why human:** CDN-owned staleness, unobservable from the repo.

*Related but separate:* ROADMAP Phase 155 (`MT5-GOAL-01`) is the umbrella acceptance gate that re-confirms "it projects in a scenario (SCEN-01, Phase 147)" live. Item 1 above is this phase's own anchor and should not be deferred to 155.

### Gaps Summary

**None.** The starting hypothesis — "tasks completed, goal missed" — does not survive the evidence.

I did not accept SUMMARY.md's narrative. Every claim I could falsify, I falsified:

- The **reader census is genuinely four sites**, and all four are widened *and* resolving — verified by reading each select string and each call site, not by counting bullets.
- The **SC2 "structurally asserted" clause is real.** I planted my own bare `daily_returns` reader in a file no gate author hand-picked; Layer A went red and printed the offending file and payload. The gate walks `src/` rather than consulting an allowlist, strips comments before matching, and carries its own non-vacuity assertion. Probe removed, tree clean.
- **SC3 survived the WR-01 fix.** The review's remedy could plausibly have deleted the 1.0-anchored oracle the roadmap wording depends on; it did not — it *added* production-shaped companions alongside it.
- **WR-01/WR-02 are fixed in code**, not merely in the report — both lines read and both regression pins located.
- **Nothing is hollow at Level 4.** The resolved series reaches the blend engine through both supply lines (book payload first, lazy fetch second), and a malformed 200 throws rather than settling a fake empty.
- **Zero migrations, zero debt markers, tsc clean, lint 0 errors, full suite 10666 passed / 0 failed** — re-run by me, not read from the ledger. (The suite is 5 tests *above* the ledger's recorded 10661, consistent with the two post-closure review-fix commits.)

One soft spot is confirmed and recorded, at the severity the founder's blast-radius bar assigns it: `queries.my-allocation.test.ts`'s supabase mock returns fixtures wholesale instead of projecting to the selected columns, so a select-width regression on the book path is caught **structurally** (SC2 Layer B) rather than **behaviourally**. That is a test-hygiene delta, not a phase-goal gap — the phase's own ledger row for that surface used a resolver-argument mutation, which the harness *does* falsify. Suggest booking as `DEF-147-C`.

Status is `human_needed` — not `passed` — solely because the four PROD/CDN acceptance items above are outstanding by design.

---

_Verified: 2026-08-05T09:02:00Z_
_Verifier: Claude (gsd-verifier)_
