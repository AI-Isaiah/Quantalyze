-- ============================================================================
-- Migration: strategy_shares + generation-counter share RPCs (SHARE-01, SHARE-03)
-- Phase 164 / Plan 164-02
-- ============================================================================
-- The storage layer for the per-strategy factsheet share link. Adds:
--   (a) strategy_shares — ONE owner-scoped row per strategy holding a
--       monotonic `generation` counter, an immutable per-row `nonce`, and a
--       `revoked_at` tombstone;
--   (b) create_strategy_share(p_strategy_id)  — atomic mint-or-reuse;
--   (c) revoke_strategy_share(p_strategy_id)  — atomic revoke (stamp + bump).
--
-- ⛔ TOKEN MODEL — D-02 (164-CONTEXT.md "#### Token model"), AS AMENDED BY THE
-- FOUNDER RULING OF 2026-08-27 (red-team SYNTHESIS §3). The share token is
-- `HMAC(SHARE_TOKEN_SECRET, "qz.strategy-share.v1" || strategy_id || nonce ||
-- generation)`, computed in Node. This table stores
-- (strategy_id, generation, nonce, revoked_at) and **NEVER a token, raw or
-- hashed**. That is the whole point of the design and the reason this table
-- deliberately diverges from `scenario_shares` (which stores a `token_hash`):
--   * Nothing secret sits at rest. A database leak, a backup, a support query
--     or a future RLS mistake yields uuids, an integer and two timestamps —
--     never a working link. ⚠️ The nonce is an unguessable INPUT to the MAC,
--     not a credential: holding it derives nothing without the secret, which is
--     why adding it does not reopen the disclosure surface D-02 closed.
--   * Reuse is a REQUIREMENT, and only a re-derivable token delivers it.
--     Hash-only storage makes the raw token unrecoverable, so every "Copy Link"
--     would mint a new link and silently break the recipient's existing one —
--     the founder-hit defect wearing a different hat.
--   * Revoke is ONE atomic increment: `generation = generation + 1` invalidates
--     every previously-copied link at once, and a double-revoke converges
--     naturally (0 rows affected → the route reads that as success, not error).
--
-- ⭐ WHY THE NONCE EXISTS, and why it replaced path-by-path column pinning.
-- The counter alone is a TRANSITIONAL claim: "this row's generation advanced".
-- Enforcing it needs the row to be (a) never absent, (b) not re-creatable, and
-- (c) the sole determinant of the token. (a) and (b) both fail — `strategies`
-- carries ON DELETE CASCADE onto this table (STEP 1), and `strategies.id` is
-- client-suppliable. So an owner could DELETE their own strategy, re-INSERT it
-- with the SAME uuid, re-mint, and receive a BIT-IDENTICAL token to the one
-- they had revoked (MEASURED). No trigger on THIS table can even observe that
-- delete, and a `strategy_id` column pin cannot touch it: the delete happens on
-- another table.
--
-- The nonce converts the claim into an EXISTENTIAL one — "you hold a token
-- minted against THIS row" — which a re-created row cannot satisfy, because it
-- draws a fresh `gen_random_uuid()`. That closes the delete-and-recreate family
-- WHOLESALE rather than one path at a time: the admin DELETE, the `strategies`
-- CASCADE, the cross-tenant uuid squat, and cascade routes that do not exist
-- yet. The property moves from "prove no path can delete this row" — an
-- enumeration that failed three separate times in this phase — to "an attacker
-- cannot guess 122 bits".
--
-- ⛔ AND IT CLOSES NOTHING WITHOUT THE COLUMN GRANTS IN STEP 2. MEASURED, both
-- directions, on a throwaway PostgreSQL 16 cluster (2026-08-27):
--   * with INSERT column-UNRESTRICTED, an owner SELECTs their own nonce under
--     RLS, cascades the row away via `strategies`, and re-inserts it VERBATIM —
--     `nonce` came back bit-identical and the attack reproduces WITH the nonce
--     in hand;
--   * with `GRANT INSERT (strategy_id, created_by)` in force, that same
--     statement is rejected `42501 permission denied for table strategy_shares`.
-- Nonce without the column grant is theatre. Ship both or neither.
-- SQL cannot compute the HMAC (this repo enables no `pgcrypto digest`; only
-- gen_random_uuid() from pg13+ core), so — unlike the scenario spine — there is
-- **NO SECURITY DEFINER reader RPC here**. Token → strategy resolution happens
-- in Node on the service_role transport. Consequently anon needs EXECUTE on
-- nothing, and both functions below are SECURITY INVOKER. ⚠️ If any SECURITY
-- DEFINER function is ever added to this surface it takes the full
-- REVOKE/GRANT/`_assert_no_public_execute` treatment (mig 20260622120000 STEP 3).
--
-- ⛔ APPLY FLOW — this migration is applied by NOTHING at authoring time.
--   * TEST: hand-applied by a human at the Phase 164 plan 164-02 blocking
--     checkpoint (three reviewers first: migration-reviewer, rls-policy-auditor,
--     silent-failure-hunter). That hand-apply is the prerequisite for the
--     `sql-tests` CI lane — supabase/tests/test_strategy_shares_rls.sql is
--     EXPECTED RED until it happens (SKIP-01; see that file's header).
--   * PROD: applied AUTOMATICALLY by the Supabase Migrate workflow on
--     push-to-main. Merging this file IS the production deploy.
--   ⚠️ TWO CI GATES ARE DELIBERATELY RED between authoring and that hand-apply,
--   and both clear at it. Neither is a defect to work around:
--     1. supabase/tests/test_strategy_shares_rls.sql — RED by SKIP-01 design.
--     2. scripts/check-gdpr-export-coverage.ts (and the 5 assertions it fails
--        downstream in src/__tests__/gdpr-export-coverage-hook.test.ts, all one
--        root cause) — the hook greps THIS file, sees a new user-owned table and
--        demands a USER_EXPORT_TABLES entry; that entry is typed against
--        `keyof Database["public"]["Tables"]` in the GENERATED
--        src/lib/database.types.ts, which cannot know about a table that is
--        applied nowhere. Adding it early is a hard tsc error (MEASURED
--        2026-08-27: TS2322). Remedy is step 2 of the checkpoint: apply ->
--        regenerate types -> add the manifest + SANITIZE_PARITY_ALLOWLIST
--        entries together. Both sites carry a PENDING block spelling this out.
--        ⛔ Never silence it with an EXCLUDED_TABLES entry — that arm means
--        "not exportable" and would drop a user-owned table from every Art. 15
--        export, permanently and silently.
--   No `supabase db push` from the authoring plan. No rollback file: the
--   `supabase/migrations/down/` convention lapsed after 20260714090000 and
--   every 2026-08 migration ships without one; this migration follows the
--   live convention rather than reviving a dead one. Manual undo is
--   `DROP FUNCTION public.revoke_strategy_share(uuid), public.create_strategy_share(uuid);`
--   followed by `DROP TABLE public.strategy_shares;`.
--
-- HOUSE RULES OBSERVED
--   * `CREATE OR REPLACE FUNCTION`, never DROP+CREATE — a re-create re-applies
--     pg_default_acl and silently re-grants EXECUTE (it bit 20260812083206 for
--     `anon`; see 20260826130000 §(v)). Explicit REVOKE/GRANT below regardless.
--   * Re-base-on-latest-definition rule: satisfied VACUOUSLY. `grep -rn
--     "create_strategy_share\|revoke_strategy_share" supabase/migrations/`
--     returns nothing before this file — both are NEW names with no earlier
--     definition anywhere in the append-only migration history, so there is no
--     prior body to re-base against.
--   * `SET search_path = public, pg_temp` on both functions (the canon from
--     mig 87 H-B / mig 117), never `pg_catalog`.
--   * ⛔ `sanitize_user` NEEDS AN EXPLICIT ARM — and gets one, in the companion
--     migration 20260827130000_sanitize_user_revoke_strategy_shares.sql. An
--     earlier draft of this line claimed the two ON DELETE CASCADE FKs made a
--     new arm unnecessary. That was FALSE. `sanitize_user` is an
--     ANONYMIZE-not-DELETE RPC: its latest body
--     (20260517013100_sanitize_user_recipient_email_case_insensitive.sql)
--     contains ZERO `DELETE FROM profiles` and ZERO `DELETE FROM auth.users`
--     — it UPDATEs both — so nothing is ever deleted and NO cascade fires.
--     Erasure therefore rides that explicit arm, never a cascade. Without it,
--     every share link the data subject minted keeps resolving after a GDPR
--     Art. 17 erasure: anonymous access to their unpublished factsheet, with
--     the returns curve, the metrics and the trade analytics all surviving the
--     anonymize. And the subject cannot self-remedy, because the same RPC sets
--     `banned_until = 'infinity'` and purges their sessions — they can never
--     log back in to press Revoke.
--     ⛔ That arm REVOKES (revoked_at + generation bump); it must NEVER delete.
--     A delete rewinds the counter, the next mint restarts at generation 1, and
--     every previously-revoked token is resurrected — this file's own STEP 2
--     argument turned on itself.
--   * The phase-29 frozen-spine migration guard was NARROWED in the same commit
--     as this file (`src/__tests__/phase-29-frozen-spine-guards.test.ts`,
--     founder ruling D-05) so that `/scenario/i` still freezes the scenario
--     spine while this unrelated `strategy_shares` filename passes. ⛔ The
--     filename was deliberately NOT renamed to dodge the old substring.
-- ============================================================================

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: strategy_shares table — the counter IS the row
-- --------------------------------------------------------------------------
-- Deliberate deviation from the scenario precedent: `scenario_shares` is
-- N-rows-per-scenario with a PARTIAL unique index (`UNIQUE (scenario_id) WHERE
-- revoked_at IS NULL`) because each mint stores a new hashed token. Under the
-- generation model there is nothing per-mint to store — the row IS the counter
-- — so the correct shape is a FULL `UNIQUE (strategy_id)` with
-- reactivate-in-place on re-share. Per-event history rides `logAuditEvent`
-- (the `scenario.share.revoke` precedent), not extra rows here.
--
-- ⚠️ `generation` IS BIGINT, AND THAT IS HEADROOM — **NOT** THE N1 FIX. Pulled
-- forward on the "free now, table rewrite later" argument (SYNTHESIS §5): the
-- widen is instant on an empty table and rewrites a live one. It buys ONLY the
-- distance to the ceiling. A client that can WRITE `generation` reaches
-- 2^63-1 exactly as easily as 2^31-1 — one PATCH — and the resulting overflow
-- wedge is the same unrecoverable one (`revoke_strategy_share` then errors
-- `out of range`, and the GDPR Art. 17 arm in companion migration
-- 20260827130000 is the SAME statement, so the whole erasure aborts).
-- ⭐ WHAT ACTUALLY CLOSES N1 IS STEP 1b, not this line — and keeping the
-- distinction matters precisely because BIGINT is the part that LOOKS like a
-- fix. Both halves now live in the trigger: its INSERT branch FORCES generation
-- to 1 for every caller, including the BYPASSRLS roles STEP 2's
-- `GRANT INSERT (strategy_id, created_by)` cannot bind, and rule (6) bounds
-- every UPDATE to +1 so the ceiling is unreachable by construction. Do not read
-- BIGINT as having closed either half.
CREATE TABLE strategy_shares (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID        NOT NULL UNIQUE REFERENCES strategies ON DELETE CASCADE,
  created_by  UUID        NOT NULL REFERENCES profiles  ON DELETE CASCADE,
  generation  BIGINT      NOT NULL DEFAULT 1 CHECK (generation >= 1),
  -- ⛔ THE MAC WITNESS. Server-generated, per ROW, never re-derived, never in
  -- the URL, and — critically — named by NEITHER RPC, which is the ONLY reason
  -- it can be made unwritable-by-client while both RPCs stay SECURITY INVOKER
  -- (STEP 2). It is a MAC INPUT, not a credential.
  nonce       UUID        NOT NULL DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

ALTER TABLE strategy_shares ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE strategy_shares IS
  'Phase 164 / SHARE-01, SHARE-03. ONE row per strategy carrying the share '
  'generation counter AND an immutable per-row nonce. ⛔ Stores NO token, raw '
  'or hashed (D-02): the link is the HMAC, under SHARE_TOKEN_SECRET, over the '
  'tag "qz.strategy-share.v1" then strategy_id then nonce then generation, '
  'derived in Node — so a leak of this table yields only uuids, an int and '
  'timestamps. ⚠️ The nonce is a MAC INPUT, not a token: it derives nothing '
  'without the secret, which is not in this database. STATE '
  'MACHINE: (1) no row -> the strategy has never been shared; (2) row with '
  'revoked_at IS NULL -> a live link exists, and it is re-derivable from '
  '(nonce, generation), so Copy Link returns the SAME url every time '
  '(SHARE-01 reuse); '
  '(3) row with revoked_at NOT NULL -> revoked, and generation has ALREADY '
  'been advanced past every link ever handed out, so all of them are dead '
  '(SHARE-03). Re-sharing clears revoked_at WITHOUT resetting generation, so '
  'the new link differs from every old one. ⛔ generation is monotonic AND '
  'BOUNDED by ENFORCEMENT: the owner holds UPDATE on this column (STEP 2 must '
  'grant it — revoke_strategy_share is SECURITY INVOKER and writes it AS THE '
  'CALLER) and the FOR ALL policy admits their own-row writes, so the raw PATCH '
  'reaches the row. What constrains it is the BEFORE INSERT OR UPDATE trigger '
  'strategy_shares_monotonic_generation (STEP 1b): it FORCES generation to 1 on '
  'every INSERT, refuses every rewind, and admits an advance of AT MOST +1 — so '
  'the counter can neither go backwards (link resurrection) nor be driven to '
  'the BIGINT ceiling (which wedged revoke and ABORTED the GDPR Art. 17 erasure '
  'in migration 20260827130000, both being the same generation + 1 statement). '
  'Being a trigger, it binds service_role too, which the column grants cannot.';

COMMENT ON COLUMN strategy_shares.generation IS
  'Monotonic share generation, BIGINT. Feeds the Node-side HMAC as the third '
  'input; incrementing it is what makes revocation instantaneous for every '
  'previously-copied link. NEVER reset, NEVER decremented, and NEVER advanced '
  'by more than 1 in one statement.⚠️ BIGINT is '
  'HEADROOM, NOT the overflow fix: a client that can WRITE this column reaches '
  '2^63-1 as easily as 2^31-1, and the resulting wedge (revoke, and the GDPR '
  'Art. 17 arm in migration 20260827130000, are the same generation + 1 '
  'statement) aborts the erasure of the very data subject who caused it. The '
  'FIX is STEP 1b, not the width: the trigger FORCES this column to 1 on every '
  'INSERT (covering the BYPASSRLS roles the INSERT grant cannot bind) and its '
  'rule (6) admits an advance of AT MOST +1, so reaching the ceiling would take '
  'on the order of 9.2e18 separately committed statements. Overflow is '
  'therefore unreachable BY CONSTRUCTION, which is why nothing on this surface '
  'carries a numeric_value_out_of_range handler — and why nothing should: '
  'swallowing that error would turn a loud, complete erasure failure into a '
  'silent, incomplete one. STEP 2 closes the INSERT half at the grant layer for '
  '`authenticated` by omitting this column from the INSERT grant; the trigger '
  'closes it for every other role, and bounds the UPDATE half besides.';

COMMENT ON COLUMN strategy_shares.nonce IS
  'Phase 164, founder ruling 2026-08-27. Immutable per-row MAC witness. Feeds '
  'the Node-side HMAC as the THIRD input, so a row that is destroyed and '
  're-created — via the strategies ON DELETE CASCADE, an admin DELETE, or a '
  'cascade route that does not exist yet — draws a FRESH nonce and lands in a '
  'token space DISJOINT from anything ever issued. That is what closes the '
  'delete-and-recreate resurrection family wholesale, where a per-column pin '
  'closed it one enumerated path at a time and kept missing one. ⛔ NOT a '
  'credential: holding it derives nothing without SHARE_TOKEN_SECRET, which is '
  'why it does not reopen the disclosure surface D-02 closed. ⛔ NOT '
  'client-writable, and that is load-bearing rather than tidy: STEP 2 grants '
  'authenticated INSERT on (strategy_id, created_by) and UPDATE on '
  '(revoked_at, generation) ONLY. MEASURED — with the nonce writable, an owner '
  'reads it under RLS, cascades the row away and re-inserts it verbatim, and '
  'the attack reproduces with the nonce in hand. Neither RPC NAMES this '
  'column, which is precisely why the restriction is compatible with SECURITY '
  'INVOKER (PostgreSQL requires column privilege only on columns a statement '
  'names). The trigger rule (0c) binds service_role, which grants cannot.';

COMMENT ON COLUMN strategy_shares.revoked_at IS
  'Soft-revoke tombstone. NULL = live. Rows are never DELETEd (a delete would '
  'reset generation to 1 on re-share and RESURRECT already-revoked links — see '
  'the REVOKE DELETE in STEP 2).';

-- Owner-only access, transposed from `scenario_shares_owner`.
--
-- ⭐ CR-01 OWNER-COHERENCE — the EXISTS clause is LOAD-BEARING, not decorative.
-- `created_by = auth.uid()` alone is NOT enough: it lets any authenticated user
-- mint a share row for ANY strategy_id, including another tenant's, because the
-- FK only checks that the strategy EXISTS — not that the caller owns it. Since
-- the recipient lane authorises exactly the strategy_id found in the matched
-- share row, a cross-tenant row would be a working link to someone else's
-- private factsheet. The EXISTS clause makes the DATABASE reject that at WITH
-- CHECK time; the route's own ownership probe is layer 1, this is layer 2, and
-- there is no layer 3 here (no SECURITY DEFINER read path exists to re-check
-- at read time), which is precisely why this clause must never be dropped.
-- `supabase/tests/test_strategy_shares_rls.sql` pins the rejection.
--
-- `TO authenticated` pins the policy to the role the request-scoped client
-- connects as; combined with the REVOKE in STEP 2, anon is dead at BOTH the
-- grant layer (42501) and the policy layer.
CREATE POLICY strategy_shares_owner ON strategy_shares
  FOR ALL
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.strategies s
      WHERE s.id = strategy_shares.strategy_id
        AND s.user_id = auth.uid()
    )
  );

