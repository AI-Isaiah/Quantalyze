# The analytics-service status-attributability contract (PYAPI-05)

**Status:** binding. **Established:** 2026-07-26 (Phase 140.1, plan 03).
**Executable half:** `analytics-service/services/error_contract.py`.
**Primary consumer:** Phase 140.2 `SEAMCORE-01` — the TypeScript error discriminator.

---

## 0. What the status code means here

> **The status code answers exactly one question: _should this response count
> against the analytics service's own health?_**

Everything else — user copy, remedy, retry affordance — is carried in the body and is
Phase 140.3's concern. Conflating *"is our service degraded?"* with *"whose fault is
this?"* is the documented root cause of A-01 (one MT5 gateway outage denies every
Deribit user) and C-12 (a Binance maintenance window trips a platform-wide breaker).

**The status line ALONE must be decidable.** A consumer must never need to read the
body to classify a response. This is not a stylistic preference: an unhandled
exception is a bodyless `500 text/plain` (Starlette `ServerErrorMiddleware` →
`PlainTextResponse("Internal Server Error", status_code=500)`, TRAP-2), so any
classifier that requires a body is undefined on the single most common 5xx.

---

## 1. The four classes

Every error-capable site is assignable to exactly one class **at the site**, with no
downstream inference.

| Class | Decision question | Status | `Retry-After` | `dependency` | `retryable` | 140.2 obligation |
|---|---|---|---|---|---|---|
| **CALLER** | Is the caller's request, credentials, or authorization at fault? | `400` `401` `403` `404` `422` `429` | on `429` only | `null` | `false` | **never counts** |
| **CALLER'S EXCHANGE** | Is the third party *the caller named* at fault (venue down, throttling us, key revoked at the venue, IP-allowlist change)? | **`424`** | optional | venue slug | `true` | **never counts**, and renders as **recoverable** |
| **SERVICE-TRANSIENT** | Is one of *our* dependencies temporarily unavailable such that an identical retry could succeed? | `503` | **required** | one of ours | `true` | **counts — keyed on the named `dependency`, never globally** |
| **SERVICE-PERMANENT** | Is this a misconfiguration or a bug that an identical retry cannot fix? | `500` | **never** | one of ours, or `null` | `false` | **never counts** |

### R-1 — `500` means "do not retry"

Today `500` is used for both bugs and transient failures, which is why A-02's
undecryptable key can re-trip the breaker forever. Splitting `500` (permanent) from
`503` (transient) makes the breaker's input set decidable **without body parsing** —
which matters precisely because of TRAP-2 above.

Corollary, and it is the whole point: **a deterministic fault can only be cleared by an
operator, so counting it guarantees a self-sustaining outage.** A permanent `503`
flaps: trip → expire → re-probe → trip, forever, with no operator signal (A-08/A-25).

### R-2 — every deliberate 5xx body carries `{code, dependency, retryable}`

- `code` — the stable machine discriminator (PYAPI-10's `code`, generalising the
  `error_code` vocabulary already proven at `services/exchange.py:978-1021`).
- `dependency` — names **which** dependency failed, so 140.2 can key a breaker
  per-dependency instead of the single global `breaker:railway` that A-01 shows is
  false. Always present; `null` when nothing of ours failed.
- `retryable` — the boolean R-1 encodes. Redundant with the status by construction;
  carried anyway so a body-reading consumer cannot disagree with a status-reading one.

An unhandled `500` has **no body**. That absence is itself the signal that the fault is
unclassified, and R-1 is what makes that safe.

---

## 2. Where the envelope lives

**Always at `body.detail`.** One location, one rule.

```jsonc
// A deliberate 503 from an HTTPException raise site
{
  "detail": {
    "code": "MT5_GATEWAY_UNREACHABLE",
    "dependency": "mt5-gateway",
    "retryable": true,
    "detail": "The MetaTrader gateway is not responding. Try again shortly."
  }
}
```

`body.detail.detail` is **always a scalar string** — the human copy. It is never a list,
never a dict, never `null`.

`correlation_id` is present as a fifth key when the raise site had one.

