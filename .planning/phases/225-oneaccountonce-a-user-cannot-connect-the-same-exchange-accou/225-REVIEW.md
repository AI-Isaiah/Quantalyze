---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
reviewed: 2026-11-23T20:09:40Z
depth: deep
files_reviewed: 30
files_reviewed_list:
  - supabase/migrations/20261123180000_api_keys_venue_server.sql
  - supabase/migrations/down/20261123180000-rollback.sql
  - supabase/migrations/20261123180100_swap_account_slot.sql
  - supabase/migrations/down/20261123180100-rollback.sql
  - supabase/schema/functions/create_wizard_strategy.sql
  - supabase/schema/functions/swap_account_slot.sql
  - supabase/tests/test_api_keys_exchange_not_user_writable.sql
  - supabase/tests/test_api_keys_venue_identity_uniq.sql
  - supabase/tests/test_swap_account_slot.sql
  - supabase/tests/test_wizard_composite_fence.sql
  - supabase/tests/test_wizard_session_idempotency.sql
  - docs/runbooks/oneaccountonce/README.md
  - docs/runbooks/oneaccountonce/census-dependents.sql
  - docs/runbooks/oneaccountonce/census-keys.sql
  - docs/runbooks/oneaccountonce/census-strategies.sql
  - docs/runbooks/oneaccountonce/census-triggers.sql
  - docs/runbooks/oneaccountonce/delete.sql
  - docs/runbooks/oneaccountonce/marker.sql
  - src/__tests__/oneaccountonce-delete-sql-exec.test.ts
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/lint-sql-gates.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - src/lib/account-share-note.test.ts
  - src/lib/database.types.ts
  - src/lib/sec-005-api-keys-projection.test.ts
  - scripts/mutation-floors.mjs
  - scripts/baseline-content-drift-check.mjs
  - scripts/dump-sql-functions.ts
  - analytics-service/tests/test_derive_allocator_equity_job.py
findings:
  critical: 0
  warning: 4
  info: 7
  total: 11
  necessity: 1
status: issues_found
---

# Phase 225: Code Review Report (PR-1, plans 01-04)

**Reviewed:** 2026-11-23T20:09:40Z
**Depth:** deep
**Files Reviewed:** 30
**Status:** issues_found
**Head SHA:** `6065311ee94f45f90bd66735cc86bd7d3ca6bcdd`
**Scope:** PR-1 (plans 01-04), `git diff $(git merge-base origin/main HEAD)..HEAD -- . ':!.planning'`

**Severity mapping used here:** CR = HIGH/CRITICAL (none found). WR = MEDIUM. IN = LOW/Info, which this repo does not fix. The one necessity-category item (WR-04) is a scope decision, not a defect fix (see `necessity-review.md`).

## Summary

The review covered both migrations, both rollbacks, the five SQL gates, the one-time delete runbook (record only), the exec test, the census moves and the D-18 parity twins. Each candidate was traced against the real marker trigger (`20260925120000`), the identity index, the api_keys grants and the PostgreSQL locking and subtransaction rules.

**Verified clean, so do not re-check:**
- The `create_wizard_strategy` re-base differs from the `20260814120000` body in exactly three places: the 13th parameter, the INSERT column and the INSERT value. Comment lines were stripped before diffing.
- The rollback of `20261123180000` restores a body byte-identical (ignoring whitespace) to the 12-parameter original. Both rollbacks carry catalogue-only precondition and verify blocks.
- The ACL pair is re-issued on the 13-type signature. The self-verify asserts one overload, SECDEF, service_role EXECUTE, and no anon, authenticated or PUBLIC EXECUTE.
- `venue_server` cannot be written from the browser. Table-level UPDATE (`20260810120000`) and INSERT (`20260823120000`) are revoked from `authenticated`, the column is not granted, and `6v-no-grant` pins it.
- No 12-type `create_wizard_strategy` pin remains outside `supabase/migrations` (`git grep` returned 0 hits).
- `npx vitest run src/lib/account-share-note.test.ts src/lib/sec-005-api-keys-projection.test.ts`: 36 passed.
- `npm run schema:functions:check`: `SQL function snapshot is current (137 functions)`.
- Locking between two swaps on the same pair (old holder H and new key N) is sound. FOR UPDATE with ORDER BY locks in sorted order. Under READ COMMITTED the second swap re-reads H after the first commits and refuses with `ACCOUNT_SLOT_IDENTITY_MISMATCH`.
- The marker trigger's FK `KEY SHARE` and `FOR SHARE` on the holder conflict with the swap's FOR UPDATE. A concurrent `composite_member` mark of H therefore cannot slip in between the composite check and step (c).

