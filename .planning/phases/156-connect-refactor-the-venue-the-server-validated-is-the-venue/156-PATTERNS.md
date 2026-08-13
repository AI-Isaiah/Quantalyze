# Phase 156: CONNECT-REFACTOR — the venue the server validated is the venue the server writes — Pattern Map

**Mapped:** 2026-08-13
**Files analyzed:** 17 (3 new, 14 modified)
**Analogs found:** 15 / 17 (2 have no analog — flagged below)
**Source of scope:** `156-RESEARCH.md` (618 lines, read in full) + `.planning/ROADMAP.md` Phase 156 block. There is **no CONTEXT.md**.

> ⛔ **Why this file exists.** This phase's failure mode is *instance-not-class* — fixing one path and leaving its twin. Every RPC, every route, every SQL gate in this phase comes in a **pair** (`create_wizard_strategy` / `add_wizard_composite_key`). The tables below are therefore organised so the twin is never off-screen. Where a twin has **no** existing coverage, that is called out as a gap rather than left silent.

---

## ⚠️ Two findings that change the plan, found while pattern-mapping

These are **not** in RESEARCH.md and both are instance-not-class hazards. Read them before the tables.

### FINDING A — the in-body `auth.role()` gate breaks **five** SQL-gate call sites that RESEARCH cleared

RESEARCH G3/G4 says the direct RPC calls in `test_wizard_composite_fence.sql` and `test_csv_finalize_double_submit.sql` "keep working" because there is no `SET LOCAL ROLE` in those files, so they run as the (owner/superuser) connection role. **That is true for the GRANT layer and false for the in-body gate.** Both files drive `auth.uid()` by setting the JWT GUC — and they set the **role claim to `authenticated`**:

```sql
-- supabase/tests/test_wizard_composite_fence.sql:120-121 (and :172-173, :190-191)
PERFORM set_config('request.jwt.claims',
  json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
```

```sql
-- supabase/tests/test_csv_finalize_double_submit.sql:212-213
PERFORM set_config('request.jwt.claims',
  json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
```

`auth.role()` reads `request.jwt.claims ->> 'role'`. Under the recommended body gate (`IF v_jwt_role <> 'service_role' THEN RAISE`), **every one of these calls raises `insufficient_privilege`** no matter what the ACL says:

| File:line | Call | Fate after the body gate lands |
|---|---|---|
| `test_wizard_composite_fence.sql:124` | `add_wizard_composite_key(...)` Part 1 | ⛔ REFUSED |
| `test_wizard_composite_fence.sql:129` | `add_wizard_composite_key(...)` Part 2 | ⛔ REFUSED |
| `test_wizard_composite_fence.sql:175` | `add_wizard_composite_key(...)` Part 3b | ⚠️ refused — but the test *expects* a refusal (see Finding B) |
| `test_wizard_composite_fence.sql:194` | `create_wizard_strategy(...)` Part 4a | ⛔ REFUSED |
| `test_wizard_composite_fence.sql:208` | `create_wizard_strategy(...)` Part 4b | ⛔ REFUSED |
| `test_csv_finalize_double_submit.sql:218` | `create_wizard_strategy(...)` cross-source control | ⛔ REFUSED |

**The remedy already exists in-repo** — `test_api_key_delete_atomicity.sql:261` calls a service-role-gated function from a SQL gate by shaping the claim:

```sql
-- supabase/tests/test_api_key_delete_atomicity.sql:259-262
--     must PERSIST a pre_terminus_balance_unknown=true row ... Service-role-shaped call.
PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
PERFORM public.replace_allocator_equity_snapshots(...);
```

⚠️ But note the collision: those gates set `sub` **because they need `auth.uid()`**. After 156 the RPCs no longer read `auth.uid()`, so the `sub` becomes decorative for these call sites and only the `role` matters. The correct re-cut is `json_build_object('sub', uid_a::text, 'role', 'service_role')` (keeps the fixture honest, flips the role) — **not** deleting the `set_config`, which would leave `auth.role()` NULL and still refuse.

### FINDING B — `test_wizard_composite_fence.sql` Part 3b becomes a **vacuous** test of a deleted guarantee

```sql
-- supabase/tests/test_wizard_composite_fence.sql:167-182
  -- Part 3b — auth guard: auth.uid() mismatch RAISEs insufficient_privilege
  -- Present a DIFFERENT identity in the JWT than p_user_id. The fn's F6-style
  -- guard (auth.uid() <> p_user_id) must reject.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_wrong::text, 'role', 'authenticated')::text, true);
  raised := FALSE;
  BEGIN
    PERFORM public.add_wizard_composite_key(
      uid_a, 'binance', 'spoofed', 'e', 's', 'p', 'd', 'n', 1, 'spoof', session_a);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3b): add_wizard_composite_key accepted a call whose p_user_id <> auth.uid() — cross-user elevation (T-88-03)';
  END IF;
```

Phase 156 **deletes** `auth.uid()` from the body. This assertion keeps passing — because the **role** gate refuses it — while the guarantee it names (cross-user elevation, T-88-03) no longer exists in the DB at all. It becomes a green test pinning a dead control. RESEARCH's gate inventory (G1–G15) does not list it.

