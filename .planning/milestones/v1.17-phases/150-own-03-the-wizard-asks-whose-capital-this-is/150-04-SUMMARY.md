---
phase: 150-own-03-the-wizard-asks-whose-capital-this-is
plan: 04
subsystem: api
tags: [next-route-handler, supabase, rls, rpc, audit, rate-limit, csrf, vitest, own-03, own-05]

# Dependency graph
requires:
  - phase: 150-01
    provides: strategies.capital_ownership column, the D-03-A INSERT trigger, and the flip_capital_ownership_to_team_review RPC this route calls
  - phase: 150-02
    provides: OWN_CAPITAL / TEAM_REVIEW constants and the CapitalOwnership type the closed-set validation imports
provides:
  - "PATCH /api/strategies/[id]/ownership — the retro mark write (D-09/D-11) with the 409/confirm/RPC flip arc"
  - "PATCH /api/strategies/[id]/name — the OWN-05 owner rename with a server-side private/draft gate"
  - "audit actions strategy.ownership_mark + strategy.rename, compile-enforced in both the TS map and the Python mirror"
affects: [150-06 Mark and Rename dialogs, 150-08 phase gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Owner-scoped route stack copied verbatim from the alias route, with the tenant predicate on the wire because strategies_update RLS has no WITH CHECK"
    - "Destructive state change is 409-until-confirmed, then ONE transaction via an RPC — never two sequential PostgREST calls"
    - "Reject-never-truncate for user-visible names, diverging from the alias route's silent cap"
    - "Route-test recorder that captures every .eq()/.in() in call order, so a dropped tenant or status predicate reddens rather than passing under RLS"

key-files:
  created:
    - src/app/api/strategies/[id]/ownership/route.ts
    - src/app/api/strategies/[id]/ownership/route.test.ts
    - src/app/api/strategies/[id]/name/route.ts
    - src/app/api/strategies/[id]/name/route.test.ts
  modified:
    - src/lib/audit.ts
    - analytics-service/services/audit.py

key-decisions:
  - "analytics-service/services/audit.py was edited too — a sixth file beyond the plan's five. The TS<->Python AuditAction parity test asserts exact set equality, so adding TS-only literals would have reddened pytest"
  - "The mark route carries NO status gate, deliberately: the retro path exists for legacy rows, most of which are published. Only the rename is D-17-restricted"
  - "An unreadable portfolios/portfolio_strategies table is a 500, never a fall-through to the plain UPDATE — treating a read failure as no positions is exactly how a live allocation gets stranded"
  - "A flip RPC that returns zero rows is a 500, not a success: RETURNS TABLE with no row leaves the counts unknown"

patterns-established:
  - "Comment-hygiene discipline for self-matching pins: three separate prose sentences had to be rewritten because the acceptance grep or repo sweep runs over the route's own source"

# Metrics
duration: 60min
completed: 2026-08-06
---

# Phase 150 Plan 04: Owner-scoped mark and rename write routes Summary

**The two owner writes OWN-03 needs: a retro mark route whose flip to `team_review` is refused with 409 until confirmed and then executed as a single RPC transaction, and an OWN-05 rename whose private/draft restriction is a predicate in the UPDATE chain rather than a hidden button — both behind the alias route's six-defence stack, both audited with compile-enforced new actions.**

## Performance

- **Duration:** ~60 min
- **Tasks:** 2 of 2
- **Files:** 6 (4 created, 2 modified), 1681 insertions, **0 deletions**
- **Commits:** 4 (one RED + one GREEN per TDD task)

## Accomplishments

- **The D-03 stranding hole is closed atomically.** Flipping `own_capital → team_review` while the caller holds a live position answers `409 { error: "live_allocation", allocated_amount }` and performs **no write at all**; the confirmed flip calls `flip_capital_ownership_to_team_review`, so the position removal and the mark change are one plpgsql body. The route issues no row-removal call of its own — two sequential PostgREST calls can strand a position if the second fails, which is the exact hole this arm exists to close (T-150-16).
- **The tenant predicate is proven on the wire, not assumed.** `strategies_update` RLS is `FOR UPDATE USING (user_id = auth.uid())` with **no WITH CHECK**, so the explicit `.eq("user_id", user.id)` is the real gate. The route tests record every `.eq()`/`.in()` in call order and assert the exact filter list, so deleting the predicate reddens — under a looser test RLS would have masked its removal (the same blindness 150-01 measured as its M6).
- **D-17 is enforced server-side.** `.in("status", ["private", "draft"])` rides in the rename's UPDATE chain; a published row matches zero rows and answers 404. Three independent pins catch its removal.
- **Reject, never truncate.** The alias route silently caps input at 120 chars; this route deliberately does not copy that for a user-visible proper name. Empty-after-trim and >80 are two distinct 400s, the cap is measured *after* trimming, and neither burns a rate-limit token (B15 ordering, asserted on `rateLimitCalls` rather than on the status alone — a route validating *after* `checkLimit` would still answer 400 and look correct).
- **The audit taxonomy stayed in lockstep across two languages.** Both new actions have TS map entries (a missing one is a compile error by design) *and* Python `Literal` members, without which `test_action_literal_matches_ts_union` would have failed.

## Task Commits

1. **Task 1: ownership mark route + flip safety + audit actions**
   - `f1652fff` (test — RED, `./route` unresolvable)
   - `8ce38ce7` (feat — GREEN, 40 passed)
2. **Task 2: OWN-05 rename route**
   - `b2df4c4f` (test — RED)
   - `6dfd69ed` (feat — GREEN, 27 passed)

## Rule-9 mutation ledger — 6 mutations, 6 caught (1 after strengthening)

| # | Mutation | Result |
|---|---|---|
| M1 | unconfirmed flip proceeds instead of 409 | RED — 2 cases, including the writes-NOTHING assertion |
| M2 | drop `.eq("user_id", user.id)` from the mark UPDATE | RED — the filter-list assertion |
| M3 | drop the `?? 0` coalesce on `allocated_amount` | **Initially GREEN (blind).** Fixed; now RED |
| M4 | consume `checkLimit` before validation (B15 inversion) | RED — 9 cases |
| M5 | drop the `.in("status", …)` D-17 gate | RED — 3 independent pins |
| M6 | restore silent truncation of the name | RED — 3 cases (boundary, behavioural, source pin) |

**M3 is the honest finding.** The original oracle seeded `allocated_amount: null` and asserted the sum — but JS `sum + null` is `sum + 0`, so removing the coalesce left it green. The shape that actually breaks is a row whose key is **absent** (a narrowed `.select()` column list, or a PostgREST embed change): `sum + undefined` is `NaN`, which serialises to `null` in JSON and would render the confirm dialog as "remove your $null allocation". A dedicated absent-key case was added, and the mutation then reddened. This is the [[feedback_economic_invariant_oracles_not_self_referential]] shape — the null case was testing the implementation's own convenience, not the economics.

## Decisions Made

- **The mark route has no status gate.** Unlike the rename, a published strategy stays markable — the retro path exists precisely for legacy rows (Black Swan, Alpha Centauri, Arctic Fox), most of which are published. Pinned by a test asserting zero `status` filters on that UPDATE, so a future "consistency" edit that adds one reddens.
- **Read failures fail loud.** A `portfolios` or `portfolio_strategies` lookup error returns 500 rather than falling through to the plain UPDATE. Treating an unreadable position table as "no positions" is the silent path to a stranded allocation.
- **A zero-row RPC result is a 500.** `RETURNS TABLE` yielding no row leaves `removed_positions` / `updated_strategies` unknown; reporting success would claim a flip that may not have happened (Rule 12).
- **`confirm_remove_allocation` is a strict boolean.** A truthy string such as `"false"` must not be able to authorise a destructive removal, and the flag is ignored entirely on the `own_capital` direction.
- **404 is one honest arm for three causes** (wrong owner, unknown id, published row). Distinguishing them would leak row existence to a caller probing ids; the route says so in a comment.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `analytics-service/services/audit.py` edited alongside `src/lib/audit.ts`**
- **Found during:** Task 1, reading `audit.ts` for the two-step add.
- **Issue:** The plan lists five files and its success criteria ask for "zero diffs outside the five listed files". But `analytics-service/tests/test_audit.py::TestAuditTaxonomySyncWithTypeScript` parses `src/lib/audit.ts` and asserts `py_actions == ts_actions` — **exact set equality in both directions**. Adding two TS-only literals would have failed pytest in CI with "in TS only (add to services/audit.py)".
- **Fix:** Added `"strategy.ownership_mark"` and `"strategy.rename"` to the Python `AuditAction` `Literal`, with the same comment convention the file already uses for TS-only call sites.
- **Files modified:** `analytics-service/services/audit.py`
- **Verification:** `python3 -m pytest tests/test_audit.py` → **23 passed** (run from `analytics-service/` per the cassette-path rule).
- **Committed in:** `8ce38ce7`

**2. [Rule 2 — Missing critical] UUID validation on the route segment before it reaches `.eq()`**
- **Found during:** Task 1, reading the async-params idiom at `admin/allocators/[id]/holdings/route.ts:28-35`.
- **Issue:** The plan's stack does not name a UUID guard. Without one a non-UUID segment reaches Postgres as a `22P02` invalid-uuid cast and surfaces as an opaque 500 — indistinguishable from infra failure — after burning a rate-limit token. This is the sibling watchlist route's H-0341 finding, already fixed there.
- **Fix:** `isUuid(id)` → 400 before both `checkLimit` and any DB call, on **both** routes. Pinned by a test asserting zero rate-limit calls and zero queries.
- **Files modified:** both new `route.ts` files
- **Committed in:** `8ce38ce7`, `6dfd69ed`

**3. [Rule 2 — Missing critical] Strict-boolean guard on `confirm_remove_allocation`**
- **Issue:** The plan says `confirm_remove_allocation !== true` gates the 409, which is safe by itself, but nothing rejected a wrong-typed flag. Accepting arbitrary types on a field that authorises a destructive removal widens T-150-17 more than necessary.
- **Fix:** A non-boolean value is a 400 before the rate limit.
- **Committed in:** `8ce38ce7`

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 missing-critical). No architectural (Rule 4) decisions were needed.
**Impact on plan:** The five-file scope became six. Every added line strengthens an invariant the plan already states rather than widening scope.

