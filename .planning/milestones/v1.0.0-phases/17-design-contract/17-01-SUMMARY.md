---
phase: 17-design-contract
plan: 01
subsystem: ui
tags: [design-tokens, vitest, typescript, a11y, trust-tier]

# Dependency graph
requires:
  - phase: 15
    provides: TrustTier union (api_verified | csv_uploaded | self_reported) + CSV_UPLOADED_LABEL string in src/components/strategy/TrustTierLabel.tsx — Plan 17-01 re-exports the type and consumes the label string
provides:
  - Single source-of-truth TRUST_TIER_TOKENS constant with three variants (api_verified, csv_uploaded, self_reported), each with {fill, text, border, label} slots
  - Framework-neutral token file at src/lib/design-tokens/trust-tier.ts (no React/Next imports — loadable by Vitest, server components, admin surfaces, future Storybook)
  - Vitest consistency test tests/a11y/trust-tier-tokens.test.ts asserting every distinct hex + label appears verbatim in DESIGN.md, plus negative assertion that retired #D97706 appears at most once
affects: [17-02, 17-05, 17-06, 18, 19]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Token files use `as const satisfies Record<Variant, Slot>` — exhaustive type-safe shape, mirrors CHART_TICK_STYLE precedent"
    - "Vitest a11y assertion reads DESIGN.md text via fs.readFileSync and asserts hex/label presence — mirrors chart-contrast.test.ts; no extra deps"
    - "Single source-of-truth pedagogy: docstrings cite the canonical hex and explicitly name the retired hex with date + measured contrast ratio so future contributors find the audit trail in the file itself"

key-files:
  created:
    - src/lib/design-tokens/trust-tier.ts
    - tests/a11y/trust-tier-tokens.test.ts
    - .planning/phases/17-design-contract/deferred-items.md
  modified: []

key-decisions:
  - "Self-reported variant uses #B45309 (canonical --color-warning, AA pass at 5.05:1 on white) — NOT the retired #D97706 from REQ DESIGN-01 (3.19:1, AA fail). Aligned with CONTEXT.md decision D-01."
  - "Token file is framework-neutral. The TrustTier type stays declared at TrustTierLabel.tsx:11 (its v0 origin) and is re-exported from the new token file via `export type { TrustTier } from \"@/components/strategy/TrustTierLabel\"` so consumers can import it from the canonical token path going forward without duplicating the union (avoids drift)."
  - "Consistency test mirrors chart-contrast.test.ts pattern exactly: hand-rolled, fs.readFileSync, no extra deps (no `polished` import). it.each per hex + per label gives distinct failure attribution in CI runner output."

patterns-established:
  - "Pattern: design-tokens layer at src/lib/design-tokens/ — system-level (out of feature folders) so admin / marketplace / factsheet can all import without crossing feature boundaries"
  - "Pattern: every new token file gets a paired tests/a11y/<token-name>-tokens.test.ts that asserts hex + label consistency with DESIGN.md (atomic CI gate against drift)"
  - "Pattern: docstrings in token files cite the canonical value AND name retired/superseded values with date + measured contrast so the file is the single audit trail"

requirements-completed:
  - DESIGN-01

# Metrics
duration: 5min
completed: 2026-05-01
---

# Phase 17 Plan 01: Trust-Tier Design Tokens Summary

**TRUST_TIER_TOKENS framework-neutral design-token file with paired Vitest DESIGN.md ↔ tokens consistency assertion as atomic CI drift gate**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-01T17:35:09Z
- **Completed:** 2026-05-01T17:39:44Z
- **Tasks:** 2
- **Files modified:** 0 (2 created)
- **Files created:** 2 source/test files + 1 deferred-items log

## Accomplishments

- Created the canonical TRUST_TIER_TOKENS source-of-truth (3 variants × 4 slots each = 12 token literals) at `src/lib/design-tokens/trust-tier.ts`, framework-neutral, type-safe via `as const satisfies Record<TrustTier, TrustTierTokenSlot>`.
- Created the DESIGN.md ↔ tokens consistency Vitest test at `tests/a11y/trust-tier-tokens.test.ts`, mirror of `chart-contrast.test.ts` pattern (hand-rolled, no extra deps).
- Self-reported variant aligned with the canonical `--color-warning` `#B45309` (5.05:1 on white, AA pass), retiring the `#D97706` literal from REQ DESIGN-01 per CONTEXT.md decision D-01.
- Confirmed zero TypeScript errors introduced by either new file (`npx tsc --noEmit -p .` shows only the unrelated pre-existing `debug-key-flow/route.ts:257` error documented in `deferred-items.md`).

