"""Phase 167.2.1.1.2.1 TRADEPAGES probe (D-03, SC-3): how far does an allocator's stored
history sit from a correct re-read of the venue, and does OKX answer fills newest first?

WHY: the allocator history rebuild used to stop reading trades on a page shorter than
the limit it asked for, so a venue that caps a page below that limit (Bybit 100, OKX
100) was read for one page only. Plans 01-04 fix the loop. Before any rebuild runs, the
founder asked (D-03) for a measurement of the stored histories against a correct
re-read, as counts and sizes only. The probe also carries the live check of RESEARCH
A1 (OKX fills-history answers newest first), because the backward walk plan 02 builds
rests on it and plan 06 refuses every rebuild while it is unproven. Run it only after
plans 01-04 are merged and deployed: it measures whatever read is deployed.

WHAT IT DOES, per allocator account holding an active OKX or Bybit key, labelled
a1..aN by the account's earliest such key:
  1. chooses the members and the window exactly as a forced rebuild would
     (_read_account_keys, _select_account_crawl_keys, _account_rebuild_window), with
     the job key the post-deploy plan's forced job uses: the earliest-created working
     Bybit key, else the earliest-created working OKX key, else the earliest active
     OKX or Bybit key. A selection refusal is recorded by its closed-vocabulary token,
     before any decrypt for that account;
  2. re-reads each selected OKX or Bybit member through the rebuild's own read
     (_fetch_and_price_window, anchored), recording per call the row count, the
     distinct trade ids and the oldest timestamp, in memory only. The deposit and
     withdrawal calls of that same read are recorded too (Phase 173 D-02). The account
     record counts the distinct events stamped more than 365 days before the run date PER
     KIND (``deposits_older_365d``, ``withdrawals_older_365d``); the pooled
     ``transfers_older_365d`` stays for lineage and equals their sum. The strict
     ``bybit_transfers_gate`` is derived in code from the two per-kind counts and never
     from the pooled one: ``ok`` only when the account holds a Bybit member, its window
     is the rebuild's full Bybit window (730 days) and BOTH counts are at least 1,
     ``unmeasured`` otherwise, ``not-applicable`` when no full Bybit window applies. A 0 is
     NOT a depth finding on the on-chain read (Phase 180 note below). The corroboration
     fields (``deposits_in_window``, ``withdrawals_in_window``, three closed age buckets
     for the oldest fill, deposit and withdrawal, and two booleans for whether the oldest
     fill is older than the oldest deposit or withdrawal) inform the founder and never open
     the gate. From Phase 180 on (D-01) a Bybit member's flow read is the Unified wallet's
     transaction log: its ``TRANSFER_IN`` rows are the deposit kind and its ``TRANSFER_OUT``
     rows the withdrawal kind, so the per-kind counts, in-window totals, buckets and the gate
     describe the Unified edge, and ``bybit_unified_state`` says whether that read answered.
     ``bybit_transfers_cause`` (D-03) names why a shut gate is shut and ``bybit_funding_explained``
     whether the account's funding is explained; both are derived in code and open nothing.
     Lineage (Phase 173, 2026-10-28): the Bybit transfer read was on-chain only, so a6's reading
     ``deposits=0 withdrawals=0 gate=unmeasured`` was not a depth finding;
  3. compares the summed rebuilt curve with the stored one, but only when every
     exchange account the allocator holds is OKX, Bybit or Deribit (which the rebuild
     counts as $0) and every OKX or Bybit member was read: a stored row is the sum
     across all of the allocator's exchange accounts, so a mixed account (an MT5
     member is not read here) reports comparable false with its read counts;
  4. for each OKX member whose forced pass read trades (Phase 173 D-01: a member that was
     read, REFUSED by the forced read under any refusal token, or cut short by a truncated
     read), makes one raw fills-history read on EVERY instrument type that pass's own calls
     returned at least two rows on (a snapshot taken before the anchor diagnostic runs; a type whose
     rows share one millisecond on one short page cannot show an order and is left out), to learn whether
     OKX answers newest first. The member carries ONE reading: ``True`` only when every type
     answers newest first and its page reaches the newest fill the forced pass read on that
     type, ``False`` when any type answers oldest first, no reading otherwise. The read is a side measurement: one that raises
     changes no member's outcome and is recorded as ``okx_order_failure_class`` (an
     allow-listed exception CLASS, never its message). The account record counts the OKX
     members whose forced pass read trades (``okx_members_with_trades``) beside
     ``okx_order_readings``, and the summary's code-derived ``okx_order_gate`` reads
     ``violated`` when a reading found OKX answering oldest first or a pass ended on a full
     page, ``ok`` only when at least one OKX member read trades and every such member
     carries a reading, and ``unmeasured`` otherwise. The probe also counts the OKX passes
     that ended on a full page without reaching their window start;
  5. for an OKX member REFUSED ``anchor_skipped_implausible`` (the replay ended far below
     today's venue equity), or whose anchor passed the 5x gate only through the bills check
     (``anchor_opening_agreed``; its record then has ``member_refusal`` ``none``), measures
     why, read-only. The refusal itself is unchanged and
     the TRADEPAGES counters above describe the forced pass only. The diagnostic makes a
     second, advisory pass of the rebuild's own read to recover the unanchored replay, reads
     one raw balance row, and asks the bills oracle (services.okx_opening_balance) what the
     account held at the start of the replay's first day. It prints ratios against the
     anchor (never the anchor), the replay's sign, the non-stable and bot-held shares, the
     uPnL share, flip-from-flat closes, negative quantities, in-window transfers and skipped
     symbols, and whether the oracle ``measured`` an opening or was ``unavailable`` (with
     its closed reason). Whether the measured opening AGREES with the implied one is NOT
     decided here: the tolerance is chosen from this reading, afterwards.
  6. when that oracle refuses with chain_break, names why (which arm broke, over how many
     currencies, on which currency class and which bill kinds), read-only, through
     scripts/okx_chain_record.py. Its venue calls are GETs only, made through
     services.okx_bills_chain.BudgetedExchange under CHAIN_CALL_CEILING, and it prints the
     chain_* keys that module declares. The refusal and every key above are unchanged.
  7. for each Bybit member read, refused or cut short, takes the funding evidence (Phase 180):
     the five evidence reads (on-chain deposits, internal deposits, withdrawals, inter-account
     transfers and universal transfers), the key's master and UTA flags and a census of eight
     Earn, staking, bonus-transfer and PEF transaction-log types, all read-only GETs and all
     through scripts/bybit_funding_record.py, after the member's snapshot and each under its own
     bound. A source past its bound prints the state Timeout, never a 0. They print counts,
     closed age buckets and closed state tokens, and they feed no gate (D-01, D-03).

REDACTION CONTRACT (the output is pasted into a tracked file in a public repo): labels,
counts, booleans, closed-vocabulary tokens and 3-significant-figure ratios, and no
timestamp finer than the run date. No id, amount, venue text or key. The only path to
stdout is ``emit_record``, which refuses any key outside the declared records, any value
outside the declared vocabulary and any float not already rounded to three significant
figures, then re-checks with ``assert_sanitized``. Logging is switched off for the run.
A failed read is recorded by an allow-listed exception CLASS (a ccxt message can carry
a signed URL, an amount or an id), and a run-level failure prints the exception TYPE
only.

READ-ONLY: every database handle is a ``ReadOnlySupabase``, which exposes ``table`` and,
on a table, ``select`` only (every other attribute, ``rpc`` included, is an
AttributeError). That closes the one write hidden inside the rebuild's read, the price
cache write that runs on a BadSymbol fallback. The probe never calls the account crawl
(_crawl_account_key, _crawl_whole_account), the key preflight (_allocator_key_preflight,
whose circuit-breaker arm can write), the 429 stamp (_stamp_429) or any persist path
(replace_equity_snapshots, replace_equity_snapshots_window, persist_equity_snapshots),
and it names no venue write endpoint. A static pin in the tests proves it. Keys are
decrypted inside the worker process and nowhere else. The venue calls outside the
rebuild's own read are GETs: the fills-history ordering read (one per OKX member whose
forced pass read trades), for an OKX member refused on its anchor, one ``GET /api/v5/account/balance``
plus the bills-archive pages read through ``services.okx_opening_balance``, and, for a Bybit member,
the funding evidence of ``scripts/bybit_funding_record.py`` (five asset record and transfer-list
reads, the key-info read and the Unified transaction-log census).

D-01 (Phase 171): WHICH LIMIT STOPPED A CUT-SHORT READ. For a member whose read was cut
short (``failure_class`` "truncated") the account record also names ``truncated_site`` (the
limit that stopped it), ``last_window_age_bucket`` (the age of the window it stopped in, in
a closed set of day ranges), ``last_window_calls`` (how many calls that window took) and
``read_elapsed_s`` (whole seconds the read ran, summed over the account's members), beside
the existing ``trade_calls``. The site is read from a typed ``site`` attribute on the raised
exception when one is present (a later plan of the phase adds it) and otherwise DERIVED from
the probe's own in-memory call log, because the reading is taken on the code deployed BEFORE
Phase 171 ships. Three derived tokens: ``bybit_window_ceiling`` (the last 7-day window took
exactly the rebuild's per-window page ceiling of calls and every page advanced),
``bybit_stalled_page`` (the last call was a full page that added no new fill, or returned the
cursor it was sent) and ``bybit_stalled_one_ms`` (that stalled page held fills of a single
millisecond). Anything else is ``unknown``. The stall is tested first because the deployed
read tests it before its ceiling branch. Every ``er`` name the probe reads is listed in
``DEPLOYED_ER_NAMES`` and ``run()`` refuses (exit 2, before any decrypt) when the rebuild
module it runs against lacks one, so this file can be run against older deployed code without
silently misrecording.

USAGE (run once on the Railway backfill worker; it takes no arguments, so no identifier
is ever typed). Railway's remote shell is broken (TRADEPAGES plan 06), so run it through a
temporary start-command change that starts the probe in the background
(``python -m scripts.allocator_history_probe``), read its lines from the service log, and
restore the service's start command afterwards. The probe exits 1 whenever a member is
refused, so nothing around it may depend on an exit code of 0.
Paste only the lines that start with ``{"`` (one per account, then one summary).

EXIT CODES
----------
  0  every selected OKX or Bybit member was read; one JSON line per account and a
     summary were printed. A selection refusal (a closed-vocabulary ``selection`` token
     on an account record) also exits 0, because no member was attempted and none
     failed. Read ``accounts_read`` and the summary totals ``trades_read`` and
     ``days_compared`` before taking a run as "no difference": 0 there means nothing was
     read or compared, not that the stored history is right
  1  any member read failed or was refused (printed as a record, after every account
     and the summary), or any other failure (the exception TYPE only on stderr)
  2  refused before any decrypt: no active ``okx`` or ``bybit`` key, or more accounts
     than a two-digit label carries
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import re
import sys
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

from scripts.bybit_upnl_probe import FAILURE_CLASSES, FIELD_ABSENT, classify_failure, sig3
from scripts.deribit_ground_truth import assert_sanitized
from services import equity_reconstruction as er
from services import okx_opening_balance as obal
from services.allocator_equity_derive import working_holder_predicate
from services.closed_sets import STABLECOINS
from scripts import bybit_funding_record, okx_chain_record

# The failure classes this probe may print: the shared allow-list plus "truncated", a trade read
# cut short (er.TruncatedTradeRead), told apart from a venue rejection and from the two-year guard.
_FAILURE_CLASSES: tuple[str, ...] = (*FAILURE_CLASSES, "truncated")

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_REFUSED = 2

# The venues the probe reads. Anything else an account holds is counted, not read.
_PROBE_VENUES: tuple[str, ...] = ("okx", "bybit")

# The label a1..aN is two digits at most.
_MAX_ACCOUNTS = 99

# A stored day differs from the re-read when the two sums are further apart than this
# (the ACCTREBUILD B'5 convention, 2 dp storage).
_DIFF_THRESHOLD = 0.005

# OKX fills-history serves 100 rows a page; a pass whose last page is this full may have
# stopped with older rows unread.
_OKX_PAGE_ROWS = 100

# Bybit's execution-list page size (the rebuild sends it explicitly); a last call this full may
# have stopped with more fills unread.
_BYBIT_PAGE_ROWS = 100

_LABEL_RE = re.compile(r"^a[0-9]{1,2}$")
_DATE_RE = re.compile(r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")

_SELECTION_TOKENS: tuple[str, ...] = ("ok", *sorted(er.FORCED_REBUILD_REFUSAL_REASONS))
_REFUSAL_TOKENS: tuple[str, ...] = ("none", *sorted(er.FORCED_REBUILD_REFUSAL_REASONS))
# Why the bills oracle could not supply an opening balance: its own closed set, or "none".
_OPENING_REASON_TOKENS: tuple[str, ...] = ("none", *sorted(obal.OPENING_UNAVAILABLE_REASONS))
# The reasons the oracle raises before or inside its bills walk, so its walk counters were never
# set. A completed walk that then fails (chain_break, unpriced_ccy) keeps its real counters.
# reach_unproven is also raised after a completed walk that served no bill since the opening;
# that case is reported absent too, the token carrying what the counters would have said.
_WALK_NOT_COMPLETED_REASONS: frozenset[str] = frozenset(
    {"malformed_balance", "malformed_bills", "page_ceiling", "reach_unproven"}
)

# D-01: the limit that stopped a cut-short read. "none" is an untruncated member; the three derived
# tokens are what the probe can tell from its own call log against the code deployed before this
# phase; the nine typed tokens are the sites the rebuild names once it carries a typed ``site``.
_TRUNCATED_SITES: tuple[str, ...] = (
    "none",
    "unknown",
    "bybit_window_ceiling",
    "bybit_stalled_page",
    "bybit_stalled_one_ms",
    "bybit_not_supported",
    "bybit_no_advance",
    "bybit_segment_ceiling",
    "okx_not_supported",
    "okx_no_advance",
    "okx_page_ceiling",
    "generic_not_supported",
    "generic_no_advance",
    "generic_page_ceiling",
)

# The age of a window's start at the run date, in whole days.
_WINDOW_AGE_BUCKETS: tuple[str, ...] = (
    "none",
    "0-29",
    "30-89",
    "90-179",
    "180-364",
    "365-546",
    "547-729",
    "730+",
)

# The OKX ordering gate, derived in code by ``okx_order_verdict`` (Phase 173 D-01).
_OKX_ORDER_GATES: tuple[str, ...] = ("ok", "violated", "unmeasured")

# The Bybit transfer-depth gate, derived in code by ``bybit_transfers_verdict`` (Phase 173 D-02).
_BYBIT_TRANSFERS_GATES: tuple[str, ...] = ("not-applicable", "ok", "unmeasured")

# D-01 (Phase 180): the rebuild's Bybit flow source is the Unified wallet's transaction log. Its
# ``TRANSFER_IN`` rows are the gate's deposit kind and its ``TRANSFER_OUT`` rows the withdrawal
# kind (the mapping D-01 left to the plan), in the recorder's own kind literals. Plan 04 pins these
# two types equal to the rebuild's ``UNIFIED_FLOW_TYPES``; the probe does not import that module,
# because an older deployed tree lacks it.
_UNIFIED_FLOW_KINDS: dict[str, str] = {"TRANSFER_IN": "deposits", "TRANSFER_OUT": "withdrawals"}

# SC-1 ("or a source still unnamed"): whether a Bybit account's funding is explained, derived in code
# by ``bybit_funding_explained``.
_FUNDING_EXPLANATIONS: tuple[str, ...] = (
    "not-applicable",
    "explained",
    "off_edge",
    "unexplained",
    "unmeasured",
)

# D-03 (Phase 180): why a shut Bybit transfer-depth gate is shut, derived in code by
# ``bybit_transfers_cause``. The cause explains a shut gate; it never opens one.
_BYBIT_TRANSFERS_CAUSES: tuple[str, ...] = (
    "not-applicable",
    "none",
    "no_deposit_older_365d",
    "no_withdrawal_older_365d",
    "neither_older_365d",
    "flow_source_unreadable",
    "read_incomplete",
)

# The literal contract with plan 07 (D-03): the closed refusal reason the rebuild gains when an
# account's Bybit flow source cannot be read. Plan 07 adds it to the rebuild's forced-refusal
# vocabulary and its token-set test asserts this name is a member of that set, so the two cannot
# drift. Until then it is not in this probe's emit vocabulary, so the cause is tested as a pure
# function and no record carrying that refusal is emitted.
_FLOW_SOURCE_REFUSAL: str = "account_flow_source_unreadable"

# The Unified states that mean the key or the request cannot get past the read (the permanent
# classes of ``classify_failure``); every other failure class is a transient or unclassified fault.
_PERMANENT_UNIFIED_STATES: tuple[str, ...] = ("AuthenticationError", "PermissionDenied", "BadRequest")

# What the Unified flow read may have done: never asked, answered, answered in a shape the
# recorder could not read, or raised a failure class.
_UNIFIED_STATES: tuple[str, ...] = (
    "not-run",
    "read",
    "malformed",
    *(name for name in FAILURE_CLASSES if name != "none"),
)

# Every attribute the probe reads off the rebuild module. ``run()`` refuses before any decrypt when
# the module it runs against lacks one (see ``missing_deployed_names``).
DEPLOYED_ER_NAMES: tuple[str, ...] = (
    "BYBIT_TRADE_TERMINUS_DAYS",
    "FORCED_REBUILD_REFUSAL_REASONS",
    "ForcedRebuildRefusedError",
    "TruncatedTradeRead",
    "_BREAKDOWN_PROTECTED_KEYS",
    "_BYBIT_WINDOW_PAGE_CEILING",
    "_RECONSTRUCT_CRAWL_TIMEOUT_S",
    "_account_rebuild_window",
    "_fetch_and_price_window",
    "_key_venue",
    "_read_account_keys",
    "_select_account_crawl_keys",
    "_sum_account_rows",
)

# The clock behind ``read_elapsed_s``; a seam so a test can set it.
_monotonic = time.monotonic

ACCOUNT_RECORD_KEYS: tuple[str, ...] = (
    "record",
    "account",
    "run_date",
    "selection",
    "okx_members",
    "bybit_members",
    "other_members",
    "zero_contribution_members",
    "non_working_accounts_excluded",
    "window_days",
    "members_read",
    "members_failed",
    "failure_class",
    "member_refusal",
    "trade_calls",
    "trades_read",
    "first_page_rows",
    "okx_order_readings",
    "okx_order_violations",
    "okx_order_failure_class",
    "okx_passes_ended_full",
    "okx_members_with_trades",
    "comparable",
    "stored_days",
    "rebuilt_days",
    "days_compared",
    "days_differing",
    "max_rel_diff",
    "days_incomplete",
    "transfers_older_365d",
    "deposits_older_365d",
    "withdrawals_older_365d",
    "deposits_in_window",
    "withdrawals_in_window",
    "oldest_fill_age_bucket",
    "oldest_deposit_age_bucket",
    "oldest_withdrawal_age_bucket",
    "oldest_fill_before_oldest_deposit",
    "oldest_fill_before_oldest_withdrawal",
    "bybit_transfers_gate",
    "bybit_unified_state",
    "bybit_unified_in_rows",
    "bybit_unified_out_rows",
    "bybit_unified_sign_mismatch_rows",
    "bybit_funding_explained",
    "bybit_transfers_cause",
    "truncated_site",
    "last_window_age_bucket",
    "last_window_calls",
    "read_elapsed_s",
    "anchor_diagnostic",
    "diagnostic_failure_class",
    "diagnostic_members",
    "advisory_arm",
    "replay_final_sign",
    "anchor_over_replay",
    "opening_check",
    "opening_unavailable_reason",
    "implied_opening_over_anchor",
    "bills_opening_over_anchor",
    "opening_residual_over_anchor",
    "non_stable_share",
    "upl_over_anchor",
    "bot_equity_share",
    "bal_over_cashbal",
    "bills_transfer_net_over_anchor",
    "flip_from_flat_closes",
    "hedge_mode_fills",
    "negative_qty_assets",
    "flow_events_in_window",
    "skipped_symbols_count",
    "bills_read",
    "blank_inst_type_bills",
    "negative_stable_cash",
    "breakdown_truncated",
    "opening_day_is_window_start",
    # The Bybit funding evidence (Phase 180) sits BEFORE the chain keys: two pins in
    # tests/test_okx_chain_record.py hold the chain keys as the tail of this tuple, on purpose.
    "bybit_evidence_members",
    *bybit_funding_record.FUNDING_KEYS,
    *okx_chain_record.CHAIN_KEYS,
)
SUMMARY_RECORD_KEYS: tuple[str, ...] = (
    "record",
    "run_date",
    "accounts",
    "accounts_read",
    "accounts_comparable",
    "accounts_trades_beyond_first_page",
    "accounts_differing",
    "trades_read",
    "days_compared",
    "okx_order_violations",
    "okx_passes_ended_full",
    "okx_order_readings",
    "okx_members_with_trades",
    "okx_order_gate",
    "bybit_accounts_applicable",
    "bybit_transfers_gate",
)


# ---------------------------------------------------------------------------
# Whitelist emitter. The ONLY path to stdout.
# ---------------------------------------------------------------------------


def _is_bool(x: Any) -> bool:
    return isinstance(x, bool)


def _is_bool_or_absent(x: Any) -> bool:
    return _is_bool(x) or (isinstance(x, str) and x == FIELD_ABSENT)


def _is_count(x: Any) -> bool:
    return isinstance(x, int) and not isinstance(x, bool) and x >= 0


def _is_count_or_absent(x: Any) -> bool:
    return _is_count(x) or (isinstance(x, str) and x == FIELD_ABSENT)


def _is_sig3_float(x: Any) -> bool:
    return isinstance(x, float) and math.isfinite(x) and float(f"{x:.3g}") == x


def _is_ratio(x: Any) -> bool:
    if isinstance(x, str):
        return x == FIELD_ABSENT
    return _is_sig3_float(x)


def _is_str_matching(pattern: re.Pattern[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and pattern.match(x) is not None


def _is_one_of(allowed: Sequence[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and x in allowed


_ACCOUNT_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "record": _is_one_of(("account",)),
    "account": _is_str_matching(_LABEL_RE),
    "run_date": _is_str_matching(_DATE_RE),
    "selection": _is_one_of(_SELECTION_TOKENS),
    "okx_members": _is_count,
    "bybit_members": _is_count,
    "other_members": _is_count,
    "zero_contribution_members": _is_count,
    "non_working_accounts_excluded": _is_count,
    "window_days": _is_count_or_absent,
    "members_read": _is_count,
    "members_failed": _is_count,
    "failure_class": _is_one_of(_FAILURE_CLASSES),
    "member_refusal": _is_one_of(_REFUSAL_TOKENS),
    "trade_calls": _is_count,
    "trades_read": _is_count,
    "first_page_rows": _is_count,
    "okx_order_readings": _is_count,
    "okx_order_violations": _is_count,
    "okx_order_failure_class": _is_one_of(_FAILURE_CLASSES),
    "okx_passes_ended_full": _is_count,
    "okx_members_with_trades": _is_count,
    "comparable": _is_bool,
    "stored_days": _is_count,
    "rebuilt_days": _is_count,
    "days_compared": _is_count,
    "days_differing": _is_count,
    "max_rel_diff": _is_ratio,
    "days_incomplete": _is_count,
    "transfers_older_365d": _is_count,
    "deposits_older_365d": _is_count,
    "withdrawals_older_365d": _is_count,
    "deposits_in_window": _is_count,
    "withdrawals_in_window": _is_count,
    "oldest_fill_age_bucket": _is_one_of(_WINDOW_AGE_BUCKETS),
    "oldest_deposit_age_bucket": _is_one_of(_WINDOW_AGE_BUCKETS),
    "oldest_withdrawal_age_bucket": _is_one_of(_WINDOW_AGE_BUCKETS),
    "oldest_fill_before_oldest_deposit": _is_bool_or_absent,
    "oldest_fill_before_oldest_withdrawal": _is_bool_or_absent,
    "bybit_transfers_gate": _is_one_of(_BYBIT_TRANSFERS_GATES),
    "bybit_unified_state": _is_one_of(_UNIFIED_STATES),
    "bybit_unified_in_rows": _is_count,
    "bybit_unified_out_rows": _is_count,
    "bybit_unified_sign_mismatch_rows": _is_count,
    "bybit_funding_explained": _is_one_of(_FUNDING_EXPLANATIONS),
    "bybit_transfers_cause": _is_one_of(_BYBIT_TRANSFERS_CAUSES),
    "truncated_site": _is_one_of(_TRUNCATED_SITES),
    "last_window_age_bucket": _is_one_of(_WINDOW_AGE_BUCKETS),
    "last_window_calls": _is_count,
    "read_elapsed_s": _is_count,
    "anchor_diagnostic": _is_one_of(("not-run", "run", "failed")),
    "diagnostic_failure_class": _is_one_of(_FAILURE_CLASSES),
    "diagnostic_members": _is_count,
    "advisory_arm": _is_one_of(("not-run", "implausible", "not-implausible")),
    "replay_final_sign": _is_one_of(("absent", "positive", "zero", "negative")),
    "anchor_over_replay": _is_ratio,
    # The probe reports that the oracle measured an opening or could not; whether the
    # measurement AGREES with the implied opening is decided later, against a tolerance
    # chosen from this very reading, so "agree" is deliberately not a token here.
    "opening_check": _is_one_of(("not-run", "measured", "unavailable")),
    "opening_unavailable_reason": _is_one_of(_OPENING_REASON_TOKENS),
    "implied_opening_over_anchor": _is_ratio,
    "bills_opening_over_anchor": _is_ratio,
    "opening_residual_over_anchor": _is_ratio,
    # "Not measured" is `field-absent` for every reading below, never 0 or False.
    "non_stable_share": _is_ratio,
    "upl_over_anchor": _is_ratio,
    "bot_equity_share": _is_ratio,
    "bal_over_cashbal": _is_ratio,
    "bills_transfer_net_over_anchor": _is_ratio,
    "flip_from_flat_closes": _is_count_or_absent,
    "hedge_mode_fills": _is_count_or_absent,
    "negative_qty_assets": _is_count_or_absent,
    "flow_events_in_window": _is_count_or_absent,
    "skipped_symbols_count": _is_count_or_absent,
    "bills_read": _is_count_or_absent,
    "blank_inst_type_bills": _is_count_or_absent,
    "negative_stable_cash": _is_bool_or_absent,
    "breakdown_truncated": _is_bool_or_absent,
    "opening_day_is_window_start": _is_bool_or_absent,
    "bybit_evidence_members": _is_count,
    **bybit_funding_record.FUNDING_VALIDATORS,
    **okx_chain_record.CHAIN_VALIDATORS,
}

_SUMMARY_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "record": _is_one_of(("summary",)),
    "run_date": _is_str_matching(_DATE_RE),
    "accounts": _is_count,
    "accounts_read": _is_count,
    "accounts_comparable": _is_count,
    "accounts_trades_beyond_first_page": _is_count,
    "accounts_differing": _is_count,
    "trades_read": _is_count,
    "days_compared": _is_count,
    "okx_order_violations": _is_count,
    "okx_passes_ended_full": _is_count,
    "okx_order_readings": _is_count,
    "okx_members_with_trades": _is_count,
    "okx_order_gate": _is_one_of(_OKX_ORDER_GATES),
    "bybit_accounts_applicable": _is_count,
    "bybit_transfers_gate": _is_one_of(("ok", "unmeasured")),
}


def _check_keys(path: str, got: Mapping[str, Any], want: Sequence[str]) -> None:
    extra = sorted(set(got) - set(want))
    missing = sorted(set(want) - set(got))
    if extra or missing:
        raise ValueError(f"{path}: keys differ from the whitelist extra={extra} missing={missing}")


def validate_record(record: Mapping[str, Any]) -> None:
    """Raise ``ValueError`` unless ``record`` is exactly the declared vocabulary.

    The message names the PATH of the offending entry and never its value: an
    unredacted amount must not leak through its own rejection."""
    if not isinstance(record, Mapping):
        raise ValueError("record: not a mapping")
    kind = record.get("record")
    if kind == "account":
        want, validators = ACCOUNT_RECORD_KEYS, _ACCOUNT_VALIDATORS
    elif kind == "summary":
        want, validators = SUMMARY_RECORD_KEYS, _SUMMARY_VALIDATORS
    else:
        raise ValueError("record.record: value outside the declared vocabulary")
    _check_keys("record", record, want)
    for key, check in validators.items():
        if not check(record[key]):
            raise ValueError(f"record.{key}: value outside the declared vocabulary")
    assert_sanitized(dict(record))


def emit_record(record: Mapping[str, Any]) -> str:
    """The ONLY path to stdout: validate, then serialize one compact JSON line."""
    validate_record(record)
    return json.dumps(record, sort_keys=True, separators=(",", ":"), allow_nan=False)


# ---------------------------------------------------------------------------
# Read-only database handle.
# ---------------------------------------------------------------------------


class _ReadOnlyTable:
    """A table handle that can select and nothing else."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner

    def select(self, *args: Any, **kwargs: Any) -> Any:
        return self._inner.select(*args, **kwargs)

    def __getattr__(self, name: str) -> Any:
        raise AttributeError(name)