FastAPI's default `HTTPException` handler serialises to `{"detail": <detail>}`, so
`service_error()` puts the whole envelope in `detail`. Middleware sites that must
**return** a `JSONResponse` rather than raise (see §6) use
`service_error_response()`, which nests identically — so a consumer never has to know
which mechanism produced the response.

**Precedent, not invention:** `routers/simulator.py:453` already raises
`HTTPException(500, detail={"error": ..., "correlation_id": ...})`. The envelope is a
superset of that shape.

### ⚠️ Obligation this creates for 140.2 (mandatory)

`body.detail` is an **object** on every deliberate error, so the three TypeScript sites
that do `err.detail ?? "..."` (Class 5: `src/lib/analytics-client.ts:179`,
`src/app/api/keys/[id]/permissions/route.ts:147`,
`src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx:622`) will render
`"[object Object]"` for these responses until 140.2 reads `body.detail.detail`.
`src/components/portfolio/PortfolioImpactPanel.tsx:76-77` already type-checks and is the
fix-shape template. This is a **known, deliberate, recorded** consequence — not an
oversight. It is invisible to users before 140.2 lands because the branch
`feat/v1.16-production-resilience` is never merged mid-programme.

Note the distinction from PYAPI-07/PYAPI-08: the **422 and 429** handlers emit a
**scalar** `detail` at the top level, which is why those need no TypeScript change.
Deliberate 4xx/5xx from `service_error()` are the object-detail case.

---

## 3. `Retry-After`

Per-dependency **integer literals declared in exactly one table**:
`RETRY_AFTER_SECONDS` in `services/error_contract.py`. A raise site reads
`RETRY_AFTER_SECONDS["<dependency>"]`; it never inlines a number (OPEN-2 /
Cluster-D lesson).

| Dependency | Seconds | Why |
|---|---|---|
| `mt5-gateway` | 30 | A Railway redeploy of the gateway settles well inside 30s |
| `supabase` | 15 | PostgREST blips are seconds, not minutes |

`kek` and `egress-proxy` are **deliberately absent**: every fault of theirs in the
current site set is a permanent misconfiguration (`500`, `retryable:false`).
Advertising a wait for them would invite exactly the retry loop R-1 exists to stop. Add
a key only when a genuinely transient arm for that dependency exists.

---

## 4. Dependency vocabulary

**Service dependencies** — the closed set that may appear on a `500`/`503`, and the only
values that are legitimate breaker keys:

| Value | What it names |
|---|---|
| `mt5-gateway` | the RPyC MetaTrader terminal bridge |
| `kek` | the key-encryption key / envelope-encryption config |
| `supabase` | PostgREST / the database |
| `egress-proxy` | the static-IP worker egress proxy |

**On a `424`, `dependency` names the CALLER'S VENUE instead** — `binance`, `deribit`,
`bybit`, … . This is how Q2.2's "the venue name in the body" is satisfied without adding
a key to the envelope. `error_contract._validate` refuses a `424` whose `dependency` is
one of ours, so the two vocabularies cannot be confused.

**A `424`'s `dependency` MUST NOT be used as a breaker key** — `424` never counts at all
(§5). It exists so 140.3 can say *"Binance is not responding right now"* instead of
*"an exchange is not responding"*.

---

## 5. Why an exchange fault is `424`, not `502` and not `400`

> *A 502 for "the user's exchange is down" must not trip our breaker, but it is
> genuinely not the user's fault either. What status does it get, and why?*

**`424 Failed Dependency`**, with a `code` of `EXCHANGE_PROBE_FAILED` /
`EXCHANGE_INIT_FAILED` and the venue named in `dependency`.

The reasoning, in the order it must survive review:

1. **It cannot be 5xx.** The status is the breaker's input (R-1), and the analytics
   service is provably healthy in this scenario — it successfully reached the venue and
   received a refusal. Emitting 5xx makes C-12 true: one dashboard render with five keys
   during a Binance outage is five 502s, hence a global trip that denies Deribit users,
   the optimizer, admin match and CSV finalize.
