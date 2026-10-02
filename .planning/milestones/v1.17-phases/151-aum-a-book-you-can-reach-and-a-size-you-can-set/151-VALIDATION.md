---
phase: 151
slug: aum-a-book-you-can-reach-and-a-size-you-can-set
status: executed
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-07
---

# Phase 151 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Details in 151-RESEARCH.md `## Validation Architecture` — this file is the
> execution-time sampling contract; the planner filled the per-task map (2026-08-07).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS) + pytest (analytics-service) |
| **Config file** | `vitest.config.ts` / `analytics-service/pyproject.toml` |
| **Quick run command** | `npx vitest run <touched-test-file> --no-file-parallelism` / `cd analytics-service && python -m pytest tests/<touched> -q` |
| **Full suite command** | `npm test` / `cd analytics-service && python -m pytest -q` (MUST run from analytics-service/ — VCR cassette dir) |
| **Estimated runtime** | quick ~10-30s; full vitest ~5min, pytest ~3min |

---

## Sampling Rate

- **After every task commit:** Run the quick command for the touched surface
- **After every plan wave:** Run the full suite for the touched language(s); `mypy --strict` on analytics-service before any ship
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~300 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-T1 | 151-01 | 1 | AUM-02 | T-151-01 | registry MOVED not copied; derive arm byte-unchanged | unit | `cd analytics-service && python -m pytest tests/test_mt5_derive_branch.py -q` | ✅ exists | ⬜ pending |
| 01-T2 | 151-01 | 1 | AUM-02 | T-151-01/02 | lock-object `is` identity across modules; leaf import invariant | unit | `cd analytics-service && python -m pytest tests/test_mt5_concurrency.py -q` | ❌ Wave 0 (task creates) | ⬜ pending |
| 02-T1 | 151-02 | 1 | AUM-04 | — | both link forms + archived exclusion (founder census) | unit (pure) | `npx vitest run src/lib/queries.test.ts --no-file-parallelism` | ✅ exists (cases new) | ⬜ pending |
| 02-T2 | 151-02 | 1 | AUM-04 | T-151-03/04 | owner_id-scoped strategy_keys read (end-to-end wired; mutation falsifier); old gate consumers frozen; both branches carry fields | unit | `npx vitest run src/lib/queries.my-allocation.test.ts --no-file-parallelism` | ✅ exists (cases new) | ⬜ pending |
| 03-T1 | 151-03 | 2 | AUM-02 | T-151-05 | dispatch on venue string; transient arm stamps human copy (wiring falsifier); NON_CCXT_VENUES↔factory drift gate | unit + handler | `cd analytics-service && python -m pytest tests/test_allocator_positions_non_ccxt.py tests/test_allocator_positions.py -q` | ❌ Wave 0 (task creates) | ⬜ pending |
| 03-T2 | 151-03 | 2 | AUM-02 | T-151-06..09 | equity-not-balance literal; account-scoped symbol; lock identity; non-USD fail-loud | unit | `cd analytics-service && python -m pytest tests/test_allocator_positions_non_ccxt.py -q` | ❌ Wave 0 | ⬜ pending |
| 04-T1 | 151-04 | 3 | AUM-05 | T-151-10/11 | get_balances only; no invented FX; honest asset-named warning | unit | `cd analytics-service && python -m pytest tests/test_allocator_positions_non_ccxt.py -q -k sfox` | ✅ (from 03) | ⬜ pending |
| 04-T2 | 151-04 | 3 | AUM-05, AUM-02 | T-151-10 | ONE parametrized body over mt5+sfox+unknown; banned-substring invariant; non-collapse literals | unit (parametrized) | `cd analytics-service && python -m pytest tests/test_allocator_positions_non_ccxt.py -q` | ✅ (from 03) | ⬜ pending |
| 05-T1 | 151-05 | 2 | AUM-04 | T-151-13/14 | gate repoint at exactly 3 consumers; MEMBER-04 + baseline frozen | unit | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" --no-file-parallelism -t "AUM-04"` | ✅ exists (cases new) | ⬜ pending |
| 05-T2 | 151-05 | 2 | AUM-04 | T-151-13 | contributing-only rows; muted note; manager keys in neither count | unit | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" --no-file-parallelism` | ✅ exists | ⬜ pending |
| 06-T1 | 151-06 | 3 | AUM-01 | T-151-15 | v4 blob w/o field decodes ok (never reset); no zod refine | unit (codec) | `npx vitest run "src/app/(dashboard)/allocations/lib/scenario-state.test.ts" --no-file-parallelism` | ✅ exists (cases new) | ⬜ pending |
| 06-T2 | 151-06 | 3 | AUM-01 | T-151-15/16 | manual-wins AUM; no re-snap; scenarioMetrics AUM-invariant (SCEN-01 guard) | unit | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" --no-file-parallelism -t "AUM input"` | ✅ exists | ⬜ pending |
| 06-T3 | 151-06 | 3 | AUM-03 | T-151-17 | equality-pinned refusal copy; never-strings grep-gate | unit + grep | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" --no-file-parallelism && ! grep -rn "toggle on a live holding" src/ --include="*.ts" --include="*.tsx" \| grep -v ".test."` | ✅ (`:2468` pins OLD copy — rewrite) | ⬜ pending |
| 07-T1 | 151-07 | 4 | AUM-01 | T-151-20 | dollar→weight through handleWeightChange ONLY (neuter falsifier); sole-unit refusal; clamp inherited | unit (economic oracles) | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" --no-file-parallelism -t "dollar"` | ✅ exists | ⬜ pending |
| 07-T2 | 151-07 | 4 | AUM-01 | T-151-18/19/21 | client_manual_aum sentinel; server truth precedence; conditional-spread hash stability | route unit | `npx vitest run src/app/api/allocator/scenario/commit/route.test.ts --no-file-parallelism` | ✅ exists (1,613 lines — extend) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Plan-Final Gates

