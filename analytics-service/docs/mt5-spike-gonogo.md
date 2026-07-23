# MT5 Feasibility Spike — Go/No-Go (MT5SPIKE-01)

**Status: TEMPLATE — awaiting the live founder run.** Every live-result cell below
is pre-filled with the literal placeholder `human_needed`. An unfilled template can
therefore never be misread as "passed": a leg is GO only once its `human_needed`
cells are replaced with observed evidence and a verdict.

This document is the committed, reviewable verdict for Phase 134 — the v1.15
milestone go/no-go gate. It is produced by running `scripts/mt5_spike.py` against a
broker DEMO/investor account and pasting the sanitized report + the founder's
observations into the cells below. The harness itself is proven offline
(`tests/test_mt5_spike_harness.py`); the four LIVE proof legs are the human part.

> **Provenance (fill on run):** recorded `human_needed` (date) from
> `scripts/mt5_spike.py`, gateway at `human_needed`. Sanitized raw report:
> `docs/evidence/mt5spike-gonogo-<date>.json`.

---

## 1. Runbook

**Prerequisites**

1. `pip install mt5linux==1.0.3` — **gated by the plan 134-03 supply-chain
   human-verify checkpoint** (a failed/typo'd install must be human-verified, never
   auto-substituted). Not installed until that gate clears; the offline harness
   tests run without it.
2. A running `gmag11/MetaTrader5-Docker` **v2.3** container (amd64-only, ~4 GB,
   persistent `/config` volume; one-time VNC install + investor login at `:3000`).
   Avoid ARM instances.
3. **RPyC port verification** — the gateway RPyC port is `18812` (mt5linux
   constructor default) OR `8001` (a common image port map). Verify per container
   and set `MT5_SPIKE_PORT` accordingly: `human_needed`.

**Environment variables (env only — never argv, never a tracked file)**

| Var | Required | Meaning |
|-----|----------|---------|
| `MT5_SPIKE_LOGIN` | yes | broker account login (int) |
| `MT5_SPIKE_INVESTOR_PASSWORD` | yes | investor (read-only) password |
| `MT5_SPIKE_SERVER` | yes | exact broker server string |
| `MT5_SPIKE_HOST` | yes | gateway **private** host/ip |
| `MT5_SPIKE_PORT` | yes | gateway RPyC port (`18812` vs `8001`) |
| `MT5_SPIKE_MASTER_PASSWORD` | no | enables the leg-2 master-side comparison |
| `MT5_SPIKE_CYCLES` | no (default 10) | leg-1 unattended-login repetitions |
| `MT5_SPIKE_HISTORY_DAYS` | no (default 90) | leg-3 deal-history window |
| `MT5_SPIKE_SYMBOL` | no (default `EURUSD`) | leg-2 `order_check` probe symbol |

**Invocation**

```bash
cd analytics-service && python -m scripts.mt5_spike > /tmp/mt5_spike_report.json
echo "exit=$?"
```

**Exit codes**

| Code | Meaning |
|------|---------|
| 0 | success — sanitized go/no-go JSON printed to stdout |
| 2 | read-only premise violated (ScopeViolationError) |
| 3 | missing required `MT5_SPIKE_*` env vars |
| 1 | any other failure (scrubbed message to stderr) |

---

## 2. Security constraint (hard)

The `mt5linux` bridge speaks **rpyc classic / SlaveService — an UNAUTHENTICATED
arbitrary-remote-code channel**. It MUST be reachable ONLY over a **private network**
(Railway internal / WireGuard / SSH tunnel) and NEVER exposed on a public port.
Anyone who can reach the port can execute arbitrary code on the gateway host.

Credentials are env-only; the harness redacts every stderr line by value and passes
the whole report through `sanitize_evidence` + `assert_sanitized` before stdout, so
the login / investor password / master password / server string can never leak.

This is a **Phase 139 provisioning requirement** carried forward: the production
gateway inherits the private-network-only constraint (and credential isolation).

---

## 3. Environment (founder fills)

| Field | Value |
|-------|-------|
| Broker | `human_needed` |
| Exact server string | `human_needed` |
| Container image + pin | `gmag11/MetaTrader5-Docker:v2.3` (confirm digest: `human_needed`) |
| RPyC port observed | `human_needed` (`18812` vs `8001`) |
| Image build/pull date | `human_needed` |
| Host / network path | `human_needed` (must be private-network-only) |

