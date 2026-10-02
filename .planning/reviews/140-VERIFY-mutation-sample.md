# Phase 140 — MUTATION VERIFICATION of the closure audit's CLOSED verdicts

**Question.** `140-RED-closure-refalsify.md` adjudicated 94 findings and marked **58 CLOSED** — but
its own load-bearing caveat is that *"no mutations were run in any lane. Every CLOSED therefore means
the mechanism is present and correct at source, not that the harness bites if you remove it."*
This document tests which.

**Tree.** Isolated worktree at `a77d607e` (branch `verify-mutation-140`, cut from
`feat/v1.16-production-resilience` HEAD — the exact commit the closure audit adjudicated). Nothing
committed. Every mutation reverted before the next was applied, so each observation is attributable
to exactly one change.

**Baselines (measured here, not quoted).**

| Suite | Command | Result |
|---|---|---|
| TypeScript | `npx vitest run` | **715 files passed, 19 skipped · 9792 passed \| 287 skipped**, 95 s |
| Python | `cd analytics-service && python3 -m pytest -q -p no:randomly` | **4778 passed, 96 skipped**, 60 s |

Both suites are cheap, so **every RED below was confirmed and every GREEN was confirmed against the
FULL suite**, never a subset. No mutation was tuned: each is the first honest semantic mutation
chosen for that finding, applied once, recorded as it fell.

**Branch protection on `main` is OFF.** Every RED means the gate **would have caught** the regression
at merge; none of them **did stop** anything.

---

## Sampling rule (stated so the fraction is interpretable)

A parallel worktree run had already established **10/10 caught in the seam core** (cluster A/D
internals). This run therefore samples deliberately **away** from that, weighted toward:

1. **Cluster B (wizard/client)** — the audit's weakest cluster (10 CLOSED · 14 PARTIAL · 4 OPEN).
2. **Cluster C (Python contract)** — the lane whose own caveat reads *"nothing was executed — no
   pytest, no mypy, no mutation."*
3. Within those, fixes whose mechanism is a **hand-typed roster**, an **allow-list**, a **comment**,
   or a **single-file edit** — the shapes the coverage law says under-cover.
4. **The SECOND member of any class**, never the first.
5. One deliberate probe at a CLOSED verdict whose **receipt was a one-time `grep`** rather than a
   test — the shape most likely to be "closed at source only" by construction.

**Mutation discipline.** Never a syntax error, never a type error, never a test edit. Every mutation
is a changed value, a moved boundary, a flipped branch, or a deleted guard, and each restores a harm
the finding actually described.

---

## ⚠️ THE HEADLINE: one GREEN, and it is on the audit's own receipt

### M11 — A-01 / C-12: the "no 502/504 remains" property is guarded for nine sites and unguarded for nine others

The closure audit's receipt for **A-01 CLOSED** is, verbatim:

> *Measured: `grep -rn "status_code=50[24]\|HTTPException(50[24]" analytics-service/routers/ services/`
> → **empty**, so no 502/504 remains to reach the counting arm.*

That is a **one-time observation of the tree**, not a property the harness enforces. I tested whether
anything re-checks it.

**The mutation.** `analytics-service/routers/portfolio.py:2326` — inside `verify_strategy`, the
**anonymous public teaser** — changed `HTTPException(status_code=500, …)` to
`HTTPException(status_code=502, …)`. One character class. No test touched.

**Result: GREEN on BOTH full suites, byte-identical to baseline.**

| Suite | Baseline | Under M11 |
|---|---|---|
| `npx vitest run` | 715 files · 9792 passed \| 287 skipped | **715 files · 9792 passed \| 287 skipped** |
| `python3 -m pytest` | 4778 passed, 96 skipped | **4778 passed, 96 skipped** |

**The harm is real and I verified it at source.** `src/lib/seam-discriminator.ts:437-444` returns
`counts:false` for **500 only**. Everything else in the 5xx range falls through to the arm below,
where `dependency` is computed **only for 503** — so a **502 yields
`{attributability:"service-transient", counts:true, breakerKey: GLOBAL_BREAKER_KEY}`**. That is the
global key every one of the fifteen call sites checks. Five such responses inside the 30 s window
open it, denying key-connect, the optimizer, admin match and CSV finalize.

