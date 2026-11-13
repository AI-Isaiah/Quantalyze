---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 33
subsystem: copy-census
tags: [plainwords, glossary, copy-census, retired-word, f-04, f-08, u-30]
requires: ["201-28", "201-29", "201-30", "201-31"]
provides:
  - "registry term `scenario` (replaces `bridge`), `mandate` definition reads Scenario"
  - "census rule A retires the case-sensitive word Bridge with one count-pinned exception"
  - "rule B `scenario` pins in the plan-11, 14, 15 and 27 ledgers for plan 201-34"
affects: [201-34, 201-23]
key-files:
  modified:
    - src/lib/glossary.ts
    - src/lib/glossary.test.ts
    - scripts/copy-census/policy.ts
    - scripts/copy-census/scan.test.ts
    - src/__tests__/copy-census.test.ts
    - scripts/copy-census/ledgers/plan-11.ts
    - scripts/copy-census/ledgers/plan-14.ts
    - scripts/copy-census/ledgers/plan-15.ts
    - scripts/copy-census/ledgers/plan-27.ts
decisions:
  - "The former-name reason shape is `/^former name \\(F-04\\): \\S.*$/`, used by exactly one row (the glossary row); a test pins that across EXCEPTIONS and every ledger"
  - "Ledger pins for the new scenario form carry a short header comment naming plan 201-34 as the plan that lowers them to zero"
metrics:
  tasks: 2
  completed: 2026-11-11
status: complete
actuals:
  tokens: 4300
  tasks: 2
  commits: 2
plan_head_before: 0fd500cfb25d8f8b9a65b5ad7e2451c93fe78d25
plan_head_after: 89e876d342f18eaf7de959ccb67f85883b1a6417
---

# Phase 201 Plan 33: Scenario registered, Bridge retired in the census Summary

"Scenario" is now the registered term with the UI-SPEC definition (`It was formerly called Bridge.`), the `bridge` registry key is gone, and the copy census reads the retired word `Bridge` case-sensitively with exactly one count-pinned exception, that definition. The seven existing "Scenario" labels the new form makes rule B report are pinned at exact live counts for plan 201-34.

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | 37639fc73 | `scenario` replaces `bridge` in `GLOSSARY` (label `Scenario`, no alias, 159-character definition); `mandate` ends `Recommendations and Scenario read it.`; `INVENTORY_KEYS` swapped (count stays 46); four new registry arms (one Bridge across label, alias, definition and context; no `bridge` key; scenario exact definition and no alias; mandate exact definition); the two rule B fixtures moved from `Bridge` to `Scenario`; rule B `scenario` hits pinned in four ledgers |
| 2 | 89e876d34 | `{ id: "bridge", re: /\bBridge\b/ }` last in `RETIRED_WORDS`, header comment now says three case-sensitive phrases, former-name shape in `REASONS`, the glossary row in `EXCEPTIONS`; `TYPED_EXCEPTIONS` lists 4 rows; a one-row arm for the former-name shape; rule A and reason fixtures in `scan.test.ts` |

## premise:

- `grep -a -rn -E 'k="bridge"|termDefinition\("bridge"|term: "bridge"' src` printed nothing (exit 1). No wave-5 straggler Term.
- The UI-SPEC grep over `src` (test files and comment-marker lines dropped) printed three lines: `src/lib/glossary.ts:261` (the old `label: "Bridge"`), `:263` (the old definition) and `:269` (the old `mandate` tail), plus one non-glossary line, `src/app/(dashboard)/allocations/components/BridgeWidget.tsx:236`. That line is an unmarked comment continuation (`reload that wiped in-flight Bridge drawer state, scroll position, and any ScenarioComposer draft`), not user-visible. Task 2's census run reports zero rule A hits for it.
- `node scripts/verify-plan-anchors.mjs` on the canonical plan: `claims: 8 checked`, `OK: 1 plan file(s), no stale claims.` (run against the phase-worktree copy, since the plan worktree holds an older plan file).

## scenario-pins:

All seven hits carry id `scenario` and rule B (checked with `scanTree` ids, not only the `--ledger` text). Plan 201-34 clears them; no `Bridge` hit is pinned.

```
plan-11  files=1  live A=0 B=3 C=0  pinned A=0 B=3 C=0   ScenarioComposer.tsx: Scenario draft | Scenario blend | Scenario max-DD at
plan-14  files=2  live A=0 B=2 C=0  pinned A=0 B=2 C=0   EquityChart.tsx: Scenario | Sidebar.tsx: Scenario
plan-15  files=1  live A=0 B=1 C=0  pinned A=0 B=1 C=0   ScenarioStub.tsx: Scenario builder coming soon
plan-27  files=1  live A=0 B=1 C=0  pinned A=0 B=1 C=0   ScenarioCompareTable.tsx: Scenario comparison
total    live A=0 B=7 C=0   (`run.ts --summary | grep -a -c MISMATCH` prints 0)
```

