---
phase: 172-okxanchor
reviewed: 2026-10-27T14:00:41Z
round: 3
depth: deep
files_reviewed: 10
files_reviewed_list:
  - analytics-service/scripts/allocator_history_probe.py
  - analytics-service/services/okx_opening_balance.py
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/tests/_okx_bills.py
  - analytics-service/tests/test_allocator_history_probe.py
  - analytics-service/tests/test_ana_recon_audit.py
  - analytics-service/tests/test_okx_anchor_rule.py
  - analytics-service/tests/test_okx_opening_balance.py
  - analytics-service/tests/test_reconstruct_force_rebuild.py
  - analytics-service/tests/test_reconstruct_whole_account.py
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
status: issues_found
---


# Phase 172: Code Review Report

**Reviewed:** 2026-10-27
**Depth:** deep (call chains traced into `services/exchange.py` and the `equity_reconstruction` price and crawl helpers)
**Files Reviewed:** 10
**Status:** issues_found
**Scope:** `git diff 53f25ac3..HEAD -- . ':!.planning'` on `feat/172-okxanchor`. Plan 05 (the post-ship operator step) is out of scope. Only MEDIUM and above are reported, as the brief asked.

## Summary

The wiring of the forced OKX second opinion holds up under tracing:

- **Scope.** `_okx_forced_opening_agrees` returns False straight away unless `require_anchor` is set and the venue is OKX. It is reached only through the `_implausible_anchor` arm, after the terminus, partial-ticker and unreliable-replay arms.
- **Telemetry.** `_anchor_opening_agreed = _implausible_anchor` in the `else` arm is True exactly when the bills agreed. The merge ORs it, and it reaches the `reconstruct_complete` audit as a bool.
- **Refusal vocabulary.** It is unchanged at 15 tokens, and no new token is raised.
- **Venue errors.** Venue exceptions from the balance read and the bills walk propagate to `_crawl_whole_account`'s `classify_exception` instead of becoming a refusal.
- **Probe.** It stays read-only. Its `ReadOnlySupabase` reaches `_read_cached_prices` only, and every new record key is validated and default-filled.
- **Checks.** The 240 tests in the six phase files pass, and the CI `mypy --strict` line reports no issues.

The defect is in what the oracle counts as a complete reading. The walk has no proof that it read every bill between the opening and now. The only live reading, a4 in 172-03-SUMMARY, looks like a one-page partial read. That reading is what both the founder's tolerance decision and SC-3 ("a4 anchors") rest on.

## Critical Issues

### CR-01 (HIGH, data-integrity): the bills walk has no completeness proof, and a4's only live reading read one page out of at least 13

**File:** `analytics-service/services/okx_opening_balance.py:232-265` (walk), `:268-288` (reach), `:291-315` (`per_ccy_opening`), `:375-389`. Consumed at `analytics-service/services/equity_reconstruction.py:3715-3727`.

**Issue:** `walk_okx_bills_archive` treats the first empty page as the end of the data. Nothing checks either end of what it collected:

- **Tail (oldest end).** `okx_bills_reach` proves that the ARCHIVE serves a bill at or before the opening instant (docstring `:271-273`: "proves every later bill is served"). It does not prove that the WALK read back to the first bill after the opening. `per_ccy_opening` then takes `bal - balChg` of the oldest bill the walk happened to read as the currency's opening.
- **Head (newest end).** Nothing compares the newest walked bill's `bal` with the balance row's `cashBal`. A currency whose only bills since the opening fall outside the pages read also keeps today's `cashBal` as its "opening" (`:303`). The module's premise "every balance change creates a bill" (`:297-298`, `:16-18`) is assumed, not checked.
- **Chain check.** It only proves the bills it read are consistent with each other (`:309-314`), so a missing run of bills at either end goes undetected.

**Evidence from the one live reading** (172-03-SUMMARY `sc1-reading`):

