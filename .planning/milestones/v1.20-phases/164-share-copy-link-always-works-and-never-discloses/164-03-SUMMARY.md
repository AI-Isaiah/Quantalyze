---
phase: 164-share-copy-link-always-works-and-never-discloses
plan: 03
subsystem: api
tags: [share-token, hmac, rls, rpc, audit, csrf, rate-limit, next-route-handler]

requires:
  - phase: 164-01
    provides: "src/lib/strategy-share-token.ts (deriveShareToken / verifyShareToken), the recipient route /factsheet-share/[token], the 410 gone sibling"
  - phase: 164-02
    provides: "migration 20260827120000 — strategy_shares, the per-row nonce, the create_strategy_share / revoke_strategy_share INVOKER RPCs, the column grants and the monotonic-generation trigger"
  - phase: 164-05
    provides: "SHARE_TOKEN_SECRET boot visibility and the share-lane leak suppression the minted url lands in"
provides:
  - "POST /api/strategies/{id}/share — mint-or-REUSE, returns { url } on the /factsheet-share lane"
  - "POST /api/strategies/{id}/share/revoke — atomic generation bump, 404 as convergence"
  - "strategy.share.mint / strategy.share.revoke in the TS AuditAction union, the entity_type map, and the Python Literal the parity test pins"
  - "A measured account of TWO ways the mutating-RPC audit detector is silently disarmed (deferred-items D-164-C)"
affects: [164-04, 164-07, 164.1]

actuals:
  tokens: 15700
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Cast the CLIENT, not the method, and keep the .rpc() call on ONE line — the audit-coverage detector is anchored on that literal and scans line-by-line"
    - "Round-trip a minted credential through its real verifier in the route test; a shape assertion cannot distinguish a right pre-image from a wrong one"

key-files:
  created:
    - src/app/api/strategies/[id]/share/route.ts
    - src/app/api/strategies/[id]/share/route.test.ts
    - src/app/api/strategies/[id]/share/revoke/route.ts
    - src/app/api/strategies/[id]/share/revoke/route.test.ts
  modified:
    - src/lib/audit.ts
    - analytics-service/services/audit.py
    - .planning/phases/164-share-copy-link-always-works-and-never-discloses/deferred-items.md

key-decisions:
  - "deriveShareToken is called with THREE arguments (id, nonce, generation) — the plan's two-argument spec predates the nonce and would have minted links that fail verification and read as 'revoked'"
  - "The route test round-trips a minted url through verifyShareToken; the 43-char shape assertion the plan named would have passed for the wrong pre-image too"
  - "The RPC cast is on the CLIENT and the call sits on ONE line, because both the method-cast and a Prettier wrap were MEASURED to hide the mutation from the audit-coverage gate"
  - "CSRF (assertSameOrigin) added on both routes — every sibling owner-write under strategies/[id] opens with it and the plan omitted it"
  - "An unreadable affected-row count from revoke is a 500, never the 404 the client reads as success"
  - "N2 left closed: no FOR UPDATE, no retry loop, no advisory lock — pinned by a comment-stripped source assertion"

patterns-established:
  - "Comment-stripped source pins: a prohibition docblock naming the banned construct makes a raw-text scan fail on its own file; strip comments rather than refusing to name the ban"
  - "Semantic rather than lexical negative pins: 'no retry' is asserted as 'the RPC appears exactly once and there is no loop', because a word-match on retry fires on Retry-After"

requirements-completed: [SHARE-01, SHARE-03]

