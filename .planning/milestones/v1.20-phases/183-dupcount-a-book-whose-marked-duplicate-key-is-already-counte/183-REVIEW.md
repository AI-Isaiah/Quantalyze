---
phase: 183-dupcount-a-book-whose-marked-duplicate-key-is-already-counte
round: 1
reviewed: 2026-11-01T11:33:07Z
reviewed_at_sha: 50a320a0a19572e59ebd9e2cf1ffb6be5b238a61
diff_base: 8c8edc452
depth: deep
files_reviewed: 22
files_reviewed_list:
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/fixtures/derive_refusal_rows.json
  - analytics-service/tests/fixtures/shared_account_resolution.json
  - analytics-service/tests/test_derive_allocator_equity_job.py
  - analytics-service/tests/test_derive_refusal_rows.py
  - analytics-service/tests/test_holder_matrix_parity.py
  - scripts/accounttruth-census.mjs
  - src/__tests__/accounttruth-census.test.ts
  - src/components/exchanges/AllocatorExchangeManager.liveness.test.tsx
  - src/components/exchanges/AllocatorExchangeManager.test.tsx
  - src/components/exchanges/AllocatorExchangeManager.tsx
  - src/components/strategy/ApiKeyManager.test.tsx
  - src/components/strategy/ApiKeyManager.tsx
  - src/lib/__tests__/derive-refusal-rows.test.ts
  - src/lib/__tests__/holder-matrix-parity.test.ts
  - src/lib/account-share-note.test.ts
  - src/lib/account-share-note.ts
  - src/lib/queries.benchmark-feed.test.ts
  - src/lib/queries.my-allocation.test.ts
  - src/lib/queries.test.ts
  - src/lib/queries.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 183: Code Review Report (round 1)

**Reviewed:** 2026-11-01T11:33:07Z
**Depth:** deep (cross-file: writer, reader, census twin, stamper, nightly fan-out)
**Files Reviewed:** 22 (diff `8c8edc452..HEAD`, `.planning/` excluded)
**Status:** issues_found

## Summary

The phase does what D-01 asks for in the steady state. The writer no longer refuses a marked
pair. The account-group loop counts the pair once (`job_worker.py:14775-14821`). A pair that
were both counted would still collide, because `account_identity_tokens` unions a marker link
into one token (`allocator_equity_derive.py:487-497`). That is pinned by
`test_a_marker_pair_that_were_both_counted_collides_as_one_account` and end to end by the
holder-matrix "no refusing cell" guard. The reader dropped `countsAsDuplicate`, and the census
twin dropped its `dup` arm in step with it. A stored `account_duplicate` row still maps to
`duplicate_account` in the reader (`queries.ts:4558`) and in the census CASE
(`accounttruth-census.mjs:338`), and three tests pin that (Python, TS reader, real-PG census).
Nothing in the services, routers, SQL or scripts turns a stored token back into
`DeriveRefusal`, so retiring the enum member cannot raise on the stale PROD row. The note copy
and tone fit DESIGN.md: muted is the "steady-state" gate, the copy is in the active voice
("We count…"), and amber is kept for recoverable states.

Targeted runs at HEAD: `pytest tests/test_derive_refusal_rows.py tests/test_holder_matrix_parity.py
tests/test_derive_allocator_equity_job.py` gave **230 passed**. `vitest run` over
holder-matrix-parity, derive-refusal-rows, account-share-note and queries gave **299 passed**.

**The silent-failure hunter's MEDIUM is CONFIRMED (WR-01).** A curve composed before the
duplicate marker was written, which counted both keys, is now drawn as `ready` from the moment
the marker lands until the next compose, which can be up to a day later. Before this phase the
key-list arm hid that row from the same moment. A probe against the real derive confirms the
writer half (output under WR-01).

## Answers to the brief

| Question | Verdict | Evidence |
|---|---|---|
| Can a real double count now pass silently? | **Yes, in one new window (WR-01).** A marked pair cannot be counted twice in a fresh compose. Unknown-identity double counts that predate this phase remain (IN-03). | probe below; `allocator_equity_derive.py:487-497`, `:520-531` |
| Does the reader still map a stale stored `account_duplicate` row? | **Yes.** | `queries.ts:4558`; `derive-refusal-rows.test.ts` legacy loop; `queries.test.ts` "Phase 183 transition"; census real-PG calibration arm |
| Is a curve composed BEFORE the marker drawn although it double-counts? | **CONFIRMED.** | WR-01 |
| Do the legacy token handling and the vocabulary pin hold? | **Yes.** `test_no_legacy_refusal_is_a_derive_refusal_member` fails if the token returns to the enum. The per-member row test fails if the row count drifts. No runtime code parses a stored token into the enum. | `git grep "DeriveRefusal("` returns only the class definition |
| Can the tests fail? | **Yes, for what they cover.** The summaries record mutations seen RED for m1-m3 (writer), m1-m2 (reader), m1-m4 (census and vocabulary) and m1/m3 (note). The TS parity guard now asserts `outcome: "compose"` per cell, so a `refuse` cell added back fails it. **No test covers WR-01.** | 183-0x-SUMMARY mutation sections |
| Does the copy and colour fit DESIGN.md? | **Yes.** | DESIGN.md "Semantic-color gates" (Muted = steady-state), "Voice / microcopy" (active voice) |

