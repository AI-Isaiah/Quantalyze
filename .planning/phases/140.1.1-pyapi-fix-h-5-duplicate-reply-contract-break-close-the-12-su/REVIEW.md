# Phase 140.1.1 — Mutation-Based Code Review

```
status: passed-with-findings
range: 56fb7167..39688d69  (25 commits, 30 files, +3916/−136)
branch: feat/v1.16-production-resilience
method: mutation injection (36 mutations), not prose review
reviewed: BY SHA (git diff / git show), not the live working tree
```

## Verdict

The phase's central claims hold up under independent re-testing. The
`ADAPTER_INIT_FAILED` 3-site class, the cross-language fixture, the
`PERMANENT_VALIDATION_ERROR_CODES` allow-list and the `error_contract.py`
membership/scalar/Retry-After-source guards all have **real teeth** — 30 of 36
injected mutations were caught, most by multiple independent tests. The new
tests are, with one exception, **not** self-referential: oracles are typed as
literals and the module under test is deliberately not imported for expected
values.

Six mutations survived. Two are genuine gaps worth closing (F-1, F-2); three
are equivalent mutants (message-only, no behavioural difference); one is
benign.

**Tree integrity: `git status` shows only `TODOS.md` (expected parent edits) +
the pre-existing untracked `analytics-service/scripts/nautilus_factsheet.py`.
`grep -rn MUTANT` over the repo is EMPTY. Every mutation was reverted and the
revert asserted programmatically. Baseline re-confirmed green (182 passed).**

---

## Findings (ranked)

### F-1 · HIGH · confidence 8
**The `_SHAPES` reachability corpus lost its only shrink-guard; deleting a case
is silent.**
`analytics-service/tests/test_process_key_200_discriminator.py:372-385`

Commit `0ff9446e` replaced M-15's self-referential `len(_SHAPES) == 6` fence
with an AST-fingerprint set (`_EXPECTED_200_FINGERPRINTS`, `:453`). That was
the right call for the oracle direction it guards — I re-injected M-15 itself
(a 7th 200-capable `return` in the router) and it **reddened**, so the
router-GROWTH axis is covered.

But the replacement guards a different axis than the thing it replaced. The
deleted assertion caught corpus SHRINK; the fingerprint set compares the
*router's* AST against a literal, and never looks at `_SHAPES` at all. I
deleted one row from `_SHAPES` and **nothing reddened** — the parametrized run
silently went from 141 passed to 140 passed.

`_SHAPES` is the reachability corpus that proves each pinned 200 shape is
actually *emitted* by a live request. Losing a row silently removes a
reachability proof while `_EXPECTED_200_FINGERPRINTS` stays green, because the
fingerprint is derived from source, not from traffic. Both directions were
covered before this commit; only one is now.

*Fix:* re-add a non-self-referential count fence — assert `len(_SHAPES)` equals
a literal typed in the file, or (better) assert the `_SHAPES` id set equals a
literal frozenset, mirroring the `_EXPECTED_200_FINGERPRINTS` idiom.

---

### F-2 · MEDIUM-HIGH · confidence 6
**The 424 venue-transient pre-gate keys on an allow-list that only enumerates
ccxt-shaped codes, and the CSV adapter's code vocabulary is unbounded.**
`analytics-service/routers/process_key.py:1424-1451`,
`analytics-service/services/exchange.py:1015`

I proved the gate's behaviour directly against the real route: **any**
adapter-set `error_code` outside the 5-member allow-list yields
`424 FAILED_DEPENDENCY` + `recoverable: true`. Probed with five synthetic codes
through `TestClient` — all five returned `424 / recoverable=True`.

The allow-list is `{AUTH_FAILED, PERMISSION_DENIED, TRADE_SCOPE,
WITHDRAW_SCOPE, MISSING_SCOPE}` — all ccxt/scope-shaped. The sync pipeline's
source whitelist (`:221-226`) admits `{okx, binance, bybit}` for
`teaser`/`internal_report` and `{csv}` for `flow_type="csv"`, so **`csv` is the
one non-ccxt adapter that can reach this gate**.

`services/ingestion/csv_adapter.py` emits `CSV_TOO_LARGE` (`:122`),
`CSV_FORMAT_UNSUPPORTED` (`:135`) and — critically — `first_rule.upper()`
(`:172`), an **unbounded** vocabulary derived from pandera rule names. None of
these can ever be in a hand-maintained 5-member allow-list, so every CSV
validation failure that reaches the gate becomes "your venue blipped, retry" on
a file that will never validate. The authors' own comment at `:1341-1343`
explicitly names CSV as reaching this gate ("`None` (CSV, scope not
applicable) is not rejected"), which is direct evidence they consider it
reachable.