## stragglers:

stragglers: none. After the matcher landed, the census reports zero rule A hits for `Bridge` anywhere in `src/` outside the one registered glossary row, so no wave-5 string was missed and no phase-200 file is affected.

## Neuter record (every gate seen RED, restored from a byte backup with `cp -p`, `cmp` exit 0, then GREEN)

- gc-201-33-neuter: gate=glossary.test.ts "Bridge appears exactly once" result=red restored=identical. Neuter: ` Bridge.` appended to the `omega` definition. RED named `omega (generic)` (the arm printed the extra hit under that key; the omega exact-definition and sentence-count arms went RED as well). Restored, `cmp` 0, 27 of 27 green.
- gc-201-33-neuter: gate=copy-census.test.ts "registers every live hit in the ledger that owns its file" result=red restored=identical. Neuter: `Bridge` planted as JSX text next to `{item.label}` in `src/components/layout/Sidebar.tsx`. RED line: `unregistered: src/components/layout/Sidebar.tsx rule A: 1 live hit(s), none pinned in any ledger`.
- gc-201-33-neuter: gate=copy-census.test.ts + scan.test.ts (exception row removed from EXCEPTIONS) result=red restored=identical. RED lines: `unregistered: src/lib/glossary.ts rule A: 1 live hit(s), none pinned in any ledger`, plus `pins the policy EXCEPTIONS list at its typed rows, in both directions` and `lets exactly one row use the former-name reason shape` both failing (3 failed).
- gc-201-33-neuter: gate=scan.test.ts "is case-sensitive for Bridge" result=red restored=identical. Neuter: `/i` added to the `bridge` matcher. See the deviation below: the first attempt did NOT go RED, the arm was strengthened, the neuter re-run went RED (1 failed), restored, `cmp` 0, 170 of 170 green.
- gc-201-33-gates: vitest=green (18 files, 341 tests: glossary, scan, copy-census, `src/components/ui/`) eslint=clean (9 touched files) tsc=clean

Plan-level premise run: `node scripts/verify-plan-anchors.mjs <plan>` OK; `npm run typecheck` exit 0. Acceptance greps: `formerly called Bridge` 1, `Recommendations and Scenario read it.` 1, `"scenario"` in glossary.test.ts 2, `id: "bridge"` 1, `former name` in policy.ts 2 lines (the shape and the exception row), `--summary | grep -a -c MISMATCH` 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The lowercase fixture arm could not fail on the case-insensitive neuter**
- **Found during:** Task 2, neuter 3
- **Issue:** The planned lowercase fixtures (`source: "bridge"`, `"[bridge] fetch"`, `BridgeDrawer`) are not read by the scanner whether the matcher is case-sensitive or not (single lowercase tokens in non-copy properties and non-prose strings are not scanned), so making the matcher case-insensitive left the arm green.
- **Fix:** Added two fixtures a case-insensitive matcher does read: the lowercase prose string `"the bridge between two accounts"` and `<input placeholder="bridge" />`. The neuter then went RED, restored, GREEN.
- **Files modified:** `scripts/copy-census/scan.test.ts`
- **Commit:** 89e876d34

**2. [Rule 3 - Blocking] Typecheck error in the new registry arm**
- **Found during:** Task 1 verify
- **Issue:** `GLOSSARY.scenario.aliases` does not exist on the literal type (`as const`), so the no-alias arm failed `tsc`.
- **Fix:** Read it through `GlossaryEntry`: `(GLOSSARY.scenario as GlossaryEntry).aliases`.
- **Files modified:** `src/lib/glossary.test.ts`
- **Commit:** 37639fc73

The plan's "rejects the bare prefix ... over 20 characters" reason arm was written as: the bare `former name (F-04): ` and the no-founder-id `former name: ...` are rejected. A "too short" arm was dropped because the prefix alone is 19 characters, so any non-empty text after it already clears the `> 20` rule and the arm would have been false.

## reported-not-edited

None. No phase-200 file (`ApiKeyManager.tsx`, `ConfirmKeyChangeDialog.tsx`, `e2e/api-key-flow.spec.ts`, `e2e/sync-analytics-flow.spec.ts`) was touched or needed a change.

## Known Stubs

None. The seven rule B pins are an intentional, exact hand-off to plan 201-34, not a stub; plan 201-23 asserts zero.

## Threat Flags

None. No new network, auth or schema surface. T-201-45 (the former-name shape as an escape hatch) is mitigated by the one-row arm and neuter 2; T-201-46 (pins hiding a Bridge straggler) by pinning only rule B `scenario` hits, verified by id, with `--summary` showing no MISMATCH.

## Self-Check: PASSED

- FOUND: all nine `files_modified` paths present in the plan worktree and committed
- FOUND: 37639fc73 and 89e876d34 are ancestors of HEAD (`git rev-list --count 0fd500cfb..HEAD` = 2 before this summary commit)
