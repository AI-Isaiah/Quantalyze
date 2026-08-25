---
phase: 162-honest-what-the-user-sees-is-true
plan: 05
subsystem: wizard-connect-key
status: complete
tags: [security, tenant-boundary, security-definer, wizard, orphaned-key, D-162-3]
requires:
  - "supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql (the service-role-only wizard-writer posture this copies)"
  - "supabase/migrations/20260410225608_api_keys_column_revoke.sql + 20260422101911_api_keys_disconnected_at.sql (the column grants that make the user-scoped re-read live)"
provides:
  - "SQL function public.create_wizard_strategy_for_key(uuid, uuid, text, uuid)"
  - "POST /api/strategies/create-with-key request field `reuse_api_key_id`"
  - "wizard error code KEY_REUSE_UNAVAILABLE"
  - "supabase/tests/test_create_wizard_strategy_for_key.sql (9-arm recurring gate)"
affects:
  - "162-06 (client thread) consumes the request field + draft-arm envelope pinned here"
  - "162-06 makes KEY_ORPHANED's second fix[] line false for the owner population — see Handoff"
tech-stack:
  added: []
  patterns:
    - "layered tenant boundary: session-uid filter on an RLS-bypassing admin read + user-scoped RLS re-read (fail-closed) + in-RPC ownership assertion"
    - "comment-stripped SQL body assertions with a prose-only canary proving the stripper ran"
    - "negative SQL assertion paired with a positive control against a function known to match"
key-files:
  created:
    - supabase/migrations/20260826130000_create_wizard_strategy_for_key.sql
    - supabase/tests/test_create_wizard_strategy_for_key.sql
  modified:
    - src/app/api/strategies/create-with-key/route.ts
    - src/app/api/strategies/create-with-key/route.test.ts
    - src/lib/wizardErrors.ts
    - src/lib/wizardErrors.test.ts
    - src/lib/wizardErrors.invariant.test.ts
    - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
    - .github/workflows/ci.yml
decisions:
  - "Task 1 shape = new-rpc (pre-decided, 162-05-DECISION.md): a function containing no api_keys INSERT makes T-162-05-B structural, and create_wizard_strategy stays byte-untouched"
  - "The connected-key refusal REUSES VENUE_ALREADY_CONNECTED — true clause for clause, remedy reachable — so no code was minted for it"
  - "One NEW code, KEY_REUSE_UNAVAILABLE, for not-yours / gone / disconnected. Three distinguishable refusals would be an ownership oracle for key ids; no incumbent was honest (each near-miss read at the emitter, recorded in the union docblock)"
  - "The SQL gate HARD-FAILS on the absent function rather than skipping — the plan's state-adaptive shape was reversed at HEAD on 2026-08-25 and CI now rejects it (deviation, below)"
  - "The venue comes out of the api_keys ROW, not off the wire: the new function has no venue parameter at all, a strictly narrower surface than create_wizard_strategy's"
metrics:
  duration: "~1h20m"
  completed: 2026-08-26
  tasks: 3
  commits: 2
actuals:
  tokens: 61000
  tasks: 3
  commits: 2
---

# Phase 162 Plan 05: Use-Existing-Key Server Path Summary

An owner's orphaned `api_keys` row can now become a wizard draft strategy through one
committed, tested, service-role-gated path that never writes `api_keys` — closing the
measured `KEY_ORPHANED` loop in which "Finish setup →" reopened the wizard onto a refusal
whose own copy had to tell the user the remedy was unreachable.

## What shipped

**`supabase/migrations/20260826130000_create_wizard_strategy_for_key.sql`** — a new
SECURITY DEFINER writer, `create_wizard_strategy_for_key(p_user_id, p_api_key_id,
p_placeholder_name, p_wizard_session_id)`:

- `service_role`-only EXECUTE (REVOKE from PUBLIC/anon/authenticated, GRANT to
  service_role) **plus** an in-body `auth.role()` gate with the fail-closed wrapper from
  `20260814120000`. The in-body gate is an active control, not future-proofing: callers
  holding EXECUTE by *ownership* (`postgres`, migration sessions, the psql SQL-test
  harness) sail past the REVOKE and land on it.
