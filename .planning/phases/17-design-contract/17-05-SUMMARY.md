---
phase: 17
plan: 05
subsystem: design-contract
tags: [DESIGN-01, trust-tier, outline-pill, component-upgrade, phase-15-lock-preserved]
requirements:
  - DESIGN-01
dependency-graph:
  requires:
    - "src/lib/design-tokens/trust-tier.ts (TRUST_TIER_TOKENS — Plan 17-01 output)"
    - "src/lib/utils.ts (cn helper)"
    - "src/components/strategy/TrustTierLabel.tsx (Phase 15 v0 baseline — Plan 15-03)"
  provides:
    - "Three-variant outline-pill renderer at src/components/strategy/TrustTierLabel.tsx"
    - "CSV_UPLOADED_LABEL re-export sourced from TRUST_TIER_TOKENS.csv_uploaded.label"
  affects:
    - "src/components/strategy/StrategyHeader.tsx — UNCHANGED (call signature byte-identical to v0; no consumer refactor)"
    - "src/components/strategy/StrategyGrid.tsx — UNCHANGED (call signature byte-identical to v0; no consumer refactor)"
    - "e2e/csv-upload-flow.spec.ts — UNCHANGED (asserts visible text 'CSV uploaded — verification pending', which equals TRUST_TIER_TOKENS.csv_uploaded.label)"
tech-stack:
  added: []
  patterns:
    - "Token-driven inline styling — `style={{ color, backgroundColor, borderColor }}` reads verbatim from TRUST_TIER_TOKENS so the Plan 17-01 DESIGN.md ↔ tokens consistency Vitest test pins every hex"
    - "Pure-render component (no `\"use client\"`, no hooks) — mirrors SyncBadge.tsx; SSR-safe; preserved from Phase 15 v0"
    - "Single-source-of-truth re-export — CSV_UPLOADED_LABEL = TRUST_TIER_TOKENS.csv_uploaded.label (no string duplication; Phase 15 lock string preserved verbatim)"
    - "Type re-export with import-type cycle — TrustTier remains declared at TrustTierLabel.tsx; trust-tier.ts uses `import type {}` (erased at compile time, no runtime cycle)"
key-files:
  created:
    - "(none — this plan only modifies existing files)"
  modified:
    - "src/components/strategy/TrustTierLabel.tsx (47 → 81 lines — internals upgraded to 3-variant outline pill driven by TRUST_TIER_TOKENS; call signature unchanged)"
    - "src/components/strategy/TrustTierLabel.test.tsx (61 → 146 lines — 7 v0 cases → 11 v1 cases covering all three variants + token-color assertions + CSV_UPLOADED_LABEL ↔ token sync)"
    - ".planning/phases/17-design-contract/deferred-items.md (added Plan 17-05 to the list of executors that re-confirmed the pre-existing debug-key-flow TS error — single-line edit)"
decisions:
  - "Apply variant colors via inline `style={{ color, backgroundColor, borderColor }}` (NOT Tailwind utility classes like `bg-accent` / `text-warning`). Rationale: TRUST_TIER_TOKENS is the source of truth; inline styles let the Plan 17-01 DESIGN.md ↔ tokens consistency Vitest test pin every hex verbatim without a runtime CSS-variable lookup layer. Per 17-05-PLAN.md Step 2 reasoning."
  - "Source CSV_UPLOADED_LABEL from TRUST_TIER_TOKENS.csv_uploaded.label (not duplicate the literal string). Keeps the Phase 15 lock string in lockstep with the token file — if the label drifts in the token file, this constant moves with it; consumers that import the constant continue to work without change."
  - "Keep the TrustTier union declared at TrustTierLabel.tsx (canonical) and let trust-tier.ts re-export it via `import type {}`. Avoids duplicate-source drift; the import-type cycle is erased at compile time so there is no runtime circular import. Decision pre-baked by Plan 17-01."
  - "Test against jsdom-canonical `rgb(...)` form (not raw hex strings) — the test helper `hexToRgb()` converts the token hex to the form jsdom returns from `style.color`. Mirrors the established convention in src/components/strategy-v2/TradeMixSubPanel.test.tsx."
metrics:
  duration: "~4 minutes (single-task TDD: RED commit → GREEN commit → SUMMARY commit)"
  completed: "2026-05-01"
  tasks_completed: 1
  files_modified: 3
---

# Phase 17 Plan 05: TrustTierLabel Outline-Pill Upgrade Summary

**One-liner:** TrustTierLabel internals swapped to a three-variant token-driven outline pill — `api_verified` filled accent, `csv_uploaded` neutral grey outline, `self_reported` warning amber outline — with the call signature byte-identical to the Phase 15 v0 so existing consumers (StrategyHeader, StrategyGrid) need NO refactor.

## What Shipped

