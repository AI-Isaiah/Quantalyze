---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 13
subsystem: routing
tags: [next-config, redirect, route-contract, retired-route, vitest]
requires:
  - phase: 199-11
    provides: "every nav entry and production link already points at /strategies, so the no-link census starts green"
  - phase: 199-06
    provides: "route-contract manifest rows for /home; this plan edits the same file"
provides:
  - "/my-strategies permanently redirects (308) to /strategies from next.config.ts redirects(), unconditional, query string passed through by Next"
  - "Manifest /my-strategies row is class exception with redirectFrom in lockstep; /strategies notes say every strategy owner"
  - "my-strategies/page.tsx and page.test.tsx deleted; nothing renders at the old path"
  - "my-strategies-retired.test.ts: 308 rule, manifest lockstep, and no comment-stripped production file under src links /my-strategies"
affects: [199-17]
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
plan_head_before: d316728ae5374fcf624bc974f54422fd7feb9712
plan_head_after: a01c72157b73485785867064d17ab24096169fa8
status: complete
tech-stack:
  added: []
  patterns:
    - "Retired route = config 308 + manifest class exception with redirectFrom + a test that walks production sources for the old literal"
key-files:
  created:
    - src/__tests__/my-strategies-retired.test.ts
  modified:
    - next.config.ts
    - src/lib/routing/route-contract-manifest.ts
    - src/__tests__/phase-149-my-strategies-parity.test.ts
    - src/__tests__/page-titles.test.ts
    - "src/app/(dashboard)/requireRolePage-wiring.test.tsx"
  deleted:
    - "src/app/(dashboard)/my-strategies/page.tsx"
    - "src/app/(dashboard)/my-strategies/page.test.tsx"
decisions:
  - "The no-link arm matches any /my-strategies not followed by a word character or hyphen in comment-stripped code (broader than a quoted literal, so a ?redirect=/my-strategies value is caught too); the manifest is the only exemption, by name"
  - "Parity pin 12's stripper check moved to a synthetic comment because the live strategies page never names getPercentiles, so the old page-based proof no longer exists"
requirements-completed: [LEAN-01]
---

# Phase 199 Plan 13: Retire /my-strategies Summary

`/my-strategies` is a permanent, unconditional 308 to `/strategies` (query string passed through by Next), its page and page test are deleted, and a test fails on any new production link to the old path.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 (tracer) | 308 rule, manifest row to exception, page deleted, pins re-pointed, retired-route test | 365998ea9 |
| 2 | no production file links /my-strategies, with a vacuity floor | a01c72157 |

## What changed

