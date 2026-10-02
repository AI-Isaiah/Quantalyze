# 154-03 Task 3 — TEST apply + reviewer checkpoint

**Run:** 2026-08-12, orchestrator session (Supabase MCP)
**Target:** TEST project `qmnijlgmdhviwzwfyzlc` — ⛔ **never PROD**, ⛔ **never `supabase db push`**
**Migration:** `supabase/migrations/20260812120000_api_keys_venue_account_id.sql`

---

## 1. Apply result

`apply_migration` → `{"success": true}`.

The migration's post-verify `DO $verify$` block aborts on any failed assertion, so a successful
apply already implies all of them held. **Verified independently anyway** — a success return is a
claim about the call, not about the end state:

| Assertion | Expected | Observed on TEST |
|---|---|---|
| `create_wizard_strategy` overloads | exactly 1 | **1** ✅ |
| function owner | in `{postgres, service_role, supabase_admin}` | **`postgres`** ✅ |
| `authenticated` EXECUTE | true | **true** ✅ |
| `anon` EXECUTE | **false** | **false** ✅ |
| index `indisunique` | true | **true** ✅ |
| index `indpred IS NOT NULL` (PARTIAL) | true | **true** ✅ |
| index definition | `(user_id, exchange, venue_account_id) WHERE (venue_account_id IS NOT NULL)` | **exact match** ✅ |
| scrub triggers on `api_keys` | 2 (new + pre-existing `attested_venue`) | **2** ✅ |
| `scrub_client_supplied_venue_account_id` `prosecdef` | **false** (INVOKER) | **false** ✅ |

### Why the owner check is the one that mattered

`DROP + CREATE` re-owns the function to whichever role applies the migration. Had that role fallen
outside the scrub allowlist, the failure mode would have been **silent and total**: both scrub
triggers would fire on the RPC's own INSERT, `attested_venue` **and** `venue_account_id` would land
NULL, every MT5 finalize would answer a permanent `KEY_SCOPE_CHECK_UNAVAILABLE`, and the migration
would still report success. Owner resolved to `postgres`, which is in the allowlist. ✅

Likewise `anon EXECUTE = false` is the one that proves the `REVOKE ALL … FROM PUBLIC, anon`
actually ran — `DROP` destroys the ACL and a fresh function grants EXECUTE to `PUBLIC` by default,
so its absence would have been a privilege escalation onto a SECURITY DEFINER function that writes
`api_keys` and `strategies`.

---

## 2. SQL gate

`supabase/tests/test_api_keys_venue_identity_uniq.sql` executed against TEST — **PASS**, no
exception raised (18 aborting assertions).

Note the gate resolves the trigger function through `pg_trigger.tgfoid` rather than by name, so a
same-named-but-unattached function cannot satisfy it.

---

## 3. Reviewer agents

`migration-reviewer` and `rls-policy-auditor` were spawned against the migration file. Findings are
recorded in the phase review trail.

---

## 4. ⚠️ OPEN — carried forward, not resolved here

### 4a. `src/lib/database.types.ts` is STALE — blocks 154-06

Confirmed: `grep -c venue_account_id src/lib/database.types.ts` → **0**. The file still describes
the 11-parameter RPC. Nothing breaks today (no TypeScript passes the new parameter), but **154-06
will not typecheck** the moment it sends `p_venue_account_id`.

Regeneration reads a live schema and needs a credential this session does not hold:
`npx supabase projects list` → `LegacyPlatformAuthRequiredError`, and `SUPABASE_ACCESS_TOKEN` is
unset. **Founder action required:**

```
! npx supabase login          # then:
! npx supabase gen types typescript --project-id qmnijlgmdhviwzwfyzlc > src/lib/database.types.ts
```

⛔ Do NOT hand-edit `database.types.ts` — its header forbids it and the next regeneration would
silently overwrite the edit.

**Sequence: TEST apply (done) → regenerate types → 154-06.**

### 4b. ⛔ DEPLOY ORDER — a merge-time hazard this file cannot enforce