## Task Commits

Each task was committed atomically (worktree branch `worktree-agent-a01a941631577a3af`):

1. **Task 1: Create TRUST_TIER_TOKENS file** — `069dd81` (feat)
2. **Task 2: Create DESIGN.md ↔ tokens consistency Vitest test** — `096372b` (test)

_Note: Task 1 had `tdd="true"`. RED was demonstrated by writing a temporary minimal probe test that imported `@/lib/design-tokens/trust-tier` and observing the import failure ("Failed to resolve import"). After the token file was written, GREEN was demonstrated by re-running the same probe (1 passed). The probe was then replaced wholesale by the full Task 2 consistency test before its own commit. RED/GREEN/REFACTOR did not produce three commits because the plan's task structure puts the token file in Task 1's commit and the test file in Task 2's commit — the per-cycle RED/GREEN happened in-flight and is documented here in lieu of separate intermediate commits._

## Files Created/Modified

- `src/lib/design-tokens/trust-tier.ts` (NEW, 57 lines) — Single source-of-truth for trust-tier badge tokens. Three variants × four slots (fill/text/border/label). Re-exports `TrustTier` from `@/components/strategy/TrustTierLabel`. Framework-neutral: zero React imports, zero Next imports.
- `tests/a11y/trust-tier-tokens.test.ts` (NEW, 53 lines) — Vitest consistency assertion. `readFileSync` on `DESIGN.md`, `it.each` per distinct hex + per label, `toBeLessThanOrEqual(1)` on `#D97706` regex matches.
- `.planning/phases/17-design-contract/deferred-items.md` (NEW) — Logs the pre-existing TS error in `src/app/api/debug-key-flow/route.ts:257` discovered during Task 1 verification (out of scope; not introduced by this plan).

## Decisions Made

- **Followed plan verbatim for the token file's literal content** (per the plan's `<action>` block instruction: "executor: type this verbatim — the string formatting is part of the contract"). This includes the docstring sentence "REQ DESIGN-01 named the retired #D97706 hex" — which appears in the file's comment header but NOT as a hex literal anywhere in the code data.
- **Used regex form for the negative assertion** (`/#D97706/g` rather than string literal `"#D97706"`) per the plan's code skeleton in Task 2 lines 290-291. This means `grep -c '"#D97706"' tests/a11y/trust-tier-tokens.test.ts` returns 0 (not 1 as the plan's acceptance-criteria text suggests). The intent of the criterion is satisfied: `#D97706` is referenced ONLY as the negative-assertion target, never as a positive token literal.
- **Did not commit the temporary RED probe** as a separate commit — the probe was a transient artifact for the TDD RED gate; the plan structure places only the final files in commits.

## Deviations from Plan

### Auto-fixed Issues

None. The plan's `<action>` blocks specified the file contents verbatim and the executor implemented them as written.

### Plan Internal Inconsistencies (noted, not deviations)

**1. [Internal inconsistency] Two grep checks for `#D97706` in the token file disagreed on whether docstring mentions are allowed**

- **Found during:** End-of-plan verification (`<verification>` block)
- **Issue:** Task 1 `<acceptance_criteria>` line says `grep -c '"#D97706"' src/lib/design-tokens/trust-tier.ts` returns `0` (zero **quoted** hex literals in code) — PASSES (count = 0). End-of-plan `<verification>` line says `grep -rn "#D97706" src/lib/design-tokens/` returns no matches (zero raw occurrences anywhere) — would FAIL because the action block's verbatim content includes the docstring sentence "REQ DESIGN-01 named the retired #D97706 hex".
- **Resolution:** Followed the action block's verbatim content (more specific instruction; explicitly told the executor to type the file verbatim). The docstring is the file's audit trail explaining why `#B45309` is canonical. The Task 1 acceptance criterion (quoted-hex grep = 0) and Task 2's runtime consistency test together provide the real functional gate against using the wrong hex; a bare-grep on the token file would block legitimate documentation.
- **Files modified:** None (kept verbatim plan content).
- **Verification:** Task 1 quoted-hex grep returns 0 ✓. Task 2 runtime regex assertion `toBeLessThanOrEqual(1)` is the functional drift gate ✓.

