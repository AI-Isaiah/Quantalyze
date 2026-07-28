---
phase: 118-sfox-research-adapter-contract
verified: 2026-07-18T00:00:00Z
status: human_needed
score: 2/3 must-haves verified in code (SC-3 founder-credential-gated → human_needed; not a gap)
overrides_applied: 0
re_verification:
  # No previous VERIFICATION.md — initial verification.
human_verification:
  - test: "Mint a sFOX SANDBOX API key at beta.sfox.com (separate from prod keys; email support@sfox.com to fund/enable the sandbox account if a populated payload is required), then run: `export SFOX_SANDBOX_KEY=<sandbox key>` and `cd analytics-service && python -m pytest tests/test_sfox_client_live.py -q`"
    expected: "Both live tests run (not skip) and pass GREEN: `get_balances()` and `get_balance_history()` each return a real list payload (an EMPTY list is a PASS — the SC-3 bar is auth + real payload against api.staging.sfox.com, not non-empty data). A 401 / SfoxApiError is a FAIL and propagates — the code can never fake a green."
    why_human: "SC-3 requires a live authenticated round-trip against api.staging.sfox.com. No sFOX sandbox key exists in this session or CI (CONTEXT.md GATE). The skipIf-gated test is committed, honest, and skips cleanly — it cannot fabricate a pass. Only the founder can mint the credential and flip SC-3 from human_needed to green."
---

# Phase 118: SFOX Research + adapter contract — Verification Report

**Phase Goal:** The genuinely-unknown sFOX questions are answered with evidence and a working `SfoxClient` adapter contract is proven against the sandbox — before any prod wiring exists.
**Verified:** 2026-07-18
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (Success Criterion) | Status | Evidence |
| --- | --- | --- | --- |
| SC-1 | Reconstruction feasibility answered with an evidence-cited GO/ADJUST verdict in 118-RESEARCH.md | ✓ VERIFIED | 118-RESEARCH.md lines 64–90: explicit **"LOAD-BEARING VERDICT: Can daily equity be reconstructed? → GO"**, backed by a 5-row feasibility table citing all four endpoints + a decisive `/v1/account/balance/history` daily `usd_value` finding. Each row is cited to docs.sfox.com and route reality was confirmed by live 401 probes on both hosts (lines 133–144). One honest caveat carried forward to phase 120 (lines 84–90), not papered over. This is a strong GO, not marginal. |
| SC-2 | `SfoxClient` adapter contract exists — Bearer auth, 4 read endpoints, prod+sandbox base URLs, coexists BESIDE `EXCHANGE_CLASSES`, explicit proxy ctor arg, read-only by construction | ✓ VERIFIED | `analytics-service/services/sfox_client.py` (289 lines). Bearer: `headers = {"Authorization": f"Bearer {self._api_key}"}` (line 150). Four read methods only: `get_balances`/`get_transactions`/`get_trades`/`get_balance_history` (lines 179/186/221/231). Base URLs: `SFOX_PROD_BASE_URL`/`SFOX_SANDBOX_BASE_URL` (lines 51–52). Coexists beside — `sfox` is entirely ABSENT from `services/exchange.py` (grep exit 1); module imports nothing from exchange.py. Explicit `proxy: str \| None` ctor arg threaded into every `session.request(..., proxy=self._proxy)` (lines 92, 155). Read-only: no `create_order`/`place_order`/`cancel_order`/`withdraw`/`transfer` method (grep exit 1; parametrized test asserts absence). |
| SC-3 | A sandbox smoke test runs GREEN against api.staging.sfox.com | ? HUMAN_NEEDED (expected — NOT a gap) | Founder-credential-gated per CONTEXT.md. `tests/test_sfox_client_live.py` is committed, hits `SFOX_SANDBOX_BASE_URL`, imports the plan-01 adapter, and has NO mock/stub/fallback — real request or clean skip. With no `SFOX_SANDBOX_KEY` it SKIPS honestly (2 skipped, exit 0) with a verbose fail-loud reason stating "a skip is NOT a pass". Cannot fabricate a green. The founder must mint a sandbox key and run it. |