- An in-body **ownership assertion** joining `api_keys.user_id` to the passed uid and
  requiring `disconnected_at IS NULL`. One raise (`no_data_found`) covers not-yours /
  absent / disconnected — three distinguishable raises would be an ownership oracle.
- A **connected refusal** (`object_in_use`) covering both `strategies.api_key_id` *and*
  `strategy_keys.api_key_id`. The second is the route resolver's blind spot: a composite
  member links through `strategy_keys` while `strategies.api_key_id` stays NULL, so the
  route's two-read measurement would report a live composite member as an orphan. This is
  the last line before the INSERT and it is where that gap is closed.
- The advisory-lock + select-existing idempotency fence, keyed on `wizreuse:<uid>:<key>`
  rather than on the wizard session — the population this serves *lost* its localStorage
  session token, which is how the key became orphaned, so a session-keyed fence would let
  every retry mint another draft.
- **No `api_keys` INSERT anywhere in the body.** `create_wizard_strategy` is byte-untouched.
- The venue is read out of the `api_keys` row, so the function carries **no venue
  parameter** — a strictly narrower attestation surface than the twin's.
- Header states, in the first paragraph, that merging `supabase/migrations/**` to `main`
  AUTO-APPLIES the file to PRODUCTION, and documents the accepted T-162-05-E ceiling.

**Route (`create-with-key/route.ts`)** — optional `reuse_api_key_id`, branching before
every credential-shape guard because the arm carries no credentials. Three ownership
layers, then the two-read orphan discipline through the *same* resolver the venue fence
uses (extracted, not copied — `resolveStrategiesForKey`, behaviour byte-identical for the
existing caller), then the RPC with the fail-LOUD missing-credential posture. Success
answers the resolver's existing draft-arm envelope `{ ok, strategy_id, api_key_id }`.

**`supabase/tests/test_create_wizard_strategy_for_key.sql`** — nine arms (A–I) over the
live ACL and the live body, with two anti-vacuity controls described below.

## RED-witness evidence (verbatim)

### 1. The tenant boundary — neuter the ADMIN `.eq("user_id", user.id)`

Byte copy taken first; restore verified by checksum, never `git checkout --`.

```
pre-neuter  shasum -a 256 route.ts
4b496f49a70da6c046ebaef4a44ee5ed24ad59b34074dbf6b4eb39f0d5ae345e
```

Neutered (that one filter deleted), `npx vitest run route.test.ts -t "162-05"`:

```
     × the uid in EVERY filter and in the RPC comes from the SESSION, never from the body 12ms
     × the ADMIN re-select carries the session-uid filter — the one line that IS the tenant boundary 7ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected undefined to be '00000000-0000-0000-0000-aaaaaaaaaaaa' // Object.is equality
AssertionError: The admin client BYPASSES RLS, so tenant scoping on this read IS this filter and nothing else — and its value must come from withAuth's server-side session, never from the request body.: expected undefined to be '00000000-0000-0000-0000-aaaaaaaaaaaa' // Object.is equality
 Test Files  1 failed (1)
      Tests  2 failed | 20 passed | 127 skipped (149)
```

### 2. What that single neuter did NOT flip, and why — stated because it matters

With **both** `.eq("user_id", …)` filters removed (admin *and* user-scoped), the
behavioural cross-tenant refusal test still PASSED:

```
     × the uid in EVERY filter and in the RPC comes from the SESSION, never from the body 13ms
     × the ADMIN re-select carries the session-uid filter — the one line that IS the tenant boundary 15ms
     × the USER-SCOPED RLS re-read happens too, and is not a dead read 5ms
 Test Files  1 failed (1)
      Tests  3 failed | 19 passed | 127 skipped (149)
```

