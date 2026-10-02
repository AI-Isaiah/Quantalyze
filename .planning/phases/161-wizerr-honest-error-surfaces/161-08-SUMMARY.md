---
phase: 161-wizerr-honest-error-surfaces
plan: 08
subsystem: seam / route error envelopes
tags: [WIZERR-06, terminal-arm, seam-code, H-1062, F5b, shape-law, anti-vacuity]
status: complete
requires:
  - "161-06 (AnalyticsUpstreamError's ctor ceiling + the five-double parity law — neither was disturbed)"
  - "140.3-G4/G6/G8/SEAMUX-03 (the 4xx-forward arms these five routes already carried)"
provides:
  - "Five terminal 5xx arms that forward the seam's own machine code instead of collapsing it to UNKNOWN"
  - "src/lib/seam-terminal-arm.invariant.test.ts — a derived-population shape law so a SIXTH route cannot regrow the collapse"
  - "A measured membership predicate that distinguishes the collapse from two legitimate near-misses"
affects:
  - "Every client of bridge / simulator / admin-match-{eval,recompute} / keys-validate-and-encrypt reading a 5xx `code`"
  - "Nothing visual: no copy string changed, no status, no header, no persist behaviour"
tech-stack:
  added: []
  patterns:
    - "duck-typed `typeof` read of `seamCode` off the caught value — never `instanceof` against a wholesale-mocked class"
    - "empty-string exclusion, because `\"\" ?? \"UNKNOWN\"` is `\"\"`"
    - "derived-population law fenced by TWO independent hand-typed literals (count AND roster)"
    - "terminal-arm region defined positionally (last `return NextResponse.json(`) rather than by status"
key-files:
  created:
    - src/lib/seam-terminal-arm.invariant.test.ts
  modified:
    - src/app/api/bridge/route.ts
    - src/app/api/bridge/route.test.ts
    - src/app/api/simulator/route.ts
    - src/app/api/simulator/route.test.ts
    - src/app/api/admin/match/recompute/route.ts
    - src/app/api/admin/match/recompute/route.test.ts
    - src/app/api/admin/match/eval/route.ts
    - src/app/api/admin/match/eval/route.test.ts
    - src/app/api/keys/validate-and-encrypt/route.ts
    - src/app/api/keys/validate-and-encrypt/route.test.ts
decisions:
  - "Widen the forward, do not mint five wizard members (plan decision, executed as written)"
  - "Membership in the shape law requires a 4xx RANGE SPLIT, not merely a seamCode forward — this is what excludes scenario/optimize, whose bare terminal UNKNOWN is correct by construction"
  - "The terminal-arm region for the err.message companion law starts AFTER the previous response closes, because on two members the preceding arm is the 4xx forward and reads err.message legitimately"
metrics:
  duration: ~35 min
  completed: 2026-08-24
actuals:
  tokens: 15900
  tasks: 3
  commits: 3
---

# Phase 161 Plan 08: WIZERR-06 — the terminal 5xx arms stop collapsing the severe half of the vocabulary

Five route handlers that already forwarded `err.seamCode` on 4xx and discarded it on 5xx now
forward it on both sides of 500, with every static 5xx sentence byte-identical and the
`err.message` restriction (H-1062 / F5b) untouched — plus a derived-population shape law so a
sixth route cannot regrow the arrangement.

---

## What changed, per task

### Task 1 — the tracer: bridge, end-to-end (`1dad0fac`)

`src/app/api/bridge/route.ts`'s terminal catch had `code: "UNKNOWN"` hard-coded. It now reads:

```ts
const rawSeamCode = (err as { seamCode?: unknown } | null | undefined)?.seamCode;
const seamCode =
  typeof rawSeamCode === "string" && rawSeamCode !== "" ? rawSeamCode : null;
…
{ error: "Bridge scoring failed. Please try again.", code: seamCode ?? "UNKNOWN" }
```

Three properties of that shape, each deliberate:

1. **`typeof`, not `instanceof AnalyticsUpstreamError`.** This arm is also reached by transport
   failures and untyped throws, and every one of these route suites `vi.mock`s
   `@/lib/analytics-client` wholesale — where the class is `undefined` and `x instanceof
   undefined` throws a `TypeError` **from inside the catch block**, turning a clean 500 into a
   crash. Same idiom, same reason, as 161-06's `keyRouteFailureHeaders`.
2. **The empty string is excluded.** `"" ?? "UNKNOWN"` is `""`, so a bodyless code would cross
   as a blank token rather than as the honest terminal.
