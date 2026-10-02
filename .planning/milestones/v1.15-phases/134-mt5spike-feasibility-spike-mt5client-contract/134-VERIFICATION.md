---
phase: 134-mtspike-feasibility-spike-mt5client-contract
verified: 2026-07-23T16:12:19Z
status: human_needed
score: 7/7 buildable must-haves verified; 6 live/supply-chain items human_needed
overrides_applied: 0
human_verification:
  - test: "Unattended Wine auto-login reliability (MT5SPIKE-01 leg 1, SC1)"
    expected: "Run `cd analytics-service && python -m scripts.mt5_spike` against a running gmag11/MetaTrader5-Docker v2.3 container + broker demo/investor account; leg-1 success rate recorded and a GO/NO-GO/INCONCLUSIVE verdict filled into docs/mt5-spike-gonogo.md §4. If NO-GO, elect the native-Windows-VPS escape hatch."
    why_human: "Requires founder demo credentials + a live Wine gateway container that do not exist in this autonomous run. Cannot be proven by grep or offline test — the harness leg + escape-hatch text are built and offline-proven, but the live proof is the human part."
  - test: "order_check investor-vs-master read-only proof on a real broker demo (MT5SPIKE-01 leg 2, SC2)"
    expected: "Observed order_check retcode/comment + account_info().trade_allowed recorded for the investor login (and master login if MT5_SPIKE_MASTER_PASSWORD provided) in docs/mt5-spike-gonogo.md §5; investor login provably distinguishable from master WITHOUT ever calling order_send; verdict filled."
    why_human: "The distinguishing retcode is [ASSUMED] until observed against a live broker. Needs founder credentials + gateway. The structural no-order_send guarantee IS verified offline; the live signal is human-needed."
  - test: "Deal-reconstruction viability confirmed on the demo account (MT5SPIKE-01 leg 3, SC3)"
    expected: "history_deals_get against the live account exposes realized profit/swap/commission/fee + DEAL_TYPE_BALANCE flows; deal count, history depth, field presence, and observed None-vs-() behavior recorded in docs/mt5-spike-gonogo.md §6 with a verdict."
    why_human: "The None≠() contract discipline is fully verified offline; 'confirmed on the demo account' requires a live broker account + gateway not present in this run."
  - test: "Broker-server-time-vs-UTC offset established on the live account (MT5SPIKE-01 leg 4, SC4)"
    expected: "Measured candidate offset (rounded to nearest 30 min) confirmed against the terminal's displayed server clock (VNC), DST behavior noted, verdict filled into docs/mt5-spike-gonogo.md §7."
    why_human: "The documented normalization approach (combine_mt5_deal_ledger seam) IS verified; the actual per-broker offset value requires a live account with real deals + founder confirmation."
  - test: "Supply-chain legitimacy gate for mt5linux==1.0.3 + rpyc==5.2.3 (134-03 Task 1, blocking-human)"
    expected: "Human verifies both PyPI pages + the mt5linux source repo (github.com/lucas-campagna/mt5linux), confirms no [SLOP] indicators and neither package is in the CLAUDE.md Banned list, then types approval. Decision recorded in the 134-03 SUMMARY."
    why_human: "Designed 'never auto-approvable'; slopcheck was unavailable in research so both packages carry [ASSUMED]. Auto-approving into the prod lockfile would violate CLAUDE.md supply-chain caution."
  - test: "mt5linux==1.0.3 pin landed in requirements.in + uv-compiled requirements.txt (134-03 Task 2)"
    expected: "After supply-chain approval: `mt5linux==1.0.3` in requirements.in with rationale comment; `make lock` regenerates requirements.txt containing mt5linux==1.0.3 + rpyc==5.2.3 with a clean diff (only declared transitives move); full suite green; lazy-import guard still passes."
    why_human: "Blocked on the Task-1 human approval above. Correctly deferred — 135/136 stub against the offline contract with mt5linux UNINSTALLED, so the pin lands with the gateway (Phase 139), not now."
---

# Phase 134: MT5SPIKE — Feasibility spike + `Mt5Client` contract Verification Report

**Phase Goal:** The core go/no-go unknowns are resolved with evidence against a real broker demo account, AND a stable worker-side `Mt5Client` network-client contract exists that all downstream phases stub against.
**Verified:** 2026-07-23T16:12:19Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