coverage:
  - id: D1
    description: "POST /api/strategies/{id}/share mints a share link and REUSES it byte-identically while the share is live, instead of revoking-on-mint and killing the recipient's existing URL"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "src/app/api/strategies/[id]/share/route.test.ts#⭐ REUSE: two sequential mints return BYTE-IDENTICAL urls (the founder-hit bug)"
        status: pass
      - kind: unit
        ref: "src/app/api/strategies/[id]/share/route.test.ts#⭐ ROUND-TRIPS: the minted token VERIFIES against (id, nonce, generation)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The mint lane is not an existence oracle: a non-owner and an unknown id both get 404 and neither reaches the RPC"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "src/app/api/strategies/[id]/share/route.test.ts#answers 404 (NOT 403) for a strategy the caller does not own, and never mints"
        status: pass
    human_judgment: false
  - id: D3
    description: "POST /api/strategies/{id}/share/revoke kills every previously-copied link via the atomic generation bump, and a double-revoke converges"
    requirement: "SHARE-03"
    verification:
      - kind: unit
        ref: "src/app/api/strategies/[id]/share/revoke/route.test.ts#⭐ answers a double-revoke and a NON-OWNER with BYTE-IDENTICAL 404s"
        status: pass
      - kind: unit
        ref: "src/app/api/strategies/[id]/share/revoke/route.test.ts#calls revoke_strategy_share with the id ALONE and answers 200"
        status: pass
    human_judgment: false
  - id: D4
    description: "Neither route leaks the token: audit metadata carries the generation only, and no DB message reaches the client"
    verification:
      - kind: unit
        ref: "src/app/api/strategies/[id]/share/route.test.ts#audits the mint with the GENERATION only — never the token (T-164-13)"
        status: pass
      - kind: unit
        ref: "src/__tests__/audit-coverage.test.ts#every .insert/.update/.delete/.upsert has a logAuditEvent or @audit-skip"
        status: pass
    human_judgment: false
  - id: D5
    description: "A real owner clicks Copy Link twice in the live app, sends the second URL, and the recipient's first URL still opens the factsheet"
    verification: []
    human_judgment: true
    rationale: "The reuse property is proven at the route seam against a mocked RPC. Whether the DEPLOYED database really returns the same (generation, nonce) pair on a second mint — and whether the resulting URL opens against the deployed SHARE_TOKEN_SECRET — is an end-to-end fact no route test reaches. Plan 164-07 owns the live check."

duration: 21min
completed: 2026-08-28
status: complete
---

# Phase 164 Plan 03: Share mint + revoke routes Summary

**The owner-side write lanes for the strategy share capability: a mint that REUSES the live link instead of silently killing the recipient's copy, and a revoke that bumps the generation atomically and converges on a second call — with the token derived from the three-input pre-image the plan got wrong.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-08-28T10:14:00Z
- **Completed:** 2026-08-28T10:35:00Z
- **Tasks:** 2
- **Files modified:** 6 created/modified (4 route files, 2 taxonomy files)

## Accomplishments

- **The mint is idempotent while the share is live.** `create_strategy_share` reactivates with `ON CONFLICT (strategy_id) DO UPDATE SET revoked_at = NULL`, touching neither `nonce` nor `generation`, so the token re-derives identically and a second Copy Link returns the same URL. This is the founder-hit defect a verbatim port of `allocator/scenario/share/route.ts` would have reproduced.
- **The token is derived from THREE inputs and PROVEN by round-trip.** `deriveShareToken(id, nonce, generation)`. The test feeds a minted URL back through the real `verifyShareToken`, and separately asserts the URL is *not* the nonce-less digest the plan's two-argument spec would have produced.
- **The revoke lane cannot be an existence oracle.** The double-revoke and non-owner arms are compared as full response snapshots (status + sorted headers + body), not just status codes.
- **The audit law now actually binds to both routes** — and the two mechanisms that were silently disarming it were measured rather than assumed (see Deviations 3 and Discoveries).

## Task Commits

1. **Task 1: POST /api/strategies/[id]/share — mint-or-reuse (D-02)** — `3ee635c46` (feat)
2. **Task 2: POST /api/strategies/[id]/share/revoke — atomic revoke, 404 as convergence** — `b2ec01684` (feat)

**Plan metadata:** see the final `docs(164-03)` commit.

## Files Created/Modified

- `src/app/api/strategies/[id]/share/route.ts` — POST mint-or-reuse: csrf → auth → validate → limiter → ownership probe → `create_strategy_share` → `deriveShareToken` → `{ url }`
- `src/app/api/strategies/[id]/share/route.test.ts` — 20 arms including the reuse pin (RED-demonstrated), the `verifyShareToken` round-trip and the stale-pre-image negative
- `src/app/api/strategies/[id]/share/revoke/route.ts` — POST revoke via `revoke_strategy_share`; 0 rows → 404 convergence; unreadable count → 500
- `src/app/api/strategies/[id]/share/revoke/route.test.ts` — 17 arms including byte-identical 404s and the N2 source pin
- `src/lib/audit.ts` — added `strategy.share.mint` / `strategy.share.revoke` to `AuditAction` and to `AUDIT_ACTION_ENTITY_TYPE_MAP`
- `analytics-service/services/audit.py` — the same two literals, required by the cross-language parity test
- `.planning/.../deferred-items.md` — D-164-C

## Decisions Made

