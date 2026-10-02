# MT5 validate latency — empirical evidence

Gathered 2026-08-08. Sources: Railway logs (project `quantalyze-analytics`,
services `quantalyze-analytics` + `mt5-gateway`, env `production`), Sentry
(`metaworld-fund-ltd`, de.sentry.io), repo source, MQL5 vendor docs.

---

## 0. Headline

**No uncensored measurement of a SUCCESSFUL MT5 validation exists anywhere.**
Not in logs, not in Sentry, not in evidence files, not in planning docs.

What *does* exist is a set of **9 independent, precisely-timed FAILURES**, all
saturating the same 30s bound to within ±1s. They do not describe a slow
operation — they describe an operation that **never returns**. The distribution
is degenerate. Sizing a timeout from these numbers is sizing it from a hang.

The mechanism is identified and is a code defect, not a broker-speed problem —
see §3.

---

## 1. MEASURED durations

### 1a. Founder validate attempts — Railway, correlated across both services

Method: gateway rpyc `SLAVE` logs the TCP accept (1s resolution, container-local
clock); the worker logs the failure with ms resolution. Δ = worker failure minus
gateway accept = wall time of the first MT5 API round-trip.

| # | Date (UTC) | Gateway `accepted` | Worker event | Δ | Censored? |
|---|---|---|---|---|---|
| 1 | 2026-08-06 | 09:50:02 | 09:50:32.220 `MT5 transient upstream failure (code=0)` | **30.2 s** | **YES** (rpyc 30s) |
| 2 | 2026-08-06 | 09:51:21 | 09:51:52.036 same | **31.0 s** | **YES** |
| 3 | 2026-08-06 | 09:53:21 | 09:53:51.910 same | **30.9 s** | **YES** |
| 4 | 2026-08-06 | 10:20:46 | 10:21:16.653 same | **30.6 s** | **YES** |
| 5 | 2026-08-06 | 13:02:52 | 13:03:22.396 same | **30.4 s** | **YES** |
| 6 | 2026-08-06 | 13:04:55 | 13:05:25.894 same | **30.9 s** | **YES** |
| 7 | 2026-08-06 | 15:11:15 | 15:11:45.087 same | **30.1 s** | **YES** |
| 8 | 2026-08-08 | 19:14:42 | 19:15:12.570 same | **30.6 s** | **YES** |
| 9 | 2026-08-08 | 19:15:42 | 19:16:12.793 same | **30.8 s** | **YES** |

Every one is the rpyc `sync_request_timeout` (`MT5_REQUEST_TIMEOUT_S`, default
30s, `analytics-service/services/mt5_client.py:82`) firing. Verified NOT env-
overridden: `MT5_REQUEST_TIMEOUT_S` is absent from the Railway variable list for
service `quantalyze-analytics` (only `MT5_ENABLED`, `MT5_GATEWAY_HOST`,
`MT5_GATEWAY_PORT`, `MT5_SERVER_UTC_OFFSET_S`, `MT5_SOAK_*`, `MT5_SPIKE_*`).

### 1b. The `close()` leg — a second full 30s, on every attempt

| Date (UTC) | probe fail | `Mt5Client.close: shutdown() raised` | Δ | Censored? |
|---|---|---|---|---|
| 2026-08-06 | 09:50:32.220 | 09:51:02.251 | **30.03 s** | **YES** |
| 2026-08-06 | 09:51:52.036 | 09:52:22.061 | **30.03 s** | **YES** |
| 2026-08-06 | 09:53:51.910 | 09:54:21.940 | **30.03 s** | **YES** |
| 2026-08-06 | 10:21:16.653 | 10:21:46.681 | **30.03 s** | **YES** |
| 2026-08-06 | 13:03:22.396 | 13:03:52.425 | **30.03 s** | **YES** |
| 2026-08-06 | 13:05:25.894 | 13:05:55.914 | **30.02 s** | **YES** |
| 2026-08-06 | 15:11:45.087 | 15:12:15.117 | **30.03 s** | **YES** |
| 2026-08-08 | 19:15:12.570 | 19:15:42.588 | **30.02 s** | **YES** |
| 2026-08-08 | 19:16:12.793 | 19:16:42.820 | **30.03 s** | **YES** |

⇒ **Server-side wall clock per failed validate attempt ≈ 60–62 s**, measured, on
9/9 attempts. That alone exceeds the client's 30s budget
(`src/lib/resilient-fetch.ts:538`, `timeoutMs: 30_000`) by 2×. The founder's
"always timed out" is fully explained without invoking broker slowness.

