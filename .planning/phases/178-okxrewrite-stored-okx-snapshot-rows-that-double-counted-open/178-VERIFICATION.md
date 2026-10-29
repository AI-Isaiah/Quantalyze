---
status: passed
verified_at_sha: 10387c1ae49923f57c6e11b084f99bd3f274f6d6
drift_subjects:
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/scripts/allocator_history_probe.py
  - analytics-service/tests/test_reconstruct_whole_account.py
  - analytics-service/tests/test_allocator_history_probe.py
  - analytics-service/tests/test_reconstruct_force_rebuild.py
  - docs/runbooks/marksource-okx-history-correction.md
  - docs/runbooks/marksource-okx-census/okx-nonworking-keys.sql
  - docs/runbooks/marksource-okx-census/README.md
  - src/__tests__/marksource-okx-census-sql.test.ts
  - src/__tests__/marksource-okx-nonworking-keys-exec.test.ts
---

# Phase 178 OKXREWRITE: Verification Report (autonomous half)

**Phase goal (ROADMAP):** The stored OKX snapshot rows that counted open profit twice are rebuilt inside the 90-day window, once Phase 173 has measured OKX trade ordering at 0 violations, so past OKX equity reads the same as the MARKSOURCE forward fix.
**Scope of this report:** plans 178-01, 178-02 and 178-05 (the autonomous code and runbook half), after three review and fix rounds. Plans 178-03 and 178-04 are orchestrator operator plans (`autonomous: false`) and have NOT run.
**Verified at:** HEAD of branch `feat/178-okxrewrite` (full sha in the frontmatter), working tree clean for tracked files.
**Re-verification:** No, initial verification.
**Overall:** the code and runbook half passes with no gaps. The phase goal itself (stored OKX rows rebuilt in PROD) is not yet achieved by construction: it needs plans 03 and 04. Status is therefore `human_needed` (pending operator plans), not `gaps_found`.

## Gates run by the verifier (exact counts)

