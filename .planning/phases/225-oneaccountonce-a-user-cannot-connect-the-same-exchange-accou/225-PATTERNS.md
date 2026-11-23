# Phase 225: ONEACCOUNTONCE - Pattern Map

**Mapped:** 2026-11-23
**Files analyzed:** 22 new or modified (grouped below)
**Analogs found:** 21 / 22 (one partial: the swap function has no multi-row analog, only parts)

All analog paths below were checked with `git ls-files --error-unmatch` and are tracked source. None is a gitignored capability mirror. Line numbers are from the worktree at the time of mapping. Excerpts are trimmed; read the cited range for the full text. No identity values, ids or home paths appear in this file.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/<A>_api_keys_venue_server_swap_slot.sql` (column + CHECK + `create_wizard_strategy` 13th param + `swap_account_slot`) | migration | CRUD / transform | `20261117120000_mt5_server_clock_readings.sql` (style), `20260812083206_api_keys_venue_account_id.sql` (column + CHECK + DROP/CREATE RPC), `20261106120000_refusalrace_metadata_merge_rpcs.sql` (service_role-only SECDEF fn + ACL + catalogue verify) | role-match (3 donors) |
| `supabase/migrations/down/<A>-rollback.sql` | migration (rollback) | transform | `down/20261117120000-rollback.sql` | exact |
| `supabase/migrations/<B>_api_keys_venue_server_index.sql` (index rebuild + `reconnect_allocator_api_key` re-base) | migration | CRUD | `20260812083206` lines 463-467 (DROP INDEX + CREATE UNIQUE INDEX), `20260925120000` lines 674-746 (reconnect body) | exact |
| `supabase/migrations/down/<B>-rollback.sql` | migration (rollback) | transform | `down/20261117120000-rollback.sql` | role-match |
| `supabase/tests/test_api_keys_venue_identity_uniq.sql` (modify arm 2, signature pins, add behavioural arms) | test (SQL gate) | request-response | itself, sections 2 and 6 | exact (edit in place) |
| `supabase/tests/test_swap_account_slot.sql` (new) and column-CHECK arms (new file or arms) | test (SQL gate) | event-driven (trigger ordering) | `supabase/tests/test_api_keys_account_identity.sql` (ACCT-* arms, owner-context idiom) | exact |
| `src/app/api/strategies/create-with-key/route.ts` | controller | request-response | itself (`resolveByVenueIdentity`, `venueAlreadyConnectedResponse`, 23505 race arm) | exact (edit in place) |
| `src/app/api/keys/validate-and-encrypt/route.ts` | controller | request-response | itself (insert at 765-777, 23505 arm 796-817) | exact (edit in place) |
| `src/lib/wizardErrors.ts` (one new code, copy, `formatKeyError` arm) | model / config (copy table) | transform | `KEY_VENUE_ALREADY_CONNECTED` and `DRAFT_ALREADY_EXISTS` entries | exact |
| `src/lib/wizardKeyRosters.ts` | config (code roster) | transform | itself, `CREATE_WITH_KEY_OWN_CODES` | exact |
| `src/lib/account-share-note.ts` (+ `.test.ts`), only if OQ-1 option (a) is taken | utility | transform | itself, `isWorkingHolder` / `accountShareNote` | exact |
| `analytics-service/services/account_identity.py` | service | batch (daily poll) | itself (`_find_live_holder`, `_write_marker_and_audit`, `_mark_shared`, `_stamp`) | exact (edit in place) |
| `analytics-service/tests/test_account_identity_stamper.py` | test | request-response (fake Supabase) | itself, MT5 section (lines 1391-1560) | exact |
| `src/app/api/strategies/create-with-key/route.test.ts` (flip 5 arms, add arms) | test | request-response | itself, blocks at 1600-1760 and 2656-2740 | exact |
| `src/lib/wizardErrors.invariant.test.ts`, `wizardKeyRosters.test.ts`, `wizardErrors.roster-render.test.tsx` | test | transform | themselves (roster pins) | exact |
| `docs/runbooks/oneaccountonce/census.sql` + `delete.sql` (read-only census, single-transaction stop-on-difference delete) | utility (ops script) | batch | `docs/runbooks/marksource-okx-census/*.sql` (shape), `test_api_keys_account_identity.sql` ACCT-j (owner context) | role-match |
| `src/__tests__/oneaccountonce-delete-sql-exec.test.ts` (new) | test | batch | `src/__tests__/mt5-parity-capture-sql-exec.test.ts`, `marksource-okx-nonworking-keys-exec.test.ts` | exact |
| `src/lib/database.types.ts` | config (generated) | transform | its own `api_keys` Row/Insert/Update and `create_wizard_strategy` Args | exact |
| `supabase/schema/functions/*.sql` dumps | config (generated) | transform | `npm run schema:functions` output | exact |
| shared normalisation fixture (TS and Py both read) | test fixture | transform | none | NO ANALOG (see end) |

---

## Pattern Assignments

### Migration A: `<A>_api_keys_venue_server_swap_slot.sql` (migration, CRUD + transform)

Pick a timestamp after `20261120120000_auth_user_has_password.sql`, the latest in `supabase/migrations/`.

**Style conflict, resolved (Rule 7).** Older identity migrations (`20260812083206`, `20260925120000`, `20260927180000`) wrap the file in `BEGIN; ... COMMIT;`. The newest ones (`20261104120000`, `20261106120000`, `20261117120000`, `20261119120000`) carry NO explicit transaction and say why: `20261117120000` line 84, "NO explicit transaction statements (migration-reviewer invariant 14; Supabase wraps each migration). SET LOCAL lock_timeout applies to that wrap." Copy the NEW style. Flag the old one as legacy.

**Header + lock timeout** (`20261117120000_mt5_server_clock_readings.sql` 73-96):
```sql
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's catalogue and
-- none of its data, and a failed TEST apply blocks the PROD apply, so the verify block
-- below reads the catalogue only (to_regclass). It reads no table row.
...
-- Transaction style: NO explicit transaction statements (migration-reviewer
-- invariant 14; Supabase wraps each migration). SET LOCAL lock_timeout applies to
-- that wrap.
...
SET LOCAL lock_timeout = '3s';
```

**Column + named CHECK** (`20260812083206` 353-364 for the CHECK shape; `20260925120000` 107-130 for ADD COLUMN + named constraints, which the CONTEXT/RESEARCH F-4 CHECK mirrors):
```sql
ALTER TABLE public.api_keys
  ADD COLUMN account_shared_with_api_key_id uuid NULL,
  ADD COLUMN account_share_kind text NULL;

ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_account_share_kind_valid
    CHECK (account_share_kind IS NULL
           OR account_share_kind IN ('duplicate', 'composite_member'));
```
and the nonblank sibling to mirror for `venue_server` (`20260812083206` 353-364):
```sql
ADD CONSTRAINT api_keys_venue_account_id_nonblank
  CHECK (venue_account_id IS NULL OR btrim(venue_account_id) <> '');
```
New: `api_keys_venue_server_valid CHECK (venue_server IS NULL OR (btrim(venue_server) <> '' AND char_length(venue_server) <= 128))`. Add the column with `ADD COLUMN venue_server text NULL` (NULL on every existing row, so the CHECK is trivially valid; assert `convalidated` in the gate, as the donor does).
Do NOT GRANT SELECT on it to `authenticated` and do not add it to `API_KEY_USER_COLUMNS_ARR` (RESEARCH F-4). Contrast: `20260925120000` 748-750 DID grant SELECT for its marker columns; that is the opposite decision.

**Replace the 12-parameter RPC: DROP then CREATE, re-issue ACL pair in the same file.** Donor DROP (`20260812083206` 596-625):
```sql
DROP FUNCTION IF EXISTS public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid
);

CREATE OR REPLACE FUNCTION create_wizard_strategy(
  p_user_id UUID,
  ...
  p_wizard_session_id UUID,
  p_venue_account_id TEXT DEFAULT NULL
)
RETURNS TABLE(strategy_id UUID, api_key_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET lock_timeout = '3s'
```
For this phase: `DROP FUNCTION public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)` (12 params), then `CREATE FUNCTION` with `p_venue_server TEXT DEFAULT NULL` as the 13th, writing `NULLIF(lower(btrim(p_venue_server)), '')` in the same INSERT that writes `venue_account_id`. Re-base the BODY on `supabase/schema/functions/create_wizard_strategy.sql` (source migration `20260814120000_wizard_rpcs_revoke_authenticated.sql`): keep the `auth.role() = 'service_role'` gate, the `wizdraft:` advisory lock, the `attested_venue` stamp and `NULLIF(btrim(p_venue_account_id), '')`. Read that file in full before writing.

**ACL pair re-issued (a DROP re-grants anon/authenticated through default ACL)** (`20260814120000` 439-450, and the 12-arg form):
```sql
REVOKE ALL ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
) TO service_role;
```
New signature has 13 types (add a trailing `text`). Also re-issue `COMMENT ON FUNCTION` (the DROP destroys it).

**`swap_account_slot(p_new_key uuid, p_old_holder uuid)` (service_role-only SECDEF)**. Closest donor for the ACL + catalogue-verify shape is `20261106120000_refusalrace_metadata_merge_rpcs.sql`:
```sql
CREATE FUNCTION public.mark_compute_job_kept_figures(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
...
REVOKE ALL ON FUNCTION public.mark_compute_job_kept_figures(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_compute_job_kept_figures(uuid) TO service_role;
```
Plain `CREATE FUNCTION` (not OR REPLACE) for a new name, so a collision fails loud (that file, lines 55-56). Raise stable token messages in the trigger's style (`20260925120000` 223-262):
```sql
RAISE EXCEPTION 'ACCOUNT_SHARE_HOLDER_NOT_SAME_OWNER'
  USING ERRCODE = '42501',
        DETAIL  = 'api_keys.account_shared_with_api_key_id must name a key of the same user_id.';
```
Row locking donor: `20260927180000` ~line 160 (`... FOR UPDATE;` on the key row, then the owner check). Lock BOTH rows in `id` order (RESEARCH pattern). The D-18 tuple inside the function must be the same text the parity tests regex (`20260927180000` 183-184):
```sql
IF v_is_active AND v_disconnected IS NULL
   AND (v_sync_status IS NULL OR v_sync_status NOT IN ('revoked', 'sign_in_failed', 'error')) THEN
```
The write order inside the function is fixed by the marker trigger (`20260925120000` 229-262: not found, not same owner, not live, holder is marked, key is already a holder). Use the six-step order in RESEARCH "Pattern: one shared swap function": clear the new key's own marker, re-point dependents of the old holder, then in ONE UPDATE set `venue_account_id = NULL` + holder + `'duplicate'` on the old holder, then stamp the new key.

**Self-verify: CATALOGUE ONLY** (`20261106120000` 158-202, `20261117120000` 265-294). Copy the `DO $$ ... pg_proc / prosecdef / proconfig / has_function_privilege / aclexplode` loop:
```sql
IF NOT COALESCE((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn_oid), false) THEN ...
IF NOT has_function_privilege('service_role', v_fn_oid, 'EXECUTE') THEN ...
IF has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN ...
IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
            WHERE p.oid = v_fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN ...
```
Add: exactly ONE `create_wizard_strategy` overload (the donor gate arm 3 asserts the same). ⛔ No row-reading `DO` guard: `scripts/lint-migration-data-dependence.mjs` scans `supabase/migrations/` only and refuses one. ⚠️ Do NOT assert the CHECK body, grants or trigger body in the verify: `20261117120000` 265-271 explains a verify that checks what the gate mutates aborts the mutated apply and the arm can never bite.

**Rollback file** (`down/20261117120000-rollback.sql`): copy the header (manual, `psql --single-transaction`, marker query first), the catalogue-only `$precondition$` block (lines 63-76) and `$verify$` block (114-138). The keep-data rule applies: that donor RENAMES aside and never drops a table. For a column, rename aside rather than DROP, or state the decision in the header.

---

### Migration B: `<B>_api_keys_venue_server_index.sql` (migration, CRUD)

Ships only after the PROD census gate (RESEARCH F-7 / OQ-3). Carries the index rebuild and the re-based `reconnect_allocator_api_key`.

**Index rebuild under the SAME name** (`20260812083206` 463-467; keep the DROP-before-CREATE rationale at 449-462, since `CREATE UNIQUE INDEX IF NOT EXISTS` matches on name only):
```sql
DROP INDEX IF EXISTS public.api_keys_user_exchange_venue_account_uniq;

CREATE UNIQUE INDEX api_keys_user_exchange_venue_account_uniq
  ON public.api_keys (user_id, exchange, venue_account_id)
  WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL;
```
New: `ON public.api_keys (user_id, exchange, venue_account_id, (COALESCE(venue_server, '')))` with the SAME partial predicate (both conjuncts). `user_id` stays first (C-08, comment at 484-486 of that file). The DROP destroys the `COMMENT ON INDEX`; re-stamp it (donor 469-494) with a new forward-correcting sentence, never an edit to the applied file.

**Reconnect re-base**: re-base on the LATEST body (`20260925120000` 674-746, also `supabase/schema/functions/reconnect_allocator_api_key.sql`). Only the EXISTS changes (lines 713-721) so a different-server key may reconnect; NULL server on either side is a wildcard:
```sql
IF v_venue_acct IS NOT NULL AND EXISTS (
  SELECT 1
    FROM api_keys s
   WHERE s.user_id = v_uid
     AND s.exchange = v_exchange
     AND s.venue_account_id = v_venue_acct
     AND s.disconnected_at IS NULL
     AND s.id <> p_api_key_id
) THEN
  RAISE EXCEPTION 'KEY_VENUE_ALREADY_CONNECTED'
    USING ERRCODE = 'unique_violation',
          DETAIL  = 'Another connected key of this user already reads the same exchange account.';
END IF;
```
`CREATE OR REPLACE` is fine here (signature `(uuid)` unchanged). Re-issue the ACL anyway, matching the donor (745-746: `REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;`). Add to the verify the `position('KEY_VENUE_ALREADY_CONNECTED' IN prosrc)` catalogue check (donor 941-947 equivalent).

---

### `supabase/tests/test_api_keys_venue_identity_uniq.sql` (SQL gate, modify)

**Analog:** itself. Three edits.

1. **Arm 2 is vacuously GREEN after migration B** (RESEARCH F-3, probed). The existing column-list query (lines 154-164) joins `unnest(i.indkey)` to `pg_attribute`; an expression member has attnum 0 and drops out of the join:
```sql
SELECT array_agg(a.attname ORDER BY k.ord) INTO v_idx_cols
  FROM pg_index i ... JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
IF v_idx_cols IS DISTINCT FROM ARRAY['user_id', 'exchange', 'venue_account_id']::TEXT[] THEN
```
Keep it, and ADD `i.indnkeyatts = 4` plus `pg_get_expr(i.indexprs, i.indrelid) ILIKE '%venue_server%'`. Its twin must recreate the OLD login-only index with a live `sql` step. Existing twin shape (line 131): `-- RED-UNDER-M: {"arm":"2","apply":[{"kind":"sql","stmt":"DROP INDEX public.api_keys_user_exchange_venue_account_uniq"}]}`.

2. **Signature pins move with the 13-parameter RPC**: line 72-73 (`c_sig CONSTANT TEXT := 'create_wizard_strategy(uuid,text,...,uuid,text)'`) and the arm 4 twin at line 481 (`GRANT EXECUTE ON FUNCTION public.create_wizard_strategy(<12 types>) TO authenticated`). Add the 13th `text`.

3. **New behavioural arms in section 6** (block 594-785). Use the exact shape of 6a (lines 647-656) and 6e (726-731): a nested `BEGIN ... EXCEPTION WHEN unique_violation` block where the "ADMITTED" RAISE carries a SQLSTATE that the handler cannot swallow:
```sql
BEGIN
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id)
  VALUES (uid_a, 'mt5', 'wizcont02 dup', 'enc', true, c_login);
  RAISE EXCEPTION 'TEST FAILED (6a): a SECOND LIVE api_keys row ... was ADMITTED ...';
EXCEPTION WHEN unique_violation THEN
  NULL;  -- expected
END;
```
New arms to add (names are the planner's): same owner + login + two DIFFERENT servers both insert; same owner + login + same server refused 23505; NULL vs NULL refused; NULL vs 'a' ADMITTED by the index (this pins F-3 so nobody assumes the index is the wildcard); two owners, same login and server, both insert (the ONCE-02 pin, donor 6e).

Every arm gets the prose `RED-UNDER:` plus an adjacent `RED-UNDER-M:` line (GRAMMAR rule 1: the marker must be at comment-line start). Use `{"kind":"sql","stmt":"..."}` steps for live-object drift (donor line 637, 725, 746). Use `{"kind":"edit","file":...,"find":...,"replace":...,"occurrences":N}` only for migration text, with `occurrences` MEASURED (GRAMMAR rule 2). A mutation may not inject or rewrite a `TEST FAILED (` literal (GRAMMAR rule 3).

**`RED-UNDER-SETUP` (line 68)**: append migrations A and B (and anything they depend on) to the `apply` JSON list, and to EVERY other gate whose behaviour reads the new column or function. A migration no gate lists forces a FULL mutation run on push to main.

**Shared-DB hygiene to copy** (lines 583-592, 596-621): per-run unique email via `gen_random_uuid()`, age-scoped reap of crashed-run users, explicit cleanup in FK order at the end (779-782). Behavioural section inserts as `postgres`/`service_role` only because `api_keys_scrub_venue_account_id` NULLs the identity for any other `current_user` (arm 6.0, 623-645). Reuse that precondition arm.

---

### `supabase/tests/test_swap_account_slot.sql` (new SQL gate, event-driven)

**Analog:** `supabase/tests/test_api_keys_account_identity.sql`. Read its `RED-UNDER-SETUP` line 65 IN FULL (it is a long apply list: fixtures 01, 15, 02, 03, 05, 07, 11, 20, 21, 24, 36, 04, plus 17 migrations through `20260925120000`). The swap gate needs the same set plus migration A, and `20260927180000` if it asserts D-18.

**Arm naming and twin shape** (`ACCT-*`, lines 80-110): header comment, `RED-UNDER:` prose, `RED-UNDER-M:` edit twin against the migration text with `occurrences`:
```sql
-- RED-UNDER-M: {"arm":"ACCT-h","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF NEW.account_shared_with_api_key_id IS NULL THEN","replace":"  IF NEW.account_shared_with_api_key_id IS NULL AND TG_OP = 'UPDATE' THEN","occurrences":1}]}
```
For the swap function the research names the neuters: drop the dependents re-point UPDATE (expect `ACCOUNT_SHARE_KEY_IS_A_HOLDER`), drop the marker clear (expect `ACCOUNT_SHARE_HOLDER_IS_MARKED`). Write the twin `find` against migration A's text.

**Owner-context call idiom** (ACCT-j, lines 366-390). The claims GUC below is the idiom for `delete_allocator_api_key` (checks `auth.uid()`). `swap_account_slot` checks no `auth.uid()`; the gate runs as the privileged role, so call it directly and test the ACL with `has_function_privilege`:
```sql
PERFORM set_config('request.jwt.claims',
  json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
v_err := NULL;
BEGIN
  PERFORM public.delete_allocator_api_key(k_h, false);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_con = CONSTRAINT_NAME;
END;
PERFORM set_config('request.jwt.claims', '', true);
```
Arms to cover (from RESEARCH validation map): new key marked, holder with dependents, wrong owner (an other-owner decoy), working holder (expect refusal), composite pair, ACL (`anon`/`authenticated` hold no EXECUTE, `service_role` does), exchange mismatch, new key not working.

⚠️ Census impact: a new `supabase/tests` file or arm moves several censuses (`scripts/mutation-floors.mjs` symbols read BY SYMBOL, `src/__tests__/mutation-runner-floors.test.ts`, `docs/sql-gate-lineage.md`). Grep them all in the same commit; never restate a floor number.

---

### `src/app/api/strategies/create-with-key/route.ts` (controller, request-response, modify in place)

**Analog:** the file itself. Five sites. Line numbers verified at mapping time.

**(1) Resolver union and resolver** (lines 197-270). Today:
```ts
type VenueIdentityResolution =
  | { kind: "unresolved" }
  | { kind: "draft"; strategy_id: string; api_key_id: string }
  | { kind: "connected"; strategyName: string | null }
  | { kind: "held" }
  | { kind: "orphaned" };
...
const { data: liveKey, error: liveKeyErr } = await admin
  .from("api_keys")
  .select("id")
  .eq("user_id", userId)
  .eq("exchange", exchangeNormalized)
  .eq("venue_account_id", venueAccountId)
  .is("disconnected_at", null)
  .maybeSingle();
```
Change: also select `is_active, sync_status, disconnected_at, venue_server`; filter the wildcard server rule IN CODE (never an `.or(...)` string, RESEARCH anti-pattern; the server is user-controlled text); drop `.maybeSingle()` (two live rows can match under NULL-as-wildcard) and take the first. Add a `failing_holder` member decided FIRST, using `isWorkingHolder` from `src/lib/account-share-note.ts` (never a fifth copy of the D-18 tuple). Keep `.eq("user_id", userId)` (the cross-owner scoping; ONCE-02). Keep the fail-soft posture and the scrubbed log:
```ts
console.error(
  "[strategies/create-with-key] venue-identity fence SELECT failed; proceeding to RPC (DB index still dedups):",
  scrubSeamError(liveKeyErr, secrets),
  liveKeyErr.code,
);
```
Add the server to the `secrets` array wherever `venueAccountId` is already listed (lines 1278, 1604, 1634).

⚠️ **Test mock hazard.** `route.test.ts` `makeSelectBuilder` (lines 400-445) only terminates on `.maybeSingle()` and returns `venueKeyLookupMock(filters)` for any `api_keys` read without an `id` filter. A resolver that stops using `.maybeSingle()`, or that returns multiple rows, needs the mock's terminal changed in the same commit. Plan this before the route edit.

**(2) The ONE refusal-body builder** (lines 477-507). A new draft refusal must be a function of this shape, taking the draft's placeholder name only, called from BOTH emitting sites (TWIN-8 rule at 461-467):
```ts
function venueAlreadyConnectedResponse(strategyName: string | null): NextResponse {
  return NextResponse.json(
    {
      code: "VENUE_ALREADY_CONNECTED",
      error: "This account is already connected to an existing strategy.",
      ...(strategyName === null ? {} : { strategy_name: strategyName }),
    },
    { status: 409, headers: NO_STORE_HEADERS },
  );
}
```
`code` FIRST as a literal (the invariant scanner reads it, `wizardErrors.invariant.test.ts`). `strategy_name` is OMITTED, not nulled, when there is no name. The venue account id is not a parameter, which is the structural reason it cannot leak. For the draft arm the resolver's `draft` member must carry the draft's name (today it carries only `strategy_id` and `api_key_id`).

**(3) The two `deduped` arms to rewrite as the named 409.** D2 (lines 1280-1300, pre-validation, MT5) and D3 (lines 1637-1647, race arm). Both currently:
```ts
if (venueMatch.kind === "draft") {
  return NextResponse.json(
    { ok: true, strategy_id: venueMatch.strategy_id, api_key_id: venueMatch.api_key_id, deduped: true },
    { headers: NO_STORE_HEADERS },
  );
}
```
Both call the new builder. KEEP D1 (lines 1203-1217, same-session resume: D-23's explicit carve-out) and D4 (reuse arm, lines 716-729, `held.kind === "draft"`, RESEARCH A3 says keep; confirm at plan time). The other arms (`connected` 1301-1317, `orphaned` 1318-1324, race `held` 1661-1678, race `orphaned` 1679-1714) are the pattern for how a refusal short-circuits BEFORE the charged `validateKey` call.

**(4) Write the server at connect.** The RPC call (lines 1537-1588) omits rather than nulls an absent identity so the wire stays additive:
```ts
...(venueAccountId === null ? {} : { p_venue_account_id: venueAccountId }),
```
Copy exactly for `p_venue_server`, sourced from `passphrase.trim().toLowerCase()` for MT5 (RESEARCH F-4; the MT5 passphrase is already required non-blank at lines 1052-1063). ⚠️ Deploy order: migration A must be applied on PROD before this PR merges, or every connect answers PGRST202 (comment at 1575-1580 records the hazard).

**(5) Failing-holder admit path.** After the INSERT the route must call `swap_account_slot` through the service-role client. Place it where the success arm builds its response; reuse the existing `rpcAdmin` client. 23505 race arm structure (1608-1722) is the template for the "index refused, re-run resolver" fallback. A swap that fails midway leaves the new key unstamped; the stamper's next poll heals it, so log at ERROR and still answer success.

**Error scrubbing and logging rule (all five sites):** `pgConstraintName(error)` reads `message` only, never `details` (the DETAIL echoes the identity). The index name must not change (`VENUE_IDENTITY_CONSTRAINT`, `src/lib/api/pgConstraintName.ts` 65-66).

---

### `src/app/api/keys/validate-and-encrypt/route.ts` (controller, request-response, modify in place)

**Analog:** the file itself. Direct insert, no RPC, no draft concept.

**Insert row** (lines 749-777): add `venue_server` in the same object, beside `venue_account_id`. The admin client here is deliberately untyped, so `tsc` will NOT catch a typo in the key name: unit-test the object.
```ts
const isMt5 = exchangeNormalized === "mt5";
const venueAccountId = isMt5 ? api_key.trim() : (validation.venue_account_id ?? null);
...
.insert({
  ...encryptedColumns,
  user_id: userId,
  exchange: exchangeNormalized,
  attested_venue: exchangeNormalized,
  label: labelOrDefault,
  venue_account_id: venueAccountId,
})
```
**23505 arm already answers the named refusal** (lines 796-817) and stays the answer for the working-holder case:
```ts
if (insertError?.code === "23505" && pgConstraintName(insertError) === VENUE_IDENTITY_CONSTRAINT) {
  console.error("[keys/validate-and-encrypt] persist INSERT failed — venue-identity collision:",
    { correlationId },
    scrubSeamError(insertError, [api_key, api_secret, passphrase, venueAccountId]));
  return NextResponse.json({ code: "KEY_VENUE_ALREADY_CONNECTED", error: "...", }, { status: 409, headers: NO_STORE_HEADERS });
}
```
Add the normalised server to both `scrubSeamError` secret lists (lines 807 and 826). Failing-holder admit: pre-check holder health (same resolver-style read, owner-scoped), then INSERT with identity NULL and call `swap_account_slot` (service role).

---

### `src/lib/wizardErrors.ts` (config/model, copy table; add one code)

**Analog:** `KEY_VENUE_ALREADY_CONNECTED` for the copy shape; `DRAFT_ALREADY_EXISTS` for the actions (CONTEXT says "finish or delete it first", which maps to `resume_draft` + `start_fresh`).

**Union member** (line 507, with a docblock above it at 460-506 recording the emitter, why it is non-recoverable and why an existing code could not be reused). Copy that docblock discipline: name the emitter, state what the copy may claim, state what it may not.

**Copy-table entry** (lines 2877-2894):
```ts
KEY_VENUE_ALREADY_CONNECTED: {
  title: "This exchange account is already connected on your account.",
  cause:
    "The key you just entered reads an exchange account that another of your connected keys already reads, and one account can back only one connected key at a time. Your new key was not saved.",
  fix: [
    "Use the key you already have for this account instead of adding a new one.",
    "To connect a different account, create a key on that account (a separate exchange account or sub-account) and add it.",
    "If you believe this account should be free to connect fresh, send the correlation id below through the contact form before disconnecting anything — the existing key keeps working until you do.",
  ],
  docsHref: "/security",
  actions: ["request_call", "expand_log"],
},
```
and the actions line to reuse for the draft case (`DRAFT_ALREADY_EXISTS`, lines 2499-2528):
```ts
actions: ["resume_draft", "start_fresh"],
```
`fixRequires` arrays (`NOT_ON_PRESELECT_SURFACE`, `REQUIRES_PRESELECT_SURFACE`, `null`) must be authored; `VENUE_ALREADY_CONNECTED` (2595-2625) shows a surface-gated bullet. Do not add `clear_and_retry` (it renders a Retry on the credential surface).

**`formatKeyError` naming arm** (lines 4825-4836). Code-gated, prepended, degrades to the unnamed copy when no name:
```ts
if (
  code === "VENUE_ALREADY_CONNECTED" &&
  context?.strategyName !== undefined &&
  context.strategyName.trim().length > 0
) {
  return { ...base, cause: `It is connected to "${context.strategyName.trim()}". ` + base.cause };
}
```
The CONTEXT decision names the refusal by "exchange plus nickname"; `WizardErrorContext.strategyName` (4672-4690) is the existing wire field. The exchange comes from `context.venue`. Do not add the venue account id to the context.

**Roster pins that move with ONE new code** (all in one commit, per RESEARCH):
- `src/lib/wizardKeyRosters.ts` lines 108-125, `CREATE_WITH_KEY_OWN_CODES` (add the code beside `"KEY_ORPHANED"`). `ADD_KEY_OWN_CODES` (131-143) does NOT get it: composite is out of scope.
- `src/lib/wizardErrors.invariant.test.ts` `codes409` in `CASES` (around 2196-2200) and `EXPECTED_409_CODES` (2336-2343), a hand-typed sorted list.
- `src/lib/wizardKeyRosters.test.ts` (around 52, 159-160) and `src/lib/wizardErrors.roster-render.test.tsx` (around 430, 1038).
- The symbol `EXPECTED_TABLE_SIZE` cited in route comments does not exist as code (RESEARCH). Do not search for it as a pin.

---

### `src/lib/account-share-note.ts` (+ test), only if OQ-1 option (a)

**Analog:** itself (lines 71-86):
```ts
export const NOT_WORKING_SYNC_STATUSES: ReadonlySet<string> = new Set(["revoked", "sign_in_failed", "error"]);
export function isWorkingHolder(
  holder: Pick<AccountShareNoteKey, "is_active" | "disconnected_at" | "sync_status">,
): boolean {
  return (
    holder.is_active === true &&
    holder.disconnected_at === null &&
    (holder.sync_status === null || !NOT_WORKING_SYNC_STATUSES.has(holder.sync_status))
  );
}
```
Import this in the route resolver; do not restate. The D-18 parity test reads migration text with an anchored regex (`src/lib/account-share-note.test.ts` 160-180): `v_sync_status\s+NOT\s+IN\s*\(([^)]*)\)` and asserts `exactly one` match per file. The swap function's local variable MUST be named `v_sync_status` for its tuple to be picked up, and the file list in the `it.each` must gain migration A or the new function dump. Mind the "exactly one" assertion: a function body with two `v_sync_status NOT IN` tuples fails it.

---

### `analytics-service/services/account_identity.py` (service, batch, modify in place)

**Analog:** itself. Imports (lines 50-60): `asyncio`, `logging`, `Mapping`, `datetime`, `typing`, `ccxt`, `httpx`, `APIError`. Add `from services.allocator_equity_derive import working_holder_predicate` (RESEARCH: imports `stitch_composite` only, no cycle; verify with mypy).

**Holder lookup to rework** (lines 246-268):
```python
async def _find_live_holder(
    supabase: Any, key_row: Mapping[str, Any], account_id: str
) -> dict[str, Any] | None:
    def _q() -> object:
        return (
            supabase.table("api_keys")
            .select("id")
            .eq("user_id", key_row["user_id"])
            .eq("exchange", key_row["exchange"])
            .eq("venue_account_id", account_id)
            .is_("disconnected_at", "null")
            .neq("id", key_row["id"])
            .limit(1)
            .execute()
        )
    return _first_row(await db_execute(_q))
```
Keep `user_id` and `exchange` filters (T-167.1.2-18: a holder is never another tenant's key). Widen the select to `id, venue_server, is_active, sync_status, disconnected_at, account_shared_with_api_key_id`, drop `.limit(1)`, filter the server wildcard in Python with one pure function (never an `.or_` string).

**Marker + audit as ONE thread task** (lines 385-435): the swap path must reuse this shape. A cancellation of `asyncio.wait_for` cannot split a synchronous callable, so the audit and the recompose enqueue follow the write in the same thread:
```python
res = supabase.table("api_keys").update({...}).eq("id", key_row["id"]).execute()
if _first_row(res) is None:
    return False
if kind == _DUPLICATE:
    _audit_duplicate(key_row, holder_id)
try:
    supabase.rpc("enqueue_compute_job", {"p_strategy_id": None, "p_allocator_id": str(key_row["user_id"]), "p_kind": "derive_allocator_equity"}).execute()
except Exception as exc:  # noqa: BLE001 — the marker stands; the drop is logged
    logger.error("account_identity: recompose enqueue after a new marker failed for api_key %s: class=%s code=%s", key_row.get("id"), type(exc).__name__, _error_code(exc))
```
The swap path calls `supabase.rpc("swap_account_slot", {"p_new_key": ..., "p_old_holder": ...})`, then audits the OLD holder via `_audit_duplicate(<old holder row>, <new key id>)` and enqueues the recompose the same way.

**`_stamp` ordering** (lines 472-531). Today the stamp UPDATE runs FIRST and the holder is looked up only AFTER a 23505 (lines 517-527). Under the new index a NULL-server legacy holder no longer collides (F-3), so for MT5 the wildcard holder lookup must run BEFORE the UPDATE. ccxt keeps its after-23505 path. The early return `if key_row.get("venue_account_id") is not None: return "skipped_already_stamped"` (488-489) is where the server backfill must branch in first (stamped MT5 key with NULL `venue_server` writes it once, guarded `.is_("venue_server","null")` like the existing `.is_("venue_account_id","null")` guard at 513).

**Outcome tokens** (lines 183-192): add to the `StampOutcome` Literal (mypy strict; used only in this module and its tests):
```python
StampOutcome = Literal["skipped_not_ccxt", "skipped_already_stamped", "skipped_no_budget", "stamped",
    "marked_duplicate", "marked_composite_member", "no_id", "error"]
```
**Logging rule** (module docstring 33-35, `_safe_message` 327-349): log key id, venue and outcome token only. Never the account id or the server. Only an `APIError.message` is ever read; never `details` or `str(exc)`.

**Write-set contract** (test file lines 38-42): the stamp may write ONLY `venue_account_id`, `account_shared_with_api_key_id`, `account_share_kind`. `venue_server` joins that set deliberately; update `ALLOWED_WRITE_COLUMNS` in the test AND the module docstring/comment at 164-170 in the same commit.

---

### `analytics-service/tests/test_account_identity_stamper.py` (test, modify in place)

**Analog:** itself, MT5 section (lines 1391-1560). Fakes only, no database. Copy these fixtures and the arm shape.

**Harness** (lines 53-135): `_Call` / `_Query` / `FakeSupabase`. `rpc_calls` records `(name, params)` and `rpc_error` forces a failure; a swap assertion reads `sb.rpc_calls`. `_Query.select` IGNORES its column argument, so holder rows in a responder must carry the new columns (`is_active`, `sync_status`, `disconnected_at`, `venue_server`).

⚠️ `_collision_responder` (lines 168-182) and `_mt5_collision_responder` return `MagicMock(data=[{"id": holder_id}])` only. Once `_find_live_holders` applies `working_holder_predicate` to the row, a row without those keys changes behaviour. Decide in the plan whether the predicate treats a missing key as working (the safe, existing-behaviour-preserving default) and pin that choice with a test, or update the responders.

**Write-set guard** (lines 38-42, 184-188):
```python
ALLOWED_WRITE_COLUMNS = frozenset({"venue_account_id", "account_shared_with_api_key_id", "account_share_kind"})
STATUS_COLUMNS = frozenset({"sync_status", "sync_error", "disconnected_at", "is_active", "last_sync_at"})
def _assert_write_set_is_identity_only(sb: FakeSupabase) -> None:
    for payload in sb.updates():
        assert set(payload) <= ALLOWED_WRITE_COLUMNS, payload
        assert not (set(payload) & STATUS_COLUMNS), payload
```
**Key-row factory** (lines 163-181): `_key_row(**overrides)`; MT5 variants at 1417-1437 (`MT5_LOGIN`, `MT5_SERVER`, `_mt5_session(monkeypatch, login_slot)` builds a real `jw._make_mt5_session(login_slot, "synthetic-investor-pw", MT5_SERVER)`, `_mt5_row`).

**The ONCE-04 test goes beside** `test_mt5_collision_marks_the_key_duplicate_and_audits_once` (line 1524). Copy its assertions on the holder look-up filters:
```python
(look,) = [c for c in sb.calls if c.table == "api_keys" and c.op == "select"]
assert ("eq", "user_id", OWNER_ID) in look.filters
assert ("eq", "exchange", "mt5") in look.filters
assert ("eq", "venue_account_id", MT5_LOGIN) in look.filters
assert ("is", "disconnected_at", "null") in look.filters
assert ("neq", "id", KEY_ID) in look.filters
audit_mock.assert_called_once()
```
New arms (RESEARCH): two unstamped MT5 keys of DIFFERENT `user_id`, same login and server, both stamp, no marker, equal stamped identity; the same-owner counterpart marks one. Failing holder + working key: swap RPC called once, old holder audited once, recompose enqueued; working holder keeps the slot; both failing leave the incumbent. Neuters: drop the `user_id` filter, make `working_holder_predicate` constant, skip the swap call.

**Log hygiene test to copy** (`test_the_mt5_login_never_reaches_the_log`, 1544-1555): `caplog.set_level("DEBUG")`, assert the key id appears and the login does NOT. Add the same for the server.

Run from `analytics-service/` only: `python3 -m pytest tests/test_account_identity_stamper.py -x -q` (130 passed at research time) plus mypy strict (command in RESEARCH Validation Architecture).

---

### `src/app/api/strategies/create-with-key/route.test.ts` (test, modify in place)

**Analog:** itself. Mock infrastructure at lines 160-445 (`venueKeyLookupMock`, `venueStrategyLookupMock`, `venueOwnerLookupMock`, `capturedSelects`, `makeSelectBuilder`). Per-test fixture block at 1600-1700:
```ts
const MT5_RECONNECT_BODY = { exchange: "mt5", api_key: MT5_LOGIN, api_secret: "<synthetic>",
  passphrase: "<synthetic broker server>", label: "mt5 key", wizard_session_id: OTHER_SESSION_ID };
function seedExistingVenueRow() {
  venueKeyLookupMock.mockResolvedValue({ data: { id: EXISTING_KEY_ID }, error: null });
  venueStrategyLookupMock.mockResolvedValue({ data: { id: EXISTING_STRATEGY_ID }, error: null });
}
```
**Flip these five** (CONN-01): lines 1675 ("THE BUG: ... resolves to the EXISTING row"), 1692 ("FAILS TOWARD THE EXISTING ROW: the dedup path issues ZERO writes"), 2084 ("ANTI-REGRESSION: a real DRAFT ... still dedups"), 2193, 2692 ("an own DRAFT on the same account → 200 deduped with the EXISTING ids"). Keep 1544 (session fence) and 4647 (reuse arm). A flipped arm keeps its zero-write assertions (`rpcMock`, `validateKeyMock`, `encryptKeyMock`, `assetClassUpdateMock` not called, 2085-2095 style) and asserts the body names the draft and never contains the identity:
```ts
expect(text).not.toContain(OKX_UID);
```
**Race-arm collision helper** (2667-2677) builds a 23505 whose message names `api_keys_user_exchange_venue_account_uniq`; the ccxt cross-owner arm and the failing-holder arm reuse it.
Add arms: same-owner MT5 login + same server refused before `validateKey`; different server not refused by the app fence; NULL server on the stored row refuses (wildcard); failing holder falls through to `validateKey` and the swap RPC is called; different owner connects (resolver filters carry `user_id`); the RPC receives `p_venue_server`.

---

### `docs/runbooks/oneaccountonce/census.sql` + `delete.sql` (ops script, batch)

**Analog for shape:** `docs/runbooks/marksource-okx-census/` (README, `marker.sql`, one read-only statement per file with NO comments, because the CLI's inline form breaks on a leading comment line; README lines 16-24). `marker.sql` is the marker query verbatim:
```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```
`delete.sql` is NOT read-only and is orchestrator-run through MCP in ONE call. Nothing in `docs/runbooks/` is scanned by the data-dependence linter (it reads `supabase/migrations/` only, confirmed in `scripts/lint-migration-data-dependence.mjs` 119, 1018-1071), so a data-reading `DO` assertion block is allowed here and not in a migration. If the plan wants to hedge, express assertions as a plain `SELECT` with a forced division by zero.

**Owner-context delete idiom** (from `test_api_keys_account_identity.sql` ACCT-j; `delete_allocator_api_key` raises 42501 when `v_owner <> auth.uid()`, `supabase/schema/functions/delete_allocator_api_key.sql` 31-36):
```sql
PERFORM set_config('request.jwt.claims',
  json_build_object('sub', <owner uuid>::text, 'role', 'authenticated')::text, true);
-- ... PERFORM public.delete_allocator_api_key(<key uuid>, true);
PERFORM set_config('request.jwt.claims', '', true);
```
The claims GUC is transaction-local (`is_local = true`), so it must be set in the SAME transaction as the delete; use one explicit `BEGIN; ... COMMIT;` and treat a 42501 as "stop, nothing written" (RESEARCH A2).

Ordering and guards the script must encode (RESEARCH "Q5"): strategies BEFORE keys; census every referencing table including `allocation_events`, `match_decisions.original_strategy_id`, `verification_requests_legacy` (these REFUSE the delete) and the cross-owner cascades; any nonzero off-manifest count aborts; NEVER set `quantalyze.sanitize_in_progress`; never delete `mt5_server_clock_readings` directly (trigger refuses a depth-1 delete, `20261117120000` 237-253); enqueue `derive_allocator_equity` per owner afterwards via `enqueue_compute_job` (same call as `account_identity.py` 421-428). README note: a hard delete of the one MT5 duplicate renumbers `capture-keymap.sql` ordinals (`row_number() OVER (ORDER BY created_at, id)` over ALL mt5 keys), so the 155.2 recapture must take a fresh keymap.

Public-repo rule: the script takes ids as a pasted `VALUES` block at run time. No id, owner, amount or home path in tracked text.

---

### `src/__tests__/oneaccountonce-delete-sql-exec.test.ts` (new, exec-SQL-on-fixture vitest)

**Analog:** `src/__tests__/mt5-parity-capture-sql-exec.test.ts` (777 lines). Copy the mechanism, not the data.

**Boot a throwaway socket-only cluster, no skip gate** (lines 341-369):
```ts
beforeAll(() => {
  const sel = spawnSync("bash", [join(REPO, "scripts", "pg-lane", "run.sh"), "--print-pgbin"], { encoding: "utf8" });
  if (sel.status !== 0 || sel.stdout.trim() === "") {
    throw new Error("... no PostgreSQL server binaries. `bash scripts/pg-lane/run.sh --print-pgbin` said:\n" + sel.stderr);
  }
  pgbin = sel.stdout.trim();
  root = mkdtempSync("/tmp/mt5p-");   // /tmp, not os.tmpdir(): the socket path must stay under ~104 bytes
  pg("initdb", ["-D", data, "-A", "trust", "-U", "postgres", "-E", "UTF8", "--locale=C"]);
  writeFileSync(join(data, "postgresql.conf"), `... listen_addresses = ''\nunix_socket_directories = '${root}'\nfsync = off\n`);
  started = true;                    // set BEFORE start: a timed-out start can still come up late
  pg("pg_ctl", ["-D", data, "-l", join(root, "pg.log"), "-w", "-t", "30", "start"]);
  psql([... `COMMENT ON DATABASE postgres IS ${q(LOCAL_MARKER)};` ...].join("\n"));
  psql(seedSql());
}, 90000);
afterAll(() => { if (started) spawnSync(join(pgbin, "pg_ctl"), [... "-m", "immediate", "-w", "stop"], ...); if (root) rmSync(root, { recursive: true, force: true }); });
```
**Real DDL, cut verbatim from the baseline** (lines 276-286): regex over `supabase/schema/baseline.sql`, throws naming the table if a block is missing:
```ts
const m = new RegExp(`^CREATE TABLE IF NOT EXISTS "public"\\."${t}" \\(\\n[\\s\\S]*?^\\);\\n`, "m").exec(baseline);
```
⚠️ The baseline's CREATE TABLE blocks do NOT carry foreign keys (they are separate `ALTER TABLE ... ADD CONSTRAINT` statements, e.g. `baseline.sql` 16297 `allocator_holdings_api_key_id_fkey ... ON DELETE RESTRICT`, 16342 `api_keys_user_id_fkey`). The delete script depends on the FK graph (RESTRICT blockers, SET NULL, CASCADE), so this test must extract the relevant `ADD CONSTRAINT ... FOREIGN KEY` lines too and apply them, plus the function body from `supabase/schema/functions/delete_allocator_api_key.sql`, `enforce_api_keys_published_composite_integrity.sql` and `enforce_mt5_server_clock_readings_write_once.sql`. Say so in the plan; the donor does not do it. The cheaper alternative is the stand-in table style of `marksource-okx-nonworking-keys-exec.test.ts` (lines 44-60, hand-written minimal DDL), which cannot carry the real FK graph, so prefer the baseline cut here.

**Frozen clock + vacuity guards** (lines 360-363, 376-401): `public.now()` shadow and `ALTER DATABASE ... SET search_path = public, pg_catalog`; vacuity tests prove the cluster's marker is the local string, the clock is frozen, and the fixture seeded decoys.

**Rolled-back what-if helper** (lines 324-335, `rows(statement, prelude)`): `BEGIN; prelude; SET TRANSACTION READ ONLY; wrapped; ROLLBACK;`. The delete script WRITES, so the exec test needs a sibling helper that runs `delete.sql` inside a transaction it controls, then inspects counts, and for the abort arms asserts `psql` exits non-zero AND a follow-up count shows nothing deleted.

Arms (RESEARCH validation map): the script deletes exactly the manifest; aborts with nothing deleted when (i) an extra key joins the set, (ii) a manifest key is live or a holder, (iii) an off-manifest dependent exists, (iv) a manifest id is missing. Neuter: delete the equality assertion in the script so the "extra key" arm goes RED. Use the neuter protocol from MEMORY/RESEARCH: back up with `cp`, restore with `cp`, `cmp` clean; never `git checkout/restore/stash`.

---

### `src/lib/database.types.ts` and `supabase/schema/functions/*.sql` (generated)

`database.types.ts` is generated; `supabase gen types --local` needs Docker, which was DOWN on the research machine. Hand edit is the documented fallback (RESEARCH A7): `api_keys` Row/Insert/Update gain `venue_server`; `create_wizard_strategy` Args gain `p_venue_server?: string`; the new function gains an entry. Run `critical-regressions.test.ts` and the GDPR export tests that read it. Function dumps: `npm run schema:functions` regenerates `supabase/schema/functions/` (`@generated` header, "DO NOT EDIT BY HAND"); CI runs `schema:functions:check`. Include the regenerated dumps for `create_wizard_strategy`, `reconnect_allocator_api_key` (B) and the new function in the migration PR.

---

## Shared Patterns

### Constraint-name discrimination of a 23505
**Source:** `src/lib/api/pgConstraintName.ts` lines 55-100
**Apply to:** both connect routes, the stamper (its Python twin `_names_identity_index`, `account_identity.py` 234-236)
```ts
const CONSTRAINT_NAME_PATTERN = /constraint "([A-Za-z0-9_]{1,128})"/;
export const VENUE_IDENTITY_CONSTRAINT = "api_keys_user_exchange_venue_account_uniq";
export function pgConstraintName(error: unknown): string | null { ... message only, never `details` ... }
```
Reads `message` only. `details` carries the identity. The index name must not change or this breaks silently.

### Scrub the identity, and the server, from every log and body
**Source:** `scrubSeamError(err, secrets)` calls at `create-with-key/route.ts` 240-244, 1600-1607 and `validate-and-encrypt/route.ts` 804-808, 826-833; Python `_safe_message` (`account_identity.py` 327-349)
**Apply to:** every new route arm, the swap caller, the stamper
Per-request candidates are redacted regardless of length. Add the normalised server to every `secrets` array that already lists `venueAccountId`. No refusal body carries the identity (the builders take no identity parameter, which is the structural guarantee).

### D-18 working-holder predicate (four twins; never write a fifth)
**Sources:** SQL `20260927180000_working_holder_rule_d18.sql` 183-184; TS `src/lib/account-share-note.ts` 71-86 (`isWorkingHolder`, `NOT_WORKING_SYNC_STATUSES`); Python `analytics-service/services/allocator_equity_derive.py` 354 (`NOT_WORKING_SYNC_STATUSES`, `working_holder_predicate(key_row)`). Parity pinned by `account-share-note.test.ts` 160-180 and `analytics-service/tests/test_derive_allocator_equity_job.py`.
**Apply to:** the swap function (SQL twin), the route resolver (TS), the stamper (Python). Extend the parity tests to the new function body.

### Service-role-only SECDEF function + ACL + catalogue self-verify
**Source:** `20261106120000_refusalrace_metadata_merge_rpcs.sql` 72-153 (create + ACL), 158-202 (verify)
**Apply to:** `swap_account_slot`, the re-created `create_wizard_strategy`
`REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` in the SAME migration as any DROP+CREATE (`20260814120000` header (vi); gate `test_api_keys_exchange_not_user_writable.sql` assertion 5h arms from `pg_get_functiondef` and the live ACL).

### Tenant scoping on the admin (RLS-bypass) client
**Source:** `.eq("user_id", userId)` in `resolveByVenueIdentity` (`create-with-key/route.ts` 224-230) and `.eq("user_id", key_row["user_id"])` in `_find_live_holder` (`account_identity.py` 259)
**Apply to:** every new read of `api_keys` on the admin or service-role client. The unique index leads with `user_id` (C-08); the marker trigger refuses a holder of another owner (`ACCOUNT_SHARE_HOLDER_NOT_SAME_OWNER`). This is what keeps cross-user sharing legal (ONCE-02): there is no cross-owner marker.

### Non-blocking enqueue of the owner's recompose after an identity change
**Source:** `account_identity.py` 420-434 (`enqueue_compute_job` with `p_kind: "derive_allocator_equity"`, ERROR log on failure, marker stands)
**Apply to:** the swap path in the stamper and the ops delete script.

### RED-UNDER / RED-UNDER-M / RED-UNDER-SETUP annotation discipline
**Source:** `scripts/mutation-runner/GRAMMAR.md` rules 1-3; examples at `test_api_keys_venue_identity_uniq.sql` 41-68, 114, 131, 248, 481, 637, 725, 746 and `test_api_keys_account_identity.sql` 65, 110, 132, 172, 366
**Apply to:** every new or edited arm. The marker must start the comment line; every `edit` step carries a MEASURED `occurrences`; the first `TEST FAILED (<arm>)` in the lane output must name the intended arm; a mutation may not inject or rewrite a `TEST FAILED (` literal. `WAIVED_CEILING` is 0: do not add a waiver.

### No data-reading DO guard in a migration
**Source:** `20261117120000` 73-75; linter `scripts/lint-migration-data-dependence.mjs`
**Apply to:** both migrations. The `venue_server` backfill is the poll's job (the server exists only in ciphertext), never SQL.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| shared normalisation fixture read by both a vitest and a pytest (ASCII + whitespace server strings, expected normal form) | test fixture | transform | No existing file is read by both languages for byte parity. Closest idea: `account_identity.py`'s docstring records that `mt5_venue_account_id` (Python `strip()`) and JS `trim()` already differ at U+001C-U+001F, U+0085, U+FEFF; its parity test lives in `analytics-service/tests/` (`test_mt5_identity_form_is_the_one_rotate_returns`, line 1511). Planner should model a JSON fixture under a path both suites can open and keep the case list ASCII-plus-whitespace only. |
| `swap_account_slot` multi-row write ordering | function | transaction across 3+ rows | Only parts exist: `FOR UPDATE` (`20260927180000` ~160), the trigger's refusal tokens (`20260925120000` 223-262), and the service_role-only ACL shape (`20261106120000`). The six-step order is derived in RESEARCH "Pattern: one shared swap function" from the trigger and the index; there is no prior function that writes holder, kind and slot together. Use RESEARCH as the spec and the ACCT-* arms as the proof style. |

(The second row is the "partial" analog counted above.)

## Metadata

**Analog search scope:** `supabase/migrations/` (latest 40 and the named identity/wizard migrations), `supabase/tests/`, `supabase/schema/functions/`, `src/app/api/strategies/create-with-key/`, `src/app/api/keys/validate-and-encrypt/`, `src/lib/` (wizard errors, rosters, pgConstraintName, account-share-note), `analytics-service/services/account_identity.py` and its test, `src/__tests__/*-exec.test.ts`, `docs/runbooks/marksource-okx-census/`, `scripts/mutation-runner/GRAMMAR.md`, `scripts/lint-migration-data-dependence.mjs`.
**Files read:** about 30 (several partially, by range).
**Tracked-source check:** done for 24 analog paths, all tracked.
**Pattern extraction date:** 2026-11-23
