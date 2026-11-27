# Phase 244: ACCESSGUARDS - Pattern Map

**Mapped:** 2026-11-26
**Files analyzed:** 14 (2 new test files, 12 modified)
**Analogs found:** 14 / 14 (all git-tracked; verified with `git ls-files`)

Prototypes (type test body, pragma text, allowlist-at-zero, policy snapshot/neuter/restore, the `Omit` diff) live in `244-RESEARCH.md`; this file points at them and only adds the real-codebase analog excerpts. Anchors are by symbol; line numbers are HEAD (`7b31cdc4b` base of this worktree) and may drift.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/__tests__/api-key-id-compile-guard.test.ts` (NEW, name free) | test (type-level) | transform (tsc gate) | `src/__tests__/audit-event-union-types.test.ts` | exact |
| `src/lib/types.ts` (`Strategy.api_key_id` required, `PublicStrategy`) | model/type | transform | same file, `Strategy` interface | self |
| `src/lib/queries.ts` (`PublicRankedStrategyRow`, two reader retypes) | service | request-response | same file, `RankedStrategyRow` + readers | self |
| `src/components/strategy/StrategyTable.tsx`, `StrategyGrid.tsx` | component | transform | each other (identical local `StrategyWithAnalytics` edit) | self |
| `src/app/api/admin/partner-import/route.ts` | route | CRUD (write) | `finalize-wizard/route.ts` ~:1368 in-window pragma | exact |
| `src/app/api/cron/flag-monitor/route.ts` | route (cron) | event-driven | same pragma idiom | exact |
| `src/app/api/keys/sync/route.ts` | route | CRUD | same pragma idiom | exact |
| `src/app/api/strategies/finalize-wizard/route.ts` | route | CRUD | its own existing pragma ~:1368 | exact |
| `src/__tests__/audit-coverage.test.ts` | test (gate) | batch (source scan) | self (`H_0001_UNCOVERED_ALLOWLIST`) | self |
| `e2e/discovery-watchlist.spec.ts` | test (e2e) | request-response | `e2e/manager-keys.spec.ts` (hydration-guard import) | role-match |
| `.github/workflows/ci.yml` (`e2e-seeded` list) | config | n/a | adjacent `e2e/manager-keys.spec.ts \` entry | exact |
| `src/__tests__/e2e-seeded-hydration-guard.test.ts` | test (census) | transform | self (`SEEDED_SPEC_COUNT`) | self |
| `src/__tests__/discovery-watchlist-e2e-wiring.test.ts` (NEW, name free) | test (wiring pin) | transform | `src/__tests__/manager-keys-e2e-wiring.test.ts` | exact |
| `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` | ledger | n/a | ship only | n/a |

## Pattern Assignments

### `src/__tests__/api-key-id-compile-guard.test.ts` (test, type-level)

**Analog:** `src/__tests__/audit-event-union-types.test.ts` (113 lines). Full test body is prototyped in RESEARCH "Type test"; copy it.

**Header-prose pattern to copy** (lines 1-17): explains that the tests assert TYPES, that the `@ts-expect-error` lines FLIP and `tsc --noEmit` fails with "Unused '@ts-expect-error' directive", that `frontend-typecheck` is the gate and vitest cannot surface it, and that the single live `it()` is a smoke check. Add the honest limit (RESEARCH "Residual loopholes": structural `{ api_key_id?: ... }` helpers and select strings are invisible to the guard).

**Never-invoked function + single-line literal rule** (lines 34-47):
```typescript
// All type-level assertions live inside this never-invoked function — only its
// TS body is type-checked. (Mirrors src/__tests__/seed-demo-data-types.test.ts.)
// NOTE: the mis-pairing (`@ts-expect-error`) cases are written as SINGLE-LINE
// ... Single-line keeps the error on the one line the directive guards.
function _typeAssertions(): void {
  // @ts-expect-error - role.grant must pair with user_app_role, not user
  const badGrant: AuditEvent = { action: "role.grant", entity_type: "user", entity_id: "x" };
  void badGrant;
}
```
Keep each `@ts-expect-error` directly above a single-line statement. Add the `getMyStrategies` owner arm (RESEARCH A4, unverified: planner's tsc loop confirms). Run `npx tsc --noEmit --incremental false` (~100 s) for RED/GREEN; the PROOF-01 neuter is `types.ts` `api_key_id: string | null;` -> `api_key_id?: string | null;` with `cp` backup + `cmp`.

### `src/lib/types.ts` and `src/lib/queries.ts` (types)

**Current code to edit** (`types.ts` ~:158-161):
```typescript
  category_id: string | null;
  // Optional: anon-safe projections (STRATEGY_PUBLIC_COLUMNS) omit it.
  api_key_id?: string | null;
  name: string;