-- HOT-PATH index for the token lane's bounded scan (D-07). The recipient route
-- cannot locate the row from the token — nothing token-derived is stored and
-- the strategy id is not in the URL — so it scans ACTIVE share rows and
-- timingSafeEqual-compares each candidate. This partial index makes that an
-- index-only scan over exactly the live rows, and it is the same reasoning the
-- scenario migration used for its `scenario_shares_token_hash_idx`: the sole
-- public read path must not degrade into a seq scan over a table that only
-- grows (revoked rows are retained forever, never deleted).
-- ⚠️ D-07 REVISIT THRESHOLD: reconsider the O(1) locator variant above **1,000
-- active (revoked_at IS NULL) rows**. Today that count is 0.
-- ⚠️ `INCLUDE (nonce)` is what KEEPS it index-only now that the token also
-- derives from the nonce. Without it the scan would heap-fetch every candidate
-- row to read one uuid, which is exactly the degradation this index exists to
-- prevent. The nonce is a payload column, not a key column — the scan never
-- searches BY nonce (it cannot; nothing token-derived is stored), it only
-- needs to READ it.
CREATE INDEX strategy_shares_active_idx
  ON strategy_shares (strategy_id, generation)
  INCLUDE (nonce)
  WHERE revoked_at IS NULL;

