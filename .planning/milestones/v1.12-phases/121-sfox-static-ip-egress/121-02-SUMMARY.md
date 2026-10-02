---
phase: 121-sfox-static-ip-egress
plan: 02
subsystem: infra
tags: [aiohttp, ccxt, proxy, egress, sfox, static-ip, connect-tunnel, fail-loud]

# Dependency graph
requires:
  - phase: 118-sfox-adapter
    provides: SfoxClient with an explicit `proxy=` ctor seam (trust_env=False)
  - phase: 120-sfox-ingestion
    provides: the 4 SfoxClient construction sites + probe_exchange_egress.py
provides:
  - services/sfox_factory.py — make_sfox_client() reads WORKER_EGRESS_PROXY_URL once and threads it as an explicit proxy at all 4 SfoxClient sites
  - create_exchange() ccxt aiohttp_proxy opt-in behind WORKER_EGRESS_PROXY_APPLIES_TO_CCXT (default OFF)
  - probe_exchange_egress --expect <ip> fail-loud pre-whitelist gate (routes through the proxy, redacts the secret)
affects: [121-03, sfox-deploy, founder-runbook, static-ip-whitelisting]

# Tech tracking
tech-stack:
  added: []  # zero new packages — aiohttp/ccxt already installed
  patterns:
    - "One env var, UNSET = byte-identical (proxy None / aiohttp_proxy None class default)"
    - "Factory reads env once, passes proxy explicitly (never aiohttp trust_env)"
    - "ccxt proxy opt-in gated by a separate flag so working ccxt egress is undisturbed"
    - "Fail-loud verification gate: never false-pass on missing evidence"

key-files:
  created:
    - analytics-service/services/sfox_factory.py
    - analytics-service/tests/test_egress_proxy_wiring.py
    - analytics-service/tests/test_egress_proxy_connect.py
    - analytics-service/tests/test_probe_egress_verify.py
  modified:
    - analytics-service/services/exchange.py
    - analytics-service/routers/exchange.py
    - analytics-service/routers/internal.py
    - analytics-service/services/job_worker.py
    - analytics-service/services/ingestion/sfox.py
    - analytics-service/scripts/probe_exchange_egress.py

key-decisions:
  - "Factory NEVER .strip()s the api_key — each call site keeps its EXACT current credential expression so env-unset wiring is byte-identical (deviation from RESEARCH Pattern 2, documented in the factory docstring)"
  - "Empty-string WORKER_EGRESS_PROXY_URL coerces to None (an unset Railway var reads as \"\") — byte-identical to truly unset"
  - "ccxt proxy is OPT-IN (WORKER_EGRESS_PROXY_APPLIES_TO_CCXT, default OFF); sFOX is proxied by default. The founder's working ccxt Amsterdam egress must not silently reroute"
  - "The 3 pre-existing sfox suites had to move their mock injection seam from SfoxClient -> make_sfox_client (they patch the constructor by name); behavioral assertions are unchanged"
  - "scripts/sfox_ground_truth.py keeps its bare SfoxClient(proxy=...) with its OWN SFOX_GROUND_TRUTH_PROXY env — a founder-run harness, out of scope for the 4 worker sites"

patterns-established:
  - "make_sfox_client() is the ONE place WORKER_EGRESS_PROXY_URL becomes an explicit proxy for the worker's sFOX egress"
  - "Secret hygiene: the proxy URL (BasicAuth) is never logged/repr'd; the probe redacts to scheme://host:port"

requirements-completed: [SFOX-07]

# Metrics
duration: 30min
completed: 2026-07-19
---

# Phase 121 Plan 02: Worker Egress Proxy Wiring Summary

**One env var (WORKER_EGRESS_PROXY_URL) threaded into both worker egress transports — a make_sfox_client() factory at all 4 SfoxClient sites (explicit proxy=, never trust_env) + opt-in ccxt aiohttp_proxy — plus a probe --expect fail-loud egress gate, with UNSET env proven byte-identical to today.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 3 (all TDD: RED → GREEN)
- **Files modified:** 6 edited, 4 created (13 files total incl. 3 pre-existing test seams)