3. **A comment at the arm records why the CODE crosses but the MESSAGE still does not**, citing
   H-1062 explicitly, so the next reader cannot conclude the message restriction was relaxed
   alongside it.

Four route cases added: (a) forwarded code, (b) null code → UNKNOWN, (c) non-seam throwable →
UNKNOWN, (d) negative control over `err.message`.

### Task 2 — the sweep: the remaining four (`7f89dcf2`)

Task 1's edit applied verbatim to `simulator`, `admin/match/recompute`, `admin/match/eval` and
`keys/validate-and-encrypt`. Sixteen more cases (four per route). `git diff` on the five route
files removes exactly **four** lines beyond Task 1's one — the four terminal object literals —
and nothing else.

Three comments that describe the 4xx/5xx split were amended to state precisely what moved
(`admin/match/recompute/route.ts`, `admin/match/eval/route.ts`, and the TS-19 docblock in
`admin/match/recompute/route.test.ts`): *"only 4xx forwards" is about the MESSAGE; the code now
crosses on both sides of 500.* A comment describing behaviour that no longer exists is a false
sentence in this phase's own defect class, which is why they were not left standing.

### Task 3 — the shape law (`1cc8a91e`)

`src/lib/seam-terminal-arm.invariant.test.ts`, 496 lines, 18 cases, following 161-06's
`analytics-upstream-error.parity.invariant.test.ts` form.

---

## The five static sentences, quoted once each, verified byte-identical

| Route | Sentence (unchanged) |
|---|---|
| `src/app/api/bridge/route.ts` | `Bridge scoring failed. Please try again.` |
| `src/app/api/simulator/route.ts` | `Portfolio impact simulation failed.` |
| `src/app/api/admin/match/recompute/route.ts` | `Match recompute failed. Please try again.` (via the `GENERIC_COPY` constant, not inlined) |
| `src/app/api/admin/match/eval/route.ts` | `Match evaluation failed. Please try again.` (via `GENERIC_COPY`) |
| `src/app/api/keys/validate-and-encrypt/route.ts` | `Key validation failed. Please try again.` |

Verified two ways: (1) `grep -aqF` for each literal at HEAD — all five present; (2)
`git diff | grep "^-[^-]"` across the five route files returns exactly five lines, all of them
the terminal `{ error: …, code: "UNKNOWN" }` object literals being replaced. No sentence
appears in the removed set.

The two `GENERIC_COPY` constants were **not** inlined or reworded. Each admin test file already
carries its own hand-typed transcription of the sentence at file scope, imported from nothing —
so the oracle stayed independent without any new constant.

---

## The `keys/validate-and-encrypt` UNKNOWN inventory

`grep -an 'code: "UNKNOWN"'` on that file at HEAD returned **two** sites before this plan:

| Line (pre-edit) | What it is | Disposition |
|---|---|---|
| `:649` | The **persist-INSERT failure arm**, inside the `persist: true` success path, after validation already succeeded and the `api_keys` INSERT failed. Copy: *"Your key was verified but couldn't be saved. Please try again."* | **LEFT ALONE.** Two independent reasons. (i) Its fault value is `insertError ?? new Error("api_keys insert returned no row")` — a PostgREST/Supabase error that carries **no `seamCode` at all**, so there is nothing to forward and a widening there would be a change with no defect behind it. (ii) Pitfall 6: the persist arm's first real PROD connect is an owed deferred verification, and altering its behaviour would make a smoke failure unattributable. |
| `:749` | The **terminal catch arm** — the 5xx/unclassified residue of the outer `try`. | **CHANGED.** This is WIZERR-06's target. |

Only the terminal arm moved. The persist arm's response body, status, copy, logging and
`captureToSentry` call are byte-unchanged.

**Scrubbing confirmed on the edited arm.** `scrubSeamError(err, perRequestSecrets)` at the
`console.error` sink and `captureToSentry(err, { secrets: perRequestSecrets })` at the Sentry
sink both sit **above** the edited return and neither call was touched. `perRequestSecrets` is
`[api_key, api_secret, passphrase]` — the raw request-body credentials. This is now **pinned**,
not just asserted in prose: case (a) for this route additionally reads
`captureSpy.mock.calls[0][1].secrets` and requires all three values to be present, and case (d)
additionally requires that neither `api_key` nor `api_secret` appears anywhere in the response
body. `seamCode` is a closed-vocabulary machine token from the upstream envelope and is never
request material, so nothing new can reach the body.