| Gate | Command (interpreter: the sibling checkout's analytics venv) | Result |
|---|---|---|
| pytest | from `analytics-service/`: `-m pytest tests/test_reconstruct_whole_account.py tests/test_allocator_history_probe.py tests/test_reconstruct_force_rebuild.py -q` | **280 passed** in 53.34 s, 0 failed |
| mypy (CI line, verbatim) | `-m mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | **Success: no issues found in 130 source files** |
| vitest | from the worktree root: `npx vitest run src/__tests__/marksource-okx-census-sql.test.ts src/__tests__/marksource-okx-nonworking-keys-exec.test.ts` | **2 files passed, 177 tests passed**, 0 failed |
| planning hygiene | `npm run -s check:planning-hygiene` | **exit 0** (rules 1, 6, 7 OK) |

The full analytics suite was not re-run by the verifier (the round-3 fixer recorded 13782 passed, 102 skipped; not independently reproduced here).

## RED spot-checks done by the verifier (byte backup with `cp -p`, restore, `cmp`; no git checkout, restore or stash)

1. **D-05 skip neutered.** In `_select_account_crawl_keys`, the `non_working_excluded += 1; continue` pair was replaced by a raise of `account_key_not_working` (the old whole-account refusal). The seven D-05 selectors from the plan (`dead_exchange_account_is_skipped`, `revoked_bybit_key_leaves`, `skips_and_counts`, `dead_key_never_decides`, `no_working_exchange_account`, `dead_keys_of_one_exchange_account`, `does_not_preempt_identity`) gave **14 failed, 9 passed** (23 selected). Failures include the three job-level params (`outcome FAILED, 'forced rebuild refused (account_key_not_work...)'` against the expected DONE), the five inverted selection params, the dead-sfox, dead-unknown-venue and dead-cross-venue params, the per-account-count test, the identity-ordering test and the probe test. The 9 that stay green are the all-dead refusal pins, which hold under both versions by design. Restored: `cmp` exit 0 and `git diff --quiet` exit 0.
2. **Round-3 key-digest check neutered** (the one tuple line comparing `expected_key_digest` removed from the pre-crawl `any(...)`). The digest selectors gave **6 failed, 4 passed**: the working-sibling-absent case, the dead/working-swap case with equal counts, and the four non-string digest params (int, null, bool, list). Restored: `cmp` exit 0, `git diff --quiet` exit 0. This matters because round 3's fix was not re-reviewed by a fourth review round.

## Decision checks (goal-backward)

### D-05: a dead key affects only its own exchange account (VERIFIED in code)

- `_select_account_crawl_keys` (read in full) decides each group in the planned order: deciding venues from the working members (every member's only when none works); all-Deribit group counted as $0; group with no working member skipped and COUNTED on any venue (third return value); working members on two venues, then a working venue outside `_ACCOUNT_REBUILD_VENUES`, each its own literal `account_key_venue_unsupported` raise; otherwise the job's own key or the smallest working id.
- Every-venue dead skip: tests cover a dead sfox account, a dead unknown-venue account, a dead cross-venue marker group, a dead member on another venue than its group's working key (read through the working key, count 0), and a dead member beside a working Deribit. A WORKING sfox, kraken or cross-venue marker group still refuses (the unchanged `test_select_refuses_an_exchange_account_no_rebuild_can_read`, 3 params, green).
- All-dead still refuses: after the loop, `if not selected and non_working_excluded > 0: raise ForcedRebuildRefusedError("account_key_not_working")`, placed before the identity check. Seven-param pin (five dead states, revoked beside Deribit, revoked sfox-only) is green; the last one fails on the old behaviour.
- Literal raise statements: `git grep` shows 1 for `account_key_not_working` and 2 for `account_key_venue_unsupported`, as at the plan's base. The 16-token closed set test is green and unchanged.
- The count reaches both surfaces under one spelling each: audit key `account_non_working_accounts_excluded` (`equity_reconstruction.py`, ACCTREBUILD counts-only block, set from `_AccountCrawl.non_working_accounts_excluded`) and probe record key `non_working_accounts_excluded` (declared in `ACCOUNT_RECORD_KEYS`, validated by `_is_count`, defaulted to 0, set in `_probe_account`). The only two production callers of the selection (`_crawl_whole_account`, `_probe_account`) unpack three values.
- A dead key is never decrypted and no session is opened: asserted by the preflight call log and `_assert_no_venue_call` in the job test and by `decrypt_calls == [okx key]` in the probe test.
- A dead OKX group does not force the 90-day window: `_account_rebuild_window` is untouched and sees only the crawled keys (job test reads `window_days` 730 for the dead-OKX param).

### D-06: P7 decides rebuild or not recomputed; enqueue and worker guards (VERIFIED as code and runbook; the PROD reading is pending)

- `okx-nonworking-keys.sql` is one read-only statement. It reproduces `account_groups` (transitive marker reach via a recursive `UNION`), the deciding-venue rule, and the state precedence `zero`, `dead`, `refused`, `crawled`, predicts the window as `_account_rebuild_window` does (90 with a crawled OKX account, else 730), tests every dead key that no working key of its own account on its own venue covers against the stored non-bulk in-window days (holdings span minus 1 day to plus 7 days, plus the uncapped-carry era 2026-09-29 to 2026-10-19), counts bulk-written in-window days, counts hard-deleted keys still named by the holdings polls' audit rows, prints a key-set digest, and emits `p7_outcome` (`rebuild` or `not recomputed (D-06)`).
- The runbook makes P7 a blocking pre-flight, quotes the founder ruling, leaves a `not recomputed (D-06)` label and any label with `predicted_window_days` not 90 out of `MS_LABELS`, and adds the owner's confirmation as the backstop for a dropped audit write.
- Worker guard (beyond the original plan, added by review rounds 1 to 3): `_crawl_whole_account` compares three exact-typed expectations from the job metadata (`expected_non_working_accounts`, `expected_window_days`, `expected_key_digest`) with its own selection, window and key-set digest BEFORE any venue call, and refuses `account_keys_changed` (an existing token, so the 16-token set is unchanged). The persist-time re-read also compares the working key id set with the crawl's. Absent keys mean no expectation. The verifier's neuter 2 shows the digest check bites.
- Enqueue guard: the `enqueue` form recomputes P7's grouping (byte-pinned to the census file), targets a label only when its live dead-account count, window and key digest equal the values the renderer took from the B'3a P7 re-run file, and writes the RENDERED values as the job's expectations. B'3a re-runs P7, compares every input (including the digest) with the pre-flight file and STOPs on any difference; the renderer refuses a re-run file older than `MS_T0`.
- Residual (named in the runbook, not a gap in this half): the worker binds the key set and each key's working flag, not P7's other inputs (overlapping stored days, bulk days, audit trace); B'3a reads those and nothing re-reads them after the enqueue. The D-06 decision itself is a runbook-level control applied by the operator (Claude's Discretion C1 in CONTEXT), not an in-code refusal.

### Runbook changes (VERIFIED)

- P7 bullet present once; heading reads P0 to P7; census-file table and README name `okx-nonworking-keys.sql`.
- `crosswalk` form present, sharing the key-group CTE block byte for byte with P7 (vitest byte-equality pin); fingerprint ties counted (`fingerprint_ties`); a tie is a recorded outcome, never a write.
- B'1 states the group rule (dead account skipped and counted; `account_key_not_working` only when nothing is left to crawl; venue refusal predicted from P7's `refused_exchange_accounts`); the two stale bullets are absent (pinned).
- P1 has the third `git grep` for the audit key. P4 carries the D-02 per-target ordering reading (`selection` ok, trades at least 1, readings equal, 0 violations, 0 full-page stops, failure class none) and the zero-trades rule.
- `audit` form selects `account_non_working_accounts_excluded`; B'5 rule 5 compares it with P7's `dead_exchange_accounts` and `window_days` with P7's `predicted_window_days`; rule 6 STOPs on NULL.
- Rule 3 states 16 tokens, `account_key_read_stalled` in the re-enqueue-once list, with a vitest parity test that parses both frozensets from the Python module (green, 177-test run).
- "What this cannot reach" names the three kept classes (refresh rows older than the window, every `allocator_holdings` history row, scenario-commit audit sizes) and the D-06 and deleted-key cases; "Where this stands" has the 2026-10-28 paragraph above the lineage-marked 2026-10-27 one.
- The runbook carries no uuid, home path or planning-directory path (vitest guard green; hygiene exit 0).

## Observable truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Plan 01: a forced whole-account rebuild skips and counts an exchange account with no working key, on any venue | VERIFIED | Code read; job-level 3-param test; neuter 1 turns 14 tests red |
| 2 | Plan 01: a dead key's venue never decides its account; working unreadable venue still refuses | VERIFIED | Decision order in code; 5-param venue test; unchanged 3-param working-venue refusal test green |
| 3 | Plan 01: all-dead allocator still refuses `account_key_not_working` (own literal raise; closed set unchanged) | VERIFIED | 7-param pin green; raise counts 1 and 2; closed-set test green |
| 4 | Plan 01: count travels as `_select...` third value, audit key, probe key, one spelling each | VERIFIED | grep of all touch points; probe vocabulary parity test green |
| 5 | Plan 01: dead key never decrypted, forced job DONE with in-window rows equal to the working accounts alone, older row untouched | VERIFIED | Job test asserts call log, no venue call, row values, older-row deep copy |
| 6 | Plan 01: dead OKX group does not force the 90-day window | VERIFIED | Job test `window_days` 730 for the dead-OKX param |
| 7 | Plan 01: new tests shown RED on old behaviour twice | VERIFIED | Summary quotes RED proof; verifier reproduced neuter 1 (14 red) |
| 8 | Plan 01 prohibition: no change to the named helpers, no conditional inside a raise, no runbook, migration or PROD action | VERIFIED | Diff outside `.planning` is 9 files, none a migration; selection raises are plain statements |
| 9 | Plan 02: P7 blocking pre-flight, SQL mirrors `account_groups` and the selection order, window and overlap rules | VERIFIED | SQL read; exec test (committed, runs in the ordinary vitest shards on a throwaway local cluster) green, 177 tests |
| 10 | Plan 02: SQL executed before PROD | VERIFIED | Superseded and strengthened by the committed exec test against hand-computed oracles (review WR-02), instead of a deleted scratch gate |
| 11 | Plan 02: runbook refusal vocabulary equals the code's 16 tokens, parity pinned | VERIFIED | Vitest parity describe green |
| 12 | Plan 05: `crosswalk` form maps probe labels to census labels with a fingerprint, over the byte-identical key-group block | VERIFIED | Byte-equality pin and exec-test crosswalk oracles green |
| 13 | Plan 05: B'1 group rule; stale bullets gone; P1 third check; D-02 in P4; audit column; B'5 rules 5 and 6 | VERIFIED | Runbook read; vitest pins green |
| 14 | Review additions: worker refuses on moved dead count, window or key digest before any venue call; enqueue carries rendered expectations | VERIFIED | Code read; neuter 2 turns 6 tests red |
| 15 | ROADMAP SC-1: Phase 173 reading cited by run before any rewrite | PENDING (operator plan 04) | Runbook P4 and plan 04 carry the gate; no run has cited it yet |
| 16 | ROADMAP SC-2: 90-day window rebuilt through the forced path with before and after census | PENDING (operator plans 03, 04) | Not run; forms and B'5, B'6 checks are ready and tested |
| 17 | ROADMAP SC-3: rows older than the window and `allocator_holdings` history named as kept with counts | PARTIAL, pending (operator plan 04) | Runbook "What this cannot reach" names them and the census files count them; the counts are not recorded until the PROD census runs |
| 18 | Phase goal: stored OKX rows rebuilt in PROD | PENDING (operator plans 03, 04) | Expected at this stage; no write has been made |

Score: 14/14 code and runbook truths verified; 4 roadmap-contract truths pending operator plans (not failures). `behavior_unverified` for the code half: 0.

## Required artifacts and wiring

| Artifact | Status | Details |
|---|---|---|
| `analytics-service/services/equity_reconstruction.py` | VERIFIED | Selection, `_AccountCrawl.non_working_accounts_excluded`, audit key, three expectation constants and the pre-crawl check, persist-time working-set re-read; wired from the job handler |
| `analytics-service/scripts/allocator_history_probe.py` | VERIFIED | Record key declared, validated, defaulted, set; `summarize` comment rewritten; `DEPLOYED_ER_NAMES` unchanged |
| `docs/runbooks/marksource-okx-census/okx-nonworking-keys.sql` | VERIFIED | One read-only statement; columns used checked by review against the baseline; executed by the exec test |
| `docs/runbooks/marksource-okx-history-correction.md` | VERIFIED | See runbook checks above |
| `docs/runbooks/marksource-okx-census/README.md` | VERIFIED | Row names the new file |
| `src/__tests__/marksource-okx-census-sql.test.ts` | VERIFIED | Guard, pins, parity tests green |
| `src/__tests__/marksource-okx-nonworking-keys-exec.test.ts` | VERIFIED | New (not in the original plan); runs P7, crosswalk and enqueue SQL on a socket-only throwaway cluster; no skip gate |
| Tests in the two analytics files | VERIFIED | Substantive, shown to fail on the old behaviour |

Data-flow (level 4): the dead count flows selection to `_AccountCrawl` to the completion audit metadata to the runbook `audit` form to B'5 rule 5; the expectation values flow runbook renderer to `enqueue` metadata to the worker check. Each hop is covered by a test or a literal-parity pin.

## Probes

No probe scripts are declared or exist for this phase (the deployed probe is operator plan 03). Not applicable for this half.

## Requirements coverage

Plan requirement ids D-05, D-06, D-02, SC-2 map to the checks above. The roadmap lists `Requirements: TBD`, so there is no REQUIREMENTS.md mapping to orphan.

## Anti-patterns

The debt-marker scan (TBD, FIXME, XXX) over the added lines of the diff outside the planning directory found 0 markers; a TODO, HACK or PLACEHOLDER scan found 0. No stub or empty implementation was found in the changed code.

## Findings

No BLOCKER. Warnings and notes for the caller:

- WARNING (bookkeeping, orchestrator): `ROADMAP.md` still shows 178-01, 178-02 and 178-05 as `[ ]` and `178-VALIDATION.md` is still `status: draft`, `nyquist_compliant: false`, with every row pending. Neither affects the code verdict.
- WARNING (process): the round-3 fix commits (digest in Python, SQL, runbook, plans) were not followed by a fourth review round. The verifier read the Python half and reproduced a RED neuter for it, and the full vitest file including the digest oracles is green, but the SQL and renderer half of round 3 rests on the committed exec test and the fixer's own RED proof.
- NOTE: the D-06 overlap decision is enforced by the operator procedure and the B'3a re-run comparison, not by an in-code refusal (Claude's Discretion C1). The worker binds only the key set, working flags, dead count and window.
- NOTE: the exec test runs P7 against stand-in tables, not the real PROD schema; the first run on the real schema is plan 03's read-only measurement.

## Human verification required (operator plans, orchestrator only)

### 1. Plan 178-03: deployed probe, crosswalk, P7 and census, founder checkpoint

**Test:** run the read-only steps on the deployed worker and PROD (marker query first): per-account probe, `crosswalk` with fingerprint ties, P7 per target, B'1 census, per-account predicted outcome, then the founder checkpoint (D-01), including that a field where most targets tie records zero rebuilds by design.
**Expected:** each target labelled `rebuild`, `not recomputed (D-06)`, `not recomputed (no ordering reading)`, `not recomputed (crosswalk ambiguous)` or `not recomputed (no crawled OKX account)`, with counts only recorded.
**Why human:** needs PROD reads on the deployed worker and a founder decision; orchestrator-only.

### 2. Plan 178-04: SC-1 cite, D-03 and D-04 gates, guarded rebuild, after-census

**Test:** cite the Phase 173 reading by run (SC-1); confirm Phase 179's close fix is on the deployed worker SHA and its tolerance decision is recorded (D-03); confirm MARKSOURCE plan 08's cut-over and first night have passed and the run is outside the hold (D-04); B'3a re-run P7, one guarded forced job per ruled label, B'3c proof, B'5 audit comparison (`account_non_working_accounts_excluded` equals P7's `dead_exchange_accounts`, window equals P7's prediction), B'6 after-census and row diff.
**Expected:** SC-2 before and after census with `older_rows_changed` 0; SC-3 kept rows named with counts in the ledger.
**Why human:** one-way PROD write; orchestrator-only.

## Post-deploy section, 2026-10-29: operator plans closed by founder ruling D-09 (status moved from `human_needed` to `passed` by hand)

The gsd-verifier was not re-run; the only outstanding items were the operator plans. What happened, from `178-03-SUMMARY.md` (read-only; counts only):

- Plan 178-03 ran on the deployed commit (contains the 178 merge and the Phase 180 merge). The probe read all five OKX-holding accounts at `selection` `ok` (none refused as a whole any more: D-05 holds in PROD), `non_working_accounts_excluded` 2, 1, 2, 0, 1, `okx_order_gate` `ok` with 5 of 5 readings, 0 violations, and each target carried its own D-02 reading. The worker was restored (Railway's record shows the normal start command).
- The crosswalk mapped census a1, a3 and a5 by fingerprint; a2 and a4 tie each other and read `ambiguous` (D-07). P7 read `not recomputed (D-06)` for census a1, a2 and a5 (a dead key's holdings overlap the 90-day window for 34, 34 and 46 in-window days; a5 also has 7 deleted keys named in the window); census a3 and a4 have no stored history.
- The founder closed the phase at the D-01 checkpoint: "Close 178, record only (Recommended)" (CONTEXT D-09). Plan 178-04 did not run (`status: superseded`; recorded in `178-03-SUMMARY.md`); nothing was enqueued and nothing was written to PROD.

### Roadmap contract against the ruling

| # | Success criterion | Status | Evidence |
|---|---|---|---|
| SC-1 | The Phase 173 ordering reading is cited by run before any rewrite; any other reading stops the phase | MET | No rewrite happened, so nothing proceeded on another reading. The deployed probe of 2026-10-29 reads `okx_order_gate` `ok`, 5 readings, 0 violations, 0 full-page stops, in addition to 173's reading |
| SC-2 | The 90-day window is rebuilt through the forced path, with a before and after census | REPLACED by the founder's ruling D-09, not met | The rebuild did not run and no after-census exists. The phase reports SC-2 as not met by founder ruling, never as met; the ruling is the recorded outcome (`sc2-status: zero rebuilt, founder-ruled (rule=none)`) |
| SC-3 | Rows older than the window and `allocator_holdings` history are named as kept, with their counts | MET, with one limit | Named under TODOS `167.2.1.1.1.1-OKX-DOUBLE-COUNT-BEYOND-REBUILD-WINDOW` together with the in-window rows of a1, a2 and a5 (D-09). Counts come from the MARKSOURCE census of record (248 suspect days over three accounts, 164 inside the window) and this pass's counts. The `allocator_holdings` row-day count was not re-taken: the census files were not re-run under D-09 |

Observable truths 15 to 18 above move from PENDING to: 15 MET, 16 replaced by D-09 (not met), 17 MET with the limit above, 18 NOT achieved by founder ruling (the stored OKX rows stay as stored; the entry stays open). `behavior_unverified` for the code half stays 0.

---

_Verified: 2026-10-29_
_Verifier: Claude (gsd-verifier)_