2. **It should not be `400`.** `400` already means "your request was malformed" across
   `routers/exchange.py:96,114,123,130,143,203,204,385,393,412`. Overloading it destroys
   the distinction between *"fix your input"* and *"wait for your venue"* — which is the
   single most important thing to tell this user.
3. **`424` is exact and free.** A registered IANA status (RFC 4918 §11.4); a 4xx, so it
   is **breaker-inert by construction**; and distinguishable **from the status line
   alone**, which matters because TRAP-2 means the body may be absent.
4. **"Not the user's fault" is a copy problem, not a status problem.** The 4xx/5xx axis
   answers *"is our service degraded?"*, not *"who is to blame?"*. 140.3 renders `424` as
   *"Binance is not responding right now — your key is fine, try again shortly"*, which
   is neither an accusation nor a false claim about our uptime.

---

## 6. Obligations for Phase 140.2 (SEAMCORE)

These are the contract's downstream half. Each one is a way the emit-side fix is
nullified if 140.2 gets it wrong.

| # | Obligation | Failure shape if missed |
|---|---|---|
| **O-1** | **`424` is recoverable AND non-counting.** It must NOT be collapsed into "caller error, not recoverable" with the rest of the 4xx. | The B-01/B-22 shape: an outage the user can only wait out renders as an un-retryable dead end. |
| **O-2** | **The breaker keys on the named `dependency`, never globally.** A `503` with `dependency:"mt5-gateway"` may only gate MT5 traffic. | A-01: the single global `breaker:railway` key means one MT5 gateway restart denies every Deribit user, the optimizer and CSV finalize. |
| **O-3** | **`retryable:false` NEVER counts toward the breaker**, and a `500` never counts either. | A-02/A-12/C-17: a deterministic fault (undecryptable key, unset KEK) re-trips the breaker forever; the breaker then blocks its own recovery probe. |
| **O-4** | **A bodyless `500` must classify safely.** The discriminator must reach a terminal, non-counting verdict from the status line with `Content-Type: text/plain` and no JSON at all. | TRAP-2 / A-03: the discriminator throws on `JSON.parse`, and the most common 5xx becomes unhandled. |
| **O-5** | **Read the human string from `body.detail.detail`, the code from `body.detail.code`.** Do not `??` the object (§2). | `"[object Object]"` in the UI — the C-14 render, reintroduced. |
| **O-6** | **`503` carries `Retry-After`; honour it** instead of inventing a wait. | B-11: 140.3 cannot "name the real wait" and falls back to a guess. |
| **O-7** | **Do not route the `/health` warmer through the seam core.** `/health`'s `503` (S-24) is correct and deliberately unchanged. | A-12/D-14: a cold `/health` probe feeds `recordSeamFailure`, the breaker trips, and it then blocks its own recovery probe. Zero tests red. |
| **O-8** | **`admin/match/*` currently flattens all upstream 4xx to a generic 500** (B-12). A `424` from `/api/match/*` would render "please try again" with no venue named. | OPEN-1: the venue name is lost exactly where it is most useful. |
| **O-9** | **`services/job_worker.py:_HTTP_TRANSIENT_4XX` does not know `424`.** No worker path reaches these router sites today, but if one ever proxies them, `424` classifies as `permanent`. | A venue blip permanently fails a job instead of retrying it. |

---

## 7. The full S-01…S-24 site map

The authoritative enumeration of every 5xx-capable site reachable from the seam.
`140.2` can diff its assumptions against this table.

**Legend.** *Plan* is the Phase 140.1 plan that owns the edit.
`✅` = implemented as of plan 03. `⬜` = owned by a later plan.

