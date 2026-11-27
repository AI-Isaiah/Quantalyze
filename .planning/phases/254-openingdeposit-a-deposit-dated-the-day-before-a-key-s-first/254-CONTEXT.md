# Phase 254: OPENINGDEPOSIT - Context

**Gathered:** 2026-11-27
**Status:** Ready for planning

<domain>
## Phase Boundary

`replay_key_equity` in `analytics-service/services/allocator_equity_derive.py` counts a flow dated before a key's first return day as `out_of_window_flow` (a blocking degrade reason) unless the key is on a `FULL_HISTORY_VENUES` venue (Deribit, MT5), where the D-13 opening run is judged by the zero-start check instead. ROADMAP Phase 254 goal: "A deposit dated exactly the day before a key's first return counts as that key's opening deposit on every venue, not only on Deribit and MT5." Founder ruling 2026-11-26, verbatim: "Exempt it, book for v1.23".

ROADMAP, verbatim: "**The fix is narrow.** An opening-run exemption in `replay_key_equity`: a flow dated exactly one day before the key's first return is its opening deposit, whatever the venue." and "**Not the fix.** Widening `FULL_HISTORY_VENUES`. That set is shared with the D-13 zero-start checks, which must keep their meaning."

PROD reading 2026-11-27 (Supabase MCP, marker query first, it named PRODUCTION): exactly one `allocator_equity_derived` `equity_curve` row carries `out_of_window_flow` (with `window_truncated`). Its book has eight keys; the only non-full-history key is a Bybit key whose single outside-window flow is a positive flow dated exactly one day before its first return day. Every other key's outside flow is on Deribit or MT5, which D-13 already covers. So this phase clears that book's `out_of_window_flow` on its next daily derive; `window_truncated` is untouched.

In scope: the exemption in `replay_key_equity`, the tests for SC-1..SC-3, the update of existing tests that pinned the old rule, PROOF-01 (SC-4).

Out of scope: `FULL_HISTORY_VENUES`, `_opening_flow_run`, the D-13 zero-start check and its band, any payload or reader change, any migration, MT5.

</domain>

<decisions>
## Implementation Decisions

### Decided autonomously
- [Scope of "flow"] Q: "Does the exemption cover any flow on the day before the first return, or only a deposit?" → Selected: "Only a deposit: the day's net flow (`_flows_by_day` aggregates by day) is strictly positive." The ROADMAP goal and SC-1 say "deposit"; a withdrawal on the day before the first return cannot be an opening deposit and keeps today's `out_of_window_flow`. Reversible, one comparison.
- [Which keys] Q: "Does the exemption apply on full-history venues too?" → Selected: "Only when `history_reaches_inception` is False." On Deribit and MT5 that day is already the end of the D-13 opening run and is judged by the zero-start check; applying the exemption there would skip that check, which SC-3 forbids. The full-history path is byte-unchanged.
- [Zero-start check on other venues] Q: "Is the exempted deposit judged by the zero-start band?" → Selected: "No." SC-3 keeps the D-13 checks unchanged and the ROADMAP names a narrow exemption, not an extension of D-13 to retention-capped venues.
- [Writer basis] Q: "Legacy roll only, or also writer-basis mode?" → Selected: "Whichever flows the replay runs on (`fbd`)", the same way the 234 stated-tail-day ruling applies. The OOW count already reads `fbd` after the writer-basis switch.
- [Visibility] Q: "Is the exemption named anywhere?" → Selected: "A count flag `opening_deposit_exempted: 1` on `KeyEquity.flags`," mirroring `opening_flows_reconciled` on the D-13 path. Count flags are not in the payload's token list (`_bool_flag_tokens`), so no payload, reader or anon surface changes.
- [Existing tests] Q: "What happens to tests that pin the old rule on non-full-history venues?" → Selected: "They are the documented intent change and are rewritten with a dated note, keeping what they test": `test_venue_without_full_history_is_unchanged` becomes the exemption arm plus a two-days-before arm; the compose and job wiring tests use a two-day opening run (days -2 and -1), so a full-history key still reconciles both days while another key keeps exactly one `out_of_window_flow` (day -2), and the wiring stays distinguishable.
- [Level reconstruction] Q: "Does the curve change?" → Selected: "No." The flow day is already in the union of days and folded into `equity[0]` (IN-02); only the count, the reason and the flag change.

### Claude's Discretion
- One plan, one wave. PROOF-01 recorded verbatim in the SUMMARY. CI mypy strict, ruff and the affected pytest modules in the pre-push check.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- OOW count: `replay_key_equity`, the block under `# MEDIUM-5:` (`out_of_window_flows = sum(...) - len(opening_run)`), and the flags block (`if out_of_window_flows:` / `if opening_run:`).
- `_opening_flow_run(fbd, lo)` (D-13 run, full-history only).
- Tests: `analytics-service/tests/test_allocator_equity_inception.py` (exact-arithmetic forward oracle `_exact_book`, `_returns`, `_flows`, `_compose`, `_job_inputs`, the 234 stated-day arms).

### Established Patterns
- Founder rulings are recorded as a dated comment at the code site (see the 234 stated-tail-day comment).
- PROOF-01: neuter, see RED with the named arm, restore with `cp`, verify with `cmp`, GREEN.

### Integration Points
- `compose_allocator_equity` passes `history_reaches_inception=k in history_first`; the job reads the venue from `api_keys.exchange` against `FULL_HISTORY_VENUES`. Neither changes.

</code_context>

<specifics>
## Specific Ideas

- 155.2 freeze window re-measured 2026-11-27 at origin/main `9a215bfef`: `.planning/phases/155.2-*/` holds `155.2-12-PLAN.md` and no `155.2-12-SUMMARY.md`, so plan 12's recapture has not run and the window is not open. This change also cannot move an MT5 number: `replay_key_equity` has one call site (`compose_allocator_equity`), which passes `history_reaches_inception=k in history_first` for live and departed keys alike, and the exemption applies only when that is False, so every Deribit and MT5 key takes the unchanged path.
- `window_truncated`, the PROD book's other reason, is BENIGN (not in `_BLOCKING_REASONS`), so the book reads trustworthy after its next derive unless something else blocks.
- Known limit, accepted by the ruling's narrow scope: on a retention-capped venue (OKX, Bybit) a deposit on the day before the first return day is exempted even if the returns start at the retention edge rather than at the account's start. Nothing else names that case today (`window_truncated` is about keys covering different days, not retention).
- No reader names `out_of_window_flow` outside `analytics-service` (`grep -rl -a` over `src`, `supabase`, `scripts`: 0 files); the token reaches readers only through the payload's `degrade_reasons`.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