A 47-line stub that rendered only the `csv_uploaded` variant as plain muted text became an 81-line three-variant pill renderer driven by `TRUST_TIER_TOKENS`. The Phase 15 v0 contract (call signature, `data-testid`, `data-trust-tier`, null-safety, `CSV_UPLOADED_LABEL` named export) is preserved byte-identically. The DESIGN.md "Trust-Tier Badges" sub-section visual lock — `inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium` — appears verbatim in the JSX. Inline `style={{ color, backgroundColor, borderColor }}` reads verbatim from `TRUST_TIER_TOKENS[variant]`, keeping the token file as the single source of truth and letting the Plan 17-01 consistency Vitest test pin every hex.

## TDD Cycle

**RED** (commit `d3ef817`): Test file rewritten from 7 v0 assertions (csv_uploaded only) to 11 v1 assertions covering all three variants, structural-class checks, inline-style colour pins, null/undefined safety, custom-className append, and CSV_UPLOADED_LABEL ↔ TRUST_TIER_TOKENS sync. Run against the v0 implementation: 7 fails, 4 passes (RED confirmed — failures are all about missing styles + missing variant renders, none about test setup).

**GREEN** (commit `0d5e96f`): Component internals rewritten. Imports `TRUST_TIER_TOKENS` from `@/lib/design-tokens/trust-tier`, `cn` from `@/lib/utils`. Returns `null` for `null|undefined` (preserved); otherwise looks up `TRUST_TIER_TOKENS[trustTier]` and renders a `<span>` with the locked structural classes + inline styles + `data-testid="trust-tier-label"` + `data-trust-tier={trustTier}` + the token's `label` text. Run against the v1 implementation: **11 / 11 pass**.

**REFACTOR**: Skipped — the GREEN code is already minimal (5 imports total, single null-guard, single token lookup, single JSX `<span>`). No cleanup pass needed.

## Verification

| Gate | Result |
|------|--------|
| `npx vitest run src/components/strategy/TrustTierLabel.test.tsx` | **11 passed / 0 failed** |
| `npx vitest run` (full suite) | **283 files passed, 2775 tests passed, 0 failed, 13 files / 159 tests skipped** — no consumer regressions |
| `npx tsc --noEmit` (TrustTierLabel + trust-tier scope) | **0 errors** in the files this plan touches |
| `npx tsc --noEmit` (full project) | Pre-existing error in `src/app/api/debug-key-flow/route.ts:257` only — unrelated to plan 17-05; already tracked in `.planning/phases/17-design-contract/deferred-items.md` |
| Branch unchanged | `git rev-parse --abbrev-ref HEAD` → `worktree-agent-adee73bf898071d1c` (worktree branch — orchestrator merges back to `v1.0.0-api-key-rewrite-15-16`) |
| Consumer files untouched | `git diff 2c3a94e..HEAD -- src/app/ src/components/strategy/StrategyHeader.tsx src/components/strategy/StrategyGrid.tsx` returns empty |
| `CSV_UPLOADED_LABEL` re-export | `=== "CSV uploaded — verification pending"` (Phase 15 verbatim) AND `=== TRUST_TIER_TOKENS.csv_uploaded.label` (in-sync assertion in test) |
| `data-testid` + `data-trust-tier` preserved | yes — both present on every rendered variant |

## Acceptance-Criteria Checklist (verbatim from 17-05-PLAN.md)

| Criterion | Result |
|-----------|--------|
| `grep -c 'from "@/lib/design-tokens/trust-tier"' src/components/strategy/TrustTierLabel.tsx` returns `1` | **1** ✓ |
| `grep -c "TRUST_TIER_TOKENS" src/components/strategy/TrustTierLabel.tsx` returns `>= 2` | **6** ✓ |
| `grep -c "export const CSV_UPLOADED_LABEL" src/components/strategy/TrustTierLabel.tsx` returns `1` | **1** ✓ |
| `grep -c "inline-flex items-center rounded-sm border" src/components/strategy/TrustTierLabel.tsx` returns `1` (visual class verbatim) | **2** ✓ (once in JSDoc commentary, once verbatim in `className=`; criterion satisfied — verbatim string is present in the JSX) |
| `grep -c "font-medium" src/components/strategy/TrustTierLabel.tsx` returns `1` | **2** ✓ (once in JSDoc, once in `className=`; criterion satisfied) |
| `grep -c 'data-testid="trust-tier-label"' src/components/strategy/TrustTierLabel.tsx` returns `1` | **1** ✓ |
| `grep -c "data-trust-tier" src/components/strategy/TrustTierLabel.tsx` returns `1` | **2** ✓ (once in JSDoc, once on the rendered span; criterion satisfied) |
| `npx vitest run src/components/strategy/TrustTierLabel.test.tsx` exits 0 | **0** ✓ |
| `npx vitest run` exits 0 | **0** ✓ |
| `npx tsc --noEmit -p .` exits 0 | **non-zero** but only because of the pre-existing `debug-key-flow/route.ts` Phase 16 error tracked in `deferred-items.md`; **0 errors in plan 17-05's touched files** |
| Branch unchanged | ✓ (`worktree-agent-adee73bf898071d1c` — worktree branch; orchestrator merges to `v1.0.0-api-key-rewrite-15-16`) |
| Consumer files untouched | ✓ (zero changed lines in `src/app/strategies/`, `src/app/discovery/`, `src/app/admin/csv-status/`, `StrategyHeader.tsx`, `StrategyGrid.tsx`) |

