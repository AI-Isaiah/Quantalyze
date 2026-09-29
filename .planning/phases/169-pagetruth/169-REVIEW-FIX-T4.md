---
phase: 169-pagetruth
topic: T4 (money module, open positions, risk attribution)
fixed_at: 2026-09-29T00:00:00Z
review_path: .planning/phases/169-pagetruth/169-REVIEW.md + .planning/phases/169-pagetruth/169-REVIEW-SFH.md
iteration: 1
findings_in_scope: 7
fixed: 5
skipped: 2
status: partial
---

# Phase 169: Code Review Fix Report, topic T4

**Fixed at:** 2026-09-29
**Branch:** `feat/169-fix4`, cut from `feat/169-pagetruth` at `8d9155b7a`. The orchestrator merges it back.
**Source reviews:** `169-REVIEW.md` (IN-04, IN-05) and `169-REVIEW-SFH.md` (M-4, M-5, L-3, L-4, L-5)
**Iteration:** 1

**Summary:**
- In scope: 7. That is the five assigned findings, plus L-4 and L-5, the two LOW items whose files are in this area.
- Fixed: 5 (M-4, M-5, IN-04, IN-05, L-3).
- Skipped and recorded: 2 (L-4, L-5).

## Fixed Issues

### L-3: `formatUsdPrice(-0)` returned "-$0.00"

**Files modified:** `src/lib/dollar-validation.ts`, `src/lib/dollar-validation.test.ts`
**Commit:** `e041950e8`
**Applied fix:**
- `formatUsdPrice` normalises `-0` to `0` before it picks a branch. Only an exact `-0` can reach the 2-decimal branch as a zero. Any other negative under $1 takes the significant-digits branch and keeps its real sign.
- **This closes the whole class, not just the one function.** `formatUsd` had the same defect, measured in node: `-0` and `-0.4` printed "-$0", and `NaN` printed "$NaN". It now rounds to whole dollars first and takes the sign from the rounded value, which is the rule `formatUsdSigned` and `signAtCents` follow. It also renders the em-dash for non-finite input.
- The non-finite guard is also a precondition for IN-04: HoldingDetail's private copy guarded non-finite input and the module did not.
- `formatUsd(-0.5)` still reads "-$1", because `toFixed` rounds half away from zero, as `toLocaleString` does.
- Output for finite amounts that do not round to zero is unchanged. The existing pins (`$120,000`, `$1,235`, `$1,000`, `-$2,500`) all still pass.

**Proof:**
- Test-first: the 3 new cases were RED against the unchanged module ("$NaN", "-$0", "-$0.00").
- Neuter: removing the two normalisations reddened the 2 signed-zero cases.
- Restore: the file was restored from a byte backup, and `cmp` matched it.

### IN-04: Two private `formatUsd` copies outside the one money module

**Files modified:**
- `src/app/(dashboard)/allocations/components/HoldingDetail.tsx`
- `src/components/exchanges/AllocatorExchangeManager.tsx`
- `src/components/exchanges/AllocatorExchangeManager.test.tsx`
- `src/lib/dollar-validation.test.ts`

**Commit:** `5992b1d46`
**Applied fix:**
- Both private functions are deleted, and both files import `formatUsd` from `src/lib/dollar-validation.ts`.
- **HoldingDetail:** the output is byte-identical, because its copy duplicated the module's body.
- **AllocatorExchangeManager (a visible copy change):** the key card's balance used a compact form ("$12.3k", "$2.50M"). It now reads whole dollars ("$12,345", "$2,500,000"). That matches DESIGN.md's Currency row ("Amounts … stay whole dollars"). A NaN balance now reads "—", not "$NaN".
- **For the 167.1.2 C4 merge:** the AllocatorExchangeManager hunk is only the import and the deleted function. The call site (`formatUsd(key.account_balance_usdt)`) is untouched.

**Guards added:**
- A contract test in `dollar-validation.test.ts` fails on any `formatUsd` declared outside the module. `src/app/factsheet/` is excluded, because DESIGN.md's "one formatter module per surface family" gives the factsheet its own `format.ts`.
- `AllocatorExchangeManager.test.tsx` has four balance cases with typed-literal oracles.