## Issues Encountered

**Three separate self-matching-comment traps.** Each was a pin defeated by the route's own prose, and each is worth recording because the class keeps recurring in this phase (150-02 hit it once):

1. The ownership docblock wrote "contains NO `.delete()`", which satisfied the acceptance grep's own needle — the grep strips only whole-line `//` comments, so a ` * ` docblock line survives. Rewritten to describe the method without naming it.
2. The rename docblock spelled the raw published predicate verbatim while *explaining why the route avoids it*. `src/lib/visibility.test.ts` B10 reads **raw file text with no comment stripping**, so the file became the sweep's sole offender. Rewritten to describe the forbidden filter without spelling it.
3. Both rewrites carry an explicit note saying the omission is deliberate, otherwise the vagueness reads as sloppiness to the next reader.

**One unrelated test failed under load and passes in isolation.** `src/__tests__/gdpr-export-coverage-hook.test.ts` ("B10 #8", a subprocess-spawning test that took 31s) failed once in a 125-file serial run and passes **24/24** when run alone. It is untouched by this plan (no GDPR-export surface here) and is out of scope per the scope boundary.

**One pre-existing lint warning** (`EquityChart.tsx:1119`, `react-hooks/exhaustive-deps`) — unchanged, unrelated, already recorded in 150-02. `npm run lint` reports **0 errors**.

