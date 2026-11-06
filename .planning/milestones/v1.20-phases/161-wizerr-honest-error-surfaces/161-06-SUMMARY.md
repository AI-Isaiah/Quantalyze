---
phase: 161-wizerr-honest-error-surfaces
plan: 06
subsystem: seam / key-connect
tags: [WIZERR-05, retry-after, analytics-client, key-routes, anti-vacuity, coverage-law]
requires:
  - "161-05 (KEY_ORPHANED lands on create-with-key's catch — this plan edits the same catch)"
  - "AnalyticsUpstreamError's three existing optional fields (140.3-01 seamCode, 140.3-11 dependency)"
  - "parseRetryAfterSeconds (B20) — the ONE Retry-After parser"
provides:
  - "AnalyticsUpstreamError.retryAfterSeconds — the upstream's advertised wait, in SECONDS, or null"
  - "keyRouteFailureHeaders() — the ONE decision about whether a key-route failure may advertise a wait, and whose"
  - "A parity law over every locally-redeclared AnalyticsUpstreamError double"
affects:
  - "The wizard key-connect error surface (E2) — its existing renderer finally has a value to render"
  - "Both key routes' terminal catches (create-with-key, composite/add-key)"
  - "Five route test files whose local doubles were brought to the real class's shape"
tech-stack:
  added: []
  patterns:
    - "add-alongside optional ctor param (type-distinct from its neighbours, so a transposition is a tsc error)"
    - "duck-typed `typeof` read off a caught value — never `instanceof` against a wholesale-mocked class"
    - "one conditional expression selecting one headers object — never two successive spreads"
    - "derived-population law with a hand-typed count AND a hand-typed roster"
key-files:
  created:
    - src/lib/api/seam-retry-after.ts
    - src/lib/analytics-upstream-error.parity.invariant.test.ts
  modified:
    - src/lib/analytics-client.ts
    - src/lib/analytics-client.test.ts
    - src/app/api/strategies/create-with-key/route.ts
    - src/app/api/strategies/create-with-key/route.test.ts
    - src/app/api/strategies/composite/add-key/route.ts
    - src/app/api/strategies/composite/add-key/route.test.ts
    - src/app/api/simulator/route.test.ts
    - src/app/api/bridge/route.test.ts
    - src/app/api/keys/validate-and-encrypt/route.test.ts
    - src/app/api/scenario/optimize/route.test.ts
    - src/app/api/verify-strategy/route.test.ts
decisions:
  - "D-161-06-A: the wait is read from the RESPONSE HEADER ONLY. Measured: service_error_body's key set is exactly {code, dependency, retryable, detail} — the nested envelope carries NO retry_after leaf. The plan's 'and/or the envelope leaf' arm is unreachable at HEAD, and reading the flat 429's retry_after_seconds instead would be the second extraction path process-key-client.ts already refused in prose."
  - "D-161-06-B: SHARE, not duplicate. Both key-route catches now call keyRouteFailureHeaders(err); the whole precedence decision (breaker wins) lives in one docblock. This also absorbed the PRE-EXISTING hand-duplicated CircuitOpenError ternary."
  - "D-161-06-C: the doubles needed `dependency` too, not just `retryAfterSeconds`. None of the five had it; adding only the 5th param would have made a 4th positional argument mean the WAIT in a test and the DEPENDENCY NAME in production."
metrics:
  duration: ~75 min
  completed: 2026-08-24
actuals:
  tokens: 16800
  tasks: 3
  commits: 3
status: complete
---

# Phase 161 Plan 06: WIZERR-05 — the server's advertised wait threads end-to-end

`MT5_GATEWAY_UNREACHABLE`'s table-sourced `Retry-After` now survives the seam on a fourth
optional `AnalyticsUpstreamError` field and is relayed by BOTH key-route catches through one
shared decision — and a new parity law makes a future constructor change unable to silently
miss the five test files that declare their own copy of the class.

---

## What changed, per task

### Task 1 — the 4th field + relay one (`400dad0f`)

**`src/lib/analytics-client.ts`**

- `AnalyticsUpstreamError` gained `retryAfterSeconds: number | null`, a 5th constructor
  parameter defaulting to `null`, with a docblock in the house style of its three siblings:
  read HERE because this is the last line at which the value exists (the route handlers
  downstream see only the thrown error, the `Response` is gone), SECONDS at every hop, and
  `null` means "no wait was advertised" — never zero.