- `bills_read=100`: exactly one full page. The forced pass read `trades_read=1282` fills in the 89-day window, and with `flow_events_in_window=0` the first row is the first trade day, so every one of those fills is on or after the opening instant. Each OKX fill writes at least one bill, so at least 1282 bills, 13 or more pages, exist since the opening. The walk stopped after page 1. The second page came back empty or a page arrived out of order. Either way the code accepted it as complete. 172-03-SUMMARY records "Noted, not decided here: a4's `bills_read=100` is one page". Plan 04 then shipped the rule without resolving it.
- `bal_over_cashbal=0.932`: the newest USDT bill read is 93.2% of today's USDT `cashBal`. With a complete walk and RESEARCH assumption A1 (bills `bal` is the cash balance), this must be 1.000. Either the page read was not the newest, or A1 fails. Both invalidate the oracle as built. RESEARCH line 229 names this exact ratio as the oracle's self-check, and it failed.

So the residual of -0.0147 that set `OPENING_TOLERANCE_REL = 0.05` (`:101-116`), and the "money_before_window" conclusion, both come from a partial reading.

**Concrete failure scenario (wrong curve written).** Suppose the venue serves the newest page first and the walk stops after it. Then the "opening" is the USDT balance a few days ago, which is close to today's cash for a mostly-stable account.

1. Take an account funded inside the window by a funding-to-trading transfer, which the replay cannot see. The replay ends at R ≈ 0.03·A. The 5x arm fires.
2. The transfer bill is older than the page read, so the oracle reports roughly today's cash, about A - upl.
3. `opening_agrees` checks |(A - R) - (A - upl - Δ)| = |upl + Δ - R|, where Δ is the cash change after the page boundary. That is ≤ 0.05·A, so it returns True.
4. The forced rebuild applies the offset to every row and replaces the stored window in one write. Every row before the transfer is overstated by the transfer amount.

This is the exact case the module docstring says must disagree (`:38-39`, "one inside the curve still does"). In the other direction (only the oldest page read), any currency whose first bill since the opening lies past that page gets today's `cashBal` as its opening, so the opening is wrong in either direction.

**Why the tests cannot catch it:** `tests/_okx_bills.py:127-140` implements `begin`/`after` exactly as the walk assumes, so the fake and the code share one unverified assumption. No test serves a partial archive in which the walk's result stays chain-consistent but incomplete.

**Fix:** before any opening is returned, prove both ends and fail closed under a token. Add tokens to the closed set (for example `head_unproven` and `tail_unproven`), each with a gap case in both parametrized lists.

```python
# head: the walk reached "now" for every currency it saw, and for every currency it did not
for ccy, group in by_ccy.items():
    newest = max(group, key=lambda b: int(b["billId"]))
    if _decimal(newest["bal"], "malformed_bills") != cash_by_ccy.get(ccy, Decimal(0)):
        raise OpeningUnavailable("head_unproven")
# tail: the walk's oldest bill per currency links to the last bill BEFORE the opening
#   GET bills-archive {"ccy": ccy, "end": str(opening_ms - 1), "limit": "1"}
#   require prev["bal"] == oldest["bal"] - oldest["balChg"]  (else "tail_unproven";
#   no prior bill for a currency is only acceptable when the opening it implies is 0)
```

Then re-measure a4 with the probe before plan 05 forces its rebuild. The tolerance and the `money_before_window` verdict should be re-decided on a reading whose `bills_read` is consistent with `trades_read` and whose `bal_over_cashbal` reads 1.000. If A1 itself proves false (`bal` is not `cashBal`), the oracle's basis needs re-deriving before it can gate a write.

## Warnings

### WR-01 (MEDIUM, user-facing): a transient price-source fault becomes a permanent `anchor_skipped_implausible` refusal