## Accomplishments
- `services/sfox_factory.py`: `worker_egress_proxy_url()` (empty/unset → None) + `make_sfox_client()` threads `proxy=` explicitly (trust_env stays False inside SfoxClient — the aiohttp env-proxy trap avoided).
- All 4 SfoxClient construction sites (routers/exchange.py, routers/internal.py, services/job_worker.py, services/ingestion/sfox.py) now route through the factory; each site's exact credential expression preserved (internal/job_worker keep their `.strip()`).
- `create_exchange()` sets `exchange.aiohttp_proxy` ONLY when the URL is set AND `WORKER_EGRESS_PROXY_APPLIES_TO_CCXT ∈ {1,true,on}` (default OFF → ccxt egress byte-identical).
- `probe_exchange_egress --expect <ip>`: routes fetches through the proxy (urllib ProxyHandler), prints the realized egress IP, exits 1 on mismatch OR missing evidence, and redacts the proxy secret.
- CONNECT proof (`test_egress_proxy_connect.py`): a mock proxy pins that `Proxy-Authorization: Basic base64(alice:s3cret)` lands on `CONNECT api.sfox.com:443` while the sFOX Bearer NEVER appears on the proxy hop (tunnel opacity, T-121-05).

## Task Commits

1. **Task 1: make_sfox_client factory + ccxt opt-in in create_exchange** - `cf3fb3fc` (feat)
2. **Task 2: wire all 4 SfoxClient sites through the factory** - `17658668` (feat)
3. **Task 3: probe --expect fail-loud gate + CONNECT Proxy-Authorization proof** - `dd70d389` (feat)

_All three tasks were TDD (RED tests written first, confirmed failing, then GREEN)._

## Files Created/Modified
- `services/sfox_factory.py` - The ONE place WORKER_EGRESS_PROXY_URL becomes an explicit proxy; no .strip, no logging of the URL.
- `services/exchange.py` - create_exchange sets aiohttp_proxy behind the ccxt opt-in flag (post-construction block; bybit branch untouched).
- `routers/exchange.py`, `routers/internal.py`, `services/job_worker.py`, `services/ingestion/sfox.py` - construct via make_sfox_client.
- `scripts/probe_exchange_egress.py` - main(argv) + --expect fail-loud gate + ProxyHandler routing + secret redaction.
- `tests/test_egress_proxy_wiring.py` - env set/unset threading + all-4-sites source-scan + functional wiring (27 tests).
- `tests/test_egress_proxy_connect.py` - CONNECT auth lands + Bearer-absent (Pitfall-1 standing guard).
- `tests/test_probe_egress_verify.py` - probe compare/exit contract + secret-not-printed.
- `tests/test_sfox_validate.py`, `tests/test_ingestion_sfox.py`, `tests/test_sfox_internal_probe.py` - mock injection seam moved SfoxClient → make_sfox_client (assertions unchanged).

## Decisions Made
See `key-decisions` frontmatter. The load-bearing one: the factory does NOT `.strip()` — the byte-identical mandate means the call site owns its trim, so env-unset behavior is provably identical to today.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Moved the mock injection seam in 3 pre-existing sfox suites**
- **Found during:** Task 2 (wiring the 4 sites)
- **Issue:** The plan's acceptance criterion said the pre-existing sfox suites pass UNMODIFIED, but `test_sfox_validate.py`, `test_ingestion_sfox.py`, and `test_sfox_internal_probe.py` inject a fake client by patching the constructor **by name** (`router.SfoxClient = factory`, `setattr("services.ingestion.sfox.SfoxClient", ...)`, `patch("services.sfox_client.SfoxClient", ...)`). Once each site calls `make_sfox_client` instead, those name-patches no longer intercept, so the tests hit the real client. This is intrinsic to the refactor — the mock seam moves by one indirection.
- **Fix:** Repointed each suite's patch target to `make_sfox_client` (site namespace or `services.sfox_factory.make_sfox_client`) and updated two construction assertions from kwarg (`api_key=`) to positional (the site now passes api_key positionally). Every behavioral assertion (401→AUTH_FAILED, structural read-only triple, empty-secret accepted, etc.) is unchanged.
- **Files modified:** tests/test_sfox_validate.py, tests/test_ingestion_sfox.py, tests/test_sfox_internal_probe.py
- **Verification:** All 105 sfox-site tests green; full suite 4010 passed.
- **Committed in:** 17658668 (Task 2 commit)