## Warnings

### WR-01 (MEDIUM, data integrity, user-facing): a curve composed before the duplicate marker landed, which counts the account twice, is drawn as `ready` until the next compose

**Files:**
- `src/lib/queries.ts:4671-4692` (`equityHistoryReadiness`: the key-list duplicate arm is gone, and nothing ties the stored row to the key list it was composed from)
- `analytics-service/services/account_identity.py:416-445` (`_mark_shared` writes the marker and enqueues no compose)
- `analytics-service/services/allocator_equity_derive.py:520-531` (`identity_pending_venues` needs TWO unknown keys on a venue before it marks a curve untrustworthy)
- `scripts/accounttruth-census.mjs:351-358` (census (e) reads the same book as `ready`, so a census reading cannot see it either)

**Issue.** Before Phase 183 a stored curve was hidden from the moment the stamper wrote the
marker. `countsAsDuplicate` returned `duplicate_account` from the key list, whatever the
stored row said. The next compose then refused. That arm was also the only thing standing
between the owner and a curve composed while the marked key was still unknown and counted. It
is now gone, and nothing replaces it. Neither the marker write nor the reader triggers or
requires a fresh compose.

**Writer half, measured.** A scratch probe (not committed) runs `run_derive_allocator_equity_job`
through the repo's own `_FakeSupabase`. Holder H is stamped (`venue_account_id='venue-shared'`).
Key B is on the same venue, unstamped and unmarked. Both hold a 1,000 anchor:

```
UNMARKED 2 2000.0 True []     # n_keys=2, terminal 2000, is_trustworthy=True, no degrade
MARKED   1 1000.0 True []     # after the stamper marks B: counted once
```

The unmarked compose is trustworthy because `identity_pending_venues` counts only venues with
two or more unknown working keys. Here H is known and B is the only unknown key. B's token is
`None`, so `account_identity_collisions` sees no collision either.

**Failure scenario.**
1. The owner connects key B, a second login on the Binance account that key A already
   stamped.
2. B's stamp does not land on its first poll. The poll can end before DONE (the ccxt stamp runs
   only on the DONE path, `job_worker.py:13279-13288`). It can hit the 429 arm. The stamp can
   time out, or return `no_id` or `_HolderVanished`. Meanwhile B's `derive_broker_dailies`
   succeeds, and its epilogue enqueues the compose (`job_worker.py:8656-8676`).
3. The compose counts A and B. It stores a version-2 trustworthy curve at twice the account's
   equity.
4. The reader holds the book in `account_identity_pending` for now. B is an unknown ccxt key
   (`identityStillPending`).
5. On B's next successful poll the stamper marks B as a `duplicate` of A. `identityStillPending`
   now treats B as known through its holder, and no duplicate arm remains, so
   `equityHistoryReadiness` returns `ready`. The Overview draws the stored double-counted curve
   as a real track record. Census (e) agrees with `ready`.
6. The curve stays up until the next compose. The nightly fan-out enqueues one
   `derive_broker_dailies` per key per UTC day (idempotency key
   `derive-dailies-<key>-<date>`, migration `20260717233529`), so the window can run up to about a
   day.

Before this phase, step 5 showed `duplicate_account` and step 6 refused. The window was closed.

**Fix (minimal, writer side).** When `_mark_shared` writes a new marker (not the
unchanged-marker early return), enqueue a recompose for the owner. Use the same best-effort,
logged call the dailies epilogue uses:

```python
# account_identity._mark_shared, after `if not await db_execute(_q): raise _MarkerNotWritten()`
def _enqueue_recompose() -> None:
    supabase.rpc(
        "enqueue_compute_job",
        {"p_strategy_id": None, "p_allocator_id": str(key_row["user_id"]),
         "p_kind": "derive_allocator_equity"},
    ).execute()
try:
    await db_execute(_enqueue_recompose)
except Exception as exc:  # noqa: BLE001 — the marker stands; the recompose is retried nightly
    logger.warning("account_identity: recompose enqueue after a new marker failed: class=%s code=%s",
                   type(exc).__name__, _error_code(exc))
```

Add a test that fails without the fix. A book whose stored curve counts two keys gets a marker
written, and a `derive_allocator_equity` enqueue for that owner must follow.

⚠️ **Residual of that fix.** A compose already RUNNING when the marker lands absorbs the
enqueue (the in-flight dedup covers `running`, see migration `20260927180000` step 1 comment),
and may write the double count after the marker. Say so in the fix. Alternatively, take the
more robust reader-side route: the writer stores a count-only identity fingerprint in
`inputs` (for example the number of marked keys and of unknown eligible keys, with no ids), and
the reader and census treat a mismatch with the live key list as `awaiting_derivation`.

### WR-02 (LOW, records): the 167.1.2 recompute runbook and an open HUMAN_NEEDED item gate on a census bucket this phase deleted, and tell the founder to disconnect keys, against D-02

**Files:**
- `.planning/phases/167.1.2-accounttruth-…/167.1.2-RECOMPUTE-RUNBOOK.md:39, 47, 112-121`
- `.planning/phases/167.1.2-accounttruth-…/167.1.2-C5-VERIFY.md:39, 119` (P6, HUMAN_NEEDED)