| # | Site | Endpoint | Today | Trigger | Class | Target | Plan | Done |
|---|---|---|---|---|---|---|---|---|
| S-01 | `routers/exchange.py:108` | `/api/validate-key` | 503 | sFOX client ctor `ValueError` — malformed `WORKER_EGRESS_PROXY_URL` | SERVICE-PERMANENT | **500** `EGRESS_PROXY_MISCONFIGURED`, `retryable:false`, `dependency:egress-proxy` | 03 | ⬜ |
| S-02 | `routers/exchange.py:215` | `/api/validate-key` | 503 | `MT5_GATEWAY_HOST`/`PORT` unset | SERVICE-PERMANENT | **500** `MT5_GATEWAY_UNCONFIGURED`, `dependency:mt5-gateway` | 03 | ⬜ |
| S-03 | `routers/exchange.py:220` | `/api/validate-key` | 503 | `MT5_GATEWAY_PORT` not an int | SERVICE-PERMANENT | **500** `MT5_GATEWAY_UNCONFIGURED`, `dependency:mt5-gateway` | 03 | ⬜ |
| S-04 | `routers/exchange.py:235` | `/api/validate-key` | 503 | MT5 gateway connect **timed out** | SERVICE-TRANSIENT | **503** `MT5_GATEWAY_UNREACHABLE`, `dependency:mt5-gateway`, `Retry-After` | 03 | ⬜ |
| S-05 | `routers/exchange.py:238` | `/api/validate-key` | 503 | MT5 gateway connect **failed** | SERVICE-TRANSIENT | **503** `MT5_GATEWAY_UNREACHABLE`, `dependency:mt5-gateway`, `Retry-After` | 03 | ⬜ |
| S-06 | `routers/exchange.py:404` | `/api/validate-key` | 500 | bare `except` around `validate_key_permissions` | **SPLIT** | `ccxt.BaseError` → **424** `EXCHANGE_PROBE_FAILED`; else **500** `INTERNAL` with copy that does not blame credentials | 03 | ⬜ |
| S-07 | `routers/exchange.py:424` | `/api/encrypt-key` | 503 | `get_kek()` raises | SERVICE-PERMANENT | **500** `KEK_UNAVAILABLE`, `retryable:false`, `dependency:kek` | 03 | ⬜ |
| S-08 | `routers/internal.py:208` | `/internal/keys/{id}/permissions` | 503 | `get_kek()` raises | SERVICE-PERMANENT | **500** `KEK_UNAVAILABLE`, `dependency:kek` + rate-limited Sentry capture | 03 | ⬜ |
| S-09 | `routers/internal.py:214` | `/internal/keys/{id}/permissions` | 500 | `decrypt_credentials` raises | SERVICE-PERMANENT | **500** `KEY_UNDECRYPTABLE`, `retryable:false`, `dependency:kek` | 03 | ⬜ |
| S-10 | `routers/internal.py:218` | `/internal/keys/{id}/permissions` | **502** | `api_keys.exchange` NULL/empty | **CALLER** | **422** `KEY_MISSING_EXCHANGE` | 03 | ⬜ |
| S-11 | `routers/internal.py:326` | `/internal/keys/{id}/permissions` | 502 | `create_exchange` raised non-`ValueError` | CALLER'S EXCHANGE | **424** `EXCHANGE_INIT_FAILED` | 03 | ⬜ |
| S-12 | `routers/internal.py:339` | `/internal/keys/{id}/permissions` | 502 | any exception from `detect_permissions` | CALLER'S EXCHANGE | **424** `EXCHANGE_PROBE_FAILED` | 03 | ⬜ |
| S-13 | `routers/match.py:1648` | `/api/match/recompute` | 503 | `_is_admin_profile` returned `None` | SERVICE-TRANSIENT | **503** `dependency:supabase` + `Retry-After` | 04 | ⬜ |
| S-14 | `routers/match.py:1674` | `/api/match/recompute` | 503 | `_is_allocator_profile` returned `None` | SERVICE-TRANSIENT | **503** `dependency:supabase` + `Retry-After` | 04 | ⬜ |
| S-15 | `routers/match.py:1765` | `/api/match/recompute` | 500 `f"Scoring failed: {err}"` | `_score_one_allocator` raised | SERVICE-PERMANENT | **500** `SCORING_FAILED`, **strip `{err}`** | 04 | ⬜ |
| S-16 | `routers/match.py:1818` | `/api/match/eval` | 503 | `PaginatedSelectTruncated` — caller's `lookback_days` too large | **CALLER** | **400** `EVAL_WINDOW_TOO_LARGE` | 04 | ⬜ |
| S-17 | `routers/match.py:1826` | `/api/match/eval` | 500 `f"Eval failed: {err}"` | any exception | SERVICE-PERMANENT | **500** `EVAL_FAILED`, **strip `{err}`** | 04 | ⬜ |
| S-18 | `routers/simulator.py:453` | `/api/simulator` | 500 `{error, correlation_id}` | any exception in the sim body | SERVICE-PERMANENT | **500** `SIMULATION_FAILED` | 04 | ⬜ |
| S-19 | `routers/portfolio.py:653` | `/api/portfolio-analytics` | 500 | insert returned no row | SERVICE-TRANSIENT | **503** `dependency:supabase` | 04 | ⬜ |
| S-20 | `routers/portfolio.py:1163` | `/api/portfolio-analytics` | 500 | compute raised | SERVICE-PERMANENT | **500** `PORTFOLIO_ANALYTICS_FAILED` | 04 | ⬜ |
| S-21 | *(implicit)* every seam endpoint | all 11 | **500 `text/plain`** | any unhandled exception | UNCLASSIFIED | **500**, no body — safe by R-1 | — | n/a |
| S-22 | *(implicit)* `/process-key` | `/process-key` | **500 `text/plain`** | any unhandled exception | UNCLASSIFIED | **500**, no body. `routers/process_key.py` contains ZERO explicit 5xx sites | — | n/a |
| S-23 | `main.py:230` | all except `/health`, `/internal/*`, `/process-key` | 503 | `SERVICE_KEY` env unset | SERVICE-PERMANENT | **500** `SERVICE_KEY_UNCONFIGURED`. ⚠️ a `JSONResponse` **literal**, not an `HTTPException` — it does NOT appear in a `status_code=5` `HTTPException` grep, and it must stay **returned**, never raised | 04 | ⬜ |
| S-24 | `main.py:279` | `/health` | 503 `{status:"stale"}` | worker heartbeat stale | SERVICE-TRANSIENT | **unchanged** — `/health` is outside the seam; see O-7 | — | n/a |

