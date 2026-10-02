---
phase: 115-e2-allocator-equity-reconstruction-scope-gated-verify-first
verified: 2026-07-18T00:00:00Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: passed
  previous_score: 9/9
  re_run_date: 2026-07-18
  re_run_head: 96844ea6
  reason: "Prior 9/9 verification (2026-07-17) predated ~19 hardening commits (3 red-team rounds + specialist fan-out): money-math fixes (F1/F2/G1 seam-day, LOCF rotation double-count, MWR terminal drop, finiteness guards) + type refactor (DegradeReason enum, is_trustworthy, LedgerScalars, required Seam.prev_keys/next_keys). Re-run confirms goal + additive-only invariant survive."
  gaps_closed: []
  gaps_remaining: []
  regressions: []
  verdict: "ALL 9 TRUTHS RE-VERIFIED — no regression. Additive-only invariant STRICTLY holds on hardened tree; type refactor did NOT wire a new production consumer."
gaps: []
deferred:
  - truth: "Frontend allocator equity DISPLAY repointed off legacy value_usd onto the per-key blend ($-curve on the dashboard)"
    addressed_in: "Phase 115.1"
    evidence: "ROADMAP L199 Phase 115.1 (worker-side flow-aware $-equity derivation onto a NEW keyed surface + repoint queries.ts equityDailyPoints / EquityCurve+DrawdownChart); REQUIREMENTS BACKBONE-02 SPLIT + BACKBONE-03 else-branch; 115-STITCH-02-DEFERRAL.md §(c). Still deferred: core's is_trustworthy is DORMANT (allocator_equity_derive.py L333: 'not display-wired'), confirming no accidental display consumer landed during hardening."
  - truth: "allocator_equity_snapshots store retirement (BACKBONE-03) — table DROP + job/cron/constraint teardown"
    addressed_in: "Deferred (gate did not clear) — residual census in 115-STITCH-02-DEFERRAL.md"
    evidence: "Reader census R1/R2 per-symbol breakdown HARD blockers + writer-side _compute_daily_equity monopoly + R5 GDPR + R6 SQL enqueue/pg_cron; census did NOT clear"
---

# Phase 115: E2 Allocator Equity Reconstruction (SCOPE-GATED) Verification Report

**Phase Goal (revised):** Allocator equity derives from the per-key daily-series blend on the backbone (derivation CORE this phase); store retirement gated on a reader census (census did NOT clear → deferred, correctly); frontend display-repoint SPLIT to Phase 115.1.
**Originally verified:** 2026-07-17 (initial, 9/9)
**Re-verified:** 2026-07-18 against HEAD `96844ea6` (post-hardening)
**Status:** passed (unchanged)

---

## RE-VERIFICATION ADDENDUM — 2026-07-18 (HEAD 96844ea6)

**Why re-run:** The initial 9/9 verification was written 2026-07-17, BEFORE the derivation core (`services/allocator_equity_derive.py`) went through 3 red-team rounds + a full specialist fan-out (~19 hardening commits). Concretely landed since: money-math fixes (F1 seam-day real-flow double-book, F2 start-capital vs end-of-day weighting, G1 = F1+F2 composition, G2 non-finite flow guard, LOCF rotation double-count, MWR terminal-value drop, finiteness guards on returns/weights/anchor/flows) and a TYPE refactor (`DegradeReason` enum + `degrade_reasons`/`is_trustworthy` on result dataclasses; `Seam.prev_keys`/`next_keys` now required with `@property` labels; `mwr_and_dietz_from_ledger` returns `LedgerScalars(mwr,dietz,computable)` instead of a tuple).

**Verdict: ALL 9 TRUTHS RE-VERIFIED — NO REGRESSION.** The hardening grew the core from 706 → 1279 lines and its coverage 96% → 98%, added tests (E2+gate 61 → 78; full suite 3727 → 3766), and did NOT touch any existing production file or wire a new production consumer.

### Re-run evidence (measured, not claimed)