### 1c. UNCENSORED datapoints (the only ones)

| Source | Operation | Value | Date | Censored? |
|---|---|---|---|---|
| Gateway rpyc `SLAVE/8001` `accepted`→`welcome` | TCP accept + rpyc classic handshake | **< 1 s** (same-second on every one of ~60 connections Aug 4–8) | 2026-08-04…08 | **NO** |
| Worker | `Mt5Client(host, port)` construction (blocking connect) | **< 35 s** — never raised `MT5_GATEWAY_UNREACHABLE`, so it completed inside `_MT5_PROBE_TIMEOUT_S`; no finer instrument exists | 2026-08-06/08 | partially (bounded above only) |
| Gateway | short connection lifetimes, e.g. Aug 08 04:07:45→04:07:45; Aug 06 07:53:48→07:53:49; Aug 05 04:06:19→04:06:20 | **≤ 1 s** open-to-close | 2026-08-05…08 | **NO**, but **UNATTRIBUTED** — I could not prove from logs which call these carried (no correlating worker log line). Do **not** treat as a login timing. |

### 1d. What is NOT a measurement

- **"35–70s+"** (`.planning/phases/153-…/153-CONTEXT.md:33`, `153-RESEARCH.md:70`,
  `153-UI-SPEC.md:228`) — a *derivation* from the timeout constants (30+5, and the
  three 35s stages), not an observation. `153-UI-SPEC.md:226` itself states
  "⛔ No typical-duration range is stated for MT5. No measured distribution of a
  *successful* MT5 login exists."
- **~90–120s** (D-01) — a founder-locked *target budget*, explicitly a proposal.
- **`analytics-service/docs/mt5-spike-gonogo.md`** — a TEMPLATE. Every live cell is
  the literal `human_needed`, including all four spike legs and the entire soak
  table. It was never run. `analytics-service/docs/evidence/` contains no `mt5-*`
  file.
- **Sentry** — 2 MT5 issues in 90 days, both 2026-08-04, neither carrying a
  duration: `QUANTALYZE-K` (`fetch_daily_pnl failed: AttributeError 'Mt5Session'
  object has no attribute 'id'`, 2 events) and `QUANTALYZE-13`
  (`Unsupported exchange: mt5` on `GET /api/keys/{id}/permissions`, 1 event).
  `traces_sample_rate=0.1` is set (`analytics-service/sentry_init.py:358`) but no
  MT5 span/transaction data surfaced.
- **Cassettes/fixtures** — the MT5 test suite injects a `_connect` transport
  double; `mt5linux` is never installed in CI. No fixture encodes a realistic
  latency. `scripts/mt5_spike.py` and `scripts/mt5_soak.py` contain **no**
  `perf_counter`/`monotonic`/elapsed instrumentation.

---

## 2. Is elapsed time instrumented at all?

**On the path the wizard actually uses: NO.**

- `analytics-service/routers/exchange.py:222-470` (`_validate_mt5_key`) — the
  endpoint behind `POST /api/validate-key`. Zero timing. It logs *outcomes*
  (`validate_key: MT5 transient upstream failure (code=%s)`, `…probe timed out`,
  `…close() timed out`) with no elapsed value.
- `analytics-service/services/mt5_client.py` (whole file, 483 lines) — **no**
  `time.monotonic`, `perf_counter`, or elapsed capture anywhere. Not around
  `initialize()` (:305), `login()` (:313), `account_info()` (:329),
  `history_deals_get()` (:350), `order_check()` (:371), `close()` (:384),
  `restart()` (:428).
- `analytics-service/services/ingestion/mt5.py` — none.
- `analytics-service/services/mt5_concurrency.py` — none (no lock-wait timing).
- `analytics-service/services/job_worker.py:364`, `:3572`,
  `services/allocator_positions.py:656` — the three lock-guarded MT5 read sites.
  None time the lock wait or the read.

**One near-miss:** `analytics-service/routers/process_key.py:775` computes
`duration_ms = int((time.monotonic() - started_at) * 1000)` around
`adapter.validate(...)` in `_run_validate_only` (`:749`, `started_at` param at
`:753`), emitting `process_key.validate_only_ok` / `…_failed`. `mt5` IS an
admitted source for that router (`process_key.py:216-225`). **But it is never
reached in production for MT5**: a Railway log search for `validate_only` across
the Aug 6→Aug 8 deployment returns **zero** rows. The wizard MT5 arm goes to
`/validate-key`, which has no timer.

