---
phase: 202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo
plan: 03
subsystem: testing
tags: [allocator-equity, replay, degrade-reasons, out-of-window-flow, window-truncated, read-only, scratch]

requires:
  - phase: 202-residchurn
    provides: plan 01 capture kit (rc.py labels and read_n), 188's b0 and b1 row-level captures
provides:
  - b3_replay.py, a read-only scratch script that replays b3's seven stored key_inputs with the repo's own replay_key_equity, in capture mode and in plan 07's c1 mode
  - out_of_window_flow on b3 reproduced from stored inputs on b1 and b0 (k15 only), with the counterfactual venue extension shown to block too
  - window_truncated predicted for all seven books from stored key windows, with one disagreement (b6) recorded as measured
  - the b1 and b0 verdict lines, composed from the component lines
affects: [202-07, 202-08]

plan_head_before: 6a371fcb0fe897a40a6c0ec5412394063d5ca63b
plan_head_after: 661c30ac5ac364c5935c5cd7e651da3b64c5d49b
actuals:
  tokens: 9000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "an offline replay of the repo's own function over stored inputs, cross-checked against a restated formula on every key"
    - "an expectation check shown RED against an empty implementation and against an in-memory neuter before it is trusted"

key-files:
  created:
    - ~/.cache/quantalyze/residchurn/bin/b3_replay.py
  modified:
    - .planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-03-SUMMARY.md

key-decisions:
  - "The all-seven window_truncated agreement is a verdict input (plan Task 2), not a hard gate of --expect b1; only b3's own truncation line is gated there, and every other disagreement is printed."
  - "The replay runs on the repo's analytics-service interpreter by absolute path, because the bare python3 -I has no pandas."
  - "The window_truncated verdict is left unexplained as the rule gives it; no amended prediction rule was applied without a decision."

requirements-completed: []  # RESID-02 stays open: window_truncated is unexplained on b6's disagreement (checkpoint below)

coverage:
  - id: D1
    description: "b3's out_of_window_flow reproduced from its seven stored key_inputs: k15 (bybit, not full-history) counts 1, the six deribit and mt5 keys 0, the replay flags out_of_window_flows:1; extending the venue rule reads inception_unreconciled, share 0.0082 against band 0.0001"
    requirement: RESID-02
    verification:
      - kind: other
        ref: "b3_replay.py --capture b1 --expect b1 exit 0; same command with --neuter exit 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "window_truncated is benign by enum classification and its prediction from stored key windows agrees with the stored reason on 6 of 7 books; b6 predicts yes and stores no"
    requirement: RESID-02
    verification:
      - kind: other
        ref: "b3_replay.py --capture b1: gc-c-b3-truncated lines, 6 of 7 agree=yes"
        status: fail
    human_judgment: true
    rationale: "The prediction rule counts every member key of a book, while b6's stored curve spans one key's window only. Whether that is the rule's reach or a compose gap is a decision, not a measurement."
  - id: D3
    description: "the founder's venue pin, band and unchanged positional rule hold: test_allocator_equity_inception 19 passed, 0 failed; no file under analytics-service changed"
    requirement: RESID-02
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_allocator_equity_inception.py (19 passed); git status --porcelain -- analytics-service empty"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-11-07
status: complete
---

# Phase 202 Plan 03: b3's two reasons explained from stored inputs Summary

**b3's `out_of_window_flow` is reproduced from its stored inputs with the repo's own replay (one opening deposit on the Bybit key k15, which would not reconcile to a zero start even on a full-history venue), while `window_truncated` stays `unexplained` by the plan's rule because the prediction disagrees with the stored reason on b6.**

## Performance

- **Duration:** about 25 min
- **Completed:** 2026-11-07
- **Tasks:** 2
- **Files modified:** 1 tracked (this SUMMARY), 1 untracked scratch script and 2 outputs under `~/.cache/quantalyze/residchurn/`

## Accomplishments