| Check | Prior (07-17) | Now (07-18, HEAD 96844ea6) | Verdict |
|-------|---------------|----------------------------|---------|
| Additive-only diff — `equity_reconstruction.py` `git diff 6b4e9285..HEAD` | 0 lines | **0 lines** | ✓ HOLDS |
| Non-test / non-planning source changed in whole phase range | 2 new files | **exactly 2 NEW files** (`allocator_equity_derive.py` +1279, `e2_allocator_ground_truth.py` +493), 1772 insertions / **0 deletions**, no existing file modified | ✓ STRICTLY additive |
| `job_worker.py` in diff | not present | **not present** | ✓ HOLDS |
| `allocator_equity_snapshots` WRITE in diff | none | **none** — the only new reference is a read-only `.select("asof, breakdown")` in the ground-truth harness (harness L256); the `.upsert` at `equity_reconstruction.py:1323` lives in the untouched 0-diff file | ✓ HOLDS |
| `match.py` changed in phase range | unchanged | **unchanged (empty diff)** — golden is genuine insurance; match input path untouched | ✓ HOLDS |
| Production consumers of `allocator_equity_derive` | harness + tests only | **harness + 4 test files only** — NO router / worker / job / cron / main imports it (type refactor did NOT wire a new consumer) | ✓ HOLDS |
| `compute_twr` in core | absent | **absent** (no token); `equity_reconstruction.compute_twr` still a `self`-method at L2972, P114-exempt | ✓ delete-gate clean |
| E2 + E1 delete-gate suites | 61 passed | **78 passed** (test_e2_allocator_blend / _deribit_allocator_dailies / _equity_curve_layer / _ground_truth_harness / _match_score_golden / _parity_oracle / _seam_ledger + test_e1_delete_gate) | ✓ PASS |
| Full analytics suite | 3727 passed, 93 skipped | **3766 passed, 93 skipped** | ✓ PASS |
| Coverage — TOTAL / new module | 90% / 96% | **91% / 98%** (`allocator_equity_derive.py` 381 stmt, 8 miss) — ≥80 gate | ✓ PASS |

### Type refactor coherence (present + isolated)

- `DegradeReason(str, Enum)` + `_is_trustworthy(frozenset[DegradeReason])` + `is_trustworthy` `@property` on all three result dataclasses (blend / equity-curve / ledger) — L93–L580.
- `Seam` dataclass: `prev_keys: tuple[str, ...]` / `next_keys: tuple[str, ...]` REQUIRED; scalar labels `prev_key`/`next_key` DERIVED via `@property _key_label` (C2 desync fix) — L379–L406; construction site passes covering tuples (L499–L500).
- `mwr_and_dietz_from_ledger(...) -> LedgerScalars` (L1192–L1279); refuses with `LedgerScalars(None, None, computable=False)` — never a fabricated scalar (C4). KEPT path wired: `from services.portfolio_metrics import compute_modified_dietz, compute_mwr` (L90), still the first production caller; `NavReconstructionError` reused (L87) — no parallel NAV chain.
- `is_trustworthy` is documented DORMANT — `allocator_equity_derive.py` L333: "This is DORMANT today (the blend's is_trustworthy is not display-wired)." This CONFIRMS the frontend display-repoint remains deferred to 115.1 and the hardening did not sneak a display consumer in.

### Per-truth re-verdict

| # | Truth | 07-17 | 07-18 re-verdict |
|---|-------|-------|------------------|
| 1 | Census recorded + store deletion gated/deferred | ✓ | ✓ VERIFIED — `115-STITCH-02-DEFERRAL.md` (112 lines) intact; census did not clear; store untouched (0-diff) |
| 2 | Core derives from per-key daily blend on backbone, not reconstruction stack | ✓ | ✓ VERIFIED — core present (1279 lines, 98% cov); `blend_concurrent_returns`/`perf_curve`/`replay_key_equity`/`allocator_equity_curve`/`build_allocator_ledger`/`mwr_and_dietz_from_ledger` all present; imports KEPT path, not the store |
| 3 | match.py parity via golden | ✓ | ✓ VERIFIED — `match.py` unchanged in range; `test_e2_match_score_golden` green |
| 4 | STITCH-01 blend (capital-weighted, never disjoint stitch) | ✓ | ✓ VERIFIED — `test_e2_allocator_blend` green in 78-pass run |
| 5 | STITCH-03/04 perf≠$-curve + backward derivation | ✓ | ✓ VERIFIED — `test_e2_equity_curve_layer` green; backward-identity + `NavReconstructionError` refusals intact |
| 6 | STITCH-05/06 one ledger + seam | ✓ | ✓ VERIFIED — `test_e2_seam_ledger` green; single `LedgerScalars` construction; F1/F2/G1/G2 seam money-math fixes pinned by new tests |
| 7 | Independent RED-capable oracle | ✓ | ✓ VERIFIED — `test_e2_parity_oracle` green; canary raises as designed (deliberate degenerate-input RuntimeWarnings only, no failures) |
| 8 | Deribit gap honestly characterized (operational, not "closed") | ✓ | ✓ VERIFIED — deferral doc §L74 + 115-04-SUMMARY: root cause (B) never-backfilled; "all-deribit allocators still render nothing until backfill runs"; no `job_worker.py` edit |
| 9 | Additive-only + suite/coverage ≥ gate | ✓ | ✓ VERIFIED — 2 new files / 0 deletions; `equity_reconstruction.py` 0-diff; no `job_worker.py`; no snapshots write; delete-gate green; 3766 passed; 91%/98% coverage |

