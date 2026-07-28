---
phase: 93-composite-data-path-correctness
plan: 03
subsystem: analytics-composite-dq
tags: [HARD-05, ccxt, degraded_members, fail-loud-removal, data_quality_flags, composite, factsheet, wizard]

# Dependency graph
requires:
  - phase: 93-composite-data-path-correctness
    plan: 01
    provides: "the composite merged_flags block (cumulative_method line) the degraded_members set/pop is threaded after"
  - phase: 93-composite-data-path-correctness
    plan: 02
    provides: "the wizard Data-window three-tier fallback that renders a degraded member's ENTERED window when per_key n_days is 0"
provides:
  - "Removal of the PERMANENT venue!='deribit' ccxt rejection in run_stitch_composite_job — a Bybit/OKX/Binance member DEGRADES (excluded from the stitch with a machine-readable DQ reason) instead of killing the whole composite"
  - "degraded_members DQ record {seq, venue, reason:'venue_reconstruction_unavailable'} (fixed enum, closed keys, leak-safe) with drop-stale healing; rides complete_with_warnings; zero-reconstructed floor stays fail-loud"
  - "Degraded member visible in per_key (n_days 0, empty-series into coverage_mask) and on BOTH DQ surfaces: factsheet hero strip + wizard amber block"
affects: [composite-factsheet, wizard-sync-preview, job_worker, composite-read-path]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three-way venue routing in _reconstruct_all: deribit → native; {binance,okx,bybit} → degrade channel; unknown → PERMANENT structural fail"
    - "Degraded members fed as empty pd.Series into coverage_mask (pure stitch_composite core UNTOUCHED) → honest per_key n_days 0"
    - "degraded_members merged_flags set/pop drop-stale heal (mtm_gated_reason / insufficient_window mirror); OUT of NAV_TWR_GUARD_KEYS, direct complete_with_warnings promotion"
    - "Strict closed-shape coercion at both TS parsers (finite numeric seq + non-empty string venue, else []) so malformed jsonb renders nothing (T-92-05 / T-93-03-02)"
    - "Server `reason` enum DROPPED at the render boundary — components own the user copy"

key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_stitch_composite_job.py
    - src/lib/factsheet/composite-read-path.ts
    - src/lib/factsheet/composite-read-path.test.ts
    - src/lib/factsheet/types.ts
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx

key-decisions:
  - "Option B (degrade) satisfies HARD-05 alone: the Phase-86 Deribit-only fence is lifted; a ccxt member is an honest visible degrade, never a fail-loud PERMANENT. Honest reconstruction (Option A) is Plan 93-04 on this same channel (reason codes are additive)."
  - "Degraded members are fed as empty pd.Series into a coverage_mask input list rather than modifying the pure stitch_composite.py core (Plan-checker Note 3 resolved by evidence — coverage_mask handles an empty per-member series cleanly, emitting {seq, None, None, 0})."
  - "degraded_members is OUTSIDE NAV_TWR_GUARD_KEYS (single-key blast radius stays zero) but STILL promotes computation_status to complete_with_warnings via a direct member_warned=True — a MISSING member is warn-worthy (research Pitfall 5), unlike the pure-annotation insufficient_window."
  - "The MTM comment is accurate (Plan-checker Note 1): the MTM pass DOES run for a composite with a degraded ccxt member (the ccxt member is continue'd before its signal is appended → member_signals is Deribit-only → mark_to_market_available can return True on the perp-only Deribit remainder). We take `degraded` from the authoritative CASH pass only; the MTM pass's identical list is discarded."
  - "An unknown venue (outside _COMPOSITE_CRYPTO_VENUES) stays PERMANENT structural fail — the degrade channel is scoped to the known ccxt crypto venues via _COMPOSITE_DEGRADE_VENUES (derived from _COMPOSITE_CRYPTO_VENUES so the sets cannot drift)."

requirements-completed: [HARD-05]

# Metrics
duration: ~75min
completed: 2026-07-11
---

# Phase 93 Plan 03: Remove the PERMANENT ccxt fail-loud; user-visible degraded-member DQ channel (HARD-05) Summary

