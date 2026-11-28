---
phase: 243-dbbackstop-anon-reads-only-named-metric-keys-an-api-keys-wri
plan: 08
subsystem: testing
tags: [e2e, seeds, supabase, insert_api_key, DBACC-02, local-stack]
status: complete
requires:
  - phase: 243-dbbackstop
    plan: 05
    provides: "public.insert_api_key (SECURITY DEFINER, service_role only, p_id for seeds) and the api_keys_user_id_immutable trigger"
provides:
  - "e2e/helpers/seed-test-project.ts insertApiKeyViaRpc: the one e2e seed path for api_keys"
  - "eleven migrated seed sites outside src/ (e2e helper x8, three e2e specs, demo seed, two integration suites, four Python live suites): none writes api_keys through PostgREST insert/upsert"
affects: [PR-C (insert fence), e2e-seeded, python job, manual demo seeding]
tech-stack:
  added: []
  patterns:
    - "a seed that needs columns the writer does not take passes them as extras: one admin UPDATE after the RPC, with a best-effort delete of its own row if that UPDATE fails"
    - "fixed-id seeds read by id, call insert_api_key with p_id when absent, then update the mutable columns; never an upsert"
key-files:
  created: []
  modified:
    - e2e/helpers/seed-test-project.ts
    - e2e/axe-app-wide.spec.ts
    - e2e/onboarding-funnel.spec.ts
    - e2e/reflow-sweep-authed.spec.ts
    - scripts/seed-full-app-demo.ts
    - tests/integration/mig-128-batch-concurrency.test.ts
    - tests/integration/mig-129-cutover-concurrency.test.ts
    - analytics-service/tests/test_compute_jobs_fencing.py
    - analytics-service/tests/test_flow_price_store_live.py
    - analytics-service/tests/test_nav_marks_writer_live.py
    - analytics-service/tests/test_trade_read_store_live.py
key-decisions:
  - "insertApiKeyViaRpc throws an Error that carries the PostgREST code and details, because the sfox and mt5 seeds read code 23514 to name a missing boundary-widen migration; a plain message-only Error would have silently turned that fail-loud path into a generic one"
  - "the helper takes the admin client as a parameter and never builds one, so getAdmin()/getCleanupAdmin() not-prod asserts always run first (T-243-25)"
  - "the helper is deliberately not shared with plan 07's src/lib/test-helpers/live-db.ts: the e2e tree imports nothing from src/lib/test-helpers"
requirements-completed: [DBACC-02]
duration: ~2h 40m (about 2h of it queued behind the shared Docker lane and a machine at load average 100)
completed: 2026-11-27
commits: 3
plan_head_before: 9de595438a0dae33d828d693b3eeb81abf3564e8
plan_head_after: f24f54d475755e84d0f9523723fae193fa109934
actuals:
  tokens: 8300
  tasks: 3
  commits: 3
---

# Phase 243 Plan 08: e2e, script, integration and Python seeds move to insert_api_key Summary

Every non-`src` writer of `api_keys` that touches a real database now goes through the audited `insert_api_key` RPC, so the PR-C insert fence has no seed to break. One new e2e helper (`insertApiKeyViaRpc`), eleven migrated seed sites, proven on the local-stack lane.

Tasks 3/3, 11 files modified, no checkpoint, no auth gate. Commits: `18005baf7` (task 1, tracer), `48608a558` (task 2), `f24f54d47` (task 3). `git rev-list --count 9de595438..HEAD` reads 3 before this SUMMARY's own commit.

## Precondition