Per-task rows above are FAST focused commands (feedback sampling, max latency ~300s).
The full-suite runs are explicit plan-final gates — run once at the end of each plan:

| Plan | Plan-final gate |
|------|-----------------|
| 151-01 | `cd analytics-service && python -m pytest -q && mypy .` |
| 151-02 | `npx vitest run src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts src/lib/queries.my-strategies.test.ts --no-file-parallelism && npm run typecheck && npm run lint` |
| 151-03 | `cd analytics-service && python -m pytest tests/test_allocator_positions_non_ccxt.py tests/test_allocator_positions.py tests/test_mt5_client_contract.py tests/test_mt5_derive_branch.py -q && mypy .` |
| 151-04 | `cd analytics-service && python -m pytest -q && mypy .` |
| 151-05 | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" --no-file-parallelism && npm run typecheck && npm run lint` |
| 151-06 | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" "src/app/(dashboard)/allocations/lib/scenario-state.test.ts" --no-file-parallelism && npm run typecheck && npm run lint` |
| 151-07 | `npm run test && npm run test:coverage && npm run typecheck && npm run lint` |

---

## Binding Oracle Rules (economic invariants, not self-referential)

- **AUM-01 sizing:** oracle is the ECONOMIC identity `dollar = weight × AUM` and
  `weight = dollar / AUM` round-trip on composed state — not the implementation's own
  formula. Dollar edit MUST route through `setWeightOverride` (test the wiring: neuter the
  route and the test must fail). Sole-unit weight edit REFUSES, never renormalizes.
- **AUM-02/05 class:** parametrized test shape over venues — the SAME test parametrizes
  mt5 (`account_info`, never `fetch_balance`) AND sfox (`get_balances`) AND asserts an
  unknown non-ccxt venue yields honest skip `(rows=[], human warning)` — never a raw
  Python identifier in `sync_error` (greppable invariant per UI-SPEC).
- **AUM-04 gate:** additive field — assert the EXISTING `perKeyDailiesGateSatisfied`
  consumers (liveBaselineMetrics, usePerKeySources, MEMBER-04 stamp) are UNCHANGED, and
  the new gate excludes strategy-linked (manager) keys via BOTH link forms
  (`strategies.api_key_id` + `strategy_keys`). NOTE (planner, per RESEARCH Open Q4):
  `usePerKeySources` is DELIBERATELY repointed to the new gate — the frozen consumers are
  liveBaselineMetrics and the MEMBER-04 stamp.
- **AUM-03 copy:** grep-gate: old string "toggle on a live holding" absent repo-wide in
  src/ (excluding tests pinning the NEW copy); refusal copy names only real affordances.
- **Commit audit:** blank-mode manual-AUM commit audits via additive `manual_aum_usd`
  sentinel — never silently `_size_source: "no_holdings_snapshot"`/size 0.

---

## Falsifiability Ledger

One block of rows per ROADMAP success criterion (SC1–SC4). Each mutation is a SEMANTIC
edit to the PRODUCTION source (never the test); run once during the owning task,
observe RED, revert, and record the observed RED in the plan SUMMARY.

