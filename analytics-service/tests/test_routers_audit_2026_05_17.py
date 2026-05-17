"""Regression tests for audit-2026-05-07 cluster B fixes on
analytics-service/routers/portfolio.py.

(routers/cron.py findings from the same cluster were not test-covered
in this file — see the M-0596 / M-0597 deferral block below for the
test-infra-coupling reason. Cron router tests live in
`test_cron_router.py` and `test_cron_recompute_is_test_filter.py`.)

Covers:

  * L-0046 — `monthly_returns` build in `_compute_portfolio_analytics`
    is single-pass. The two-pass form (cumprod walk + finalize -1.0
    walk) is structurally fragile: a missed key in the finalize pass
    would silently leave a cumulative product on the row.

  * L-0047 — bridge endpoint trust boundary. A request whose user_id
    does NOT own the portfolio must 404. The integration test asserts
    the explicit reject so a future refactor that drops the ownership
    filter is caught.

  * L-0045 — bridge endpoint per-user rate limit (defense-in-depth
    behind the IP-only slowapi quota).

  * H-0594 — verify_strategy candidate cap + returns_series payload
    trim, bounding the JSONB memory footprint.

  * C-0209 — portfolio_optimizer endpoint coverage. Previously only the
    services helpers were tested. We add direct router tests for:
      - portfolio-not-found → HTTPException(404)
      - portfolio with zero strategies → HTTPException(400)
      - custom `req.weights` overriding base weights (phantom keys dropped)
      - persistence path: latest COMPLETE analytics row gets
        optimizer_suggestions UPDATE
      - no-completed-analytics fallback: response-only with persisted=False

These tests use `_reload_portfolio_with_noop_limiter()` to ensure the
endpoints are callable as plain coroutines (no slowapi Request state).
The autouse cleanup fixture evicts the reloaded modules so cron_router
tests that follow can re-import under their own stub regime.
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock

import pytest


# ---------------------------------------------------------------------------
# Pre-import shared stubs (mirrors test_portfolio_router_logic).
# ---------------------------------------------------------------------------


class _NoopLimiter:
    """Stand-in for slowapi.Limiter that turns @limiter.limit("…") into
    a no-op decorator so we can call the endpoint coroutine directly
    without slowapi installed."""

    def __init__(self, *args, **kwargs):
        pass

    def limit(self, *args, **kwargs):
        def decorator(fn):
            return fn
        return decorator


_PATCHED_SLOWAPI: dict[str, object] = {}


def _install_router_stubs():
    """Install sys.modules stubs so importing routers.portfolio works
    without slowapi / ccxt installed.

    Carefully scoped:

    * `slowapi` / `slowapi.util` — ALWAYS swap the `Limiter` attribute
      to `_NoopLimiter` (saving the original so we can restore it).
      The real slowapi Limiter wraps endpoints with state that expects
      a Starlette Request — we want the @limiter.limit("…") decorators
      on the routers.portfolio endpoints to be passthroughs so we can
      `await` them directly.
    * `ccxt` — leave alone if loaded; install a MagicMock only if
      missing (matches the legacy `_install_stubs` pattern).

    Notes on modules this helper deliberately does NOT touch:
    * `supabase` — left untouched. Sibling tests like
      `test_transition_rpc.py` capture
      `from supabase import create_client` at module top; a MagicMock
      here would silently break their assertions (the bug that took
      CI red on the first push of this PR).
    * `fastapi` — never stubbed. The real fastapi is needed so
      HTTPException carries a real `.status_code` attribute.
    """
    import slowapi
    import slowapi.util as slowapi_util

    # Save the real Limiter + get_remote_address so the autouse teardown
    # below can restore them. Patch the noop limiter in place so any
    # subsequent re-import of routers.portfolio (or any module that
    # rebinds `limiter = Limiter(...)`) picks up the noop form.
    _PATCHED_SLOWAPI.setdefault("Limiter", slowapi.Limiter)
    _PATCHED_SLOWAPI.setdefault("get_remote_address", slowapi_util.get_remote_address)
    slowapi.Limiter = _NoopLimiter  # type: ignore[attr-defined,assignment]
    slowapi_util.get_remote_address = MagicMock()  # type: ignore[attr-defined,assignment]

    for name in ("ccxt", "ccxt.async_support"):
        if name not in sys.modules:
            sys.modules[name] = MagicMock()


def _restore_slowapi():
    """Reverse `_install_router_stubs`'s slowapi patches so sibling
    tests that depend on the real Limiter / get_remote_address (none
    today, but the contract holds for future siblings) are not poisoned.
    """
    if _PATCHED_SLOWAPI:
        import slowapi
        import slowapi.util as slowapi_util
        slowapi.Limiter = _PATCHED_SLOWAPI["Limiter"]  # type: ignore[attr-defined,assignment]
        slowapi_util.get_remote_address = _PATCHED_SLOWAPI["get_remote_address"]  # type: ignore[attr-defined,assignment]
        _PATCHED_SLOWAPI.clear()


_install_router_stubs()


@pytest.fixture(autouse=True)
def _restore_portfolio_after_test():
    """Cleanup: drop reloaded `routers.portfolio` AND `routers.cron`
    from sys.modules after each test in this file so the next test
    re-imports cleanly under its own stub regime.

    Why both routers: if we reload `routers.portfolio` to pick up a
    fresh limiter, `routers.cron`'s lazy
    `from routers.portfolio import _compute_portfolio_analytics`
    resolves through sys.modules at cron_sync call time. Evicting both
    gives sibling test files (test_cron_router.py et al.) a clean
    slate when they re-import.

    slowapi attribute restoration is handled by
    `_restore_slowapi_at_module_teardown` below, NOT here.
    """
    yield
    sys.modules.pop("routers.portfolio", None)
    sys.modules.pop("routers.cron", None)


@pytest.fixture(scope="module", autouse=True)
def _restore_slowapi_at_module_teardown():
    """At module teardown, restore the real slowapi.Limiter and
    slowapi.util.get_remote_address so subsequent test files in the
    same pytest session don't see our `_NoopLimiter` shim.
    """
    yield
    _restore_slowapi()


# ---------------------------------------------------------------------------
# M-0596 / M-0597 — DOCUMENTED EXEMPTION
#
# The audit's prescribed fix ("hoist the `from routers.portfolio import
# _compute_portfolio_analytics` to module top") was attempted and
# reverted: the existing test infrastructure in
# test_cron_router.py::TestPortfolioRecomputeErrorIsolation et al.
# reassigns `sys.modules["routers.portfolio"]` then `patch.object`s the
# module's `_compute_portfolio_analytics` attribute. The function-local
# re-import resolves against the current sys.modules state, so the
# patch takes effect; a module-top binding captures the symbol at
# cron-load time and orphans the patches (the resulting test failures
# bypass _compute_portfolio_analytics entirely and fall through to the
# real Supabase client → RuntimeError on missing SUPABASE_URL).
#
# Closing this finding requires either (a) refactoring every
# cron_router test to patch by other means, or (b) extracting
# `_compute_portfolio_analytics` into a shared service module
# (services/portfolio_compute.py per the audit's secondary suggestion)
# — both are out-of-scope for cluster B. Status: deferred under
# audit-2026-05-07 cluster B as "deferred (test-infra coupling)".
# The audit-trail Markdown that originally tracked this (FIX-LIST-FIXED-
# cluster-B.md) was consolidated into the phase trail files under
# `.planning/audit-2026-05-07/` (PHASE-2-FIXED.md / PHASE-4-FIXED.md /
# PHASE-5-SIMPLIFY.md) — no separate FIX-LIST file is checked in.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# L-0046 — monthly_returns single-pass invariant
# ---------------------------------------------------------------------------


def test_monthly_returns_is_period_returns_not_cumulative_product():
    """L-0046 — drive the production `_build_monthly_returns` helper
    end-to-end. The post-fix code MUST yield period returns
    (cumprod(1+r) - 1) per (year, month). Pre-fix did two passes:
    build cumprod then subtract 1.0 in a second nested loop. A missed
    key in pass 2 left the cell as a cumulative product. The test
    imports the production helper so a future refactor that reverts
    to the two-pass shape (or any other algorithmic drift) WILL break
    this test.
    """
    import pandas as pd

    portfolio_mod = _reload_portfolio_with_noop_limiter()

    daily = pd.Series(
        [0.01, 0.02, -0.01, 0.005],
        index=pd.DatetimeIndex(
            ["2026-01-05", "2026-01-12", "2026-02-09", "2026-02-23"]
        ),
    )

    # Call the production helper (NOT a pasted copy). Rule 9: the
    # test verifies the router behavior, not its own implementation.
    monthly_returns = portfolio_mod._build_monthly_returns(daily)

    # Analytical expected:
    #   Jan 2026: (1.01 * 1.02) - 1 = 0.0302
    #   Feb 2026: (0.99 * 1.005) - 1 = -0.00505
    assert "2026" in monthly_returns
    assert set(monthly_returns["2026"].keys()) == {"01", "02"}
    assert monthly_returns["2026"]["01"] == pytest.approx(0.0302, rel=1e-9)
    assert monthly_returns["2026"]["02"] == pytest.approx(-0.00505, rel=1e-9)
    # Sanity: all entries must be in (-1, +inf), i.e. they ARE period
    # returns, not cumulative products that forgot the -1.0 subtract.
    for months in monthly_returns.values():
        for ret in months.values():
            assert ret > -1.0


# ---------------------------------------------------------------------------
# Reload helper for tests that need to drive the endpoints.
# ---------------------------------------------------------------------------


def _reload_portfolio_with_noop_limiter():
    """Return routers.portfolio with a guaranteed-noop limiter.

    Pre-conditions enforced at every call (NOT just module load), because
    sibling test files in the same pytest session ALSO have module-top
    `_install_stubs()` calls that reset `slowapi.Limiter` to a generic
    MagicMock. Alphabetical collection order puts at least one such
    file (test_routers_audit_emission.py) AFTER our module load, so the
    one-time patch at module top is not sufficient — every test must
    re-apply the noop before reloading routers.portfolio.

    Also evicts MagicMock-stubbed `fastapi` / `fastapi.routing` so the
    reload picks up the REAL FastAPI installed in the venv; sibling
    tests (test_portfolio_router_logic, test_portfolio_router_audit_*)
    stub fastapi.HTTPException to Exception which would break our
    `.status_code` assertions.
    """
    import importlib

    for name in ("fastapi", "fastapi.routing", "fastapi.exceptions"):
        mod = sys.modules.get(name)
        if mod is not None and isinstance(mod, MagicMock):
            sys.modules.pop(name, None)

    # Re-apply the noop limiter every call. Direct attribute assignment
    # via `import slowapi; slowapi.Limiter = _NoopLimiter` works whether
    # the module in sys.modules is the real package or a MagicMock stub.
    import slowapi
    import slowapi.util as slowapi_util
    slowapi.Limiter = _NoopLimiter  # type: ignore[attr-defined,assignment]
    slowapi_util.get_remote_address = MagicMock()  # type: ignore[attr-defined,assignment]

    sys.modules.pop("routers.portfolio", None)
    import fastapi  # noqa: F401
    import routers.portfolio as portfolio_mod  # noqa: F401
    importlib.reload(portfolio_mod)
    return portfolio_mod


# ---------------------------------------------------------------------------
# L-0047 — bridge endpoint trust boundary (mismatched user_id → 404)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_portfolio_bridge_rejects_mismatched_user_id():
    """L-0047 — the analytics-service trusts client-supplied user_id
    for ownership. The minimum-promise check is: a request whose
    user_id does NOT match `portfolios.user_id` MUST 404 (the
    `.eq("user_id", req.user_id).single()` SELECT returns no row).
    Without this assertion a refactor could drop the `.eq("user_id", …)`
    filter and the endpoint would silently leak portfolio data to any
    service-key holder.
    """
    portfolio_mod = _reload_portfolio_with_noop_limiter()

    # Mock supabase to return no row for the ownership-checked SELECT.
    mock_supabase = MagicMock()
    portfolio_chain = MagicMock()
    portfolio_chain.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(data=None)
    mock_supabase.table.return_value = portfolio_chain

    from unittest.mock import patch
    from fastapi import HTTPException

    req = MagicMock()
    req.portfolio_id = "portfolio-real"
    req.user_id = "attacker-uuid"  # not the owner
    req.underperformer_strategy_id = "s-1"

    request_obj = MagicMock()
    request_obj.headers = {}

    with patch.object(portfolio_mod, "get_supabase", return_value=mock_supabase):
        with pytest.raises(HTTPException) as exc_info:
            await portfolio_mod.portfolio_bridge(request_obj, req)

    assert exc_info.value.status_code == 404
    # Critical contract: the SELECT chain MUST call .eq twice with the
    # ownership filter — once on id, once on user_id. Without both the
    # `.single()` would return ANY row matching portfolio_id and the
    # 404 would never fire.
    select_chain = mock_supabase.table.return_value.select.return_value
    assert select_chain.eq.call_count >= 1
    eq_chain = select_chain.eq.return_value
    assert eq_chain.eq.call_count >= 1


# ---------------------------------------------------------------------------
# H-0594 — verify_strategy match payload bounded
# ---------------------------------------------------------------------------


def test_verify_strategy_match_candidate_limit_is_bounded():
    """H-0594 — `_MATCH_CANDIDATE_LIMIT` MUST be a small constant.
    Pre-audit the limit was 100; combined with up to 1k records per
    `returns_series` JSONB column the matching path materialized up
    to 100k objects per call. The audit lowered the candidate cap; we
    pin "<= 50" as a forward-compatible ceiling so a future tuning
    bump still has to justify crossing the soft cap.
    """
    portfolio_mod = _reload_portfolio_with_noop_limiter()
    assert portfolio_mod._MATCH_CANDIDATE_LIMIT <= 50, (
        f"_MATCH_CANDIDATE_LIMIT={portfolio_mod._MATCH_CANDIDATE_LIMIT} "
        "exceeds the audit-2026-05-07 H-0594 soft ceiling of 50. "
        "If you need more candidates, implement the fingerprint-based "
        "shortlist instead of bulk-fetching returns_series."
    )


def test_verify_strategy_matching_partial_status_surfaces_truncation():
    """audit-2026-05-07 red-team (CRITICAL conf 7) — when the catalog
    exceeds `_MATCH_CANDIDATE_LIMIT` and no peer is found within the
    bounded slice, the response MUST carry
    `matching_status='matching_partial'`, NOT `'no_match'`.

    Pre-fix: the SELECT capped the candidate list silently at
    _MATCH_CANDIDATE_LIMIT (=30) and the fall-through default was
    'no_match' — a FALSE NEGATIVE on the user-facing promise of
    `matched / no_match / matching_unavailable`. With a 500-strategy
    catalog, the user's actual peer might be the 31st-most-recent
    and would never be compared, but the user was told "nobody
    trades like you".

    Post-fix: when `len(published_ids) >= _MATCH_CANDIDATE_LIMIT`
    (the SELECT hit the cap) AND the matching loop finds no peer
    above _MATCH_CORRELATION_THRESHOLD, the status is flipped to
    'matching_partial' so the caller can render "we only compared
    the most-recent N strategies" UI.

    Test shape: assert the Literal in `models/schemas.py` includes
    `matching_partial` AND the router source contains the
    flip-to-partial branch. We pin both because the schema is the
    public OpenAPI contract and the router is the only producer.
    """
    import inspect

    portfolio_mod = _reload_portfolio_with_noop_limiter()
    # 1) Schema admits the new value.
    from models.schemas import VerifyStrategyResponse
    # Pydantic v2 — Literal-typed field exposes its allowed values via
    # the model's JSON schema. The OpenAPI schema is what typed-SDK
    # consumers switch on (review API-3); pin the enum members.
    schema = VerifyStrategyResponse.model_json_schema()
    matching_status_schema = schema["properties"]["matching_status"]
    # The field is Optional[Literal[...]] so it resolves to anyOf with
    # an enum branch + null branch. Extract the enum.
    enum_values: list[str] = []
    for branch in matching_status_schema.get("anyOf", []):
        if "enum" in branch:
            enum_values = branch["enum"]
            break
    if not enum_values and "enum" in matching_status_schema:
        enum_values = matching_status_schema["enum"]
    assert "matching_partial" in enum_values, (
        f"VerifyStrategyResponse.matching_status enum is {enum_values}; "
        "MUST include 'matching_partial' so callers can distinguish "
        "'cap hit + no peer in slice' from 'no peer exists' "
        "(red-team CRITICAL conf 7)"
    )

    # 2) Router code path flips to 'matching_partial' on cap-hit.
    # Inspect the verify_strategy source — the regression we are
    # pinning is the flip-to-partial branch right before the
    # except-handler. A future refactor that drops the branch will
    # fail this test loudly.
    src = inspect.getsource(portfolio_mod.verify_strategy)
    assert 'matching_status = "matching_partial"' in src, (
        "verify_strategy must flip to matching_partial when the "
        "candidate SELECT hit `_MATCH_CANDIDATE_LIMIT` and no peer "
        "was found within that bounded slice — the truthful answer "
        "is 'we only looked at the most-recent N', not 'no peer exists'"
    )
    assert "hit_candidate_cap" in src, (
        "the cap-hit detection variable was removed; the flip-to-"
        "partial branch above relies on it"
    )


def test_verify_strategy_returns_series_trim_caps_payload():
    """H-0594 — drive the production `_trim_returns_series` helper.
    `_MATCH_RETURNS_SERIES_MAX_POINTS` MUST exist and the trim helper
    must slice oversized `returns_series` payloads before
    deserialization. We construct an oversized record list and assert
    the trimmed copy is exactly _MATCH_RETURNS_SERIES_MAX_POINTS long
    AND ends on the trailing edge (the relevant window for recent-
    regime correlation matching).

    Calls the production helper so a future refactor that drops the
    trim from verify_strategy's row loop (or weakens the slice
    semantics) WILL break this test.
    """
    portfolio_mod = _reload_portfolio_with_noop_limiter()
    cap = portfolio_mod._MATCH_RETURNS_SERIES_MAX_POINTS
    assert isinstance(cap, int) and cap > 0
    oversized = [
        {"date": f"2020-01-{i:02d}", "value": float(i)}
        for i in range(1, cap + 200)
    ]
    # Call the production helper (NOT a pasted slice). Rule 9: the
    # test verifies the router behavior, not its own implementation.
    trimmed = portfolio_mod._trim_returns_series(oversized)
    assert len(trimmed) == cap
    assert trimmed[-1] == oversized[-1]
    # Under-cap input is value-equal but MUST NOT be the same object
    # (audit-2026-05-07 red-team MED conf 8 — `_trim_returns_series`
    # always returns a fresh list to avoid the future-mutation footgun).
    small = [{"date": "2026-01-01", "value": 1.0}]
    out = portfolio_mod._trim_returns_series(small)
    assert out == small
    assert out is not small, (
        "_trim_returns_series must return a fresh list (defensive copy) "
        "even on the no-trim path — a shared reference lets future "
        "enrichment loops silently mutate Supabase row data still held "
        "in sa_result.data (red-team MED conf 8)"
    )
    # Non-list inputs pass through (None / malformed JSONB tolerated).
    assert portfolio_mod._trim_returns_series(None) is None


def test_trim_returns_series_caller_mutation_does_not_leak_to_input():
    """audit-2026-05-07 red-team (MED conf 8) — regression test for the
    aliasing footgun. A future enrichment loop that appends to the
    trimmed list MUST NOT mutate the original Supabase row's payload.

    Pre-fix the no-trim path returned the SAME object, so
    `trimmed.append({...})` would have leaked the new record into
    `sa_result.data` — a subtle bug because the test surface (the
    correlation matching loop) iterates non-destructively.
    """
    portfolio_mod = _reload_portfolio_with_noop_limiter()

    original = [
        {"date": "2026-01-01", "value": 0.01},
        {"date": "2026-01-02", "value": 0.02},
    ]
    original_snapshot = list(original)
    trimmed = portfolio_mod._trim_returns_series(original)
    trimmed.append({"date": "2026-01-03", "value": 999.0})
    assert original == original_snapshot, (
        "trimmed.append leaked into the original list — defensive copy "
        "is missing from `_trim_returns_series`"
    )


def test_build_monthly_returns_dedupes_duplicate_dates():
    """audit-2026-05-07 red-team (MED conf 8) — `_build_monthly_returns`
    MUST be idempotent under duplicate dates. Upstream
    `returns_series` JSONB can contain repeated `date` keys (no
    dedupe in `_records_to_series`) — without this guard the
    cumprod walk double-counts the day's return into the
    `(year, month)` bucket and overstates the month.

    Test: build a daily series with one duplicated date, assert the
    monthly bucket matches the deduped (last-write-wins) result, NOT
    the (1+v1)*(1+v2) double-count.
    """
    import pandas as pd

    portfolio_mod = _reload_portfolio_with_noop_limiter()

    # Two entries on Jan 5 — duplicate date. Last-write-wins → 0.03
    # is the value that survives the dedupe. Plus Jan 12 = 0.01.
    daily = pd.Series(
        [0.02, 0.03, 0.01],
        index=pd.DatetimeIndex(["2026-01-05", "2026-01-05", "2026-01-12"]),
    )
    monthly = portfolio_mod._build_monthly_returns(daily)
    # Expected (deduped): (1.03 * 1.01) - 1 = 0.0403
    # WRONG (double-count): (1.02 * 1.03 * 1.01) - 1 = 0.061106
    assert monthly["2026"]["01"] == pytest.approx(0.0403, rel=1e-9), (
        "monthly bucket double-counted a duplicate date — dedupe guard "
        "is missing from _build_monthly_returns (red-team MED conf 8)"
    )


# ---------------------------------------------------------------------------
# L-0045 — bridge endpoint per-user rate limit (defense-in-depth)
# ---------------------------------------------------------------------------


def test_portfolio_bridge_rejects_when_per_user_quota_burned():
    """L-0045 — without a per-user limiter, slowapi's IP-only quota
    collapses to a single bucket behind Next.js. A hostile user on the
    same egress IP pool could starve all other users. We assert that
    after _BRIDGE_USER_RATE_LIMIT successful calls from the same
    user_id, the next one is rejected — independent of the slowapi
    limit (which is decorated noop-passthrough in tests).
    """
    portfolio_mod = _reload_portfolio_with_noop_limiter()

    user_id = "test-user-rate-limit"
    portfolio_mod._bridge_user_attempts.pop(user_id, None)
    for _ in range(portfolio_mod._BRIDGE_USER_RATE_LIMIT):
        assert portfolio_mod._check_bridge_user_rate(user_id) is True
    # Next attempt MUST be rejected.
    assert portfolio_mod._check_bridge_user_rate(user_id) is False


def test_portfolio_bridge_rate_limit_evicts_oldest_at_cache_cap():
    """L-0045 — the per-user bucket dict must NOT leak memory unbounded.
    An attacker submitting unique user_ids could otherwise grow the
    process heap. We assert insertion-order LRU eviction kicks in at
    _BRIDGE_USER_CACHE_MAX and the dict size never exceeds the cap.
    """
    portfolio_mod = _reload_portfolio_with_noop_limiter()
    original_cap = portfolio_mod._BRIDGE_USER_CACHE_MAX
    portfolio_mod._BRIDGE_USER_CACHE_MAX = 5
    portfolio_mod._bridge_user_attempts.clear()
    try:
        for i in range(20):
            portfolio_mod._check_bridge_user_rate(f"user-{i}")
        assert len(portfolio_mod._bridge_user_attempts) <= 5
    finally:
        portfolio_mod._BRIDGE_USER_CACHE_MAX = original_cap
        portfolio_mod._bridge_user_attempts.clear()


def test_portfolio_bridge_over_budget_user_survives_cache_pressure():
    """audit-2026-05-07 red-team (HIGH conf 8) — a rate-limited user
    MUST NOT regain quota when CACHE_MAX fresh users arrive.

    Pre-fix: the over-budget branch did `bucket_map[key] = bucket`
    WITHOUT first popping the key. In CPython, re-assigning an
    existing dict key does NOT move it to insertion-order tail —
    the rejected user stays at the dict head while every distinct
    successful caller is appended to the tail. Once CACHE_MAX
    distinct callers arrive, the rejected user's bucket is the
    first thing evicted by `next(iter(bucket_map))` and their NEXT
    call starts a fresh empty bucket → another 30 requests in the
    same hour.

    Post-fix: the over-budget branch also `pop+reinsert`s, so the
    attacker's bucket competes fairly for the cache slot. The
    attacker's bucket may STILL be evicted under sustained cache
    pressure (LRU is LRU), but it cannot be evicted faster than
    legitimate buckets — the bypass relied on the attacker being
    pinned at the head while everyone else moved to the tail.

    Test shape: burn LIMIT from 'attacker', cycle CACHE_MAX-1 fresh
    users, then re-check 'attacker'. Pre-fix this returns True
    (bucket evicted, fresh window). Post-fix, the attacker's
    bucket either survived (still rejected) OR was evicted (now a
    fresh window) — but the attacker must NOT be the FIRST entry
    evicted from a dict where they have been the MOST RECENT
    submitter. We assert position: the attacker is NOT at the head
    of the dict after their reject — they were moved to the tail.
    """
    portfolio_mod = _reload_portfolio_with_noop_limiter()
    portfolio_mod._bridge_user_attempts.clear()
    try:
        # Step 1: burn LIMIT successful calls; assert next is rejected.
        attacker = "attacker-uuid"
        for _ in range(portfolio_mod._BRIDGE_USER_RATE_LIMIT):
            assert portfolio_mod._check_bridge_user_rate(attacker) is True
        assert portfolio_mod._check_bridge_user_rate(attacker) is False

        # Step 2: after the reject, the attacker MUST be at the
        # dict tail (most-recently-touched), NOT the head. Pre-fix
        # the attacker stayed at the head and would be evicted
        # first under LRU pressure.
        keys = list(portfolio_mod._bridge_user_attempts.keys())
        assert keys[-1] == attacker, (
            "over-budget branch did not refresh LRU position — "
            "attacker pinned at dict head, will be evicted by "
            "fresh callers and silently regain a fresh window"
        )

        # Step 3: even after a wave of fresh users, the attacker's
        # most-recent reject keeps their bucket at the dict tail,
        # so they remain rejected when re-tested back-to-back.
        for i in range(10):
            portfolio_mod._check_bridge_user_rate(f"fresh-user-{i}")
        # Touch attacker again — still over budget within the window.
        assert portfolio_mod._check_bridge_user_rate(attacker) is False
    finally:
        portfolio_mod._bridge_user_attempts.clear()


@pytest.mark.asyncio
async def test_portfolio_bridge_rate_limit_runs_after_ownership_select():
    """audit-2026-05-07 red-team (MED conf 8) — `_check_bridge_user_rate`
    MUST run AFTER the portfolio ownership SELECT, NOT before.

    Pre-fix order: rate-limit check → ownership SELECT. An attacker
    submitting forged/unauthenticated user_ids consumed cache slots
    on every request. With CACHE_MAX=10k, ~10k unique uuids could
    fully turn over the bucket dict and silently evict every
    legitimate user's bucket → per-user limiter disabled.

    Post-fix order: ownership SELECT → rate-limit check. A mismatched
    user_id 404s on the SELECT and NEVER reaches the limiter, so the
    bucket cache contains only DB-validated user_ids.

    Test: a request with a user_id that does NOT own the portfolio
    MUST 404 (not 429), AND the limiter's bucket dict MUST remain
    empty afterwards (the forged user_id never made it past the
    SELECT).
    """
    portfolio_mod = _reload_portfolio_with_noop_limiter()
    portfolio_mod._bridge_user_attempts.clear()

    mock_supabase = MagicMock()
    portfolio_chain = MagicMock()
    portfolio_chain.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(data=None)
    mock_supabase.table.return_value = portfolio_chain

    from unittest.mock import patch
    from fastapi import HTTPException

    req = MagicMock()
    req.portfolio_id = "portfolio-real"
    req.user_id = "attacker-uuid-not-in-db"
    req.underperformer_strategy_id = "s-1"

    request_obj = MagicMock()
    request_obj.headers = {}

    with patch.object(portfolio_mod, "get_supabase", return_value=mock_supabase):
        with pytest.raises(HTTPException) as exc_info:
            await portfolio_mod.portfolio_bridge(request_obj, req)

    # 404 (ownership SELECT), NOT 429 — confirms the ownership check
    # ran first AND the forged user_id never reached the limiter.
    assert exc_info.value.status_code == 404
    # The forged user_id MUST NOT have consumed a cache slot.
    assert "attacker-uuid-not-in-db" not in portfolio_mod._bridge_user_attempts, (
        "forged user_id poisoned the rate-limit cache — the limiter "
        "check ran BEFORE the ownership SELECT (red-team MED conf 8)"
    )


def test_portfolio_bridge_rate_limit_uses_wall_clock_not_monotonic():
    """audit-2026-05-07 red-team (MED conf 8) — the in-process
    sliding window MUST use `time.time()`, not `time.monotonic()`.

    `time.monotonic()` resets to 0 on a new process (worker
    recycle / cold start). A bucket stamped with the OLD process's
    monotonic value is then in the past relative to the NEW
    process's `time.monotonic() - window_sec` cutoff, so every
    stored timestamp prunes to empty — every user silently
    regains a fresh 30-call window on every worker recycle.
    Wall-clock timestamps survive the process boundary (they are
    absolute) so the same `now - window_sec` cutoff continues to
    bound the same bucket entries.

    Implementation contract: assert `_check_sliding_window_rate`
    is reachable from `routers.portfolio` and that the production
    code reads `time.time` (not `time.monotonic`). We inspect the
    function's source to pin the choice — a future refactor that
    silently flips back to `time.monotonic` will break this test.
    """
    import inspect

    portfolio_mod = _reload_portfolio_with_noop_limiter()
    src = inspect.getsource(portfolio_mod._check_sliding_window_rate)
    assert "time.time()" in src, (
        "_check_sliding_window_rate must use wall-clock time.time() "
        "to survive worker recycles — see audit red-team MED conf 8"
    )
    assert "time.monotonic" not in src, (
        "time.monotonic restarts at 0 on cold start and silently "
        "invalidates every stored timestamp → free quota refill on "
        "every worker recycle"
    )


# ---------------------------------------------------------------------------
# C-0209 — portfolio_optimizer endpoint coverage
# ---------------------------------------------------------------------------


def _make_optimizer_supabase(
    *,
    portfolio_row: dict | None,
    portfolio_strategies: list[dict],
    sa_in_data: list[dict],
    published_data: list[dict],
    sa_cand_data: list[dict],
    latest_analytics: list[dict],
) -> MagicMock:
    """Build a Supabase mock whose `.table(name)` dispatch yields the
    correct chain for each table touched by `portfolio_optimizer`.
    """
    mock = MagicMock()

    portfolio_chain = MagicMock()
    portfolio_chain.select.return_value.eq.return_value.single.return_value.execute.return_value = (
        MagicMock(data=portfolio_row)
    )

    ps_chain = MagicMock()
    ps_chain.select.return_value.eq.return_value.execute.return_value = MagicMock(
        data=portfolio_strategies
    )

    sa_in_chain = MagicMock()
    sa_in_chain.select.return_value.in_.return_value.execute.return_value = MagicMock(
        data=sa_in_data
    )

    strategies_chain = MagicMock()
    strategies_chain.select.return_value.eq.return_value.not_.in_.return_value.order.return_value.limit.return_value.execute.return_value = (
        MagicMock(data=published_data)
    )

    sa_cand_chain = MagicMock()
    sa_cand_chain.select.return_value.in_.return_value.execute.return_value = MagicMock(
        data=sa_cand_data
    )

    pa_chain = MagicMock()
    pa_chain.select.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = (
        MagicMock(data=latest_analytics)
    )
    pa_update_execute = MagicMock(return_value=MagicMock(data=[]))
    pa_chain.update.return_value.eq.return_value.execute = pa_update_execute

    call_order = {"count": 0}
    sa_chains = [sa_in_chain, sa_cand_chain]

    def _dispatch(name: str):
        if name == "portfolios":
            return portfolio_chain
        if name == "portfolio_strategies":
            return ps_chain
        if name == "strategies":
            return strategies_chain
        if name == "strategy_analytics":
            chain = sa_chains[min(call_order["count"], len(sa_chains) - 1)]
            call_order["count"] += 1
            return chain
        if name == "portfolio_analytics":
            return pa_chain
        return MagicMock()

    mock.table.side_effect = _dispatch
    mock._pa_update_execute = pa_update_execute
    mock._strategies_chain = strategies_chain
    return mock


@pytest.mark.asyncio
async def test_portfolio_optimizer_portfolio_not_found_raises_404():
    """C-0209 (a) — portfolio-not-found path must HTTPException(404)."""
    portfolio_mod = _reload_portfolio_with_noop_limiter()
    from unittest.mock import patch
    from fastapi import HTTPException

    supabase = _make_optimizer_supabase(
        portfolio_row=None,
        portfolio_strategies=[],
        sa_in_data=[],
        published_data=[],
        sa_cand_data=[],
        latest_analytics=[],
    )

    req = MagicMock()
    req.portfolio_id = "missing"
    req.weights = None

    with patch.object(portfolio_mod, "get_supabase", return_value=supabase):
        with pytest.raises(HTTPException) as exc_info:
            await portfolio_mod.portfolio_optimizer(MagicMock(), req)
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_portfolio_optimizer_no_strategies_raises_400():
    """C-0209 (b) — portfolio with zero strategies must 400, not crash
    silently nor return an empty `suggestions` list (the latter would
    be ambiguous with the no-candidates branch)."""
    portfolio_mod = _reload_portfolio_with_noop_limiter()
    from unittest.mock import patch
    from fastapi import HTTPException

    supabase = _make_optimizer_supabase(
        portfolio_row={"id": "p1", "user_id": "u1"},
        portfolio_strategies=[],
        sa_in_data=[],
        published_data=[],
        sa_cand_data=[],
        latest_analytics=[],
    )

    req = MagicMock()
    req.portfolio_id = "p1"
    req.weights = None

    with patch.object(portfolio_mod, "get_supabase", return_value=supabase):
        with pytest.raises(HTTPException) as exc_info:
            await portfolio_mod.portfolio_optimizer(MagicMock(), req)
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_portfolio_optimizer_no_returns_data_raises_400():
    """C-0209 (d) — portfolio_strategies is non-empty but every row's
    `returns_series` is NULL / empty / malformed, so `_records_to_series`
    returns None for all of them. The endpoint MUST raise
    HTTPException(400, 'No returns data available for portfolio
    strategies') rather than returning an empty `portfolio_returns`
    map and crashing downstream on the empty DataFrame build.
    Closes the 6th and final portfolio_optimizer branch the original
    PR left uncovered.
    """
    portfolio_mod = _reload_portfolio_with_noop_limiter()
    from unittest.mock import patch
    from fastapi import HTTPException

    supabase = _make_optimizer_supabase(
        portfolio_row={"id": "p1", "user_id": "u1"},
        portfolio_strategies=[
            {"strategy_id": "s-real", "current_weight": 1.0},
        ],
        # returns_series=None for the one strategy → _records_to_series
        # returns None → portfolio_returns stays empty → 400 path.
        sa_in_data=[{"strategy_id": "s-real", "returns_series": None}],
        published_data=[],
        sa_cand_data=[],
        latest_analytics=[],
    )

    req = MagicMock()
    req.portfolio_id = "p1"
    req.weights = None

    with patch.object(portfolio_mod, "get_supabase", return_value=supabase):
        with pytest.raises(HTTPException) as exc_info:
            await portfolio_mod.portfolio_optimizer(MagicMock(), req)
    assert exc_info.value.status_code == 400
    assert "No returns data" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_portfolio_optimizer_phantom_weights_are_dropped():
    """C-0209 (c) — custom req.weights that contain strategy_ids not in
    the portfolio MUST be dropped. Pre-audit the loop blindly applied
    req.weights.update; any service-key holder could inject a ghost
    strategy and corrupt the score matrix. We assert no candidates are
    scored against the phantom by checking the strategies SELECT was
    scoped to the real `strategy_ids` only.
    """
    portfolio_mod = _reload_portfolio_with_noop_limiter()
    from unittest.mock import patch

    supabase = _make_optimizer_supabase(
        portfolio_row={"id": "p1", "user_id": "u1"},
        portfolio_strategies=[
            {"strategy_id": "s-real", "current_weight": 1.0},
        ],
        sa_in_data=[
            {
                "strategy_id": "s-real",
                "returns_series": [
                    {"date": "2026-01-01", "value": 0.01},
                    {"date": "2026-01-02", "value": 0.02},
                ],
            }
        ],
        published_data=[],
        sa_cand_data=[],
        latest_analytics=[],
    )

    req = MagicMock()
    req.portfolio_id = "p1"
    req.weights = {"s-real": 0.5, "s-phantom": 0.5}

    with patch.object(portfolio_mod, "get_supabase", return_value=supabase), \
         patch.object(portfolio_mod, "log_audit_event"):
        result = await portfolio_mod.portfolio_optimizer(MagicMock(), req)

    assert result["ok"] is True
    strategies_chain = supabase._strategies_chain
    not_in_call = strategies_chain.select.return_value.eq.return_value.not_.in_
    assert not_in_call.called
    excluded_ids = not_in_call.call_args.args[1]
    assert "s-phantom" not in excluded_ids
    assert "s-real" in excluded_ids


@pytest.mark.asyncio
async def test_portfolio_optimizer_persists_on_complete_analytics():
    """C-0209 (e) — when the latest analytics row is COMPLETE, the
    optimizer MUST UPDATE optimizer_suggestions onto it. The
    `persisted` flag in the response MUST be True.
    """
    portfolio_mod = _reload_portfolio_with_noop_limiter()
    from unittest.mock import patch

    supabase = _make_optimizer_supabase(
        portfolio_row={"id": "p1", "user_id": "u1"},
        portfolio_strategies=[
            {"strategy_id": "s-real", "current_weight": 1.0},
        ],
        sa_in_data=[
            {
                "strategy_id": "s-real",
                "returns_series": [
                    {"date": "2026-01-01", "value": 0.01},
                    {"date": "2026-01-02", "value": 0.02},
                ],
            }
        ],
        published_data=[
            {"id": "c-1", "name": "Candidate 1"},
        ],
        sa_cand_data=[
            {
                "strategy_id": "c-1",
                "returns_series": [
                    {"date": "2026-01-01", "value": -0.01},
                    {"date": "2026-01-02", "value": -0.02},
                ],
            }
        ],
        latest_analytics=[{"id": "pa-1"}],
    )

    req = MagicMock()
    req.portfolio_id = "p1"
    req.weights = None

    with patch.object(portfolio_mod, "get_supabase", return_value=supabase), \
         patch.object(portfolio_mod, "log_audit_event"):
        result = await portfolio_mod.portfolio_optimizer(MagicMock(), req)

    assert result["persisted"] is True
    assert supabase._pa_update_execute.called


@pytest.mark.asyncio
async def test_portfolio_optimizer_response_only_when_no_complete_analytics():
    """C-0209 (e) — when NO COMPLETE analytics row exists, suggestions
    are returned response-only (`persisted=False`). Pre-audit the
    endpoint silently dropped them.
    """
    portfolio_mod = _reload_portfolio_with_noop_limiter()
    from unittest.mock import patch

    supabase = _make_optimizer_supabase(
        portfolio_row={"id": "p1", "user_id": "u1"},
        portfolio_strategies=[
            {"strategy_id": "s-real", "current_weight": 1.0},
        ],
        sa_in_data=[
            {
                "strategy_id": "s-real",
                "returns_series": [
                    {"date": "2026-01-01", "value": 0.01},
                    {"date": "2026-01-02", "value": 0.02},
                ],
            }
        ],
        published_data=[
            {"id": "c-1", "name": "Candidate 1"},
        ],
        sa_cand_data=[
            {
                "strategy_id": "c-1",
                "returns_series": [
                    {"date": "2026-01-01", "value": -0.01},
                    {"date": "2026-01-02", "value": -0.02},
                ],
            }
        ],
        latest_analytics=[],  # no COMPLETE row
    )

    req = MagicMock()
    req.portfolio_id = "p1"
    req.weights = None

    with patch.object(portfolio_mod, "get_supabase", return_value=supabase), \
         patch.object(portfolio_mod, "log_audit_event"):
        result = await portfolio_mod.portfolio_optimizer(MagicMock(), req)

    assert result["persisted"] is False
    assert not supabase._pa_update_execute.called