- **Three-argument `deriveShareToken`.** Verified by reading `src/lib/strategy-share-token.ts:247-255`, not by trusting the plan.
- **Round-trip over shape.** A 43-char base64url assertion passes for any HMAC, including one over the wrong pre-image; the round-trip is the only assertion that discriminates.
- **Client cast, single-line RPC call.** See Deviation 3 — both choices are load-bearing for the audit gate and both are pinned in the route tests with the measurement recorded in the comment.
- **`revoke`'s indeterminate arm is a 500.** 404 is the status the client treats as success; coercing an unreadable row count to 0 would claim the link is dead without having established it.
- **No ownership probe on revoke.** The INVOKER RPC's UPDATE is RLS-scoped and carries its own `created_by = auth.uid()`, so a non-owner already falls into the same 404. A probe would make the two arms distinguishable.

## Deviations from Plan

### Corrections to the plan itself (pre-flagged by the `<revision_note>`, plus one it missed)

**1. [Plan wrong — corrected] `deriveShareToken` takes THREE arguments**
- **Found during:** Task 1, before writing any code (module read).
- **Issue:** The plan body (Task 1 step 6) and `key_links` name `deriveShareToken(strategyId, nonce, generation)` correctly, but the `<revision_note>` records that the plan as originally written specified the two-argument form. The signature was verified directly.
- **Fix:** `deriveShareToken(id, minted.nonce, minted.generation)`, plus a round-trip test through `verifyShareToken` so the wrong pre-image cannot pass.
- **Committed in:** `3ee635c46`

**2. [Plan imprecise — corrected] `create_strategy_share`'s row arrives as an ARRAY**
- **Found during:** Task 1.
- **Issue:** The plan says the RPC "yields ONE ROW WITH TWO COLUMNS, not a scalar. Destructure BOTH." True in SQL — but through PostgREST/supabase-js a `RETURNS TABLE` function resolves to a row **array**, so a literal destructure of `data` would have yielded `undefined` for both fields. Confirmed against the `get_verified_cohort_rank` precedent (`src/app/api/scenario/peer-rank/route.ts:167` — "RETURNS TABLE resolves to an array; read the single row").
- **Fix:** `mintedRows?.[0]`, with an explicit fail-loud 500 when the row or either field is absent — a token derived from `undefined` is still a well-formed 43-char string that verifies against nothing.
- **Verification:** `FAILS LOUD rather than minting from an empty row set` and `FAILS LOUD when the row is missing the nonce`.
- **Committed in:** `3ee635c46`

### Auto-fixed issues

**3. [Rule 2 — missing critical functionality] The audit law did not reach either route**
- **Found during:** Task 1, verifying that `create_strategy_share`'s entry in `MUTATING_RPC_NAMES` was more than decorative.
- **Issue:** `findRpcMutations` (`src/__tests__/audit-coverage.test.ts:264-269`) tests `\.rpc\(\s*['"]<name>['"]` against **one line at a time**. Two independent things defeat it: the scenario-share precedent's method cast (`supabase.rpc as unknown as …`), which erases the literal; and a Prettier-style wrap between `.rpc(` and the name. **MEASURED both ways:** with the call wrapped, deleting the route's `logAuditEvent` left audit-coverage GREEN; with the client cast and the call on one line, the same deletion turned it RED with `Found 1 uninstrumented mutation(s)`.
- **Fix:** cast the client rather than the method, keep both `.rpc()` calls on one line, document the measurement at each call site, and pin the shape in each route test.
- **Committed in:** `3ee635c46`, `b2ec01684`

**4. [Rule 2 — missing critical functionality] No CSRF guard**
- **Found during:** Task 1.
- **Issue:** The plan's route body omits CSRF. Both sibling owner-writes under `strategies/[id]` (`name/route.ts`, `ownership/route.ts`) open with `assertSameOrigin`, and these are state-changing POSTs driven from the dashboard.
- **Fix:** `assertSameOrigin` first on both routes, with a 403 arm pinned in each test. Additive for plan 164-04: a same-origin browser POST always carries `Origin`, so the documented happy path is unchanged.
- **Committed in:** `3ee635c46`, `b2ec01684`

**5. [Rule 3 — blocking] `strategy.share.mint` / `.revoke` were not in the audit taxonomy**
- **Found during:** Task 1 (`tsc` error TS2322 — the action is not assignable to `AuditAction`).
- **Issue:** `AuditEvent` is a discriminated union derived from `AUDIT_ACTION_ENTITY_TYPE_MAP`, so a new action is a compile error until it is declared. `analytics-service/services/audit.py` carries a mirrored `Literal` that `analytics-service/tests/test_audit.py::TestAuditTaxonomySyncWithTypeScript` pins to the TS union — editing one side alone fails that test.
- **Fix:** added both literals to the TS union and map (`entity_type: "strategy"`, `entity_id` = the strategy id) and to the Python `Literal`, keeping the union comments free of semicolons and double quotes as that file's parser requires.
- **Verification:** `npx tsc --noEmit` clean; `pytest tests/test_audit.py` 23 passed.
- **Committed in:** `3ee635c46`