That is faithful, not a broken test: RLS enforces `user_id = auth.uid()` *inside the
database*, so deleting the route's redundant filter from the user-scoped read genuinely
does not open a cross-tenant hole, and the double models that. The real loss of the
property is layer 1's filter gone **and** layer 2's verdict ignored — which was then
measured:

```
     × the uid in EVERY filter and in the RPC comes from the SESSION, never from the body 12ms
     × the ADMIN re-select carries the session-uid filter — the one line that IS the tenant boundary 5ms
     × a key id the caller does NOT own is refused — no RPC, no write of any kind 8ms
 Test Files  1 failed (1)
      Tests  3 failed | 19 passed | 127 skipped (149)
```

So: the **structural** pin is the single-line witness for that filter, and the
**behavioural** cross-tenant test is not vacuous either — it reds when the property is
lost across both layers. Both facts are written into the test file's own docblock so a
reader who expects one neuter to redden everything is not misled.

### 3. Restore, verified byte-identical

```
4b496f49a70da6c046ebaef4a44ee5ed24ad59b34074dbf6b4eb39f0d5ae345e  src/app/api/strategies/create-with-key/route.ts
4b496f49a70da6c046ebaef4a44ee5ed24ad59b34074dbf6b4eb39f0d5ae345e  .../scratchpad/route.ts.orig

 Test Files  1 passed (1)
      Tests  149 passed (149)
```

### 4. The curated refusal-copy fence — witnessed RED too

`wizardErrors.ts` byte-copied (`bd0cc60cd3e12c0e536d35272a6ce6fbe6d5c6834312fbd5135e99c379bf32f1`),
`KEY_REUSE_UNAVAILABLE.cause` replaced with credential-blaming copy:

```
     × blames nothing about the caller's credentials — they were never received 11ms
     × claims 'nothing was created' — which BOTH emitters can actually establish 2ms
AssertionError: KEY_REUSE_UNAVAILABLE blames the caller's credentials. …: expected [ 'regenerate', 'check your key' ] to deeply equal []
AssertionError: …: expected 'we could not use that key. check your…' to contain 'nothing was created'
      Tests  2 failed | 2 passed | 229 skipped (233)
```

Restored, checksum re-verified identical, 233 passed.

## Deviations from Plan

### 1. [Rule 7 — conflicting patterns, pick the more recent] The SQL gate HARD-FAILS on the absent function instead of skipping

**Found during:** Task 3.
**Issue:** the plan specifies a *state-adaptive* gate ("SKIP when the function is absent,
ARM after", citing the Phase-156 pattern). That posture was **reversed at HEAD on
2026-08-25** by F8 (`test_get_verified_cohort_rank_gate.sql`) and WR-03
(`test_ledger_refresh_*.sql`), and `.github/workflows/ci.yml` now **fails** any SQL test
that prints a whole-file `SKIP:` notice, naming those files as the shape to copy. The
reasons recorded there are measured: a skip exits 0 and the CI step reads the exit code,
and nothing applies migrations to TEST so a skip can never re-arm itself.
**Fix:** the absent-function state raises at arm A, with a failure message naming both
candidate causes (TEST has not received the migration / a later migration dropped the
function), on the F8 template.
**Consequence, surfaced not hidden:** arm A **will fail once** on the PR that introduces
this migration, until `20260826130000` is applied to the TEST project. That is the
documented one-time cost of the HEAD posture.
**Files:** `supabase/tests/test_create_wizard_strategy_for_key.sql`.
**Commit:** `e3ca0e163`.

### 2. [Rule 2 — missing critical functionality] CI floors and derivation table updated

**Found during:** Task 3.
**Issue:** `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` re-derives the
sentinel-bearing file set, the per-file arm counts and both floors from the corpus, and
reds when a NEW sentinel-bearing file appears without the workflow moving in the same diff.
**Fix:** `SENTINEL_FLOOR` 6→7, `ARMS_FLOOR` 54→63, derivation table row
`test_create_wizard_strategy_for_key.sql  9`. Contract test green (18 passed).
**Files:** `.github/workflows/ci.yml`. **Commit:** `e3ca0e163`.

### 3. [Rule 2] The RPC's connected refusal also checks `strategy_keys`

**Found during:** Task 2.
**Issue:** the route's two-read resolver reads `strategies.api_key_id` only. A composite
member key links through `strategy_keys` while the composite's `strategies.api_key_id`
stays NULL, so the resolver reports a **live composite member as an orphan** — and this
plan turns that measurement into a *write*.
**Fix:** the in-RPC connected assertion checks both tables. The route maps the resulting
`object_in_use` to `VENUE_ALREADY_CONNECTED`. Pinned by a route test.
**Note:** the resolver's own `orphaned` arm is UNCHANGED (this is a pre-existing property
of that resolver, not something introduced here).