**A composite containing a Bybit/OKX/Binance member NO LONGER fails PERMANENT on the venue check. The Deribit members stitch, the ccxt member DEGRADES out of the stitch with a fixed, machine-readable, leak-safe `degraded_members` DQ record (`{seq, venue, reason:'venue_reconstruction_unavailable'}`), computation_status promotes to `complete_with_warnings`, and the exclusion is USER-VISIBLE on both existing DQ surfaces (factsheet hero strip + wizard amber block) plus honestly in `per_key` (n_days 0). Fail-loud is preserved where it stays honest: a composite where NO member reconstructs still fails PERMANENT with a scrubbed message, and an unknown non-ccxt venue stays a PERMANENT structural fail. Additive JSONB key — NO migration. Closes HARD-05.**

## Task 1 — BLOCKING no-CHECK verification (A2 discharged with quoted DDL evidence)

The `degraded_members` key is introduced into `strategy_analytics.data_quality_flags`. This gate proves no CHECK/whitelist rejects a new key BEFORE it is introduced.

- `grep -rn "data_quality_flags" supabase/migrations/*.sql | grep -ic "check"` → **0** (the automated verify: NO same-line CHECK reference).
- The `strategy_analytics` column DDL (`supabase/migrations/20260405061911_initial_schema.sql:70-97`) — the column is a **bare JSONB**, the LAST column in the table, terminated by the closing `)` on line 97 (so no multi-line CHECK follows either):

  ```sql
  CREATE TABLE strategy_analytics (
    ...
    computation_status TEXT NOT NULL DEFAULT 'pending' CHECK (computation_status IN ('pending', 'computing', 'complete', 'failed')),
    ...
    trade_metrics JSONB,
    data_quality_flags JSONB
  );
  ```

- Every OTHER `data_quality_flags` migration hit (`20260707120000`, `20260708120000`, `20260710130000_stitch_composite_kind`) is a **comment** (`--`), not DDL. The only nearby CHECK is on the sibling `computation_status` column.
- **Verdict:** no CHECK, domain, or trigger-based key whitelist on `data_quality_flags`. The additive-JSONB / no-migration premise is PROVEN. Task 2/3 proceed.

## Task 2 — remove the PERMANENT ccxt rejection; degrade channel (commit `a43be0e7`)

