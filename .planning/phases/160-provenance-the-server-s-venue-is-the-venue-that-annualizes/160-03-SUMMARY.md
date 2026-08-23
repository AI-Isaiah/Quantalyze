---
phase: 160-provenance-the-server-s-venue-is-the-venue-that-annualizes
plan: 03
subsystem: api-keys-connect
status: complete
tags: [RANK-03, provenance, attested-venue, client-insert-retirement, sql-gate]

requires:
  - "160-02 persist arm — `persist: true` ⇒ server-side attested INSERT ⇒ `{ api_key_id }`"
  - "public.api_keys BEFORE INSERT scrub trigger admitting service_role by name (20260811210000:534)"
  - "migration-027 SELECT column allowlist (API_KEY_USER_COLUMNS) for the row re-fetch"
provides:
  - "StrategyForm converted — zero browser-composed api_keys INSERTs"
  - "AllocatorExchangeManager converted — persist request + row re-fetch by api_key_id"
  - "ALL THREE client INSERT sites retired; the browser's only api_keys verbs are SELECT and DELETE"
  - "supabase/tests/test_api_keys_insert_not_client_writable.sql — A1 enforced from this commit; post-REVOKE assertions pre-authored and correctly dormant"
  - "arming marker pinned: `revoke_api_keys_insert` on the api_keys.exchange column comment"
affects:
  - "160-05 (REVOKE INSERT) — its pre-REVOKE grep precondition is now satisfied; ⚠️ AND it inherits a BLOCKING collision, see below"

tech-stack:
  added: []
  patterns:
    - "server-writes-then-client-re-reads (persist response is minimal; UI re-fetches through the SELECT allowlist)"
    - "state-adaptive SQL gate armed by a slug marker in a column comment, cross-checked against the ACL"
    - "loud-fail on a 2xx without api_key_id (160-02 posture, carried to both components)"

key-files:
  created:
    - supabase/tests/test_api_keys_insert_not_client_writable.sql
  modified:
    - src/components/strategy/StrategyForm.tsx
    - src/components/strategy/StrategyForm.test.tsx
    - src/components/exchanges/AllocatorExchangeManager.tsx
    - src/components/exchanges/AllocatorExchangeManager.test.tsx

decisions:
  - "The A1 positive runs as the LITERAL `service_role`, not as the test's owner role. The scrub trigger keys on current_user, so the sibling file's owner-role 5b shape would pass even if 'service_role' were edited out of the allowlist — i.e. it would not be testing A1 at all."
  - "The gate's marker is cross-checked against has_table_privilege in the direction that bites: privilege revoked + marker absent RAISES. A marker-only gate can be disarmed by editing prose."
  - "AllocatorExchangeManager's failed-re-fetch arm gets CURATED copy. The pre-conversion arm piped `insertErr.message` — a raw PostgREST string with SQLSTATE, relation and column names — into the form banner (H-0405 class)."
  - "The three M-0407 specs were retired rather than rewritten: their subject (client-side `?? ` fallbacks on ciphertext columns) was deleted with the insert and no longer exists to test."

metrics:
  duration: ~110 min
  completed: 2026-08-23
  tasks: 3
  commits: 6

actuals:
  tokens: 18400
  tasks: 3
  commits: 6
---

# Phase 160 Plan 03: The last two client INSERT sites, and the door that closes on them

`StrategyForm` and `AllocatorExchangeManager` now connect keys through the
`validate-and-encrypt` persist arm instead of composing the `api_keys` row in the
browser, and a new state-adaptive SQL gate enforces assumption A1 today while
holding the post-REVOKE assertions dormant until plan 160-05 stamps its marker.

## The phase-wide claim, measured

`grep -rln 'from("api_keys")' src/` then a whitespace-collapsed count of
`from("api_keys").insert(` on every `.ts`/`.tsx` file under `src/`:

```
api_keys INSERT chains found:
  1  src/app/api/keys/validate-and-encrypt/route.ts     <- THE SERVER WRITER (correct)
  ... 12 test/live-DB files (service-role or mock definitions)
Of those, browser components:
  none
```

