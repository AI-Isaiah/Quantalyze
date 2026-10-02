# Phase 121 — Red-team review fixes (F1–F5)

Fixed at: 2026-07-19 · Branch: `gsd/v1.12-sfox-verified-integration`
Scope: proxy-secret hygiene (the class defect) + F4-partial hardening + F5 whitespace.

## Summary

| Finding | Status | Commit | What changed |
|---------|--------|--------|--------------|
| **F1** proxy URL userinfo blind spot (the root cause) | fixed | `611e18c4` | `services/redact.py`: new `URL_USERINFO` pattern + `scrub_url_userinfo()` helper, applied as Pass 0 in `scrub_freeform_string` and exported. `SENSITIVE_KEY_VALUE`/JWT passes were structurally blind to `scheme://user:pass@host`. |
| **F2** SfoxClient + Sentry error paths | fixed | `423a5972` | `sfox_client.py` `_request`: by-value redact `self._proxy` (like `self._api_key`) in BOTH the transport and non-2xx arms. `sentry_init.py`: denylist proxy-named keys (`proxy`,`_proxy`,`_egress_proxy`,`worker_egress_proxy_url`) + new `_url_userinfo_sweep` stage in `_scrub` over every string leaf (frame vars, extra, contexts, breadcrumbs). |
| **F3** probe stdout leak | fixed | `4756f209` | `scripts/probe_exchange_egress.py` `_get` catch-all body now runs through `scrub_url_userinfo` before it is returned/printed (the old `_redact_proxy` only covered the routed-through note). |
| **F5** confusing whitespace failure | fixed | `8c9c3720` | `sfox_factory.py`: whitespace-only `WORKER_EGRESS_PROXY_URL` → None (via `.isspace()`, NOT `.strip()` — the module's AST guard forbids stripping). New `_validate_proxy_url` fails loud on a malformed non-empty URL with a secret-free message. |
| **F4-partial** open-relay + README secret | fixed | `ab5eee33` | `tinyproxy.filter` allow-list (sFOX/ccxt/ipinfo hosts) + `FilterDefaultDeny Yes` in the template + Dockerfile COPY. README step 7 now references `$WORKER_EGRESS_PROXY_URL` (no secret on the command line) and documents the plaintext-BasicAuth residual + the 443-TLS-front upgrade. **TLS-front redesign deliberately NOT attempted.** |

## F1(c) — the ccxt path is closed by the root-cause fix, no `exchange.py` change

`create_exchange` itself never logs/raises the proxy. Every ccxt error branch in
`validate_key_permissions` (PermissionDenied, AuthenticationError, DDoSProtection,
RateLimitExceeded, ExchangeNotAvailable, **NetworkError** — the proxy-failure vector,
and the generic backstop) already routes `str(exc)` through `scrub_freeform_string`.
With F1 that scrub now redacts URL userinfo, so a proxy-bearing ccxt error is
redacted with zero exchange.py edits. Regression pinned in
`test_scrub_freeform_string_redacts_ccxt_networkerror_with_proxy`.

## Verification

- Required targeted suite GREEN: `test_egress_proxy_wiring · test_egress_proxy_connect · test_probe_egress_verify · test_redact` (+ `test_sfox_client · test_sentry_init · test_stdlib_redact_bridge`) → 158 passed.
- FULL analytics suite: **4028 passed, 96 skipped, 0 failed**.
- `scrub_pii` (the shared TS-parity corpus consumer) is untouched → cross-runtime parity preserved.

## Confirmed non-leak (the three vectors) + byte-identical-unset

1. Malformed-URL error message — `test_transport_error_redacts_proxy_userinfo` (SfoxClient) + `test_make_sfox_client_malformed_bad_port_fails_loud_no_secret` (factory).
2. Sentry frame vars — `test_exception_frame_vars_redact_proxy_url` (proxy-named key AND non-denylisted `url` value AND `exception.value`).
3. Probe stdout — `test_get_error_body_redacts_proxy_userinfo` + existing `test_proxy_url_secret_never_printed`.
4. Byte-identical-when-unset preserved — the wiring suite's unset/empty pins stay green, whitespace-only now also coerces to None, valid URLs still thread unchanged.