- Added `_COMPOSITE_DEGRADE_VENUES = _COMPOSITE_CRYPTO_VENUES - {"deribit"}` (derived — the two sets can't drift).
- Replaced the `venue != "deribit"` PERMANENT rejection (`_reconstruct_all`) with three-way routing:
  1. `deribit` → the existing `_reconstruct_deribit` try/except/finally path, **byte-identical** (the try block and the `clipped/signals/venues/metas` appends are unchanged).
  2. `{binance, okx, bybit}` → **DEGRADE**: `aclose_exchange`, append `{seq, venue, reason:"venue_reconstruction_unavailable"}` to a new `degraded` accumulator, append `venue` to `venues` (keep the #597 blend seeing the crypto venue), `continue`. No `_stamp_failed`, no DispatchResult return, no reconstruction attempt (Plan 93-04 adds it).
  3. any OTHER venue → PERMANENT structural fail (message updated to "not a supported exchange").
- `_reconstruct_all` return tuple extended with `degraded`; both call sites updated (cash unpacks `degraded_members`; MTM discards `_mtm_degraded` — the authoritative degraded list is the cash pass's, per the corrected comment).
- **Zero-reconstructed honest floor:** `if not clipped_cash:` → `_stamp_failed("No composite member could be reconstructed.")` + PERMANENT (replaces what the removed rejection guaranteed implicitly).
- **per_key visibility:** `coverage_mask` is called on `clipped_cash + [(seq, empty pd.Series) for each degraded]` — an empty per-member series yields `{seq, first_day:None, last_day:None, n_days:0}` (verified: `stitch_composite.coverage_mask` handles empties cleanly; the pure core is UNTOUCHED).
- **merged_flags:** `degraded_members` set-when-non-empty / pop-when-empty (drop-stale heal, after Plan 93-01's `cumulative_method` line).
- **Status:** `if degraded_members: member_warned = True` → rides the existing `complete_with_warnings` promotion. NOT added to `NAV_TWR_GUARD_KEYS`.
- **Leak discipline:** `reason` is always the fixed literal; the entry is a closed key-set `{seq, venue, reason}`.

**RED proof:** the 4 degrade-behavior tests FAILED on pre-change code (`assert result.outcome == DispatchOutcome.DONE` → `failed`) because the venue check returned a permanent FAILED; the 2 permanent-fail tests (`all_ccxt_...no_member_reconstructed`, `unknown_venue...permanent_fail`) passed pre-change (current code already fails permanent) and stay green post-change via the new zero-reconstructed guard / the else branch.

Tests added (6): `test_ccxt_member_degrades_not_permanent_fail`, `test_all_ccxt_composite_permanent_no_member_reconstructed`, `test_degraded_members_drop_stale_on_all_deribit_restitch`, `test_degraded_member_leak_discipline_closed_keys_no_magnitude`, `test_mtm_runs_on_deribit_remainder_with_degraded_ccxt_member` (Plan-checker Note 1 — deribit perp-only + degraded bybit → both bases written), `test_unknown_venue_member_still_permanent_fail`.

## Task 3 — render the degrade on both existing DQ surfaces (commit `09d4be71`)

Mirrors the 92-03 insufficient_window slice one-for-one; NO new component.

- `composite-read-path.ts`: `degraded_members?: unknown` on the dqf input; new exported `parseDegradedMembers` strict coercion (array of objects with a finite numeric `seq` + non-empty string `venue`, else `[]`); exposed on `dataQuality.degradedMembers` (the server `reason` enum dropped).
- `types.ts`: `dataQuality.degradedMembers?: Array<{seq: number; venue: string}>` (optional — absent = nothing renders).
- `FactsheetView.tsx`: sibling amber hero-strip `<p>` (NEW-C20-08 pattern, `px-3 sm:px-4 py-2 text-micro font-mono`, `var(--color-warning, #B45309)`), gated on `degradedMembers.length > 0`, copy "Key {seq} ({venue}) could not be included — {its/their} data is excluded from this track record."
- `SyncPreviewStep.tsx`: `degradedMembers` on `CompositePreviewData` + strict inline parse from the snapshot dq + OR'd into `hasDqCaveat` + a `<p>` inside the existing amber `role="status"` Data quality block.

**RED proof:** the render tests assert copy the pre-change components never emitted; the read-path tests assert `degradedMembers` on `dataQuality` which the pre-change parser never produced.

Tests added: read-path strict-coercion (valid → `{seq,venue}` reason-dropped; 9 malformed shapes → `[]`; mixed valid+junk → only well-formed); factsheet caveat present (single + multi with plural pronoun) / absent; wizard block present / only-caveat (hasDqCaveat OR) / malformed→nothing / absent. Three existing `dataQuality` `toEqual` assertions updated to include `degradedMembers: []` (legitimate contract-change consequence of the new optional field).

## Acceptance evidence

| Check | Command | Result |
|-------|---------|--------|
| BLOCKING no-CHECK verify | `grep -rn data_quality_flags supabase/migrations/*.sql \| grep -ic check` | 0 (DDL quoted above) |
| fence removed | `grep -v '^\s*#' services/job_worker.py \| grep -c "Deribit-only this phase"` | 0 |
| reason literal present | `grep -v '^\s*#' services/job_worker.py \| grep -c "venue_reconstruction_unavailable"` | 1 |
| degrade tests (RED→GREEN) | `pytest tests/test_stitch_composite_job.py -k "degrad or ccxt or mtm_runs or unknown_venue or no_member" -q` | 6 passed |
| full stitch file (parity, all-Deribit unmodified) | `pytest tests/test_stitch_composite_job.py -q` | 37 passed |
| parity set | `pytest test_composite_headline_parity test_golden_parity test_metrics_parity -q` | 49 passed |
| offline parity gate | `pytest stitch_composite + composite_headline_parity + golden_parity + metrics_parity -q` | 86 passed |
| full analytics suite | `.venv/bin/python -m pytest -q` | 3594 passed, 92 skipped, 0 failed |
| mypy | `mypy services/job_worker.py` | Success, 0 issues |
| read-path test | `vitest run composite-read-path.test.ts` | 15 passed |
| three Task-3 render files | `vitest run read-path + FactsheetView.kpistrip + SyncPreviewStep.composite.render` | 60 passed |
| full frontend surfaces | `vitest run src/lib/factsheet src/lib/composite wizard/steps v2` | 542 passed (53 files) |
| tsc | `npx tsc --noEmit` | clean (0 errors) |
| lint (touched) | `eslint` the 4 touched source files | 0 errors |
| no new component | `git status --porcelain src \| grep ^A \| grep -v test \| grep -c .tsx` | 0 |
| no migration | `git status --porcelain supabase/migrations/` | empty |

## Deviations from Plan

### 1. [Rule 1 — contract pin update] Three read-path `dataQuality` `toEqual` assertions extended for the new `degradedMembers` field
- **Found during:** Task 3 (composite-read-path.test.ts blast-radius).
- **Issue:** the existing HARD-04 tests assert `dataQuality` equals exactly `{ composite: true, insufficientWindow: ... }`; adding `degradedMembers: []` to the returned object reddens the closed-set `toEqual`.
- **Fix:** updated the three assertions to include `degradedMembers: []` — a deliberate additive-field contract change, preserving the tests' binding intent (strict server-truth coercion).
- **Files:** `src/lib/factsheet/composite-read-path.test.ts`. **Commit:** `09d4be71`.

Not scope creep — the pin encoded the pre-HARD-05 `dataQuality` shape that HARD-05 deliberately extends. `singleKeyDataQuality`'s return is unchanged (a single-key strategy cannot have degraded members), so its `toEqual` pins stay exact.

## Non-blocking live gate

Per the plan verification, the full Railway ccxt canary with real Bybit/OKX/Binance keys (mirrors SC-3 piece 3) is the user's corroboration gate and is **documented as NON-BLOCKING** — the offline fixtures + the degrade path close the phase requirement. NOT run here (no live keys in the executor context). This is the accepted closure basis: honest offline degrade contract + both render surfaces, not a live-attested ccxt onboarding.

## Threat surface scan

No new network endpoints, auth paths, or file access. `degraded_members` is a closed-key `{seq, venue, reason}` record with `reason` a fixed enum literal — no exception text / USD / account size ever interpolated (T-93-03-01, pinned by `test_degraded_member_leak_discipline_closed_keys_no_magnitude`). Both TS parsers strict-coerce (finite numeric seq + non-empty string venue, else `[]`) so malformed jsonb renders nothing (T-93-03-02). The exclusion is never silent: DQ flag + complete_with_warnings + per_key n_days 0 + two render surfaces (T-93-03-03). A zero-member composite fails PERMANENT with a terminal stamp (T-93-03-04). No new packages (T-93-03-SC not triggered). No threat flags.

## Known Stubs

None. The degrade channel is fully wired end-to-end (worker → merged_flags → both render surfaces). Plan 93-04 will attach the honest ccxt reconstruction ATTEMPT to this same channel (adding the second reason code `reconstruction_failed`) without frontend churn — the reason codes are additive by design, not a stub.

## Self-Check: PASSED

- `analytics-service/services/job_worker.py` — FOUND (degrade routing, zero-reconstructed floor, coverage_mask degraded input, merged_flags set/pop, member_warned promotion).
- `analytics-service/tests/test_stitch_composite_job.py` — FOUND (6 HARD-05 tests).
- `src/lib/factsheet/composite-read-path.ts` — FOUND (parseDegradedMembers + dataQuality.degradedMembers).
- `src/lib/factsheet/types.ts`, `FactsheetView.tsx`, `SyncPreviewStep.tsx` — FOUND (shape + both render surfaces).
- Commit `a43be0e7` (Task 2) — FOUND.
- Commit `09d4be71` (Task 3) — FOUND.
