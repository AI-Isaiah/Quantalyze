"""Phase 153.6 / PARITY-01 — the ONE MT5 login+read+probe body, shared by both
validate paths.

Consumed by ``routers/exchange.py`` (the FastAPI ``_validate_mt5_key_probe``
branch) and ``services/ingestion/mt5.py`` (``Mt5Adapter.validate``). Until this
module existed each of those two files carried its OWN hand-written
``_assert_expected_login`` / ``_read_terminal`` / ``_probe`` closures, and 153.3
landed three separate fixes on the router copy that never reached the worker
copy:

  * **A1** the terminal short-circuit that stops ``order_check`` running once the
    capability verdict is already ``"undetermined"``;
  * **A2** the broad ``except`` around rpyc netref materialization, logging the
    exception CLASS only;
  * **A3** the operator-fault refusal, which on the worker escaped as a bare
    ``RuntimeError`` and was therefore RETRIED forever.

Concentrating the body here means a fix cannot land on one path only — there is
one path. What genuinely resists extraction (lease bounds, timeout chains,
HTTP-vs-``ValidationResult`` dispositions) stays at the call sites, deliberately,
with its rationale; see the ⛔ note at the bottom of this docstring.

Leaf-module invariant (mirrors the ``mt5_concurrency.py`` / ``closed_sets.py``
convention): this module's only in-tree imports are ``services.mt5_client`` and
``services.mt5_validation``. It MUST NEVER import ``routers.*``, and it must
never import ``services.job_worker`` nor anything that does.

⛔ The DIRECTION is load-bearing and must stay so (D-07). The worker importing
``routers/exchange.py`` would invert the dependency (worker → HTTP layer) and is
the circular-import hazard that forced 153.5 to put the epoch registry in
``mt5_client`` rather than ``mt5_concurrency``. Neither ``routers/exchange.py``
nor ``services/ingestion/mt5.py`` may import the other; both import THIS.

⭐ The client is a PARAMETER, never a module-level handle. This module owns no
session, holds no terminal lease and structurally cannot fence one: it is handed
an already-connected ``Mt5Client`` by a caller that is already inside its own
``mt5_terminal_lease`` block, and it hands the session back untouched. The two
callers' lease bounds DIVERGE on purpose — the router bounds its wait
(``_MT5_LEASE_WAIT_S``, an interactive human is inside the client budget) and the
worker waits unboundedly (``wait_s=None``, batch ingestion where bounding would
convert serialization into failure) — and so do their timeout chains (153.3 /
D-03). ⛔ Do NOT "unify" either of those here; both divergences are documented AT
their call sites and moving them would delete the rationale.
"""
from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any, Final

from services.mt5_client import (
    Mt5AccountMismatchError,
    Mt5Client,
    Mt5ClientError,
    Mt5SessionAbandoned,
)
from services.mt5_validation import (
    classify_trade_capability,
    mt5_probe_request,
    terminal_trade_permission_off,
)

logger = logging.getLogger("quantalyze.analytics")


#: The GENERIC curated copy for :class:`Mt5GatewayMisconfigured` — arm 3 of
#: :func:`mt5_gateway_misconfigured_detail`, and the default-argument value that
#: keeps raw remote text out of the exception by omission.
#:
#: ⚠️ 161-02 RESIDUAL, stated honestly. This sentence names a SPECIFIC option, so
#: it is only truthful where a cause is genuinely unknown — which is why the
#: builder reaches it ONLY when the terminal names no cause at all, and why both
#: raise sites (which reach the operator arm only via
#: ``terminal_trade_permission_off``) can no longer emit it. 161-UI-SPEC
#: § Copy Spec WIZERR-01 arm 3 holds this constant unchanged; re-wording it to a
#: cause-free fallback is a copy decision for the phase owner, not an executor
#: improvisation, and is recorded in 161-02-SUMMARY.
#:
#: ⛔ HAND-WRITTEN, and deliberately NOT derived from any exception text. It is
#: rendered to a human (``job_worker.classify_exception`` persists it as
#: ``sanitized_message`` and the admin UI shows it), so it is held to two
#: negative rules, both pinned by
#: ``tests/test_mt5_validate_parity.py::test_every_builder_emittable_constant_is_curated_and_credential_free``:
#:
#:   1. it names NO credential — no "password", "investor", "master", "secret";
#:   2. it carries NO token from ``mt5_validation._WRONG_SERVER_TOKENS`` or
#:      ``_AUTH_TOKENS``. A message containing "terminal" or "server" is one
#:      ``classify_mt5_login_error`` call away from being re-read as "the user's
#:      broker server is wrong" — the exact accusation A1 exists to remove, and
#:      the reason the pre-153.6 worker copy's ``RuntimeError`` text was unsafe.
MT5_GATEWAY_MISCONFIGURED_DETAIL: Final[str] = (
    "MT5 gateway refuses automated trading (the 'Disable automatic trading "
    "through the external Python API' option is in force), so read-only "
    "capability cannot be proven. This needs an operator, not a retry — see "
    "docs/runbooks/mt5-go-live.md."
)