This phase has a deliberately SPLIT completion model:

- **Buildable half** (MT5GW-02 contract + the MT5SPIKE-01 harness/doc scaffolding, plans 134-01 + 134-02) — verified DONE with codebase evidence below.
- **Live half** (the four MT5SPIKE-01 live proofs + the supply-chain legitimacy gate + lockfile pin, plan 134-03) — genuinely `human_needed`: they require founder demo credentials + a running gmag11 v2.3 gateway that do not exist in this autonomous run. 134-03-SUMMARY.md correctly records them as `human_needed` (parked with runbook), NOT done. None are silently claimed passed.

The buildable half is fully verified, so the phase closes as `human_needed` — the only outstanding items are the human live/supply-chain gates, which no amount of autonomous coding can close. These are NOT gaps.

### Observable Truths

| # | Truth | Status | Evidence |
| --- | ------- | ---------- | -------------- |
| 1 | `Mt5Client` exists as a synchronous, structurally read-only RPyC facade (no `order_send`, no `__getattr__`, no generic passthrough) | ✓ VERIFIED | `services/mt5_client.py` (214 lines). Grep: `order_send(`=0, `__getattr__`=0, `async def`=0. `test_public_surface_is_exactly_the_contract` pins public surface to exactly {login, account_info, history_deals_get, order_check, close}; parametrized `test_read_only_surface_no_trade_methods` over 10 forbidden methods passes. |
| 2 | Transport import is lazy — importing `services.mt5_client` does NOT import `mt5linux` | ✓ VERIFIED | `from mt5linux import MetaTrader5` lives only inside `_default_connect` (line 109). Module-level grep=0. `test_module_import_does_not_require_mt5linux` asserts `"mt5linux" not in sys.modules`. Confirmed `mt5linux NOT installed` and suite still green. |
| 3 | `None`≠`()` fail-loud: `None`→typed `Mt5ClientError` via immediate `last_error()`; `()`→`[]`; degenerate shape raises; netref→native dict materialization | ✓ VERIFIED | `history_deals_get` uses `if deals is None:` (never a truthiness check — `if not deals`=0). `_materialize` fails loud on missing `._asdict()`. Tests `test_history_deals_none_is_error_not_empty`, `test_history_deals_empty_tuple_is_honest_empty`, `test_materialize_degenerate_shape_raises`, `test_account_info_materialized_to_native_dict` all pass. |
| 4 | No credential (password/server/login) leaks into any error/log surface | ✓ VERIFIED | `Mt5ClientError.__init__` passes detail through `scrub_freeform_string` (grep=4 uses). `test_login_failure_raises_typed_error_no_secret` asserts `"s3cr3t-pw"` absent from exc. `scrub_freeform_string` confirmed defined in `services/redact.py`. |
| 5 | OFFLINE contract test suite is green in CI WITHOUT `mt5linux` installed (the load-bearing gate 135/136 stub against) | ✓ VERIFIED | `python3 -m pytest tests/test_mt5_client_contract.py tests/test_mt5_spike_harness.py -q` → **37 passed** (25 contract + 12 harness), `mt5linux NOT installed` confirmed. |
| 6 | Spike harness + founder-fillable go/no-go doc exist and are offline-proven | ✓ VERIFIED | `scripts/mt5_spike.py` (470 lines): `run_spike` + `main` with injectable `client_factory`, four legs, deribit-shaped exit codes. Missing-env run → exit 3 with no-secret ERROR line (spot-checked). `docs/mt5-spike-gonogo.md`: 8 sections, 32 `human_needed` cells, Windows-VPS escape hatch, private-network constraint, `combine_mt5_deal_ledger` normalization note (all grep-confirmed). |
| 7 | Dual-timeout ordering: MT5 login IPC ms strictly below rpyc request-timeout s; escape hatch + normalization approach documented (SC1/SC4 buildable parts) | ✓ VERIFIED | `MT5_LOGIN_TIMEOUT_MS`=20000 < `MT5_REQUEST_TIMEOUT_S`*1000=30000, asserted by `test_login_passes_ipc_timeout_below_rpyc_timeout`. Escape-hatch string emitted on leg-1 NO-GO (`test_leg1_no_go_emits_escape_hatch`). Normalization note present in both harness leg 4 and the go/no-go doc §7. |
| 8 | LIVE: unattended Wine auto-login PROVEN against gmag11 v2.3 (SC1 live part) | ? human_needed | Harness leg 1 + escape hatch built/offline-proven; live proof needs founder gateway + creds. Recorded human_needed in 134-03-SUMMARY. |
| 9 | LIVE: order_check investor-vs-master proof on a real broker demo (SC2 live part) | ? human_needed | Structural no-order_send guarantee verified; live retcode is [ASSUMED], needs demo account. |
| 10 | LIVE: deal-reconstruction confirmed on the demo account (SC3 live part) | ? human_needed | None≠() discipline verified offline; live confirmation needs a real account. |
| 11 | LIVE: server-time offset established on the live account (SC4 live part) | ? human_needed | Normalization seam documented; actual offset value needs live deals + founder VNC confirmation. |
| 12 | Supply-chain gate + lockfile pin for mt5linux==1.0.3 / rpyc==5.2.3 (134-03 T1/T2) | ? human_needed | Never auto-approvable; correctly deferred. `mt5linux`/`rpyc` absent from requirements.in/txt (grep=0) — consistent with the deferred human gate; 135/136 don't need it (lazy import). |

