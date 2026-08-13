---
phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
plan: 01
status: complete
measured: 2026-08-13T01:05:00Z
measured_by: orchestrator (blocking checkpoint — MCP is stripped from subagents)
target: TEST only for mutations; two READ-ONLY catalog SELECTs against PROD, noted per claim
decision_gate: PASS — A1 and A2 both hold; plans 03/04/07 remain VALID as written
---

# Phase 156 — Wave 0 measurements

Closes assumptions **A1, A2, A4** from `156-RESEARCH.md` by measurement. **A3 is BLOCKED** — see below.

⛔ No key, JWT, connection string or project ref is recorded here. Role names and booleans only.

---

## A1 — `auth.role()` is `'service_role'` for a service-key client · **PASS**

**Load-bearing because:** the in-body gate compares against this literal. If A1 were false the gate
is either always-refuse (total connect outage) or always-pass (a security no-op no test would catch).
`156-PATTERNS.md` found no in-repo analog that settles it — `log_audit_event_service` admits
`auth.role() IN ('authenticated','service_role')`, so its production success proves the **union**, not A1.

**Method:** transient `public.__p156_probe()`, `LANGUAGE sql STABLE`, **SECURITY INVOKER**
(a DEFINER probe reports the owner and answers the wrong question — Trap C in miniature),
`REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO service_role`.
Invoked over **PostgREST** (`POST /rest/v1/rpc/__p156_probe`) with the TEST service-role key.
⚠️ Deliberately NOT via MCP `execute_sql` — MCP uses its own connection and cannot answer A1 at all;
a value read that way is a false PASS.

**Observed:**
```json
{"auth_uid": null, "auth_role": "service_role",
 "current_user": "service_role", "session_user": "authenticator"}
```
Contrast run with the anon key → **HTTP 401** (the REVOKE held).

**Verdict: A1 PASS.** `auth.role() = 'service_role'`. Probe ACL at creation was
`postgres=X/postgres, service_role=X/postgres`; `prosecdef = false`.

## A2 — `auth.uid()` IS NULL for that client · **PASS**

**Observed:** `auth_uid: null` (same payload above).

**Verdict: A2 PASS.** This is why the final PR-B bodies must contain **zero** `auth.uid()`: under a
service-role client it is NULL, so any surviving `auth.uid()`-based ownership check is a
**permanent silent no-op** — the `_assert_owner` shape (`20260411144407:300-302`) the phase must not copy.
Ownership binding therefore lives entirely at the route (`p_user_id === user.id` under `withAuth`).

📌 Bonus: `current_user` = `service_role`, `session_user` = `authenticator`. Note this probe is
**INVOKER**; Trap C's warning (that `current_user` in a **SECURITY DEFINER** body resolves to the
OWNER, not the caller) is unaffected by this reading and still stands.

## A3 — the `sql-tests` CI connection role · **BLOCKED, NOT MEASURED**

**Required command** (unchanged, for whoever can run it):
```
psql "$TEST_SUPABASE_DB_URL" -c "SELECT current_user, session_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super"
```

**Why blocked:** `TEST_SUPABASE_DB_URL` is a **GitHub Actions secret**. It is not present in
`.env.test.local`, `.env.local` or `.env.development.local`, and GitHub secrets cannot be read back.
⛔ The MCP connection is NOT a substitute — the plan says so explicitly, and a value read that way
would be a false PASS for the same reason it is in A1.

**Impact — bounded, and PR-B only.** A3 governs whether the direct RPC call sites in
`supabase/tests/` survive the PR-B `REVOKE` at the **grant layer**. It does not gate PR A.
`156-09-PLAN.md` Task 1 already carries the ordered A3-FAIL branch (fixture-level `GRANT` →
`SET LOCAL ROLE postgres` → STOP-and-report), so a FAIL-shaped A3 has a planned remedy rather than
an improvisation. **Resolve A3 before PR B, not before PR A.**

## A4 — today's ACL · **MEASURED — AND IT FALSIFIES `156-RESEARCH.md` FINDING 3**