**Re-verification score: 9/9 truths re-verified. 0 regressions. 0 new gaps.** The two deferred items (frontend display-repoint → 115.1; store retirement → census-gated deferral) remain correctly deferred and are unaffected by the hardening.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | **[SC1 GATE]** Reader census completes + is recorded; store deletion (BACKBONE-03) proceeds ONLY if census clears — else display-repoint ships, store stays | ✓ VERIFIED | `115-STITCH-02-DEFERRAL.md` + RESEARCH §1: whole-repo census (R1–R10, F1–F4) recorded; census did NOT clear (R1/R2 per-symbol `breakdown` HARD blockers + writer-side `_compute_daily_equity` monopoly). Store deferred. `equity_reconstruction.py` **0-diff** in the phase range; `compute_twr` untouched. |
| 2 | **[SC2]** Allocator equity derivation core derives from the per-key daily blend on the backbone, not the separate reconstruction stack | ✓ VERIFIED (core) | `services/allocator_equity_derive.py` (1279 lines post-hardening, 98% cov): `blend_concurrent_returns` (D1/D2/D3 port of queries.ts), `perf_curve`, `replay_key_equity`, `allocator_equity_curve`, `build_allocator_ledger`, `mwr_and_dietz_from_ledger`. Frontend DISPLAY repoint scheduled Phase 115.1 (see Deferred). |
| 3 | **[SC3]** Parity verified on `match.py` match/score outputs (not just the dashboard number) | ✓ VERIFIED | `tests/test_e2_match_score_golden.py` drives real `_load_allocator_context` + `score_candidates` (mocked supabase), byte-stable JSON golden green; honestly framed as insurance (match input path UNCHANGED; `match.py` 0-diff in range). |
| 4 | STITCH-01 blend: concurrent keys → capital-weighted BLEND, never disjoint-window stitch (L1); D3 all-or-nothing | ✓ VERIFIED | `test_e2_allocator_blend.py`: L1 regression monkeypatches `assert_windows_disjoint` to explode; D3 honest-empty; static-weight invariance; equal-weight fallback. |
| 5 | STITCH-03/04: perf-curve ≠ $-curve (identical zero-flow, diverge by flow step); unknown start → backward from anchor; anchor=None → no $-curve, flagged | ✓ VERIFIED | `test_e2_equity_curve_layer.py`; backward identity `equity_{t-1}=(equity_t−F_t)/(1+r_t)` + forward self-check; `NavReconstructionError` on structural refusal, no USD leak. |
| 6 | STITCH-05/06: ALL flows (real + synthetic seam) in ONE dated `ExternalFlow` ledger consumed by both $-replay and Dietz/MWR; TWR clean across seam, $ steps | ✓ VERIFIED | `test_e2_seam_ledger.py`; single construction site `_ledger_entry`; `mwr_and_dietz_from_ledger` is first production caller of KEPT `compute_mwr`/`compute_modified_dietz`; unknown seam → `LedgerScalars(None,None,computable=False)` fail-loud (post-refactor C4). |
| 7 | Independent oracle re-derives every STITCH claim inline (no module/metrics on expected side) and is RED-capable (fabrication canary) | ✓ VERIFIED | `test_e2_parity_oracle.py`: `_inline_backward_equity`/`_inline_normalized_cumprod`/`_inline_modified_dietz` re-implemented from scratch; Oracle 5 corruption canary proven via `pytest.raises(AssertionError)`. |
| 8 | Deribit dogfooding gap HONESTLY characterized as operational (backfill never run), mutation-falsifiable pins, no false "closed" claim | ✓ VERIFIED | Plan-04 summary + deferral §L74: root cause **(B) never-backfilled**; handler + enqueue proven correct (2 neuter pins reverted); "an all-deribit allocator still has 0 per-key rows … until the backfill runs." Recurring-enqueue gap + approval-gated backfill flagged as follow-ups. No `job_worker.py` edit. |
| 9 | Additive-only: no snapshots write/read-for-merge; `compute_twr` + legacy store untouched; E1 delete-gate green; full suite + coverage ≥80 | ✓ VERIFIED | Whole phase range = 2 NEW files, 1772 insertions / 0 deletions. `equity_reconstruction.py` 0-diff; `job_worker.py` not in diff. Delete-gate green. Full suite **3766 passed, 93 skipped**; coverage **91% total / 98% on the new module** (≥80 gate). |

