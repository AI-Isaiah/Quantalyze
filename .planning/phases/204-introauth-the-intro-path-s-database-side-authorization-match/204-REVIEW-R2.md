---
phase: 204-introauth
round: 2
reviewed_range: a83b7ac8c..fa554f0c8
scope: diff excluding .planning
threshold: MEDIUM and above
reviewed: 2026-11-10
status: issues_found
findings: { critical: 0, high: 0, medium: 1 }
---

# Phase 204 review, round 2

Round 2 re-reviewed the SF-01 fix (`fa554f0c8`, "fix(204): name and capture a policy refusal
on the intro insert (SF-01)") and re-scanned the rest of the range. The same four reviewers ran
in parallel.

## gsd-code-reviewer (opus): no MEDIUM+ findings; SF-01 closed

- **The fix itself:**
  - A `42501` now returns 403 `{error, code: insert_policy_refused}` with a tagged capture. It
    sits after the 23505 → 409 branch.
  - Other insert errors are captured, and their 500 is unchanged.
  - The response shape matches the route's other named refusals.
- **Code-list consistency:** no exhaustive code list exists elsewhere, so nothing goes stale.
- **Client copy:**
  - `RequestIntroButton` shows the route's error text.
  - `ReplacementCard` shows its 403 permission copy, which is more accurate than the previous
    500 copy.
  - Neither component loops or opens the attestation modal.
- **Tests:** the three new route tests assert status, code, the capture count and tags, and the
  absence of an audit row. 75/75 passed across the route and the two component test files.
- **Rest of the range:** unchanged since round 1, and still clean.

## pr-review-toolkit:silent-failure-hunter (sonnet): no MEDIUM+ findings; SF-01 closed

- The capture fires on both new branches.
- The tests drive the real route, and `vi.clearAllMocks` runs in `beforeEach`.
- No client path swallows the new 403.
- The floors are consistent bookkeeping. The static `ARMS_FLOOR` is disclosed and deferred to
  CI `sql-mutation` FULL.

## migration-reviewer (sonnet): clean

- No file under `supabase/` changed since round 1.
- The migration and the rollback were re-read in full against the invariants.
- Ordering: the migration sorts after `20261110120000`, which is both PROD's applied tip
  (re-measured through the MCP before round 1) and `origin/main`'s newest migration.

## rls-policy-auditor (sonnet): clean

- **No SQL change:** none since round 1.
- **Parity:** the policy still matches the updated route.
- **What the new 403 sends the client:** two static strings. No PostgREST `message`, `details`
  or `hint` reaches the client, and nothing about another user or the policy text does either.

## Coordinator-supplied finding (automated security review of `fa554f0c8`)

### SEC-01 [MEDIUM, data-integrity/security]: the new captures sent the raw PostgREST error object to Sentry

**Issue:** a PostgREST error is a plain object, so `src/lib/sentry-capture.ts` renders the whole
object. A constraint or policy failure's `details` (a failing-row dump) and `hint` could carry
the requester's row values into error reporting. The attestation-read capture in the same route
had the same shape.

**Fixed in `5a7b0da83`,** "fix(204): report a reduced error from the intro insert, never its
row details (SEC-01)":
- **What changed:** all three capture sites in `src/app/api/intro/route.ts` now send an `Error`
  built from the code and message only. HTTP responses are unchanged. No reducing helper existed
  in the repo, so each site builds its own.
- **Tests:** three tests set `details` and `hint` sentinels and assert that neither appears in
  the capture argument. They also assert that the code survives.
- **RED evidence:** with the pre-fix `route.ts`, 3 tests failed with ``expected '{"code":"42501",…' not to contain 'DETAILS-SENTINEL'``,
  and the same for P0001 and the attestation read. The fixed file was then restored from a byte
  backup, and `cmp` confirmed it was identical.
- **Runs after the fix:**
  - vitest: 78/78 across the route and the two component test files.
  - `tsc --noEmit`: clean.
- **Out of scope, booked for follow-up rather than fixed here:** other API routes
  (`trades/upload`, `strategies/draft/[id]`) pass raw Supabase errors to the same capture.

## Disposition

| ID | Severity | Disposition |
|---|---|---|
| SF-01 | MEDIUM | Closed in `fa554f0c8`, confirmed by all four reviewers |
| SEC-01 | MEDIUM | Fixed in `5a7b0da83`; re-reviewed in round 3 |

## Below threshold (not fixed)

- The SQLSTATE `42501` that `insert_policy_refused` catches also covers grant-level and
  read-back refusals, so the code's name is slightly narrower than what it catches. The status
  and the copy are still correct.
- Pre-existing: the route ignores the error from the `profiles` role read.