**Tally:** 24 rows = **21 explicit editable sites** (S-01…S-20 `HTTPException` raises,
plus S-23 the `JSONResponse` literal) + 2 implicit unhandled-500s (S-21, S-22, no edit
possible or needed) + 1 deliberately unchanged (S-24). The `21` is the number that an
`HTTPException` grep sweep under-counts by one, because S-23 is not an `HTTPException`.

**Not seam-reachable, deliberately excluded** (listed so the enumeration is provably
complete, not because they were missed): `routers/exchange.py:453,491,553`
(`/api/fetch-trades`, no TS caller); `routers/csv.py:95`; `routers/portfolio.py:2242,2446`
(Python `/api/verify-strategy`, no TS caller); `routers/cron.py:613,631`;
`routers/debug_key_flow.py:56,100`; `services/analytics_runner.py:1725`.

**Hygiene flag (no code change):** `services/analytics_runner.py:1725` raises
`HTTPException(500)` from `run_csv_strategy_analytics`, whose only caller is
`services/job_worker.py:1947` — the **worker**. An `HTTPException` raised outside an HTTP
request is a category error that can never render. Recorded, not fixed.

---

## 8. How to add a new error site

1. Decide the class from §1's decision questions. If more than one seems to fit, the
   tie-break is R-1: *could an identical retry succeed?*
2. `from services.error_contract import service_error` (or `RETRY_AFTER_SECONDS`).
3. `raise service_error(<status>, "<CODE>", dependency=…, retryable=…, detail="…")`.
   The helper refuses contradictory combinations with a `ValueError` at construction.
4. Write the test with **literal** expected values — never import the expected status or
   code from `error_contract`. An oracle that reads its expectation out of the thing
   under test cannot fail (programme non-negotiable #3: 10 simultaneous semantic
   mutations once produced a byte-identical `8859 passed`).
5. Add the row to §7.