**`persist: true` behaviour is unchanged.** The discriminator (`if (body.persist !== true)` →
409 `STALE_CLIENT`), the service-credential arm (503 `SEAM_MISCONFIGURED`), the INSERT, the
no-ciphertext response and the persist-INSERT failure arm are all untouched. The 83-case
validate-and-encrypt suite — which includes the persist-arm and persist-failure-surface blocks —
is green.

---

## ⚠️ W1 — THE REMEDY-TRUTH INVENTORY (all 7 `SEAM_CODE_TO_WIZARD_CODE` rows)

**The question.** Widening the code channel makes previously-unreachable rows reachable *on a
5xx*. The plan already accepts the UNRECOGNIZED case (a forwarded code with no copy renders
UNKNOWN copy — a *rendering* fallback, legitimate). The RECOGNIZED case is the risk: a row whose
wizard copy was authored for a 4xx arm could now render against an upstream outage — e.g. an
auth-flavoured code riding a transient 5xx telling the user to check their API key for a problem
that is not theirs.

**Verdict: 0 of 7 rows are reachable on a 5xx from these five routes. Nothing is rendered
falsely and nothing needed fixing here.** Two independent gates each close it on their own; both
were measured at HEAD rather than reasoned about.

### Gate 1 — the PRODUCER. `seamCode` can only ever hold what the Python service put in its envelope

`AnalyticsUpstreamError.seamCode` is populated at exactly one construction site in
`src/lib/analytics-client.ts` (`:606`), from `seamErrorCode(error)` — the parsed JSON error
envelope of a non-ok response. The other three construction sites pass `null` by construction
(the two `UNUSABLE_RESPONSE_STATUS` arms and the `text/plain` arm). So a row is reachable at a
terminal arm **iff the service emits that wire code at a status ≥ 500**.

Measured with a script that, for each of the seven codes, collected every non-test Python
occurrence and every 4xx/5xx literal within a ±6-line window:

| # | Wire code | Wizard code it maps to | Emitted by the service at… | Reachable on a 5xx from these five routes? | Verdict |
|---|---|---|---|---|---|
| 1 | `VALIDATION_FAILED` | `VALIDATION_FAILED` | `main.py:428` — **422** only (the `RequestValidationError` handler). Two further occurrences carry no HTTP status: `debug_key_flow.py:143` (a `StepResponse` *body field*, and `/debug-key-flow` is called by none of these five routes) and `process_key.py:1594` / `long_fetch.py:337` (worker-path prose/constants). | **NO** — 422 is a 4xx and is answered by the forward arm, never the terminal. | Unreachable; remedy never rendered against a 5xx. |
| 2 | `RATE_LIMITED` | `RATE_LIMITED` | **429** at `main.py:535`, `internal.py:253`, `simulator.py:257`, `portfolio.py:1970`, `portfolio.py:2265`, `match.py:1764`; **424** at `exchange.py:292` (`VenueTransientHTTPException`). `services/exchange.py:1052/1191` set `result["error_code"]` on a **200-shaped dict**, which `routers/exchange.py` converts into the same 424. `error_contract.py:78` is a docstring; `RETRY_AFTER_SECONDS`' keys are dependency names, not codes. | **NO** — every emission is 429 or 424, both 4xx. | Unreachable. |
| 3 | `CIRCUIT_OPEN` | `SERVICE_UNAVAILABLE_RETRY` | **Zero** non-test Python emissions. It is TS-minted, carried by `CircuitOpenError` — a *different class*, from the dependency-free `@/lib/seam-errors` leaf — and every one of the five routes answers it in a dedicated 503 arm that runs **first** among the typed arms. It never touches `AnalyticsUpstreamError.seamCode`. | **NO** | Unreachable, twice over. |
| 4 | `UPSTREAM_TIMEOUT` | `SERVICE_UNREACHABLE` | **Zero** Python emissions. TS-minted as `AnalyticsTimeoutError.seamTransportCode` — a *differently named field* on a *different class*, answered by each route's own 504 arm above the terminal. The duck-typed read added by this plan looks for `seamCode`, which that class does not have. | **NO** | Unreachable, twice over. |
| 5 | `UPSTREAM_NETWORK_ERROR` | `SERVICE_UNREACHABLE` | **Zero** Python emissions. TS-minted for a transport failure — by definition there is no HTTP response, so no `AnalyticsUpstreamError` and no envelope to read a code from. | **NO** | Unreachable by construction. |
| 6 | `SEAM_MISCONFIGURED` | `SEAM_MISCONFIGURED` | **Zero** Python emissions of this literal wire code. Our own five routes *emit* `code: "SEAM_MISCONFIGURED"` on their limiter-misconfigured 503 arm, but that is the route **minting** it, not forwarding an upstream `seamCode`, and that arm is untouched by this plan. (The service's 500-class misconfiguration codes — `EGRESS_PROXY_MISCONFIGURED`, `SERVICE_KEY_UNCONFIGURED`, `KEK_UNAVAILABLE` — are *different wire codes*, dispositioned in `VENUE_WIRE_CODE_TO_VERDICT`, a **different table read at a different call site**.) | **NO** | Unreachable via this table. |
| 7 | `CSV_RATE_LIMIT` | `RATE_LIMITED` | **Zero** Python emissions. It is the two CSV routes' own local throttle token, minted by those routes. Neither CSV route is one of these five. | **NO** | Unreachable. |

For completeness, the codes the service **does** emit at ≥ 500 — the set that this plan actually
made reachable — are: `ADAPTER_INIT_FAILED`, `ADMIN_CHECK_UNAVAILABLE`,
`ANALYTICS_ROW_NOT_CREATED`, `EGRESS_PROXY_MISCONFIGURED`, `EVAL_FAILED`, `INTERNAL`,
`KEK_UNAVAILABLE`, `KEY_UNDECRYPTABLE`, `MT5_GATEWAY_UNCONFIGURED`, `MT5_GATEWAY_UNREACHABLE`,
`PORTFOLIO_ANALYTICS_FAILED`, `ROLE_CHECK_UNAVAILABLE`, `SCORING_FAILED`, `SIMULATION_FAILED`,
plus `SERVICE_KEY_UNCONFIGURED` (500, `main.py:796`). **None of these fifteen is a member of
`SEAM_CODE_TO_WIZARD_CODE`**, so every one of them resolves through
`recogniseSeamErrorCode`'s `?? "UNKNOWN"` to UNKNOWN copy — exactly the accepted,
legitimate rendering fallback the plan's decision block records.

### Gate 2 — the CONSUMER. None of these five routes has a client that consults the table

Measured: `recogniseSeamErrorCode` is called in exactly **six** non-test files, all of them
wizard steps — `ConnectKeyStep`, `CsvSubmitStep`, `CsvUploadStep`, `MultiKeyConnectStep`,
`SubmitStep`, `SyncPreviewStep`.

The five widened routes have eight non-test consumers between them — `BridgeTrigger`,
`ReplacementPanel`, `SimulateImpactButton`, `PortfolioImpactPanel`, `AllocatorMatchQueue`,
`AllocatorExchangeManager`, `ApiKeyManager`, `StrategyForm` — and **every one of them measures
0 references to `recogniseSeamErrorCode`**. No wizard step fetches
`/api/keys/validate-and-encrypt` either (the only wizard mentions of that path are in prose).

So even if a row *could* arrive, no consumer of these routes would translate it. The copy
vocabulary is not widened by this plan, which is the plan's own must-have.

### Residual, named rather than left to be rediscovered

Neither gate is currently pinned by an automated test, and each could open independently: the
service could start emitting one of the seven at a 5xx, or a consumer of one of these five
routes could adopt `recogniseSeamErrorCode`. That would be a **cross-language arrival law**
(Python emitter statuses × TS table membership) — a new artefact, not a widening of anything in
this plan, so it was not smuggled in here. The measurement method is recorded above so it is
re-runnable in one command. Flagged for 161-09 / 161-10 to schedule or decline explicitly.

---

## The shape law: population, how it was counted, and the two near-misses

**Predicate (prose, so the count is reproducible without reading a regex).** A file named
`route.ts` anywhere under `src/app/api`, read from disk and comment-stripped, is a member iff:
(1) it names `AnalyticsUpstreamError`; **and** (2) it carries a 4xx range split — an upper bound
of the form `status < 500`; **and** (3) its terminal arm — operationally, the **last**
`return NextResponse.json(` in the file — carries a `code:` channel.

**Measured 2026-08-24: 5 members**, hand-typed into `EXPECTED_ROUTES` (a roster) and
`EXPECTED_ROUTE_COUNT = 5` (an independently asserted count). `derived.length` is never its own
oracle anywhere in the file.

**How it was counted, and why the plan's stated predicate mattered.** The naive scan —
`grep -ral 'seamCode ?? "UNKNOWN"' src/app/api --include=route.ts` — returns **SIX**, not five:

- `src/app/api/scenario/optimize/route.ts` **is the sixth, and is correctly excluded.** It has
  **no range split**: its `AnalyticsUpstreamError` arm answers *every* status, 4xx and 5xx
  alike, with a flat 502 that **already forwards** `err.seamCode ?? "UNKNOWN"`. Its terminal
  arm's bare `code: "UNKNOWN"` is therefore correct **by construction** — no seam error can
  reach it. Its own comment says so ("THIS ROUTE HAS NO RANGE SPLIT"). Widening it would have
  been a change with no defect behind it; admitting it to the population would have made the law
  *demand* one. **This is why condition (2) is in the predicate and not just condition (1).**
- A second near-miss, found by the same scan and also excluded:
  `src/app/api/strategies/create-with-key/route.ts` names `AnalyticsUpstreamError`, has no range
  split, and ends `return NextResponse.json({ code }, …)` where `code` comes from
  `classifyKeyValidationError(err)` — which already reads the seam code through
  `recogniseSeamErrorCode` / `VENUE_WIRE_CODE_TO_VERDICT`. It never collapsed.

Both are named in the law's docblock, because *"why is this route not in the list"* is the
question every reader of a derived population has.

**Terminal arm defined positionally, not by status** — deliberately. A status-based rule
(`the 500 response inside the catch`) would drag `keys/validate-and-encrypt`'s persist-INSERT
arm, also a 500, into the law and demand a forward for a code that does not exist. The last
`return NextResponse.json(` is the final statement of the outermost catch in all five members;
this was verified by printing that slice for each.

**Comment-stripping is measured load-bearing, not asserted.** On the UNSTRIPPED source, 2 of the
5 members carry 3 `.message` occurrences in exactly the region the companion law scans — bridge
2, simulator 1, the other three 0 — and all three are comments (H-1062 and its restatement)
saying `err.message` must **not** be echoed there. An unstripped scan would report two routes as
violating the rule those very comments state. A self-test re-measures that delta on every run so
the claim cannot go stale.

---

## Observed RED records (three-part house shape: mutation → observed message → restoration)

### NEUTER 1 — the code collapse restored on bridge (Task 1)

- **Mutation:** `code: seamCode ?? "UNKNOWN"` → `code: "UNKNOWN"` in
  `src/app/api/bridge/route.ts`, working tree only.
- **Observed:**
  ```
  FAIL  src/app/api/bridge/route.test.ts > WIZERR-06 (a) — a 5xx seam error carrying a code forwards THAT code, sentence unchanged
  AssertionError: expected 'UNKNOWN' to be 'SERVICE_KEY_UNCONFIGURED' // Object.is equality
  ```
  plus case (d): `expected '{"error":"Bridge scoring failed. Plea…' to contain 'SERVICE_KEY_UNCONFIGURED'`.
  2 failed | 31 passed.
- **Restored** byte-identical from a pre-mutation copy; 33/33 green.
- Note the clean separation this exposed: case (d)'s *leak* assertions stayed green under this
  mutation, because they pin the message discipline, not the code.

### NEUTER 2 — the message discipline neutered on bridge (Task 1)

- **Mutation:** `error: "Bridge scoring failed. Please try again."` →
  `` error: `Bridge scoring failed. Please try again. ${String((err as Error)?.message)}` ``.
- **Observed:**
  ```
  FAIL  WIZERR-06 (d) — NEGATIVE CONTROL: no substring of the thrown message reaches the body (H-1062)
  AssertionError: the 5xx body leaked "Traceback:" out of err.message — H-1062 is re-opened:
    expected '{"error":"Bridge scoring failed. Plea…' not to contain 'Traceback:'
  ```
  6 failed | 27 passed — the two pre-existing H-1062 cases (TC8, TC9b) went red alongside it,
  which is the corroboration that case (d) is pinning the same property they do.
- **Restored** byte-identical; 33/33 green.

### NEUTER 3 — the code collapse restored on all four swept routes (Task 2)

- **Mutation:** `code: seamCode ?? "UNKNOWN"` → `code: "UNKNOWN"` on simulator,
  admin/match/recompute, admin/match/eval and keys/validate-and-encrypt simultaneously.
- **Observed:** 8 failed | 183 passed — cases (a) and (d) red on **all four**, by name:
  ```
  AssertionError: expected 'UNKNOWN' to be 'SIMULATION_FAILED'
  AssertionError: expected 'UNKNOWN' to be 'KEK_UNAVAILABLE'
  AssertionError: expected 'UNKNOWN' to be 'EVAL_FAILED'
  AssertionError: expected 'UNKNOWN' to be 'INTERNAL'
  ```
  This is the per-route proof: a single shared fix could not have produced four independently
  named failures.
- **Restored** all four byte-identical; 191/191 green.

### NEUTER 4 — the message discipline neutered on validate-and-encrypt (Task 2, the credential route)

- **Mutation:** the static sentence concatenated with `String((err as Error)?.message)`.
- **Observed:**
  ```
  AssertionError: the 5xx body leaked "RuntimeError:" out of err.message:
    expected '{"error":"Key validation failed. Plea…' not to contain 'RuntimeError:'
  ```
  6 failed | 77 passed, including the pre-existing F5b static-message case.
- **Restored** byte-identical; suite green.

### NEUTER A — the hard-coded UNKNOWN restored on ONE route, against the LAW (Task 3)

- **Mutation:** `code: "UNKNOWN"` on `src/app/api/simulator/route.ts` only.
- **Observed:**
  ```
  FAIL  src/lib/seam-terminal-arm.invariant.test.ts > src/app/api/simulator/route.ts — the terminal code channel READS seamCode, and is not a bare literal
  AssertionError: src/app/api/simulator/route.ts's terminal arm hard-codes a bare string ("UNKNOWN").
    That is the WIZERR-06 collapse: a 5xx the service classified precisely reaches the client as
    'we could not classify this'. Forward the code the 4xx arm above already forwards.:
    expected true to be false
  ```
  1 failed | 17 passed — and it named the offending route, which is the point of the roster.
- **Restored**; 18/18 green.

### NEUTER B — the hand-typed population count made wrong by one (Task 3)

- **Mutation:** `EXPECTED_ROUTE_COUNT = 5` → `4`.
- **Observed:**
  ```
  FAIL  has exactly the hand-typed measured size
  AssertionError: Expected 4 routes carrying the shape; found 5: src/app/api/admin/match/eval/route.ts,
    src/app/api/admin/match/recompute/route.ts, src/app/api/bridge/route.ts,
    src/app/api/keys/validate-and-encrypt/route.ts, src/app/api/simulator/route.ts.
    A SIXTH is not a literal to bump — …: expected 5 to be 4
  ```
- **Restored**; 18/18 green.

### NEUTER C — the scanner blinded (the vacuity fence exercised, Task 3)

Not required by the plan; run because a non-empty-population assertion that has never been seen
to fire is itself unproven.

- **Mutation:** `NAMES_UPSTREAM_ERROR = /\bAnalyticsUpstreamError\b/` → `/\bZZNoSuchSymbolZZ\b/`,
  i.e. the population derives to the empty set.
- **Observed:** 5 failed | 13 passed, including:
  ```
  × is NOT empty — an empty-set law passes trivially and guards nothing
  ```
  and both SELF-TESTs, which is the correct signal — a blinded scanner should fail its own
  self-tests before it fails the population laws.
- **Restored**; 18/18 green.

---

## Deviations from Plan

### 1. [Rule 1 — the plan's population was one short of the measurement] The scan returns SIX routes, not five

**Found during:** Task 3, re-measuring at HEAD as the plan's behavior block instructs.

**The plan says** the population is "every route file containing BOTH a 4xx seamCode-forward arm
AND an AnalyticsUpstreamError terminal catch", with "5 at plan-time measurement — RE-MEASURE at
HEAD".

**Measured at HEAD:** `grep -ral 'seamCode ?? "UNKNOWN"' src/app/api --include=route.ts` returns
**six**. The extra file is `src/app/api/scenario/optimize/route.ts`.

**Resolution — and it is NOT a sixth route to widen.** `scenario/optimize` has no 4xx range
split; its `AnalyticsUpstreamError` arm answers every status with a flat 502 that already
forwards the code, so nothing from the seam can reach its terminal arm and its bare
`code: "UNKNOWN"` is correct. The plan's own predicate wording ("a **4xx** seamCode-forward arm")
already excludes it — I made that exclusion **mechanical** by requiring `status < 500` in the
membership test rather than leaving it to a reader's judgement, and named both this near-miss and
a second one (`strategies/create-with-key`) in the law's docblock. Nothing about either file was
changed. Had I taken the naive six-file scan as the population, the law would have demanded a
"fix" to a route that has no defect.

### 2. [Rule 1 — my own first cut of the companion law was wrong] The terminal region boundary

**Found during:** Task 3, first run of the new law — it went RED on `admin/match/eval` and
`admin/match/recompute`.

**The bug (mine, not the plan's):** I first defined the terminal region as running *from* the
previous `return NextResponse.json(` through the terminal one. On bridge and simulator the
preceding arm is the 504 timeout; but on the two admin routes the preceding arm **is the 4xx
forward**, whose body reads `err.message` **legitimately** — a 4xx `detail` is operator-curated
copy. The law fired on the one place the message is allowed.

**Fix:** the region now starts where the previous response call *closes*. The wrong boundary and
why it was wrong are recorded in `TerminalArm.region`'s docblock and in the file header, because
the measured `.message` count moved from 4-of-5 to 2-of-5 as a result and a reader re-deriving
that number would otherwise conclude the docblock was stale.

**This is exactly the trap the required reading names** — *"verify your pin actually pins the arm
you think it does"*. It surfaced as a RED rather than as a silent pass only because the law was
run against real source before being trusted.

### 3. [Rule 2 — a corpus that would have failed against a CORRECT tree] `"failed"` and `"unavailable"` rejected as leak-corpus words

**Found during:** Task 2, authoring `keys/validate-and-encrypt`'s case (d).

My first leak corpus was `"RuntimeError: KEK unavailable — nonce derivation failed at …"`. The
token `failed` is a substring of the honest static sentence *"Key validation failed. Please try
again."*, so the negative control would have gone RED against a **correct** tree — the
mirror-image of a test that cannot fail, and just as useless. The corpus was rewritten to be
token-disjoint from both the sentence and the forwarded code, and the constraint is written into
the constant's docblock so the next author does not re-introduce it. All five corpora were then
re-checked for the same collision.

### 4. [Declined — out of scope] Vercel plugin hook recommendations

The `posttooluse-validate` hook flagged "long-running or polling logic detected in a serverless
handler" on three **test** files (`recompute/route.test.ts:583/590`, `eval/route.test.ts:465`),
pointing at pre-existing test code unrelated to this plan, and a `next-cache-components` skill
was suggested on reading `bridge/route.ts`. Neither touches an error-envelope `code` channel.
Declined under CLAUDE.md Rule 3 (surgical changes) and the plan's own scope.

---

## Must-haves ledger

| Truth | Status | How |
|---|---|---|
| A 5xx carrying a seamCode answers with that code on all five routes | ✅ | Case (a) × 5, falsifiable (NEUTER 1, NEUTER 3) |
| A 5xx carrying NO seamCode still answers UNKNOWN | ✅ | Case (b) × 5 |
| Every static 5xx sentence byte-identical | ✅ | `grep -aqF` × 5 at HEAD + the removed-lines audit (5 lines, all object literals) |
| No 5xx body gains err.message / FastAPI detail / a base URL | ✅ | Case (d) × 5 + the law's companion, falsifiable (NEUTER 2, NEUTER 4) |
| The client copy vocabulary is NOT widened | ✅ | W1 inventory, both gates measured; 0 of 7 rows reachable, and none of the eight consumers calls `recogniseSeamErrorCode` |
| The shape is fixed so the CLASS closes | ✅ | `seam-terminal-arm.invariant.test.ts`, falsifiable (NEUTER A, B, C) |
| `persist: true` behaviour unchanged | ✅ | Only the terminal catch edited; persist blocks byte-unchanged; 83-case suite green |
| No loading / success / empty-state branch edited | ✅ | Diff touches terminal catch arms and their tests only |
| The 5xx sentences still wrap without truncation (E9) | ⚪ backstop | Unchanged copy in unchanged mounts — nothing rendered differently; this plan cannot regress it |

Prohibitions: all four hold. `err.message` never forwarded (test + law); no code cast into
`WizardErrorCode` at any consumer (nothing consumer-side was touched at all); persist arm
untouched (judgment, evidenced above); `scrubSeamError` + per-request secret scrubbing survive
and are now pinned by assertion rather than by reading.

---

## Verification

| Gate | Result |
|---|---|
| `npx vitest run` × 5 route suites | **224 passed** |
| `npx vitest run src/lib/seam-terminal-arm.invariant.test.ts` | **18 passed** |
| `npm run test` (full — required, since `src/__tests__/contracts/` scans all of `src/`) | **790 files passed, 19 skipped; 12228 tests passed, 281 skipped** — 262.55 s |
| `npm run typecheck` (`tsc --noEmit`) | clean |
| `npm run lint` (eslint + admin-route-manifest + route-contract) | **0 errors**, 2 pre-existing warnings in files this plan did not touch; manifests OK (20 admin routes, 57 page routes) |

The 281 skips are pre-existing; this plan added **zero** (`grep -c` for `it.skip` / `test.skip` /
`describe.skip` / `it.todo` returns 0 in all six touched test files).

⚠️ Verification prose, per the phase convention: branch protection is off, so every CI gate is
advisory at merge. These gates **would have caught** the collapse regrowing; they did not *stop*
anything, because nothing was merged past them.

All runs were direct `npx vitest` / `npm run` from the repo root in the MAIN working tree — never
wrapped in `gstack-evidence run`, never from a worktree.

---

## Notes for the next executor (161-09, wave 5)

1. **The five terminal arms now carry a duck-typed `seamCode` read, and the idiom is not
   negotiable.** `typeof`, never `instanceof AnalyticsUpstreamError`. All five suites
   `vi.mock("@/lib/analytics-client")` wholesale, so the class is `undefined` inside them and
   `x instanceof undefined` throws a `TypeError` **from inside the catch** — a clean 500 becomes
   a crash. If you see an `instanceof` appear on one of these arms, it is a regression, not a
   tidy-up.
2. **`scenario/optimize` is NOT an oversight and must not be "completed".** Its bare terminal
   `code: "UNKNOWN"` is correct: it has no range split, so its upstream arm already forwards the
   code for every status and nothing from the seam reaches the terminal. Adding it to
   `EXPECTED_ROUTES` would make the law demand a change with no defect behind it. Same for
   `strategies/create-with-key`, whose terminal classifies via `classifyKeyValidationError`.
3. **A SIXTH member of the shape law is a decision, not a literal to bump.** `EXPECTED_ROUTE_COUNT`
   and `EXPECTED_ROUTES` are two independent hand-typed oracles and both must move, deliberately.
4. **161-06's parity population is still exactly 5, and I did not touch it.** No local
   `AnalyticsUpstreamError` double was added to either `admin/match/*` test file — both still
   import the real class via `await import("@/lib/analytics-client")`. Verified: `grep -c "class
   AnalyticsUpstreamError"` returns 0 in both.
5. **The W1 gates are measured but NOT pinned.** Neither "the service emits none of the seven at
   5xx" nor "no consumer of these five routes calls `recogniseSeamErrorCode`" has an automated
   guard. Both are one commit away from opening. The measurement commands are in the W1 section
   above; a cross-language arrival law is the artefact that would close it, and it is deliberately
   not smuggled into this plan.
6. **`npm run test` took 262.55 s this run** (161-06 recorded 191.66 s). Budget for it — a
   file-scoped green cannot clear `src/__tests__/contracts/`.
7. **The `err.message` companion law's region boundary is subtle.** It starts *after* the previous
   response call closes, precisely because on `admin/match/eval` and `admin/match/recompute` the
   preceding arm is the 4xx forward and reads `err.message` legitimately. If you extend that
   scanner, keep the boundary and re-read deviation 2.

---

## Owed to a later plan (not a defect left here)

The `backstop`-verified truth — *"the unchanged static 5xx sentences continue to wrap within
their existing mounts without truncation and with no fixed-height clipping"* — is unverified, and
is unverifiable-by-change here: this plan alters **no** copy string, **no** mount and **no**
renderer. The sentences are byte-identical to what shipped before it, so there is no new layout
risk to check. Recorded rather than silently dropped.

161-06's owed item stands unchanged: a visual check on E2 with a non-null `Retry-After` wait.
This plan does not open that surface either.

---

## Known Stubs

None. No hardcoded empty value, placeholder string, TODO or FIXME was introduced. The five
terminal arms' `?? "UNKNOWN"` fallback is **not** a stub — it is the honest terminal for a
genuinely unclassified failure, exercised by case (b) and case (c) on every route.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change. The one
information-disclosure surface this plan touches (T-161-23 / T-161-24) is mitigated exactly as
the threat register requires and is pinned by the negative-control cases and the companion law.

---

## Self-Check: PASSED

- `src/lib/seam-terminal-arm.invariant.test.ts` — FOUND on disk (496 lines, 18 cases).
- `.planning/phases/161-wizerr-honest-error-surfaces/161-08-SUMMARY.md` — FOUND on disk.
- Commits `1dad0fac`, `7f89dcf2`, `1cc8a91e` — all three FOUND in `git log --oneline --all`.
- All five static sentences re-verified present byte-identical at HEAD via `grep -aqF`.