#: 161-02 / WIZERR-01 arm 1 — the FOUNDER-MEASURED live cause (2026-08-13).
#:
#: The gateway's Expert-Advisors *"Allow algorithmic trading"* setting
#: (``Enabled`` in the ``[Experts]`` block) is what governs the
#: ``trade_allowed`` flag we read. The gateway re-sets it OFF on every account
#: change (``Account=1`` / ``Profile=1``) and the worker logs in on every job,
#: which is why this fault RECURS rather than staying fixed once an operator
#: clears it. The external-Python-API option is an INDEPENDENT checkbox, read
#: through ``tradeapi_disabled`` — see the arm below.
#:
#: Held to the same two negative rules as the constant above, and pinned over
#: the WHOLE family by
#: ``tests/test_mt5_validate_parity.py::test_every_builder_emittable_constant_is_curated_and_credential_free``.
MT5_GATEWAY_TRADE_PERMISSION_OFF_DETAIL: Final[str] = (
    "The MT5 gateway has 'Allow algorithmic trading' switched off, so read-only "
    "capability cannot be proven. The gateway switches it off again whenever it "
    "changes users, so turning it back on needs an operator, not a retry — see "
    "docs/runbooks/mt5-go-live.md."
)

#: 161-02 / WIZERR-01 arm 2 — the case the constant at the top of this block
#: actually describes: the named external-API option IS in force, reported by
#: ``terminal_info()['tradeapi_disabled']``.
#:
#: ⚠️ A1 (UNVERIFIED): that key was founder-measured ONCE (2026-08-13) with zero
#: production readers. The builder below therefore reads it defensively and an
#: ABSENT key can never select this arm — it falls through to the generic
#: constant rather than asserting a cause we did not measure.
MT5_GATEWAY_EXTERNAL_API_BLOCKED_DETAIL: Final[str] = (
    "The MT5 gateway blocks outside automated access (the 'Disable automatic "
    "trading through the external Python API' option is in force), so read-only "
    "capability cannot be proven. This needs an operator, not a retry — see "
    "docs/runbooks/mt5-go-live.md."
)

#: EVERY constant :func:`mt5_gateway_misconfigured_detail` can emit, and the ONLY
#: strings :func:`curated_gateway_detail` will let out of the worker's classify
#: sink. It exists so the curated-message fence can be parametrized over the
#: whole family at ONE seam: a new cause arm that forgets to join this tuple is
#: unreachable through the allow-list, and one that joins it is fence-checked.
MT5_GATEWAY_MISCONFIGURED_DETAILS: Final[tuple[str, ...]] = (
    MT5_GATEWAY_MISCONFIGURED_DETAIL,
    MT5_GATEWAY_TRADE_PERMISSION_OFF_DETAIL,
    MT5_GATEWAY_EXTERNAL_API_BLOCKED_DETAIL,
)