**File:** `analytics-service/services/okx_opening_balance.py:343-349` and `:396-398`. Callees: `analytics-service/services/equity_reconstruction.py:1103-1107` (`_read_cached_prices`) and `:1015-1022` (`_fetch_coingecko_daily_closes`).

**Issue:** the module promises that "a transient fault turned into 'unavailable' would become a permanent refusal that ... PD-I forbids retrying" (`:57-60`) and propagates venue exceptions for that reason. The BadSymbol pricing branch breaks that promise:

- `_read_cached_prices` swallows any database exception and returns `{}`.
- `_fetch_coingecko_daily_closes` swallows any HTTP status error, including CoinGecko's free-tier 429, and returns `[]`.

`_usd_close_on` then returns None, `read_okx_opening` raises `OpeningUnavailable("unpriced_ccy")`, and `_okx_forced_opening_agrees` returns False. The forced job then fails permanent as `anchor_skipped_implausible`.

**Failure scenario:** a forced OKX rebuild of an account holding a coin with no OKX `X/USDT` market, at a moment when CoinGecko answers 429 or the price-cache read hits a transient PostgREST error. The rebuild is refused permanently instead of retried, and the operator gets a refusal token that claims the anchor is implausible. Under PD-I nothing re-crawls automatically.

**Fix:** in the oracle, call the price sources without their swallowing wrappers, so that a transport or 429 failure raises (classified transient by `_crawl_whole_account`). Reserve `unpriced_ccy` for a successful answer that contains no price for the day. For example, add a non-swallowing variant of the CoinGecko fetch that calls `resp.raise_for_status()` and lets the error propagate, and read the cache through `db_execute` without the catch-all. Add a test in which the CoinGecko fetch raises and the forced call must propagate, not refuse.

---

_Reviewed: 2026-10-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Silent-failure hunter, round 1 (MEDIUM+ only)

- SFH-01 (HIGH, data-integrity): `okx_opening_balance.py` `_usd_close_on` — `er._read_cached_prices` and `er._fetch_coingecko_daily_closes` swallow errors (DB error -> `{}`, any non-2xx incl. 429 -> `[]`), so a transient pricing failure becomes `unpriced_ccy` -> permanent `anchor_skipped_implausible` (PD-I). An empty OKX candle list also never falls back to cache/CoinGecko. Same defect as WR-01.
- SFH-02 (MEDIUM, data-integrity): the walk treats any empty page as the end and never ties the newest `bal` per ccy to today's `cashBal`; a4 read `bills_read=100`, `bal_over_cashbal=0.932`. Same defect as CR-01.
- SFH-03 (MEDIUM, operator-visible): every oracle outcome (six unavailable reasons and a genuine disagreement) collapses to `anchor_skipped_implausible` with the reason only in a log line (disagreement at info). Fix: a closed-vocabulary oracle-outcome field in telemetry/audit (not a refusal token); log a disagreement at warning.
- SFH-04 (MEDIUM, probe): `allocator_history_probe.py` `_anchor_diagnostic` — one oracle/venue exception discards every field already measured; keep the partial `out` and mark the opening check unavailable with its failure class.

## Round 2

**Reviewed:** 2026-10-27T13:41:08Z, `feat/172-okxanchor` at `f1e37b804`
**Scope:** the whole phase diff `git diff 53f25ac3..HEAD -- . ':!.planning'`, with emphasis on the fix range `0b3ed22e8..HEAD -- analytics-service` (merges `f8574ed82`, `ad811dc75` and commit `f1e37b804`). Findings of MEDIUM and above only. The frontmatter counts above are this round's.
**Checks run:** 264 tests pass in the six phase test files (pytest, from `analytics-service/`). The CI line `mypy --strict --follow-imports=silent` over `services/ routers/ models/ main*.py sentry_init.py` reports `Success: no issues found in 124 source files`. `len(er.FORCED_REBUILD_REFUSAL_REASONS) == 15`, measured.

### Round-1 findings: status