**2. [Internal inconsistency] Task 2 acceptance criterion `grep -c '"#D97706"' tests/a11y/trust-tier-tokens.test.ts returns 1` is inconsistent with the same plan's code skeleton (which uses regex form `/#D97706/g`)**

- **Found during:** Task 2 acceptance verification
- **Issue:** Plan's code skeleton (Task 2 `<action>` lines 289-295) uses `designMd.match(/#D97706/g)` (regex literal). Plan's acceptance-criteria text says `grep -c '"#D97706"'` (quoted-hex string literal) returns 1. Both can't be true with the same file: the regex form produces 0 on a quoted-hex grep.
- **Resolution:** Followed the plan's code skeleton (more specific instruction). The intent — "ensure `#D97706` is referenced as the negative-assertion target only, never as a positive token literal" — is satisfied: `grep -c '\"#D97706\"' tests/a11y/trust-tier-tokens.test.ts` returns 0; bare grep returns 3 (regex literal + comment about historical row + comment in superseded reference).
- **Files modified:** None (kept verbatim plan code skeleton).

---

**Total deviations:** 0 auto-fixed (no Rule 1/2/3 fixes needed). 2 plan internal inconsistencies noted for the orchestrator's awareness.

**Impact on plan:** Zero scope creep. Both files match the plan's verbatim action blocks. The runtime Vitest assertion is the functional drift gate; the bare-grep checks in `<verification>` were lower-fidelity than the runtime assertion they supplement.

## Issues Encountered

- **Vitest run shows 4/8 assertions FAIL inside this isolated worktree** — Expected and pre-documented in the plan (`<acceptance_criteria>`: "After Plan 17-02 lands DESIGN.md additions, this test passes... Plan 17-01 task only verifies file exists + compiles"). Specifically: the 3 label assertions and the `#D97706 ≤ 1` assertion fail because Plan 17-02 (Wave 1 sibling) is what writes the labels into DESIGN.md and cleans up redundant `#D97706` mentions. Inside this isolated worktree those edits aren't visible. The 4 hex assertions PASS because `#B45309`, `#FFFFFF`, etc. already appear in DESIGN.md from prior phases. Phase 17 verifier (Plan 17-06) runs the full assertion gate post-Wave-1-merge.
- **Pre-existing TS error in `src/app/api/debug-key-flow/route.ts:257`** — Not caused by this plan; logged to `.planning/phases/17-design-contract/deferred-items.md` per scope-boundary rule.

## TDD Gate Compliance

Task 1 was marked `tdd="true"`. The RED gate was satisfied in-flight (temporary probe test imported `@/lib/design-tokens/trust-tier`, observed import-resolution failure from Vitest). The GREEN gate was satisfied immediately after the token file was written (same probe re-ran with 1 pass). Per plan structure (Task 1 = file commit, Task 2 = test commit), the RED/GREEN cycle did not produce intermediate test-only commits — the final test file is committed as Task 2 in commit `096372b`. Git log shows the gate-compliant order: `feat(17-01)` (Task 1, GREEN code) followed by `test(17-01)` (Task 2, full test). REFACTOR not needed — file content was verbatim from plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- TRUST_TIER_TOKENS is the contract for downstream consumers (Plan 17-05 builds the badge component, Plan 17-06 verifier asserts the consistency test passes).
- Sibling Plan 17-02 (also Wave 1) lands DESIGN.md additions referencing all three labels and trims `#D97706` mentions to ≤1; once both Wave 1 worktrees merge into the parent branch, the consistency test will exit 0.
- No blockers. The pre-existing `debug-key-flow` TS error is pre-existing on the worktree base (commit `9519478`) and unrelated to Phase 17.

## Self-Check

Verified after writing this SUMMARY.md:

```
File: src/lib/design-tokens/trust-tier.ts → FOUND
File: tests/a11y/trust-tier-tokens.test.ts → FOUND
File: .planning/phases/17-design-contract/deferred-items.md → FOUND
Commit 069dd81 (Task 1 feat) → FOUND in git log
Commit 096372b (Task 2 test) → FOUND in git log
```

## Self-Check: PASSED

---
*Phase: 17-design-contract*
*Plan: 01*
*Completed: 2026-05-01*