**Score:** 2/3 truths verified in code; SC-3 is the expected founder-gated `human_needed` state (per phase design, not scored as a failure or gap).

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `analytics-service/services/sfox_client.py` | Non-ccxt read-only sFOX adapter (aiohttp, Bearer, rate-gated, explicit-proxy seam, bounded aclose), ≥120 lines, `class SfoxClient` | ✓ VERIFIED | 289 lines. `class SfoxClient` present. Single `_request` chokepoint (auth+proxy+rate-gate+fail-loud parse). Per-endpoint rate gate (`/v1/account/transactions` = 10s). Bounded idempotent `aclose` with `asyncio.wait_for(SFOX_CLOSE_TIMEOUT_S)`. Fail-loud `SfoxApiError` carrying HTTP status; secrets scrubbed via `scrub_freeform_string` (confirmed present at `services/redact.py:198`). |
| `analytics-service/tests/test_sfox_client.py` | Pure-unit contract test (mocked aiohttp, zero network/creds), ≥100 lines | ✓ VERIFIED | 386 lines. Patches `aiohttp.ClientSession.request` with AsyncMock; asserts real wiring (header bytes, literal URLs for both hosts, proxy kwarg verbatim + None default, read-only surface, wire param names, envelope unwrap, cursor plumbing, 10s rate gate via injected clock, secret scrub). **25 passed in 1.00s.** |
| `analytics-service/tests/test_sfox_client_live.py` | skipIf(!key) SC-3 empirical smoke, ≥30 lines, `skipif` | ✓ VERIFIED | 115 lines. Module-level `pytestmark = pytest.mark.skipif(not os.environ.get("SFOX_SANDBOX_KEY"), ...)`. Two live tests (balances + balance-history) against `SFOX_SANDBOX_BASE_URL`, no mocks. **2 skipped, exit 0** with credential absent. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `sfox_client.py` | `aiohttp.ClientSession.request` | single `_request` chokepoint passing `proxy=` explicitly | ✓ WIRED | Line 154–156: `session.request(method, url, headers=headers, params=query, proxy=self._proxy)`. |
| `test_sfox_client.py` | `sfox_client.py` | direct import + AsyncMock patch of request seam | ✓ WIRED | `from services.sfox_client import (...)`; 25 tests pass exercising it. |
| `test_sfox_client_live.py` | `api.staging.sfox.com` | `SfoxClient(base_url=SFOX_SANDBOX_BASE_URL)` real call when key present | ✓ WIRED (gated) | Uses `SFOX_SANDBOX_BASE_URL`; no mock/fallback — real request or skip. |
| `test_sfox_client_live.py` | `sfox_client.py` | imports the plan-01 adapter | ✓ WIRED | `from services.sfox_client import (SFOX_SANDBOX_BASE_URL, SfoxClient)`. |

### Data-Flow Trace (Level 4)

N/A — this is a library/adapter phase (Python client + tests). It renders no dynamic UI data; there is no downstream render surface to trace. The equivalent "real data flows" check is SC-3's live smoke test, which is the founder-gated `human_needed` item above.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Contract unit suite passes with zero network/creds | `.venv/bin/python -m pytest tests/test_sfox_client.py -q` | `25 passed in 1.00s` | ✓ PASS |
| Live smoke skips cleanly without a sandbox key (never a fake pass) | `.venv/bin/python -m pytest tests/test_sfox_client_live.py -q -rs` | `2 skipped`, exit 0, verbose founder-gated reason | ✓ PASS |
| `sfox` absent from ccxt-typed `EXCHANGE_CLASSES` | `grep -ni sfox services/exchange.py` | no match (exit 1) | ✓ PASS |
| No order/withdraw/transfer method on `SfoxClient` | `grep -niE "def (create_order\|place_order\|cancel_order\|withdraw\|transfer\|order)" services/sfox_client.py` | no match (exit 1) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| SFOX-01 | 118-01-PLAN, 118-02-PLAN | Custom non-ccxt `SfoxClient` adapter contract (auth; balance/trades/transaction endpoints; prod+sandbox base URLs) proven by a green sandbox-key smoke test before any prod wiring | ✓ SATISFIED (contract) / ? HUMAN (live green) | Contract + unit proof complete (SC-2). Empirical live green is the founder-gated SC-3 item — the committed test carries the design, the founder supplies the sandbox key. |

### Anti-Patterns Found

None. `grep -niE "TODO|FIXME|XXX|TBD|HACK|placeholder|not implemented|not yet"` across all three files returned no matches (exit 1). The single-page reads (no auto-crawl) and per-endpoint rate gate are documented deliberate design (crawl orchestration is phase 120), not stubs. Fail-loud on non-2xx / non-JSON / degenerate shapes is explicit and tested — no invented data.

### Human Verification Required

**1. Run the SC-3 live sandbox smoke test with a founder-minted key**

- **Test:** Mint a sFOX SANDBOX API key at `beta.sfox.com` (separate from prod; email `support@sfox.com` to fund/enable the sandbox if a populated payload is wanted). Then `export SFOX_SANDBOX_KEY=<sandbox key>` and `cd analytics-service && python -m pytest tests/test_sfox_client_live.py -q`.
- **Expected:** Both tests run (not skip) and pass GREEN — `get_balances()` and `get_balance_history()` each return a real list payload against `api.staging.sfox.com`. An EMPTY list is a PASS (SC-3 bar = auth + real payload, not non-empty data). A 401 / `SfoxApiError` is a FAIL and propagates.
- **Why human:** No sFOX sandbox credential exists in this session or CI (CONTEXT.md GATE). The skipIf test is honest and cannot fabricate a green; only the founder can supply the key and flip SC-3 to green.

### Gaps Summary

No gaps. SC-1 (evidence-cited GO verdict) and SC-2 (the full `SfoxClient` contract — Bearer, four read endpoints, both base URLs, explicit-proxy seam, read-only by construction, coexisting BESIDE the ccxt-typed `EXCHANGE_CLASSES`) are fully code-complete and verified against the actual source, not SUMMARY claims. The unit contract suite (25 passed) proves the wire-level behavior with zero network/credentials.

SC-3 is legitimately founder-credential-gated: the live sandbox smoke test is committed, honest, and skips cleanly (2 skipped, exit 0) with a fail-loud "a skip is NOT a pass" reason — it can never fabricate a green. Per the phase design and CONTEXT.md GATE, this is the expected `human_needed` state, not a failure and not a gap. The phase holds open on SC-3 until the founder mints a sandbox key and runs the smoke test green.

---

_Verified: 2026-07-18_
_Verifier: Claude (gsd-verifier)_
