---
phase: 145-job-csv-finalize-atomicity
verified: 2026-08-19T10:47:32Z
verified_at_head: 47022a6f
status: passed
score: 3/3 success criteria achieved
behavior_unverified: 2
overrides_applied: 0
re_verification: null
gaps: []
deferred: []
behavior_unverified_items:
  - truth: "SC#2 — a fault injected mid-fold leaves ZERO rows in strategies + strategy_verifications + csv_daily_returns, proven ON THE DEPLOYED BODY"
    test: "Trigger the `sql-tests` CI job at HEAD (push to main / same-repo PR with vars.E2E_TEST_DB_CONFIGURED=true) and read Part 2a/2b of supabase/tests/test_csv_finalize_atomic_fold.sql in the job log."
    expected: "Part 2a NOT-raised check passes (the malformed-date payload RAISES class-22 rather than returning a UUID), Parts 3/4/5/6/7 green."
    why_human: "The oracle only executes against the shared TEST Supabase project inside the gated `sql-tests` job. It cannot be run from this checkout (no local TEST_SUPABASE_DB_URL) and the verifier is forbidden from touching the DB. Its last observed GREEN is the artifact-recorded 2026-08-17 run, not a run at HEAD 47022a6f."
  - truth: "The 18 PROD orphan rows were TERMINALIZED (strategy_analytics 'failed' + reason, then status='archived') and the post-pass PROD orphan census is 0/0"
    test: "Re-run census queries (1) and (2) from 145-CONTEXT.md on PROD khslejtfbuezsmvmtsdn; spot-check 2-3 of the 18 ids for status='archived' + a strategy_analytics row at computation_status='failed' with a non-null computation_error."
    expected: "Census (1)=0 and (2)=0; the sampled ids archived with their analytics reason intact (the 15 incident casualties keep their ORIGINAL '400: Insufficient trade history' text via the COALESCE)."
    why_human: "A live PROD data mutation. 145-TERMINALIZE.md records the per-row list and the exact statements, but the resulting DB state is outside a read-only codebase verification's reach."
human_verification:
  - test: "Trigger `sql-tests` at HEAD and confirm test_csv_finalize_atomic_fold.sql / test_csv_finalize_auth_guard.sql / test_csv_finalize_double_submit.sql are GREEN."
    expected: "All three pass under psql -v ON_ERROR_STOP=1 against the TEST project."
    why_human: "Gated CI job against a shared remote DB; not runnable from this checkout."
  - test: "Re-measure the PROD orphan census and spot-check the terminalized rows."
    expected: "0/0, rows archived with reason preserved."
    why_human: "Live PROD state; verifier is read-only on the DB."
  - test: "Decide disposition on the three WARNING findings below (stale wizard copy fixtures; over-claiming Part 3 comment; no CI-durable no-handler prosrc pin)."
    expected: "Either filed to TODOS.md or fixed; none is user-facing or data-integrity, so per the project stopping rule none should block the milestone close."
    why_human: "A judgment call the founder's stopping rule reserves."
---

# Phase 145: JOB — csv-finalize atomicity (reproduce-first) — Verification Report