class ReadOnlySupabase:
    """A database client for the probe that cannot write.

    ``table(name)`` hands out a handle exposing ``select`` only; every other attribute of
    the client or of a table handle, ``rpc`` included, is an ``AttributeError``. It is
    passed to the rebuild's own read, whose only write (the price cache on a BadSymbol
    fallback) then fails inside its own caught exception instead of reaching PROD."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner

    def table(self, name: str) -> _ReadOnlyTable:
        return _ReadOnlyTable(self._inner.table(name))

    def __getattr__(self, name: str) -> Any:
        raise AttributeError(name)


# ---------------------------------------------------------------------------
# Pure layer: what the recorded calls, the raw OKX answer and the two curves say.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Call:
    """One recorded ``fetch_my_trades`` call. Ids and timestamps stay in memory."""

    since: int | None
    params: dict[str, Any]
    rows: int
    ids: tuple[tuple[Any, str], ...]
    rows_without_id: int
    oldest_ts: int | None
    newest_ts: int | None = None
    cursor_repeated: bool = False


def _as_int(raw: Any) -> int | None:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw
    if isinstance(raw, float) and raw == raw and abs(raw) != float("inf"):
        return int(raw)
    return None


def _as_ms(raw: Any) -> int | None:
    """A venue millisecond stamp: an int that is not a bool, or a string of ASCII digits, as an
    int. Anything else is None (a stamp is never invented)."""
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str) and raw.isascii() and raw.isdigit():
        return int(raw)
    return None


def _log_rows(answer: Any) -> list[Any] | None:
    """The entries of a Unified transaction-log answer (``result.list``), or None when the answer
    is not that shape. Entries are handed back unfiltered: the caller counts a non-object as
    malformed, as the rebuild's reader refuses it."""
    if not isinstance(answer, dict):
        return None
    result = answer.get("result")
    if not isinstance(result, dict):
        return None
    listed = result.get("list")
    if not isinstance(listed, list):
        return None
    return listed


