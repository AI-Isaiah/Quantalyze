---
status: passed
verified_at_sha: 5d80c1a61f8d79e1ace682b9e3eb08f627a683a2
drift_subjects:
  - analytics-service/scripts/walletoffset_probe.py
  - analytics-service/tests/test_walletoffset_probe.py
  - analytics-service/tests/_okx_bills.py
---

# Phase 184 WALLETOFFSET: Verification (re-verification after gap closure G-01)

**Verdict: passed.** All three Success Criteria are met. The one gap of the first verification (G-01, the OKX
window-bill parser dropped `instId`) is closed in code (PR #1176, `ce8685fa2`), proved by a test that fails
without the fix, and proved on PROD by the read-only re-run of plan 184-07 (`sc1-met: yes`, all 6 marked keys
measured). The previous verdict was `gaps_found` at `fcad2b19`; this one replaces it.

`verified_at_sha` is the origin/main sha `5d80c1a61f8d79e1ace682b9e3eb08f627a683a2`, which carries both shipped
merges (`552cd7d36` and `ce8685fa2` are ancestors of it). The probe file at that sha is identical to the one at
the worktree HEAD `9ac2a6ddddd65a0858c9c3b58f4111934bbb14ba` (`git diff` of the file between them is empty), so
the tests below ran against the shipped probe.

## Success Criteria

| # | Success Criterion | Verdict | Evidence |
|---|---|---|---|
| SC-1 | For each key on those venues, the offset as a ratio of NAV is measured from fills and trade history for the first-mark window, read-only, recorded with counts and ratios only | VERIFIED | 184-07 PROD re-run: `keys 17, keys_marked 6, keys_measured 6, keys_unmeasurable 0`, `okx_state=measured` (5 of 5), `bybit_state=measured` (1 of 1), `probe-exit: 0`, `sc1-met: yes`. Per-key ratios: OKX k4/k8/k10/k15/k17 offset 0.0000784 to 0.0000786 (all funding, trading 0, flow 0); Bybit k16 offset 0.000543 (trading 0.00096, funding -0.000417). Records carry only tags, counts and ratios. Binance and sFOX read `no_keys` (0 keys), so there was nothing to measure; see SC-2 and the deferral below. |
| SC-2 | The founder gets the numbers and decides; the decision is recorded in this phase's CONTEXT and in this ROADMAP entry | VERIFIED | `184-CONTEXT.md` D-02 (line 25) records `venue-decision: okx=keep bybit=keep binance=wait sfox=wait` with the 0.1% of NAV threshold and the measured maxima; the five open questions at lines 91-95 each carry an "Answered 2026-11-01 (D-02)" line. The ROADMAP Phase 184 entry (line 6730) carries the same decision. 184-05-SUMMARY has the founder's verbatim answers and `sc2-met: yes`. |
| SC-3 | No published number changes in this phase unless the founder decides so | VERIFIED | `git show --stat` on both code merges: `552cd7d36` (PR #1173) touched CHANGELOG.md, VERSION, `analytics-service/scripts/walletoffset_probe.py` (new, 1309 lines), `analytics-service/tests/_okx_bills.py` (additive `pnl`/`fee` params, default off), `analytics-service/tests/test_walletoffset_probe.py` (new), package.json. `ce8685fa2` (PR #1176) touched CHANGELOG.md, VERSION, the probe (+1 line), the probe test, package.json. No derive, applier, migration, router or UI path in either. The founder decision moves no venue, so no number was rebuilt. The probe has no write path (below). |

### Read-only proof (SC-1 and SC-3)

- `ReadOnlySupabase` (probe lines 149-165) hands out a table handle exposing `select` only; every other attribute,
  `rpc` included, raises `AttributeError`. A grep of the probe for `.insert(`, `.update(`, `.upsert(`, `.delete(`,
  `.rpc(`, `.post(`, `.put(`, `.patch(`, `open(` finds none outside comments and docstrings.
- The test file pins it, with failing controls: `test_read_only_wrapper_exposes_select_and_nothing_else`,
  `test_source_calls_no_writer`, `test_source_calls_no_venue_write`, `test_source_pins_can_fail_on_a_planted_write`,
  `test_read_only_a_full_run_leaves_the_fake_databases_writes_empty` and its control.
- The PROD run was delivered by a temporary worker start command that was restored (`worker-restored: yes`,
  start command read back as `python -m main_worker`), and the run printed no `failed:` line.

## G-01 closure (re-verified in full, 3 levels)

- **Exists and substantive.** `_parse_window_bill` at origin/main now returns `"instId": str(row.get("instId") or "")`
  (the single added line of `ce8685fa2`). `okx_window_terms` reads `bill.get("instId", "")`, so the funding bill is
  summed instead of being refused as a blank instrument.
- **Wired.** The new test `test_okx_a_funding_bill_read_from_the_archive_keeps_its_instrument_so_the_key_is_measured`
  drives a type-8 USDT funding bill from the archive fake through `run()`, the walk, the parser and
  `okx_window_terms`, asserting `measured is True`, `pnl_funding_ratio == -0.00015` (hand-computed -3 / 20000).
  The parity test now parses its bills through `wp._parse_window_bill` as well, so it no longer bypasses the parser.
- **Neuter check (run by this verifier).** With the `instId` line removed the new test fails
  (`assert record["measured"] is True` -> `assert False is True`); with the line restored it passes. The file was
  restored from a byte backup and `git status` is clean.
- **Data flows.** The PROD re-run printed `parser-check: billId ccy fee instId instType pnl ts type` equal to
  `parser-expected`, `fingerprint-expected` equal to `import-check`, and the deployed commit
  `ce8685fa2ede01829852ee38737c67f9141ca9cf` equal to the merge commit, so the run used the fixed code. The five
  OKX keys that were `malformed` in 184-04 are `measured=true reason=none failure=none` in 184-07.
- **Small-change disclosure.** The blank-instrument parametrization lost its `" "` case; the chain keeps a
  whitespace-only `instId`, so refusing it would have broken parity (184-06 key-decision). This is consistent with
  the probe's stated rule of mirroring `fetch_funding_okx`.

## Behavioral spot-checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Probe test file passes | `cd analytics-service && .venv/bin/python -m pytest -q tests/test_walletoffset_probe.py --no-cov` | 178 passed | PASS |
| New G-01 test fails without the fix | line removed, then `-k keeps_its_instrument` | 1 failed; restored: 1 passed | PASS |
| Shared helper regression gate | orchestrator-run: 10 analytics-service files using `tests/_okx_bills.py` | 793 passed (reported, not re-run here) | PASS (reported) |

## Binance and sFOX deferral (founder-decided, tracked, not a gap)

D-02 (founder 2026-11-01, "Wait for their own measurement (Recommended)") keeps Binance and sFOX on the wallet
base until a key is marked and measured. The wait is tracked by the founder's choice ("TODOS entry with a trigger
(Recommended)") as `[184-BINANCE-SFOX-OFFSET-WAIT]`, which exists in `TODOS.md` (line 13430 of the worktree copy)
with the trigger "a Binance or sFOX key gets its first stored mark" and the action "re-run the read-only probe,
then bring the ratios to the founder under the D-02 rules". The Goal text itself says "once their keys have
marks". The probe has Binance and `reader_not_built` sFOX handling already, so the re-run needs no new code.
Note: the TODOS entry is on the planning branch (`feat/184-planning`); it was not present in `origin/main:TODOS.md`
at the time of this check, so it lands with the planning/records PR.

## Requirements coverage

The phase has no REQUIREMENTS.md ids (`phase_req_ids` null; REQUIREMENTS.md has no Phase 184 mapping). The plans
declare phase-local criteria ids only: 184-01 to 184-04, 184-06, 184-07 carry `[SC-1, SC-3]` (184-05 `[SC-2, SC-3]`),
and each of SC-1, SC-2, SC-3 is accounted for above. No orphaned requirement.

## Anti-patterns

None blocking. The fix is one line plus a test; no TBD, FIXME or XXX markers were introduced by the changed lines.

## Warnings (not blocking)

- **ROADMAP bookkeeping is stale.** The Phase 184 entry still reads `Plans: 5/7 plans executed`, and the plan rows
  for 184-07 and 184-05 are unchecked `[ ]` although both SUMMARYs are `status: complete`. The overview bullet at
  ROADMAP line 219 is also `[ ]`. Tick these when closing the phase (`phase complete`), then `git diff` the result
  per the repo rule on gsd-tools handlers.
- **Human items:** none. The decision (SC-2) was made by the founder and is recorded; no visual or runtime-only
  behavior remains unverified.

## Gaps

None. G-01 is closed.

---

_Verified: 2026-11-01_
_Verifier: Claude (gsd-verifier), against origin/main 5d80c1a61f8d79e1ace682b9e3eb08f627a683a2_
