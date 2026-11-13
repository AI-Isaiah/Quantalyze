---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 06
subsystem: routing
tags: [routing, role-home, redirect, proxy, route-contract, discovery]
requires: ["199-01"]
provides:
  - "src/app/home/page.tsx: the one server role-home redirect (/home)"
  - "ROLE_HOME_ROUTE = /home and DISCOVERY_LANDING_ROUTE = /discovery/crypto-sma in src/lib/routing/default-route.ts"
  - "/home public in PUBLIC_ROUTES, bounce-exempt in the proxy, public manifest row"
affects: [199-08 (other home sites, admin guards), ship CHANGELOG]
status: complete
commits: 4
plan_head_before: 1060e1f20c106eefa3babaa2d288c19ee1a12a49
plan_head_after: 457b52c867dc382d224fee622954bb2dc535847d
actuals:
  tokens: 12000
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: ["one data-only constant split in two by what each label means", "literal pins beside constant-comparing tests"]
key-files:
  created:
    - src/app/home/page.tsx
    - src/app/home/page.test.tsx
    - src/app/(marketing)/page.signed-in.test.tsx
  modified:
    - src/proxy.ts
    - src/proxy.test.ts
    - src/lib/routing/route-contract-manifest.ts
    - src/lib/routing/default-route.ts
    - src/app/(marketing)/page.tsx
    - src/components/marketing/MarketingHeaderActions.tsx
    - src/components/marketing/MarketingHeaderActions.test.tsx
    - src/components/auth/LoginForm.tsx
    - src/components/auth/LoginForm.test.tsx
    - src/components/factsheet/BackLink.tsx
    - src/components/factsheet/BackLink.test.tsx
    - src/app/browse/BrowseDiscoveryLink.tsx
    - src/app/browse/layout.session.test.tsx
    - src/lib/factsheet/origin.ts
    - src/lib/factsheet/origin.test.ts
key-decisions:
  - "R-01 split: ROLE_HOME_ROUTE (/home) for role-home sites, DISCOVERY_LANDING_ROUTE (/discovery/crypto-sma) for the three Discovery-labelled sites; Discovery sites change import, identifier and one docblock phrase only."
  - "/home decides admin as profiles.is_admin, else isAdminUser (the dashboard layout's computation), and throws on a failed profile read."
requirements-completed: [ROUTE-01]
---

# Phase 199 Plan 06: One role-home route and the constant split Summary

A signed-in user now reaches their own page through one server route, /home (allocator to /allocations, manager to /strategies, admin to /admin, unapproved to /pending-approval), and the old role-blind constant is split so "Go to Discovery" and "Back to Discovery" still reach Discovery.

## Tasks

| # | Task | Commits |
|---|------|---------|
| 1 (tracer) | `/home` page, proxy `PUBLIC_ROUTES` + `isHomeRoute` bounce exemption, public manifest row, two proxy cases | RED 601d51607, GREEN 01faf15a5 |
| 2 | `default-route.ts` split into `ROLE_HOME_ROUTE` / `DISCOVERY_LANDING_ROUTE`; every importer moved by label; BackLink literal pin; marketing page signed-in test | RED e3bd81f4a, GREEN 457b52c86 |

Tracer gate: the Task 1 `<verify>` is automated-only; it was re-run green (`⚡ Tracer verified end-to-end - expanding`) before Task 2.

## TDD record

**RED 1 (601d51607).** `src/app/home/page.test.tsx`, ten cases, against a stub page returning `null`. All 10 failed on their own assertions ("RoleHomePage returned without redirecting", "promise resolved null instead of rejecting"), so the target tests executed and failed on the planned behavior (semantic assessment: valid RED, not an import or fixture failure; the stub exists so the module loads). `gsd_run check tdd-red-evidence` was not run; the evidence is the vitest report quoted here.

**RED 2 (e3bd81f4a).** 23 tests failed across 6 files with the constants not yet defined. The role-home failures are assertion failures on the literal `/home` (proxy `/login` and `/forgot-password` bounce, three LoginForm cases, the MarketingHeaderActions `ROLE_HOME_ROUTE` value pin, the BackLink literal pin). The Discovery-site failures (layout.session, origin.test, BackLink render) fail because the not-yet-exported `DISCOVERY_LANDING_ROUTE` reads as `undefined`, which is a weaker RED than the literal ones: they prove the tests read the new name, not that the target is wrong. The literal pin is what makes the Discovery value testable.