class Mt5GatewayMisconfigured(Exception):
    """Operator fault: the gateway refuses automated trading, so an investor
    password cannot be distinguished from a master password and no read-only
    verdict is available.

    ⚠️ 161-02 CORRECTION: TWO independent gateway settings produce this, and this
    type no longer presumes which. The measured live cause is the Expert-Advisors
    *"Allow algorithmic trading"* option (``Enabled`` in ``[Experts]``), which the
    gateway re-sets off on every account change while the worker logs in on every
    job — hence the recurrence. MetaQuotes' default-ON *"Disable automatic
    trading through the external Python API"* (``Api``, reported as
    ``tradeapi_disabled``) is the OTHER one. ``mt5_gateway_misconfigured_detail``
    picks the sentence the flags actually support.

    PERMANENT — a retry can NEVER clear it. That is the whole point of the type.
    Raised by ``services/ingestion/mt5.py`` where a bare ``RuntimeError`` used to
    be, so ``job_worker.classify_exception`` can map it onto ``("permanent",
    curated_gateway_detail(exc))`` instead of falling through to
    ``("unknown", str(exc))`` — under which the worker re-ran the whole serialized
    probe against the ONE shared terminal on every retry, queueing ahead of every
    other user's validate, for a condition no retry can clear.

    ⚠️ 161-02 MOVED THAT SINK, and this paragraph used to name the one it
    replaced. The arm returned ``MT5_GATEWAY_MISCONFIGURED_DETAIL``
    unconditionally, which threw away the cause
    ``mt5_gateway_misconfigured_detail`` had just derived from the terminal flags
    — so the operator surface kept naming the option the founder measured NOT to
    be in force. ``job_worker.py`` now reads the message through
    ``curated_gateway_detail``'s allow-list: a member of
    ``MT5_GATEWAY_MISCONFIGURED_DETAILS`` rides out intact, and anything else —
    including raw remote text — degrades to the generic constant. That constant
    is now the DEGRADATION TARGET, not the return value, and a comment saying
    otherwise is the false-sentence class this phase exists to close.

    ⛔ The message defaults to the curated constant so no call site can raise this
    carrying raw remote text by omission. Do not interpolate an upstream
    exception into it: ``mt5linux`` f-string-interpolates the password into the
    source it evaluates remotely (T-134-01 / T-153.3-23), so raw remote text is a
    credential-disclosure surface.
    """

    def __init__(self, message: str = MT5_GATEWAY_MISCONFIGURED_DETAIL) -> None:
        super().__init__(message)


def mt5_gateway_misconfigured_detail(terminal_info: dict[str, Any] | None) -> str:
    """The ONE flag->cause seam: pick the curated sentence that names the ACTUAL
    blocker, from the ``terminal_info`` dict both raise sites already hold.

    Lives HERE rather than in ``mt5_validation`` for one measured reason: the
    curated constants and the ``Mt5GatewayMisconfigured`` default-argument
    property live here, ``mt5_probe`` already imports ``mt5_validation``, and the
    reverse import would be a cycle. It does NOT re-derive the four-condition
    shape test — it CALLS ``terminal_trade_permission_off``, the single seam that
    owns it (a shape test copied twice drifts, silently).

    PRECEDENCE, deterministic and deliberate: when BOTH flags indicate blockage
    the NAMED option wins. ``tradeapi_disabled`` describes a specific, named
    checkbox and it SUBSUMES the terminal-level permission (branch 5 of
    ``classify_trade_capability`` records the same subsumption), so naming it is
    strictly more informative than naming the setting it already forces off.

    ⚠️ A1 QUARANTINE. ``tradeapi_disabled`` was founder-measured ONCE (2026-08-13)
    against the live gateway and has had zero production readers since, so this
    function must be safe whether or not the key exists. Every read is a
    ``.get()``; a terminal that is ``None``, not a mapping, or simply missing the
    key can neither raise nor mis-select an arm — it falls through to the generic
    constant, which asserts no cause we did not measure. A ``KeyError`` here would
    fail the whole job PERMANENTLY (T-161-05).

    ⛔ Flag NAMES never reach the returned sentence: the user gets the cause, never
    the sensor reading.
    """
    if not isinstance(terminal_info, Mapping):
        return MT5_GATEWAY_MISCONFIGURED_DETAIL
    if terminal_info.get("tradeapi_disabled"):
        return MT5_GATEWAY_EXTERNAL_API_BLOCKED_DETAIL
    if terminal_trade_permission_off(terminal_info):
        return MT5_GATEWAY_TRADE_PERMISSION_OFF_DETAIL
    return MT5_GATEWAY_MISCONFIGURED_DETAIL


def curated_gateway_detail(exc: Mt5GatewayMisconfigured) -> str:
    """The message an ``Mt5GatewayMisconfigured`` may render to a human — read
    through an ALLOW-LIST, never trusted because it arrived on an exception.

    Why not simply ``str(exc)``: ``mt5linux`` f-string-interpolates the password
    into the source it evaluates remotely (T-134-01 / T-153.3-23), so ANY text
    that originates upstream is a credential-disclosure surface, and this string
    is persisted as ``sanitized_message`` and rendered (T-161-04). Why not simply
    the generic constant, which is what ``job_worker.classify_exception`` used to
    return unconditionally: that discarded the cause the raise site had just
    derived, so the worker surface kept telling the operator about an option that
    was measured NOT to be in force.

    The allow-list gives both: a curated cause rides out intact, and anything else
    — including raw remote text — degrades to the generic curated constant.
    """
    message = str(exc)
    if message in MT5_GATEWAY_MISCONFIGURED_DETAILS:
        return message
    return MT5_GATEWAY_MISCONFIGURED_DETAIL


