---
phase: 244-accessguards
reviewed: 2026-11-27T11:55:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/lib/types.ts
  - src/lib/queries.ts
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/StrategyGrid.tsx
  - src/__tests__/api-key-id-compile-guard.test.ts
  - src/__tests__/audit-coverage.test.ts
  - src/app/api/admin/partner-import/route.ts
  - src/app/api/cron/flag-monitor/route.ts
  - src/app/api/keys/sync/route.ts
  - src/app/api/strategies/finalize-wizard/route.ts
  - e2e/discovery-watchlist.spec.ts
  - .github/workflows/ci.yml
  - src/__tests__/e2e-seeded-hydration-guard.test.ts
  - src/__tests__/discovery-watchlist-e2e-wiring.test.ts
findings:
  critical: 0
  warning: 2
  info: 7
  total: 9
  necessity: 1
status: clean
---

# Phase 244: Code Review Report

**Reviewed:** 2026-11-27T11:55:00Z
**Depth:** standard (with call-chain reads into `src/proxy.ts`, `getMyStrategies` / `shapeRankingRows`, the owner `/strategies` page and the partner-import catch path)
**Files Reviewed:** 14 (`git diff 45d7b4e5c..HEAD -- . ':!.planning'`)
**Status:** issues_found

## Summary

No CRITICAL or HIGH findings. There are two MEDIUM findings, and neither is user-facing or a data-integrity issue.

- **DBACC-05 holds.** All six H-0001 sites now carry an in-window `@audit-skip:` pragma, and `audit-coverage.test.ts` passes with the allowlist at 0. Each reason is accurate:
  - The two flag-monitor upserts write the `ZERO_DENOM_STREAK_KEY` counter.
  - Both finalize-wizard upserts write a `computation_status: "failed"` stamp, and so does keys/sync.
  - The partner-import `profiles` upsert is rolled up. Every upsert that lands advances `managers_created` (route.ts:719), so it reaches the catch-path or success-path `admin.partner_import` roll-up. `observedPartialCompletion` includes `managers_created` (:855-858), and `mapConcurrent` awaits every in-flight worker before it rethrows (:347-351).
- **DBACC-06 placement holds.**
  - The spec is in the `else` arm of the `e2e-seeded` list (ci.yml:7140-7166). `e2e-seeded` is in the `frontend` aggregator's `needs` (ci.yml:3819).
  - The lane handoff exits 1 on an empty URL, anon key or service key (ci.yml:6853-6864).
  - `manager-keys-e2e-wiring.test.ts` pins step-level tolerance for every listed spec.
- **The 307 arm holds.** `src/proxy.ts:89-93` answers a cookie-less non-public path with `NextResponse.redirect` to `/login` before any route handler runs. The arm uses `maxRedirects: 0`, asserts 307 and checks the Location pathname. It does prove that an anonymous (cookie-less) caller is refused.
- **DBACC-04 is weaker than its wording (WR-01).** The type guard proves that a value typed `PublicStrategy` cannot be assigned to `Strategy`. It does not make an owner read without `api_key_id` fail to compile, because every owner read gets its row type from an `as unknown as` cast of an unchecked select string. The caller should rule whether that is a goal gap or a recorded narrowing.
- **The wiring pin has gaps (WR-02).** It catches list removal, advisory placement, extra skips and a returning `if (anonKey)`. It misses three cheap edits that would make the RLS proof vacuous while CI stays green.

**Verification run on the branch head:**
- `npx tsc --noEmit --incremental false`: exit 0. `npm run typecheck` is `tsc --noEmit` on the default tsconfig, which includes `src/__tests__`. `frontend-typecheck` is in the aggregator `needs` (ci.yml:3810).
- vitest, the five phase test files: 68 passed.
- vitest, 22 neighbouring census and contract files that read `ci.yml` or the spec (`critical-regressions`, `local-stack-lane-wiring`, `contracts/`, `anon-strategies-projection` and others): 1976 passed.

**Not re-run by this review:** the e2e spec itself and the PROOF-01 neuters (the RLS `USING (true)` policy, the proxy `PUBLIC_ROUTES` neuter, the pragma removal, the optional-key neuter). For those, this review relies on the verbatim records in 244-01/02/03/04-SUMMARY.md.

**Review inputs:** the necessity rubric (`gsd-core/references/necessity-review.md`) was read. There is no `.claude/skills/` or `.agents/skills/` directory in the worktree.