**2. [Rule 1 - Bug] AST-based source scan instead of substring for the secret-hygiene test**
- **Found during:** Task 1
- **Issue:** The first `.strip(`/`logger` substring scan of sfox_factory.py false-tripped on the module docstring's prose (which explains WHY the factory does not strip).
- **Fix:** Rewrote the guard to walk the AST (assert no `.strip` Attribute call and no `logger`/`print` Name in actual code), so prose cannot false-trip it.
- **Files modified:** tests/test_egress_proxy_wiring.py
- **Verification:** test_sfox_factory_never_logs_or_strips_url green.
- **Committed in:** cf3fb3fc (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 test-bug). No scope creep — the production wiring matches the plan exactly.
**Impact on plan:** The plan's "pass unmodified" claim was mechanically impossible given the constructor-by-name mock strategy; the byte-identical behavioral proof is preserved (assertions unchanged, only the injection point moved).

## Issues Encountered
- `scripts/sfox_ground_truth.py` contains a bare `SfoxClient(api_key=..., proxy=proxy)` — the plan's verification grep ("no remaining bare SfoxClient( outside sfox_client.py/sfox_factory.py/tests") flags it. Left intentionally: it is a founder-run ground-truth parity harness (SFOX-06) with its OWN explicit `SFOX_GROUND_TRUTH_PROXY` env; routing it through make_sfox_client would silently override that with WORKER_EGRESS_PROXY_URL and change founder-tool semantics. Out of scope for the 4 worker egress sites.

## Threat Flags
None — no new security surface beyond the plan's threat model. T-121-05 (Bearer opacity) and T-121-06/07 (secret hygiene + auth-regression guard) are pinned by the new CONNECT test; T-121-08 (assumed-vs-realized egress) is pinned by the probe --expect gate.

## User Setup Required
None in code. The founder sets `WORKER_EGRESS_PROXY_URL` (+ optional `WORKER_EGRESS_PROXY_APPLIES_TO_CCXT`) in Railway AFTER the Fly proxy deploy, then runs the probe gate before whitelisting the static egress IP at sFOX (plan 121-03 / founder runbook). Merging this plan with the env unset changes NOTHING in prod.

## Next Phase Readiness
- 121-03 deploy leg can rely on: sFOX + (opt-in) ccxt riding the authenticated proxy the moment the env is set, and a one-command fail-loud egress gate (`python -m scripts.probe_exchange_egress --expect <egress-ip>`).
- Safe to merge ahead of the Fly deploy (env-unset byte-identical, proven by the unchanged pre-existing sfox suites + explicit None-pins).

## Self-Check: PASSED
- Created files present: sfox_factory.py, test_egress_proxy_wiring.py, test_egress_proxy_connect.py, test_probe_egress_verify.py.
- Commits present: cf3fb3fc (Task 1), 17658668 (Task 2), dd70d389 (Task 3).
- Bare `SfoxClient(` scan clean except the documented founder harness `scripts/sfox_ground_truth.py` (own SFOX_GROUND_TRUTH_PROXY seam).
- Full analytics suite: 4010 passed, 96 skipped, 0 failed.

---
*Phase: 121-sfox-static-ip-egress*
*Completed: 2026-07-19*