And the site I mutated is the **unauthenticated teaser** — so this re-arms exactly the A-05 exposure
the code already documents as ACCEPTED (*"a distributed caller… Vercel's 10 req/60 s per-IP cap is no
defence"*), on the route with the highest exposure in the system.

**Why the guard misses it.** The 502/504 ban IS enforced — but at the **constructor**, not by a
census. `services/error_contract.py:160` raises at runtime:

> `ValueError: the only permanent 5xx in this contract is 500, got 502; a transient fault is 503, an
> exchange fault is 424`

That is genuinely strong — **stronger than the grep the audit cited** (M10 below proves it bites).
But it only covers call sites that route **through `service_error()`**. Every site raising
`HTTPException` directly bypasses it silently. Censused at HEAD, **nine such sites exist** in
`routers/` and `services/`:

```
routers/cron.py:613            routers/exchange.py:719          routers/csv.py:101
routers/debug_key_flow.py:56   routers/exchange.py:781          services/analytics_runner.py:1725
routers/exchange.py:681        routers/portfolio.py:2326        routers/portfolio.py:2550
```

The audit **already censused these** ("eleven deliberate 5xx sites bypass the PYAPI-05 contract
entirely") — but filed it as a *contract-shape* residual (no `code`, no `dependency`, no
`retryable`). It did not notice that the same bypass also voids the A-01 status ban. **Nine sites can
reintroduce the exact A-01/C-12 global-breaker harm with a completely green suite.**

**This is the programme's signature failure recurring one level up, and it is the same shape the
audit itself named as the residual pattern**: the class was closed by the mechanism everyone adopts
(`service_error`), and the completeness needle is *"uses `service_error`"* (syntax) rather than
*"returns a 5xx"* (behaviour).

**Verdict: A-01 is CLOSED AT SOURCE ONLY** with respect to the property its own receipt asserts.
The remedy is a census test — a from-disk scan asserting no `HTTPException` with a 5xx literal other
than 500 survives under `routers/` and `services/`, with the nine known raw sites as a shrinking
allow-list. That is the shape `test_limiter_identity.py::test_no_router_source_references_get_remote_address_except_the_quarantine`
already uses successfully for a neighbouring class, in this same service.

---

## Full results

| # | Finding | Mutation applied | Ran | Result | Failures | Verdict |
|---|---------|------------------|-----|--------|----------|---------|
| M1 | **B-26 member 2** `KeyPermissionBadge.tsx` | Deleted `setPerms(null)` — the invalidate-before-refetch guard. **Second member** of the class. | full vitest | **RED** | **4** in 2 files — `KeyPermissionBadge.test.tsx` (3: breaker-503 chips, fail-closed `{}` verdict, B-27 raw message) + `PortfolioOptimizer.test.tsx` (1: structural pin) | **GENUINELY CLOSED** |
| M2 | **B-26 member 1** `PortfolioOptimizer.tsx` | Deleted `setSuggestions(null)`. | full vitest | **RED (thin)** | **1** — `PortfolioOptimizer.test.tsx` › *STRUCTURAL PIN: the locked invalidate-before-refetch idiom*. **Zero behavioural cases moved.** | **GENUINELY CLOSED — structurally, and it says so** (see note) |
| M3 | **B-14** `finalize-wizard/route.ts` | Flipped the publish gate back to **fail-OPEN**: on a parse miss `return PROBE_PARSE_MISS` → `return {read:true, trade:false, withdraw:false}`. | full vitest | **RED** | **3** — `finalize-wizard/route.test.ts` (2xx `{}`, `trade` renamed, `trade` non-boolean all REFUSE the publish) | **GENUINELY CLOSED** |
| M4 | **B-05 / B-17** `AllocatorMatchQueue.tsx` | Moved the boundary on the **second** member of the `res.ok` class (`handleRecompute` — the one 140.3-08 fixed; `handleDecision` was already correct): `if (!res.ok)` → `if (!res.ok && res.status !== 503)`. Restores "a breaker trip reads as a completed recompute". | full vitest | **RED** | **2** — `AllocatorMatchQueue.test.tsx` (breaker 503 does not call `load()`; ANTI-REGRESSION breaker sentence) | **GENUINELY CLOSED** |
| M5 | **B-01** `SubmitStep.tsx` | Removed `"SERVICE_UNREACHABLE"` — the **second** of the two seam codes 140.3-05 added — from the hand-typed `KNOWN_FINALIZE_CODES` roster, so a seam transport failure falls back to `UNKNOWN`. | full vitest | **RED** | **4** — `SubmitStep.test.tsx` (UPSTREAM_TIMEOUT→SERVICE_UNREACHABLE, UPSTREAM_NETWORK_ERROR→SERVICE_UNREACHABLE, + 2 ANTI-REGRESSION copy cases) | **GENUINELY CLOSED** |
| M6 | **C-13** `main.py::_validation_detail` | Re-echoed the credential carrier: appended `err.get('input')` to the 422 detail string — C-13's exact defect (FastAPI's 422 echoing raw `api_secret` to an anonymous browser). | full pytest | **RED** | **6** in 2 files — `test_validation_error_contract.py` (5, incl. `test_07a_canary_secret_appears_zero_times_in_the_whole_response` and `test_07a_canary_absent_on_a_second_route_too`) + `test_process_key_auth_order.py` (1) | **GENUINELY CLOSED** |
| M7 | **C-15** `main.py` 429 handler | Deleted the `Retry-After` header from the app-global 429 `JSONResponse` — restoring C-15's exact defect (slowapi's header-less 429). | targeted pytest (3 contract files) | **RED** | **3** — `test_rate_limit_contract.py` (`test_08b_429_carries_a_parseable_positive_retry_after`, `test_08b_retry_after_header_and_body_field_agree`, `test_08c_second_route_gets_the_same_envelope_and_header`) | **GENUINELY CLOSED** |
| M8 | **C-09** `services/rate_limit.py` | Deleted the replay guard: removed `if int(exp_raw) < int(time.time()): return None`, so a captured `X-Tenant-Claim` becomes a permanent tenant-bucket credential — the boundary the docstring exists to defend. | targeted pytest (3 limiter files) | **RED** | **1** — `test_limiter_identity.py::TestBucketBehaviour::test_expired_claim_cannot_reach_a_tenant_bucket` | **GENUINELY CLOSED** |
| M9 | **B-28** `ReplacementPanel.tsx` | Deleted the `!Array.isArray(data?.candidates)` guard and restored `data?.candidates ?? []` — a malformed body renders "No replacement candidates found…" as a claim about the user's portfolio. | full vitest | **RED** | **6** — all in `ReplacementPanel.test.tsx` (field absent / null / body not an object / object not array / string, + the observability log case) | **GENUINELY CLOSED** |
| M10 | **C-12 / A-01** `routers/internal.py` | Reverted the **second** named 502-elimination (S-10, the NULL-`exchange`-column arm) from `422` back to `502`. | targeted pytest (3 contract files) | **RED** | **2** — `test_status_contract_exchange_internal.py::test_s10_key_with_no_exchange_is_caller_422` (both params). Failure is a **runtime `ValueError` from `services/error_contract.py:160`** — the guard is in production code, not the test. | **GENUINELY CLOSED — and by a stronger mechanism than the audit's receipt claimed** |
| **M11** | **A-01 / C-12 (completeness)** `routers/portfolio.py:2326` | Raw `HTTPException(status_code=500 → 502)` on the **anonymous public teaser**, at one of the nine sites that bypass `service_error`. | **full vitest + full pytest** | 🔴 **GREEN** | **0** — 9792 \| 287 and 4778 \| 96, byte-identical to baseline | **CLOSED AT SOURCE ONLY** |