- Fed from `parseRetryAfterSeconds(res.headers)` at **both** `!res.ok` construction sites: the
  contract-envelope (JSON) arm and the `text/plain` arm.
- The two `UNUSABLE_RESPONSE_STATUS` arms (null-body statuses, and a 2xx with a non-JSON
  content-type) deliberately keep `null`, documented at the field: their status is
  *synthesized* by this module (502) rather than forwarded, so attaching the upstream's
  advice to a verdict of our own would misattribute it.

**`src/app/api/strategies/create-with-key/route.ts`** — the terminal catch's existing
`CircuitOpenError` ternary gained a second branch inside the *same* conditional expression.

**Five new seam cases** in `analytics-client.test.ts`, including the load-bearing HTTP-date
case: `Retry-After: "Wed, 21 Oct 2026 07:28:45 GMT"` against `Date: "…07:28:00 GMT"` must
yield `45`. `Number()` of that string is `NaN`, so that case can only go green through
`parseRetryAfterSeconds` — it is what makes "the ONE parser" an assertion rather than a
convention. Three new route cases (present / absent / zero).

### Task 2 — relay two + the concurrency/staleness invariants (`79cde37c`)

**`src/lib/api/seam-retry-after.ts` (NEW)** — `keyRouteFailureHeaders(err)`. Both halves (the
breaker cooldown and the seam's own wait), the precedence between them and TRAP-3's absence
rule live in one docblock. Each catch is now one call; neither was restructured.

**Four new cases on `composite/add-key`** (present, absent, staleness, precedence), on top of
Task 1's three on `create-with-key`.

### Task 3 — the parity law (`d5f18d64`)

**`src/lib/analytics-upstream-error.parity.invariant.test.ts` (NEW, 415 lines)** — a derived
population over every file under `src/` declaring its own
`class AnalyticsUpstreamError extends Error`, asserted parameter-for-parameter against a
hand-typed reference list. Plus all five doubles brought to the real class's full shape.

---

## The share-vs-duplicate decision (Task 2's acceptance criterion)

**Chosen: SHARE.** `keyRouteFailureHeaders` in `src/lib/api/seam-retry-after.ts`.

**Reason.** The two catches already carried a hand-duplicated `CircuitOpenError` `Retry-After`
ternary, kept in step by a comment in *each* file pointing at the other. `strategyGate.ts`
records what happens to that arrangement — a predicate that "must never diverge", kept by
comment, "diverged anyway; a comment is not an enforcement mechanism, a shared function is."
WIZERR-05 adds a *second* source of a wait to that expression, which is the moment the
duplication stops being cheap: the copy would now have to stay in step on the value, the
precedence AND the absence rule.

**Why it did not restructure either catch.** One expression became one call, at the same place
— after the classify call, before the return. Both routes' comments record that placement as
deliberate (the caught VALUE still reaches the shared classifier unmodified; the status is
still the classifier's), and it is unchanged. The `CircuitOpenError` import moved into the
helper along with the branch that reads it, taking its "import from the dependency-free leaf,
not through `analytics-client`'s re-export" rationale with it.

**What sharing does NOT buy, stated so nobody deletes the tests.** A law about the helper
cannot see a route that stopped calling it. The four present/absent cases are therefore still
per-route, each naming its route in its title, with deliberately different seconds
(30 = `RETRY_AFTER_SECONDS["mt5-gateway"]` on create-with-key, 15 = `["supabase"]` on
composite/add-key) so a cross-wired fixture cannot pass both. Neuter C below is the receipt.

---

## The idempotency and concurrency questions, answered in this plan's terms

The edge report flagged two probes as genuinely biting here. Both are now pinned, not argued.

### "What happens if `Retry-After` is relayed twice?"

**It cannot be.** `keyRouteFailureHeaders` is ONE conditional expression selecting ONE headers
object — deliberately not two successive spreads, which is the shape that lets a later branch
silently overwrite an earlier one and produce a response advertising a wait belonging to the
other failure mode. Precedence is explicit and documented: **the breaker wins**. While the
circuit is open no request leaves the process at all, so its cooldown is the only value that
describes what will actually happen next; the upstream wait attached to the error that tripped
it would under-advertise by construction.

Pinned by `[composite/add-key] PRECEDENCE: a breaker trip stamps the breaker's own wait, and
exactly one value` — a `CircuitOpenError(42)` carrying an *additional* `retryAfterSeconds: 15`
yields `"42"`, is asserted `not.toBe("15")`, and is asserted `not.toContain(",")` because
`Headers.get` comma-joins a repeated value, so a comma **is** the double-stamp.

Relaying the same value twice is likewise not expressible: the route sets the header once via
one object literal, and `process-key-client.ts`'s relay (a different surface) copies the string
verbatim without parsing. There is one write and one read.

### "What is guaranteed if the header is absent on the retry?"

**Nothing rides along.** The relay is stateless by construction — every fact is read off the
caught value on that call. Nothing is memoized, closed over or held at module level, so a wait
cannot outlive the response that carried it.

Pinned by `[composite/add-key] STALENESS: a wait never outlives the response that carried it`:
two sequential `POST` invocations against the same handler in the same process and the same
module instance, the first advertising 15 (asserted `"15"`), the second advertising none. The
second response's `Retry-After` is asserted `toBeNull()`. A `"15"` there would be the first
attempt's wait describing a response it has nothing to do with — a false sentence about how
long to wait, and worse than no sentence at all, because the user acts on it.

Absence at the seam is equally stateless: `parseRetryAfterSeconds` reads the header off *that*
`Response` and returns `null` when it is absent, empty, non-positive or unparseable. There is
no carry-over slot anywhere on the path.

---

## Observed RED records (three-part house shape)

Every mutation below was applied to the **working tree only**, observed first-hand, and
restored byte-identical (`git diff --stat` confirmed unchanged line counts afterwards, and each
restore was followed by a re-run showing green).

### Initial TDD RED — Task 1 seam cases, against unchanged code

5 failed / 99 skipped. Verbatim:

- `AssertionError: The wait died at this construction site. 30 is the value RETRY_AFTER_SECONDS['mt5-gateway'] puts on the wire; if this reads null the field is not fed and every downstream hop is rendering nothing or, worse, inventing a number.: expected undefined to be 30`
- `AssertionError: Absence must stay absence all the way down. \`0\` is not 'no wait' — it is an instruction to retry immediately, which is a number nobody advertised and the thundering-herd shape B20 exists to stop.: expected undefined to be null`
- `AssertionError: 45 seconds is the delta between the two hand-typed timestamps above, resolved against the SERVER's clock. A raw Number() of the header gives NaN; a client-clock resolution gives whatever today is.: expected undefined to be 45`
- `AssertionError: expected undefined to be 17` (the text/plain arm)
- `AssertionError: expected undefined to be null` (the 2-/3-arg additive property)

### Initial TDD RED — Task 1 route case, against unchanged code

1 failed / 2 passed:

> `AssertionError: The server told us how long to wait and this route is the last hop that can pass it on. 30 is RETRY_AFTER_SECONDS['mt5-gateway'] — not a number this route may choose, round, or clamp.: expected null to be '30'`

⚠️ The absent and zero cases passed against unchanged code, as expected — they cannot red
without the implementation present. Neuter B below is what makes them falsifiable.

### NEUTER A — the feed disabled at the contract-envelope site

**Mutated:** `parseRetryAfterSeconds(res.headers)` → `null` at the JSON construction site.
**Observed RED (2 failed / 3 passed):**

- `AssertionError: The wait died at this construction site. …: expected null to be 30`
- `AssertionError: 45 seconds is the delta between the two hand-typed timestamps above …: expected null to be 45`

Informative asymmetry: the `text/plain` case stayed GREEN, correctly — it is fed at the *other*
construction site, which this mutation did not touch. That is the evidence the two arms are
independently covered.

**Restored** byte-identical; 5 passed / 99 skipped.

### NEUTER B — the absence guard removed (always stamp, zero when null)

**Mutated:** create-with-key's second branch condition replaced by `true`, stamping
`typeof advertisedWait === "number" ? advertisedWait : 0`.
**Observed RED (2 failed / 1 passed):**

- `AssertionError: ABSENT, not empty and not zero. \`Headers.get\` answers null only when the header was never set; an empty-string stamp would satisfy a falsy check and still put a header on the wire the upstream never authorised.: expected '0' to be null`
- `AssertionError: expected '0' to be null` (the zero case)

**Restored** byte-identical; 228 passed across both Task 1 files.

### NEUTER C — composite/add-key stops calling the shared helper (the per-route proof)

**Mutated:** `const headers = keyRouteFailureHeaders(err);` → `const headers = NO_STORE_HEADERS;`
in `composite/add-key/route.ts` ONLY.
**Observed RED — 6 failed / 203 passed, ALL SIX in the composite file, `create-with-key`
entirely green.** That asymmetry is the acceptance criterion: it proves the four cases are
genuinely per-route and not an aggregate that either route could satisfy alone.

- `[161-06 / WIZERR-05] composite/add-key … a seam 503 carrying a wait relays that exact value` — `AssertionError: The '+ Add another key' path must relay the upstream's wait exactly as the single-key path does. Fixing one route of this pair and not the other is the failure this case exists to name.: expected null to be '15'`
- `… STALENESS …: expected null to be '15'`
- `… PRECEDENCE …: expected null to be '42'`
- **and three PRE-EXISTING breaker cases** — `circuit-breaker trip … validateKey` (`expected null to be '42'`), `… encryptKey` (`expected null to be '7'`), and `SEAMUX-08 … NEGATIVE: a breaker short-circuit is NEVER captured — and the breaker cell is UNDISTURBED` (`expected null to be '42'`).

Those last three are the receipt that the helper genuinely absorbed the breaker half too, and
that the route's existing coverage polices the call site.

**Restored** byte-identical; 209 passed.

### Initial TDD RED — Task 3, the law against the un-updated doubles

5 failed / 11 passed. Each failure names its file and its **measured** arity — and this is how
the plan's arity table was corrected:

- `src/app/api/bridge/route.test.ts's double declares 3 constructor parameters; the real class declares 5. …: expected 3 to be greater than or equal to 5`
- same for `keys/validate-and-encrypt` (3), `scenario/optimize` (3), `simulator` (3)
- `src/app/api/verify-strategy/route.test.ts's double declares 2 constructor parameters; the real class declares 5. …: expected 2 to be greater than or equal to 5`

The 11 passing cases were the self-tests, the population floor/roster and the reference
assertions — i.e. the scanner was proven working *before* it was believed about the doubles.

### NEUTER D — the 4th/5th param removed from ONE double

**Mutated:** `retryAfterSeconds` param + field deleted from `simulator/route.test.ts`.
**Observed RED (1 failed / 15 passed):**

> `AssertionError: src/app/api/simulator/route.test.ts's double declares 4 constructor parameters; the real class declares 5. A double with fewer parameters cannot be made to carry the field a route now reads, and — worse — a positional construction silently means something different here than it does in production.: expected 4 to be greater than or equal to 5`

Exactly one file reddened, by name. **Restored** byte-identical.

### NEUTER E — the hand-typed population count made self-referential

**Mutated:** `const EXPECTED_DOUBLE_COUNT = 5;` → `= DOUBLE_FILES.length;`
**Observed RED:** the file failed to load at all —
`ReferenceError: Cannot access 'DOUBLE_FILES' before initialization`, `Tests no tests`.

A blunt failure rather than a clean assertion, but a real and immediate one. Because it does
not exercise the *vacuity fence* itself, two further mutations were run to prove that fence:

### NEUTER E′ — the scanner blinded (the vacuity fence exercised)

**Mutated:** `CLASS_DECL` regex → `AnalyticsUpstreamErrorZZZ`, so the population goes empty.
**Observed RED — 13 failed**, and critically the floor fires by name:

> `AssertionError: The scanner found no local doubles at all. Either every one was deleted (in which case delete this law deliberately) or the scanner broke — and a broken scanner makes every parity assertion below pass vacuously.: expected 0 to be greater than 0`

plus `has exactly the hand-typed measured size` (`expected +0 to be 5`), the roster
(`expected [] to deeply equal [ …(5) ]`), `the REAL class is where this law thinks it is`, and
the SELF-TEST positive (`expected [] to have a length of 1`). This is the answer to "an
empty-set law passes trivially": here it does not — it fails five different ways.

### NEUTER F — the hand-typed count wrong by one

**Mutated:** `EXPECTED_DOUBLE_COUNT = 5` → `4`.
**Observed RED (1 failed / 15 passed):**

> `AssertionError: The number of files declaring their own AnalyticsUpstreamError changed. That is not a thing to 'fix' by editing the literal: a SIXTH double is a sixth place a constructor change can go silent, and it needs the same deliberate decision the other five got.: expected 5 to be 4`

**Restored** byte-identical; 16 passed.

---

## The parity-law population: how it was measured, and the hand-typed literal

**Measurement command, run at HEAD before writing the law:**

```
grep -ran "class AnalyticsUpstreamError" src | sort
```

`grep -a` deliberately, per 161-01's and 161-05's recorded hazard: `src/lib/wizardErrors.test.ts`
carries a NUL byte and a bare `grep` skips it in silence, which reads exactly like "no match".
(The file does not declare a double, but the habit is what matters.)

**Six hits: one real, five doubles.**

| File | Line | Arity BEFORE this plan |
|---|---|---|
| `src/lib/analytics-client.ts` (the REAL class, exported) | 120 | 4 → **5** |
| `src/app/api/bridge/route.test.ts` | 124 | 3 |
| `src/app/api/keys/validate-and-encrypt/route.test.ts` | 143 | 3 |
| `src/app/api/scenario/optimize/route.test.ts` | 137 | 3 |
| `src/app/api/simulator/route.test.ts` | 106 | 3 |
| `src/app/api/verify-strategy/route.test.ts` | 72 | **2** |

**Hand-typed literals in the law** (`EXPECTED_DOUBLE_COUNT` is asserted independently of
`EXPECTED_DOUBLE_FILES`, and `REAL_CTOR_PARAMS` is a third, separate oracle):

```ts
const EXPECTED_DOUBLE_COUNT = 5;

const EXPECTED_DOUBLE_FILES = [
  "src/app/api/bridge/route.test.ts",
  "src/app/api/keys/validate-and-encrypt/route.test.ts",
  "src/app/api/scenario/optimize/route.test.ts",
  "src/app/api/simulator/route.test.ts",
  "src/app/api/verify-strategy/route.test.ts",
] as const;

const REAL_CTOR_PARAMS = [
  "message", "status", "seamCode", "dependency", "retryAfterSeconds",
] as const;
```

`derived.length` is never used as its own oracle anywhere in the file. The two
`admin/match/*` tests import the REAL class via `await import("@/lib/analytics-client")` and
are correctly NOT in this population — adding doubles there would enlarge it and weaken the law.

---

## Deviations from Plan

### 1. [Rule 1 — the plan is wrong about the wire] The nested envelope carries NO `retry_after` leaf

**Found during:** Task 1, reading `analytics-service/services/error_contract.py` per
`<read_first>`.

**The plan says** (behavior bullet 3, and `key_links.via`): "a 503 whose response carries no
header but whose nested envelope carries the `retry_after` leaf ⇒ the field holds those
seconds", via "`parseRetryAfterSeconds(res.headers)` **and/or** the nested envelope's
`retry_after` leaf".

**Measured at HEAD:** `service_error_body`'s key set is exactly
`{code, dependency, retryable, detail}` (+ `correlation_id` when supplied) — its own docstring
says so, and the function body confirms it. The wait travels on the wire in exactly ONE place
for a 503: the `Retry-After` header `_retry_after_headers` attaches. **The described arm is
unreachable.**

The only real body-borne wait anywhere on this seam is the app-global 429 handler's FLAT
`retry_after_seconds` (`main.py`) — and that handler sets the header too, so the header alone
loses nothing. Reading it as a fallback would have created a second extraction path for one
fact, which `src/lib/process-key-client.ts`'s relay docblock **already refused, in prose**:

> ⚠️ RELAY, NEVER PARSE. […] The body's `retry_after_seconds` field is deliberately NOT
> consulted here: two extraction paths for one fact is the substring-cascade shape this
> milestone exists to remove.

**Resolution:** header-only, through `parseRetryAfterSeconds`. This satisfies the plan's own
`and/or` disjunction by taking the reachable arm, honours a standing recorded decision, and is
documented at the field so the next reader inherits the measurement rather than re-deriving it.
Recorded as **D-161-06-A**.

### 2. [Rule 2 — a docblock that would otherwise be false] The `text/plain` arm is fed too

**Found during:** Task 1.

**The plan says** "the single construction site (`analytics-client.ts:~556`)". **Measured:**
`grep -rn "new AnalyticsUpstreamError" src --exclude tests` returns **four** production sites
in that one file (`:513`, `:556`, `:572`, `:585`).

Feeding only `:556` would have made the new field's own docblock (`null` means "no wait was
advertised") a **false sentence** at `:572` — a real upstream error, forwarding a real upstream
status, whose headers are as authoritative as the JSON arm's. That is precisely the class this
phase exists to close, so both `!res.ok` arms are fed (2 extra lines, no call-site churn).

The two `UNUSABLE_RESPONSE_STATUS` arms (`:513`, `:585`) keep `null` **deliberately and
documented**: their status is synthesized by this module (502), not forwarded, so attaching the
upstream's advice to a verdict of our own would misattribute it.

### 3. [Rule 3 — the doubles were further behind than the plan assumed] `dependency` had to be added too

**Found during:** Task 3, measuring the doubles at HEAD as the plan instructed.

**The plan says** "add the 4th param (same name, same `number | null = null` default)".
**Measured:** none of the five doubles carries `dependency` (added to the real class by
140.3-11), and `verify-strategy`'s does not carry `seamCode` either (arity 2, not the "measure
at HEAD" the plan left open — and not 3).

Adding *only* `retryAfterSeconds` as a 4th parameter would have produced the exact silent
divergence this plan exists to close: `new AnalyticsUpstreamError(m, 503, "CODE", 30)` would
read `30` as the **wait** in a test and as the **dependency name** in production. All five were
therefore brought to the real class's full shape. Every pre-existing construction in those
files was left untouched and still passes fewer arguments (verified — 219 tests green across
the six files). Recorded as **D-161-06-C**.

### 4. [Rule 2 — plan-authorised choice, exercised] Shared helper instead of a hand-copied twin

See "The share-vs-duplicate decision" above. This absorbed the **pre-existing** duplicated
`CircuitOpenError` ternary as well as the new branch, which is why Neuter C reddened three
pre-existing breaker cases. Recorded as **D-161-06-B**.

### 5. [Declined — Rule 4 territory, out of scope] Vercel plugin hook recommendations

Two automated hook suggestions fired on the route edits: `next-cache-components` (matched on
the `app/**` path suffix) and a `vercel-functions` "manual retry logic detected — use Workflow
DevKit" recommendation pointing at **line 586**, code this plan never touched. Neither is
applicable: no caching directive was added, and adopting Workflow DevKit for the seam's retry
core is an architectural change (Rule 4) far outside WIZERR-05. Not actioned; recorded here so
the next executor does not re-litigate it.

**Total deviations:** 5 — 1 measured plan correction, 2 auto-applied correctness widenings, 1
plan-authorised choice exercised, 1 declined as out of scope.

---

## Verification

| Command | Result |
|---|---|
| `npx vitest run src/lib/analytics-client.test.ts src/app/api/strategies/create-with-key/route.test.ts` (Task 1) | **228 passed** |
| `npx vitest run src/app/api/strategies/composite/add-key/route.test.ts src/app/api/strategies/create-with-key/route.test.ts` (Task 2) | **209 passed** |
| `npx vitest run src/lib/analytics-upstream-error.parity.invariant.test.ts` + the five double files (Task 3) | **219 passed** |
| `npx tsc --noEmit` | clean |
| `npx eslint` on every touched file | clean (no `no-raw-retry-after-parse` violation — the relay uses `String()`, and the only parse is `parseRetryAfterSeconds`) |
| `npm run test` (**full suite, from the repo ROOT — mandatory, contract tests scan all of `src/`**) | **789 files / 12 166 tests passed, 19 files + 281 tests skipped (pre-existing), 191.66 s** |

No Python was touched, so `pytest` was not owed.

**`[B25]` did not bite this run.** The `contracts-registry.test.ts` case with the raised 30 s
timeout passed; per the plan's note, a failure there would have been news.

**Environment directive confirmed working.** The new law reports `environment 0ms` under a
`|jsdom|` header — which is exactly the signal 161-01's note #5 describes for a working
`// @vitest-environment node` directive. The label is the project default and does not mean the
directive was ignored.

⚠️ **Verification wording (ledger rule).** Branch protection is deliberately off until there
are paying clients, so every CI gate is **advisory at merge**. Each law above is stated as one
that **would have** caught the drift it names, never as one that did stop it.

---

## Must-haves ledger

| Truth | Status |
|---|---|
| A 503 carrying a server-advertised wait reaches the browser with that wait intact, in SECONDS at every hop | ✅ origin table → header → `parseRetryAfterSeconds` → `AnalyticsUpstreamError.retryAfterSeconds` → `keyRouteFailureHeaders` → response header. Pinned at the seam and at both routes. |
| Absent wait ⇒ header omitted entirely, never a default, never zero | ✅ pinned per route (`toBeNull()`, plus explicit `not.toBe("0")` / `not.toBe("")`), and the zero case pins the `> 0` guard. Neuter B is the falsifiability receipt. |
| The client never invents a duration; the only parser is `parseRetryAfterSeconds` | ✅ the HTTP-date case can only go green through it; `Number(header)` is `NaN` there. Repo-wide lint rule `no-raw-retry-after-parse` clean. |
| At most ONE `Retry-After`, with documented deterministic precedence | ✅ one conditional expression, one headers object; precedence pinned with `not.toContain(",")`. |
| A retry whose upstream no longer advertises a wait carries no `Retry-After` | ✅ the staleness case: two sequential invocations, second asserted `toBeNull()`. |
| BOTH key-route catches relay it, asserted **per route** | ✅ present + absent on each, different seconds per route; Neuter C produced a one-route-only RED. |
| Every locally-redeclared double matches the real ctor arity and field set | ✅ the new parity law, with a non-empty floor, a hand-typed count AND roster, and a hand-typed reference param list. |
| No loading / success / empty-state branch on E2 edited | ✅ no wizard component file is in the diff at all — the diff is 13 files, all seam, routes, and tests. |
| The rendered wait sentence wraps without truncation on E2 (`backstop`) | ⬜ **not verified this plan** — no renderer was touched and none is in scope here. See "Owed to a later plan". |

---

## Known Stubs

None. No hardcoded empty values, placeholder text, `TODO`/`FIXME`, or unwired data source was
introduced (`git diff ec9aee8d..HEAD | grep` over added lines: zero hits for
`TODO|FIXME|placeholder|.skip(|.todo(|coming soon|not available`). No test was skipped; the
281 full-suite skips are pre-existing and unchanged.

---

## Threat Flags

None new. The plan's register is honoured:

- **T-161-15 (DoS, Retry-After relay, `mitigate`)** — a wait is stamped only when a source
  advertised a positive one; absence and zero both omit the header (the permissions-route
  exemplar's shape). Exactly one branch can stamp, and the precedence is documented in code, so
  a wait from one failure mode cannot be attributed to another. Pinned by the precedence case
  and by Neuter B.
- **T-161-16 (Tampering, stale wait carry-over, `mitigate`)** — the relay is stateless by
  construction; pinned by the staleness case with two sequential invocations on one handler.
- **T-161-17 (Information Disclosure, widened seam surface, `mitigate`)** — only a NUMBER
  crosses the new field. Every 5xx sentence on every touched arm is byte-identical; the seam
  case additionally asserts `err.message` equals the emitter's own sentence AND
  `not.toContain("30")`, so the wait cannot leak into copy (H-1062 / F5b).
- **T-161-18 (Tampering, silent test-double drift, `mitigate`)** — the parity law, proven
  falsifiable by Neuter D (one double, one named RED) and its vacuity fence proven by
  Neuter E′.

One property strengthened beyond the register: the law also asserts each double **assigns** a
field for every parameter it accepts. A parameter accepted and dropped is worse than an absent
one — the test reads `undefined` from a field it believes it set.

---

## Notes for the next executor

1. **⛔ The wait's ONLY wire source is the `Retry-After` HEADER.** `service_error_body` emits
   `{code, dependency, retryable, detail}` and nothing else; there is no `retry_after` leaf in
   the nested envelope. If a future plan "adds a fallback" that reads a body field, it is
   creating the second extraction path `process-key-client.ts` refused — go read that docblock
   before writing it.
2. **⚠️ `AnalyticsUpstreamError` is now at FIVE parameters, and that is the recorded ceiling
   for the positional form.** The add-alongside was justified because `number | null` follows
   two `string | null`s, so a transposition is a `tsc` error. A **sixth** optional field, or a
   **second `number | null`** one, removes that type-distinctness and makes the
   trailing-options-object refactor mandatory. The trigger is written at `REAL_CTOR_PARAMS` in
   the parity law, so whoever adds the sixth reads it while editing the literal they must edit.
3. **Adding a parameter now costs SEVEN deliberate edits** — the real class, `REAL_CTOR_PARAMS`
   in the law, and all five doubles. That friction is the point; the law will name each file
   that has not been updated, with its measured arity.
4. **A SIXTH file declaring its own double is a deliberate decision, not a literal to bump.**
   `EXPECTED_DOUBLE_COUNT` and `EXPECTED_DOUBLE_FILES` are two independent hand-typed oracles
   and both must move. The two `admin/match/*` tests import the REAL class — keep it that way,
   or the law's population grows and its guarantee shrinks.
5. **⛔ Do not re-inline `keyRouteFailureHeaders` into either route.** Its bodies are trivially
   short, which makes the inline tempting. Neuter C shows what the shared function is buying:
   the SAME six assertions (three of them pre-existing breaker cases) that a hand-copied twin
   was previously kept in step with by a comment in each file — the arrangement `strategyGate.ts`
   records diverging anyway.
6. **⚠️ Both key-route catches now duck-type `retryAfterSeconds` with `typeof`, never
   `instanceof`.** That is not a style choice: the route suites `vi.mock("@/lib/analytics-client")`
   with a bare factory, so the class is `undefined` there and `x instanceof undefined` throws a
   `TypeError` from inside a catch block — turning a clean 503 into a crash. `CircuitOpenError`
   IS read with `instanceof` and that is consistent, because it comes from the dependency-free
   leaf that no wholesale mock replaces.
7. **The parity law's scanner masks STRING CONTENTS as well as stripping comments.** The real
   class's `RangeError` message contains parens and a `${…}` interpolation, and the
   brace/paren balancer would be defeated by unmasked punctuation. If you extend the scanner,
   keep both passes and keep both SELF-TEST negatives (comment, and string).
8. **`npm run test` took 191.66 s this run** (faster than 161-04's ~300 s and 161-05's ~260 s
   note). `[B25]` did not bite.

---

## Owed to a later plan (not a defect left here)

The `backstop`-verified truth — *"the rendered wait sentence wraps within the existing envelope
body without truncation and grows downward in its existing mount, no fixed-height clipping on
E2"* — is **unverified**. Nothing in this plan touches a renderer: the wizard's
`WizardErrorContext.retryAfterSeconds` → envelope `retry_after_seconds` path already existed
and simply had nothing to render until now. This is the first plan in which a real wait can
reach it, so a visual check on E2 with a non-null wait is genuinely owed to whichever plan next
opens that surface (161-07 / wave 4). It is a `backstop` in the plan's own frontmatter, not a
`test`, so no automated pin was owed here.

---

## Self-Check: PASSED

- `src/lib/api/seam-retry-after.ts` — FOUND; `keyRouteFailureHeaders` is called from BOTH
  key routes (`grep -c` = 3 in each, i.e. the import comment, the import, and the call).
- `src/lib/analytics-upstream-error.parity.invariant.test.ts` — FOUND, **415 lines**
  (exceeds the plan's `min_lines: 80`).
- `src/lib/analytics-client.ts` — FOUND; contains `parseRetryAfterSeconds` and
  `retryAfterSeconds` (`grep -c` = 4: field decl, ctor param, assignment, docblock mention).
- All five doubles carry `retryAfterSeconds`; `verify-strategy`'s double additionally gained
  `seamCode` and `dependency` (it had neither).
- No `TODO` / `FIXME` / `placeholder` / `.skip(` / `.todo(` introduced anywhere in the diff.
- Every neuter mutation was restored byte-identical and re-verified green.
- Commit `400dad0f` — FOUND.
- Commit `79cde37c` — FOUND.
- Commit `d5f18d64` — FOUND.

---

## ⚠️ Surfaced, NOT fixed: `STATE.md` still reads `current_phase: 160`

`.planning/STATE.md:5` reads `current_phase: 160` while this phase is 161. Consequences
observed this run, all cosmetic but all misleading:

- `state.advance-plan` answered `{"advanced": false, "reason": "last_plan", "current_plan": 6}`
  — it was reasoning about phase 160's plan count, not 161's.
- The three decisions recorded above were filed under the label **`[Phase 160]`**.
- `roadmap.update-plan-progress 161` was passed the phase explicitly and IS correct
  (`plan_count: 10, summary_count: 6`), as is `requirements.mark-complete WIZERR-05`.

**Deliberately not repaired here.** The phase pointer is the orchestrator's, and four sibling
plans (161-07 … 161-10) are still unexecuted; an executor rewriting it mid-phase could disturb
their sequencing. This is also a recurring class in this file — STATE's own note at `:165`
records a previous `current_phase: 153.7` sitting next to a Phase-143 `stopped_at`. Whoever
runs the next wave should set it, and re-label the three `D-161-06-*` decisions.