-- --------------------------------------------------------------------------
-- STEP 1b: enforce the monotonic-counter invariant IN THE DATABASE
-- --------------------------------------------------------------------------
-- ⛔ THE OWNER SELF-REWIND. Everything above assumes `generation` only ever
-- moves through revoke_strategy_share(). It does not, and the gap was MEASURED
-- (PostgreSQL 16, throwaway replica of this schema, 2026-08-27) rather than
-- reasoned about:
--   * the STEP 2 grant is column-UNRESTRICTED (`GRANT SELECT, INSERT, UPDATE`);
--   * `strategy_shares_owner` is FOR ALL, and an owner's UPDATE of their OWN
--     row satisfies USING *and* WITH CHECK whenever created_by is unchanged.
-- So a plain `PATCH /rest/v1/strategy_shares?strategy_id=eq.<own>` carrying
-- `{"generation": 1, "revoked_at": null}` was accepted: generation went 2 -> 1
-- and the tombstone was cleared, in one request, from an ordinary user token.
-- Every recipient still holding a previously-revoked link regained anonymous
-- access to that owner's UNPUBLISHED factsheet. It also made the table COMMENT
-- above false and defeated the Art. 17 arm in companion migration
-- 20260827130000, whose whole value is that revocation is IRREVERSIBLE.
--
-- ⚠️ COLUMN-LEVEL GRANTS ARE NOT THE FIX **FOR `generation` AND `revoked_at`**,
-- and the earlier absolute phrasing of this paragraph was WRONG — it forbade
-- the very mechanism STEP 2 now relies on. The correct, narrower statement:
-- PostgreSQL requires column-level INSERT/UPDATE privilege only on the columns
-- a statement NAMES. Both RPCs NAME `generation` and `revoked_at`, so revoking
-- those two would disarm revoke_strategy_share(), which is SECURITY INVOKER and
-- writes AS THE CALLER — those privileges must stay, and what must be
-- constrained is the DIRECTION they may move, which is this trigger's job.
-- ⭐ `nonce` is the opposite case, and uniquely so: it is DEFAULT-populated and
-- NAMED BY NO RPC, so `GRANT INSERT (strategy_id, created_by)` /
-- `GRANT UPDATE (revoked_at, generation)` lock it while both RPCs keep working
-- unchanged (MEASURED both ways — see STEP 2). It is therefore the ONLY MAC
-- input that can be made unwritable-by-client without abandoning the founder's
-- SECURITY INVOKER ruling.
--
-- ⭐ WHY A TRIGGER AND NOT A CHECK CONSTRAINT: the invariant spans OLD and NEW,
-- which a CHECK cannot see. And ⛔ **a trigger is NOT bypassed by BYPASSRLS** —
-- unlike every RLS policy on this table, this fires for `service_role` too, so
-- it is the only control here that also covers the admin transport the
-- recipient lane already uses (STEP 2).
--
-- ⛔ THE TWO-REQUEST RE-POINT — why guarding `generation` ALONE is not enough.
-- An earlier version of this trigger compared only the counter and the
-- tombstone. It never looked at `strategy_id`, so the identical end state was
-- reachable in two requests instead of one, both issued as the row's own owner:
--   1. `PATCH /rest/v1/strategy_shares?strategy_id=eq.<A>` `{"strategy_id":"<B>"}`
--      where B is a second strategy the SAME user owns and has never shared.
--      USING passes (created_by is unchanged), the CR-01 WITH CHECK EXISTS
--      passes (they really do own B), UNIQUE(strategy_id) is free because B has
--      no row, and the counter is untouched — so nothing above rejected it. The
--      advanced counter walks away with strategy B and strategy A is left with
--      NO share row at all.
--   2. `create_strategy_share(A)` then takes the INSERT path and lands a fresh
--      row at `generation` DEFAULT 1. HMAC(secret, A || 1) is byte-identical to
--      the token A handed out — and REVOKED — at generation 1, so every
--      recipient holding that dead url is back inside the unpublished factsheet.
-- The counter is only meaningful RELATIVE to the strategy it counts for. That
-- binding is therefore IMMUTABLE, and so are the row identity and provenance
-- columns: STEP 3 tells the reader that reactivation never rewrites
-- created_by/created_at, and before rule (0b) a raw PATCH falsified that claim.
--
-- ⛔⛔ N1 — THE CEILING JUMP, AND WHY THE FIX IS RULE (6) AND NOT AN EXCEPTION
-- HANDLER. Plan 164-06, closing the gap this file's STEP 1 note above DEFERRED.
-- MEASURED at HEAD on a throwaway PostgreSQL 16 cluster (2026-08-27,
-- EXECUTION-EVIDENCE.md §5) with rules (0a)-(2) in force and rule (6) absent:
--   step 1  mint                                       generation = 1
--   step 2  owner PATCHes generation = 9223372036854775807   ACCEPTED
--   step 3  revoke_strategy_share(sid)                  WEDGED 22003
--   step 4  sanitize_user(uid)          Art. 17 ERASURE ABORTED 22003
-- Step 4 is the one that matters. `BIGINT` (STEP 1) raised the ceiling and
-- closed NOTHING: a client that can WRITE this column reaches 2^63-1 exactly as
-- easily as 2^31-1, in one request, because rule (1) forbids only a DECREASE.
--
-- ⭐ THE BOUND MAKES OVERFLOW UNREACHABLE BY CONSTRUCTION, which is why there is
-- no exception handler anywhere on this surface and why the next reader should
-- not add one. `generation` starts at 1 (the INSERT branch above FORCES it),
-- moves only by +1 (rule (6)), and every +1 is its own committed statement — so
-- arriving at 2^63-1 takes on the order of 9.2e18 revokes. The Art. 17 arm in
-- companion migration 20260827130000 runs the same `generation + 1`; it
-- therefore CANNOT raise 22003, and it needs no handler to say so.
--
-- ⛔ REJECTED ALTERNATIVE, recorded because it is the obvious one: wrapping that
-- B1 arm in `EXCEPTION WHEN numeric_value_out_of_range THEN ... CONTINUE`. That
-- converts a LOUD, COMPLETE failure into a SILENT, INCOMPLETE erasure — the
-- subject's share links survive, and the caller is told the erasure succeeded.
-- Aborting is strictly better than that, so the abort is not the defect; being
-- able to REACH it is. The fix belongs at the root, and the root is this
-- trigger.
--
-- The six rules plus the INSERT pin are what make the model sound:
--   (I)  on INSERT, generation is FORCED to 1 AND nonce is FORCED to a fresh
--        gen_random_uuid() — not validated, overwritten — so no caller can
--        express either MAC input on a fresh row. STEP 2's column grant closes
--        both for `authenticated` only; the trigger closes them for the BYPASSRLS
--        roles a grant cannot bind (R3). ⛔ The nonce half was ADDED 2026-08-28
--        and is not decoration: a column DEFAULT applies only when the statement
--        does not NAME the column, so before it a service_role
--        DELETE + `INSERT ... (strategy_id, created_by, nonce)` restored a
--        recorded nonce while this branch clamped generation back to 1 —
--        rebuilding the exact pre-revoke (nonce, generation, live) triple, and
--        with it every revoked token (MEASURED).
--   (0a) strategy_id NEVER changes. Re-pointing the counter re-issues generation
--        1 for the strategy it was pointed away from.
--   (0b) id, created_by and created_at are never REWRITTEN. ⚠️ Read that
--        narrowly, because the wider claim it used to make ("provenance on a
--        live capability grant must not be forgeable") is FALSE on the INSERT
--        side and was flagged as such: this rule is UPDATE-only, so a caller
--        that bypasses grants can still CHOOSE `id` and `created_at` on a fresh
--        row. That is accepted, not overlooked. Provenance on INSERT is
--        caller-supplied by design — `created_by` IS the mint RPC's auth.uid(),
--        so there is nothing to force it to — and neither `id` nor `created_at`
--        is an input to the MAC, so neither buys a token. The rule's real job is
--        to stop a SURVIVING row's provenance being rewritten, which is what
--        STEP 3 promises the reader about reactivation.
--   (0c) nonce NEVER changes. STEP 2's column grant already denies an ordinary
--        `authenticated` caller any write naming this column — but a grant
--        binds only roles that OBEY grants, and `service_role` holds GRANT ALL
--        and BYPASSRLS and is on this feature's hot path (the recipient lane
--        reads this table through createAdminClient()). MEASURED with rule (0c)
--        absent: `SET ROLE service_role; UPDATE strategy_shares SET nonce = <a
--        nonce recorded earlier>` was ACCEPTED — restoring a recorded nonce is
--        exactly the R2g residual, and the trigger is the only control on this
--        table that reaches that caller. ⚠️ It does not ELIMINATE the residual
--        (an operator who can read SHARE_TOKEN_SECRET can mint any token from
--        scratch); it removes the cheap in-database form of it.
--   (1)  generation NEVER decreases. A rewind re-issues a dead token.
--   (2)  a revocation (revoked_at NULL -> NOT NULL) MUST advance generation.
--   (6)  an UPDATE advances generation by AT MOST ONE. With (1) this pins the
--        counter to "stay, or advance by exactly one" — the whole of N1.
-- ⛔ RULES (1) AND (2) ARE NOT SUPERSEDED BY THE NONCE and must both stay. The
-- nonce closes resurrection via row DESTRUCTION AND RE-CREATION; (1) and (2)
-- govern the SAME row, which keeps its nonce throughout. A rewind on a
-- surviving row re-derives a dead token with the nonce unchanged — the nonce is
-- simply a constant in that pre-image and contributes nothing.
-- (2) is what lets reactivation stay unconstrained: because every revoked row
-- provably got there by advancing, clearing `revoked_at` without touching the
-- counter — exactly what create_strategy_share() does — can never return the
-- row to a generation that was live before a revoke. Without (2) an owner could
-- raw-stamp revoked_at at generation G (making the link merely go dark), then
-- re-mint and bring that same generation-G token back to life.
--
-- ⚠️ THE FUNCTION NAME IS NOW NARROWER THAN ITS JOB, and is kept anyway:
-- `strategy_shares_enforce_monotonic_generation` / trigger
-- `strategy_shares_monotonic_generation` are pinned by name in STEP 6 (v), by
-- `supabase/tests/test_strategy_shares_rls.sql` (SHAPE 5) and by this table's
-- COMMENT. Renaming to chase the widened scope would touch four sites to buy a
-- better word; the scope is documented here and in the function COMMENT instead.
--
-- ⛔ FOUNDER RULING (2026-08-27) — the alternative fix was CONSIDERED AND
-- REJECTED: revoking the client UPDATE grant outright and converting both RPCs
-- to SECURITY DEFINER would also close the re-point, but it deletes RLS as the
-- ownership wall on this surface and moves the whole tenancy argument inside two
-- function bodies. The column pin plus SECURITY INVOKER is the ruling. Do not
-- re-litigate it.
CREATE OR REPLACE FUNCTION public.strategy_shares_enforce_monotonic_generation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- (I) INSERT: the starting counter is not EXPRESSIBLE by any caller.
  -- ⛔ Must be the first statement and must RETURN. On an INSERT `OLD` is
  -- unassigned, and PL/pgSQL raises "record old is not assigned yet" on the
  -- very first comparison below — so every rule after this point is
  -- UPDATE-only by construction, not by convention.
  -- FORCE rather than reject: a rejection lets the caller learn which starting
  -- values are legal, and every legal value other than 1 is a bug. Overwriting
  -- means no caller — not `authenticated`, not `service_role`, not a future
  -- BYPASSRLS maintenance script — can express a starting generation at all.
  -- ⛔⛔ `nonce` IS RE-ROLLED HERE, AND LEAVING IT TO THE COLUMN DEFAULT WAS A
  -- MEASURED HOLE (2026-08-28 three-reviewer gate, F-3). A DEFAULT only applies
  -- when the statement does not NAME the column; a caller that names it supplies
  -- its own value, and rule (0c) below is UPDATE-only by construction. STEP 2's
  -- column grant closes the naming for `authenticated` — and for nobody else.
  -- MEASURED on a throwaway PostgreSQL 16 cluster, with this line absent:
  --   1. owner mints                       -> generation 1, nonce N
  --   2. owner revokes                     -> generation 2; the token derived
  --                                           from (N, 1) is now DEAD
  --   3. `SET ROLE service_role; DELETE FROM strategy_shares ...`
  --   4. `SET ROLE service_role; INSERT INTO strategy_shares
  --       (strategy_id, created_by, nonce) VALUES (..., N)`
  --   -> stored row came back as generation 1 (this branch FORCED it back down),
  --      nonce N, revoked_at NULL. The (nonce, generation, live) triple is
  --      byte-identical to the pre-revoke one, so HMAC over it re-derives the
  --      REVOKED token exactly. Step 3+4 also fully reverses an Art. 17 erasure.
  -- ⭐ Forcing rather than rejecting, for the same reason `generation` is forced:
  -- a rejection teaches the caller which values are legal. Overwriting means no
  -- caller — not `authenticated`, not `service_role`, not a future BYPASSRLS
  -- maintenance script — can express a nonce at all, so a destroyed-and-
  -- recreated row ALWAYS lands in a token space disjoint from every token that
  -- row ever issued. That is the property the nonce exists to provide, and
  -- before this line it held only against callers who obey column grants.
  -- ⚠️ It does not disturb the mint lane: `create_strategy_share` never NAMES
  -- `nonce` (STEP 3, pinned by STEP 6 arm (ii-d) and by SHAPE 4d), and it reads
  -- the value back through `RETURNING`, which observes the post-trigger tuple —
  -- MEASURED clean on both the INSERT and the ON CONFLICT path.
  -- ⚠️ AND IT DOES NOT TOUCH REUSE OR REACTIVATION. `INSERT ... ON CONFLICT DO
  -- UPDATE` fires this branch on the PROPOSED tuple, which is then DISCARDED on
  -- conflict; the surviving row keeps its own nonce, so OWNER 2d (live reuse
  -- returns the SAME nonce) and REACTIVATE 1g (revoke -> re-share returns the
  -- SAME nonce) both stay green — measured, not assumed.
  --
  -- ⚠️ RULE (0b) HAS NO INSERT HALF AND DELIBERATELY GAINS NONE. A service_role
  -- INSERT can still choose `id` and `created_at`. That is NOT closed here and
  -- the COMMENT on this function is worded accordingly: (0b) is a claim about
  -- never REWRITING provenance on a surviving row, not about establishing it.
  -- Provenance on INSERT is caller-supplied by design — `created_by` IS the
  -- mint RPC's `auth.uid()`, so forcing it is not available — and neither `id`
  -- nor `created_at` is an input to the MAC, so neither buys a token. The nonce
  -- is forced because it IS a MAC input; the rest is documented, not guarded.
  IF TG_OP = 'INSERT' THEN
    NEW.generation := 1;
    NEW.nonce := gen_random_uuid();
    RETURN NEW;
  END IF;

  -- (0a) the counter is bound to ONE strategy, permanently.
  IF NEW.strategy_id IS DISTINCT FROM OLD.strategy_id THEN
    RAISE EXCEPTION 'strategy_shares: strategy_id is immutable — refusing to re-point the share row for strategy % at strategy %. The generation counter is only meaningful RELATIVE to the strategy it counts for. Moving it leaves the original strategy with NO share row, so the very next create_strategy_share() inserts a fresh one at generation 1 and re-issues every token that strategy ever had at generation 1 — including the ones that were explicitly REVOKED. Two requests, both legitimate for the row owner, same end state as rewinding the counter.',
      OLD.strategy_id, NEW.strategy_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- (0b) row identity and provenance are write-once.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'strategy_shares: identity and provenance are immutable — refusing to rewrite id, created_by or created_at on strategy %. STEP 3 of this migration tells every future reader that reactivation never rewrites provenance; without this rule a raw PATCH falsifies that claim and forges who minted a live anonymous capability link, and when.',
      OLD.strategy_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- (0c) the MAC witness is write-once. Deliberately its OWN rule and its OWN
  -- message rather than a fourth column bolted onto (0b): (0b) is a provenance
  -- claim (who/when), this is a CRYPTOGRAPHIC one, and the arms that pin them
  -- need distinguishable messages or one deletion hides behind the other's text.
  IF NEW.nonce IS DISTINCT FROM OLD.nonce THEN
    RAISE EXCEPTION 'strategy_shares: nonce is immutable — refusing to rewrite the MAC witness on strategy %. The nonce is what makes a destroyed-and-recreated row land in a token space DISJOINT from every token ever issued; letting it be written back restores a recorded value and resurrects those tokens. STEP 2''s column grant already denies this to `authenticated`, so a write that reaches this rule came from a role that BYPASSES grants — service_role, which holds GRANT ALL and is on this feature''s hot path. A trigger is the only control on this table that binds it.',
      OLD.strategy_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.generation < OLD.generation THEN
    RAISE EXCEPTION 'strategy_shares: generation is monotonic — refusing to rewind it from % to % on strategy %. A rewind re-issues every share token minted at the lower generation, including ones that were explicitly REVOKED, as anonymous access to an unpublished factsheet.',
      OLD.generation, NEW.generation, OLD.strategy_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.revoked_at IS NULL
     AND NEW.revoked_at IS NOT NULL
     AND NEW.generation <= OLD.generation THEN
    RAISE EXCEPTION 'strategy_shares: a revocation must ADVANCE generation — refusing to stamp revoked_at on strategy % while generation stays at %. A tombstone without a bump is COSMETIC: the link merely disappears from the active scan, and the next create_strategy_share() clears the tombstone at the SAME generation and brings the supposedly-revoked token back to life.',
      OLD.strategy_id, OLD.generation
      USING ERRCODE = 'check_violation';
  END IF;

  -- (6) an UPDATE may advance generation by AT MOST ONE. Ordered last on
  -- purpose: rule (1) has already refused every decrease, so by the time
  -- control reaches here NEW.generation >= OLD.generation and the two rules
  -- together pin the counter to "stay, or advance by exactly one". Nothing
  -- else is expressible.
  IF NEW.generation > OLD.generation + 1 THEN
    RAISE EXCEPTION 'strategy_shares: generation may advance by AT MOST ONE per statement — refusing to move it from % to % on strategy %. An unbounded jump does not merely skip numbers: it drives the counter to the BIGINT ceiling in ONE request from an ordinary owner token (they hold the STEP 2 UPDATE(generation) column grant, and rule (1) forbids only a DECREASE). After that, revoke_strategy_share and the GDPR Art. 17 erasure arm in migration 20260827130000 are the SAME generation + 1 statement, so both raise 22003 numeric_value_out_of_range and the data subject has WEDGED THEIR OWN ERASURE with one PATCH (MEASURED 2026-08-27). Bounding every advance to +1 is what makes that overflow unreachable by construction.',
      OLD.generation, NEW.generation, OLD.strategy_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.strategy_shares_enforce_monotonic_generation() IS
  'Phase 164 / SHARE-03 and 164-06. BEFORE INSERT OR UPDATE guard. On INSERT it '
  'FORCES generation to 1 AND re-rolls nonce, then returns — not "rejects a '
  'wrong value", overwrites both — so no caller can express EITHER MAC input on '
  'a fresh row, including the BYPASSRLS '
  'roles that STEP 2''s column grant cannot bind (R3). The nonce half is what '
  'stops a service_role DELETE plus a re-INSERT naming a recorded nonce from '
  'rebuilding the pre-revoke (nonce, generation, live) triple byte-for-byte, '
  'which re-derives every token that row ever issued and reverses an Art. 17 '
  'erasure (MEASURED 2026-08-28). On UPDATE it enforces SIX '
  'rules (the name predates all but one and is kept because STEP 6, the table '
  'COMMENT and test_strategy_shares_rls.sql all pin it): (0c) nonce is IMMUTABLE — the MAC '
  'witness must not be written back from a recorded value, and since STEP 2''s '
  'column grant already denies this to `authenticated`, the rule exists for the '
  'role that bypasses grants entirely (service_role, GRANT ALL + BYPASSRLS, on '
  'this feature''s hot path); (0a) strategy_id is IMMUTABLE — '
  're-pointing the row at another strategy the same owner holds leaves the '
  'original with no row, and the next create_strategy_share() re-issues it at '
  'generation 1, resurrecting every token revoked at generation 1 in TWO '
  'requests; (0b) id, created_by and created_at cannot be REWRITTEN on a '
  'surviving row, so the provenance STEP 3 promises about reactivation cannot be '
  'forged by a raw PATCH — this rule is UPDATE-only, and a caller that bypasses '
  'grants can still choose id and created_at on a FRESH row, which is accepted '
  'because neither is a MAC input and created_by is caller-supplied by design; '
  '(1) generation '
  'is monotonic; (2) every revocation advances it; (6) an UPDATE advances it by '
  'AT MOST ONE. Closes the owner '
  'self-rewind: the FOR ALL policy plus a column-unrestricted UPDATE grant let '
  'an owner PATCH their own row back to a revoked generation and clear '
  'revoked_at, resurrecting every link they had revoked (MEASURED). ⭐ Rule (6) '
  'closes the opposite direction, N1: the same PATCH could set generation to '
  '2^63-1, after which revoke_strategy_share and the GDPR Art. 17 arm in '
  'migration 20260827130000 — the same generation + 1 statement — both raise '
  '22003 and the data subject has ABORTED THEIR OWN ERASURE (MEASURED). With '
  '(1) and (6) the counter may only stay or advance by exactly one, so the '
  'BIGINT ceiling is unreachable by construction and no overflow handler is '
  'needed anywhere on this surface. ⛔ Triggers '
  'are NOT bypassed by BYPASSRLS, so this covers service_role as well — the '
  'only control on this table that does.';