---

### Note on M2 — the one thin RED, and why it is not a failure

Deleting `setSuggestions(null)` reddened **exactly one** case, and it is a `readFileSync` grep
asserting the call appears **above** the `await fetch(`. Zero behavioural cases moved.

This is **not** a hidden gap: `PortfolioOptimizer.test.tsx:287-309` discloses it in source, verbatim
— *"⚠️ Added in response to a GREEN mutation, and recorded as such. M72 (delete `setSuggestions(null)`
from the top of `runOptimizer`) left all eleven cases above GREEN."* It explains why (the render
guard's `error` disjunct already keeps every ranking off screen, so the invalidation is behaviourally
redundant on all reachable paths), pins it **structurally and labels it as structural** rather than
dressing it up as behaviour, and records the negative control — *"M72b, deleting the guard's `error`
disjunct, reddens 4 cases, so the behavioural oracle above is not vacuous."*

**My measurement confirms the disclosure is accurate to the case count.** It also confirms the
docblock's testable claim about the other member — *"Member 2 needs no such pin: `setPerms(null)` is
its ONLY fix, so M73 reddens its behavioural cases directly."* M1 **is** that mutation, and it
reddened 3 behavioural cases plus the structural pin. **The claim holds.**

That is a materially different regime from Phase 140, which asserted mutation coverage it did not
have. Residual exposure is narrow: the guard binds the *ordering*, not the *effect*, so a
semantics-preserving refactor would redden it spuriously.

