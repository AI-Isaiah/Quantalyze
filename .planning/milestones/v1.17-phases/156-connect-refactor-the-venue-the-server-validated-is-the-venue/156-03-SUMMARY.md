---
phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
plan: 03
subsystem: database
tags: [supabase, migration, security-definer, service-role, acl, plpgsql, sql-tests]

requires:
  - phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
    plan: 01
    provides: "A1/A2/A4 measurements — the privilege design this migration encodes, and the falsified RESEARCH finding 3 its prose must not re-seed"
provides:
  - "Migration A applied to TEST as version 20260813150106 — both wizard RPCs accept a service_role caller while authenticated keeps its grant AND its full auth.uid() ownership check"
  - "supabase/tests/test_wizard_composite_fence.sql Parts 3c/3d/3e — the CI-run behavioural net for the single-key cross-user guard, the new service_role arm, and the ELSE arm"
  - "Regenerated function snapshots naming 20260813150106 as source"
  - "MEASURED evidence that PR A breaks no existing SQL gate (sql-tests green on main against TEST carrying Migration A)"
affects: [156-04, 156-05, 156-06, 156-07, 156-08, 156-09]

tech-stack:
  added: []
  patterns:
    - "Transitional two-arm role gate — branched, never unioned — for a zero-outage deploy/migration split"
    - "Post-verify that asserts the ownership COMPARISON, not merely that auth.uid() is called, and aborts AT APPLY"
    - "Sentinel-abort probe: run a gate file via MCP execute_sql ending in a deliberate RAISE, so a shared TEST db is never polluted"

key-files:
  created:
    - supabase/migrations/20260813150106_wizard_rpcs_service_role_writer.sql
  modified:
    - supabase/schema/functions/create_wizard_strategy.sql
    - supabase/schema/functions/add_wizard_composite_key.sql
    - supabase/tests/test_wizard_composite_fence.sql

key-decisions:
  - "NO `REVOKE … FROM authenticated` in this file — that single absent statement is what the two-migration split buys; revoking here IS the merge-window outage"
  - "The GRANT to service_role is KEPT despite being a measured idempotent no-op (pg_default_acl already grants it), for explicitness — and the file records that RESEARCH finding 3's opposite claim is falsified, so no later reader re-derives it"
  - "Task 4 was WIDENED beyond the plan to cover the rls-policy-auditor's finding: nothing behaviourally proved the service_role arm WORKS, and plan 07 deletes the authenticated arm"
  - "Task 4's four-gate verification was run against TEST rather than a local PG16 fixture — a stronger oracle, since it is the database CI actually uses"

patterns-established:
  - "An operator-facing/post-verify canary must be checked against the STALE source it exists to catch — `wizdraft:` + `attested_venue` exist in the older body too, so the canary passed on precisely its target case"
  - "RED→GREEN for a SQL gate is measurable before merge: run it against TEST before and after the MCP apply"

requirements-completed: [CONNECT-03, CONNECT-04]

duration: 2h
completed: 2026-08-13
---

# Phase 156 Plan 03: Migration A — the service-role writer Summary

**Both wizard RPCs now accept a `service_role` caller, and the browser still works exactly as it did —
which is the entire point of shipping this half on its own.**

Executed by the orchestrator as a blocking checkpoint (`autonomous: false`): Task 2's apply goes
through Supabase MCP, which is stripped from subagents.

## The shape, and the one statement that is not in the file

| role | before | after Migration A |
|---|---|---|
| `service_role` | EXECUTE (from `pg_default_acl`), body refused it | EXECUTE, **body admits it** — ownership bound at the route |
| `authenticated` | EXECUTE + full `auth.uid()` check | **unchanged, both** |
| `anon` | nothing | nothing |

⛔ There is deliberately **no `REVOKE … FROM authenticated`**. Merging `supabase/migrations/**`
auto-applies to PROD while the Vercel build races it with no ordering between them, so withdrawing
that grant here would 42501 every connect-a-key for the width of the merge window. Plan 07 owns it.

The arms are **branched**, never unioned. Post-verify (e2) asserts the substring
`v_auth_uid <> p_user_id` and the `ELSIF` keyword per function and **aborts at apply**, so a flat-union
body — which would delete the T-88-03 cross-user guard for a role that still holds EXECUTE — cannot
commit. `migration-reviewer` confirmed mechanically that the comparison occurs twice in the bodies and
zero times on comment lines, so (e2) is a code-only match today.