| Round 1 | Verdict | Evidence at HEAD |
|---|---|---|
| CR-01 / SFH-02: walk completeness | **Resolved in code.** One part is a leftover (WR-02 below). | Tail: `okx_opening_balance.py:256-279` sends no `begin`, ends only on a bill with `ts < opening_ms`, and an empty page is `reach_unproven` (`:264-265`). Head: `per_ccy_opening` requires each currency's newest `bal` to equal its `cashBal`, or 0 when absent (`:308-309`). Zero bills is `reach_unproven` (`:431-432`). This proof is as strong as round 1's `okx_bills_reach`, and it no longer depends on reply order. The `oldest_first` gap case proves the order point. |
| WR-01 / SFH-01: price fault became `unpriced_ccy` | **Resolved.** | `_cached_close_on` (`:319-339`) has no catch. `_coingecko_close_on` (`:342-366`) treats 404 as "no price" and calls `raise_for_status()` on every other status. `httpx.HTTPStatusError` and `APIError` reach `classify_exception` as `unknown`, then `_AccountCrawlRetryableError` (`equity_reconstruction.py:5495-5499`), so they are retried and never refused permanently. |
| SFH-03: outcome visibility | **Resolved.** | `_okx_forced_opening_check` returns the closed outcome (`:3435-3492`). It rides `ForcedRebuildRefusedError.opening_check` and reaches the refusal audit (`:5225-5262`, `:5709-5711`). The gather re-raises the same exception object (`raise outcome`, `:5465`), so the field survives a multi-member crawl. A disagreement now logs at warning. |
| SFH-04: probe discarded partial readings | **Resolved.** | Only the oracle call is caught (`allocator_history_probe.py:898-904`), and every ratio measured before it survives. |

### Specific questions from the brief (checked; none reaches MEDIUM)

- **A bill posted between the balance read and the walk.** The balance row is read inside `_okx_forced_opening_check` (`equity_reconstruction.py:3471`), immediately before the walk. A fill or funding bill in that one round trip makes the newest `bal` differ from `cashBal`, so the result is `chain_break` and a permanent refusal. That fails closed: it can never produce `agreed`. The chance per attempt is about the bill rate times one round trip, which is roughly 1e-4 for a4's about 14 fills a day. That is below MEDIUM, unless OKX's archive lags `cashBal`, which is unmeasured.
- **Newest-first walk without `begin`, against the page ceiling.** It reads the same bills as the `begin`-bounded walk did, plus at most one boundary page. The capacity of 50,000 bills since the opening is unchanged, so there is no regression.
- **CoinGecko 404 vs other statuses.** Correct as written. A 404 means "not listed", which is an answer. 429, 5xx, 401 and 403, a transport error and a non-JSON 200 all propagate and are retried.
- **Merge rule for `anchor_opening_check`.** It takes the first member value that is not `not-run`. On a completed forced rebuild a member can only carry `agreed` or `not-run`, because any other value raises. The unforced path always carries `not-run`. So the rule cannot hide a refusal outcome.
- **Refusal vocabulary.** It is still the closed 15. `anchor_opening_check` is an audit field, not a token.
- **A transient fault turned into a permanent refusal.** None is introduced, apart from the race above.
- **An unproven opening turned into `agreed`.** No path does this. `agreed` needs `opening_usd` to be set, and that needs a bill from before the opening, a non-empty walk, every chain and head link holding, and every non-stable currency priced.
- **The dormant-before-opening case.** An account with no bill in the archive's window before its opening is refused `reach_unproven`. Round 1's `okx_bills_reach` refused the same case. a4 passed that check at plan 03, so this is not a regression and it does not block SC-3.
- **Can the tests fail?** Yes, for each fix:
  - Without the empty-page rule, `reach_unproven-second_page_comes_back_empty` returns 1150 as a measured opening.
  - Without the head link, `chain_break-newest_bill_is_not_todays_cash_balance` and `chain_break-archive_served_oldest_first` measure an opening.
  - With the swallowing price wrapper back, the 429/500/503 cases return `unpriced_ccy` and do not raise. The fake runs on real httpx `MockTransport` semantics.
  - Without the `if not bills` check, `reach_unproven-no_bill_since_the_opening` measures 1.
  - The refusal-audit cases assert each token, `disagreed` and `not-run`.

  One limit remains: `OkxBillsArchive` still assumes `billId` order equals `ts` order, so no test can show the walk's stop rule is sound if the venue breaks that assumption.

