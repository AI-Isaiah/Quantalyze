"""Phase 164.6.2 (MT5RELOGIN) — the BOOT HEAL: re-establish the MT5 terminal's
broker session from the environment triple, once, at the analytics worker's own
startup, without a human.

WHAT THIS IS FOR (criterion 1). The Wine terminal's broker session is established
ONCE, BY HAND, over VNC, and nothing re-establishes it — so any rotation, expiry
or broker-side event takes MT5 down silently and stays down until somebody opens
a VNC session. This module is the caller that closes that loop: it detects the
lost session with a CREDENTIAL-FREE probe and, only for that one fault, re-runs
``initialize()`` in its credentialed form from ``MT5_LOGIN`` / ``MT5_PASSWORD`` /
``MT5_SERVER``.

TWO DECISIONS ARE LOAD-BEARING HERE AND NEITHER IS THIS MODULE'S TO REVISIT.

  * **D-07** — the heal verb is ``Mt5Client.initialize_with_credentials``, NOT
    ``Mt5Client.login``. ``login()`` opens with a credential-LESS ``initialize()``
    and raises on its falsy return, and a credential-less ``initialize()`` is
    EXACTLY the call that answers ``-6`` when the terminal has no authorized
    account — so ``login()`` raises before reaching its own login and cannot heal
    the fault this module exists for (probed live, 2026-09-13).
  * **D-08** — STARTUP ONLY. The heal is called from ``main.lifespan`` and NOWHERE
    ELSE. D-01's "also heal on session open" was STRUCK on a measurement:
    ``job_worker._make_mt5_session`` runs in PREFLIGHT, outside and before the
    terminal lease, and ``Mt5Client._epoch`` binds on FIRST TOUCH — so a touch
    there would stamp the generation early and an unrelated lease release in the
    preflight-to-lease window would refuse a LEGITIMATE derive read with
    ``Mt5SessionAbandoned``. ⛔ A reader who finds the per-session half missing has
    found a DECISION, not a gap.

⛔ THREE THINGS THIS MODULE MUST BE STRUCTURALLY INCAPABLE OF DOING.

  1. **RAISING.** ``main.lifespan``'s ``_crash_handler`` calls ``SHUTDOWN.set()`` on
     ANY background-task exception, which stops the dispatch, watchdog and enqueue
     loops while the API — and therefore ``/health`` — stays green. A raising heal
     is a SILENT ANALYTICS OUTAGE behind a passing health check. Every path out of
     ``heal_mt5_terminal_session`` therefore sits inside ONE top-level
     ``except Exception``, and that property is asserted both structurally (the
     shape of the function's AST) and behaviourally (every internal step made to
     raise, the coroutine still returns ``None``).
  2. **BLOCKING THE EVENT LOOP.** ``rpyc.classic.connect(host, port)`` carries NO
     timeout of its own — ``MT5_REQUEST_TIMEOUT_S`` is applied only once the socket
     is up — so a blackholed mesh address would block ``/health`` against Railway's
     120 s ``healthcheckTimeout``. The ``Mt5Client`` is therefore CONSTRUCTED INSIDE
     the ``to_thread`` body, where the caller's ``wait_for`` bounds it.
  3. **TOUCHING THE TERMINAL FROM ANYWHERE BUT ITS OWN SINGLE LEASE.** There is
     exactly ONE ``mt5_terminal_lease`` acquisition in this module, at the top level
     of the async entry, and the client it covers is built and closed inside it.

⚠️ The bare-``initialize()`` idempotence assumption this path relies on ("a no-op
``True`` when the terminal is already attached") is an EMPIRICAL observation owned
by Phase 155 / MT5-VERIFY, not a MetaQuotes guarantee. If the D-06 window
measurement surprises, that assumption is the first suspect.
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
import time
from typing import Callable, Final, NamedTuple

import sentry_sdk

from services.closed_sets import mt5_enabled_server
from services.mt5_client import MT5_REQUEST_TIMEOUT_S as _MT5_REQUEST_TIMEOUT_S
from services.mt5_client import (
    Mt5Client,
    Mt5ClientError,
    Mt5SessionAbandoned,
    _redact_credential_values,
    _scrub_refusal_reason,
    clear_mt5_relaunch_debt,
    is_private_gateway_host,
    mt5_relaunch_debt,
    mt5_terminal_answer_count,
    mt5_terminal_key,
)
from services.mt5_concurrency import Mt5TerminalBusyError, mt5_terminal_lease
from services.mt5_handover import HOLDER_HOUSE, SITE_HEAL
from services.mt5_session_episodes import (
    KIND_ALREADY_AUTHORIZED,
    KIND_BOOT_ACCOUNTLESS_RELAUNCH_FAILED,
    KIND_BOOT_ACCOUNTLESS_RELAUNCHED,
    KIND_BUDGET_ABANDONED,
    KIND_BUSY_SKIP,
    KIND_CREDENTIAL_REFUSED,
    KIND_CREDENTIALS_NOT_CONFIGURED,
    KIND_GATEWAY_NOT_CONFIGURED,
    KIND_HEAL_SENT_IPC_FAULT_ON_REPROBE,
    KIND_HEALED,
    KIND_IPC_FAULT,
    KIND_IPC_FAULT_RECYCLE_CAPPED,
    KIND_IPC_FAULT_RECYCLE_FAILED,
    KIND_IPC_FAULT_RECYCLE_NO_HOUSE_CREDENTIALS,
    KIND_IPC_FAULT_RECYCLE_NOT_LANDED,
    KIND_IPC_FAULT_RECYCLE_SKIPPED_BUDGET,
    KIND_IPC_FAULT_RECYCLED,
    KIND_IPC_FAULT_RECYCLED_DEGRADED,
    KIND_IPC_FAULT_RECYCLED_HOUSE_REFUSED,
    KIND_IPC_FAULT_RECYCLED_RELAUNCH_PENDING,
    KIND_IPC_FAULT_RECYCLED_STILL_FAULTED,
    KIND_IPC_FAULT_RECYCLED_UNVERIFIED,
    KIND_NO_AUTHORIZED_ACCOUNT,
    KIND_RELAUNCH_DEBT,
    KIND_RELAUNCH_DEBT_OUTSTANDING,
    KIND_RELAUNCH_DEBT_SETTLED,
    KIND_STILL_UNAUTHORIZED,
    IPC_FAULT_RECYCLE_CAP,
    HealOutcome,
    claim_ipc_fault_escalation,
    end_ipc_fault_run,
    end_ipc_fault_run_if_answered,
    ipc_fault_alarm_due,
    ipc_fault_cap_alarm_due,
    ipc_fault_escalation_armed,
    ipc_fault_recycles_in_window,
    mark_ipc_fault_alarm,
    mark_ipc_fault_cap_alarm,
    note_ipc_fault_reading,
    restore_ipc_fault_attempt,
    record_mt5_heal_outcome,
    record_mt5_session_reading,
)
from services.mt5_validation import (
    _IPC_TRANSPORT_CODES,
    Mt5ValidationError,
    parse_mt5_credentials,
)
from services.redact import scrub_freeform_string

# ⛔ A STDLIB logger, bound at module scope under the `quantalyze.analytics.`
# prefix — the convention `services/job_worker.py` and `services/mt5_client.py`
# already use. ⛔ NEVER `structlog.get_logger(...).bind(...)` at module scope:
# `BoundLoggerLazyProxy.bind()` freezes whatever processor list is in force at
# import time, i.e. before any entrypoint calls `configure_logging()`, so the
# resulting logger carries the UNREDACTED chain forever
# (`tests/test_structlog_frozen_proxy.py`, Mode A).
logger = logging.getLogger("quantalyze.analytics.mt5_relogin")


# The MT5 error code for "no account is authorized on this terminal" — the ONE
# fault this module heals, and the vocabulary Phase 164.8.3 (PROBERAUTH) shipped
# for the prod prober ("Terminal: Authorization failed"). ⛔ Every OTHER code the
# detector can carry (-10003 / -10004 / -10005) is an IPC fault whose remedy is
# the OPPOSITE one — restart the pipe, look at the VNC screen — and re-sending a
# credential there heals nothing while re-collapsing exactly the distinction
# Phase 164.1 built.
_MT5_NO_AUTHORIZED_ACCOUNT_CODE: Final[int] = -6

# --------------------------------------------------------------------------- #
# ⭐ THE ESCALATION's CODE GATE (164.6.5 plan 05, D-08) — which IPC fault a
# terminal-PROCESS recycle can actually reach.
#
# The two IPC-transport codes have DIFFERENT remedies, and the prod prober's arm
# encodes the same split as two kinds:
#
#   * `-10004` "No IPC connection" — the bridge is DETACHED. The recycle verb has
#     to travel THROUGH that bridge to end the terminal, so here it has nothing
#     to talk to. The shipped remedy is a redeploy. NOT escalated.
#   * `-10005` "IPC timeout" — the bridge ANSWERED and the terminal behind it did
#     not. A credentialed `initialize()` has to go through the dead half; a
#     process recycle does not. THIS is the class the escalation exists for.
#
# ⛔ DERIVED FROM THE SHIPPED TUPLE, never a re-spelled `-10005`: the gate is
# "the IPC-transport codes, minus the detached one". The private import is the
# same deliberate choice `_redact_credential_values` above records — the tuple
# is the one place those codes are defined, and a second copy is drift. ⛔ If a
# code is ever ADDED to `_IPC_TRANSPORT_CODES`, this set widens with it, and
# `test_the_escalation_gate_is_exactly_the_ipc_timeout_code` reds so that
# widening is a decision rather than an accident. `-10003` and the `0`
# sentinel are not transport codes and never escalate.
# --------------------------------------------------------------------------- #
_MT5_IPC_BRIDGE_DETACHED_CODE: Final[int] = -10004

#: The stage name `Mt5Client.recycle_terminal_process` passes to its OWN
#: first-statement fence. An `Mt5SessionAbandoned` carrying it was refused before
#: the recycle crossed the wire (WR-01).
_RECYCLE_FENCE_STAGE: Final[str] = "terminal_recycle"

#: ⭐ 164.6.6.1 plan 03 — the stage `Mt5Client.scrub_terminal_account_data`
#: passes to its OWN first-statement fence. An `Mt5SessionAbandoned` carrying it
#: was refused before the scrub crossed: nothing was ended or deleted, and no
#: relaunch debt was recorded.
_SCRUB_FENCE_STAGE: Final[str] = "terminal_scrub"

_RECYCLE_REACHABLE_IPC_CODES: Final[frozenset[int]] = frozenset(
    _IPC_TRANSPORT_CODES
) - {_MT5_IPC_BRIDGE_DETACHED_CODE}

# The three Railway variables the heal reads, in the order they are reported.
# ⛔ NAMES ONLY ever reach a log line — never a value, never a length, never a
# prefix, never a hash (T-164.6.2-12).
_MT5_CREDENTIAL_ENV_NAMES: Final[tuple[str, str, str]] = (
    "MT5_LOGIN",
    "MT5_PASSWORD",
    "MT5_SERVER",
)

_MT5_GATEWAY_ENV_NAMES: Final[tuple[str, str]] = (
    "MT5_GATEWAY_HOST",
    "MT5_GATEWAY_PORT",
)

# ⭐ Phase 164.6.6 D-02 — the VALIDATION terminal's endpoint, a second pair beside
# the job pair above and read by exactly two sites: the wizard's
# `routers.exchange._validate_mt5_key_probe` and the worker's
# `services.ingestion.mt5.Mt5Adapter.validate`. ⛔ Never a fallback to the job pair
# (D-05): a validation that lands on the job terminal is the eviction this phase
# exists to remove. NAMES ONLY ever reach a log line (T-164.6.2-12).
_MT5_VALIDATION_GATEWAY_ENV_NAMES: Final[tuple[str, str]] = (
    "MT5_VALIDATION_GATEWAY_HOST",
    "MT5_VALIDATION_GATEWAY_PORT",
)

# The kill switch's variable NAME, so the disabled-return log line can name it
# without re-spelling the string `services/closed_sets.py` owns (HIGH-1).
_MT5_ENABLED_ENV_NAME: Final[str] = "MT5_ENABLED"

# --------------------------------------------------------------------------- #
# ⭐ THE CALLER'S NAME, IN THE RECORD AND IN THE LOG LINE (164.6.4 plan 02).
#
# The heal had exactly ONE caller — `main.lifespan`'s boot task — so every
# sentence it emits says "boot heal". Phase 164.6.4 adds a SECOND caller (the
# session monitor's tick), at which point those sentences stop being true for
# half the traffic. ⛔ A log line that names the wrong caller is this repo's
# recorded defect class, not a cosmetic issue: an operator reading "mt5 boot
# heal: ABANDONED" at 14:05 on a container that booted at 09:12 has been handed
# a false fact about WHEN it happened.
#
# The mapping is TOTAL by construction — an unknown source is NAMED as unknown
# rather than silently mislabelled — and the label is bound as the FIRST
# statement inside the entry's guard, beside the `credentials` binding, so the
# outer handler can never hit an unbound local.
# --------------------------------------------------------------------------- #
HEAL_SOURCE_BOOT: Final[str] = "boot"
HEAL_SOURCE_SESSION_MONITOR: Final[str] = "session_monitor"

_HEAL_SOURCE_LABELS: Final[dict[str, str]] = {
    HEAL_SOURCE_BOOT: "mt5 boot heal",
    HEAL_SOURCE_SESSION_MONITOR: "mt5 session monitor",
}

#: ⛔ Never a silent fallback to the boot label. An unrecognised source is an
#: EDITING mistake, and labelling it "boot heal" would hide it behind a sentence
#: that reads correct.
_HEAL_SOURCE_LABEL_UNKNOWN: Final[str] = "mt5 session heal (UNKNOWN caller)"

# The two tuning knobs. ⛔ READ PER CALL AND NEVER AT IMPORT — 164.6.2 CR-02.
#
# They WERE `float(os.getenv(...))` at module scope, and `main.lifespan` imports
# this module unguarded before its `yield`. MEASURED 2026-09-14:
#
#     $ MT5_RELOGIN_BUDGET_S="45s" python -c "import services.mt5_relogin"
#     ValueError: could not convert string to float: '45s'
#
# so an operator typo in a Railway variable raised out of the lifespan context
# manager, aborted uvicorn startup, and `restartPolicyType ON_FAILURE x3` took
# the WHOLE analytics service down — the dispatch loop, the watchdog, the enqueue
# loop and `/health` — for a best-effort heal of a gateway nobody needed. That is
# VERBATIM the outcome D-08's own comment in `main.lifespan` says the
# `create_task` shape exists to prevent; the unguarded import defeated it one
# line above the task. The asymmetry was the tell: every OTHER misconfiguration
# here is handled by log-once-and-return (D-02) and only the two knobs that exist
# purely to TUNE the heal were fatal.
#
# Reading per call also restores the property `read_env_mt5_credentials`'s
# docstring argues for at length — a go-live variable flip must take effect
# without a reimport — which these two were the module's only violators of.
_MT5_RELOGIN_BUDGET_ENV: Final[str] = "MT5_RELOGIN_BUDGET_S"
_MT5_RELOGIN_LEASE_WAIT_ENV: Final[str] = "MT5_RELOGIN_LEASE_WAIT_S"

# ⭐ THE BUDGET IS DERIVED FROM THE NUMBER OF ROUND-TRIPS THE PATH ACTUALLY
# MAKES (WR-03), not from one. The `-6` path — the path a heal exists for — is:
#
#   | step                                            | ceiling                 |
#   |-------------------------------------------------|-------------------------|
#   | `rpyc.classic.connect` in `Mt5Client.__init__`   | NONE of its own; this   |
#   |                                                 | `wait_for` is the only  |
#   |                                                 | thing bounding it       |
#   | `assert_session_authorized` -> `initialize()`    | 20 s MT5 IPC / 30 s rpyc|
#   | `_raise_last` -> `last_error()`                  | 30 s rpyc — D-32's own  |
#   |                                                 | EVIDENCE §1b records a  |
#   |                                                 | failed attempt paying a |
#   |                                                 | SECOND full 30 s here   |
#   | `initialize_with_credentials` -> `initialize(…)` | 20 s MT5 IPC / 30 s rpyc|
#   | the WR-02 RE-PROBE -> `initialize()`             | 20 s MT5 IPC / 30 s rpyc|
#   | the RE-PROBE's `_raise_last` -> `last_error()`   | 30 s rpyc — the SAME     |
#   |                                                 | second round-trip as row |
#   |                                                 | three, on the second     |
#   |                                                 | probe. This row was      |
#   |                                                 | MISSING (WR-02 r2)       |
#
# The old `_MT5_REQUEST_TIMEOUT_S + 10.0` (40 s) bounded ~80 s of work, so a
# genuinely-`-6` terminal on a slow Wine bridge — the condition under which a
# heal is MOST needed — had its `wait_for` fire MID-`initialize`: the coroutine
# unwinds, the lease releases and bumps the generation, the zombie thread's
# in-flight credentialed `initialize` is abandoned against the shared terminal,
# and whether the session came up is unknowable from the log. Still DERIVED from
# the rpyc bound (the house idiom) so a retune carries through.
#
# ⛔ IT WAS 4, AND THE PATH MAKES 5. The table's last row was missed: WR-02's
# re-probe is a DETECTOR, and a detector that answers falsy goes on to
# `_raise_last` -> `last_error()` exactly as the first probe does. The five-trip
# path is not an exotic one — it is the path that produces
# `still_unauthorized` / `heal_sent_ipc_fault_on_reprobe`, i.e. the single most
# VALUABLE verdict this module emits, the one that says a human must act.
# MEASURED: 5 x 30 s = 150 s against a 130 s budget, so on a slow Wine bridge the
# `wait_for` fired mid-`last_error` and the operator got the generic
# `did not complete` INSTEAD of the verdict — and a zombie thread was left in
# flight against the shared terminal for the difference. 5 x 30 + 10 = 160 s,
# comfortably under the 300 s ceiling derived below.
#
# ⛔ The count is GATED, not asserted: `test_the_budget_covers_every_round_trip_
# the_worst_case_path_makes` drives the five-trip path against the double and
# counts the remote calls it actually makes. A sixth round-trip added to the path
# reds there rather than silently re-opening this window.
#
# ⛔ 164.6.5 plan 05 — IT WAS 5, AND THE WORST PATH IS NOW THE ESCALATION's. Plan
# 05 re-derived it to 8, counting "terminal-touching calls" and treating the
# recycle's bridge-served rpyc requests as free.
#
# ⛔ 164.6.5 review round 1 (WR-04) — THAT COUNT WAS INCONSISTENT, AND HONESTLY
# COUNTED THE PATH OVERRAN THE 300 s CEILING. The same table counts `last_error()`
# — a BRIDGE-LOCAL read of the package's stored error — at a full 30 s, because
# D-32's EVIDENCE §1b measured a failed attempt paying a SECOND 30 s there. The
# unit is therefore the RPYC CROSSING, each bounded only by `sync_request_timeout`,
# and `recycle_terminal_process._remote_call` makes THREE of them
# (`conn.execute(SRC)`, the `conn.namespace[FN]` netref lookup, the call), not one.
# Counted that way plan 05's path was 10 crossings = 310 s, over the ceiling: the
# `wait_for` would fire mid-recycle (the WR-03 class, and the SFH-06 abandonment).
#
# THE FIX IS NOT A BIGGER NUMBER. The budget now covers exactly the crossings the
# escalation makes UNCONDITIONALLY, and every OPTIONAL read is taken only when the
# time left still covers it AND everything the path must still do
# (`_affordable`). The unconditional worst path:
#
#   | the first probe: `initialize()` + `last_error()`                 | 2 |
#   | the capture: `terminal_info()` + its `last_error()`              | 2 |
#   | the recycle: execute + namespace lookup + call                   | 3 |
#   | the verb's relaunch probe: `initialize()` + `last_error()`        | 2 |
#
# 9 x 30 + 10 = 280 s, under the 300 s ceiling, which is unchanged. The capture's
# `account_info()` read, the relaunch POLLS that let a slow relaunch be seen
# answering, and the post-relaunch reads are all budget-gated, so none of them
# can push the path past the `wait_for`. ⛔ It is the MINIMUM that covers the
# unconditional path: `test_the_budget_covers_the_ESCALATION_path_too` drives the
# worst path with every crossing at its ceiling and asserts EQUALITY, so an
# over-provision (which lengthens the unbounded lease wait batch jobs pay, IN-04)
# reds as surely as an under-count.
#
# ⛔ 164.6.5 review round 2 (WR-03, 2026-09-25) — THE CAPTURE ROW WAS AN
# UNDER-COUNT, AND THE PATH IS NOW 7. `terminal_info()` was charged 2 crossings,
# which is its FAILING shape (the read, then `_raise_last`'s `last_error()`). Its
# ANSWERING shape is a netref namedtuple that `mt5_client._materialize` walks
# once per field (29 crossings at the documented field count), so "unconditional"
# was never true of it at the ceiling. Charged honestly, no budget under the 300 s
# ceiling can cover an answering read beside the recycle and its relaunch, so the
# capture is now budget-gated like every other optional read, and the
# unconditional path is:
#
#   | the first probe: `initialize()` + `last_error()`                 | 2 |
#   | the recycle: execute + namespace lookup + call                   | 3 |
#   | the verb's relaunch probe: `initialize()` + `last_error()`        | 2 |
#
# 7 x 30 + 10 = 220 s. ⚠️ THE CONSEQUENCE, STATED: at every budget the window
# admits, the in-process capture (`terminal_info` / `account_info`) and the
# SFH-07 post-relaunch check are SKIPPED, and their lines say so. They become
# affordable only if these reads stop costing one crossing per field, i.e. are
# materialized bridge-side the way `Mt5Client._materialize_rows` already does
# deals (the review's other option, and `mt5_client`'s to take).
#
# ⭐ SUPERSEDED THE SAME DAY (164.6.5 review round 2, WR-03 ROOT CAUSE,
# 2026-09-25; the paragraph above is kept as lineage). The option above was
# taken: `Mt5Client.session_snapshot` reads the heal's fields of BOTH
# `terminal_info()` and `account_info()` on the far side of the wire in ONE
# `conn.eval` of a committed literal (`mt5_client._REMOTE_SESSION_SNAPSHOT_SRC`),
# returning a tuple of scalars rpyc copies by value. A read that does not answer
# reads its `last_error()` code in the SAME crossing. So the capture and the
# SFH-07 post-relaunch check cost ONE crossing each, whatever the terminal
# answers, and both are back on the unconditional path:
#
#   | the first probe: `initialize()` + `last_error()`                 | 2 |
#   | the capture: `session_snapshot()`                                | 1 |
#   | the recycle: execute + namespace lookup + call                   | 3 |
#   | the relaunch reading, ONE of:                                    | 2 |
#   |   the verb's probe does not answer: `initialize()` + `last_error()` |   |
#   |   it answers: `initialize()` + the post-relaunch `session_snapshot()` | |
#
# 8 x 30 + 10 = 250 s (it was 220 s with both reads skipped, 280 s before
# that), under the unchanged 300 s ceiling. The last row is why the check costs
# the path nothing extra: it runs only after the probe ANSWERED, and an
# answering probe is one crossing, so the probe and the check together are never
# more than the failing probe's two. The same arithmetic means the recycle's own
# reserve (`_ESCALATION_RESERVE_CROSSINGS`) already covers the check.
# ⚠️ The two reads are ONE crossing, not one each, on purpose: one crossing per
# read would make the path 2 + 2 + 3 + 3 = 10 crossings = 310 s, over the
# ceiling. The relaunch POLLS stay budget-gated, and each poll reserves a whole
# detector reading, so a poll that sees the relaunch answer also leaves the
# check its crossing.
#
# ⭐ 164.6.6.1 plan 03 (2026-10-04, D-04 (i)) — THE SCRUB REPLACES THE RECYCLE,
# AND THE RELAUNCH READING IS CREDENTIALED. The table above is kept as lineage.
# The escalation no longer calls `recycle_terminal_process` (which relaunches
# BARE, i.e. from the saved `accounts.dat`, the L7 Login-dialog shape). It calls
# `scrub_terminal_account_data`, which ends the terminal, deletes the saved
# accounts and never relaunches, and then sends ONE credentialed house
# `initialize`. The unconditional path is:
#
#   | the first probe: `initialize()` + `last_error()`                 | 2 |
#   | the capture: `session_snapshot()`                                | 1 |
#   | the scrub: execute + namespace lookup + call                     | 3 |
#   | the credentialed relaunch reading, ONE of:                       | 2 |
#   |   it does not answer: `initialize(login=…)` + `_raise_last`'s     |   |
#   |     `last_error()`                                                |   |
#   |   it answers: `initialize(login=…)` + the post-relaunch           |   |
#   |     `session_snapshot()`                                          |   |
#
# The scrub row replaces the recycle row crossing for crossing, and the
# credentialed reading replaces the verb's bare relaunch probe crossing for
# crossing, so the derived default is UNCHANGED, and so are
# `_MT5_RELOGIN_BUDGET_CEILING_S` and `_RELAUNCH_SETTLE_S`. Evidence that the
# credentialed reading fits ONE crossing: S-09 measured the credentialed call
# returning True in 2.8 s on a killed, scrubbed terminal (the 36 s kill-to-
# authorized wall time there included a 24.9 s WASTED bare call, which this path
# never makes), and S-11 measured the FIRST credentialed call launching the
# killed, scrubbed validation terminal and authorizing it as house 6.0 s after
# the kill, with no poll.
#
# ⚠️ W-2, A SLOW LAUNCH, STATED. At the ceilings every crossing costs
# `_MT5_REQUEST_TIMEOUT_S` and the unconditional path spends the whole derived
# budget, so no credentialed poll is affordable: a launch slower than one
# crossing is NOT seen inside this heal. It ends
# `KIND_IPC_FAULT_RECYCLED_RELAUNCH_PENDING`, the relaunch debt the scrub verb
# recorded is KEPT, and the next tick from any source pays it with a credentialed
# relaunch (CONTEXT D-10, plan 04). At the MEASURED costs polls ARE affordable:
# the first probe on `-10005` takes about 25 s (S-10), the capture one snapshot,
# and the kill plus delete about 2 s (S-05), so the time left when polls start is
# roughly the budget less about 30 s and less the first credentialed call. A
# relaunch that authorizes up to `_RELAUNCH_SETTLE_S` after the kill is
# therefore still seen whenever that first call returns well inside one
# crossing, which S-09 (2.8 s) and S-11 (6.0 s kill-to-authorized) bound.
# ⚠️ S-11 measured the VALIDATION terminal. The jobs terminal has more `Bases`
# and a larger `accounts.dat` and may launch slower; plan 07's L-3 records the
# jobs path's own kill-to-authorized time from this escalation's
# `relaunch_elapsed_s`, and that reading, not S-11, is the jobs-path evidence.
# Shipping on the S-11 proxy is the founder's D-11 (accepted 2026-10-04).
_DETECTOR_READING_CROSSINGS: Final[int] = 2
#: `Mt5Client.scrub_terminal_account_data`'s `_remote_call`: `conn.execute`, the
#: `conn.namespace[FN]` netref lookup, and the call.
_SCRUB_CROSSINGS: Final[int] = 3
#: A credentialed `initialize` plus EITHER `_raise_last`'s `last_error()` (it
#: did not answer) OR the one-crossing post-relaunch `session_snapshot` (it
#: answered).
_CREDENTIALED_RELAUNCH_READING_CROSSINGS: Final[int] = 2
#: What a scrub must be able to finish once started: the scrub itself and its
#: credentialed relaunch reading. No scrub starts unless the time left covers
#: this (W-2). Public so the validation-terminal scrub (plan 05) gates on the
#: same number.
SCRUB_RELAUNCH_RESERVE_CROSSINGS: Final[int] = (
    _SCRUB_CROSSINGS + _CREDENTIALED_RELAUNCH_READING_CROSSINGS
)
#: `Mt5Client.session_snapshot`: one `conn.eval`, whatever it answers.
#: `test_R2_WR03_RC_a_session_snapshot_is_ONE_crossing_on_every_shape` drives the
#: REAL client against a netref-shaped double and requires this charge to equal
#: what it crossed.
_SESSION_SNAPSHOT_CROSSINGS: Final[int] = 1
_MT5_RELOGIN_ROUND_TRIPS: Final[int] = (
    _DETECTOR_READING_CROSSINGS  # the first probe
    + _SESSION_SNAPSHOT_CROSSINGS  # the pre-scrub evidence capture
    + _SCRUB_CROSSINGS
    + _CREDENTIALED_RELAUNCH_READING_CROSSINGS  # see the 164.6.6.1 table
)

#: The crossings the escalation must still make once the capture is done: the
#: scrub and its credentialed relaunch reading, which covers the post-relaunch
#: check (see the table). The scrub, and the capture before it, are taken only
#: if the time left covers this (WR-04, W-2).
_ESCALATION_RESERVE_CROSSINGS: Final[int] = SCRUB_RELAUNCH_RESERVE_CROSSINGS

#: ⭐ 164.6.6.1 plan 03 — the `delete_trades` flag the JOBS terminal's scrub
#: sends. ⭐ 1, FLIPPED by Phase 164.6.6.3 plan 03 (D-07): every `ipc_fault`
#: recycle now deletes the per-account deal caches, so each account is new to the
#: jobs terminal afterwards. That is safe because both callers of
#: `read_mt5_deal_ledger` (the derive and the backfill) wait for a fresh login's
#: history to settle (`services/mt5_read.py`, D-04), so a fresh cache no longer
#: hands back a partial deal history (RESEARCH Finding C). The flip is owned by
#: `TODOS.md` `MT5-JOB-TERMINAL-TRADES-SCRUB-01`, and its pin
#: (`test_SCRUB_the_job_path_keeps_trades_until_MT5_JOB_TERMINAL_TRADES_SCRUB_01`)
#: reads that entry live, so the constant and the ledger line move together. The
#: validation terminal's scrub already passes 1. ⛔ Never set it back to 0 while
#: the wait is on `main`: the pin goes RED on the ledger line.
_JOB_TERMINAL_DELETE_TRADES: Final[int] = 1

#: The heal's clock. ⛔ A module attribute, not a bare `time.monotonic` call, only
#: so the budget-gated paths can be driven against a clock whose every crossing
#: costs its full ceiling — the one condition the budget exists for.
_clock: Callable[[], float] = time.monotonic

#: The heal's sleep, a module attribute for the same reason as `_clock`.
_sleep: Callable[[float], None] = time.sleep

# ⭐ WR-02 / SFH-02 (164.6.5 review round 1) — THE RELAUNCH IS WATCHED, NOT READ
# ONCE. The verb's own relaunch probe is ONE bare `initialize()` bounded by
# `MT5_INITIALIZE_TIMEOUT_MS` (20 s), while plan 02's live spike MEASURED a cold
# relaunch reaching authorized 86 s after the kill (run 1; the terminal reappeared
# about 25 s in). So on the only evidence held, a WORKING recycle usually read an
# IPC code on that one probe and was logged `recycled_still_faulted` at ERROR,
# "a human is needed" — minutes before the next tick found it healthy. That trains
# the operator to ignore the one loud line this phase adds.
#
# SETTLE: the escalation keeps probing until the terminal answers, or until this
# long has passed since the verb RETURNED. The verb returns only after the remote
# terminate AND its own relaunch probe, so this clock starts no earlier than the
# kill: 90 s from here is always more than the measured 86 s kill-to-authorized.
# Only a relaunch still not answering after the whole window is `still_faulted`.
# ⭐ 164.6.6.1 plan 03 — the escalation's verb is now the scrub, which makes NO
# relaunch probe of its own; the settle clock starts when the scrub returns,
# which is still after the kill, and every probe in the window is a
# CREDENTIALED house `initialize` (`_relaunch_as_house`), never a bare one.
_RELAUNCH_SETTLE_S: Final[float] = 90.0

# The pause between relaunch polls. A not-yet-answering `initialize()` usually
# spends its own 20 s IPC timeout, so this mostly matters when it fails FAST
# (a terminal not yet listening), where it stops a tight loop against the bridge.
_RELAUNCH_POLL_INTERVAL_S: Final[float] = 10.0

# ⭐ SFH-03 (164.6.5 review round 1) — how often a PERSISTING IPC fault is
# re-raised at ERROR. One hour, the cadence of the independent hourly prod-prober
# (`mt5_session_monitor._MT5_SESSION_POLL_INTERVAL_CEILING_S`, not imported: that
# module imports this one). Alarm cadence only: it never re-opens the
# one-recycle-per-run decision.
_IPC_FAULT_ALARM_INTERVAL_S: Final[float] = 3600.0

# ⭐ CR-01 (164.6.5 review round 2) — THE ROLLING WINDOW the recycle cap
# (`mt5_session_episodes.IPC_FAULT_RECYCLE_CAP`, 2) is counted over. ORCHESTRATOR
# DECISION 2026-09-25, recorded in the phase CONTEXT.md: one hour, the same hour
# as the persistence alarm, so a recurring wedge is raised at ERROR about hourly
# and the shared terminal is recycled at most twice an hour. Without it, a wedge
# that returned every tick after a WORKING recycle was recycled every tick,
# unbounded, and never reached ERROR (round 1's CR-01 re-arm composed with the
# alarm's reset).
_IPC_FAULT_RECYCLE_WINDOW_S: Final[float] = _IPC_FAULT_ALARM_INTERVAL_S

#: `_raise_last`'s sentinel for "last_error() itself failed or answered
#: malformed" — it measured NOTHING about the terminal.
_MT5_UNATTRIBUTED_CODE: Final[int] = 0

#: ⛔ R2-SFH-02 (164.6.5 review round 2) — THE ALARM IS A DENYLIST, NOT AN
#: ALLOWLIST. It was the transport codes plus `-10003`, so every OTHER code
#: `_heal_blocking` labels `ipc_fault` — `-10001` / `-10002` (the IPC-internal
#: send/receive failures `services/mt5_validation.py` already lists), `-1`, any
#: terminal-internal code — read `not_healed:ipc_fault:code=N` at WARNING forever
#: (measured by the reviewer: 48 ticks, 0 ERROR). Now every first-probe code's
#: persistence is alarmed EXCEPT the two that are not a fault of the terminal's
#: IPC: `-6` (ours to heal, never reaches here) and the `0` sentinel (measured
#: nothing). ⛔ The ACTION's gate stays narrow and separate:
#: `_RECYCLE_REACHABLE_IPC_CODES`.
_IPC_FAULT_ALARM_EXEMPT_CODES: Final[frozenset[int]] = frozenset(
    {_MT5_NO_AUTHORIZED_ACCOUNT_CODE, _MT5_UNATTRIBUTED_CODE}
)


def _affordable(deadline: float, crossings: int) -> bool:
    """Whether ``crossings`` rpyc crossings, each at its full ceiling, still fit
    before ``deadline``. The guard every OPTIONAL read takes (WR-04)."""
    return deadline - _clock() >= crossings * _MT5_REQUEST_TIMEOUT_S


# The slack over the round-trips, covering the unbounded `rpyc.classic.connect`.
_MT5_RELOGIN_CONNECT_SLACK_S: Final[float] = 10.0

# ⛔ WR-06 — THE DECLARED CEILING, and it is a DERIVATION rather than a taste.
# Any value `float()` accepts was previously used verbatim as an `asyncio.wait_for`
# timeout: `MT5_RELOGIN_BUDGET_S=0` cancelled the heal immediately and logged
# "did not complete" on every boot FOREVER (indistinguishable from a transient
# gateway problem), and `inf` removed the bound entirely and held
# `mt5_terminal_lease` for as long as a wedged rpyc connect lasted — while every
# batch caller (`run_derive_broker_dailies_job`, `_fetch_mt5_account_balance`,
# `_fetch_mt5_account_rows`) acquires with `wait_s=None`, i.e. UNBOUNDED. A
# best-effort heal took out the batch.
#
# 300 s is ONE THIRD of the 15-minute dispatch ceiling those batch callers wait
# against, so even a maximally mis-tuned budget leaves a derive job two thirds of
# its own ceiling. ⛔ It bounds a TYPO, not a tuning decision; raising it means
# arguing about the dispatch ceiling, not about this line.
_MT5_RELOGIN_BUDGET_CEILING_S: Final[float] = 300.0

# ⛔ IN-03 (round 2) — THE FLOOR, and it is ONE ROUND-TRIP because anything less is
# a budget that cannot complete a single bounded call. `MT5_RELOGIN_BUDGET_S=0` was
# already rejected while `0.5` and `0.001` were accepted SILENTLY (measured), and
# the sub-round-trip values are the WORSE of the two: zero cancels before the
# thread starts, whereas `0.5` lets it start and then expires MID-`initialize_with_
# credentials` on the `-6` path, so EVERY boot abandons a credentialed call against
# the shared terminal after the lease released and bumped the generation. Derived
# from the rpyc bound like every other number here, so a retune carries through.
_MT5_RELOGIN_BUDGET_FLOOR_S: Final[float] = _MT5_REQUEST_TIMEOUT_S

# ⭐ The bound on ACQUIRING the terminal, and it is deliberately SHORT — a
# different quantity from the bound on OPERATING it (the D-29 distinction).
#
# WHY IT IS BOUNDED AT ALL: an unbounded acquire at boot would put a BEST-EFFORT
# heal ahead of real work in the terminal queue — the batch derive read, a user
# sitting in front of an interactive validate — for as long as that work takes.
# And the correct behaviour when the terminal is already busy is to SKIP: a busy
# terminal is a terminal somebody is already successfully using, which is itself
# evidence that the session is fine and there is nothing here to heal. ⛔ A
# timed-out acquire holds nothing, bumps nothing and stamps nothing
# (`mt5_terminal_lease`'s release discipline), so skipping costs the next holder
# exactly zero.
#
# ⚠️ IN-04 — THE ASYMMETRY, STATED RATHER THAN IMPLIED. This bound is deliberate
# on ONE side only: the heal refuses to queue behind real work, but real work
# DOES queue behind the heal. The three job call sites
# (`run_derive_broker_dailies_job`, `_fetch_mt5_account_balance`,
# `_fetch_mt5_account_rows`) acquire the same lease with `wait_s=None`, i.e.
# UNBOUNDED. Concretely: the worker boots, `dispatch_loop` claims a
# `derive_broker_dailies` job within a second or two, the heal already holds the
# lease, and the job waits inside its own unbounded acquire for up to the whole
# budget. That is harmless against the 15-minute dispatch ceiling and it is the
# direction the "a busy terminal is a terminal somebody is already using"
# argument above does NOT cover — and it grows in proportion to any budget
# increase, which is why `_MT5_RELOGIN_BUDGET_CEILING_S` is derived from that
# dispatch ceiling rather than picked.
_MT5_RELOGIN_LEASE_WAIT_DEFAULT_S: Final[float] = 2.0

# Its ceiling is ONE rpyc round-trip, and that follows from the argument above:
# waiting LONGER for a terminal somebody else is driving than a single round-trip
# takes contradicts the whole "a busy terminal is evidence the session is fine,
# so skip" posture this bound exists to express.
_MT5_RELOGIN_LEASE_WAIT_CEILING_S: Final[float] = _MT5_REQUEST_TIMEOUT_S

# ⛔ Its floor is a DIFFERENT quantity from the budget's and is deliberately tiny.
# This bound governs ACQUIRING, not operating (the D-29 distinction), and the
# correct behaviour when the terminal is busy is to SKIP — so a short wait is a
# legitimate tuning choice, not a typo. The floor exists only to keep the knob out
# of the region where "bounded" stops meaning anything: a wait of `0.001 s` cannot
# lose a race it never entered, so the heal would skip on every boot and the log
# would fill with a designed-looking INFO skip forever.
_MT5_RELOGIN_LEASE_WAIT_FLOOR_S: Final[float] = 0.1

# The verdict tokens `_heal_blocking` hands back for the caller to log. Short,
# fixed strings: they name what happened to the SESSION and carry no credential,
# no host and no port.
# ⭐ BOUND TO THE EPISODE RECORDER'S CLASS CONSTANT rather than re-spelled, so the
# token in a log line and the token in a `cron_runs` row cannot drift apart. The
# VALUE is byte-unchanged.
_VERDICT_ALREADY_AUTHORIZED: Final[str] = KIND_ALREADY_AUTHORIZED

#: ⭐ WR-02 — this token is now MEASURED. It used to be returned on the sole basis
#: that ``initialize_with_credentials`` did not raise, i.e. named after exactly
#: the signal both docstrings say must never be trusted. ``_heal_blocking`` now
#: re-runs the credential-free detector inside the same lease and the same budget
#: before returning it, so the log line and the doctrine agree.
_VERDICT_HEALED: Final[str] = KIND_HEALED

#: Every non-heal verdict starts with this, and the caller's log LEVEL keys off
#: it (WR-01). ⛔ A new failure verdict that does not carry the prefix is silently
#: demoted to INFO — `_heal_blocking`'s verdicts are built through `_not_healed`
#: for exactly that reason.
_VERDICT_NOT_HEALED_PREFIX: Final[str] = "not_healed:"

#: Reason keys already logged in THIS process. D-02 — an absent or unparseable
#: configuration must LOG ONCE and then stay quiet: the heal runs once per boot
#: today, but a second call in the same process (a test, a future caller) must not
#: re-emit. Composed from `main._capture_secret_misconfig`'s monotonic throttle
#: (keyed by fault-and-NAME, holding no value) simplified to once-per-process,
#: because there is no interval to tune when the event fires once per boot.
#: ⛔ It holds REASON KEYS, never a credential value.
_LOGGED_CONFIGURATION_FAULTS: set[str] = set()


def _reset_relogin_log_throttle_for_tests() -> None:
    """Clear the once-per-process log throttle.

    ⛔ Test-only. Production wants exactly the opposite of this: the throttle is
    what keeps an unconfigured deploy from re-stating the same missing-variable
    line on every future call.

    ⚠️ IN-03 — A TEST-ONLY MUTATOR SHIPPING IN A ``services/`` MODULE IS A
    DECISION HERE, NOT AN OVERSIGHT. It is underscore-prefixed, documented as
    test-only, and matches `mt5_client._reset_mt5_epochs_for_tests` — the same
    shape, in the same package, for the same reason (module-level state a test
    must be able to clear). ⛔ Production never calls it, and a future caller that
    does is removing a log-once guarantee the operator depends on. Recorded so
    the convention stays a decision rather than drifting into a habit.
    """
    _LOGGED_CONFIGURATION_FAULTS.clear()


def _log_configuration_fault_once(reason: str, message: str, *args: object) -> None:
    """Emit ``message`` at WARNING at most once per process per ``reason``.

    ⛔ **ITS CALLERS' SENTENCES NAME THE SESSION PATH, NOT A BOOT HEAL** (Phase
    164.6.4 plan 02). The SIX messages emitted by this module's module-scope
    configuration helpers — the two ``_env_float`` fault messages, the two
    credential-read messages and the two gateway-endpoint messages — all began
    "mt5 boot heal:". They were TRUE while the boot was the only caller; the
    session monitor makes them false for half the traffic, and ``_env_float`` is
    now reached from the monitor's OWN cadence knob. They describe CONFIGURATION
    FAULTS OF THE MT5 SESSION PATH, which is what they are, and the prefix now
    says so. ⛔ The SENTENCE was corrected, never the BEHAVIOUR: the throttle, the
    names-only rule (T-164.6.2-12) and the fault classes are byte-unchanged.
    ⚠️ MEASURED, and it corrects the plan's own arithmetic: there are SIX such
    messages, not seven — the port message IS one of the two gateway-endpoint
    messages rather than a seventh beside them.

    ⛔ LOG-AND-PROCEED, never silence (the posture `main_worker.daily_enqueue_loop`'s
    startup gate already uses in this repo's own voice). ⛔ Do NOT copy
    `sentry_init.init_sentry`'s silent early return: silence is the defect class
    this milestone exists to remove, and an MT5 gateway that never heals because
    nobody set a variable must be visible in the operator's log.
    """
    if reason in _LOGGED_CONFIGURATION_FAULTS:
        return
    _LOGGED_CONFIGURATION_FAULTS.add(reason)
    logger.warning(message, *args)


def _env_float(name: str, default: float, *, floor: float, ceiling: float) -> float:
    """One tuning knob, read PER CALL, with the SAME posture as the credential
    readers: a bad value logs once and falls back to the derived default.

    ⛔ STRUCTURALLY INCAPABLE OF RAISING, and that is the whole point (CR-02).
    Absent, blank, non-numeric, zero, negative, `nan` and `inf` all take the
    default. There is no input that reaches an `asyncio.wait_for` unvalidated and
    none that reaches the caller as an exception.

    ⛔ IN-03 (round 2) — THE WINDOW IS BOUNDED AT BOTH ENDS, AND THE FLOOR IS THE
    HALF THAT WAS MISSING. `MT5_RELOGIN_BUDGET_S=0` was rejected while `0.5` and
    `0.001` were accepted SILENTLY (measured) — and a SUB-ROUND-TRIP budget is
    strictly WORSE than zero. Zero cancels before the thread starts; `0.5` lets the
    thread start and then expires MID-`initialize_with_credentials` on the `-6`
    path, so EVERY boot leaves a credentialed call in flight against the shared
    terminal after the lease released and bumped the generation — the
    abandoned-thread state WR-03's whole derivation exists to avoid, arrived at by
    a typo. ⛔ The presence of a validated ceiling was itself the hazard: a knob
    that rejects `inf` and `0` reads as "this one is range-checked", and an
    operator has no reason to look for the end that is not.

    ⛔ The value is NEVER logged — only the variable NAME and the fault class.
    These knobs carry no credential today, but the module's rule (T-164.6.2-12)
    is names only, and an exception to it at one site is how a rule stops being
    one.
    """
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        _log_configuration_fault_once(
            f"{name}_not_numeric",
            "mt5 session path: %s is set but is not a number; falling back to the "
            "derived default. This is a SERVER misconfiguration, never a "
            "credential failure — the session path still runs (D-02).",
            name,
        )
        return default
    # ⚠️ The ceiling can never sit BELOW the default it guards. Both defaults are
    # derived from `MT5_REQUEST_TIMEOUT_S`, which is itself tunable, so a large
    # retune there could otherwise produce a window that rejects every value the
    # module would happily use itself — a ceiling that forbids its own default is
    # not a bound, it is a bug.
    effective_ceiling = max(ceiling, default)
    # ⚠️ And by the SAME argument in the other direction: a floor above the default
    # would reject the value the module would happily use itself. Clamped to the
    # default so the window can never be empty from either end.
    effective_floor = min(floor, default)
    # `math.isfinite` covers BOTH `inf` and `nan`, and `float("nan")` is the
    # nastier of the two: every comparison against it is False, so a naive
    # `floor <= value <= ceiling` range check would ACCEPT it and hand `nan` to
    # `wait_for`. Test the finiteness first, explicitly.
    if not math.isfinite(value) or not effective_floor <= value <= effective_ceiling:
        _log_configuration_fault_once(
            f"{name}_out_of_range",
            # ⛔ THE BODY IS CALLER-NEUTRAL TOO, not merely the prefix (164.6.4
            # plan 02). It used to describe the BUDGET's specific hazard —
            # "expires MID-round-trip", "on EVERY boot" — and `_env_float` is now
            # also the reader for the session monitor's DETECTION POLL CADENCE,
            # whose out-of-range hazard is the opposite shape (ticks overlapping
            # each other against the ONE shared terminal). A message naming a
            # hazard that does not apply to the knob that triggered it misleads
            # the operator it exists for. The per-knob derivations stay where they
            # belong, in each constant's own comment.
            "mt5 session path: %s is set to a value outside [%s, %s] seconds; "
            "falling back to the derived default. BOTH ends of the window are "
            "deliberate: below the floor the bound stops being able to do its "
            "job, and above the ceiling it stops bounding anything. See the "
            "constant's own derivation for what that means for this knob. This "
            "is a SERVER misconfiguration, never a credential failure (D-02).",
            name,
            effective_floor,
            effective_ceiling,
        )
        return default
    return value


def _relogin_budget_s() -> float:
    """The WHOLE heal's wall-clock budget — the rpyc connect plus the bounded
    round-trips the worst path actually makes (see the derivation above).

    ⛔ R2-SFH-01 (164.6.5 review round 2) — A VALUE BELOW THE DERIVED DEFAULT IS
    ACCEPTED AND NAMED. The window above admits anything from one round-trip
    up, and every value below the derived default is one the ipc_fault
    escalation can NEVER afford: its recycle is skipped on every wedge, forever.
    It stays accepted (a shorter heal is a legitimate trade for the ``-6`` path,
    and rejecting it would silently LENGTHEN an operator's deliberate choice),
    but it is logged ONCE per process at WARNING, by NAME, never by value
    (T-164.6.2-12). The escalation's own skip then reaches the persistence alarm
    (WR-01). MEASURED 2026-09-25 by the orchestrator (read-only): the variable is
    NOT set on the production analytics service, so the derived default applies
    there today.

    ⚠️ WR-03 ROOT CAUSE (2026-09-25) — "NEVER afford" above is now true only of
    the lower part of that range. The default covers the pre-recycle evidence
    capture as well, so a value somewhat below it drops the capture first, and
    only a value further below it loses the recycle itself. (The post-relaunch
    check is never the one dropped: whenever the recycle starts, its reserve
    leaves the check its crossing.) The warning says both.
    """
    default = (
        _MT5_RELOGIN_ROUND_TRIPS * _MT5_REQUEST_TIMEOUT_S
        + _MT5_RELOGIN_CONNECT_SLACK_S
    )
    budget = _env_float(
        _MT5_RELOGIN_BUDGET_ENV,
        default,
        floor=_MT5_RELOGIN_BUDGET_FLOOR_S,
        ceiling=_MT5_RELOGIN_BUDGET_CEILING_S,
    )
    if budget < default:
        _log_configuration_fault_once(
            f"{_MT5_RELOGIN_BUDGET_ENV}_below_derived_default",
            "mt5 session path: %s is set below its derived default of %s seconds. "
            "The value is accepted, but the ipc_fault escalation cannot afford "
            "every step at it: the pre-recycle evidence capture is dropped "
            "first, and further below the default the terminal-process recycle "
            "itself, so a -10005 wedge is never recycled automatically and the "
            "persistence alarm raises it at ERROR instead. This is a SERVER "
            "misconfiguration, never a credential failure (D-02).",
            _MT5_RELOGIN_BUDGET_ENV,
            default,
        )
    return budget


def _relogin_lease_wait_s() -> float:
    """The bound on ACQUIRING the terminal — deliberately short (D-29)."""
    return _env_float(
        _MT5_RELOGIN_LEASE_WAIT_ENV,
        _MT5_RELOGIN_LEASE_WAIT_DEFAULT_S,
        floor=_MT5_RELOGIN_LEASE_WAIT_FLOOR_S,
        ceiling=_MT5_RELOGIN_LEASE_WAIT_CEILING_S,
    )


def read_env_mt5_credentials() -> tuple[int, str, str] | None:
    """The ``(login, password, server)`` triple from the environment, or ``None``.

    ⛔ ``os.getenv`` is read PER CALL, never bound into a module-level constant.
    The reason is written in `services/closed_sets.py`'s module comment and it is
    load-bearing here twice over: a go-live variable flip must take effect without
    a reimport, and the tests monkeypatch the environment — a constant resolved at
    import would silently pin every one of them to import-time state.

    The parse goes through ``parse_mt5_credentials``, the ONE fail-closed OFFLINE
    seam the rest of the service uses (credential-slot reuse: login -> ``api_key``,
    investor password -> ``api_secret``, broker server -> ``passphrase``). ⛔ Never
    a hand-rolled ``int()`` plus two ``strip()``s — that drifts silently from the
    seam every other MT5 call site defers to.

    ⛔ Absent or unparseable configuration LOGS ONCE AND RETURNS (D-02). It does
    NOT copy `job_worker._make_mt5_session`'s ``RuntimeError``: that raise is
    correct for a JOB that cannot proceed, and wrong here, where the caller is the
    worker's boot and MT5 is one arm of many.
    """
    raw = (
        os.getenv("MT5_LOGIN"),
        os.getenv("MT5_PASSWORD"),
        os.getenv("MT5_SERVER"),
    )
    missing = [
        name
        for name, value in zip(_MT5_CREDENTIAL_ENV_NAMES, raw)
        if not (value or "").strip()
    ]
    if missing:
        _log_configuration_fault_once(
            "mt5_credentials_absent",
            "mt5 session path: skipped — the broker-session variables are not "
            "configured: %s. This is a SERVER misconfiguration, never a "
            "credential failure; the terminal keeps whatever session it already "
            "has and the next attempt will try again (D-02).",
            ", ".join(missing),
        )
        return None
    try:
        return parse_mt5_credentials(raw[0], raw[1], raw[2])
    except Mt5ValidationError:
        _log_configuration_fault_once(
            "mt5_credentials_invalid",
            "mt5 session path: skipped — the broker-session variables %s are set "
            "but do not form a usable login/password/server triple. This is a "
            "SERVER misconfiguration, never a credential failure (D-02).",
            ", ".join(_MT5_CREDENTIAL_ENV_NAMES),
        )
        return None


def read_env_gateway_endpoint() -> tuple[str, int] | None:
    """The ``(host, port)`` of the RPyC gateway from the environment, or ``None``.

    Same per-call read and same log-once-and-return posture as the credential
    reader above, and for the same D-02 reason.
    """
    raw_host = (os.getenv("MT5_GATEWAY_HOST") or "").strip()
    raw_port = (os.getenv("MT5_GATEWAY_PORT") or "").strip()
    missing = [
        name
        for name, value in zip(_MT5_GATEWAY_ENV_NAMES, (raw_host, raw_port))
        if not value
    ]
    if missing:
        _log_configuration_fault_once(
            "mt5_gateway_absent",
            "mt5 session path: skipped — the gateway endpoint is not configured: "
            "%s. This is a SERVER misconfiguration, never a credential failure.",
            ", ".join(missing),
        )
        return None
    try:
        port = int(raw_port)
    except ValueError:
        _log_configuration_fault_once(
            "mt5_gateway_port_not_numeric",
            "mt5 session path: skipped — %s is set but is not an integer port. "
            "This is a SERVER misconfiguration, never a credential failure.",
            _MT5_GATEWAY_ENV_NAMES[1],
        )
        return None
    if not is_private_gateway_host(raw_host):
        # Phase 164.6.6 D-07 part 1 (T-134-03): the rpyc bridge is dialled only
        # over a private network. `_default_connect` refuses such a host too;
        # refusing HERE keeps it a named, logged misconfiguration on the session
        # path instead of a construction error. NAME only, never the value.
        _log_configuration_fault_once(
            "mt5_gateway_host_not_private",
            "mt5 session path: skipped — %s is not a private-network host "
            "(T-134-03). This is a SERVER misconfiguration, never a credential "
            "failure.",
            _MT5_GATEWAY_ENV_NAMES[0],
        )
        return None
    return raw_host, port


def read_env_validation_gateway_endpoint() -> tuple[str, int] | None:
    """The ``(host, port)`` of the VALIDATION terminal's gateway, or ``None``.

    Phase 164.6.6 D-02: a key validation leases the validation terminal's
    ``terminal_key``, never the job terminal's, so an onboarding login can no
    longer switch the terminal that serves live jobs. A sibling of
    ``read_env_gateway_endpoint`` with the same per-call read, strip, int-parse,
    log-once and never-raise posture, over ``MT5_VALIDATION_GATEWAY_HOST`` /
    ``MT5_VALIDATION_GATEWAY_PORT``.

    ⛔ D-05 — ``None`` means REFUSE. Both callers fail loud and fire
    ``alert_mt5_validation_gateway_unconfigured``; neither may read the job pair
    instead. The routing pin in ``tests/test_mt5_concurrency.py`` reds if any
    other production function calls this reader.

    The log-once reasons are this reader's OWN keys, so an unset job pair can
    never silence the validation pair's line or the reverse.
    """
    raw_host = (os.getenv("MT5_VALIDATION_GATEWAY_HOST") or "").strip()
    raw_port = (os.getenv("MT5_VALIDATION_GATEWAY_PORT") or "").strip()
    missing = [
        name
        for name, value in zip(
            _MT5_VALIDATION_GATEWAY_ENV_NAMES, (raw_host, raw_port)
        )
        if not value
    ]
    if missing:
        _log_configuration_fault_once(
            "mt5_validation_gateway_absent",
            "mt5 validation path: refused — the validation gateway endpoint is not "
            "configured: %s. This is a SERVER misconfiguration, never a credential "
            "failure, and the job terminal is never used instead (D-05).",
            ", ".join(missing),
        )
        return None
    try:
        port = int(raw_port)
    except ValueError:
        _log_configuration_fault_once(
            "mt5_validation_gateway_port_not_numeric",
            "mt5 validation path: refused — %s is set but is not an integer port. "
            "This is a SERVER misconfiguration, never a credential failure.",
            _MT5_VALIDATION_GATEWAY_ENV_NAMES[1],
        )
        return None
    if not is_private_gateway_host(raw_host):
        # Phase 164.6.6 D-07 part 1 (T-134-03): refused HERE, as None, so both
        # callers take their D-05 misconfiguration path (500 + alert / the
        # RuntimeError + alert). Left to `_default_connect`, the refusal would
        # surface inside the wizard's broad connect arm as a 503 that votes on
        # `breaker:mt5-gateway`. NAME only, never the value.
        _log_configuration_fault_once(
            "mt5_validation_gateway_host_not_private",
            "mt5 validation path: refused — %s is not a private-network host "
            "(T-134-03). This is a SERVER misconfiguration, never a credential "
            "failure, and the job terminal is never used instead (D-05).",
            _MT5_VALIDATION_GATEWAY_ENV_NAMES[0],
        )
        return None
    return raw_host, port


# Phase 164.6.6 D-05 — the alert window, the prober-cadence window
# (`routers.cron._escalate_prober_cadence_gap`): at most one Sentry capture per
# site per hour, an ERROR line on every refusal.
_MT5_VALIDATION_ALERT_WINDOW_S: Final[float] = 3600.0
# Keyed PER SITE (the `routers.cron._last_prober_cadence_alert_at` WR-02 shape),
# so the worker's alert can never silence the wizard's inside one window.
_last_mt5_validation_alert_at: dict[str, float] = {}


def _reset_mt5_validation_alert() -> None:
    """Test-only: clear the per-site alert window. ⛔ Production never calls it."""
    _last_mt5_validation_alert_at.clear()


def alert_mt5_validation_gateway_unconfigured(*, site: str) -> None:
    """D-05's ALERT: a validation was refused because the validation endpoint is
    unset or malformed. Called by both validate sites BEFORE they raise.

    Cloned from ``routers.internal._alert_kek_unavailable``: an ERROR line on
    EVERY call (the rate is itself the operator's evidence), then at most one
    ``sentry_sdk.set_tag`` + ``sentry_sdk.capture_message(level="error")`` per
    ``_MT5_VALIDATION_ALERT_WINDOW_S`` PER SITE, the capture wrapped so a Sentry
    failure can never mask or alter the refusal it reports. It NEVER raises.

    ⛔ Names the two env var NAMES and the site only — never a host, port,
    terminal key or credential (T-164.6.6-20).

    ⚠️ CAVEAT THAT MUST STAY ATTACHED (carried from ``routers.cron``): delivery
    to a human depends on ``SENTRY_DSN`` staying set on the analytics service,
    whose presence was founder-confirmed on 2026-09-18 (never its value); if it
    is ever unset this alert silently degrades to the ERROR log line alone.
    """
    names = " / ".join(_MT5_VALIDATION_GATEWAY_ENV_NAMES)
    logger.error(
        "mt5 validation refused at site=%s: %s is unset or malformed. The job "
        "terminal is never used instead (D-05); this needs an operator.",
        site,
        names,
    )
    now = time.monotonic()
    last_at = _last_mt5_validation_alert_at.get(site)
    if last_at is not None and (now - last_at) < _MT5_VALIDATION_ALERT_WINDOW_S:
        return
    _last_mt5_validation_alert_at[site] = now
    try:
        sentry_sdk.set_tag("mt5_validation_gateway_unconfigured", site)
        sentry_sdk.capture_message(
            f"MT5 validation gateway unconfigured at site={site}: {names} is unset "
            "or malformed; every key validation on this path is refused (D-05)",
            level="error",
        )
    except Exception:
        pass  # never mask the refusal via a Sentry failure


def _not_healed(
    reason: str, err: Mt5ClientError, login: int, password: str, server: str
) -> str:
    """A ``not_healed`` verdict that CARRIES THE DETAIL — WR-01.

    The verdict used to be ``not_healed:ipc_fault:code={code}`` and nothing else,
    which threw away a failure description that was already safe to log. Two
    measured consequences, both unactionable for an operator:

      * ``code=0`` is the sentinel ``_raise_last`` uses for THREE distinct faults
        — an unknown ``last_error``, a malformed ``last_error`` shape, and a
        transport raise converted by its own except arm — so the one verdict named
        neither the transport class nor the reason.
      * it named no remedy. ``-10005`` is a modal login dialog on the VNC screen;
        ``-10004`` is a dead IPC pipe. Same verdict, opposite remedies.

    ⛔ REDACTED BY VALUE, not merely shape-scrubbed. ``Mt5ClientError.__init__``
    scrubs at construction, but that scrub is SHAPE-based — and this text can be
    the TERMINAL's own ``last_error()`` message, which a broker is free to echo
    the submitted account or server back into. The three values are in scope here,
    so the by-value control travels with them exactly as it does inside the client
    (T-164.6.2-12: a value must never reach a log line).

    ⛔ ``_redact_credential_values`` is imported from ``services.mt5_client``
    despite its leading underscore, DELIBERATELY. It is the SHIPPED control and
    the phase's signature-derived gate is written against that exact name; a
    second copy here would be the drift the gate exists to prevent, and renaming
    it for tidiness would silently take it out of the gate's derivation.
    """
    detail = _redact_credential_values(str(err), login, password, server)
    return f"{_VERDICT_NOT_HEALED_PREFIX}{reason}:{detail}"


def _describe_exception_for_log(
    exc: BaseException, credentials: tuple[int, str, str] | None
) -> str:
    """The entry catch-all's scrubbed description of ``exc`` — BY VALUE whenever the
    three values are known, shape-scrubbed only when they are not.

    ⛔ HIGH-2 (secondary). The catch-all used to redact with ``scrub_freeform_string``
    ALONE, which ``_redact_credential_values``' own docstring records as a MEASURED
    NO-OP on the ``mt5linux`` kwargs-repr shape: its ``SENSITIVE_KEY_VALUE`` pattern
    needs ``key`` immediately followed by ``[:=]`` and the repr puts a closing quote
    between them. So the handler was safe only by the CALLEE's discipline — every
    credential-carrying verb in ``mt5_client`` redacts before raising — and not by
    its own. That is an inherited property, and an inherited property is one refactor
    away from being absent: the catch-all is the LAST handler on a path that carries
    a live broker password to a PUBLIC Actions log.

    ⛔ THE ``None`` ARM IS NOT A WEAKENING, IT IS THE CORRECT BEHAVIOUR. Before the
    credential read there is nothing to redact by value, and ``_redact_credential_values``
    with placeholder values would be actively WORSE than useless: a placeholder login
    of ``0`` would replace every ``0`` in the message with the marker, mangling the
    very text an operator needs. The callers that HAVE credentials pass them.

    ⛔ ``str(exc)`` is evaluated HERE, inside the function the caller invokes from
    inside its own nested guard (IN-06), so an exception whose ``__str__`` misbehaves
    still lands on the fallback line rather than escaping.
    """
    text = str(exc)
    if credentials is None:
        return str(scrub_freeform_string(text))
    login, password, server = credentials
    return _redact_credential_values(text, login, password, server)


def _describe_capture_failure(exc: Exception) -> str:
    """The CLASS and the typed code of a failed capture read — never ``str(exc)``,
    which for a raw transport raise is remote text."""
    code = exc.code if isinstance(exc, Mt5ClientError) else None
    return f"exc_class={type(exc).__name__} code={code}"


def _capture_wedge_evidence(
    client: Mt5Client, env_server: str, deadline: float
) -> str:
    """Read what the recycle is about to ERASE, and return it as a log fragment.

    ⭐ WHY (``TODOS.md`` ``MT5-SWITCH-WEDGE-CAUSE-01``). The wedge is PROCESS state,
    so the recycle that heals it also destroys the only evidence for its cause:
    the terminal build (the self-update hypothesis, D-03a) and which broker server
    the session was on (the same-server-vs-different-server hypothesis). Unless
    this runs FIRST, every automatically healed wedge heals with no evidence and
    that item can never close by waiting.

    ⛔ CREDENTIAL-FREE. ``terminal_info()`` and ``account_info()`` read the
    CURRENT session; neither logs in, and nothing here ever calls a login. If the
    terminal cannot answer them, the fields are recorded ``not_captured`` WITH
    THE REASON — never filled in by logging in.

    ⚠️ SFH-04 (164.6.5 review round 1) — ON A TRUE ``-10005`` THIS IS EXPECTED
    TO CAPTURE NOTHING. Both reads cross the SAME terminal IPC the fault says is
    dead (the MetaTrader5 package does not serve them for a session whose
    ``initialize()`` just failed), so the realistic line is ``not_captured``
    with the reason. It is kept because a partial wedge may still answer, and
    the line says so honestly either way. The build evidence that does NOT need
    that IPC — the terminal executable's file version — is read bridge-side by
    the recycle's own remote source and logged as ``file_versions`` on the
    recycle's lines. The broker server on each side of a switch is recorded by
    nothing automatic (``TODOS.md`` ``MT5-SWITCH-WEDGE-CAUSE-01``).

    ⛔ THE BROKER SERVER IS RECORDED AS A COMPARISON, NEVER AS A NAME. This
    module's rule is that a value never reaches a log line (T-164.6.2-12), and
    ``MT5_SERVER`` is one of the three values ``_not_healed`` redacts BY VALUE, so
    logging the session's server name would log that value whenever the terminal
    is on the environment account. ``TODOS.md`` says the same of the repo: keep
    server names private and bring only the verdicts in. So the line says whether
    the session's server EQUALS the environment's — the verdict, not the name.
    No account number is read into the line at all.

    ⛔ IT CANNOT RAISE, except ``Mt5SessionAbandoned``, which is re-raised for the
    same reason ``_escalate_ipc_fault`` re-raises it. ⚠️ A terminal that does not
    answer ``terminal_info()`` is not asked ``account_info()``: a terminal that
    cannot answer one cannot answer the other. ⛔ And the capture is BUDGET-GATED
    (WR-04): it is read only when the time left covers it AND the recycle and its
    relaunch reading, which leaves the post-relaunch check its crossing
    (``_ESCALATION_RESERVE_CROSSINGS``).
    Evidence is never bought with the recovery it exists to precede.

    ⛔ WR-03 (164.6.5 review round 2) — the two reads were charged their ANSWERING
    cost, one rpyc crossing per field, and at that cost this capture was skipped
    at every budget the window admits. ⭐ WR-03 ROOT CAUSE (same day): they are
    now ONE bridge-side crossing (``Mt5Client.session_snapshot``), so at the
    derived default the capture RUNS on every escalation.
    """
    if not _affordable(
        deadline, _SESSION_SNAPSHOT_CROSSINGS + _ESCALATION_RESERVE_CROSSINGS
    ):
        return (
            "build=not_captured connected=not_captured "
            "session_server_matches_env=not_captured (terminal_info and "
            "account_info skipped: the heal budget left is reserved for the "
            "recycle and its relaunch; the bridge-side file version is on the "
            "recycle's own line)"
        )
    try:
        snapshot = client.session_snapshot(
            expected_login=None, expected_server=env_server
        )
    except Mt5SessionAbandoned:
        raise
    except Exception as exc:  # noqa: BLE001 — a capture must never block the recycle
        return (
            "build=not_captured connected=not_captured "
            "session_server_matches_env=not_captured "
            f"(the session read failed: {_describe_capture_failure(exc)}; the "
            "bridge-side file version is on the recycle's own line)"
        )
    if snapshot.terminal_code is not None:
        return (
            "build=not_captured connected=not_captured "
            "session_server_matches_env=not_captured "
            f"(terminal_info failed: code={snapshot.terminal_code}; account_info "
            "skipped; the bridge-side file version is on the recycle's own line)"
        )
    build_part = (
        f"build={snapshot.build}"
        if snapshot.build is not None
        else "build=not_captured (terminal_info carried no integer build)"
    )
    connected_part = (
        f"connected={snapshot.connected}"
        if snapshot.connected is not None
        else "connected=not_captured (terminal_info carried no boolean)"
    )
    if snapshot.account_code is not None:
        server_part = (
            "session_server_matches_env=not_captured "
            f"(account_info failed: code={snapshot.account_code})"
        )
    elif snapshot.server_matches is not None:
        server_part = f"session_server_matches_env={snapshot.server_matches}"
    else:
        server_part = (
            "session_server_matches_env=not_captured "
            "(account_info carried no server)"
        )
    return f"{build_part} {connected_part} {server_part}"


def _count(verdict: dict[str, object], key: str) -> int | None:
    """One of the verb's integer counts, or ``None`` when it is not an int."""
    value = verdict.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _recycle_landed(verdict: dict[str, object]) -> bool:
    """Whether the recycle ended EVERY terminal process it matched, and matched
    at least one. ⛔ The counts are the ONLY evidence the terminate landed
    (``deploy/mt5-gateway/railway-gateway.md``, D-05 caveats): the Wine-side
    ``TerminateProcess`` path has never run live."""
    matched = _count(verdict, "matched")
    terminated = _count(verdict, "terminated")
    return (
        matched is not None
        and terminated is not None
        and matched >= 1
        and terminated == matched
    )


class ScrubDeleteFaults(NamedTuple):
    """Why a scrub verdict's DELETE is not proven clean, one flag per reason
    (``scrub_delete_faults``). ``refused`` is read separately by each consumer;
    these are the faults a ``refused == 0`` verdict can still carry.

    * ``accounts_errored``: ``accounts_errors`` is not an empty list, so the
      saved-account database (``Config/accounts.dat``) is not proven gone.
    * ``trades_errored``: the verb was asked to delete the deal caches
      (``delete_trades == 1``) and ``trades_errors`` is not an empty list, so an
      account-named cache is not proven gone. Always False when the caches
      were not to be deleted.
    * ``profile_tripwire``: ``profile_accounts_found`` is not the int 0. The
      literal counts an ``accounts.dat`` under the per-user profile directory and
      NEVER deletes one (CONTEXT S-07 measured that directory holding none), so
      a non-zero or unreadable count means the measured layout no longer holds
      and a saved account may survive every scrub.
    """

    accounts_errored: bool
    trades_errored: bool
    profile_tripwire: bool

    @property
    def any(self) -> bool:
        return self.accounts_errored or self.trades_errored or self.profile_tripwire


def scrub_error_count(verdict: dict[str, object], key: str) -> int | None:
    """The length of one of the verdict's error lists, or ``None`` when the
    field is missing or unparsed. Counts only: the class names stay in the
    verb's own log line."""
    value = verdict.get(key)
    return len(value) if isinstance(value, list) else None


def scrub_delete_faults(
    verdict: dict[str, object], *, delete_trades: int
) -> ScrubDeleteFaults:
    """⛔ THE ONE DEFINITION of a clean scrub delete beyond ``refused == 0``
    (164.6.6.1 review round 1, SFH-01 / SFH-02 / WR-01 / WR-03). Both scrub
    consumers call it: the validation scrub's classifier
    (``mt5_terminal_scrub._classify``) and the jobs-terminal escalation's level
    ladder (``_escalate_ipc_fault``). Before it existed the two disagreed about
    the same verdict, and neither read ``trades_errors`` or acted on the profile
    tripwire.

    FAIL CLOSED. A field that is missing, or that the client's parser turned
    into ``"unparsed"``, counts as a fault: an unreadable error list did not
    prove the delete clean. Only meaningful on a verdict the verb RETURNED; a
    caller whose verb raised has an empty verdict and must not ask."""
    accounts_errors = verdict.get("accounts_errors")
    trades_errors = verdict.get("trades_errors")
    profile_found = verdict.get("profile_accounts_found")
    return ScrubDeleteFaults(
        accounts_errored=not (
            isinstance(accounts_errors, list) and len(accounts_errors) == 0
        ),
        trades_errored=delete_trades == 1
        and not (isinstance(trades_errors, list) and len(trades_errors) == 0),
        profile_tripwire=not (
            isinstance(profile_found, int)
            and not isinstance(profile_found, bool)
            and profile_found == 0
        ),
    )


def _relaunch_as_house(
    client: Mt5Client, house: tuple[int, str, str], deadline: float
) -> tuple[bool, int | None, int, bool]:
    """Relaunch an ended (and perhaps scrubbed) terminal with the HOUSE
    credentials, and keep trying, CREDENTIALED, until it authorizes, the broker
    refuses the triple (``-6``), the settle window passes, or the heal budget can
    no longer cover another try. Returns ``(authorized, code, polls, settled)``.

    ⛔ NEVER A BARE ``initialize()`` (164.6.6.1 plan 03). On a terminal whose
    ``accounts.dat`` was deleted a bare call reads ``-10005`` after about 25 s
    (CONTEXT S-10) and, on a killed terminal, LAUNCHES it outside this call's
    control (S-09). So this never calls ``assert_session_authorized``; every try
    is ``initialize_with_credentials``, which redacts the triple by value on
    every failure arm (T-134-01). The budget gating is ``_watch_relaunch``'s
    (164.6.5 WR-02, deleted here): a try is started only if the pause and one
    whole credentialed reading still fit before ``deadline``.

    ``settled`` is whether the whole ``_RELAUNCH_SETTLE_S`` window was watched,
    counted from this call's start, which is after the kill. ``Mt5SessionAbandoned``
    propagates: the terminate has already crossed, so the attempt stands.
    """
    started = _clock()

    def _try() -> tuple[bool, int | None]:
        try:
            client.initialize_with_credentials(*house)
        except Mt5SessionAbandoned:
            raise
        except Mt5ClientError as exc:
            return False, exc.code
        except Exception:  # noqa: BLE001 — the verb wraps transport raises; belt and braces
            return False, _MT5_UNATTRIBUTED_CODE
        return True, None

    authorized, code = _try()
    polls = 0
    while not authorized and code != _MT5_NO_AUTHORIZED_ACCOUNT_CODE:
        if _clock() - started >= _RELAUNCH_SETTLE_S:
            return authorized, code, polls, True
        if not _affordable(
            deadline - _RELAUNCH_POLL_INTERVAL_S,
            _CREDENTIALED_RELAUNCH_READING_CROSSINGS,
        ):
            return authorized, code, polls, False
        _sleep(_RELAUNCH_POLL_INTERVAL_S)
        polls += 1
        authorized, code = _try()
    return authorized, code, polls, True


#: What the post-relaunch check came to (SFH-07 / SFH-08). ⛔ The order is the
#: precedence: a definite mismatch outranks a check that could not complete.
_POST_RELAUNCH_VERIFIED: Final[str] = "verified"
_POST_RELAUNCH_UNVERIFIED: Final[str] = "unverified"
_POST_RELAUNCH_DEGRADED: Final[str] = "degraded"


def _read_post_relaunch_state(
    client: Mt5Client, env_login: int, env_server: str, deadline: float
) -> tuple[str, str]:
    """After a relaunch the detector called AUTHORIZED, read what "authorized"
    did not say. Returns ``(log fragment, status)``, the status one of
    ``_POST_RELAUNCH_VERIFIED`` / ``_UNVERIFIED`` / ``_DEGRADED``.

    ⛔ SFH-07 (164.6.5 review round 1). A bare ``initialize()`` returning True
    says a session exists — not WHICH account it is on, nor whether the terminal
    is connected to the trade server. The D-05 record MEASURED a relaunched
    terminal coming back on "whichever account the last service call had logged
    in to" (a different account in run 2), and the four-day incident's Journal
    showed a terminal `disconnected` with no reconnect. Either way the heal's
    purpose — the house account's session — is not restored, the monitor's next
    probe reads `already_authorized`, and nothing said so.

    ⛔ SFH-08 (164.6.5 review round 2) — "degraded" used to be set only by a
    definite ``connected=False`` or login mismatch, so a check that could not
    complete (``not_read``, a failed ``terminal_info()``, a field not captured)
    left the recovery at INFO, "nothing for anyone to do". Now:

      * ``degraded`` — MEASURED not the house session: disconnected, another
        login, or another broker server (a login is only unique per server).
      * ``unverified`` — the check could not complete, whatever the reason.
      * ``verified`` — connected, on the environment's login and server.

    ⛔ CREDENTIAL-FREE and VALUE-FREE: one read of the CURRENT session, no login.
    The account and server are recorded as EQUALITY VERDICTS against the
    environment's, never as values — the same rule the pre-recycle capture
    follows (T-164.6.2-12); no account number reaches the line, and none reaches
    this module (``Mt5Client.session_snapshot`` compares inside the client).

    ⛔ BUDGET-GATED, like every optional read (WR-04): it is taken only if it
    still fits before ``deadline``, else recorded ``not_read`` with the reason.
    ⭐ WR-03 ROOT CAUSE (164.6.5 review round 2, 2026-09-25): it is ONE crossing
    and it is on the derived default's path, so at that default a relaunch the
    verb's own probe saw answer is always checked. It cannot raise except
    ``Mt5SessionAbandoned``.
    """
    if not _affordable(deadline, _SESSION_SNAPSHOT_CROSSINGS):
        return (
            "post_relaunch=not_read (the heal budget left cannot cover it)",
            _POST_RELAUNCH_UNVERIFIED,
        )
    try:
        snapshot = client.session_snapshot(
            expected_login=env_login, expected_server=env_server
        )
    except Mt5SessionAbandoned:
        raise
    except Exception as exc:  # noqa: BLE001 — a read must never undo the verdict
        why = _describe_capture_failure(exc)
        return (
            f"post_relaunch: connected=not_captured (the session read failed: {why}) "
            "session_account_matches_env=not_captured "
            "session_server_matches_env=not_captured",
            _POST_RELAUNCH_UNVERIFIED,
        )
    if snapshot.terminal_code is not None:
        return (
            "post_relaunch: connected=not_captured (terminal_info failed: "
            f"code={snapshot.terminal_code}) session_account_matches_env="
            "not_captured (account_info not read: the terminal did not answer)",
            _POST_RELAUNCH_UNVERIFIED,
        )
    degraded = False
    complete = True
    if snapshot.connected is not None:
        connected_part = f"connected={snapshot.connected}"
        degraded = not snapshot.connected
    else:
        complete = False
        connected_part = "connected=not_captured (no boolean)"
    if snapshot.account_code is not None:
        complete = False
        account_part = (
            "session_account_matches_env=not_captured (account_info failed: "
            f"code={snapshot.account_code})"
        )
    else:
        if snapshot.login_matches is not None:
            account_part = f"session_account_matches_env={snapshot.login_matches}"
            degraded = degraded or not snapshot.login_matches
        else:
            complete = False
            account_part = "session_account_matches_env=not_captured (no login)"
        if snapshot.server_matches is not None:
            account_part += (
                f" session_server_matches_env={snapshot.server_matches}"
            )
            degraded = degraded or not snapshot.server_matches
        else:
            complete = False
            account_part += " session_server_matches_env=not_captured (no server)"
    if degraded:
        status = _POST_RELAUNCH_DEGRADED
    elif complete:
        status = _POST_RELAUNCH_VERIFIED
    else:
        status = _POST_RELAUNCH_UNVERIFIED
    return f"post_relaunch: {connected_part} {account_part}", status


class ScrubRelaunchResult(NamedTuple):
    """What ``scrub_and_relaunch_as_house`` did, as structured fields only:
    counts, codes, class names and durations, never a credential or remote text.

    ``relaunch_elapsed_s`` is seconds on the heal clock from the verb's return to
    the authorizing call, or to the last attempt when none authorized; ``None``
    when no relaunch ran. Plan 07's L-3 reads it as the jobs path's measured
    relaunch time. ``post_status`` is a ``_POST_RELAUNCH_*`` value, or
    ``"not_reached"`` when the relaunch did not authorize."""

    verdict: dict[str, object]
    verb_exc_class: str | None
    verb_exc_code: int | None
    authorized: bool | None
    relaunch_code: int | None
    relaunch_polls: int
    relaunch_elapsed_s: float | None
    settled: bool
    post_status: str
    post_fragment: str


#: `ScrubRelaunchResult.post_status` when the post-relaunch check never ran.
_POST_RELAUNCH_NOT_REACHED: Final[str] = "not_reached"


def heal_deadline(budget_s: float) -> float:
    """The deadline ``budget_s`` from now on the heal's own clock (``_clock``).
    Public so the validation-terminal scrub (plan 05) budgets on the same clock
    seam as the jobs-terminal escalation."""
    return _clock() + budget_s


def scrub_and_relaunch_as_house(
    client: Mt5Client,
    *,
    house: tuple[int, str, str],
    deadline: float,
    delete_trades: int,
) -> ScrubRelaunchResult:
    """End the terminal, delete its saved accounts, and relaunch it with the
    HOUSE credentials (164.6.6.1 plan 03, CONTEXT D-04 (i)). Public: the
    validation-terminal scrub (plan 05) reuses it.

    In order, inside the caller's ONE lease and against its ONE ``deadline``:

      1. ``client.scrub_terminal_account_data(delete_trades=...)``. It records
         the relaunch debt before it crosses and never relaunches.
      2. Whatever the verb returned OR raised, a credentialed relaunch
         (``_relaunch_as_house``), if the budget still covers one credentialed
         reading. ⛔ Keyed on "a terminal may have been ended", never on
         ``refused``: ``terminated >= 1`` with ``exited < matched`` is refused
         AND killed, and a verb that raised after crossing may have killed it.
      3. When it authorized, the house-equality check
         (``_read_post_relaunch_state``).
      4. ``clear_mt5_relaunch_debt`` ONLY on a house-VERIFIED session. Degraded,
         unverified, refused, pending and failed outcomes all keep the debt, so
         the next tick pays it (D-10, plan 04).

    ⛔ The house triple reaches ``initialize_with_credentials`` and nothing else:
    not the scrub verb (whose only argument is an int flag), not a log line, not
    the result. ⛔ It never raises ``Exception``. ``Mt5SessionAbandoned`` (a
    plain exception on purpose, D-42) propagates from any step.
    """
    verdict: dict[str, object] = {}
    verb_exc_class: str | None = None
    verb_exc_code: int | None = None
    try:
        verdict = client.scrub_terminal_account_data(delete_trades=delete_trades)
    except Mt5SessionAbandoned:
        raise
    except Exception as exc:  # noqa: BLE001 — the verb's failure is a verdict, never a raise
        # ⛔ The CLASS and the typed code only — never `str(exc)`, which for a
        # raw transport raise is remote text.
        verb_exc_class = type(exc).__name__
        verb_exc_code = exc.code if isinstance(exc, Mt5ClientError) else None
    returned_at = _clock()
    authorized: bool | None = None
    relaunch_code: int | None = None
    polls = 0
    elapsed: float | None = None
    settled = True
    post_status = _POST_RELAUNCH_NOT_REACHED
    post_fragment = ""
    if _affordable(deadline, _CREDENTIALED_RELAUNCH_READING_CROSSINGS):
        authorized, relaunch_code, polls, settled = _relaunch_as_house(
            client, house, deadline
        )
        elapsed = _clock() - returned_at
        if authorized:
            post_fragment, post_status = _read_post_relaunch_state(
                client, house[0], house[2], deadline
            )
    else:
        post_fragment = "relaunch=not_read (the heal budget left cannot cover it)"
    if post_status == _POST_RELAUNCH_VERIFIED:
        clear_mt5_relaunch_debt(client.terminal_key)
    return ScrubRelaunchResult(
        verdict=verdict,
        verb_exc_class=verb_exc_class,
        verb_exc_code=verb_exc_code,
        authorized=authorized,
        relaunch_code=relaunch_code,
        relaunch_polls=polls,
        relaunch_elapsed_s=elapsed,
        settled=settled,
        post_status=post_status,
        post_fragment=post_fragment,
    )


def _classify_scrub_relaunch(result: ScrubRelaunchResult) -> str:
    """Map a scrub-and-relaunch result to one escalation kind, from its
    STRUCTURED fields only.

    ⛔ THE COUNTS DECIDE FIRST (164.6.5 WR-03 / SFH-01, kept): a scrub that did
    not end every terminal it matched, or matched none, is ``recycle_not_landed``
    whatever the relaunch said. Then the relaunch: authorized is ``recycled`` /
    ``recycled_degraded`` / ``recycled_unverified`` by what the house-equality
    check came to; ``-6`` is the broker REFUSING the house triple
    (``recycled_house_refused``), since the relaunch is credentialed now; a
    relaunch the budget could not watch through the settle window is
    ``relaunch_pending`` (WR-02); only a watched-and-failed one is
    ``still_faulted``."""
    if result.verb_exc_class is not None:
        return KIND_IPC_FAULT_RECYCLE_FAILED
    if not _recycle_landed(result.verdict):
        return KIND_IPC_FAULT_RECYCLE_NOT_LANDED
    if result.authorized:
        if result.post_status == _POST_RELAUNCH_VERIFIED:
            return KIND_IPC_FAULT_RECYCLED
        if result.post_status == _POST_RELAUNCH_DEGRADED:
            return KIND_IPC_FAULT_RECYCLED_DEGRADED
        return KIND_IPC_FAULT_RECYCLED_UNVERIFIED
    if result.relaunch_code == _MT5_NO_AUTHORIZED_ACCOUNT_CODE:
        return KIND_IPC_FAULT_RECYCLED_HOUSE_REFUSED
    if not result.settled or result.authorized is None:
        # ⛔ WR-02 — the budget ran out before the settle window did, or could
        # not cover the relaunch at all. Not shown to fail, so never
        # `still_faulted`.
        return KIND_IPC_FAULT_RECYCLED_RELAUNCH_PENDING
    return KIND_IPC_FAULT_RECYCLED_STILL_FAULTED


def _escalate_ipc_fault(
    client: Mt5Client,
    code: int,
    env_server: str,
    deadline: float | None = None,
    env_login: int | None = None,
    env_password: str | None = None,
) -> str | None:
    """ACT on an ``ipc_fault`` reading by recycling the terminal PROCESS (D-08),
    once per run, and return the escalation kind — or ``None`` when it did not run.

    ⛔ ESCALATING MEANS RECYCLING THE PROCESS, NEVER ANOTHER LOGIN. Phase 164.6.2's
    heal read ``not_healed:ipc_fault`` five consecutive times on 2026-09-21
    because it cannot drive a terminal whose IPC is dead; re-sending a credential
    goes through exactly the half that is not answering. The recycle verb takes NO
    credential and structurally cannot (plan 02), and nothing here passes one.

    ⭐ AMENDED 2026-10-04 (Phase 164.6.6.1 plan 03, the founder's D-04 (i)). The
    process is still ENDED FIRST, because a credential alone cannot get through a
    wedged terminal. But the ending is now ``scrub_terminal_account_data``, which
    also deletes the saved ``accounts.dat``, and the relaunch that follows is
    CREDENTIALED with the house triple (``scrub_and_relaunch_as_house``). That
    reverses 164.6.5 D-08's "the escalation never sends a credential" for the
    RELAUNCH only: a bare relaunch reads the saved copy, and a stale saved house
    password there is the 2026-10-04 L7 Login-dialog wedge. The terminate-and-
    delete verb itself still takes no credential. ``env_password`` is threaded
    from ``_heal_blocking``'s own parameters; ⛔ ``MT5_PASSWORD`` is never re-read
    here (that would be a second credential source). Without a house login and
    password nothing is ended or deleted (``recycle_no_house_credentials``).

    ⭐ WHY IT IS CALLED FROM INSIDE ``_heal_blocking`` AND NOT FROM THE ASYNC
    CALLER. The caller's verdict log and episode record run AFTER its
    ``async with`` has released the terminal lease, so an escalation there would
    recycle the terminal out from under whoever acquired it next — and fixing
    that with a second acquisition is the "second lease acquisition, second
    budget" this module's docstring refuses. Here it inherits the ONE lease and
    the ONE whole-heal budget. ⚠️ That budget was re-derived for this path —
    first probe, the evidence capture, the recycle, its relaunch and the
    post-relaunch check — at the ``_MT5_RELOGIN_ROUND_TRIPS`` definition, and a
    test counts it.

    ⛔ THE CODE GATE: ``_RECYCLE_REACHABLE_IPC_CODES`` only. A DETACHED bridge
    (``-10004``) gives the recycle nothing to talk to, and ``-10003`` and the
    ``0`` sentinel are not the wedge. ⛔ Those readings are NEUTRAL to the
    once-per-run gate (WR-08): they measured no answer from the terminal, so they
    neither end the run nor start one. Only the terminal MEASURED answering
    re-arms it — see the gate's comment in ``mt5_session_episodes``.

    ⛔ THE DEBOUNCE: without it, a ten-minute cadence recycles a shared terminal
    every ten minutes forever when the recycle does not help — a self-inflicted
    outage wearing a recovery's name. Five readings of one wedge, one attempt.
    ⛔ AND THE CAP (CR-01, review round 2; CONTEXT D-18): the debounce is per
    RUN, and a run ends whenever the terminal answers, so a wedge that returns
    after every working recycle is capped separately at
    ``IPC_FAULT_RECYCLE_CAP`` recycles per rolling ``_IPC_FAULT_RECYCLE_WINDOW_S``.

    ⛔ IT CANNOT RAISE OUT OF THE HEAL, and that is the highest-severity property
    in this module: a raise here unwinds the heal and, from inside the entry's
    handler, would reach ``_crash_handler`` — a SILENT ANALYTICS outage caused by
    an MT5 fault. Every ``Exception`` the recycle can raise becomes
    ``KIND_IPC_FAULT_RECYCLE_FAILED``. ⛔ EXCEPT ``Mt5SessionAbandoned``, which is
    re-raised untouched: it is a plain exception ON PURPOSE (D-42) so an
    our-infrastructure refusal is never re-classified, and the entry's catch-all
    already logs its class. Widening this guard to swallow it would hide exactly
    the zombie-thread refusal the fence exists to surface.

    ⭐ ITS OWN LOG LINE, at a severity that follows the outcome, so an operator
    can see a recovery was attempted WITHOUT the verdict string moving — the
    ``not_healed:`` prefix is a contract downstream keys off. The line carries
    kinds, codes and counts only; never a credential, host, port or account.
    """
    if deadline is None:
        deadline = _clock() + _relogin_budget_s()
    now = _clock()
    # ⭐ WR-02 / R2-SFH-03 (164.6.5 review round 2) — FOR EVERY CODE: if the
    # terminal answered anyone since this run started (the job path's `login()`
    # included), the run is over, gate AND alarm, before this reading is counted.
    answers = mt5_terminal_answer_count(client.terminal_key)
    # ⭐ SFH-03 / R2-SFH-02 — every fault reading extends the persistence run.
    # The `0` sentinel measured nothing and neither starts nor extends one.
    if code not in _IPC_FAULT_ALARM_EXEMPT_CODES:
        since: float | None = note_ipc_fault_reading(now, answers)
    else:
        end_ipc_fault_run_if_answered(answers)
        since = None
    if code not in _RECYCLE_REACHABLE_IPC_CODES:
        # ⛔ WR-08 — NO re-arm here. `0` measured nothing, and `-10003` / `-10004`
        # are the terminal NOT answering either; re-arming on them let a flaky
        # bridge (-10005, 0, -10005, 0 ...) recycle the shared terminal every
        # other tick.
        if since is not None and ipc_fault_alarm_due(
            now, _IPC_FAULT_ALARM_INTERVAL_S, attempted=False
        ):
            # ⛔ SFH-03 — never escalated, so before this it never reached ERROR
            # at all, however long it lasted.
            mark_ipc_fault_alarm(now)
            logger.error(
                "mt5 session heal: ipc_fault code=%s has PERSISTED for %d min — the "
                "terminal-process recycle cannot reach this code, so nothing "
                "automatic will clear it; an OPERATOR is needed. Re-raised at "
                "ERROR at most every %d min while it persists.",
                code,
                int((now - since) // 60),
                int(_IPC_FAULT_ALARM_INTERVAL_S // 60),
            )
        return None
    if not ipc_fault_escalation_armed():
        if since is not None and ipc_fault_alarm_due(
            now, _IPC_FAULT_ALARM_INTERVAL_S, attempted=True
        ):
            # ⛔ SFH-03 — THE DEBOUNCE IS ON THE ACTION, NOT ON THE ALARM. A wedge
            # the recycle did not cure used to be ONE ERROR at hour 0 and then
            # INFO lines for as long as it lasted (four days, on the record).
            mark_ipc_fault_alarm(now)
            logger.error(
                "mt5 session heal: ipc_fault code=%s PERSISTS %d min into this run, "
                "after its one terminal-process recycle — an OPERATOR is needed. "
                "The recycle is NOT repeated (once per run; the terminal answering "
                "re-arms it); this alarm is re-raised at ERROR at most every %d min "
                "while it persists.",
                code,
                int((now - since) // 60),
                int(_IPC_FAULT_ALARM_INTERVAL_S // 60),
            )
        else:
            logger.info(
                "mt5 session heal: ipc_fault code=%s persists — the terminal-process "
                "recycle was already attempted in this run of consecutive faults, "
                "so it is NOT repeated (once per run; the terminal answering "
                "re-arms it).",
                code,
            )
        return None
    if (
        ipc_fault_recycles_in_window(now, _IPC_FAULT_RECYCLE_WINDOW_S)
        >= IPC_FAULT_RECYCLE_CAP
    ):
        # ⛔ CR-01 (164.6.5 review round 2) — CAPPED. The recycle already ran
        # the cap's number of times inside the window, each after the terminal
        # had answered, and the wedge came back. Recycling the ONE shared
        # terminal again is not a recovery; it is the Cause B pattern, and a
        # human is needed. Nothing is read or recycled until the oldest recycle
        # leaves the window. ⭐ SFH-09 — its own kind.
        if ipc_fault_cap_alarm_due(now, _IPC_FAULT_ALARM_INTERVAL_S):
            mark_ipc_fault_cap_alarm(now)
            log_capped = logger.error
        else:
            log_capped = logger.warning
        log_capped(
            "mt5 session heal: ipc_fault code=%s — REPEATED WEDGE, recycle CAPPED: "
            "the terminal-process recycle already ran %d times in the last %d min, "
            "each after the terminal had answered, and the wedge came back. That "
            "recurrence is the Cause B signal (MT5-SWITCH-WEDGE-CAUSE-01: an "
            "account switch on the shared terminal re-wedging it); an OPERATOR is "
            "needed. NOT recycled now; the cap frees once the oldest recycle is "
            "%d min old. Raised at ERROR at most every %d min while capped.",
            code,
            IPC_FAULT_RECYCLE_CAP,
            int(_IPC_FAULT_RECYCLE_WINDOW_S // 60),
            int(_IPC_FAULT_RECYCLE_WINDOW_S // 60),
            int(_IPC_FAULT_ALARM_INTERVAL_S // 60),
        )
        return KIND_IPC_FAULT_RECYCLE_CAPPED
    # ⭐ EVIDENCE FIRST (`MT5-SWITCH-WEDGE-CAUSE-01`): the recycle erases it.
    # Logged on its own line BEFORE the recycle is attempted, so the evidence is
    # on record even if the recycle then hangs past the budget.
    try:
        evidence = _capture_wedge_evidence(client, env_server, deadline)
    except Mt5SessionAbandoned:
        raise
    except Exception as exc:  # noqa: BLE001 — belt and braces; see the docstring
        evidence = (
            "not_captured (the capture itself failed: "
            f"{_describe_capture_failure(exc)})"
        )
    logger.warning(
        "mt5 session heal: ipc_fault code=%s — pre-recycle wedge evidence "
        "(MT5-SWITCH-WEDGE-CAUSE-01; read credential-free, no login made): %s",
        code,
        evidence,
    )
    # ⛔ WR-01 — CLAIMED HERE, immediately before the recycle, and NOT as the
    # escalation's first act. An escalation abandoned during the capture used to
    # have spent the run's one attempt already, with no process ended, so every
    # later `-10005` was debounced until a redeploy.
    if not _affordable(deadline, SCRUB_RELAUNCH_RESERVE_CROSSINGS):
        # ⛔ WR-04 / SFH-06 — NEVER START A RECYCLE THE BUDGET CANNOT FINISH.
        # ⛔ 164.6.6.1 (W-2) — nor a scrub: the time left must cover the scrub
        # AND a credentialed relaunch reading, or the terminal could be left
        # logged out with its saved login deleted. Nothing is deleted here. Under
        # the derived default this cannot happen (the unconditional path is what
        # the default is derived from); it is reachable when `MT5_RELOGIN_BUDGET_S`
        # is set below that default. Killing the shared terminal and then being
        # abandoned before the relaunch probe is the worst outcome here, so the
        # attempt is NOT spent and NOT made.
        #
        # ⛔ WR-01 / R2-SFH-01 (164.6.5 review round 2) — AND IT GOES THROUGH THE
        # PERSISTENCE ALARM. The budget comes from the same variable every tick,
        # so "the next reading will try again" never comes true: this exit used
        # to be a WARNING per tick, forever, with no recycle and no ERROR — the
        # four-day shape. It is a server misconfiguration preventing a recovery,
        # so the first due reading is an ERROR that names the variable.
        # ⭐ SFH-09 — the step ran and declined, so it returns its own kind.
        if since is not None and ipc_fault_alarm_due(
            now, _IPC_FAULT_ALARM_INTERVAL_S, attempted=False
        ):
            mark_ipc_fault_alarm(now)
            logger.error(
                "mt5 session heal: ipc_fault code=%s has PERSISTED for %d min and the "
                "terminal-process recycle was NOT attempted on any reading of it: "
                "the heal budget cannot cover the recycle and its relaunch probe, "
                "because %s is set below its derived default. Nothing automatic "
                "will clear it until that variable is corrected; an OPERATOR is "
                "needed. Re-raised at ERROR at most every %d min while it persists.",
                code,
                int((now - since) // 60),
                _MT5_RELOGIN_BUDGET_ENV,
                int(_IPC_FAULT_ALARM_INTERVAL_S // 60),
            )
        else:
            logger.warning(
                "mt5 session heal: ipc_fault code=%s — the terminal-process recycle "
                "was NOT attempted: the heal budget left cannot cover the recycle "
                "and its relaunch probe (%s is set below its derived default?). The "
                "attempt is not spent; a persisting fault is raised at ERROR once it "
                "has lasted %d min.",
                code,
                _MT5_RELOGIN_BUDGET_ENV,
                int(_IPC_FAULT_ALARM_INTERVAL_S // 60),
            )
        return KIND_IPC_FAULT_RECYCLE_SKIPPED_BUDGET
    if env_login is None or env_password is None:
        # ⛔ 164.6.6.1 plan 03 — NOTHING IS ENDED OR DELETED WITHOUT THE HOUSE
        # TRIPLE TO RELAUNCH WITH. A scrub deletes the saved login; with no
        # credential to relaunch on, it would leave the shared terminal logged
        # out with nothing able to bring it back. No fallback to the bare recycle
        # either (that is the L7 shape). The attempt is not spent.
        logger.error(
            "mt5 session heal: ipc_fault code=%s — the terminal-process recycle "
            "with a saved-account scrub was NOT attempted: no house login or "
            "password reached the escalation, so nothing could relaunch the "
            "terminal as house. Nothing was ended or deleted; an OPERATOR is "
            "needed (%s).",
            code,
            KIND_IPC_FAULT_RECYCLE_NO_HOUSE_CREDENTIALS,
        )
        return KIND_IPC_FAULT_RECYCLE_NO_HOUSE_CREDENTIALS
    recent_recycles = claim_ipc_fault_escalation(
        _clock(), _IPC_FAULT_RECYCLE_WINDOW_S
    )
    try:
        # ⭐ 164.6.6.1 plan 03, D-04 (i) — THE SCRUB REPLACES THE RECYCLE. It ends
        # the terminal, deletes its saved accounts and relaunches it with the
        # HOUSE credentials. ⛔ Never recycle-then-scrub: the recycle's own bare
        # relaunch would bring the terminal back from the stale saved copy (the
        # L7 shape) and the delete would then run under a live terminal (A4).
        result = scrub_and_relaunch_as_house(
            client,
            house=(env_login, env_password, env_server),
            deadline=deadline,
            delete_trades=_JOB_TERMINAL_DELETE_TRADES,
        )
    except Mt5SessionAbandoned as exc:
        # ⛔ WR-01 — `terminal_scrub` is the verb's OWN first-statement fence: it
        # refused BEFORE anything crossed, so no process was ended, nothing was
        # deleted, no debt was recorded and the attempt was not spent. Any other
        # stage is the relaunch, i.e. AFTER the terminate crossed, and the
        # attempt stands.
        #
        # ⛔ WR-02 (164.6.5 review round 2) — UNDO THE CLAIM, NOTHING MORE. This
        # refusal runs in the zombie thread after the `wait_for` fired and
        # measured nothing about the terminal, so the persistence alarm's run
        # stays exactly as it was.
        if exc.stage == _SCRUB_FENCE_STAGE:
            restore_ipc_fault_attempt()
        raise
    verdict = result.verdict
    kind = _classify_scrub_relaunch(result)
    elapsed_part = (
        "None"
        if result.relaunch_elapsed_s is None
        else str(int(round(result.relaunch_elapsed_s)))
    )
    relaunch_part = (
        f"authorized={result.authorized} relaunch_code={result.relaunch_code} "
        f"relaunch_polls={result.relaunch_polls} "
        f"relaunch_elapsed_s={elapsed_part}"
    )
    if result.verb_exc_class is not None:
        # ⛔ The CLASS and the typed code only — never `str(exc)`, which for a
        # raw transport raise is remote text. ⛔ R2-SFH-04 part 3, kept: the
        # remote call may already have ended the terminal, so the credentialed
        # relaunch above ran anyway (budget-gated) and the line says whether it
        # answered.
        detail = (
            f"exc_class={result.verb_exc_class} code={result.verb_exc_code} "
            f"post_failure_relaunch: {relaunch_part}"
        )
    else:
        detail = (
            f"matched={verdict.get('matched')} terminated={verdict.get('terminated')} "
            f"exited={verdict.get('exited')} refused={verdict.get('refused')} "
            f"accounts_deleted={verdict.get('accounts_deleted')} "
            f"accounts_missing={verdict.get('accounts_missing')} "
            # ⭐ 164.6.6.1 review round 1 (SFH-02): the COUNT, always printed.
            f"accounts_errors={scrub_error_count(verdict, 'accounts_errors')} "
            f"trades_deleted={verdict.get('trades_deleted')} "
            f"profile_accounts_found={verdict.get('profile_accounts_found')} "
            f"{relaunch_part} "
            # ⭐ 164.6.5 review round 2, Topic B — the verb's diagnostic fields,
            # each an int, a list of Win32 codes, four-int file versions or a
            # bridge-local exception CLASS name (the client admits only a
            # Python identifier there), or "unparsed". No remote free text.
            f"attempted={verdict.get('attempted')} "
            f"unprocessed={verdict.get('unprocessed')} "
            f"enumerated={verdict.get('enumerated')} "
            f"enumerate_error={verdict.get('enumerate_error')} "
            f"open_errors={verdict.get('open_errors')} "
            f"terminate_errors={verdict.get('terminate_errors')} "
            f"pid_errors={verdict.get('pid_errors')} "
            f"file_versions={verdict.get('file_versions')} "
            f"file_version_errors={verdict.get('file_version_errors')} "
            f"file_version_exc={verdict.get('file_version_exc')}"
        )
    if result.post_fragment:
        detail = f"{detail} {result.post_fragment}"
    # ⛔ CR-01 (164.6.5 review round 1) — THE RELAUNCH IS A READING, AND WHEN IT
    # MEASURED THE TERMINAL ANSWERING THE RUN IS OVER. `authorized` and `-6` are
    # both the terminal answering (`-6` is now the broker refusing the house
    # triple, which a terminal must be up to say), so either one ends this run
    # and the NEXT wedge earns its own attempt.
    # ⚠️ Decided here and APPLIED after the level ladder (WR-02, round 2): a
    # run that is over must not be stamped with this line's alarm afterwards,
    # or the stale stamp pages the next, unrelated fault on its first reading.
    answered = (
        result.authorized is True
        or result.relaunch_code == _MT5_NO_AUTHORIZED_ACCOUNT_CODE
    )
    if kind == KIND_IPC_FAULT_RECYCLED:
        level = logging.INFO
    elif (
        kind == KIND_IPC_FAULT_RECYCLE_NOT_LANDED
        and _count(verdict, "matched") == 0
        and answered
    ):
        # ⭐ IN-02 (164.6.5 review round 2) — `matched=0` with an ANSWERING
        # relaunch is ambiguous, and one reading is a genuine heal: no
        # `terminal64.exe` was running and the credentialed relaunch LAUNCHED
        # one. The other is an image name that did not match (SFH-01).
        # WARNING, qualified on the line, until the first live run shows which.
        level = logging.WARNING
        detail = (
            f"{detail} no_process_matched_relaunch_answered (either no terminal "
            "was running and the relaunch launched one, or the process name did "
            "not match; the first live run decides)"
        )
    else:
        # Still faulted, the house triple refused, a scrub that did not land, one
        # whose effect is unknown, or — ⛔ 164.6.6.1 — a relaunch that did NOT
        # verify the house session: degraded, unverified, or pending. The saved
        # login is gone and the relaunch debt is kept, so these are no longer
        # the WARNINGs they were when the recycle deleted nothing. ⚠️ PENDING
        # in particular: 164.6.5 WR-02 called it "not yet known" because the
        # recycled terminal still had its saved account and would come back
        # unaided. A scrubbed terminal will NOT come back unaided; only the
        # next tick's credentialed relaunch (D-10, plan 04) brings it back, so
        # until it verifies it is an outage, and it is said at ERROR.
        level = logging.ERROR
    exited = _count(verdict, "exited")
    terminated = _count(verdict, "terminated")
    if exited is not None and terminated is not None and exited < terminated:
        # ⚠️ SFH-01 — a terminated process that did not confirm its exit inside
        # the wait is a QUALIFIER, never an INFO: the terminal may still hold the
        # pipe the relaunch attached to.
        level = max(level, logging.WARNING)
        detail = f"{detail} exit_unconfirmed={terminated - exited}"
    refused = _count(verdict, "refused")
    if refused is not None and refused != 0:
        # ⛔ 164.6.6.1 — the scrub ended the terminal but KEPT `accounts.dat`, so
        # the stale saved copy may still be on disk. On a landed scrub that is
        # an ERROR whatever the relaunch said.
        detail = f"{detail} accounts_dat_kept={_scrub_refusal_reason(refused)}"
        if _recycle_landed(verdict):
            level = logging.ERROR
    if result.verb_exc_class is None:
        # ⛔ 164.6.6.1 review round 1 (SFH-02 / WR-03) — THE ONE SHARED
        # PREDICATE the validation scrub classifies by. A delete that ERRORED
        # did not prove the stale saved copy gone, and a fired or unreadable
        # profile tripwire means a saved account may sit where the literal never
        # deletes. Either is ERROR whatever the relaunch said. The kind and the
        # debt are untouched: a VERIFIED house relaunch still pays the debt
        # (the terminal is up as house), exactly as a refused-and-verified scrub
        # does; this line is what keeps the outcome from reading clean.
        # `_JOB_TERMINAL_DELETE_TRADES` is 1 (164.6.6.3 plan 03), so the trades
        # arm below applies: a failed trades delete is ERROR too.
        # Only a verdict the verb RETURNED is asked: a raised verb's is empty.
        faults = scrub_delete_faults(
            verdict, delete_trades=_JOB_TERMINAL_DELETE_TRADES
        )
        # A refused delete never ran, so its (empty) error list says nothing and
        # `accounts_dat_kept` already names the refusal above.
        if faults.accounts_errored and refused == 0:
            level = logging.ERROR
            detail = f"{detail} accounts_dat_kept=delete_errored"
        # ⛔ 164.6.6.3 plan 03 (D-07, fail loud) — the job path deletes the
        # per-account deal caches once `_JOB_TERMINAL_DELETE_TRADES` is 1. A
        # delete that errored, or whose error list is unreadable, has not proven
        # an account-named cache gone, and the next derive of that account may
        # then read a stale or partial history. Like the accounts arm: a refused
        # delete never ran, so its empty error list says nothing.
        if faults.trades_errored and refused == 0:
            level = logging.ERROR
            detail = f"{detail} trades_kept=delete_errored"
        # The literal counts the profile directory whether or not it refused.
        if faults.profile_tripwire:
            level = logging.ERROR
            detail = f"{detail} profile_tripwire=fired"
    if recent_recycles >= IPC_FAULT_RECYCLE_CAP:
        # ⛔ CR-01 (164.6.5 review round 2) — THE RECURRENCE IS THE SIGNAL. This
        # is the cap'th recycle inside the window: the last one "worked" and the
        # wedge came back. Whatever this recycle's own outcome, that is an ERROR,
        # and the next recycle is withheld until the oldest leaves the window.
        level = logging.ERROR
        mark_ipc_fault_cap_alarm(_clock())
        detail = (
            f"{detail} — REPEATED WEDGE: {recent_recycles} recycles in the last "
            f"{int(_IPC_FAULT_RECYCLE_WINDOW_S // 60)} min. A wedge that returns "
            "after a working recycle is the Cause B signal "
            "(MT5-SWITCH-WEDGE-CAUSE-01); an OPERATOR is needed. The recycle is "
            f"now CAPPED at {IPC_FAULT_RECYCLE_CAP} per rolling "
            f"{int(_IPC_FAULT_RECYCLE_WINDOW_S // 60)} min"
        )
    if answered:
        end_ipc_fault_run()
    elif level >= logging.ERROR:
        # SFH-03 — this line IS the run's alarm; the next is due an interval on.
        mark_ipc_fault_alarm(_clock())
    logger.log(
        level,
        "mt5 session heal: ipc_fault code=%s escalated to a terminal-process "
        "recycle with a saved-account scrub and a credentialed house relaunch "
        "— %s (%s)",
        code,
        kind,
        detail,
    )
    return kind


def _log_relaunch_debt_outstanding(client: Mt5Client, detail: str) -> None:
    """⛔ ERROR ON EVERY TICK while the debt is unpaid (164.6.6.1 plan 04,
    T-164.6.6.1-15). ``detail`` carries kinds, codes and equality verdicts only,
    never a credential, host, port or account."""
    if not mt5_relaunch_debt(client.terminal_key):
        return
    logger.error(
        "mt5 session heal: relaunch debt OUTSTANDING — the jobs terminal this "
        "service ended has not been seen authorized as the house account since, "
        "so MT5 jobs on it fail until it is. The next tick sends another "
        "credentialed house relaunch; an OPERATOR is needed if this persists "
        "(%s).",
        detail,
    )


def _settle_relaunch_debt(
    client: Mt5Client, login: int, password: str, server: str, deadline: float
) -> HealOutcome:
    """Pay the relaunch debt: ONE credentialed house relaunch and the
    house-equality check, sent INSTEAD OF the bare first probe (164.6.6.1 plan
    04, CONTEXT D-10, founder 2026-10-04: "pay debt on any tick").

    ⭐ WHY NO BARE PROBE. This service ended the terminal (the scrub records the
    debt before its terminate crosses) and has not seen it house-verified since.
    A terminal relaunched from there has no saved account, and a bare
    ``initialize()`` against it reads ``-10005`` after about 25 s (S-10) or hangs
    to the rpyc bound (S-03(b)). It measures nothing, and its ``-10005`` is
    debounced within the run, so the terminal would stay account-less with
    nothing acting on it (RESEARCH Pitfall 1).

    ⭐ THE BUDGET IS UNCHANGED. The credentialed call takes the bare probe's
    two-crossing slot (it plus ``_raise_last``'s ``last_error()``, or it plus the
    one-crossing house check), and NO poll follows it. A ``-10005`` falls through
    to the scrub escalation, subject to its debounce and cap: 2 + capture 1 +
    scrub 3 + credentialed reading 2 = ``_MT5_RELOGIN_ROUND_TRIPS``.

    ⛔ IT TERMINATES NOTHING, so it never claims the escalation and never counts
    against ``IPC_FAULT_RECYCLE_CAP`` (decision 5). Only the ``-10005``
    fall-through can end the terminal, and only through ``_escalate_ipc_fault``.

    The debt is cleared ONLY on a house-VERIFIED reading. Every other result
    keeps it and logs at ERROR, on every tick. ``Mt5SessionAbandoned``
    propagates (D-42).
    """
    try:
        client.initialize_with_credentials(login, password, server)
    except Mt5SessionAbandoned:
        raise
    except Mt5ClientError as err:
        code = err.code
        if code in _RECYCLE_REACHABLE_IPC_CODES:
            # ⭐ A dialog-wedged terminal: the scrub escalation is what reaches
            # it, debounced and capped exactly as on a first-probe `-10005`.
            escalated = _escalate_ipc_fault(
                client,
                code,
                server,
                deadline,
                env_login=login,
                env_password=password,
            )
            verdict = _not_healed(
                f"{KIND_RELAUNCH_DEBT}:code={code}", err, login, password, server
            )
            escalation_kind = (
                escalated if escalated is not None else KIND_RELAUNCH_DEBT_OUTSTANDING
            )
        else:
            if code == _MT5_NO_AUTHORIZED_ACCOUNT_CODE:
                # ⛔ CR-01 — `-6` is the terminal ANSWERING (the broker refused
                # the house triple), so the run of faults is over. A credentialed
                # call moves no answered-count and a debt tick sends no bare
                # probe, so nothing else would end it, and a re-wedge would stay
                # debounced on every later tick.
                end_ipc_fault_run()
            verdict = _not_healed(
                f"{KIND_RELAUNCH_DEBT_OUTSTANDING}:code={code}",
                err,
                login,
                password,
                server,
            )
            escalation_kind = KIND_RELAUNCH_DEBT_OUTSTANDING
        _log_relaunch_debt_outstanding(
            client,
            f"{KIND_RELAUNCH_DEBT} credentialed_relaunch_code={code} "
            f"escalation={escalation_kind}",
        )
        return HealOutcome(
            verdict=verdict,
            first_kind=KIND_RELAUNCH_DEBT,
            first_code=None,
            final_kind=None,
            final_code=None,
            escalation_kind=escalation_kind,
        )
    fragment, status = _read_post_relaunch_state(client, login, server, deadline)
    if status == _POST_RELAUNCH_VERIFIED:
        clear_mt5_relaunch_debt(client.terminal_key)
        end_ipc_fault_run()
        logger.warning(
            "mt5 session heal: relaunch debt paid — the terminal this service "
            "ended answered a credentialed house relaunch and was verified as the "
            "house session (%s; %s).",
            KIND_RELAUNCH_DEBT_SETTLED,
            fragment,
        )
        return HealOutcome(
            verdict=_VERDICT_HEALED,
            first_kind=KIND_RELAUNCH_DEBT,
            first_code=None,
            final_kind=KIND_HEALED,
            final_code=None,
            escalation_kind=KIND_RELAUNCH_DEBT_SETTLED,
        )
    # ⛔ Authorized but NOT the verified house session (degraded or unverified).
    # Still the terminal ANSWERING, so the run of faults is over (CR-01, as for
    # `-6` above); the debt is kept. There is no client error to hand
    # `_not_healed`, so the same prefix and the same by-value redaction are
    # applied to the value-free check fragment.
    end_ipc_fault_run()
    detail = _redact_credential_values(fragment, login, password, server)
    _log_relaunch_debt_outstanding(
        client, f"{KIND_RELAUNCH_DEBT} post_status={status} {detail}"
    )
    return HealOutcome(
        verdict=(
            f"{_VERDICT_NOT_HEALED_PREFIX}{KIND_RELAUNCH_DEBT_OUTSTANDING}:"
            f"code=None:post_status={status}:{detail}"
        ),
        first_kind=KIND_RELAUNCH_DEBT,
        first_code=None,
        final_kind=None,
        final_code=None,
        escalation_kind=KIND_RELAUNCH_DEBT_OUTSTANDING,
    )


def _boot_accountless_relaunch(
    client: Mt5Client,
    err: Mt5ClientError,
    login: int,
    password: str,
    server: str,
    deadline: float,
) -> HealOutcome:
    """CONTEXT D-09 (founder, 2026-10-04): at BOOT ONLY, a first probe that read
    the unattributed code ``0`` sends a credentialed house relaunch and the
    house-equality check (164.6.6.1 plan 04).

    ⭐ WHY. The relaunch debt is in-process, so a process restart loses it. The
    account-less terminal the previous process left behind then reads ``0`` on
    the boot probe (the rpyc-bound shape, S-03(b)), and before this branch that
    reading healed nothing and escalated nothing: the terminal went silent
    (RESEARCH Pitfall 1). The ``-10005`` half of D-09 needs no branch, because
    that code already reaches the scrub escalation (D-04 (i), S-10).

    ⛔ IT ENDS NOTHING. No scrub, no recycle, no claim and no cap: only
    ``initialize_with_credentials`` (by-value redaction, T-134-01), polled
    under ``_affordable`` exactly as the escalation's relaunch is, then one
    snapshot. The verdict and the first reading stay what the probe measured
    (``ipc_fault`` / ``0``); the outcome rides on ``escalation_kind`` and its
    own log line, WARNING when verified and ERROR otherwise.
    """
    verdict = _not_healed(
        f"{KIND_IPC_FAULT}:code={err.code}", err, login, password, server
    )
    status = _POST_RELAUNCH_NOT_REACHED
    if not _affordable(deadline, _CREDENTIALED_RELAUNCH_READING_CROSSINGS):
        detail = "relaunch=not_read (the heal budget left cannot cover it)"
    else:
        authorized, code, polls, settled = _relaunch_as_house(
            client, (login, password, server), deadline
        )
        detail = (
            f"authorized={authorized} relaunch_code={code} relaunch_polls={polls} "
            f"settled={settled}"
        )
        if authorized:
            fragment, status = _read_post_relaunch_state(
                client, login, server, deadline
            )
            detail = f"{detail} {fragment}"
    if status == _POST_RELAUNCH_VERIFIED:
        clear_mt5_relaunch_debt(client.terminal_key)
        end_ipc_fault_run()
        logger.warning(
            "mt5 boot heal: the first probe read the unattributed code 0 (the "
            "account-less terminal a restart can leave, CONTEXT D-09); a "
            "credentialed house relaunch brought it back as the house session — "
            "%s (%s)",
            KIND_BOOT_ACCOUNTLESS_RELAUNCHED,
            detail,
        )
        return HealOutcome(
            verdict=verdict,
            first_kind=KIND_IPC_FAULT,
            first_code=err.code,
            final_kind=KIND_HEALED,
            final_code=None,
            escalation_kind=KIND_BOOT_ACCOUNTLESS_RELAUNCHED,
        )
    logger.error(
        "mt5 boot heal: the first probe read the unattributed code 0 (the "
        "account-less terminal a restart can leave, CONTEXT D-09), and the "
        "credentialed house relaunch did NOT verify the house session — %s (%s). "
        "Nothing was ended; MT5 jobs on this terminal fail until it is house "
        "again, and an OPERATOR is needed if this persists.",
        KIND_BOOT_ACCOUNTLESS_RELAUNCH_FAILED,
        _redact_credential_values(detail, login, password, server),
    )
    return HealOutcome(
        verdict=verdict,
        first_kind=KIND_IPC_FAULT,
        first_code=err.code,
        final_kind=None,
        final_code=None,
        escalation_kind=KIND_BOOT_ACCOUNTLESS_RELAUNCH_FAILED,
    )


def _heal_blocking(
    host: str,
    port: int,
    login: int,
    password: str,
    server: str,
    *,
    deadline: float | None = None,
    source: str | None = None,
) -> HealOutcome:
    """The BLOCKING body, run under ``to_thread``. Returns a ``HealOutcome``.

    ⭐ STRUCTURED OUTCOME INSTEAD OF STRING PARSING (164.6.4 plan 02). This used
    to return the composed verdict ``str``, and the episode recorder would have
    had to PARSE it to learn the class — the exact string-shape dependency plan
    01 removed from ``initialize_with_credentials``. ``HealOutcome.verdict``
    carries that same string BYTE-UNCHANGED, so every log line and the
    ``startswith(_VERDICT_NOT_HEALED_PREFIX)`` severity branch keep reading one
    field and no log-content assertion moves; the other fields carry the FIRST
    probe's class and code and the FINAL re-probe's, which is what the recorder
    reads instead.

    ⛔ THE CLIENT IS CONSTRUCTED HERE, AS THIS FUNCTION'S FIRST ACT, AND THAT IS
    THE POINT OF THE FUNCTION. ``Mt5Client.__init__`` performs
    ``rpyc.classic.connect(host, port)``, which carries NO timeout of its own; the
    caller's ``asyncio.wait_for`` is the only thing bounding it, and it can only
    bound it if the construction happens inside the thread rather than on the
    event loop.

    THE BRANCH, and its asymmetry is deliberate:

      * ``assert_session_authorized()`` returns cleanly -> a session already
        exists. Return the already-authorized verdict and send NO credential. ⛔ A
        credential sent to a terminal that did not need one is a disclosure
        surface opened for nothing.
      * it raises with code ``-6`` -> the saved Wine session was refused. THIS is
        ours to heal: call the credentialed verb.
      * it raises with ANY other code -> an IPC fault (wedged pipe, unreachable
        terminal, a modal dialog). Return a verdict NAMING the code and heal
        NOTHING. Applying the session remedy to an IPC fault re-collapses the
        distinction Phase 164.1 built and Phase 164.8.3 shipped.

    ⭐ AMENDED 2026-10-04 (Phase 164.6.6.1 plan 04) — TWO EXCEPTIONS to "a
    credential only on ``-6``", and the sentence "a credential sent to a
    terminal that did not need one is a disclosure surface opened for nothing"
    above now holds for every reading EXCEPT these two. Each sends the house
    triple only through ``initialize_with_credentials`` (by-value redaction,
    T-134-01), over the private-network gateway only.

      (a) RELAUNCH DEBT, CONTEXT D-10 (founder, 2026-10-04, "pay debt on any
          tick"). When this service ended the terminal and has not seen it
          house-verified since (``mt5_relaunch_debt``), the tick SKIPS the bare
          probe, from ANY source, and sends ONE credentialed house relaunch
          (``_settle_relaunch_debt``). The service ended that terminal itself,
          and a bare call against an account-less terminal measures nothing: it
          hangs to the rpyc bound or reads ``-10005`` (S-03(b), S-10). The
          terminal needed the credential.
      (b) CONTEXT D-09 (founder, 2026-10-04), at BOOT ONLY
          (``source == HEAL_SOURCE_BOOT``): a probe that reads the unattributed
          code ``0`` sends a credentialed house relaunch
          (``_boot_accountless_relaunch``). A process restart loses the
          in-process debt, and the account-less terminal it left would otherwise
          go silent (RESEARCH Pitfall 1). The founder accepted this widening of
          164.6.2's "credentials only on -6" rule. D-09's ``-10005`` half needs
          no branch: that code already reaches the scrub escalation, which
          relaunches with the house credentials (D-04 (i)).
      (c) Every other reading keeps the original asymmetry. In particular a
          session-monitor tick that reads ``0`` with no debt sends no credential
          and escalates nothing, exactly as before.

    ⚠️ IN-02 — ``-6`` IS ONLY EVER OBSERVABLE THROUGH ``last_error()``, so the
    branch table above is conditional on that SECOND round-trip working. If
    ``last_error()`` itself raises, or answers a falsy/malformed shape,
    ``_raise_last`` produces ``code=0`` and the fault is classified as an IPC
    fault and healed NOT AT ALL. The fail-closed direction is the right one — a
    credential is never sent on a guess — but the consequence is worth stating
    plainly: the ONE fault this module exists for is UNDETECTABLE whenever the
    second round-trip is the broken one. The verdict's detail (below) is what
    tells an operator which of those it was.

    ⛔ THE CREDENTIALED VERB'S RETURN VALUE IS NOT INSPECTED — the oracle for "is
    the session authorized" is the NEXT PROBE, never this call's own boolean
    (RESEARCH question TWO). ⭐ WR-02: that next probe is now ACTUALLY TAKEN. It
    was not, and ``_VERDICT_HEALED`` was returned on the sole basis that
    ``initialize_with_credentials`` did not raise — i.e. the verdict was named
    after exactly the signal the design refuses to trust, and it was the only
    thing an operator saw. A broker that accepts the connection but rejects the
    account (a password rotated twice, a server rename) returns TRUTHY, and the
    log read ``healed`` over a gateway that was still down. The re-probe is the
    same credential-FREE detector, inside the same lease and the same budget —
    and, since WR-01 (round 2), it BRANCHES ON ITS CODE exactly as the first probe
    does. Folding every code into ``still_unauthorized`` asserted a session state
    the probe had not measured whenever the bridge dropped between the heal and the
    re-probe, which is the first probe's own conflation arriving backwards.

    ⛔ An ``Mt5SessionAbandoned`` raised by any step is NOT absorbed here. It is a
    PLAIN exception on purpose (D-42) so an OUR-INFRASTRUCTURE refusal can never
    be re-classified as a user credential fault; it propagates to the entry's
    catch-all, which logs its CLASS.
    """
    if deadline is None:
        deadline = _clock() + _relogin_budget_s()
    client = Mt5Client(host, port)
    try:
        if mt5_relaunch_debt(client.terminal_key):
            # ⭐ 164.6.6.1 plan 04 (CONTEXT D-10) — the debt is paid BEFORE the
            # bare probe, from any source; see `_settle_relaunch_debt`.
            return _settle_relaunch_debt(client, login, password, server, deadline)
        try:
            client.assert_session_authorized()
        except Mt5ClientError as err:
            if source == HEAL_SOURCE_BOOT and err.code == _MT5_UNATTRIBUTED_CODE:
                # ⭐ 164.6.6.1 plan 04, CONTEXT D-09 — boot only; see THE BRANCH
                # in this docstring and `_boot_accountless_relaunch`.
                return _boot_accountless_relaunch(
                    client, err, login, password, server, deadline
                )
            if err.code != _MT5_NO_AUTHORIZED_ACCOUNT_CODE:
                # ⛔ The verdict is COMPOSED FIRST and is byte-identical to the
                # pre-escalation one: the escalation rides out on
                # `escalation_kind` and its own log line, never in this string.
                verdict = _not_healed(
                    f"{KIND_IPC_FAULT}:code={err.code}",
                    err,
                    login,
                    password,
                    server,
                )
                return HealOutcome(
                    verdict=verdict,
                    first_kind=KIND_IPC_FAULT,
                    first_code=err.code,
                    # ⛔ No credentialed call ran, so there is NO final reading —
                    # and `None` is what keeps "a tick that heals nothing writes
                    # at most one observation" structural rather than incidental.
                    final_kind=None,
                    final_code=None,
                    # ⭐ D-08 — ACT, don't only report. Decided from the typed
                    # `err.code`, never from `verdict`. See `_escalate_ipc_fault`.
                    escalation_kind=_escalate_ipc_fault(
                        client,
                        err.code,
                        server,
                        deadline,
                        env_login=login,
                        env_password=password,
                    ),
                )
            # ⭐ THE ONE READING THAT ESTABLISHES DARKNESS. `-6` means the bridge
            # ANSWERED and no account is authorized; every other code is an IPC
            # fault that measured nothing about the session.
            first_kind = KIND_NO_AUTHORIZED_ACCOUNT
            first_code = err.code
            # A reading that is not the escalating class ends any run of them.
            end_ipc_fault_run()
        else:
            end_ipc_fault_run()
            return HealOutcome(
                verdict=_VERDICT_ALREADY_AUTHORIZED,
                first_kind=KIND_ALREADY_AUTHORIZED,
                # ⚠️ A clean probe RAISES NOTHING, so there is no `last_error()`
                # to read and no code to record. `None` is the honest value;
                # a `0` here would collide with the IN-02 sentinel.
                first_code=None,
                final_kind=None,
                final_code=None,
            )
        try:
            client.initialize_with_credentials(login, password, server)
        except Mt5ClientError as err:
            # ⛔ HIGH-2 — A CREDENTIAL REFUSAL IS NOT A TRANSIENT MISS, AND IT USED
            # TO BE LOGGED AS ONE. This was the ONLY credential-carrying call in
            # the module sitting UNGUARDED between two typed-handler blocks, so its
            # raise escaped to the entry's catch-all and the operator read
            # "mt5 boot heal did not complete — continuing without it … the next
            # boot will try again" — this module's wording for a TRANSIENT fault.
            # The truth is the opposite: rotate `MT5_PASSWORD` at the broker
            # without updating Railway and NOTHING heals, on this boot or any
            # future one, until a human edits a Railway variable. "The next boot
            # will try again" is then an actively misleading sentence.
            #
            # It also bypassed WR-01's severity ladder BY CONSTRUCTION: the ladder
            # keys off the `not_healed:` prefix, and a verdict that is never
            # produced carries no prefix. Routing it through `_not_healed` puts it
            # back on the ladder (WARNING), gives it a `code=` token like every
            # other failure here, and — because `_not_healed` redacts BY VALUE —
            # carries the broker's own refusal text safely.
            return HealOutcome(
                verdict=_not_healed(
                    f"{KIND_CREDENTIAL_REFUSED}:code={err.code}",
                    err,
                    login,
                    password,
                    server,
                ),
                first_kind=first_kind,
                first_code=first_code,
                final_kind=KIND_CREDENTIAL_REFUSED,
                final_code=err.code,
            )
        try:
            client.assert_session_authorized()
        except Mt5ClientError as err:
            # ⛔ WR-01 (round 2) — THE RE-PROBE CLASSIFIES ITS CODE, EXACTLY AS THE
            # FIRST PROBE DOES. It used to fold EVERY code into
            # `still_unauthorized`, which is a claim about the SESSION that the
            # probe did not measure whenever the code was not `-6`.
            #
            # The reachable sequence: the heal succeeds, and then the Wine bridge
            # drops (`-10004`) or a modal dialog appears (`-10005`) BEFORE the
            # re-probe returns. The verdict read
            # `not_healed:still_unauthorized:code=-10004` and the operator rotated
            # the broker password — while the session was fine and the actual
            # remedy was restart-the-pipe / look at the VNC screen.
            #
            # ⛔ That is the SAME conflation the first probe's branch refuses at
            # length ("re-sending a credential heals nothing while re-collapsing
            # exactly the distinction Phase 164.1 built"), arriving in the other
            # direction: WR-02 existed to stop the log asserting unmeasured session
            # state, and this arm reintroduced it. The classifier is therefore the
            # same constant, not a second spelling of the same rule.
            if err.code != _MT5_NO_AUTHORIZED_ACCOUNT_CODE:
                return HealOutcome(
                    verdict=_not_healed(
                        f"{KIND_HEAL_SENT_IPC_FAULT_ON_REPROBE}:code={err.code}",
                        err,
                        login,
                        password,
                        server,
                    ),
                    first_kind=first_kind,
                    first_code=first_code,
                    final_kind=KIND_HEAL_SENT_IPC_FAULT_ON_REPROBE,
                    final_code=err.code,
                )
            return HealOutcome(
                verdict=_not_healed(
                    f"{KIND_STILL_UNAUTHORIZED}:code={err.code}",
                    err,
                    login,
                    password,
                    server,
                ),
                first_kind=first_kind,
                first_code=first_code,
                final_kind=KIND_STILL_UNAUTHORIZED,
                final_code=err.code,
            )
        return HealOutcome(
            verdict=_VERDICT_HEALED,
            first_kind=first_kind,
            first_code=first_code,
            final_kind=KIND_HEALED,
            final_code=None,
        )
    finally:
        # Closed on EVERY path, success and failure alike. `close` is deliberately
        # EXEMPT from the D-36 session fence (D-41) precisely so a teardown is
        # never stranded — it touches only our own rpyc socket and never the
        # terminal's shared IPC pipe.
        client.close()


async def heal_mt5_terminal_session(
    *,
    source: str = HEAL_SOURCE_BOOT,
    poll_interval_s: float | None = None,
) -> None:
    """Re-establish the terminal's broker session when it has lapsed.

    ⛔ **D-08's "STARTUP ONLY" IS AMENDED HERE, DELIBERATELY, AND NOT QUIETLY
    CONTRADICTED** (164.6.4 plan 02, task 2). This sentence used to read "once,
    at worker startup", and Phase 164.6.4 is CHARTERED to make it false: the
    session monitor's tick is a second caller, on a DETECTION POLL CADENCE.
    Nothing reds when a docstring goes false, which is exactly why the amendment
    is written rather than left to be discovered — a reader who finds the
    sentence false and the reason unwritten has found drift, which is the
    record-versus-reality class this milestone exists to remove.

    ⭐ **WHY D-08's ORIGINAL HAZARD DOES NOT TRANSFER, VERIFIED TWO INDEPENDENT
    WAYS.** D-08 STRUCK "also heal on session open" because
    ``job_worker._make_mt5_session`` runs in PREFLIGHT, outside and before the
    terminal lease — so a touch there would stamp the generation early and an
    unrelated lease release in the preflight-to-lease window would refuse a
    LEGITIMATE derive read with ``Mt5SessionAbandoned``. The monitor is not that
    call site: (a) the terminal epoch binds on FIRST TOUCH rather than at
    construction, so a preflight-built client has no epoch until the job's own
    login inside the job's own lease; and (b) the construction fence is a
    ContextVar that preflight never carries — which ``mt5_client`` itself calls
    "the honest encoding of 'this construction is not happening under anyone's
    lease'". The monitor takes the SAME single bounded lease this entry already
    takes, and adds no new lease site at all.

    ``source`` names the caller so each in-heal sentence is true for the caller
    that actually made it; ``poll_interval_s`` is the DETECTION POLL CADENCE in
    effect (``None`` at boot, where there is no cadence) and rides into the
    episode row. ⛔ Neither changes behaviour: the keyword defaults keep
    ``main.lifespan``'s existing call and the "returns ``None`` on every path"
    contract byte-identical.

    THE ONE lease site in this module, and the ONE public entry. Returns ``None``
    on every path; ⛔ the return value is NOT an oracle for success — the oracle is
    the next probe (RESEARCH question TWO).

    ⛔ **THE ENTIRE BODY SITS INSIDE ONE TOP-LEVEL ``except Exception``, AND THAT
    CATCH IS WHAT STANDS BETWEEN A GATEWAY OUTAGE AND AN ANALYTICS OUTAGE.** This
    coroutine runs as a task in ``main.lifespan``'s task list, every member of
    which carries ``_crash_handler`` as a done-callback; ``_crash_handler`` calls
    ``SHUTDOWN.set()`` on ANY exception, which stops the dispatch, watchdog and
    enqueue loops while the API keeps answering ``/health`` green. A raise here is
    therefore a SILENT analytics outage, not an MT5 one. ⛔ Never move a statement
    outside the guard, and never narrow it to a specific exception type.

    ORDER, and the first step's position is a decision:
      1. the kill switch, consulted BEFORE anything is constructed. ⛔ The repo's
         own WR-08 residual is a gate that sits AFTER the transport opened;
         repeating that shape at a second site would be a knowing regression.
      2. the credential triple, then the gateway endpoint — absent either, log
         once and return (D-02).
      3. the lease, taken by KEY (``mt5_terminal_key``) BEFORE any client exists,
         and BOUNDED so a busy terminal means skip rather than queue.
      4. the blocking body, off the loop, under the whole-heal budget.

    ⚠️ A ``wait_for`` that fires does NOT cancel the thread. The thread keeps
    driving the shared session while this coroutine unwinds, the lease releases
    and the terminal's generation is bumped — at which point the zombie's next
    touch is refused by the client's own D-36 fence. That is the DESIGNED
    behaviour, not a leak; ⛔ do not "fix" it by joining the thread, which would
    hold the lease for exactly as long as the hang (the WEDGE-01 class D-25
    forbids). ⭐ WR-05: it is nonetheless the one outcome here that leaves the
    SYSTEM in a state nobody measured, so it is logged at ERROR under its own arm —
    above every verdict — rather than sharing the catch-all's transient wording
    with a busy-terminal SKIP, which is logged at INFO for the opposite reason.
    """
    try:
        # ⛔ HIGH-2 (secondary) — BOUND BEFORE THE FIRST STATEMENT THAT CAN RAISE, so
        # the catch-all below can redact BY VALUE whenever the values are known and
        # fall back to the shape scrub when they are not. An `except` arm that
        # referenced an unbound local would raise `NameError` from INSIDE the
        # handler and silently demote every early failure to the argument-free
        # fallback line.
        credentials: tuple[int, str, str] | None = None
        # ⛔ BOUND HERE FOR THE SAME REASON `credentials` IS — before the first
        # statement that can raise, so no handler below can reference an unbound
        # local. The lookup is TOTAL: an unrecognised source is NAMED, never
        # silently relabelled as the boot heal.
        label = _HEAL_SOURCE_LABELS.get(source, _HEAL_SOURCE_LABEL_UNKNOWN)

        if not mt5_enabled_server():
            # ⛔ FIRST, and before any construction: fail-closed, read per call.
            #
            # ⛔ HIGH-1 — IT LOGS. This used to be the module's ONE unlogged exit,
            # and zero log lines was simultaneously consistent with FIVE
            # hypotheses: MT5 disabled, the `create_task` entry reverted, the
            # import failing, the process killed before the task was scheduled, or
            # `LOG_LEVEL` raised above INFO. Every OTHER early return here
            # (credentials absent, credentials invalid, gateway absent, port not
            # numeric) already obeys `_log_configuration_fault_once`'s stated
            # doctrine — "LOG-AND-PROCEED, never silence … silence is the defect
            # class this milestone exists to remove" — and the one exit that
            # violated it was the one an operator is most likely to hit.
            #
            # ⚠️ It NAMES the variable, because `mt5_enabled_server` is
            # `.strip().lower() == "true"`: `1`, `on` and `yes` all read OFF, so a
            # future edit to any of them would otherwise disable the heal with an
            # EMPTY log. (Booked as `[164.6.2-KILLSWITCH-COMMENT-DRIFT]`; this line
            # makes the consequence visible without touching that gate.)
            #
            # INFO, not WARNING: a disabled kill switch is an operator DECISION,
            # not a misconfiguration, and it is not throttled because it fires once
            # per boot.
            logger.info(
                "%s: skipped — %s is not set to true, so the heal is "
                "disabled. The terminal keeps whatever session it already has.",
                label,
                _MT5_ENABLED_ENV_NAME,
            )
            return

        credentials = read_env_mt5_credentials()
        if credentials is None:
            # ⛔ WR-03 — COUNTED, not merely logged-once (`read_env_mt5_
            # credentials` already did the once-per-process log via D-02). On
            # the session monitor's cadence this path is reachable on EVERY
            # tick, and an uncounted refusal cannot reach the blind-run
            # escalation — which is the control for exactly this: a Railway
            # variable that was never set must not read byte-identical in the
            # logs to a monitor that has found the session healthy forever.
            # ⛔ IN-07 (round 2) — `KIND_CREDENTIALS_NOT_CONFIGURED`, not the
            # gateway arm's kind: the throttled log line names WHICH variable
            # once, but the recurring per-tick reading is this row's only
            # OTHER evidence, and it must say which check refused.
            await record_mt5_session_reading(
                KIND_CREDENTIALS_NOT_CONFIGURED,
                None,
                source=source,
                poll_interval_s=poll_interval_s,
            )
            return
        endpoint = read_env_gateway_endpoint()
        if endpoint is None:
            # ⛔ WR-03 / IN-07 (round 2) — same reasoning as the credentials
            # arm above, `KIND_GATEWAY_NOT_CONFIGURED` for this one.
            await record_mt5_session_reading(
                KIND_GATEWAY_NOT_CONFIGURED,
                None,
                source=source,
                poll_interval_s=poll_interval_s,
            )
            return

        login, password, server = credentials
        host, port = endpoint

        # ⛔ HIGH-1's SECOND half, and the two only work together. The disabled
        # return above removes ONE hypothesis from an empty log; this line removes
        # the rest of them. Once it is present, an empty log means "the task never
        # ran" and NOTHING else — a heal that reached the lease always emits a
        # second line, whatever happens next (a verdict, a busy skip, a timeout, or
        # the catch-all). ⛔ It carries no host, no port and no credential: the
        # module's rule is NAMES ONLY (T-164.6.2-12), and the endpoint is not even
        # a name.
        logger.info(
            "%s: starting — acquiring the terminal and probing the "
            "broker session (a second line always follows).",
            label,
        )

        # The lease key WITHOUT a client — plan 01's helper exists for this call
        # site. ⛔ Never a second hand-spelled `f"{host}:{port}"`: the epoch
        # registry and the lock registry must be keyed byte-identically or the
        # fence guards a different terminal than the lock serializes.
        budget_s = _relogin_budget_s()
        # ⛔ WR-05 — TWO OUTCOMES THAT ARE NOT FAILURES OF THE SAME KIND, AND WERE
        # LOGGED AS ONE. Both used to exit through the entry's catch-all as
        # "mt5 boot heal did not complete" at WARNING, which is this module's
        # wording for a transient miss. ⛔ These handlers are NESTED inside the one
        # top-level `except Exception`, never beside it: the never-raises gate
        # requires the outer guard to carry exactly ONE handler, and narrowing or
        # multiplying it is the escape route that reaches `_crash_handler`.
        try:
            # ⭐ Phase 164.6.6 criterion 1 — held for the HOUSE account, so a
            # heal that re-logs it records a handover from whoever held the
            # terminal before; a tick that only reads records nothing.
            async with mt5_terminal_lease(
                mt5_terminal_key(host, port),
                wait_s=_relogin_lease_wait_s(),
                holder=HOLDER_HOUSE,
                site=SITE_HEAL,
            ):
                outcome = await asyncio.wait_for(
                    asyncio.to_thread(
                        _heal_blocking,
                        host,
                        port,
                        login,
                        password,
                        server,
                        # ⭐ WR-04 — the SAME instant the `wait_for` starts, so the
                        # blocking body's optional reads can never outlive it.
                        deadline=_clock() + budget_s,
                        # ⭐ 164.6.6.1 plan 04 — D-09's boot-only branch keys
                        # off the caller.
                        source=source,
                    ),
                    timeout=budget_s,
                )
        except Mt5TerminalBusyError:
            # ⭐ A DESIGNED SKIP, and this module's own derivation says so: "the
            # correct behaviour when the terminal is already busy is to SKIP: a
            # busy terminal is a terminal somebody is already successfully using,
            # which is itself evidence that the session is fine and there is
            # nothing here to heal … skipping costs the next holder exactly zero."
            #
            # The race is the ordinary one IN-04 describes: `dispatch_loop` claims
            # a `derive_broker_dailies` job within a second or two of boot. So a
            # HEALTHY boot logged TWO warnings — this one and `mt5_terminal_lease`'s
            # own — and an operator who learns that a healthy boot warns twice has
            # been taught to ignore the channel this milestone exists to fill.
            #
            # ⚠️ The lease's own WARNING is NOT changed here. It belongs to a shared
            # helper whose other callers are the INTERACTIVE validate path, where
            # "gave up waiting for the terminal" genuinely is a warning.
            #
            # ⛔ T-15 / WR-02 (164.6.6.1) — EXCEPT WHILE A RELAUNCH DEBT IS OWED.
            # A debt means this service ended the terminal and has not seen it
            # house-verified since, so the jobs holding the lease are most likely
            # FAILING against an account-less terminal (a credential-less
            # `initialize()` there blocks 25-30 s, S-03(b)/S-10), and "busy is
            # evidence the session is fine" is then false. `_settle_relaunch_debt`
            # only runs after the lease is won, so without this branch a backlog
            # that starves every tick's bounded acquire reports the terminal fine
            # on every tick. The SKIP itself is unchanged (never queue ahead of
            # real work, and the lease wait is NOT lengthened); only the claim is.
            # Closed literal text and the source label only: no credential, host,
            # port or account.
            if mt5_relaunch_debt(mt5_terminal_key(host, port)):
                logger.error(
                    "%s: relaunch debt OUTSTANDING and the heal could not get the "
                    "terminal lease — the bounded acquire expired while the "
                    "terminal was in use, so the credentialed house relaunch that "
                    "pays the debt did not run this tick. The jobs holding the "
                    "terminal are most likely failing against a terminal with no "
                    "account; an OPERATOR is needed if this persists.",
                    label,
                )
            else:
                logger.info(
                    "%s: skipped — the terminal was already in use when "
                    "the bounded acquire expired, so the heal gave up rather than "
                    "queueing ahead of real work. A busy terminal is a terminal "
                    "somebody is already successfully using, which is itself "
                    "evidence the session is fine (D-29).",
                    label,
                )
            # ⛔ RECORDED AS `not_measured`, AND THE SKIP'S OWN RATIONALE IS
            # DELIBERATELY NOT CARRIED INTO THE RECORD. "A busy terminal is
            # evidence the session is fine" is cheap and defensible for a
            # once-per-boot heal and UNSOUND for a periodic one: it is a standing
            # claim about session state this tick did not measure, and a terminal
            # held by a FAILING job is exactly where it is most wrong. The SKIP
            # stays (never queue ahead of real work) and the INFO stays; only the
            # unmeasured claim is refused.
            await record_mt5_session_reading(
                KIND_BUSY_SKIP, None, source=source, poll_interval_s=poll_interval_s
            )
            return
        except asyncio.TimeoutError:
            # ⛔ NOT a miss, and NOT the same event as a busy skip. The budget
            # fired, and `wait_for` DOES NOT CANCEL THE THREAD: a credential-free
            # probe, or a credentialed `initialize()` carrying the broker password,
            # is STILL IN FLIGHT against the shared terminal. The lease has
            # released and bumped the generation, so the zombie's next touch is
            # fenced (D-36) — but whether the broker session came up is UNKNOWABLE
            # from this log, and the next boot's detector is the only thing that
            # will answer it.
            #
            # ERROR, above every verdict: it is the one outcome here that leaves
            # the SYSTEM in a state nobody measured.
            logger.error(
                "%s: ABANDONED at the %.1fs budget — a round-trip is "
                "still in flight against the shared terminal on a thread that was "
                "NOT cancelled. The lease has released and fenced it (D-36), but "
                "whether the broker session came up is unknowable from here; the "
                "next credential-free probe is what answers it.",
                label,
                budget_s,
            )
            # ⛔ `not_measured`, and it CLOSES NOTHING. "Whether the broker session
            # came up is unknowable from here" is the log line's own sentence; a
            # row asserting either state would contradict it.
            await record_mt5_session_reading(
                KIND_BUDGET_ABANDONED,
                None,
                source=source,
                poll_interval_s=poll_interval_s,
            )
            return
        # ⛔ WR-01 — THE SEVERITY FOLLOWS THE VERDICT, and it did not. Every
        # outcome was INFO, so a wedged terminal behind a modal login dialog
        # (`-10005`) — a real gateway outage — was logged one level BELOW a
        # merely-unset `MT5_GATEWAY_PORT`, which `_log_configuration_fault_once`
        # emits at WARNING. That is a severity inversion inside a milestone whose
        # stated purpose is removing silent failure.
        if outcome.verdict.startswith(_VERDICT_NOT_HEALED_PREFIX):
            logger.warning("%s: %s", label, outcome.verdict)
        else:
            logger.info("%s: %s", label, outcome.verdict)
        # ⭐ THE SINK, BESIDE THE VERDICT THAT PRODUCED IT — and AFTER the log
        # line, so a slow Supabase write can never delay the operator's sentence.
        # ⛔ Never from the OUTER catch-all: the never-raises AST gate requires
        # that handler's body to be EXACTLY one nested `try`, and an extra
        # statement there is a named defect. This call cannot raise, so the
        # verdict and the two lines above stay byte-identical whatever the sink
        # does (T-153.3-24).
        await record_mt5_heal_outcome(
            outcome, source=source, poll_interval_s=poll_interval_s
        )
    except Exception as exc:  # noqa: BLE001 — see the docstring; this is the control
        # ⛔ IN-06 — THE HANDLER BODY IS ITSELF GUARDED, because "structurally
        # incapable of raising" is the declared standard and `logger.warning`'s
        # ARGUMENTS are evaluated before it is entered. stdlib `logging` swallows
        # formatting errors during emit; it does NOT swallow the evaluation of
        # `type(exc).__name__` or `scrub_freeform_string(str(exc))`. An exception
        # whose `__str__` misbehaves, or a `RecursionError`/`MemoryError` arriving
        # at an already-exhausted stack, escapes the outer guard from INSIDE it and
        # reaches `_crash_handler` — the one route this whole module is built to
        # close. ⛔ `BaseException`, not `Exception`: `RecursionError` is an
        # `Exception` but `MemoryError`'s neighbours in the stack-exhaustion class
        # are not, and a fallback that is itself narrower than the failure it
        # catches is not a fallback. The fallback line takes NO arguments to
        # evaluate, so it has nothing left that can raise.
        try:
            logger.warning(
                "%s did not complete — continuing without it; the "
                "terminal keeps whatever session it already has and the next "
                "attempt will try again (exc_class=%s scrubbed=%s)",
                label,
                type(exc).__name__,
                # ⛔ HIGH-2 (secondary) — BY VALUE, not merely shape-scrubbed. The
                # bare `scrub_freeform_string` that stood here is a MEASURED NO-OP
                # on the `mt5linux` kwargs-repr shape, so this handler's safety was
                # INHERITED from the callee's discipline rather than structural —
                # and this is the last handler on a path carrying a live broker
                # password to a PUBLIC Actions log. See `_describe_exception_for_log`.
                _describe_exception_for_log(exc, credentials),
            )
        except BaseException:  # noqa: BLE001 — see the comment; this is the control
            logger.warning(
                "the mt5 session heal did not complete, and the failure could "
                "not be described — continuing without it"
            )