**Zero browser components INSERT into `api_keys`.** That is ROADMAP 160 SC-2's
client half and plan 160-05's precondition.

⚠️ **Note for 160-05's pre-REVOKE re-grep.** A naive repo-wide grep for that
literal returns FOUR non-code hits: the legitimate server writer, plus prose in
three spec files that quote the chain while explaining its retirement
(`StrategyForm.test.tsx:42,181`, `ApiKeyManager.test.tsx:530` — the last written
by plan 160-02). Scope the check to non-test files carrying `"use client"`, or
reuse the scan above, which reports browser components separately.

## Task 1 — StrategyForm

The insert at `:140` captured no id and nothing downstream consumed one (verified
before deleting), so the conversion is a straight swap: the POST body gains
`persist: true` and `label: \`${exchangeCanonical} key\`` (the component's own
pre-existing default template, moved into the request because the server now
composes the row), and the `getUser()` / ciphertext-stripping / insert block is
deleted.

The F4 lowercase chokepoint stays — its consumer is now the request body rather
than the insert, and the route re-normalizes independently at its own chokepoint.

## Task 2 — AllocatorExchangeManager (the third site)

`:591`, the site 160-CONTEXT.md missed. Not a like-for-like swap: the old insert
used `.select(API_KEY_USER_COLUMNS).single()` to get the full row back for the
optimistic render, and the persist response is deliberately minimal. The
component now re-reads by id:

```ts
.from("api_keys").select(API_KEY_USER_COLUMNS).eq("id", newKeyId).single()
```

The projection is privilege-compatible **by construction, not by assumption**:
PostgREST's `insert().select(cols)` is a `RETURNING`, which is governed by the
same SELECT column privileges as a plain read. The previous code used this exact
constant on that path in production, so the requirement is unchanged.

`pending_insert` stamping, the awaited first-run sync, the f8 queued-helper arm
and the D-11 polling loop are all untouched.

## Task 3 — the SQL gate

`supabase/tests/test_api_keys_insert_not_client_writable.sql`. Six assertions,
four unconditional and two state-adaptive:

| # | State | Claim |
|---|-------|-------|
| 1 | always | owner's authenticated session can SELECT its own row (vacuity control for all below) |
| 2 | always | **A1**: a `service_role` INSERT supplying `attested_venue = exchange` RETAINS it |
| 3 | always | the scrub trigger is present, ENABLED, and SECURITY INVOKER (vacuity control for 2) |
| 4 | always | owner can still DELETE its own row — **D-05's canary** that the REVOKE stays INSERT-only |
| 5 | armed | `authenticated` INSERT refused with SQLSTATE **42501 exactly**, AND no row minted |
| 6 | armed | ACL class: neither `authenticated` nor `anon` holds INSERT; `service_role` keeps INSERT and `authenticated` keeps DELETE |

Plus a marker/ACL cross-check placed **outside** the branch: if the privilege
says revoked but the comment lacks the marker, it RAISES rather than skipping
green.

**Arming marker (pinned):** `revoke_api_keys_insert`, in the
`public.api_keys.exchange` column comment. A slug, not a timestamp — the
migration's UTC filename is unknowable when this file is written, and a guessed
one would leave the negatives permanently un-armed and silently green.

**No migration file was created.** `git diff --stat` confirms zero files under
`supabase/migrations/`. PR-1 stays TS + tests only (D-06).

## Verification — what was actually executed

### The SQL gate was RUN, in both states

The plan anticipated that the armed set could not be observed until the REVOKE
reaches TEST. It was possible to do better. `psql` is absent from this worktree,
so a throwaway **PostgreSQL 16** container was stood up and a minimal fixture
built reproducing exactly the objects the gate touches — the three Supabase
roles, `auth.users` + `auth.uid()`, `public.api_keys` with the coupling CHECK and
the `api_keys_owner` RLS policy, and the scrub trigger **copied verbatim** from
`20260811210000` §4.