def assert_expected_login(info: dict[str, Any], *, login: int) -> None:
    """RED-TEAM login bracket (MT5CONC-02), run BEFORE and AFTER the probe.

    MT5 binds ONE account per terminal at a time and both callers share ONE
    terminal, so a concurrent validate (the other path, another replica, another
    process) can re-log the terminal onto a different account mid-probe — and the
    capability verdict would then be judged against the WRONG account: a master
    password wrongly accepted as read-only (the EoP gate T-135-09 defeated), or an
    investor login wrongly rejected.

    STRICT equality on the parsed login; a missing ``"login"`` field FAILS LOUD
    and never default-matches. A mismatch raises ``Mt5AccountMismatchError``,
    which is deliberately NOT an ``Mt5ClientError`` so no classify arm can absorb
    it into a credential verdict.

    153.3-04 / D-29: the race this DETECTS is now also PREVENTED in-process — both
    callers run under ``mt5_terminal_lease``. The bracket nonetheless STAYS: an
    ``asyncio.Lock`` serializes nothing ACROSS REPLICAS, and this is the guarantee
    that ``api_verified`` is never stamped on another account's numbers. A
    prevention is not a licence to delete the detection.
    """
    _actual = info.get("login")
    if _actual != login:
        raise Mt5AccountMismatchError(login, _actual)


def read_terminal(client: Mt5Client, *, log_prefix: str) -> dict[str, Any] | None:
    """The terminal's own state, or ``None`` if it could not be read.

    An UNREADABLE terminal must yield NO signal (-> ``"undetermined"`` ->
    refusal), and it must NOT flow into the ``classify_mt5_login_error`` arms the
    callers own: that table's "terminal"/"ipc"/"connect" tokens would classify OUR
    gateway's condition as the user's wrong broker server and blame their
    credentials for it. Caught here, logged secret-free.

    ⭐ THE GUARDED REGION IS THIS ``try``, AND IT MUST SPAN THE WHOLE READ —
    INCLUDING MATERIALIZATION. ``Mt5Client.terminal_info`` converts a transport
    RAISE into a typed ``Mt5ClientError`` via ``_guarded_read``, but it
    materializes the rpyc netref AFTER that wrapper has returned. An
    ``Mt5ClientError``-only catch therefore left a hole exactly the width of that
    step: if the connection drops between the call returning a netref and the
    netref being read, the failure is a raw transport exception, it is NOT an
    ``Mt5ClientError``, and it escaped this refusal entirely — out of the probe,
    past the ``except Mt5ClientError`` classify arm, to an unhandled bodyless 500.
    Under R-1 that status means SERVICE-PERMANENT, "do not retry" — the opposite of
    the truth for a dropped connection — and it is produced by NO arm of this
    contract, so nothing here chose it.

    ⛔ Fail CLOSED on ANY failure, deliberately: this is the one read whose absence
    must yield NO signal. A terminal we could not read cannot license a read_only
    verdict (D-31's fail-OPEN). ``Exception``, never ``BaseException``:
    cancellation and interpreter exits are not "the terminal is unreadable".
    """
    try:
        return client.terminal_info()
    except Mt5SessionAbandoned:
        # ⭐ WIZFORM-ABANDON / D-09 / D-14. THE FENCE TYPE REACHES ITS OWN ARM
        # FIRST. `Mt5SessionAbandoned` is a plain `Exception` by design (D-42, so
        # that no credential-classify arm can absorb an operator-side refusal into
        # a user verdict) — which means it matches NEITHER sibling arm below by
        # type, and the broad one would therefore swallow it. Absorbed, it becomes
        # a `None` terminal read: an operator triaging in Railway reads a gateway
        # MATERIALIZATION fault that never happened, and the probe continues on a
        # "terminal unreadable" premise that is false.
        #
        # ⚠️ On the genuinely abandoned path nobody awaits this read, so the raise
        # reaches no one and this arm never runs (D-39 — the WARNING at the fence
        # is the signal). It exists for the FALSE-POSITIVE path: a legitimate
        # caller that trips the fence must surface as a retryable transient, never
        # as "the terminal was unreadable" and never as a credential verdict.
        #
        # ⛔ NOTHING ELSE IN THIS ARM. No log line (the fence already logged), no
        # `None` return, no conversion to `Mt5ClientError` — a converted fence
        # refusal is exactly what the classify arms must never see. This is also
        # why extracting A2's broad arm and closing B1 is ONE edit (D-14): adding
        # the broad arm to the worker path without this arm above it would have
        # imported B1 onto the worker.
        raise
    except Mt5ClientError as terminal_err:
        logger.warning(
            "%s: terminal_info unreadable (code=%s) — capability undetermined",
            log_prefix,
            terminal_err.code,
        )
        return None
    except Exception as terminal_exc:  # noqa: BLE001 — see the docstring above
        # The typed arm above carries a scrubbed MT5 code; this one has no such
        # guarantee, so it logs the exception CLASS only. Never the message: an
        # unconverted transport raise is precisely the raw, unscrubbed rpyc text
        # `_guarded_read` exists to keep out of our logs, and `mt5linux`
        # f-string-interpolates the password into the source it evaluates
        # remotely (T-134-01 / T-153.3-23).
        logger.warning(
            "%s: terminal_info failed to materialize (error_class=%s) — "
            "capability undetermined",
            log_prefix,
            type(terminal_exc).__name__,
        )
        return None


