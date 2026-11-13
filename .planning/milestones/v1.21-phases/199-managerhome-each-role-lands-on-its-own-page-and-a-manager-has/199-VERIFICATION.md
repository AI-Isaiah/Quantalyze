---
phase: 199-managerhome
verified: 2026-11-10T20:50:00Z
status: passed
score: 4/4 success criteria verified (SC-1 with one recorded deviation, see Warnings)
verified_at_sha: 4e24cfa90e4f6e7d66ed1c54d7a00edb3691f40d
drift_subjects:
  - src/lib/routing/role-home.ts
  - src/lib/routing/default-route.ts
  - src/app/home/page.tsx
  - src/proxy.ts
  - src/components/auth/LoginForm.tsx
  - src/lib/auth/requireRolePage.ts
  - src/lib/admin.ts
  - src/lib/strategy-health.ts
  - src/lib/degrade-warnings.ts
  - src/app/(dashboard)/strategies/page.tsx
  - src/app/(dashboard)/strategies/layout.tsx
  - src/app/(dashboard)/strategies/StrategiesLegend.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/layout/Sidebar.tsx
  - next.config.ts
  - e2e/role-home.spec.ts
behavior_unverified: 0
overrides_applied: 0
routed:
  - id: SFH-R2-02
    severity: LOW
    what: "stale-no-data wording says 'no computation is running' for a queued, retrying or running job"
    note: "Routed by the orchestrator. Not booked in TODOS.md at HEAD."
  - id: WR-01-R3
    severity: MEDIUM (pre-existing class)
    what: "proxy decides signed-in from getSession (cookie only) while /home and the page guards use getUser: a revoked-but-unexpired cookie loops / <-> /home and /login?redirect= <-> /discovery"
    note: "Existed at base 9bc83f894 (discovery/layout.tsx shape); phase 199 added a second shape through /home. Routed to a follow-up phase. Not booked in TODOS.md at HEAD."
  - id: R-05
    severity: residual
    what: "a non-crypto row 8 to 10 days old reads Healthy on the list and stale on its factsheet chip (3d/7d ladder)"
    note: "Founder D-06 (keep 197's ladder). Routed to Phase 201."
human_verification:
  - test: "e2e/role-home.spec.ts against a live stack (CI-side)"
    expected: "allocator lands on /allocations, manager on /strategies, admin on /admin after sign-in; a safe ?redirect= wins; an off-origin ?redirect= is ignored; /my-strategies 308s to /strategies with the query preserved"
    why_human: "needs a seeded local stack; none allowed locally. Runs in the CI e2e lanes."
  - test: "axe-app-wide, layout-narrow and reflow-sweep-authed specs on the merged /strategies page (CI-side)"
    expected: "no new axe violations; no horizontal overflow at narrow widths with the Health column and legend"
    why_human: "browser rendering; CI only"
  - test: "Visual read of the Health column, the legend and the row notes on /strategies (founder, DESIGN.md)"
    expected: "one Health word per row, legend explains Health words and every status chip, notes read as registered copy"
    why_human: "visual and copy judgement"
---

# Phase 199: MANAGERHOME Verification Report

**Phase Goal:** After sign-in, an allocator, a manager and an admin each land on a page made for their role. A manager has one strategies list (`/strategies` and `/my-strategies` merged) that shows each strategy's health, explains its status chips, and whose degrade warnings name the affected days or key and say what to do.
**Verified:** 2026-11-10 at `4e24cfa90` (worktree `quantalyze-199`, branch `feat/199-managerhome`, phase base `9bc83f894`)
**Status:** passed
**Re-verification:** No, initial verification

Per the repo convention (Phase 197), items provable only in CI are listed under `human_verification` and do not by themselves move the verdict off `passed`.

## Evidence run (this verification, not taken from SUMMARY)