| State | Result |
|-------|--------|
| Pre-REVOKE (today's TEST DB shape) | assertions 1, 2, 3, 4 RUN and pass; 5/6 emit the loud SKIP; exit 0 |
| Armed (marker stamped + INSERT revoked) | all six RUN and pass; exit 0 |

⚠️ **Honest limit.** This is a LOCAL FIXTURE, not the shared TEST DB. It
reproduces the objects the gate reads, not the whole schema, and it does not
prove the file passes against real production migration state. It does prove the
file parses, that its control flow reaches every assertion, that the marker gate
flips correctly, and that each assertion can fail. The first CI `sql-tests` run
on the shared TEST DB is still the authoritative check.

Also verified: CI auto-discovers `supabase/tests/test_*.sql` by glob
(`ci.yml:1324`) and runs it under `psql -v ON_ERROR_STOP=1` (`:1335`), and the
file passes CI's Finding-6 preflight (no `\!`, `\copy`, `\COPY`, `\o`).

### Anti-vacuity: every neuter, observed RED first-hand

Each neuter was applied to a byte-verified-clean baseline and reverted by
`git checkout` (or, for the SQL fixture, by re-applying the correct DDL);
`git diff --stat HEAD` confirmed identical restoration each time.

**TypeScript (10 neuters):**

| # | Neuter | Observed RED |
|---|--------|--------------|
| 1 | StrategyForm: unconverted (pre-edit baseline) | `expected undefined to be true` on `body.persist` |
| 2 | StrategyForm: `persist: true` → `persist: "true"` | `expected 'true' to be true` — the strict-boolean skew oracle |
| 3 | StrategyForm: loud-fail guard disabled | loud-fail copy absent from the DOM |
| 4 | StrategyForm: `err.error` → `JSON.stringify(err)` (the classic leak shape) | curated persist-failure copy absent |
| 5 | StrategyForm: a browser insert reintroduced | `expected { exchange: 'binance' } to be null`, **and** the plan's collapsed grep returned 1 |
| 6 | Allocator: unconverted (pre-edit baseline) | all 4 new oracles RED |
| 7 | Allocator: projection → a re-typed column list | `expected { cols: 'id, exchange, label', …} to deeply equal {…}` |
| 8 | Allocator: `.eq("id", …)` → `.eq("user_id", …)` | deep-equal mismatch on the filter |
| 9 | Allocator: curated copy → `refetchErr?.message` | curated sentence absent |
| 10 | Allocator: insert reintroduced **+** optimistic row fabricated from form data | 4 RED — 3× `expected "vi.fn()" to not be called`, plus `Unable to find… Refetched Label`; collapsed grep returned 1 |

**SQL (8 neuters, all against the running fixture):**

| # | Neuter | Assertion that caught it |
|---|--------|--------------------------|
| A | INSERT revoked but marker dropped | the marker/ACL cross-check — the silent-green trap |
| B | `GRANT INSERT … TO authenticated` re-granted | (5) "an authenticated browser session INSERTed a row" |
| C | REVOKE also took DELETE | (6) `OUTAGE … the REVOKE was meant to be INSERT-ONLY (D-05)` |
| D | `'service_role'` removed from the trigger allowlist | (2) A1 — `read back <NULL> instead of 'deribit'` |
| E | trigger flipped to SECURITY DEFINER | (3) — and note **(2) would have passed**; 3 is the only thing that catches this |
| F | trigger dropped entirely | (3) "the trigger is GONE" |
| G | INSERT revoked from `service_role` | (2) OUTAGE arm |
| H | SELECT revoked from `authenticated` | (1) OUTAGE arm |

### Two real defects the neuters found in my own gate — fixed

Neuters G and H initially produced a bare `ERROR: permission denied for table
api_keys`: correctly RED, but with **no diagnosis and no remedy**, and in G's case
*before* assertion 6's curated OUTAGE line could ever be reached. The two
failures mean opposite things — "our server cannot write at all" versus "our
server writes but is not believed" — so assertions 1 and 2 now wrap their
statement and raise distinct, remedied messages. Re-running G and H against the
fixed file produces the curated text. This is exactly what the neuter cycle is
for; a static read would not have surfaced it.

### Gates

| Gate | Command | Result |
|------|---------|--------|
| Both component suites + upstream suites | `vitest run StrategyForm.test.tsx AllocatorExchangeManager.test.tsx ApiKeyManager.test.tsx route.test.ts --no-file-parallelism` | **158 passed** |
| Typecheck | `tsc --noEmit -p tsconfig.json` | clean |
| Lint | `eslint` × the four changed TS files | clean |
| Grep: persist present | `grep -q 'persist: true'` × both components | PASS |
| Grep: zero insert chains | `! tr -d ' \n\t' \| grep -q 'from("api_keys").insert('` × both | PASS (count 0) |
| SQL gate greps | marker / 42501 / has_table_privilege / ROLLBACK / RAISE NOTICE≠0 | PASS (7 NOTICEs) |
| No migration | `git diff --stat` under `supabase/migrations/` | 0 files |

**How these were run.** This worktree has no `node_modules`; binaries were
invoked by absolute path from the parent checkout's `node_modules/.bin` with cwd
inside the worktree. Vitest confirms the root on every run:
`RUN v4.1.10 …/.claude/worktrees/agent-a9552e2cc87eb1d92`. The neuter/RED cycle is
the proof these are real gates against this worktree's files. CI runs Node 22;
this ran on the parent's toolchain (the project's documented CI-only-vitest-skew
class applies). No `.env.test.local` here, so live-DB specs skip.

