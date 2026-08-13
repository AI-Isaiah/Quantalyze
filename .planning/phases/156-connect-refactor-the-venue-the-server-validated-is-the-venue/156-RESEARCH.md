# Phase 156: CONNECT-REFACTOR — the venue the server validated is the venue the server writes — Research

**Researched:** 2026-08-13
**Domain:** PostgreSQL/Supabase privilege design (SECURITY DEFINER + role grants), Next.js 16 route handlers, ASVS V4 access control
**Confidence:** HIGH on the codebase trace (everything below was read, not recalled); MEDIUM on two Supabase runtime facts that are flagged for a Wave-0 measurement.

---

## Summary

`api_keys.attested_venue` is the sole input to the finalize-wizard scope-broadening probe gate (ASVS V4). Phase 153.6 shipped remedy **(b)** — a scrub trigger closes the client-INSERT door, and a `CHECK (attested_venue IS NULL OR attested_venue = exchange)` makes the forgery non-selective. The **RPC door is still open**: `create_wizard_strategy` and `add_wizard_composite_key` are SECURITY DEFINER, hold `EXECUTE` for `authenticated`, are reachable over PostgREST, and write the caller's `p_exchange` verbatim into `attested_venue`. Phase 156 is remedy **(a)**.

**The single most important finding, and it changes the shape of the phase:** the ROADMAP's SC2 says to trace *"from `/api/keys/validate-and-encrypt` through to the INSERT."* **The wizard connect path never touches that route.** `ConnectKeyStep.tsx:787` posts to `/api/strategies/create-with-key`; `MultiKeyConnectStep.tsx:1195` posts to `/api/strategies/composite/add-key`. Both of those routes run `validateKey(exchangeNormalized, …)` → `encryptKey(exchangeNormalized, …)` → the RPC **inside one server request, under `withAuth`**. `/api/keys/validate-and-encrypt` is a *sibling* surface used only by `AllocatorExchangeManager.tsx:563`, `ApiKeyManager.tsx:229` and `StrategyForm.tsx:118`, which then do a **client-side `api_keys` INSERT** — the door 153.6's scrub trigger already closes (their `attested_venue` lands NULL ⇒ PROBED ⇒ fail-toward, which is correct and must not change).

Consequence: SC2 needs **no cross-request binding token, no HMAC, no new seam**. `exchangeNormalized` in each wizard route is (1) closed-set gated by `isSupportedExchange`, (2) the exact argument to a `validateKey` that returned `read_only: true`, (3) the exact argument to the `encryptKey` that produced the ciphertext, and (4) already what is passed as `p_exchange`. The venue *is* server-verified today; what is missing is that **a browser can bypass the route entirely and call the RPC itself**. Phase 156 closes that by moving the RPC call onto the service-role client and withdrawing `authenticated` EXECUTE.

**Primary recommendation:** Keep both RPC signatures unchanged (so `CREATE OR REPLACE` preserves the ACL and no PostgREST overload/PGRST202 hazard is created). Replace each RPC's `auth.uid()` guard with an `auth.role() = 'service_role'` in-body gate (defence-in-depth), `REVOKE ALL … FROM authenticated` + `GRANT EXECUTE … TO service_role`, and switch both wizard routes' `.rpc()` call from `createClient()` to `createAdminClient()` while passing `user.id` from `withAuth` verbatim. One new migration, one new SQL-gate assertion set, and a hard-fail-closed posture when `SUPABASE_SERVICE_ROLE_KEY` is absent.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Verifying the caller's identity | Frontend Server (route handler, `withAuth`) | — | ADR-0022 layer 2: `supabase.auth.getUser()` is the authoritative network verification. The DB cannot see the caller's cookie once the client is service-role. |
| Verifying the venue | Frontend Server → Analytics API (`validateKey`) | — | The venue is proven by a successful read-only authentication against that venue's live API. Nothing in Postgres can verify a venue. |
| Enforcing *who may write* `attested_venue` | Database / Storage (GRANT + SECDEF + trigger) | Frontend Server (client choice) | ASVS V4 controls must not be enforceable only in the tier a caller can skip. PostgREST exposes every `public` function, so the grant layer is the only door the browser cannot walk around. |
| Enforcing `attested_venue = exchange` | Database (CHECK) | — | SC4 — a fence independent of who writes. Keep. |
| Deciding whether to probe | Frontend Server (`finalize-wizard`, `venueSupportsScopeProbe`) | — | Unchanged by this phase. |
| Failing honestly when the service key is missing | Frontend Server (route error arm) | — | A missing server credential is our outage; it must never render as a key/venue fault. |

---

## Project Constraints (from CLAUDE.md / AGENTS.md / repo conventions)

**Binding, non-negotiable. Copy into the plan.**