| SC | Criterion | Production-source mutation | Test that must go RED | Owning task | Observed |
|----|-----------|---------------------------|-----------------------|-------------|----------|
| SC1 | Direct AUM sizing: a blank-slate scenario can size and commit; "allocate $500k" expressible (AUM-01) | Add `scenarioAum` to the scenarioMetrics dep array | ScenarioComposer Test 8 (metrics AUM-invariance) | 06-T2 | ⬜ |
| SC1 | 〃 | Neuter `handleWeightChange` (dollar edit writes weight via any other path) | ScenarioComposer Test 3 (wiring falsifier) | 07-T1 | ⬜ |
| SC1 | 〃 | Flip the sentinel branch order (client manual AUM preferred over server_aum) | route.test.ts Test 10 (server truth precedence) | 07-T2 | ⬜ |
| SC2 | Non-ccxt class fixed: MT5 equity row, no raw AttributeError in sync_error, sFOX proven pre-flip (AUM-02, AUM-05) | Re-declare `_MT5_TERMINAL_LOCKS = {}` locally in job_worker | test_mt5_concurrency Test 1 (registry `is` identity) | 01-T2 | ⬜ |
| SC2 | 〃 | Comment out the dedicated `except AllocatorHoldingsSyncTransientError` arm | non_ccxt Test 3 (handler stamps human copy) | 03-T1 | ⬜ |
| SC2 | 〃 | Build the MT5 row from `balance` instead of `equity`; declare a local lock dict in allocator_positions | Test 6 (literal 123456.78) / Test 10 (lock `is` chain) | 03-T2 | ⬜ |
| SC2 | 〃 | Remove the "sfox" dispatch entry; collapse the account-scoped symbol to a constant | Test 17 (parametrized class proof) / Test 18 (non-collapse literals) | 04-T2 | ⬜ |
| SC3 | Founder's partial book reaches "From my book"; manager keys pin nothing (AUM-04) | Change the strategy_keys builder to `.eq("user_id", userId)` OR return `[]` from the read | queries.my-allocation Test 1 (end-to-end exclusion through the wired read) | 02-T2 | ⬜ |
| SC3 | 〃 | Revert `canEnterBook` to `perKeyDailiesGateSatisfied` | ScenarioComposer Test 1 (partial book reaches book mode) | 05-T1 | ⬜ |
| SC4 | Refusal copy names only real affordances (AUM-03) | Revert the :3677 refusal to the old "portfolio AUM is zero" copy / reintroduce a never-string | Tests 10-12 (equality-pinned copy) + the never-strings grep-gate | 06-T3 | ⬜ |

---

## Oracle Independence

- [ ] Money figures pinned by HAND-COMPUTED literals typed into the test (123456.78 equity; 500_000 = 25% of 2M; 111111.11 / 222222.22) — never recomputed from the implementation's own formula.
- [ ] Wiring proven by neuter/mutation falsifiers at the CALL SITE (ledger above) — never helper-only tests.
- [ ] Copy pinned by EQUALITY against literals typed into the test (the 140.1.1 lesson) plus repo-wide grep-gates on never-strings.
- [ ] Fakes are spec-constrained (unexpected attribute access raises) — AsyncMock's attribute synthesis is banned for non-ccxt clients (PATTERNS Correction 3).

Deliberate exceptions (self-reference accepted, with reason):

- 02-T1 Test 5 (extraction no-drift): compares deriveStrategylessKeys pre/post extraction — refactor-equivalence is self-referential BY DESIGN; the census tests (02-T1 Tests 1-4) carry the independent oracle.
- 06-T1 codec round-trips: encode/decode of the same codec — acceptable because backward-decode (Test 1) feeds a HAND-WRITTEN v4 blob literal, independent of the encoder.
- 04-T2 Test 17's "returns or raises only the transient type" is a deliberately weak oracle (class shape, not values) — backstopped by the banned-substring invariant and spec-constrained fakes in the same test.

---

## Wave 0 Requirements

- [ ] Existing infrastructure covers all phase requirements (vitest + pytest present);
      new test files land beside their surfaces per repo convention.
- [ ] New test files created by their owning tasks: `tests/test_mt5_concurrency.py`
      (151-01), `tests/test_allocator_positions_non_ccxt.py` (151-03).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Founder's real book reaches "From my book" (8 keys, 3 deribit + 3 mt5 zero-dailies) | AUM-04 | PROD data state | Founder account: composer shows "From my book" segment; partial-book note ABSENT — census math: allocatorEligible=2 (bybit+okx), contributing=2 ⇒ 0 of 2 not yet contributing; the note's rendering is exercised by the 151-05 unit fixtures instead |
| MT5 holdings row appears after sync on PROD | AUM-02 | Live terminal + cron | After 04:00 cron or "Sync now": mt5 key shows holdings row, `sync_status` ≠ error, no AttributeError in `sync_error` |
| Stale PROD `sync_error` on key `46293712-…` clears | AUM-02 | Stale stored value only changes on next successful sync (RESEARCH Runtime State Inventory) | Post-deploy: trigger "Sync now" (or wait one cron), re-check the column |
| Assumption A1 check (the 2 bare keys are bybit+okx) | AUM-04 | PROD census | If a zero-dailies key is allocator-only, the ≥1 relaxation (shipped) carries the founder's book instead of the exclusion alone — both are in-phase, so no action either way |

---

## Ledger close-out (2026-08-07, orchestrator)

All 15 per-task rows and the Falsifiability Ledger were discharged during execution;
the Observed-RED evidence was recorded in each plan's SUMMARY (§ self-check — RED commit
hashes + failure counts, incl. two mutation falsifiers) rather than back-filled here.
Verifier confirmed 30/30 must-haves with suites green (151-VERIFICATION.md). The four
PROD-gated manual rows moved to 151-HUMAN-UAT.md.
