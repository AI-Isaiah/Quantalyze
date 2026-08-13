---
phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
plan: 09
subsystem: database
tags: [supabase, sql-tests, acl, service-role, plpgsql, vacuous-test, migration-b]

requires:
  - phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
    plan: 07
    provides: "Migration B (20260814120000) — the REVOKE + service_role-only in-body gate these gates now assert"
  - phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
    plan: 03
    provides: "Parts 3c/3d/3e in test_wizard_composite_fence.sql, and Migration A as the body the re-cut 3b/3c now discriminate against"
provides:
  - "Three inverted `authenticated`-EXECUTE pins, each with a service_role outage positive"
  - "Five wizard-RPC call sites re-shaped to the service_role claim via three set_config edits"
  - "Part 3b and Part 3c re-cut so neither is a green test pinning a deleted control"
  - "The add_wizard_composite_key stale-re-base canary, which the repo never had"
  - "Both RPC bodies pinned from outside the migration chain: auth.role() present, auth.uid() ABSENT"
affects: [156-10]

tech-stack:
  added: []
  patterns:
    - "Comment-stripped `pg_get_functiondef` matching — a raw match is wrong in BOTH directions when the body documents the thing being asserted absent"
    - "Re-cutting rather than deleting an assertion whose subject was removed, with prose naming where the control moved"
    - "Asserting a refusal over TWO identities so the block cannot be misread as ownership coverage"

key-files:
  created: []
  modified:
    - supabase/tests/test_wizard_session_idempotency.sql
    - supabase/tests/test_wizard_composite_fence.sql
    - supabase/tests/test_csv_finalize_double_submit.sql
    - supabase/tests/test_api_keys_venue_identity_uniq.sql

key-decisions:
  - "Part 3b/3c were RE-CUT, not made-to-pass: they assert 42501 for BOTH a mismatched and a MATCHING sub, which discriminates the Migration B body from the Migration A body it would otherwise have passed against"
  - "The plan's anti-vacuity premise is MEASURED FALSE — has_function_privilege RAISES 42883 on a dropped function rather than returning FALSE — so the service_role positives are justified by the one-role-too-far outage instead"
  - "Task 3's auth.uid()-absent assertion required a comment strip; the literal form the plan specified would have RED-lined against the correct Migration B body"
  - "No A3 remedy arm taken: 156-MEASUREMENTS.md A3 records superuser-or-owner, and the plan's inverse rule forbids an unnecessary fixture grant"

requirements-completed: [CONNECT-01, CONNECT-03]

duration: 3h
completed: 2026-08-13
---

# Phase 156 Plan 09: Flip every gate Migration B falsifies — and re-cut the two that would have stayed green while their subject was deleted

**Three ACL pins inverted, five call sites re-pointed at the claim production actually sends, and the
two assertions that were about to report cross-user coverage the database no longer provides now
assert something true and say where the control went.**

⛔ **Read the Evidence section before trusting any "passes" claim here.** Migration B is applied to no
database, deliberately, so none of these gates was run end-to-end against the schema they target.

---

## What changed, per site

### The three ACL pins — inverted, each with a positive

| Site | Asserted BEFORE | Asserts NOW | What makes it fail |
|---|---|---|---|
| `test_wizard_session_idempotency.sql` §4 | `authenticated` **HAS** EXECUTE on `create_wizard_strategy` | `authenticated` holds **NO** EXECUTE | a re-GRANT, or a `DROP`+`CREATE` that lets `pg_default_acl` re-grant silently |
| `test_wizard_composite_fence.sql` Part 3a | `authenticated` **HAS** EXECUTE on `add_wizard_composite_key` | same inversion | same |
| `test_api_keys_venue_identity_uniq.sql` §4 | `authenticated` **HAS** EXECUTE on `create_wizard_strategy` | same inversion | same — **this pin was not in Task 1's file list; see Deviation 2** |