## Verification

| Gate | Result |
|------|--------|
| `npx vitest run "…/ownership/route.test.ts"` | **40 passed** |
| `npx vitest run "…/name/route.test.ts"` | **27 passed** |
| Both routes + `no-store-coverage` + `visibility` (B10) | 4 files, **76 passed** |
| `npx tsc --noEmit` | clean (the audit map's compile enforcement satisfied) |
| `npm run lint` | **0 errors**, 1 pre-existing unrelated warning; admin-manifest + route-contract OK |
| `pytest tests/test_audit.py` (from `analytics-service/`) | **23 passed** — TS↔Python taxonomy parity green |
| `npx vitest run src/app/api/strategies src/__tests__ src/lib/audit.test.ts` | 1538 passed / 268 skipped; 1 unrelated load-flake (passes in isolation) |

**Acceptance criteria, per task:**

- Task 1: `grep -v '^\s*//' ownership/route.ts \| grep -c '\.delete('` → **0**. `grep -c "flip_capital_ownership_to_team_review"` → **4** (≥1 required). `NextResponse.json(` count vs `NO_STORE_HEADERS` count asserted in-suite (every arm stamped). `audit.ts` compiles — both literals have map entries.
- Task 2: `grep -c 'in("status"'` → **2** (≥1 required). `grep -c 'eq("status"'` → **0**. `grep -v '^\s*//' name/route.ts \| grep -c '\.slice('` → **0**. B10 sweep green with **zero allowlist edits**.

## Known Stubs

None. Both routes are complete against the `<interfaces>` contract Plan 06's dialogs will fetch. Nothing mounts them yet — that is Plan 06's scope by design.

## Threat Flags

No new threat surface beyond what the plan's register already dispositions. Two register entries are worth re-stating as **live accepted risk** rather than closed:

| Flag | File | Description |
|------|------|-------------|
| threat_flag: accepted-residual (T-150-15) | `src/app/api/strategies/[id]/name/route.ts` | This is the first free-text path into `strategies.name`, previously allow-list-constrained by the wizard. Accepted because the C-0112 redaction contract is byte-untouched (public surfaces render codename regardless), D-17 confines the rename to private/draft rows, and publication is admin-gated by `guard_strategies_publish_transition` so an admin reviews the name before it can go public. Written into the route docblock and pinned by a test. |
| threat_flag: accepted-residual (T-150-20) | `src/app/api/strategies/[id]/ownership/route.ts` | The flip RPC scopes removal to the **caller's own** portfolios. A third party holding a position on a published own-capital strategy would survive the owner's flip. Accepted per the plan: D-03 is creation-scoped, the trigger blocks all new positions post-flip, and cross-tenant deletion would be a larger authz surface than the hole. Recorded for Phase-151 review. |

Carried forward from 150-02 and consciously acknowledged here, as this plan's wave-context asked: **`capital_ownership` is publicly readable on published rows** — `strategies_read` has no column projection (T-150-04). These two routes do not widen that: they are write-only, both are session-authenticated, and neither adds a read projection or a public surface. UI-SPEC invariant 3 remains a *render* invariant, and the decision itself lives in the `20260806120000` migration header where 150-01 recorded it.

`T-150-SC` holds: **zero packages installed** this plan.

## User Setup Required

None — no new env var, no feature flag, no external service configuration. Note (carried from 150-RESEARCH): this phase ships behind **no flag**, so these routes are live on merge.

## Next Phase Readiness

- **Plan 06** can `fetch()` both routes exactly as specified in the plan's `<interfaces>` block. The 409 body is `{ error: "live_allocation", allocated_amount }` — the confirm dialog renders its copy from that number, which is guaranteed finite (pinned).
- **Plan 06's Rename dialog** should surface the two distinct 400 messages (`invalid name` / `name too long`) as inline field errors, and must not pre-truncate input client-side — the server rejects rather than truncating, so a client-side cap would hide the contract.
- **Plan 08 (phase gate)** can pin: the `own_capital` literal still resolves to `src/lib/capital-ownership.ts` alone (both routes import the constants — asserted by a negative source pin in the ownership suite), and the mark-flip removal is one statement (the ownership route contains no direct row removal).
- ⚠️ `STATE.md` / `ROADMAP.md` deliberately **not** touched (worktree mode; the orchestrator owns those writes post-wave).

## Self-Check: PASSED

All 4 created files exist on disk; both modified files carry their edits. All 4 task commits resolve in `git log` (`f1652fff`, `8ce38ce7`, `b2df4c4f`, `6dfd69ed`). `git diff --stat` against the base shows exactly 6 files, **1681 insertions and 0 deletions**; `git diff --diff-filter=D` reports no deletions in any commit. Working tree clean, no untracked files.

---
*Phase: 150-own-03-the-wizard-asks-whose-capital-this-is*
*Completed: 2026-08-06*