**Proof:**
- Test-first: the contract test was RED and named exactly `HoldingDetail.tsx:43` and `AllocatorExchangeManager.tsx:188`. Three of the four balance cases were RED.
- Neuter: restoring both pre-fix sources reddened all 4 tests again.
- Restore: both files were restored from byte backups, and `cmp` matched them.

### M-4: The open-positions total counted a trusted row's missing P&L as $0.00

**Files modified:**
- `src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx`
- `src/app/(dashboard)/allocations/components/OpenPositionsTable.all-columns.test.tsx`
- `src/app/(dashboard)/allocations/components/untrusted-key-status.surfaces.test.tsx`

**Commit:** `10c5001b5`
**Status:** fixed: requires human verification (the wording below is new copy)
**Applied fix:**
- The one existing pass now also counts rows whose P&L is reported, whatever their key's status. The sum itself is unchanged (D-03).
- **Every P&L missing:** the total cell is the em-dash, uncoloured. A muted note reads "P&L unavailable for N of M positions."
- **Some missing:** the total keeps the sum of the reported rows and its sign colour. The note reads "Partial total: P&L unavailable for N of M positions."
- **All reported:** no note. A real reported zero still reads "$0.00".
- The note has its own `<tr>` and testid (`open-positions-pnl-unavailable-note`). It uses the key-trust note's tone (muted, `text-xs`, colSpan 7). The key-trust note and its roughly dozen literal pins are untouched.
- The note counts every row with no P&L, so for an untrusted row it overlaps the key-trust part's "(P&L unavailable for k …)". Both statements are true at their own scope, and they use the same noun phrase.
- The open-positions total is computed inside `OpenPositionsTable.tsx`. `live-holdings-summary.ts` (the composer's AUM total, 167.1.2's) was read and not modified.

**Proof:**
- Test-first: the 3 new cases were RED against the unchanged component, and the WR-03 test was extended with the partial note.
- Neuter: making the total always the sum, and hiding the note, reddened all 4.
- Restore: the file was restored from a byte backup, and `cmp` matched it.

### M-5: A missing `weight_pct` became 0.0% and marked every row "Overweight risk"

**Files modified:**
- `src/lib/types.ts` (the `RiskDecompositionRow` block only)
- `src/lib/portfolio-analytics-adapter.ts` and its test
- `src/components/portfolio/RiskAttribution.tsx` and its test
- `src/lib/portfolio-insights.ts` and its test

**Commit:** `5ece86168`
**Applied fix:**
- `weight_pct` is `number | null` in the type, the adapter (`?? 0` dropped) and RiskAttribution's prop type.
- A null weight renders "—". With no weight there is nothing to compare the share against, so the assessment is a colorless "—". The risk share still renders.
- ⚠️ **Outside the listed area: `src/lib/portfolio-insights.ts`.** The type change forced it: it is the only other reader of the field, and tsc fails without it. The same defect was live there. `computeBiggestRisk` could write "…% of portfolio volatility on 0% of capital." It now compares only rows with both a share and a weight, which is the null-filter pattern the file already used for `marginal_risk_pct`. `computeConcentrationCreep` picks its top weight from rows that have one, keeps the full strategy count for the equal-weight baseline, and returns null when no row has a weight. No sibling fixer (T1–T3) touches this file.
- ⚠️ **`src/lib/types.ts`:** only the `RiskDecompositionRow` block was edited. T1's IN-02 names `src/lib/factsheet/types.ts`, a different file. I name it here so the merge can be watched.

**Proof:**
- Test-first: the adapter case, the `computeBiggestRisk` case and the RiskAttribution case were RED against the unchanged code. RiskAttribution read "Overweight risk".
- Neuter: restoring `?? 0`, the share-only assessability and the share-only filter reddened all 3. Removing the empty-weights guard reddened the creep "no row has a weight" case.
- Restore: every file was restored from a byte backup, and `cmp` matched it.
- One pin could not be shown RED against the pre-fix code: the creep "picks the top weight from the rows that have one" case. Before the fix a null read as 0, which can never be the top weight, so that case passed. It pins the new filter's behaviour.

### IN-05: RiskAttribution called risk shares an unsigned domain