```
Follow the RESEARCH diff verbatim (`api_key_id: string | null;`, `export type PublicStrategy = Omit<Strategy, "api_key_id">;`, `PublicRankedStrategyRow = Omit<RankedStrategyRow, "api_key_id">` beside `RankedStrategyRow` at `queries.ts` ~:177, `getStrategiesByCategory` return type, `getFactsheetDetail` `.single<PublicStrategy & {...}>()` and return type). Keep `RankedStrategyRow` as the owner type. Update the stale "Optional: anon-safe" comment. Do not cast public rows to `Strategy` (RESEARCH anti-pattern).

### `StrategyTable.tsx` / `StrategyGrid.tsx` (component)

One-line edit each (RESEARCH diff): import `PublicStrategy` instead of `Strategy`; `type StrategyWithAnalytics = PublicStrategy & { api_key_id?: string | null } & {`. `api_key_id?` must stay optional here: `StrategyTable`'s name cell reads `s.trust_tier === "api_verified" || s.api_key_id` on both surfaces. Not-optional-by-accident: `StrategyForm`, the edit page and `strategies/page.tsx` type as `Strategy` and need no edit. Public-page call sites that bite without the relaxation: `src/app/(dashboard)/discovery/[slug]/page.tsx`, `src/app/browse/[slug]/page.tsx`, `StrategyTable.stale-analytics.test.tsx` (RESEARCH measured). Final check is `npx tsc --noEmit` 0 errors.

### Route pragmas: `partner-import`, `flag-monitor`, `keys/sync`, `finalize-wizard` (route, write)

**Analog:** the in-window pragma at `src/app/api/strategies/finalize-wizard/route.ts` ~:1362-1373 (and 73 others under `src/app/api`):
```typescript
    // ⛔ THE PRAGMA BELOW MUST STAY WITHIN 8 LINES OF THE MUTATION —
    // `audit-coverage.test.ts` scans that window, so prose inserted BETWEEN them
    // silently un-instruments the site (measured: this note, on its first
    // placement). New commentary goes ABOVE this line, never below it.
    //
    // @audit-skip: non-security annualization metadata ...
    // traditional) written as part of the already-audited strategy finalization;
    // a dedicated audit event would be noise (mirrors the last_sync_at skip below).
    const { error: assetClassErr } = await supabase
      .from("strategies")
```
**Rule (read from `isCovered`):** token `@audit-skip:` must be on a line in `[chainStart-8, chainStart-1]`, where `chainStart` is the `.from(` line (all six sites are single-line `await x.from("t").upsert(`). Put the pragma (1-2 lines) DIRECTLY above the statement. Text and the six-site table (symbol, snippet, placement) are in RESEARCH "Site anchors" and "Pragma placement"; exemption wording is fixed by CONTEXT: cite "founder exemption 2026-11-26 (Phase 244 DBACC-05)" and name the class (internal cron counter / derived strategy_analytics compute state).

**Site 1 specifics (partner-import ~:692-707):** the existing 4-line pragma (`// @audit-skip: bulk-import row; rolled up into a single admin.partner_import audit event ...`) sits 15 lines above `const { error: profileErr } = await admin.from("profiles").upsert(` with the P325 comment block and `const managerDisplayName = validateDisplayName(...)` between. MOVE the 4-line block to directly above the `profileErr` statement (after `managerDisplayName`); do not duplicate it. Reason it cannot be a real emit match: the gate's audit-call regex is `/logAuditEvent(AsUser)?\s*\(/`, which `emitAsUser(` does not match.

### `src/__tests__/audit-coverage.test.ts` (test gate, edit)

Edit symbols (HEAD lines): `H_0001_UNCOVERED_ALLOWLIST` (:1703, six entries `{file, snippet, reason}`), `expect(H_0001_UNCOVERED_ALLOWLIST).toHaveLength(6);` (:1880), stale prose at :1411-1413, :1671, :1684 and the comment before `toHaveLength` ("must match the SUMMARY and TODOS entry").

**Discharge arm that forces same-commit entry deletion** (:1858-1875): throws `N H-0001 allowlist entr(y/ies) are no longer uncovered ... DELETE those entries ... and lower the count assertion below.` **New-site arm** (:1838-1856) throws `Found N uninstrumented mutation(s) NOT in the H-0001 allowlist:` with `<file>:<line>\n    > <snippet>`: this is the PROOF-01 RED message.

Target end state is in RESEARCH "Allowlist at zero": keep the typed empty array (do NOT delete the const), `toHaveLength(0)`, reword the four TODOS-pointing comments, record closure date 2026-11-26 and per-site disposition in the header block. Plan split A (site 1: 6 -> 5) then B (sites 2-6: 5 -> 0) is serial; both edit this file.

### `e2e/discovery-watchlist.spec.ts` (e2e, edit)

**Analog for the import swap:** `e2e/manager-keys.spec.ts` and every other seeded spec bind `test` from the guard. Replace line `import { test, expect } from "@playwright/test";` (spec ~:33) with:
```typescript
import { test, expect } from "./helpers/hydration-guard";
```
(`e2e/helpers/hydration-guard.ts` is tracked and does `export * from "@playwright/test"` plus a guarded `test`.)

**Silent-skip site to repair** (~:376-377):
```typescript
    const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
    if (anonKey) {
      const userBClient = createClient(url, anonKey, {
```
Replace the `if (anonKey) {` wrapper with `expect(anonKey, "TEST_SUPABASE_ANON_KEY missing - the primary RLS proof cannot run").toBeTruthy();` and de-indent/close the block. Keep `RLS LEAK on migration 024 policy` message verbatim (PROOF-01 names it). Keep `test.skip(!HAS_SEED_ENV, ...)` (MA-8 place 2).

**401 arm (founder-decided Option A, CONTEXT):** `request.put(url, { ..., maxRedirects: 0 })`, assert `status() === 307` and the `location` path is `/login`. No in-repo analog for `maxRedirects: 0` was needed; use the existing test body's request shape. PROOF-01 neuter: byte-backed `src/proxy.ts` copy with `/api/watchlist` added to `PUBLIC_ROUTES` (line 19). Also update the stale header bullet "(a) unauthenticated PUT returns 401" and the "`test.skip`'d when ... env is missing" prose only if wording would mislead; spec-local edits only.

### `.github/workflows/ci.yml` (config)

**Analog/placement:** the `else` arm of step `- name: Run seed-gated specs (MA-8 / BLOCK-3)` (:7081); list ends at :7165-7167:
```yaml
              e2e/role-home.spec.ts \
              e2e/manager-keys.spec.ts \
              --timeout 60000
          fi
```
Insert `              e2e/discovery-watchlist.spec.ts \` before `e2e/manager-keys.spec.ts \`, never after `--timeout`, and never in the advisory `e2e` job list (the line naming `e2e/smoke.spec.ts`). Optionally add a dated comment in the comment block below `fi` in the existing "place 1 / place 2" form (e.g. "Phase 199 plan 17 (ROUTE-01): ... its HAS_SEED_ENV skip is place 2"). Do not name any `TEST_SUPABASE_*`/`NEXT_PUBLIC_SUPABASE_*` var in a step `env:` (RESEARCH Pitfall 6).

### `src/__tests__/e2e-seeded-hydration-guard.test.ts` (census, edit)

Change `const SEEDED_SPEC_COUNT = 26;` (:45) to 27 and extend the dated PIN comment above it, which currently ends "... 25 -> 26 on 2026-11-14 when Phase 214 SC-5 added e2e/freshness-chip-width.spec.ts. Update this pin TOGETHER with the CI list." Add "26 -> 27 on 2026-11-26 when Phase 244 DBACC-06 added e2e/discovery-watchlist.spec.ts". The "every seeded spec binds `test` from the hydration guard" arm then covers the spec's import swap automatically.

### `src/__tests__/discovery-watchlist-e2e-wiring.test.ts` (NEW wiring pin)

**Analog:** `src/__tests__/manager-keys-e2e-wiring.test.ts` (165 lines). Copy the parser helpers locally (do not import a test file):

**Imports + constants** (lines 28-38):
```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = resolve(__dirname, "..", "..");
const CI_WORKFLOW = ".github/workflows/ci.yml";
const SPEC = "e2e/manager-keys.spec.ts";   // -> "e2e/discovery-watchlist.spec.ts"
const SEEDED_STEP_NAME = "- name: Run seed-gated specs (MA-8 / BLOCK-3)";
const ADVISORY_ANCHOR = "e2e/smoke.spec.ts";
```
**Parser helpers to copy** (lines 40-69): `readRepoFile`, `codeLines`, `seededStep`, `seededElseArm`, `parseSeededSpecs`.

**Membership + non-empty-parse arm** (lines 75-87) and **advisory-exclusion arm** (lines 128-143): copy as-is with the new `SPEC`.

**Do NOT copy** the step-tolerance arm (lines 89-126): `manager-keys-e2e-wiring.test.ts` already pins that shared step. **Do NOT copy** the spec arm's `/\.skip\(/` and `/process\.env/` needles (lines 150): the kept `HAS_SEED_ENV` skip and `process.env.TEST_SUPABASE_*` reads would violate them. Per RESEARCH: comment-strip the spec, assert no `.fixme(`/`.only(`/`test.skip(true`, exactly one skip `test.skip(!HAS_SEED_ENV`, no match of `/if\s*\(\s*anonKey\s*\)/`, and anchors present: `RLS LEAK on migration 024 policy`, `signInWithPassword(`, `.from("user_favorites")`, `maxRedirects: 0`. Write the header in the same "WHY THIS FILE EXISTS / pins N ways it can stop meaning anything" form. Needle spellings that contain a disabled-spec token must be written with an escaped dot (see comment at line 147-149) so `contracts/spec-disabling.invariant.test.ts` stays green.

## Shared Patterns

### PROOF-01 neuter / restore (applies to every gate)
Byte backup then `cp` back and `cmp` (never `git checkout/restore/stash` on uncommitted work); record RED message verbatim then GREEN in the plan SUMMARY.
- DBACC-04: neuter `types.ts` field; first RED is `TS2578 Unused '@ts-expect-error' directive` at the first arm, then `TS2322` at the owner arm.
- DBACC-05: remove one new pragma; RED text `Found 1 uninstrumented mutation(s) NOT in the H-0001 allowlist:` + `<file>:<line> > <snippet>`.
- DBACC-06: lane-only policy neuter via `ALTER POLICY "users see own favorites" ON public.user_favorites USING (true);`, `pg_policy` snapshot before/after and `cmp`; proxy `PUBLIC_ROUTES` neuter for the 307 arm.

### Pragma window law
`@audit-skip:` in `[chainStart-8, chainStart-1]` raw lines, directly above the statement; new prose goes ABOVE the pragma, never between pragma and statement (the finalize-wizard ~:1362 note records this failure).

### Seeded-spec MA-8 two-place contract
Place 1 = listed in the `e2e-seeded` `else` arm; place 2 = the spec's `HAS_SEED_ENV` skip. Spec binds `test` from `./helpers/hydration-guard`.

### Planning-artifact hygiene
Plans/SUMMARYs are tracked in a public repo: no home paths, PROD ids, scratch paths. Run `npx tsx scripts/check-planning-hygiene.ts`. Never write the CI skip tokens in a commit or PR body. `plan-anchor-verify` re-resolves `file:line` anchors in pending PLAN.md: cite edited files by symbol.

### Ship ledger
Delete closed TODOS entries (`170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD`, `[H-0001]`, the `[158-OPS-03] discovery-watchlist.spec.ts` bullet only) in the ship PR and name them in the CHANGELOG entry; VERSION and package.json byte-equal 4-digit strings.

## No Analog Found

None. Closest to "no analog" is the `maxRedirects: 0` 307 assertion in the spec (no existing spec asserts a redirect that way); the planner should use the Playwright `APIRequestContext` option as RESEARCH Open Question 1 Option A describes, and the first lane run measures the actual response.

## Metadata

**Analog search scope:** `src/__tests__/`, `src/app/api/**/route.ts`, `src/lib/{types,queries}.ts`, `src/components/strategy/`, `e2e/`, `.github/workflows/ci.yml`
**Files read this pass:** audit-event-union-types.test.ts (head), manager-keys-e2e-wiring.test.ts (full), audit-coverage.test.ts (allowlist and gate arms), ci.yml e2e-seeded list, partner-import and finalize-wizard pragma regions, spec head and RLS arm
**Pattern extraction date:** 2026-11-26