**Score:** 9/9 truths verified (re-confirmed 2026-07-18)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Frontend $-equity DISPLAY repoint (dashboard curve off legacy `value_usd`) | Phase 115.1 | ROADMAP L199; REQUIREMENTS BACKBONE-02 SPLIT; deferral doc §(c). Core `is_trustworthy` still DORMANT (not display-wired) → repoint genuinely still pending. |
| 2 | `allocator_equity_snapshots` store retirement (BACKBONE-03) | Deferred (census did not clear) | Residual-blocker ledger R1/R2/R3-partial/R5/R6 + writer monopoly in the deferral doc. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `services/allocator_equity_derive.py` | blend + $-ledger core | ✓ VERIFIED | 1279 lines (post-hardening), 98% cov, pure I/O-free; `DegradeReason`/`is_trustworthy`/`LedgerScalars`/required `Seam.prev_keys/next_keys` present |
| `tests/test_e2_parity_oracle.py` | independent oracle | ✓ VERIFIED | expected side module-free; canary RED-capable |
| `tests/test_e2_match_score_golden.py` + `.json` | match parity pin | ✓ VERIFIED | byte-stable golden green; `match.py` 0-diff |
| `tests/test_e2_allocator_blend.py` / `_equity_curve_layer.py` / `_seam_ledger.py` | STITCH pins | ✓ VERIFIED | 78 E2+gate tests green (up from 61; hardening added edge pins T1–T6, F1–F6, G1/G2) |
| `tests/test_e2_deribit_allocator_dailies.py` | deribit gap repro + regression | ✓ VERIFIED | root-cause (B), 2 mutation pins |
| `scripts/e2_allocator_ground_truth.py` | read-only acceptance harness | ✓ VERIFIED | 493 lines, read-only-proof (only `.select` on snapshots) + sanitized JSON + non-zero-on-skip; gates on `is_trustworthy`; not a stub |
| `115-STITCH-02-DEFERRAL.md` / `115-VALIDATION.md` | deferral + validation | ✓ VERIFIED | present; residual ledger + BACKBONE 115/115.1 map + A1 by-venue |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `allocator_equity_derive.py` | `services/external_flows.ExternalFlow` | ONE ledger shape | ✓ WIRED | `from services.external_flows import ExternalFlow` (L86) |
| `allocator_equity_derive.py` | `portfolio_metrics.compute_mwr/compute_modified_dietz` | first production caller | ✓ WIRED | import L90 (no twr token — delete-gate Part B clean) |
| `allocator_equity_derive.py` | `nav_twr.NavReconstructionError` + dated-flow convention | reuse (not parallel ledger) | ✓ WIRED | backward identity + refusal exception reused; not a re-hand-rolled NAV chain |
| `test_e2_parity_oracle.py` | `allocator_equity_derive` | oracle re-derives, actual side only | ✓ WIRED | expected side inline; module only on actual side |
| `allocator_equity_derive` | production consumers | none beyond harness+tests | ✓ ISOLATED | no router/worker/job/cron/main imports it — type refactor did not add a consumer |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| E2 + delete-gate + golden suites | `.venv/bin/pytest tests/test_e2_*.py tests/test_e1_delete_gate.py` | 78 passed | ✓ PASS |
| Oracle fabrication canary | Oracle 5 `pytest.raises(AssertionError)` on dropped-flow input | raises as designed | ✓ PASS |
| Full analytics suite + coverage | `.venv/bin/pytest -q --cov=services` | 3766 passed, 93 skipped, TOTAL 91% (new module 98%) | ✓ PASS |
| Additive-only diff gate | `git diff 6b4e9285..HEAD -- equity_reconstruction.py` | 0 lines | ✓ PASS |
| Whole-range source delta | `git diff --name-only 6b4e9285..HEAD` (non-test/planning) | 2 NEW files, 0 deletions, no existing file modified | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| STITCH-01 | 115-02, 115-04 | ✓ SATISFIED | canonical Python blend + deribit dailies path proven |
| STITCH-02 | 115-01 | ✓ SATISFIED (deferred, recorded) | census did not clear; deferral durable; store untouched |
| STITCH-03/04/05/06 | 115-03 | ✓ SATISFIED | equity-curve layer + one unified ledger + seam, oracle-pinned; F1/F2/G1/G2 money-math hardened |
| BACKBONE-02 | 115-02/03/05 | ✓ SATISFIED (core) | derivation core shipped; DISPLAY-repoint SPLIT → 115.1 (scheduled) |
| BACKBONE-03 | — | Deferred (gate) | census did not clear; else-branch = 115.1 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX in phase-added source | ℹ️ Info | Clean (re-scanned post-hardening) |
| `115-STITCH-02-DEFERRAL.md` | §(c) | Wave-0 doc says deribit gap "CLOSED IN THIS PHASE" | ℹ️ Info | Optimistic vs §L74/plan-04's authoritative "does not yet render until backfill runs". Not a hidden gap — CODE PATH proven/pinned; only approval-gated operational backfill remains, transparently documented. No action required. |

