# Phase 235: HOLDINGSTRUTH - Research

**Researched:** 2026-11-26
**Domain:** TypeScript identity readers (Holdings, Exposure, scenario commit), the Python matcher's native-unpriced marker, the My-allocation payload and its two degrade surfaces, the missing-data message.
**Confidence:** HIGH (every finding below was read in this worktree or probed by a targeted run; assumptions are listed in the Assumptions Log)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**HOLD-01 identity completeness**
- The fail-loud point is the identity mapping itself: `keyAccountOf` returns a function that THROWS a named error class for a key id absent from the `keys` it was built from. A key that IS in `keys` but that the identity does not group keeps its own token (`key:<id>`); that is legitimate and unchanged.
- `fetchHoldings` (portfolio-exposure.ts) propagates the throw, like its other fail-loud paths (identity read error, row cap): the series read fails rather than yielding a double-counted series.
- The dollar callers that take `fetchLatestHoldingsPerKey`'s `accountByKey` (`derivePhase07Fields` in `src/lib/queries.ts`, the scenario commit route) stop falling back to `?? keyId` for a counted row whose key `accountByKey` does not carry; they throw the same named error. The commit route already turns a throw in that block into `holdingsLookupErr` (lookup_failed, no failed commit) and that stays.
- A test per reader: `fetchHoldings` with a row whose key is absent from the identity read throws; the per-key dollar path with a row whose key is absent from `accountByKey` throws. Each goes RED on pre-fix code (PROOF-01).

**HOLD-02 match marker per account**
- The matcher treats a key's marker day as that key's READING day when it is after the key's newest rows (exactly the TS reader's rule in `fetchLatestHoldingsPerKey`: `{day: unpricedAsof, hasRows: false}`), and an account's newest day is the maximum over its keys' reading days. So when key A carries a marker for day D and key B's newest rows are D-1, B's rows stop counting, as on Holdings.
- The marker read covers every one of the owner's keys (from `key_rows`), not only keys that have holdings rows, because a key with no rows and a marker still sets its account's day in the TS reader.
- A failed marker read keeps today's behaviour (logged at ERROR, rows kept): the scorer is request-time and persists nothing.
- One shared case (fixture consumed by both the TS reader test and the match test) proves the two runtimes agree on the A-marker / B-older case.