---

## The number that matters

**11 mutations against 10 distinct findings the audit marked CLOSED.**

| Verdict | Findings |
|---|---|
| **GENUINELY CLOSED** (harness reddens) | **9** — B-01, B-05/B-17, B-14, B-26 (both members), B-28, C-09, C-12, C-13, C-15 |
| **CLOSED AT SOURCE ONLY** (green suite, harm restored) | **1** — A-01 |
| NOT CLOSED | 0 |

### **9 of 10 sampled CLOSED verdicts are genuinely guarded — 90%.**

Counting mutations rather than findings: **10 of 11 RED (91%)**.

The one failure is **not** a random miss. It is the single finding I selected *because* its receipt
was a one-time `grep` rather than a test — i.e. the sampling rule predicted it. Every CLOSED verdict
whose receipt was a **named test** or a **structural guard** reddened; the one whose receipt was a
**measured command output** did not.

**That is the transferable rule this exercise produces:** in `140-RED-closure-refalsify.md`, treat
*"Measured: `grep …` → empty"* as **evidence about the tree, not about the harness**. Anywhere the
audit's receipt is a grep rather than a `file:line` guard or a named test, the property is one commit
away from being false with green CI.

---

## Confidence and known bias

**High** on the RED results — each was confirmed on the full suite with named failing tests, and each
mutation restores a harm the finding described in its own words.

**High** on the GREEN — confirmed on **both** full suites at byte-identical counts, with the harm
path re-derived independently at `seam-discriminator.ts:437-455` and the bypass class censused at
nine sites.

**Biases I know I have, stated so the 90% is not over-read:**

1. **The sample is adversarially selected, not random.** I deliberately chose the shapes most likely
   to be unguarded. On a random sample of the 58 CLOSED I would expect a *higher* pass rate, so 90%
   is a **lower bound**, not an estimate of the population.
2. **Counter-bias: one mutation per finding.** A single mutation proves a mechanism has *some* teeth;
   it does not prove the guard is complete. M11 is precisely a case where mutation #1 (M10) reddened
   and mutation #2 on the same property was green — **the first mutation of a class is not evidence
   about the class.** Nine of my ten findings received only one mutation each.
3. **Cluster coverage is uneven.** 6 of 11 mutations are cluster B, 5 are cluster C, and I did not
   re-test cluster A/D internals (a parallel run covered those at 10/10). Cluster B's CLOSED subset
   held perfectly; but B's problem was never its 10 CLOSED — it is the 14 PARTIAL and 4 OPEN, which
   are outside this exercise's remit by definition.
4. **Local Node 25 vs CI Node 22.** Both suites are green locally; a CI-only failure mode
   (this repo has a known one) would not surface here.
5. **I did not run `mypy --strict`.** M11 changes only an integer literal, so it is type-clean, but
   no mutation here was mypy-verified.

---

## Bottom line

The closure audit's structural inference was **substantially correct**: the pins are hand-typed, the
rosters are oracle-independent, the vacuity fences are real, and — measured, not inferred — **the
harness bites on 9 of the 10 CLOSED verdicts I attacked**, including every one in the two clusters
the audit rated weakest. This is a genuinely different regime from Phase 140, where ten simultaneous
semantic mutations produced a byte-identical pass count.

**But the audit's own caveat was right to be load-bearing, and it under-sold itself in one direction
and over-sold itself in another.** It under-sold `service_error`'s runtime ban (a production-code
guard, stronger than the grep it cited). It over-sold A-01, whose stated property — *no 502/504
remains to reach the counting arm* — is enforced at nine call sites and unenforced at nine others,
including the anonymous public teaser, where restoring the exact global-breaker harm costs one
character and passes 14,570 tests.

**Act on:** add the census test for raw 5xx literals under `routers/`/`services/`, modelled on
`test_limiter_identity.py`'s quarantine-allow-list pattern already in this service. It closes A-01's
completeness gap and would have caught M11.

---

## Hygiene

- `grep -rn MUTANT src analytics-service tools` → **0 matches**
- `git status --short` → **clean** (no commits made; every mutation reverted individually)
- `npx vitest run` → **715 files passed | 19 skipped · 9792 passed | 287 skipped** (baseline)
- `cd analytics-service && python3 -m pytest` → **4778 passed, 96 skipped** (baseline)