def _reader_accepts_unified_row(requested: str, row: Any) -> bool:
    """Whether the rebuild's Unified reader would accept this log row (``normalise_unified_flow_row``
    in the rebuild's ``bybit_unified_flows`` module): an object of the requested type, a usable id (a str or an
    int that is not a bool, never ``""``), a usable ``transactionTime``, a non-empty currency, and a
    finite ``change`` (else ``cashFlow``). Mirrored here, not imported: the probe must run against an
    older deployed tree that lacks that module; ``test_the_probes_unified_row_check_agrees_with_the_readers``
    pins the two together."""
    if not isinstance(row, Mapping) or row.get("type") != requested:
        return False
    row_id = row.get("id")
    if isinstance(row_id, bool) or not isinstance(row_id, (str, int)) or row_id == "":
        return False
    if _as_ms(row.get("transactionTime")) is None:
        return False
    currency = row.get("currency")
    if not isinstance(currency, str) or not currency:
        return False
    for field_name in ("change", "cashFlow"):
        raw = row.get(field_name)
        if raw is None or raw == "":
            continue
        if isinstance(raw, bool):
            return False
        try:
            return math.isfinite(float(raw))
        except (TypeError, ValueError):
            return False
    return False


def _sign_contradicts(kind: str, row: Mapping[str, Any]) -> bool:
    """Whether a Unified flow row's sign contradicts the type it was requested under. The sign of
    a ``TRANSFER_IN`` / ``TRANSFER_OUT`` row is not documented (RESEARCH A2), so direction always
    comes from the requested type and a contradiction is only COUNTED, as evidence. Reads
    ``change``, else ``cashFlow`` (``""``, None and a non-finite value are absent), never
    ``funding``."""
    value = _num(row.get("change"))
    if value is None:
        value = _num(row.get("cashFlow"))
    if value is None:
        return False
    return value < 0 if kind == "deposits" else value > 0


def _page_cursor(rows: Sequence[Mapping[str, Any]]) -> str | None:
    """The Bybit ``nextPageCursor`` left on a row's ``info``, read as the rebuild reads it. Only
    compared with the cursor the call was sent; the text is never stored."""
    for row in rows:
        info = row.get("info")
        if isinstance(info, Mapping) and info.get("nextPageCursor"):
            return str(info["nextPageCursor"])
    return None


def _describe_call(args: tuple[Any, ...], kwargs: Mapping[str, Any], page: Any) -> _Call:
    since = args[1] if len(args) > 1 else kwargs.get("since")
    params = args[3] if len(args) > 3 else kwargs.get("params")
    rows = [t for t in (page or []) if isinstance(t, Mapping)]
    ids = tuple((t.get("symbol"), str(t["id"])) for t in rows if t.get("id") is not None)
    stamps = [s for s in (_as_int(t.get("timestamp")) for t in rows) if s is not None]
    sent = params.get("cursor") if isinstance(params, Mapping) else None
    returned = _page_cursor(rows)
    return _Call(
        since=_as_int(since),
        params=dict(params) if isinstance(params, Mapping) else {},
        rows=len(rows),
        ids=ids,
        rows_without_id=sum(1 for t in rows if t.get("id") is None),
        oldest_ts=min(stamps) if stamps else None,
        newest_ts=max(stamps) if stamps else None,
        cursor_repeated=returned is not None and sent is not None and returned == str(sent),
    )