### Human Verification Required

None blocking. Approval-gated founder/operational follow-ups, explicitly scoped OUT of this phase's must-haves and scheduled elsewhere:
- **Live ground-truth acceptance run** (real allocator account, `railway ssh … scripts.e2_allocator_ground_truth`) — pending founder-set `E2_GROUND_TRUTH_*` env. The SCRIPT existing + correct is the must-have (verified); running it live is 115.1/production acceptance.
- **PROD A1 census** (per-key `csv_daily_returns` by venue) — only TEST recorded (364/364 deribit at 0 rows); PROD approval-gated, documented not skipped.
- **Operational deribit backfill** (`scripts.phase35_backfill_enqueue`) — approval-gated; until run, all-deribit allocators still render nothing. Recurring key-mode enqueue gap flagged for 115.1.

### Gaps Summary

No gaps — re-confirmed against HEAD `96844ea6` after the hardening campaign. The derivation core is real (not a stub): 1279-line module at 98% coverage, independent RED-capable oracle, byte-stable match golden, one-ledger seam accounting with fail-loud unknowns (now via `LedgerScalars`). The additive-only invariant holds STRICTLY and was re-measured: the entire phase range added exactly two NEW files (1772 insertions / 0 deletions) with `equity_reconstruction.py` at 0-diff, no `job_worker.py` change, no `allocator_equity_snapshots` write (only a read-only `.select` in the founder harness), and `match.py` unchanged. The money-math fixes and the type refactor (`DegradeReason`/`is_trustworthy`/`LedgerScalars`/required `Seam.prev_keys/next_keys`) did NOT break any goal-truth and did NOT wire a new production consumer — the core is still consumed only by the ground-truth harness + tests, and `is_trustworthy` is explicitly DORMANT (not display-wired), which correctly leaves the frontend display-repoint for Phase 115.1. The STITCH-02 store retirement and the frontend display-repoint remain properly deferred/scheduled — a roadmap-ratified scope split, not a hidden scope-cut. The deribit dogfooding gap is honestly characterized as operational (backfill never run) with mutation-falsifiable regression pins.

Note: Phase 115.1's ROADMAP entry still carries placeholder `Goal: [Urgent work - to be planned]` / `Requirements: TBD` / 0 plans — the descriptive header (L199) carries the scope, but the phase still needs `/gsd-plan-phase 115.1` to be broken down. Non-blocking for Phase 115.

---

_Originally verified: 2026-07-17 · Re-verified: 2026-07-18 (HEAD 96844ea6)_
_Verifier: Claude (gsd-verifier)_