Severity mapping: `WR-` = MEDIUM, `IN-` = LOW or INFO (the caller's own scale is noted on each finding).

## Warnings

### WR-01: DBACC-04 guard covers assignability, not owner reads. Every owner read is typed by a cast, and the shared table re-opens the key at its truth-test

**Severity:** MEDIUM · not user-facing · not data-integrity · **possible goal gap (SC-1), caller to rule**
**File:** `src/__tests__/api-key-id-compile-guard.test.ts:61-63` (ARM-OWNER-READ); `src/lib/queries.ts:1158-1170` (`getMyStrategies`), `src/lib/queries.ts:769-786` (`shapeRankingRows`); `src/app/(dashboard)/strategies/page.tsx:118-123,560-571` (`OwnerListRow` cast); `src/components/strategy/StrategyTable.tsx:77,1884`
**Symbol:** `_typeAssertions` ARM-OWNER-READ, `getMyStrategies`, `shapeRankingRows`, `StrategyWithAnalytics` (StrategyTable/StrategyGrid)

**Problem:** SC-1 and DBACC-04 both say "an owner-surface read that lacks `api_key_id` fails to compile". The shipped guard does not do that for any real owner read:

- **`getMyStrategies` has no column check.**
  - It selects `*, strategy_analytics (*)` and casts the result `as unknown as { id; strategy_analytics }[]`.
  - `shapeRankingRows` then casts each row `as unknown as Strategy` and returns `RankedStrategyRow[]`.
  - Changing that select to `STRATEGY_PUBLIC_COLUMNS`, or to any list without `api_key_id`, compiles cleanly.
- **The owner `/strategies` page has the same hole.** It selects `*` and casts `listData as unknown as OwnerListRow[]`.
- **The edit page overrides its type the other way.** `src/app/(dashboard)/strategies/[id]/edit/page.tsx:60-65` reads with `.select("*")…single<Strategy & { source: string | null }>()`. The explicit generic sets the row type whatever the select string names.
- A select change that drops the key is invisible to tsc in all three places.
- **ARM-OWNER-READ is tautological.** `OwnerRow` is derived from `getMyStrategies`' declared return type, which is `Strategy & …` by construction. The arm can only go red if someone edits that annotation. It can never go red because the read lost its key.
- **The shared component re-opens the key.** `StrategyTable` / `StrategyGrid` now type their row as `PublicStrategy & { api_key_id?: string | null }`, so the key is optional again. In this component that type governs `s.api_key_id` in `(s.trust_tier === "api_verified" || s.api_key_id) && <VerifiedCheck />` (StrategyTable.tsx:1884). Per the comment at :1876-1883, that half of the check is what keeps the verified tick on an owner's unpublished drafts. TODOS `170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD` booked exactly this failure: owner code "truth-tests `strategy.api_key_id` … against a row that may be a public projection and silently read 'no key'". The component still accepts that shape without complaint.
- **The disclosed limits leave out the main hole.**
  - The test header's "Honest limit" names `shapeOf` and select strings, but not the `as unknown as` casts that type every owner read.
  - 244-01-SUMMARY "Known limits" says select strings "stay covered by `src/lib/anon-strategies-projection.test.ts` and the live anon probe". That test covers PUBLIC projections only. No test covers an owner select dropping the key.

**What the guard does prove:** a value already typed `PublicStrategy` / `PublicRankedStrategyRow` (the two public readers' return types) cannot be handed to `Strategy`-typed owner code (ARM-1 to ARM-4). Per the PROOF-01 record (244-01-SUMMARY:80-91), neutering the key to optional reds ARM-1, ARM-2 and ARM-4 as unused directives, and ARM-OWNER and ARM-OWNER-READ as real errors. ARM-3 does not flip, because `Omit` removes the key either way. That is a real but narrower guard.

**Fix:** pick one and record the choice in VERIFICATION:
1. **Add a source-scan pin** beside the type test. Every owner read of `from("strategies")` whose result is cast to `Strategy` / `OwnerListRow` / `RankedStrategyRow` must select `*` or name `api_key_id`. The reads are `getMyStrategies`, the `ownerList` read in `strategies/page.tsx` and the `[id]/edit/page.tsx` read. The pin should go red on a neutered select.
2. **Take the key out of the shared table.** The caller computes the verified flag (for example `verified: boolean` on the row, from the required key on owner rows and from `trust_tier` on public rows). Then `StrategyTable` / `StrategyGrid` never read `api_key_id`, and their row type can be plain `PublicStrategy`.
3. **Narrow the wording.** Record SC-1 as narrowed to "a public-projection row cannot reach an owner surface typed `Strategy`", with the cast hole named, and route the rest. Also fix the header and SUMMARY limit notes so they name the casts and drop the anon-projection-test claim.

#### Fix round 1 (WR-01, option 1)

**Applied:** a source-scan pin, `src/__tests__/api-key-id-owner-read-pin.test.ts`. It enumerates four owner reads exactly (`getMyStrategies`, the `/strategies` `ownerList` read, the `[id]/edit` read, and the `/compare` read, which also selects `*` and casts to `Strategy & {…}`) and asserts each `.select(` literal starts with `*` or names `api_key_id`. A non-literal select, or a missing anchor, `.from` or `.select(`, fails. A second arm pins the per-file count of owner-type cast tokens across all non-test `src/` files (`queries.ts` 2, `strategies/page.tsx` 1, `[id]/edit/page.tsx` 1, `compare/page.tsx` 2), so a new or removed cast site reds until both tables are updated. The compile-guard header and the 244-01-SUMMARY "Known limits" now name the casts and drop the claim that `anon-strategies-projection.test.ts` covers owner selects.

**Limit, recorded honestly:** the scan reads source text. It misses an owner read typed by an idiom the cast regex does not name or a select assembled elsewhere. It does not touch the shared-table half of WR-01 (`StrategyTable` / `StrategyGrid` still type the key optional); that remains open and is not fixed here.

**PROOF-01 (byte-backed neuters, restored with `cp` and verified with `cmp`):**
- NEUTER A: `getMyStrategies` select changed to `` `${STRATEGY_PUBLIC_COLUMNS}, strategy_analytics (*)` ``. `npx tsc --noEmit` stayed GREEN (exit 0, no output), which re-proves the review's hole. The pin went RED: `getMyStrategies: select does not start with * and does not name api_key_id (src/lib/queries.ts): ${STRATEGY_PUBLIC_COLUMNS}, strategy_analytics (*)` (1 failed, 5 passed). Restored, `cmp` clean.
- NEUTER B: the edit page `.select("*")` changed to `.select("name, source")`. RED: `strategy edit page: select does not start with * and does not name api_key_id (src/app/(dashboard)/strategies/[id]/edit/page.tsx): name, source`. Restored, `cmp` clean.
- NEUTER C: a new file with an owner-type cast (`src/lib/zz-neuter-census.ts`). RED on the census arm, diff line `+ "src/lib/zz-neuter-census.ts": 1`. File removed.
- GREEN after all restores: `git diff` of `queries.ts` and the edit page empty, `npx tsc --noEmit` exit 0, `vitest run` on the pin, `api-key-id-compile-guard.test.ts` and `src/lib/anon-strategies-projection.test.ts`: 3 files, 13 tests passed.

### WR-02: The wiring pin misses three edits that would make the RLS proof vacuous while CI stays green

**Severity:** MEDIUM · not user-facing · not data-integrity · not a goal gap (the spec runs and can fail today)
**File:** `src/__tests__/discovery-watchlist-e2e-wiring.test.ts:103-150`
**Symbol:** `"the spec skips only on its seed precondition…"`, `"the primary RLS proof cannot skip on a missing anon key"`, `"the RLS and auth anchors are present"`

**Problem:** the pin's header says it stops the spec "quietly [ceasing] to mean anything". These three edits pass every arm:

1. **A client-side filter on the bare SELECT.** `.from("user_favorites").select("user_id, strategy_id").eq("user_id", userBId!)` makes `aRowsVisibleToB` empty whatever RLS does. The spec's own comment (spec:367-376, `rls-masked-by-explicit-filter`) records this as a real past masking defect. The anchor `'.from("user_favorites")'` is a whole-file substring check, and the spec contains it three times (the admin upsert :357, the bare SELECT :406, the cleanup :486), so it holds even if the bare SELECT were deleted outright.
2. **A widened or renamed `HAS_SEED_ENV`.** For example, a third `&& !!process.env.X` the lane does not export, or a renamed key. The whole describe, RLS proof included, then skips, and Playwright exits 0 on skips. Nothing in `ci.yml` counts skips.
   - The arm checks `.skip(` count == 1 and the regex `/\btest\.skip\(\s*!HAS_SEED_ENV\b/`. That regex also passes `test.skip(!HAS_SEED_ENV || somethingElse, …)`.
   - Nothing reads the constant's definition (spec:49-51).
   - The lane handoff's `exit 1` arms do not help: the env is present and the spec stops looking at it.
3. **An early return on a missing key.** `if (!anonKey) { console.warn("TEST_SUPABASE_ANON_KEY missing"); return; }` passes. The `/if\s*\(\s*anonKey\s*\)/` regex does not match `!anonKey`, and the message substring is still present.

The header defers (2) to "the `e2e-seeded` log on the PR head SHA". That is a one-time human reading, not a gate.

**Fix:** keep it small:
- (1) Pin the bare-select statement itself. Match `.from("user_favorites")\s*\.select("user_id, strategy_id")\s*;` on the `userBClient` chain, so a chained `.eq/.match/.filter/.in` before the `;` reds it.
- (2) Pin `HAS_SEED_ENV`'s definition to exactly the env names the handoff step exports (read them from the `printf 'TEST_SUPABASE_…=%s'` lines in `ci.yml`). Tighten the skip regex to `test\.skip\(\s*!HAS_SEED_ENV\s*,`.
- (3) Forbid `if (!anonKey)` and any `return` between the anon-key `expect` and the `RLS LEAK` assertion.
- Alternative to (2): follow the `manager-keys.spec.ts` precedent (ci.yml comment at :7174-7178) and drop the place-2 skip, so a lost seed env fails rather than skips.

**Fix round 1 (2026-11-27, fixed in `78ff8b721`):** `src/__tests__/discovery-watchlist-e2e-wiring.test.ts` gained four arms and one tightened regex; nothing was dropped (the place-2 skip stays).
- (1) `user-B's SELECT is bare and the RLS assertion reads the unfiltered result`: the `userBClient.from("user_favorites")` chain must be `.select("<one string>");` with nothing chained after it, `aRowsVisibleToB` must be `(leakRows ?? []).filter((r) => r.user_id === userAId)`, and `expect(aRowsVisibleToB, ...).toHaveLength(0)` must be present.
- (2) `HAS_SEED_ENV is exactly the two env names the lane handoff exports`: the definition is read from the spec and must be `!!process.env.TEST_SUPABASE_URL && !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY`, and each name must be exported by a `printf '<NAME>=%s` line in `ci.yml`. The skip regex is now `/\btest\.skip\(\s*!HAS_SEED_ENV\s*,/`, so nothing can be ORed in.
- (3) `nothing between the anon-key assertion and the RLS LEAK assertion can return early or branch`: the text from `const anonKey =` to the RLS LEAK message must hold `expect(anonKey, ...).toBeTruthy()` and no `return` and no `if (`.
- PROOF-01 (byte backups of the spec and `ci.yml` in the session scratchpad, restored with `cp`, `cmp` = 0 after every neuter, no git checkout/restore/stash). Each neuter went RED on the named arm only (1 failed, 8 passed); the final rerun is 9 passed:
  - `.eq("user_id", userBId!)` chained on the bare select: RED `user-B's SELECT is bare ...` (message `user-B's user_favorites read is no longer a bare ...`).
  - third env `&& !!process.env.TEST_SUPABASE_BOGUS` in `HAS_SEED_ENV`: RED `HAS_SEED_ENV is exactly the two env names ...`.
  - `test.skip(!HAS_SEED_ENV || !process.env.TEST_SUPABASE_BOGUS, ...)`: RED `the spec skips only on its seed precondition ...` (`no longer exactly test.skip(!HAS_SEED_ENV,`).
  - `if (!anonKey) { return; }` after the anon-key assertion: RED `nothing between the anon-key assertion and the RLS LEAK assertion ...` (`a return sits between ...`).
  - `toHaveLength(0)` changed to `toHaveLength(1)`: RED `user-B's SELECT is bare ...` (`no longer asserts expect(aRowsVisibleToB, ...).toHaveLength(0)`).
  - `r.user_id === userAId` changed to `=== userBId`: RED `user-B's SELECT is bare ...` (`aRowsVisibleToB is no longer ...`).
  - the `TEST_SUPABASE_SERVICE_ROLE_KEY` `printf` line deleted from `ci.yml`: RED `HAS_SEED_ENV is exactly ...` (`the lane handoff ... no longer exports TEST_SUPABASE_SERVICE_ROLE_KEY`).


## Info

### IN-01: The 307 arm proves only cookie-less refusal. The route's real `getUser` 401 has no live proof

**Severity:** LOW
**File:** `e2e/discovery-watchlist.spec.ts:272-320`; `src/proxy.ts:67-93`
**Symbol:** `"unauthenticated PUT to /api/watchlist is bounced…"`
**Problem:** the proxy gate is `getSession()`, which only reads the cookie. A caller holding a forged or expired session cookie passes the proxy, and only the route's `if (!user) return 401` stands in the way. That guard is proven only by the mocked `src/app/api/watchlist/[strategyId]/route.test.ts:184`. This is not a regression: the old 401 arm never reached the route either (244-03-SUMMARY:48-55). The new arm's claim (an anonymous caller is refused before the route runs) is accurate.
**Fix:** optional. Add a seeded arm that sends a syntactically valid but revoked or garbage `sb-*` cookie and expects 401 from the route.

### IN-02: Retained Origin pin and CSRF rationale in the 307 arm (necessity: already-defended-elsewhere)

**Severity:** INFO
**File:** `e2e/discovery-watchlist.spec.ts:293-305`
**Category:** necessity
**Problem:** the comment says the Origin header stops `assertSameOrigin` masking the auth regression. The proxy redirects before the route's `assertSameOrigin` runs (`src/proxy.ts:89-93`), so on the path this arm asserts, CSRF never runs. This is a judgment call: the header still sharpens the failure under the `PUBLIC_ROUTES` neuter (a 401 instead of a 403).
**Fix:** reword the comment to "only matters if the proxy gate stops covering this path", or drop the header.

### IN-03: The audit-coverage lineage comment says a TODOS entry is deleted, but it still exists on the branch

**Severity:** LOW
**File:** `src/__tests__/audit-coverage.test.ts:1697-1699`
**Problem:** "the 2026-08-26 TODOS.md census entry, deleted when Phase 244 closed H-0001". `TODOS.md:1781` (H-0001) is still on the branch, as are `:3126` (`170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD`) and the `:4025` 158-OPS-03 bullet.
**Fix:** the ship PR deletes all three and names them in the CHANGELOG (CLAUDE.md "TODOS.md holds open work only", rule b). If WR-01 resolves as a narrowing, re-point the 170.6.1.1 entry instead of deleting it.

### IN-04: Public category rows are cast to `Strategy` inside `shapeRankingRows` before the return narrows

**Severity:** LOW
**File:** `src/lib/queries.ts:773,777`
**Symbol:** `shapeRankingRows`
**Problem:** `getStrategiesByCategory` passes key-free rows through `s as unknown as Strategy`. Inside `queries.ts` a public row is typed as an owner row until the declared `PublicRankedStrategyRow` return. A future `strat.api_key_id` read inside `shapeRankingRows` compiles and reads `undefined` for public rows. This is the same class as WR-01, contained to one function.
**Fix:** make `shapeRankingRows` generic over `PublicStrategy` (spread `PublicStrategy`, return `Omit<RankedStrategyRow,"api_key_id">`). `getMyStrategies` then re-adds the key from its typed row.

### IN-05: Site 1 "COVERED" rests on a roll-up whose emit failure is swallowed (pre-existing)

**Severity:** INFO
**File:** `src/app/api/admin/partner-import/route.ts:877-897,1005-1030`
**Problem:** both roll-up `emitAsUser` calls are wrapped in a try/catch that logs and continues. If the audit RPC fails, a landed `profiles` upsert ends with no audit row. This predates the phase and is a deliberate non-fatal choice. Noted only because DBACC-05 counts this site as covered by a real row.
**Fix:** none required for this phase.

### IN-06: Founder-exemption pragmas carry no extra weight in the gate

**Severity:** INFO
**File:** `src/app/api/cron/flag-monitor/route.ts:499,640`; `src/app/api/keys/sync/route.ts:593`; `src/app/api/strategies/finalize-wizard/route.ts:2539,2686`
**Problem:** the gate reads any `@audit-skip:` text. "founder exemption 2026-11-26 (Phase 244 DBACC-05)" is prose, so a later `@audit-skip` can cite a founder exemption that was never given, and nothing ties the five sites to the CONTEXT decision.
**Fix:** optional. Add a small pin that `founder exemption` pragmas appear only at an allowlisted set of (file, snippet) pairs.

### IN-07: The advisory-list check scans only the line that carries `e2e/smoke.spec.ts`

**Severity:** INFO
**File:** `src/__tests__/discovery-watchlist-e2e-wiring.test.ts:88-102`
**Problem:** the spec could be added to any other `continue-on-error` or unaggregated Playwright invocation, a new advisory step for example, and still pass. This is the same shape as the manager-keys pin.
**Fix:** optional. Assert that the spec path appears in exactly one uncommented `npx playwright test` invocation in `ci.yml`, the seeded `else` arm.

---

_Reviewed: 2026-11-27T11:55:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure-hunter findings (round 1, merged by the orchestrator)

### SFH-M1 (MEDIUM) — the anonymous /browse block can pass without rendering the table
File: `e2e/discovery-watchlist.spec.ts`, describe "DISCO-01 watchlist — public/anon path (no allocator chrome)". Every assertion is an absence check (`toHaveCount(0)` on star, cog, tab; status < 400; not on login). If `/browse/crypto-sma` renders an empty or error state the userId-gated chrome never mounts and the test passes vacuously. Fix: before the absence checks, assert a positive render (a strategy table row visible, or the explicit empty-state text if the seeded lane has no crypto-sma row; never accept the error boundary). Confirm on the local-stack lane.

**Fix round 1 (2026-11-27, fixed in `410353152`):** `e2e/discovery-watchlist.spec.ts`, anon `/browse/crypto-sma` test: before the absence checks it now asserts (a) the root error boundary heading ("Something went wrong") has count 0 and (b) `table tbody tr` has a visible first row. `StrategyTable` renders a `tbody` row either for a strategy or for its explicit "No strategies match your filters." row, so (b) accepts both an occupied and an empty table and rejects an error or an unmounted table. On the seeded lane `/browse/crypto-sma` renders the empty-state row (no public strategy in that category), so on the lane (b) is satisfied by the explicit empty-state text.
- Lane run (local-stack lane only, as in 244-03-SUMMARY: `--check-currency` `carried=344 replay=0 marker-sha=match defects=0`, `up` exit 0, `--assert-local-handoff` exit 0, seed exit 0, build exit 0 with the three inline checks OK, `npm run start` with `NEXT_PUBLIC_ALLOWED_ORIGINS=http://localhost:3000`): `CI=true npx playwright test e2e/discovery-watchlist.spec.ts --timeout 60000`, exit 0, `4 passed`, no skipped, flaky or did-not-run line. Rerun against the restored tree after the neuters: `4 passed (4.8s)`, exit 0.
- PROOF-01 on the row assertion. Neuter: `src/app/browse/[slug]/page.tsx` with the `<StrategyTable ... />` element removed (backup `cp`, restored, `cmp` = 0, `git diff --quiet` clean; rebuilt, inline checks OK; served HTML held 0 `<tbody`). The page still answers 200, so the pre-fix spec (the committed version, run from a temporary copy, deleted afterwards) PASSED vacuously: `1 passed`. The fixed spec went RED: `anon /browse/crypto-sma rendered no strategy table row and no 'No strategies match your filters' row — the page did not render the table, so the absence checks below would be vacuous` (`Locator: table tbody tr`, `element(s) not found`).
- PROOF-01 on the error-boundary assertion (spec-only neuter, backup restored, `cmp` = 0): heading name changed to `/crypto/i`, which the real page heading matches. RED: `anon /browse/crypto-sma rendered the root error boundary ... Expected: 0, Received: 1`. A real 200-status error boundary was not reproduced (a throwing page answers a non-2xx status that the earlier status check already catches), so this arm is shown to be able to fail but not driven by a real boundary render.
- Docker: Docker Desktop was not running and was started by this fix; lane `down` exit 0, `--assert-teardown` exit 0 (surviving quantalyze containers 0), project volumes 0, port 3000 free (server stopped by listener PID after its cwd was checked to be this worktree), `lane.env` and `.stack-env` removed.

### SFH-M2 (MEDIUM) — same class as WR-02
`src/__tests__/discovery-watchlist-e2e-wiring.test.ts` anchors are satisfiable by unrelated text: `.from("user_favorites")` appears three times; message strings survive a weakened matcher; any `toBe(307)` satisfies the 307 anchor. Fix: pin `userBClient .from("user_favorites") .select(` with no `.eq(` in that chain, pin `.toHaveLength(0)` on `aRowsVisibleToB`, pin `toBe(307)` on the `res.status()` assertion. Fix together with WR-02.

**Fix round 1 (2026-11-27, fixed in `78ff8b721`, together with WR-02):** the three pins this finding names are in the same commit. Bare-select shape and `.toHaveLength(0)` on `aRowsVisibleToB`: the `user-B's SELECT is bare ...` arm. `toBe(307)` bound to `res.status()`: the new arm `the anonymous PUT arm asserts the status itself is 307` requires `expect(res.status(), ...).toBe(307);`, so another `toBe(307)` elsewhere no longer satisfies it. PROOF-01: `.toBe(307)` on the status changed to `.toBe(401)` with a decoy `expect(307).toBe(307);` appended. The old anchor arm stayed green (the decoy satisfied it), the new arm went RED (`no expect(res.status(), ...).toBe(307) ... another toBe(307) elsewhere does not count`), `cmp` = 0 after restore, GREEN 9 passed. The bare-select and `toHaveLength(0)` neuters are listed under WR-02.

## Round 2

**Reviewed:** 2026-11-27T12:20:00Z · **Reviewer:** Claude (gsd-code-reviewer) · **Depth:** standard
**Scope:** `git diff 3b3dc0178..HEAD -- . ':!.planning'`. The files are `e2e/discovery-watchlist.spec.ts`, `src/__tests__/api-key-id-compile-guard.test.ts`, the NEW `src/__tests__/api-key-id-owner-read-pin.test.ts` and `src/__tests__/discovery-watchlist-e2e-wiring.test.ts`. Call-chain reads went into the four pinned owner-read sites, `StrategyTable` / `StrategyGrid` and their three mount sites, `src/lib/supabase/{server,client}.ts`, the browser-client `strategies` reads, `e2e/helpers/discovery-selectors.ts` and the spec's user-B block.

**Verification run on the branch head:**
- `npx vitest run` on the pin, `api-key-id-compile-guard`, `discovery-watchlist-e2e-wiring`, `src/lib/anon-strategies-projection.test.ts` and `manager-keys-e2e-wiring`: 5 files, 26 tests passed.
- `npx tsc --noEmit --incremental false`: exit 0.
- An in-memory neuter of the pin's site check, run as a scratchpad node script that replicates `mask` / `selectArgAfter` / `namesKey`, with no source edited. Each site's select was swapped for a bare identifier (`.select(STRATEGY_PUBLIC_COLUMNS)`). All four sites go RED. For the result see IN-08.
- `grep -c` of `printf 'TEST_SUPABASE_URL=%s` and `printf 'TEST_SUPABASE_SERVICE_ROLE_KEY=%s` in `ci.yml`: 1 each.

**Not re-run by this review:** the e2e spec on the local-stack lane, and the fixer's PROOF-01 neuters. For the SFH-M1 lane result (`4 passed`, no skips) and the neuter REDs, this review relies on the fixer's verbatim records above.

### Per-finding verdicts

| Finding | Verdict | Basis |
|---|---|---|
| WR-01 | **RESOLVED (owner-read select half, via option 1). SC-1 to be RECORDED AS NARROWED in mechanism. Shared-table remainder is LOW.** | See below |
| WR-02 | **RESOLVED** | All three named edits now red a named arm. The spec also asserts `signInErr` and `leakErr` are null (spec ~:400-411), so a failed sign-in or query cannot yield an empty, green array. |
| SFH-M1 | **RESOLVED** (spec not re-run here) | `SELECTORS.tableRows` is `table tbody tr` (`e2e/helpers/discovery-selectors.ts:49`). `StrategyTable` renders "No strategies match your filters." inside a `<tr>` in its `tbody` (`StrategyTable.tsx:2244-2247`). A positive row is therefore required, and an occupied or an empty table both satisfy it. The fixer's neuter (table element removed) showed the old spec passing vacuously and the new spec red. |
| SFH-M2 | **RESOLVED** | `expect(res.status(), …).toBe(307);` is bound to the status call. The bare-select chain and `toHaveLength(0)` on `aRowsVisibleToB` are pinned. A decoy `toBe(307)` no longer satisfies the arm. |

**WR-01 / SC-1 ruling.**
- **What is now gated.** The owner reads whose row type comes from a cast or an explicit generic are `getMyStrategies`, the `/strategies` `ownerList` read, `[id]/edit` and `/compare`. Each fails CI if its select stops starting with `*` and stops naming `api_key_id`. The cast census reds on a new cast site that is not enrolled. That is option 1 from round 1, which round 1 offered as a full fix.
- **Reads with no cast.** The typed server client (`createServerClient<Database>`, `src/lib/supabase/server.ts:9`) covers owner reads that do not cast. A dropped column there surfaces as a type error wherever the key is read. The untyped browser-client reads of `strategies` (`SyncProgress.tsx:287`, `ApiKeyManager.tsx:1009`, `SyncPreviewStep.tsx:817`) all name `api_key_id` explicitly.
- **Why SC-1 is narrowed, not met as written.** SC-1 says an owner read lacking the key "fails to compile, shown by a type-level test". That is not literally true. The fixer's NEUTER A showed `tsc` staying green with `getMyStrategies` on `STRATEGY_PUBLIC_COLUMNS`. VERIFICATION should record SC-1 as met by two mechanisms:
  - **Compile time:** a public projection cannot be assigned to `Strategy` (ARM-1 to ARM-4).
  - **CI-blocking source scan:** owner-read selects must keep the key.
- **Why this is not an open MEDIUM.** It is a wording record. Per round-1 IN-03, a narrowing also means TODOS `170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD` is RE-POINTED at ship, not deleted, because the shared-table half below stays open.
- **The shared-table remainder (LOW).** `StrategyTable` / `StrategyGrid` still type the row `PublicStrategy & { api_key_id?: string | null }`. The only owner mount is `StrategiesSection` (`StrategiesSection.tsx:226,322`), and its prop is `strategies: RankedStrategyRow[]`, with the key required. The other two mounts are public (`browse/[slug]`, `discovery/[slug]`) and rely on `trust_tier`. A public row handed to the owner section would therefore be rejected structurally at that prop. The hole is reachable only by a future owner mount that bypasses `StrategiesSection`, or by retyping its prop. No compile-guard arm pins the `StrategiesSection` prop explicitly. That is optional hardening and LOW.

### New findings introduced by the fix round

No new MEDIUM or higher finding. LOW and INFO findings, recorded here only (CLAUDE.md "TODOS.md holds open work only", rule a):

#### IN-08 (LOW): the pin's select extraction is not bounded to the read statement. A non-literal select is judged by a LATER literal, not failed
**File:** `src/__tests__/api-key-id-owner-read-pin.test.ts` (`selectArgAfter`, `checkSite`)
**Problem:**
- The header says a select "built from a variable or helper … FAILS". `selectArgAfter` actually takes the first `.select(` followed by a quote anywhere after `.from("strategies")`, with no bound on the statement.
- With `.select(STRATEGY_PUBLIC_COLUMNS)` (a bare identifier), the scan skips it and judges an unrelated later select:
  - `getMyStrategies` judges `"id"`.
  - `ownerList` judges `"id, name, created_at, review_note"`.
  - `edit` and `compare` find none.
- All four are red today, but by accident of what follows each site. If the next literal `.select(` in the file were `"*"` or named `api_key_id`, the neuter would pass.
- NEUTER A used a template literal, which the extractor does handle, so this path was never exercised.

**Fix:** require the select to sit on the same chain. Match `/\.from\(\s*["']strategies["']\s*\)\s*\.select\(\s*(["'`])/` from the `.from` index, and return null (FAIL) when `.select(` is not immediately followed by a quote.

#### IN-09 (INFO): the cast census regex names `.single<` and `as [unknown as] T[]` only
**File:** `src/__tests__/api-key-id-owner-read-pin.test.ts` (`CAST_RE`)
**Problem:** a new owner read typed as `.maybeSingle<Strategy>()`, `.returns<Strategy[]>()`, `as Array<Strategy>` or `as unknown as (Strategy & {…})[]` does not move the census, so it escapes enrolment. The header's honest limit covers this in general terms ("an idiom the cast regex does not name").
**Fix:** optional. Add `\.(?:maybeSingle|single|returns)<\s*(?:T)` and `as (?:unknown as )?(?:Array<|\(\s*)(?:T)` alternatives.

#### IN-10 (INFO): the `HAS_SEED_ENV` export check is a whole-file substring
**File:** `src/__tests__/discovery-watchlist-e2e-wiring.test.ts` (`HAS_SEED_ENV is exactly the two env names …`)
**Problem:** `printf '<NAME>=%s` is searched across all of `ci.yml`, not inside the `e2e-seeded` handoff step. Today each line occurs exactly once (measured with `grep -c`), so this has no current effect. A second job's handoff could keep the check green after the seeded job lost its export.
**Fix:** optional. Scope the search to the `e2e-seeded` job block.

#### IN-11 (INFO): the "no early exit" window forbids `return` and `if (` but not `try {` or a ternary
**File:** `src/__tests__/discovery-watchlist-e2e-wiring.test.ts` (`nothing between the anon-key assertion …`)
**Problem:** wrapping the RLS `expect` in a `try { … } catch {}` would swallow the leak and pass every arm. This is contrived, and the bare-select regex already blocks the ternary-on-`anonKey` form.
**Fix:** optional. Also forbid `\btry\b` and `\bcatch\b` in that window.

#### IN-12 (INFO): SFH-M1's error-boundary arm is shown able to fail only against a spec-side neuter
**File:** `e2e/discovery-watchlist.spec.ts` (anon `/browse/crypto-sma` test)
**Problem:** the fixer records this honestly. A real 200-status boundary render was not reproduced. The positive-row arm (b) carries the weight, and it was proven against a real page neuter.
**Fix:** none required.

### Round 2 verdict
No MEDIUM+ remains open. WR-02, SFH-M1 and SFH-M2 are resolved. WR-01 is resolved by option 1 for the owner-read selects. One action carries to VERIFICATION and to ship, and neither is an open code finding:
- Record SC-1 as narrowed in mechanism (compile-time assignability plus a CI-blocking select pin, not "fails to compile").
- Re-point TODOS `170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD` at the shared-table remainder instead of deleting it.

Frontmatter `status` set to `clean`. The `findings:` counts above are round 1's, left unchanged.

_Round 2 reviewed: 2026-11-27T12:20:00Z · Reviewer: Claude (gsd-code-reviewer) · Depth: standard_

## Round 2 silent-failure-hunter findings (merged by the orchestrator)

The round-2 reviewer rated the select-skip issue LOW (IN-08); the silent-failure hunter rated it MEDIUM. Taken as MEDIUM (the more conservative reading for a gate whose purpose is to be able to fail), so both items below go to a round-2 fixer and the status returns to `issues_found` until they land.

### SFH2-M1 (MEDIUM, same defect as IN-08) — owner-read pin skips a non-literal `.select(` and judges a later query's select
`src/__tests__/api-key-id-owner-read-pin.test.ts` `selectArgAfter`/`checkSite`: `.select(COLS)` is skipped and the next quoted `.select(` anywhere later in the file is judged. Fix: require `.from("strategies")` directly chained to `.select(` + quote (one regex on the masked text from the anchor); a non-literal select fails with "no literal .select(...) chained to .from(\"strategies\")".

**Fix round 2 (commit 1cb0e4673) — FIXED.** `selectArgAfter` now matches `^\.from\(\s*["']strategies["']\s*\)\s*\.select\(\s*(["'`])` at the first `.from("strategies")` after the anchor (one regex on the masked text). A bare identifier, helper call, or gap between `.from` and `.select(` returns null and `checkSite` fails with `no literal .select(...) chained to .from("strategies")`; no later query's select is judged. Header updated so its claim holds.
PROOF-01 (byte-backed copy via cp + cmp restore): `src/lib/queries.ts:1158` `.select(\`*, strategy_analytics (*)\`)` replaced by `.select(STRATEGY_PUBLIC_COLUMNS)` ->
```
 × getMyStrategies selects * or names api_key_id
AssertionError: expected 'getMyStrategies: no literal .select(.…' to be null
"getMyStrategies: no literal .select(...) chained to .from(\"strategies\") in src/lib/queries.ts"
 Tests  1 failed | 5 passed (6)
```
Restored, `cmp` clean; pin 6 passed.

### SFH2-M2 (MEDIUM) — the RLS proof can still be emptied with every pin green
`src/__tests__/discovery-watchlist-e2e-wiring.test.ts`: nothing pins that user-A's favorite is seeded (`admin.from("user_favorites").upsert({ user_id: userAId! …` and `expect(insertError…).toBeNull()`), nor that the bare SELECT runs on user-B's signed-in client (`userBClient.auth.signInWithPassword(`). Fix: add those three regex pins on `code` to the "user-B's SELECT is bare" arm.

**Fix round 2 (commit 1cb0e4673) — FIXED.** Three regex pins on `code` added to the "user-B's SELECT is bare" arm of `discovery-watchlist-e2e-wiring.test.ts`: `.from("user_favorites").upsert({ user_id: userAId!`, `expect(insertError, …).toBeNull();`, and `userBClient.auth.signInWithPassword(`. Header updated.
PROOF-01 (byte-backed copy of `e2e/discovery-watchlist.spec.ts`, cp + cmp restore after each), each red on the same arm with 8 of 9 passing:
- `userAId!` -> `userBId!` in the seed upsert: `AssertionError: user-A's favorite is no longer seeded by `.from("user_favorites").upsert({ user_id: userAId!`: … expected false to be true`
- `insertError` expect deleted: `AssertionError: the seed upsert's `expect(insertError, ...).toBeNull()` is gone: a failed seed would leave user-A with no row and the RLS proof green: expected false to be true`
- sign-in receiver renamed `userBClient.auth` -> `userAClient.auth`: `AssertionError: the sign-in is no longer `userBClient.auth.signInWithPassword(`: the bare SELECT would run on a client that is not user-B's session: expected false to be true`

GREEN after restore: `Test Files 3 passed (3) / Tests 16 passed (16)` (owner-read pin, wiring pin, compile guard); `npx tsc --noEmit --incremental false` exit 0.