### WR-02 (MEDIUM, data-integrity, round-1 leftover of CR-01's re-measure clause): an anchored a4 prints `opening_check: not-run`, so the 5% tolerance's basis is never re-measured on a complete walk

**Files:** `analytics-service/scripts/allocator_history_probe.py:829` (`_read_member` discards `_telemetry`), `:974-976` (the diagnostic runs only on a refusal), `:1060` (default `opening_check: "not-run"`). Also `analytics-service/services/okx_opening_balance.py:109-124` (the basis of `OPENING_TOLERANCE_REL`).

**Issue:** CR-01 asked for two things: re-measure a4 on a complete walk, and re-decide the tolerance from that reading. The code half is fixed. The measurement half cannot happen with the code as shipped:

- The tolerance docstring still names the plan-03 a4 reading as its basis: `opening_residual_over_anchor=-0.0147` beside `bal_over_cashbal=0.932`.
- The fixed oracle rejects exactly that shape. `test_bills_whose_newest_balance_is_not_todays_cash_are_not_a_measurement` says so: "It used to come back as a measured opening."
- So the only number behind the 5% gate came from a reading the code now treats as no measurement.

**Failure scenario.** The probe would print a false `not-run` beside an anchored a4. A tolerance entry would then be written from a residual the code itself rejects, and the 5% write gate would ship with an unmeasured basis.

1. Plan 05 runs the deployed probe. Its forced pass reads a4 with the complete walk, and the bills agree at some residual up to 0.05.
2. `_read_member` returns rows only, so the member is `read=True` and no diagnostic runs.
3. a4's record prints `opening_check: "not-run"`, `bills_read: "field-absent"` and `opening_residual_over_anchor: "field-absent"`. The oracle did run and did agree, so `not-run` is false.
4. Plan 05 Task 2 books `172-OKX-OPENING-TOLERANCE-ONE-ACCOUNT` "with the measured residual". The only residual on record is the invalid -0.0147.
5. The gate that decides whether an offset is spread over every stored row of an OKX account rests on a residual no complete walk produced. A residual of, say, 0.045 on the first valid reading would pass silently and never reach the founder, who chose 5% as "at least twice the residual".

**Fix (minimal):**
- In `_probe_member`, also run the read-only `_anchor_diagnostic` for an OKX member whose forced pass anchored with `anchor_opening_check == "agreed"`. Have `_read_member` return `_telemetry`. The advisory pass re-flags the 5x arm, so the diagnostic then prints `opening_check: measured`, `bills_read`, `bal_over_cashbal` and `opening_residual_over_anchor` from the complete walk.
- Change the comment at `okx_opening_balance.py:114-122` to say that the basis reading came from a partial walk the fixed oracle refuses, and that plan 05 re-measures it.
- Plan 05 should record the new residual, not -0.0147, in the tolerance entry. A residual over 0.025 (half the tolerance) should be a STOP for the founder.

### WR-03 (MEDIUM, process, not user-facing; new, caused by the SFH-03 rename): plan 05's deploy import check looks up the old helper name and will STOP on a correct deploy

**File:** `.planning/phases/172-okxanchor-an-okx-account-s-history-rebuild-gets-a-plausible/172-05-PLAN.md:88`, against `analytics-service/services/equity_reconstruction.py:3435`.