**Verdict: we cannot answer "how long does an MT5 validation take" from telemetry,
because we never measured it. The only clock in the system is the timeout itself.**

---

## 3. Vendor / default timeouts — and the defect they expose

| Knob | Value | Units | Where |
|---|---|---|---|
| `MetaTrader5.initialize(timeout=…)` **vendor default** | **60 000** | ms | MQL5 docs: *"Connection timeout in milliseconds. Optional named parameter. If not specified, the value of 60 000 (60 seconds) is applied."* — https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py |
| `MetaTrader5.login(timeout=…)` vendor default | **60 000** | ms | https://www.mql5.com/en/docs/python_metatrader5/mt5login_py (same wording) |
| Our `initialize()` call | **passes NO timeout ⇒ 60 000 ms applies** | — | `analytics-service/services/mt5_client.py:305` — `inited = self._mt5.initialize()` |
| Our `login()` call | `MT5_LOGIN_TIMEOUT_MS` = **20 000** | ms | `mt5_client.py:88`, passed at `:313-315` |
| rpyc `sync_request_timeout` | `MT5_REQUEST_TIMEOUT_S` = **30** | s | `mt5_client.py:82`, applied at `:157` |
| Per-stage asyncio ceiling | `_MT5_PROBE_TIMEOUT_S` = 30 + 5 = **35** | s | `routers/exchange.py:62`, applied 3× at `:328`, `:380`, `:456` |
| Derive-path ceiling | `_MT5_DERIVE_READ_TIMEOUT_S` = 30 + 10 = **40** | s | `services/mt5_concurrency.py:56` |
| Restart ceiling | `_MT5_RESTART_TIMEOUT_S` = **10** | s | `services/mt5_concurrency.py:68` |
| Browser→Next client budget | **30 000** | ms | `src/lib/resilient-fetch.ts:538` (`SEAM_ROUTE_BUDGETS["validate-key"].timeoutMs`) |

### ⚠️ The ordering invariant is violated for `initialize()`

`mt5_client.py:38-48` documents the load-bearing rule: MT5's own IPC timeout must
stay **strictly below** the rpyc timeout so MT5 fails its own pipe first and rpyc
surfaces a clean error. `mt5_client.py:213-219` **enforces** this at construction —
but only for `MT5_LOGIN_TIMEOUT_MS` (20 000 ms < 30 000 ms ✅).

`initialize()` is **not covered by that guard**. It runs with the vendor default
**60 000 ms — 2× the 30 000 ms rpyc bound**. So the very first MT5 call in
`Mt5Client.login()` is structurally incapable of returning an MT5-level answer
before rpyc gives up. Whatever `initialize()` was going to say at t=31…60s, we
can never hear it. Every one of the 9 observations in §1a is that inversion.

This is also why the observations are so tightly clustered at 30.1–31.0s rather
than spread: it is a fixed ceiling, not a latency distribution.

### Cold start is NOT a factor here

The vendor docs say *"If required, the MetaTrader 5 terminal is launched to
establish connection when executing the `initialize()` call"* — so on a cold
terminal, `terminal64.exe` launch is inside `initialize()` and typically dominates.
**But our gateway terminal is warm and long-lived:** the Railway `mt5-gateway`
deployment `7b6c62c7-…` has been running since **2026-07-24 22:21:13 UTC**, and its
startup log reads `[4/7] File /config/.wine/drive_c/Program Files/MetaTrader 5/
terminal64.exe is installed. Running MT5...` followed by
`[7/7] The mt5linux server is running on port 8001.` The terminal was started once,
15 days ago. So a cold-launch term should not be present in these numbers — which
makes a 30s+ non-return *more* alarming, not less.

Image is pinned: `gmag11/metatrader5_vnc:2.3@sha256:2fdff449cf70…`, single replica,
region `europe-west4-drams3a`, `/config` volume mounted.

### Community / anecdotal (labelled as such)

- Anecdotal figures found in search: MT5-terminal→broker-server ~194 ms; Python
  API→broker ~670 ms mean ⇒ Python↔terminal IPC ~573 ms. **Anecdotal, single
  source, unverified.** Sources: https://www.mql5.com/en/forum/447937 ,
  https://www.mql5.com/en/book/advanced/python/python_init