**Phase Goal:** A mid-request csv-finalize failure leaves no orphan strategy row — and no budget is spent re-fixing the likely-stale 42501 bug
**Verified at:** main HEAD `47022a6f` (post-145 PR #689, post-146.1 PR #692)
**Verified:** 2026-08-19T10:47:32Z
**Status:** human_needed
**Re-verification:** No — initial verification (no prior 145-VERIFICATION.md existed)

**Scope note (146.1 overlay).** Phase 146.1 (PR #692, `a6a2dee8`) modified artifacts Phase 145
built. Every verdict below is against the CURRENT state, with 146.1's deltas named where they
touch a 145 criterion. 146.1's changes to 145's surface are all STRENGTHENING — none reverses a
145 guarantee (detail in §"What 146.1 changed under Phase 145").

---

## Goal Achievement

### Success Criteria — per-criterion verdicts

| # | Success Criterion | Verdict | Load-bearing evidence at HEAD |
|---|---|---|---|
| 1 | A documented reproduction attempt of the 42501 / `PROCESS_KEY_UNIFIED_BACKBONE` claim against current `main` exists (committed pass/fail) BEFORE any fix is scoped | **ACHIEVED** | `145-REPRODUCTION.md` — 4 arms all executed with pre-registered oracles, final verdict **CANNOT REPRODUCE**; arm 1 promoted to a permanent CI gate; TODOS.md:818-827 bullet closed citing which of its own two remedies shipped |
| 2 | A fault injected between `finalize_csv_strategy`, `persist_csv_daily_returns` and the `after()` enqueue leaves no orphan strategy row (one SECDEF transaction OR compensating cleanup + Sentry) | **ACHIEVED (with 2 honest caveats)** | `20260819120000` + `20260819130000`: ONE 6-arg SECDEF `finalize_csv_strategy_with_returns` writing all three tables, **no handler clause anywhere**; both parent RPCs DROPped; route is the sole caller; Python branch deleted (tombstoned); `test_csv_finalize_atomic_fold.sql` Part 2 fault-injection oracle; Sentry `finalize-fold-fail` + `finalize-resolve-refused` |
| 3 | Happy-path csv-finalize behavior is unchanged — including the CONTRIB-02 owner-only private-finalize path if the RPCs are folded | **ACHIEVED** | Wire half: `route.test.ts:288-303` pins `p_terminal_status='private'` for `entry_context='contribution'` and `'pending_review'` for the default body. DB half: fold gate Part 3a (private written verbatim), 3b (default), 3d (`published` → 22023 before any write). Measured half: five-relation before/after diff vs the arm-4 baseline, identical on every field |

**Score: 3/3 success criteria achieved.** Two supporting truths are **present-but-behaviour-unverified
at HEAD** (the deployed-body oracle and the PROD terminalize) — see `behavior_unverified_items`.

---

### SC#1 — the reproduce-first gate

| Check | Result |
|---|---|
| Artifact committed | ✓ `145-REPRODUCTION.md` (25.8 KB) at HEAD |
| Arm 1 positive control (the 42501 guard FIRES) | ✓ Promoted to a permanent CI gate: `supabase/tests/test_csv_finalize_auth_guard.sql` Part A pins the **exact** message `finalize_csv_strategy_with_returns called without an auth session`, Part B pins the identity-mismatch raise, Part C asserts both parent functions are GONE from `pg_proc` |
| Arm 2 negative control (fresh call-site grep) | ✓ Recorded verbatim, executed at HEAD `330bca56` 2026-08-17T17:33:54Z. **Corroborated**: `330bca56` exists, dated 2026-08-17 17:20 UTC — 13 min before the grep, and before Wave 3 authored the fold. The reproduce-before-fix ORDERING holds |
| Arm 3 (Python gates) | ✓ Recorded with the mock-level overclaim caveat stated in the artifact, not hidden |
| Arm 4 (live TEST finalize) | ✓ GREEN, 200 + UUID, zero 42501 in any layer; doubles as the SC#3 baseline (`824b0fe8`) |
| Census corroboration | ✓ 18 PROD orphans, all 2026-05-07/05-21 incident-era, all predating the Phase 19.1 fix; zero in ~3 months since |
| "Could not reproduce" honored as a valid outcome | ✓ No 42501 fix was scoped anywhere in the phase; the D-02 split ("the GUARD is live, the PATH is closed") is stated in the artifact so the guard is not deleted as dead code |
| TODOS closure | ✓ TODOS.md:818-827 struck through, citing `route.ts:1324` forwards `X-User-Access-Token` and `process_key.py:1135` reads it |

Arm 1 is a **real** gate, not a grep: it CALLs the deployed function and asserts SQLSTATE + exact
message. It is auto-discovered by the `sql-tests` job glob (`.github/workflows/ci.yml:1020`) and
runs under `psql -v ON_ERROR_STOP=1`.

### SC#2 — the atomicity mechanism

**The mechanism exists and is load-bearing.** Verified line-by-line on the CURRENT body
(`20260819130000_csv_finalize_fold_input_guards.sql:222-421`, the `CREATE OR REPLACE` that
supersedes 145's original `20260819120000:204-342`):

| Property | Status | Evidence |
|---|---|---|
| ONE function, ONE transaction, three writes | ✓ | `strategies` INSERT (:374-384), `strategy_verifications` INSERT (:392-398), length-gated `csv_daily_returns` INSERT (:410-417) — one plpgsql body |
| SECURITY DEFINER + pinned `search_path` | ✓ | `:232-233` + apply-time assertions at `:514` and `:570` |
| **NO handler clause anywhere** | ✓ | Zero `EXCEPTION WHEN` in the body (:222-421 scanned); every new 146.1 guard RAISEs, none catches |
| Both parents DROPped | ✓ | `20260819120000:349-350`; asserted again by `test_csv_finalize_auth_guard.sql` Part C and by both migrations' STEP 4 pg_proc counts |
| Grants: `authenticated` only | ✓ | REVOKE from PUBLIC/anon (`:430`) **and** from `service_role` (`:441`, 146.1 finding C4 — 145 documented "authenticated ONLY" but only asserted anon); assertions at `:525` / `:533` |
| Dailies INSERT names exactly `(strategy_id, date, daily_return)` | ✓ | `:411` — leaves `api_key_id`/`allocator_id` NULL, satisfying the 20260624120000 XOR CHECK |
| `wizard_session_id` written (so the partial unique index bites) | ✓ | `:381`; pinned by `20260819120000:438-441` |
| 5000-row cap survives verbatim | ✓ | `:317`; pinned by a word-bounded regex in both STEP 4s and by fold-gate Part 5 |
| 143's + 144's migrations untouched | ✓ | `20260816140000` and `20260817120000` carry no 145 hunks |

**The request path has exactly one writer.** `src/app/api/strategies/csv-finalize/route.ts` has
precisely two `.rpc(` call sites: the fold at `:611`, and `enqueue_compute_job` at `:1356` inside
`after()`. The standalone persist call and the pre-fold stale-range probe are gone from the
request path — the probe now survives only INSIDE the 23505 resolve arm, as reads, after the
fold has already failed and committed nothing.

**The second writer was removed, not just bypassed.** `analytics-service/routers/process_key.py`
:1126-1183 is a tombstone: a `flow_type='csv', step='finalize'` request falls through to the
API-6 422 with a message that says the service stopped being a writer for this flow. Pinned by
`test_pyapi_10b_csv_finalize_tombstone_and_422_arm`, which explicitly records the RED it was
observed at ("the old 401 assertion failed against the tombstone").

**Observability delivered.** `finalize-fold-fail` (route.ts:786-790) and
`finalize-resolve-refused` (route.ts:987-990) — the two arms that had ZERO capture pre-fold.

#### Caveat 2a — the "zero rows" half of the fault-injection oracle is partly tautological

`test_csv_finalize_atomic_fold.sql` Part 2c counts 0/0/0 after the injected fault — but the
`BEGIN ... EXCEPTION WHEN OTHERS` wrapper around the probe call is an implicit PL/pgSQL
subtransaction, so those counts are 0/0/0 by savepoint semantics regardless of what the fold
does. **The phase itself found and disclosed this** (146.1-07 wrote the honesty note in-place at
`:194-212`: "Do not read a green Part 2c as independent evidence of the fold's atomicity").

This is NOT a vacuous gate overall: **Part 2a is the discriminating assertion and it can fail** —
if the malformed payload SUCCEEDS (a handler swallowed the error and returned a UUID, or the
dailies write was silently dropped), Part 2a REDs. Part 2b pins the failure to class 22. Part 3c
of the double-submit gate independently proves the FIRST submission's 3 dailies survive intact.

Recorded because the phase's own SUMMARY prose overstates it: "the atomicity oracle left 0/0/0
across three tables after a mid-body class-22 fault AT THE DEPLOYED BODY" reads as an independent
measurement; per the file's own note, it is belt to Part 2a's braces.

#### Caveat 2b — the `after()` enqueue leg is delegated, not transactional

SC#2's wording names the `after()` enqueue. It cannot be inside the DB transaction and is not:
hop 5 remains post-response BY DESIGN. The phase's argument (recorded in the migration header
and confirmed in the code) is that a lost enqueue now leaves a **consistent** strategy+dailies
state with no compute job — window D, not an orphan strategy row — and that Phase 143's shipped
sweep (`20260816140000`) heals it. Enqueue failures are alertable
(`csv-finalize-after-failloud.test.ts`, 4 paths, each pinning a `tags.step`).

**No test inside Phase 145 proves 143's sweep actually readmits a csv window-D strategy.** That
leg is asserted-and-delegated. Not a blocker (143 is a separately shipped, separately gated
mechanism, and "no orphan strategy row" — the criterion's actual words — holds) but it is not
demonstrated here.

### SC#3 — happy path unchanged

| Half | Evidence | Status |
|---|---|---|
| Wire | `route.test.ts:270-303` — default body → fold with `p_terminal_status='pending_review'`, no /process-key dispatch; `entry_context='contribution'` → fold with `'private'`, returns `status='private'`. The CONTRIB-02 describe is intact | ✓ |
| Route source | `route.ts:1764` passes `terminalStatus: "private"` verbatim; `:1783` `"pending_review"`; `:1857-1862` records that it is never derived | ✓ |
| DB | Fold gate Part 3a (private written), 3b (default `pending_review`), 3d (`published` → 22023 BEFORE any write, 0/0 counts) | ✓ |
| Economic oracle | Part 3c: 2 rows persisted for a 2-row submission and the spot value is `-0.0032` EXACTLY as submitted — the fold is not editing the user's track record | ✓ |
| Measured before/after | `145-REPRODUCTION.md:296-320` — five relations (strategies, strategy_verifications, csv_daily_returns, compute_jobs, strategy_analytics) identical between the arm-4 OLD-path baseline `824b0fe8` and the NEW-path run `0cc8bdb1`. One divergence occurred and was **explained and reproduced away** (harness killed `next dev` before the `after()` flush), not hidden | ✓ (artifact-recorded; not re-runnable read-only) |

---

## Gates located, and whether they can fail

| Gate | Runs where | Binds to behaviour? | Can it fail? |
|---|---|---|---|
| `supabase/tests/test_csv_finalize_atomic_fold.sql` (Parts 1-7) | `sql-tests` CI job, psql against TEST | YES — CALLs the deployed function | YES via Part 2a/3d/4/5/6/7 (Part 2c is belt-only, disclosed in-file) |
| `supabase/tests/test_csv_finalize_auth_guard.sql` (A/B/C) | same | YES — exact SQLSTATE + exact message | YES (a rename/weakening REDs; Part C REDs if a parent is recreated) |
| `supabase/tests/test_csv_finalize_double_submit.sql` (1-4) | same | YES | YES via Part 2a (a second submit succeeding) and Part 3a/b/c |
| Migration STEP 4 self-verify (both 20260819120000 and 20260819130000) | migration APPLY time only | YES (prosrc regex incl. `EXCEPTION[[:space:]]+WHEN`) | YES, but one-shot per migration — see W3 |
| `csv-finalize-c14-regression.test.ts` A/B/C (replacements for RED-TEAM-M1) | vitest, every shard | YES — drives the real route with a mocked RPC and asserts the REAL response copy, the REAL capture tags, and `updateMock`/`insertMock`/`upsertMock` **not** called | YES |
| `route.test.ts` CONTRIB-02 | vitest | YES — inspects the actual RPC args | YES |
| `test_pyapi_10b_csv_finalize_tombstone_and_422_arm` | pytest | YES | YES (documented RED at the flip) |

**The vacuous RED-TEAM-M1 block is gone.** `grep -rn "RED-TEAM-M1" src/` returns zero hits; the
only surviving mentions are in planning artifacts explaining the deletion. Its three replacements
drive the arms Plan 04 actually built. `csv-finalize-rpc.test.ts` (deferred item #5, left open by
145) was closed by 146.1 finding B5: the six skip-gated live-DB cases were removed and their three
real guard behaviours re-homed to fold-gate Part 7a/7b/7c, which executes in CI. Verified: Part 7
exists at `test_csv_finalize_atomic_fold.sql:940-1043`.

---

## Executed checks (this verification, at HEAD)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | ✓ clean |
| csv-finalize vitest suites | `npx vitest run` on c14-regression, after-failloud, cross-submission-merge, route.test.ts | ✓ **4 files / 73 tests passed** |
| Python (CI collection order) | `python3 -m pytest tests/test_process_key.py tests/test_process_key_200_discriminator.py -q` from `analytics-service/` | ✓ **125 passed** |
| Python (reversed order — control) | same two files, order swapped | 20 failed — `RuntimeError: SUPABASE_URL and SUPABASE_SERVICE_KEY required` from `services/db.py:76`. A pre-existing local cross-file env/cache-isolation artifact affecting tests unrelated to 145; CI collects alphabetically (`test_process_key.py` first) where all 125 pass. **Not a Phase 145 defect** |
| Debt markers in phase files | grep `TBD|FIXME|XXX` over route.ts, c14 test, both migrations, fold gate, process_key.py | ✓ zero (the `TODO` hits are the filename `TODOS.md`) |
| Dishonest copy removed | grep `"Nothing was changed"` / `"Your strategy was created but the daily-return data"` in `src/` | route.ts: ✓ both gone. **One stale residue in a test fixture — see W1** |

---

## What 146.1 changed under Phase 145

| 146.1 finding | Change to a 145 artifact | Effect on a 145 criterion |
|---|---|---|
| A1 | New migration `20260819130000` `CREATE OR REPLACE`s the fold with 5 new guards (p_rows NULL, NULL-explicit fmt, empty-array narrowed to `trades`, value scan, duplicate-date scan) — all above the strategies INSERT | STRENGTHENS SC#2. Header + STEP 4 preserve the no-handler property and the 5000 cap spelling. The measured hole was real: `p_rows := NULL` walked past every rows guard (three-valued logic) and committed a zero-dailies strategy 143's sweep structurally cannot heal |
| C4 | `REVOKE ALL ... FROM service_role` + an assertion; and the Python tombstone MESSAGE (code deliberately kept as `MISSING_STRATEGY_ID`, not a new code, because WIZFORM-02 is open) | CLOSES a gap 145 documented but did not assert |
| A2 | `route.ts:1044` — the 23505 echo now refuses when the committed status differs from the request's terminal status | STRENGTHENS SC#3's contribution/manager separation |
| B5 | `csv-finalize-rpc.test.ts` live-DB block removed; guards re-homed to fold-gate Part 7 | CLOSES 145's open deferred item #5 |
| 146.1-07 | Honesty note added to fold-gate Part 2c | CORRECTS an overstatement in 145's own evidence (see Caveat 2a) |
| B4 | New migration `20260819130500` readmits terminalizer-produced orphans to 143's sweep | Phase **144**'s residual, not 145's — no bearing on these criteria |

---

## Asserted but NOT demonstrated

Stated plainly. None of these falsifies a success criterion; each is something a reader should
not take as verified-at-HEAD.

1. **"The atomicity oracle GREEN on the deployed body."** True as of the artifact-recorded
   2026-08-17 TEST run. It has NOT been re-observed at HEAD `47022a6f` by this verification: the
   `sql-tests` job needs `TEST_SUPABASE_DB_URL` (absent locally) and the DB is out of scope.
2. **"18 PROD rows terminalized; post-pass census 0/0."** Recorded per-row with rollback anchors
   and the exact UPDATE statements in `145-TERMINALIZE.md`. The resulting PROD state is not
   re-verifiable read-only.
3. **"Part 2c proves the fold's atomicity."** It does not, independently — the file itself now
   says so. Part 2a carries it.
4. **"The `after()` enqueue leg leaves no unrecovered strategy."** Argued (window A → window D)
   and delegated to Phase 143's shipped sweep; no Phase-145 test exercises that recovery.
5. **Reproduce-before-fix commit ordering.** PR #689 was squash-merged, so intra-PR ordering is
   not recoverable from main's history. Corroborated instead by the artifact's dated verbatim
   arm-2 output anchored at `330bca56` (a real commit, 2026-08-17 17:20 UTC, predating Wave 3).
6. **The RED observations.** Every "observed RED under neuter" claim in the SUMMARYs is a
   process claim about a transient state. This verification confirms the gates EXIST, BIND to
   behaviour, and PASS — it cannot re-observe the REDs without mutating source (out of scope).
   Two REDs are independently corroborated by comments left in the code itself
   (`CsvSubmitStep.upstream-arm.test.tsx:260-266`, `test_process_key_200_discriminator.py:951`).
7. **CI enforcement strength.** `sql-tests` requires `vars.E2E_TEST_DB_CONFIGURED` and runs only
   on push / same-repo PR; branch protection is deferred on this repo by founder decision. These
   gates "would have caught" regressions — they do not, today, block a merge.

---

## Warnings (non-blocking; not user-facing, not data-integrity)

**W1 — a copy-parity gate pinned to copy production no longer emits.**
`src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.upstream-arm.test.tsx` (a file
Phase 145 DID edit — `9386bae5`, 13 lines) declares two constants labelled "`csv-finalize/route.ts`
— verbatim":
- `ROUTE_PERSIST_FAIL` = "Your strategy was created but the daily-return data could not be
  saved…" — **this string does not exist anywhere in route.ts at HEAD.** The real
  `CSV_PERSIST_FAIL` emitter (route.ts:939-941) now says "We could not confirm what is already
  saved…, so we stopped before writing anything of this submission."
- `ROUTE_SESSION_REUSED` = "…Nothing was changed…" — likewise stale; the real 409 (route.ts:1004)
  now says "…we refused before writing anything of this submission."

Consequence: the ⭐ test at `:232` still justifies itself with "The route says the strategy WAS
created and the series was NOT saved" — a premise the fold made FALSE — and the whole describe
feeds itself its own fixture, so it cannot fail when production copy drifts. The route-side
must-have ("each sentence pinned by a test that can fail") IS satisfied elsewhere: the c14 A/B
replacements assert the route's REAL strings from the REAL response. This is fixture-provenance
drift, not a live copy defect.

**W2 — an over-claiming comment the honesty pass missed.**
`supabase/tests/test_csv_finalize_double_submit.sql:222-227` claims Part 3 catches "a handler that
catches it, writes dailies onto the existing strategy, and re-raises". It does not: the re-raise
propagates through the same implicit subtransaction and the write is undone regardless. The
identical savepoint honesty note that 146.1-07 added to the fold gate's Part 2c was not applied
here. Part 3's assertions remain correct and useful (they prove the FIRST submission's 1/1/3
survive); only the stated discrimination is wrong.

**W3 — the no-handler invariant has no CI-durable pin.**
The migration headers call the absence of a handler clause "THE mechanism of this migration", and
both migrations assert it with a comment-stripped `EXCEPTION[[:space:]]+WHEN` regex — but only at
their own APPLY time. A future `CREATE OR REPLACE` that reintroduces a handler would apply
cleanly and no standing CI gate would red. The house already has the pattern (10+ `supabase/tests/
test_*.sql` files carry `prosrc` structural assertions); the fold's own gate does not. The
behavioural proxy (fold-gate Part 2a) catches the dangerous SWALLOW shape but not a
catch-and-re-raise. Cheap, durable fix available: add a `prosrc` no-handler assertion to
`test_csv_finalize_atomic_fold.sql` Part 1.

---

## Requirements Coverage

| Requirement | Source | Status | Evidence |
|---|---|---|---|
| JOB-06 | Plans 145-01…06 | ✓ SATISFIED | Both halves met: the reproduce-first gate produced a committed CANNOT-REPRODUCE verdict (no 42501 budget spent), and the genuinely-open gap is closed by ONE SECURITY DEFINER transaction (not compensating cleanup), with Sentry on both failure arms. REQUIREMENTS.md:1449 records "Complete (2026-08-18, PR #689)" — corroborated at HEAD |

No orphaned requirements: `.planning/REQUIREMENTS.md` maps only JOB-06 to Phase 145, and every
plan declares `requirements: [JOB-06]`.

---

## Bookkeeping

`.planning/ROADMAP.md` Phase 145 says "**Plans**: 5/6 plans executed" while all six checkboxes are
`[x]` and all six SUMMARY files exist at `status: complete`. Stale counter only; no work is
missing. `145-06-SUMMARY.md` still reads `status: complete — awaiting the Task-3 human approval to
ship`, which the merge of PR #689 superseded.

---

## Gaps Summary

**No gaps block the phase goal.** All three success criteria are achieved in the codebase at HEAD
`47022a6f`, and the phase's central claim — csv-finalize is now ONE transaction with no handler
clause and exactly one writer — is verifiable directly in the migration body, the route, the
Python tombstone, and four CI-wired gates that bind to behaviour rather than to greps.

Status is `human_needed` rather than `passed` for two reasons, both of which are limits of a
read-only codebase verification rather than defects:

1. The deployed-body atomicity oracle and the PROD terminalize are **artifact-recorded from
   2026-08-17**, not re-observed at HEAD. Both need a human (a `sql-tests` CI run; a PROD census
   re-measure).
2. Three WARNING findings (W1/W2/W3) need a disposition decision. Under this project's stopping
   rule — reviews block only on user-facing or data-integrity issues — none should block the v1.19
   milestone close; all three are test-fidelity/durability items appropriate for TODOS.md.

The single finding worth the founder's attention is **W3**: the invariant the phase exists to
protect is pinned only at migration-apply time, and a one-line `prosrc` assertion in the existing
fold gate would make it CI-durable.

---

_Verified: 2026-08-19T10:47:32Z at main `47022a6f`_
_Verifier: Claude (gsd-verifier) — read-only on source; no DB access; no git writes_

---

## Human-item closure record (2026-08-20, orchestrator session — v1.19 milestone audit)

All three human items CLOSED; status flipped `human_needed` → `passed`.

1. **`sql-tests` at HEAD** — CLOSED. CI run 32360136832 (PR #695 head, a
   descendant of 47022a6f; the three suites gained +279 lines since, none
   weakened) ran `sql-tests` GREEN 2026-08-20 10:57Z and the job log shows all
   three files executing, including `Part 2 OK: mid-body fault (SQLSTATE 22007,
   element 6 of 10) left ZERO rows in strategies, strategy_verifications and
   csv_daily_returns.` — the SC#2 oracle observed on the deployed body.
2. **PROD orphan census** — CLOSED. Measured 2026-08-20 via Supabase MCP on
   `khslejtfbuezsmvmtsdn`: census (1) = **0**, census (2) = **0**. Spot-check of
   3 of the 18 terminalized ids (`5454d0d5…`, `58786362…`, `454a301c…`): all
   `status='archived'` with `strategy_analytics.computation_status='failed'`
   and a non-null reason ("csv-finalize orphan reaped by Phase 145 one-time
   pass (2026-…") preserved.
3. **W1/W2/W3 disposition** — CLOSED: all three were FIXED in code by Phase
   146.2, none needs filing. W1 → 146.2-07 re-typed the
   `CsvSubmitStep.upstream-arm.test.tsx` fixtures from HEAD with symbol anchors
   (file names the W1 false-provenance class it corrects). W2 → the honesty
   note now sits at `test_csv_finalize_double_submit.sql` Part 3 header, citing
   "v1.19 review-of-146.1 finding W2". W3 → the standing no-handler `prosrc`
   pin is Part 1d of `test_csv_finalize_atomic_fold.sql` (citing finding W3)
   and executed GREEN in today's `sql-tests` run.