**Score:** 7/7 buildable must-haves VERIFIED; 6 live/supply-chain items human_needed (truths 8–12 + the lockfile pin).

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `analytics-service/services/mt5_client.py` | Mt5Client facade + Mt5ClientError + dual-timeout constants (≥120 lines) | ✓ VERIFIED | 214 lines; git-tracked; exports Mt5Client, Mt5ClientError, MT5_REQUEST_TIMEOUT_S, MT5_LOGIN_TIMEOUT_MS. Wired: imported by test suite + mt5_spike.py. |
| `analytics-service/tests/test_mt5_client_contract.py` | offline contract suite (≥150 lines) | ✓ VERIFIED | 355 lines; git-tracked; 25 tests green offline. |
| `analytics-service/scripts/mt5_spike.py` | four-leg harness, main+run_spike (≥150 lines) | ✓ VERIFIED | 470 lines; git-tracked; imports Mt5Client (1) + deribit sanitization (1). |
| `analytics-service/tests/test_mt5_spike_harness.py` | offline harness tests (≥60 lines) | ✓ VERIFIED | 304 lines; git-tracked; 12 tests green offline. |
| `analytics-service/docs/mt5-spike-gonogo.md` | founder-fillable go/no-go template (contains human_needed) | ✓ VERIFIED | 186 lines; git-tracked; 32 human_needed cells, all 8 sections present. |
| `analytics-service/requirements.in` / `requirements.txt` (mt5linux pin) | mt5linux==1.0.3 pinned + locked | ? human_needed | Absent by design — 134-03 Task 2 blocked on the human supply-chain gate (Task 1). Not a gap: offline suite is green with mt5linux uninstalled. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| mt5_client.py | services/redact.py | `scrub_freeform_string` at Mt5ClientError construction | ✓ WIRED | grep=4; called in `Mt5ClientError.__init__`. |
| test_mt5_client_contract.py | mt5_client.py | injected `_connect=` fake (RPyC-shaped double) | ✓ WIRED | `_make()` builds a `_connect(*, host, port, timeout)`; all 25 tests drive through it. |
| mt5_client.py | mt5linux.MetaTrader5 | lazy import inside `_default_connect` ONLY | ✓ WIRED | `from mt5linux import` present only at line 109 inside the function body; module-level=0. |
| mt5_spike.py | services.mt5_client | `from services.mt5_client import` | ✓ WIRED | grep=1; `_default_client_factory` constructs `Mt5Client`. |
| mt5_spike.py | scripts.deribit_ground_truth | single-definition sanitization import | ✓ WIRED | grep=1; imports ScopeViolationError, _redact_secret_values, assert_sanitized, sanitize_evidence. |
| docs/mt5-spike-gonogo.md | scripts/mt5_spike.py | runbook documents exact invocation + env vars | ✓ WIRED | `python -m scripts.mt5_spike` + all MT5_SPIKE_* vars present in §1. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Offline contract + harness suites green without mt5linux | `python3 -m pytest tests/test_mt5_client_contract.py tests/test_mt5_spike_harness.py -q` | 37 passed in 1.71s | ✓ PASS |
| mt5linux truly not installed | `importlib.util.find_spec('mt5linux')` | mt5linux NOT installed | ✓ PASS |
| Missing-env exit code + no-secret stderr | `env -i python3 -m scripts.mt5_spike` | exit=3; ERROR names missing vars, no values | ✓ PASS |
| Structural read-only guards | grep on mt5_client.py | order_send(=0, __getattr__=0, async def=0, if not deals=0, module mt5linux import=0 | ✓ PASS |
| go/no-go doc gates | grep on docs/mt5-spike-gonogo.md | human_needed=32, Windows VPS=3, private network=1, combine_mt5_deal_ledger=1 | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention in this repo; the phase's runnable verification is the offline pytest suites, executed above (37 passed). Not applicable.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| MT5GW-02 | 134-01, 134-03 | Pure network client via mt5linux, timeout-bounded, never importing Windows-only pkg in-process; RPyC contract with offline suite green | ✓ SATISFIED (contract) | SC5 fully met: contract defined, lazy import, dual-timeout, 25-test offline suite green. Lockfile pin (134-03 T2) is human_needed but not required for 135/136 to stub. |
| MT5SPIKE-01 | 134-02, 134-03 | Feasibility spike resolves 4 live unknowns against a real broker demo; documented go/no-go + escape hatch | ? NEEDS HUMAN | Buildable half done (harness + doc + escape hatch + normalization note). The four LIVE proofs (SC1–SC4 live parts) are human_needed — 134-02-SUMMARY correctly leaves `requirements-completed: []`. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No TODO/FIXME/XXX/HACK debt markers in any modified file | ℹ️ Info | Clean. |
| mt5_client.py / mt5_spike.py / docs | various | `[ASSUMED]` tags on the order_check investor retcode | ℹ️ Info | Intentional and referenced to formal follow-up (MT5SPIKE-01 leg 2); documents a genuine live unknown, not code debt. |
| docs/mt5-spike-gonogo.md | ×32 | `human_needed` placeholders | ℹ️ Info | INTENDED template design — an unfilled template must not read as passed. Not a stub. |

### Human Verification Required

Six items are genuinely human-needed (see frontmatter `human_verification` for full detail). Summary:

1. **Unattended Wine auto-login proof (SC1 live)** — run the harness against a live gmag11 v2.3 gateway + broker demo; fill leg-1 verdict; if NO-GO, elect the Windows-VPS escape hatch.
2. **order_check investor-vs-master proof (SC2 live)** — record the live retcode/comment + trade_allowed distinguishing an investor from a master login.
3. **Deal-reconstruction confirmation (SC3 live)** — confirm profit/swap/commission/fee + DEAL_TYPE_BALANCE on the real account.
4. **Server-time offset (SC4 live)** — establish + VNC-confirm the broker offset.
5. **Supply-chain legitimacy gate (134-03 T1)** — blocking-human approval of mt5linux==1.0.3 + rpyc==5.2.3; never auto-approvable.
6. **Lockfile pin (134-03 T2)** — land the pin + `make lock` after the supply-chain approval.

### Gaps Summary

No gaps in the buildable half. Every MT5GW-02 discipline and every harness/doc scaffolding item is present, substantive, wired, and offline-proven with real test execution (37 tests green, mt5linux confirmed uninstalled) and structural grep guards (order_send=0, __getattr__=0, lazy import, None≠()). The `Mt5Client` contract that phases 135/136 stub against is stable and complete.

The only outstanding work is the live-broker proofs and the supply-chain/lockfile gate — all correctly recorded as `human_needed` in 134-03-SUMMARY.md and none silently claimed passed. These are human-gated by design (founder demo credentials + a running Wine gateway that do not exist in an autonomous run) and cannot be closed by further autonomous coding. Phase status is therefore `human_needed`, not `gaps_found`.

---

_Verified: 2026-07-23T16:12:19Z_
_Verifier: Claude (gsd-verifier)_