**Issue:** the import check prints `callable(getattr(e, "_okx_forced_opening_agrees", None))` and expects `True` on a rule branch. The SFH-03 fix renamed the helper to `_okx_forced_opening_check`, and `grep` finds no `_okx_forced_opening_agrees` left in `analytics-service/`. On the correct deploy the line therefore reads `0 15 True 0.05 False`. Step 2 says "Anything else is a STOP (deploy mismatch)", so the operator halts a correct deploy, or overrides a STOP by hand. Either way the deploy-identity check (T-172-23) no longer distinguishes this head from the `refusal`-branch shape (`... no-rule False`) on its last field.

**Fix:** in `172-05-PLAN.md:88`, change `_okx_forced_opening_agrees` to `_okx_forced_opening_check`. The expected value stays `... <tolerance-rel> True`.

---

_Reviewed: 2026-10-27T13:41:08Z_
_Reviewer: Claude (gsd-code-reviewer), round 2_
_Depth: deep_

## Silent-failure hunter, round 2 (MEDIUM+ only)

All four round-1 SFH findings resolved.

- SFH-R2-01 (MEDIUM, data-integrity auditability, new): an anchor accepted past the 5x gate records no measure of how close the bills came (`equity_reconstruction.py` agreed log, telemetry, completion audit carry only `agreed`/true), so a 4.9% agreement reads like a 0.1% one while the tolerance rests on one account. Fix: carry the opening residual over the anchor and the implied opening over the anchor (3 significant figures, ratios only) on the agreed log and the completion/refusal audits.
- SFH-R2-02 (MEDIUM, decision basis, leftover from CR-01): `okx_opening_balance.py` tolerance comment cites the a4 partial reading (bills_read=100) as the 5% basis; same as WR-02.

## Round 3

**Reviewed:** 2026-10-27T14:00:41Z, `feat/172-okxanchor` at `26f6b8806`
**Scope:** the whole phase diff `git diff 53f25ac3..HEAD -- . ':!.planning'`, with emphasis on the round-2 fix range `0a924d204..HEAD` (commits `17e6c0fd5`, `4243c208c`, `c3d329b3a`, `2d2a0c3b7`, `39306bd47`, merges `7db65ffc1`, `26f6b8806`) and the plan-05 edit `e37f3a2ff`. Findings of MEDIUM and above only. The frontmatter counts above are this round's.
**Checks run (from `analytics-service/`):**
- pytest: 270 pass in the six phase test files. 722 pass and 5 skip across all 19 test files that reference `_fetch_and_price_window`, `ForcedRebuildRefusedError`, `_merge_account_telemetry`, `run_reconstruct_allocator_history_job`, the probe or the oracle.
- The CI line `mypy --strict --follow-imports=silent` reports `Success: no issues found in 124 source files`.
- Plan 05's import check, run locally at HEAD, prints `0 15 True 0.05 True`. That matches the expected `0 15 True <tolerance-rel> True` on a rule branch.

### Round-2 findings: status

