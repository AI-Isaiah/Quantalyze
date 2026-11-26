---
phase: 230-mt5nightly-every-mt5-nightly-derive-ends-done-on-its-first-a
plan: 01
subsystem: database
tags: [postgres, lease, mt5, security-definer, rls, sql-gate]

requires:
  - phase: 227-jobledger
    provides: the claim-renewal migration shape (SECURITY DEFINER hardening, catalogue-only self-verify) this plan copies
provides:
  - public.mt5_terminal_leases, one row per MT5 terminal, keyed by a sha256 digest
  - acquire_mt5_terminal_lease, renew_mt5_terminal_lease, release_mt5_terminal_lease (all RETURNS boolean, service_role only)
  - supabase/tests/test_mt5_terminal_lease.sql, arms L1 to L8, each with a biting RED-UNDER-M twin
  - manual rollback and three generated function mirrors
affects: [230-02, 230-04, 230-06, 230-07, 230-08]

plan_head_before: 7d19de0d1d5923f1cae67543c64a7e892f73812e
plan_head_after: 94a764f5de3162e685de813872745305cceef281

actuals:
  tokens: 15900
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "token-fenced lease row: INSERT ... ON CONFLICT DO UPDATE ... WHERE <free or same token>, answer from the row count"
    - "release clears the owner token and keeps the row, so a late renew can never match"

key-files:
  created:
    - supabase/migrations/20261126120000_mt5_terminal_lease.sql
    - supabase/migrations/down/20261126120000-rollback.sql
    - supabase/tests/test_mt5_terminal_lease.sql
    - supabase/schema/functions/acquire_mt5_terminal_lease.sql
    - supabase/schema/functions/renew_mt5_terminal_lease.sql
    - supabase/schema/functions/release_mt5_terminal_lease.sql
  modified: []

key-decisions:
  - "DEC-01-A Release sets owner_token NULL and expires_at now() and keeps the row; renew requires owner_token = the caller's token."
  - "DEC-01-B Same-token acquire is idempotent, so a retried acquire whose answer was lost is granted."
  - "DEC-01-C Acquire is one INSERT ... ON CONFLICT DO UPDATE ... WHERE statement; granted iff the row count is 1."
  - "DEC-01-D Rejected: session advisory lock, moving the holdings poll or cron, a pruning cron."

requirements-completed: [MT5D-02]

coverage:
  - id: D1
    description: "One terminal digest admits one owner token at a time; the same token re-acquiring is granted (L1)"
    requirement: MT5D-02
    verification:
      - kind: integration
        ref: "supabase/tests/test_mt5_terminal_lease.sql#L1 (pg-lane; node scripts/mutation-runner/run.mjs --file supabase/tests/test_mt5_terminal_lease.sql)"
        status: pass
    human_judgment: false
  - id: D2
    description: "An expired lease is taken over and the old token can neither renew nor release it; a foreign release changes nothing; renew is fenced and never resurrects a released lease; distinct terminals are independent (L2, L3, L4, L7)"
    requirement: MT5D-02
    verification:
      - kind: integration
        ref: "supabase/tests/test_mt5_terminal_lease.sql#L2,L3,L4,L7 (pg-lane)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Bad digest, ttl, token and holder raise 22023 and write nothing; the table CHECKs refuse a digit-only holder (L5, L8)"
    requirement: MT5D-02
    verification:
      - kind: integration
        ref: "supabase/tests/test_mt5_terminal_lease.sql#L5,L8 (pg-lane)"
        status: pass
    human_judgment: false
  - id: D4
    description: "anon and authenticated reach neither the RPCs nor the table; service_role reaches the RPCs and SELECT only; RLS on; search_path pinned (L6 plus the catalogue self-verify)"
    requirement: MT5D-02
    verification:
      - kind: integration
        ref: "supabase/tests/test_mt5_terminal_lease.sql#L6 (pg-lane)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Manual rollback applies cleanly after the migration on the lane and its verify block passes"
    requirement: MT5D-02
    verification:
      - kind: other
        ref: "scripts/pg-lane/run.sh applying 01, 07, the migration, then down/20261126120000-rollback.sql (rollback NOTICE printed)"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-11-25
status: complete
---

# Phase 230 Plan 01: MT5 terminal lease (database half) Summary

**One lease row per MT5 terminal behind three token-fenced SECURITY DEFINER RPCs (acquire, renew, release), proved on a real PostgreSQL by an 8-arm gate in which every arm has a twin that bites.**

## Performance

- **Duration:** about 45 min
- **Completed:** 2026-11-25
- **Tasks:** 3 (1 tracer, 2 auto/tdd)
- **Files:** 6 created, 0 modified