**Files modified:** `src/components/portfolio/RiskAttribution.tsx`, `src/components/portfolio/RiskAttribution.test.tsx`, `src/lib/types.ts`
**Commit:** `c83166375`
**Applied fix:**
- The component's prop docblock, its chart comment, the `marginal_risk_pct` docblock in `types.ts` and the test header now say the same thing. Weights are unsigned. A risk share is negative for a strategy that offsets the book's risk. The shares sum to 100, so the others then exceed it.
- A new case pins a hedge's "-12.0%" in both the table cell and the tooltip, beside "112.0%".

**Proof:**
- The case passed on the current code, as the review said: the display was already right.
- Neuter: `Math.abs` in the percent conversion reddened it.
- Restore: the file was restored from a byte backup, and `cmp` matched it.

**Two things observed and not fixed:**
- `formatPercent` (`src/lib/utils.ts`, the product-wide canonical helper, outside this area) prints an ASCII hyphen-minus. DESIGN.md's Percentages row asks for U+2212. So the test pins what renders today, "-12.0%". Changing it is a product-wide formatter change for its owner.
- D-49's rationale sentence in `169-CONTEXT.md` ("weights and shares are an unsigned domain") is now known to be false for shares. CONTEXT.md was not edited.

## Skipped Issues

### L-4: A hedge's negative share is clipped out of the bar, and its row reads "Balanced" in green

**File:** `src/components/portfolio/RiskAttribution.tsx:59` (`domain={[0, 1]}`) and the assessment cell
**Reason:**
- This needs a rendering decision that the review leaves open: should the bar drop negative segments, or draw them left of 0 (for example with `stackOffset="sign"` and a widened domain)? And what should a hedge's row say instead of "Balanced"? Either answer is new copy or new chart behaviour.
- A recharts layout cannot be verified under the test file's recharts mock.
- The component's chart comment now names the gap and points to L-4.

**Original issue:** the Euler share can be negative, so a hedge leg is drawn left of 0 and clipped, and the positive legs, which then sum past 100%, overflow the domain. The table labels the negative share "Balanced" in green.

### L-5: `standalone_vol` is `+`-signed at 2 dp, and `?? 0` in the adapter

**File:** `src/components/portfolio/RiskAttribution.tsx` (Standalone Vol cell); `src/lib/portfolio-analytics-adapter.ts` (`standalone_vol: asNumber(...) ?? 0`)
**Reason:**
- Locked by 169 D-49: "`standalone_vol` is not double-scaled and is left alone; its missing period label is copy (Phase 170.1)."
- Making it nullable would also reach the trailing-stop lookup in `portfolio-insights.ts` (`volByStrategy`). That goes beyond the M-5 change, which that file needed for type-safety.
- The review itself classes L-5 as Info.

**Original issue:** it is formatted signed at 2 decimals next to unsigned 1-decimal columns, and a missing value reads 0.

## Verification

**Where the gates ran:**
- Every gate ran in this fix worktree (`feat/169-fix4`), a sibling checkout of the main one.
- Its `node_modules` is a symlink to another sibling checkout's (`quantalyze-167.1.2-c2`). `npm run lint`'s eslint cache (`node_modules/.cache`) therefore lives in that checkout.
- The numbers reproduce on this branch's tree.

**Gates:**

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p .` | clean. The baseline before any edit was also clean, so no pre-existing errors were inherited. |
| `npm run lint` | clean: eslint, admin-route manifest (20), route contract (58), planning hygiene. |
| The brief's vitest set, plus `portfolio-analytics-adapter.test.ts` and `portfolio-insights.test.ts` | 159 files, **2604 passed**. The baseline was 2586 on the same 159 files, so +18 new cases and 0 regressions. |
| Suites of the other importers of the touched modules: `src/components/strategy`, the new-strategy wizard, `/portfolios`, `finalize-wizard`, `seed-integrity` | 93 files, 1767 passed. |

**Commits (5 fixes, plus this report):**
- `e041950e8` L-3
- `5992b1d46` IN-04
- `10c5001b5` M-4
- `5ece86168` M-5
- `c83166375` IN-05

---

_Fixed: 2026-09-29_
_Fixer: Claude (gsd-code-fixer), topic T4_
_Iteration: 1_