`156-RESEARCH.md` finding 3 states: *"`service_role` has NO EXECUTE on either RPC today… no migration
grants it. Omitting `GRANT EXECUTE … TO service_role` is the easiest way for this phase to ship a
total connect-a-key outage."*

**That is FALSE.** Measured `pg_proc.proacl`, identically on **TEST and PROD** (no drift):

```
create_wizard_strategy   (12 args, owner postgres, SECURITY DEFINER)
add_wizard_composite_key (11 args, owner postgres, SECURITY DEFINER)

acl (both):  postgres=X/postgres
             authenticated=X/postgres
             service_role=X/postgres      ← already granted
```

`has_function_privilege('service_role', …, 'EXECUTE')` = **true** for both, in both environments.
Arity confirmed against `pg_get_function_identity_arguments`: **12** and **11** respectively.

### ⭐ Why — and the consequence, which is the important part

No migration grants `service_role`. The grant comes from **Supabase's default privileges**:

```
pg_default_acl · schema public · objtype f · granting role postgres:
    postgres=X/postgres  anon=X/postgres  authenticated=X/postgres  service_role=X/postgres
```

Every function `postgres` creates in `public` is **automatically** granted EXECUTE to `anon`,
`authenticated` and `service_role`. The migrations' `REVOKE ALL … FROM PUBLIC, anon` strips `anon`
and re-grants `authenticated` explicitly; `service_role` simply survives from the default.

**Two consequences for this phase:**

1. **Migration A's `GRANT EXECUTE … TO service_role` is a no-op** (already held). ✅ Keep it anyway —
   it makes the dependency explicit and survives a future default-privilege change — but **correct the
   rationale in `156-03-PLAN.md`**: the "omitting it ships a total outage" premise is false, and a plan
   that reasons from a false model invites the wrong call later. The two-PR split is **still correct**
   for the *other* direction: migration-first would `REVOKE` `authenticated` while the old deploy is
   still on the user-scoped client → outage.

2. ⛔⛔ **PR B's `REVOKE … FROM authenticated` is NOT durable.** It takes effect when it runs, but **any
   future migration that DROPs and re-CREATEs either function silently re-grants EXECUTE to
   `authenticated` AND `anon`** via these same default privileges. This is not hypothetical:
   `20260812083206` (Phase 154, three days ago) did exactly a DROP + CREATE on `create_wizard_strategy`,
   and its own post-verify at `:867` exists **because the author hit this for `anon`** — *"DROP destroyed
   the original ACL and a new function grants EXECUTE to PUBLIC by default, so the REVOKE did not take."*

   **PR B therefore needs a DURABLE CI guard**, not just a REVOKE: a SQL gate asserting
   `has_function_privilege('authenticated', …, 'EXECUTE') = false` for both functions, so the next
   DROP+CREATE that silently reopens the door **reds CI** instead of reaching production. Without it,
   PR B closes the hole once and the class stays open — the exact instance-not-class failure Phase 153.6
   was convened to end, and which the Phase 153 span verification found still open on 2026-08-13.

---

## Decision gate

**PASS.** A1 = `service_role` and A2 = NULL, both as designed. Plans 03/04/07 are **VALID as written**;
no STOP condition triggered.

**Required plan follow-ups before execution continues:**
- `156-03-PLAN.md` — correct the A4 rationale (GRANT is a no-op, not an outage guard); keep the GRANT.
- `156-07/08-PLAN.md` — add the durable `authenticated`-has-no-EXECUTE SQL gate (consequence 2 above).
- `156-VALIDATION.md` — add a ledger row: mutation = re-GRANT EXECUTE to `authenticated`; the new gate must red.
- A3 — resolve before PR B (needs `TEST_SUPABASE_DB_URL` or a CI run).

## Teardown

`DROP FUNCTION IF EXISTS public.__p156_probe();` executed. Verified: `probe_still_present = 0`.
No object created by this plan remains on TEST. Nothing was written to `supabase/migrations/`;
all DDL went through MCP `execute_sql`, never `apply_migration`, so no `schema_migrations` row and
no `migration-drift-check` drift was manufactured.