- **out_of_window_flow (correct behaviour).** Per b3 key the script prints the venue, whether it is on `FULL_HISTORY_VENUES`, the first and last return day, the flows before and after, the opening run and the count. On b1 k15 (Bybit, `full_history=no`) has one flow the day before its first return day and an empty opening run, so its count is 1. The six deribit and mt5 keys each carry one pre-window flow, absorbed by the opening run, so their count is 0. The repo's `replay_key_equity` over k15's stored inputs returns `flags=out_of_window_flows:1`, reason `out_of_window_flow`, trustworthy false, and on every one of the seven keys the function's own count equals the restated formula (`gc-c-b3-xcheck`, 7 of 7 `agree=yes` on b1 and on b0).
- **Counterfactual.** Replaying k15 with `history_reaches_inception=True` reads `inception_unreconciled`, also blocking, with an implied-start share of 0.0082 against the band 0.0001, computed as the `implied_start` block of `replay_key_equity` computes it. Extending the venue rule would not green the book.
- **window_truncated.** It is benign (`DegradeReason.WINDOW_TRUNCATED` sits under the benign header and is not in `_BLOCKING_REASONS`). Predicted from each book's member keys' stored first and last return days, it agrees with the stored reason on b1, b2, b3, b4, b5 and b7, and disagrees on b6 (predicted yes, stored no), on b1 and on b0 alike. b2, b5 and b7 carry the reason while trustworthy, which is the evidence that it does not block.
- **Pins.** `FULL_HISTORY_VENUES == {deribit, mt5}` is asserted by the script, and `test_allocator_equity_inception.py` passes 19 of 19. No file under `analytics-service` changed.

## Task Commits

1. **Task 1: b3's seven keys replayed from stored inputs (RED then GREEN)** - `cbbe25032` (test)
2. **Task 2: pins and the b1 verdict per reason** - `661c30ac5` (feat)

**Plan metadata:** the docs commit that carries this file's final form, STATE and ROADMAP.