### 4. [Rule 1 — bug] `logLabel` was documented but unused

**Found during:** Task 2 lint. The extracted resolver took a `logLabel` parameter whose
docblock claimed it named which fence reported a dark read — and never used it. A claimed
property that does not exist. Fixed by interpolating it into both `console.error` sites;
the reuse arm's dark reads no longer log "venue-identity".

### 5. Hand-typed pins moved, each with its reasoning re-run

`EXPECTED_TABLE_SIZE` 89→90 (×2), `EXPECTED_409_CODES` 3→4 and its vacuity floor 3→4,
`expectedSites` 12→13 for create-with-key (one new 400 emitter: the combined
`wizard_session_id and reuse_api_key_id must be uuids` shape guard), and the
`KNOWN_CREATE_WITH_KEY_CODES` roster row. Each pin's docblock records *why* the number
moved, not just that it did.

## Verified facts (re-measured at HEAD, not inherited)

- **The user-scoped defence-in-depth read is live, not a dead read.** `id` and `user_id`
  are in the `api_keys` column allowlist at
  `20260410225608_api_keys_column_revoke.sql:79-89`; `disconnected_at` is granted at
  `20260422101911_api_keys_disconnected_at.sql:48`. Both confirmed by reading those files
  in this worktree. The layer is therefore claimed honestly — and it **fails closed**: if
  that read faults (e.g. a future grant change → 42501) the route refuses rather than
  silently dropping to two layers.
- **The accepted ceiling (T-162-05-E) is documented, not closed.** `p_user_id` is a
  parameter; the function verifies the key belongs to that uid, never that the uid is the
  real caller. Stated in the migration header ⛔ (ii), in the function COMMENT, and in the
  route docblock. No attempt was made to close it.
- **`create_wizard_strategy` is byte-untouched** — `git diff` over the tracer commit shows
  no change to `20260814120000` or any prior wizard-writer migration.
- **The resolver's `orphaned` arm carries no key id** (T-154-06-C stands): `ORPHANED` is
  still `{ kind: "orphaned" }` and the `KEY_ORPHANED` 409 body is unchanged.
- **No raw driver errors on the new arm**: pinned by a test asserting the 500 body is
  byte-exactly `{"code":"UNKNOWN","error":"Could not create draft strategy"}` and contains
  neither the Postgres message fragment nor `details`.

## Anti-vacuity mechanisms in the SQL gate

Because `pg_get_functiondef` **returns the comments**, and this function's body discusses
every token asserted:

- **Arm D** requires the prose-only token `CANARY_162_05_PROSE_ONLY` — which exists only
  inside a comment in the function — to be **absent** from the comment-stripped
  definition, and separately requires it to be **present** in the raw one. Delete the
  stripper, or delete the canary, and arm D reds. Arms E/F/G are measurements only because
  of it.
- **Arm H** runs arm G's *negative* regex against `create_wizard_strategy`, which genuinely
  does contain `INSERT INTO api_keys`, and **requires a hit**. Without it, "no api_keys
  INSERT here" would also be satisfied by a regex that matches nothing anywhere.
- **Arm I** asserts the refusal's **SQLSTATE is 42501**, not merely that something raised:
  with the role gate deleted the call would fall through to the ownership assertion and
  raise `P0002` instead, which arm I rejects.

## Could NOT be verified (stated, not glossed)