**Issue.** Census (b) no longer prints `duplicate.blocking` or `duplicate.blocking_owners`
(`accounttruth-census.mjs:183-191`, `SECTIONS` b `gate: []`). The runbook's step 4 still reads
"Gate: (b) `duplicate.blocking_owners` > 0 … the founder disconnects the flagged duplicates with
the key card's existing Disconnect control". Step 5's "Done" reads "`duplicate.blocking_owners`
is 0 … no key card shows the duplicate note". Since D-02 the note shows for every working
marked pair, and it is meant to stay. So "no key card shows the note" can be reached only by
disconnecting keys, which the founder's rule (one account behind several logins is intended)
calls wrong.

**Failure scenario.** An operator re-runs the recompute runbook or works P6. They find the gate
bucket missing and fall back on "the key cards show the note", which they always will, then
disconnect the founder's keys as step 4 instructs.

**Fix.** Add a dated `⛔ CORRECTED 2026-11-01 (Phase 183 D-01/D-02)` note to steps 4 and 5 and
to the section table's (b) row: the gate is retired, nothing is disconnected, and the note is
information only. Reword or close P6 in `167.1.2-C5-VERIFY.md` on the same grounds. Keep the old
text as lineage, as this repo does.

## Info

### IN-01 (INFO): during the deploy transition the panel and the Exchanges page contradict each other

**File:** `src/app/(dashboard)/allocations/components/EquityHistoryRebuilding.tsx:234-240`, `src/lib/account-share-note.ts:108`

The PROD book's stored `account_duplicate` row reads `duplicate_account` until the next derive
replaces it. During that window the Overview says "Two of your keys read the same exchange
account. Disconnect one of them on the Exchanges page". The Exchanges page now says "We count
that account once." and offers no remedy. This is founder-accepted by D-03 and lasts until one
derive runs after Railway deploys. No fix is required. The SC-4 reading (plan 183-04) should
note it, and so should the founder if the panel is seen in that window.

### IN-02 (INFO): census `KEYS_CTE.working` is now read by no section

**File:** `scripts/accounttruth-census.mjs:95-96, 109-110`

The `working` column existed for `blocking` (b) and `dup` (e). Both are deleted, and no other
section reads `working`. The header comment still describes it as the `isWorkingHolder` twin. It
is harmless, but a reader may assume some section still applies D-18 to holders. Drop it, or
add a comment that it is kept only for parity with the TS rule.

### IN-03 (INFO, predates the phase): the identity gate's comment says more than the gate can see

**File:** `analytics-service/services/job_worker.py:14887-14893`

The rewritten comment ends "Checked BEFORE anything is composed, so a double-counted book never
composes." The gate sees only KNOWN identity tokens (venue id or marker link). The WR-01 probe
shows a book composing a trustworthy double count when a second key on a known account is still
unknown. On ccxt the reader holds that case with `account_identity_pending`, at least until the
marker lands (WR-01). On MT5 and sFOX nothing holds it: the reader exempts them, and
`identity_pending_venues` excludes MT5. This predates Phase 183 and is not in its scope. Reword
the comment to "a double count between keys whose account is known never composes", so the
next reader does not read the gate as complete.

---

_Reviewed: 2026-11-01T11:33:07Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Fix round 1

**Scope:** WR-01 only (founder rule: minimal fix, no new abstractions or defensive checks). WR-02 and IN-01..IN-03 were not touched.