**What is wrong:** every finding is in `swap_account_slot` and its gate.
1. Two concurrent swaps on sibling duplicates of one failing holder can deadlock (WR-01).
2. A NULL caller server overwrites a captured server when the slot moves (WR-02).
3. Six of the thirteen refusal branches have no arm. One of them is the guard that stops step (d) from silently dropping an account the new key already holds (WR-03).
4. The gate's "both rows unchanged" half cannot fail (WR-04, necessity).

No finding reaches HIGH. Nothing here is a security hole: the ACL and the trigger's same-owner check both stop cross-tenant writes. The migrations auto-apply to PROD on merge, and PR-2 carries no migration (plan 04 objective: "The SQL surface is frozen here"). WR-01 to WR-03 are therefore cheapest to fix now. After merge, each one costs a new `CREATE OR REPLACE` migration.

No `.claude/skills` or `.agents/skills` directory exists in the worktree. `necessity-review.md` was read.

**Coverage note.** Every listed file was opened. The census-move files (`gate-family-meta`, `lint-sql-gates`, `mutation-annotation-parser`, `mutation-runner-floors`, `mutation-floors.mjs`, `dump-sql-functions.ts`, `baseline-content-drift-check.mjs`) were checked only for consistency of the moved numbers. The exec test was read for its header, fixture, run helpers and abort-measurement helper (`expectAbort` compares a full per-table state before and after); its individual arms were reviewed by name only. The `swap_account_slot` snapshot body is byte-equal to the migration body.

**Not run here:** the SQL lane, the mutation runner and the Python parity test. The plan SUMMARYs quote those runs (every new arm `RED (identity ok)`); this review did not reproduce them.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: Two swaps on sibling duplicates of one failing holder can deadlock, which contradicts the plan's concurrency must-have

**Severity:** MEDIUM (robustness: one caller gets a raw 40P01; no data corruption)
**File:** `supabase/migrations/20261123180100_swap_account_slot.sql:116-123` (lock set), `:240-245` (step (b))
**Issue:** Step 2 locks only the two named rows, in id order. Step (b) then UPDATEs every `duplicate` dependent of the old holder. Those rows were never locked, so their locks are taken outside the ordered set.

Take two working keys N1 and N2, both marked `duplicate` against the same failing holder H. This is the heal case that plan 09's poll will drive for each sibling. With N2 < H by id:
1. T1 = `swap(N1, H)` locks N1, then H.
2. T2 = `swap(N2, H)` locks N2, then blocks on H.
3. T1 reaches step (b), which must UPDATE N2 (`AND id <> p_new_key` keeps N2 in the set), and blocks on T2.
4. That is a lock cycle. PostgreSQL aborts one side with `40P01`.

The data stays consistent, because the survivor commits whole. But one caller gets a raw `40P01`, which is none of the seven tokens plan 09 maps (225-09-PLAN.md:72). That breaks the must-have "the row locks serialise two swaps or a swap and a stamp on the same rows" (225-04-PLAN.md must_haves) and the header's claim that row locks taken in id order "serialise two swaps" (`:13-16`).

The function also has no `SET lock_timeout`, unlike `create_wizard_strategy` (`SET lock_timeout = '3s'`). Its waits are bounded only by the caller's statement timeout.
**Fix:** Lock every row the body writes, in one id-ordered pass. Add the function-level lock timeout the sibling RPC carries:
```sql
CREATE FUNCTION public.swap_account_slot(...)
...
SET search_path = public, pg_catalog
SET lock_timeout = '3s'
AS $$
...
  -- lock the pair AND the old holder's dependents in one id-ordered pass
  PERFORM 1
     FROM public.api_keys
    WHERE id IN (p_new_key, p_old_holder)
       OR account_shared_with_api_key_id = p_old_holder
    ORDER BY id
      FOR UPDATE;
  -- then read the two named rows (already locked) into the locals as today
```
Add a gate arm only if the lane can drive two sessions. Otherwise record the trace above in the header in place of the current claim.

### WR-02: A NULL caller server overwrites a captured server when the slot moves, so the account's stored identity gets less precise