1. **The SQL migration and the SQL gate were never executed.** There is no TEST database
   reachable from this worktree, and connecting a local worker to production is forbidden.
   Both files were written against the live definitions of `create_wizard_strategy` and
   `add_wizard_composite_key` re-read at HEAD, and reviewed by hand for plpgsql validity
   (`RETURNS TABLE` OUT-parameter shadowing in the `strategies` INSERT column list follows
   the twin's proven pattern; the `EXCEPTION WHEN OTHERS` subtransaction restores
   `request.jwt.claims` inside the handler, after rollback). **They have not been run.**
   First execution will be CI's `sql-tests` job, where arm A is expected to fail once
   (deviation 1).
2. **No behavioural SQL arm seeds two tenants.** The plan asked for four gate properties
   plus the non-service-role refusal; all five are implemented. A seeded
   `user A owns key K, call with uid B → raises, no strategies row` arm would be stronger
   still, but writing untested table-seeding SQL against `api_keys`' NOT NULL / trigger
   surface carried more risk than value here. The equivalent property IS covered at the
   route layer with a RED witness. Recommended as a follow-up once the migration is on TEST.
3. **The reuse arm has never been exercised against a real database or a real browser.**
   Everything here is unit-level plus static gates. Plan 162-06 threads the client; live
   acceptance belongs with it.

## Handoff to 162-06 (client thread)

- **Pinned contract:** POST `/api/strategies/create-with-key` with
  `{ wizard_session_id: uuid, reuse_api_key_id: uuid }` and no credential fields.
  Success → `{ ok: true, strategy_id, api_key_id }` (plus `deduped: true` when an existing
  draft was handed back). Refusals: `KEY_MISSING_REQUIRED_FIELD` 400 (our request shape),
  `KEY_REUSE_UNAVAILABLE` 409, `VENUE_ALREADY_CONNECTED` 409, `DRAFT_ALREADY_EXISTS` 409,
  `SEAM_MISCONFIGURED` 503, `UNKNOWN` 403/500. All are in `KNOWN_CREATE_WITH_KEY_CODES`.
- ⚠️ **SURFACED, NOT EDITED — `KEY_ORPHANED`'s second `fix[]` line becomes false when
  162-06 lands.** It currently reads *"To reuse this exact account, email
  security@quantalyze.com … releasing the stored key is not something you can do from this
  page."* That is still true at this commit, because no client sends `reuse_api_key_id`
  yet. The moment the client threads the owner's own key id, the owner population CAN
  reuse it from that page and the sentence lies for exactly the users the phase is about.
  The plan scoped that copy out of 162-05 unless a line "now lies for a reachable
  population"; it does not yet, so it was left alone. **162-06 must move it in the same
  commit that ships the client.** The residual non-owner/anonymous population keeps the
  existing sentence.

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired components were introduced.

## Threat Flags

None beyond the plan's register. The new surface (`reuse_api_key_id` on an existing route,
one new SECURITY DEFINER function) is exactly what `<threat_model>` enumerated as
T-162-05-A through T-162-05-E; no additional endpoint, auth path, file access pattern or
trust-boundary schema change was introduced.

## Test results

| Gate | Result |
|------|--------|
| `npx vitest run src/app/api/strategies/create-with-key/route.test.ts` | 149 passed |
| `npx vitest run` (full suite — contract tests scan all of `src/`) | 800 files passed, 12494 tests passed, 281 skipped |
| `npx tsc --noEmit` | clean |
| `npx eslint` on all changed source | clean |
| `npx vitest run src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` | 18 passed |
| `test -f supabase/tests/test_create_wizard_strategy_for_key.sql` | present |
| SQL gate executed against a database | **NOT RUN** — see "Could NOT be verified" |

## Self-Check: PASSED

- `supabase/migrations/20260826130000_create_wizard_strategy_for_key.sql` — FOUND
- `supabase/tests/test_create_wizard_strategy_for_key.sql` — FOUND
- commit `02107e27b` — FOUND
- commit `e3ca0e163` — FOUND