**Commits:**
- `95d813e90` fix(183): `analytics-service/services/account_identity.py`, `_write_marker_and_audit`. After a marker UPDATE lands on a row, the same thread task calls `enqueue_compute_job` (`p_strategy_id` NULL, `p_allocator_id` the key's owner, `p_kind` `derive_allocator_equity`), the call the per-key derive epilogue uses. Best effort: a failure is logged (class and code, no message) and the marker stands. It sits beside the audit, not in the async `_mark_shared`, so a budget cancellation cannot land the marker and drop the enqueue. The unchanged-marker early return never reaches it, so only a new marker enqueues.
- `7a54db990` test(183): `analytics-service/tests/test_account_identity_stamper.py`. The `FakeSupabase` double records `rpc` calls. Four new cases: a new duplicate marker and a new composite_member marker each enqueue the owner's recompose; an unchanged marker enqueues nothing; a failing enqueue leaves the marker written, the outcome unchanged and a warning logged.

**RED evidence:** with `"p_kind": "derive_allocator_equity"` replaced by a different kind in `account_identity.py` (byte backup taken first, restored by copy, `NEUTERED` count 0 after), `pytest tests/test_account_identity_stamper.py` gave 2 failed (`test_a_new_marker_enqueues_the_owners_recompose[False]` and `[True]`), 128 passed. Restored: 130 passed.

**Gates (from `analytics-service/`):** `pytest -n auto -q`: 14081 passed, 102 skipped. CI's mypy line: Success, no issues found in 131 source files. No TS touched.

**Residual (as WR-01 stated):** a compose already running when the marker lands absorbs the enqueue through the in-flight dedup and may write the double count after the marker. The nightly fan-out recomposes it. The reader-side fingerprint alternative was not taken (a new mechanism).


## Round 2

**Reviewed:** 2026-11-01T11:46:32Z, at `8c818eff0` (fix `95d813e90`, test `7a54db990`)
**Scope:** `git diff 50a320a0a..HEAD -- . ':!.planning'`: `analytics-service/services/account_identity.py`, `analytics-service/tests/test_account_identity_stamper.py`
**Depth:** deep (traced into the RPC body in `supabase/schema/baseline.sql`, the per-key derive epilogue, both stamper call sites and the compose's key read)
**Status:** WR-01 closed. Two LOW findings (records, test pin). No new defect in the code.

### Answers to the brief

| Question | Verdict | Evidence |
|---|---|---|
| (1) Does the fix close WR-01, with the same RPC and arguments as the epilogue? | **Yes.** The call is `enqueue_compute_job` with `{"p_strategy_id": None, "p_allocator_id": <owner>, "p_kind": "derive_allocator_equity"}`, the same as the epilogue (`job_worker.py:8666-8673`). `p_strategy_id` is passed explicitly, so PostgREST resolves the one overload (`baseline.sql:4857`). The allocator-scoped branch needs `service_role` or `p_allocator_id = auth.uid()` (`baseline.sql:4875-4910`). The worker's client is `service_role`, as in the epilogue. The owner is `ctx.key_row["user_id"]` in both: the poll binds `allocator_id = ctx.key_row["user_id"]` (`job_worker.py:12897`) and hands that same `ctx.key_row` to the stamper (`:12926`, `:13284`). The epilogue's owner is `ctx.key_row["user_id"]` too (`:4321`). The compose re-reads the markers live (`_load_keys`, `job_worker.py:14636-14650`), so a compose that is still `pending` when the marker lands also counts the pair once. | read |
| (2a) An enqueue on an unchanged marker? | **No.** The unchanged-marker early return in `_mark_shared` sits before `_write_marker_and_audit`. `ctx.key_row` is read fresh by each poll's preflight. MT5 stamps once per poll, before the fetch, and the DONE path skips it (`job_worker.py:13277-13288`). A holder change or a duplicate-to-composite flip is a real new marker, and it should enqueue. | read; M4 below |
| (2b) A wrong owner? | **No.** Same source as the epilogue. A marker can name only a holder that belongs to the same owner (trigger `api_keys_account_share_same_owner`), so the key's owner is the book's owner. | M2 below |
| (2c) Can an exception path drop the marker or the audit? | **No.** The UPDATE and the audit run before the enqueue. The `try` wraps the whole call, `key_row["user_id"]` included. It runs in the same synchronous thread task, so `asyncio.wait_for` cannot split it (a cancelled awaiter leaves the thread to finish). A failing enqueue logs the class and the SQLSTATE only. The RPC's `insufficient_privilege` message carries the user id, but `_safe_message` is not called here, so that message is never logged. | read; M3 below |
| (2d) An id in a user-facing place? | **No.** The new code writes only a `compute_jobs` row and one log line, which carries the api_key id the module's other lines already carry. | read |
| (2e) A compose → re-stamp → re-enqueue loop? | **No.** The stamper runs only in `poll_allocator_positions` (`job_worker.py:12926`, `:13284`). `run_derive_allocator_equity_job` writes no marker and enqueues no poll (no `rpc(`/enqueue call in `:14551-15908`). After the first write the marker is unchanged, so each later poll returns early. | grep + read |
| (3) Can the new tests fail? | **Yes, for the arguments, the owner, the unchanged path, the kind and the swallow.** Five mutations went RED in a throwaway worktree (the fixer's run covered one). Two mutations survive (WR-R2-02, IN-R2-01). | table below |
| (4) Is the residual acceptable as recorded? | **Yes, as a bounded known limit, but it is recorded only in this file (WR-R2-01).** `_enqueue_compute_job_internal` treats `running` as in flight (`baseline.sql`, the allocator branch of the optimistic look-up). A compose that read `api_keys` before the marker committed absorbs the enqueue and can store the double count. The window is the few seconds between that compose's key read and the marker. The next per-key derive epilogue recomposes it, at the latest after the nightly fan-out, so it is open for at most about a day. A compose that has backed off into `failed_retry` is outside the dedup, so the enqueue becomes its own pending twin. | read |

**Mutation probes** (scratch worktree at `8c818eff0`, the reviewed tree untouched, file restored and `cmp`-checked after each one, the worktree removed afterwards). The baseline was 130 passed.

| # | Mutation | Result |
|---|---|---|
| M1 | enqueue block deleted | 3 failed (`new_marker[False]`, `[True]`, `failed_recompose_enqueue`) |
| M2 | `p_allocator_id` = holder id | 2 failed (`new_marker[False]`, `[True]`) |
| M3 | `except Exception` narrowed so the enqueue error propagates | 1 failed (`failed_recompose_enqueue`) |
| M4 | enqueue moved before the unchanged-marker early return | 4 failed (`unchanged_marker` among them) |
| M5 | enqueue only for `kind == duplicate` | 1 failed (`new_marker[True]`) |
| M6 | audit moved inside the `try`, after the RPC (a failing enqueue drops the audit) | **0 failed, survives** (WR-R2-02) |
| M7 | enqueue moved before the zero-row check (a no-row UPDATE enqueues) | **0 failed, survives** (IN-R2-01) |

**Regression run:** from `analytics-service/` with `.venv/bin/python -m pytest tests/test_account_identity_stamper.py tests/test_derive_allocator_equity_job.py tests/test_derive_refusal_rows.py -q`: **287 passed**, 0 failed, 0 skipped.

### WR-R2-01 (LOW, records): the residual is written only in REVIEW.md

**File:** this file, `## Fix round 1` "Residual"; the comment at `analytics-service/services/account_identity.py:413-417`
**Issue.** A `running` compose that read the key list before the marker committed absorbs the enqueue and can store the double count. The reader then draws that curve as `ready` until the next compose. That is a data-integrity, user-facing window. It is rare and bounded at about a day, which makes it acceptable. But this file is its only record. The code comment says "the nightly fan-out recomposes anyway", which a reader will take for "no window remains". The ROADMAP, TODOS.md and the ship's CHANGELOG entry all lack it, and CHANGELOG discipline asks for known limits to be carried.
**Fix.** In the ship commit, add one known-limit line to the CHANGELOG entry. It should name the in-flight dedup (`running` is in its predicate), the absorbed enqueue and the bound (the next per-key derive, about a day at most). Optionally, add the words "a compose already running absorbs this enqueue" to the code comment. No code change.

### WR-R2-02 (LOW, test pin): no test pins that a failing enqueue keeps the audit

**File:** `analytics-service/tests/test_account_identity_stamper.py`, `test_a_failed_recompose_enqueue_does_not_undo_the_marker`
**Issue.** Today's code keeps the audit, because the audit runs before the `try` (read and confirmed). The test asserts the outcome, the marker UPDATE and the warning, but not the audit. M6 moves `_audit_duplicate` inside the `try` after the RPC, so a failing enqueue drops the `api_key.account_duplicate_detected` row for good, because the next poll meets an unchanged marker and skips the audit. M6 passes all 130 tests. That is the exact SF-M2 / IN-04 failure `_write_marker_and_audit` exists to prevent, and the brief asks for it to be covered.
**Fix.** One line in that test: `audit_mock.assert_called_once()`. A stricter form asserts the kwargs `action=DUPLICATE_DETECTED_AUDIT_ACTION, entity_id=KEY_ID`.

### IN-R2-01 (INFO): a zero-row UPDATE that enqueued would not be caught

**File:** `analytics-service/tests/test_account_identity_stamper.py`
M7 passes. Its only effect would be one extra compose, which the dedup makes safe, so it is not a defect. If a pin is wanted, the existing `_MarkerNotWritten` test could assert `sb.rpc_calls == []`. Not to be fixed under the founder's LOW/INFO rule.

### IN-R2-02 (INFO): a dropped enqueue is a WARNING, so Sentry never sees it

**File:** `analytics-service/services/account_identity.py:426-431`
This matches the epilogue's level, and the next derive heals it within the same bound as WR-R2-01. Recorded so the choice is visible. No fix.

---

_Reviewed (round 2): 2026-11-01T11:46:32Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_


## Fix round 2

**Scope:** the two round-2 MEDIUMs from the silent-failure hunt (founder rule: minimal fix, no new abstractions or defensive checks). WR-R2-01 (CHANGELOG known-limit line, ship-time), IN-R2-01, IN-R2-02 and WR-02 were not touched.

**Commits:**
- `d02c83c54` fix(183), MEDIUM 1: `analytics-service/services/account_identity.py`, `_write_marker_and_audit`. A failed recompose enqueue is logged with `logger.error` (class and code only, no message), so it reaches Sentry. The comment no longer calls the nightly fan-out a safety net: it is the window. `analytics-service/tests/test_account_identity_stamper.py`: `test_a_failed_recompose_enqueue_does_not_undo_the_marker` asserts the ERROR level and `audit_mock.assert_called_once()` (WR-R2-02).
- `38a2b55b7` fix(183), MEDIUM 2 (D-05): `analytics-service/services/job_worker.py`, `run_derive_allocator_equity_job`. The share markers `(id, holder, kind)` of the loaded keys are kept; just before the curve upsert (step 5a) the keys are re-read with the same `_load_keys`. If any marker differs, the job runs itself once more through a keyword-only `_markers_rechecked=True` (the retry does not check again, so it always ends) and saves the curve built from the new markers. The first pass saves no curve. `analytics-service/tests/test_derive_allocator_equity_job.py`: `test_a_marker_that_lands_mid_compose_is_recomposed_before_the_curve_is_saved`.
- `ac7a632f5` docs(183): D-05 in `183-CONTEXT.md` and a matching line in the Phase 183 ROADMAP entry.

**Why a redo inside the job and not an enqueue (the trap):** `_enqueue_compute_job_internal` dedups on pending/running/done_pending_children for (allocator_id, kind), so an enqueue from the running compose is absorbed by its own job. A retry outcome would cost a backoff and an attempt. The in-job redo provably ends with a curve composed from the new markers.

**RED evidence:** with the check neutered (`if False and markers_now != markers_at_load`; byte backup taken first, restored by `cp` and `cmp`-checked, `if False and` count 0 after), the new test failed with `the account must be ONE counted key / assert 2 == 1`. Restored: passed. For MEDIUM 1, with `logger.error` swapped back to `logger.warning` (byte backup, restored, `cmp` clean) `test_a_failed_recompose_enqueue_does_not_undo_the_marker` failed (1 failed, 129 passed); restored: 130 passed.

**Gates (from `analytics-service/`):** `pytest -n auto -q`: 14082 passed, 102 skipped. CI's mypy line verbatim: Success, no issues found in 131 source files. No TS touched.

**Residuals, stated plainly:**
- A marker that commits after the re-read and before the upsert (the upsert's own round trip) still stores the double count. The stamper's enqueue is absorbed by the still-running job, so that case waits for the next derive. The window shrank from the whole compose to the upsert.
  - **CORRECTED 2026-11-01 (round 3, WR-R3-01): the sentence above is false whenever a redo runs, and is kept as lineage.** The redo skipped the re-read, so a marker landing while the redo composed was saved double-counted; the window was the whole redo compose, not the upsert. Fix round 3 closes that part. What stays open is only the first bullet's original residual: a marker that commits after the final re-read and before the upsert's round trip.
- The redo repeats the compose's pre-save side effects once: the idempotent orphan `key_inputs` deletes and, when it applies, the `departed_history_unavailable` Sentry warning event (a second event for the same job).
- The re-read also fires on a key added or removed during the compose (the compared set is `(id, holder, kind)` for every key of the owner). That costs one extra compose, bounded to one.


## Round 3

**Reviewed:** 2026-11-01T12:00:23Z, at `e1119a35b` (code commits `d02c83c54`, `38a2b55b7`)
**Scope:** `git diff 8c818eff0..HEAD -- . ':!.planning'`: `analytics-service/services/account_identity.py`, `analytics-service/services/job_worker.py`, `analytics-service/tests/test_account_identity_stamper.py`, `analytics-service/tests/test_derive_allocator_equity_job.py`
**Depth:** deep. I read all of `run_derive_allocator_equity_job` (`job_worker.py:14551-15920`) for every write and return, then the dispatch wrapper (`:16166-16208`), the handler timeout (`TIMEOUT_PER_KIND`, `:976`), the 20-minute watchdog override (`main_worker.py:366-387`), and the stamper's two writers (`account_identity.py:385-531`).
**Status:** issues_found. Two WARNINGs: one data-integrity residual that the fix round recorded wrongly, and one test pin. Three INFO items.

### Answers to the brief

| Question | Verdict | Evidence |
|---|---|---|
| (1) Does the redo close the mid-compose window? | **Mostly, but only for the first marker change.** A marker that lands between the first `_load_keys` (`:14654`) and the re-read (`:15884-15887`) is caught, and the redo saves a curve built from the new markers. Two windows remain. (a) A marker that commits between the re-read and the upsert (`:15909`) is stored stale, as fix round 2 recorded. (b) **A marker that lands while the redo itself is composing is also stored stale.** The redo runs with `_markers_rechecked=True` and never re-reads, and the job is still `running`, so that marker's own recompose enqueue is absorbed. Fix round 2 said the window "shrank from the whole compose to the upsert". That holds only when no redo runs. When one does, the window is the whole redo compose (WR-R3-01, probe measured). | read + probe |
| (2) Does a path before 5a write something from the stale markers that the redo does not overwrite? | **No path writes a wrong number. Some refusal records are written from stale markers and are not redone (IN-R3-02).** Every `_persist_refusal` call returns at once: `:14756`, `:14933`, `:14998`, `:15669`, `:15756`, `:15861`/`:15863`. So the redo never runs on a refusal path, and a refusal that came from stale markers stands. The one realistic case is `COMPOSE_INCOMPLETE`. A new key B with no returns yet is counted under the stale markers, while under the new markers B is excluded. That refusal fails closed (the panel shows rebuilding, not a number), and B's own derive epilogue clears it. Only two things written before 5a fall through to the redo: the orphan `key_inputs` deletes (`:15645-15651`, idempotent, and the redo finds none left) and the `departed_history_unavailable` Sentry event (`:15803-15819`, sent twice, as fix round 2 recorded). The first pass writes no `key_inputs` and no `compute_jobs` row. Its degrade tokens live only in the discarded payload, and the collision Sentry event sits on a path that returns. | awk over every `upsert`/`delete`/`rpc`/`capture_message`/`return` in `:14551-15921` |
| (3) Watchdog, timeout, DispatchResult, retries, dedup? | **No defect. Two things are worth knowing.** The redo runs inside the same `asyncio.wait_for(handler(job), timeout=300)` (`:16208`), so one job's handler time roughly doubles (IN-R3-03). A timeout during the redo ends transient with nothing saved, and the previous curve stands. The redo's `DispatchResult` is returned unchanged, and dispatch has no post-processing for this kind. The redo reads the same `job["attempts"]`, so the `lagging_inputs` verdict (`:15293-15312`) uses the same budget. A redo can end transient where the first pass would have saved, and that is correct because its inputs are fresher. The private keyword cannot be reached from dispatch, which calls `handler(job)`. The job stays `running` for the whole redo, so the in-flight dedup absorbs every stamper enqueue in that time. That is the mechanism behind WR-R3-01. The 20-minute watchdog measures claim-to-done for a whole batch (`main_worker.py:372-386`). The redo adds one compose to that, which falls inside the `[166.5.1-DERIVE-BATCH-RESET-RESIDUAL]` already booked. | read |
| (4) Can it loop or double-write? | **No.** Recursion is bounded by the flag (M3 below goes RED). One curve upsert per job: the first pass reaches 5a only after it has written nothing but the idempotent orphan deletes, and it returns the redo's result instead of continuing (M4 RED, through `_composed_payload`'s exactly-one-upsert assert). | read + M3/M4 |
| (5) Can the new tests fail? | **Yes, for the redo existing, its bound and its single save. No, for where the re-read sits (WR-R3-02) or for a holder-only change (IN-R3-01).** The stamper test's `[r.levelname for r in failed] == ["ERROR"]` fails under WARNING whatever caplog's level is, and the `audit_mock.assert_called_once()` added there closes WR-R2-02. | table below |

**Mutation probes.** Each ran in a throwaway worktree at `e1119a35b`. Before each mutation the file was byte-backed-up. Afterwards it was restored by copy and `filecmp`-checked (`restored True`), and the worktree was removed. Test file: `tests/test_derive_allocator_equity_job.py`, baseline 147 passed.

| # | Mutation (`job_worker.py`) | Result |
|---|---|---|
| M1 | the 5a re-read block moved to directly after `markers_at_load` (before the returns read and the compose, where it closes nothing) | **147 passed, survives** (WR-R3-02) |
| M2 | `account_shared_with_api_key_id` dropped from the compared tuple at both sites | **147 passed, survives** (IN-R3-01) |
| M3 | the redo passes `_markers_rechecked=False` | 1 failed (`api_key_reads == 3`) |
| M4 | the redo's result is ignored and the stale payload is saved too | 1 failed (`_composed_payload`: two upserts) |
| M5 | the change is detected and logged, with no redo | 1 failed (`n_keys == 1`) |

**Probe for WR-R3-01** (a scratch test, not committed). It uses the repo's own `_FakeSupabase` and `_run_gate` with four keys. H is stamped on binance and B is unstamped on binance. G is stamped on okx and C is unstamped on okx. Anchors: H and B 1,000 each, G and C 500 each. The `on_read` hook marks B as a duplicate of H after api_keys read 1, which is the first pass's load. It marks C as a duplicate of G after read 3, which is the redo's load:

```
outcome DONE reads 3
n_keys 3 terminal 2000.0 trust True degrade []
```

The correct book is two accounts, 1,500. The stored curve counts C's account twice, at 2,000. It is trustworthy with no degrade, so the reader draws it as `ready` until the next derive (up to about a day). `identity_pending_venues` cannot hold it: after B is marked, each venue has only one unknown key.

**Regression run:** from `analytics-service/` with `.venv/bin/python -m pytest tests/test_derive_allocator_equity_job.py tests/test_account_identity_stamper.py -q`: **277 passed**, 0 failed, 0 skipped.

### WR-R3-01 (WARNING, MEDIUM, data integrity, user-facing): a second marker that lands during the redo is saved double-counted, and the fix round recorded this window wrongly

**File:** `analytics-service/services/job_worker.py:15883-15894`; `183-REVIEW.md` `## Fix round 2` "Residuals", first bullet
**Issue.** The redo exists because the running job absorbs the stamper's enqueue. That reason still applies while the redo runs, because the job is still `running`. The redo does not re-read, so a marker written during the redo compose is never seen by this job and is absorbed by the dedup. The probe above stores a trustworthy curve at 2,000 for a 1,500 book. This needs two second-login keys marked within one compose, for example when the owner connects several logins of accounts already stamped, which the founder's "one account under several logins is intended" rule makes a normal action. Each key's poll stamps on its own schedule, seconds apart in one batch. The case is rare, but the result is the exact double count D-05 exists to remove. The fix round's statement that "the window shrank from the whole compose to the upsert" is false whenever a redo runs. As written, the ship's CHANGELOG known-limit line (WR-R2-01) would understate it.
**Fix (minimal, keeps "always ends").** Let the redo re-read too. On a second change, end transient instead of saving. The job then leaves `running`, so the stamper's enqueue becomes its own pending twin (`failed_retry` is outside the dedup predicate, as the `lagging_inputs` comment at `:15279-15281` already relies on), and the queue's backoff re-reads:

```python
    markers_now = {
        (r["id"], r.get("account_shared_with_api_key_id"), r.get("account_share_kind"))
        for r in await db_execute(_load_keys)
    }
    if markers_now != markers_at_load:
        if _markers_rechecked:
            logger.warning(
                "derive_allocator_equity: share markers changed again while recomposing "
                "for allocator %s — ending transient so the retry re-reads",
                allocator_id,
            )
            return DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=(
                    "derive_allocator_equity: share markers changed again during the "
                    "recompose; retrying so the curve is built from the current markers"
                ),
                error_kind="transient",
            )
        logger.info(...)  # unchanged
        return await run_derive_allocator_equity_job(job, _markers_rechecked=True)
```

Add the probe above as a test, asserting no curve upsert and a transient outcome. If the founder prefers no code change, correct the fix-round-2 residual and the WR-R2-01 CHANGELOG line instead. Both should name "a marker landing during the redo compose" as part of the window, bounded by the next derive.

### WR-R3-02 (WARNING, test pin): the D-05 test cannot tell where the re-read sits

**File:** `analytics-service/tests/test_derive_allocator_equity_job.py:1677-1718`
**Issue.** The hook writes B's marker right after the first `api_keys` read. Any re-read placed after that point sees the change, including one placed immediately after the load, before the returns read, the stitch and the compose. That placement closes nothing in production. M1 moves the check there, and all 147 tests pass. D-05's point is that the re-read happens "just before the compose saves its curve" (CONTEXT D-05), and no test pins that.
**Fix.** Fire the marker write from a read the compose makes after its key load. The `csv_daily_returns` read is the last one before the compose (`:14736`). Or patch `services.allocator_equity_compose.compose_allocator_equity` with a wrapper that writes B's marker and then delegates. Keep `len(api_key_reads) == 3` and fire the hook once only. With either change, M1 goes RED.

### IN-R3-01 (INFO): a holder-only marker change is not pinned

**File:** `analytics-service/tests/test_derive_allocator_equity_job.py:1677`
M2 (comparing `(id, kind)` only) passes. A re-point from one holder to another keeps the kind and changes the group, so the redo should fire. Today's code compares the holder, so this is a missing pin, not a defect. No fix under the LOW/INFO rule.

### IN-R3-02 (INFO): refusals written from stale markers are not redone

**File:** `analytics-service/services/job_worker.py:15667-15679` (and the other `_persist_refusal` returns before 5a)
A marker landing mid-compose can leave a `COMPOSE_INCOMPLETE` refusal (B counted, with no inputs yet) where the new markers would compose. It fails closed, B's own derive epilogue recomposes it, and before Phase 183 the reader would have shown `duplicate_account` for that book anyway. Recorded so that "the redo covers the mid-compose window" is read as covering the saved curve only. The duplicated `departed_history_unavailable` Sentry event and WARNING lines on a redo were already recorded in fix round 2.

### IN-R3-03 (INFO): the redo spends the same 5-minute handler budget

**File:** `analytics-service/services/job_worker.py:976`, `:16208`
A redo job composes twice inside one `asyncio.wait_for`. No single-compose duration is measured. The 166.5.1 figures are claim-to-done over whole batches. A timeout here ends transient with nothing saved, so it fails safe and the retry composes from the new markers. Recorded so a future `QUANTALYZE-2A`/`A` recurrence on a book with marker churn has an explanation ready.

### Other checks (no finding)

- `d02c83c54` ERROR level: consistent with the module's other ERROR lines, which already send the api_key id to Sentry (`account_identity.py:377`, `:700`, `:811`, `:834`). The message carries class and SQLSTATE only, never `_safe_message`, so the RPC's user id is not logged.
- The comment at `account_identity.py:416-419` now states the window honestly ("the window, not a safety net"). That closes the code-comment half of WR-R2-01. The CHANGELOG half is still owed at ship.
- `_load_keys` is a closure over the same `allocator_id`, so the re-read compares exactly the owner's key set the compose read. Added or deleted keys also trigger the redo, as fix round 2 recorded.

---

_Reviewed (round 3): 2026-11-01T12:00:23Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Fix round 3

**Scope:** WR-R3-01 (MEDIUM, data integrity, user-facing) and WR-R3-02 (test pin). Founder rule: minimal fix, no new abstractions or defensive checks. WR-02, IN-R3-01, IN-R3-02 and IN-R3-03 were not touched, nor were the refusal paths.

**Commit:** `a0f166c54` fix(183): `analytics-service/services/job_worker.py`, step 5a of `run_derive_allocator_equity_job`. The re-read now runs in the redo too. If the markers changed again, the redo returns the handler's existing transient outcome (`DispatchResult(FAILED, error_kind="transient")`, the same shape as the `lagging_inputs` path) and saves no curve; a WARNING with the allocator id is logged. The queue's retry is a fresh job, so it re-reads, and a stamper enqueue arriving after the job left `running` is its own pending twin. No new type. `analytics-service/tests/test_derive_allocator_equity_job.py`: the D-05 test now fires the marker from the first `csv_daily_returns` read (the last read the compose makes after its key load) and expects four `api_keys` reads (load, re-read, redo load, redo re-read). New `test_a_marker_that_lands_during_the_redo_ends_transient_without_a_curve` (four keys, B marked in the first pass, C marked during the redo) asserts a transient FAILED and no curve upsert.

**RED evidence** (byte backups of both files taken first, restored by `cp` and `cmp`-checked after each mutation):
- M1 (the 5a re-read block moved to directly after `markers_at_load`, before the returns read and the compose): 2 failed (`test_a_marker_that_lands_mid_compose_...` and the new redo test), 146 passed. Before the test change this mutation survived (WR-R3-02). Restored: 148 passed.
- Redo re-read neutered (`and not _markers_rechecked` added to the change condition, i.e. the round 2 behaviour): 1 failed (the new redo test, `'DONE' == 'FAILED'`), 147 passed. Restored: 148 passed.

**Gates (from `analytics-service/`):** `pytest -n auto -q`: 14083 passed, 102 skipped. CI's mypy line verbatim: Success, no issues found in 131 source files. No TS touched. Verification ran in the `quantalyze-183` checkout (main working tree of that worktree).

**Residual, stated plainly:** a marker that commits after the last re-read and before the upsert's own round trip still stores the double count until the next derive. The redo is bounded to one, and a second change ends transient, so the retry's own pass can also end transient again if markers keep changing; the attempt budget then ends it as any transient failure does.