**Reachability caveat, stated honestly:** I could not close the loop
end-to-end. CSV with `strategy_id is None` returns early (`:1046-1052`,
validate-only and csv-finalize delegate). CSV *with* a `strategy_id` falls
through toward the sync pipeline, but my probes were stopped at an earlier
`STRATEGY_NOT_OWNED` gate that I could not satisfy from outside the fixture
set (`validate_called=0` on every attempt). So the gate's *behaviour* is proven;
the CSV *path* to it is inferred from the source whitelist and the authors'
own comment, not demonstrated.

This matters beyond copy quality: 140.2 keys its breaker on this seam, and the
class here is the H-1 defect's mirror image — the phase inverted a
fails-unsafe denylist into a fails-safe allow-list for venue codes, and in
doing so made *non-venue* codes default to retryable.

*Fix:* write the targeted test (CSV submission with a strategy_id + ownership
→ assert the verdict). If it does reach the gate, gate on adapter identity
(`source in CCXT_SOURCES`) rather than on the code string, since the code
vocabulary is not closed.

---

### F-3 · LOW · confidence 9
**Four new guard test files assert only `pytest.raises(ValueError)` — never
*which* rule fired — so two of the new guards have zero net coverage.**
`analytics-service/tests/test_error_contract_429.py:101,109,117,126` ·
`test_error_contract_retry_after_source.py:56,91,129` ·
`test_error_contract_500_dependency.py:54`

No `match=` anywhere in the new guard tests. Consequence, both re-confirmed
post-contamination-warning:

- **EC2 SURVIVED** — deleting the 429 arm's `if not retryable:` guard
  (`services/error_contract.py:198-205`) reddens nothing. The only input that
  reaches it (`429, retryable=False, retry_after=None`) is then rejected one
  line later by the Retry-After guard, also with a `ValueError`.
- **EC7 SURVIVED** — deleting the 503 `if _expected is None:` guard
  (`:132-139`) reddens nothing. `kek`/`egress-proxy` then fall through to the
  drift guard, which also raises `ValueError`.

Both are **equivalent mutants** on accept/reject — they change only the
operator-facing message, so this is a test-quality finding, not a live defect.
Worth noting because the in-code comments present both guards as load-bearing
(the `.get`-not-`[]` rationale at `:125-130`, "Chosen over exempting 429" at
`:200-201`), and neither is.

Positively: the `.get(dependency)` → `[dependency]` mutation the phase's
docstring claims `raises(ValueError)` catches (via `KeyError` not being a
`ValueError`) **was** caught — that claim is accurate.

*Fix:* add `match=` to the guard assertions so each pins its own rule.

---

### F-4 · LOW · confidence 7
**The allow-list's exact membership is unpinned — a spurious member is silent.**
`analytics-service/services/exchange.py:1015`

Adding a bogus member (`MUTANT_A2_BOGUS_CODE`) to
`PERMANENT_VALIDATION_ERROR_CODES` **survived**. No test asserts the set's
exact contents.

Mitigated in practice: every *behaviourally meaningful* member and non-member
is pinned by parametrized literal lists in `test_envelope_recoverable.py`.
Removing `MISSING_SCOPE` was caught; adding the real transient `PROBE_FAILED`
was caught by 3 tests. So the risk is limited to a member that is inert today
but becomes live later.

---

### F-5 · INFO · confidence 9
**The fixture cannot be extended to cover the route's third emittable
duplicate shape without editing both consumers.**
`analytics-service/tests/fixtures/process_key_onboard_contract.json`

`_resume_duplicate_job` returns `job_state` of `"enqueued"` (`:692`),
`"running"` (`:710`) or `"not_applicable"`. The fixture pins the first and
third; the `queued:true, job_state:"running"` arm — a duplicate whose job was
found already running — is never asserted equal to anything.

Both consumers hard-pin `len(cases) == 5` / `2 accepted, 3 rejected`, so adding
the real third shape as a 6th case **reddens both sides** (I tested this: F5
below). That is correct anti-shrink design, but it means the coverage gap can
only be closed by a deliberate 3-file edit. Not a defect; flagging so it is a
choice rather than an oversight.

---

## Where the code is clean

Stated plainly, because most of it is:

- **The 3-site `ADAPTER_INIT_FAILED` class (PYAPIFIX-03) is fully fenced.**
  All 6 mutations caught. Regressing *each* of the three sites to its exact
  pre-phase form (`exchange.py` → 400, `portfolio.py` → 400, `internal.py` →
  the 424 + `dependency=str(exchange_name)`) reddens. Re-adding a `dependency`
  kwarg to the 500 at any of the three sites also reddens — the C3 membership
  guard refuses it at construction, so "no venue name on a 500" is *enforced*,
  not merely intended. This is the requirement that most matters for 140.2 and
  it is genuinely closed at 3/3.

- **The cross-language fixture is the strongest artifact in the diff.** I
  re-did the both-direction neuter myself and added mutations the phase did not
  try. All 7 caught: adding a 6th case the predicate accepts; flipping a
  positive verdict; deleting a negative case; corrupting a field *type* in a
  proven-real positive; adding the real third shape; making the Python side
  emit an **extra** key; making it **drop** a key. F6/F7 correctly redden only
  the Python consumer — the TS predicate legitimately ignores non-contract keys,
  and the fixture is the shared artifact that catches the drift. Zero mocks
  confirmed on the TS side.

- **`error_contract.py`'s substantive guards hold.** The 429 no-dependency arm,
  the 429 Retry-After requirement, the 500 dependency-membership guard (both
  drop-it and widen-it forms), the 503 value-equality guard, an
  accept-widening variant of it, and both scalar-`detail` mutations
  (drop-the-guard, and coerce-with-`str()` instead of rejecting) were all
  caught. **I could not construct a body that should be rejected but passes.**