- `next.config.ts`: a `/my-strategies` to `/strategies` rule with `permanent: true` and no `has`/`missing`, beside `/scenarios`, with a Phase 199 D-01 comment.
- Manifest: `/my-strategies` row is class `exception` with `redirectFrom: "/my-strategies"` (no backing page, so Rule 4's page-existence check skips it, same carve-out as `/scenarios`); the `/strategies` notes now read "the one strategies list every strategy owner reads".
- Deleted `src/app/(dashboard)/my-strategies/page.tsx` and `page.test.tsx` (the only files in that directory), in the same commit as the rule and manifest flip (Rules 3 and 4 lockstep).
- Parity test: pin 6 now asserts the `/strategies` page calls `getOwnRowPercentiles(` and has no `getPercentiles(`; the `MY_STRATEGIES_PAGE` constant is gone; pin 12's stripper proof uses a synthetic comment; header prose updated.
- `page-titles.test.ts` test 4: `/strategies` has a literal PageHeader title and `my-strategies/page.tsx` does not exist.
- `requireRolePage-wiring.test.tsx`: the my-strategies surface is removed.

## Verification

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 5 claims, no stale.
- `npx vitest run src/__tests__/my-strategies-retired.test.ts src/__tests__/phase-149-my-strategies-parity.test.ts src/__tests__/page-titles.test.ts "src/app/(dashboard)/requireRolePage-wiring.test.tsx" src/__tests__/check-route-contract.test.ts`: 5 files, 66 passed.
- `npx vitest run src/__tests__/my-strategies-retired.test.ts "src/app/(dashboard)/strategies" src/components/layout src/__tests__/phase-149-my-strategies-parity.test.ts src/__tests__/page-titles.test.ts "src/app/(dashboard)/requireRolePage-wiring.test.tsx" src/__tests__/check-route-contract.test.ts src/__tests__/trim-removed-surfaces.test.tsx src/__tests__/strategy-route-redirects.test.ts`: 63 files, 1247 passed, 0 failed, 0 skipped.
- `npm run check:route-contract`: OK, 48 page routes.
- `npx tsc --noEmit -p .`: clean (no output).
- ESLint scoped to the six touched files (`--no-cache`): clean. The other `npm run lint` steps run individually: `check-admin-route-manifest`, `check-route-contract`, `check-planning-hygiene`, `check-canonical-domain` all OK. The full-tree `eslint --cache` was deliberately not run (its cache writes into the shared node_modules symlink).

## Neuter evidence (tests shown able to fail; restored from byte backups, cmp clean, backups deleted)

gc-199-13-neuter: removed the `/my-strategies` rule from `next.config.ts` on a byte copy. `my-strategies-retired.test.ts` went RED (3 failed / 2 passed: rule present, redirects() returns it, manifest lockstep) and `npm run check:route-contract` went RED with `MISSING-REDIRECT: route /my-strategies declares redirectFrom /my-strategies but next.config.ts redirects() has no matching source`. Restored, `cmp` identical.

gc-199-13-neuter: appended a `{ href: "/my-strategies" }` export to `HoldingsTable.tsx` on a byte copy. The arm `no production file links /my-strategies` went RED naming `src/app/(dashboard)/allocations/components/HoldingsTable.tsx:1352` (1 failed / 7 passed). Restored, `cmp` identical, and `git status` showed only the intended test file modified afterwards.

gc-199-13-gates: vitest=green tsc=clean lint=clean

## CHANGELOG note for the ship

`/my-strategies` now answers a 308 (permanent) to `/strategies`, query string kept. Browsers cache a 308, so reverting the rule does not reach a visitor who already followed it; the founder accepted that one-way door in D-01. Allocators lose the separate "My Strategies" page: every strategy owner reads the one `/strategies` list.

## Deviations from Plan

None to the code. Two judgement calls inside the plan's remit:
- The link arm's regex is broader than the plan's "quoted literal starting /my-strategies" (any `/my-strategies` not followed by `[\w-]` in stripped code), a strict superset.
- Parity pin 12 item 2 could not keep its original proof (the live strategies page never names `getPercentiles`), so it asserts the stripper on a synthetic comment.

## Left to CI / later plans

- The live 308 status and query carry-over are the e2e first-hop canary in plan 199-17 (this plan proves the config shape only). `e2e/my-strategies.spec.ts` and `e2e/layout-narrow.spec.ts` still `goto("/my-strategies")`; they are 199-17's to rewrite.
- No SQL, no local stack, no Docker; no SQL checks were in scope.
- Stale comments naming the retired page remain in `strategies/StrategiesSection.tsx` ("until plan 199-13 retires that page"), `strategies/comparison-note.ts` and a few production files. They are comment-only (the no-link test strips comments) and those files are outside this plan's `files_modified`; a later cleanup can reword them.
- `src/lib/factsheet/compute.conventions.test.ts` has 2 frozen-snapshot failures on main already; not touched or run here.

## Known Stubs

None.

## Threat Flags

None. T-199-17 mitigated by `check:route-contract` Rule 3 and the retired test, both with neuter evidence above.

## Self-Check: PASSED

- FOUND: src/__tests__/my-strategies-retired.test.ts
- MISSING (as intended): src/app/(dashboard)/my-strategies/page.tsx
- FOUND commits 365998ea9 and a01c72157 in HEAD history