class _TradeRecorder:
    """Wraps a client's ``fetch_my_trades`` so every call is recorded, in memory only,
    and the answer is handed back unchanged."""

    def __init__(self, client: Any) -> None:
        self.calls: list[_Call] = []
        # The fills themselves, in memory only: the anchor diagnostic reads fill-level facts
        # (sides, realised pnl) that the per-call summary above deliberately drops.
        self.trades: list[Mapping[str, Any]] = []
        original = client.fetch_my_trades

        async def _recorded(*args: Any, **kwargs: Any) -> Any:
            page = await original(*args, **kwargs)
            self.calls.append(_describe_call(args, kwargs, page))
            self.trades.extend(t for t in (page or []) if isinstance(t, Mapping))
            return page

        client.fetch_my_trades = _recorded

        # The rebuild's own transfer read, recorded the same way: (kind, id, timestamp).
        self.transfers: list[tuple[str, Any, int | None]] = []
        for kind, name in (("deposits", "fetch_deposits"), ("withdrawals", "fetch_withdrawals")):
            fetcher = getattr(client, name, None)
            if fetcher is not None:
                setattr(client, name, self._recording_transfers(kind, fetcher))

        # D-01 (Phase 180): the rebuild's Bybit flow read is the Unified transaction log, recorded
        # into the SAME per-kind list, plus a list of its own so the account record can say how
        # many rows the Unified edge alone gave.
        self.unified: list[tuple[str, Any, int | None]] = []
        self.unified_calls = 0
        self.unified_failure = "none"
        self.unified_malformed = 0
        self.unified_sign_mismatch = 0
        self._unified_seen: set[tuple[str, str]] = set()
        log_fetcher = getattr(client, "private_get_v5_account_transaction_log", None)
        if log_fetcher is not None:
            client.private_get_v5_account_transaction_log = self._recording_unified_log(log_fetcher)

    def unified_state(self) -> str:
        """What the Unified flow read did: ``not-run`` when it was never asked, the first failure
        class it raised, ``malformed`` when an answer or a row could not be read, else ``read``."""
        if self.unified_calls == 0:
            return "not-run"
        if self.unified_failure != "none":
            return self.unified_failure
        if self.unified_malformed > 0:
            return "malformed"
        return "read"

    def _recording_unified_log(self, fetcher: Any) -> Callable[..., Any]:
        async def _recorded_log(*args: Any, **kwargs: Any) -> Any:
            params = args[0] if args else kwargs.get("params")
            requested = params.get("type") if isinstance(params, Mapping) else None
            kind = _UNIFIED_FLOW_KINDS.get(requested) if isinstance(requested, str) else None
            if kind is None or not isinstance(requested, str) or not isinstance(params, Mapping):
                # Not a flow (the Earn census, a funding settlement read): answered, never recorded.
                return await fetcher(*args, **kwargs)
            self.unified_calls += 1
            try:
                answer = await fetcher(*args, **kwargs)
            except asyncio.CancelledError:
                # The crawl bound cancels the read mid-call: the flows it holds are partial. The
                # bound is the only canceller, so the state reads as the timeout it is.
                if self.unified_failure == "none":
                    self.unified_failure = classify_failure(TimeoutError())
                raise
            except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
                if self.unified_failure == "none":
                    self.unified_failure = classify_failure(exc)
                raise  # the same exception object: the recorder never changes what the rebuild sees
            listed = _log_rows(answer)
            if listed is None:
                self.unified_malformed += 1
                return answer
            # Count what the rebuild's reader would accept, once per (type, id) as its replay does.
            # A row it would refuse, or a cursor it would refuse, is malformed and counts nothing.
            for row in listed:
                if not _reader_accepts_unified_row(requested, row):
                    self.unified_malformed += 1
                    continue
                key = (kind, str(row["id"]))
                if key in self._unified_seen:
                    continue
                self._unified_seen.add(key)
                entry = (kind, row["id"], _as_ms(row.get("transactionTime")))
                self.transfers.append(entry)
                self.unified.append(entry)
                if _sign_contradicts(kind, row):
                    self.unified_sign_mismatch += 1
            next_cursor = answer["result"].get("nextPageCursor")
            sent = params.get("cursor")
            if (next_cursor is not None and not isinstance(next_cursor, str)) or (
                listed and next_cursor and next_cursor == sent
            ):
                self.unified_malformed += 1
            return answer

        return _recorded_log

    def _recording_transfers(self, kind: str, fetcher: Any) -> Callable[..., Any]:
        async def _recorded_transfers(*args: Any, **kwargs: Any) -> Any:
            page = await fetcher(*args, **kwargs)
            for row in page or []:
                if isinstance(row, Mapping):
                    self.transfers.append((kind, row.get("id"), _as_int(row.get("timestamp"))))
            return page

        return _recorded_transfers


def trades_read(calls: Sequence[_Call]) -> int:
    """Distinct (symbol, id) fills across the calls; a row without an id counts once each.
    The key carries the symbol because OKX numbers ``tradeId`` per instrument."""
    seen: set[tuple[Any, str]] = set()
    no_id = 0
    for call in calls:
        seen |= set(call.ids)
        no_id += call.rows_without_id
    return len(seen) + no_id


def transfers_older_than(transfers: Sequence[tuple[str, Any, int | None]], cutoff_ms: int) -> int:
    """Distinct transfer events stamped before ``cutoff_ms``: a (kind, id) pair counts once
    however many overlapping windows returned it; an event without an id counts each time."""
    seen: set[tuple[str, str]] = set()
    no_id = 0
    for kind, transfer_id, stamp in transfers:
        if stamp is None or stamp >= cutoff_ms:
            continue
        if transfer_id is None:
            no_id += 1
        else:
            seen.add((kind, str(transfer_id)))
    return len(seen) + no_id


def transfers_of_kind(
    transfers: Sequence[tuple[str, Any, int | None]], kind: str
) -> list[tuple[str, Any, int | None]]:
    """The recorded transfers of one kind (``"deposits"`` or ``"withdrawals"``, the recorder's
    own literals)."""
    return [t for t in transfers if t[0] == kind]


def oldest_fill_ms(calls: Sequence[_Call]) -> int | None:
    """The oldest fill timestamp across the calls, else None when no call returned a stamped row."""
    stamps = [c.oldest_ts for c in calls if c.oldest_ts is not None]
    return min(stamps) if stamps else None


def oldest_transfer_ms(transfers: Sequence[tuple[str, Any, int | None]], kind: str) -> int | None:
    """The oldest timestamp among the recorded transfers of one kind, else None."""
    stamps = [stamp for _kind, _id, stamp in transfers_of_kind(transfers, kind) if stamp is not None]
    return min(stamps) if stamps else None


def _oldest_of(stamps: Iterable[int | None]) -> int | None:
    present = [s for s in stamps if s is not None]
    return min(present) if present else None


def _fill_before(fill_ms: int | None, transfer_ms: int | None) -> bool | str:
    """Whether the oldest fill is older than the oldest transfer: ordering only, never a stamp.
    ``field-absent`` when either side has no timestamp."""
    if fill_ms is None or transfer_ms is None:
        return FIELD_ABSENT
    return fill_ms < transfer_ms


def _passes(calls: Sequence[_Call]) -> dict[Any, list[_Call]]:
    """The calls grouped by the ``type`` param (an OKX instrument-type pass), in order."""
    grouped: dict[Any, list[_Call]] = {}
    for call in calls:
        grouped.setdefault(call.params.get("type"), []).append(call)
    return grouped


def first_page_rows(venue: str, calls: Sequence[_Call]) -> int:
    """What the old loop kept. Bybit: the rows of the first call. OKX: the rows of each
    pass's first call (the call without ``until``, else the pass's first), summed."""
    if venue != "okx":
        return calls[0].rows if calls else 0
    total = 0
    for pass_calls in _passes(calls).values():
        first = next((c for c in pass_calls if "until" not in c.params), pass_calls[0])
        total += first.rows
    return total


def okx_passes_ended_full(calls: Sequence[_Call]) -> int:
    """OKX passes whose last call returned a full page while its oldest row is still newer
    than that call's ``since``: the walk stopped with the window start unreached."""
    count = 0
    for pass_calls in _passes(calls).values():
        last = pass_calls[-1]
        if (
            last.rows >= _OKX_PAGE_ROWS
            and last.oldest_ts is not None
            and last.since is not None
            and last.oldest_ts > last.since
        ):
            count += 1
    return count


