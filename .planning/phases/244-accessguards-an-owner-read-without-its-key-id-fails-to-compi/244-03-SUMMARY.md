---
phase: 244-accessguards-an-owner-read-without-its-key-id-fails-to-compi
plan: 03
subsystem: testing
tags: [e2e, playwright, rls, proxy, local-stack, watchlist, hydration-guard]
requires: []
provides:
  - "e2e/discovery-watchlist.spec.ts runnable on the local-stack lane, 4 of 4 with nothing skipped, and PROOF-01 RED/GREEN records for its RLS and proxy arms"
affects: [244-04]
tech-stack:
  added: []
  patterns: ["spec binds test from ./helpers/hydration-guard", "a missing precondition env is a failing assertion, never a skip", "redirect-off request to assert the proxy gate's 307"]
key-files:
  created: []
  modified:
    - e2e/discovery-watchlist.spec.ts
key-decisions:
  - "Anonymous PUT arm asserts the proxy session gate's 307 to /login with maxRedirects: 0; the route's own 401 stays proven by route.test.ts (Option A)"
  - "Primary RLS proof asserts TEST_SUPABASE_ANON_KEY is present and runs unconditionally"
requirements-completed: [DBACC-06]
status: complete
verified_at_sha: 6ecf0dc17
actuals:
  tokens: 9000
  tasks: 2
  commits: 1
plan_head_before: 6e5f1840f053d2f43c21f8f807eaea3afe6af171
plan_head_after: 6ecf0dc17
completed: 2026-11-27
---

# Phase 244 Plan 03: watchlist spec on the local-stack lane Summary

The watchlist spec now runs on the lane exactly as the `e2e-seeded` job runs it, passes 4 of 4 with nothing skipped, and both PROOF-01 neuters (a USING (true) SELECT policy, and `/api/watchlist` in `PUBLIC_ROUTES`) turn their named arm red before the restore turns it green.

## Environment (lane only)

- Local Supabase CLI 2.84.2; CI pins 2.98.2 (`ci.yml`, `supabase/setup-cli` step).
- `run.sh --check-currency`: `carried=344 replay=0 marker-sha=match defects=0`. `run.sh up` exit 0. `--assert-local-handoff` exit 0 (loopback API_URL and DB_URL) before every psql call.
- Seed `SEED_CONFIRM_STAGING=true npx tsx scripts/seed-demo-data.ts` exit 0; `npm run build` exit 0; the three inline checks of the "Verify build inlined" step all OK (lane host:port inlined, no `placeholder.supabase.co`, no hosted-project URL). `npm run start` with `NEXT_PUBLIC_ALLOWED_ORIGINS=http://localhost:3000` set for the server only (as in the CI step).
- Marker query on the lane (`shobj_description` on `pg_database`): `default administrative connection database`. It names neither TEST nor PROD, so the lane is the stock local database.

## AS-IS run (before any edit), `CI=true ... --retries 0`, exit 1, 3 passed 1 failed

```
✓ 1 public/anon path › anonymous /browse/[slug] hides star toggles, Customize cog, and My watchlist tab (849ms)
✓ 2 DISCO-01 watchlist › watchlist toggle persists across reload (1.6s)
✘ 3 DISCO-01 watchlist › unauthenticated PUT to /api/watchlist returns 401 (public-path RLS guard) (18ms)
✓ 4 DISCO-01 watchlist › user-B cannot read user-A's favorites (RLS proof) (1.1s)
  Error: expect(received).toBe(expected) // Object.is equality
  Expected: 401
  Received: 200
```

The 200 is Playwright's request client following the proxy's 307 to the login page; the route's 401 is never reached by an anonymous caller (RESEARCH "The 401 arm" confirmed). Test 4 passed as-is only because the lane run supplies the anon key; its primary arm sat inside `if (anonKey)`, so a missing key would have skipped it silently.

## Repairs (spec only, one commit)

Commit `6ecf0dc17` `test(244-03): watchlist spec runs on the lane without a silent skip, anon PUT asserts the proxy's 307`:

- Import `test, expect` from `./helpers/hydration-guard`.
- Primary RLS proof: the `if (anonKey)` wrapper is gone; `expect(anonKey, "TEST_SUPABASE_ANON_KEY missing - the primary RLS proof cannot run").toBeTruthy()` precedes the unconditional body. The `RLS LEAK on migration 024 policy` message is byte-identical.
- Anonymous PUT: retitled "... is bounced to /login by the proxy session gate before the route runs"; `maxRedirects: 0`; asserts status 307 and Location pathname `/login`; comments and the file header bullet (a) rewritten.
- No other rot was measured; no further edits. `test.skip(` count stays 1 (the MA-8 place-2 skip).

Repaired run (`--retries 0`), exit 0:

```
✓ 1 public/anon path ... (359ms)
✓ 2 watchlist toggle persists across reload (1.6s)
✓ 3 unauthenticated PUT to /api/watchlist is bounced to /login by the proxy session gate before the route runs (22ms)
✓ 4 user-B cannot read user-A's favorites (RLS proof) (1.0s)
4 passed (4.6s)
```

Acceptance greps (code lines only): import 1, `@playwright/test` 0, `if (anonKey)` 0, missing-key message 1, `maxRedirects: 0` 1, `toBe(307)` 1, `toBe(401)` 0, `RLS LEAK on migration 024 policy` 1, `test.skip(` 1. `tsc --noEmit`: exit 0, 0 `error TS`. `spec-disabling.invariant.test.ts`: 9 passed. `e2e-seeded-hydration-guard.test.ts`: 30 passed.

## PROOF-01 (lane only), verbatim

**A. RLS neuter.** Snapshot of the four `user_favorites` policies taken first (`policy-before.txt`: delete, insert, select, update, each `(auth.uid() = user_id)`).

`ALTER POLICY "users see own favorites" ON public.user_favorites USING (true);` then `CI=true ... --retries 0`, exit 1:

```
✓ 1 public/anon path ...
✓ 2 watchlist toggle persists across reload
✓ 3 unauthenticated PUT ... bounced to /login ...
✘ 4 user-B cannot read user-A's favorites (RLS proof) (146ms)
  Error: user-B's session sees 1 of user-A's user_favorites rows — RLS LEAK on migration 024 policy
  Expected length: 0
  Received length: 1
1 failed, 3 passed
```

Restore `ALTER POLICY ... USING ((auth.uid() = user_id));`, re-snapshot, `cmp policy-before.txt policy-after.txt` -> `cmp=0`.

**B. Proxy neuter.** `cp src/proxy.ts proxy.ts.bak`; `"/api/watchlist"` added as one more `PUBLIC_ROUTES` element; rebuilt (inline checks OK), restarted. `-g "bounced to /login"`, exit 1:

```
✘ 1 DISCO-01 watchlist › unauthenticated PUT to /api/watchlist is bounced to /login by the proxy session gate before the route runs (108ms)
  Error: anonymous PUT /api/watchlist was not answered by the proxy session gate with a 307 to /login — the PUBLIC_ROUTES gate no longer covers this path
  Expected: 307
  Received: 401
1 failed
```

Received 401 is the route's own guard, as RESEARCH predicted. Restore: `cp proxy.ts.bak src/proxy.ts`, `cmp=0`, `git diff --quiet -- src/proxy.ts` -> `clean=0`. Rebuilt from the restored tree (inline checks OK) before the final run.

**C. Final CI-parity GREEN** (`CI=true`, 2 retries in effect), exit 0:

```
✓ 1 public/anon path ... (755ms)
✓ 2 watchlist toggle persists across reload (2.5s)
✓ 3 unauthenticated PUT ... bounced to /login ... (32ms)
✓ 4 user-B cannot read user-A's favorites (RLS proof) (1.2s)
4 passed (6.6s)
```
No flaky, skipped or did-not-run line.

**D. Neighbour run** (`discovery-hide-examples-default`, `discovery-prefs-isolation`, `discovery-watchlist`, `--workers 1`), exit 0: `6 passed (10.6s)`; no flaky, skipped or did-not-run test. Plan 04 may wire the spec.

## Teardown

Server stopped by PID (each listener's cwd checked to be this worktree before kill); port 3000 `listen=0`. `src/proxy.ts` `cmp=0`, `clean=0`. `run.sh down` exit 0; `run.sh --assert-teardown` exit 0 (`surviving quantalyze containers -> 0`); project volumes 0; `docker ps -q` empty; `lane.env` deleted; `git status --porcelain` empty. `src/proxy.ts` is not in any commit of this plan.

## Deviations from Plan

**1. [Rule 3 - blocking] Next build nudge.** The first `npm run build` of each build pair exited 1 with a Next.js "upgrade recommendation" banner (it asks to be retried unchanged); the unchanged retry exited 0 every time. No upgrade was run and no instruction in that banner was followed. Tracked here because the banner also asks to be relayed to the user.
**2. [Environment] First attempt halted** on the symlinked `node_modules` (Turbopack root); the orchestrator installed a real `node_modules` and the plan ran from the top. The lane was booted twice; the earlier boot was torn down with exit 0.
**3. Policy snapshot has four rows** as the plan expected; the marker answer is the stock comment, not empty (the plan expected an empty result); it names neither project, so the plan's stop rule did not apply.

No auth gates, no stubs, no threat flags. The ledger step 0c file was not written; `commits` is measured as `git rev-list --count 6e5f1840f..6ecf0dc17` = 1 (the SUMMARY commit follows).

## Self-Check: PASSED

- e2e/discovery-watchlist.spec.ts: FOUND, commit 6ecf0dc17 is an ancestor of HEAD.