**HOLD-04 dashboard marker-read failure**
- `getMyAllocationDashboard` reports a non-null `markerReadError` to Sentry (`captureToSentry`, level warning, an `area` tag, the supabase message in `extra`, user id; no raw key ids beyond what existing captures carry) and carries a boolean degraded flag in the payload.
- The rows are KEPT (the marker read failing must not blank Holdings, as the reader's own comment requires) and the note says the latest figures may include an account whose newest day could not be priced-checked. "Stale rows are never shown silently" is met by the note, not by hiding rows.
- The note is a new `degrade-warnings.ts` registry entry rendered through `DegradeLine`, shown wherever the Holdings / live total reads the affected rows (exact mount points and copy at planning, per DESIGN.md Voice).

**HOLD-05 every failing shared-account key named**
- `key-data-gaps.ts` (`deriveKeyDataGapsField` path) emits the attributed key ids for the `shared_account_failing` cause (every key of each all-failing group, whether or not its tail has a range), and the payload carries them to `missingDataLines`.
- `missingDataLines` applies the R3-01 rule to `shared_account_failing` as it does to `not_syncing`: the book-level fallback stays unless every attributed key is in a printed line.
- CORRECTED 2026-11-26 (UI-SPEC check, before planning): 'covered (named, or the fallback prints)' was weaker than ROADMAP SC-4 and REQUIREMENTS HOLD-05, which say every failing key is NAMED. The requirement governs (it is the more authoritative source; CLAUDE.md Rule 7). Every attributed `shared_account_failing` key must appear BY LABEL in a printed line. A key that no dated gap line names (its account's history reaches yesterday, so no tail range) is named in a labelled line of its own that states no day (no invented date, no 'no complete history yet' claim). That line is a new `degrade-warnings.ts` registry entry; its copy is Claude's discretion in DESIGN.md Voice (no founder channel in this run), modelled on the shipped `allocation.key-gap.shared-account-failing` sentence minus its coverage clause. The unnamed book-level fallback then stays only for a key the owner's list cannot label (review SFH-4 behaviour unchanged).
- The RED fixture is the two-account case from UI-SPEC S3 (two all-failing shared accounts, one with a tail gap, one whose history reaches yesterday): it fails on pre-fix code. The TODOS entry's literal two-key case passes at HEAD and is kept as a GREEN-only regression.

**Decided autonomously (CONTEXT)**
- [HOLD-01] In `keyAccountOf`, plus strict `accountByKey` lookups in the two dollar callers.
- [HOLD-01] No extra query for holdings rows of keys outside the identity read; the per-key reader reads rows per identity key, so such a row is never counted; the strict `accountByKey` lookup covers the counted path.
- [HOLD-02] Marker as a reading day, account newest = max over keys (the TS reader's rule); one function in match.py.
- [HOLD-02] A JSON fixture under `analytics-service/tests/fixtures` replayed by a TS test and a pytest, like `one_key_per_account_day_cases.json`.
- [HOLD-04] Sentry `warning` with an `area` tag, like the scenario commit route's capture of the same condition.
- [HOLD-05] An extra payload field next to the gaps (or on the reason), server-built, owner ids only.

### Claude's Discretion
- HOLD-04 note wording and placement, within DESIGN.md Voice and the degrade registry's conventions. Founder may override at review.
- Plan split and wave layout.

### Deferred Ideas (OUT OF SCOPE)
None. Out of scope per CONTEXT domain: the HOLD-03 writer-basis gate (Phase 229), any migration, the `commit_scenario_batch` SQL twin, Phase 225 plan 225-21, Phase 228.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HOLD-01 | A Holdings row whose key is missing from the identity read fails loud; it never counts as an account of its own. | Section "HOLD-01": `keyAccountOf` strictness via `identity.has`, strict `accountByKey` lookups at `queries.ts` and `route.ts`, the seven fixture tests that must move, the test seams for each reader. |
| HOLD-02 | Match scoring applies the native-unpriced marker per account, so for a multi-key account match AUM equals what Holdings reports. | Section "HOLD-02": exact current logic, measured divergence (700 vs 0), design, fixture and replay plan, mypy command. |
| HOLD-04 | When the dashboard's marker read fails, the page shows a note and a Sentry event fires; stale rows are never shown silently. | Section "HOLD-04": payload plumbing, capture convention and throttle precedent, registry entry, mount points, the harness gap, every census moved. |
| HOLD-05 | Every failing key of a shared account is named in the missing-data message, even when another key with the same cause already prints a line. | Section "HOLD-05": producer sibling export, grouped payload field, `missingDataLines` rule, new undated registry entry with concrete copy, S3 probe result. |
</phase_requirements>

## Summary

All four requirements are small, local edits with one large blast radius: the test fixtures and the censuses that read the touched files. HOLD-01 is a throw in an identity closure plus two strict lookups. It breaks nothing else when `keyAccountOf` goes strict, but making the `derivePhase07Fields` lookup strict breaks **seven existing fixture tests in two files**, because the function documents a default `accountByKey = {}` that "counts every key". The planner must rewrite those seven fixtures to pass an explicit identity map. HOLD-02 is one function in `analytics-service/routers/match.py`. Measured at HEAD, the matcher counts the older key of an account when the other key carries a newer marker (AUM 700.0, where Holdings reads 0). The same holds when the marker key has no rows at all. HOLD-04 needs a boolean on both return literals of `getMyAllocationDashboard`, one registry entry, two inline `<p>` mounts, and three moved ledger rows. The `queries.my-allocation` test harness cannot fail only the marker read today, which is a Wave 0 gap. HOLD-05 needs a sibling export from `key-data-gaps.ts` (the existing `keyDataGaps()` return is asserted with whole-array `toEqual`, so its shape must not change), a **grouped** payload field (a flat id list cannot say "one of these keys" per account), and one new undated registry entry.

Verified by probe in this session (all restored byte-equal, worktree clean after each): the UI-SPEC S3 claim holds. The two-key literal prints the book fallback at HEAD (so it passes today). The two-account fixture prints only account one's dated line and leaves B1 and B2 unnamed with no fallback.

**Primary recommendation:** Three waves. Wave 1: HOLD-01 and HOLD-02 in parallel (disjoint files). Wave 2: HOLD-04 (it owns the registry, scan-ledger and payload-literal edits first). Wave 3: HOLD-05 (same shared files, so it follows). Each requirement's RED/restore proof is recorded in its plan's SUMMARY.

## Project Constraints (from CLAUDE.md)

- `[VERIFIED: CLAUDE.md "TODOS.md holds open work only"]` Ship deletes the four closed `TODOS.md` entries in the same PR and names them in the CHANGELOG entry. LOW/Info review survivors are not booked.
- `[VERIFIED: CLAUDE.md "CHANGELOG discipline"]` Every ship writes a CHANGELOG entry plus a 4-digit VERSION bump, in the same commit (`chore(release)` shape). Never write the CI skip tokens, even in a denial. Never run `npm version`.
- `[VERIFIED: CLAUDE.md "CI gate integrity"]` Count checks bound to the head SHA, not "no red".
- `[VERIFIED: ~/.claude memory "ship-planning-guard"]` A ship branch must change nothing under `.planning` (check before push).
- `[VERIFIED: AGENTS.md]` This Next.js has breaking changes: read the relevant guide in `node_modules/next/dist/docs/` before writing code. This phase edits no Next API (no routes, no `after()` usage added), but the HOLD-04 capture reuses the existing `after()` wrapper `scheduleDerivedRowCapture`.
- `[VERIFIED: CLAUDE.md "Design System"]` Read DESIGN.md before visual decisions. The UI-SPEC already did; do not deviate.
- Founder memory (applies to the plan briefs): always `grep -a`; pytest only from `analytics-service/` with its `.venv`; "Agent gates include mypy"; data-integrity and user-facing gates must be shown RED (neuter, restore from a byte backup with `cp` + `cmp`, never `git checkout`/`stash` on uncommitted work); no AI attribution trailers; no config/secret/home paths in tracked text.
- No package is installed or added by this phase. No `npm`/`pip` dependency change, so no Package Legitimacy Audit rows.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Account identity completeness (throw on absent key) | API / Backend (server TS: `latest-holdings-per-key.ts`, `portfolio-exposure.ts`) | — | Pure server reads under owner RLS; the throw reaches the route's `error.tsx`. |
| Dollar-caller strictness (`derivePhase07Fields`, commit route) | API / Backend | — | Server payload build and a route handler. |
| Matcher marker per account | API / Backend (Python analytics service) | — | Request-time scorer; persists nothing. |
| Marker-read failure capture + flag | Frontend Server (SSR: `getMyAllocationDashboard` runs in a Server Component) | — | Capture and boolean are computed in the RSC read, never on the client. |
| Unpriced-check note | Browser / Client (render of a boolean) | Frontend Server (payload) | Pure render from a server-built flag; no client clock, no client-side suppression. |
| Attributed-key groups for shared-account failing | Frontend Server (`deriveKeyDataGapsField`, owner ids only) | Browser (`missingDataLines` joins labels) | Account identity stays on the server (T-186-18); the browser only maps owner ids to owner labels. |

## Standard Stack

No new libraries. Everything uses what the repo already has. `[VERIFIED: package.json scripts]` vitest (`npm test` is `vitest run`), `tsc --noEmit` (`typecheck`), eslint; Python 3.12 venv with pytest and mypy under `analytics-service/.venv`.

| Tool | Use in this phase | Command |
|------|-------------------|---------|
| vitest | TS tests (single file at a time) | `npx vitest run <file>` |
| pytest | match tests (from `analytics-service/` only) | `.venv/bin/python -m pytest tests/<file>.py -q` |
| mypy strict | analytics gate, in every analytics-touching brief | `cd analytics-service && .venv/bin/mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` `[VERIFIED: .github/workflows/ci.yml, step "Type gate - mypy strict over the running-service surface"]` |
| tsc | type gate | `npm run typecheck` |

## Package Legitimacy Audit

None. This phase installs no external package. Banned-package list (CLAUDE.md global) is not touched.

## Architecture Patterns

### System Architecture Diagram

```
HOLD-01/04 (TypeScript, /allocations request)

 page.tsx Promise.all  ──────────────────────────────────────────────────────────────┐
   ├─ getNetExposureSeries / getAllocationSeries ──> fetchHoldings(userId)           │
   │      api_keys (KEY_IDENTITY_COLUMNS) ─> keyAccountOf(keys) ─┐                    │
   │      allocator_holdings pages ─> byDay ─> oneKeyPerAccountDay(rows, accountOf)   │ throw
   │                                      row.api_key_id NOT in keys ─> [HOLD-01] THROW ──┐
   └─ getMyAllocationDashboard(userId)  (React cache, one request)                    │  │
        fetchLatestHoldingsPerKey ─> {data, accountByKey, markerReadError, ...}       │  │
          │  markerReadError != null ─> [HOLD-04] captureToSentry + flag ────────────┼──┼─> payload.holdingsUnpricedCheckFailed
          └─> derivePhase07Fields(..., accountByKey)                                 │  │
                oneKeyPerAccountDay(perKeyRows, accountByKey[keyId] ?? keyId)        │  │
                       key absent ─> [HOLD-01] THROW ────────────────────────────────┼──┘
        deriveKeyDataGapsField ─> keyDataGaps[] + [HOLD-05] sharedAccountFailingGroups┘
 error.tsx ("Something went wrong") <────────── any throw above

 AllocationsTabs ({...payload}) ─> AllocationDashboardV2 (Overview)  ─> GlancePanel, MissingDataMessage, [HOLD-04 note A]
                                └> HoldingsTabPanel (Holdings tab)   ─> Positions header, [HOLD-04 note B]
 scenario commit route ─> fetchLatestHoldingsPerKey(auditEvidence:false) ─> strict lookup in the oneKeyPerAccountDay accountOf
                          └ a throw inside its try ─> holdingsLookupErr ─> _size_source "lookup_failed" (unchanged)

HOLD-02 (Python, request-time scorer)

 _load_holding_portfolio_context(allocator_id)
   api_keys (identity cols) ─> key_rows
   per key: latest asof ─> rows at it
   [HOLD-02] markers for EVERY key_rows id ─> per-key reading day = marker if marker > key's latest asof (no rows), else latest asof
   account newest day = max over its keys' reading days  (account_identity_tokens(key_rows))
   rows counted only when asof == account newest day ─> one_key_per_account_day ─> holdings_map ─> portfolio_aum
```

### Recommended edit map

```
src/lib/latest-holdings-per-key.ts   # HoldingsIdentityError, keyAccountOf strict, strictAccountOf helper
src/lib/portfolio-exposure.ts        # no code change needed (propagates the throw); test only
src/lib/queries.ts                   # strict lookup; payload flag; capture; attributed groups field
src/app/api/allocator/scenario/commit/route.ts   # strict lookup (one line)
analytics-service/routers/match.py   # Step 1/1b/2
src/app/(dashboard)/allocations/lib/key-data-gaps.ts            # sibling export
src/app/(dashboard)/allocations/components/MissingDataMessage.tsx
src/app/(dashboard)/allocations/AllocationDashboardV2.tsx       # note A + new missingDataLines arg
src/app/(dashboard)/allocations/HoldingsTabPanel.tsx            # note B
src/lib/degrade-warnings.ts          # two new entries
```

### Anti-Patterns to Avoid

- **Throwing from `fetchLatestHoldingsPerKey`.** It documents "Never throws" and returns `error` instead. The `keyAccountOf` throw is unreachable from it (it only passes ids taken from `keys`). Do not add a throw there, and do not add a query for out-of-identity rows (CONTEXT locked "no").
- **Discriminating "absent" by a null token.** `accountIdentityTokens` returns a `Map` entry (possibly `null`) for EVERY key in `keys`. A null value means "in `keys`, unplaceable" (legitimate, keeps `key:<id>`); only a missing Map entry means absent. Use `identity.has(keyId)`.
- **Changing the return shape of `keyDataGaps()`.** `key-data-gaps.test.ts` asserts whole arrays with `toEqual` (for example the group test at the `shared_account_no_working_key` cases). Use a sibling export.
- **Adding a required parameter to `missingDataLines`.** `MissingDataMessage.test.tsx`'s helper `lines()` calls it with five keys and no more; the new argument must be optional or those tests break.
- **Writing `computed_at` / `computedAt` or a `(venue, symbol)` tuple / `f"holding:..."` in the touched files.** Two censuses pin counts for those (see Census table).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Account identity | A second grouping | `accountIdentityTokens` (TS) / `account_identity_tokens` (Python) | One mechanism; twins pinned by fixtures. |
| Day-winner per account | A new tie-break | `oneKeyPerAccountDay` / `one_key_per_account_day` | Shared fixture-pinned rule. |
| Key labels | A label builder | `apiKeyLabelById(apiKeys)` | T-198-17: a raw id never prints. |
| User-facing degrade sentence | JSX copy | A `degrade-warnings.ts` entry rendered by `DegradeLine` | The registry judge, scan ledger and copy census all key on it. |
| Sentry flush | A bare `captureToSentry` call | `scheduleDerivedRowCapture(captureToSentry(...))` | Keeps the capture alive past the response flush (queries.ts). |
| Repeat-capture damping | A new timer | `shouldCaptureDerivedRowRejection` window pattern | Same 30 s poll volume problem, solved by R3-WR-04. |

**Key insight:** every one of these has an existing, tested home. The phase's risk is census and fixture drift, not algorithmic novelty.

## HOLD-01: identity completeness

### Current code `[VERIFIED: src/lib/latest-holdings-per-key.ts:110-129]`

```ts
export function keyAccountOf(
  keys: readonly KeyIdentityRow[],
): (keyId: string) => string {
  const identity = accountIdentityTokens(
    keys.map((k) => ({
      id: k.id,
      ...
  );
  return (keyId: string): string => identity.get(keyId) ?? `key:${keyId}`;
}
```

`accountIdentityTokens` ends with `return new Map(keys.map((k) => [k.id, known.has(k.id) ? \`account:${find(k.id)}\` : null]),` `[VERIFIED: src/lib/departed-history.ts:252-254]`, which is why `identity.has` is the absent-key discriminator.

### Callers (every one)

| Caller | Site | Ids passed | Effect of a strict throw |
|---|---|---|---|
| `fetchLatestHoldingsPerKey` | `latest-holdings-per-key.ts` lines ~513-531, 573 (`accountOf(key.id)`) | only ids from `keys` | Unreachable; contract "Never throws" holds. |
| `fetchHoldings` (not exported) | `portfolio-exposure.ts:320` `keyAccountOf(keys)`, used at `:349` `oneKeyPerAccountDay(byDay.get(asof)!, accountOf)` | every `allocator_holdings.api_key_id` in the 730-day window | Throw rejects `getNetExposureSeries` and `getAllocationSeries`. |
| `derivePhase07Fields` | `queries.ts:5130-5133` `(keyId) => accountByKey[keyId] ?? keyId` | counted rows' `api_key_id` | Throw propagates out of `getMyAllocationDashboard`. |
| scenario commit | `route.ts:880-883` `(keyId) => read.accountByKey[keyId] ?? keyId` | counted rows | Throw is caught by the existing `catch (e)` and becomes `holdingsLookupErr`. |

Out of scope, recorded: `src/components/exchanges/AllocatorExchangeManager.tsx:292` has its own `identity.get(k.id) ?? \`key:${k.id}\``. It groups the manager's own key rows for a display ranking, never a dollar count, so it stays. Python `match.py::_account` has the same fallback, but its rows come from per-key reads over `key_rows`, so an absent key cannot occur there; HOLD-01 is TS only.

Surface of a throw: `page.tsx` awaits `getNetExposureSeries`, `getAllocationSeries` and `getMyAllocationDashboard` in one `Promise.all` with no `try`, and `allocations/error.tsx` exists `[VERIFIED: ls and grep this session; line refs page.tsx:114-117, "OUTSIDE any try/catch" comment at :60]`. `getMyAllocationDashboard` has one non-test caller, `page.tsx:115` `[VERIFIED: grep]`.

### Design (prescriptive)

1. In `latest-holdings-per-key.ts`, export `class HoldingsIdentityError extends Error` (name `"HoldingsIdentityError"`, pattern of `HoldingsUpdatedAtError` `[VERIFIED: src/lib/holdings-account-day.ts:56-61]`).
2. `keyAccountOf` returns `(keyId) => { if (!identity.has(keyId)) throw new HoldingsIdentityError(...); return identity.get(keyId) ?? \`key:${keyId}\`; }`. The message must not print more than the id of an owner's own key row (it already is owner data; keep the existing capture convention, no secrets are in scope).
3. Export `strictAccountOf(accountByKey: Readonly<Record<string, string>>): (keyId: string) => string` from the same module: `const a = accountByKey[keyId]; if (a === undefined) throw new HoldingsIdentityError(...)`. Use it at `queries.ts:5132` and `route.ts:882`. One helper keeps one error class for both dollar callers.
4. `fetchHoldings` needs no code change: the throw already propagates (its other failures use `throw`). Update the docblock sentence "A key the identity does not group, or that is absent from `keys`, is its own account" at `latest-holdings-per-key.ts:108-109` and the `oneKeyPerAccountDay` docblock "a key it does not know should map to its own token" (`holdings-account-day.ts:118-119`), which become false.

### The default `accountByKey = {}` conflict (seven tests must move)

`derivePhase07Fields` documents `accountByKey: ... = {}` "A key it does not name is its own account, so a caller that passes none counts every key" `[VERIFIED: src/lib/queries.ts:4902-4906]`. A strict lookup contradicts that. Measured: with the strict lookup applied, exactly **seven tests in two files fail**, and nothing else in `src/lib`, `src/app/(dashboard)/allocations` (the full dashboard-adjacent run) or the commit route tests:

- `src/lib/queries.holdings-per-key.test.ts`: "with no account map every key is its own account (the default)"; "within one key two rows of one venue:symbol:type still yield one row"; "a row without a parseable updated_at fails loud rather than being treated as a tie".
- `src/lib/queries.test.ts` (`derivePhase07Fields: holdingsSummary is each key's own latest asof (D-16)`): "a position the key closed before its latest poll is gone"; "a key that did not poll on the latest day keeps its own latest rows"; "input order is irrelevant"; "D-08: two keys on one venue:symbol:type keep one row EACH".

`[VERIFIED: ran vitest on both files with the lookup neutered to throw, then restored with cp + cmp; git status clean afterwards]`. The first test above pins the very default HOLD-01 retires; it must be rewritten (to assert the throw, or to pass an explicit identity), not deleted silently. The other 28 `derivePhase07Fields` calls in `queries.test.ts` (32 in total) are unaffected.

**Decision for the planner (recommended):** keep the signature and the `= {}` default, make the lookup strict, and give the seven tests an explicit identity map (a tiny test helper that maps each fixture key id to its own `account:<id>`). Do not keep a "no map means every key" branch: it is the silent fallback the requirement removes.

Other pins checked and found unmoved by a strict `keyAccountOf` or strict commit lookup `[VERIFIED: ran vitest for portfolio-exposure, latest-holdings-per-key, the three fingerprint parity tests, holdings-account-day, queries.holdings-per-key, HoldingsTabPanel.exposure-agreement, and the scenario commit directory plus scenario-commit-rls with each neuter in turn: 11 files / 325 tests green for keyAccountOf; 4 files / 110 tests green for the route]`.

### Test seams (where each RED test goes)

| Reader | Test file (extend) | Seed | Assertion (RED pre-fix, GREEN post) |
|---|---|---|---|
| `fetchHoldings` | `src/lib/portfolio-exposure.test.ts` (next to "an unparseable updated_at on a counted row rejects with HoldingsUpdatedAtError") | `beforeEach` seeds `keysResolver.rows = [keyRow(K1)]` `[VERIFIED: portfolio-exposure.test.ts:273]`; set `holdingsResolver.rows = [row({ api_key_id: K2 })]` | `await expect(getNetExposureSeries(USER_ID)).rejects.toMatchObject({ name: "HoldingsIdentityError" })` and the same for `getAllocationSeries`. Use the string name, not an imported class, so pre-fix code fails on the assertion (it resolves with a point) instead of on a missing import. |
| `keyAccountOf` | `src/lib/latest-holdings-per-key.test.ts` (beside the test at :871) | `keyAccountOf([k-a])` | `of("absent")` throws; `of("k-c")` (in `keys`, unplaceable) still returns `key:k-c` (pins the discriminator). |
| per-key dollar path | `src/lib/queries.holdings-per-key.test.ts` | `derivePhase07Fields` with a row for key X and `accountByKey` lacking X | `toThrow` with name `HoldingsIdentityError`. |
| commit route | `src/app/api/allocator/scenario/commit/route.per-key-aum.test.ts` or `route.test.ts` | Reader cannot return such a row through the harness (it reads rows only for keys in `api_keys`), so partially mock the reader module (`vi.mock("@/lib/latest-holdings-per-key", async (orig) => ({ ...(await orig()), fetchLatestHoldingsPerKey: ... }))`) to return a row absent from `accountByKey` | The audit rows carry `_size_source: "lookup_failed"` and no AUM figure (not a failed commit). Pre-fix: the row is counted and a server size is produced. |

PROOF-01 neuter for each: replace the throw with the old `?? \`key:${id}\`` / `?? keyId` fallback in a byte-backed copy, see the named arm RED, restore with `cp` and `cmp`.

## HOLD-02: matcher marker per account

### Current logic `[VERIFIED: analytics-service/routers/match.py:716-950 (read this session)]`

- Step 1 reads `key_rows` (identity columns `id, exchange, venue_account_id, venue_server, account_share_kind, account_shared_with_api_key_id`), then per key its newest `asof` and the rows at it (`latest = rows(...order("asof", desc=True).limit(1)...)`, then `day_rows`). A key with no rows is skipped (`if not latest: continue`).
- Step 1b: `key_ids = sorted({str(h["api_key_id"]) for h in holdings_rows ...})` (only keys that have rows), `unpriced_days = read_native_unpriced_days(supabase, allocator_id, key_ids)` inside `try/except Exception` that does `logger.exception("match: native-unpriced marker read failed ...")` and keeps the rows. A row is dropped when `str(h["asof"]) < unpriced_day` (per key).
- Step 2: `group_of` is built only `if holdings_rows:` from `account_identity_tokens(key_rows)`; `_account(holding)` is `group_of.get(key_id, f"key:{key_id}")`. `newest_day[account]` is the maximum `asof` over the rows that survived Step 1b. Only rows at an account's newest day go to `one_key_per_account_day`.

The defect: a marker only removes the marker key's own older rows, so the account's newest day is taken from the survivors. When key A has the marker (D) and key B's newest rows are D-1, B survives and counts.

### TS reference rule `[VERIFIED: src/lib/latest-holdings-per-key.ts:455-465 and 510-540]`

A key whose marker day is after its newest rows (or that has no rows) gets `reading = { day: unpricedAsof, hasRows: false }`; an account's `newestByAccount` is the maximum reading day over its keys; only keys with `hasRows` whose `reading.day === newestByAccount.get(accountOf(key.id))` are read.

### Measured divergence at HEAD (temporary pytest, removed, worktree clean)

Two keys on one MT5 login and server (same account), via `tests/fake_postgrest.FakeDb`, `_load_holding_portfolio_context(...)["portfolio_aum"]`:

| Case | Rows | Marker | HEAD matcher AUM | TS reader result |
|---|---|---|---|---|
| A-marker / B-older | A: 1000 on D-2 (2026-10-08); B: 700 on D-1 (2026-10-09) | A: D (2026-10-10) | **700.0** | 0 (A's reading day D is the account's newest, B at D-1 does not count) |
| marker key has no rows | B: 700 on 2026-10-09 only | A: 2026-10-10 | **700.0** | 0 |

The TS result is by reading the code above, not by a run in this session (the cross-runtime test the plan adds will run it). Expected post-fix AUM: 0.0 in both cases.

### Design (prescriptive)

In `_load_holding_portfolio_context`:
1. Build `group_of` from `account_identity_tokens(key_rows)` unconditionally (it is needed to place markers of rows-less keys). Keep `_account` as is.
2. Read markers for **every** `key_rows` id: `key_ids = [str(k["id"]) for k in key_rows]` (same `try/except` and ERROR log; on failure `unpriced_days = {}` = today's behaviour, CONTEXT-locked).
3. Per key, a reading day: `marker_day if marker_day is not None and (latest is None or marker_day > latest) else latest` (strict `>` as in TS; a marker on the rows' own day or older changes nothing). Record each key's `latest` asof while reading Step 1 (the code currently discards it after reading rows; a dict `latest_by_key` is enough).
4. `newest_day[account]` = max over the account's keys' reading days (a marker-won key contributes its marker day and no rows).
5. Counted rows are those with `asof == newest_day[account]`. A marker-won key's rows are at its `latest < marker_day <= newest_day`, so the equality drops them without any separate Step 1b row filter; the old `kept_rows` loop becomes redundant. Keep the INFO log of "removed N rows" only if cheap; do not keep both mechanisms.
6. Step 3 (mark history) deliberately applies neither rule (comment at `match.py:987`): unchanged.

Do not add `f"holding:..."` strings, `(venue, symbol)` tuples or `computed_at` to this function (census pins below).

### Parity limits to record (not hide)

- The matcher reads no audit log. The dashboard reader also supersedes a key's rows on a clean empty or newer clean poll (`auditEvidence: true`, the default). So parity is **rows plus markers only**. The TS replay of the shared fixture must call `fetchLatestHoldingsPerKey(client, userId, cols, { auditEvidence: false })` (or serve an empty `audit_log`), the same mode the scenario commit uses `[VERIFIED: latest-holdings-per-key.ts:306-323 docblock; route.ts passes { auditEvidence: false }]`.
- **SC-2's phrase "match AUM and unpriced days equal what Holdings reports":** no match output field carries "unpriced days". `grep -n -i unpriced analytics-service/routers/match.py` finds only the import, the docstring, the Step 1b block and a Step 3 comment `[VERIFIED: grep this session]`. So SC-2 is testable as: the same account contributes the same **rows and the same total value** in both runtimes (AUM and the contributing key ids). Do not invent an output field. Flag in the plan that "unpriced days" is satisfied by the shared marker-day rule, not by a new field.
- **Stale pointers:** `TODOS.md` (entry `170.4-MATCH-UNPRICED-PER-KEY`) says "as `equity_reconstruction.py` does", and `read_native_unpriced_days`'s docstring says it is "the same reader the daily refresh uses". At HEAD `match.py` is the **only** caller of `read_native_unpriced_days` and no refresh code reads the marker `[VERIFIED: grep -rn "read_native_unpriced_days" analytics-service excluding tests/.venv returns only routers/match.py and the definition]`. The authoritative reference is the TS reader. Fix the docstring in the same edit if the plan touches `allocator_positions.py`; otherwise record it.

### Shared fixture and replay

The existing `one_key_per_account_day_cases.json` is "consumed whole by both suites" (its `_comment`), so **add a new file**: `analytics-service/tests/fixtures/native_unpriced_account_day_cases.json`, hand-typed expectations (no value derived from either implementation), `_comment` naming both consumers. Case schema: `keys` (id, exchange, venue_account_id, venue_server, share columns), `rows` (key, asof, value), `markers` (key to day), `expected_counted_keys`, `expected_total_usd`. Cases to include: A-marker/B-older (expect none counted), marker-key-without-rows (expect none), marker on the rows' own day (A and B both counted per the existing identity rule), marker older than rows (no effect), two keys on different accounts (marker drops only its own key; this is today's `test_match_portfolio_aum_native_unpriced.py` shape), and the already-parity-tested duplicate-marker pair from `src/lib/fingerprint-unpriced-parity.test.ts` (KEY_S `duplicate` of KEY_U, marker after both: account contributes nothing).

Replays (mirror `holdings-account-day.test.ts`, which loads its JSON with `readFileSync(path.resolve(process.cwd(), "analytics-service/tests/fixtures/..."))` `[VERIFIED: src/lib/holdings-account-day.test.ts:36-45]`, and `test_one_key_per_account_day.py`, which loads via `Path(__file__).parent / "fixtures"` `[VERIFIED: analytics-service/tests/test_one_key_per_account_day.py:25-27]`):
- TS: new `src/lib/native-unpriced-account-day.parity.test.ts`. Reuse the hand-rolled chain client shape from `src/lib/fingerprint-unpriced-parity.test.ts` (it serves `api_keys`, `audit_log` empty, `allocator_equity_derived`, `allocator_holdings` honouring `eq`/`order`/`limit`), generalised to read its tables from the fixture case.
- Python: new `analytics-service/tests/test_match_native_unpriced_account_day.py`. Use `FakeDb` as `test_match_portfolio_aum_native_unpriced.py` does (`monkeypatch.setattr(match_mod, "get_supabase", lambda: db)`; `db.errors["allocator_equity_derived"] = RuntimeError(...)` simulates the failed read). Assert `portfolio_aum` and the set of counted key ids.
- The existing three tests in `test_match_portfolio_aum_native_unpriced.py` (marker after row removes the account; marker on or before the row hides nothing; failed marker read keeps rows and logs at ERROR) must keep passing unchanged `[VERIFIED: ran this session, 31 passed across that file, test_match_portfolio_aum_per_key.py, test_native_unpriced_marker_reader.py]`.

RED/neuter: the TS replay is green at HEAD (the TS reader is the reference); its sensitivity proof is a neutered copy of the reader's marker branch. The Python replay is RED at HEAD with the 700-vs-0 arms named, then GREEN after the edit. Record both.

## HOLD-04: dashboard marker-read failure

### Where `markerReadError` is dropped `[VERIFIED: grep + Read this session]`

`fetchLatestHoldingsPerKey` returns `markerReadError: string | null`, the message of the **first** failed marker read (`latest-holdings-per-key.ts:349-354, 574`). In `getMyAllocationDashboard` the read is destructured as `phase07HoldingsRes` (queries.ts:5268), checked with `assertOk(phase07HoldingsRes, "allocator_holdings")` (:5680), and only `.data`, `.partialReads`, `.accountByKey` are used (:5698, :5755, :5758). `derivePhase07Fields` never sees `markerReadError`. Only the commit route reads it today.

### Payload plumbing

`page.tsx` spreads the payload (`<AllocationsTabs {...payload} .../>`, page.tsx:187-188), and `AllocationsTabs` renders `<AllocationDashboardV2 {...props} />` and `<HoldingsTabPanel {...props} />` (AllocationsTabs.tsx:1009, 1017) `[VERIFIED: Read/grep]`. The hand-picked object at `AllocationsTabs.tsx:1163` is only the narrow slice for `ScenarioComparePanel` and does not need the flag. So: add `holdingsUnpricedCheckFailed?: boolean` (optional, like `departedHistoryUnavailable`, queries.ts:3033) to `MyAllocationDashboardPayload`, and set it in **both** return literals of `getMyAllocationDashboard` explicitly, next to `keyDataGaps` (queries.ts:6141, `!portfolio` branch; queries.ts:6711, main branch), computed once as `const holdingsUnpricedCheckFailed = phase07HoldingsRes.markerReadError !== null;` after the `assertOk` block. Do NOT thread it through `derivePhase07Fields` (its `Pick<...>` return type and 50+ test call sites would widen for a value the function does not compute).

### Capture convention (surface the conflict, then decide)

CONTEXT says "an `area` tag". Every capture inside `getMyAllocationDashboard` uses `tags: { op: "getMyAllocationDashboard", reason: "<token>" }` (for example the `role_discriminator_read_failed` warning at queries.ts:5958-5962 with `extra: { userId }, level: "warning"`), while `area` is the commit route's convention (`tags: { area: "scenario-commit", gate: "audit_size_recompute" }`, route.ts, and its `extra: { user_id, supabase_err }`). Two conventions, not blended silently: **decision recorded for the planner:** use `tags: { op: "getMyAllocationDashboard", reason: "holdings_marker_read_failed", area: "my-allocation-dashboard" }`, `extra: { userId, supabase_err: markerReadError }`, `level: "warning"`. `op`+`reason` keeps file conformity (Rule 11) and Sentry dashboards that filter on `op`; `area` honours CONTEXT; the undotted `area` value avoids the degrade-scan registry-id false positive (UI-SPEC T8; the scan reads dotted `allocation.*` strings in walked roots, and `queries.ts` is not a walked root anyway). Raw key ids do not enter; `markerReadError` is a supabase message and is scrubbed by `captureToSentry` (`scrubCaptureInput`, src/lib/sentry-capture.ts). Wrap as `scheduleDerivedRowCapture(captureToSentry(new Error("getMyAllocationDashboard: native-unpriced marker read failed"), {...}))` `[VERIFIED: queries.ts:4309-4322 the wrapper and its after()/queueMicrotask fallback]` and write a `console.error` line first (that is the local trace the wrapper's comment requires).

### Poll volume (T8)

`router.refresh()` re-runs the read every `PERFORMANCE_POLL_INTERVAL_MS` while the Overview is open (UI-SPEC measured). The repo already solved this exact volume for derived-row captures: `shouldCaptureDerivedRowRejection(allocatorId, rejection)` keeps a per-instance 6 h window `[VERIFIED: queries.ts:4330-4354; DERIVED_ROW_CAPTURE_WINDOW_MS = 6 * 60 * 60 * 1000 at :4326, R3-WR-04: "~120 events an hour per open tab"]`. **Recommendation:** extend its second parameter's union with `"holdings_marker_read_failed"` and use it, so the failure fires once per window per instance, and test it with `__resetDerivedRowCaptureThrottleForTests()` in `beforeEach` (the same reset `queries.my-allocation.test.ts` already calls in its describe blocks). The note itself is not throttled (it renders on every poll). The alternative (capture on every poll, Sentry groups them) is acceptable only if the founder prefers it; record the choice. Server-side throttling is not the client-side suppression UI-SPEC T8 forbids.

### Registry entry and copy

UI-SPEC section 1.1/1.2 is complete and must be copied verbatim: id `allocation.holdings-unpriced-check-failed`, surface `my-allocation`, class `read_failure`, scope `none`, action `A-RELOAD`, text `[ "We could not check whether each account's newest day could be priced in USD, so the holdings shown may include an account's positions from an earlier day. ", { action: "A-RELOAD" } ]`. Place it after `allocation.alerts-unverified` `[VERIFIED: src/lib/degrade-warnings.ts:933-942 the entry it follows]`. `A-RELOAD`'s sentence is "Reload this page to try again." with `link: "none"` `[VERIFIED: degrade-warnings.ts A-RELOAD entry]`. The copy contains none of the copy-census rule-A retired words (`portfolio`, `book`, `favorites`, `starred`, `preference`, `my strategies`, `My Allocation`, `My Watchlist`, `Bridge`) `[VERIFIED: scripts/copy-census/policy.ts RETIRED_WORDS]` and no `GLOSSARY` label (the labels are Omega ... Underwater, listed in `src/lib/glossary.ts`).

### Mounts and gates

Exactly UI-SPEC section 1.3 (two inline `<p>` blocks with literal ids, no wrapper component). Mount A in `AllocationDashboardV2.tsx` goes after `<MissingDataMessage lines={missingLines} />` and before the `departedHistoryUnavailable && !isRebuilding && <DepartedHistoryNote />` line (current anchors: MissingDataMessage at :299, DepartedHistoryNote at :304). Mount B in `HoldingsTabPanel.tsx` goes as the first child after the Positions header `div` (the `h3#holdings-positions-heading` row, current anchor :723-735) and before `positions-unreported-caption`. Render condition `props.holdingsUnpricedCheckFailed === true && (props.holdingsSummary ?? []).length > 0`.

### Census and ledger moves (T1-T4, measured design; re-measure the counts, do not assume)

| File | What moves |
|---|---|
| `src/lib/degrade-warnings.test.tsx` | Add `SAMPLES` rows for the two new ids (`"every sample has an entry and every entry has a sample"` fails otherwise). `WHOLE_HISTORY_IDS` count pin (10) does NOT move: neither new entry is `whole_history`. Add a verbatim-sentence pin like the `allocation.alerts-unverified` one (:692) plus the no-"the total" assertion. |
| `src/__tests__/degrade-warning-scan.test.ts` | `AllocationDashboardV2.tsx` row (`tripHits: 7`, :95): add the id to `ids`, move `tripHits` by the comment-stripped delta (the new `role="status"` is the trip token; expected +1, re-measure) and extend the `reason`. **New** row for `src/app/(dashboard)/allocations/HoldingsTabPanel.tsx` (none exists today `[VERIFIED: grep -n HoldingsTabPanel src/__tests__/degrade-warning-scan.test.ts returns no hit]`): `ids: ["allocation.holdings-unpriced-check-failed"]`, measured `tripHits`. `MissingDataMessage.tsx` row (tripHits 0): add the new undated id for HOLD-05 to `ids`. |
| `src/__tests__/copy-census.test.ts` | Must stay at its pinned exception count (36); the new copy must hit no rule. Run it after the registry edits. |
| `src/__tests__/computed-at-reader-census.test.ts` | Pins counts of `computedAt`/`computed_at` per file for `AllocationDashboardV2.tsx`, `HoldingsTabPanel.tsx`, `match.py`, `queries.ts`. Add none of those identifiers. |
| `src/__tests__/holding-scope-key-census.test.ts` | Pins `match.py` M4 count 6 etc. and `HoldingsTabPanel.tsx` M2 count 2. Add no `(venue, symbol)` tuples, `${venue}:${symbol}` templates or `f"holding:..."` strings. |
| `src/__tests__/recompute-verdict-census.test.ts` | Pins `latest-holdings-per-key.ts::!== "complete"` count 1 and `!== "complete_with_warnings"` count 1 `[VERIFIED: recompute-verdict-census.test.ts:185-186]`. The new error class and helper must not add either token. |

Run all five census tests after the TS edits; they are single-file runs.

### Test harness gap (Wave 0)

`src/lib/queries.my-allocation.test.ts`'s failure injection is keyed by table: `state.tableErrors["allocator_equity_derived"]` makes **every** `allocator_equity_derived` read fail (the equity-curve read included), and the only narrower key is `"allocator_equity_derived:key_inputs"` for reads with an `in("kind", ...)` filter `[VERIFIED: queries.my-allocation.test.ts:483-491]`. A HOLD-04 test needs the **marker read alone** to fail (so the curve read and everything else stay healthy). Add a third injection key (for example `"allocator_equity_derived:native_unpriced"`, matched when a recorded `eq("kind", "native_unpriced:...")` filter exists) at both injection points (:459 and :488) of the fake chain. This is a test-harness edit, not production code. Model the Sentry assertions on the existing spies (`vi.spyOn(sentry, "captureToSentry")`, :3654 onward) and seed from the CR-01 block (:5349-5440: `state.apiKeys`, `state.allocatorHoldings`, `unpricedRecord`).

### Render tests

Model T5 on `src/app/(dashboard)/allocations/AllocationDashboardV2.departed-history.test.tsx` and T6 on `HoldingsTabPanel.positions-header.test.tsx` `[VERIFIED: both files exist; departed-history test asserts testids at :110-152]`. Cases are exactly UI-SPEC T5/T6/T9.

## HOLD-05: every failing shared-account key named

### Producer today `[VERIFIED: key-data-gaps.ts, read in full; and the S3 probe]`

`keyDataGaps(input)` returns `KeyDataGap[]` (`apiKeyIds`, `cause`, `firstMissingDay`, `ranges`). In the `shared_account_no_working_key` arm it takes `accountGroups(keyAccounts, { countedOnly: false })` (groups of two or more keys on one known account), skips groups not every-key-failing, takes the group's latest last day, and `push(group, "shared_account_failing", 2, { lastDay, referenceDay: yesterdayUtc })`. `push` emits **nothing** for a valid empty tail (`tailRange` null), which is the uncovered case.

### S3 probe result (run this session; temporary test removed; worktree clean)

Run through `keyDataGaps` then `missingDataLines` + `MissingDataMessage` with `reason: "shared_account_no_working_key"`:

- Two-key literal (one account B1, B2; B2's last day = yesterday): `gaps = []`; text = the book fallback only ("The equity chart and the ratios built from it are hidden for your whole history. The keys that read one of your exchange accounts are all failing to sync, so that account's history stops. Fix or reconnect one of them on the Exchanges page."). It passes at HEAD, so it cannot satisfy PROOF-01.
- Two-account (A1,A2 with tail gap; B1,B2 reaching yesterday): `gaps = [{apiKeyIds:["A1","A2"], cause:"shared_account_failing", firstMissingDay:"2026-10-05", ranges:[{from:"2026-10-05",to:"2026-10-11"}]}]`; text = only `Binance - a1 and Binance - a2: no data for Oct 5, 2026 - Oct 11, 2026. Fix or reconnect one of these keys on the Exchanges page.` B1 and B2 are named nowhere and no fallback prints. This is the RED fixture.

### Payload field: grouped, not a flat id list (design)

A flat id list fails two of the UI-SPEC prohibitions: with two undated accounts it cannot say "one of these keys" per account without merging both accounts into one sentence (violating P2, which forbids merging a key into another account's line), and `Fix or reconnect one of these keys` would misstate which keys are interchangeable. So the field is **grouped per account**:

- In `key-data-gaps.ts`, add a **sibling export** `sharedAccountFailingGroups(input: KeyDataGapsInput): string[][]`: `[]` unless `input.reason === "shared_account_no_working_key"`; otherwise each group from `accountGroups(input.keyAccounts, { countedOnly: false })` whose every key `failing === true`, ids filtered to `input.ownKeyIds` (the same owner filter `push` applies), sorted, groups with fewer than two owned ids dropped, ordered by first id. Leave `keyDataGaps()` and its return shape untouched (its tests `toEqual` whole arrays).
- `queries.ts`: factor the input construction in `deriveKeyDataGapsField` (:4635) so both functions are fed once, or add a sibling `deriveSharedAccountFailingGroupsField` taking the same arguments. Add `sharedAccountFailingGroups?: string[][]` (optional, legacy fixtures compile) to `MyAllocationDashboardPayload`, set in **both** return literals next to `keyDataGaps` (:6141, :6711). Owner ids only; `accountId` never copied (T-186-18).

### `missingDataLines` rule (design)

Add an optional argument `sharedFailingGroups?: readonly (readonly string[])[] | null` (default undefined, so `MissingDataMessage.test.tsx`'s `lines()` helper, which passes five keys, stays valid `[VERIFIED: MissingDataMessage.test.tsx:55-66]`). Rule when the argument is a non-empty array:

1. For each group: it is **named by a dated gap** when a printed (`resolveGaps`) `shared_account_failing` gap has exactly those `apiKeyIds`.
2. Otherwise, if every id in the group resolves through `apiKeyLabelById(apiKeys)`, add an **undated labelled line** for the group (new registry entry below), `id: "gap:shared_account_failing_undated:<ids>"`, `sortLabel: labels.join(" and ")` so it sorts with the key lines.
3. A group with an id the owner's list cannot label names nothing (SFH-4 / T-198-17) and keeps the book fallback.
4. `causesPrinted.has("shared_account_failing")` becomes true (fallback suppressed) iff every group is covered by (1) or (2). When the argument is absent or empty (legacy payload, or `reason` not shared-account), behaviour is byte-identical to today.

Consequence to state in the plan: the TODOS/CONTEXT two-key GREEN-only regression keeps passing as a test, but its expected text **changes**: at HEAD it prints the book fallback; after the fix it prints the undated labelled line and **no** fallback (the keys are labelled). Update that regression's expected text deliberately; the existing `shared_account_no_working_key with no gap line` fallback test (:345, `[]` gaps and no groups argument) is the legacy-payload case and must stay green unchanged.

Expected renders:
- Two-account fixture, rebuilding: line 1 account A's dated line; line 2 `Binance - b1 and Binance - b2: ...undated sentence...`; no book fallback (P4 holds, no double message).
- P1: B1/B2 are never printed with "no complete history yet" or null coverage.
- P3: no raw id prints (labels only).

### New registry entry (copy is Claude's discretion; this is a concrete proposal)

Model: `allocation.failing-key-undated` (class `degrade`, scope `key`, no day; degrade-warnings.ts:501-513) and `allocation.key-gap.identity-pending` (`{labels}: ...` shape). A `key_day` scope would force the judge to demand a day (`judgeEntry`: `scope === "key_day"` requires `sample.days.length > 0`) `[VERIFIED: degrade-warnings.test.tsx judgeEntry arm]`, so the scope is `key`.

```ts
// Phase 235 HOLD-05 (CONTEXT correction 2026-11-26, UI-SPEC S1): an all-failing shared account whose
// history already reaches yesterday has no dated gap line, so it would go unnamed. This line names its
// keys and states no day: no invented date, and no "no complete history yet" claim for a key whose
// history is complete.
{
  id: "allocation.key-gap.shared-account-failing-undated",
  surface: "my-allocation",
  class: "degrade",
  scope: "key",
  action: "A-FIX-ONE-OF-THESE",
  text: (a: { labels: readonly string[] }): DegradeSegment[] => [
    ...labelSegments(a.labels),
    ": these keys read one exchange account and every one of them is failing to sync. ",
    { action: "A-FIX-ONE-OF-THESE" },
  ],
},
```

Rendered: `Binance - b1 and Binance - b2: these keys read one exchange account and every one of them is failing to sync. Fix or reconnect one of these keys on the Exchanges page.` (the label separator is the real em dash the shipped `apiKeyLabelById` prints). `labels` always has two or more entries (the producer drops smaller groups), so plural is always true. Checked against: copy-census rule A (no retired word), rule B (no glossary label), the `MissingDataMessage` scope test (`/your keys|your book/i` must not match: it does not), and the D-10 return/risk ban (not whole-history, but it names neither). Place it directly after `allocation.key-gap.shared-account-failing`. SAMPLES row: `{ args: { labels: [KEY_A, KEY_B] }, labels: [KEY_A, KEY_B], days: [] }`. In `GapLine`/`missingDataLines` the id must appear as a **literal** at its render site (scan convention), and `src/__tests__/degrade-warning-scan.test.ts`'s `MissingDataMessage.tsx` row gains the id.

Wire-up in `AllocationDashboardV2.tsx`: pass `sharedFailingGroups: props.sharedAccountFailingGroups` into the `missingDataLines` call (:168-175) and add it to the `useMemo` dependency list.

## Common Pitfalls

### Pitfall 1: the strict lookup breaks seven fixtures that pre-date it
**What goes wrong:** `derivePhase07Fields` fixtures pass no `accountByKey`; strictness throws.
**Why:** the default `{}` meant "every key is its own account".
**How to avoid:** the planner lists the seven tests (above) in the plan and rewrites them with an explicit identity map in the same task. Re-run both files.
**Warning signs:** `HoldingsIdentityError` in `queries.test.ts` or `queries.holdings-per-key.test.ts`.

### Pitfall 2: a RED test that is red for the wrong reason
**What goes wrong:** importing `HoldingsIdentityError` in a test makes pre-fix code fail on a missing export, not on the behaviour.
**How to avoid:** assert by `name` string (`toMatchObject({ name: "HoldingsIdentityError" })`) or `rejects.toThrow(/.../)`; record the named arm in the SUMMARY (PROOF-01).

### Pitfall 3: the flag set in one return literal only
**What goes wrong:** `getMyAllocationDashboard` has two literals (`!portfolio` at ~:6141 and the main one at ~:6711). `...phase07` carries nothing for the flag.
**How to avoid:** a const computed once, set in both; a test for each branch (fresh allocator with keys and holdings but no portfolio, and a book with a portfolio).

### Pitfall 4: failing the whole `allocator_equity_derived` table in the HOLD-04 test
**What goes wrong:** the existing injection fails the curve read too, so the page reads as `history_read_failed` and the test proves nothing about the marker.
**How to avoid:** the Wave 0 injection key (above).

### Pitfall 5: the new line moves a count in a scan or census test
**What goes wrong:** forgetting the ledger rows, the SAMPLES rows, or the copy census.
**How to avoid:** the Census and ledger table; run the five census tests plus the two degrade tests after the TS edits.

### Pitfall 6: marker rule with the wrong comparison
**What goes wrong:** using `>=` (a marker on the rows' own day would hide a priced key) or only reading markers for keys that have rows (the rows-less marker case silently fails).
**How to avoid:** the fixture arms "marker on the rows' own day" and "marker key has no rows", both hand-typed; strict `>` as in TS.

### Pitfall 7: restoring neutered files with git
**What goes wrong:** the founder rule forbids `git checkout`/`stash` on uncommitted work.
**How to avoid:** `cp` byte backup before, `cp` back and `cmp` after, in every PROOF-01 step. (This research did exactly that for every probe.)

## Code Examples

### Strict identity (HOLD-01)

```ts
// Source: src/lib/latest-holdings-per-key.ts:110-129 (current), edit per Design
export class HoldingsIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HoldingsIdentityError";
  }
}
// ...in keyAccountOf:
return (keyId: string): string => {
  if (!identity.has(keyId)) {
    throw new HoldingsIdentityError(`holdings row names key ${keyId}, which is absent from the owner's api_keys identity read`);
  }
  return identity.get(keyId) ?? `key:${keyId}`;
};
export function strictAccountOf(
  accountByKey: Readonly<Record<string, string>>,
): (keyId: string) => string {
  return (keyId) => {
    const account = accountByKey[keyId];
    if (account === undefined) {
      throw new HoldingsIdentityError(`counted holdings row names key ${keyId}, which accountByKey does not carry`);
    }
    return account;
  };
}
```

### Marker reading day in the matcher (HOLD-02, shape only)

```python
# per key, after the Step 1 reads (latest_by_key[key_id] = newest asof or absent)
def _reading_day(key_id: str) -> str | None:
    latest = latest_by_key.get(key_id)
    marker = unpriced_days.get(key_id)
    if marker is not None and (latest is None or marker > latest):
        return marker            # a reading with no rows
    return latest
```

### Flag and capture (HOLD-04, shape only)

```ts
const holdingsUnpricedCheckFailed = phase07HoldingsRes.markerReadError !== null;
if (holdingsUnpricedCheckFailed && shouldCaptureDerivedRowRejection(userId, "holdings_marker_read_failed")) {
  console.error("[queries.getMyAllocationDashboard] native-unpriced marker read failed (holdings rows kept, note shown):", phase07HoldingsRes.markerReadError);
  scheduleDerivedRowCapture(
    captureToSentry(new Error("getMyAllocationDashboard: native-unpriced marker read failed"), {
      tags: { op: "getMyAllocationDashboard", reason: "holdings_marker_read_failed", area: "my-allocation-dashboard" },
      extra: { userId, supabase_err: phase07HoldingsRes.markerReadError },
      level: "warning",
    }),
  );
}
```

## State of the Art

| Old approach | Current approach | Impact |
|---|---|---|
| `key:<id>` fallback hides an identity gap | Fail loud on a key absent from the identity read | A double count becomes a thrown read (error boundary), never a figure |
| Marker removes only the marker key's rows | Marker is the key's reading day; account newest = max over keys | Matcher AUM equals Holdings for multi-key accounts |
| R3-01 for `not_syncing` only | Attributed groups for `shared_account_failing` too | Every failing key is named |

**Deprecated/outdated:** the TODOS pointer "as `equity_reconstruction.py` does" and the `read_native_unpriced_days` docstring "same reader the daily refresh uses" are not true at HEAD (see HOLD-02).

## Runtime State Inventory

Not a rename/refactor/migration phase. No stored data, live-service config, OS-registered state, secrets or build artifacts carry a renamed string. No migration (CONTEXT: out of scope). The only persisted artifact the phase touches is test fixtures. The `native_unpriced:<key>` markers in `allocator_equity_derived` are read, never written.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node + vitest | all TS tests | yes | Node v25.8.1 (local) | none needed |
| Python venv + pytest + mypy | HOLD-02 | yes | 3.12.13 (`analytics-service/.venv`); pytest ran this session | none needed |
| graphify | context graph | no (`graphify is not enabled`) | skipped, not needed for in-repo research | none |
| Docker / Supabase local stack | none (no SQL) | not required | n/a | n/a |
| External docs (Context7 etc.) | none (all in-repo behaviour, no library API question) | not used | n/a | n/a |

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (TS, jsdom/node per file), pytest (analytics) |
| Config file | `vitest.config.ts`, `analytics-service/pyproject.toml` |
| Quick run | `npx vitest run <one file>`; `cd analytics-service && .venv/bin/python -m pytest tests/<file>.py -q` |
| Full suite | not run per task (heavy); CI runs it. Per wave run the census set below |

### Phase Requirements to Test Map

| Req | Behavior | Test type | Command | File exists? | RED on pre-fix code because |
|-----|----------|-----------|---------|--------------|------------------------------|
| HOLD-01 | `fetchHoldings` rejects when a row's key is absent from the identity read | unit | `npx vitest run src/lib/portfolio-exposure.test.ts` | extend (file exists) | pre-fix resolves with a point (row counted as `key:<id>`) |
| HOLD-01 | `keyAccountOf` throws for absent id, keeps `key:<id>` for an in-keys unplaceable key | unit | `npx vitest run src/lib/latest-holdings-per-key.test.ts` | extend | pre-fix returns `key:absent` |
| HOLD-01 | `derivePhase07Fields` throws for a counted row whose key `accountByKey` lacks | unit | `npx vitest run src/lib/queries.holdings-per-key.test.ts` | extend + fix 3 fixtures | pre-fix `?? keyId` counts it |
| HOLD-01 | `queries.test.ts` fixtures carry an explicit identity | unit | `npx vitest run src/lib/queries.test.ts` | rewrite 4 fixtures | strictness without the fixture edit fails these 4 |
| HOLD-01 | commit route: absent-from-`accountByKey` row becomes `lookup_failed`, not a counted row | unit | `npx vitest run src/app/api/allocator/scenario/commit/route.per-key-aum.test.ts` | extend | pre-fix counts the row and sizes from it |
| HOLD-02 | matcher count equals the TS reader's per shared case | unit | `cd analytics-service && .venv/bin/python -m pytest tests/test_match_native_unpriced_account_day.py -q` | NEW (Wave 0) | HEAD gives 700.0 on the A-marker/B-older and rows-less-marker arms (measured) |
| HOLD-02 | TS reader satisfies the same fixture (`auditEvidence: false`) | unit | `npx vitest run src/lib/native-unpriced-account-day.parity.test.ts` | NEW (Wave 0) | green at HEAD (it is the reference); proven sensitive by a neutered copy of the marker branch |
| HOLD-02 | existing marker tests unchanged | unit | `... pytest tests/test_match_portfolio_aum_native_unpriced.py tests/test_match_portfolio_aum_per_key.py tests/test_native_unpriced_marker_reader.py -q` | exists (31 pass) | regression guard |
| HOLD-02 | mypy strict | type | the mypy command above | n/a | signature drift |
| HOLD-04 | flag true + Sentry capture only on a marker-read failure, rows kept, both return branches | integration | `npx vitest run src/lib/queries.my-allocation.test.ts -t "<new describe>"` | extend + Wave 0 harness key | pre-fix: no flag, no capture |
| HOLD-04 | registry pin, SAMPLES, ledger | unit | `npx vitest run src/lib/degrade-warnings.test.tsx src/__tests__/degrade-warning-scan.test.ts` | extend | missing entry / unledgered id |
| HOLD-04 | Overview note cases (T5, T9) | component | `npx vitest run "src/app/(dashboard)/allocations/AllocationDashboardV2.unpriced-check.test.tsx"` | NEW | no note rendered pre-fix |
| HOLD-04 | Holdings note cases (T6) | component | `npx vitest run "src/app/(dashboard)/allocations/HoldingsTabPanel.unpriced-check.test.tsx"` | NEW | no note rendered pre-fix |
| HOLD-05 | producer emits grouped attributed ids incl. a group with no dated gap | unit | `npx vitest run "src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts"` | extend | export missing / group absent |
| HOLD-05 | two-account render names B1 and B2 by label, no fallback; P1-P4 | component | `npx vitest run "src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx"` | extend | pre-fix leaves B1/B2 unnamed (probe-measured) |
| HOLD-05 | two-key literal stays a GREEN regression with its updated text | component | same file | extend | n/a (green-only) |
| HOLD-05 | new registry entry judged | unit | `npx vitest run src/lib/degrade-warnings.test.tsx` | extend | no sample |
| censuses | copy, computed-at, holding-scope-key, recompute-verdict, scan | unit | `npx vitest run src/__tests__/copy-census.test.ts src/__tests__/computed-at-reader-census.test.ts src/__tests__/holding-scope-key-census.test.ts src/__tests__/recompute-verdict-census.test.ts src/__tests__/degrade-warning-scan.test.ts` | exist | count moves |

### Sampling Rate
- **Per task commit:** the single file(s) the task edits.
- **Per wave merge:** the census set above plus `npm run typecheck`, and for HOLD-02 the mypy command.
- **Phase gate:** CI's full suite green bound to the head SHA with the expected check count (CLAUDE.md), plus PROOF-01 transcripts in each SUMMARY.

### PROOF-01 per gate (cp + cmp, verbatim in each SUMMARY)
For each new gate: byte-backup the production file, apply the neuter (revert the fix: HOLD-01 restore the `?? ` fallbacks; HOLD-02 revert the Python edit; HOLD-04 drop the flag/capture or the mount; HOLD-05 return the old `causesPrinted` logic), run the named test and record the RED arm, `cp` back, `cmp` identical, run GREEN. HOLD-02's TS replay additionally needs a neutered copy of the reader's marker branch to prove the fixture bites on that side.

### Wave 0 Gaps
- [ ] `analytics-service/tests/fixtures/native_unpriced_account_day_cases.json` (shared case table)
- [ ] `src/lib/native-unpriced-account-day.parity.test.ts` and `analytics-service/tests/test_match_native_unpriced_account_day.py`
- [ ] `queries.my-allocation.test.ts`: marker-only failure injection key at both injection points
- [ ] Two new render-test files (T5/T6/T9)
- [ ] No framework install needed.

### Pre-existing red, record so it is not blamed on this phase
`src/lib/factsheet/compute.conventions.test.ts` fails 2 snapshot tests on the clean tree (run twice this session: 2 failed, 21 passed; `git status` clean). `src/lib/return-stats.single-source.test.ts` failed 3 tests once inside a 500-file parallel run with the neuter in place, but passes alone both on the clean tree and with the neuter (34/34 each): a load flake, not a source-reading pin on `queries.ts`. Do not treat either as caused by this phase.

## Security Domain

`security_enforcement` is unset in `.planning/config.json`, which means enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (no auth change) | existing |
| V3 Session Management | no | existing |
| V4 Access Control | yes (owner scoping) | every read keeps `.eq("user_id"/"allocator_id", userId)`; the new payload groups carry only the owner's own key ids and are filtered against `ownKeyIds`; labels resolve only via the owner's key list (T-198-17, T-186-18) |
| V5 Input Validation | yes (marker payload is service-written JSONB, still read defensively) | `nativeUnpricedDay` / `native_unpriced_day` strict ISO-day parse (existing); the matcher's new comparison reuses ISO-string ordering like today |
| V7 Error Handling and Logging | yes | no raw key ids or account identifiers in Sentry (supabase message scrubbed by `captureToSentry`; `venue_account_id` never enters the payload or the new groups field); the HOLD-01 error names only the owner's own key id |
| V6 Cryptography | no | n/a |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant key id in a payload group | Information disclosure | filter to `ownKeyIds`; render by label only |
| Marker forgery to hide a key's rows | Tampering | markers live in `allocator_equity_derived` with owner SELECT only (service-role writes) `[CITED: latest-holdings-per-key.ts:204-217 docblock]`; unchanged |
| Capture flood from the 30 s poll | Denial of service (observability) | `shouldCaptureDerivedRowRejection` window |
| Account identifier leak via the new groups field | Information disclosure | groups carry key ids only, never `accountId` |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The proposed undated sentence ("these keys read one exchange account and every one of them is failing to sync.") is acceptable DESIGN.md Voice; CONTEXT leaves its copy to Claude's discretion, founder may override. | HOLD-05 | Wording rework only; the registry pin test and snapshot move with it. |
| A2 | Tags `{ op, reason, area }` together satisfy CONTEXT's "an `area` tag" without breaking this file's `op`/`reason` convention. | HOLD-04 | If the founder wants `area` only, drop `op`/`reason`; Sentry filters on `op` would not match. |
| A3 | Reusing the 6 h per-instance capture window for the marker-read failure is acceptable (one Sentry event per window per instance, not per poll). | HOLD-04 | If the founder wants every poll captured, remove the `shouldCapture...` guard; volume rises. |
| A4 | The TS reader's result for the two HOLD-02 probe cases is 0 (derived by reading the code, not by running them this session). | HOLD-02 | The new parity test will show it; a different TS result would mean the fixture's expectations need re-derivation by hand. |
| A5 | `account_identity_tokens` (Python) groups the probe's two MT5 keys the same way `accountIdentityTokens` (TS) does (same login and server). The twins are pinned by `analytics-service/tests/fixtures/venue_server_identity.json` per the TS docblock. | HOLD-02 | A grouping difference would surface in the new replay, not silently. |
| A6 | Test-count and `tripHits` deltas (+1 for the Overview row, 1 for the Holdings row) are expected values and must be re-measured. | HOLD-04 | The scan test fails with both counts printed if wrong. |
| A7 | Plan split: wave 1 = HOLD-01 and HOLD-02 in parallel; wave 2 = HOLD-04; wave 3 = HOLD-05 (HOLD-04 and HOLD-05 share `queries.ts`, both degrade registry/test files, the scan ledger and `AllocationDashboardV2.tsx`). | Plan split | Parallel HOLD-04/05 would collide on those shared files. |

## Open Questions (RESOLVED)

1. **Strict `derivePhase07Fields` versus the seven fixtures.**
   - Known: seven tests break; the other callers are unaffected.
   - Unclear: nothing technical; it is a planner choice.
   - Recommendation: keep the `= {}` default, strict lookup, rewrite the seven fixtures with an explicit identity map.
   - RESOLVED: adopted as 235-01-PLAN.md planner decision 1.
2. **`area` versus `op`/`reason` Sentry tags.** Recommendation: both (A2); record the choice in CONTEXT's decision log at plan time. RESOLVED: 235-03-PLAN.md planner decision 1 (`op`, `reason` and `area`).
3. **Capture throttling (A3).** Recommendation: reuse the window; the founder may prefer every-poll capture. RESOLVED: 235-03-PLAN.md planner decision 2 (the 6 h window is reused; the founder may override at review).
4. **SC-2 "unpriced days".** No output field exists. Recommendation: treat "equal" as the same counted rows and total (the fixture asserts both); do not add a field. RESOLVED: 235-02-PLAN.md planner decision 3.
5. **Two-key GREEN regression's expected text changes** (fallback becomes the undated labelled line). Recommendation: state the change in the plan so the executor updates the expectation deliberately. RESOLVED: 235-06-PLAN.md planner decision 2 (arm M6 carries the new expectation).

## Ship checklist (TODOS and citations)

Delete in the ship PR and name in the CHANGELOG entry (CLAUDE.md rule (b)); line numbers are positions today, re-find by id:
- `TODOS.md`: bullet `[198-SHARED-ACCOUNT-FALLBACK-UNNAMED]` (line ~304, a single bullet); the three `###` blocks `170.4-IDENTITY-READ-COMPLETENESS` (~2946-2954), `170.4-DASHBOARD-MARKER-READ-SILENT` (~2956-2965) and `170.4-MATCH-UNPRICED-PER-KEY` (~2976-2984), each up to the next heading.
- Files that cite the ids, measured with `grep -rl -a`: `CHANGELOG.md` (history lineage, leave), `.planning/REQUIREMENTS.md` (its `covers:` ids), `.planning/research/v1.22/*.md`, the 170.4 milestone phase docs, and this phase's own CONTEXT/UI-SPEC/DISCUSSION-LOG. **No `src/`, `scripts/`, `analytics-service/`, `docs/` or `CLAUDE.md` file cites any of the four ids** `[VERIFIED: grep -rl -a for each id, excluding node_modules/.git/.next/.venv]`, so nothing outside `.planning`, `TODOS.md` and `CHANGELOG.md` needs a pointer fix. The ship branch must change nothing under `.planning` (guard), so planning edits go to main afterwards.
- `src/__tests__/lint-migration-data-dependence.test.ts` is the only test that reads `TODOS.md` (line ~274, for an unrelated entry); deleting these four entries does not move it `[VERIFIED: grep of readFileSync TODOS in src and scripts]`.

## Sources

### Primary (HIGH confidence, read or run in this worktree this session)
- `src/lib/latest-holdings-per-key.ts`, `src/lib/portfolio-exposure.ts`, `src/lib/holdings-account-day.ts`, `src/lib/departed-history.ts`, `src/lib/queries.ts` (derive, payload type, both return literals, capture helpers), `src/app/api/allocator/scenario/commit/route.ts`
- `analytics-service/routers/match.py`, `analytics-service/services/allocator_positions.py`, the three existing marker pytest files, `tests/fake_postgrest.py`
- `src/app/(dashboard)/allocations/{lib/key-data-gaps.ts, components/MissingDataMessage.tsx, AllocationDashboardV2.tsx, HoldingsTabPanel.tsx, AllocationsTabs.tsx, page.tsx}`
- `src/lib/degrade-warnings.ts`, `src/lib/degrade-warnings.test.tsx`, `src/__tests__/degrade-warning-scan.test.ts`, `scripts/copy-census/policy.ts`
- Probes (all restored with cp + cmp, worktree clean): strict-lookup neuters over `queries.ts`, `latest-holdings-per-key.ts`, `route.ts`; a temporary S3 vitest; a temporary HOLD-02 pytest.
- `235-CONTEXT.md`, `235-UI-SPEC.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` `### Phase 235`.

### Secondary / Tertiary
- None. No web or library-docs lookup was needed: every question is about in-repo behaviour and no package is added.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, nothing new.
- Architecture: HIGH, each edit site read and each strictness change run against its dependent tests.
- Pitfalls: HIGH for fixture and census findings (measured); MEDIUM for the exact post-fix TS reader result in the HOLD-02 probe cases (A4) until the new parity test runs.

**Research date:** 2026-11-26
**Valid until:** 2026-12-10 (the touched files move fast; re-measure line anchors and `tripHits` before editing)