## Applied and read back

Applied to **TEST `qmnijlgmdhviwzwfyzlc`**; the `$verify$` block passed (it aborts the whole apply
otherwise). MCP stamps `now()`, so the recorded version is **`20260813150106`** and the file was
renamed to match (PR-Y2) — forward of the tip `20260812083206`, no backdate guard tripped.

```
cws_sr=t  awck_sr=t   ← state pin; TRUE even where the GRANT never ran (§ A4)
cws_auth=t awck_auth=t ← the ONLY pair this migration could have broken
cws_anon=f awck_anon=f
```

## RED → GREEN, measured on the real database

The updated gate was run against TEST **before** the apply and **after**, both ending in a deliberate
`RAISE` so nothing was seeded onto the shared db (verified 0/0/0 after).

| | before apply | after apply |
|---|---|---|
| Parts 1 / 3b / 3c | pass | pass |
| **Part 3d — service_role arm** | **`REFUSED a service_role caller`** | **pass, both RPCs, stamps intact** |
| Part 3e — ELSE arm fails closed | — | pass |

⭐ **`sql-tests` on `main` went green against TEST carrying Migration A**, with main's own unmodified
gate files. That is this plan's "PR A breaks no existing gate" claim measured in a lane nobody here
controls.

## Review findings fixed BEFORE the apply

- **`migration-reviewer` MEDIUM — the stale-re-base canary passed on precisely the re-base it existed
  to catch.** (d) asserted `wizdraft:` and `attested_venue`; the previous single-key source contains
  **both** and merely lacks `venue_account_id`. A re-base onto it would drop the WIZCONT-02 stamp and
  the `btrim`/`NULLIF` normalisation and commit clean. Added `%venue_account_id%` **and**
  `%NULLIF(btrim(p_venue_account_id)%`, with the comment recording that the first is
  comment-satisfiable and the second is the load-bearing half.
- **`rls-policy-auditor`** — corrected the header, which claimed the fail-closed wrapper covers the
  claims read. It covers `auth.role()` only; `auth.uid()` sits in `DECLARE` and is evaluated first.
  Pre-existing, fails closed, now stated accurately.

**`rls-policy-auditor` verdict: no new cross-user write path.** A service-key principal already holds
`BYPASSRLS`, full grants on `api_keys`/`strategies`, and a place in both scrub-trigger allowlists — the
new arm is a strict subset of power it already had. It also found that the new `p_user_id IS NULL`
check *closes a latent hole in the pre-156 bodies*: `v_auth_uid <> NULL` is NULL, so the old guard
never fired on a NULL `p_user_id`.

## Deviations

1. **Task 4 was WIDENED.** The plan specified Part 3c only. The auditor found that **nothing
   behaviourally proved the `service_role` arm works** — post-verify (a) pins the ACL but never invokes
   the function, and reads TRUE on a database where the arm does not exist. Since plan 07 deletes the
   `authenticated` arm, a broken new arm would break every connect-a-key with no test failing. Added
   **Part 3d** (the arm works on both RPCs, row owned by `p_user_id`, `attested_venue` survives) and
   **Part 3e** (unknown role and no-claims caller both refused — the fail-closed property).
2. **Task 4's four-gate run used TEST, not a local PG16 fixture.** Bootstrapping Supabase's `auth`
   schema and `anon`/`authenticated`/`service_role` roles into a bare `initdb` is not what the plan's
   one-line `psql` invocation implies, and TEST is the database `sql-tests` actually runs against.
   Measured green there instead — a stronger oracle, not a weaker one.
3. **Part 3d catches the refusal and RE-RAISES** with this file's own message. Not in the plan;
   without it a body lacking the arm raises its own "called without an auth session" and the gate
   reports the symptom instead of the cause.

## Carried forward, not fixed

- Post-verify **(e) is a no-op on its own** — `auth.uid()` appears in six in-body comments, so it
  would pass even if the declaration were deleted. (e2) is the real guard. Named here so plan 07 does
  not mistake (e) for load-bearing when it inverts the polarity.
- **(e2) is still a text grep**, defeatable by deleting the comparison and mentioning it in a comment.
  Structurally unavoidable for a `pg_get_functiondef` canary.
- The branch still needs a **rebase onto `main`** to pick up the v0.59.0.2 version bump before it
  becomes a PR.