Each file also gained a `has_function_privilege('service_role', …)` **positive** worded as an outage
(`CONNECT-A-KEY IS BROKEN`), which fails when a REVOKE goes one role too far. Every `anon` assertion
is byte-unchanged, as is `test_wizard_session_idempotency.sql`'s body-substring block.

### The A3 self-diagnosing pre-check

Added at the top of both files the plan names. If `has_function_privilege(current_user, …)` is FALSE,
one `RAISE` names `current_user` and the word **environmental**, instead of every downstream call site
failing separately for a reason none of them states. **No remedy arm was taken** — `156-MEASUREMENTS.md`
§ A3 records `postgres`/`supabase_admin` (superuser-or-owner), and the plan's inverse rule forbids an
unnecessary fixture grant. The reasoning is written into both files so it is not re-derived.

### The five re-shaped call sites — three `set_config` edits

| Claim site | Serves | Change |
|---|---|---|
| fence — claim opening *Part 1 + Part 2* | 2 calls | `'authenticated'` → `'service_role'`, `sub` kept |
| fence — claim opening *Part 4 — single-key regression* | 2 calls (4a, 4b) | same |
| `test_csv_finalize_double_submit.sql` (before the cross-source control) | 1 call | same |

**Five call sites, three edits.** Parts 3b and 3c deliberately **retain** `authenticated` — they are
refusal assertions. The CSV file's Part 1 claim is untouched: it precedes `finalize_csv_strategy`,
which is not a wizard RPC.

⭐ Each re-shaped site records **why** `sub` is retained here while Part 3d deliberately omits it —
they are not in conflict. Part 3d presents the exact shape production sends; these sites keep `sub` so
the pair forms a control proving the gate is decided by the **role claim alone** and is indifferent to
the identity beside it. That is the positive half of what re-cut 3b/3c say negatively.

---

## ⭐ The finding that mattered: Parts 3b and 3c were about to become green tests pinning a deleted control

`rls-policy-auditor` was right, and the fix was not to make them pass.

**Before:** each presented a *different* `sub` than `p_user_id`, asserted `insufficient_privilege`, and
named *"cross-user elevation (T-88-03)"*. The thing refusing was the body's `auth.uid() <> p_user_id`
comparison. **Migration B deletes that comparison** — deletes, not relaxes, because `auth.uid()` IS NULL
under `service_role` (§ A2), so a retained one is a permanent silent no-op.

**They would have kept passing** — the role gate refuses before ownership is ever reached — while
naming a guarantee that no longer exists anywhere in the database.

**What they assert now:** an `authenticated` caller is refused with `42501` **for two `sub` values —
mismatched AND matching** — plus a zero row delta across both. 3b against `add_wizard_composite_key`,
3c against `create_wizard_strategy`.

⭐ **The matching-`sub` half is what makes the re-cut non-vacuous in its turn.** That exact call
**SUCCEEDED** under Migration A (20260813150106), whose `authenticated` arm admitted a caller whose
`auth.uid()` equalled `p_user_id`. So unlike the assertion it replaces — which passed against every
body ever shipped — this one distinguishes the post-156 body from the body shipped one migration
earlier, and reds if the REVOKE is rolled back. Stating it over two identities is also what stops a
later reader construing the block as ownership coverage.

**Where the control went, named in both blocks' prose:** entirely to the route. `p_user_id` is
`withAuth`'s getUser()-verified `user.id` (ADR-0022). T-88-03 is restated throughout as *"formerly
enforced here; now enforced at the route"* — all four occurrences in the file are so qualified. The
surviving controls are named by file **and test title**:

- 3b → `src/app/api/strategies/composite/add-key/route.test.ts` — *"156 — p_user_id is withAuth's user.id, and NO request-body field can reach it"*
- 3c → `src/app/api/strategies/create-with-key/route.test.ts` — same case title
- both → `src/__tests__/phase-156-wizard-rpc-writer-guard.test.ts` (CONNECT-02b)

Both pointers were **proven live by mutation** (below), not merely cited.

---