## Accomplishments

- `public.mt5_terminal_leases` with named CHECKs for the 64-hex digest, the closed holder set (four literals or a canonical lower-case UUID) and the site shape; RLS on with no policy; every table privilege revoked, then SELECT granted to service_role only.
- `acquire_mt5_terminal_lease` is a single `INSERT ... ON CONFLICT (terminal_digest) DO UPDATE ... WHERE <free, expired or same token>` whose answer is the row count (DEC-01-C). Same-token acquire is idempotent (DEC-01-B).
- `renew_mt5_terminal_lease` matches on the token alone; `release_mt5_terminal_lease` NULLs the token and keeps the row (DEC-01-A), so a renew landing after the release returns false and leaves the row free (RESEARCH Pitfall 1).
- Bad input raises 22023 with fixed messages that echo no argument; the expiry clock is the database `now()`.
- A catalogue-only `DO $verify$` block (reads no row; `lint-migration-data-dependence` reports 0 NEW) and a manual rollback under `down/`, applied on the lane and verified.
- Gate `test_mt5_terminal_lease.sql`: arms L1 to L8, sentinel `ALL 8 ARMS EXECUTED (L1,L2,L3,L4,L5,L6,L7,L8)`; `arms: 8/8/0`, `biting: 8`.

## Task Commits

1. Task 1 (tracer), table, acquire RPC, grants, arm L1: `c269bb694`
2. Task 2, renew and release RPCs, arms L2 L3 L4 L7: `a1093af29`
3. Task 3, arms L5 L6 L8, self-verify, rollback, three mirrors: `94a764f5d`

The tracer feedback gate: the tracer `<verify>` is automated-only, so it was re-run end to end (exit 2, `arm L1 ... RED (identity ok)`) and expansion continued.

## Verification (verbatim)

`node scripts/mutation-runner/run.mjs --file supabase/tests/test_mt5_terminal_lease.sql` on the final tree, exit 2 (the diagnostic mode never exits 0):

```
  baseline  supabase/tests/test_mt5_terminal_lease.sql — exit 0
  arm L1                       exit   3  RED (identity ok)
  arm L2                       exit   3  RED (identity ok)
  arm L3                       exit   3  RED (identity ok)
  arm L4                       exit   3  RED (identity ok)
  arm L5                       exit   3  RED (identity ok)
  arm L6                       exit   3  RED (identity ok)
  arm L7                       exit   3  RED (identity ok)
  arm L8                       exit   3  RED (identity ok)
  restore   supabase/tests/test_mt5_terminal_lease.sql — exit 0
arms: 8/8/0   (executed/annotated/waived)
biting: 8   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
No defects in the narrowed scope.
```

- `node scripts/mutation-runner/run.mjs --parse-only`: `No static defects. Every prose marker has a twin and every needle still matches.`
- `node scripts/lint-migration-data-dependence.mjs`: exit 0, `83 refusal(s), 83 allowlisted, 0 NEW`.
- `node scripts/lint-sql-gates.mjs`: exit 0, `scanned 122 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s)`; `--self-test`: `7 rules, red+green each`.
- `cd analytics-service && .venv/bin/python -m pytest tests/test_sql_gate_scoped_updates.py -q -p no:cacheprovider`: `4 passed`, with no edit to that file (the plan's Census note holds: the back-dating UPDATEs target `mt5_terminal_leases`, not `strategy_analytics`; PATTERNS said otherwise and the plan's correction is the measured one).
- Rollback on the lane (01, 07, migration, then the rollback file): printed `Rollback 20261126120000: the three lease functions and public.mt5_terminal_leases dropped.`
- No analytics Python changed, so mypy strict was not run.

## PROOF-01 (neuter, RED, byte restore, GREEN)

```
backup: cp -p supabase/migrations/20261126120000_mt5_terminal_lease.sql <scratch>/mig.bak (exit 0)
# neuter: the DO UPDATE WHERE condition of acquire removed by hand (the statement ends at EXCLUDED.expires_at)
bash scripts/pg-lane/run.sh --workdir <scratch>/proof --apply scripts/pg-lane/fixtures/01-fixture-core.sql scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql supabase/migrations/20261126120000_mt5_terminal_lease.sql --gate supabase/tests/test_mt5_terminal_lease.sql
lane exit=3
psql:supabase/tests/test_mt5_terminal_lease.sql:95: ERROR:  P0001: TEST FAILED (L1): a second token acquiring a terminal an unexpired token holds returned t; two processes would drive the one terminal at once.
cp <scratch>/mig.bak supabase/migrations/20261126120000_mt5_terminal_lease.sql
cmp -s exit=0
diagnostic: node scripts/mutation-runner/run.mjs --file supabase/tests/test_mt5_terminal_lease.sql
diagnostic exit=2   (arm L1 .. L8 all RED (identity ok); biting: 8; No defects in the narrowed scope.)
```