- Measured by the orchestrator (2026-11-27): the PROD marker query named PRODUCTION, then the ledger tip read returned `20261127130000 cron_destinations_exact` and `20261127120100 insert_api_key_rpc_and_user_id_immutable` (plan 05's version) is present. I did not run that read (no PROD MCP).
- Run by me: `git fetch origin main -q` exit 0; `git ls-tree --name-only origin/main supabase/migrations/` lists exactly one `_insert_api_key_rpc_and_user_id_immutable.sql` (`20261127120100_...`); `git merge-base --is-ancestor 8e8c0753 HEAD` true (this branch contains PR-A); `node scripts/verify-plan-anchors.mjs <plan>` printed `OK: 1 plan file(s), no stale claims.` exit 0.

## Attestation census (BEFORE any edit)

`insert_api_key` stamps `attested_venue = exchange`; the direct inserts it replaces left it NULL. Scan of every non-comment line naming `attested_venue` under `src/` (test files and `test-helpers` excluded):

```
src/app/api/keys/validate-and-encrypt/route.ts:941: attested_venue: exchangeNormalized,        (WRITER)
src/app/api/strategies/finalize-wizard/route.ts:184: attested_venue: z.string().nullable().optional(),
src/app/api/strategies/finalize-wizard/route.ts:1274: .select("exchange, attested_venue")
src/app/api/strategies/finalize-wizard/route.ts:1300: typeof keyVenueRow?.attested_venue === "string"
src/app/api/strategies/finalize-wizard/route.ts:1301: ? keyVenueRow.attested_venue
src/app/api/strategies/finalize-wizard/route.ts:1507: .select("api_key_id, api_keys ( exchange, attested_venue )")
src/app/api/strategies/finalize-wizard/route.ts:1708: typeof member.api_keys?.attested_venue === "string"
src/app/api/strategies/finalize-wizard/route.ts:1709: ? member.api_keys.attested_venue
src/lib/database.types.ts:516/549/582 (generated types)
```

The one runtime reader is `finalize-wizard/route.ts`. Scan of `e2e/` for `attested_venue`: **no hits**. Scan of `e2e/` for `finalize-wizard`: `composite-onboarding.spec.ts:24-25` only, in a comment (its preview poller calls `/api/keys/sync`). No spec reaches the real route with a seeded key, so no spec asserts the unattested branch and no seed needed `extras: { attested_venue: null }`. Per the plan's rule every seeded key is left attested (the production shape). DB-side, `supabase/schema/functions` carries `attested_venue` only in the writers and scrub triggers (`add_wizard_composite_key`, `create_wizard_strategy`, `insert_api_key`, `scrub_client_supplied_*`), none of which an e2e seed reads.

## Lane driver (Task 1 proof, uncommitted driver, lane `run.sh up`, loopback only)

Per-site read-back through the admin client; no key printed:

```
PASS seedWizardDraft: exchange=binance attested=binance active=true
PASS seedAllocatorBook: exchange=binance attested=binance venue_account_id_set=true
PASS seedCompositeStrategy[seq 1]: exchange=deribit attested=deribit
PASS seedCompositeStrategy[seq 2]: exchange=deribit attested=deribit
PASS seedCompositeStrategy[seq 3]: exchange=deribit attested=deribit
PASS seedSfoxVerifiedStrategy: exchange=sfox attested=sfox
PASS seedMt5VerifiedStrategy: exchange=mt5 attested=mt5
PASS seedManagerKeyPanel[linked]: sync_status=error sync_error_set=true attested=binance
PASS seedManagerKeyPanel[spare]: exchange=okx active=true
PASS seedManagerKeyPanel[disconnected]: is_active=false disconnected_at_set=true
PASS extras refusal (user_id): extras naming user_id throws
PASS extras attested_venue null: attested=null
DRIVER OK
```

Eight helper sites (wizard draft, allocator book, composite x3 as one site in a loop, sfox, mt5, manager panel x3: linked, spare, disconnected). The three specs (axe, reflow, onboarding) call the same helper with their own admin client; they are covered by the helper's proof and by `tsc`, and were not run as browser specs here (no web server on the lane).

## Integration suites, before and after (lane, `SUPABASE_TEST_URL` / `SUPABASE_TEST_SERVICE_ROLE_KEY` from `.stack-env`)

| run | result |
|---|---|
| BEFORE the edit | `Test Files 1 failed \| 1 passed (2)`, `Tests 1 failed \| 6 passed (7)`; failure: `mig-129 ... test_concurrent_writer_serializes_behind_cutover_lock`, `AssertionError: expected true to be false` at `expect("daily_returns_grid" in finalMetrics).toBe(false)` |
| AFTER the edit | identical: `Test Files 1 failed \| 1 passed (2)`, `Tests 1 failed \| 6 passed (7)`, the same test and the same assertion (its line moved 437 to 433 because the seed shrank by four lines) |

The one failure is **pre-existing and unrelated to `api_keys`** (it asserts a metrics_json key survives a cutover and fails on the lane before my edit too). It is recorded, not fixed, and not routed here. Neither run printed a `Seed: api_keys insert failed` or `Seed: api_key insert failed` line. The seven tests are not skipped (an unset env skips all of them, as an earlier misconfigured session showed: `7 skipped`).

## Python live suites (lane, `CI=true`, `SUPABASE_TEST_URL` / `SUPABASE_TEST_SERVICE_KEY` from `.stack-env`, run from `analytics-service/`)

```
pytest tests/test_flow_price_store_live.py tests/test_nav_marks_writer_live.py tests/test_trade_read_store_live.py "tests/test_compute_jobs_fencing.py::test_advance_sync_cursor_monotonic_guard_no_regress" -q -rs --no-cov
12 passed, 18 warnings in 60.94s (0:01:00)
```

Zero skips (no `-rs` skip line). `CI=true` matches the CI python job, so an unreachable lane would hard-fail rather than skip; an earlier run against a dead stack showed exactly that (8 failed, 1 error, with the "unset in CI" message). The 18 warnings are supabase-py `timeout`/`verify` deprecations, unrelated.

CI's mypy strict invocation (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 146 source files`. The four test files are outside that path set by design; `py_compile` on them passed.

## Demo seed: NOT run, and why

`scripts/seed-full-app-demo.ts` was not run end to end. Its `SEED_CONFIRM_STAGING` interlock and project-ref allowlist refuse any non-hosted URL, so it cannot target the lane, and running it against shared TEST would wipe and re-seed demo rows other CI reads. That refusal is the guard working; I did not touch it. It is proven by `tsc`, by `critical-regressions.test.ts` (the `[AUDIT-2026-05-07 #35]` allowlist block) and `observ12-fixtures-presence.test.ts` (188 passed), and by the static counts below. Its absent-then-RPC-then-update shape is the same shape plan 07 proves on the lane for the scenario-commit fixed-id seeds.

## Verification

- `npx tsc --noEmit`: exit 0, no output (run after every task and on the final tree).
- `npm run lint`: exit 0 (eslint, route manifest, route contract, planning hygiene, canonical domain, demo credential digests all OK).
- `npx vitest run src/__tests__/critical-regressions.test.ts src/__tests__/observ12-fixtures-presence.test.ts`: `Test Files 2 passed (2)`, `Tests 188 passed (188)`.
- Whole `npx vitest run` (machine at load average 50 to 100 from other agents): `Test Files 16 failed | 1282 passed | 20 skipped (1318)`, `Tests 25 failed | 28309 passed | 306 skipped`. Triage of the 25:
  - 23 are load timeouts (20 at the 5 s default, 2 at an explicit 30 s, plus one `FactsheetBody.advanced` assertion that read before an async write landed). Every one passes when its file is re-run with a raised `--testTimeout` (the factsheet, `check-planning-hygiene`, `return-stats.single-source`, `mutation-annotation-parser`, `mutation-runner-floors`, `queries.my-allocation`, `seam-venue-vocabulary`, `local-stack-lane-wiring`, `page.key-pill` files: all green on re-run, e.g. `mutation-annotation-parser` plus `mutation-runner-floors`: 241 passed).
  - 2 are deterministic and PRE-EXISTING: `src/lib/factsheet/compute.conventions.test.ts` fixtures B and C (frozen-snapshot mismatch). Re-run on a throwaway worktree of the base commit `9de595438` (before any change of mine) they fail identically (`2 failed | 21 passed`). This plan changes no `src/` file. Logged under Deferred Issues, not fixed (out of scope).
- Direct-write counts over e2e helper and specs, demo seed, both integration suites: `0` (acceptance said HEAD=11 EXPECT 0). Python count over the four live suites: `0` (HEAD=4). `grep -ac 'rpc("insert_api_key"' scripts/seed-full-app-demo.ts` = 1; `grep -ac "export async function insertApiKeyViaRpc"` = 1.
- Whole-repo residual scan (tracked `.ts/.tsx/.js/.mjs/.py` outside `src/`, `.planning/` and `docs/`; multi-line; string-literal `api_keys` then `.insert(`/`.upsert(`):

```
analytics-service/tests/test_walletoffset_probe.py:1756: table("api_keys").insert(
```

That is the in-memory fake, which touches no database. Nothing else.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The helper's Error had to carry the PostgREST `code` and `details`**
- **Found during:** Task 1, converting the sfox and mt5 sites.
- **Issue:** `isSfoxBoundaryViolation` / `isMt5BoundaryViolation` read `err.code === "23514"`; a message-only Error from the helper would have lost the code, silently degrading the fail-loud "boundary-widen migration is not applied" message to a generic one.
- **Fix:** `insertApiKeyViaRpc` throws `Object.assign(new Error(...), { code, details })`; the two sites catch it and pass it to the same detectors. Thrown message wording is preserved.
- **Files modified:** `e2e/helpers/seed-test-project.ts`
- **Commit:** `18005baf7`

**2. [Rule 2 - Missing critical functionality] Helper deletes its own row if the extras UPDATE fails**
- **Found during:** Task 1, reading `seedManagerKeyPanel`'s rollback list.
- **Issue:** the caller never receives the id of a failed seed, so a row inserted by the RPC whose extras UPDATE failed would leak on the shared TEST DB.
- **Fix:** best-effort `delete().eq("id", id)` before throwing.
- **Files modified:** `e2e/helpers/seed-test-project.ts`
- **Commit:** `18005baf7`

### Environment notes (not plan deviations)

- The lane driver could not live in the scratchpad: `tsx` resolves `@supabase/supabase-js` relative to the driver's directory, so it was run from an untracked file in the worktree root and deleted afterwards (never committed).
- The shared Docker lane is a singleton and a non-GSD agent (a `.claude/worktrees/agent-*` checkout) was also booting a stack without the lock; with the machine at load average 100 the analytics container failed its health check on several consecutive boots. The script released the lock and retried; the final script's first cycle booted. Early lane `down` output is suppressed in my wrapper, and one wrapper run left my containers up; I took the lock, ran `run.sh down` myself and confirmed `docker ps -q` empty.

## Deferred Issues

- `src/lib/factsheet/compute.conventions.test.ts` fixtures B (zero-return days) and C (interior calendar gaps): frozen snapshots mismatch on the base commit `9de595438` and on this branch alike. Pre-existing, unrelated to `api_keys`, not touched. The orchestrator should route it if no owner exists.
- `tests/integration/mig-129-cutover-concurrency.test.ts > test_concurrent_writer_serializes_behind_cutover_lock` fails on the lane before and after this plan (`daily_returns_grid` survives the cutover). Pre-existing, recorded above.

## Known Stubs

None. No placeholder data flows to a UI; the `e2e-placeholder-ciphertext` literals are the existing test-only ciphertext idiom.

## Threat Flags

None. No new endpoint, auth path or schema change; the seeds only call an existing service_role RPC. T-243-25 (helper takes the client from the caller, never builds one), T-243-26 (interlock and allowlist untouched, still pinned) and T-243-27 (keys only in the environment, masked in logs) are honoured.

## Self-Check: PASSED

- `insertApiKeyViaRpc` present in `e2e/helpers/seed-test-project.ts`: FOUND.
- Commits `18005baf7`, `48608a558`, `f24f54d47` are ancestors of HEAD: FOUND.
- docker down (`docker ps -q` empty) and the lane lock released: confirmed.
