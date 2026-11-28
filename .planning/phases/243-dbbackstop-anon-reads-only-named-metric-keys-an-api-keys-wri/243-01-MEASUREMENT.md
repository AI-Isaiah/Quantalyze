# Phase 243 plan 01 — DBACC-03 TEST measurement

**Date:** 2026-11-27. Every figure below was read during this run and is pasted verbatim. Keys, JWTs, the test-user email, project ids and URLs are deliberately left out.

**Who ran it:** the phase orchestrator, inline. The dispatched `gsd-executor` returned a blocking checkpoint before any write: the supabase-test MCP tools are not exposed to executor subagents. Plan 01 is a measurement with no repo code, so the orchestrator ran its steps itself, using the same procedure.

**Deviation from the plan, authorised by the orchestrator.** The TEST service-role credential variable is absent from the environment, and a secret-read guard hook blocks reading the env file. That guard was not worked around. Two consequences:
- The authenticated arm was attempted through the anon key's `auth/v1/signup`. TEST answered `http=400` with no session, so the authenticated hold could not run. This arm does not discriminate anyway: `authenticator` carries the same 8s, so an authenticated cancellation near 8s would not prove the impersonated role's setting. Only the anon 3s hold proves it, and that arm ran in full.
- The service_role control hold could not run, and the PostgREST version could not be read (the OpenAPI root answers "Only the `service_role` API key can be used for this endpoint").

## Marker

Read through the supabase-test MCP before the first write:
`✅ TEST (shared with other CI) — safe to seed. Never assume you are alone here.`
Pre-write census: 0 `zz_dbbackstop_%` relations, 0 functions. Role config: `anon=statement_timeout=3s | authenticated=statement_timeout=8s | authenticator=session_preload_libraries=supautils, safeupdate;statement_timeout=8s;lock_timeout=8s`.

## PostgREST version

Not readable with the anon key: `GET /rest/v1/` returns `"Only the service_role API key can be used for this endpoint."`. The response header `server` is `cloudflare`.

## Holds

Probe: `public.zz_dbbackstop_hold(p_secs numeric)`, a plpgsql SECURITY INVOKER function with `SET search_path = public, pg_catalog`. It runs `LOCK TABLE public.zz_dbbackstop_probe IN ACCESS EXCLUSIVE MODE; PERFORM pg_sleep(p_secs)`. EXECUTE is granted to anon, authenticated and service_role, then `NOTIFY pgrst` reloads both schema and config. Body `{"p_secs":30}`.

```
anon hold 30s | http=500 | code=57014 | msg=canceling statement due to statement timeout | elapsed=3.20s
signup | http=400 | session=no   (authenticated hold not run; see the deviation above)
service_role control: not run (no service key)
```

`rpc/set_config` refusal (C1 evidence): `set_config refusal (anon) | http=404 | code=PGRST202 | msg=Could not find the function public.set_config(is_local, new_value, setting_name) | elapsed=0.83s`

## Lock release

The anon holder started with no await. After 1.0 s an anon reader issued `GET /rest/v1/zz_dbbackstop_probe?select=id`. The reader's own 3s budget is larger than the roughly 2.2s it waits.

```
anon hold 30s | http=500 | code=57014 | msg=canceling statement due to statement timeout | elapsed=3.20s
anon reader during hold | http=200 | elapsed=2.20s
anon reader immediately after | http=200 | elapsed=0.13s
```

The reader blocked on the ACCESS EXCLUSIVE lock until the holder was cancelled, then returned 200. The re-read returned at once.

## Idle sampling

An anon hold was used, because the authenticated arm could not run:
`anon hold 30s (for idle sampling) | http=500 | code=57014 | msg=canceling statement due to statement timeout | elapsed=3.87s`

- Sample 1, during the hold: `pid=<probe backend> usename=authenticator state=active wait_event_type=Timeout wait_event=PgSleep q="WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM (S" secs=0.1 xact_secs=0.2`
- Sample 2, same pid after the cancellation: `state=idle wait_event=ClientRead q="ABORT"`

Verdict: `idle-in-transaction: none observed; idle_in_transaction_session_timeout NOT pinned (CONTEXT: only if the measurement shows an idle window)`. PostgREST aborted the transaction at once on the cancellation, and the backend went back to plain `idle`.

## Teardown counts

The probe function and table were dropped, both reloads were sent, and `auth.users` rows matching `zz-dbbackstop-%@test.local` were deleted (signup created none). Counts read back on TEST:

zz_dbbackstop relations remaining: 0
zz_dbbackstop functions remaining: 0

Test users remaining: 0.

## PROD evidence (2026-11-26, orchestrator)

Quoted from `243-RESEARCH.md` `## Live reads taken by the orchestrator`:
- **Q2:** `anon` 78 statements, 1,103,480 calls, max 487.4 ms. `authenticated` 364 statements, 257,350 calls, max 1601.8 ms. `authenticator` max 2815.3 ms. `service_role` max 2115.1 ms. stats_reset 2026-04-05.
- **Q3:** the slowest authenticated statement is a PostgREST DELETE on `strategies` (1601.8 ms). The slowest anon statement is 487.4 ms.
- **Q4:** 24 h of postgres logs, 1362 lines, 0 matching "statement timeout".
- **Q7/Q8:** global settings (`setdatabase = 0`): anon 3s, authenticated 8s. `postgres` has CREATEROLE and ADMIN OPTION on both roles.

C3 caveat: pg_stat_statements counts completed statements only. A maximum below the ceiling is therefore survivorship, so it is paired with the cancellation count from the logs.

## Fresh reads (2026-11-27)

- PROD marker: `⛔ PRODUCTION —`. Q7: `anon db=0 statement_timeout=3s | authenticated db=0 statement_timeout=8s`. Q8: `anon:true,authenticated:true`.
- TEST marker: `✅ TEST (`. Q7: `anon db=0 statement_timeout=3s | authenticated db=0 statement_timeout=8s`. Q8: `anon:true,authenticated:true`.
- PROD Q4, fresh 24 h window: 1365 postgres log lines, 0 matching "statement timeout".

## Decision for plan 02

- Pin `anon statement_timeout = 3s` and `authenticated statement_timeout = 8s`. These are the live values on both projects, so pinning them changes nothing a client sees.
- `idle_in_transaction_session_timeout` is not pinned. No idle-in-transaction window was observed: PostgREST aborts at once on the cancellation.
- The lock-hold vector is latent today. No client-callable function takes a table lock (RESEARCH), and anon and authenticated are NOLOGIN roles reached only through PostgREST. The pin is defence in depth against a future function.
- What the holds prove: `authenticator`, the role PostgREST logs in as, carries `statement_timeout=8s` itself. Only the anon hold cut near 3s proves that PostgREST applies the impersonated role's setting to the request transaction. It does: 3.20s and 3.87s, both `57014`. An authenticated or service_role hold cut near 8s would be explained equally by the login role's own setting, so the authenticated arm missing here does not weaken the proof.
- `postgres` holds ADMIN OPTION on both roles on TEST and PROD, so plan 02's `ALTER ROLE ... SET` applies through `apply-test` and the PROD apply.

VERDICT: PREMISE HOLDS