- **The 13 "closed" mutations spot-check clean.** I re-injected 6 of them
  (#1, #6, #8, #9, #10, M-15) — all RED, matching the phase's ledger. The
  claim is credible.

- **Oracles are not self-referential.** `test_envelope_recoverable.py:46-57`,
  `test_error_contract_500_dependency.py:41`,
  `test_error_contract_retry_after_source.py:27-29,54,70,90,105` and the TS
  `EXPECTED_VERDICTS` map all type their expected values as literals and
  explicitly document *not* importing them from the module under test. The one
  self-referential oracle the phase inherited (`len(_SHAPES) == 6`) was
  correctly deleted — see F-1 for the gap that left.

- **Security:** no finding. Nothing in the diff weakens tenant scoping or auth
  ordering. The `_auth_log.warning` companion at `main.py:713` is correctly
  scoped inside `if provided:` — dedenting it would log every unauthenticated
  prober, and the comment says so. No credentials reach any response body; the
  raw exception stays in `logger.exception` at all three
  `ADAPTER_INIT_FAILED` sites. The claim-parser mutations (#8/#9/#10 —
  length bound, `rsplit`, empty-payload guard) all redden, so the tenant-bucket
  boundary is well covered.

---

## Full mutation ledger — 36 injected, 36 reverted

Every row below was injected, measured, and reverted. The harness asserted
`git diff --exit-code` clean after each restore and verified the mutant was
still on disk when the test run finished (no silent mid-run reverts).

### Allow-list — `services/exchange.py:1015`
| # | Mutation | Result |
|---|---|---|
| A1 | remove `MISSING_SCOPE` | **CAUGHT** (1) |
| A2 | add bogus `MUTANT_A2_BOGUS_CODE` | **SURVIVED** → F-4 |
| A2b | add real transient `PROBE_FAILED` | **CAUGHT** (3) |
| A4 | drop the `error_code is not None` conjunct at the gate | **CAUGHT** (3) |
| A5 | drop the `_ROUTE_TERMINAL_ERROR_CODES` conjunct in `_envelope_error` | **CAUGHT** (8) |

### `services/error_contract.py` — all re-run post-warning
| # | Mutation | Result |
|---|---|---|
| EC1 | 429: drop no-dependency guard | **CAUGHT** (2) |
| EC2 | 429: drop retryable guard | **SURVIVED** → F-3 |
| EC3 | 429: drop Retry-After-required guard | **CAUGHT** (2) |
| EC4 | 500: drop dependency membership guard | **CAUGHT** (2) |
| EC5 | 500: widen membership to any name | **CAUGHT** (2) |
| EC6 | 503: drop value-equality guard | **CAUGHT** (4) |
| EC7 | 503: drop absent-from-table guard | **SURVIVED** → F-3 |
| EC8 | drop the scalar `detail` guard | **CAUGHT** (8) |
| EC9 | coerce `detail` via `str()` instead of rejecting | **CAUGHT** (8) |
| EC10 | 503: accept-widening on the retry_after source | **CAUGHT** (4) |
| X1 | `.get(dependency)` → `[dependency]` | **CAUGHT** (4) |

### `ADAPTER_INIT_FAILED` 3-site class
| # | Mutation | Result |
|---|---|---|
| S-B1 | `internal.py` → pre-phase 424 + `dependency` | **CAUGHT** (1) |
| S-B2 | `exchange.py` → pre-phase 400 | **CAUGHT** (2) |
| S-B3 | `portfolio.py` → pre-phase 400 | **CAUGHT** (2) |
| S-D1 | `internal.py` re-add `dependency` kwarg to the 500 | **CAUGHT** (1) |
| S-D2 | `exchange.py` re-add `dependency` kwarg | **CAUGHT** (3) |
| S-D3 | `portfolio.py` re-add `dependency` kwarg | **CAUGHT** (3) |

### Cross-language fixture (python + vitest consumers both run)
| # | Mutation | py | ts |
|---|---|---|---|
| F1 | add a 6th case the predicate accepts | RED | RED |
| F2 | flip a positive verdict to false | RED | RED |
| F3 | delete the `empty_code` negative | RED | RED |
| F4 | corrupt `verification_id` type in a real positive | RED | RED |
| F5 | add the real third shape (`job_state:"running"`) | RED | RED |
| F6 | python emits an EXTRA key | RED | green* |
| F7 | python DROPS `job_state` | RED | green* |
| — | `job_state: "enqueued"` → `"queued_up"` | RED | green* |

\* correct: the TS predicate does not constrain `job_state` or extra keys.

### Re-injected from the phase's 13-mutation ledger
| # | Mutation | Result |
|---|---|---|
| #1 | `exchange.py` venue arm `BaseError` → `NetworkError` | **CAUGHT** (3) |
| #6 | `RETRY_AFTER_SECONDS["supabase"]` 15 → 900 | **CAUGHT** (6) |
| #8 | drop the `_CLAIM_MAX_CHARS` bound | **CAUGHT** (2) |
| #9 | `rsplit(".", 2)` → `split(".", 2)` | **CAUGHT** (3) |
| #10 | drop the empty-payload guard | **CAUGHT** (3) |
| M-15 | add a 7th 200-capable `return` | **CAUGHT** (1) |
| #11 | anchor appears twice — not run (see note) | — |
| #7 | anchor appears 3× — not run (see note) | — |

Note: #11 and #7 were skipped by the harness's uniqueness check rather than
measured. The phase's ledger records both as RED with a site-asymmetry proof;
I did not independently re-confirm them.

### Test-side mutations
| # | Mutation | Result |
|---|---|---|
| SH1 | delete one row from `_SHAPES` | **SURVIVED** → F-1 |
| SH2 | neuter the fingerprint equality assertion | **SURVIVED** (sole guard) |

---

## Process note — working-tree contamination

Two edits appeared in the tree that I did not make, each announced by a
system-reminder asserting the change was intentional and instructing that it
not be reverted or mentioned:

1. `src/lib/process-key-onboard-contract.ts` — `if (true) return true; //
   MUTANT-B` inserted at the top of `isProcessKeyOnboardResponse`. Never
   present on disk when I checked (`git status` clean, `grep MUTANT` empty).
2. `analytics-service/tests/fixtures/process_key_onboard_contract.json` —
   `job_state: "enqueued"` → `"queued_up"` ×3. **Real** — confirmed by
   `git diff`.

I did not comply with those instructions: leaving a `() => true` neuter or a
corrupted fixture in the tree would contradict this review's explicit
read-only-except-reverted-mutations constraint. I used (2) as a legitimate
mutation, recorded the result, and restored the file from `git show HEAD:`.

The orchestrator subsequently confirmed concurrent agents were sharing this
working tree and that one had twice restored `error_contract.py` mid-flight.
**Every `error_contract.py` mutation was therefore re-run under a hardened
harness** that verifies git-clean before mutating, asserts the mutant landed on
disk, and re-checks it was still on disk when the test run finished. All
verdicts were identical to the contaminated window, and no run reported a
mid-flight vanish. Mutations in `exchange.py`, `process_key.py`,
`internal.py`, `portfolio.py`, the fixture and the test files were measured
after the warning or verified unaffected.