---

## 4. Leg 1 — unattended Wine auto-login

`MT5_SPIKE_CYCLES` fresh `login → account_info → close` cycles with **no human
dialog-dismissal**. Verdict: GO iff success rate 1.0; INCONCLUSIVE ≥ 0.8; NO-GO below.

| Field | Value |
|-------|-------|
| Cycles run | `human_needed` |
| Success rate | `human_needed` |
| Observed failure modes | `human_needed` |
| **Verdict** | `human_needed` (GO / NO-GO / INCONCLUSIVE) |

**Escape-hatch trigger (if NO-GO):** a Leg 1 NO-GO pivots the milestone to a **native
Windows VPS** running the official MetaTrader5 wheel behind the **IDENTICAL**
`Mt5Client` contract — only the gateway host swaps, no adapter code changes.
Recorded, never papered over.

---

## 5. Leg 2 — `order_check` investor-vs-master read-only proof

Investor login → `order_check` (probe only; the trade path is never touched,
harness-enforced) + `account_info().trade_allowed`. If `MT5_SPIKE_MASTER_PASSWORD`
is set, the same probe runs on the master login and BOTH signal tuples are recorded.

| Login | `order_check` retcode | comment | `trade_allowed` |
|-------|-----------------------|---------|-----------------|
| investor | `human_needed` | `human_needed` | `human_needed` |
| master (if provided) | `human_needed` | `human_needed` | `human_needed` |

**Verdict:** `human_needed` (GO / NO-GO / INCONCLUSIVE).

The exact distinguishing retcode is **[ASSUMED]** until observed here. Phase 135
encodes the real per-broker rule from the **COMBINATION** of the `order_check`
retcode/comment + `account_info().trade_allowed` — never `order_check` alone. The
trade path was never touched.

---

## 6. Leg 3 — deal-reconstruction viability

`history_deals_get` over the last `MT5_SPIKE_HISTORY_DAYS`. An error is recorded as an
ERROR observation with its code — NEVER coerced to "zero deals" (the `None` ≠ `()`
honesty that motivates this source).

| Field | Value |
|-------|-------|
| Observation (populated / honest_empty / error) | `human_needed` |
| Deal count | `human_needed` |
| History depth (earliest deal time) | `human_needed` |
| `profit` / `swap` / `commission` / `fee` present | `human_needed` |
| `DEAL_TYPE_BALANCE` (type == 2) rows observed | `human_needed` |
| `None`-vs-`()` behavior observed live | `human_needed` |
| **Verdict** | `human_needed` |

---

## 7. Leg 4 — broker-server-time-vs-UTC offset

Most-recent deal's raw server-time epoch vs UTC → candidate offset rounded to the
nearest 30 minutes (broker offsets are whole/half hours). A deal-derived offset is an
**estimate**, not ground truth — `founder_confirmation_required` is always true.

| Field | Value |
|-------|-------|
| Candidate offset (minutes) | `human_needed` |
| Terminal-clock confirmation (VNC) | `human_needed` |
| DST behavior note | `human_needed` |
| **Verdict** | `human_needed` |

**Normalization approach note (ROADMAP success criterion 4):** the client returns raw
server-time epochs **VERBATIM**. Phase 136's `combine_mt5_deal_ledger` is the **ONE
seam** that subtracts the recorded offset to normalize to UTC BEFORE day-bucketing
(the Deribit/sFOX UTC-day-bucketing precedent), so deals near midnight land on the
correct calendar day. The offset is recorded per broker in this doc and re-verified
whenever a new broker server is onboarded.

---

## 8. Overall verdict + fallback decision

| Field | Value |
|-------|-------|
| **Overall milestone verdict** | `human_needed` (GO / NO-GO / INCONCLUSIVE) |
| Fallback elected (if any) | `human_needed` (e.g. native Windows VPS escape hatch) |
| Founder signature / date | `human_needed` |

Overall verdict aggregation (harness-computed): NO-GO if any leg is NO-GO; else
INCONCLUSIVE if any leg is INCONCLUSIVE; else GO. Leg 1 is the core gate — a NO-GO
there elects the Windows VPS fallback (identical contract).