- Users hitting `IPC timeout` are commonly advised to raise `timeout` to e.g.
  `180000` (180 s). Anecdotal.
- Consistent with our own uncensored datum: the rpyc handshake to the gateway is
  sub-second, so the transport is not the slow part.

---

## 4. Queue behaviour

### The lock

`analytics-service/services/mt5_concurrency.py:126`
```python
_MT5_TERMINAL_LOCKS: dict[str, asyncio.Lock] = {}
```
`:129-134` `_mt5_terminal_lock_for(terminal_key)` → `setdefault(key, asyncio.Lock())`.
Key = `Mt5Client.terminal_key` = `f"{host}:{port}"` (`mt5_client.py:453`), so every
client for the one gateway shares one Lock.

### Who takes it — and who does NOT

| Site | Takes the lock? |
|---|---|
| `services/job_worker.py:364` — `sync_trades` mt5 balance read | ✅ `async with _mt5_terminal_lock_for(...)` |
| `services/job_worker.py:3572` — `derive_broker_dailies` deal read | ✅ |
| `services/allocator_positions.py:656` — holdings/positions read | ✅ |
| **`routers/exchange.py:_validate_mt5_key` (`:222-470`)** — **the wizard path** | ❌ **NO LOCK AT ALL** |
| `services/ingestion/mt5.py` `Mt5Adapter.validate` | ❌ no lock |

**This is the single most important queue fact: the validate path is completely
unserialized.** Two concurrent wizard submissions both call `client.login(...)` on
the ONE shared Wine terminal. The code's own comment at `routers/exchange.py:352-372`
acknowledges this ("FastAPI serves validates CONCURRENTLY against the ONE shared
terminal, so a second request's `login(...)` can switch the terminal onto another
account mid-probe") and mitigates it with a *detect-and-fail* login bracket
(`Mt5AccountMismatchError` → 424 transient), **not** with a queue. So concurrent
user #2 does not wait k×T — under today's code they can make each other **fail**.

### Lock-acquisition timeout: NONE

`async with _mt5_terminal_lock_for(...)` at all three job sites has **no**
acquisition timeout. Waiting on the lock is **unbounded**. The `asyncio.wait_for`
ceilings (`_MT5_DERIVE_READ_TIMEOUT_S` = 40 s at `job_worker.py:365-367`;
`_MT5_PROBE_TIMEOUT_S` = 35 s at `exchange.py:328/380/456`) are placed **INSIDE**
the lock, so they bound the *operation*, never the *wait*. The k-th queued job
therefore waits ~(k−1)×T with no ceiling of its own; its own 40s timer only starts
once it holds the lock.

### Scope caveat (documented in-tree)

`mt5_concurrency.py:117-125`: an `asyncio.Lock` is single-event-loop. It serializes
only within one worker process. Across worker replicas and the FastAPI validate
process it serializes **nothing** — an explicitly documented v1 gap.

### Consequence for budgeting

Today's honest server worst case for one validate = 3 × 35 s stages = **105 s**
(`153-CONTEXT.md:D-03`), confirmed empirically at ~60 s for the two stages that
actually fire (§1a+1b). Add an unbounded lock wait once validate is serialized —
which any correct fix must do — and a budget derived from a single-user T is wrong
for user #2 by construction.

---

## 5. What we still cannot know

1. **How long a successful MT5 `initialize()` + `login()` + `account_info()` +
   `order_check()` actually takes.** Never observed, never timed. Right-censored at
   30 s by rpyc on 9/9 observations.
2. **Which stage hangs.** `code=0` is the generic transport-raise code
   (`mt5_client.py:249/279/309/323`) — it is emitted identically by the
   `initialize()` arm, the `login()` arm, and `_guarded_read`. From logs alone we
   cannot tell `initialize()` from `login()`. (Inference, not proof: `initialize()`
   is first and is the one running with a 60 s ceiling inside a 30 s window, so it
   is the prime suspect.)
3. **Whether the terminal is healthy at all.** `shutdown()` also fails to return
   inside 30 s on every attempt. The gateway logged **no** exceptions in August
   (the only rpyc exceptions on record are 2026-07-24/25: `OverflowError: Python
   int too large` in `history_deals_get`, and `NameError: name 'datetime' is not
   defined` — both since fixed). Silence server-side + non-return client-side is
   the signature of a blocked Wine IPC pipe, i.e. **the terminal may simply be
   wedged or logged out**, in which case there is no "true latency" to size against
   at all and the timeout is the wrong lever.
4. **The distribution.** With one degenerate failure mode, n=9 identical values, we
   have zero information about p50/p95 of a healthy login.

**A timeout sized off §1's numbers is sized off a broken terminal.** Fixing the
`initialize()` timeout inversion and re-measuring must come first; otherwise a
90 s budget just moves the pile-up from 30 s to 90 s.

---

## 6. Cheapest experiment that yields an UNCENSORED number

**Do not run this from a laptop against the prod gateway** — the gateway is on
Railway's private network (`mt5-gateway.railway.internal:8001`, and it is
`rpyc classic`/`SlaveService`, an unauthenticated RCE channel that must never be
publicly exposed). Run it **inside** the Railway project.

