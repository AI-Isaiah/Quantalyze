---
phase: "235"
slug: "holdingstruth"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-11-26"
---

# Phase 235 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 235-RESEARCH.md `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS) and pytest (analytics-service) |
| **Config file** | `vitest.config.ts`, `analytics-service/pyproject.toml` |
| **Quick run command** | `npx vitest run <one file>`; `cd analytics-service && .venv/bin/python -m pytest tests/<file>.py -q` |
| **Full suite command** | CI only (heavy; parallel phases share the host). Per wave: the census set in RESEARCH plus `npm run typecheck` and, for analytics, mypy strict |
| **Estimated runtime** | ~60 seconds per wave set |

---

## Sampling Rate

- **After every task commit:** the single test file(s) the task edits
- **After every plan wave:** census set + `npm run typecheck` (+ mypy strict for HOLD-02)
- **Before `/gsd-verify-work`:** CI full suite green bound to the head SHA
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

Every task in plans 01 to 06 carries an `<automated>` verify block, so no three consecutive tasks lack one. Each behavior below must go RED when its fix is neutered. The PROOF-01 transcripts in each plan SUMMARY record that, and the validation audit adds one row (HOLD-04 multi-key). Statuses were measured on 2026-11-26 at origin/main `397966135`, plus the audit's test commit.

| Task | Req | Behavior | Test type | Automated command | File | Status |
|------|-----|----------|-----------|-------------------|------|--------|
| 01-T1 | HOLD-01 | `keyAccountOf` throws for a key absent from the identity read, and keeps `key:<id>` for an in-keys key it cannot place. `fetchHoldings` rejects with `HoldingsIdentityError` | unit | `npx vitest run src/lib/latest-holdings-per-key.test.ts src/lib/portfolio-exposure.test.ts src/lib/holdings-account-day.test.ts` | extend | ✅ green |
| 01-T2 | HOLD-01 | `derivePhase07Fields` throws for a counted row whose key `accountByKey` lacks, and the fixtures carry an explicit identity | unit | `npx vitest run src/lib/queries.holdings-per-key.test.ts src/lib/queries.test.ts` | extend | ✅ green |
| 01-T3 | HOLD-01 | commit route: a counted row with an unknown key is `lookup_failed` and sizes nothing. The guard row with its key present is `server_aum` | unit | `npx vitest run src/app/api/allocator/scenario/commit/ src/__tests__/scenario-commit-rls.test.ts` | new (`route.holdings-identity.test.ts`) | ✅ green |
| 02-T1/T2 | HOLD-02 | the matcher's AUM and counted keys equal the TS reader's on one shared case table (7 cases, including a failed marker read logged at ERROR with the rows kept) | unit, both runtimes | `cd analytics-service && .venv/bin/python -m pytest tests/test_match_native_unpriced_account_day.py tests/test_match_portfolio_aum_native_unpriced.py tests/test_match_portfolio_aum_per_key.py tests/test_native_unpriced_marker_reader.py -q`; `npx vitest run src/lib/native-unpriced-account-day.parity.test.ts` | new | ✅ green |
| 02 (review WR-02) | HOLD-02/04 | a failed matcher marker read returns `unpriced_check_failed` and the persisted batch carries the book-level entry. A healthy read carries none | integration | `cd analytics-service && .venv/bin/python -m pytest tests/test_match_book_join_e2e.py -q` | extend | ✅ green |
| 02-T2 | HOLD-02 | mypy strict | type | the mypy command in 235-02-PLAN | n/a | ✅ green (146 files) |
| 03-T1 | HOLD-04 | marker-only failure: `holdingsUnpricedCheckFailed` is true on both return branches, an explicit false when healthy, and the rows and AUM are kept (H1 to H4) | integration | `npx vitest run src/lib/queries.my-allocation.test.ts` | extend | ✅ green |
| 03-T2 | HOLD-04 | one throttled warning capture per window, with the exact message, tags and extra and no key id. None when healthy (S1 to S4) | integration | same file | extend | ✅ green |
| audit | HOLD-04 | ONE key's failed marker read in a multi-key book still sets `markerReadError`: a later key with rows (A1), and a later key with no rows (A2). The rows are kept | unit | `npx vitest run src/lib/latest-holdings-per-key.test.ts` | extend (validation audit) | ✅ green |
| 04-T1 | HOLD-04 | Overview note from the registry (T5, T9), with the registry and scan ledger moved | component | `npx vitest run "src/app/(dashboard)/allocations/AllocationDashboardV2.unpriced-check.test.tsx" src/lib/degrade-warnings.test.tsx src/__tests__/degrade-warning-scan.test.ts src/__tests__/copy-census.test.ts` | new | ✅ green |
| 04-T2 | HOLD-04 | Holdings tab note (T6) | component | `npx vitest run "src/app/(dashboard)/allocations/HoldingsTabPanel.unpriced-check.test.tsx"` | new | ✅ green |
| 05-T1/T2 | HOLD-05 | the producer emits grouped, attributed ids, including a group with no dated gap. The field is set in both payload literals | unit | `npx vitest run "src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts" src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts` | extend | ✅ green |
| 06-T1 | HOLD-05 | the message names every failing shared-account key by label (M1 to M8), and the book fallback stays when any group is named only by the undated line (WR-01) | component | `npx vitest run "src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx"` | extend | ✅ green |
| 06-T2 | HOLD-05 | the Overview passes the payload groups through | component | `npx vitest run "src/app/(dashboard)/allocations/AllocationDashboardV2.shared-account-named.test.tsx"` | new | ✅ green |
| all | censuses | copy, computed-at, holding-scope-key, recompute-verdict, scan | unit | `npx vitest run src/__tests__/copy-census.test.ts src/__tests__/computed-at-reader-census.test.ts src/__tests__/holding-scope-key-census.test.ts src/__tests__/recompute-verdict-census.test.ts src/__tests__/degrade-warning-scan.test.ts` | exist | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `analytics-service/tests/fixtures/native_unpriced_account_day_cases.json` — shared HOLD-02 case table
- [x] `src/lib/native-unpriced-account-day.parity.test.ts` and `analytics-service/tests/test_match_native_unpriced_account_day.py` — HOLD-02 replays
- [x] `src/lib/queries.my-allocation.test.ts` — marker-only failure injection key (HOLD-04)
- [x] Two render-test files for the HOLD-04 note mounts (T5/T6/T9)