-- ⛔ `BEFORE INSERT OR UPDATE`, not `BEFORE UPDATE`. The INSERT half is what
-- covers the roles GRANTs cannot bind: STEP 2 omits `generation` from
-- authenticated's INSERT grant, but `service_role` holds GRANT ALL, so before
-- the TG_OP branch above an admin transport could land a fresh row at any
-- starting counter it liked. Widening the trigger is the only control on this
-- table that reaches that caller (R3's closure).
CREATE TRIGGER strategy_shares_monotonic_generation
  BEFORE INSERT OR UPDATE ON strategy_shares
  FOR EACH ROW
  EXECUTE FUNCTION public.strategy_shares_enforce_monotonic_generation();

-- --------------------------------------------------------------------------
-- STEP 2: table grants — POSITIVE-ONLY (anon dead, DELETE and TRUNCATE closed)
-- --------------------------------------------------------------------------
-- A fresh table inherits Supabase's default GRANT ALL to anon/authenticated.
-- There is NO public-read use case for this table: the recipient lane reads it
-- through `createAdminClient()` (service_role) in Node, exactly like
-- /scenario-share.
--
-- ⛔ THE POSTURE IS POSITIVE-ONLY, NOT SUBTRACTIVE. An earlier draft revoked
-- only `DELETE` by name from `authenticated` and left the rest of the
-- inherited GRANT ALL standing — which keeps TRUNCATE, REFERENCES and TRIGGER.
-- TRUNCATE is the dangerous one: **it is EXEMPT FROM RLS**, so one
-- `TRUNCATE strategy_shares` from any authenticated session discards EVERY
-- tenant's counter simultaneously, and every revoked link in the system comes
-- back to life at generation 1. That is the token-resurrection failure below,
-- escalated from one tenant to all of them, and no policy on this table can
-- stop it. A subtractive posture is only ever as complete as its enumeration;
-- stating what to GIVE is complete by construction. Same shape as
-- 20260825120000_ledger_refresh_staleness_view.sql:333.
--
-- ⛔ TOKEN-RESURRECTION GUARD — why DELETE is absent from the positive list.
-- The RLS policy above is FOR ALL, which would otherwise let an owner DELETE
-- their own share row. That is not equivalent to revoking: a DELETE discards
-- the counter, so the next create_strategy_share() inserts a fresh row at
-- generation = 1 and every token minted at generation 1 — including ones the
-- owner explicitly REVOKED — becomes valid again. Revocation must be
-- irreversible, so no client role gets DELETE. Soft-revoke (revoked_at +
-- generation bump) is the only supported un-share. FK cascades from
-- strategies/profiles still work: referential actions execute internally and
-- do not consult the caller's privileges, so account deletion is unaffected.
-- service_role keeps DELETE for exactly those maintenance paths.
--
-- ⭐⭐ THE WRITE GRANTS ARE COLUMN-SCOPED, AND THAT IS THE OTHER HALF OF THE
-- NONCE FIX — not a tidy-up. Founder ruling 2026-08-27 (red-team SYNTHESIS §3).
--
-- WHY IT IS POSSIBLE AT ALL. PostgreSQL checks column-level INSERT/UPDATE
-- privilege only against the columns a statement NAMES. `nonce` is populated by
-- its column DEFAULT and is named by NEITHER RPC, so locking it does not disarm
-- them — unlike `generation`/`revoked_at`, which both RPCs name explicitly and
-- which therefore cannot be withdrawn from a SECURITY INVOKER writer (STEP 1b).
-- ⇒ The nonce is the ONLY MAC input that can be made unwritable-by-client while
-- keeping the founder's SECURITY INVOKER ruling intact.
--
-- WHY IT IS NECESSARY. MEASURED both directions on a throwaway PostgreSQL 16
-- cluster with this migration applied verbatim (2026-08-27):
--   * WITHOUT it — `INSERT INTO strategy_shares (strategy_id, created_by, nonce)`
--     from an ordinary owner token was ACCEPTED, and the nonce came back
--     BIT-IDENTICAL. The owner SELECTs their own nonce under RLS, DELETEs their
--     `strategies` row (the CASCADE takes the share row with it), re-INSERTs the
--     strategy with the same client-suppliable uuid, and re-inserts the share
--     row verbatim. The nonce closes NOTHING against that.
--   * WITH it — the same statement is rejected
--     `42501 permission denied for table strategy_shares`, while
--     create_strategy_share (mint AND the ON CONFLICT reuse path) and
--     revoke_strategy_share both still run unchanged as SECURITY INVOKER.
--
-- ⭐ IT ALSO COVERS R3's INSERT HALF AT THE GRANT LAYER, which is worth naming
-- because it is not obvious: `generation` and `revoked_at` are both absent from
-- the INSERT grant, so `INSERT ... (strategy_id, created_by, generation)` from
-- an ordinary owner is rejected 42501 (MEASURED) — a client cannot choose a
-- starting counter or pre-stamp a tombstone on a fresh row.
-- ⛔ AND A GRANT IS ONLY HALF OF IT, which is why STEP 1b's trigger now fires
-- `BEFORE INSERT OR UPDATE` and FORCES `generation := 1`. A grant binds only
-- roles that OBEY grants; `service_role` holds GRANT ALL and BYPASSRLS and is
-- on this feature's hot path. The two layers fail on OPPOSITE edits — widen the
-- grant and the trigger still pins the value; drop the trigger branch and the
-- grant still stops `authenticated` — so neither is redundant. The UPDATE half
-- of N1 (the bounded increment, rule (6)) is likewise in STEP 1b, not here.
--
-- ⛔ STILL POSITIVE-ONLY. `REVOKE ALL` first, then state exactly what to GIVE,
-- at table level and at column level. A subtractive `REVOKE INSERT(nonce)` is
-- only ever as complete as its enumeration and would silently re-open on the
-- next column added to this table.
--
-- ⚠️ SELECT STAYS TABLE-WIDE, INCLUDING `nonce`, and that is required rather
-- than lax: create_strategy_share RETURNs the nonce to its caller and runs AS
-- THE CALLER, so revoking SELECT(nonce) would break the mint lane. Reading the
-- nonce is harmless — it derives nothing without SHARE_TOKEN_SECRET. WRITING it
-- is the attack, and writing is what is closed.
REVOKE ALL ON strategy_shares FROM PUBLIC, anon, authenticated;

GRANT SELECT                           ON strategy_shares TO authenticated;
GRANT INSERT (strategy_id, created_by) ON strategy_shares TO authenticated;
GRANT UPDATE (revoked_at, generation)  ON strategy_shares TO authenticated;
GRANT ALL                              ON strategy_shares TO service_role;

-- --------------------------------------------------------------------------
-- STEP 2b: pin the `authenticated` privilege set EXACTLY
-- --------------------------------------------------------------------------
-- Read the ACL from pg_class.relacl via aclexplode, NOT from
-- information_schema.role_table_grants: that view is PRIVILEGE-FILTERED (it
-- only surfaces grants whose grantor or grantee the current role is, or is a
-- member of), so depending on WHO applies this migration it can under-report
-- and turn the assertion vacuously green. relacl is the authoritative store
-- and is not filtered.
--
-- ⚠️ TWO CATALOGS, because the posture now lives in two places. Table-level
-- grants are in `pg_class.relacl`; COLUMN-level grants are in
-- `pg_attribute.attacl` and are INVISIBLE to relacl. A pin that read only
-- relacl would see `{SELECT}` and report the write surface as CLOSED while
-- every column grant sat beside it unexamined — including, one day, a
-- re-granted `INSERT (nonce)`. Both are asserted, and both as EXACT SETS.
DO $$
DECLARE
  v_privs TEXT[];
  v_cols  TEXT;
BEGIN
  SELECT array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
    INTO v_privs
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
    JOIN pg_roles r ON r.oid = acl.grantee
   WHERE c.oid = 'public.strategy_shares'::regclass
     AND r.rolname = 'authenticated';

  -- RED-UNDER: restore the old table-wide grant in STEP 2
  --            (`GRANT SELECT, INSERT, UPDATE ON strategy_shares TO authenticated`).
  IF v_privs IS DISTINCT FROM ARRAY['SELECT']::TEXT[] THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: `authenticated` holds TABLE-level privilege set % on strategy_shares, expected exactly {SELECT}. A table-level INSERT or UPDATE covers EVERY column — including `nonce`, whose unwritability is what makes the MAC witness a witness (MEASURED: with a table-wide INSERT grant, an owner re-inserts a recorded nonce verbatim after cascading the row away, and the revoked token derives again). DELETE lets one tenant discard their counter; TRUNCATE — EXEMPT FROM RLS — does it for EVERY tenant at once.',
      COALESCE(v_privs::TEXT, '(none)');
  END IF;

  SELECT string_agg(a.attname || ':' || acl.privilege_type, ',' ORDER BY a.attname, acl.privilege_type)
    INTO v_cols
    FROM pg_attribute a
    CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
    JOIN pg_roles r ON r.oid = acl.grantee
   WHERE a.attrelid = 'public.strategy_shares'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped
     AND r.rolname = 'authenticated';

  -- RED-UNDER: add `GRANT INSERT (nonce) ON strategy_shares TO authenticated`
  --            to STEP 2 (the exact re-grant that undoes the whole fix).
  IF v_cols IS DISTINCT FROM 'created_by:INSERT,generation:UPDATE,revoked_at:UPDATE,strategy_id:INSERT' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: `authenticated` holds COLUMN-level grants "%" on strategy_shares, expected exactly "created_by:INSERT,generation:UPDATE,revoked_at:UPDATE,strategy_id:INSERT". ⛔ An INSERT grant naming `revoked_at` reopens R3''s INSERT half outright: a pre-stamped tombstone on a fresh row is covered by NO trigger rule, because rule (2) fires only on the NULL to NOT NULL transition of an UPDATE. ⚠️ Grants naming `nonce` or `generation` are caught a second time by the trigger''s INSERT branch, which FORCES both — so for those two columns this arm is the cheap detector rather than the last line, and it is kept because a grant is the only control that automatically covers columns added to this table in future, and because a grant REFUSES the write (42501, the caller learns) where the trigger silently corrects it.',
      COALESCE(v_cols, '(none)');
  END IF;

  RAISE NOTICE 'Migration 164-02: authenticated pinned to TABLE {SELECT} + COLUMNS {INSERT(strategy_id,created_by), UPDATE(revoked_at,generation)} — nonce unwritable.';
END $$;

-- --------------------------------------------------------------------------
-- STEP 3: create_strategy_share(p_strategy_id) — atomic mint-or-reuse
-- --------------------------------------------------------------------------
-- ONE statement: insert the counter row, or reactivate the existing one. The
-- caller gets back the CURRENT generation AND the row's nonce and derives the
-- token from both in Node, so:
--   * strategy never shared -> row at generation 1 -> a fresh link;
--   * strategy already live -> the SAME generation -> the SAME link (SHARE-01
--     reuse: Copy Link is idempotent and never breaks the recipient's url);
--   * strategy revoked      -> revoked_at cleared, generation UNCHANGED at the
--     already-advanced value -> a link that differs from every revoked one.
--
-- Why an RPC rather than a client-side upsert (RESEARCH assumption A4): the
-- state machine — "never touch created_by or created_at on reactivation, never
-- touch generation on mint" — lives in ONE place instead of being re-derived
-- correctly by every future call site. `created_by` is sourced from auth.uid()
-- INSIDE the body and is never a parameter, so a forged owner is impossible.
--
-- SECURITY INVOKER (stated explicitly, not left to the default): this runs AS
-- THE CALLER, so `strategy_shares_owner` gates it — including the CR-01
-- owner-coherence EXISTS clause. A caller cannot mint for a strategy they do
-- not own through this RPC either; the WITH CHECK raises and the function's
-- implicit subtransaction rolls back. STABLE would be wrong here (this writes);
-- VOLATILE is correct and is the omitted default.
--
-- ON CONFLICT + RLS: on the DO UPDATE path Postgres evaluates the policy's
-- USING against the existing row and its WITH CHECK against the updated row.
-- A conflicting row belonging to another tenant therefore ERRORS rather than
-- being silently updated — no cross-tenant write, and the route surfaces a
-- generic failure rather than an existence oracle.
--
-- ⛔ THE RETURN SHAPE CHANGED IN PLACE, NOT BY DROP+CREATE, AND THAT MATTERS.
-- `CREATE OR REPLACE FUNCTION` CANNOT change a return type — PostgreSQL rejects
-- it with "cannot change return type of existing function" (MEASURED). The
-- lawful ways out are (i) DROP + CREATE, or (ii) editing the ORIGINAL
-- definition. This migration is UNAPPLIED, so (ii) is available and (ii) is
-- what was done. ⚠️ (i) would have been actively unsafe here: a DROP+CREATE
-- re-applies Supabase's `pg_default_acl`, silently re-granting EXECUTE to
-- anon/authenticated/service_role — the exact hazard this file documents at
-- STEP 5 and that bit mig 20260812083206. Never "fix" a future return-type
-- change on this function by appending a DROP.
--
-- ⚠️ `RETURNS TABLE`, NOT `OUT` PARAMETERS, AND THE REASON IS MEASURED RATHER
-- THAN STYLISTIC. Both express the same two-column result, but they differ in
-- the catalog in a way that matters here (PostgreSQL 16, throwaway cluster):
--   * with OUT parameters, `pg_get_function_identity_arguments` becomes
--     `p_strategy_id uuid, OUT generation bigint, OUT nonce uuid` — which
--     SILENTLY BREAKS every probe in this file's STEP 6 and in
--     test_strategy_shares_rls.sql SHAPE 4 that looks the function up by
--     `= 'p_strategy_id uuid'`. They do not error; they match zero rows and the
--     body-shape arms go vacuous. (The first apply of this change did exactly
--     that: "a share RPC is missing post-create (create present: f)".)
--   * with RETURNS TABLE, identity arguments stay byte-identical at
--     `p_strategy_id uuid`, so every existing lookup, every REVOKE/GRANT and
--     `_assert_no_public_execute('public.create_strategy_share(uuid)')` keep
--     working untouched — and `pg_get_function_result` returns the greppable
--     `TABLE(generation bigint, nonce uuid)` instead of a bare `record`.
-- `RETURN NEXT` emits the single row from the RETURNS TABLE output variables.
-- The INTO targets are function-qualified (`create_strategy_share.generation`)
-- so plpgsql cannot confuse the output variable with the column of the same
-- name — MEASURED clean on both the INSERT and the ON CONFLICT path.
CREATE OR REPLACE FUNCTION public.create_strategy_share(p_strategy_id UUID)
RETURNS TABLE (generation BIGINT, nonce UUID)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ⛔ FAIL LOUD for a caller with no authenticated identity (founder ruling
  -- 2026-08-27). SECURITY INVOKER + RLS is the ownership wall here, and RLS
  -- DOES NOT APPLY to a BYPASSRLS role — `service_role`, which is exactly what
  -- `createAdminClient()` connects as, and the recipient lane already uses an
  -- admin client against this table (STEP 2).
  --
  -- MEASURED (PostgreSQL 16), so the rationale is not guesswork: without this
  -- guard a service_role call raises `23502 null value in column "created_by"`
  -- — ExecConstraints checks NOT NULL on the proposed tuple BEFORE speculative
  -- insertion, so the ON CONFLICT DO UPDATE path is never reached and an
  -- existing revoked row is NOT reactivated. The NOT NULL column therefore
  -- happens to block the cross-tenant resurrection today. ⚠️ That is an
  -- INCIDENTAL save, not a designed one: it evaporates the moment `created_by`
  -- becomes nullable or a future overload accepts it as a parameter. And 23502
  -- reads as "some database hiccup", not "you called this wrong" — the route
  -- would log a constraint error and nobody would learn that an admin client
  -- must never take this path. The guard converts an accident into a contract.
  -- (Contrast revoke_strategy_share, where the missing guard was NOT
  -- incidental: it revoked another tenant's live share and returned 1.)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'create_strategy_share: no authenticated user — not callable by a service-role/admin client'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_strategy_id IS NULL THEN
    RAISE EXCEPTION 'create_strategy_share: p_strategy_id must not be NULL'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- Atomic reactivate-or-insert. ⛔ generation is deliberately ABSENT from the
  -- DO UPDATE SET list: reactivation must NOT rewind the counter, or every
  -- previously revoked link would come back to life. created_by/created_at are
  -- likewise never rewritten — the row keeps its original provenance.
  --
  -- ⛔⛔ `nonce` MUST NOT APPEAR IN THE COLUMN LIST OR THE DO UPDATE SET LIST,
  -- and this is a HARD constraint rather than a style note. STEP 2 grants
  -- `authenticated` INSERT on (strategy_id, created_by) only; PostgreSQL checks
  -- column privilege against the columns a statement NAMES, so the instant this
  -- statement names `nonce` this SECURITY INVOKER function starts failing 42501
  -- for every ordinary owner — and the "obvious fix" is to widen the grant,
  -- which re-opens the resurrection family. The nonce is populated by its column
  -- DEFAULT and read back through RETURNING (which needs only SELECT). STEP 6
  -- arm (ii-d) fails the apply if this ever changes.
  INSERT INTO public.strategy_shares (strategy_id, created_by)
  VALUES (p_strategy_id, auth.uid())
  ON CONFLICT (strategy_id) DO UPDATE
    SET revoked_at = NULL
  RETURNING strategy_shares.generation, strategy_shares.nonce
       INTO create_strategy_share.generation, create_strategy_share.nonce;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.create_strategy_share(UUID) IS
  'Phase 164 / SHARE-01. Atomic mint-or-reuse of a strategy share. Returns '
  '(generation, nonce); the caller derives the token as '
  'HMAC(SHARE_TOKEN_SECRET, over the tag "qz.strategy-share.v1" then '
  'strategy_id then nonce then generation) in Node — nothing token-derived is ever stored. ⛔ The body must '
  'never NAME `nonce` in the INSERT column list or the DO UPDATE SET list: '
  'STEP 2 grants authenticated INSERT on (strategy_id, created_by) only, and '
  'naming the column would make this SECURITY INVOKER function fail 42501 for '
  'every owner. It is DEFAULT-populated and read back via RETURNING. '
  'Idempotent while the share is live (the same generation AND the same nonce '
  'return the same url, which is what makes Copy Link reuse work). '
  'Reactivating a revoked share clears revoked_at WITHOUT rewinding generation, '
  'created_by or created_at, so revoked links stay dead. SECURITY INVOKER — '
  'RLS gates it as the caller and created_by is auth.uid() inside the body. '
  '⛔ RAISES insufficient_privilege when auth.uid() IS NULL. RLS does not apply '
  'to a BYPASSRLS role; without the guard such a caller gets an opaque 23502 on '
  'created_by (measured — the NOT NULL blocks the ON CONFLICT reactivation '
  'incidentally, and would stop doing so if created_by ever became nullable). '
  'Not callable by a service-role/admin client, by design.';

-- --------------------------------------------------------------------------
-- STEP 4: revoke_strategy_share(p_strategy_id) — atomic stamp + bump
-- --------------------------------------------------------------------------
-- ⭐ THE INCREMENT MUST BE IN-STATEMENT. `generation = generation + 1` is
-- column arithmetic evaluated by the server against the row it is locking; a
-- client library cannot express it (it would have to SELECT the value, add one
-- and write it back — a read-modify-write whose lost update, under two
-- concurrent revokes, leaves the counter one short and a supposedly-revoked
-- link ALIVE). This RPC exists precisely to make the stamp and the bump one
-- indivisible act.
--
-- Returns the number of rows affected, NOT a boolean:
--   * 1 -> a live share was just revoked;
--   * 0 -> already revoked, or never shared. That is CONVERGENCE, not failure.
--     The route maps 0 to a 404 (matching the scenario revoke route, which
--     returns 404 rather than 403 so it is not an existence oracle) and the
--     client treats it as success — the caller's intent ("this link must be
--     dead") is satisfied either way.
--
-- Soft-revoke ONLY — never DELETE. See the REVOKE DELETE in STEP 2 for why a
-- hard delete would resurrect revoked tokens.
--
-- SECURITY INVOKER: the `strategy_shares_owner` USING clause scopes the UPDATE
-- to the caller's own rows, so another tenant's strategy_id matches 0 rows and
-- takes the indistinguishable 0-row exit.
CREATE OR REPLACE FUNCTION public.revoke_strategy_share(p_strategy_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  -- ⛔ FAIL LOUD for a caller with no authenticated identity (founder ruling
  -- 2026-08-27), and BEFORE the p_strategy_id convergence exit below — an
  -- admin client passing NULL must not receive the indistinguishable 0.
  -- Without this guard a `service_role` caller (BYPASSRLS — and STEP 2 records
  -- that this feature's recipient lane already reads this table through
  -- `createAdminClient()`) reaches the UPDATE with NO policy applied, revokes
  -- ANY tenant's live share and gets `1` back: a silent cross-tenant kill
  -- switch that reports success. The ownership predicate below closes the same
  -- hole from the other side; a 0-row return would not be enough on its own,
  -- because the route maps 0 to a 404 the client reads as SUCCESS.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'revoke_strategy_share: no authenticated user — not callable by a service-role/admin client'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_strategy_id IS NULL THEN
    RETURN 0;   -- nothing to revoke; converges like any other miss
  END IF;

  -- ⭐ `created_by = auth.uid()` is LOAD-BEARING, not a restatement of the
  -- policy. For an ordinary `authenticated` caller the strategy_shares_owner
  -- USING clause already scopes this UPDATE; for a BYPASSRLS role it does not,
  -- and this predicate is then the ONLY thing standing between the caller and
  -- another tenant's counter. Defense-in-depth behind the guard above.
  UPDATE public.strategy_shares
     SET revoked_at = now(),
         generation = generation + 1
   WHERE strategy_id = p_strategy_id
     AND created_by = auth.uid()
     AND revoked_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.revoke_strategy_share(UUID) IS
  'Phase 164 / SHARE-03. Revokes a strategy share in ONE atomic statement: '
  'stamps revoked_at AND increments generation together, so every '
  'previously-copied link dies at the same instant and no read-modify-write '
  'race can leave the counter short. Returns the affected row count: 1 = just '
  'revoked, 0 = already revoked or never shared (CONVERGENCE — the route maps '
  'it to 404 and the client treats it as success). Soft-revoke only; rows are '
  'never deleted. SECURITY INVOKER — RLS scopes it to the caller''s own rows, '
  'and the UPDATE carries an independent `created_by = auth.uid()` predicate '
  'for the case where RLS does NOT apply. ⛔ RAISES insufficient_privilege when '
  'auth.uid() IS NULL: without that, a BYPASSRLS service-role caller was an '
  'unauthenticated cross-tenant kill switch that returned 1 and read as '
  'success. Not callable by a service-role/admin client, by design.';

-- --------------------------------------------------------------------------
-- STEP 5: function grants + PUBLIC-EXECUTE self-verify
-- --------------------------------------------------------------------------
-- Both RPCs are invoked by the authenticated owner only. anon must never reach
-- them (there is no anon lane in this design at all). REVOKE from PUBLIC/anon
-- as defense-in-depth against default-ACL drift, then GRANT to authenticated.
--
-- ⛔ `service_role` IS ON THE REVOKE LIST, and its absence was a real gap.
-- MEASURED on a PostgreSQL 16 replica carrying Supabase's default ACLs: with
-- the REVOKE naming only PUBLIC and anon, `aclexplode(proacl)` showed
-- service_role holding EXECUTE on BOTH functions — Supabase's `pg_default_acl`
-- grants every new function in `public` to anon/authenticated/service_role, and
-- revoking PUBLIC does not touch a grant made to a NAMED role. So both RPCs
-- shipped callable by the BYPASSRLS role. This REVOKE is what closes that, and
-- it matches the house posture (mig 20260515205431 revokes
-- _assert_no_public_execute from PUBLIC, anon, authenticated AND service_role
-- for the same reason).
--
-- ⛔⛔ AND THIS REVOKE IS THE ONLY WALL AGAINST `service_role`, NOT THE SECOND OF
-- TWO. An earlier version of this paragraph — and of STEP 3/4's comments —
-- claimed "two independent walls" for that caller, with the `auth.uid() IS
-- NULL` body guard as the other. THAT CLAIM WAS FALSE and it is corrected here
-- rather than quietly softened. `auth.uid()` reads `request.jwt.claims`, a GUC
-- the CALLER sets: any principal that can reach the function can also
-- `set_config('request.jwt.claims', ...)` first, at which point auth.uid() is
-- whatever they chose and the guard is satisfied.
-- MEASURED (throwaway PostgreSQL 16, 2026-08-28), with EXECUTE temporarily
-- granted so that only the body guard was under test:
--   SET LOCAL ROLE service_role;
--   PERFORM set_config('request.jwt.claims', '{"sub":"<VICTIM uuid>"}', true);
--   SELECT public.revoke_strategy_share('<victim strategy>');
--   -> rows=1, revoked_at stamped, generation 1 -> 2 on ANOTHER TENANT'S live
--      share, reported to the caller as success.
-- ⭐ WHAT THE BODY GUARD IS STILL WORTH, stated at its real size: it converts an
-- ACCIDENT into a CONTRACT. An admin client that reaches this function WITHOUT
-- having set claims — which is what `createAdminClient()` does — gets a loud,
-- named refusal instead of an opaque 23502 (create) or a silent cross-tenant
-- revoke returning 1 (revoke). It is a correctness guard against the honest
-- mistake, not a security boundary against a deliberate one. The incremental
-- capability it withholds from a principal that already holds `GRANT ALL` on
-- this table and BYPASSRLS is nil — such a principal can simply UPDATE the row.
-- ⚠️ A `pg_has_role(current_user, 'service_role', 'member')` assertion was
-- EVALUATED as hardening and NOT SHIPPED, because it could not be shown to
-- leave every intended caller working. MEASURED on the same cluster:
-- `pg_has_role(current_user,'service_role','member')` is TRUE for `postgres` —
-- superusers are members of every role — so the assertion would refuse these
-- SECURITY INVOKER RPCs to any psql/migration/SQL-editor session, which is a
-- larger and less visible regression than the accident it would prevent. It is
-- recorded here so the next reader does not re-derive it and ship it.
REVOKE ALL ON FUNCTION public.create_strategy_share(UUID) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.revoke_strategy_share(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_strategy_share(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_strategy_share(UUID) TO authenticated;

-- Self-verify with the mig-134 canon (CALL it; do NOT redefine the helper).
-- Aborts the apply if PUBLIC retained EXECUTE — a grant we cannot revoke is a
-- real CRITICAL and the apply MUST fail rather than ship a quiet leak.
--
-- ⚠️ THE REVOKE ABOVE IS NOT THE DURABLE CONTROL, and must not be read as one.
-- This repo has MEASURED that REVOKE does not survive: `pg_default_acl` re-grants
-- on any DROP+CREATE, "and that is a CLASS" (ROADMAP.md:1534; it bit
-- mig 20260812083206 for anon, recorded at 20260826130000 §(v)). The block below
-- makes THIS apply fail loudly if the revoke did not take; the control that keeps
-- biting on every future CI run is `SERVICE-ROLE 0-acl` in
-- supabase/tests/test_strategy_shares_rls.sql, which reads the LIVE ACL out of
-- aclexplode(pg_proc.proacl) rather than trusting a comment or a marker.
DO $$
BEGIN
  PERFORM public._assert_no_public_execute('public.create_strategy_share(uuid)');
  PERFORM public._assert_no_public_execute('public.revoke_strategy_share(uuid)');

  IF has_function_privilege('service_role', 'public.create_strategy_share(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: service_role retains EXECUTE on create_strategy_share after the REVOKE. That role is BYPASSRLS and is exactly what createAdminClient() connects as, and this REVOKE is the ONLY wall against it — the auth.uid() fail-loud guard in the body is NOT a second one, because auth.uid() reads the caller-settable request.jwt.claims GUC and MEASURED (2026-08-28) a service_role call that sets it first revokes another tenant''s live share and is told it succeeded. With the grant back, nothing stands between an admin transport and an ON CONFLICT reactivation of someone else''s revoked share.';
  END IF;
  IF has_function_privilege('service_role', 'public.revoke_strategy_share(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: service_role retains EXECUTE on revoke_strategy_share after the REVOKE. That role is BYPASSRLS, so with the body guard also gone this RPC is an unauthenticated cross-tenant kill switch that revokes any tenant''s live share and returns 1.';
  END IF;

  RAISE NOTICE 'Migration 164-02: EXECUTE absence verified for PUBLIC and service_role on create_strategy_share + revoke_strategy_share.';
END $$;

-- --------------------------------------------------------------------------
-- STEP 6: body-shape self-assert (defense-in-depth; mirrors mig 117 STEP 7)
-- --------------------------------------------------------------------------
-- The two properties this phase's security rests on are both invisible to a
-- "did it return 200" test and both FAIL SILENTLY if a future CREATE OR REPLACE
-- drops them:
--   (i)  revoke must INCREMENT generation (drop it and revocation becomes
--        cosmetic — revoked_at is stamped, the token still derives, every
--        "revoked" link keeps working);
--   (ii) mint must NOT assign generation (assign it and reactivation rewinds
--        the counter, resurrecting revoked links).
--
-- ⚠️ WHAT THIS BLOCK IS AND IS NOT. A `DO` block runs ONCE, at this migration's
-- apply, and never again — so it CANNOT "fail the apply" of some future
-- loosening. An earlier draft of this comment claimed it could; that was
-- wrong. What it actually buys is a guard on THIS apply against an authoring
-- slip: if the body above were edited between review and apply, or if a
-- concurrently-applied migration redefined either RPC first, the apply aborts
-- instead of silently deploying a body nobody checked. The DURABLE pin — the
-- one that keeps biting on every future CI run — is
-- `supabase/tests/test_strategy_shares_rls.sql`, which re-asserts every
-- property below against the LIVE database. Both are needed; neither
-- substitutes for the other.
DO $$
DECLARE
  v_create   TEXT;
  v_revoke   TEXT;
  v_create_s TEXT;
  v_revoke_s TEXT;
  v_secdef   BOOLEAN;
  v_trg      INTEGER;
  v_trigfn   TEXT;
  v_trigfn_s TEXT;
  v_create_res TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_create
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_strategy_share'
     AND pg_get_function_identity_arguments(p.oid) = 'p_strategy_id uuid';
  SELECT pg_get_functiondef(p.oid) INTO v_revoke
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'revoke_strategy_share'
     AND pg_get_function_identity_arguments(p.oid) = 'p_strategy_id uuid';

  IF v_create IS NULL OR v_revoke IS NULL THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: a share RPC is missing post-create (create present: %, revoke present: %)',
      (v_create IS NOT NULL), (v_revoke IS NOT NULL);
  END IF;

  -- ⛔ Strip `--` line comments before any LIVE-STATEMENT probe below.
  -- pg_get_functiondef returns in-body comments VERBATIM, so a probe run
  -- against the raw text can be satisfied by a comment that merely DESCRIBES
  -- the mechanism — and both bodies above are heavily commented with the exact
  -- phrases the arms look for. This repo has already been bitten by that
  -- (mig 20260517013100 STEP 2 carries the same guard for the same reason).
  v_create_s := regexp_replace(v_create, '--[^\n]*', '', 'g');
  v_revoke_s := regexp_replace(v_revoke, '--[^\n]*', '', 'g');

  -- (i) revoke increments the counter, in-statement.
  IF v_revoke_s !~* 'generation\s*=\s*generation\s*\+\s*1' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: revoke_strategy_share lost the atomic `generation = generation + 1` bump — revocation would be COSMETIC and every revoked link would keep working';
  END IF;

  -- (i-b) ...and only over rows that are still live, so a double-revoke cannot
  -- keep inflating the counter (0 rows is the convergence contract).
  IF v_revoke_s !~* 'revoked_at\s+IS\s+NULL' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: revoke_strategy_share lost the `revoked_at IS NULL` predicate — double-revoke would no longer converge at 0 rows';
  END IF;

  -- (i-c) soft-revoke only.
  -- `\M` (end of word), NOT `\m`, closes the anchor: `\m` after FROM demands
  -- the position be a word START, which it never is, and the arm would be
  -- silently vacuous.
  IF v_revoke_s ~* '\mDELETE\s+FROM\M' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: revoke_strategy_share performs a DELETE — revocation must be a soft tombstone, or re-sharing resets generation and RESURRECTS revoked links';
  END IF;

  -- (ii) mint never writes generation.
  -- RED-UNDER: add `, generation = 1` to the DO UPDATE SET list in STEP 3.
  IF v_create_s ~* 'SET[^;]*\mgeneration\s*=' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: create_strategy_share assigns `generation` — reactivation must never rewind the counter (revoked links would come back to life)';
  END IF;

  -- (ii-d) mint never NAMES `nonce` as a write target. This is not a duplicate
  -- of STEP 2b's grant pin: the grant pin proves the PRIVILEGE is absent, this
  -- proves the STATEMENT does not need it. They fail on opposite edits, and
  -- naming the column is the edit that makes someone WIDEN the grant to "fix"
  -- the resulting 42501 — which is how the resurrection family comes back.
  -- The nonce is DEFAULT-populated; RETURNING reads it back on SELECT alone.
  -- RED-UNDER: add `nonce` to the INSERT column list in STEP 3
  --            (`INSERT INTO public.strategy_shares (strategy_id, created_by, nonce)`).
  IF v_create_s ~* 'INSERT\s+INTO\s+public\.strategy_shares\s*\([^)]*\mnonce\M'
     OR v_create_s ~* 'SET[^;]*\mnonce\s*=' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: create_strategy_share NAMES `nonce` as a write target. PostgreSQL checks column privilege against the columns a statement names, and STEP 2 grants authenticated INSERT on (strategy_id, created_by) only — so this SECURITY INVOKER function now fails 42501 for every owner, and the obvious remedy (widening the grant) re-opens the delete-and-recreate resurrection family the nonce exists to close. The nonce must stay DEFAULT-populated and read back via RETURNING.';
  END IF;

  -- (ii-e) ...but the mint MUST hand the nonce back, or the route cannot derive
  -- the token at all. Catalog-based, not a text probe: the OUT-parameter set is
  -- the contract the Node caller is typed against, and a body that computed the
  -- nonce into a local and dropped it would satisfy any regex over the text.
  -- RED-UNDER: delete `OUT nonce UUID` from the STEP 3 signature (and the
  --            matching RETURNING/INTO targets).
  SELECT pg_get_function_result(p.oid) INTO v_create_res
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_strategy_share'
     AND pg_get_function_identity_arguments(p.oid) = 'p_strategy_id uuid';
  IF v_create_res IS NULL
     OR v_create_res !~* 'TABLE\s*\([^)]*\mnonce\s+uuid\M'
     OR v_create_res !~* 'TABLE\s*\([^)]*\mgeneration\s+bigint\M' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: create_strategy_share does not declare `TABLE(generation bigint, nonce uuid)` — its declared result is "%". The token is HMAC(secret, tag then strategy_id then nonce then generation — written without pipes because src/__tests__/raise-exception-concat-grammar.test.ts forbids them anywhere in a RAISE format slot, and it is right to: PL/pgSQL needs that slot to be ONE literal, so a real concat there is SQLSTATE 42601 at apply and a guard cannot tell prose from code); with no nonce coming back the mint route cannot derive a link at all, and the temptation is to drop the nonce from the pre-image, which silently restores the pre-fix resurrection behaviour. ⛔ A bare `record` here means someone converted the signature to OUT parameters — that ALSO changes pg_get_function_identity_arguments and silently voids every `= ''p_strategy_id uuid''` lookup in this file and in test_strategy_shares_rls.sql.',
      COALESCE(v_create_res, '(function not found)');
  END IF;

  -- (ii-b) BOTH RPCs refuse a caller with NO authenticated identity. ⚠️ Read
  -- that literally — "no identity", not "the wrong identity". RLS does not apply
  -- to a BYPASSRLS role, so for `service_role` this is the only thing in the
  -- body that looks at who is calling; but `auth.uid()` reads the
  -- caller-settable `request.jwt.claims` GUC, so it stops the admin client that
  -- arrives WITHOUT claims (the honest mistake) and not one that sets them first
  -- (MEASURED 2026-08-28 — see STEP 5). It is a contract, not a wall; the wall
  -- against that role is STEP 5's EXECUTE revoke, pinned durably by
  -- SERVICE-ROLE 0-acl. Probed against the comment-stripped body precisely
  -- because both bodies discuss this guard in prose.
  IF v_create_s !~* 'auth\.uid\s*\(\s*\)\s+IS\s+NULL'
     OR v_revoke_s !~* 'auth\.uid\s*\(\s*\)\s+IS\s+NULL' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: a strategy-share RPC lost its `auth.uid() IS NULL` fail-loud guard — a service-role/admin client would reach the body with RLS not applied. MEASURED consequences: revoke becomes an unauthenticated cross-tenant kill switch that revokes another tenant''s live share and RETURNS 1; create degrades to an opaque 23502 on created_by, whose NOT NULL is the only (incidental) thing preventing an ON CONFLICT reactivation of someone else''s revoked share';
  END IF;

  -- (ii-c) revoke carries its OWN ownership predicate, independent of the
  -- policy. Drop it and the only cross-tenant wall left is RLS — which the
  -- BYPASSRLS role the recipient lane already uses does not obey.
  IF v_revoke_s !~* 'created_by\s*=\s*auth\.uid\s*\(\s*\)' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: revoke_strategy_share lost the `created_by = auth.uid()` predicate on its UPDATE — for any BYPASSRLS caller the statement would revoke ANY tenant''s share and report success';
  END IF;

  -- (iii) neither RPC is SECURITY DEFINER: RLS is the ownership wall here, and
  -- a DEFINER body would bypass the CR-01 owner-coherence WITH CHECK entirely.
  FOR v_secdef IN
    SELECT p.prosecdef
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('create_strategy_share', 'revoke_strategy_share')
  LOOP
    IF v_secdef THEN
      RAISE EXCEPTION 'Migration 164-02 verification failed: a strategy-share RPC is SECURITY DEFINER — it would bypass the strategy_shares_owner RLS policy that is the ONLY cross-tenant wall on this surface';
    END IF;
  END LOOP;

  -- (iv) search-path hardening present on both (pg_get_functiondef emits
  -- `SET search_path TO public, pg_temp`; accept TO or =).
  IF v_create_s !~* 'search_path\s*(=|TO)\s*''?public''?,\s*''?pg_temp''?'
     OR v_revoke_s !~* 'search_path\s*(=|TO)\s*''?public''?,\s*''?pg_temp''?' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: a strategy-share RPC is missing SET search_path = public, pg_temp';
  END IF;

  -- (v) the STEP 1b monotonicity trigger is installed, and installed with the
  -- right shape. BEFORE (not AFTER — an AFTER trigger cannot veto the write by
  -- returning NULL and would have to rely on raising, which it still can, but
  -- the row would already have been written for any AFTER trigger ordered
  -- before it) and FOR EACH ROW (a STATEMENT-level trigger has no OLD/NEW at
  -- all, so the comparison would be a runtime error rather than a guard).
  -- tgtype bit 0 = ROW, bit 1 = BEFORE, bit 2 = INSERT, bit 4 = UPDATE.
  -- ⛔ THE INSERT BIT IS ASSERTED SEPARATELY AND ON PURPOSE (164-06). The old
  -- form omitted it, and `&` masking means a trigger narrowed back to
  -- `BEFORE UPDATE` would have satisfied every remaining term — the R3 INSERT
  -- pin could be deleted without this block noticing. Each event the guard
  -- claims to cover needs its own bit test.
  SELECT count(*) INTO v_trg
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.strategy_shares'::regclass
     AND NOT t.tgisinternal
     AND t.tgname = 'strategy_shares_monotonic_generation'
     AND (t.tgtype & 1) = 1
     AND (t.tgtype & 2) = 2
     AND (t.tgtype & 4) = 4
     AND (t.tgtype & 16) = 16;
  IF v_trg <> 1 THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: the BEFORE INSERT OR UPDATE FOR EACH ROW trigger strategy_shares_monotonic_generation is absent or misshapen (matching triggers: %). Without its UPDATE half an owner can PATCH their own row back to a revoked generation and clear revoked_at, resurrecting every link they revoked; without its INSERT half a BYPASSRLS role can land a fresh row at any starting counter it likes, which no column grant reaches — both MEASURED, neither hypothetical.', v_trg;
  END IF;

  -- (v-b) ...and it still carries ALL FOUR rules. (v) above proves a trigger of
  -- the right timing and level EXISTS; it says nothing about what the function
  -- behind it compares, so a `CREATE OR REPLACE` that quietly drops one rule
  -- passes (v) unchanged. Each rule closes a DIFFERENT route to the same end
  -- state — a token that was revoked resolving again — so each needs its own
  -- probe. Comment-stripped for the usual reason (mig 20260517013100 STEP 2):
  -- pg_get_functiondef returns in-body comments verbatim and this body labels
  -- its rules in prose, so a raw-text probe could be satisfied by the label
  -- rather than by the code. ⚠️ Apply-time only, like every DO block here — the
  -- DURABLE pins are the behavioural TRIGGER 1-4 arms in
  -- supabase/tests/test_strategy_shares_rls.sql, which break the invariant
  -- against the live database instead of grepping a body.
  SELECT pg_get_functiondef(p.oid) INTO v_trigfn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'strategy_shares_enforce_monotonic_generation';
  IF v_trigfn IS NULL THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: the trigger function public.strategy_shares_enforce_monotonic_generation() could not be read, so every rule probe below would be VACUOUSLY true on NULL';
  END IF;
  v_trigfn_s := regexp_replace(v_trigfn, '--[^\n]*', '', 'g');

  IF v_trigfn_s !~* 'NEW\.strategy_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.strategy_id' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: the monotonicity trigger lost rule (0a) — it no longer compares NEW.strategy_id to OLD.strategy_id. The owner can then re-point their share row at a second strategy they own in ONE PATCH (USING passes, the CR-01 WITH CHECK passes, UNIQUE(strategy_id) is free), leaving the original strategy with no row; create_strategy_share() on it then inserts at generation 1 and every token that strategy revoked at generation 1 works again.';
  END IF;

  IF v_trigfn_s !~* 'NEW\.id\s+IS\s+DISTINCT\s+FROM\s+OLD\.id'
     OR v_trigfn_s !~* 'NEW\.created_by\s+IS\s+DISTINCT\s+FROM\s+OLD\.created_by'
     OR v_trigfn_s !~* 'NEW\.created_at\s+IS\s+DISTINCT\s+FROM\s+OLD\.created_at' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: the monotonicity trigger lost rule (0b) — id, created_by and created_at are no longer pinned. STEP 3 of this file tells every reader that reactivation never rewrites provenance; without the rule a raw PATCH does exactly that, forging who minted a live anonymous capability link and when.';
  END IF;

  IF v_trigfn_s !~* 'NEW\.generation\s*<\s*OLD\.generation' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: the monotonicity trigger lost rule (1) — it no longer refuses a generation REWIND, which is the single-request form of the resurrection above (MEASURED: generation 2 -> 1 with revoked_at cleared, from an ordinary owner token).';
  END IF;

  IF v_trigfn_s !~* 'OLD\.revoked_at\s+IS\s+NULL'
     OR v_trigfn_s !~* 'NEW\.generation\s*<=\s*OLD\.generation' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: the monotonicity trigger lost rule (2) — a revocation is no longer required to ADVANCE generation. A raw tombstone at the same counter is COSMETIC: the row drops out of the active scan, and the next create_strategy_share() clears it at the SAME generation and brings the supposedly-revoked token back to life.';
  END IF;

  -- (v-c) ...and rule (0c), the nonce pin. Its own probe rather than a fourth
  -- column folded into the (0b) check above, because it guards a different
  -- actor: STEP 2's column grant already denies an `authenticated` write naming
  -- `nonce`, so the ONLY caller this rule can ever fire for is one that bypasses
  -- grants — service_role. Deleting it is therefore invisible to every
  -- client-role arm in this file and in test_strategy_shares_rls.sql except the
  -- one that runs AS service_role.
  -- RED-UNDER: delete the `IF NEW.nonce IS DISTINCT FROM OLD.nonce` block from
  --            strategy_shares_enforce_monotonic_generation() in STEP 1b.
  IF v_trigfn_s !~* 'NEW\.nonce\s+IS\s+DISTINCT\s+FROM\s+OLD\.nonce' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: the monotonicity trigger lost rule (0c) — the nonce is no longer immutable. MEASURED with the rule absent: `SET ROLE service_role; UPDATE strategy_shares SET nonce = <a value recorded before the row was destroyed>` was ACCEPTED. Restoring a recorded nonce re-derives every token that row ever issued, which is the whole resurrection family walking back in through the one role that GRANTs cannot bind.';
  END IF;

  -- (v-d) ...and the INSERT branch, which is the ONLY control that pins the
  -- starting counter for a role that bypasses grants. Two probes, not one: the
  -- TG_OP guard without the assignment is a no-op branch, and the assignment
  -- without the guard would try to read OLD on an UPDATE path it does not
  -- belong to. Deleting either is invisible to every UPDATE-side arm above.
  -- RED-UNDER: delete the `IF TG_OP = 'INSERT' THEN NEW.generation := 1;
  --            RETURN NEW; END IF;` block from STEP 1b.
  IF v_trigfn_s !~* 'TG_OP\s*=\s*''INSERT'''
     OR v_trigfn_s !~* 'NEW\.generation\s*:=\s*1' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: the monotonicity trigger lost its INSERT branch — generation is no longer FORCED to 1 on insert. STEP 2 omits the column from authenticated''s INSERT grant, so this rule''s only caller is one that BYPASSES grants: service_role, which holds GRANT ALL and is on this feature''s hot path. Such a caller could then land a fresh row at a chosen starting counter, and a row minted at a generation some revoked token already used re-issues that token.';
  END IF;

  -- (v-d2) ...and the INSERT branch FORCES THE NONCE too. Its own probe, beside
  -- the `NEW.generation := 1` one above, because the two assignments close
  -- different halves of the same attack and deleting either is invisible to the
  -- other: forcing the counter alone still leaves the nonce caller-supplied, and
  -- re-rolling the nonce alone still leaves the counter caller-supplied. Both
  -- are needed for a destroyed-and-recreated row to land in a token space
  -- DISJOINT from every token that row ever issued.
  -- RED-UNDER: delete the `NEW.nonce := gen_random_uuid();` assignment from the
  --            `IF TG_OP = 'INSERT'` branch of STEP 1b.
  IF v_trigfn_s !~* 'NEW\.nonce\s*:=' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: the monotonicity trigger''s INSERT branch no longer FORCES the nonce. The column DEFAULT does not cover this — a DEFAULT applies only when the statement does not NAME the column, STEP 2''s grant stops `authenticated` from naming it and nobody else, and rule (0c) is UPDATE-only by construction. MEASURED with the assignment absent: mint (generation 1, nonce N), revoke (generation 2, so the token over (N, 1) is dead), `SET ROLE service_role; DELETE FROM strategy_shares`, then `SET ROLE service_role; INSERT INTO strategy_shares (strategy_id, created_by, nonce) VALUES (..., N)` — the stored row came back at generation 1 with nonce N and revoked_at NULL, a (nonce, generation, live) triple byte-identical to the pre-revoke one, which re-derives the REVOKED token and fully reverses a completed Art. 17 erasure.';
  END IF;

  -- (v-e) ...and rule (6), the bounded increment. This is N1's closure and it
  -- is the reason nothing on this surface carries an overflow handler: with the
  -- rule gone, one PATCH sets generation to 2^63-1 and the GDPR Art. 17 arm in
  -- migration 20260827130000 — the same generation + 1 statement — aborts the
  -- data subject's own erasure with 22003 (MEASURED 2026-08-27).
  -- RED-UNDER: delete the `IF NEW.generation > OLD.generation + 1` block from
  --            strategy_shares_enforce_monotonic_generation() in STEP 1b.
  IF v_trigfn_s !~* 'NEW\.generation\s*>\s*OLD\.generation\s*\+\s*1' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: the monotonicity trigger lost rule (6) — an UPDATE is no longer bounded to advancing generation by AT MOST ONE. Rule (1) forbids only a DECREASE, so the owner''s UPDATE(generation) column grant then reaches the BIGINT ceiling in a single PATCH, after which revoke_strategy_share WEDGES on 22003 and sanitize_user ABORTS THE ENTIRE ART. 17 ERASURE on the same statement. A data subject can wedge their own erasure with data they control, and the overflow that this file argues is unreachable by construction becomes reachable in one request.';
  END IF;

  RAISE NOTICE 'Migration 164-02: share RPC body-shape verified (atomic bump + live-only predicate + no delete + no generation rewind + mint never names nonce + mint returns nonce + auth.uid() fail-loud + revoke ownership predicate + INVOKER + search_path + monotonicity trigger present on INSERT AND UPDATE AND carrying all six rules plus the INSERT pin: forced-1-on-insert, forced-nonce-on-insert, strategy_id pin, provenance pin, nonce pin, no-rewind, revocation-advances, at-most-plus-one).';
END $$;

-- --------------------------------------------------------------------------
-- STEP 7: no-token-at-rest self-assert (D-02, threat T-164-07)
-- --------------------------------------------------------------------------
-- The single most important property of this table is a NEGATIVE one: it holds
-- no secret. A future ALTER that adds a `token`/`token_hash`/`secret` column
-- would reintroduce exactly the disclosure surface D-02 rejected, and nothing
-- else in the stack would notice.
--
-- ⚠️ Same caveat as STEP 6: this DO block runs ONCE, at THIS apply. It cannot
-- reach forward and fail a future ALTER's apply — an earlier draft of this
-- comment said it could, and that was wrong. Here it pins the shape the rest
-- of this migration was reviewed against. The DURABLE pin, the one a future
-- token column actually trips, is the identical assertion in
-- supabase/tests/test_strategy_shares_rls.sql, which runs on every CI push.
--
-- Read the column set from pg_attribute, NOT information_schema.columns: that
-- view is PRIVILEGE-FILTERED (it only shows columns the current role has some
-- privilege on), so a role with partial privileges would see a SHORT list —
-- and a short list is DISTINCT FROM the expected string, which fails loudly
-- here but would report the wrong cause. pg_attribute is the authoritative
-- catalog and is not filtered.
DO $$
DECLARE
  v_cols TEXT;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.strategy_shares'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped;

  -- ⚠️ `nonce` IS IN THIS SET AND IS NOT A TOKEN. The distinction is the one
  -- D-02 actually draws: a token (raw or hashed) is a value that, ON ITS OWN,
  -- reproduces or verifies a working link. The nonce is a MAC *input* — it
  -- derives nothing without SHARE_TOKEN_SECRET, which is not in this database.
  -- A leak of this table still yields only uuids, an integer and timestamps.
  --
  -- RED-UNDER: add a `token_hash TEXT` column to the STEP 1 CREATE TABLE.
  -- ⚠️ AND NOT the other direction, stated honestly rather than claimed: this
  -- arm CANNOT be the first failure for a DELETED `nonce`. That column is
  -- load-bearing in four places that all execute earlier — the COMMENT ON
  -- COLUMN (STEP 1), `INCLUDE (nonce)` on the active index, trigger rule (0c),
  -- and the RETURNING in STEP 3 — so removing it aborts the apply long before
  -- STEP 7 runs (MEASURED: `column "nonce" of relation "strategy_shares" does
  -- not exist`, at the COMMENT). The nonce's PRESENCE is therefore pinned
  -- structurally by the DDL, and what this arm uniquely detects is a column
  -- ADDED at rest. It is listed in the expected set because the set must be
  -- exact, not because this arm is what defends it.
  IF v_cols IS DISTINCT FROM 'created_at,created_by,generation,id,nonce,revoked_at,strategy_id' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: strategy_shares column set is "%", expected exactly "created_at,created_by,generation,id,nonce,revoked_at,strategy_id". ⛔ D-02: this table must NEVER hold a token, raw or hashed. ⚠️ `nonce` belongs in that set and is NOT a token — it derives nothing without SHARE_TOKEN_SECRET, which is not in this database.', v_cols;
  END IF;

  RAISE NOTICE 'Migration 164-02: strategy_shares holds no token at rest, and the nonce is present (column set pinned).';
END $$;

COMMIT;