def run_probe(
    client: Mt5Client,
    *,
    login: int,
    investor_pw: str,
    server: str,
    log_prefix: str,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any] | None]:
    """Log in, read the account + terminal, and probe capability ONCE.

    Returns ``(account_info, order_check_result, terminal_info)``. The
    ``order_check_result`` is ``{}`` when the terminal verdict already
    short-circuited the probe — which is the value ``classify_trade_capability``
    already expects for "no probe was run".

    ⛔ Raises are the CALLER's to dispose of. This body converts nothing: the
    router maps them onto HTTP statuses and the adapter onto a
    ``ValidationResult`` / a propagated transient, and those dispositions
    deliberately stay at the two call sites.
    """
    client.login(login, investor_pw, server)  # falsy -> Mt5ClientError
    info = client.account_info()  # proves auth + read
    assert_expected_login(info, login=login)  # PRE-probe bracket
    # D-31: the TERMINAL's own state, read once ATTACHED (it describes the
    # terminal we are logged into) and INSIDE the PRE/POST login bracket so the
    # whole probe stays framed by the account-mismatch guard.
    terminal = read_terminal(client, log_prefix=log_prefix)
    # ⭐ A CONCLUSIVE TERMINAL VERDICT SHORT-CIRCUITS THE PROBE.
    #
    # Asked with NO probe result, the ONE capability seam already answers
    # "undetermined" whenever the terminal signal alone forces a refusal —
    # unreadable, malformed, detached, or trade permission off. Running
    # order_check after that cannot improve the verdict, and it can DESTROY it:
    # with the gateway's algorithmic-trading permission off — the case D-31 was
    # written for, whether that is the Expert-Advisors "Allow algorithmic
    # trading" option (`Enabled`, the founder-measured live cause) or MetaQuotes'
    # separate default-ON "Disable automatic trading through the external Python
    # API" checkbox (`Api`) — the probe is refused, and its
    # Mt5ClientError leaves by a different door. classify_mt5_login_error's
    # _WRONG_SERVER_TOKENS carry "terminal", so that refusal came out as a 400
    # telling the user their BROKER SERVER is wrong: an accusation against the
    # user for a checkbox in OUR gateway, silently replacing the operator-facing
    # 500 that would have named the real remedy.
    #
    # ⛔ This NARROWS what can pre-empt the refusal; it never widens what can be
    # classified read_only. Branch 5 reaches "undetermined" for EVERY probe value,
    # so no read_only verdict is newly reachable. The only verdict the probe could
    # still have changed is trade_capable via retcode 10009 — itself a refusal,
    # and unobtainable from a terminal that refuses Python probes at all. The
    # POSITIVE master signal is untouched: it comes from
    # account_info().trade_allowed, read above and conclusive before any terminal
    # reasoning.
    #
    # The predicate is the SEAM ITSELF, deliberately not a fourth copy of the
    # shape test — a duplicated four-condition rule drifts, and the drift would be
    # silent (see terminal_trade_permission_off's docstring).
    if classify_trade_capability(info, {}, terminal) == "undetermined":
        # The POST bracket still runs: the terminal read we are about to classify
        # on must belong to OUR account, exactly as the probe result would have
        # had to.
        assert_expected_login(client.account_info(), login=login)
        return info, {}, terminal
    probe = client.order_check(mt5_probe_request())  # PROBE ONLY
    assert_expected_login(client.account_info(), login=login)  # POST-probe bracket
    return info, probe, terminal