| Check | Result |
|---|---|
| `npx vitest run` on all 65 test files changed in the phase, plus `src/app/(dashboard)/strategies` and all of `src/__tests__` | 231 files passed, 18 skipped (DB or env gated), 5901 tests passed, 0 failed |
| `npx tsc --noEmit -p .` | exit 0, no output |
| `npm run lint` (eslint, admin-route-manifest, route-contract, planning-hygiene, canonical-domain) | 0 errors; 4 warnings, all unused-variable in files outside this phase's diff; every check script OK |
| Neuter probe on the SC-4 test: replaced the day in the `allocation.staleness` text with "recently" in `src/lib/degrade-warnings.ts` | `degrade-warnings.test.tsx` went RED (2 failed: the registry contract and the staleness sample), file restored from a byte backup, `git status` clean |
| `e2e/role-home.spec.ts` | not run (no local stack); listed under `human_verification` |

## Goal Achievement: success criteria

| # | Success criterion | Status | Evidence |
|---|---|---|---|
| 1 | After sign-in an allocator lands on My allocation, a manager on their strategies list, an admin on `/admin`; every post-sign-in and "go home" site reads one role-aware choice | VERIFIED (one recorded deviation) | `src/lib/routing/role-home.ts`: `roleHomeFor` (not approved -> `/pending-approval`, admin -> `/admin`, else `roleSurfaceHome`: manager `/strategies`, allocator and both `/allocations`). `/home` (`src/app/home/page.tsx`) reads the profile and `isAdminUser(..., {strict:true})`, redirects via `roleHomeFor`, throws (never guesses) on a read error or a missing row. `ROLE_HOME_ROUTE = "/home"` is consumed by `LoginForm` (with `safeRedirectPath` first, CD-02/CD-13), `OnboardingWizard`, `not-found.tsx`, `MarketingHeaderActions`, marketing page, proxy bounce, `(dashboard)/error.tsx`, `compare/error.tsx`; `pending-approval` uses `roleHomeFor` directly; `requireRolePage` and the 13 admin guards bounce to the role home. `src/__tests__/role-home-call-sites.test.ts` enumerates the sites and passed. |
| 2 | One strategies list: `/strategies` and `/my-strategies` are one page, the other route leads to it, one sidebar entry | VERIFIED | `src/app/(dashboard)/my-strategies/` no longer exists; `next.config.ts` carries `{ source: "/my-strategies", destination: "/strategies", permanent: true }` (308, lockstep with the route manifest). `strategies/layout.tsx` guards sign-in only, the index admits every owner role, sell-side sub-routes keep manager guards in `strategies/new/layout.tsx` and `strategies/[id]/layout.tsx`. `Sidebar.tsx` pushes "Strategies" once for the allocator workspace and skips the manager push when that workspace shows (role `both` gets one); `Sidebar.test.tsx` "role='both' lists the allocator set with a single Strategies" passed. Mobile nav line 319 is the single entry. |
| 3 | The list shows each strategy's health, and its status chips have a legend | VERIFIED | `strategy-health.ts` `strategyHealthOf` composes key sync status, analytics state and `listSeriesVerdict` (no new threshold, D-06). `strategies/page.tsx` computes `healthOfRow` on the server; `StrategyTable.tsx` renders a "Health" column header and cell (and a cell on the no-strategy placeholder row); `StrategiesLegend` is mounted at `page.tsx:1535` when rows exist; `StrategiesLegend.test.tsx` and `page.table.test.tsx` passed. |
| 4 | Every degrade warning names the days or key and says what to do; a test goes RED on one that names neither (narrowed 2026-11-09, D-05) | VERIFIED | `src/lib/degrade-warnings.ts` is the one registry (66 entries); `degrade-warnings.test.tsx` judges each entry's rendered text for its day or key slot and its action sentence verbatim; `degrade-warning-scan.test.ts` fails on an unregistered warning in a scanned surface. I mutated a registered text (dropped the day) and the test went RED. The D-05 exempt entries use the count-pinned `whole_history` scope plus an action. TODOS.md carries `[199-DEPARTED-HISTORY-NAME-THE-KEY]`, as D-05 requires. |

**Score:** 4/4

## Requirements coverage