**Severity:** MEDIUM, latent (identity precision; reachable only through a NULL-server MT5 call, see below)
**File:** `supabase/migrations/20261123180100_swap_account_slot.sql:184` (wildcard check), `:254-258` (step (d))
**Issue:** The wildcard check admits `p_venue_server` NULL against an old holder whose `venue_server` is set. Step (d) then writes `venue_server = v_server`, which is NULL. The slot that was `(login, 'srv-x')` becomes `(login, NULL)`, and the old holder keeps `'srv-x'` beside a NULL login (`:248-252` clears only `venue_account_id`).

Plan 09 calls the function with `p_venue_server` "only when non-None" (225-09-PLAN.md:94), so a NULL server from the poll is a planned call shape. For MT5 it is reachable in two ways. First, plan 09 lands before plan 12 gives the stamper a server. Second, after plan 12 the server is `normalise_venue_server(getattr(exchange, "server", None))` (225-12-PLAN.md:101), which is None when the session carries no server. The connect routes always have one: the MT5 server is the non-blank `passphrase` slot (225-07-PLAN.md:69, 225-08-PLAN.md:94). So this is latent, not hot. If the orchestrator judges a server-less MT5 session impossible, downgrade it to LOW. Plan 10's index is `COALESCE(venue_server, '')`, and "a null server beside a set one is admitted" (225-10-PLAN.md:33). After this swap, the index alone no longer refuses a second same-owner key on `(login, 'srv-x')`, and the protection rests on the app fences. This is the opposite of CONTEXT Q2's "the half-done state errs toward refusing".

225-04-SUMMARY records "nothing is inherited from the old holder" as a decision. That decision does not cover this case, because here nothing is known about the new key's server and the old value is the only evidence there is.
**Fix:** Carry the captured server forward when the caller has none. Clear it from the demoted row so it no longer sits beside a NULL login:
```sql
  -- (c)
  UPDATE public.api_keys
     SET venue_account_id               = NULL,
         venue_server                   = NULL,
         account_shared_with_api_key_id = p_new_key,
         account_share_kind             = 'duplicate'
   WHERE id = p_old_holder;
  -- (d)
  UPDATE public.api_keys
     SET venue_account_id = v_login,
         venue_server     = COALESCE(v_server, v_old_server)
   WHERE id = p_new_key;
```
Add a `SWAP-server-inherit` arm: old holder `'syn-srv-i'`, caller NULL, and assert the new key stores `'syn-srv-i'`.

The alternative fix is to refuse a NULL caller server on `exchange = 'mt5'` when the holder's server is known. Pick one; do not leave the silent NULL.

### WR-03: Six refusal branches have no arm, including the guard that stops step (d) from silently dropping an account the new key already holds

**Severity:** MEDIUM (data-integrity guards with no test that can fail)
**File:** `supabase/tests/test_swap_account_slot.sql:12-15` (claim), migration `:104`, `:153`, `:171`, `:190`, `:196`, `:202`
**Issue:** The function has 13 `RAISE` sites. The gate exercises seven of them: owner, not-live, login, server, holder-working, new-failing and composite. The file header claims it pins "every refusal token with an unchanged two-row fingerprint". There is no arm for:
- `:104`: the same key on both sides, or a blank or NULL login (`IDENTITY_MISMATCH`);
- `:153`: `ACCOUNT_SLOT_NOT_FOUND`;
- `:171`: an exchange mismatch;
- `:190`: an old holder that is itself marked;
- `:196`: **a new key that already holds a login**;
- `:202`: a new key marked against a different holder.

Removing any of these goes unnoticed by the 13 twins, and three of them guard data integrity:
- Without `:196`, step (d) overwrites the new key's existing `venue_account_id`. The account it held is then held by nobody, and its `duplicate` dependents now resolve to a different account. Nothing errors.
- Without `:171`, an mt5 account's slot moves onto an okx key. The marker trigger does not compare exchanges (`20260925120000:217-262`), so nothing backstops it.
- Without `:202`, step (a) unmarks a key that was marked against a third key Y and drops that relationship.

