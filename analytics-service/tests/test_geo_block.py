"""Unit tests for services.geo_block.is_geo_blocked."""

from __future__ import annotations

import ccxt  # type: ignore[import-untyped]

from services.geo_block import is_geo_blocked


class TestIsGeoBlocked:
    def test_bybit_cloudfront_country_block(self) -> None:
        exc = ccxt.RateLimitExceeded(
            "bybit 403 Forbidden {error:The Amazon CloudFront distribution is "
            "configured to block access from your country}"
        )
        assert is_geo_blocked(exc) is True

    def test_binance_451_restricted_location(self) -> None:
        exc = ccxt.ExchangeError(
            "binance 451 Service unavailable from a restricted location "
            "according to 'b. Eligibility'"
        )
        assert is_geo_blocked(exc) is True

    def test_detects_signature_in_cause_chain(self) -> None:
        """The tell may live on __cause__ if a wrapper re-raised."""
        try:
            try:
                raise ccxt.RateLimitExceeded(
                    "403 {error:block access from your country}"
                )
            except ccxt.RateLimitExceeded as inner:
                raise RuntimeError("funding fetch failed") from inner
        except RuntimeError as outer:
            assert is_geo_blocked(outer) is True

    # --- Negatives: ordinary errors must NOT be mistaken for a geo-block ---

    def test_ordinary_rate_limit_is_not_geo_blocked(self) -> None:
        assert is_geo_blocked(ccxt.RateLimitExceeded("429 too many requests")) is False

    def test_auth_error_is_not_geo_blocked(self) -> None:
        assert is_geo_blocked(ccxt.AuthenticationError("invalid api key")) is False

    def test_bare_451_substring_without_eligibility_tell_is_not_geo_blocked(self) -> None:
        # A stray "451" in an unrelated payload must not trip the heuristic.
        assert is_geo_blocked(ccxt.BaseError("order id 451 filled")) is False

    def test_plain_403_permission_is_not_geo_blocked(self) -> None:
        assert is_geo_blocked(ccxt.PermissionDenied("403 endpoint not permitted")) is False

    def test_okx_operation_restricted_is_not_geo_blocked(self) -> None:
        # Regression (red-team 2026-06-02): the bare word "restricted" must NOT
        # trip the geo-block. OKX "Operation restricted" (funding-frozen / ADL)
        # is RETRYABLE — classifying it permanent would suppress a valid retry
        # (failed_final on the first attempt). The order id embeds "451".
        exc = ccxt.ExchangeError(
            "okx GET /api/v5/account/balance ordId=376870555451677 "
            '{"code":"50023","msg":"Operation restricted"}'
        )
        assert is_geo_blocked(exc) is False

    def test_451_in_price_substring_without_eligibility_is_not_geo_blocked(self) -> None:
        # Regression (red-team 2026-06-02): ccxt embeds the full response body
        # in str(exc), so a price/id like "1451.59" carries the substring "451".
        # Without a word-boundary 451 AND the "eligibility" tell this transient
        # 503 must stay retryable, not flip to permanent.
        exc = ccxt.ExchangeNotAvailable("okx 503 GET /time price=1451.59 service busy")
        assert is_geo_blocked(exc) is False

    def test_451_bearing_503_chained_from_restricted_cause_is_not_geo_blocked(self) -> None:
        # Regression (red-team 2026-06-02): the exact co-occurrence — a transient
        # 503 whose body embeds a 451-bearing price, chained from an
        # "Operation restricted" cause. Before the fix this satisfied
        # "451" + "restricted" and was mis-classified permanent (no retry).
        cause = ccxt.ExchangeError("okx Operation restricted")
        try:
            raise ccxt.ExchangeNotAvailable(
                "okx 503 price=1451.59 service busy"
            ) from cause
        except ccxt.ExchangeNotAvailable as e:
            assert is_geo_blocked(e) is False

    def test_451_with_eligibility_tell_but_no_phrase_marker_is_geo_blocked(self) -> None:
        # Positive case for the HTTP-451 heuristic branch: a 451 carrying the
        # specific "eligibility" tell but NOT the "restricted location" phrase
        # marker still classifies as a geo-block (word-boundary 451 + eligibility).
        exc = ccxt.ExchangeError(
            "binance GET /fapi/v1/account 451 "
            '{"code":0,"msg":"Service unavailable per b. Eligibility in your region"}'
        )
        assert is_geo_blocked(exc) is True