### Step 1 — one-off timing probe, huge timeouts, per-stage clocks

Save as `analytics-service/scripts/mt5_latency_probe.py` (throwaway; do not commit
without review — this is *my suggestion*, I did not create it):

```python
"""One-off MT5 stage-latency probe. Deliberately uses timeouts far ABOVE any
production bound so every stage runs to completion and nothing is censored."""
import os, time, json, sys

HOST = os.environ["MT5_GATEWAY_HOST"]
PORT = int(os.environ["MT5_GATEWAY_PORT"])
LOGIN = int(os.environ["MT5_SPIKE_LOGIN"])
PW = os.environ["MT5_SPIKE_INVESTOR_PASSWORD"]
SERVER = os.environ["MT5_SPIKE_SERVER"]

RPYC_TIMEOUT_S = 600.0      # 10 min — must exceed every MT5-side ceiling
MT5_STAGE_TIMEOUT_MS = 300_000  # 5 min, passed EXPLICITLY to initialize + login

from mt5linux import MetaTrader5

def stage(name, fn, out):
    t0 = time.perf_counter()
    try:
        r = fn()
        ok, err = True, None
    except Exception as e:            # never print e — it can carry the password
        r, ok, err = None, False, type(e).__name__
    dt = time.perf_counter() - t0
    out.append({"stage": name, "seconds": round(dt, 3), "ok": ok,
                "exc_class": err, "truthy": bool(r)})
    print(f"{name}: {dt:.3f}s ok={ok} exc={err}", file=sys.stderr)
    return r

out = []
t0 = time.perf_counter()
mt5 = MetaTrader5(HOST, PORT)
mt5._MetaTrader5__conn._config["sync_request_timeout"] = RPYC_TIMEOUT_S
out.append({"stage": "connect+handshake",
            "seconds": round(time.perf_counter() - t0, 3), "ok": True})

stage("initialize", lambda: mt5.initialize(timeout=MT5_STAGE_TIMEOUT_MS), out)
stage("login",      lambda: mt5.login(LOGIN, password=PW, server=SERVER,
                                      timeout=MT5_STAGE_TIMEOUT_MS), out)
stage("account_info", mt5.account_info, out)
stage("terminal_info", mt5.terminal_info, out)   # cheap liveness read
stage("shutdown",   mt5.shutdown, out)
print(json.dumps({"stages": out,
                  "total_seconds": round(sum(s["seconds"] for s in out), 3)}))
```

Key properties: **rpyc bound (600 s) ≫ MT5 stage bound (300 s) ≫ any real latency**,
so the ordering inversion of §3 is removed and each stage returns its own verdict.
No credential is ever printed (only `type(e).__name__`).

### Step 2 — run it inside Railway, on the private network

```bash
cd analytics-service
railway link            # project quantalyze-analytics, service quantalyze-analytics, env production
railway run python -m scripts.mt5_latency_probe
```

`railway run` injects the service env (`MT5_GATEWAY_HOST/PORT`, `MT5_SPIKE_*` are
all already set on that service) but executes locally — which will NOT reach
`*.railway.internal`. If that fails, use a one-off container instead:

```bash
railway ssh --service quantalyze-analytics --environment production
# then, inside:
python -m scripts.mt5_latency_probe
```

(The repo already documents one-off Railway script runs; see the
`reference_railway_analytics_oneoff_scripts` memory note. Env key is
`SUPABASE_SERVICE_KEY`, not `_ROLE_KEY`, if the script ever needs DB access.)