## The composite canary, and the `auth.uid()`-absent guard

`test_api_keys_venue_identity_uniq.sql` gained §3b — the `add_wizard_composite_key` twin of the
create-side canary the file already had: single-overload count, `pg_advisory_xact_lock`,
`wizcomposite:`, `attested_venue`, each message naming the guarantee a stale re-base reverts and the
migration it would revert to. Its absence was a live one-path-only gap: a re-base touching only the
composite body would have left every create-side assertion green.

§3c asserts on **both** bodies that `auth.role()` is present and `auth.uid()` is **absent**, from
outside the migration chain, with the silent-no-op consequence in the message.

---

## Evidence — what was actually run, and what was not

⛔ **NOT run:** these gates were **not** executed against a database carrying Migration B. It is applied
nowhere by design and the fences forbade applying it. **`sql-tests` was NOT observed green, and this
plan does not claim it.**

⚠️ **Expected consequence for PR B:** because TEST does not carry Migration B, `sql-tests` on this PR
will be **RED** until it is applied — the inverted pins and the matching-`sub` halves of 3b/3c are
precisely the assertions designed to fail against a pre-Migration-B body. That is the intended RED of a
RED→GREEN pair, not a defect. `sql-tests` has no migration-apply step; it runs the files against the
shared TEST project as-is.

**What WAS run** — a throwaway `postgres:16-alpine` container carrying the **real Migration B function
bodies and the real Migration B `REVOKE`/`GRANT` statements**, extracted verbatim from the migration.
It carries no Supabase schema (`api_keys`, `strategies`, `auth.users` absent), so the behavioural Parts
could not execute.

| Check | Result |
|---|---|
| All four files' PL/pgSQL **compiles** (block structure, `RAISE` format strings and arg counts, control flow) | ✅ all four; first error in each is a runtime missing-object, never a parse error |
| `test_wizard_composite_fence.sql` **Part 3a end-to-end** against Migration B's real grants | ✅ `NOTICE: Part 3a OK: neither anon nor authenticated holds EXECUTE …` |
| **Mutation** — re-GRANT `authenticated` on the composite RPC → Part 3a | ✅ RED, `ERROR: TEST FAILED (Part 3a): authenticated HOLDS EXECUTE on add_wizard_composite_key …` |
| **Mutation** — re-GRANT `authenticated` → both inverted pin predicates | ✅ both flip to fire; both service_role positives stay quiet |
| **Mutation** — REVOKE `service_role` → both positive predicates | ✅ both fire with the outage wording; inverted pins stay quiet |
| §3c strip logic vs the **real** Migration B bodies | ✅ RAW `LIKE '%auth.uid()%'` = **true** for both (would have red-lined); STRIPPED = **false** for both; `auth.role()` = true for both |
| §3b canary strings vs the real composite body | ✅ `wizcomposite:`, `pg_advisory_xact_lock`, `attested_venue` all present; overload count = 1 for both RPCs |
| `has_function_privilege(current_user, …)` overload resolution (A3 pre-check) | ✅ resolves, `current_user=postgres execute=true` |

**Vitest mutation — the route-side pointers are live, identified BY TEST NAME** (run in the main
checkout, `node_modules` present; not a worktree):

Baseline, composite: `✓ … > 156 — p_user_id is withAuth's user.id, and NO request-body field can reach it 328ms`

Neutered `p_user_id: user.id` → a body field in `composite/add-key/route.ts`:

```
× |node| src/app/api/strategies/composite/add-key/route.test.ts > [156 / CONNECT-02 + CONNECT-03] composite/add-key — the service-role writer contract > 156 — p_user_id is withAuth's user.id, and NO request-body field can reach it 326ms
  → CONNECT-03b: p_user_id must come from withAuth's verified session.: expected 'beefbeef-beef-4eef-8eef-beefbeefbeef' to be '00000000-0000-0000-0000-aaaaaaaaaaaa'
```

Same mutation on `create-with-key/route.ts` reds its twin:

```
× |jsdom| src/app/api/strategies/create-with-key/route.test.ts > [156 / CONNECT-02 + CONNECT-03] create-with-key — the service-role writer contract > 156 — p_user_id is withAuth's user.id, and NO request-body field can reach it 290ms
```

`phase-156-wizard-rpc-writer-guard.test.ts`: 10 passed. **Both routes restored; `git status --short src/` is empty.**

**Not obtainable here:** the behavioural halves of Parts 1/2/3b-ii/3c-ii/3d/3e/4, and the re-GRANT
mutation's *"neither 3b nor 3c reds"* demonstration, both of which need the full Supabase schema plus
Migration B. They belong to plan 10 / the TEST apply.

**Complete-surface sweep.** No `IF NOT has_function_privilege('authenticated', …)` pin on either wizard
RPC remains anywhere in `supabase/tests/`. `test_guard_wizard_draft_updates_auth_uid.sql` was checked
and is **unaffected** — catalog reads only, no invocation, no ACL pin. `test_api_key_delete_atomicity.sql`
pins different functions.

---

## Deviations

**1. The plan's verify command counts `service_role` claim sites as 2; the true count is 3.**
PR A minted Part 3c **and Parts 3d/3e**; the plan's post-PR-A model accounted only for 3c, so the fence
file holds **six** claim sites, not four, and Part 3d already carried `'role', 'service_role'`. My two
NEW edits are the correct ones (`git diff` shows exactly two added `service_role` claim lines); the
third is pre-existing and untouched. The plan's `-eq 2` assertion is stale by construction — the same
hazard it warned about for line numbers, applied to its own count. The stray-`authenticated` range
check passes as written.

**2. A third `authenticated`-HAS-EXECUTE pin existed outside Task 1's file list.**
`test_api_keys_venue_identity_uniq.sql` §4 pinned the same 12-arg signature. Task 1 named only two
files, but must_haves truth 1 says *every* pin, the file is in `files_modified`, and Migration B would
have reddened it. Inverted under Task 3 with a matching positive (Rule 2/3).

**3. ⭐ The plan's anti-vacuity premise is MEASURED FALSE, and three comment blocks were corrected.**
The plan (and threat **T-156-46**) state that `has_function_privilege('authenticated', …) = FALSE`
*"also passes on a database where the function was dropped"*. Measured on PG16: with the **text** form
of the signature used throughout these files, it **RAISES `undefined_function` (42883)** — it does not
return FALSE — and under `ON_ERROR_STOP=1` that aborts the file loudly. I had first written the plan's
version into all three files; it is now replaced with the measured behaviour and the **correct**
justification: what no negative can see is a REVOKE that goes **one role too far**, leaving
`service_role` without EXECUTE while `anon`/`authenticated` read exactly as intended and every
connect-a-key is broken. The positives are still required — for that reason. ⚠️ T-156-46's stated
mechanism should be corrected in the threat register; its mitigation stands.

**4. Task 3's assertion as literally specified would have RED-lined against the correct body.**
The action says assert the body *"does not contain `auth.uid()`"*. `pg_get_functiondef` reconstructs
from `prosrc`, which stores comments verbatim, and **both** Migration B bodies discuss `auth.uid()` at
length in their Trap-B prose — RAW match measured **true** for both. Implemented with a line-comment
strip mirroring the migration's own post-verify (stripped match measured **false** for both), with the
rationale and the strip's limitation recorded in the file.

**5. Parts 3b/3c now make two calls each**, so the file's "six direct call sites" phrasing became stale
mid-task. Replaced with count-free wording in my own new comments rather than shipping a number that
drifts.

**6. Per hard fence 5, no `.planning/` file other than this SUMMARY was written** — `STATE.md`,
`ROADMAP.md` and `REQUIREMENTS.md` updates from the standard executor protocol were **skipped**, and no
`gsd-sdk state.*` commands were run. The orchestrator owns those for PR B.