This gate is a data-integrity gate in the repo's sense (it must be able to fail). The tokens are shared (`IDENTITY_MISMATCH` is raised from seven sites), so the existing login and server arms do not cover the others.
**Fix:** Add one arm per branch, each seeding its own keys and asserting the token (not the row fingerprint, which cannot fail, see WR-04), with an `IF false` twin. For example:
```sql
  -- SWAP-new-holds. RED-UNDER-M: {"arm":"SWAP-new-holds","apply":[{"kind":"edit","file":"supabase/migrations/20261123180100_swap_account_slot.sql","find":"IF v_new_login IS NOT NULL THEN","replace":"IF false THEN","occurrences":1}]}
  k_h := pg_temp.sw_key(uid_a, 'swap225-nh-a', NULL, 'error');
  k_n := pg_temp.sw_key(uid_a, 'swap225-nh-b', NULL, NULL);
  v_res := pg_temp.sw_try(k_n, k_h, 'swap225-nh-a', NULL);
  IF v_res IS DISTINCT FROM 'ACCOUNT_SLOT_IDENTITY_MISMATCH' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-new-holds): ...';
  END IF;
```
For the exchange arm, `sw_key` needs an exchange parameter. For `:202`, seed a third live holder Y and mark N against it. Move the census (`ARMS_FLOOR`, `stepsSeen`, `needles.length`, `totalAnchored`) by measurement, as plans 01 and 04 did. Alternatively, correct the header claim to name the seven branches it pins. The fix is still owed for `:196` and `:171`.

### WR-04: Already defended elsewhere — the "[ROWS CHANGED]" half of every refusal arm cannot fail

**Severity:** necessity (scope decision, no fix required)
**File:** `supabase/tests/test_swap_account_slot.sql:66-87` (`pg_temp.sw_try`), `:163-165`
**Category:** necessity
**Issue:** `sw_try` calls the swap inside `BEGIN ... EXCEPTION WHEN OTHERS ... END`. In PL/pgSQL that block is a subtransaction. When the call raises, every write the function made is rolled back before the handler runs. Every refusal path in the function is a `RAISE`. So whenever `v_err` is set, the fingerprint taken after the handler necessarily equals `v_before`, and `' [ROWS CHANGED]'` (`:83`) cannot be returned.

The "both rows unchanged" assertion that the header (`:12-15`) and every refusal arm cite is guaranteed by PostgreSQL, not tested. A refactor that wrote first and then raised would still pass it. The token half of each arm is sound.
**Fix:** Either drop the fingerprint and the claim, stating in the header that subtransaction rollback guarantees no write on a refusal, or make it bite. To make it bite, take the after-fingerprint inside the handler of a function that catches the raise without a subtransaction, which PL/pgSQL cannot do. In practice that leaves dropping it. This is a scope decision, not a defect: keep it if it is documentation, but do not cite it as a pinned property.

## Info

### IN-01: No in-body caller-role gate on a SECURITY DEFINER slot writer

**Severity:** LOW
**File:** `supabase/migrations/20261123180100_swap_account_slot.sql:74-78`
**Issue:** The function relies on the ACL alone. `20260814120000`'s header calls `create_wizard_strategy`'s in-body `auth.role()` gate "an ACTIVE control" against owner-role callers and against a future DROP+CREATE re-granting through `pg_default_acl`. Only about 12 of the 108 SECDEF snapshots carry that gate, so it is not a universal convention, and owner-role callers are superusers anyway. This is a defence-in-depth gap, not a vulnerability. The SECDEF itself is also not strictly needed: UPDATE has no scrub trigger, and service_role holds UPDATE on api_keys.
**Fix:** Optionally add the same fail-closed `auth.role() IS DISTINCT FROM 'service_role'` block `create_wizard_strategy` uses.

### IN-02: An over-long server raises a raw 23514, not a token

**Severity:** LOW
**File:** `supabase/migrations/20261123180100_swap_account_slot.sql:86`, `supabase/migrations/20261123180000_api_keys_venue_server.sql:193`
**Issue:** A server over 128 characters, after trim, reaches `api_keys_venue_server_valid` as a 23514. The `20260814120000` comment calls that error class one "the wizard route has no handler for". `btrim` also trims spaces only, so a trailing tab or newline survives as a distinct identity. The header acknowledges this.
**Fix:** Have the PR-2 routes and the poll normalise and cap the value before calling, or raise `ACCOUNT_SLOT_IDENTITY_MISMATCH` in the swap when `char_length(v_server) > 128`.

### IN-03: `venue_server` is "MT5 only" in prose but enforced nowhere

**Severity:** LOW
**File:** `supabase/migrations/20261123180000_api_keys_venue_server.sql:80-81` (COMMENT), `:193`; swap `:257`
**Issue:** Both writers store any non-blank server for any exchange. After plan 10, a stray server on an okx key would split that key's index entry.
**Fix:** Optionally add `CHECK (venue_server IS NULL OR exchange = 'mt5')`. Only a future migration can add it, and it is cheap while every row is NULL.

### IN-04: The README's discovery covers marker-marked duplicates only (record)