### Step 3 — read the answer, and read it for the RIGHT thing

- If `initialize` returns in e.g. 2–8 s ⇒ the terminal is fine and the **30 s rpyc
  bound was never the binding constraint**; something else (likely `login` against
  a slow broker, or the missing `initialize` timeout arg interacting with an
  already-attached terminal) was. Size the budget off `total_seconds` × safety.
- If `initialize` runs 60 s+ or never returns even at 300 s ⇒ **the terminal is
  wedged/logged out.** Fix that (VNC in at `:3000`, confirm the investor account is
  logged in, restart the container) and re-run. A timeout change would be a bandaid.
- Either way, run it **≥ 20 times** (a `for` loop around the whole block, fresh
  connection each iteration) to get a real p50/p95 rather than n=1.

### Step 4 — instrument permanently, so this is never a mystery again

Add `time.perf_counter()` brackets inside `Mt5Client` around `initialize`, `login`,
`account_info`, `order_check`, `shutdown`, and emit them as a structlog event with
`stage` + `duration_ms` on **both** success and failure. Also time the lock wait at
`job_worker.py:364/3572` and `allocator_positions.py:656` separately from the read.
Without that, the next budget conversation starts from zero again.

---

## Appendix — file:line index of every code claim

| Claim | Citation |
|---|---|
| rpyc timeout 30s default | `analytics-service/services/mt5_client.py:82` |
| rpyc timeout applied to connection | `analytics-service/services/mt5_client.py:157` |
| MT5 login IPC timeout 20 000 ms | `analytics-service/services/mt5_client.py:88` |
| Ordering guard (login only) | `analytics-service/services/mt5_client.py:213-219` |
| `initialize()` called with NO timeout | `analytics-service/services/mt5_client.py:305` |
| `login()` called with explicit timeout | `analytics-service/services/mt5_client.py:313-315` |
| `code=0` generic transport-raise arms | `analytics-service/services/mt5_client.py:249, 279, 309, 323` |
| `terminal_key` = host:port | `analytics-service/services/mt5_client.py:453` |
| No timing anywhere in the client | `analytics-service/services/mt5_client.py` (whole file) |
| `_MT5_PROBE_TIMEOUT_S = 30+5` | `analytics-service/routers/exchange.py:62` |
| Three separate 35s stages | `analytics-service/routers/exchange.py:328, 380, 456` |
| Validate path takes NO terminal lock | `analytics-service/routers/exchange.py:222-470` (absence) |
| Concurrency acknowledged, mitigated by detect-not-queue | `analytics-service/routers/exchange.py:352-372` |
| `transient upstream failure (code=%s)` log | `analytics-service/routers/exchange.py:426-428` |
| Lock registry | `analytics-service/services/mt5_concurrency.py:126` |
| Lock factory | `analytics-service/services/mt5_concurrency.py:129-134` |
| Derive read ceiling 40s | `analytics-service/services/mt5_concurrency.py:56` |
| Restart ceiling 10s | `analytics-service/services/mt5_concurrency.py:68` |
| Single-event-loop scope gap | `analytics-service/services/mt5_concurrency.py:117-125` |
| Lock held at balance read | `analytics-service/services/job_worker.py:364` |
| Lock held at derive read | `analytics-service/services/job_worker.py:3572` |
| Lock held at holdings read | `analytics-service/services/allocator_positions.py:656` |
| `duration_ms` on validate-only (unused for MT5 in prod) | `analytics-service/routers/process_key.py:749, 753, 775, 785` |
| `mt5` admitted to process_key sources | `analytics-service/routers/process_key.py:216-225` |
| Sentry traces_sample_rate 0.1 | `analytics-service/sentry_init.py:358` |
| Client budget 30 000 ms | `src/lib/resilient-fetch.ts:538` |
| Spike/soak doc is an unfilled template | `analytics-service/docs/mt5-spike-gonogo.md` (all `human_needed`) |
| "no measured distribution exists" | `.planning/phases/153-wizform-form-errors-belong-on-the-form-mt5-declarable/153-UI-SPEC.md:226-228` |
| "35–70s+" is derived, not measured | `.planning/phases/153-…/153-CONTEXT.md:33`, `153-RESEARCH.md:70` |
| D-03 105s worst case | `.planning/phases/153-…/153-CONTEXT.md` (D-03) |
| A2: no successful-login distribution | `.planning/phases/153-…/153-RESEARCH.md:1270` |