**7. `test_api_keys_exchange_not_user_writable.sql` shows +141 lines in the working tree** — that is
plan 08's concurrent work in this shared checkout. I did not touch it and did not stage it.

**8. ⚠️ SHARED-CHECKOUT RACE — my first commit attempt silently no-oped, and the orchestrator should
know the mechanism.** Plans 08 and 09 ran concurrently in the **same main checkout** (worktrees were
fenced off because GSD worktree agents get no `node_modules`). Plan 08 committed, then ran
`git reset HEAD~1` and re-committed — visible in the reflog as
`commit 020d00c2 → reset: moving to HEAD~1 → commit 47dc0d45`. My `git add` of five files landed in
the index just before that reset, so my `git commit` reported **"nothing to commit, working tree
clean"** while `git log -1 -- <file>` still showed only old commits. **No work was lost** — the files
and the index recovered on the next read, and the retry committed cleanly as `a7542b6f` — but a
`git reset --hard` or `git clean` in the concurrent agent at that instant *would* have destroyed
uncommitted work in four files with no warning.
⭐ **Verified after the fact:** plan 08's four commits touch **only**
`test_api_keys_exchange_not_user_writable.sql`, and `a7542b6f` touches only this plan's five files —
no cross-contamination in either direction. ⛔ Two agents sharing one index is not safe; a "commit
reported success/no-op" reading is not trustworthy under it. Future concurrent waves should either
serialise the commit step or give each plan its own checkout with `node_modules` linked in.

---

## Known Stubs

None.

## Threat Flags

None — no new network, auth, file-access or schema surface. All four files are test-lane assertions.

## Self-Check: PASSED

- `supabase/tests/test_wizard_session_idempotency.sql` — FOUND
- `supabase/tests/test_wizard_composite_fence.sql` — FOUND
- `supabase/tests/test_csv_finalize_double_submit.sql` — FOUND
- `supabase/tests/test_api_keys_venue_identity_uniq.sql` — FOUND
- `.planning/phases/156-…/156-09-SUMMARY.md` — FOUND
- All four files compile under `psql -v ON_ERROR_STOP=1`; no parse errors.
- Commit hash recorded in the phase log.

---

## Follow-up (2026-08-13): sequencing fix — the gates are now STATE-ADAPTIVE

**Commit:** `b8419767` · **Files:** the three gate files below (`test_csv_finalize_double_submit.sql` deliberately unchanged)

### The defect this closes

`migration-reviewer` found (HIGH) that Migration B (`20260814120000`) must **not**
be applied to the shared TEST database ahead of the merge: `origin/main`'s copies
of these same gate files still require `authenticated` to HOLD EXECUTE, so an
early apply would red `sql-tests` for main and for every concurrent PR sharing
that database. But this plan left the gates asserting the POST-Migration-B state
**unconditionally**, which redded PR B itself. Measured baseline on a PG16
fixture carrying Migration A alone — i.e. today's TEST — was **3 of 4 files RED**.

### The arming signal, and the two wrong ones

Each gate now arms from **live state**, in the shape plan 08 proved: the presence
of `v_auth_uid` in the **comment-stripped** function body. Migration A declares
and compares it as *code*; Migration B deletes both and keeps the name only in
prose.