| Round 2 | Verdict | Evidence at HEAD |
|---|---|---|
| SFH-R2-01: an agreed anchor recorded nothing about how close the bills came | **Resolved.** | `_okx_forced_opening_check` (`equity_reconstruction.py:3462-3533`) returns `(outcome, residual_ratio, implied_ratio)`. Both ratios are set only after `reading.opening_usd` is not None (`:3518-3520`), so they exist only for `agreed` and `disagreed`. `anchor` cannot be zero at that point, because the 5x arm needs `last_value > 0` and `abs(anchor - last_value) > 5*last_value`. Where the ratios go: the agreed log at info and the disagreed log at warning, ratios only (`:3522-3533`); telemetry (`:3888-3890`); a first-non-None merge (`:2533-2550`); the completion audit (`:6090-6091`); and, through `ForcedRebuildRefusedError.opening_ratios`, the refusal audit only when `opening_ratios[0]` is set (`:5313-5321`, `:5769-5771`). The gather re-raises the same exception object, so the ratios survive a whole-account crawl. The merge cannot pair one member's outcome with another member's ratios. A completed forced rebuild's members carry only `agreed` with ratios or `not-run` with None, and a disagreement raises before any merge. Tests assert the exact values: -0.0143 and 0.857 on telemetry, the log and the completion audit; -0.429 on the disagreement's refusal audit; neither key on a `reach_unproven` refusal; present-and-None on an ordinary forced completion. |
| WR-02 / SFH-R2-02: an anchored a4 printed `opening_check: not-run`; the tolerance comment cited the partial walk | **Code half resolved. The plan half is partly open (WR-04 below).** | The probe: `_read_member` returns `telemetry.get("anchor_opening_agreed") is True` (`allocator_history_probe.py:847`), and `_probe_member` runs the never-raising `_anchor_diagnostic` for an OKX member that agreed (`:971-976`). It snapshots `calls` and `transfers` BEFORE the second pass, so the TRADEPAGES counters are not doubled. The test pins `trade_calls == 2`, `trades_read == 5` and `read_args == [True, None]`. The probe stays read-only: `ReadOnlySupabase`, and `supabase.writes == []` is asserted. The comment: `okx_opening_balance.py:111-127` now calls 0.05 the founder's recorded choice, made on a partial walk the fixed oracle refuses, to be re-decided from plan 05's re-read. |
| WR-03: plan 05's import check named the old helper | **Resolved.** | `172-05-PLAN.md:88` now looks up `_okx_forced_opening_check`. Every field of the expected line was measured at HEAD: `EXIT_OK=0`, `len(FORCED_REBUILD_REFUSAL_REASONS)=15`, `"opening_check" in ACCOUNT_RECORD_KEYS` is True, `OPENING_TOLERANCE_REL=0.05`, and the helper is callable. No `_okx_forced_opening_agrees` is left in `analytics-service/`. |

### Invariants re-checked across the whole phase diff (none reaches MEDIUM)

- **PD-H.** On the forced path, `_fetch_and_price_window` either applies the anchor or raises a named refusal before any row is returned. The 5x arm applies the anchor only on `"agreed"`. Every other outcome sets `_anchor_skipped_implausible` and raises `anchor_skipped_implausible`, which `_forced_refusal_result` records as permanent with nothing written.
- **PD-I.** No round-2 change adds a catch. The balance-row read, the bills walk, the price-cache read and the non-404 CoinGecko statuses still propagate to the crawl's `classify_exception`.
- **Refusal vocabulary.** It is still the closed 15. `anchor_opening_check` and the two ratios are audit fields, not tokens.
- **Redaction.** The only new values are two 3-significant-figure ratios over the anchor. They appear on logs and audits, and no amount or id was added anywhere. The probe gained no record key, and its agreed-path test checks the output for leaks: the total equity, the opening balance, the key id and the trade-id prefix.
- **Below MEDIUM, noted.** The probe's `opening_residual_over_anchor` is `(implied - bills) / anchor` (`allocator_history_probe.py:913`). The audit's `anchor_opening_residual_ratio` is `(bills - implied) / anchor` (`equity_reconstruction.py:3519`). For the same reading they print opposite signs. Every decision uses the absolute value (the gate, and plan 05 step 9b), so nothing is decided wrongly, but an operator comparing the two will see a sign flip.

### WR-04 (MEDIUM, decision basis / data-integrity adjacent, not user-facing; leftover: the plan half of round-2 WR-02): plan 05's ledger task still records plan 03's refused partial-walk residual, and nothing gates step 9b