**Severity:** LOW
**File:** `docs/runbooks/oneaccountonce/delete.sql:90-94`, `census-keys.sql:1-11`
**Issue:** The discovery predicate is `account_share_kind = 'duplicate'` with a same-owner holder. A same-owner pair with equal identity where one row is disconnected and unmarked (the index is live-only, so the pair can exist) is not found. The founder confirmed the 13-key manifest, so the executed run is correct. The README does not say what "same-owner duplicate" was operationalised as.
**Fix:** Add one sentence to the README naming the predicate.

### IN-05: The protected-key fingerprint omits columns (record)

**Severity:** LOW
**File:** `docs/runbooks/oneaccountonce/delete.sql:120`, `:221`
**Issue:** The fingerprint covers `id, user_id, exchange, venue_account_id, disconnected_at, account_shared_with_api_key_id`. It does not cover `account_share_kind`, `sync_status` or `is_active`. Nothing in the delete path writes those on a protected key, so this is record-only.

### IN-06: The demoted holder keeps `venue_server` beside a NULL login

**Severity:** LOW
**File:** `supabase/migrations/20261123180100_swap_account_slot.sql:248-252`
**Issue:** This is intentional per 225-04-SUMMARY, but it leaves an identity fragment on a row that holds no account. The fix is folded into WR-02's suggestion.

### IN-07: The exec test is coupled to two moving sources

**Severity:** LOW
**File:** `src/__tests__/oneaccountonce-delete-sql-exec.test.ts:20-26`
**Issue:** The test pins a script that has already run. It cuts tables from `supabase/schema/baseline.sql` and loads the live `delete_allocator_api_key` body from `supabase/schema/functions`. A later re-base of either can turn this suite red for reasons unrelated to the executed run.
**Fix:** Optionally retire it, or freeze its inputs once the run's record is sealed.

---

_Reviewed: 2026-11-23T20:09:40Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Silent-failure hunter (round 1, 2026-11-23): MEDIUM findings merged in by the orchestrator

These overlap with the findings above:
- SF-M1 = WR-02 + IN-06
- SF-M2 = WR-04
- SF-M3 = WR-03

The new ones are SF-M4, SF-M5 and SF-M6.

- **SF-M4 (MEDIUM): normalisation is incomplete.**
  - Where: `20261123180100_swap_account_slot.sql:85-86`, and in `20261123180000_api_keys_venue_server.sql` the `api_keys_venue_server_valid` CHECK and the `create_wizard_strategy` stamp.
  - What is wrong: `btrim` strips spaces only, so a tab-only or newline-only server or login is stored as a real, non-wildcard identity. A server longer than 128 characters reaches step (d) of the swap and raises a raw 23514 instead of a token.
  - Fix: normalise with `btrim(x, E' \t\r\n')` in both functions and in the CHECK. In `swap_account_slot`, add a tokenised refusal for an over-length server before any write.
- **SF-M5 (MEDIUM): check H in `docs/runbooks/oneaccountonce/delete.sql` has no positive control.**
  - What is wrong: check H reads `pg_stat_xact_user_tables`. With `track_counts` off, every delta is 0 and the guard is vacuous.
  - Fix: before any write, RAISE unless `current_setting('track_counts') = 'on'`. After the writes, assert that the api_keys delete delta equals the manifest key count.
  - PROD record: `track_counts` was measured `on` on PROD on 2026-11-23, so the guard was live during the one PROD run.
- **SF-M6 (MEDIUM): several abort branches in `delete.sql` have no exec-test arm.**
  - Branches without an arm: the composite foreign key, the `v_fk_count = 0` vacuity guard, the `[G-write]` strategy row-count mismatch, the `[H-post-write]` protected-key-changed check, and the `[H-post-write]` manifest-still-exists check.
  - Fix: add arms in `src/__tests__/oneaccountonce-delete-sql-exec.test.ts` where a fixture can reach the branch. For a branch no fixture can reach, record why. Also state in the runbook README that the F scan covers declared foreign keys only.

### Orchestrator decision on WR-02 / SF-M1

Fix it.
- Step (d) stamps `venue_server = COALESCE(v_server, v_old_server)`.
- Step (c) also clears `venue_server` on the demoted holder.
- Add an arm in which the old holder has a server and the caller passes NULL.

The executor's "nothing is inherited" choice was an implementation detail, not a founder ruling. Keeping the captured server is the data-integrity-safe reading of Q2, where NULL is a wildcard and never erases a known server.
