# Phase 244: ACCESSGUARDS - Research

**Researched:** 2026-11-26
**Domain:** TypeScript type-level guards, a regex-based audit-coverage gate, Playwright e2e wiring against the local-stack lane
**Confidence:** HIGH for DBACC-04 and DBACC-05 (both prototyped and run green and red this session); MEDIUM for DBACC-06 (Docker is down here, so no Playwright run happened, and one arm is spec rot)
**Base:** HEAD `1b59794a89dcff58a2121d151bdebaa50f099c6d` on branch `gsd/phase-244-accessguards`. Line numbers below are only valid at this sha; files this phase edits are anchored by symbol first.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**DBACC-05 per-site judgment (FOUNDER DECISION 2026-11-26: "Approve as proposed", relayed by the coordinating session from the founder's AskUserQuestion answer)**
- Site 1, `src/app/api/admin/partner-import/route.ts` `profiles` upsert: COVERED by a real audit row. The import writes one roll-up `admin.partner_import` row via `emitAsUser` (route.ts ~:878 and ~:1006). The existing `@audit-skip` pragma sits outside the gate's 8-line window; move it into the window.
- Sites 2-3, `src/app/api/cron/flag-monitor/route.ts`, the two `feature_flags` upserts of `ZERO_DENOM_STREAK_KEY` (increment in `handleZeroDenominator`, reset on the first non-zero window): FOUNDER EXEMPTION 2026-11-26, internal cron counter written every 15 minutes.
- Site 4, `src/app/api/keys/sync/route.ts` `stampCompositeFailedUnlessComplete`'s `strategy_analytics` upsert: FOUNDER EXEMPTION 2026-11-26, derived `strategy_analytics` compute state ('failed' stamp).
- Sites 5-6, `src/app/api/strategies/finalize-wizard/route.ts`, the `strategy_analytics` upserts in `compositeMemberCount` and `unifiedFinalizeWizardHandler`: FOUNDER EXEMPTION 2026-11-26, same class as site 4.
- Exemption form: an in-window `// @audit-skip:` pragma at each of sites 2-6 whose reason cites "founder exemption 2026-11-26 (Phase 244 DBACC-05)" and names the class (internal cron counter / derived strategy_analytics compute state). The allowlist goes 6 -> 0 by deleting its entries, and the `toHaveLength(6)` literal moves with it. - **Reversibility:** costly - an exemption is a compliance judgment the founder owns; undoing it later means designing audit actions and probably a migration that auto-applies to PROD.
- Not chosen: real audit rows for sites 2-6 (new `AuditAction` values, possibly a migration).

**Decided autonomously**
- [DBACC-04] Q: "How is the compile guard shaped?" -> Selected: "Keep `Strategy.api_key_id` REQUIRED (`string | null`) and add `PublicStrategy = Omit<Strategy, 'api_key_id'>` in `src/lib/types.ts` for the readers that select `STRATEGY_PUBLIC_COLUMNS` (`getFactsheetDetail`, `getStrategiesByCategory` and any other found by grep in `src/lib/queries.ts`, which today cast to `Strategy`). Measured 2026-11-26: flipping the field to required alone gives 0 tsc errors at HEAD, so the work is the public types plus the test." - local type edit, no runtime or schema change
- [DBACC-04] Q: "How is the guard tested?" -> Selected: "A type-level test file with `@ts-expect-error` lines inside a never-invoked function (the `src/__tests__/audit-event-union-types.test.ts` pattern). The RED comes from `npx tsc --noEmit` (the `frontend-typecheck` job), because vitest strips types and cannot fail on it. Neuter = make the field optional again; tsc must report `Unused '@ts-expect-error' directive` on the named line." - test-only
- [DBACC-05] Q: "How does the ratchet end?" -> Selected: "Delete each discharged allowlist entry and lower the `toHaveLength` literal in the same commit; the gate's own discharge arm demands it. Never add an entry. Update the header prose to record the closure date." - test file edit
- [DBACC-05] Q: "PROOF-01 for the audit gate?" -> Selected: "Neuter = remove one new in-window pragma (or move it out of the window); the gate must go red naming that file and snippet in its 'NOT in the H-0001 allowlist' message; restore from a byte backup (`cp` back, `cmp`)." - proof procedure only
- [DBACC-06] Q: "How is the watchlist spec wired?" -> Selected: "Add `e2e/discovery-watchlist.spec.ts` to the `e2e-seeded` Playwright list in `.github/workflows/ci.yml` (place 1 of the MA-8 contract; its `HAS_SEED_ENV` skip is place 2), and add a wiring pin test modelled on `src/__tests__/manager-keys-e2e-wiring.test.ts` so dropping it from the list, adding it to the advisory `e2e` list, or a tolerated-failure spelling goes red. Grep `src/__tests__` for every census of the seeded list and update each." - CI list and test edits
- [DBACC-06] Q: "What about the RLS arm's silent skip?" -> Selected: "Remove the `if (anonKey)` guard around the bare `user_favorites` SELECT (spec ~:376-377) so a missing `TEST_SUPABASE_ANON_KEY` FAILS rather than skipping the primary RLS proof. The `e2e-seeded` lane already exports `TEST_SUPABASE_ANON_KEY`." - spec edit
- [DBACC-06] Q: "Where is the neutered-policy proof run?" -> Selected: "On the local-stack lane only (`scripts/local-stack/run.sh up`), never shared TEST or PROD: replace the `user_favorites` SELECT policy with `USING (true)`, run the spec, see the 'RLS LEAK on migration 024 policy' arm fail first, restore, see green. Also prove the 401 arm by neutering the route's auth check in a byte-backed copy. Stop the Docker stack and clean up afterwards." - local proof procedure
- [DBACC-06] Q: "Run-and-repair?" -> Selected: "Run the spec against the local-stack lane before wiring; repair spec rot found there within the spec file only. The spec has never run in CI." - spec-local

### Claude's Discretion
- Plan split and wave layout (the three requirements are independent: one plan per requirement fits; DBACC-05 can split site 1 from sites 2-6 so the founder wait blocks only the second).

### Deferred Ideas (OUT OF SCOPE)
- flag-monitor's two streak upserts and finalize-wizard's two `strategy_analytics` upserts ignore their `error` result. That is a silent-failure question outside DBACC-05's audit-row scope.

**Also out of scope (CONTEXT `<domain>`):** the other 158-OPS-03 bullets. **Merge constraint:** nothing merges to main before 23:15 UTC 2026-11-26.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DBACC-04 | An owner-surface read that lacks `api_key_id` fails to compile. | Prototype: `Strategy.api_key_id` required + `PublicStrategy` + a public ranked-row type + a relaxed `StrategyTable`/`StrategyGrid` row type gives 0 tsc errors and 309 vitest files green; a type test goes RED (TS2578) when the field is made optional again. See "DBACC-04" below. |
| DBACC-05 | Each of the six routes outside the audit-log law writes an audit row, or carries a recorded founder exemption. The exact-set allowlist only shrinks. | Prototype: one moved pragma + five new pragmas discharge all six entries; allowlist emptied + literal lowered gives green; removing one pragma gives the named red. Pragma window rules read from `isCovered`. See "DBACC-05" below. |
| DBACC-06 | The `discovery-watchlist` RLS and auth assertions run in CI and can fail there. | The spec needs a guard-import change, a count pin move 26 -> 27, a wiring pin, and a decision on the 401 arm, which the proxy intercepts before the route. See "DBACC-06" below. |
</phase_requirements>

## Summary

DBACC-04 is larger than CONTEXT's wording. Flipping the field to required alone is silent (re-verified: 0 tsc errors), because both public readers pass an explicit generic (`.single<Strategy & ...>()`) or cast through `unknown`. The guard only exists once the public readers return a type that lacks the field. That immediately breaks `StrategyTable` and `StrategyGrid`, which are shared by the public pages and the owner `/strategies` list and declare their own `Strategy & {...}` row. The minimal working shape (prototyped, then fully reverted): `PublicStrategy` in `types.ts`, `PublicRankedStrategyRow = Omit<RankedStrategyRow, "api_key_id">` as `getStrategiesByCategory`'s return, `getFactsheetDetail` retyped to `PublicStrategy`, and the two shared components taking `PublicStrategy & { api_key_id?: string | null }`. With that: `tsc --noEmit` 0 errors and 309 vitest files / 5607 tests green over every source-reading test touching these files.

DBACC-05 is mechanical and fully de-risked. All six allowlist entries discharge with one pragma move (site 1) and five new one-line pragmas placed directly above each upsert statement. The gate's own discharge arm then forces the entry deletions, and with the allowlist emptied and `toHaveLength(0)` the suite is green; removing any one pragma turns it red naming file, line and snippet. 34 test files that read these four route files stay green with the comments inserted.

DBACC-06 has one finding that changes the plan. The spec's `PUT /api/watchlist/<uuid>` unauthenticated test asserts 401, but `src/proxy.ts` answers that request with a 307 to `/login` before the route runs, because `/api/watchlist` is not in `PUBLIC_ROUTES`. The route's own `if (!user) return 401` is unreachable for a cookie-less caller, so "neuter the route's auth check" (a locked CONTEXT step) cannot turn this arm red as written. This is spec rot the lane run would surface; it is an Open Question (below) because the repair choice changes what the arm proves. Everything else is list wiring plus two census edits (the hydration-guard import and `SEEDED_SPEC_COUNT` 26 -> 27).

**Primary recommendation:** Plan three independent plans (DBACC-04, DBACC-05 split site 1 / sites 2-6, DBACC-06). Make "boot the lane and run the spec as-is" the first DBACC-06 task, resolve the 401-arm question from that measured status, and plan the type change with the public ranked-row type and the shared-component relaxation included, since without them the guard is a no-op.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Owner vs public row typing (`Strategy` / `PublicStrategy`) | Build-time (TypeScript) | API / Backend (readers in `queries.ts`) | Compile-time contract; readers pick the type that matches their column projection. |
| Audit-row coverage law | CI test (vitest source scan) | API / Backend (route files) | Static gate over `src/app/api/**/route.ts`; pragmas live in the routes. |
| `user_favorites` RLS (user-B cannot read user-A) | Database / Storage (RLS policy "users see own favorites") | API / Backend (explicit `.eq` in `getMyWatchlist` is defense-in-depth only) | RLS is the only thing that scopes a bare SELECT; `anon` and `authenticated` hold table-level grants. |
| Anonymous PUT rejection | Frontend Server (`src/proxy.ts` session gate) | API / Backend (route 401 guard, covered by `route.test.ts`) | The proxy runs first and redirects; the route guard is unreachable for a cookie-less caller. |
| Anonymous `/browse/[slug]` hides watchlist chrome | Frontend Server (SSR, `StrategyTable` `userId` gate) | Browser | Server renders without `userId`. |
| Seeded e2e gating | CI (`e2e-seeded` job, `frontend` aggregator) | Test fixtures (seed/cleanup helpers) | The job is judged by the aggregator; the spec self-seeds against a lane private to the runner. |

## Standard Stack

No new packages. Every change is edits to existing TypeScript, workflow YAML and one test file.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| typescript (via `tsc --noEmit`) | repo-pinned | Type-level guard; unused `@ts-expect-error` is TS2578 | `frontend-typecheck` job runs `npm run typecheck` = `tsc --noEmit` `[VERIFIED: package.json scripts, ci.yml frontend-typecheck]` |
| vitest | 5.0.5 `[VERIFIED: vitest run header]` | Audit gate, wiring pins, censuses | Existing framework |
| @playwright/test | repo-pinned, chromium installed locally `[VERIFIED: node_modules/@playwright/test/package.json present, ms-playwright cache has chromium]` | The watchlist spec | Existing framework |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Relax `StrategyTable`/`StrategyGrid` row type | Make the pages cast `PublicRankedStrategyRow` to `Strategy` | A cast re-creates the lie the guard removes. Rejected. |
| Public type via `Omit<Strategy, "api_key_id">` | A hand-listed interface from `STRATEGY_PUBLIC_COLUMNS_ARR` | `Omit` cannot drift from `Strategy`; a hand list can. CONTEXT already chose `Omit`. |

**Installation:** none.

## Package Legitimacy Audit

No external packages are installed or recommended by this phase. Audit: none required.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
DBACC-04 (build time)
 PostgREST select STRATEGY_PUBLIC_COLUMNS ──► getFactsheetDetail ──► PublicStrategy ──► tearsheet page, tearsheet.pdf route
                                          └─► getStrategiesByCategory ─► PublicRankedStrategyRow[] ─┐
 owner select(*) ───────────────────────────► getMyStrategies ───────► RankedStrategyRow (api_key_id required) ─┤
                                                                                                                 ▼
                          StrategyTable / StrategyGrid take  PublicStrategy & { api_key_id?: string | null }  (shared surface)
 src/__tests__/<new>.test.ts  --- @ts-expect-error arms --->  tsc --noEmit (frontend-typecheck) --- RED if Strategy.api_key_id goes optional

DBACC-05 (CI test time)
 src/app/api/**/route.ts ─► findMutations / findRpcMutations / findHelperMutations / findImportedMutatorCalls
        └─► isCovered: pragma in [chainStart-8, chainStart-1]  OR  logAuditEvent(AsUser)( in same function body
              └─► uncovered ─► must equal H_0001_UNCOVERED_ALLOWLIST exactly (new = red, discharged = red)  ──► ends at 0 entries

DBACC-06 (CI e2e-seeded)
 run.sh up (lane) ─► handoff exports TEST_SUPABASE_{URL,ANON_KEY,SERVICE_ROLE_KEY} ─► seed-demo-data ─► npm run build ─► npm run start
   ─► playwright (CI=true: 1 worker, 2 retries) ─► discovery-watchlist.spec.ts
        test 1 star toggle persists  (allocator UI)
        test 2 anonymous PUT         ─► proxy.ts 307 /login   (route 401 never reached)
        test 3 user-B bare SELECT    ─► RLS policy "users see own favorites"   <-- neuter target
        test 4 anon /browse chrome   (no seed)
```

### Recommended edit set

```
src/lib/types.ts                              # api_key_id required; export PublicStrategy
src/lib/queries.ts                            # getFactsheetDetail -> PublicStrategy; getStrategiesByCategory -> PublicRankedStrategyRow
src/components/strategy/StrategyTable.tsx     # local row type: PublicStrategy & { api_key_id?: string | null } & {...}
src/components/strategy/StrategyGrid.tsx      # same
src/__tests__/<new api-key-id type test>.test.ts
src/app/api/{admin/partner-import,cron/flag-monitor,keys/sync,strategies/finalize-wizard}/route.ts   # comments only
src/__tests__/audit-coverage.test.ts          # allowlist 6 -> 0, literal 6 -> 0, header prose
e2e/discovery-watchlist.spec.ts               # guard import, anon-key guard removed, 401 arm repair
.github/workflows/ci.yml                      # one line in the e2e-seeded `else` arm list
src/__tests__/e2e-seeded-hydration-guard.test.ts   # SEEDED_SPEC_COUNT 26 -> 27 (+ pin comment history)
src/__tests__/<new watchlist wiring pin>.test.ts
TODOS.md / CHANGELOG.md / VERSION / package.json   # ship only
```

### DBACC-04: how the guard is shaped (prototyped, then reverted)

**Readers of `STRATEGY_PUBLIC_COLUMNS` (exhaustive).** `grep -rn STRATEGY_PUBLIC_COLUMNS src e2e scripts supabase/tests docs analytics-service` finds exactly two non-test readers, both in `src/lib/queries.ts`:
- `getStrategiesByCategory` (`.select(\`${STRATEGY_PUBLIC_COLUMNS}, discovery_categories!inner(slug), strategy_analytics (...)\`)`), whose result goes `as unknown as {id; strategy_analytics}[]` into `shapeRankingRows`, returning `RankedStrategyRow[]`.
- `getFactsheetDetail` (`.single<Strategy & { discovery_categories: ...; strategy_analytics: ... }>()` and a return type `strategy: Strategy & { discovery_categories?: ... }`).
Other hits are the constants file, the two census tests (`src/lib/anon-strategies-projection.test.ts`, `src/lib/anon-strategies-live-probe.test.ts`) and comments. TODOS says "three public readers"; at HEAD it is two (the third, `getPublicStrategyDetail`, was deleted in Phase 196 plan 14 per the comment on `ANON_READERS` in `anon-strategies-projection.test.ts`). `[VERIFIED: grep this session; src/lib/anon-strategies-projection.test.ts "Phase 196 plan 14 deleted getPublicStrategyDetail"]`

**Why flipping the field alone is a no-op.** Re-measured: with `api_key_id: string | null;` in `Strategy`, `npx tsc --noEmit --incremental false` prints nothing (about 99 s). `[VERIFIED: tsc run this session]` The public readers hand-assert `Strategy`; `shapeRankingRows` also does `s as unknown as Strategy`.

**The ranked-row type is shared.** `RankedStrategyRow = StrategyWithAnalytics & {...}` (queries.ts) is returned by both `getStrategiesByCategory` (public) and `getMyStrategies` (owner, `select(\`*, strategy_analytics (*)\`)`). Keep `RankedStrategyRow` as the owner type (required key). Add the public type beside it.

**Prototype diff (the whole change, minus the one-line flip), measured clean:**
```diff
--- a/src/lib/types.ts
+++ b/src/lib/types.ts
@@ export interface Strategy {
-  // Optional: anon-safe projections (STRATEGY_PUBLIC_COLUMNS) omit it.
-  api_key_id?: string | null;
+  api_key_id: string | null;          // required: owner rows always carry it
@@ (after the interface's closing brace)
+export type PublicStrategy = Omit<Strategy, "api_key_id">;

--- a/src/lib/queries.ts
@@ import type { Strategy, ... } from "./types"
+  PublicStrategy,
@@ above getStrategiesByCategory
+export type PublicRankedStrategyRow = Omit<RankedStrategyRow, "api_key_id">;
-export async function getStrategiesByCategory(categorySlug: string): Promise<RankedStrategyRow[]> {
+export async function getStrategiesByCategory(categorySlug: string): Promise<PublicRankedStrategyRow[]> {
@@ getFactsheetDetail
-  strategy: Strategy & { discovery_categories?: { slug: string } | null };
+  strategy: PublicStrategy & { discovery_categories?: { slug: string } | null };
-    .single<Strategy & { discovery_categories: ...
+    .single<PublicStrategy & { discovery_categories: ...

--- a/src/components/strategy/StrategyTable.tsx   (and the identical edit in StrategyGrid.tsx)
-import type { Strategy, StrategyAnalytics } from "@/lib/types";
+import type { PublicStrategy, StrategyAnalytics } from "@/lib/types";
-type StrategyWithAnalytics = Strategy & {
+type StrategyWithAnalytics = PublicStrategy & { api_key_id?: string | null } & {
```
Results with exactly this diff plus the flip: `tsc` 0 errors; vitest over `src/lib/queries*`, `src/lib/anon-strategies*`, `src/components/strategy`, `src/app/browse`, `src/app/(dashboard)/discovery`, `src/app/(dashboard)/strategies`, `src/app/factsheet`, `src/app/api/factsheet`, the phase-149 / computed-at / recompute-verdict / figure-parity / public-truth-copy / phase-147 censuses and `seam-citations.invariant`: **309 files, 5607 passed, 18 skipped**. `[VERIFIED: vitest run this session, then every touched file restored and compared with cmp]`

**Without the component relaxation the guard bites at exactly these places** (measured, before relaxing): `src/app/(dashboard)/discovery/[slug]/page.tsx:108`, `src/app/browse/[slug]/page.tsx:77` and four sites in `StrategyTable.stale-analytics.test.tsx` (`Property 'api_key_id' is missing in type 'PublicRankedStrategyRow' but required in type 'Strategy'`). `[VERIFIED: tsc output this session]` So the relaxation is not optional; it goes beyond CONTEXT's wording and the planner should say so in the plan.

**`StrategyTable` reads `api_key_id` on both surfaces.** `{(s.trust_tier === "api_verified" || s.api_key_id) && (<VerifiedCheck />)}` (StrategyTable.tsx, the strategy-name cell; the adjacent comment explains public rows no longer carry the key). That is a deliberate dual-surface truth test, so `api_key_id?` stays optional on the shared row type. `StrategyForm.tsx` (`strategy?: Strategy`), the edit page (`.single<Strategy & {source}>()` over `select("*")`) and `strategies/page.tsx` (`OwnerListRow = Strategy & {...}`, `select("*", ...)` owner reads) all type as `Strategy`, so they get the required key for free and need no edit. `SyncProgress.tsx` and `SyncPreviewStep.tsx` read `api_key_id` from their own narrow selects, untyped as `Strategy`; untouched. `[VERIFIED: grep + reads this session]`

**Residual loopholes to record, not fix (CONTEXT: local type edit only):** `strategies/page.tsx` `shapeOf = (s: { id; source; api_key_id?: string | null }, ...)` and `queries.ts` helpers typed `{ api_key_id: string | null }` are structural escapes. The compile guard protects code that takes `Strategy`; it cannot see a select string. State this limit honestly in the test header and SUMMARY.

**Type test (prototyped, green with the diff, RED when neutered).**
```typescript
import { describe, it, expect } from "vitest";
import type { Strategy, PublicStrategy } from "@/lib/types";
import type { getFactsheetDetail, getStrategiesByCategory } from "@/lib/queries";

type FactsheetStrategy = NonNullable<Awaited<ReturnType<typeof getFactsheetDetail>>>["strategy"];
type CategoryRow = Awaited<ReturnType<typeof getStrategiesByCategory>>[number];

// Never invoked: only its TS body is type-checked (pattern of audit-event-union-types.test.ts).
function _typeAssertions(): void {
  const pub = {} as PublicStrategy;
  const factsheet = {} as FactsheetStrategy;
  const row = {} as CategoryRow;
  const owner = {} as Strategy;

  // @ts-expect-error - a public projection is not an owner row
  const a: Strategy = pub;
  void a;
  // @ts-expect-error - the public tearsheet reader's row has no api_key_id
  const b: Strategy = factsheet;
  void b;
  // @ts-expect-error - a category list row has no api_key_id
  const c: Strategy = row;
  void c;
  // @ts-expect-error - reading the key off a public row is a compile error
  void pub.api_key_id;
  // The owner type reads it as string | null with no undefined arm.
  const k: string | null = owner.api_key_id;
  void k;
}
void _typeAssertions;

describe("api_key_id compile guard (DBACC-04)", () => {
  it("is a type-level file; tsc --noEmit is the gate", () => {
    expect(true).toBe(true);
  });
});
```
Neuter (`api_key_id: string | null;` -> `api_key_id?: string | null;` in `types.ts`): tsc reports, in order, `TS2578 Unused '@ts-expect-error' directive` at the first three arms (lines 14, 17, 20 of the prototype) and `TS2322 'string | null | undefined' is not assignable to 'string | null'` at the owner arm (line 26). The fourth `@ts-expect-error` (`pub.api_key_id`) does NOT flip because `Omit` removes the key regardless; it guards `PublicStrategy` itself. The first RED line is the arm the PROOF-01 record names. `[VERIFIED: tsc run this session]` Add an owner-reader arm for `getMyStrategies` (`NonNullable<Awaited<ReturnType<typeof getMyStrategies>>>[number]["api_key_id"]` must be `string | null`) so the guard names a real owner read; that arm was not run `[ASSUMED]`, the planner's tsc loop confirms it.

**Confirmed infrastructure.** `tsconfig.json` `include` is `**/*.ts`, `**/*.tsx` minus `node_modules`, `supabase`, `tools`, so `src/__tests__` and `e2e/` are type-checked; `incremental: true` means a CI cache of `tsconfig.tsbuildinfo` (use `--incremental false` locally to avoid dirtying the tree). `[VERIFIED: tsconfig.json, ci.yml frontend-typecheck]`

### DBACC-05: the gate's exact rules (read from `isCovered` / `findMutations`)

- **Pragma window.** `isCovered` loops `for (let j = Math.max(0, chainStartIdx - 8); j < chainStartIdx; j++)` over the RAW lines and tests `/@audit-skip\s*:/`. In 1-indexed terms the pragma must sit on a line in `[chainStart-8, chainStart-1]`. A pragma on the chain-start line itself, or below it, does not count. `[VERIFIED: src/__tests__/audit-coverage.test.ts isCovered, "Pragma check: @audit-skip must live within 8 lines ABOVE the mutation chain's start line"]`
- **Chain start.** `findMutations` sets `chainStart = fromIdx` (the line holding `.from(`) and only walks BACK to a statement head when that `.from(` line itself starts with `.`. All six sites are single-line `await x.from("t").upsert(` statements, so `chainStart` is the upsert line itself. `[VERIFIED: findMutations, "if (lines[fromIdx].trim().startsWith("."))"]`
- **`emitAsUser` does not count as an audit call.** The forward walk matches `/logAuditEvent(AsUser)?\s*\(/` only. partner-import's real audit row is written by `emitAsUser(`, which the regex does not match, so a pragma is the only way site 1 can be covered; the CONTEXT decision "move the pragma" is the right one. `[VERIFIED: isCovered audit-call-above and audit-call regexes; partner-import route.ts uses emitAsUser at the roll-up]`
- **Two lines can share a snippet.** `const { error: profileErr } = await admin.from("profiles").upsert(` appears twice in partner-import (first at the unguarded site, second with an in-window pragma). The allowlist key is `file :: snippet`, so one entry matches the one uncovered occurrence; after the move it is discharged. `[VERIFIED: grep + discharge run]`
- **Both directions are red.** A new uncovered site not in the list throws `Found N uninstrumented mutation(s) NOT in the H-0001 allowlist:` with `<file>:<line>` and `> <snippet>`; a listed entry that is now covered throws `N H-0001 allowlist entr(y/ies) are no longer uncovered:`. So each pragma commit MUST delete its entries in the same commit.

**Site anchors (HEAD).** Symbols, with HEAD lines in brackets:
| Site | File | Statement (the allowlist snippet) | Where the pragma goes |
|---|---|---|---|
| 1 | `admin/partner-import/route.ts` [:707] | `const { error: profileErr } = await admin.from("profiles").upsert(` | MOVE the existing 4-line pragma block (currently [:692-:695], 15 lines above) to directly above this statement (after `const managerDisplayName = ...`). |
| 2 | `cron/flag-monitor/route.ts` `handleZeroDenominator` [:499] | `await args.admin.from("feature_flags").upsert(` | new pragma directly above |
| 3 | `cron/flag-monitor/route.ts` main handler, after `if (total === 0)` [:638] | `await admin.from("feature_flags").upsert(` | new pragma directly above (a prose comment "Reset streak..." already sits there) |
| 4 | `keys/sync/route.ts` `stampCompositeFailedUnlessComplete` [:593] | `const { error: stampErr } = await admin.from("strategy_analytics").upsert(` | new pragma directly above |
| 5 | `strategies/finalize-wizard/route.ts` `compositeMemberCount` [:2539] | `await admin.from("strategy_analytics").upsert(` | new pragma directly above |
| 6 | `strategies/finalize-wizard/route.ts` `unifiedFinalizeWizardHandler` [:2684] | `await compositeAdmin.from("strategy_analytics").upsert(` | new pragma directly above |

Pragma text, one or two lines, first line carries the token: `// @audit-skip: founder exemption 2026-11-26 (Phase 244 DBACC-05) - internal cron counter, ...` for sites 2-3 and `... - derived strategy_analytics compute state.` for 4-6. `[VERIFIED: prototype, all six discharged]`

**Prototype result.** Applying those edits and nothing else: the suite reports `6 H-0001 allowlist entr(y/ies) are no longer uncovered` (all six, so placement is right). Emptying the list (`const H_0001_UNCOVERED_ALLOWLIST: ReadonlyArray<{file; snippet; reason}> = [];`) and `toHaveLength(0)`: `audit-coverage.test.ts` 28 passed. Removing one pragma (site 3): `Found 1 uninstrumented mutation(s) NOT in the H-0001 allowlist: src/app/api/cron/flag-monitor/route.ts:640 > await admin.from("feature_flags").upsert(`. 34 test files that read these four route files (the `seam-*` invariants, `no-email-in-copy`, `redteam-b02-regressions`, `phase-150-capital-ownership-invariant`, `recompute-verdict-census`, `no-store-coverage`, `options-cash-wallet-withhold.census`, `contracts/*`, the four routes' own tests) all stayed green: 1241 tests. `[VERIFIED: vitest runs this session, files restored with cmp]`

**Keep the empty array.** Keep `H_0001_UNCOVERED_ALLOWLIST` as a typed empty array rather than deleting it: the "NOT in the allowlist" and discharge arms and their guidance text keep working, and a future debt entry is still impossible without an explicit edit. The header prose (the `H-0001 - the six PRE-EXISTING ...` block) records the closure date and the per-site disposition. Four comments in the test point at the TODOS entry and go stale at ship: "it stays open under H-0001 in TODOS.md" (the detector block above `describe` near `findMutations` tests, and the allowlist header), "(TODOS.md, "H-0001 census RE-MEASURED", ...)", and "match the SUMMARY and TODOS entry" (near `toHaveLength`). Reword them.

**Plan split (Claude's discretion, recommended).** Plan A, site 1: move the pragma, delete entry 1, `toHaveLength(6)` -> `5`. Plan B, sites 2-6: five pragmas, delete entries 2-6, `toHaveLength(5)` -> `0`, header prose. Each commit stays green on its own because the discharge arm demands the deletion alongside the pragma. Both touch `audit-coverage.test.ts`, so serialize them (A then B) or one plan.

### DBACC-06: spec, wiring and proof

**Spec rot check at HEAD (static; no Playwright run was possible because the Docker daemon is down).**
| Spec dependency | Status | Evidence |
|---|---|---|
| Routes `/discovery/crypto-sma`, `/browse/crypto-sma`, `PUT /api/watchlist/[strategyId]` | exist | `src/app/(dashboard)/discovery/[slug]/page.tsx`, `src/app/browse/[slug]/page.tsx`, `src/app/api/watchlist/[strategyId]/route.ts` (param is `strategyId`, CONTEXT writes `[id]`) |
| `seedTestAllocator`, `seedBridgeCandidate({categorySlug})`, `cleanupTestAllocator`, `cleanupTestStrategy`, `SELECTORS`, `isPostLoginPath` | exist | `e2e/helpers/seed-test-project.ts`, `cleanup-test-project.ts`, `discovery-selectors.ts`, `login.ts` |
| `crypto-sma` category on the lane | replayed | `scripts/restore-test-refdata-allowlist.txt` lists `20260405061911_initial_schema.sql	public.discovery_categories` |
| `watchlist-count-badge`, "My watchlist" tab, StarToggle labels (`Add ${name} to watchlist` / `Remove ${name} from watchlist`) | exist | `WatchlistTabs.tsx`, `StarToggle.tsx` |
| **Anonymous PUT reaches the route's 401** | **NO** | see below |
| `/discovery/<slug>` renders a published strategy with no analytics row | UNMEASURED | `shapeRankingRows` substitutes `EMPTY_ANALYTICS`; a lane run is the only proof `[ASSUMED]` |

**The 401 arm (the finding to lead with).** `src/proxy.ts` line 19 reads, verbatim: `const PUBLIC_ROUTES = ["/login", "/signup", "/forgot-password", "/reset-password", "/api/health", "/strategy", "/factsheet", "/api/factsheet", "/api/og/factsheet", "/browse", "/api/keys", "/api/trades", "/api/verify-strategy", "/api/alert-digest", "/portfolio-pdf", "/scenario-share", "/factsheet-share", "/api/benchmark/btc", "/legal", "/for-quants", "/api/for-quants-lead", "/security", "/contact", "/home"];` `/api/watchlist` is not there, and the gate is `if (!session && !isPublicRoute && !isAuthCallbackRoute) { ... return NextResponse.redirect(url) }` with `url.pathname = "/login"`. A probe that called the real `proxy()` with a mocked cookie-less session on `PUT http://localhost:3000/api/watchlist/cccccccc-0001-4000-8000-000000000001` (matching Origin, JSON body) returned `307 http://localhost:3000/login`. `[VERIFIED: Read src/proxy.ts:19, probe output this session "expected '307 http://localhost:3000/login' to be 'PROBE'"]` So the spec's `expect(res.status()).toBe(401)` cannot hold, and the route's `if (!user) return 401` (the arm CONTEXT wants neutered) is never reached by an anonymous request. What Playwright's `request.put` finally reports after following the 307 (it follows redirects by default, preserving the method on 307) is unmeasured: `[ASSUMED]` (a non-401, probably 405 or 200 from `/login`). The route's 401 is covered at unit level (`route.test.ts` "returns 401 when supabase getUser returns null"), not in e2e. See Open Question 1.

**Spec edits that are certain:**
1. Replace `import { test, expect } from "@playwright/test";` with `import { test, expect } from "./helpers/hydration-guard";` (the module re-exports all of `@playwright/test`, `export * from "@playwright/test"` plus a guarded `test`). `src/__tests__/e2e-seeded-hydration-guard.test.ts` ("every seeded spec binds `test` from the hydration guard") goes RED for any listed spec that binds `test` from `@playwright/test`. `[VERIFIED: hydration-guard.ts line 1, test file unguardedReason]`
2. Remove `if (anonKey) { ... }` around the bare `user_favorites` SELECT (spec "const anonKey = process.env.TEST_SUPABASE_ANON_KEY; if (anonKey) {", about :376-409). Replace the guard with `expect(anonKey, "TEST_SUPABASE_ANON_KEY missing - the primary RLS proof cannot run").toBeTruthy()` so the failure names the cause instead of `createClient` throwing. The `e2e-seeded` handoff step exports it: `printf 'TEST_SUPABASE_ANON_KEY=%s\n' "${anon_key}"` (ci.yml, step `Lane handoff - assert loopback, then export the URL and keys to later steps`). `[VERIFIED: ci.yml]`
3. Keep `test.skip(!HAS_SEED_ENV, ...)` (place 2 of MA-8) per CONTEXT. It is a conditional skip; `spec-disabling.invariant.test.ts` only flags `test.skip(true`/`test.skip()` forms.

**CI list wiring.** Add `e2e/discovery-watchlist.spec.ts \` to the `else` arm of step `- name: Run seed-gated specs (MA-8 / BLOCK-3)` in the `e2e-seeded` job, anywhere before the final `e2e/manager-keys.spec.ts \` and its `--timeout 60000` (the parsers read up to `--timeout`). It must NOT be added to the advisory `e2e` job's list. `[VERIFIED: ci.yml e2e-seeded step]`

**Every census that moves when a spec joins the list.**
| Test | What moves |
|---|---|
| `src/__tests__/e2e-seeded-hydration-guard.test.ts` | `SEEDED_SPEC_COUNT = 26` -> 27 (extend the dated PIN comment); the guard-import check (item 1 above). |
| `src/__tests__/manager-keys-e2e-wiring.test.ts` | Nothing moves; it pins its own spec and the seeded step's tolerance (continue-on-error, errexit-off, `--timeout 60000` tail, `fi` tail, `$?`). That step-shape pin already covers the new entry. Do not duplicate it. |
| `critical-regressions.test.ts` | Pins the `e2e-seeded` job shape (gate, `npm run build`, lane handoff, inline-URL verify step); not the spec list. No change. |
| `tap-target-minimums`, `observ12-fixtures-presence`, `phase-150-capital-ownership-invariant`, `local-stack-lane-wiring`, `contracts/*` | They mention `e2e-seeded` or other spec names; none parses the list (read this session). No change. |
| `contracts/spec-disabling.invariant.test.ts` | Scans all specs for unconditional skips; the spec has none. No change. |

**New wiring pin (model: `manager-keys-e2e-wiring.test.ts`, with a local copy of its parser; do not import a test file).** Assert: (1) the seeded list parses non-empty and contains `e2e/discovery-watchlist.spec.ts`; (2) the advisory `e2e` job's `npx playwright test` line naming `e2e/smoke.spec.ts` does not contain it; (3) the spec (comment-stripped via `stripCommentsPreserveLines` from `@/lib/source-scan`) has no `.fixme(`/`.only(`/`test.skip(true`, and exactly one skip, `test.skip(!HAS_SEED_ENV`; NOT the manager-keys "no `process.env`, no `.skip(`" arm, which the kept `HAS_SEED_ENV` skip would violate; (4) the spec no longer matches `/if\s*\(\s*anonKey\s*\)/` (the silent RLS skip), and still contains the load-bearing anchors `RLS LEAK on migration 024 policy`, `signInWithPassword(`, `.from("user_favorites")` and the 401-arm anchor chosen under Open Question 1. Do not copy the step-tolerance arm (manager-keys already pins that step).

**Cross-spec pollution.** The spec seeds `seedBridgeCandidate({ categorySlug: "crypto-sma" })`, a published non-example strategy. The `ci.yml` comment at the seeded list names this exact seed as the thing that polluted `discovery-hide-examples-default` in v1.3 and says the cure is teardown by id. The spec tears it down in `test.afterAll` (`cleanupTestStrategy(seededStrategy)`). In CI `playwright.config.ts` is `workers: process.env.CI ? 1 : undefined`, `fullyParallel: true`, `retries: process.env.CI ? 2 : 0`, so specs run one at a time; `discovery-hide-examples-default` matches names against the seed-name set and only logs row counts, so a leftover non-example row would not fail it. Residual risks to check during the lane run: `cleanupTestStrategy` throws in CI on a leak (it surfaces rather than hides); a retry re-runs `beforeAll` and seeds a second strategy (the first row is cleaned in `afterAll` after the final attempt, so a retried describe can leave one extra row until then). `[VERIFIED: playwright.config.ts, ci.yml comment, helper read]` `[ASSUMED: retry/beforeAll interplay for describe blocks]`.

**RLS facts.** `public.user_favorites` has RLS enabled and four policies; the SELECT policy is `CREATE POLICY "users see own favorites" ON "public"."user_favorites" FOR SELECT USING (("auth"."uid"() = "user_id"));` (baseline.sql, 19043). `anon` AND `authenticated` hold table-level `SELECT,INSERT,REFERENCES,DELETE,UPDATE` on it (baseline.sql, 20853-20854), so RLS is the ONLY row scope and the spec is the only e2e proof. No `supabase/tests` file covers it. `[VERIFIED: baseline.sql read, grep of supabase/tests]` The user-B `SELECT *` sits in test 3; with the SELECT policy neutered the first failing assertion is the bare-SELECT arm whose message is `user-B's session sees N of user-A's user_favorites rows - RLS LEAK on migration 024 policy`. The UI arm (`getMyWatchlist` has an explicit `.eq("user_id", ...)`) would stay green under the neuter, which is why that arm is documented as belt-and-braces.

**Exact neuter and byte-restore on the lane (never shared TEST or PROD).**
1. Snapshot: `psql "$LANE_DB_URL" -At -c "select polname, polcmd, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid) from pg_policy where polrelid = 'public.user_favorites'::regclass order by polname" > before.txt` (take `DB_URL` from the mode-600, gitignored `scripts/local-stack/.stack-env`; it is loopback and `run.sh --assert-local-handoff` proves that; never print it into a tracked file).
2. Neuter: `ALTER POLICY "users see own favorites" ON public.user_favorites USING (true);`
3. Run the spec; expect test 3 red with the leak message first.
4. Restore: `ALTER POLICY "users see own favorites" ON public.user_favorites USING ((auth.uid() = user_id));` then re-run the snapshot to `after.txt` and `cmp before.txt after.txt` (the DB analogue of the `cp` + `cmp` rule, which does not map to a live policy). Then run the spec green.
5. Preferred alternative that needs no restore: since the lane is disposable, `run.sh down` then `up` also resets it, but the snapshot `cmp` is the recorded proof.

**How to run the spec locally (mirror of the `e2e-seeded` job; no Docker was started this session).**
1. `bash scripts/local-stack/run.sh --check-currency` (names the migrations the lane replays), then `bash scripts/local-stack/run.sh up` (boots the Supabase CLI stack, loads `supabase/schema/baseline.sql`, replays reference data and newer migrations, writes `scripts/local-stack/.stack-env`).
2. `bash scripts/local-stack/run.sh --assert-local-handoff scripts/local-stack/.stack-env`, then export from that file: `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` into `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY` (the CI step parses the same three lines with `sed`).
3. `SEED_CONFIRM_STAGING=true npx tsx scripts/seed-demo-data.ts`.
4. `ADMIN_EMAIL=test@example.com PLATFORM_NAME=Quantalyze PLATFORM_EMAIL=test@example.com SHARE_TOKEN_SECRET=placeholder_share_token_secret_not_a_real_secret npm run build` (the job's build env; a build inlines the lane URL).
5. Start `npm run start` with the same env plus `NEXT_PUBLIC_ALLOWED_ORIGINS=http://localhost:3000` (production mode does not auto-allow localhost, so without it the CSRF guard 403s the PUT).
6. `CI=true npx playwright test e2e/discovery-watchlist.spec.ts --timeout 60000` (CI mode: no spawned dev server, 1 worker, 2 retries, as in the job). Record the `list` reporter output with 4 executed and 0 skipped; TODOS' own rule for 158-OPS-03 is "verify >=1 executed, non-skipped case per spec before calling it wired".
7. For quick neuter iterations a `next dev` server (what `playwright.config.ts` spawns when `CI` is unset) avoids the 1-2 minute rebuild; do the final green record under build + start for CI parity.
8. Afterwards `bash scripts/local-stack/run.sh down` and stop/clean Docker (founder memory: Docker cleanup after use; put it in every executor brief).

**Local tool skew.** The local `supabase` CLI is 2.84.2; CI pins 2.98.2 (`ci.yml` `supabase/setup-cli` `version: 2.98.2`). The lane pins its own Postgres image (`LANE_PG_VERSION="17.6.1.113"` in `run.sh`), so Postgres is not skewed, but record the CLI version in the SUMMARY. `[VERIFIED: supabase --version, ci.yml, run.sh:158]`

### Anti-Patterns to Avoid
- **Casting public rows to `Strategy`** to satisfy a consumer: re-creates the lie. Relax the consumer's row type instead.
- **Adding `/api/watchlist` to `PUBLIC_ROUTES`** to make the spec's 401 reachable: a production routing change, outside "repair spec rot within the spec file only".
- **Leaving an allowlist entry beside a new pragma:** the discharge arm goes red; delete in the same commit.
- **A pragma more than 8 lines above the chain start, or on/below it:** silently not counted.
- **Citing `file:line` anchors in PLAN.md for files this phase edits:** `plan-anchor-verify` re-resolves them and fails on a miss; cite by symbol.
- **Importing a test file to reuse its parser** (registers its tests twice); copy the parser as manager-keys did.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Making an unused expectation fail | A runtime assertion on types | `// @ts-expect-error` + `tsc --noEmit` | vitest strips types; TS2578 is the failure. |
| Public row type | A hand-copied interface | `Omit<Strategy, "api_key_id">` | Cannot drift. |
| Seeded-list parsing | A new YAML parser | The `seededStep` / `parseSeededSpecs` text parser already in `manager-keys-e2e-wiring.test.ts` (copy) | Pinned, self-tested pattern. |
| Lane lifecycle | Hand-run `supabase start` | `scripts/local-stack/run.sh up` / `down` / `--assert-teardown` | Refuses non-local targets; pins the Postgres image; hands over env. |
| Seeding users/strategies | Raw inserts | `seedTestAllocator`, `seedBridgeCandidate`, `cleanupTestAllocator`, `cleanupTestStrategy` | They carry the production-URL guards and the cleanup contract. |

**Key insight:** every one of these gates already exists; the phase's job is to make them bite on the surface they were meant to protect, then prove each bites.

## Common Pitfalls

### Pitfall 1: The compile guard is a no-op without the public types
**What goes wrong:** the field is flipped to required, tsc stays green, and the guard guards nothing.
**Why:** readers use explicit generics / `as unknown as`.
**Avoid:** retype the two readers and relax the shared components; the type test names `Strategy = PublicStrategy` as an error.
**Warning sign:** the type test passes before any reader is retyped.

### Pitfall 2: Pragma placed by prose position, not gate window
**What goes wrong:** a comment block longer than 8 lines puts the `@audit-skip:` token out of window; the site is "uncovered" again.
**Avoid:** pragma directly above the statement; verify by running `audit-coverage.test.ts`.

### Pitfall 3: Discharge arm
**What goes wrong:** pragma added, entry left; red with "no longer uncovered".
**Avoid:** pragma, entry deletion and literal change in one commit.

### Pitfall 4: Anonymous request never reaches the route
**What goes wrong:** the 401 arm passes or fails for the wrong reason; neutering the route changes nothing.
**Avoid:** see Open Question 1; assert what actually answers.

### Pitfall 5: CSRF origin in production mode
**What goes wrong:** the PUT returns 403 because `NEXT_PUBLIC_ALLOWED_ORIGINS` is absent under `next start`.
**Avoid:** export `NEXT_PUBLIC_ALLOWED_ORIGINS=http://localhost:3000` locally as the job does.

### Pitfall 6: A step `env:` shadows the lane handoff
**What goes wrong:** the six Supabase variables come from `$GITHUB_ENV`; a step-level `env:` naming any of them overrides the lane and points the suite elsewhere. Do not name them in any edited step.

### Pitfall 7: Planning artifacts in a public repo
Plans, SUMMARYs and this file are tracked: no home paths, no PROD ids, no scratch paths, no credential-shaped literals; run `npx tsx scripts/check-planning-hygiene.ts`. Never write the CI skip tokens in a commit message or PR body (CLAUDE.md "CI gate integrity").

## Code Examples

### Pragma placement (audit-coverage)
```typescript
// Source: this repo, audit-coverage.test.ts isCovered window rule (prototype-verified)
  // @audit-skip: founder exemption 2026-11-26 (Phase 244 DBACC-05) - internal cron counter reset.
  await admin.from("feature_flags").upsert(
    { flag_key: ZERO_DENOM_STREAK_KEY, value: "0", updated_at: now.toISOString(), updated_by: "cron/flag-monitor" },
    { onConflict: "flag_key" },
  );
```

### Allowlist at zero
```typescript
const H_0001_UNCOVERED_ALLOWLIST: ReadonlyArray<{
  file: string;
  snippet: string;
  reason: string;
}> = [];
// ...
expect(H_0001_UNCOVERED_ALLOWLIST).toHaveLength(0);
expect(uncovered).toHaveLength(H_0001_UNCOVERED_ALLOWLIST.length);
```

### Policy snapshot, neuter, restore (lane only)
```sql
-- snapshot (run before and after; cmp the two files)
select polname, polcmd, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
  from pg_policy where polrelid = 'public.user_favorites'::regclass order by polname;
-- neuter
ALTER POLICY "users see own favorites" ON public.user_favorites USING (true);
-- restore
ALTER POLICY "users see own favorites" ON public.user_favorites USING ((auth.uid() = user_id));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Strategy.api_key_id` optional so public projections compile | Required on `Strategy`, absent on `PublicStrategy` | this phase | Compiler separates owner and public rows. |
| `sql-tests`/`python`/`e2e-seeded` on shared TEST | Private local-stack lane per runner | Phase 164.9.4 (CIOFFMUTEX) | `e2e-seeded` can seed and neuter freely without touching shared TEST. |
| Allowlist of six uncovered sites | Empty allowlist plus pragmas | this phase | The ratchet ends at 0. |

**Deprecated/outdated:** TODOS wording "three public readers" (two at HEAD); CONTEXT "migration 024" is the old name of `20260409202757_user_favorites.sql`, the spec's message string is kept verbatim because the PROOF-01 record names it.

## Runtime State Inventory

Not a rename/refactor/migration phase. Omitted.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | What Playwright's `request.put` finally reports for an anonymous PUT after following the proxy's 307 (probably 405 or 200 from `/login`) | DBACC-06 401 arm | Low: it is not 401 either way; the lane run measures it. |
| A2 | `/discovery/crypto-sma` renders a published strategy with no `strategy_analytics` row on the lane, so test 1's row assertion holds | DBACC-06 spec rot | Medium: if rows are filtered, test 1 needs a spec-local repair (seed analytics or relax). Lane run measures it. |
| A3 | A describe-level retry re-seeds in `beforeAll` and can leave one extra published crypto-sma row until `afterAll` | pollution | Low: rows are non-example and tear down. |
| A4 | The owner-reader arm for `getMyStrategies` in the type test compiles as written | DBACC-04 test | Low: planner's tsc loop confirms. |
| A5 | A stale-but-unexpired session cookie (revoked server-side) passes the proxy's cookie-only `getSession` and reaches the route's `getUser()` 401 | Open Question 1 option B | Medium: depends on `@supabase/ssr` cookie handling; only matters if option B is chosen. |

## Open Questions (RESOLVED)

Resolution (2026-11-26): Q1 decided in 244-CONTEXT.md as Option A (assert the 307 to /login with maxRedirects: 0; proxy neuter), implemented in plan 03. Q2 (discovery-prefs-isolation anon-key guard) is out of scope and left to reviewers.

1. **How is the unauthenticated PUT arm repaired, given the proxy intercepts it?** (founder decision; deviates from the locked CONTEXT wording "the unauthenticated PUT 401" and its "neuter the route's auth check" proof step)
   - What we know: a cookie-less PUT gets `307 /login` from `src/proxy.ts` (verified); the route's 401 is unit-tested only.
   - What's unclear: whether the founder wants the e2e arm to prove the proxy gate or the route guard.
   - Options (spec-file-only, per CONTEXT):
     - **A (recommended).** `request.put(..., { maxRedirects: 0 })` and assert `status === 307` and `location` path `/login`: "an anonymous caller is bounced before any work". Neuter proof: a byte-backed copy of `src/proxy.ts` with `/api/watchlist` added to `PUBLIC_ROUTES` makes the request reach the route (401), so the arm goes red naming itself; the route guard's own proof stays `route.test.ts` (neuter its `if (!user)` and see that test red). Cheap, deterministic, honest about what e2e can observe.
     - **B.** Sign in as a seeded user, revoke the session server-side, then PUT with the stale-but-unexpired cookie so the proxy's cookie-only gate passes and the route's `getUser()` answers 401; neuter the route check to prove it. Faithful to "route returns 401" but depends on cookie naming/encoding and refresh behavior (A5); materially more code and flake risk.
   - Recommendation: A, taken to the founder as one AskUserQuestion before the DBACC-06 plan locks, because it changes what the arm proves.

2. **Should the spec's second `anonKey`-style guard in `e2e/discovery-prefs-isolation.spec.ts` (already seeded, same pattern per its header comment) be fixed here?** Out of scope for DBACC-06 as written; reviewers may book it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node / npm / npx | tsc, vitest, Playwright | yes | node 25.8.1 | n/a |
| Playwright chromium | spec run | yes (cache present) | chromium-1248 | `npx playwright install chromium` |
| Docker daemon | local-stack lane | **no (daemon not reachable at research time)** | n/a | start Docker Desktop for the DBACC-06 proof; stop and clean after (founder rule) |
| Supabase CLI | lane | yes | 2.84.2 (CI pins 2.98.2) | record the skew in the SUMMARY |
| psql | baseline load, policy snapshot | yes | installed | none needed |

**Missing dependencies with no fallback:** none, but DBACC-06's lane run is blocked until Docker is started; the DBACC-04 and DBACC-05 proofs need no Docker.
**Missing with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 5.0.5 (unit/census), `tsc --noEmit` (type gate), Playwright (e2e-seeded) |
| Config file | `vitest.config.ts`, `tsconfig.json`, `playwright.config.ts` |
| Quick run command | `npx vitest run src/__tests__/audit-coverage.test.ts src/__tests__/e2e-seeded-hydration-guard.test.ts src/__tests__/manager-keys-e2e-wiring.test.ts` |
| Full suite command | `npm run typecheck && npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? | Failing direction (PROOF-01) |
|--------|----------|-----------|-------------------|-------------|------------------------------|
| DBACC-04 | `Strategy` read without `api_key_id` does not compile | type-level | `npx tsc --noEmit` (about 100 s; `--incremental false` locally) | new type test file, Wave 0 | Neuter `types.ts` `api_key_id: string \| null;` -> `api_key_id?: string \| null;`: `TS2578 Unused '@ts-expect-error'` on the first arm line, then `TS2322` on the owner arm. Restore with `cp` + `cmp`. |
| DBACC-04 | Public readers still project the key-free list | census | `npx vitest run src/lib/anon-strategies-projection.test.ts` | exists | Unchanged by this phase; must stay green. |
| DBACC-05 | Every mutation site emits or carries a pragma; allowlist ends at 0 | vitest | `npx vitest run src/__tests__/audit-coverage.test.ts` (about 1.5 s) | exists (edit) | Remove one new pragma (or move it out of the 8-line window): `Found 1 uninstrumented mutation(s) NOT in the H-0001 allowlist: <file>:<line> > <snippet>`. Other direction: add a pragma and leave its entry: `N H-0001 allowlist entr(y/ies) are no longer uncovered`. |
| DBACC-05 | Source-reading tests tolerate the inserted comments | vitest sweep | the 34-file list in the DBACC-05 prototype (about 2 min), or full suite | exist | n/a (regression sweep; was green) |
| DBACC-06 | Spec is in the seeded list and bound to the hydration guard | vitest | `npx vitest run src/__tests__/e2e-seeded-hydration-guard.test.ts` | exists (edit pin 26 -> 27) | Drop the spec from `ci.yml` -> count pin red; revert the import to `@playwright/test` -> `every seeded spec binds test from the hydration guard` red. |
| DBACC-06 | Wiring cannot silently weaken | vitest | `npx vitest run src/__tests__/<new watchlist wiring pin>.test.ts` | new, Wave 0 | Remove the list entry, add it to the advisory list, restore `if (anonKey)`, or add `test.skip(true` to the spec: each is a named red. |
| DBACC-06 | user-B cannot read user-A's favorites | Playwright on the lane | `CI=true npx playwright test e2e/discovery-watchlist.spec.ts --timeout 60000` | exists (edit) | Neuter `ALTER POLICY "users see own favorites" ON public.user_favorites USING (true)`: test 3 red, first message `... RLS LEAK on migration 024 policy`. Restore, snapshot `cmp`, green with 0 skipped. |
| DBACC-06 | Anonymous PUT is rejected | Playwright on the lane | same command | exists (edit per Open Question 1) | Option A: byte-backed `src/proxy.ts` with `/api/watchlist` added to `PUBLIC_ROUTES` -> arm red. Route guard: `route.test.ts` with its `if (!user)` neutered -> red. |
| DBACC-06 | Anon `/browse/[slug]` hides watchlist chrome | Playwright | same command | exists | No seed needed; neuter by passing `userId` on the public page is out of scope; the arm is run green and recorded. |

### Sampling Rate
- **Per task commit:** the quick run command above plus the touched file's own test.
- **Per wave merge:** `npm run typecheck` and the vitest sweep for the touched files.
- **Phase gate:** `npm run typecheck`, full `npx vitest run`, `npm run lint`, and the recorded lane run, before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/__tests__/<api-key-id type test>.test.ts` - covers DBACC-04 (sample above).
- [ ] `src/__tests__/<discovery-watchlist wiring pin>.test.ts` - covers DBACC-06.
- [ ] A lane boot and an as-is spec run (the first DBACC-06 task) to measure spec rot before wiring.
- Framework install: none.

## Security Domain

`security_enforcement` is absent in `.planning/config.json`, so it is enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (anonymous PUT rejection) | `src/proxy.ts` session gate plus the route's `getUser()` check |
| V3 Session Management | marginal | cookie-only `getSession` in the proxy vs `getUser()` in the route (Option B depends on this gap) |
| V4 Access Control | yes | Postgres RLS "users see own favorites"; owner/public row typing so owner reads cannot silently drop `api_key_id` |
| V5 Input Validation | no change | route already validates `action` and `isUuid(strategyId)` |
| V6 Cryptography | no | none touched |
| V7 Logging / Audit | yes | audit-coverage gate; five founder-owned exemptions recorded by dated pragmas |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|----------|---------------------|
| A leaked `api_key_id` via a public projection | Information disclosure | `STRATEGY_PUBLIC_COLUMNS` omits it; `PublicStrategy` omits it at the type level; the live anon probe stays the behavioural backstop |
| Cross-user read of `user_favorites` | Information disclosure | RLS `auth.uid() = user_id`; the e2e bare-SELECT arm |
| Unaudited admin/internal writes | Repudiation | audit rows, or a dated founder exemption pragma (reversal is costly and the founder's) |

## Sources

### Primary (HIGH confidence, files read and commands run this session)
- `src/__tests__/audit-coverage.test.ts` (`isCovered`, `findMutations`, `H_0001_UNCOVERED_ALLOWLIST`, the final `describe`)
- `src/proxy.ts` (`PUBLIC_ROUTES`, the session gate) and the `proxy()` probe
- `src/lib/types.ts` (`Strategy`), `src/lib/queries.ts` (`getFactsheetDetail`, `getStrategiesByCategory`, `getMyStrategies`, `shapeRankingRows`, `RankedStrategyRow`), `src/components/strategy/StrategyTable.tsx`, `StrategyGrid.tsx`
- `.github/workflows/ci.yml` (`e2e-seeded` job, seeded step, lane handoff step, `frontend-typecheck`)
- `e2e/discovery-watchlist.spec.ts`, `e2e/helpers/*`, `playwright.config.ts`, `scripts/local-stack/run.sh` header
- `supabase/schema/baseline.sql` (`user_favorites` policies and grants)
- `src/__tests__/e2e-seeded-hydration-guard.test.ts`, `manager-keys-e2e-wiring.test.ts`, `contracts/spec-disabling.invariant.test.ts`
- Runs: `tsc --noEmit` (baseline, required-only, full prototype, neutered), `vitest` (audit-coverage baseline/prototype/neuter; 34-file and 309-file sweeps). Every edited file was restored from a byte copy and compared with `cmp`; `git status` was clean afterwards.

### Secondary / Tertiary
- None. No web sources were needed; all claims are in-repo.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no new packages)
- Architecture: HIGH for DBACC-04/05 (prototyped); MEDIUM for DBACC-06 (no Playwright run)
- Pitfalls: HIGH

**Research date:** 2026-11-26
**Valid until:** about 7 days, or until `src/proxy.ts`, `types.ts`, the audit gate or the `e2e-seeded` job change. Re-measure the line anchors at the executing HEAD.