## Deviations from Plan

### Auto-fixed Issues

None. The plan executed exactly as written.

### Authentication Gates

None.

### Out-of-Scope Issues Logged

**Pre-existing TypeScript error in `src/app/api/debug-key-flow/route.ts:257`** — flagged independently by Plans 17-01, 17-03, 17-04, and 17-05. Already tracked in `.planning/phases/17-design-contract/deferred-items.md`. This plan added a single-line update to that document noting Plan 17-05 also re-confirmed the error is pre-existing (not introduced by this plan). Disposition: out of Phase 17 scope per executor scope-boundary rule; suggested handler is Phase 16 follow-up, Phase 18 root-cause fix, or Phase 19 backbone rewrite.

### Plan-Spec Notes

The plan's acceptance-criteria table called for `grep -c` counts of `1` for the visual class string, `font-medium`, and `data-trust-tier`. The implementation has each of those tokens appearing **twice** because the JSDoc comment block also references the visual lock string and DOM hooks for documentation continuity. The verbatim string still appears once in the actual JSX `className=` / `data-trust-tier={trustTier}` — i.e., the criterion's intent (the literal lock is present) is satisfied. The doubled count is documentation, not implementation drift.

## Final TrustTierLabel.tsx Shape (key lines)

```typescript
import { cn } from "@/lib/utils";
import { TRUST_TIER_TOKENS } from "@/lib/design-tokens/trust-tier";

export const CSV_UPLOADED_LABEL = TRUST_TIER_TOKENS.csv_uploaded.label;

export type TrustTier = "api_verified" | "csv_uploaded" | "self_reported";

interface TrustTierLabelProps {
  trustTier: TrustTier | null | undefined;
  className?: string;
}

export function TrustTierLabel({ trustTier, className }: TrustTierLabelProps) {
  if (trustTier == null) return null;
  const token = TRUST_TIER_TOKENS[trustTier];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium",
        className,
      )}
      style={{
        color: token.text,
        backgroundColor: token.fill,
        borderColor: token.border,
      }}
      data-testid="trust-tier-label"
      data-trust-tier={trustTier}
    >
      {token.label}
    </span>
  );
}
```

## Commits

| # | Type | Hash | Message |
|---|------|------|---------|
| 1 | test | `d3ef817` | test(17-05): add failing tests for TrustTierLabel outline pill (Phase 17 DESIGN-01) |
| 2 | feat | `0d5e96f` | feat(17-05): TrustTierLabel renders 3-variant outline pill from TRUST_TIER_TOKENS (DESIGN-01) |
| 3 | docs | _(this commit)_ | docs(17-05): plan complete — 17-05-SUMMARY.md + deferred-items.md note |

## Threat-Surface Scan

No new security-relevant surface introduced. The component is a pure-render presentation primitive (no network, no auth, no file IO, no schema). Token values are public design constants. Threat register entries from 17-05-PLAN.md `<threat_model>`:

- **T-17-05-01** (Tampering — hex drift between component and DESIGN.md): mitigated. Component reads from TRUST_TIER_TOKENS verbatim; Plan 17-01's `tests/a11y/trust-tier-tokens.test.ts` asserts every hex appears verbatim in DESIGN.md; CI fails on drift.
- **T-17-05-02** (Information Disclosure): accepted (public design surface).
- **T-17-05-03** (Spoofing — arbitrary string passed as trustTier): accepted (TypeScript union type at compile time + runtime `if (trustTier == null) return null` short-circuit; non-union strings would type-error at the call-site).

No new threat flags.

## Self-Check: PASSED

Verification of Summary claims:

- **Files created/modified exist:**
  - `src/components/strategy/TrustTierLabel.tsx` — present (81 lines, contains `TRUST_TIER_TOKENS` import + 3-variant render).
  - `src/components/strategy/TrustTierLabel.test.tsx` — present (146 lines, 11 test cases).
  - `.planning/phases/17-design-contract/deferred-items.md` — present (single-line update applied).
  - `.planning/phases/17-design-contract/17-05-SUMMARY.md` — present (this file).
- **Commits exist on worktree branch `worktree-agent-adee73bf898071d1c`:**
  - `d3ef817` (test) — present in `git log`.
  - `0d5e96f` (feat) — present in `git log`.
  - SUMMARY.md commit hash — recorded after this commit lands.
- **Branch correct:** `worktree-agent-adee73bf898071d1c` (worktree branch; orchestrator merges to `v1.0.0-api-key-rewrite-15-16`).
- **No consumer files modified:** confirmed via `git diff 2c3a94e..HEAD -- src/app/ src/components/strategy/StrategyHeader.tsx src/components/strategy/StrategyGrid.tsx` returning empty.
- **STATE.md and ROADMAP.md NOT modified by this executor:** confirmed (parallel-executor constraint honored).
