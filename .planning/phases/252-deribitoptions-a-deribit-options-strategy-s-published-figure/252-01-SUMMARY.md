---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
plan: 01
subsystem: factsheet
tags: [headline-verdict, options-book, og-card, cache-key, proof-01]
requires: []
provides:
  - "isOptionsCashWalletBook / isOptionsCashWalletReason: the one trigger owner for the options-book withhold"
  - "options_cash_wallet withhold cause, OPTIONS_CASH_WALLET_PHRASES (headline, panel, range, card)"
  - "HeadlineNote variant structural (muted, no glyph)"
  - "public factsheet payload cache key v28"
affects: [252-02, 252-03, 252-04, 252-05]
status: complete
commits: 3
plan_head_before: 89a9e3d9713dc6ac0d6e5f0382d4ff0d66146001
plan_head_after: 886a608595743e7564fa7fff8158e2289b1a278e
actuals:
  tokens: 13931
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns:
    - "one predicate owns a structural withhold; every surface calls it and never compares the flag string"
key-files:
  created: []
  modified:
    - src/lib/factsheet/headline-basis.ts
    - src/lib/factsheet/composite-read-path.ts
    - src/lib/factsheet/types.ts
    - src/app/factsheet/[id]/v2/MetricsColumn.tsx
    - src/app/api/og/factsheet/[id]/route.tsx
    - src/app/factsheet/[id]/v2/page.tsx
    - src/lib/factsheet/fetch-and-build-payload.ts
    - src/lib/factsheet/headline-verdict.parity.test.ts
    - src/lib/factsheet/headline-basis.test.ts
    - src/lib/factsheet/composite-read-path.headline-basis.test.ts
    - src/app/factsheet/[id]/v2/FactsheetView.headline-coverage.test.tsx
    - src/app/api/og/factsheet/[id]/route.figure-gate.test.tsx
    - src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx
    - src/app/factsheet-share/[token]/page.cache-isolation.test.tsx
key-decisions:
  - "The options check is the first statement of headlineVerdict, so it beats dated and needs neither a chain break nor an applicable gate (founder ruling 2026-11-25)."
  - "isHeadlineWithheld drops its twrChainBroken conjunct: headlineWithheld alone decides."
requirements-completed: []
---

# Phase 252 Plan 01: the options-book named withhold Summary

A row whose `data_quality_flags.mtm_gated_reason` is exactly `"unsmoothed_options_book"` is now withheld by name on the factsheet read path, the KPI strip, Main Metrics, the rail panels and the OG share card; the public payload cache key moves to v28. No stored value changes.

## What was built

- **Task 1 (tracer), commit `0929531c8`.** `headline-basis.ts` gains `OPTIONS_CASH_WALLET_REASON`, `isOptionsCashWalletReason` (strict `===`), `isOptionsCashWalletBook` (record-or-null guard, then the reason check), `OPTIONS_CASH_WALLET_CAUSE`, `OptionsCashWalletSlot` and `OPTIONS_CASH_WALLET_PHRASES` (`as const satisfies Record<OptionsCashWalletSlot, string>`). `headlineVerdict` asks the predicate first. `applyHeadlineBasis` now spreads `twrChainBroken` conditionally on the row's own chain flag. `readSingleKeyBasisOpts`' no-headline branch fires for `twr_chain_broken === true || isOptionsCashWalletBook(dqf)`, and its `no_row` defect log is guarded by the chain condition. `types.ts` widens `headlineWithheldCause`. `MetricsColumn.tsx` adds the `structural` variant, drops the chain conjunct from `isHeadlineWithheld`, and answers the cause arm in `headlineCoverageNote` before the chain-broken early return.
- **Task 2, commit `b85a90bf5`.** `route.tsx` computes one boolean from the existing `effectiveFlags` (no second `effectiveDataQualityFlags` call, census still 1), skips the D-15 record arm for a triggered row, and sets `figureNote` to the card sentence on every path. Table-driven NOT_TRIGGERS, precedence, MT5 shapes, phrase table, composite-reader and structural render cases added.
- **Task 3, commit `886a60859`.** Key `factsheet-v2-payload-v28` with its dated bump line; four pins in `page.public-cache-key.test.tsx`, `EXPECTED_KEY_PREFIX`, and the quoted key in `fetch-and-build-payload.ts`' docblock (comment only).

## PROOF-01 (verbatim)

Every neuter was made on a copy backed up byte-for-byte, restored with `cp`, proven with `cmp` (exit 0), then re-run GREEN. Output below is the vitest FAIL/summary lines, with the long describe prefixes shortened.

### Tracer RED, before any source edit (the new describe against today's code)