**GREEN.** Both greens pass. No REFACTOR commit.

## Neuter evidence (data-integrity and user-facing gates shown able to fail)

Byte backups under the scratchpad (outside the worktree), `cmp` after each restore, backups deleted at the end.

- `gc-199-06-neuter: isHomeRoute removed from the exempt set` -> `src/proxy.test.ts` "/home with session does NOT redirect to dashboard" RED (1 failed, 112 passed); restored, cmp equal.
- `gc-199-06-neuter: isAdminUser fallback dropped in /home` -> `page.test.tsx` "an admin known only through the isAdminUser claim fallback lands on /admin" RED (`expected '/allocations' to be '/admin'`); restored, cmp equal.
- `gc-199-06-neuter: role home set back to Discovery` (ROLE_HOME_ROUTE = "/discovery/crypto-sma") -> 9 failed across 3 files: proxy `/login` and `/forgot-password` bounce, 6 LoginForm cases, the MarketingHeaderActions Go to app case; restored, cmp equal.
- `gc-199-06-neuter: Discovery retargeted to the role home` (DISCOVERY_LANDING_ROUTE = "/home") -> 1 failed: BackLink "the Discovery landing constant > is the Discovery path"; restored, cmp equal. The other Discovery assertions all stayed green under this retarget, which is exactly the hole the literal pin closes.
- Extra (marketing page, added test): `redirect("/discovery/crypto-sma")` in `(marketing)/page.tsx` -> "sends a signed-in visitor to /home" RED; restored, cmp equal.

`gc-199-06-gates: vitest=green tsc=clean lint=clean`

## Verification

| Command | Result |
|---------|--------|
| `node scripts/verify-plan-anchors.mjs <plan>` | OK, 12 claims, no stale |
| `npx vitest run` over the plan's Task 1 and Task 2 verify files plus `(marketing)/page.signed-in.test.tsx` and `page.stat-errors.test.tsx` | 11 files, 234 tests, all passed |
| `npm run check:route-contract` | OK, 49 page routes, all declared |
| `npx tsc --noEmit` | clean (no output) |
| `npm run lint` | 0 errors; 4 pre-existing unused-var warnings in `MetricsColumn.tsx`, `composite-read-path.ts`, `queries.stale-analytics-detail.test.ts` (files this plan did not touch); the admin-route manifest, route contract, planning hygiene and canonical-domain checks all OK |

Not run (disk rules): `scripts/local-stack/run.sh up` and the SQL gates. This plan touches no SQL, migration or supabase/tests file, so nothing is left to the sql-tests lane; CI runs the full vitest shards and `frontend` aggregator.

## Census (re-measured at the rebased tree, REVIEWS R-01)

- Pre-task 2 (HEAD 01faf15a5): `grep -a -rl "DEFAULT_AUTHENTICATED_ROUTE" src e2e` -> **14 files**: default-route.ts plus 13 importers (0 in e2e). The plan expected 11 + LoginForm.tsx + its test = 13; the extra file is `src/proxy.test.ts`, which 199-01's proxy cases import. It is in files_modified and moved to `ROLE_HOME_ROUTE` (role-home set).
- Post-task 2: `grep -a -rl "DEFAULT_AUTHENTICATED_ROUTE" src e2e | wc -l` -> **0**.
- Role-home production importers (import-line gate) -> exactly: `src/app/(marketing)/page.tsx`, `src/components/auth/LoginForm.tsx`, `src/components/marketing/MarketingHeaderActions.tsx`, `src/proxy.ts`.
- Discovery production importers (import-line gate) -> exactly: `src/app/browse/BrowseDiscoveryLink.tsx`, `src/components/factsheet/BackLink.tsx`, `src/lib/factsheet/origin.ts`. No file is in both sets.
- `export const DISCOVERY_LANDING_ROUTE = "/discovery/crypto-sma"` count 1; `export const ROLE_HOME_ROUTE = "/home"` count 1; BackLink literal pin count 1.
- Task 1 acceptance: `grep -a -c '"/home"' src/proxy.ts` -> 2; `grep -a -c 'route: "/home"' route-contract-manifest.ts` -> 1.

## Discovery sites diff (`git diff -U0 01faf15a5..HEAD -- BackLink.tsx BrowseDiscoveryLink.tsx origin.ts`; import, identifier and docblock phrase only)