**6. [Rule 1 — bug in my own test] The N2 source pin failed on the prohibition docblock**
- **Found during:** Task 2, first run.
- **Issue:** The route's header says "DO NOT ADD `SELECT … FOR UPDATE`…" in order to forbid it, so a raw-text scan for `FOR UPDATE` made the file its own offender. A second arm matched `retry` inside `Retry-After` and `rl.retryAfter`.
- **Fix:** scan a comment-stripped copy for the SQL/lock constructs (with an assertion that the stripper still leaves the real body behind), and re-express "no retry loop" semantically — the RPC must appear exactly once and there must be no loop.
- **Committed in:** `b2ec01684`

---

**Total deviations:** 6 — 2 plan corrections, 4 auto-fixed (2× Rule 2, 1× Rule 3, 1× Rule 1).

## Anti-vacuity demonstrations (RED observed, then restored)

Every restore was done from a byte backup verified by `shasum`; `git checkout --` was never used in this tree.

| Pin | Neuter | Result |
|---|---|---|
| Byte-identical reuse | mock bumps `generation` by the call index | RED — **exactly one** test failed, the reuse pin, `expected 'https://…' to be 'https://…'`. Restored, `shasum 0c9cf15e…` matches. |
| Audit law binds to the mint route | delete `logAuditEvent` (call WRAPPED) | GREEN — the detector never saw the mutation. This is the finding, not a pass. |
| Audit law binds to the mint route | delete `logAuditEvent` (call on ONE line) | RED — `Found 1 uninstrumented mutation(s): …/share/route.ts:269`. Restored, `shasum 4b53a19d…`. |
| Audit law binds to the revoke route | delete `logAuditEvent` | RED — `Found 1 uninstrumented mutation(s): …/share/revoke/route.ts:200`. Restored, `shasum 7f152812…`. |

## Verification

| Gate | Result |
|---|---|
| `vitest src/app/api/strategies/[id]/share` (both suites) | 37 passed |
| `vitest src/__tests__/audit-coverage.test.ts` | 17 passed, 1 skipped |
| `vitest src/__tests__/contracts` (whole directory) | 109 passed |
| `vitest` share lane (`factsheet-share`, `strategy-share-token`, share-lane headers, `scrub-share-path`) | 99 passed |
| `vitest` audit suites (`audit`, `audit.hh1`, union types, gdpr-export hook) | 61 passed |
| `npx tsc --noEmit` | clean |
| `npx eslint src/app/api/strategies/[id]/share/` | clean |
| `npx tsx scripts/check-route-contract.ts` | OK — 58 page routes |
| `pytest analytics-service/tests/test_audit.py` | 23 passed |

## Success criteria

- **SHARE-01 mint half** — Copy Link's backend returns a working, REUSED url across sessions. ✅ (reuse pin RED-demonstrated; round-trip verified)
- **SHARE-03 backend** — one call kills every previously-copied link; double-revoke converges. ✅
- **Response contract exactly as stated in the objective** — ✅, plus an additive 403 CSRF arm that a same-origin browser POST never trips.
- **A minted url actually VERIFIES** — ✅ round-tripped through `verifyShareToken`, and pinned as *not* the two-argument digest.
- **N2 untouched** — ✅ no `FOR UPDATE`, no retry loop, no advisory lock; pinned by source assertion.

## Discoveries (logged, not fixed)

- **D-164-C** (appended to `deferred-items.md`): the mutating-RPC audit detector is disarmed by a line wrap as completely as by a method cast, and `create_scenario_share` is not in `MUTATING_RPC_NAMES` at all — so `allocator/scenario/share/route.ts` has never been under the audit law (it does emit an event, so there is no audit hole today, only an unenforced one). The remedy belongs to the gate, not to a route.

## Known Stubs

None. Both routes are complete implementations against the shipped migration; nothing is hardcoded, mocked or deferred inside them.

## Threat Flags

None. Every trust boundary this plan touches is in the plan's `<threat_model>`; no new endpoint, auth path, file access pattern or schema change was introduced beyond the two declared routes.

## Self-Check: PASSED

- `src/app/api/strategies/[id]/share/route.ts` — FOUND
- `src/app/api/strategies/[id]/share/route.test.ts` — FOUND
- `src/app/api/strategies/[id]/share/revoke/route.ts` — FOUND
- `src/app/api/strategies/[id]/share/revoke/route.test.ts` — FOUND
- commit `3ee635c46` — FOUND
- commit `b2ec01684` — FOUND