**The honest re-cut:** Part 3b must assert the *new* boundary — a caller presenting `role: 'authenticated'` is refused `42501` **whatever** `sub` it carries — and the ownership binding must be re-asserted **at the route layer** (CONNECT-03b's `p_user_id === user.id` unit test), because that is where it now lives. Say so in the test's own prose, or the next reader will think the DB still enforces it.

---

## File Classification

| New/Modified File | New? | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|---|
| `supabase/migrations/<ts1>_wizard_rpcs_service_role_writer.sql` | NEW | migration (DDL + privilege) | batch / one-shot | `supabase/migrations/20260515113753_log_audit_event_service_hardened.sql` | **exact** ⚠️ see gate divergence |
| `supabase/migrations/<ts2>_wizard_rpcs_revoke_authenticated.sql` | NEW | migration (privilege only) | batch / one-shot | `20260515113753:200-205` + `20260812083206:740-754` | exact |
| `src/app/api/strategies/create-with-key/route.ts` | mod | route handler (Next 16 App Router) | request-response | `src/app/api/strategies/finalize-wizard/route.ts:1181-1190` (hard admin dep) | exact |
| `src/app/api/strategies/composite/add-key/route.ts` | mod | route handler | request-response | its own twin, `create-with-key/route.ts` (self-declared structural mirror, `:41-68`) | **exact** |
| `src/app/api/strategies/create-with-key/route.test.ts` | mod | test (vitest, route unit) | request-response | itself — `:229-238` admin mock already exists | exact |
| `src/app/api/strategies/composite/add-key/route.test.ts` | mod | test (vitest, route unit) | request-response | `create-with-key/route.test.ts:229-238` | exact |
| `supabase/tests/test_api_keys_exchange_not_user_writable.sql` | mod | SQL gate (privilege/trigger) | batch assertion | itself — 5b (`:267-281`) positive control + 5e (`:401-417`) SQLSTATE discipline | exact |
| `supabase/tests/test_wizard_session_idempotency.sql` | mod | SQL gate (privilege pin) | batch assertion | `20260811210000:869-882` post-verify (e) | exact |
| `supabase/tests/test_wizard_composite_fence.sql` | mod | SQL gate (behaviour + privilege) | batch assertion | `test_api_key_delete_atomicity.sql:140-190, :259-262` (role-shaped calls) | exact |
| `supabase/tests/test_csv_finalize_double_submit.sql` | mod ⚠️ **not in RESEARCH's edit list** | SQL gate (behaviour) | batch assertion | same as above | exact |
| `supabase/tests/test_api_keys_venue_identity_uniq.sql` | mod | SQL gate (structural: signature pin + single-overload + `pg_get_functiondef` canary) | batch assertion | itself — `:174-208`, the `create_wizard_strategy` canary block being twinned for the composite | exact |
| `src/__tests__/phase-156-wizard-rpc-writer-guard.test.ts` | NEW | test (source-scan structural invariant) | batch / file-walk | `src/__tests__/strategies-published-sole-writer-guard.test.ts` | **exact** |
| `supabase/schema/functions/create_wizard_strategy.sql` | mod (generated) | generated artifact | — | `npm run schema:functions` — ⛔ never hand-edit | n/a |
| `supabase/schema/functions/add_wizard_composite_key.sql` | mod (generated) | generated artifact | — | same | n/a |
| `src/app/api/strategies/finalize-wizard/route.ts` | mod (prose only) | route handler | request-response | itself `:1213-1220` (the paragraph being upgraded) | exact |
| `src/app/api/strategies/finalize-wizard/route.test.ts` | mod (prose only) | test | — | itself | exact |
| `src/__tests__/wizard-rpcs-live-db.test.ts` | mod (non-gate) | test (`it.skipIf`, never runs in CI) | — | — | **no analog needed** |
| `.planning/REQUIREMENTS.md` / `ROADMAP.md` / `STATE.md` / `CHANGELOG.md` / `VERSION` / `package.json` | mod | docs / version | — | repo convention (VERSION + package.json in ONE commit) | exact |

**Wave-0 probe (A1/A2/A3/A4)** is a *measurement*, not a file. Its analog is the shape at `test_api_key_delete_atomicity.sql:259-262` — set a claim, call, observe.

---

## Pattern Assignments

### 1. `supabase/migrations/<ts1>_wizard_rpcs_service_role_writer.sql` (migration, privilege DDL)

**Analog:** `supabase/migrations/20260515113753_log_audit_event_service_hardened.sql` — RESEARCH calls this "the same shape applied to a second function." It is. But **its gate is wider than what this phase needs**, and copying it verbatim silently voids layer 4 of D1.

#### ⛔ THE DIVERGENCE, STATED LOUDLY

**The precedent admits `authenticated`. Phase 156 must not.**

```sql
-- 20260515113753:137-152 — THE PRECEDENT, verbatim
  -- audit-2026-05-07 P919: in-body role gate (defense-in-depth on top
  -- of the grant-layer REVOKE). auth.role() returns the JWT's role
  -- claim; we accept service_role and authenticated (the two intended
  -- callers). anon, dashboard_user, and any future custom roles are
  -- rejected.
  BEGIN
    v_role := auth.role();
  EXCEPTION WHEN OTHERS THEN
    v_role := NULL;
  END;

  IF v_role IS NULL OR v_role NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION
      'log_audit_event_service: auth.role() must be authenticated or service_role (got %). audit-2026-05-07 P919.', v_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;
```

Three things to carry, one to reject:

| Element | Carry? | Why |
|---|---|---|
| `auth.role()` (not `current_user`, not `session_user`) | ✅ **carry** | Trap C. `current_user` inside SECDEF is the *owner* ⇒ always-pass. Repo names it twice: `20260811210000:518-523`, `20260411103316:313-321`. |
| `BEGIN … EXCEPTION WHEN OTHERS THEN v_role := NULL; END` wrapper | ✅ **carry** | Fails closed if `auth.role()` itself errors (e.g. a fixture DB without the `auth` schema helper). Strictly safer than RESEARCH's bare `COALESCE(auth.role(),'')`, and it composes with it. |
| `v_role IS NULL → RAISE` | ✅ **carry** | Fail-closed on an absent claim. |
| `NOT IN ('authenticated','service_role')` | ⛔ **REJECT** | `authenticated` is **the exact caller this phase exists to lock out**. Admitting it in-body makes layer 4 a permanent no-op: a future GRANT leak would then pass *both* layers. Use `<> 'service_role'`. |

The precedent's width is defensible **there** (`log_audit_event_service` has an authenticated caller by design); it is a security hole **here**. Rule 7: pick one, say why — do not average them.

**Grant/revoke pattern** (copy the self-contained re-assertion posture):

```sql
-- 20260515113753:200-205
-- Re-assert grant pattern (defensive — migration 058 already did this,
-- but re-applying makes the migration self-contained).
REVOKE ALL ON FUNCTION public.log_audit_event_service(UUID, TEXT, TEXT, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_audit_event_service(UUID, TEXT, TEXT, UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.log_audit_event_service(UUID, TEXT, TEXT, UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event_service(UUID, TEXT, TEXT, UUID, JSONB) TO service_role;
```

⚠️ In **migration 1** of the two-migration split, the `REVOKE … FROM authenticated` line is the ONE line that must **not** be copied yet — it is migration 2's whole content. Migration 1 ships: `REVOKE … FROM PUBLIC, anon` + `GRANT EXECUTE … TO service_role`, leaving `authenticated`'s grant standing. (RESEARCH "Deploy order": both single-migration orderings produce a total connect-a-key outage window.)

**Self-verifying DO block** (same file, `:210-268`) — the body-substring canary shape:

```sql
-- 20260515113753:250-264
  -- 3. log_audit_event_service body contains both new gates
  SELECT pg_get_functiondef(p.oid) INTO fn_body
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'log_audit_event_service';

  IF fn_body IS NULL THEN
    RAISE EXCEPTION 'Migration 123 failed: log_audit_event_service function not found';
  END IF;
  IF fn_body NOT LIKE '%auth.role()%' THEN
    RAISE EXCEPTION 'Migration 123 failed: log_audit_event_service body lacks auth.role() role gate';
  END IF;
```

That is the direct template for post-verify **(e)** (`body contains auth.role()` AND `body does NOT contain auth.uid()` — Trap B's structural guard).

**Post-verify privilege + ownership + CHECK assertions** — copy from `20260811210000:865-943`, which already asserts *both polarities* on *both* functions:

```sql
-- 20260811210000:869-882 — BOTH FUNCTIONS, BOTH POLARITIES (invert the first for 156)
  IF NOT has_function_privilege('authenticated',
        'public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated',
        'public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'Migration 20260811210000 failed: authenticated lost EXECUTE on a wizard RPC — connect-a-key is broken. Rolling back.';
  END IF;
  IF has_function_privilege('anon', ...) OR has_function_privilege('anon', ...) THEN
    RAISE EXCEPTION 'Migration 20260811210000 failed: anon acquired EXECUTE on a wizard RPC. Rolling back.';
  END IF;
```

⚠️ **Signature drift in the analog:** those literals are the **11-arg** `create_wizard_strategy`. The live signature is **12 args** (`…,uuid,text`) since `20260812083206`. Copying the string verbatim will `regprocedure`-error or silently address nothing. Correct current pins:
- `create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)` — 12
- `add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)` — 11

Owner-allowlist assertion (f) and CHECK-validated assertion (g) to re-assert verbatim: `20260811210000:898-912` and `:928-943`.

```sql
-- 20260811210000:932-943 — SC4's fence, the (g) shape to keep
  SELECT convalidated INTO v_chk_valid FROM pg_constraint
   WHERE conrelid = 'public.api_keys'::regclass
     AND conname  = 'api_keys_attested_venue_matches_exchange'
     AND contype  = 'c';
  IF v_chk_valid IS NULL THEN RAISE EXCEPTION '… CHECK is absent … Rolling back.'; END IF;
  IF NOT v_chk_valid THEN RAISE EXCEPTION '… CHECK exists but is NOT VALID … Rolling back.'; END IF;
```

**Comment ordering — the measured rule, copy the reasoning not just the order:**

```sql
-- 20260811210000:702-712
-- ⛔ THIS SECTION MUST PRECEDE THE POST-VERIFY BLOCK, AND THE ORDER IS THE
-- WHOLE POINT (153.6 migration re-audit M2-02). Post-verify (d) reads
-- col_description on api_keys.exchange and asserts that the 20260810120000
-- marker survived THIS migration's re-stamp. While the re-stamp sat AFTER the
-- verify block, (d) was reading the comment 20260810120000 itself had written…
-- MEASURED on a local PG16 fixture 2026-08-12: in the old order, a re-stamp with
-- the marker removed COMMITTED while (d) reported "20260810120000 marker preserved".
```

**`CREATE OR REPLACE`, not DROP+CREATE** — the hazard text to quote in the header:

```sql
-- 20260812083206:740-747
-- ⛔⛔ THE GRANTS MUST BE RE-ISSUED, AND THIS IS THE SHARP EDGE OF DROP+CREATE.
-- 20260811210000 could write "NO GRANT AND NO REVOKE ANYWHERE IN THIS FILE"
-- because CREATE OR REPLACE PRESERVES the existing ACL. DROP DESTROYS IT. A
-- freshly created function's default ACL grants EXECUTE to PUBLIC — so omitting
-- the REVOKE below would hand `anon` EXECUTE on a SECURITY DEFINER function that
-- writes api_keys and strategies. That is a privilege ESCALATION introduced by
-- the act of dropping, silently, with no error.
```

**`COMMENT ON FUNCTION` re-stamp** — analog `20260812083206:757-779`; the P8 prose to rewrite is `:772-775` (`⛔ p_venue_account_id is NOT VALIDATED here and 'authenticated' can call this RPC directly`).

---

### 2. ⛔ `_assert_owner` — **THE SHAPE TO NOT WRITE** (Trap B, verbatim)

**Source:** `supabase/migrations/20260411144407_compute_jobs_queue.sql:285-321`

```sql
CREATE OR REPLACE FUNCTION _assert_owner(
  p_table   REGCLASS,
  p_row_id  UUID,
  p_context TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_owner UUID;
BEGIN
  IF v_auth_uid IS NULL THEN
    RETURN;  -- service-role path, skip the check      ← ⛔ THIS LINE
  END IF;
  …
END;
$$;

COMMENT ON FUNCTION _assert_owner IS
  'Private shared ownership check. If auth.uid() is set, verifies the target row is owned by the caller. Service-role calls (auth.uid() NULL) bypass. …';
```

Here it is **deliberate and documented**. In `create_wizard_strategy` / `add_wizard_composite_key` the same shape (`IF v_auth_uid IS NOT NULL AND v_auth_uid <> p_user_id THEN RAISE`) is a **permanent silent no-op** under `service_role` — the ownership check vanishes and any uid the route passes is accepted forever, with no error and no test failure.

**Planner instruction:** the new bodies must contain **zero** occurrences of `auth.uid()`. Not a relaxed comparison, not a commented-out one — the post-verify (e) assertion greps `pg_get_functiondef` for the literal string. Ledger a Rule-9 mutation that reinstates the relaxed form and prove a named test reds.

Note `_assert_owner`'s **good** half worth copying: `REVOKE ALL ON FUNCTION _assert_owner FROM PUBLIC, anon, authenticated;` (`:323`) — the compact three-target revoke form.

---

### 3. The two RPCs being changed — LATEST bodies (re-base ground truth)

⛔ Re-base **only** from `supabase/schema/functions/*.sql`, whose `-- source migration:` header names the latest source. A stale re-base is Pitfall 8 (silently reverts PR #675).

| Function | Snapshot (canonical) | `-- source migration:` header | Params |
|---|---|---|---|
| `create_wizard_strategy` | `supabase/schema/functions/create_wizard_strategy.sql` (142 lines) | `20260812083206_api_keys_venue_account_id.sql` | **12** |
| `add_wizard_composite_key` | `supabase/schema/functions/add_wizard_composite_key.sql` (105 lines) | `20260811210000_api_keys_attested_venue.sql` | **11** |

**The guard block to REPLACE — identical in both, and this is the only region that changes:**

```sql
-- create_wizard_strategy.sql:26-40  ‖  add_wizard_composite_key.sql:30-44
DECLARE
  v_auth_uid UUID := auth.uid();
  v_key_id UUID;
  v_strategy_id UUID;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION '<fn> called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION '<fn>: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;
```

**Everything below that block is byte-preserved.** The load-bearing regions a stale re-base would drop:

```sql
-- create_wizard_strategy.sql:49-51 — the F6 fence (pinned by test_api_keys_venue_identity_uniq.sql:201)
  PERFORM pg_advisory_xact_lock(
    hashtext('wizdraft:' || p_user_id::text || ':' || p_wizard_session_id::text)
  );

-- add_wizard_composite_key.sql:50-52 — the DISTINCT lock space
  PERFORM pg_advisory_xact_lock(
    hashtext('wizcomposite:' || p_user_id::text || ':' || p_wizard_session_id::text)
  );
```

```sql
-- create_wizard_strategy.sql:114-126 — both stamps; attested_venue AND the NULLIF(btrim(…))
  INSERT INTO api_keys (
    user_id, exchange, label,
    api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
    dek_encrypted, nonce, kek_version, is_active,
    attested_venue, venue_account_id
  )
  VALUES (
    p_user_id, p_exchange, p_label,
    p_api_key_encrypted, p_api_secret_encrypted, p_passphrase_encrypted,
    p_dek_encrypted, p_nonce, COALESCE(p_kek_version, 1), TRUE,
    p_exchange, NULLIF(btrim(p_venue_account_id), '')
  )
  RETURNING id INTO v_key_id;
```

Also preserve verbatim: `create_wizard_strategy.sql:53-72` (the select-existing replay fence with its red-team MEDIUM-1 NULL-`api_key_id` note), `add_wizard_composite_key.sql:59-81` (lazy composite-draft creation), and the header attrs on both — `SECURITY DEFINER`, `SET search_path = public, pg_catalog`, `SET lock_timeout = '3s'`.

**In-body prose to rewrite (P4 — follows automatically via `npm run schema:functions`, ⛔ do NOT hand-edit the snapshots):** `create_wizard_strategy.sql:74-113` (the CR-01 / `authenticated holds EXECUTE` paragraph at `:92-101`) and `add_wizard_composite_key.sql:85-88`.

**Current ACL, measured from the migrations:**

| Function | PUBLIC | anon | authenticated | service_role |
|---|---|---|---|---|
| `create_wizard_strategy` | REVOKEd `20260812083206:748-750` | REVOKEd (same) | **GRANTed** `:752-754` | **none** |
| `add_wizard_composite_key` | REVOKEd `20260710180000:146` | REVOKEd | **GRANTed** `:149` | **none** |

⛔ `GRANT EXECUTE … TO service_role` is **mandatory in migration 1** or the first service-role call answers 42501 and every connect-a-key submit breaks (Pitfall 3).

---

### 4. `src/app/api/strategies/create-with-key/route.ts` (controller, request-response)

**Analogs, in the order the plan needs them.**

**(a) `withAuth` + how `user.id` is obtained** — `src/lib/api/withAuth.ts:32-73`:

```ts
export function withAuth(handler: AuthenticatedHandler, options: WithAuthOptions = {}) {
  const { requireApproval } = { ...DEFAULT_OPTIONS, ...options };
  return async (req: NextRequest) => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      const csrfError = assertSameOrigin(req);
      if (csrfError) return csrfError;
    }
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
    if (requireApproval) {
      const denied = await approvalGate.assertProfileApproved(supabase, user.id);
      if (denied) return denied;
    }
    return handler(req, user);   // ← `user` is the ADR-0022 layer-2 verified identity
  };
}
```

Both routes enter as `export const POST = withAuth(async (req: NextRequest, user: User) => {` (`create-with-key:330`, `add-key:88`). **`user.id` is already what both `.rpc()` calls pass as `p_user_id`** — no new plumbing.

**(b) An admin client already exists in this file** — `create-with-key/route.ts:169-205`:

```ts
  try {
    const admin = createAdminClient();
    const { data: liveKey, error: liveKeyErr } = await admin
      .from("api_keys")
      .select("id")
      .eq("user_id", userId)          // ⭐ admin client BYPASSES RLS — tenant scoping IS this filter
      .eq("exchange", exchangeNormalized)
      .eq("venue_account_id", venueAccountId)
      .is("disconnected_at", null)
      .maybeSingle();
    …
  } catch (adminErr) {
    // `createAdminClient()` THROWS when SUPABASE_SERVICE_ROLE_KEY is absent.
    // A missing credential must not 500 a connect that would otherwise succeed:
    // the DB index is still the backstop, so the honest degradation is a dark
    // fence plus a loud log — never a failed submit.
    console.error("[strategies/create-with-key] venue-identity fence unavailable; proceeding to RPC (DB index still dedups):",
      scrubSeamError(adminErr, secrets));
    return UNRESOLVED;
  }
```

⛔ **Rule 7 conflict — two admin-client postures exist in this codebase and this phase must pick the OTHER one.**

| Posture | Site | On missing service key | Correct for 156? |
|---|---|---|---|
| **fail-SOFT** (`try/catch` → degrade) | `create-with-key:195-205` | dark fence, connect still succeeds | ⛔ **NO.** Copying it here re-opens the door this phase closes and makes every gate pass vacuously (RESEARCH "Fail-closed posture"). |
| **fail-HARD** (no catch, hard dependency) | `finalize-wizard/route.ts:1181` — `const assetClassAdmin = createAdminClient();` | route throws | ✅ closest to the required posture, but a raw throw is a 500 |

**The posture to build:** catch the throw and answer an **honest 503**, using the code union member both wizard routes already emit for a server-side misconfiguration:

```ts
// create-with-key/route.ts:504-511 — the SEAM_MISCONFIGURED shape already in this file
    return rateLimitDenyJson(rl, {
      headers: NO_STORE_HEADERS,
      throttledBody: { code: "KEY_RATE_LIMIT", error: "Too many requests" },
      misconfiguredBody: {
        code: "SEAM_MISCONFIGURED",
        error: "Rate limiter unavailable",
      },
    });
```

`SEAM_MISCONFIGURED` is already a member of the wizard code union (`src/lib/wizardErrors.ts:430`) with authored copy (`:2166-2183`) that is **exactly** right for this case, and 503 is its status (`src/lib/ratelimit.ts:325-326`: `isRateLimitMisconfigured(rl) ? 503 : 429`). **No new code needs minting** — which matters, because PARITY-05's ledger and the `EXPECTED_TABLE_SIZE` pins police additions to that union.

```ts
// src/lib/wizardErrors.ts:2166-2183 — the copy this route would render
  SEAM_MISCONFIGURED: {
    title: "We could not send this request — our own configuration is wrong.",
    cause: "A setting on our side is wrong, so we stopped before sending the request. Nothing was submitted and nothing was changed. … This is not your key, your exchange or your data.",
    …
    actions: ["request_call", "expand_log"],   // deliberately NOT recoverable
  },
```

**(c) The one line that changes** — `create-with-key/route.ts:749-795`:

```ts
    // @audit-skip: wizard draft — create_wizard_strategy writes draft
    // strategies + api_keys not yet user-visible. The user-visible
    // creation is audited at finalize time in
    // src/app/api/strategies/finalize-wizard/route.ts. Per audit-2026-05-07
    // P692 + ADR-0023 (taxonomy follow-up tracked separately).
    const { data, error } = await supabase.rpc("create_wizard_strategy", {
      p_user_id: user.id,                    // ← withAuth-verified, NEVER a body field
      p_exchange: exchangeNormalized,        // ← the SAME value validateKey() succeeded on
      …
      ...(venueAccountId === null ? {} : { p_venue_account_id: venueAccountId }),
    });
```

⚠️ **G12 — the pragma must MOVE WITH the call.** `src/__tests__/audit-coverage.test.ts` requires the `@audit-skip` pragma within **8 lines** of the mutation, and `create_wizard_strategy` is in `MUTATING_RPC_NAMES` (`audit-coverage.test.ts:204-216`). If the `.rpc()` moves onto an admin client obtained above, the five pragma lines move with it.

```ts
// src/__tests__/audit-coverage.test.ts:204-216 — the allowlist (note the twin's ABSENCE)
const MUTATING_RPC_NAMES: readonly string[] = [
  "admin_role_mutate", "enqueue_compute_job", "sanitize_user", "send_intro_with_decision",
  "create_wizard_strategy",          // ← present
  "finalize_csv_strategy", "commit_scenario_batch", …
];                                    // ⛔ "add_wizard_composite_key" is NOT here — pre-existing gap
```

⛔ Do **not** add `add_wizard_composite_key` to that list in this phase (Rule 3 — it creates an audit-emission obligation on a route already being rewired). Log it to `TODOS.md` (RESEARCH Open Question 4).

**(d) P7 prose to rewrite** — `create-with-key/route.ts:772-780`:

```ts
      // ⛔ WHAT THIS DOES NOT BUY, STATED SO NOBODY LATER ASSUMES IT DOES: the
      // RPC does not validate the parameter, and `authenticated` holds EXECUTE
      // on it, so a browser session can call /rest/v1/rpc/create_wizard_strategy
      // directly with an identity of its choosing. … Same CR-01 class as
      // `p_exchange`; remedy is Phase 156 (CONNECT-REFACTOR), which moves this
      // INSERT behind a service-role writer and withdraws authenticated EXECUTE.
```

⚠️ Rewrite as **done for the reachability half only**: "only the server can pass it" becomes true; "the venue confirmed it" stays false. Do not silently upgrade.

Also at `:102-107` this file already predicts the change — that paragraph becomes past tense, not deleted.

---

### 5. `src/app/api/strategies/composite/add-key/route.ts` (controller, request-response) — THE TWIN

**Analog:** its own sibling. The file declares the relationship in its header:

```ts
// composite/add-key/route.ts:42-67
 * POST /api/strategies/composite/add-key — the multi-key wizard's per-key
 * assembly endpoint (Phase 88 / ONB-01 + ONB-03). It is a STRUCTURAL MIRROR of
 * create-with-key/route.ts (validate + encrypt a read-only exchange key
 * server-side, then persist via a SECURITY DEFINER RPC) with exactly three
 * intentional divergences, each commented below:
 *   (1) NO app-layer existing-draft short-circuit. …
 *   (2) The RPC is `add_wizard_composite_key` …
 *   (3) NO asset_class force-derive here. …
 * Everything else — withAuth, input validation + length caps, B15 limiter
 * ordering …, uniform { code } error classification … — mirrors the analog verbatim.
```

⭐ **This is the instance-not-class safety net: the file's own contract says every non-listed behaviour mirrors the twin.** The service-role writer is a non-listed behaviour ⇒ it must land identically here, and divergence (4) must be *added to that list* only if the plan deliberately makes one.

**What it does NOT have that the twin does:** no `createAdminClient` import (`add-key:1-39` has no `@/lib/supabase/admin` line), no `resolveByVenueIdentity`, no draft SELECT. Its `.rpc()` is the ONLY supabase call in the file:

```ts
// composite/add-key/route.ts:385-401
    // @audit-skip: wizard draft — add_wizard_composite_key writes draft
    // strategies + api_keys not yet user-visible. The user-visible creation is
    // audited at finalize time in
    // src/app/api/strategies/finalize-wizard/route.ts.
    const { data, error } = await supabase.rpc("add_wizard_composite_key", {
      p_user_id: user.id,
      p_exchange: exchangeNormalized,
      …
      p_wizard_session_id: wizard_session_id,
    });
```

Consequence: after the swap, `const supabase = await createClient();` at `:275` becomes **dead** in this file unless something else uses it. Either delete it or keep it with a stated reason — do not leave an unused user-scoped client sitting next to an admin one (that is how the next reader re-wires the wrong client).

The SEAM_MISCONFIGURED shape is already present here too (`add-key:258-265`) — same 503 posture, verbatim twin.

---

### 6. `src/app/api/strategies/create-with-key/route.test.ts` and `composite/add-key/route.test.ts` (tests)

**The admin-mock analog (G11's missing piece) — `create-with-key/route.test.ts:215-238`:**

```ts
/**
 * 154-06 — the service-role client the venue fence needs.
 * … `adminClientThrows` drives the missing-SUPABASE_SERVICE_ROLE_KEY case, which
 * must degrade to a dark fence and never to a failed submit.
 */
const adminClientThrows = { value: false };
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (adminClientThrows.value) {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for admin operations");
    }
    return {
      from: (table: string) => ({ select: () => makeSelectBuilder(table) }),
    };
  },
}));
```

⛔ **G10 — the docblock's last sentence is the expectation that becomes FALSE.** "must degrade to a dark fence and never to a failed submit" is correct for the *venue fence* and wrong for the *RPC*. After 156 the same missing key means the RPC cannot be called at all. Re-cut to an honest 503 **first**, observe it RED against the unchanged route, then change the route (Pitfall 5).

**G9 — where `rpc` currently lives** (`create-with-key/route.test.ts:205-213`):

```ts
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (table: string) => ({
      select: () => makeSelectBuilder(table),
      update: (...args: unknown[]) => assetClassUpdateMock(...args),
    }),
  }),
}));
```

`rpc` moves onto the **admin** mock's return object. ⭐ Leave a `rpc` on the *server* mock that **throws or fails the test** if reached — otherwise "the route still calls the user-scoped client" is indistinguishable from "the route was rewired," and CONNECT-02's unit assertion passes either way.

**G11 — the composite twin has NO admin mock at all. Confirmed** (`composite/add-key/route.test.ts:107-114`):

```ts
const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  // The composite add-key route calls ONLY supabase.rpc — no app-layer
  // draft SELECT (no F6 short-circuit) and no asset_class force-derive UPDATE.
  createClient: async () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
  }),
}));
```

Without an added `@/lib/supabase/admin` mock the real `createAdminClient()` throws for missing env and **every** composite test reds for the wrong reason — noise that hides a real failure. Add it in the same commit as the route change.

**Mock-hygiene convention worth copying** (`composite/add-key/route.test.ts:87-98`) — extend, don't replace, so a mock cannot drift from real behaviour:

```ts
// ⚠️ EXTENDED, NOT REPLACED (140.4-13 / SEAMRIM-05). … the pure helpers come from
// `importActual` so this mock cannot drift from the real 503-vs-429 decision.
vi.mock("@/lib/ratelimit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ratelimit")>();
  return { userActionLimiter: {}, checkLimit: (l: unknown, k: string) => checkLimitMock(l, k),
           rateLimitDenyJson: actual.rateLimitDenyJson,
           isRateLimitMisconfigured: actual.isRateLimitMisconfigured };
});
```

⚠️ CI runs **Node 22**, local is Node 25 — a CI-only vitest failure here is not a flake.

---

### 7. `supabase/tests/test_api_keys_exchange_not_user_writable.sql` — the 5d inversion + the 5f/5g twin

**Analog: the file's own conventions.** Four shapes, all already present.

**(i) The gate marker — the SKIP trap (⛔ read this before touching any COMMENT):**

```sql
-- test_api_keys_exchange_not_user_writable.sql:242-253
  SELECT COALESCE(
    col_description(
      'public.api_keys'::regclass,
      (SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.api_keys'::regclass
          AND attname = 'attested_venue'
          AND NOT attisdropped)
    ) LIKE '%20260811210000%',
    false
  ) INTO v_attest_live;

  IF v_attest_live THEN
```

**The match is a bare `LIKE '%20260811210000%'` on the column comment.** If the SC5 re-stamp drops that 14-digit substring, `v_attest_live` is FALSE and the **entire 5a–5e block** falls to:

```sql
-- :419-421
  ELSE
    RAISE NOTICE 'SKIP (5): migration 20260811210000 not yet applied here …';
  END IF;
```

— a NOTICE, exit code 0, **green CI with zero coverage.** The comment being re-stamped is `20260811210000:713-747`, whose own first line carries the marker (`'RPC-WRITTEN venue (migration 20260811210000). …'`). Preserve that substring, add the new migration's id, and gate the new 5f/5g on the **new** id so the two markers cross-check.

**(ii) The 5a-shaped marker positive control** — the exact template for the new one:

```sql
-- :254-265
    -- (5a) MARKER-PRESENT POSITIVE CONTROL for the gate above (153.6 P4).
    -- … Asserting that here is what turns "the re-stamp dropped the marker"
    -- into a FAILURE instead of assertions 2 and 3 quietly skipping forever —
    -- and a skip is the worse outcome, because it looks green.
    IF NOT v_fix_live THEN
      RAISE EXCEPTION
        'CR-01/153.6 REGRESSION (5a): api_keys.attested_venue carries the 20260811210000 marker but api_keys.exchange no longer names 20260810120000. A comment re-stamp dropped the gate marker, so assertions 2 and 3 above SKIPPED rather than ran. …';
    END IF;
```

**(iii) The anti-vacuity positive control (5b) — mandatory before any negative:**

```sql
-- :267-281
    -- (5b) POSITIVE CONTROL on the PRIVILEGED path, before any negative.
    -- … Without this, "the client's value was scrubbed" is indistinguishable
    -- from "this column never stores anything", and 5c would pass vacuously.
    INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted, attested_venue)
    VALUES (v_key5, v_uid, 'binance', 'cr01-roundtrip', 'x', 'binance');
    SELECT attested_venue INTO v_attested FROM public.api_keys WHERE id = v_key5;
    IF v_attested IS DISTINCT FROM 'binance' THEN
      RAISE EXCEPTION 'TEST FAILED (5b): a privileged INSERT did not persist attested_venue (got %). …';
    END IF;
```

⚠️ `153.6-07-SUMMARY.md` records the hazard: **a blunt 5d mutation is intercepted by 5b before it reaches 5d.** Design Rule-9 mutations to isolate the assertion under test.

**(iv) The SQLSTATE discipline — "refused for the RIGHT reason":**

```sql
-- :413-417
    IF v_ins_err <> '23514' THEN
      RAISE EXCEPTION
        'CR-01/153.6 (5e): the divergent INSERT was refused with SQLSTATE % rather than 23514 check_violation — it was blocked for the wrong reason, so this assertion is not testing the coupling constraint.',
        v_ins_err;
    END IF;
```

The new 5d requires `42501` by the same shape.

**(v) The 5d body being INVERTED** — current text at `:346-365`, whose failure message is the polarity to flip:

```sql
    SET LOCAL ROLE authenticated;
    v_ins_err := NULL;
    BEGIN
      SELECT api_key_id INTO v_key_rpc
        FROM public.create_wizard_strategy(
          v_uid, 'mt5',              -- the forged, probe-exempt venue
          'cr01-rpc-door', 'ct', 'ct', NULL, 'dek', 'nonce', 1,
          'cr01-rpc-draft', v_session);
    EXCEPTION WHEN OTHERS THEN
      v_ins_err := SQLSTATE || ' ' || SQLERRM;
    END;
    RESET ROLE;

    IF v_ins_err IS NOT NULL THEN
      RAISE EXCEPTION
        'TEST FAILED (5d): create_wizard_strategy could not be called by the row owner (%). …', v_ins_err;
    END IF;
```

⚠️ **This positional call passes 11 args to the 12-arg function** (the 12th has `DEFAULT NULL`). Keep it positional-with-default or make it named — but note that the *route* calls by NAME through PostgREST while the *gate* calls positionally in SQL; the two do not have to match, and the 12-arg pin lives in `test_api_keys_venue_identity_uniq.sql:41`.

⚠️ Note the JWT setup this block inherits from `:135-137` — role claim `authenticated`, `sub` = `v_uid`. After 156 the new 5d needs **both** doors shut: `SET LOCAL ROLE authenticated` (grant layer) **and** the `authenticated` role claim (body layer). It already has both, which is why it makes a clean 42501 assertion.

**(vi) 5f/5g — the twin that does not exist.** `add_wizard_composite_key` has the identical door and **no assertion anywhere in this file**. Adding 5d without 5f/5g closes one of two identical doors — precisely the defect class this phase was created to end.

**Assertion 5c (`:283-327`) and 5e (`:389-418`) are DO-NOT-TOUCH** — 5c asserts the client re-INSERT **SUCCEEDS** (D-02/D-03 keep that path open on purpose); 5e is SC4's fence.

---

### 8. `test_wizard_session_idempotency.sql` / `test_wizard_composite_fence.sql` / `test_csv_finalize_double_submit.sql` (privilege pins + call sites)

**G1 — the pin to invert** (`test_wizard_session_idempotency.sql:129-135`):

```sql
  IF NOT has_function_privilege('authenticated',
        'create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED: authenticated lost EXECUTE on create_wizard_strategy';
  END IF;
  IF has_function_privilege('anon',
        'create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED: anon must NOT have EXECUTE on create_wizard_strategy';
  END IF;
```

Invert the first (`IF has_function_privilege(...) THEN RAISE`), **keep the `anon` one byte-intact**, and add the `service_role` positive — because a negative-only assertion also passes on a database where the function was dropped.

**G2 — the composite twin** (`test_wizard_composite_fence.sql:54-70`) has the same three-assertion shape (`anon` ×2 + `authenticated` ×1) and takes the same treatment.

**FINDING A's remedy pattern — the service-role-shaped call, from `test_api_key_delete_atomicity.sql`:**

```sql
-- :148-149 / :169-171 / :261 — three role shapes in one file, all via the same GUC
PERFORM set_config('request.jwt.claims',
  json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
…
PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
…
--     Service-role-shaped call.
PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
PERFORM public.replace_allocator_equity_snapshots(…);
…
PERFORM set_config('request.jwt.claims', NULL, true);   -- ⭐ always reset at the end
```

Apply to the six call sites in Finding A. **Note the reset line** — `test_wizard_composite_fence.sql` and `test_csv_finalize_double_submit.sql:267` already do this; keep it.

**Body-substring canary (post-verify (d) analog) — `test_api_keys_venue_identity_uniq.sql:174-208`:**

```sql
  -- THE STALE-RE-BASE CANARY, ASSERTED FROM THE OUTSIDE. The migration's own
  -- post-verify checks these too; this is the independent copy that survives
  -- the migration being edited. Each string names a guarantee that a body older
  -- than 20260811210000 would silently revert.
  IF v_fn_src NOT ILIKE '%pg_advisory_xact_lock%' OR v_fn_src NOT ILIKE '%wizdraft:%' THEN
    RAISE EXCEPTION 'TEST FAILED (3): create_wizard_strategy lost its wizdraft: advisory-lock fence — a re-base took a stale body and F6 double-submit idempotency is gone';
  END IF;
  IF v_fn_src NOT ILIKE '%attested_venue%' THEN
    RAISE EXCEPTION 'TEST FAILED (3): create_wizard_strategy no longer writes attested_venue — a re-base took a body older than 20260811210000 and reverted PR #675; …';
  END IF;
```

⭐ **The `add_wizard_composite_key` twin of this whole assertion block does not exist.** RESEARCH's Pitfall 8 remedy says "add its twin for the composite" — this is the shape to copy, plus a new `NOT ILIKE '%auth.uid()%'` line on **both**.

Also pinned here and load-bearing: the single-overload assertion (`:174-186`) — the argument for `CREATE OR REPLACE` over `DROP`+`CREATE`.

---

### 9. `src/__tests__/phase-156-wizard-rpc-writer-guard.test.ts` (NEW — structural source-scan gate, CONNECT-02b)

**Analog:** `src/__tests__/strategies-published-sole-writer-guard.test.ts` — a sole-writer source scan with an allowlist, carve-outs, and a recorded falsifiability proof. Copy its structure wholesale.

```ts
// strategies-published-sole-writer-guard.test.ts:5-21
/**
 * Phase 87 PUB-01 / W-1 — SC-1 "sole published writer" source-scan guard.
 *
 * INVARIANT (SC-1, "any status-advancing path"): the admin approve route
 * `src/app/api/admin/strategy-review/route.ts` is the ONLY code path — in TS
 * OR SQL — that WRITES `strategies.status = 'published'`. … A NEW second writer
 * added anywhere … would bypass the publish gate … This guard makes that
 * invariant a falsifiable, repo-native regression that runs on every
 * `npm run test` — a second writer reddens it BEFORE it can land.
 *
 * Why a source-scan …: it runs in the normal unit suite (fails locally before
 * push), needs no new CI step, and the failure message points the dev at the
 * offending file.
 */
```

```ts
// :73-89 — the walker + allowlist + regex idiom
const REPO_ROOT = join(__dirname, "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");
const FUNCTIONS_DIR = join(REPO_ROOT, "supabase", "functions");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

/** The ONE sanctioned production writer of strategies.status='published'. */
const ALLOWED_TS_WRITER = "src/app/api/admin/strategy-review/route.ts";

const STRATEGIES_TABLE_RE = /from\(\s*["']strategies["']\s*\)/;
const MUTATION_RE = /\.(update|upsert)\s*\(/;
const PUBLISH_PAYLOAD_RE = /(?<![A-Za-z0-9_])status\s*[:=]\s*["']published["']/;
```

```ts
// :63-71 — ⭐ THE FALSIFIABILITY RECORD, and it is the part most often skipped
 * ── FALSIFIABILITY (verified once in development, recorded in 87-03-SUMMARY) ──
 *   • TS: adding a throwaway NON-test file under src/ with
 *     `await sb.from("strategies").update({ status: "published" })` makes Scan A
 *     exit non-zero; removing it → green.
```

**Mapping to CONNECT-02b:** the invariant is *"neither wizard RPC name appears in a `.rpc(` call reached from a user-scoped client."* Note the analog's carve-outs (test files excluded, read filters excluded) exist because a naive regex produced false positives — budget for the same. `MUTATING_RPC_RE` in `audit-coverage.test.ts:220-224` shows the anchored call-site regex idiom:

```ts
const MUTATING_RPC_RE = new RegExp(
  `\\.rpc\\(\\s*['"](?:${MUTATING_RPC_NAMES.join("|")})['"]`,
);
```

⚠️ A name-only scan cannot see *which client* `.rpc` hangs off. The tractable invariant is a **pairing** one: in each of the two route files, the `.rpc("create_wizard_strategy"|"add_wizard_composite_key")` call must be preceded by an admin-client binding and the file must not bind `createClient()` to the same identifier. State the heuristic explicitly and record the falsifiability proof, exactly as the analog does.

---

### 10. `src/app/api/strategies/finalize-wizard/route.ts` (prose, P5)

**The paragraph to upgrade** — `:1213-1220`:

```ts
  // ⚠️ WHAT THIS IS NOT (153.6 code review CR-01): it is NOT a venue the server
  // independently validated. The wizard RPCs write the `p_exchange` they were
  // CALLED with, and `authenticated` can invoke them directly over PostgREST.
  // The reason a forged call does not buy a free probe skip is that both RPCs
  // write `exchange` and `attested_venue` from ONE parameter — pinned by the
  // CHECK api_keys_attested_venue_matches_exchange (20260811210000) — so forging
  // the attestation forges the routing label too, and the key never syncs.
  // Do not upgrade this comment to "server-validated" without the deferred
  // connect-flow refactor that would make it true.
```

**Phase 156 IS that refactor.** Upgrade it — and keep **byte-intact** the paragraph immediately below (`:1252-1258`):

```ts
    // ⛔ NEVER `?? apiKeyExchange`. A null attestation is a legacy row the
    // backfill has not reached, or a client INSERT the trigger scrubbed — the two
    // states this change exists to cover. Falling back to the forgeable column
    // there would make the whole thing a no-op for every row that has one.
```

**The honest ceiling to write** (RESEARCH SC2): *"the venue is the one this server observed a successful read-only authentication at"* — **not** "the venue cannot be forged." Any server route holding `createAdminClient()` can still pass any uid; that is the standing `service_role` trust boundary (ADR-0001/ADR-0003), identical to `log_audit_event_service(p_user_id, …)`.

**The fail-HARD admin analog also lives here** — `:1181`:

```ts
  const assetClassAdmin = createAdminClient();
```

No try/catch. `finalize-wizard` **already** hard-depends on the service key on the wizard path (`:1181`, `:1355`, `:1681`, `:1965`, `:2290`). Phase 156 extends that dependency from *submit* to *connect* — a real widening; state it in the route header, do not smuggle it.

---

## Shared Patterns

### A. Twin-pairing — apply to EVERY artifact in this phase

**Source:** `composite/add-key/route.ts:42-67` (the file's own "structural mirror … everything else mirrors the analog verbatim" contract) and `create-with-key/route.ts:411-417`:

```ts
         * undifferentiated 23505 → DRAFT_ALREADY_EXISTS mapping. Fixing only
         * the instance the bug was reported against is how this repo grows
         * divergent twins, so the discrimination lands here too — through the
         * same `pgConstraintName` leaf, so the two copies cannot drift.
```

**Apply to:** the migration (both bodies, both ACLs, both post-verify polarities), both routes, both route tests, both SQL-gate privilege pins, the 5d/5f-5g pair, the stale-re-base canary pair.

**Checklist the planner should embed in every plan's verification step:**

| Artifact | single-key instance | composite twin | twin exists today? |
|---|---|---|---|
| RPC body re-base | `create_wizard_strategy` | `add_wizard_composite_key` | ✅ both |
| REVOKE/GRANT | 12-arg sig | 11-arg sig | ✅ both |
| post-verify (a)–(h) | both sigs in each check | — | ✅ pattern at `20260811210000:869-882` |
| route `.rpc` swap | `create-with-key:754` | `add-key:389` | ✅ both |
| route test admin mock | `route.test.ts:229-238` | — | ⛔ **MISSING (G11)** |
| SQL gate 5d/5f | `:329-387` | — | ⛔ **MISSING** |
| stale-re-base canary | `venue_identity_uniq:198-208` | — | ⛔ **MISSING** |
| `MUTATING_RPC_NAMES` | `audit-coverage.test.ts:209` | — | ⛔ MISSING — **log, do not fix** (Rule 3) |

### B. Anti-vacuity: every negative gets a positive control

**Source:** `test_api_keys_exchange_not_user_writable.sql:267-271` (5b), `:254-260` (5a), `test_api_key_delete_atomicity.sql:147-153` (a-before-b).

> *"Without this, 'the client's value was scrubbed' is indistinguishable from 'this column never stores anything', and 5c would pass vacuously."*

**Apply to:** every new assertion in this phase. `has_function_privilege('authenticated', …) = FALSE` passes on a database where the function was **dropped**; pair it with `has_function_privilege('service_role', …) = TRUE` **and** a privileged call that SUCCEEDS and stores `attested_venue = exchange`.

### C. Refused — and refused for the RIGHT reason (SQLSTATE pinning)

**Source:** `test_api_keys_exchange_not_user_writable.sql:413-417`, `:183-187`.

**Apply to:** new 5d/5f (`42501`), and to the re-cut composite-fence Part 3b. A bare "an error was raised" is the weaker claim, and after this phase there are **two** distinct refusal mechanisms (grant layer and body gate) that both yield `42501` — so also assert **no row was minted**.

### D. Fail-closed, and never blame the user for our outage

**Source:** `src/lib/wizardErrors.ts:2166-2183` (`SEAM_MISCONFIGURED` copy), `src/lib/ratelimit.ts:325-326` (503 status), `create-with-key:504-511` + `add-key:258-265` (both routes already emit it).

> *"A setting on our side is wrong … Nothing was submitted and nothing was changed. … This is not your key, your exchange or your data."*

**Apply to:** the missing-`SUPABASE_SERVICE_ROLE_KEY` arm in **both** wizard routes. ⛔ **No fallback to the user-scoped client** — that silently re-opens the door and makes every gate in this phase pass vacuously. ⛔ **No new error code** — `SEAM_MISCONFIGURED` is already in the union (`wizardErrors.ts:430`); PARITY-05's ledger and the `EXPECTED_TABLE_SIZE` pins police additions.

### E. Server-derived identity, never a body field

**Source:** `create-with-key:653-655` (and the identical twin at `add-key:292-294`):

```ts
      // TS-04 / SC7 — the SERVER-derived identity from withAuth's session, so
      // the Python limiter buckets this call to this tenant. Never a body field.
      { userId: user.id },
```

**Apply to:** the CONNECT-03b unit assertion. `p_user_id` must be provably `user.id` from `withAuth`, and no request-body field may reach it. This is now the **sole** ownership binding — the DB no longer checks it (Finding B) — so its test is load-bearing in a way it was not before.

### F. RLS is bypassed — the `.eq("user_id", …)` filter IS the tenancy

**Source:** `create-with-key:109-112`:

```ts
 * ⭐ THREE FILTERS, EACH LOAD-BEARING:
 *   · `.eq("user_id", …)` — the admin client BYPASSES RLS, so tenant scoping
 *     here IS this filter and nothing else. The value comes from `withAuth`'s
 *     server-side session and never from the request body.
```

**Apply to:** any admin-client read/write added by this phase, and to the migration header's "what D1 does NOT buy" paragraph.

### G. Generated artifacts are regenerated, never hand-edited

**Source:** both snapshot headers:

```sql
-- @generated by scripts/dump-sql-functions.ts — DO NOT EDIT BY HAND.
-- Canonical current body of this function, replayed from supabase/migrations/**.
-- Regenerate with `npm run schema:functions`. See tech-debt #2.
```

**Apply to:** `supabase/schema/functions/{create_wizard_strategy,add_wizard_composite_key}.sql` — run `npm run schema:functions` and commit **both** snapshots in the **same commit** as the migration (G14; 153.6-07 was bitten by exactly this). `src/lib/database.types.ts` needs no regeneration (signature unchanged) — verify with `npx tsc --noEmit`.

### H. A shipped migration is never edited

**Source:** `.claude/agents/migration-reviewer.md` invariant 11; RESEARCH constraints 3 and 10.

`20260810120000`, `20260811210000`, `20260812083206` are applied to PROD **and** TEST ⇒ read-only. P2's stale prose (`20260811210000` §1b, which reads as if 156 is still deferred) is corrected in the **new** migration's header, which names §1b as superseded. ⛔ Do not edit the old file.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Wave-0 runtime probe for A1/A2 (`auth.role()` / `auth.uid()` through a service-key supabase-js client) | measurement | request-response | No existing in-repo probe returns `auth.role(), auth.uid(), current_user, session_user` from a supabase-js admin client. The closest shape is the *SQL-side* simulation at `test_api_key_delete_atomicity.sql:261` — which proves the **GUC** path, not that supabase-js actually sets that GUC through PostgREST. Those are different claims; the probe must go through a real `createAdminClient().rpc()` against TEST. **⛔ The whole design rests on A1/A2. Measure before writing SQL.** |
| `src/__tests__/wizard-rpcs-live-db.test.ts` update | test (`it.skipIf(!HAS_LIVE_DB)`) | — | No analog needed — and **it is not a gate**. It never runs in CI. Update it so a stale live test is not a trap for whoever next runs it locally, but do not count it toward any success criterion. |

---

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/schema/functions/`, `supabase/tests/`, `src/app/api/strategies/**`, `src/lib/{api,supabase,ratelimit,wizardErrors}`, `src/__tests__/`
**Files read this session:** 24 (full or targeted ranges)
**Strong analogs extracted:** 9
**Pattern extraction date:** 2026-08-13

**Confidence:**
- Route/test/SQL-gate analogs: **HIGH** — every excerpt above was read this session at the cited lines.
- Finding A (six SQL-gate call sites carry `role: 'authenticated'`): **HIGH** — read verbatim at `test_wizard_composite_fence.sql:120-121, 172-173, 190-191` and `test_csv_finalize_double_submit.sql:212-213`. Its *consequence* depends on A1/A2 (that `auth.role()` reads that GUC), which is the same assumption the whole design rests on.
- Finding B (Part 3b goes vacuous): **HIGH** — the assertion text names `auth.uid()` explicitly and this phase deletes it.
- `log_audit_event_service` gate divergence: **HIGH** — `20260515113753:148` admits `authenticated` verbatim.

**Invalidated immediately by:** any new migration touching `api_keys`, either wizard RPC, or `VENUE_CAPABILITIES`. Re-check the `-- source migration:` headers in `supabase/schema/functions/*.sql` before planning.