| Requirement | Status | Evidence |
|---|---|---|
| ROUTE-01 | SATISFIED | SC-1 above |
| LEAN-01 | SATISFIED | SC-2 above; D-02 "everything from both" is carried by the `phase-149-my-strategies-parity` and `page.merged` tests, which passed |
| ROUTE-11 | SATISFIED | SC-3 and SC-4 above |

## Warnings (not blockers)

1. **SC-1 literal deviation, recorded here and not in CONTEXT/ROADMAP.** The ROADMAP evidence lists `src/app/error.tsx` and `admin/error.tsx` as "go home" sites that must read the one role-aware choice. After review round 1 (WR-01, `431c0018a`) the root, `admin`, `allocations` and `strategies` error boundaries no longer link to the role home: root, admin and allocations link "Go to Discovery" (`DISCOVERY_LANDING_ROUTE`), and the strategies boundary links "Go to your profile" (`/profile`, WR-01-R2). Reason: the role home redirects straight back into the surface that just crashed. The census (`ESCAPE_BOUNDARIES`, `ROLE_FREE_ESCAPE_BOUNDARIES`) pins each choice, the boundaries are not dead ends (a manager or admin sent to Discovery is bounced to their own surface), and three review rounds accepted it. The repo's deviation policy says a deviation is recorded in CONTEXT.md and the ROADMAP; `199-REVIEW-FIX.md` records it but those two files do not. Recommended action for the founder: add one line to `199-CONTEXT.md` and ROADMAP SC-1 naming the four escape boundaries. This does not block the phase: the sign-in and role-home behaviour that SC-1 is about is intact.
2. **Routed items are not yet in `TODOS.md`.** SFH-R2-02 and WR-01-R3 are recorded only in the review files and this report. WR-01-R3 is a user-facing MEDIUM (pre-existing class), so it should get a TODOS entry or phase booking.
3. **Review-fix commits are logic changes in routing** (`/home` strict admin read, strategies Health remedies). Tests cover them with neuter-and-RED evidence in `199-REVIEW-FIX.md`; the e2e spec is the end-to-end proof and is CI-side.

## Anti-patterns

A grep for TBD, FIXME and XXX across every changed non-JSON file under src, e2e, scripts and next.config.ts returned no unreferenced marker. Lint and planning-hygiene are green. No stub or hollow wiring was found in the files above: `/home`, the registry, the Health column and the legend are all consumed and tested.

## Gaps Summary

None. All four success criteria hold at `4e24cfa90` on the evidence above. CI-side e2e, axe and reflow runs and a founder visual read remain as `human_verification`.

## Post-verification commits (note added 2026-11-10, records PR)

The verdict above was issued at `4e24cfa90` and written in `95b18746e`. It stays `passed`. Six non-planning commits landed on `feat/199-managerhome` after `95b18746e` and before the squash merge (PR #1243, `25d31622b`, v0.133.33.0). All are CI-driven test, contrast or e2e-spec fixes; none changes a success criterion's routing or Health logic:

- `d4a33e44f` test(199): point the chip-contrast pin at PIPELINE_CHIPS
- `4ccc45c4e` fix(199): e2e specs seed rows a role-both owner sees (wizard drafts are hidden from managers, CD-10)
- `de9343a0b` fix(199): Badge and OwnershipTag tones reach AA contrast on their own tint; gate pins every pair
- `9bd09b080` fix(199): sync-pill warning and negative tints reach AA; contrast gate reads the pill map
- `b20dd53a1` fix(199): N-TABLE probes the search box (no Sort selects on /strategies); owner-list link matched exactly
- `1c5ee2f66` test(199): manager key-card pill pin follows the AA revoked tint (bg-negative/4)

Command: `git log --oneline 95b18746e..feat/199-managerhome -- . ':!.planning'`. Routed items: WR-01-R3 is booked as a follow-up phase and SFH-R2-02 as a LOW `TODOS.md` entry in the same records PR.

---

_Verified: 2026-11-10T20:50:00Z_
_Verifier: Claude (gsd-verifier)_