TDD gate: the expectation checks were written first and shown to fail against an empty implementation (8 `EXPECTATION FAILED` lines, exit 1: k15 count, the six zero counts, the replay shape). GREEN is `--expect b1` exit 0 on b1; the neuter run (k15's pre-window flow moved onto its first return day in memory) exits 1 with four failures (count 0 not 1, no flags, no `inception_unreconciled`, no share). The script is untracked scratch, so RED and GREEN could not be separate repo commits; the two task commits carry the SUMMARY lines each stage produced.

## Files Created/Modified

- `~/.cache/quantalyze/residchurn/bin/b3_replay.py` - the replay (untracked): `--repo`, `--labels`, `--capture`, `--c1`, `--c1-rows`, `--expect b1|none`, `--neuter`.
- `~/.cache/quantalyze/residchurn/b3/b1.out`, `b0.out` - its outputs (untracked).
- This SUMMARY.

## The explanation, in labels only

`window_truncated` is benign. The curve is correct; the token only says the member keys' windows are unequal, which is true of any multi-key book whose keys start or end on different days. It does not block, and b2, b5 and b7 carry it while trustworthy. b3 is untrustworthy because of the other reason alone.

`out_of_window_flow` blocks b3 because of one opening deposit on the Bybit key k15, dated the day before its first return day. Bybit is not pinned as a full-history venue, so that key keeps the positional rule and the deposit counts as out-of-window. If Bybit were on the list, the opening run would be excluded from the count but the zero-start check would still block, because the capital implied before the deposit is 0.82% of the first-return-day level against a 0.01% band. The venue list and the band are the founder's pins from 167.1.2.2.

The verdict depends on k15's rows, which move nightly (the cluster plan 02 attributes). Plan 07 re-reads it on c1 with the same script (`--c1`), and only a measured c1 fact can reopen D-12.

## Flagged assumption (edge probe item RESID-02, left unresolved)

The stored `key_inputs` payload is taken to be the input the compose used for b3. The checkable proxy is that b3 carries no `key_inputs_mismatch` reason. On b1 it carries none (`gc-c-b3-proxy: capture=b1 ... key_inputs_mismatch=no`). On b0 it does (`key_inputs_mismatch=yes`, `other_blocking=key_inputs_mismatch`). That is the pre-188 stale-row state: 188 gap closure found the reconcile delete left stored rows on stated days, which produced `key_inputs_mismatch` on three books, and cleared it from every book on b1. So the b0 reading explains b3's own `out_of_window_flow` from the same payloads either way, but the assumption is not established by this plan; c0 and c1 carry the same proxy line.

## Decisions Made

See `key-decisions`. The one that matters: the plan's rule makes `window_truncated` `unexplained` when any of the seven books disagrees, and this plan applied it as written.

## Deviations from Plan

**1. [Rule 3 - Blocking] The replay runs on the repo's analytics-service interpreter by absolute path**
- **Found during:** Task 1
- **Issue:** the bare `python3 -I` named in the plan's verify commands has no pandas, so `services.allocator_equity_derive` cannot be imported.
- **Fix:** the main checkout's analytics-service interpreter is run by absolute path with cwd in the worktree; the script inserts `--repo` into `sys.path` first and refuses to run unless the module resolves under `--repo` (it did, under the worktree).
- **Verification:** the Task 1 and Task 2 verify commands were re-run with that interpreter in place of `python3`; both reach their expected outcome.

**2. [Rule 1 - Bug in the plan's expectation] `--expect b1` does not hard-gate the other six books' truncation agreement**
- **Found during:** Task 1
- **Issue:** `<behavior>` says the prediction equals the stored reason on all 7 books, and `--expect b1` was to assert it. The first b1 run measured a disagreement on b6, so a hard gate would make Task 1's verify unsatisfiable and hide the measured fact; the plan's own Task 2 turns a disagreement into `unexplained` and a checkpoint.
- **Fix:** `--expect b1` gates b3's own truncation line and prints a `NOTE:` for any other disagreement; the verdict reads all seven lines.
- **Files modified:** `b3_replay.py` (untracked).

**3. [Rule 2 - Added evidence] Three extra line kinds**
- `gc-c-b3-xcheck` (function count against the restated formula, per key), `gc-c-b3-proxy` (the flagged assumption's proxy) and `gc-c-b3-curve` (whether the stored curve spans every member key's equity window, capture mode only). None changes a count the plan gates on, and none enters the verdict rule.

**Total deviations:** 3 (1 blocking, 1 expectation, 1 added evidence). **Impact:** none on the b3 out_of_window_flow result; the second one is what exposes the b6 disagreement instead of failing before it can be recorded.

## Issues Encountered

- **window_truncated is `unexplained` on b6, on b1 and on b0.** The prediction from member keys' stored windows says yes (k18 runs 2026-02-28 to 2026-11-05, k20 runs 2026-01-22 to 2026-07-20) and b6 stores no reason. The supplementary `gc-c-b3-curve` line shows b6's stored curve spans 2026-02-28 to 2026-11-05, which is k18's window alone (k20 starts 2026-01-22), so k20's days are not in that curve. b5 shows the same curve gap (`curve_holds_all_members=no`) yet agrees, because its other keys still differ. This is not a finding about b3 (b3's own line agrees, and its curve holds all its members), and no defect is claimed: the cause of k20's absence from b6's curve was not established, because that needs the compose's run-time inputs, which the stored rows do not carry.

## Checkpoint

## CHECKPOINT REACHED

**Type:** decision
**Gate:** blocking
**Plan:** 202-03
**Progress:** 2/2 tasks complete

**Blocked by:** the verdict rule gives `gc-c-b3-verdict: capture=b1 window_truncated=unexplained out_of_window_flow=correct trust=false d13=open`. The failing component line is `gc-c-b3-truncated: capture=b1 book=b6 keys=2 predicted=yes stored=no agree=no trustworthy=true`, with `gc-c-b3-curve: capture=b1 book=b6 ... curve_holds_all_members=no` as context.

The decision is how to read it: (1) amend the prediction to range over the keys a book's stored curve actually holds, which makes b6 predicted no and all seven agree, so `window_truncated` becomes `correct` and D-13 applies; or (2) treat the b6 gap as its own question (why the compose leaves k20 out of b6's curve) and keep `window_truncated` `unexplained` until it is answered. b3 itself is not affected either way. Nothing was fixed and no defect was claimed.

## Known Stubs

None.

## Threat Flags

None. The script reads saved files and imports repo code read-only; nothing touched PROD, Railway, Keychain or `q.sh`. Only labels, ISO days, counts, flags, tokens and one 4-decimal ratio are printed.

## Next Phase Readiness

Plan 07 can run `b3_replay.py --c1 "$RC/c1" --c1-rows "$RC/rows/k15.json"`. That mode was run on a synthetic c1 directory built from b1 (checksums computed locally) and printed the same line shapes as capture mode, so its file reading, chk binding and window cross-checks are exercised; it has not met a real c1 capture. Plan 07 needs the decision above to know whether its `window_truncated=correct|absent|unexplained` rule starts from `correct` or `unexplained`.

## Raw output: capture b1 (`$RC/b3/b1.out`)

gc-c-b3-venues: FULL_HISTORY_VENUES=deribit,mt5 pinned=yes
gc-c-b3-key: capture=b1 key=C venue=deribit full_history=yes first=2023-06-28 last=2026-10-26 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-xcheck: capture=b1 key=C replay=0 formula=0 agree=yes
gc-c-b3-key: capture=b1 key=k4 venue=deribit full_history=yes first=2024-12-07 last=2026-11-05 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-xcheck: capture=b1 key=k4 replay=0 formula=0 agree=yes
gc-c-b3-key: capture=b1 key=k8 venue=mt5 full_history=yes first=2025-10-17 last=2026-11-05 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-xcheck: capture=b1 key=k8 replay=0 formula=0 agree=yes
gc-c-b3-key: capture=b1 key=k10 venue=deribit full_history=yes first=2025-09-27 last=2026-11-05 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-xcheck: capture=b1 key=k10 replay=0 formula=0 agree=yes
gc-c-b3-key: capture=b1 key=k14 venue=mt5 full_history=yes first=2026-07-29 last=2026-11-05 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-xcheck: capture=b1 key=k14 replay=0 formula=0 agree=yes
gc-c-b3-key: capture=b1 key=k15 venue=bybit full_history=no first=2026-01-23 last=2026-11-05 pre_window_flows=1 post_window_flows=0 opening_run=0 out_of_window_flows=1
gc-c-b3-xcheck: capture=b1 key=k15 replay=1 formula=1 agree=yes
gc-c-b3-key: capture=b1 key=k35 venue=mt5 full_history=yes first=2026-07-28 last=2026-11-05 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-xcheck: capture=b1 key=k35 replay=0 formula=0 agree=yes
gc-c-b3-replay: capture=b1 key=k15 inception=false flags=out_of_window_flows:1 reasons=out_of_window_flow trustworthy=false
gc-c-b3-replay: capture=b1 key=k15 inception=true flags=inception_unreconciled_flows:1 reasons=inception_unreconciled trustworthy=false implied_start_share=0.0082 band=0.0001
gc-c-b3-stored: capture=b1 book=b3 trust=false reasons=out_of_window_flow,window_truncated other_blocking=none
gc-c-b3-proxy: capture=b1 book=b3 key_inputs_mismatch=no
gc-c-b3-truncated: capture=b1 book=b1 keys=1 predicted=no stored=no agree=yes trustworthy=true
gc-c-b3-curve: capture=b1 book=b1 curve_first=2026-02-28 curve_last=2026-11-05 members_first=2026-02-28 members_last=2026-11-05 curve_holds_all_members=yes
gc-c-b3-truncated: capture=b1 book=b2 keys=8 predicted=yes stored=yes agree=yes trustworthy=true
gc-c-b3-curve: capture=b1 book=b2 curve_first=2023-06-27 curve_last=2026-11-05 members_first=2023-06-27 members_last=2026-11-05 curve_holds_all_members=yes
gc-c-b3-truncated: capture=b1 book=b3 keys=7 predicted=yes stored=yes agree=yes trustworthy=false
gc-c-b3-curve: capture=b1 book=b3 curve_first=2023-06-27 curve_last=2026-11-05 members_first=2023-06-27 members_last=2026-11-05 curve_holds_all_members=yes
gc-c-b3-truncated: capture=b1 book=b4 keys=1 predicted=no stored=no agree=yes trustworthy=true
gc-c-b3-curve: capture=b1 book=b4 curve_first=2026-02-28 curve_last=2026-11-05 members_first=2026-02-28 members_last=2026-11-05 curve_holds_all_members=yes
gc-c-b3-truncated: capture=b1 book=b5 keys=3 predicted=yes stored=yes agree=yes trustworthy=true
gc-c-b3-curve: capture=b1 book=b5 curve_first=2026-02-28 curve_last=2026-11-05 members_first=2026-01-22 members_last=2026-11-05 curve_holds_all_members=no
gc-c-b3-truncated: capture=b1 book=b6 keys=2 predicted=yes stored=no agree=no trustworthy=true
gc-c-b3-curve: capture=b1 book=b6 curve_first=2026-02-28 curve_last=2026-11-05 members_first=2026-01-22 members_last=2026-11-05 curve_holds_all_members=no
gc-c-b3-truncated: capture=b1 book=b7 keys=7 predicted=yes stored=yes agree=yes trustworthy=true
gc-c-b3-curve: capture=b1 book=b7 curve_first=2023-06-27 curve_last=2026-11-05 members_first=2023-06-27 members_last=2026-11-05 curve_holds_all_members=yes

## Task 1 output: capture b0, second reading (`$RC/b3/b0.out`)

gc-c-b3-key: capture=b0 key=C venue=deribit full_history=yes first=2023-06-28 last=2026-11-03 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-xcheck: capture=b0 key=C replay=0 formula=0 agree=yes
gc-c-b3-key: capture=b0 key=k4 venue=deribit full_history=yes first=2024-12-07 last=2026-11-04 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-xcheck: capture=b0 key=k4 replay=0 formula=0 agree=yes
gc-c-b3-key: capture=b0 key=k8 venue=mt5 full_history=yes first=2025-10-17 last=2026-11-04 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-xcheck: capture=b0 key=k8 replay=0 formula=0 agree=yes
gc-c-b3-key: capture=b0 key=k10 venue=deribit full_history=yes first=2025-09-27 last=2026-11-04 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-xcheck: capture=b0 key=k10 replay=0 formula=0 agree=yes
gc-c-b3-key: capture=b0 key=k14 venue=mt5 full_history=yes first=2026-07-29 last=2026-11-04 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-xcheck: capture=b0 key=k14 replay=0 formula=0 agree=yes
gc-c-b3-key: capture=b0 key=k15 venue=bybit full_history=no first=2026-01-23 last=2026-11-04 pre_window_flows=1 post_window_flows=0 opening_run=0 out_of_window_flows=1
gc-c-b3-xcheck: capture=b0 key=k15 replay=1 formula=1 agree=yes
gc-c-b3-key: capture=b0 key=k35 venue=mt5 full_history=yes first=2026-07-28 last=2026-11-04 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-xcheck: capture=b0 key=k35 replay=0 formula=0 agree=yes
gc-c-b3-replay: capture=b0 key=k15 inception=false flags=out_of_window_flows:1 reasons=out_of_window_flow trustworthy=false
gc-c-b3-replay: capture=b0 key=k15 inception=true flags=inception_unreconciled_flows:1 reasons=inception_unreconciled trustworthy=false implied_start_share=0.0082 band=0.0001
gc-c-b3-stored: capture=b0 book=b3 trust=false reasons=key_inputs_mismatch,out_of_window_flow,window_truncated other_blocking=key_inputs_mismatch
gc-c-b3-proxy: capture=b0 book=b3 key_inputs_mismatch=yes
gc-c-b3-truncated: capture=b0 book=b1 keys=1 predicted=no stored=no agree=yes trustworthy=true
gc-c-b3-curve: capture=b0 book=b1 curve_first=2026-02-28 curve_last=2026-11-04 members_first=2026-02-28 members_last=2026-11-04 curve_holds_all_members=yes
gc-c-b3-truncated: capture=b0 book=b2 keys=8 predicted=yes stored=yes agree=yes trustworthy=false
gc-c-b3-curve: capture=b0 book=b2 curve_first=2023-06-27 curve_last=2026-11-04 members_first=2023-06-27 members_last=2026-11-04 curve_holds_all_members=yes
gc-c-b3-truncated: capture=b0 book=b3 keys=7 predicted=yes stored=yes agree=yes trustworthy=false
gc-c-b3-curve: capture=b0 book=b3 curve_first=2023-06-27 curve_last=2026-11-04 members_first=2023-06-27 members_last=2026-11-04 curve_holds_all_members=yes
gc-c-b3-truncated: capture=b0 book=b4 keys=1 predicted=no stored=no agree=yes trustworthy=true
gc-c-b3-curve: capture=b0 book=b4 curve_first=2026-02-28 curve_last=2026-11-04 members_first=2026-02-28 members_last=2026-11-04 curve_holds_all_members=yes
gc-c-b3-truncated: capture=b0 book=b5 keys=3 predicted=yes stored=yes agree=yes trustworthy=true
gc-c-b3-curve: capture=b0 book=b5 curve_first=2026-02-28 curve_last=2026-11-04 members_first=2026-01-22 members_last=2026-11-04 curve_holds_all_members=no
gc-c-b3-truncated: capture=b0 book=b6 keys=2 predicted=yes stored=no agree=no trustworthy=true
gc-c-b3-curve: capture=b0 book=b6 curve_first=2026-02-28 curve_last=2026-11-04 members_first=2026-01-22 members_last=2026-11-04 curve_holds_all_members=no
gc-c-b3-truncated: capture=b0 book=b7 keys=7 predicted=yes stored=yes agree=yes trustworthy=false
gc-c-b3-curve: capture=b0 book=b7 curve_first=2023-06-27 curve_last=2026-11-04 members_first=2023-06-27 members_last=2026-11-04 curve_holds_all_members=yes

## Task 2 output: the pins and the verdict per reason

gc-c-b3-pin: tests=test_allocator_equity_inception passed=19 failed=0

The verdict is composed from the component lines above by the plan's rule. `out_of_window_flow`: the k15 key line reads `full_history=no` and `out_of_window_flows=1`, the six other key lines read `out_of_window_flows=0`, the k15 `inception=false` replay reads `flags=out_of_window_flows:1`, and the `inception=true` replay reads `inception_unreconciled` with a share of 0.0082 against the band 0.0001: correct. `window_truncated`: six of the seven `gc-c-b3-truncated` lines read `agree=yes`; the b6 line reads `predicted=yes stored=no agree=no`: the rule makes that `unexplained`.

gc-c-b3-verdict: capture=b1 window_truncated=unexplained out_of_window_flow=correct trust=false d13=open
gc-c-b3-verdict: capture=b0 window_truncated=unexplained out_of_window_flow=correct trust=false d13=open

## Self-Check: PASSED

- Scratch script and both outputs present under `~/.cache/quantalyze/residchurn/` (`bin/b3_replay.py`, `b3/b1.out`, `b3/b0.out`).
- Task commits present on this branch: cbbe25032, 661c30ac5.
- `git status --porcelain -- analytics-service supabase` prints nothing; the uuid and home-path grep on this file prints nothing.
- Passing here means the self-check items hold. It does not mean RESID-02 is closed: `window_truncated` is `unexplained` and the checkpoint above is open.