## ⛔ BLOCKING HANDOFF TO PLAN 160-05

**`test_api_keys_exchange_not_user_writable.sql` assertion 5c will HARD-FAIL the
moment the REVOKE merges.** Measured at HEAD, not predicted.

At `:450-455` that gate drives a DELETE-then-re-INSERT as `authenticated` and
raises if the re-INSERT is refused:

```sql
IF v_ins_err IS NOT NULL THEN
  RAISE EXCEPTION 'TEST FAILED (5c): the client re-INSERT was REFUSED (%). 153.6
    D-02/D-03 keep this path open on purpose … A refusal here means
    connect-a-key is broken.', v_ins_err;
```

That premise — the client INSERT path stays open by design — is precisely what
plan 160-05 reverses. 5c sits inside `IF v_attest_live`, whose marker
(`20260811210000`) **is** present on TEST, so it runs. Post-REVOKE the INSERT
raises 42501 (I measured this refusal directly on the fixture as my own assertion
5), `v_ins_err` is non-null, and `sql-tests` goes red on main.

**Plan 160-05 must make 5c state-adaptive on the same `revoke_api_keys_insert`
marker, in the same commit as the migration.** This plan's prohibitions forbid
touching that file, and it was not touched.

## Deviations from Plan

### 1. [Rule 1 — bug in my own work] `git checkout --` discarded an uncommitted conversion

While running neuter 1 I restored with `git checkout --` against a HEAD that was
still the test-only RED commit, wiping the not-yet-committed StrategyForm
conversion. Caught immediately (the suite went from 7 green to 2 RED with the
pre-conversion signature), reapplied, and re-verified. Every subsequent neuter
was run against a **committed** baseline so restore is exact; each restore was
confirmed with `git diff --stat HEAD` returning empty.

### 2. [Rule 2 — missing critical functionality] Loud failure on a 2xx without `api_key_id`, in both components