def window_age_bucket(since_ms: int | None, run_day: date) -> str:
    """The closed age bucket of a window start: whole days from ``since_ms`` to the run day's
    UTC midnight. ``None`` (no start known) is "none"."""
    if since_ms is None:
        return "none"
    days = max(0, (_day_ms(run_day) - since_ms) // 86_400_000)
    for upper, token in ((30, "0-29"), (90, "30-89"), (180, "90-179"), (365, "180-364")):
        if days < upper:
            return token
    if days < 547:
        return "365-546"
    return "547-729" if days < 730 else "730+"


def last_window_calls(calls: Sequence[_Call]) -> int:
    """How many trailing calls share the last call's ``since``: one Bybit window is read with
    the same start on every call, so this is the call count of the window the read stopped in."""
    if not calls:
        return 0
    count = 0
    for call in reversed(calls):
        if call.since != calls[-1].since:
            break
        count += 1
    return count


def derive_truncated_site(venue: str, calls: Sequence[_Call]) -> str:
    """Which limit stopped a Bybit read, told from the call log alone (the code deployed before
    Phase 171 carries no typed site). The stall is tested first because the deployed read tests
    it before its page-ceiling branch, so a 100th call that stalls is the stall. A full last page
    is a stall when it added no fill an earlier call had not already returned (the deployed
    ``seen`` set spans the whole read) or returned the cursor it was sent. Anything the log
    cannot tell is "unknown"."""
    if venue != "bybit":
        return "unknown"
    window = list(calls)[len(calls) - last_window_calls(calls) :]
    if not window:
        return "unknown"
    last = window[-1]
    if last.rows >= _BYBIT_PAGE_ROWS:
        earlier: set[tuple[Any, str]] = set()
        for call in calls[:-1]:
            earlier |= set(call.ids)
        added = last.rows_without_id > 0 or any(i not in earlier for i in last.ids)
        if not added or last.cursor_repeated:
            return "bybit_stalled_one_ms" if last.oldest_ts == last.newest_ts else "bybit_stalled_page"
    if len(window) == er._BYBIT_WINDOW_PAGE_CEILING:
        return "bybit_window_ceiling"
    return "unknown"


def truncated_site_of(exc: BaseException, venue: str, calls: Sequence[_Call]) -> str:
    """The typed ``site`` the rebuild put on the exception when it carries one, else the site
    derived from the call log. A typed site outside the declared tokens is "unknown": vocabulary
    drift must not be mapped onto a derived answer."""
    typed = getattr(exc, "site", None)
    if isinstance(typed, str):
        return typed if typed in _TRUNCATED_SITES else "unknown"
    return derive_truncated_site(venue, calls)


def missing_deployed_names() -> list[str]:
    """The ``DEPLOYED_ER_NAMES`` the rebuild module this probe runs against does not define."""
    return [name for name in DEPLOYED_ER_NAMES if not hasattr(er, name)]


def _row_inst_types(calls: Sequence[_Call]) -> list[str]:
    """Every instrument type (upper-cased, in the order the forced pass met them) whose pass
    returned at least two rows, except a type that cannot show an order: one whose rows share ONE
    millisecond AND fit on one short page (fewer rows than the OKX page size). The walk reads such
    a type in full whatever the order, so it owes the member no reading. A multi-page type, or one
    whose rows carry no timestamp, is still read, and fails shut through ``_okx_order_reading``'s
    reach check (CONTEXT: every type that returned at least two rows)."""
    types: list[str] = []
    for kind, pass_calls in _passes(calls).items():
        rows = sum(c.rows for c in pass_calls)
        stamps = [s for c in pass_calls for s in (c.newest_ts, c.oldest_ts) if s is not None]
        one_ms_short_page = rows < _OKX_PAGE_ROWS and bool(stamps) and max(stamps) == min(stamps)
        if isinstance(kind, str) and rows >= 2 and not one_ms_short_page and kind.upper() not in types:
            types.append(kind.upper())
    return types


def okx_newest_first(raw: Any) -> bool | str:
    """Does an OKX fills-history answer list its rows newest first?

    ``True`` when the ``ts`` values never increase and the first is later than the last,
    ``False`` when they rise anywhere, and ``field-absent`` when the answer cannot say:
    not a mapping, no ``data`` list, fewer than two rows, a ``ts`` that is not a number,
    or equal timestamps throughout."""
    data = raw.get("data") if isinstance(raw, Mapping) else None
    if not isinstance(data, list) or len(data) < 2:
        return FIELD_ABSENT
    stamps: list[int] = []
    for row in data:
        value = row.get("ts") if isinstance(row, Mapping) else None
        if isinstance(value, bool) or not isinstance(value, (str, int)):
            return FIELD_ABSENT
        try:
            stamps.append(int(value))
        except ValueError:
            return FIELD_ABSENT
    if all(s == stamps[0] for s in stamps):
        return FIELD_ABSENT
    if any(later > earlier for earlier, later in zip(stamps, stamps[1:])):
        return False
    return True


def _pass_newest_ms(calls: Sequence[_Call], inst_type: str) -> int | None:
    """The newest fill (ms) the forced pass read on this instrument type (upper-cased), or
    ``None`` when none of that pass's calls carried a timestamp."""
    stamps = [
        c.newest_ts
        for kind, pass_calls in _passes(calls).items()
        if isinstance(kind, str) and kind.upper() == inst_type
        for c in pass_calls
        if c.newest_ts is not None
    ]
    return max(stamps) if stamps else None


def okx_order_verdict(
    violations: int, ended_full: int, readings: int, members_with_trades: int
) -> str:
    """The OKX ordering gate, derived in code (Phase 173 D-01): ``violated``, ``ok`` or
    ``unmeasured``.

    ``violated`` when any reading found OKX answering oldest first or any pass stopped on a
    full page, and it is tested FIRST: a violation outranks an otherwise complete set of
    readings. ``ok`` only when at least one OKX member read trades and EVERY such member
    carries a reading. This is stricter than the TRADEPAGES plan 06 wording (every account
    whose OKX read went past one page carries at least one reading), so whenever it says ``ok``
    that wording holds too. Absent evidence is never ``ok``: no OKX member with trades, or a
    member whose answer could not say, is ``unmeasured``."""
    if violations > 0 or ended_full > 0:
        return "violated"
    if members_with_trades >= 1 and readings == members_with_trades:
        return "ok"
    return "unmeasured"


def bybit_transfers_verdict(
    bybit_members: int, window_days: int, deposits_old: int, withdrawals_old: int
) -> str:
    """The Bybit transfer-depth gate, derived in code (Phase 173 D-02): ``not-applicable``,
    ``ok`` or ``unmeasured``.

    ``not-applicable`` unless the account holds a Bybit member and its window is the rebuild's
    full Bybit window (``BYBIT_TRADE_TERMINUS_DAYS``). ``ok`` only when BOTH per-kind counts of
    events older than 365 days are at least 1; a 0 for either kind keeps the gate shut, and the
    pooled count never decides it (TRADEPAGES REVIEW-3 WR-07). Corroboration never opens it.
    An account holding any OKX member has a 90-day window (``_account_rebuild_window``), so
    whenever the gate applies its counts are Bybit members' counts."""
    if bybit_members < 1 or window_days != er.BYBIT_TRADE_TERMINUS_DAYS:
        return "not-applicable"
    if deposits_old >= 1 and withdrawals_old >= 1:
        return "ok"
    return "unmeasured"


def bybit_transfers_cause(
    gate: str,
    unified_state: str,
    member_refusal: str,
    failure_class: str,
    trade_calls: int,
    deposits_old: int,
    withdrawals_old: int,
) -> str:
    """Why the Bybit transfer-depth gate reads as it does (D-03), one closed token, derived in code.

    ``not-applicable`` when the gate is; ``none`` when it is ``ok``. For a shut gate, in this order:
    ``flow_source_unreadable`` when the rebuild refused the flow source
    (``_FLOW_SOURCE_REFUSAL``), the Unified answer was malformed, or the read failed with a
    permanent class (the key or the request cannot get past it); ``read_incomplete`` when the
    Unified read never ran or failed with any other class (a transient or unclassified fault a retry
    may clear, so never reported as an unreadable source), or when the member failed before any
    trade call (the rebuild reads the Bybit flows BEFORE the trades, so a member that made a trade
    call finished its flow read and its per-kind counts are a measurement); otherwise the per-kind
    counts name what is missing. The cause explains a shut gate and never opens one."""
    if gate == "not-applicable":
        return "not-applicable"
    if gate == "ok":
        return "none"
    if (
        member_refusal == _FLOW_SOURCE_REFUSAL
        or unified_state == "malformed"
        or unified_state in _PERMANENT_UNIFIED_STATES
    ):
        return "flow_source_unreadable"
    if unified_state != "read" or (failure_class != "none" and trade_calls == 0):
        return "read_incomplete"
    if deposits_old == 0 and withdrawals_old == 0:
        return "neither_older_365d"
    if deposits_old == 0:
        return "no_deposit_older_365d"
    return "no_withdrawal_older_365d"


def account_unified_state(states: Sequence[str]) -> str:
    """One account's Unified flow-read state from its Bybit members' states, in key order: the
    first that is neither ``read`` nor ``not-run`` (a failure or a malformed answer outranks a
    clean read), else ``read`` when any member read, else ``not-run``."""
    for state in states:
        if state not in ("read", "not-run"):
            return state
    return "read" if "read" in states else "not-run"


def bybit_funding_explained(
    bybit_members: int,
    unified_state: str,
    unified_in_rows: int,
    trades_read: int,
    evidences: Sequence[Mapping[str, Any]],
) -> str:
    """Whether a Bybit account's funding is explained (SC-1), derived in code, one closed token.
    ``evidences`` is every Bybit member's funding evidence and ``trades_read`` counts the Bybit
    members' trades only.

    ``not-applicable`` without a Bybit member. ``explained`` when the Unified edge shows at least
    one ``TRANSFER_IN`` row, whatever the Unified state. ``off_edge`` when no Unified in-row exists
    but an inflow evidence source of ANY member shows money arriving: RESEARCH Pitfall 2's
    disagreement between the evidence and the edge, and a reason to hold a rebuild. ``unexplained``
    is SC-1's "a source still unnamed": the Unified edge was read, trades were read, EVERY Bybit
    member's evidence was taken and every inflow source was read (or is master-only and was not
    asked), and none shows a funding row. Anything else, a Unified edge never read, no trades, a
    member whose evidence was never taken, an evidence source that failed or never ran, is
    ``unmeasured``.
    The explanation feeds no gate."""
    if bybit_members < 1:
        return "not-applicable"
    if unified_in_rows >= 1:
        return "explained"
    names = bybit_funding_record.INFLOW_SOURCE_NAMES
    for evidence in evidences:
        for name in names:
            rows = evidence.get(f"bybit_{name}_rows")
            if isinstance(rows, int) and not isinstance(rows, bool) and rows >= 1:
                return "off_edge"
    if (
        unified_state == "read"
        and trades_read >= 1
        and len(evidences) == bybit_members
        and all(
            evidence.get(f"bybit_{name}_state") in ("read", "not-master")
            for evidence in evidences
            for name in names
        )
    ):
        return "unexplained"
    return "unmeasured"


def compare_days(
    stored: Mapping[str, float], rebuilt: Mapping[str, float]
) -> tuple[int, int, float | str]:
    """(days in both, days that differ, largest relative difference to 3 figures).

    A day differs when the two sums are further apart than ``_DIFF_THRESHOLD``. The
    relative difference is taken against the stored value over the days whose stored
    value is not 0; with no such day it reads ``field-absent``, never 0."""
    common = sorted(set(stored) & set(rebuilt))
    differing = 0
    largest: float | None = None
    for day in common:
        diff = abs(rebuilt[day] - stored[day])
        if diff > _DIFF_THRESHOLD:
            differing += 1
        if stored[day] != 0:
            rel = diff / abs(stored[day])
            largest = rel if largest is None or rel > largest else largest
    ratio: float | str = FIELD_ABSENT
    if largest is not None:
        shown = sig3(largest)
        ratio = shown if isinstance(shown, float) else FIELD_ABSENT
    return len(common), differing, ratio


def _num(raw: Any) -> float | None:
    """A finite float from a venue number (a str, int or float), else None. A bool, NaN,
    inf, an empty string and any other type are not numbers here."""
    if isinstance(raw, bool) or not isinstance(raw, (str, int, float)):
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def ratio_or_absent(numerator: float | None, denominator: float | None) -> float | str:
    """``numerator / denominator`` to three significant figures, or ``field-absent``.

    Absent when either side is unread, the denominator is 0, or the quotient is not finite
    (``sig3`` says ``non-finite`` for inf and NaN, which ``_is_ratio`` rejects). Every
    ratio the anchor diagnostic prints goes through here, so a ratio against a zero
    anchor can never reach stdout as an unrounded or non-finite figure."""
    if numerator is None or denominator is None or denominator == 0:
        return FIELD_ABSENT
    shown = sig3(numerator / denominator)
    return shown + 0.0 if isinstance(shown, float) else FIELD_ABSENT  # + 0.0: never "-0.0"


def replay_sign(value: float | None) -> str:
    """The sign of the replay's final value; ``absent`` when it was not recovered."""
    if value is None:
        return "absent"
    if value > 0:
        return "positive"
    return "negative" if value < 0 else "zero"


def balance_row_readings(row: Mapping[str, Any] | None) -> dict[str, Any]:
    """Three ratios against today's equity, read off one raw OKX balance row.

    * ``non_stable_share``: the ``eqUsd`` of every currency outside ``STABLECOINS``, over
      ``totalEq``. Assumes ``eqUsd`` is the currency's whole equity in USD (RESEARCH A1).
    * ``upl_over_anchor``: the account-level ``upl`` over ``totalEq``. A simple-mode account
      carries no account ``upl`` (an empty string), which reads as unknown, not 0.
    * ``bot_equity_share``: the strategy-bot part of each currency, ``stgyEq / eq`` of its
      ``eqUsd``, summed over ``totalEq``. A bot's equity leaves the cash balance the bills
      oracle reads, so this sizes one thing the oracle cannot see (RESEARCH A5).

    Any field a reading needs that is not a finite number makes THAT reading
    ``field-absent``; none is ever filled with 0. A non-positive ``totalEq`` reads all three
    as absent."""
    absent: dict[str, Any] = {
        name: FIELD_ABSENT for name in ("non_stable_share", "upl_over_anchor", "bot_equity_share")
    }
    if row is None:
        return absent
    total = _num(row.get("totalEq"))
    if total is None or total <= 0:
        return absent
    out = dict(absent)
    out["upl_over_anchor"] = ratio_or_absent(_num(row.get("upl")), total)
    details = row.get("details")
    if not isinstance(details, list) or not all(isinstance(d, Mapping) for d in details):
        return out
    non_stable_usd = 0.0
    non_stable_read = True
    for detail in details:
        ccy = detail.get("ccy")
        usd = _num(detail.get("eqUsd"))
        if not isinstance(ccy, str) or (ccy not in STABLECOINS and usd is None):
            non_stable_read = False
            break
        if ccy not in STABLECOINS and usd is not None:
            non_stable_usd += usd
    out["non_stable_share"] = ratio_or_absent(non_stable_usd if non_stable_read else None, total)
    bot_usd = 0.0
    bot_read = True
    for detail in details:
        eq, stgy, usd = _num(detail.get("eq")), _num(detail.get("stgyEq")), _num(detail.get("eqUsd"))
        if eq is None or stgy is None or usd is None:
            bot_read = False
            break
        if eq != 0:
            bot_usd += stgy * usd / eq
    out["bot_equity_share"] = ratio_or_absent(bot_usd if bot_read else None, total)
    return out


def _usdt_cash_balance(row: Mapping[str, Any] | None) -> float | None:
    """Today's USDT ``cashBal`` from a balance row, else None."""
    details = row.get("details") if row is not None else None
    for detail in details if isinstance(details, list) else []:
        if isinstance(detail, Mapping) and detail.get("ccy") == "USDT":
            return _num(detail.get("cashBal"))
    return None


def _unique_fills(trades: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """The fills once each, in time order. A fill is keyed on (symbol, id), as ``trades_read``
    does, so an overlapping page cannot count a fill twice; a fill with no id is kept as is."""
    seen: set[tuple[Any, str]] = set()
    kept: list[Mapping[str, Any]] = []
    for trade in trades:
        if trade.get("id") is not None:
            key = (trade.get("symbol"), str(trade["id"]))
            if key in seen:
                continue
            seen.add(key)
        kept.append(trade)
    return sorted(kept, key=lambda t: (_as_int(t.get("timestamp")) or 0, str(t.get("id"))))


def _info(trade: Mapping[str, Any]) -> Mapping[str, Any]:
    info = trade.get("info")
    return info if isinstance(info, Mapping) else {}


def flip_from_flat_closes(trades: Sequence[Mapping[str, Any]]) -> int | str:
    """Fills that realise pnl while the replay's own position in that instrument is flat.

    The replay keeps one signed size per instrument from the fills it reads. A fill that
    realises a nonzero ``info.fillPnl`` while that size is flat closes a position opened
    BEFORE the window, which the replay never held: one way its level goes missing. Such a
    fill is counted and leaves the in-window size flat (it closed something the replay never
    opened); every other fill moves the size by its signed amount.

    A LOWER BOUND: a pre-window position closed after an in-window fill of the same
    instrument has already moved the size looks like an ordinary close and is missed, and a
    hedge-mode account's two legs share one size here. ``field-absent`` when no fill carries
    a readable ``info.fillPnl`` (OKX's field name is RESEARCH A6), never 0."""
    fills = _unique_fills(trades)
    if not any(_num(_info(t).get("fillPnl")) is not None for t in fills):
        return FIELD_ABSENT
    sizes: dict[Any, float] = {}
    count = 0
    for trade in fills:
        symbol = trade.get("symbol")
        size = sizes.get(symbol, 0.0)
        pnl = _num(_info(trade).get("fillPnl"))
        if pnl is not None and pnl != 0 and abs(size) <= 1e-12:
            count += 1
            continue
        amount = _num(trade.get("amount"))
        if amount is None:
            continue
        if trade.get("side") == "buy":
            sizes[symbol] = size + amount
        elif trade.get("side") == "sell":
            sizes[symbol] = size - amount
    return count


def hedge_mode_fills(trades: Sequence[Mapping[str, Any]]) -> int | str:
    """Fills on a hedge-mode leg (``info.posSide`` long or short). ``field-absent`` when no
    fill carries a ``posSide`` at all, so a venue that does not say is not read as one-way."""
    sides = [_info(t).get("posSide") for t in _unique_fills(trades)]
    if not any(isinstance(side, str) and side for side in sides):
        return FIELD_ABSENT
    return sum(1 for side in sides if side in ("long", "short"))


def breakdown_readings(breakdown: Mapping[str, Any] | None) -> dict[str, Any]:
    """Facts about the replay's last row, read from its per-asset breakdown.

    ``negative_qty_assets``: assets outside ``STABLECOINS`` with a negative value (a sale the
    replay holds no purchase for). Perp keys (``...:PERP``) and the protected keys
    (``STARTING_BALANCE`` and the like) are not assets. ``negative_stable_cash``: any
    stablecoin negative (an unfunded buy). ``breakdown_truncated``: the breakdown was capped,
    so the count above is a lower bound. All ``field-absent`` for a missing breakdown."""
    if not isinstance(breakdown, Mapping):
        return {
            "negative_qty_assets": FIELD_ABSENT,
            "negative_stable_cash": FIELD_ABSENT,
            "breakdown_truncated": FIELD_ABSENT,
        }
    negative_assets = 0
    negative_stable = False
    for key, value in breakdown.items():
        if not isinstance(key, str) or key.endswith(":PERP") or key in er._BREAKDOWN_PROTECTED_KEYS:
            continue
        amount = _num(value)
        if amount is None or amount >= 0:
            continue
        if key in STABLECOINS:
            negative_stable = True
        else:
            negative_assets += 1
    return {
        "negative_qty_assets": negative_assets,
        "negative_stable_cash": negative_stable,
        "breakdown_truncated": breakdown.get("__truncated__") is True,
    }


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


def _day_ms(day: date) -> int:
    return int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp() * 1000)


# ---------------------------------------------------------------------------
# I/O layer. Select reads and venue GETs only.
# ---------------------------------------------------------------------------


@dataclass
class _MemberResult:
    read: bool
    failure_class: str = "none"
    refusal: str = "none"
    rows: list[dict[str, Any]] = field(default_factory=list)
    calls: list[_Call] = field(default_factory=list)
    transfers: list[tuple[str, Any, int | None]] = field(default_factory=list)
    order: bool | str | None = None  # None: no raw ordering read was made
    order_failure_class: str = "none"  # the allow-listed class of a raw ordering read that raised
    truncated_site: str = "none"
    last_window_age_bucket: str = "none"
    last_window_calls: int = 0
    elapsed_s: int = 0
    diagnostic: dict[str, Any] | None = None  # the anchor diagnostic's record keys, when run
    funding: dict[str, Any] | None = None  # the Bybit funding evidence's record keys, when taken
    unified: list[tuple[str, Any, int | None]] = field(default_factory=list)  # the Unified-edge flows
    unified_state: str = "not-run"
    unified_sign_mismatch: int = 0


async def _okx_order_reading(
    client: Any, venue: str, calls: Sequence[_Call], window_start: date, end_date: date
) -> tuple[bool | str | None, str]:
    """One raw OKX fills-history read on EVERY instrument type the forced pass read at least two
    rows on (``_row_inst_types``: a type whose rows share one millisecond on one short page is
    left out, it cannot show an order), and whether the member's answers list their rows newest first: ``(reading, failure_class)``.

    The rebuild's OKX walk pages each instrument type it meets (review SFH-2), so a member's
    reading is ``True`` only when every such type answers newest first AND its page reaches the
    newest fill the forced pass read on that type (review WR-01), ``False`` when any type answers
    oldest first, and otherwise ``field-absent`` (a type whose answer cannot say or does not reach
    its newest fill) or ``None`` (a type whose read raised). One reading per member, so readings
    never exceed members with trades. ``None`` is also returned when the member is not OKX or
    ``calls`` holds no typed pass that ``_row_inst_types`` selects. A read that raises is swallowed here and recorded as
    the allow-listed CLASS of the first exception (its message is never read, a ccxt message can
    carry a signed URL). A side measurement that never changes a member's outcome. ``calls`` must
    be a SNAPSHOT taken before the anchor diagnostic runs: the diagnostic re-wraps the same client,
    so the live recorder list would also hold its advisory pass and could add another instrument
    type. The raw reads are not wrapped by the recorder, so they never enter the forced pass's
    counters."""
    inst_types = _row_inst_types(calls) if venue == "okx" else []
    if not inst_types:
        return None, "none"
    readings: list[bool | str] = []
    failure = "none"
    for inst_type in inst_types:
        try:
            raw = await asyncio.wait_for(
                client.private_get_trade_fills_history(
                    {
                        "instType": inst_type,
                        "begin": str(_day_ms(window_start)),
                        "end": str(_day_ms(end_date + timedelta(days=1))),
                        "limit": str(_OKX_PAGE_ROWS),
                    }
                ),
                er._RECONSTRUCT_CRAWL_TIMEOUT_S,
            )
        except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
            if failure == "none":
                failure = classify_failure(exc)
            continue
        reading = okx_newest_first(raw)
        if reading is True:
            # Rows that descend inside one page prove nothing if the page is not the NEWEST
            # fills: the rebuild's walk stops on a short page, so a range answered with its oldest
            # rows would lose every newer fill and still read ``True`` here (review WR-01).
            newest = _pass_newest_ms(calls, inst_type)
            if newest is None or int(raw["data"][0]["ts"]) < newest:
                reading = FIELD_ABSENT
        readings.append(reading)
    if any(r is False for r in readings):
        return False, failure
    if len(readings) == len(inst_types) and all(r is True for r in readings):
        return True, failure
    return (None if failure != "none" else FIELD_ABSENT), failure


def _unified_snapshot(recorder: _TradeRecorder | None) -> dict[str, Any]:
    """The recorder's Unified-edge reading, as ``_MemberResult`` fields (the defaults when the
    member never got as far as a recorder)."""
    if recorder is None:
        return {}
    return {
        "unified": list(recorder.unified),
        "unified_state": recorder.unified_state(),
        "unified_sign_mismatch": recorder.unified_sign_mismatch,
    }


async def _bybit_funding_evidence(
    client: Any, venue: str, window_start: date, end_date: date
) -> dict[str, Any] | None:
    """The Bybit funding evidence (Phase 180 SC-1): how the account was funded, as counts and
    closed tokens, from five read-only GETs and the key's flags. ``None`` unless the member is a
    Bybit member with a client. It is a side measurement: it runs AFTER the member's snapshot,
    outside the crawl bound, so it can change neither a member's outcome nor its forced-pass
    counters, and ``measure_funding`` records a failure by state and never raises one."""
    if venue != "bybit" or client is None:
        return None
    return await bybit_funding_record.measure_funding(client, _day_ms(window_start), end_date)


async def _read_member(
    client: Any,
    venue: str,
    supabase: ReadOnlySupabase,
    window_start: date,
    end_date: date,
) -> tuple[list[dict[str, Any]], bool]:
    """The rebuild's own read. The second value is whether the anchor passed the 5x gate
    only through the bills check. The OKX ordering read is ``_okx_order_reading``'s, taken by
    ``_probe_member`` from its call snapshot on every arm that read trades."""
    rows, _hit_terminus, telemetry = await er._fetch_and_price_window(
        client, venue, supabase, window_start, end_date, require_anchor=True
    )
    return rows, telemetry.get("anchor_opening_agreed") is True


async def _measure_anchor(
    client: Any, supabase: ReadOnlySupabase, window_start: date, end_date: date
) -> dict[str, Any]:
    """Measure, read-only, why an OKX member's anchor was refused as implausible.

    A SECOND, advisory pass of the rebuild's own read (no ``require_anchor``) recovers the
    unanchored replay: its last value is ``replay_final`` and its first row's day is the
    opening day. One raw balance row gives the anchor ``A`` (``totalEq``), which stays in
    memory: only ratios against it are returned. The bills oracle then reads the account's
    balance at the opening day's start. Agreement is NOT decided here."""
    started = asyncio.get_running_loop().time()  # Phase 179: the chain tail's share of the outer bound
    fresh = _TradeRecorder(client)
    rows, _terminus, telemetry = await er._fetch_and_price_window(
        client, "okx", supabase, window_start, end_date
    )
    repeated = telemetry.get("anchor_offset_implausible") is True
    out: dict[str, Any] = {
        "anchor_diagnostic": "run",
        "advisory_arm": "implausible" if repeated else "not-implausible",
    }
    replay_final: float | None = None
    opening_day: date | None = None
    if repeated and rows:
        replay_final = _num(rows[-1].get("value_usd"))
        opening_day = date.fromisoformat(str(rows[0]["asof"]))
    out["replay_final_sign"] = replay_sign(replay_final)

    row = await obal.read_okx_balance_row(client)
    anchor = _num(row.get("totalEq")) if row is not None else None
    if anchor is not None and anchor <= 0:
        anchor = None
    out["anchor_over_replay"] = ratio_or_absent(anchor, replay_final)
    out = {**out, **balance_row_readings(row)}

    # What the advisory pass itself read, from its OWN recorder (the forced pass's is
    # untouched): fill-level facts, the transfers it saw and the symbols it could not price.
    out["flip_from_flat_closes"] = flip_from_flat_closes(fresh.trades)
    out["hedge_mode_fills"] = hedge_mode_fills(fresh.trades)
    out["flow_events_in_window"] = transfers_older_than(
        fresh.transfers, _day_ms(end_date + timedelta(days=1))
    )
    out["skipped_symbols_count"] = len(telemetry.get("skipped_symbols") or [])
    if rows:
        out = {**out, **breakdown_readings(rows[-1].get("breakdown"))}
        out["opening_day_is_window_start"] = str(rows[0].get("asof")) == window_start.isoformat()

    out["opening_check"] = "not-run"
    if replay_final is not None and opening_day is not None:
        if row is None:
            out["opening_check"], out["opening_unavailable_reason"] = "unavailable", "malformed_balance"
        else:
            walk_started_ms = int(time.time() * 1000)  # Phase 179: the walk's real start, for the archive-lag split
            try:
                reading = await obal.read_okx_opening(client, supabase, opening_day, row)
            except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
                # Review SFH-04: the walk is the last read, so its failure (a 429 that outlives
                # the backoff) must not discard the ratios already in ``out``.
                out["opening_check"] = "unavailable"
                out["diagnostic_failure_class"] = classify_failure(exc)
                return out
            out["opening_check"] = "measured" if reading.opening_usd is not None else "unavailable"
            out["opening_unavailable_reason"] = reading.unavailable_reason
            implied = None if anchor is None else anchor - replay_final
            out["implied_opening_over_anchor"] = ratio_or_absent(implied, anchor)
            out["bills_opening_over_anchor"] = ratio_or_absent(reading.opening_usd, anchor)
            residual = None if implied is None or reading.opening_usd is None else implied - reading.opening_usd
            out["opening_residual_over_anchor"] = ratio_or_absent(residual, anchor)
            out["bal_over_cashbal"] = ratio_or_absent(reading.newest_usdt_bal, _usdt_cash_balance(row))
            # Review SFH-R3-01: when the walk itself raised, the oracle's counters are still
            # their 0 defaults, which would read as an empty archive. Not measured is absent.
            if reading.unavailable_reason not in _WALK_NOT_COMPLETED_REASONS:
                out["bills_read"] = reading.bills_read
                out["blank_inst_type_bills"] = reading.blank_inst_type_bills
                out["bills_transfer_net_over_anchor"] = ratio_or_absent(reading.stable_transfer_net_usd, anchor)
            # Phase 179: name the arm, currency and kind of a chain_break (read-only, GETs only).
            if reading.unavailable_reason == "chain_break":
                # The chain's deadline never outlasts what is left of the outer bound (less a margin
                # to return), or the outer bound would cancel the whole first reading.
                left_s = er._RECONSTRUCT_CRAWL_TIMEOUT_S - (asyncio.get_running_loop().time() - started) - 30.0
                out = {
                    **out,
                    **await okx_chain_record.measure_chain(
                        client, reading, row, opening_day, walk_started_ms, budget_s=max(0.0, left_s)
                    ),
                }
    return out


async def _anchor_diagnostic(
    client: Any, supabase: ReadOnlySupabase, window_start: date, end_date: date
) -> dict[str, Any]:
    """``_measure_anchor`` under the crawl bound. It never raises: a failed measurement is
    recorded by exception CLASS (a ccxt message can carry an amount or an id) and the
    member's refusal stands."""
    try:
        return await asyncio.wait_for(
            _measure_anchor(client, supabase, window_start, end_date),
            er._RECONSTRUCT_CRAWL_TIMEOUT_S,
        )
    except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
        return {
            "anchor_diagnostic": "failed",
            "diagnostic_failure_class": (
                "truncated" if isinstance(exc, er.TruncatedTradeRead) else classify_failure(exc)
            ),
        }


async def _probe_member(
    credentials_row: Mapping[str, Any] | None,
    venue: str,
    supabase: ReadOnlySupabase,
    kek: bytes,
    window_start: date,
    end_date: date,
) -> _MemberResult:
    """Decrypt, build the client, read the window, close the client. A failure is
    recorded by CLASS (or, for a rebuild refusal, by its token); the message is never read."""
    from services.encryption import decrypt_credentials
    from services.exchange import aclose_exchange
    from services.job_worker import _make_exchange_client

    client: Any = None
    recorder: _TradeRecorder | None = None
    started: float | None = None

    def _elapsed() -> int:
        return 0 if started is None else max(0, int(_monotonic() - started))

    try:
        if credentials_row is None:
            raise LookupError("selected member is not among the active keys read")
        api_key, api_secret, passphrase = decrypt_credentials(dict(credentials_row), kek)
        client = _make_exchange_client(venue, api_key, api_secret, passphrase)
        recorder = _TradeRecorder(client)
        started = _monotonic()
        rows, agreed = await asyncio.wait_for(
            _read_member(client, venue, supabase, window_start, end_date),
            er._RECONSTRUCT_CRAWL_TIMEOUT_S,
        )
        # Snapshot BEFORE the diagnostic, as in the refusal arm below. An anchor that passed
        # only through the bills check is the reading the OKX tolerance is re-measured from
        # (review WR-02), so it gets the same read-only diagnostic a refusal does.
        calls = list(recorder.calls)
        moved = list(recorder.transfers)
        unified = _unified_snapshot(recorder)
        elapsed_s = _elapsed()
        # The ordering read is a side measurement: one that raises is recorded by class and
        # the member stays read. It follows the snapshot, so ``read_elapsed_s`` keeps meaning
        # the forced pass.
        order, order_failure = await _okx_order_reading(client, venue, calls, window_start, end_date)
        funding = await _bybit_funding_evidence(client, venue, window_start, end_date)
        diagnostic: dict[str, Any] | None = None
        if venue == "okx" and agreed:
            diagnostic = await _anchor_diagnostic(client, supabase, window_start, end_date)
        return _MemberResult(
            read=True,
            rows=rows,
            calls=calls,
            transfers=moved,
            order=order,
            order_failure_class=order_failure,
            elapsed_s=elapsed_s,
            diagnostic=diagnostic,
            funding=funding,
            **unified,
        )
    except er.ForcedRebuildRefusedError as exc:
        # Snapshot BEFORE the diagnostic: its second pass runs through the same wrapped
        # client, so the live lists would otherwise count it (the TRADEPAGES counters
        # describe the forced pass only).
        calls = list(recorder.calls) if recorder is not None else []
        moved = list(recorder.transfers) if recorder is not None else []
        unified = _unified_snapshot(recorder)
        if exc.reason == _FLOW_SOURCE_REFUSAL and unified.get("unified_state") == "read":
            # The reader refused an answer the recorder saw no fault in (the page ceiling, say):
            # the Unified read did not answer, whatever its calls looked like.
            unified["unified_state"] = "malformed"
        elapsed_s = _elapsed()
        # D-01 (Phase 173): the refusal is raised at the END of the rebuild's read, so the
        # snapshot already holds the whole forced pass. Take the ordering reading from it now,
        # before the diagnostic's advisory pass can add calls to the client's recorder.
        order, order_failure = await _okx_order_reading(client, venue, calls, window_start, end_date)
        # The Bybit funding evidence follows the same snapshot: it describes the account, not the
        # refusal, so it is taken whichever way the refusal reads below.
        funding = await _bybit_funding_evidence(client, venue, window_start, end_date)
        if exc.reason in er.FORCED_REBUILD_REFUSAL_REASONS:
            diagnostic = None
            if venue == "okx" and client is not None and exc.reason == "anchor_skipped_implausible":
                diagnostic = await _anchor_diagnostic(client, supabase, window_start, end_date)
            return _MemberResult(
                read=False,
                refusal=exc.reason,
                calls=calls,
                transfers=moved,
                order=order,
                order_failure_class=order_failure,
                elapsed_s=elapsed_s,
                diagnostic=diagnostic,
                funding=funding,
                **unified,
            )
        return _MemberResult(
            read=False,
            failure_class="other",
            calls=calls,
            transfers=moved,
            order=order,
            order_failure_class=order_failure,
            elapsed_s=elapsed_s,
            funding=funding,
            **unified,
        )
    except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
        calls = list(recorder.calls) if recorder is not None else []
        moved = list(recorder.transfers) if recorder is not None else []
        unified = _unified_snapshot(recorder)
        elapsed_s = _elapsed()
        truncated = isinstance(exc, er.TruncatedTradeRead)
        # A cut-short read did read trades, so it takes the ordering reading too. Every other
        # class (auth, network, the crawl-bound timeout, decrypt, lookup) is not a read of
        # trades that can be trusted to describe the venue, so it takes none.
        order, order_failure = (
            await _okx_order_reading(client, venue, calls, window_start, end_date)
            if truncated
            else (None, "none")
        )
        # The same reasoning for the funding evidence: a venue that hung or rejected the key is
        # not asked five more questions.
        funding = (
            await _bybit_funding_evidence(client, venue, window_start, end_date) if truncated else None
        )
        return _MemberResult(
            read=False,
            failure_class="truncated" if truncated else classify_failure(exc),
            calls=calls,
            transfers=moved,
            order=order,
            order_failure_class=order_failure,
            truncated_site=truncated_site_of(exc, venue, calls) if truncated else "none",
            last_window_age_bucket=(
                window_age_bucket(calls[-1].since if calls else None, end_date) if truncated else "none"
            ),
            last_window_calls=last_window_calls(calls) if truncated else 0,
            elapsed_s=elapsed_s,
            funding=funding,
            **unified,
        )
    finally:
        if client is not None:
            await aclose_exchange(client)


def choose_job_key(account_rows: Sequence[Mapping[str, Any]]) -> str:
    """The key id a forced rebuild of this account would be queued on: the earliest-created
    working Bybit key, else the earliest-created working OKX key, else the earliest active
    OKX or Bybit key. ``account_rows`` is in ``created_at`` order."""
    for venue in ("bybit", "okx"):
        for row in account_rows:
            if er._key_venue(row) == venue and working_holder_predicate(row):
                return str(row["id"])
    return str(account_rows[0]["id"])


async def _stored_curve(
    supabase: ReadOnlySupabase, allocator_id: str, window_start: date
) -> dict[str, float]:
    """The stored ``asof -> value_usd`` of one allocator from the window start on."""
    from services.db import db_execute, rows

    def _load() -> Any:
        return (
            supabase.table("allocator_equity_snapshots")
            .select("asof, value_usd")
            .eq("allocator_id", allocator_id)
            .gte("asof", window_start.isoformat())
            .execute()
        )

    return {str(r["asof"]): float(r["value_usd"]) for r in rows(await db_execute(_load))}


def _account_record(label: str, run_date: str, **values: Any) -> dict[str, Any]:
    record: dict[str, Any] = {
        "record": "account",
        "account": label,
        "run_date": run_date,
        "selection": "ok",
        "okx_members": 0,
        "bybit_members": 0,
        "other_members": 0,
        "zero_contribution_members": 0,
        "non_working_accounts_excluded": 0,
        "window_days": FIELD_ABSENT,
        "members_read": 0,
        "members_failed": 0,
        "failure_class": "none",
        "member_refusal": "none",
        "trade_calls": 0,
        "trades_read": 0,
        "first_page_rows": 0,
        "okx_order_readings": 0,
        "okx_order_violations": 0,
        "okx_order_failure_class": "none",
        "okx_passes_ended_full": 0,
        "okx_members_with_trades": 0,
        "comparable": False,
        "stored_days": 0,
        "rebuilt_days": 0,
        "days_compared": 0,
        "days_differing": 0,
        "max_rel_diff": FIELD_ABSENT,
        "days_incomplete": 0,
        "transfers_older_365d": 0,
        "deposits_older_365d": 0,
        "withdrawals_older_365d": 0,
        "deposits_in_window": 0,
        "withdrawals_in_window": 0,
        "oldest_fill_age_bucket": "none",
        "oldest_deposit_age_bucket": "none",
        "oldest_withdrawal_age_bucket": "none",
        "oldest_fill_before_oldest_deposit": FIELD_ABSENT,
        "oldest_fill_before_oldest_withdrawal": FIELD_ABSENT,
        "bybit_transfers_gate": "not-applicable",
        "bybit_unified_state": "not-run",
        "bybit_unified_in_rows": 0,
        "bybit_unified_out_rows": 0,
        "bybit_unified_sign_mismatch_rows": 0,
        "bybit_funding_explained": "not-applicable",
        "bybit_transfers_cause": "not-applicable",
        "truncated_site": "none",
        "last_window_age_bucket": "none",
        "last_window_calls": 0,
        "read_elapsed_s": 0,
        "anchor_diagnostic": "not-run",
        "diagnostic_failure_class": "none",
        "diagnostic_members": 0,
        "advisory_arm": "not-run",
        "replay_final_sign": "absent",
        "anchor_over_replay": FIELD_ABSENT,
        "opening_check": "not-run",
        "opening_unavailable_reason": "none",
        "implied_opening_over_anchor": FIELD_ABSENT,
        "bills_opening_over_anchor": FIELD_ABSENT,
        "opening_residual_over_anchor": FIELD_ABSENT,
        "non_stable_share": FIELD_ABSENT,
        "upl_over_anchor": FIELD_ABSENT,
        "bot_equity_share": FIELD_ABSENT,
        "bal_over_cashbal": FIELD_ABSENT,
        "bills_transfer_net_over_anchor": FIELD_ABSENT,
        "flip_from_flat_closes": FIELD_ABSENT,
        "hedge_mode_fills": FIELD_ABSENT,
        "negative_qty_assets": FIELD_ABSENT,
        "flow_events_in_window": FIELD_ABSENT,
        "skipped_symbols_count": FIELD_ABSENT,
        "bills_read": FIELD_ABSENT,
        "blank_inst_type_bills": FIELD_ABSENT,
        "negative_stable_cash": FIELD_ABSENT,
        "breakdown_truncated": FIELD_ABSENT,
        "opening_day_is_window_start": FIELD_ABSENT,
        "bybit_evidence_members": 0,
        **bybit_funding_record.funding_defaults(),
        **okx_chain_record.chain_defaults(),
    }
    return {**record, **values}


async def _probe_account(
    label: str,
    allocator_id: str,
    account_rows: Sequence[Mapping[str, Any]],
    supabase: ReadOnlySupabase,
    kek: bytes,
    run_date: str,
    end_date: date,
) -> dict[str, Any]:
    """Select, window, re-read and compare ONE account, exactly as a forced rebuild would
    choose its members and window. Nothing is written."""
    job_key_id = choose_job_key(account_rows)
    try:
        account_keys = await er._read_account_keys(supabase, allocator_id, job_key_id)
        selected, zero_contribution, non_working_excluded = er._select_account_crawl_keys(
            account_keys, job_key_id
        )
    except er.ForcedRebuildRefusedError as exc:
        # An out-of-vocabulary reason is refused by the emitter, loudly, not mapped.
        return _account_record(label, run_date, selection=exc.reason)

    window_start, window_days = er._account_rebuild_window(selected, end_date)
    venues = [er._key_venue(member) for member in selected]
    credentials = {str(row["id"]): row for row in account_rows}

    results: list[_MemberResult] = []
    venue_of: list[str] = []
    for member, venue in zip(selected, venues):
        if venue not in _PROBE_VENUES:
            continue
        results.append(
            await _probe_member(
                credentials.get(str(member.get("id"))), venue, supabase, kek, window_start, end_date
            )
        )
        venue_of.append(venue)

    failed = [r for r in results if not r.read]
    first_failure = next((r for r in failed if r.failure_class != "none"), None)
    readings = [r.order for r in results if isinstance(r.order, bool)]
    diagnostics = [r.diagnostic for r in results if r.diagnostic is not None]
    # The FIRST measured member's keys go into the record; the count tells the reader when
    # more than one member was measured.
    first_diagnostic: dict[str, Any] = dict(diagnostics[0]) if diagnostics else {}
    fundings = [r.funding for r in results if r.funding is not None]
    first_funding: dict[str, Any] = dict(fundings[0]) if fundings else {}
    cutoff_365 = _day_ms(end_date - timedelta(days=365))
    deposits_old = sum(
        transfers_older_than(transfers_of_kind(r.transfers, "deposits"), cutoff_365) for r in results
    )
    withdrawals_old = sum(
        transfers_older_than(transfers_of_kind(r.transfers, "withdrawals"), cutoff_365)
        for r in results
    )
    all_in_window = _day_ms(end_date + timedelta(days=1))
    # D-01 (Phase 180): what the Unified edge alone gave, over the Bybit members only.
    bybit_results = [r for v, r in zip(venue_of, results) if v == "bybit"]
    unified_state = account_unified_state([r.unified_state for r in bybit_results])
    unified_in_rows = sum(
        transfers_older_than(transfers_of_kind(r.unified, "deposits"), all_in_window)
        for r in bybit_results
    )
    fill_ms = _oldest_of(oldest_fill_ms(r.calls) for r in results)
    deposit_ms = _oldest_of(oldest_transfer_ms(r.transfers, "deposits") for r in results)
    withdrawal_ms = _oldest_of(oldest_transfer_ms(r.transfers, "withdrawals") for r in results)
    # Strict, from the per-kind counts only; independent of members_failed because a positive
    # per-kind count is sound evidence even from a member that failed later (RESEARCH Pitfall 4).
    gate = bybit_transfers_verdict(venues.count("bybit"), window_days, deposits_old, withdrawals_old)
    failure_class = first_failure.failure_class if first_failure is not None else "none"
    member_refusal = next((r.refusal for r in failed if r.refusal != "none"), "none")
    trade_calls = sum(len(r.calls) for r in results)
    record = _account_record(
        label,
        run_date,
        okx_members=venues.count("okx"),
        bybit_members=venues.count("bybit"),
        other_members=sum(1 for v in venues if v not in _PROBE_VENUES),
        zero_contribution_members=zero_contribution,
        non_working_accounts_excluded=non_working_excluded,
        window_days=window_days,
        members_read=len(results) - len(failed),
        members_failed=len(failed),
        failure_class=failure_class,
        member_refusal=member_refusal,
        trade_calls=trade_calls,
        trades_read=sum(trades_read(r.calls) for r in results),
        first_page_rows=sum(first_page_rows(v, r.calls) for v, r in zip(venue_of, results)),
        okx_order_readings=len(readings),
        okx_order_violations=sum(1 for ok in readings if ok is False),
        okx_order_failure_class=next(
            (r.order_failure_class for r in results if r.order_failure_class != "none"), "none"
        ),
        okx_passes_ended_full=sum(
            okx_passes_ended_full(r.calls) for v, r in zip(venue_of, results) if v == "okx"
        ),
        okx_members_with_trades=sum(
            1 for v, r in zip(venue_of, results) if v == "okx" and trades_read(r.calls) > 0
        ),
        transfers_older_365d=sum(transfers_older_than(r.transfers, cutoff_365) for r in results),
        # Per kind (Phase 173 D-02), same cutoff and same distinct-event rule as the pooled field.
        # A Bybit deposit row may carry no id, and an id-less event counts each time it appears,
        # so a deposit COUNT can double-count a row two windows returned; "at least one" stays sound.
        deposits_older_365d=deposits_old,
        withdrawals_older_365d=withdrawals_old,
        # Corroboration for the founder to judge (D-02); these fields feed no gate. From Phase 180
        # on a Bybit member's flow read is the Unified wallet's transaction log (D-01), so these
        # describe the Unified edge and ``bybit_transfers_cause`` names why a shut gate is shut.
        # Lineage (Phase 173, 2026-10-28): that read was on-chain only (RESEARCH Pitfall 3), so a 0
        # was not a depth finding. Counts, closed age buckets and booleans only.
        deposits_in_window=sum(
            transfers_older_than(transfers_of_kind(r.transfers, "deposits"), all_in_window)
            for r in results
        ),
        withdrawals_in_window=sum(
            transfers_older_than(transfers_of_kind(r.transfers, "withdrawals"), all_in_window)
            for r in results
        ),
        oldest_fill_age_bucket=window_age_bucket(fill_ms, end_date),
        oldest_deposit_age_bucket=window_age_bucket(deposit_ms, end_date),
        oldest_withdrawal_age_bucket=window_age_bucket(withdrawal_ms, end_date),
        oldest_fill_before_oldest_deposit=_fill_before(fill_ms, deposit_ms),
        oldest_fill_before_oldest_withdrawal=_fill_before(fill_ms, withdrawal_ms),
        bybit_transfers_gate=gate,
        bybit_unified_state=unified_state,
        bybit_unified_in_rows=unified_in_rows,
        bybit_unified_out_rows=sum(
            transfers_older_than(transfers_of_kind(r.unified, "withdrawals"), all_in_window)
            for r in bybit_results
        ),
        bybit_unified_sign_mismatch_rows=sum(r.unified_sign_mismatch for r in bybit_results),
        bybit_funding_explained=bybit_funding_explained(
            venues.count("bybit"),
            unified_state,
            unified_in_rows,
            sum(trades_read(r.calls) for r in bybit_results),
            fundings,
        ),
        bybit_transfers_cause=bybit_transfers_cause(
            gate, unified_state, member_refusal, failure_class, trade_calls, deposits_old, withdrawals_old
        ),
        truncated_site=first_failure.truncated_site if first_failure is not None else "none",
        last_window_age_bucket=(
            first_failure.last_window_age_bucket if first_failure is not None else "none"
        ),
        last_window_calls=first_failure.last_window_calls if first_failure is not None else 0,
        read_elapsed_s=sum(r.elapsed_s for r in results),
        diagnostic_members=len(diagnostics),
        **first_diagnostic,
        bybit_evidence_members=len(fundings),
        **first_funding,
    )

    comparable = bool(results) and not failed and len(results) == len(selected)
    comparison: dict[str, Any] = {}
    if comparable:
        summed, days_incomplete = er._sum_account_rows([r.rows for r in results])
        stored = await _stored_curve(supabase, allocator_id, window_start)
        rebuilt = {str(row["asof"]): float(row["value_usd"]) for row in summed}
        compared, differing, largest = compare_days(stored, rebuilt)
        comparison = {
            "stored_days": len(stored),
            "rebuilt_days": len(rebuilt),
            "days_compared": compared,
            "days_differing": differing,
            "max_rel_diff": largest,
            "days_incomplete": days_incomplete,
        }
    return {**record, "comparable": comparable, **comparison}


def summarize(records: Sequence[Mapping[str, Any]], run_date: str) -> dict[str, Any]:
    """The summary line: counts only, and the OKX ordering gate and the Bybit transfer-depth gate
    derived from them."""
    violations = sum(r["okx_order_violations"] for r in records)
    ended_full = sum(r["okx_passes_ended_full"] for r in records)
    # A reading is only taken for a member with trades, so per account readings never exceed
    # members with trades, and equal sums mean equality on every account.
    readings = sum(r["okx_order_readings"] for r in records)
    members_with_trades = sum(r["okx_members_with_trades"] for r in records)
    # The Bybit roll-up (review WR-02, founder D-05): ``ok`` only when at least one account has a
    # full Bybit window and EVERY such account reads ``ok``. An account refused at selection is
    # ``not-applicable`` and does not shut it (the rebuild refuses that account at the same
    # selection, so an ``ok`` opens nothing for it); after phase 178 D-05 only an allocator with
    # no working exchange account at all (or one refused ``account_identity_pending`` or
    # ``account_key_venue_unsupported``) is refused at selection, and a dead key's own exchange
    # account is skipped and counted in ``non_working_accounts_excluded``. Plan 03 names the
    # refused accounts on a ``bybit-transfers-unread:`` line. Absent evidence is never ``ok``: with no applicable
    # account it is ``unmeasured``, not a vacuous truth.
    applicable = [r["bybit_transfers_gate"] for r in records if r["bybit_transfers_gate"] != "not-applicable"]
    return {
        "record": "summary",
        "run_date": run_date,
        "accounts": len(records),
        "accounts_read": sum(
            1
            for r in records
            if r["selection"] == "ok" and r["members_failed"] == 0 and r["members_read"] > 0
        ),
        "accounts_comparable": sum(1 for r in records if r["comparable"] is True),
        "accounts_trades_beyond_first_page": sum(
            1 for r in records if r["trades_read"] > r["first_page_rows"]
        ),
        "accounts_differing": sum(
            1 for r in records if r["comparable"] is True and r["days_differing"] > 0
        ),
        "trades_read": sum(r["trades_read"] for r in records),
        "days_compared": sum(r["days_compared"] for r in records),
        "okx_order_violations": violations,
        "okx_passes_ended_full": ended_full,
        "okx_order_readings": readings,
        "okx_members_with_trades": members_with_trades,
        "okx_order_gate": okx_order_verdict(violations, ended_full, readings, members_with_trades),
        "bybit_accounts_applicable": len(applicable),
        "bybit_transfers_gate": (
            "ok"
            if applicable and all(g == "ok" for g in applicable)
            else "unmeasured"
        ),
    }


async def run() -> int:
    """Select the active OKX / Bybit keys, refuse before any decrypt, then measure each
    account in ``created_at`` order and print one JSON line per account and a summary."""
    from services.db import db_execute, get_supabase, rows
    from services.encryption import get_kek

    missing = missing_deployed_names()
    if missing:
        print(
            f"refused: the deployed rebuild lacks {len(missing)} name(s) this probe reads",
            file=sys.stderr,
        )
        return EXIT_REFUSED

    supabase = ReadOnlySupabase(get_supabase())

    def _load_keys() -> Any:
        return (
            supabase.table("api_keys")
            .select("*")
            .in_("exchange", list(_PROBE_VENUES))
            .eq("is_active", True)
            .order("created_at")
            .execute()
        )

    key_rows = rows(await db_execute(_load_keys))
    if not key_rows:
        print("refused: no active okx or bybit key", file=sys.stderr)
        return EXIT_REFUSED
    accounts: dict[str, list[dict[str, Any]]] = {}
    for key_row in key_rows:
        accounts.setdefault(str(key_row.get("user_id")), []).append(key_row)
    if len(accounts) > _MAX_ACCOUNTS:
        print("refused: more accounts than the label can carry", file=sys.stderr)
        return EXIT_REFUSED

    kek = get_kek()
    end_date = _utc_today()
    run_date = end_date.strftime("%Y-%m-%d")
    records: list[dict[str, Any]] = []
    for index, (allocator_id, account_rows) in enumerate(accounts.items(), start=1):
        record = await _probe_account(
            f"a{index}", allocator_id, account_rows, supabase, kek, run_date, end_date
        )
        records.append(record)
        print(emit_record(record), flush=True)
    print(emit_record(summarize(records, run_date)), flush=True)
    return EXIT_FAILED if any(r["members_failed"] > 0 for r in records) else EXIT_OK


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="TRADEPAGES read-only allocator history probe (takes no arguments)"
    )
    parser.parse_args(argv)
    logging.disable(logging.CRITICAL)
    try:
        return asyncio.run(run())
    except Exception as exc:  # noqa: BLE001 - the TYPE only; a message can carry an id
        print(f"failed: {type(exc).__name__}", file=sys.stderr)
        return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