From the migration header (:7-19). Merging to `main` fires the Supabase auto-apply **and** the
Vercel build with **no ordering between them**. Plan 154-06 makes
`/api/strategies/create-with-key` call the RPC with the 12th named parameter. If the Vercel
deployment wins the race, PostgREST resolves against the cached 11-parameter function, does not
find `p_venue_account_id`, and answers **PGRST202** — i.e. **every connect-a-key submit fails**, on
the wizard's only API path, for the length of the window.

**The migration must be live on PROD BEFORE the deployment that passes the parameter.** Apply to
PROD via MCP `apply_migration`, confirm green, and only then merge/promote. This ordering cannot be
enforced from inside the migration and must be honoured by whoever lands the PR.

### 4c. TEST/PROD migration-ledger drift

MCP `apply_migration` stamps the ledger with `now()`, not the filename's `20260812120000`. Known,
accepted for TEST, and consistent with prior phases.

---

## 5. AMENDMENT re-apply (after the reviewer HIGH findings)

`migration-reviewer` and `rls-policy-auditor` returned **3 HIGH / 4 MEDIUM / 1 LOW**. Two HIGHs
cleared the blocking bar (user-facing / data-integrity) and were fixed in `f35fafea`; the third is
a Phase 156 residual and was corrected in prose only.

| Finding | Disposition |
|---|---|
| **HIGH-1** partial UNIQUE was lifecycle-blind — a soft-disconnected row permanently squats the slot, so re-connecting the same MT5 login 23505s and "fails toward" a **dead** key the cron skips (silently never syncs) | **FIXED** — predicate now `venue_account_id IS NOT NULL AND disconnected_at IS NULL`. ⭐ Required `DROP INDEX` first: `CREATE UNIQUE INDEX IF NOT EXISTS` matches on **name only**, so a re-apply would have left the old predicate live with every assertion green. |
| **HIGH-2** `''` treated as a real identity → two different accounts collide → silent wrong-account attribution | **FIXED** — `api_keys_venue_account_id_nonblank CHECK (… btrim(…) <> '')` + RPC stamps `NULLIF(btrim(p_venue_account_id), '')` |
| **HIGH-3** (RLS) `authenticated` holds EXECUTE on the SECDEF RPC, which stamps the identity **verbatim from a caller-supplied parameter** — so a crafted client can still forge it via PostgREST and evade the dedup | **NOT FIXED HERE — by design.** This is the CR-01 class; the remedy (service-role writer + withdraw `authenticated` EXECUTE) is **Phase 156**. The column COMMENT and header were rewritten to stop claiming the value is unforgeable. |

Re-applied to TEST and verified independently:

| Property | Observed |
|---|---|
| index predicate | `((venue_account_id IS NOT NULL) AND (disconnected_at IS NULL))` ✅ |
| nonblank CHECK | `CHECK (((venue_account_id IS NULL) OR (btrim(venue_account_id) <> ''::text)))` ✅ |
| overloads | 1 ✅ |
| `anon` EXECUTE | false ✅ |
| scrub triggers | 2 ✅ |

### Residuals recorded, not fixed

- **Revoked keys deliberately do NOT free the slot.** `sync_status` is rewritten by the worker on
  every tick, so putting it in a UNIQUE predicate would let a routine background write raise 23505
  with no user watching. `'revoked'` is recoverable in place via `reconnect_allocator_api_key`.
- **New residual from HIGH-1:** clearing `disconnected_at` is now index-relevant, so
  disconnect A → connect same login as B → Reconnect A raises 23505. Judged acceptable: fail-loud
  on a deliberate click that already has a revert path, versus the silent never-syncs-again it
  replaces. Pinned by SQL-gate case 6c.
- The full amended file has **not** been re-applied end-to-end (the delta was). Full-file
  idempotency is exercised by CI's `sql-tests`.
- SQL gate section 6 (seeded behavioural cases) has **never executed** — first run is CI.