The gate also went RED for each arm on the first run before its migration part existed: arm L2 printed `TEST FAILED (L2): SQLSTATE 42883 ... renew_mt5_terminal_lease(text, uuid, integer) does not exist` against the Task 1 migration.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in the plan's twin design] L4's twin and L2's release check could not be the first failure**
- **Found during:** Task 2
- **Issue:** The plan's L4 twin ("release keeps the owner token") is caught first by L3's owner-NULL assertion (L3 is earlier in file order), so L4 could never be the first `TEST FAILED`. The plan's L2 asserts "A's release returns false" after a takeover, which an L3 twin (release without a token predicate) reddens first, so L3's twin could never be the first failure.
- **Fix:** L2 keeps the renew check and drops the stale-release check; the stale-release assertion (an old token's release after a takeover is refused, owner unchanged) moved into L3, so the L3 twin names L3. L4's twin is renew matching a freed row (`OR owner_token IS NULL`), the exact Pitfall 1 resurrection; the keep-the-token release variant stays covered by L3's owner-NULL check and by the self-verify clause on release's body. L7's twin uses ONE token for two terminals, because with two different tokens the token predicate alone would hide a missing digest predicate. All five arms of Task 2 reported `RED (identity ok)`.
- **Files modified:** supabase/tests/test_mt5_terminal_lease.sql
- **Commit:** a1093af29

**2. [Plan-internal inconsistency, not auto-fixable here] `dump-sql-functions.ts --check` cannot exit 0 in this plan**
- **Found during:** Task 3
- **Issue:** The verify line and `<verification>` ask for `--check` to exit 0 with the three new mirrors, but the same plan says census pins are plan 06's, and plan 06 owns the three dated `snapshot-only` NAME_SET_RATCHET rows (its Task 2). Run now, `--check` exits 1 with exactly three findings: `snapshot-only: acquire_mt5_terminal_lease`, `release_mt5_terminal_lease`, `renew_mt5_terminal_lease`. The ratchet text says not to add a row to make a run green, so none was added here.
- **Fix:** none in this plan, by instruction. Plan 06 Task 2 clears it. The three mirrors are exactly the three files `npm run schema:functions` produced, and no existing mirror changed.
- **Files modified:** none
- **Commit:** n/a

**Total deviations:** 1 auto-fixed (Rule 1), 1 sequencing conflict recorded for plan 06.
**Impact:** none on the contract. The RPC signatures, table shape and semantics are exactly the Interface contract.

## Authentication Gates

None.

## Known Stubs

None. Nothing calls the RPCs until plan 02 lands, which is stated in the migration header and the plan.

## Threat Flags

None beyond the plan's register. T-230-01 to T-230-04 are mitigated and pinned by arms L5, L6, L8, L4 and the catalogue self-verify.

## Issues Encountered

- `npx tsx scripts/dump-sql-functions.ts --check` exits 1 until plan 06 adds the ratchet rows (Deviation 2).
- Stamp check: `ls supabase/migrations/*.sql | sort | tail -n 1` prints `supabase/migrations/20261126120000_mt5_terminal_lease.sql`, so the stamp still sorts last in this tree (newest other: 20261125151936). Re-check at ship time (plan 08).

## Next Phase Readiness

Ready for plan 02 (the Python lease client calls these three RPCs) and plan 06 (the census files this gate and these mirrors move: mutation floors and their restatement pins, SQL gate file count, anti-skip sentinels, compared-function floor, NAME_SET_RATCHET rows, TypeScript types).

## Self-Check: PASSED

- FOUND: supabase/migrations/20261126120000_mt5_terminal_lease.sql
- FOUND: supabase/migrations/down/20261126120000-rollback.sql
- FOUND: supabase/tests/test_mt5_terminal_lease.sql
- FOUND: supabase/schema/functions/acquire_mt5_terminal_lease.sql
- FOUND: supabase/schema/functions/renew_mt5_terminal_lease.sql
- FOUND: supabase/schema/functions/release_mt5_terminal_lease.sql
- FOUND commits: c269bb694, a1093af29, 94a764f5d
- Acceptance greps: `CREATE FUNCTION public.acquire_mt5_terminal_lease` 1, `renew` 1, `release` 1; `TEST FAILED (L` 42 (at least 8); `ALL 8 ARMS EXECUTED` 1; `RED-UNDER-SETUP` 1; mirrors 3; rollback present.