1. **⛔ NEVER run `supabase db push`.** Merging anything under `supabase/migrations/**` to `main` **auto-applies to PROD** via `.github/workflows/supabase-migrate.yml` (documented at `CONTRIBUTING.md` §2). PROD = `khslejtfbuezsmvmtsdn`; TEST = `qmnijlgmdhviwzwfyzlc`. New migrations go to **TEST via MCP `apply_migration` BEFORE merge**.
2. **MCP `apply_migration` stamps the version with `now()`.** That produces repo-vs-remote timestamp drift, which `.github/workflows/migration-drift-check.yml` catches at PR time (`supabase db push --include-all --dry-run`, exit ≠ 0 ⇒ "Migration drift detected"). The workflow's own error text names the remedy: *"rename the local file to match the remote `schema_migrations.version`. See PR-Y2 pattern."* **Practical procedure for this phase:** apply to TEST via MCP, read back the stamped version, then rename the local file to that exact 14-digit prefix in the same PR. See "Migration Mechanics" below.
3. **A shipped migration is NEVER edited** — changes layer as a NEW migration (`migration-reviewer` invariant 11: any diff modifying an already-applied `.sql` is an immediate CRITICAL). `20260810120000`, `20260811210000` and `20260812083206` are all applied to PROD and TEST. **They are read-only to this phase.**
4. **Before any `CREATE OR REPLACE FUNCTION`: grep ALL migrations and re-base on the LATEST body.** The ground truth is already captured for you — see "Re-base ground truth" below.
5. **SQL gates live in `supabase/tests/test_*.sql`.** `*_live.py` and `skipIf` vitest tests **never run in CI**. `src/__tests__/wizard-rpcs-live-db.test.ts` is `it.skipIf(!HAS_LIVE_DB)` ⇒ it is NOT a gate; do not count it.
6. **`AGENTS.md`: this is Next.js 16.2.11.** Read `node_modules/next/dist/docs/` before asserting Next behaviour. (Verified: nothing in this phase changes a Next.js API surface — route handlers already default to `runtime = 'nodejs'` and POST is dynamic. `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md:649`.)
7. **Bump `VERSION` and `package.json` together** in one commit (`critical-regressions.test.ts` fails CI otherwise), plus a `CHANGELOG.md` entry.
8. **Never bundle a commit with edits** — edit → verify (grep/tsc) → commit, each its own step.
9. **`.planning/` is TRACKED and the repo is PUBLIC.** Everything written here is world-readable on push. Do not put a secret, a live census, or a PROD connection string in a plan.
10. **Rule 3 (surgical changes) / Rule 7 (surface conflicts, don't average them)** apply with force here — this phase touches an ASVS V4 control that three prior phases have already fenced.

---

## Phase Requirements (proposed IDs — mint at planning)

There is **no CONTEXT.md** for this phase; the ROADMAP block is the authoritative scope statement. IDs are TBD per the ROADMAP; proposed mapping:

| Proposed ID | Description (from ROADMAP SC) | Research Support |
|----|-------------|------------------|
| CONNECT-01 | A caller with a valid session + the server-minted ciphertext cannot set `attested_venue` by any route, including calling the wizard RPCs directly over PostgREST. Proven by a SQL assertion that calls the RPC as `authenticated` and is REFUSED, replacing 153.6's assertion 5d. | §"The privilege design", §"SC1: what has to change in assertion 5d", §"Gates and pins that flip polarity" |
| CONNECT-02 | `attested_venue` is written from a venue the server verified against the live venue API at mint time, traced end to end. | §"SC2: the trace, corrected" |
| CONNECT-03 | The wizard works end to end for every venue, single-key and composite; the ownership check survives the loss of `auth.uid()`. | §"SC3: how a service-role writer proves the row is the caller's" (the core of this research) |
| CONNECT-04 | The `CHECK (attested_venue IS NULL OR attested_venue = exchange)` is KEPT. | §"Do not touch" |
| CONNECT-05 | Every prose claim 153.6 weakened is re-strengthened; the `threat_flag` is cleared. | §"SC5: the prose inventory (exact sites)" |

It closes the **PARITY-04 `threat_flag: deferred-control`** (`REQUIREMENTS.md:885-895`, ledger row at `:1281`).

---

## Codebase trace (verified, file:line)

### The two doors, and which one each surface uses

| Surface | Route it posts to | What that route does | `attested_venue` outcome today |
|---|---|---|---|
| Wizard, single key — `ConnectKeyStep.tsx:787` | `POST /api/strategies/create-with-key` | `withAuth` → closed-set gate (`:348`) → `validateKey` (`:648`) → `encryptKey` (`:686`) → `supabase.rpc("create_wizard_strategy", …)` (`:754`) on the **user-scoped** client (`:524`) | Written by the RPC from `p_exchange` |
| Wizard, composite — `MultiKeyConnectStep.tsx:1195` | `POST /api/strategies/composite/add-key` | `withAuth` → `isSupportedExchange` (`:106`) → `validateKey` (`:287`) → `encryptKey` (`:322`) → `supabase.rpc("add_wizard_composite_key", …)` (`:389`) on the **user-scoped** client (`:275`) | Written by the RPC from `p_exchange` |
| Allocator key manager — `AllocatorExchangeManager.tsx:563` | `POST /api/keys/validate-and-encrypt` | `withAuth` → `validateKey` → `encryptKey` → **returns ciphertext to the browser** (`route.ts:326`) | Client then INSERTs `api_keys` directly ⇒ **scrubbed to NULL** ⇒ PROBED |
| Strategy key manager — `ApiKeyManager.tsx:229` | same | same | same |
| Strategy form — `StrategyForm.tsx:118` | same | same | same |

**The exploit CR-01 describes** is: take the ciphertext `/api/keys/validate-and-encrypt` hands the browser, then `POST /rest/v1/rpc/create_wizard_strategy` yourself with `p_exchange: "mt5"`. Both doors are needed for it — the ciphertext comes from the *sibling* surface, the write from the *wizard* RPC. Phase 156 closes the write side. The ciphertext-return side is **out of scope and should stay so** (those three components legitimately need it, and their rows are unattested by design).

### Current RPC bodies — the re-base ground truth

`npm run schema:functions` maintains canonical snapshots; their `-- source migration:` headers are authoritative.

| Function | LATEST body lives in | Snapshot | Signature |
|---|---|---|---|
| `create_wizard_strategy` | `20260812083206_api_keys_venue_account_id.sql` (DROP+CREATE, 12 params) | `supabase/schema/functions/create_wizard_strategy.sql` (142 lines) | `(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)` |
| `add_wizard_composite_key` | `20260811210000_api_keys_attested_venue.sql` (`20260812083206:255` states *"add_wizard_composite_key is NOT touched"*) | `supabase/schema/functions/add_wizard_composite_key.sql` (105 lines) | `(uuid,text,text,text,text,text,text,text,integer,text,uuid)` — **11 params, no `p_venue_account_id`** |

Both bodies open identically:

```sql
DECLARE v_auth_uid UUID := auth.uid();
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION '<fn> called without an auth session' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION '<fn>: p_user_id (%) does not match auth.uid (%)', p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;
```

Both then `PERFORM pg_advisory_xact_lock(hashtext('wizdraft:'|'wizcomposite:' || …))` — the **F6 idempotency fence** (H-0304/H-0311/H-0186). **This fence must survive the re-base**; `test_api_keys_venue_identity_uniq.sql:201` and `test_wizard_session_idempotency.sql:96` both assert it by grepping `pg_get_functiondef`.

### Current ACL

| Function | PUBLIC | anon | authenticated | service_role |
|---|---|---|---|---|
| `create_wizard_strategy` | REVOKEd (`20260812083206:748`) | REVOKEd | **GRANTed** (`:752`) | **none** |
| `add_wizard_composite_key` | REVOKEd (`20260710180000:146`) | REVOKEd | **GRANTed** (`:149`) | **none** |

⚠️ **`service_role` has NO EXECUTE on either function today.** `service_role` is not a member of `authenticated` in Supabase's role graph (this repo grants both separately where both are needed — e.g. `20260417031851:165`). **Phase 156 must add `GRANT EXECUTE … TO service_role` or the first service-role call answers 42501 and every connect-a-key submit breaks.** This is the easiest way for this phase to ship a total outage.

### The other three protections on `api_keys` (leave alone)

| Protection | Where | Behaviour |
|---|---|---|
| `api_keys_scrub_attested_venue` BEFORE INSERT, SECURITY **INVOKER** | `20260811210000:515-552` | `IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF; NEW.attested_venue := NULL;` |
| `api_keys_scrub_venue_account_id` BEFORE INSERT, SECURITY INVOKER | `20260812083206:521-539` | same allowlist |
| `api_keys_attested_venue_matches_exchange` CHECK, `convalidated` | `20260811210000` §7, post-verify (g) at `:927-943` | SC4 says **keep** |
| `prevent_api_key_venue_change` + table-level UPDATE revoke | `20260810120000` | `authenticated` cannot rewrite `exchange` |

**Why the RPCs survive the scrub triggers:** they are `SECURITY DEFINER`, so inside their bodies `current_user` = the function **owner** (`postgres`), which the allowlist admits. `20260811210000` post-verify (f) at `:891-912` asserts exactly this (`pg_get_userbyid(proowner)` ∈ allowlist) plus a loop proving the allowlist array actually appears in the trigger body. **This composition is unchanged by Phase 156** — the RPC still runs as its owner regardless of who called it. Do not "simplify" it.

---

## SC3 — How a service-role writer proves the row belongs to the caller

This is the phase's central question. `auth.uid()` returns NULL for a service-role caller, so the existing guard cannot be kept as-is and cannot be relaxed as-is. Both plausible one-line edits are wrong in opposite directions.

### ⛔ The two traps, stated first

**Trap A — keeping `IF v_auth_uid IS NULL THEN RAISE`.** Under `service_role`, `auth.uid()` is NULL, so **every** wizard connect fails with `insufficient_privilege`. Total outage, caught immediately.

**Trap B — relaxing to `IF v_auth_uid IS NOT NULL AND v_auth_uid <> p_user_id THEN RAISE`.** Under `service_role` this is a permanent no-op: the ownership check silently vanishes and any uid the route passes is accepted, unchecked, forever. This is *exactly* the shape of `_assert_owner` (`20260411144407:299-302` — `IF v_auth_uid IS NULL THEN RETURN; -- service-role path, skip the check`), where it is deliberate and documented. Here it would be a silent regression that no test catches unless one is written for it. **This is the failure this phase must be planned against.** Ledger a Rule-9 mutation that neuters the replacement guard and prove it reds.

**Trap C — using `current_user` for the in-body role gate.** Inside a `SECURITY DEFINER` function `current_user` is the function **owner**, so `IF current_user = 'service_role'` (or any `current_user` role test) **always evaluates against the owner and never against the caller**. The repo already names this trap twice: `20260811210000:518-523` (*"under SECURITY DEFINER, current_user would be this function's owner and the privileged-caller check below would ALWAYS pass, making the trigger a silent no-op … the bug that made prevent_profile_role_change a no-op"*) and `20260411103316:313-321`. **Use `auth.role()`** — it reads `request.jwt.claims ->> 'role'`, which PostgREST sets from the verified JWT and which a SECDEF entry does not rewrite. `session_user` is also wrong (it is `authenticator` for every PostgREST request).

### The options, with what stops a forged uid in each

| # | Option | What stops a caller forging the uid | Verdict |
|---|--------|--------------------------------------|---------|
| **D1** | **Route passes the `withAuth`-verified `user.id` as `p_user_id`; RPC drops the `auth.uid()` guard and instead requires `auth.role() = 'service_role'`; `REVOKE ALL … FROM authenticated`, `GRANT EXECUTE … TO service_role`.** | **Five layers.** (1) *Grant layer — primary:* `authenticated`/`anon`/`PUBLIC` have no EXECUTE, so the browser cannot reach the function at all; PostgREST answers 42501/403. (2) *Credential layer:* reaching it needs a `service_role` JWT, i.e. `SUPABASE_SERVICE_ROLE_KEY`, which lives only in the Vercel server env and is unreachable from the browser (`src/lib/supabase/admin.ts:1` is `import "server-only"`). (3) *Identity binding:* `p_user_id` is `user.id` from `withAuth` → `supabase.auth.getUser()`, an **authoritative network verification against Supabase Auth** (ADR-0022 layer 2), never a request-body field — the same chain the route already trusts for `validateKey({ userId: user.id })` (`create-with-key:654`) and the rate-limit bucket. (4) *In-body defence-in-depth:* `auth.role() = 'service_role'` means a future GRANT leak still fails closed (the `log_audit_event_service` hardening precedent, `20260515113753:60-77`). (5) *Referential integrity:* `api_keys.user_id` is `NOT NULL REFERENCES profiles ON DELETE CASCADE` (`20260405061911:21`), so a fabricated uid raises 23503. | ✅ **RECOMMENDED** |
| D2 | Split into a private `_create_wizard_strategy_internal` (REVOKEd from everyone) + a thin public wrapper. Precedent: `_enqueue_compute_job_internal` / `enqueue_compute_job` (`20260411144407:440-480`). | Identical to D1 — the wrapper is the thing being revoked anyway. | ❌ Extra moving parts, no added guarantee. Two more ACLs and two more re-base surfaces to keep in sync. |
| D3 | Keep `authenticated` EXECUTE; mint an HMAC attestation token at validate time and verify it in-body over `(user_id, venue, ciphertext hash)`. | The token; the caller cannot forge it without the HMAC key. | ❌ Fails the ROADMAP goal (`authenticated` EXECUTE must be withdrawn). Adds a key-management surface (pgsodium/Vault) that does not exist here, and a token-replay question. Enumerated so it is not re-proposed. |
| D4 | Drop the RPC for the `api_keys` write; do a direct service-role `.from("api_keys").insert()` from the route (the scrub trigger's allowlist already admits `service_role` — IN-04). | Same as D1 layers 2/3/5. | ❌ Loses the **F6 advisory-lock dedup fence** and the **atomic `api_keys` + `strategies` pair** — two PostgREST calls cannot be one transaction, so H-0304/H-0311 double-submit reopens. IN-04 pre-authorised this shape; do not take it. |
| D5 | Keep the user JWT but send it with a service-key-keyed client (`apikey: serviceKey`, `Authorization: Bearer <userToken>`). | Nothing new. | ❌ **Does not work.** PostgREST derives the DB role from the **Authorization** JWT, so this yields `authenticated`, not `service_role` — the exact role being revoked. The `apikey` header is a gateway concern. |
| D6 | Keep the user-scoped RPC; stamp `attested_venue` afterwards with a separate service-role UPDATE. | Nothing — `authenticated` EXECUTE stays. | ❌ Fails SC1 outright. Also fights `20260810120000`'s UPDATE revoke and the CHECK, and opens an unattested window. |
| D7 | Two-phase: user-scoped ownership pre-check, then hand off to a service-role writer. | Nothing beyond `getUser()`. | ❌ **The row does not exist yet.** At INSERT time "the row is the caller's" reduces to "`user_id` equals the authenticated caller", which `getUser()` already establishes. A pre-check on a not-yet-existing row buys nothing. Worth writing down so a reviewer does not ask for it. |

### What D1 does NOT buy — state this in the plan and in the column comment

Any server route holding `createAdminClient()` can pass any uid. That is the **standing `service_role` trust boundary** (ADR-0003, ADR-0001: BYPASSRLS means server-side code is never gated by RLS), identical to `log_audit_event_service(p_user_id, …)` which the Python worker calls with a uid of its choosing. What D1 converts is: *"any browser session can forge an attestation"* → *"only our own server code can"*. That is the whole point of the refactor, and it is the honest ceiling. Do not write "the venue cannot be forged"; write "the venue is the one this server observed a successful read-only authentication at."

### Recommended in-body shape (both RPCs, identical)

```sql
DECLARE
  v_jwt_role TEXT := COALESCE(auth.role(), '');
BEGIN
  -- ⛔ NOT current_user: inside a SECURITY DEFINER body current_user is the
  -- function OWNER, so a current_user test always passes (the no-op that made
  -- prevent_profile_role_change useless — 20260811210000:518-523).
  -- ⛔ NOT auth.uid(): a service-role caller has auth.uid() = NULL, so a
  -- uid comparison here is either a hard outage (IS NULL -> RAISE) or a
  -- permanent no-op (IS NOT NULL AND <> -> never fires). The ownership
  -- binding lives in the ROUTE: p_user_id is withAuth's getUser()-verified
  -- user.id (ADR-0022 layer 2), and the grant layer is what makes that
  -- trustworthy — only service_role can reach this function.
  IF v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION '<fn> may only be invoked by the server-side writer'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION '<fn>: p_user_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
```

⚠️ **Two runtime facts to MEASURE in Wave 0, not assume** (see Assumptions Log A1/A2): that a supabase-js service-key client yields `auth.role() = 'service_role'` and `auth.uid() = NULL` through PostgREST. The repo asserts the second twice in migration prose (`20260411144407:321`, `:453`; `20260418074935:157-158`) and the whole existence of `log_audit_event_service` depends on it — but a one-statement probe against TEST costs a minute and removes the guess.

---

## SC2 — The trace, corrected

**The ROADMAP's stated trace is through the wrong route.** Write the plan against this one instead, and record the correction so the verifier does not chase `/api/keys/validate-and-encrypt`.

```
Browser (ConnectKeyStep / MultiKeyConnectStep)
  POST { exchange, api_key, api_secret, passphrase, wizard_session_id }
      │
      ▼
withAuth  ── getUser() ──► user.id            (ADR-0022 layer 2, authoritative)
      │                        │
      ▼                        │
isSupportedExchange(exchange)  │              create-with-key:348 / add-key:106
      │                        │              ⇒ closed set, lowercased :555 / :277
      ▼                        │
exchangeNormalized ────────────┼──► validateKey(exchangeNormalized, creds, {userId})
      │                        │      create-with-key:648 / add-key:287
      │                        │      ⇒ live auth against THAT venue's API
      │                        │      ⇒ refuses unless read_only === true
      ▼                        │
exchangeNormalized ────────────┼──► encryptKey(exchangeNormalized, creds, {userId})
      │                        │      create-with-key:686 / add-key:322
      │                        │      ⇒ ciphertext is bound to the same venue
      ▼                        ▼
   createAdminClient().rpc(<fn>, { p_user_id: user.id, p_exchange: exchangeNormalized, … })
      │                                      ← THE ONE LINE PHASE 156 CHANGES
      ▼
SECURITY DEFINER body: auth.role()='service_role' gate
      │
      ▼
INSERT INTO api_keys (…, exchange, attested_venue) VALUES (…, p_exchange, p_exchange)
      │        ▲ scrub trigger: current_user = owner ⇒ value survives
      │        ▲ CHECK attested_venue = exchange     ⇒ coupling enforced (SC4, KEEP)
      ▼
INSERT INTO strategies (…)  — same transaction, same advisory-lock fence
```

**The honest ceiling on "server-verified", to be written into the column comment:** what the server observed is *"these credentials authenticated read-only at the venue named."* For every ccxt venue the adapter is selected by that venue string, so claiming `okx` with Binance credentials fails; for `mt5` the call goes through the MT5 gateway, which will not accept ccxt credentials. It is **not** a claim that the venue is where the user's capital actually sits. That is the strongest available statement and it is exactly what the probe gate needs.

**Deliberately out of scope, record as a decision:** `AllocatorExchangeManager` / `ApiKeyManager` / `StrategyForm` keep the client INSERT and keep landing `attested_venue = NULL` ⇒ PROBED. That is fail-toward and is 153.6 D-02/D-03 working. Changing it would break `test_api_keys_exchange_not_user_writable.sql` assertion **5c**, which asserts the client re-INSERT **SUCCEEDS**.

---

## SC1 — What has to change in assertion 5d

**File:** `supabase/tests/test_api_keys_exchange_not_user_writable.sql` — 5d at `:329-387`, 5e at `:389-418`. Whole file is `BEGIN; … ROLLBACK;` with `RAISE EXCEPTION` assertions (no pgTAP), run by the `sql-tests` CI job (`.github/workflows/ci.yml:833`, gated on `vars.E2E_TEST_DB_CONFIGURED`, `needs: [python]`, in the `shared-test-db` concurrency group).

**Today** (`:346-365`) it does `SET LOCAL ROLE authenticated`, calls `public.create_wizard_strategy(v_uid,'mt5', …)` positionally with 11 args, and asserts:

```sql
IF v_ins_err IS NOT NULL THEN
  RAISE EXCEPTION 'TEST FAILED (5d): create_wizard_strategy could not be called by the row owner (%)…';
```

— i.e. **it fails if the door is shut.** That inversion is the whole point of SC1.

**After Phase 156, 5d must assert the door is SHUT, three ways** (the file's own "refused AND unchanged" discipline from assertion 2, `:189-196`):

1. **Privilege polarity:** `has_function_privilege('authenticated', '<sig>', 'EXECUTE')` is **FALSE**, and `has_function_privilege('service_role', '<sig>', 'EXECUTE')` is **TRUE**. (Both polarities — a test that only asserts the negative passes on a database where the function was dropped.)
2. **The call is REFUSED with the right SQLSTATE:** `SET LOCAL ROLE authenticated` → call → capture SQLSTATE → require `42501`. Refusal on any other code means it was blocked for the wrong reason (the file already applies this discipline at `:183-187` and `:413-417`).
3. **Nothing was minted:** no new `api_keys` row exists for `v_uid` from that call. "An error was raised" is the weaker claim.

**Plus a mandatory anti-vacuity positive control** — the file's own convention (5b at `:267-281` exists solely for this): the SAME call made as the **privileged role** with a valid `p_user_id` must **SUCCEED** and store `attested_venue = exchange`. Without it, "refused" is indistinguishable from "the function no longer exists / the signature drifted", which would mean connect-a-key is broken and the test would green-light it. ⚠️ Note the pre-existing hazard recorded in `153.6-07-SUMMARY.md`: a blunt 5d mutation is intercepted by 5b's anti-vacuity control before it reaches 5d — design the Rule-9 mutations so they isolate the assertion under test.

**Add the composite twin.** 5d only exercises `create_wizard_strategy`. `add_wizard_composite_key` has the identical door and no assertion at all. Add **5f/5g** for it, or the phase closes one of two identical doors — the instance-not-class defect this repo has paid for repeatedly.

**⛔ Gate-marker trap.** The whole 5a–5e block is gated on `col_description(api_keys.attested_venue) LIKE '%20260811210000%'` (`:242-253`). **SC5 rewrites that comment.** If the re-stamp drops the `20260811210000` substring, the entire block **SKIPs with a NOTICE and the job stays green.** 5a exists to catch exactly this for the *older* marker (`:261-264`) — there is no equivalent guard for the newer one. **The plan must (a) preserve the `20260811210000` substring in any re-stamp, and (b) add the new migration's own marker as a second gate plus a 5a-shaped positive control asserting the older marker survived.** Comment re-stamps must also precede the post-verify block in the new migration (`20260811210000:702-712` records the measured reason: in the old order a marker-dropping re-stamp COMMITTED while the verify reported "marker preserved").

---

## Gates and pins that flip polarity — the full inventory

Every one of these currently asserts `authenticated` **HAS** EXECUTE. Withdrawing it turns each into a CI failure. This is the phase's biggest breakage surface and it is entirely mechanical.

| # | Site | Current assertion | Action |
|---|---|---|---|
| G1 | `supabase/tests/test_wizard_session_idempotency.sql:129-131` | `IF NOT has_function_privilege('authenticated','create_wizard_strategy(uuid,text,…,uuid,text)','EXECUTE') THEN RAISE 'authenticated lost EXECUTE'` | **INVERT** to `IF has_function_privilege(…) THEN RAISE`, and add the `service_role` positive. Keep the `anon` assertion at `:133-135` unchanged. |
| G2 | `supabase/tests/test_wizard_composite_fence.sql:65-68` | same for `add_wizard_composite_key(uuid,…,uuid)` | **INVERT** + add `service_role` positive. Keep `anon` at `:55-58`. |
| G3 | `supabase/tests/test_wizard_composite_fence.sql:124/129/175/194/208` | Calls both RPCs directly. **No `SET LOCAL ROLE` in the file** ⇒ runs as the connection role (migration owner), so these keep working. **Verify, do not assume** — if the CI connection role is not in the owner/superuser set, every one of these breaks. | **MEASURE** on TEST before writing the plan. |
| G4 | `supabase/tests/test_csv_finalize_double_submit.sql:218` | Calls `create_wizard_strategy` as the connection role | Same measurement as G3. |
| G5 | `supabase/tests/test_api_keys_venue_identity_uniq.sql:41` | Pins the exact 12-arg signature string; `:174-204` asserts one overload, the `wizdraft:` fence, and that the body still writes `attested_venue` | **Keep the signature unchanged** and all of this survives. This is the strongest argument for `CREATE OR REPLACE` over `DROP+CREATE`. |
| G6 | `supabase/tests/test_api_keys_exchange_not_user_writable.sql:329-387` | 5d asserts the RPC door is OPEN | **REPLACE** — see SC1 above |
| G7 | `20260811210000` post-verify (e), `:869-882` | `IF NOT has_function_privilege('authenticated', …) THEN RAISE 'connect-a-key is broken'` | **Cannot be edited** (applied migration). On an ordered fresh replay it runs *before* 156's migration, so it passes. ⚠️ **It would abort if `20260811210000` were ever re-applied after 156.** Record this in the new migration's header and in `docs/runbooks/migration-failure.md` if that runbook covers re-apply. |
| G8 | `20260812083206` post-verify, `:861-868` | same shape | Same as G7. |
| G9 | `src/app/api/strategies/create-with-key/route.test.ts:205-213` | Mocks `@/lib/supabase/server`'s `createClient` to supply `rpc` | **MOVE `rpc` onto the `@/lib/supabase/admin` mock** (`:229-238`). |
| G10 | `src/app/api/strategies/create-with-key/route.test.ts:229-238` (`adminClientThrows`) | Asserts a missing service key **degrades gracefully** (venue fence goes dark, connect still succeeds) | ⛔ **This expectation becomes FALSE.** After 156 a missing service key means the RPC cannot be called at all. The test must be re-cut to assert an honest hard failure — and the *route* must be changed to produce one (see "Fail-closed posture"). A test left as-is would pass only if the route kept a silent fallback, which is the bug. |
| G11 | `src/app/api/strategies/composite/add-key/route.test.ts:108-114` | Mocks only `@/lib/supabase/server`; **no `admin` mock exists** | **ADD** a `@/lib/supabase/admin` mock, or the real `createAdminClient()` throws for missing env and every composite test reds for the wrong reason. |
| G12 | `src/__tests__/audit-coverage.test.ts:208` + the `@audit-skip` pragma at `create-with-key:748-753` | The pragma must sit **within 8 lines** of the mutation (`finalize-wizard:1283-1286` records this measured rule) | Moving the `.rpc()` call must move the pragma with it. `add_wizard_composite_key` is **not** in `MUTATING_RPC_NAMES` — a pre-existing gap; log it, do not fix it in this phase (Rule 3). |
| G13 | `src/lib/database.types.ts:3399`, `:3604` | Generated RPC types | Signature unchanged ⇒ no regeneration needed. Verify with `npx tsc --noEmit`. |
| G14 | `npm run schema:functions:check` | Snapshots must match the replayed migration chain | **Run `npm run schema:functions` and commit both snapshots** in the same commit as the migration. 153.6-07 was bitten by exactly this (its "Deviations from Plan" §1). |
| G15 | `src/__tests__/wizard-rpcs-live-db.test.ts:161`, `:215`, … | Calls the RPCs with a **user-scoped** client and expects success | `it.skipIf(!HAS_LIVE_DB)` ⇒ **never runs in CI**. It will be wrong after 156. Update it anyway (a stale live test is a trap for whoever next runs it locally), but do not treat it as a gate. |

---

## Migration mechanics

### Shape

**One new migration, `CREATE OR REPLACE` (not `DROP`+`CREATE`).**

Why this matters more than usual: `20260812083206:739-747` documents the sharp edge — *"DROP DESTROYS [the ACL]. A freshly created function's default ACL grants EXECUTE to PUBLIC — so omitting the REVOKE below would hand `anon` EXECUTE on a SECURITY DEFINER function that writes api_keys. That is a privilege ESCALATION introduced by the act of dropping, silently, with no error."* Since **no signature change is needed** (the uid already arrives as `p_user_id`), `CREATE OR REPLACE` preserves the ACL, preserves the `COMMENT`, keeps G5's signature pin valid, and avoids any PostgREST overload/PGRST202/PGRST203 hazard. **Then issue the REVOKE/GRANT explicitly anyway**, because that is the actual product change.

Sketch of the migration's sections, in order:

1. Header: what, why, the ⛔ deploy-order block (mirroring `20260811210000`'s), and the G7/G8 re-apply note.
2. `CREATE OR REPLACE FUNCTION public.create_wizard_strategy(<12 args>)` — **re-based verbatim on `supabase/schema/functions/create_wizard_strategy.sql`**, with only the guard block replaced. Keep `SECURITY DEFINER`, `SET search_path = public, pg_catalog`, `SET lock_timeout = '3s'`, the `wizdraft:` advisory lock, the select-existing fence, and both stamp expressions (`p_exchange` into `attested_venue`, `NULLIF(btrim(p_venue_account_id),'')`).
3. Same for `add_wizard_composite_key(<11 args>)`, re-based on its snapshot, `wizcomposite:` lock preserved.
4. `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated;` + `GRANT EXECUTE ON FUNCTION … TO service_role;` for both. (Revoke from `PUBLIC` too — `authenticated` inherits PUBLIC's default grants, so revoking from `authenticated` alone is not sufficient in general. Both are already PUBLIC-revoked here; re-assert to make the file self-contained, as `20260515113753:200-203` does.)
5. `COMMENT ON COLUMN public.api_keys.attested_venue` — the SC5 re-strengthening. **Must preserve the `20260811210000` substring** (G6 gate) and add the new migration's id. **Must sit BEFORE the post-verify block.**
6. `COMMENT ON FUNCTION` for both RPCs (re-stamp the CR-01/Phase-156 residual prose that `20260812083206:756-775` carries).
7. `DO $verify$` post-verify, aborting on:
   - (a) `has_function_privilege('authenticated', <sig>, 'EXECUTE')` is FALSE — **both** functions;
   - (b) `has_function_privilege('anon', <sig>, 'EXECUTE')` is FALSE — both;
   - (c) `has_function_privilege('service_role', <sig>, 'EXECUTE')` is TRUE — both (**the outage guard**);
   - (d) both bodies still contain their advisory-lock fence substring and still write `attested_venue` (the `test_api_keys_venue_identity_uniq.sql:201-204` shape — a stale re-base is the documented way to silently revert PR #675);
   - (e) both bodies contain `auth.role()` and do **not** contain `auth.uid()` (Trap B's structural guard);
   - (f) both still `prosecdef = true` and `proowner` ∈ the scrub-trigger allowlist (re-assert `20260811210000` (f));
   - (g) the `api_keys_attested_venue_matches_exchange` CHECK is still present and `convalidated` (SC4 — a fence that this phase must be seen not to have dropped);
   - (h) the `attested_venue` column comment still contains `20260811210000` **and** the new id (the G6 gate-marker guard).

### `migration-reviewer` / `rls-policy-auditor` invariants this phase can trip

Read `.claude/agents/migration-reviewer.md` and `.claude/agents/rls-policy-auditor.md` in full before writing SQL. The ones live here:

| Invariant | Relevance |
|---|---|
| #1 timestamp filename, #2 backdated guard | `.github/workflows/migration-policy.yml` blocks a timestamp < remote tip without an allowlist entry. The MCP-apply-then-rename procedure interacts with this — rename **forward**, never backward. |
| #3 SECDEF must `SET search_path = public, pg_catalog` | Both re-based bodies already have it. Do not drop it in the re-base. |
| **#11 edit-applied-migration = CRITICAL** | `20260810120000`, `20260811210000`, `20260812083206` are applied. **Read-only.** |
| **#17 trigger-on-SECDEF-helper REVOKE production-breaker** | A `REVOKE EXECUTE … FROM <role>` where that role originates DML on a table with a trigger calling the helper ⇒ 42501 for every DML. **Check this explicitly:** `api_keys` carries two INVOKER scrub triggers and `strategies` carries `guard_wizard_draft_updates_trigger`. Those trigger *functions* are not being revoked here, and `guard_wizard_draft_updates` only blocks `current_user = 'authenticated'` on UPDATE (`20260411103316:341-347`) — a service-role UPDATE passes. **But the reviewer will raise this; pre-empt it with the analysis written down.** |
| **#19 SECDEF EXECUTE-to-authenticated = probe-oracle** | This phase **removes** such a grant. Note it as the finding being *closed*. |
| #20 ACL drift between adjacent migrations | The REVOKE and the route change ship in the same PR; the migration must be applied to TEST **before** the deploy that switches the client, and to PROD **before** the merge's Vercel build wins the race. See "Deploy order". |
| #21 `RAISE` format string must be a single literal | Long `RAISE EXCEPTION` messages with `||` fail at apply with 42601. Use one literal or `$msg$…$msg$`. |
| ADR-0001 / ADR-0003 BYPASSRLS | The whole design leans on `service_role`. State the trust boundary explicitly (D1's "what it does NOT buy"). |

### Deploy order — this phase has a genuine outage window

`CONTRIBUTING.md` §2: *"the merge IS the apply"*, and the Vercel build fires on the same merge **with no ordering between them**.

- If the **deploy wins**: the route calls the RPC as `service_role`, which has no EXECUTE yet ⇒ **42501 on every connect-a-key**, single-key and composite, for the whole window.
- If the **migration wins**: `authenticated` has lost EXECUTE while the old deploy still calls with the user-scoped client ⇒ **42501 on every connect-a-key** for the whole window.

**Both directions break.** Neither ordering is safe on its own. Mitigations, in the plan's words not mine:

- **Preferred — make the migration order-independent:** in the new migration, `GRANT EXECUTE … TO service_role` **and leave `authenticated`'s grant in place**; withdraw `authenticated` in a **second, later migration** merged after the deploy carrying the client swap is live and verified. Two migrations, zero-window. The `authenticated` withdrawal is the SC1 change, so SC1's gate must arm against the second migration's marker.
- **Alternative — a single migration + the documented manual procedure:** apply to PROD via MCP first, confirm `Supabase Migrate` green, then merge. This is what `20260811210000`'s header prescribes for its own class. It still leaves the "migration wins" window open for the duration of the Vercel build.

**Recommend the two-migration split.** It is the only option with no window, and it costs one extra file.

### The PR-Y2 rename, concretely

1. Write `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql` locally with a plausible timestamp.
2. Apply to **TEST** (`qmnijlgmdhviwzwfyzlc`) via Supabase MCP `apply_migration`. **⛔ Never `supabase db push`.**
3. MCP stamps the remote `schema_migrations.version` with `now()` — read the actual stamped version back.
4. **Rename the local file** so its 14-digit prefix equals the stamped version. This is the PR-Y2 pattern the drift workflow's error text names.
5. Confirm `migration-drift-check` is green on the PR before merge; its `PRE_EXISTING_DRIFT` arm compares pending remote versions against the PR's added files, so a mismatched name reds.
6. ⚠️ The drift workflow links to `vars.SUPABASE_PROJECT_REF`, which is **PROD**. A file applied to TEST but not PROD still shows as *pending* on PROD, which the workflow tolerates only if the timestamp matches a file this PR added. Keep the rename consistent.

---

## Fail-closed posture (a decision the plan must take, not inherit)

`create-with-key:196-204` already documents the current posture for the *venue-identity fence*: *"`createAdminClient()` THROWS when `SUPABASE_SERVICE_ROLE_KEY` is absent. A missing credential must not 500 a connect that would otherwise succeed: the DB index is still the backstop, so the honest degradation is a dark fence plus a loud log — never a failed submit."*

**After Phase 156 that reasoning does not transfer**, because there is no backstop: without the service key the RPC cannot be called at all. The plan must:

- **Not** fall back to the user-scoped client. That fallback silently re-opens the door this phase closes, and it would make every gate here pass vacuously.
- Answer an honest, non-accusatory failure. This repo has fixed the "our outage rendered as your key is bad" class repeatedly (`seam-copy.ts:31`, `validate-and-encrypt:328-348`). Candidate: `SEAM_MISCONFIGURED` at 503 — already a member of the code union and already used by both wizard routes for a limiter misconfiguration (`create-with-key:507-510`, `validate-and-encrypt:158-161`). ⚠️ Check `KNOWN_FINALIZE_CODES` / `wizardErrors.ts` and the `EXPECTED_TABLE_SIZE` pins before adding any *new* code — PARITY-05's ledger (`REQUIREMENTS.md:897-905`) records the exact discipline for that.
- Note that `finalize-wizard` **already** hard-depends on `createAdminClient()` on the wizard path (`:1181`, the attestation read; also `:1355`, `:1681`, `:1965`, `:2290`), so the service key is already load-bearing for a wizard submit. This phase extends that dependency from *submit* to *connect*, which is a real widening and should be stated, not smuggled.

---

## SC5 — The prose inventory (exact sites)

Every place 153.6 weakened a claim, with the current wording's location:

| # | Site | Current (weakened) | Required |
|---|---|---|---|
| P1 | `COMMENT ON COLUMN public.api_keys.attested_venue` — new migration re-stamps it; current text at `20260811210000:713-745` | *"RPC-WRITTEN venue … it is narrower than 'server-validated' … the two RPCs do NOT validate this value … both are invokable by authenticated over PostgREST"* | Server-attested: written only by the two RPCs, which only `service_role` may invoke, from the venue the route observed a successful read-only authentication at. **⛔ Must retain the `20260811210000` substring (G6) and add the new id.** Must also retain the "NULL means PROBE (fail-toward)" and "never fall back to `api_keys.exchange`" sentences. |
| P2 | `20260811210000` §1b header prose (`:225-290`, incl. `:277` *"withdraw `authenticated` EXECUTE from both wizard RPCs"* as future work) | Describes 156 as deferred | **⛔ Cannot be edited** (applied migration, invariant 11). Correct it in the **new** migration's header, which explicitly names `20260811210000` §1b as superseded. Say this in the plan so nobody edits the old file. |
| P3 | `REQUIREMENTS.md` PARITY-04 (`:885-895`) and its ledger row (`:1281`) | Carries the accepted residual + `threat_flag: deferred-control` | Re-strengthen; clear the flag; mark 🟢→✅ only once CI has observed the new assertions green. |
| P4 | `supabase/schema/functions/create_wizard_strategy.sql:74-113` and `add_wizard_composite_key.sql:85-88` | In-body ⛔ notes naming Phase 156 as the owner | Regenerated by `npm run schema:functions` — so they follow automatically **iff** the migration's in-body comments are rewritten. Do not hand-edit the snapshots. |
| P5 | `src/app/api/strategies/finalize-wizard/route.ts:1200-1220` | *"⚠️ WHAT THIS IS NOT (153.6 code review CR-01): it is NOT a venue the server independently validated … Do not upgrade this comment to 'server-validated' without the deferred connect-flow refactor"* | This phase **is** that refactor. Upgrade it — and keep the "⛔ NEVER `?? apiKeyExchange`" paragraph at `:1252-1258` byte-intact. |
| P6 | `src/app/api/strategies/finalize-wizard/route.test.ts` — the `[153.6-04 / PARITY-04]` docblock + `describe` title | Asserts the narrower guarantee | Update the prose; **do not** weaken any assertion. |
| P7 | `src/app/api/strategies/create-with-key/route.ts:766-782` (the `p_venue_account_id` ⛔ block) and `:104` | *"remedy is Phase 156 (CONNECT-REFACTOR), which moves this INSERT behind a service-role writer and withdraws authenticated EXECUTE"* | Rewrite as done. ⚠️ **`venue_account_id` is a separate CR-01-class residual** — 156 closes the *reachability* half (only the server can pass it) but the value still has no in-database oracle. Say precisely that; do not over-claim. |
| P8 | `20260812083206:756-775` — the `COMMENT ON FUNCTION create_wizard_strategy` text | Carries *"⛔ `p_venue_account_id` is NOT VALIDATED here and `authenticated` can call this RPC directly"* | Re-stamp via `COMMENT ON FUNCTION` in the new migration. |
| P9 | `CONTRIBUTING.md` §2 | Cites `20260811210000` as the worked deploy-order example | Optional: add this phase's two-migration split as the worked example for a *privilege* change. |
| P10 | `.planning/ROADMAP.md` Phase 156 block + `.planning/STATE.md` | — | Close out at phase end. |

---

## Do not touch

- **The `api_keys_attested_venue_matches_exchange` CHECK.** SC4 is explicit. Post-verify it, do not drop it. Its rationale outlives this phase: it is the fence against a *future* writer letting the columns diverge.
- **The scrub triggers and their SECURITY INVOKER declaration.** `20260811210000:518-523` explains why a DEFINER form would be a silent no-op.
- **Assertion 5c** (client re-INSERT SUCCEEDS + stores NULL). D-02/D-03 keep the client INSERT path open on purpose.
- **The F6 advisory-lock fences** in both bodies, and the select-existing replay fence in `create_wizard_strategy` (`:53-72` of the snapshot) with its red-team MEDIUM-1 note about NULL `api_key_id`.
- **`venue_account_id`'s `NULLIF(btrim(…),'')` normalisation** and its agreement with `api_keys_venue_account_id_nonblank`.
- **The three client-INSERT surfaces** (`AllocatorExchangeManager`, `ApiKeyManager`, `StrategyForm`) and `/api/keys/validate-and-encrypt` itself.
- **`finalize_wizard_strategy`** — a third wizard RPC with `authenticated` EXECUTE (`20260411103316:292`). It does not write `api_keys` and is not in scope. Resist scope creep; log it if it looks like the same class.
- **The composite arm's fail-CLOSED refusal** in `finalize-wizard` — `153.6-07-SUMMARY.md` analysed and deliberately left it; softening it fails **open** on a security control.

---

## Common Pitfalls

### Pitfall 1 — The relaxed uid guard that never fires
**What goes wrong:** `IF v_auth_uid IS NOT NULL AND v_auth_uid <> p_user_id THEN RAISE` looks like it preserves the ownership check. Under `service_role` it never fires.
**Why:** `auth.uid()` is NULL for a service-key JWT.
**Avoid:** Delete `auth.uid()` from both bodies entirely; add a post-verify assertion that neither body contains the string `auth.uid()`. Ledger a mutation that reinstates the relaxed form and prove a test reds.
**Warning sign:** any surviving reference to `auth.uid()` in either RPC.

### Pitfall 2 — `current_user` in a SECDEF role gate
**What goes wrong:** the gate always passes. Documented twice in-repo (`20260811210000:518-523`, `20260411103316:313-321`); it is the bug that made `prevent_profile_role_change` a no-op.
**Avoid:** `auth.role()`. Post-verify that the bodies contain `auth.role()`.

### Pitfall 3 — Forgetting `GRANT EXECUTE … TO service_role`
**What goes wrong:** total connect-a-key outage, both arms, every venue. `service_role` has no EXECUTE on either RPC today.
**Avoid:** post-verify (c) above, plus a SQL-gate positive assertion.

### Pitfall 4 — The gate-marker drop
**What goes wrong:** re-stamping the `attested_venue` comment without the `20260811210000` substring makes the whole 5a–5e block SKIP with a NOTICE. **Green CI, zero coverage.** Comment ordering matters too — a re-stamp placed after the post-verify reads the comment it just wrote (measured, `20260811210000:702-712`).
**Avoid:** preserve the substring; comments before post-verify; assert the marker in post-verify (h) and in 5a.

### Pitfall 5 — The route test that asserts the old degradation
**What goes wrong:** `adminClientThrows` (`create-with-key/route.test.ts:229-238`) currently asserts a missing service key still lets a connect succeed. After 156 that is only achievable by keeping a user-scoped fallback — i.e. by not doing the phase.
**Avoid:** re-cut the test to the new posture **first**, observe it RED against the unchanged route, then change the route.

### Pitfall 6 — Composite route tests have no admin mock at all
**What goes wrong:** `composite/add-key/route.test.ts` mocks only `@/lib/supabase/server`. The real `createAdminClient()` throws for missing env ⇒ every composite test reds for the wrong reason, and the noise hides a real failure.
**Avoid:** add the mock in the same commit as the route change.

### Pitfall 7 — DROP+CREATE
**What goes wrong:** a fresh function's default ACL grants EXECUTE to **PUBLIC**; the COMMENT is destroyed; G5's signature pin and the PostgREST schema cache both take a hit. `20260812083206:739-747` calls it *"a privilege ESCALATION introduced by the act of dropping, silently, with no error."*
**Avoid:** no signature change ⇒ `CREATE OR REPLACE`.

### Pitfall 8 — A stale re-base silently reverting PR #675
**What goes wrong:** re-basing on a body older than `20260811210000` drops `attested_venue` from the INSERT; every MT5 finalize then answers a permanent `KEY_SCOPE_CHECK_UNAVAILABLE` with no remedy.
**Avoid:** re-base from `supabase/schema/functions/*.sql`, whose `-- source migration:` header names the LATEST source; keep the existing `test_api_keys_venue_identity_uniq.sql:204` assertion armed and add its twin for the composite.

### Pitfall 9 — Shared-TEST-DB flakes read as this phase's failures
**What goes wrong:** `sql-tests` shares the `shared-test-db` concurrency group with `python` and `e2e-seeded` (`ci.yml:833`+). A cancelled job renders **grey**, not red, and branch protection is deferred on this repo — so a lost gate looks like a pass. Four separate flake mechanisms are already documented for this DB.
**Avoid:** do not remove `needs: [python]`; do not give the job its own group; when a SQL gate is grey, re-run it rather than reading it as green.

### Pitfall 10 — Editing an applied migration to "fix" the prose
**What goes wrong:** invariant 11, CRITICAL. `20260811210000` §1b reads as if 156 is still deferred; the temptation to edit it is real.
**Avoid:** correct it in the new migration's header, and say so in the plan.

---

## Runtime State Inventory

This is a privilege/refactor phase, so the inventory applies.

| Category | Items found | Action required |
|----------|-------------|-----------------|
| **Stored data** | `api_keys.attested_venue` on PROD: 29 rows total / 2 `mt5` as of the `20260811210000` census; TEST `qmnijlgmdhviwzwfyzlc` measured 2026-08-12 at 2438 rows → 2320 attested / 118 NULL (all post-cutoff) / 0 divergent. **No data migration is needed** — existing values stay valid; 156 changes only *who may write new ones*. | None. ⛔ Do **not** add a backfill: `20260811210000` WR-01 records that any unbounded re-backfill retro-attests exactly the rows the trigger deliberately scrubbed. |
| **Live service config (not in git)** | Vercel env `SUPABASE_SERVICE_ROLE_KEY` must be present in **all** environments that serve the wizard (Production + Preview). It already is — `finalize-wizard` and the `create-with-key` venue fence depend on it — but connect-a-key has never depended on it before. Railway worker uses the different name `SUPABASE_SERVICE_KEY`; **the worker does not call these RPCs**, so no worker change. | **Verify the Vercel Preview env has the key** before merging, or every Preview deploy's wizard breaks. |
| **OS-registered state** | None — no cron, no scheduler, no OS registration touches these RPCs. Verified: no `cron.schedule` reference to either function name across `supabase/migrations/**`. | None. |
| **Secrets / env vars** | No new secret. No key rotation. `SUPABASE_SERVICE_ROLE_KEY` changes *criticality*, not value. | Document the criticality change in the route header. |
| **Build artifacts / installed packages** | `supabase/schema/functions/{create_wizard_strategy,add_wizard_composite_key}.sql` are generated artifacts that go stale the moment the migration lands; `src/lib/database.types.ts` is generated but unaffected (signature unchanged). PostgREST's schema cache reloads on DDL via the event trigger — no manual `NOTIFY pgrst, 'reload schema'` needed, but a grant-only change does not always invalidate it; if a stale-privilege symptom appears on TEST, that is the cause. | `npm run schema:functions` + commit, same commit as the migration. |

---

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Frameworks | **vitest 4.1.10** (TS, `vitest.config.ts`, coverage thresholds 82/80/74/72), **plain PL/pgSQL** SQL gates under `supabase/tests/test_*.sql` run by `psql -v ON_ERROR_STOP=1` in the `sql-tests` CI job, **pytest** (`analytics-service/`, not touched by this phase) |
| Config files | `vitest.config.ts`; `.github/workflows/ci.yml:833` (`sql-tests`) |
| Quick run (TS) | `npx vitest run src/app/api/strategies/create-with-key/route.test.ts src/app/api/strategies/composite/add-key/route.test.ts --no-file-parallelism` |
| Quick run (SQL, local) | `/opt/homebrew/opt/postgresql@16/bin/psql -v ON_ERROR_STOP=1 -f supabase/tests/test_api_keys_exchange_not_user_writable.sql` against a throwaway PG16 fixture (the 153.6-07 harness — `initdb -U postgres`, loopback TCP, **not** a unix socket: the scratchpad path is 121 bytes against a 103-byte `sun_path` limit) |
| Full suite | `npm run lint && npx tsc --noEmit && npx vitest run --coverage && npm run schema:functions:check` |

### Phase Requirements → Test Map

| Req | Behaviour | Type | Automated command | Exists? |
|-----|-----------|------|-------------------|---------|
| CONNECT-01 | `authenticated` cannot EXECUTE `create_wizard_strategy`; the call raises 42501; no row minted | SQL gate | `psql -f supabase/tests/test_api_keys_exchange_not_user_writable.sql` (rewritten 5d) | ❌ inverted today — Wave 0 |
| CONNECT-01b | same for `add_wizard_composite_key` | SQL gate | same file, new 5f/5g | ❌ does not exist — Wave 0 |
| CONNECT-01c | `service_role` HAS EXECUTE on both (anti-vacuity + outage guard) | SQL gate | `test_wizard_session_idempotency.sql`, `test_wizard_composite_fence.sql` (inverted + extended) | ❌ Wave 0 |
| CONNECT-02 | The RPC is called with the same `exchangeNormalized` that `validateKey` succeeded on, on the **admin** client | unit (vitest) | `npx vitest run src/app/api/strategies/create-with-key/route.test.ts -t "attest"` — assert `rpcMock` was reached via the **admin** mock and `p_exchange === ` the `validateKey` arg | ❌ Wave 0 — needs the mock re-wiring (G9/G11) |
| CONNECT-02b | A structural CI invariant: neither wizard route calls `.rpc("create_wizard_strategy"\|"add_wizard_composite_key")` on a user-scoped client | grep-gate (vitest) | a `147-guards`-shaped source-scanning test (precedent: `148-04`'s SC2-B structural invariant) | ❌ Wave 0 |
| CONNECT-03 | Wizard end-to-end, single-key AND composite, per venue | e2e + manual | `e2e-seeded` lane; ⚠️ **a real browser pass is worth more than the suite here** (`feedback_review_blast_radius…`: a 40-min browser pass beat 10,193 tests) | partial |
| CONNECT-03b | Ownership binding: a route cannot pass a uid other than `withAuth`'s | unit | assert `p_user_id === user.id` and that no request-body field can reach it | ❌ Wave 0 |
| CONNECT-04 | The CHECK still exists and is `convalidated` | migration post-verify (g) + `test_…_not_user_writable.sql` 5e (already exists, `:389-418`) | unchanged | ✅ exists |
| CONNECT-05 | Prose | repo grep for the negated claim (153.6-07's own method: *"a repo grep for the claim now returns only the negated usage"*) | manual grep in the plan | n/a |

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit` + the two route test files + `npm run lint`.
- **Per wave merge:** full vitest with `--coverage`, `npm run schema:functions:check`, and the SQL gate against the local PG16 fixture.
- **Phase gate:** full suite green **and** `sql-tests` observed green in CI against TEST (a grey `sql-tests` is not a pass — Pitfall 9).

### Wave 0 Gaps
- [ ] Rewrite `supabase/tests/test_api_keys_exchange_not_user_writable.sql` 5d (invert) + add 5f/5g composite twin + the two anti-vacuity positives — covers CONNECT-01/01b/01c
- [ ] Invert G1 (`test_wizard_session_idempotency.sql:129-131`) and G2 (`test_wizard_composite_fence.sql:65-68`), add `service_role` positives
- [ ] Re-wire `create-with-key/route.test.ts` mocks (G9) and re-cut the `adminClientThrows` expectation (G10)
- [ ] Add a `@/lib/supabase/admin` mock to `composite/add-key/route.test.ts` (G11)
- [ ] New structural grep-gate for CONNECT-02b
- [ ] **Measure** A1/A2/A3 (below) against TEST before designing on them

---

## Security Domain

| ASVS Category | Applies | Standard control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `withAuth` → `supabase.auth.getUser()` (ADR-0022 layer 2). Unchanged. |
| V3 Session Management | no | — |
| **V4 Access Control** | **yes — this is the phase** | Postgres GRANT/REVOKE on `SECURITY DEFINER` functions as the primary gate; in-body `auth.role()` as defence-in-depth; RLS is *not* the control here because `service_role` has BYPASSRLS (ADR-0001/0003). |
| V5 Input Validation | yes | `isSupportedExchange` closed set (`closed-sets.ts` `SUPPORTED_EXCHANGES`), lowercase normalisation, `NULLIF(btrim(…),'')`. Unchanged. |
| V6 Cryptography | no (unchanged) | Envelope encryption stays in the Python service; never hand-rolled. |

### Threat patterns for this stack

| Pattern | STRIDE | Mitigation |
|---|---|---|
| Direct PostgREST RPC invocation bypassing the route's checks | Elevation of Privilege | Withdraw `authenticated` EXECUTE; grant only `service_role`. **This is the phase.** |
| SECDEF role gate written with `current_user` ⇒ always-pass | Elevation of Privilege | `auth.role()`; post-verify the body string. |
| Ownership check silently voided when `auth.uid()` becomes NULL | Elevation of Privilege | Delete `auth.uid()` from both bodies; post-verify its absence; Rule-9 mutation. |
| DROP+CREATE restoring PUBLIC EXECUTE | Elevation of Privilege | `CREATE OR REPLACE` + explicit REVOKE + post-verify both polarities. |
| Deploy/migration race leaving one side without EXECUTE | Denial of Service | Two-migration split (grant first, revoke later). |
| Test gate that SKIPs on a dropped marker | *(control failure)* | Preserve the marker; assert it in post-verify and in a 5a-shaped control. |
| A probe-exempt **syncable** venue joining `scopeProbeSupported: false` | Elevation of Privilege | The reason this phase exists. sFOX's `VENUE_CAPABILITIES` row is `{}` today (`closed-sets.ts`), with a logged open question about whether it belongs in the opt-out. **After 156, adding sFOX to the opt-out is safe; before it, it is a free bypass.** |

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| `supabase` CLI | drift check / local | ✓ | 2.84.2 (CI pins 2.98.2) | — |
| `psql` | local SQL-gate runs | ✓ *not on PATH* | 16.13 at `/opt/homebrew/opt/postgresql@16/bin/psql` | prepend to PATH |
| `node` / `npm` | vitest, tsc, lint | ✓ | v25.8.1 / 11.11.0 | ⚠️ CI runs Node 22 — a CI-only vitest failure is not a flake; reproduce with `PATH=/opt/homebrew/opt/node@22/bin` |
| `vitest` | TS gates | ✓ | 4.1.10 | — |
| `gh` | PR ops | ✓ | 2.92.0 | — |
| Supabase MCP `apply_migration` | TEST apply | assumed ✓ | — | ⛔ never `supabase db push` |
| TEST project `qmnijlgmdhviwzwfyzlc` | SQL gate, measurements | assumed ✓ | — | local PG16 fixture for behaviour; TEST for privileges |

**No blocking gaps.** ⚠️ **GSD worktree agents get no `node_modules`** — `npx vitest` exits 1 with `MODULE_NOT_FOUND` and `npx tsc` resolves a joke package. Symlink the main checkout's `node_modules` into any worktree before trusting a red result, and grep for per-test-name labels among failures rather than reading a bare exit code.

---

## Package Legitimacy Audit

**No packages are installed by this phase.** It touches SQL, two route handlers, their tests, and prose. `slopcheck` was therefore not run and no dependency is recommended. If the plan later proposes one, run the Package Legitimacy Gate first.

---

## Assumptions Log

| # | Claim | Section | Risk if wrong | How to close (cheap) |
|---|-------|---------|---------------|----------------------|
| **A1** | A supabase-js client constructed with `SUPABASE_SERVICE_ROLE_KEY` reaches PostgREST as DB role `service_role`, with `auth.role() = 'service_role'`. `[ASSUMED — supported by in-repo prose at 20260411144407:453 and by the existence of log_audit_event_service, not measured this session]` | SC3 / D1 | The in-body gate is wrong; either always-refuse or always-pass. | Wave 0: `createAdminClient().rpc(<probe>)` where the probe returns `auth.role(), auth.uid(), current_user, session_user`, against TEST. One task. |
| **A2** | `auth.uid()` is NULL for that client. `[ASSUMED — 20260411144407:321/:453, 20260418074935:157-158 state it; not measured this session]` | SC3 traps | Trap B's analysis changes. | Same probe. |
| **A3** | The `sql-tests` CI connection role is a superuser/owner, so the existing RPC calls in `test_wizard_composite_fence.sql` / `test_csv_finalize_double_submit.sql` keep working after the REVOKE. `[ASSUMED]` | G3/G4 | Two SQL gates red on merge for a reason unrelated to the change. | Run `SELECT current_user, session_user, rolsuper FROM pg_roles WHERE rolname = current_user` at the top of a scratch gate on TEST. |
| **A4** | `service_role` is not a member of `authenticated` in Supabase's role graph, so it has no EXECUTE today. `[ASSUMED — inferred from this repo granting both separately, e.g. 20260417031851:165, and from no wizard-RPC grant to service_role existing]` | ACL table | If wrong, the `GRANT … TO service_role` is redundant (harmless). If right and omitted, total outage. | `SELECT has_function_privilege('service_role','create_wizard_strategy(…)','EXECUTE')` on TEST. Grant it either way. |
| **A5** | PostgREST answers 403 with SQLSTATE `42501` when the JWT role lacks EXECUTE (rather than PGRST202 "not found"). `[ASSUMED]` | SC1 | Only affects a route-level test's expected status; the SQL gate asserts in-DB SQLSTATE and is unaffected. | Curl TEST's `/rest/v1/rpc/<fn>` with an `authenticated` JWT after the revoke. |
| **A6** | A grant-only DDL change reliably invalidates PostgREST's schema cache. `[ASSUMED]` | Runtime state | A stale cache would delay the effect on TEST/PROD by up to the reload interval. | If a stale-privilege symptom appears, `NOTIFY pgrst, 'reload schema'`. Not a correctness risk. |

---

## Open Questions (RESOLVED)

⚠️ **All five were decided at planning on 2026-08-13.** Nothing below is open. Each carries a
**DECIDED** line naming the plan that owns the decision; the *Recommendation* lines are kept as the
reasoning that produced it, not as a live question.

1. **One migration or two?**
   - Known: both merge orderings (deploy-first, migration-first) produce a total connect-a-key outage window.
   - Unclear: whether the founder accepts a short window in exchange for one file.
   - **Recommendation:** two migrations — *(i)* re-base bodies to accept `service_role` **and** grant it EXECUTE, keeping `authenticated`'s grant; ship the route swap; verify on PROD; *(ii)* a second migration withdrawing `authenticated`. Zero window. SC1's gate arms against (ii)'s marker. This is a planning decision, not a research finding.
   - ✅ **DECIDED — two migrations, and the split is hard.** Migration A (`156-03`) is additive:
     `GRANT EXECUTE … TO service_role` on both RPCs with `authenticated`'s grant **and** its
     `auth.uid()` ownership guard left standing, under a **branched** two-arm gate (D-156-1) —
     never a flat union. Migration B (`156-07`) withdraws `authenticated`. Between them sits
     `156-06`, a blocking live gate on PROD: rows 1–5 must read PASS in a real browser before
     Migration B is authored at all. Owners: `156-03`, `156-06`, `156-07`.

2. **Does the `venue_account_id` residual close here too?**
   - Known: 156 makes `p_venue_account_id` unreachable by a browser, which is half of its CR-01-class residual (`create-with-key:766-782`, `20260812083206:772-775`).
   - Unclear: whether the founder wants the *other* half (the value still has no in-database oracle) declared closed or restated.
   - **Recommendation:** restate precisely — "only the server can pass it" is now true; "the venue confirmed it" is still not. Do not silently upgrade the claim.
   - ✅ **DECIDED — RESTATED, not closed.** `venue_account_id`'s residual is **half**-closed: after
     156 only the server can pass it, and it still has no in-database oracle. `156-10` Task 1 writes
     exactly that and no more; `REQUIREMENTS.md:1381` already carries the restatement. ⛔ The claim
     is not upgraded to "the venue confirmed it". Owner: `156-10`.

3. **Should the `asset_class` stamp also move to `attestedVenue`?**
   - Known: `finalize-wizard:1275-1285` deliberately still reads the forgeable `apiKeyExchange` for the annualization stamp, calling the swap "a ONE-IDENTIFIER change" left for a follow-on because it needs its own oracle over √365 vs √252.
   - **Recommendation:** **out of scope.** Its own note says the swap needs an oracle this plan will not have. Log it; do not do it in passing (Rule 3).
   - ✅ **DECIDED — OUT OF SCOPE, logged to `TODOS.md`.** `156-05` Task 2 writes the entry naming
     `finalize-wizard/route.ts:1275-1285` and the reason: the swap needs its own oracle over √365
     vs √252 that this phase does not have. `156-05`'s acceptance asserts that file is
     **unmodified**. Owner: `156-05` Task 2.

4. **Should `add_wizard_composite_key` join `MUTATING_RPC_NAMES`?**
   - Known: `audit-coverage.test.ts:204-216` lists `create_wizard_strategy` but not the composite twin — a real audit-coverage gap.
   - **Recommendation:** log to `TODOS.md`. It is not this phase's charter and it would add an audit-emission obligation to a route this phase is already rewiring.
   - ✅ **DECIDED — LOGGED, not fixed.** `156-05` Task 2 writes the entry naming
     `src/__tests__/audit-coverage.test.ts:204-216`, and its acceptance asserts that file is
     **unmodified** by this phase. Owner: `156-05` Task 2.

5. **IN-04 — `service_role` in the scrub-trigger allowlist.**
   - Known: 153.6's review filed it as "a standing exemption with no current beneficiary". **Phase 156 does not become the beneficiary** — the RPCs run as their *owner* (`postgres`), not as `service_role`, so the exemption is still unused.
   - **Recommendation:** re-state IN-04's status accurately in the new migration's header (still unused; still pre-authorises the next server route that INSERTs from a request body). Do not remove `service_role` from the allowlist in this phase — the removal is a separate blast radius.
   - ✅ **DECIDED — RESTATED as STILL UNUSED; the allowlist entry stays.** `156-03` Task 1 §0(v)
     writes it into Migration A's header: these RPCs run as their **owner** (`postgres`), not as
     `service_role`, so the scrub trigger's `service_role` allowlist entry remains unused and this
     phase does not become its beneficiary. ⛔ No plan removes it. Owner: `156-03` Task 1.

---

## Sources

### Primary (HIGH confidence — read this session)
- `.planning/ROADMAP.md:526-549` — Phase 156 goal, 5 SCs, pull-forward trigger
- `.planning/REQUIREMENTS.md:885-895`, `:1281` — PARITY-04 + ledger row
- `.planning/STATE.md` — milestone v1.17 context
- `.planning/phases/153.6-…/153.6-REVIEW.md:99-231` — CR-01, both remedies verbatim
- `.planning/phases/153.6-…/153.6-07-SUMMARY.md` — why (b), residual risk, mutation-recut lessons
- `supabase/migrations/20260811210000_api_keys_attested_venue.sql` (950 lines) — column, scrub trigger, CHECK, post-verify (a)–(g)
- `supabase/migrations/20260812083206_api_keys_venue_account_id.sql` (1061 lines) — DROP+CREATE ACL hazard, current `create_wizard_strategy`
- `supabase/migrations/20260411103316`, `20260602190000`, `20260710180000` — original grants, `guard_wizard_draft_updates`
- `supabase/migrations/20260411144407_compute_jobs_queue.sql:280-480` — `_assert_owner` / `enqueue_compute_job` precedent (and Trap B's shape)
- `supabase/migrations/20260515113753_log_audit_event_service_hardened.sql` — **the service-role-only + explicit-uid + in-body-role-gate precedent**
- `supabase/schema/functions/{create_wizard_strategy,add_wizard_composite_key}.sql` — canonical re-base bodies
- `supabase/tests/test_api_keys_exchange_not_user_writable.sql` (424 lines) — assertions 1–5e
- `supabase/tests/{test_wizard_session_idempotency,test_wizard_composite_fence,test_api_keys_venue_identity_uniq,test_upsert_strategy_analytics_series_batch_privilege}.sql`
- `src/app/api/strategies/create-with-key/route.ts` (1100 lines), `src/app/api/strategies/composite/add-key/route.ts` (616), `src/app/api/keys/validate-and-encrypt/route.ts` (417), `src/app/api/strategies/finalize-wizard/route.ts:1195-1290`
- `src/lib/{closed-sets.ts,api/withAuth.ts,supabase/admin.ts}`; `src/__tests__/audit-coverage.test.ts:180-230`
- `.claude/agents/{migration-reviewer,rls-policy-auditor}.md` — invariants 1–21 / RLS + BYPASSRLS
- `docs/architecture/adr-{0001,0003,0022}` ; `CONTRIBUTING.md` §2
- `.github/workflows/{migration-drift-check.yml,ci.yml:833+}` — PR-Y2 remedy text, `sql-tests` gating
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (Next 16.2.11)

### Secondary (MEDIUM)
- Supabase RLS / JWT-claims docs and issue threads on `auth.uid()` NULL under non-user JWTs — consistent with, but not conclusive for, A1/A2. https://supabase.com/docs/guides/database/postgres/row-level-security ; https://github.com/supabase/supabase/issues/43066

### Not consulted
- Context7 MCP tools were unavailable in this environment and the `ctx7` CLI is not installed (`command -v ctx7` → not found). No auto-download was attempted. The Postgres/PostgREST facts relied on above are either read from this repo's own migrations or flagged in the Assumptions Log for a Wave-0 measurement.

---

## Metadata

**Confidence breakdown:**
- Codebase trace (routes, RPCs, ACLs, gates, pins): **HIGH** — every file:line above was opened this session.
- The SC2 correction (wizard does not use `/api/keys/validate-and-encrypt`): **HIGH** — confirmed from both directions (client callers and route bodies).
- The recommended privilege design (D1): **HIGH** on shape (it is `log_audit_event_service` applied to a second function), **MEDIUM** on the two Supabase runtime facts A1/A2 — closable with one Wave-0 probe.
- Deploy-order analysis: **HIGH** — derived from `CONTRIBUTING.md` §2's own statement that the merge is the apply with no ordering against the Vercel build.
- Gate-polarity inventory: **HIGH** for G1/G2/G5–G14 (read directly); **MEDIUM** for G3/G4 (depends on A3).

**Research date:** 2026-08-13
**Valid until:** ~2026-09-12 (30 days) — but **invalidated immediately** by any new migration touching `api_keys`, either wizard RPC, or `VENUE_CAPABILITIES`. Re-check `supabase/schema/functions/*.sql`'s `-- source migration:` headers before planning.