⛔ **The strip is mandatory and was MEASURED.** On a fixture carrying Migration B,
the RAW `pg_get_functiondef` of `create_wizard_strategy` still matches
`'%v_auth_uid%'` — its own Trap B comment explains the absence and thereby
contains the string. Measured in the same run: the **composite** twin's raw
definition reads FALSE in that identical state, so a raw detector would arm one
twin and not the other. End-to-end counterfactual: with a raw-matched detector,
re-granting `authenticated` EXECUTE on a Migration-B database — the exact
CONNECT-01 regression — **exits 0, green, undetected**. Third independent
encounter with this trap (migration post-verify (e2), plan 08's 5h, here).

Rejected: `auth.role()` (present in **both** bodies — discriminates nothing) and
`has_function_privilege('authenticated', …)` (the very thing being asserted —
arming on it makes the assertion vacuous).

### Against the SKIP-with-exit-0 hazard

- Every skip `RAISE NOTICE`s loudly, naming **exactly** which assertions were
  skipped, which still ran, and why the skipped state is legitimate.
- Every summary `NOTICE` is **state-aware**. The previous fixed wording would
  have printed *"BOTH bodies gating on auth.role() with ZERO auth.uid() … anon
  and authenticated shut out"* as a **PASS** on a run that skipped all three of
  those claims — the silent-green failure this phase exists to end, emitted by
  the file's own last statement.
- **Both-or-neither coherence checks** make every incoherent half-state **RED**
  rather than skip: twin divergence, body-narrowed-but-grant-standing (the worst
  state — Migration B *deletes* the ownership comparison, so this permits a
  cross-tenant write), and grant-revoked-but-body-still-Migration-A (the state
  that would otherwise skip **silently**).
- ⭐ Each coherence check is **scoped to the cell no armed assertion can reach**.
  A first draft duplicated section 4's exact condition, making one of the two
  provably dead code — the (5h′) defect plan 08 called out, reproduced. Caught by
  the mutation battery and fixed; `m4`/`m5` below confirm each armed assertion
  still fires on its own ground.

### Evidence — local PG16.13 fixture, purpose-built, re-based verbatim

⛔ **Nothing was applied to any database.** No `supabase db push`, no MCP, no
shared DB touched. `sql-tests` has **not** been observed green in CI against
TEST; that remains undischarged until PR B merges.

Three fidelity checks passed before any conclusion was drawn: (1) the fixture's
function ACL after Migration A reproduces `156-MEASUREMENTS.md` § A4 byte for
byte (`postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres`);
(2) Migration B's own post-verify (a)–(h) passes on it; (3) plan 08's
**untouched** gate reproduces its documented profile exactly (2 skips on
Migration-A, 0 on Migration-B).

| State | idempotency | composite_fence | venue_identity | csv_double_submit |
|---|---|---|---|---|
| Migration A (today's TEST) | green, 1 skip | green, 3 skips | green, 2 skips | green, 0 skips |
| Migration B applied | green, **0 skips** | green, **0 skips** | green, **0 skips** | green, 0 skips |
| body narrowed, grant standing | **RED** 3f/§4 | **RED** 3a-2b | **RED** 3e-b | green (out of scope) |
| grant revoked, body Migration A | **RED** 3f | **RED** 3a-2c | **RED** 3e-c | green (out of scope) |
| twin divergence (one RPC only) | green, 0 skips¹ | **RED** 3a-2a | **RED** 3e-a | green (out of scope) |
| `authenticated` re-granted, single-key | **RED** §4 | **RED** 3a-2b | **RED** §4 | green (out of scope) |
| `authenticated` re-granted, composite | green, 0 skips¹ | **RED** Part 3a | **RED** 3e-b | green (out of scope) |

¹ Correct, not a gap: `test_wizard_session_idempotency.sql` reads only
`create_wizard_strategy`, and in those two states that twin is fully coherent, so
it runs **all** its assertions. Twin divergence is caught by the two files that
read both twins — duplicating it a third time would add a pin that already exists
twice.

### `test_csv_finalize_double_submit.sql` — unchanged, and why

Measured **green on both states**, so it was left alone. Its `create_wizard_strategy`
call site already presents a `'role', 'service_role'` claim, which Migration A's
`service_role` arm admits (`20260813150106:136`) and Migration B's gate admits;
its `finalize_csv_strategy` call sites are not wizard RPCs and are untouched by
Phase 156. Adding skip machinery to a file with nothing to skip would have
introduced a silent-green path rather than closed one.

⚠️ **Residual, stated rather than hidden:** that file *would* fail on a
**pre-Migration-A** database, whose body has no `service_role` arm. That state is
unreachable for TEST — Migration A is on `origin/main` and auto-applies — so it
is recorded, not guarded.
