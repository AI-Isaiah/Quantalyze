# 145-REPRODUCTION.md — SC#1: the stale 42501 / `PROCESS_KEY_UNIFIED_BACKBONE` claim

**Executed:** 2026-08-17, worktree `feat/v1.19-phase-145`, HEAD `330bca56`
**Requirement:** JOB-06 (`.planning/REQUIREMENTS.md:56`) — "The stale 42501 / `PROCESS_KEY_UNIFIED_BACKBONE` claim is reproduced against current `main` before any fix is scoped (documented pass/fail)"
**Design:** four arms per 145-CONTEXT.md "What a reproduction ATTEMPT should actually consist of", fleshed out in 145-RESEARCH.md §4. Arms 1–3 executed in this plan (repo-side); arm 4 + census are orchestrator-session-only (Supabase MCP is stripped from subagents) and land in Plan 02.

---

## The claim under test (TODOS.md:818-821, verbatim)

> - **Unified-backbone CSV-finalize breaks if flag on** — service-role client has no
>   `auth.uid()` → 42501 every time when `PROCESS_KEY_UNIFIED_BACKBONE=on`. Skip unified for
>   finalize or forward JWT. Make `USE_COMPUTE_JOBS_QUEUE` permanent + delete both legacy
>   finalize placeholder-write branches.

## Pre-registered expected outcome (registered BEFORE execution, from CONTEXT/RESEARCH §4)

- **Arm 1 GREEN** (the 42501 guard fires when driven directly) — the positive control that makes a negative verdict non-vacuous.
- **Arms 2/3/4 GREEN** (no code path reaches the guard through a service-role client) — the negative controls.
- All four together ⇒ **CANNOT REPRODUCE**.

## ⭐ The split (D-02) — state it or invite the wrong deletion

**The GUARD is live. The PATH is closed.** These are two different facts and both matter:

- The guard (`finalize_csv_strategy`'s two 42501 raises, `20260728120000:225-234`) is REAL and fires today — arm 1 proves it by execution, and `supabase/tests/test_csv_finalize_auth_guard.sql` now keeps it a CI fact permanently.
- The path the TODOS bullet describes (a service-role client calling finalize) does not exist at HEAD — arm 2 proves both call sites are user-scoped, and `PROCESS_KEY_UNIFIED_BACKBONE` has zero code readers (145-RESEARCH.md Runtime State Inventory; fresh grep this session found only comments/test-constants). The fix the bullet proposes ("forward JWT") ALREADY SHIPPED in Phase 19.1 (2026-05-27): the route forwards `X-User-Access-Token` (`route.ts:1324` `userAccessToken`, re-verified live this session) and Python builds `get_user_scoped_supabase(user_token)` from it (`process_key.py:1135/:1148`).

A flat "not a bug" is WRONG: it reads as license to delete the guard or the token forwarding, which are exactly what keeps the bug unreproducible. ⛔ Do not re-add the forwarding (it exists); a diff that "adds" it is the PITFALLS warning sign. ⛔ No 42501 fix is scoped (D-01).

---

## Arm 1 — positive control: the 42501 guard fires (now a permanent CI gate)

**Gate file:** `supabase/tests/test_csv_finalize_auth_guard.sql` (ungated, two parts, claims idiom, per-part BEGIN/ROLLBACK). Proven on a throwaway Postgres 16.13 cluster (`/opt/homebrew/opt/postgresql@16/bin`, socket `$TMPDIR/145-tracer-wt`) via `.planning/phases/145-job-csv-finalize-atomicity/145-repro-harness.sql`, which loads the REAL `20260728120000:196-309` function body verbatim.

**Anti-vacuity first** (the 143 extraction-vacuity lesson — a gate green against an empty cluster proves nothing). Observed on harness apply:

```
NOTICE:  145 harness: REAL 20260728120000 finalize_csv_strategy body loaded (wizard_session_id write verified inside the INSERT fragment).
```

The check is fragment-scoped (`wizard_session_id` inside the strategies-INSERT fragment) — the signature of the LATEST body specifically; a superseded (20260716130500) or stub body fails it.

**Both parts PASS against the real loaded body** (observed, `psql -v ON_ERROR_STOP=1`, exit 0):

```
NOTICE:  Part A OK: no-session finalize_csv_strategy call raised 42501 with the exact guard message.
NOTICE:  Part B OK: mismatched-identity finalize_csv_strategy call raised 42501 with the mismatch message.
NOTICE:  test_csv_finalize_auth_guard: ALL PASS (no-session 42501 with exact message; identity-mismatch 42501).
```

- Part A pins SQLSTATE `42501` AND the EXACT message `finalize_csv_strategy called without an auth session` (`20260728120000:226`).
- Part B pins `42501` AND the mismatch shape (substring `does not match auth.uid`, `20260728120000:230-234`).

**Neuter-RED, BOTH parts (plan-check W3 amendment) — observed 2026-08-17.** Each neuter was a scratch VARIANT of the gate (the committed file was never modified); the real gate re-ran GREEN afterward.

| Neuter | What was changed | Observed output (verbatim) | Exit |
|---|---|---|---|
| Part A | Valid claims MATCHING `p_user_id` set before the call (guard satisfied → expected raise absent) | `ERROR:  TEST FAILED (Part A): finalize_csv_strategy with NO auth session RETURNED 68b6aee6-9eb3-4a1a-9b1d-1088f6ac3263 instead of raising - the no-session guard (20260728120000:225-228) is dead, and a service-role caller would silently write strategies rows under an arbitrary user` | 3 (RED) |
| Part B | Call made with MATCHING identity (`jwt_user` passed as `p_user_id` → mismatch raise absent) | `ERROR:  TEST FAILED (Part B): finalize_csv_strategy with a MISMATCHED identity RETURNED 7a7fc964-7545-4886-853e-bd1556f4b2bb instead of raising - the identity guard (20260728120000:230-234) is dead, and an authenticated caller could write strategies rows under another user` | 3 (RED) |

Restored gate re-run: both parts GREEN, exit 0 (same three NOTICE lines as above).

**Arm 1 verdict: GREEN — the guard fires, both halves, with the pinned messages.**

---

## Arm 2 — negative control: fresh call-site grep (executed at HEAD `330bca56`, 2026-08-17T17:33:54Z — NOT copied from CONTEXT/RESEARCH)

Command (repo root):

```
grep -rn "finalize_csv_strategy" src/ analytics-service/ --include="*.ts" --include="*.py" | grep -v -e test -e __tests__ -e "\.types\.ts"
```

Output, verbatim:

```
src/app/api/strategies/csv-finalize/route.ts:19: * Calls the SECURITY DEFINER `finalize_csv_strategy` RPC (migration 093)
src/app/api/strategies/csv-finalize/route.ts:687: * finalize_csv_strategy + persist_csv_daily_returns RPCs run earlier in
src/app/api/strategies/csv-finalize/route.ts:761:    // this request by the finalize_csv_strategy RPC.
src/app/api/strategies/csv-finalize/route.ts:821:      // finalize_csv_strategy + persist_csv_daily_returns earlier.
src/app/api/strategies/csv-finalize/route.ts:912:  // flow — finalize_csv_strategy created the row milliseconds ago
src/app/api/strategies/csv-finalize/route.ts:978:  // finalize_csv_strategy RPC RAISEs on any other terminal value (server-side
src/app/api/strategies/csv-finalize/route.ts:1155:  // work (the unified /process-key dispatch and the finalize_csv_strategy
src/app/api/strategies/csv-finalize/route.ts:1196:  // status='private'. The unified backbone (below) calls finalize_csv_strategy
src/app/api/strategies/csv-finalize/route.ts:1199:  // Route the contribution through a direct user-scoped finalize_csv_strategy
src/app/api/strategies/csv-finalize/route.ts:1236: * `finalize_csv_strategy` server-side and returns the new strategy_id +
src/app/api/strategies/csv-finalize/route.ts:1275:  // Phase 19.1 (2026-05-27) — finalize_csv_strategy is SECURITY DEFINER and
src/app/api/strategies/csv-finalize/route.ts:1280:  // ("finalize_csv_strategy called without an auth session").
src/app/api/strategies/csv-finalize/route.ts:1323:    // finalize_csv_strategy as the user (auth.uid() = p_user_id).
src/app/api/strategies/csv-finalize/route.ts:1432: * CONTRIB-02 (Phase 110) — contribution CSV finalize. Calls finalize_csv_strategy
src/app/api/strategies/csv-finalize/route.ts:1437: * Python backbone calls finalize_csv_strategy without p_terminal_status (defaults
src/app/api/strategies/csv-finalize/route.ts:1471:      fn: "finalize_csv_strategy",
src/app/api/strategies/csv-finalize/route.ts:1483:  )("finalize_csv_strategy", {
src/app/api/strategies/csv-finalize/route.ts:1493:      `[strategies/csv-finalize contribution] finalize_csv_strategy failed [correlation_id=${args.correlationId}]:`,
src/app/api/strategies/csv-finalize/route.ts:1517:          `finalize_csv_strategy returned a non-uuid strategy id (${String(
src/lib/process-key-client.ts:348:   * (finalize_csv_strategy). The analytics service's service-role client has
src/lib/process-key-client.ts:489:        // router can call user-auth SECURITY DEFINER RPCs (finalize_csv_strategy)
src/lib/wizardErrors.ts:1929:  // `strategies` row is created on the CSV path only by `finalize_csv_strategy`
src/lib/wizardErrors.ts:1973:  // `finalize_csv_strategy`, and uvicorn does not cancel a handler on client
src/lib/wizardErrors.ts:2026:    // `wizard_session_id IS NOT NULL`, and `finalize_csv_strategy` did not WRITE
src/lib/wizardErrors.ts:2036:    //      (user_id, wizard_session_id, source), and finalize_csv_strategy
src/lib/analytics-schemas.ts:309: * Returned by the route after a successful `finalize_csv_strategy` RPC
src/lib/wizard/draft-query.ts:129: *    a NEW `source='csv'` row (`finalize_csv_strategy`, migration
analytics-service/routers/csv.py:9:finalize_csv_strategy RPC directly because that RPC is SECURITY DEFINER
analytics-service/routers/process_key.py:1113:        # finalize_csv_strategy RPC (migration 093 STEP 5) which atomically
analytics-service/routers/process_key.py:1126:            # finalize_csv_strategy is SECURITY DEFINER and enforces
analytics-service/routers/process_key.py:1151:                        "finalize_csv_strategy",
analytics-service/routers/process_key.py:1166:                # finalize_csv_strategy write the session id, so a repeat submit
analytics-service/routers/process_key.py:1398:    #       finalize_csv_strategy had written an SV row carrying that session
analytics-service/services/db.py:84:    ``finalize_csv_strategy``, migration 20260501055202) cannot be called with
```

### Per-hit classification

| Hit(s) | Classification | Client (call sites only) |
|---|---|---|
| `route.ts:1471` + `:1483` | **CALL SITE** (one invocation: the cast at :1471 names the fn type, :1483 invokes it — the CONTRIB-02 contribution arm) | `const supabase = await createClient()` at `route.ts:1461`, imported from `@/lib/supabase/server` (`route.ts:3`) — the **SSR cookie client**, natively user-scoped. **PASS** |
| `process_key.py:1151` | **CALL SITE** (`user_sb.rpc("finalize_csv_strategy", …)` at :1149-1158, the unified-backbone manager arm) | `user_sb = get_user_scoped_supabase(user_token)` at `process_key.py:1148`, with `user_token = request.headers.get("X-User-Access-Token", "")` at `:1135`. `get_user_scoped_supabase` (`db.py:79-111`) builds an anon-key client and sets the USER JWT via `postgrest.auth()` — **user-scoped by construction**. **PASS** |
| `route.ts:19, 687, 761, 821, 912, 978, 1155, 1196, 1199, 1236, 1275, 1280, 1323, 1432, 1437` | mention (comments/docstrings) | — |
| `route.ts:1493, 1517` | mention (error-message string literals in the contribution arm's failure handling) | — |
| `process-key-client.ts:348, 489` | mention (comments explaining WHY the token is forwarded) | — |
| `wizardErrors.ts:1929, 1973, 2026, 2036` | mention (comments) | — |
| `analytics-schemas.ts:309`, `draft-query.ts:129` | mention (comments) | — |
| `csv.py:9`, `process_key.py:1113, 1126, 1166, 1398` | mention (comments/docstrings) | — |
| `db.py:84` | mention (the `get_user_scoped_supabase` docstring — it DOCUMENTS the 42501 failure mode this artifact closes) | — |

**Exactly 2 call sites; both user-scoped. Zero calls on `get_supabase()` (the `lru_cache` service-role singleton, `db.py:70-77`) and zero on `createAdminClient()`** (the file's `createAdminClient` usages at `route.ts:717-718/:817-818` are the strategy_analytics-placeholder and enqueue helpers — neither calls `finalize_csv_strategy`).

**Arm 2 verdict: GREEN — no service-role path to the guard exists at HEAD.**

---

## Arm 3 — the existing Python gates, run and recorded verbatim

Command (from `analytics-service/`, `python3` — never repo root, per the VCR-cassette rule):

```
cd analytics-service && python3 -m pytest tests/test_process_key.py -k "csv_finalize" -q
```

Tail, verbatim (2026-08-17):

```
.........                                                                [100%]
=============================== warnings summary ===============================
../../../../../opt/homebrew/lib/python3.14/site-packages/slowapi/extension.py:720
../../../../../opt/homebrew/lib/python3.14/site-packages/slowapi/extension.py:720
  /opt/homebrew/lib/python3.14/site-packages/slowapi/extension.py:720: DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
    if asyncio.iscoroutinefunction(func):

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
9 passed, 104 deselected, 2 warnings in 3.47s
```

Collected (9): `test_process_key_csv_finalize_calls_finalize_csv_strategy_rpc`, `test_process_key_csv_finalize_without_user_token_returns_401`, `test_pyapi_09c_csv_finalize_does_not_hit_the_precheck_shortcircuit`, `test_seamrim03_csv_finalize_23505_answers_200_with_existing_strategy`, `test_seamrim03_csv_finalize_23505_refetch_is_tenant_and_source_scoped`, `test_cr01_csv_finalize_23505_refuses_a_DIFFERENT_submission`, `test_cr01_csv_finalize_23505_still_resolves_a_TRUE_repeat`, `test_seamrim03_csv_finalize_23505_refetch_miss_does_not_fabricate_success`, `test_seamrim03_csv_finalize_residual_error_message_is_static`.

⚠️ **Overclaim guard (stated here, in the artifact, per the CONTEXT mandate):** these tests are MOCK-LEVEL. They prove WIRING — that the Python router invokes the RPC on the user-scoped client and never on the service client (`test_process_key_csv_finalize_calls_finalize_csv_strategy_rpc` asserts `svc_finalize == []`), and that a missing token 401s without touching the user client. They prove NOTHING about the deployed SQL body or the absence of 42501 in a live stack — that is what arms 1 (deployed-body guard, executed) and 4 (live end-to-end) are for. Do not cite this arm alone as evidence the bug is gone.

**Arm 3 verdict: GREEN — the user-scoped wiring the shipped fix installed is pinned and passing.**

---

## Arm 4 — one live end-to-end finalize on TEST — **PENDING (Plan 02, orchestrator session)**

Executed by Plan 02 in the orchestrator session (Supabase MCP is stripped from subagents). **Pre-registered oracle, verbatim (from 145-RESEARCH.md §4 arm 4):**

> Passwordless idiom: service-role magic-link for a test user → `setSession` → `curl -X POST $TEST_APP_URL/api/strategies/csv-finalize` with a small `daily_returns_series` (10 rows), fresh `wizard_session_id`, `fmt='daily_returns'`, a name, minimal valid metadata. PASS = HTTP 200, body `ok: true` + UUID `strategy_id`; FAIL = any `42501` in any layer's logs, or `CSV_FINALIZE_FAIL`. Then capture the **row-state baseline** (this is also SC#3's measured before-state and §3 Step B's first run):
>
> ```sql
> SELECT id, status, source, wizard_session_id, created_at FROM strategies WHERE id = :sid;
> SELECT status, trust_tier, flow_type, source FROM strategy_verifications WHERE strategy_id = :sid;
> SELECT count(*) FROM csv_daily_returns WHERE strategy_id = :sid;   -- expect 10
> SELECT kind, status FROM compute_jobs WHERE strategy_id = :sid;     -- expect compute_analytics_from_csv
> SELECT computation_status FROM strategy_analytics WHERE strategy_id = :sid;
> ```

TEST only — never PROD (it mints real strategies).

---

## Census — **TAKEN 2026-08-17 (Plan 02, orchestrator session, read-only)**

The four CONTEXT census queries (145-CONTEXT.md `:310-341`) run verbatim on BOTH projects.
Pre-registered interpretation applied; **STOP-rule row 3 FIRED: census non-zero on PROD → re-ranked
from prospective hardening to LIVE CLEANUP.**

### PROD `khslejtfbuezsmvmtsdn`

| query | result |
|---|---|
| (1) full orphans (no dailies, no jobs, no keys, >1h) | **3** — `5454d0d5-0492…` (2026-05-07), `58786362-7e87…` (2026-05-21), `454a301c-4844…` (2026-05-21); all `source='csv'`, `pending_review`, `wizard_session_id` NULL, verification row present, analytics NULL |
| (2) csv + no dailies (any job/key state, any age) | **18** |
| (1) minus (2), i.e. non-csv first-hop | **0** — no wizard first-hop population on PROD |
| (3) window E (dailies, zero jobs, analytics='failed') | **1** (the known composite; EXCLUDED from 145 per CONTEXT Deferred) |
| (4) `process_key_unified_backbone` flag row | present, reads **`'on'`**, updated 2026-05-25 15:51 — INERT (zero runtime readers) and NOT touched (⛔ `20260620120000:86-89` RAISEs at apply time if it reads 'off'; cleanup = Plan 05 TODOS deferral) |

**The 18 query-(2) rows annotated (the Plan 06 terminalize candidate list — re-verify fresh there):**

- **15 × incident casualties**: `published`, job `failed_final`, `analytics='failed'`, no keys —
  created 2026-05-07 (6 rows) and 2026-05-21 (9 rows). Published strategies with permanently-failed
  analytics and zero data rows.
- **3 × pure window-shape orphans** (the query-(1) set): `pending_review`, NO jobs, NO analytics,
  verification row present — same two dates.

⭐ **Every one of the 18 predates the Phase 19.1 token-forwarding fix (both dates sit in the
v0.24.9.30-era incident window; the flag flip was 2026-05-25).** Zero orphans have been created in
the ~3 months of live traffic since. This is the census corroborating CANNOT REPRODUCE: the orphan
population is fossil evidence of the ORIGINAL incident, not of an ongoing defect.

### TEST `qmnijlgmdhviwzwfyzlc`

| query | result |
|---|---|
| (1) full orphans | **8107** — ALL non-csv (`q1_csv = 0`) |
| (2) csv + no dailies | **0** |
| (3) window E | **0** |
| (4) flag row | present, reads **`'off'`** (⚠️ diverges from PROD's `'on'`), updated 2026-05-08 — NOT touched, same trap |

The 8107 are the **wizard first-hop / e2e-seed residue class** — 143's filed non-coverage, EXCLUDED
from 145 scope by decree (recorded here so it is never silently absorbed; Plan 05 files the census
number to TODOS). TEST's CSV population is zero everywhere.

---

## Verdict

**PENDING arm 4 — arms 1-3 consistent with CANNOT REPRODUCE.** The final verdict is written by Plan 02 only after arm 4. When Plan 02 closes the TODOS.md:818-821 bullet, it cites this artifact and states which of the bullet's own two proposed remedies shipped: **"forward JWT" — shipped in Phase 19.1** (`route.ts:1324` / `process_key.py:1135`); "skip unified for finalize" was not taken.