```
src/app/browse/BrowseDiscoveryLink.tsx
-import { DEFAULT_AUTHENTICATED_ROUTE } from "@/lib/routing/default-route";
+import { DISCOVERY_LANDING_ROUTE } from "@/lib/routing/default-route";
- * the default authenticated route. A client component only because the layout
+ * the Discovery landing. A client component only because the layout
-  const href = known ? `/discovery/${slug}` : DEFAULT_AUTHENTICATED_ROUTE;
+  const href = known ? `/discovery/${slug}` : DISCOVERY_LANDING_ROUTE;
src/components/factsheet/BackLink.tsx
-import { DEFAULT_AUTHENTICATED_ROUTE } from "@/lib/routing/default-route";
+import { DISCOVERY_LANDING_ROUTE } from "@/lib/routing/default-route";
-      href={DEFAULT_AUTHENTICATED_ROUTE}
+      href={DISCOVERY_LANDING_ROUTE}
src/lib/factsheet/origin.ts
-import { DEFAULT_AUTHENTICATED_ROUTE } from "@/lib/routing/default-route";
+import { DISCOVERY_LANDING_ROUTE } from "@/lib/routing/default-route";
-    href: origin.key === "discovery" ? DEFAULT_AUTHENTICATED_ROUTE : "/browse",
+    href: origin.key === "discovery" ? DISCOVERY_LANDING_ROUTE : "/browse",
```

(`BASE` = 01faf15a5, the Task 1 GREEN commit Task 2 started from; the Task 2 RED commit e3bd81f4a touched only tests.)

## For the ship CHANGELOG

Admins, the founder included, now land on /admin after sign-in (and from "Go to app" and the signed-in bounce) instead of Discovery; allocators land on /allocations, managers on /strategies, role both on /allocations.

## Deviations from Plan

**1. [Rule 2 - Missing critical test] Added `src/app/(marketing)/page.signed-in.test.tsx`**
- **Found during:** Task 2 (the behavior list says "the marketing page redirects a signed-in user to /home", but no existing test covers that redirect; `page.stat-errors.test.tsx` only mocks a signed-out user).
- **Fix:** a two-case test (signed-in goes to /home, signed-out does not redirect) with its own neuter evidence. The file is outside the plan's files_modified.
- **Commit:** 457b52c86

**2. [Rule 1 - Test hardening] LoginForm.test.tsx pins the literal `/home` instead of importing `ROLE_HOME_ROUTE`**
- **Found during:** Task 2 neuter (a). The plan expects the LoginForm cases RED when ROLE_HOME_ROUTE is set back to the Discovery path; cases that compare against the constant cannot go RED. The file therefore no longer imports the constant (the plan's "maybe" import). Same reason the proxy `/login` and `/forgot-password` cases assert the literal `/home` (the hostile-redirect proxy cases still compare against `ROLE_HOME_ROUTE`, and stayed green under neuter (a), as expected).
- **Commit:** e3bd81f4a

**3. [Census] 14 files, not 13** (see Census). `src/proxy.test.ts` is inside files_modified, so no scope change.

**4. [Docblock] `route-contract-manifest.ts` `/` row notes** rewritten to name `redirect(ROLE_HOME_ROUTE)` as the plan asked; the new `/home` public row was placed after `/for-quants` (the public group is grouped, not strictly alphabetical; `check:route-contract` accepts it).

**Total deviations:** 2 auto-added or hardened tests, 2 notes. **Impact:** none on scope; test-only additions.

## Known Stubs

None. (The RED stub `page.tsx` from 601d51607 was replaced in 01faf15a5.)

## Threat Flags

None beyond the plan's register: T-199-08 (loop) mitigated by the bounce exemption, the shared admin predicate and the two neuters; T-199-09 mitigated by the throw on a failed read and its test; T-199-32 mitigated by the split, the named-set import gates and the literal pin. `/home` is a new public-listed route but serves no content: signed-out visits redirect to `/`.

## Auth Gates

None.

## Self-Check: PASSED

- Created files exist: `src/app/home/page.tsx`, `src/app/home/page.test.tsx`, `src/app/(marketing)/page.signed-in.test.tsx`.
- Commits reachable from HEAD: 601d51607, 01faf15a5, e3bd81f4a, 457b52c86.
- All `<acceptance_criteria>` of both tasks re-run and pass (see Census); plan-level verification re-run green.