Not in the plan; carried from 160-02's deviation 2 per the orchestrator's
instruction. Both components now throw / `setFormError` a user-visible "Your key
was verified but not saved. Please try again." rather than reporting success for
a key the server never saved. Each has a dedicated oracle (neuters 3 and the
allocator's 4th test).

### 3. [Rule 2] Curated copy on the allocator's failed re-fetch

The plan specified curated copy; worth recording *why* it is an improvement
rather than a translation. The pre-conversion arm was
`setFormError(insertErr?.message ?? "Failed to save key")` — a raw PostgREST
string carrying SQLSTATE, relation and column names, rendered into the form
banner. That is the H-0405 leak class, in a component that had no H-0405 fix.
The new copy is also more honest about the split outcome: the key **is** saved
(the route returned an id); only this view could not load it.

### 4. [Rule 1 — dead/false documentation] Retired specs and a stale header

- **Three M-0407 specs retired** (allocator). They asserted the client insert
  carried the ciphertext and exercised its `?? `-fallback branches
  (`dek_encrypted ?? null`, the nullish-vs-falsy `kek_version ?? 1` preserving a
  valid version 0). Every one of those expressions was deleted with the insert;
  the route spreads its own `encrypted` object, so no client fallback remains to
  get wrong. An in-file comment records where the surviving obligation is pinned.
- **Two StrategyForm specs retired/retargeted**: the H-0405 connect-key insert
  redaction (its writer is gone; both halves of its coverage re-pinned and cited
  in-file) and F4's insert-payload assertion (retargeted onto the request body,
  the value's only remaining consumer).
- **One stale header line corrected** (`AllocatorExchangeManager.tsx:15`) which
  described the awaited first-run sync as following "the api_keys INSERT".

### 5. [Rule 3] `vi.restoreAllMocks()` added to StrategyForm's `afterEach`

`clearAllMocks` resets call history but leaves a `vi.spyOn(globalThis,"fetch")`
INSTALLED, so a later spec inherits the previous one's canned Response. My three
new specs each install their own fetch mock and depend on not inheriting a
neighbour's. Matches the project's documented remedy for the CI-only vitest skew
class.

## Coverage delta — recorded, not buried

M-0407's `kek_version` claim is **not** individually re-pinned. `route.test.ts`
(160-02) asserts `row.api_key_encrypted` and `row.dek_encrypted` on the captured
server INSERT, but not `row.kek_version`. It arrives by the same single
`...encrypted` spread as the two fields that ARE asserted — there is no per-field
expression that could single it out — so it is covered **structurally rather
than by name**. Adding the named assertion would mean editing `route.test.ts`,
which is outside this plan's `files_modified`. A one-line addition for whoever
next touches that file; noted in-place at the retirement comment as well.

## Known Stubs

None. No stub patterns, no `TODO`/`FIXME`, no skipped tests introduced. Two
assertions in the new SQL gate are deliberately DORMANT until plan 160-05 stamps
the marker — that is the designed two-landing behaviour (D-06), it announces
itself with a loud NOTICE naming exactly what is and is not enforcing, and both
were executed green in the armed state on the local fixture.

## Threat Flags

None new. The change removes surface: two more browser components lose an
`api_keys` write path and stop receiving ciphertext. The `service_role` write
path is pre-existing standing surface (T-160-07, disposition **accept**), and the
new SQL gate's header states that ceiling honestly — "only our own server code
can forge", never "cannot be forged" (ADR-0001/0003).

## Commits

| Task | Commit | Scope |
|------|--------|-------|
| 1 RED | `c238849c` | StrategyForm oracles, observed RED |
| 1 GREEN | `5a323db1` | StrategyForm conversion |
| 2 RED | `2e19921d` | Allocator oracles + table-aware supabase mock, observed RED |
| 2 GREEN | `2f84b652` | Allocator conversion + re-fetch |
| 2 follow-up | `6f86cfa5` | stale header line corrected |
| 3 | `c1604920` | the state-adaptive SQL gate |

## Self-Check: PASSED

- `src/components/strategy/StrategyForm.tsx` — FOUND (modified)
- `src/components/strategy/StrategyForm.test.tsx` — FOUND (modified)
- `src/components/exchanges/AllocatorExchangeManager.tsx` — FOUND (modified)
- `src/components/exchanges/AllocatorExchangeManager.test.tsx` — FOUND (modified)
- `supabase/tests/test_api_keys_insert_not_client_writable.sql` — FOUND (created)
- Commits `c238849c`, `5a323db1`, `2e19921d`, `2f84b652`, `6f86cfa5`, `c1604920` — all FOUND in `git log`
- `supabase/migrations/` — no file added or modified (confirmed via `git diff --stat`)
- `supabase/tests/test_api_keys_exchange_not_user_writable.sql` — NOT modified (prohibition honoured; confirmed via `git diff --stat`)