---

## Manual-Only Verifications

Every requirement (HOLD-01, HOLD-02, HOLD-04, HOLD-05) has automated verification. One UI-SPEC `backstop` truth, which is layout and not a requirement behavior, stays manual:

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The unpriced-check note wraps inside its column at 390px on the Overview and the Holdings tab, with no horizontal scroll of `#main-content` | HOLD-04 (UI-SPEC long-text backstop) | jsdom has no layout engine. The shipped jsdom arm only pins that the class lists carry no hidden or breakpoint toggle | Load My Allocation at a 390px viewport with the marker read failing (or the flag forced), and look at the note on both surfaces. This is the `human_needed` item in 235-VERIFICATION.md and the STATE Deferred Verification row |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-11-26. Measured on 2026-11-26:
- 18 vitest files: 952 passed, 1 skipped
- `latest-holdings-per-key.test.ts`: 95 passed after the audit's 2 arms
- the censuses and `scenario-commit-rls`: 111 passed
- pytest: 38 passed in the matcher and marker set, 7 in the book-join e2e
- mypy strict clean, typecheck clean

The gap test is test PR #1380 (merge `25cbaaf1c`). Neutering the aggregation to `readings[0]?.markerError ?? null` turned A1 and A2 RED with 93 arms still green. The file was restored from a byte backup (`cmp` silent) and is green again.

## Validation Audit 2026-11-26

| Metric | Count |
|---|---|
| Gaps found | 1 |
| Resolved | 1 |
| Escalated | 0 |