**File:** `.planning/phases/172-okxanchor-an-okx-account-s-history-rebuild-gets-a-plausible/172-05-PLAN.md:113`, `:118`, `:120` (Task 2), `:102` (Task 1's automated verify), `:166-170` (Artifacts).

**Issue.** Round 2's fix for WR-02 asked that "plan 05 should record the new residual, not -0.0147, in the tolerance entry". Step 9b now writes `tolerance-basis:` and asks the founder for `tolerance-founder-decision:`. Neither line reaches the ledger or any gate:
- **Task 2's sources.** Its `read_first` (`:113`) still lists `sc1-reading:` and `tolerance-rel:` from 172-03-SUMMARY, and not `tolerance-basis:` or `tolerance-founder-decision:`.
- **The Measured paragraph (`:118`).** It must quote `opening_residual_over_anchor` "from `sc1-reading:`". That value is plan 03's -0.0147, the reading the fixed oracle refuses. On a rule branch the paragraph closes with "tolerance <tolerance-rel>", which is plan 03's value, not the founder's 9b answer.
- **The tolerance entry (`:120`).** `172-OKX-OPENING-TOLERANCE-ONE-ACCOUNT` is booked "with the measured residual". The only residual Task 2 is told to read is the refused one.
- **Task 1's gate (`:102`).** The SC3_OK automated check gates neither `tolerance-basis:` nor `tolerance-founder-decision:`, and the Artifacts list (`:166-170`) omits both. Step 9b can be skipped and the plan still passes. That is the "a step that cannot fail" class CLAUDE.md records for the CHANGELOG.

**Scenario.**
1. Plan 05 runs. a4 anchors, and the probe prints `opening_check: measured` with, for example, `opening_residual_over_anchor: 0.041`.
2. Step 9b is skipped or recorded, and SC3_OK passes either way.
3. Task 2 follows its own text. It closes `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE` with -0.0147 and "tolerance 0.05".
4. It books the tolerance entry with -0.0147 as "the measured residual".

The ledger is the durable record of the 5% write gate's basis. It would then say the gate has twice the margin of the only reading the code accepts, which is the outcome WR-02 was raised to prevent. If the founder re-sets the tolerance in 9b, nothing in Task 2 records that the shipped constant no longer matches the decision. Plan 05 changes no code, so the constant stays 0.05 until a follow-up.

**Fix (plan text only):**
- Add `tolerance-basis:` and `tolerance-founder-decision:` from 172-05-SUMMARY to Task 2's `read_first`.
- In the Measured paragraph and the tolerance entry, take the residual from `tolerance-basis:`. Name plan 03's -0.0147 only as the superseded partial-walk reading.
- Close with the founder's 9b decision. When it differs from the shipped `OPENING_TOLERANCE_REL`, the tolerance entry's trigger is the constant change.
- Append `&& grep -aqE '^tolerance-basis: opening_check=' "$S" && grep -aqE '^tolerance-founder-decision: .+' "$S"` to Task 1's automated verify, and list both lines under Artifacts.

---

_Reviewed: 2026-10-27T14:00:41Z_
_Reviewer: Claude (gsd-code-reviewer), round 3_
_Depth: deep_

## Silent-failure hunter, round 3 (MEDIUM+ only), and dispositions

- SFH-R3-01 (MEDIUM, probe measurement integrity): the probe printed `bills_read: 0` / `blank_inst_type_bills: 0` / `bills_transfer_net_over_anchor: 0.0` when the bills walk never completed. Fixed (fix round 3): those three fields stay `field-absent` for `malformed_balance`, `malformed_bills`, `page_ceiling`, `reach_unproven`.
- SFH-R3-02 (MEDIUM, auditability): the audit residual had the opposite sign of the probe's. Fixed (fix round 3): the audit uses `(implied - bills_opening) / anchor`, the probe's convention.
- WR-04 (round 3 code review, plan text): fixed in `172-05-PLAN.md` (ledger and gate take `tolerance-basis:` and `tolerance-founder-decision:`).

Three review rounds and three fixer rounds are spent. No finding is left open at MEDIUM+. The 0.05 tolerance's basis is a founder re-decision at plan 05 step 9b.
