---
phase: "231"
slug: "bybitreads-a-bybit-read-covers-every-coin-settle-type-window"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 2
created: "2026-11-24"
---

# Phase 231 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Audit

gsd-security-auditor, 2026-11-24, over plans 01-06 (plan 06 code at the phase branch after three review rounds). Verdict **SECURED**: 21 of 21 threats closed (15 mitigate, 6 accept), 0 open. Verified at L2 depth (the mitigation sits at the right boundary), not only by pattern.

| Threat | Category | Sev | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-231-01 | Information disclosure | medium | mitigate | CENSUS and FOUNDER-VREAD05 carry no home path, uuid, email or address; greps over the phase dir find none | closed |
| T-231-02 | Information disclosure | high | mitigate | `scripts/bybitreads_probe.py` `emit_record` is the only stdout path, through `validate_record` (closed key set) and `assert_sanitized`; `test_a_planted_amount_never_reaches_stdout` | closed |
| T-231-03 | Tampering | high | mitigate | `ReadOnlyRecordingExchange` resolves read prefixes and a closed read set only; `ReadOnlySupabase` is select-only; `test_the_view_refuses_write_methods`, `test_the_probe_source_names_no_write_method` and its can-fail twin | closed |
| T-231-04 | Denial of service | medium | mitigate | operational: PROBE-RESULT records the run inside the window and `worker-restored: yes`, the start command read back | closed |
| T-231-05 | Information disclosure | medium | mitigate | the probe prints failure tokens and exception class names only; `test_main_prints_the_exception_type_only_on_a_run_level_failure` | closed |
| T-231-06 | Tampering | medium | mitigate | `services/positions.py` `_bybit_inverse_position` requires a usable mark and finite value and pnl, else `BybitPositionReadRefused`; `TestBybitPositionCategories` | closed |
| T-231-07 | Information disclosure | low | mitigate | static refusal reasons with no digits; the holdings path logs class plus fixed copy; digit assertions in `test_positions.py` | closed |
| T-231-08 | Denial of service | low | accept | bounded position calls per poll inside the `poll_positions` budget; raw walk capped | closed (accepted) |
| T-231-09 | Repudiation | high | mitigate | `_fetch_raw_trades_bybit` walks seven-day windows with both bounds and refuses by name (page cap, stuck cursor, start too old, malformed reply, unreadable fill); `TestBybitExecutionWindowWalk` | closed |
| T-231-10 | Information disclosure | medium | mitigate | static refusal texts, the page-cap driver message discarded, scrubbed failed-page log; `test_the_refusal_text_carries_no_digits` | closed |
| T-231-11 | Denial of service | low | accept | page limit and one request per empty window; the probe measured the sweep time | closed (accepted) |
| T-231-12 | Information disclosure | medium | mitigate | the VREAD-05 record carries the choice, an upper-bound date and counts only | closed |
| T-231-13 | Tampering | high | mitigate | the Bybit derive reads Unified transfer rows only (`replace`, verdict undecided); `test_unified_rows_replace_the_on_chain_reads_and_count_once`, union neuter RED in plan 05 | closed |
| T-231-14 | Tampering | medium | mitigate | `services/exchange.py` `fetch_bybit_stable_wallet_with_status`: membership only through `is_stable_value`; malformed, non-finite, absent-total and any `None` stable quantity read `(None, True)`; the sum is signed (review MD-01); `test_bybit_stable_wallet_arms`, the shared-constant monkeypatch test | closed |
| T-231-15 | Information disclosure | low | mitigate | class plus `scrub_freeform_string` only; raised text names the coin code, never a value; the arms assert no signature and no raw quantity reaches the log | closed |
| T-231-SC (01-06) | Tampering | low | accept | no package installed; dependency manifests unchanged | closed (accepted) |

## Notes (non-blocking)

- T-231-14's register and the plan 06 SUMMARY say negative stable balances are "skipped". Review round 1 (MD-01) changed this to a signed sum so a borrowed stable coin lowers the anchor; the security intent (no inflated anchor) holds and is stronger. Recorded in `231-REVIEW-W4.md`.
- T-231-06 guards the inverse rows, the only place a USD figure is derived from a mark; linear and USDC rows keep the venue's `positionValue` as before (pre-existing, out of scope).
- T-231-10's digit test exercises three of the five reasons through their real paths; the other two texts were read and hold no digit.
- Pre-existing "Bybit fill dropped" log lines in `exchange.py` log raw execution fields with `%r`; they predate this phase and are outside T-231-10.