```
 FAIL  headline-verdict.parity.test.ts > 252 SC-2 > the evidence shape (chain broken, dated, reason) is withheld, not dated: seven scalars null, cause named, chain flag kept
 FAIL  ... > the same flags with the chain keys removed are withheld too, and carry no twrChainBroken key
 FAIL  ... > a not-applicable stored headline (failed) still withholds with the options cause, not 'failed'
 FAIL  ... > the composite arm's own call redacts every BASIS_KPI_MAP key and names the cause
 FAIL  ... > the card prints three dashes for the evidence shape and for the intact-chain shape
 FAIL  ... > the note names the reason in muted text with no glyph, on the strip, strip-relative and Main Metrics slots
 FAIL  ... > the intact-chain shape names the reason, never the chain-break wording
 Test Files  1 failed (1)
      Tests  7 failed | 14 passed (21)
```

The two shapes both fail, as the plan requires. Sample of the received values at HEAD: the evidence row's strip note read `Measured since Dec 16, 2025; earlier history is unreliable (it includes a break in the return chain)...` with variant `dated` (the founder's evidence: dated, scalars kept); the intact-chain row's note was `undefined` (clean). The two passing cases are the anti-vacuity control and the off-cash-basis null.

### Tracer GREEN

```
 Test Files  4 passed (4)
      Tests  263 passed (263)
```
(parity, headline-basis, composite-read-path.headline-basis, composite-read-path.)

### PROOF-01 predicate: `isOptionsCashWalletBook` made `return false`

```
 FAIL  ... > the evidence shape (chain broken, dated, reason) is withheld, not dated ...
 FAIL  ... > the same flags with the chain keys removed are withheld too ...
 FAIL  ... > a not-applicable stored headline (failed) still withholds with the options cause ...
 FAIL  ... > the composite arm's own call redacts every BASIS_KPI_MAP key and names the cause
 FAIL  ... > the card prints three dashes for the evidence shape and for the intact-chain shape
 FAIL  ... > the note names the reason in muted text with no glyph ...
 FAIL  ... > the intact-chain shape names the reason, never the chain-break wording
 Test Files  1 failed (1)
      Tests  7 failed | 14 passed (21)
cmp exit 0
 Test Files  1 passed (1)
      Tests  21 passed (21)
```

### PROOF-01 verdict order: options check moved below the `dated` return (dated wins)

```
FAIL: the evidence shape (chain broken, dated, reason) is withheld, not dated ...
FAIL: the same flags with the chain keys removed are withheld too ...
FAIL: a not-applicable stored headline (failed) still withholds with the options cause ...
FAIL: the composite arm's own call redacts every BASIS_KPI_MAP key and names the cause
FAIL: the card prints three dashes for the evidence shape and for the intact-chain shape
FAIL: the note names the reason in muted text with no glyph ...
FAIL: the intact-chain shape names the reason, never the chain-break wording
 Test Files  1 failed (1)
      Tests  7 failed | 14 passed (21)
cmp exit 0
 Test Files  1 passed (1)
      Tests  21 passed (21)
```

Plan deviation on the expectation (not a code deviation): the plan said the intact-chain case "still passes" under this neuter. It does not, and cannot: with the options check below the chain tests, an intact chain returns `clean` first, so that case fails too. The evidence-shape case fails as the plan says. Two other placements were tried first and recorded here for honesty: the check placed after the `headlineSince` test but before the gate test left the evidence shape still withheld (5 fail, 16 pass; the evidence-shape page case passes because that placement still precedes `dated`), and the check placed after the gate test but before the `dated` return gave the same 5 fail. Only a placement below the `dated` return makes dated win, which is the neuter above.

### PROOF-01 note: the cause arm in `headlineCoverageNote` deleted

```
FAIL: the note names the reason in muted text with no glyph, on the strip, strip-relative and Main Metrics slots
FAIL: the intact-chain shape names the reason, never the chain-break wording
 Test Files  1 failed (1)
      Tests  2 failed | 19 passed (21)
cmp exit 0
 Test Files  1 passed (1)
      Tests  21 passed (21)
```

### PROOF-01 card line: the `figureNote` assignment for the cause removed from `route.tsx`

```
FAIL: the share card names the options-book reason > an admitted triggered row prints three dashes and the card sentence; the D-15 record line does not overwrite it
FAIL: the share card names the options-book reason > a triggered row that is NOT admitted (failed) prints three dashes and the same sentence
 Test Files  1 failed (1)
      Tests  2 failed | 10 passed (12)
cmp exit 0
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

### PROOF-01 strict equality: `isOptionsCashWalletReason` made trimmed and case-insensitive

```
FAIL: an intact composite with mtm_gated_reason = a case variant
FAIL: an intact composite with mtm_gated_reason = a mixed case variant
FAIL: an intact composite with mtm_gated_reason = a leading-space variant
FAIL: an intact composite with mtm_gated_reason = a trailing-space variant
FAIL: a dated chain-broken composite with mtm_gated_reason = a case variant
FAIL: a dated chain-broken composite with mtm_gated_reason = a mixed case variant
FAIL: a dated chain-broken composite with mtm_gated_reason = a leading-space variant
FAIL: a dated chain-broken composite with mtm_gated_reason = a trailing-space variant
FAIL: an undated chain-broken composite with mtm_gated_reason = a case variant
FAIL: an undated chain-broken composite with mtm_gated_reason = a mixed case variant
FAIL: an undated chain-broken composite with mtm_gated_reason = a leading-space variant
FAIL: an undated chain-broken composite with mtm_gated_reason = a trailing-space variant
 Test Files  1 failed (1)
      Tests  12 failed | 129 passed (141)
cmp exit 0
 Test Files  1 passed (1)
      Tests  141 passed (141)
```

### PROOF-01 cache key: the v27 key put back in `page.tsx`

```
 FAIL  page.public-cache-key.test.tsx > WR-02 - the public factsheet cache is keyed by the analytics run it was built from > KEY SHAPE: ...
 FAIL  page.public-cache-key.test.tsx > 167.1.2.2.2 plan 10 - a tick or a provenance write ... > the key carries the raw stamp and a short fingerprint ...
 FAIL  page.public-cache-key.test.tsx > 166.3.1 D-05 - the key's last member is the row's computation_status > KEY SHAPE edge: ...
 FAIL  page.public-cache-key.test.tsx > 237 CACHE-03 - a failed BTC price read is rendered, never stored > GOOD-AFTER-BAD: ...
 Test Files  1 failed (1)
      Tests  4 failed | 16 passed (20)
cmp exit 0
 Test Files  1 passed (1)
      Tests  20 passed (20)
```

## Existing case updated (named, not deleted)

`FactsheetView.headline-coverage.test.tsx`, "Test C (one discriminator)", asserted `isHeadlineWithheld({ ...WITHHELD_DQ, twrChainBroken: false }, "cash_settlement")` is `false`. That pinned the dropped `twrChainBroken` conjunct, a state the read path never produced (it sets `headlineWithheld` only on a withheld verdict, and used to set it only with the chain key). Its intent is now: `headlineWithheld` alone decides; that same input reads `true`, `{ composite: true, headlineWithheld: true }` reads `true`, and a chain break without the withheld flag reads `false`. No other existing case changed.

## Verification

- `npm run typecheck`: clean.
- `npm run lint`: 0 errors, 4 warnings. All four are unused-import / unused-variable warnings that were there before this plan (`nativeUnitReason` in `MetricsColumn.tsx`, `isRankableAnalyticsRow` in `composite-read-path.ts`, two in `queries.stale-analytics-detail.test.ts`); none comes from a line this plan added.
- `node scripts/verify-plan-anchors.mjs --pending`: `OK: 20 plan file(s), no stale claims.`
- Plan verify command, whole sweep (`src/lib/factsheet`, `src/app/factsheet/[id]/v2`, `src/app/api/og/factsheet/[id]`, `src/app/factsheet-share/[token]`, the recompute-verdict census, the Phase 148 owner-lane isolation test): `Test Files 1 failed | 207 passed (208)`, `Tests 2 failed | 3820 passed (3822)`.
- The 2 failures are `src/lib/factsheet/compute.conventions.test.ts`, "fixture B" and "fixture C" of the frozen byte-identical snapshot: a last-digit float difference in `skew` (`-0.11360716852722537` expected, `-0.11360716852722538` received; `0.036844507138639` expected, `0.036844507138638946` received). `compute.ts` is untouched by this plan (`git diff` over the plan range is empty for it), so these are not caused here. Not fixed: out of scope. Not confirmed against a clean base checkout (no worktree run was made), so "pre-existing" is an inference from the untouched file, not a measurement.

## Deviations from Plan

### Auto-fixed Issues

None beyond the PROOF-01 expectation note and the updated "Test C" case above.

### Left alone, for plan 252-02

`build-payload.ts` line `headlineWithheld: opts?.dataQuality?.twrChainBroken === true && opts.dataQuality.headlineWithheld === true` (the window gate input) and `MetricsColumn.tsx`'s `windowCoverageNote` / `headlineBenchSource` still read `twrChainBroken`. The plan assigns them to 252-02 and says not to edit them here. Consequence until 252-02 lands: for an options row on an INTACT chain the strip, Main Metrics and panel notes and the seven nulled scalars are right, but the selected-range window gate does not yet treat that row as withheld.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema surface; T-252-01 (strict equality, NOT_TRIGGERS table), T-252-02 (cache key v28) and T-252-04 (phrase table carries no flag, job or chain wording, asserted by test) are mitigated as planned. T-252-03 is accepted as planned.

## Self-Check: PASSED

- Commits `0929531c8`, `b85a90bf5`, `886a60859` are reachable from HEAD; `commits: 3` was measured from the persisted ledger (`plan_head_before` to HEAD).
- All 14 files listed under `key-files.modified` exist and are in the three commits.
- STATE.md, state.json and ROADMAP.md were not touched.
