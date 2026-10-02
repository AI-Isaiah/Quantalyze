# Phase 140 — SYNTHESIS of fourteen review registers

**Input:** 14 active registers (6 270 lines) at HEAD `a77d607e`, plus the quarantined
shared-tree run used **only** as a replication signal. **Output owner:** planning phase 140.4.

**Register keys used throughout:**
`SF` = SPEC-silent-failure · `TST` = SPEC-tests · `CMT` = SPEC-comments · `TYP` = SPEC-types ·
`REV` = SPEC-review · `FCP` = SPEC-fixture-contract-parity · `TCC` = SPEC-test-comment-claims ·
`ATK` = RED-attacker · `OUT` = RED-outage · `REG` = RED-regressions · `GRD` = RED-guards ·
`CVI` = RED-class-vs-instance · `TRP` = RED-traps · `RFL` = RED-closure-refalsify ·
`Q-*` = quarantined (replication only, never a primary source).

**Evidence grades.** `CONFIRMED` = a first-hand `file:line` plus measured output (a grep count, a
probe, a mutation, an executed suite). `PLAUSIBLE` = reasoned from code shape, no measurement.
`REPL n` = the number of **independent active registers** that found the same underlying defect.

**Branch protection on `main` is OFF** by settled founder decision. Every gate named below
**would have caught**; none **did stop**. Do not re-litigate.

---

## 1. Verdict

Phase 140.1/.2/.3 closed the seam **core** and did not close the wizard/client **rim**. Of 94
findings adjudicated by `RFL`, **58 CLOSED / 26 PARTIAL / 8 OPEN / 2 SUPERSEDED** — and the split
is not random: Cluster A (seam core) is 22/29 closed with **zero OPEN**, Cluster D (harness) is
10/14 with 2 OPEN, while Cluster B (wizard/client) is **10 CLOSED against 14 PARTIAL and 4 OPEN**,
the weakest cluster by a wide margin, with a uniform failure mode — *a type branch or a copy string
was changed while the control flow that produced the harm was left alone.* `TST` independently
corroborates the core half by execution: ten semantic mutations applied one at a time, each
followed by a full 9 792-test run, **10/10 caught** with tight failure counts (1–12 tests) — a
genuinely different regime from Phase 140's ten-simultaneous-mutations byte-identical green. But
`RFL` **ran no mutations** (the no-write rule forbade it), so its 58 CLOSED verdicts mean *the
mechanism is present and correct at source*, **not** *the harness bites if you remove it* — and
four guards in the range are silently deletable with green CI, which is the shape that makes that
distinction load-bearing. Against that, the range also shipped **one new data-integrity regression
produced inside the gated pipeline** (the CSV double-submit constraint, §2 C-2), one plan that
**ships with zero user-visible effect** (140.3-01, §2 H-2), and a rim in which the most expensive
control in the product — an unconfirmed draft delete that cascades every `strategy_keys` member —
is still the primary affordance on 9 of 11 reachable terminal states.

---

## 2. Findings, deduplicated and ranked by blast radius

Stakes ordering: **a live exchange credential reaching a browser or a log** > **a wrong number an
allocator acts on** > **irreversible user data loss** > **an outage we cannot see** > everything else.

### CRITICAL

---

#### C-1 — `csv-validate`'s 502 body echoes the raw caught message, including `INTERNAL_API_TOKEN`, and paints it into the wizard error panel twice
`src/app/api/strategies/csv-validate/route.ts:262` → `:273` (console, raw) → `:274` (HTTP body) →
`CsvUploadStep.tsx:278-279` → `CsvValidationEnvelope.tsx:69` (title) → `:70` (subtitle).
**CONFIRMED** — `TST §1` inserted a probe and measured `PROBE token in HTTP body? >>> true`; `ATK A1`
traced every render hop at source; I re-read `:255-275` and measured `grep -c scrubSeam` on that
file → **0**, the only changed seam route calling `captureToSentry` without ever importing
`seam-redaction`. **REPL 5** (`TST §1`, `ATK A1`, `CVI RIM-1(c)`, `TRP §3`, `REV #2`; + `Q-review C-1`).

**Blast radius.** Per `tenant-claim.ts:31-34` that token is full `/process-key` auth **and** the HMAC
key for `X-Tenant-Claim` — holding it means calling the analytics seam directly as any tenant and
minting claims for arbitrary tenant buckets. The exfiltration path is not devtools: it is the
support screenshot, in the one flow whose whole job is "the upload failed, send this to support."
Trigger is opportunistic (needs a *throw* rather than a classified envelope — a Railway blip), which
does not buy much when the payload is the platform credential.

**Remedy.** Static 502 message — the sibling `bridge/route.ts:190-193` already carries the rule
verbatim (*"H-1062: genuine 5xx / unexpected exceptions return a STATIC message"*) — plus
`scrubSeamError(err)` at the console site. **Mechanism row: per-site edit (1/8) today; promote to
shared artefact** by routing every seam route's error-body construction through one constructor.

> ⚠️ **TRAP.** `src/__tests__/csv-validate-route.test.ts:382-397` **pins the leak green**:
> `expect(json.human_message).toContain("ANALYTICS_SERVICE_URL not configured")`. A fix must
> **delete an assertion**, which is TRAP-9 territory. Land the stronger negative
> (`expect(JSON.stringify(await res.clone().json())).not.toContain(INTERNAL_TOKEN)` — it reddens
> today) **in the same commit** that removes the old one.

---

#### C-2 — the tenant-scope migration silently removed `finalize_csv_strategy`'s only double-submit protection; a CSV double-submit now creates a duplicate strategy
`supabase/migrations/20260726000225_strategy_verifications_tenant_scope_uniq.sql:123` (new
`UNIQUE (strategy_id, wizard_session_id)`), `:135` (drops the platform-global
`UNIQUE(wizard_session_id)`) vs `20260716130500_finalize_terminal_status_param.sql:296-304`, `:315-321`.
**CONFIRMED at source** by `RFL` and re-derived first-hand by the orchestrator. **REPL 1** — but
this is the one entry where replication count is not the credibility signal: two independent
first-hand source derivations agree, with the re-base rule applied (`20260716130500` is the latest
of two definitions).

`finalize_csv_strategy` mints a **fresh** `strategy_id` and then inserts the verification row, so the
new composite key **can never collide**. The only other backstop cannot fire either:
`20260602190000_f6_wizard_session_idempotency.sql:52-54` is
`ON strategies (user_id, wizard_session_id) WHERE wizard_session_id IS NOT NULL`, and that INSERT's
column list **omits `wizard_session_id`**, leaving it NULL. A repeat submit that previously raised
23505 now returns 200 with a second `strategies` row **and** a second `strategy_verifications` row.
`src/lib/wizardErrors.ts:882` still tells the user *"On the CSV path a repeat submit of the same
wizard session cannot create a second strategy"* — now false.

**Branch-only, not yet in prod.** Verified: `git diff --stat origin/main..HEAD -- supabase/migrations`
= this one file, 196 insertions. **Merging `supabase/migrations/**` to main AUTO-APPLIES to prod.**
This must be resolved before the branch lands.

**Remedy.** Enumerate the **writers** of the dropped index, not its readers — either write
`wizard_session_id` into the `strategies` INSERT so the 2026-06-02 partial index bites, or add a
CSV-path uniqueness the RPC actually collides on. **Mechanism row: shared artefact (100%)** — a DB
constraint is the strongest chokepoint available; the failure here was enumeration scope, not
mechanism.

---

#### C-3 — the wizard's single-key gate reads six Supabase results without ever destructuring `error`, so a transient read failure renders as a fabricated measurement about the user's account, terminally, with an unconfirmed destructive control as the primary action
`SyncPreviewStep.tsx:1053-1061` → `:1124-1140`; gate at `strategyGate.ts:155-159`; copy at
`wizardErrors.ts:543-544`, `:1196-1201`; control at `WizardClient.tsx:864-880` → `void handleDeleteDraft()`.
**CONFIRMED.** **REPL 3** (`SF C0`, `TRP §2(c)`, `CVI RIM-2` server half; adjacent `OUT O3`).

supabase-js returns PostgREST failures **as values**, so a failed `trades` count is `null` → `?? 0`
→ `INSUFFICIENT_TRADES` → *"We found only 0 filled trade(s) on this key."* — a **fabricated
observation**, byte-identical to a correct run against a genuinely empty account. `onTerminal`
returns `"done"`, so the poll stops and there is no self-recovery. **The class is fixed 200 lines up
in the same function**: the composite arm at `:848-867` checks `.error` on all four reads and throws
into the `heavyFetchErrorsRef` escalation. The file's own comment at `:699-701` *acknowledges* the
single-key behaviour and treats it as acceptable.

**Inverse instance, same cause, fail-OPEN direction:** if the `earliest`/`latest` reads fail,
`computeSpanDays` returns `null` and `strategyGate.ts:165`'s `spanDays !== null &&` **skips the
7-day history gate entirely** — a 2-day strategy becomes submittable.

**Remedy.** A checked-read helper that throws on `.error`, applied to all six, routed into the
escalation the composite arm already uses. **Mechanism row: per-site edit (0/32) unless you build
the helper** — see WP-2.

---

#### C-4 — the destructive-control guard is a 2-member allow-list against 11 reachable codes; on 9 of them the wizard's offered action deletes the draft and cascades every `strategy_keys` member, without confirmation
`SyncPreviewStep.tsx:1347-1358` (the allow-list — I re-read it: exactly `GATE_DRAFT_GONE`,
`VALIDATION_FAILED`), render at `:1360-1408`, control at `WizardClient.tsx:864-880`.
**CONFIRMED.** **REPL 5** (`TRP §1` full 11-code table, `CVI RIM-4`, `GRD F-8`, `OUT O3`, `SF C0`).

Three sub-facts that the registers state differently and that 140.4 must keep separate:

- **`GATE_NO_DATA_SOURCE` is the genuine sole-control member** (`CVI RIM-4`, CONFIRMED). It is
  non-recoverable, so no Retry renders, so `onTryAnotherKey` is *literally the only button*. Its
  `actions` are **byte-identical to `GATE_DRAFT_GONE`** — the code the guard was created for — and
  its own fix line says *"Start fresh — the previous draft will be cleaned up."* The button is
  labelled "Try another key" and deletes without confirmation, unlike `handleStartFresh`, which
  140.3-10 deliberately routed through the confirm dialog.
- **`GATE_INSUFFICIENT_TRADES` / `GATE_INSUFFICIENT_DAYS` are *spuriously* recoverable** (`TRP §1d`,
  CONFIRMED). `recoverable` is derived from `actions ∩ {clear_and_retry, try_another_key}`, and
  `try_another_key` makes them recoverable while the handler `onRetry` receives is
  `handleKickoffRetry`, which re-runs the kickoff and re-evaluates an identical gate. **140.3-10's
  B-22 fix created this false affordance.** `GATE_INSUFFICIENT_TRADES`'s copy says *"Your draft is
  saved for 30 days"* while its only other control deletes that draft now.
- **`isComposite` is provably `false` wherever the guard fires**, so the non-destructive
  `onReviewKeys` escape hatch at `:1399` is structurally unreachable on exactly the arms where the
  destructive button appears (`TRP §1c`, `REG N-1`, both CONFIRMED, same fact, opposite framings —
  `REG` reads it as the guard over-reaching, `TRP` as the escape being unavailable; the operative
  truth is `TRP`'s).

**Remedy: INVERT the guard.** Render the destructive control only for codes that *earn* it, split
`recoverable` from "a kickoff retry will help", and confirm the delete. **Mechanism row: today a
hand-typed roster (2/3); inverting converts it to a property = shared-artefact row.** A widened
allow-list is a partial fix by construction, and the range already proves it — `39ea3b20`'s failure
message instructing a future author to widen the list "IN THE SAME COMMIT" was written *after*
`RATE_LIMITED` had already been admitted without it.

> ⚠️ **TRAP.** `TRP` records `.planning/STATE.md`'s *"TRAP-4 five clicks in a REAL browser against a
> live composite draft"* as **FOUNDER OWES, none done**. The allow-list was accepted as the
> discharge. It is not one. See §7.

---

#### C-5 — the breaker's own health is a single `console.warn`, both of its store-failure catches fail OPEN silently, and on one Upstash outage the limiter beside it fails CLOSED and blames the user's exchange
`resilient-fetch.ts:922` (the sole `seam.breaker.*` sink — I re-grepped, one production hit),
`:1027-1035` (`isBreakerOpen` → `{open:false}`), `:1234-1242` (`recordSeamFailure` records nothing);
`ratelimit.ts:322-336` (fails CLOSED); `create-with-key/route.ts:223-235` → `KEY_RATE_LIMIT`.
**CONFIRMED** — measured `grep -c captureToSentry` → **0** in both `resilient-fetch.ts` and
`ratelimit.ts`, while the same phase wired `captureToSentry` into 32 new sites elsewhere. There is
no bundle obstacle: `sentry-capture.ts` imports only `seam-redaction.ts`, which `resilient-fetch.ts`
already imports. **REPL 3** (`SF C2`, `RFL A-11`, `OUT O2`).

**The compound trace is the finding, not either half.** During an Upstash outage the breaker is
**entirely disabled and will never trip**, while the limiter — which runs *first* in every seam
route — denies every request. `checkLimit` hands back `reason: "ratelimit_misconfigured"` precisely
so the caller can answer 503 instead of 429; `OUT` audited all 15 seam routes and measured the split
present at **3**, absent at **11**, no limiter at 1. The worst render is `create-with-key`, which
attaches `KEY_RATE_LIMIT`: *"The exchange rate-limited this request… This is a transient,
exchange-side throttle and not a problem with your key… Wait 60 seconds and try again."* Every
clause is false, on the user's **first** click, for **every user simultaneously**, for as long as
Upstash is down, and the only trace is two `console.error` lines. That is the absence-shaped
evidence this programme's hardest lesson names: only a positive case can falsify the carry, and
there is no positive case.

**Secondary, MEASURED:** an unresponsive store adds up to ~4.25 s to *every* seam call before the
request is even issued (`Redis.fromEnv` retries×backoff + a 2 s per-command signal), on top of the
up-to-5 s ratelimit timeout sentinel inside `recordSeamFailure`.

**Remedy.** Route `emitBreakerTransition` and both store catches through `captureToSentry`
(`warning` for the transition, `error` for the store failure); apply `isRateLimitMisconfigured(rl)`
at the 11 routes lacking it. **Mechanism row: chokepoint (100%) for the breaker half; the 11-route
half is per-site (measured 3/15) unless `checkLimit`'s misconfigured branch returns a response shape
callers cannot ignore.**

> ⚠️ **SEQUENCING TRAP.** This fix is worthless until **H-7** lands. Every `captureToSentry` today
> is an un-awaited floating promise on a runtime with no Sentry wrapper and no flush.

---

### HIGH

---

#### H-1 — credential scrubbing reaches 1 of 4 sinks as a class; the guard's completeness needle re-derives 3 of the 5 routes it must protect, and the two it misses are the ones standing over the raw undici error
Sinks measured by `CVI RIM-1`: **Sentry** — chokepoint, 109 sites, gap 0. **`console`** — hand-typed
`SEAM_FILES` roster of 8, **7 more seam route files / 8 sites uncovered**. **thrown `Error.message`**
— `analytics-client.ts:529-536`, gap 1. **HTTP response body** — `csv-validate:274`, gap 1 (= C-1).
**CONFIRMED** by measured greps in four registers plus `REV`'s re-run of the guard's own scanner over
all 15 routes (**10 of 15 have unscrubbed `console.*` error arguments**; `verify-strategy` and
`keys/sync` are the two that hold credentials and both were edited by this diff).
**REPL 7 — the most-replicated finding in the corpus** (`CVI RIM-1`, `REV #2`, `TRP §3`, `RFL A-10`,
`SF M5`, `GRD F-1`, `TST §5`; + `Q-review C-1`).

The four load-bearing specifics:

- **The thrown twin.** In ONE function, four lines apart: `console.error(…, scrubSeamString(JSON.stringify(result.error.issues)))`
  then `throw new Error(\`…${result.error.issues.map(...).join("; ")}\`)` — **unscrubbed**, with the
  comment immediately above the scrubbed call stating the rule the throw breaks. `parseResponse` is
  reached from 8 of 9 analytics-client wrappers, so this string is producible on every seam route.
- **`verify-strategy` is the worst uncovered route and it is public/anonymous.** It declares
  `perRequestSecrets = [userAccessToken, body.api_key, body.api_secret]` and applies them **to
  Sentry only**, then logs raw at `:384`, `:423`, `:440`. It matches neither
  `CREDENTIAL_BEARING_CALLS` needle (it calls `postProcessKey`, not `validateKey`/`encryptKey`).
- **The roster is droppable.** `GRD F-1` measured a green mutation: delete `finalize-wizard` from
  `SEAM_FILES` and add a bare `console.error(…, err)` beside its `resilientFetch` call — every
  assertion in the file stays green, because there is **no `expect(SEAM_FILES).toHaveLength(8)`
  anywhere**, and the HI-02 needle does not match that route. `resilient-fetch.ts:1807` is
  `throw err;` — the ORIGINAL error, headers inlined in `message` — so the hazard is structural.
- **The good news, and it is real:** the 10 unrostered seam routes are safe **by containment, not by
  the guard** — they consume `analytics-client` (`:404` throws a static string) or
  `process-key-client` (returns an envelope). That containment is itself undefended; nothing pins
  `analytics-client.ts:404` as "must be a static message."

**Remedy.** Derive `SEAM_FILES` from `SEAM_ROUTE_BUDGETS ∪ SEAM_EXCLUSIONS` + the two lib clients;
extend `CREDENTIAL_BEARING_CALLS` with `postProcessKey(` and `resilientFetch(`; scrub the thrown
twin. **Mechanism row: shared artefact (100%) — and `CVI CLOSED-1` measured that the budget table is
a complete superset (20/20 seam-reaching files under `src/app/api`), so the source is proven.**
`resilient-fetch.wiring.test.ts`'s three set equalities are the shape to copy.

---

#### H-2 — 140.3-01 ships with **zero user-visible effect**: the fix translates two new codes correctly and a second, unextended allow-list in the same function throws them away one line later
`SubmitStep.tsx:206-213`; `KNOWN_FINALIZE_CODES` at `:148-194` (9 members — I re-read the set);
`SEAM_CODE_TO_WIZARD_CODE` at `wizardErrors.ts:1554-1555`.
**CONFIRMED** (orchestrator-settled fact #3; independently derived by `CVI RIM-0`).
**REPL 3** (`CVI RIM-0` headline, `TYP F2a`+`F6`, `OUT O3` at the sibling site).

`recogniseSeamErrorCode("RATE_LIMITED")` → `"RATE_LIMITED"` ✅, a valid `WizardErrorCode`, **not in
the 9-member set** → `"UNKNOWN"` → *"Something went wrong."* Same for `VALIDATION_FAILED`. So a
Python 429 (`main.py:520`) or 422 (`main.py:413`) at the publish step renders as a generic dead end.
**The discipline that would have prevented this is written down TWICE inside the very set that drops
the codes** (`:159`, `:181`), for the two members that *were* admitted in the same commit — the rule
was applied to `COMPOSITE_TOO_MANY_MEMBERS` (140.3-14) and `SEAM_MISCONFIGURED` (140.3-15) and
skipped for the two codes 140.3-01 minted, same file, same set, same range.

**Second, independent structural gap at the same surface.** `SubmitStep.tsx:119` reads `data.code`
**top-level**. All 21 nested-envelope Python codes live at `body.detail.code`. The leaf that handles
both shapes — `seamErrorCode` — **is already imported in this file** (`seamCorrelationId(data)` is
called at `:216`). Those 21 codes are structurally unreadable there no matter what any table holds.

**Per-consumer coverage, measured by `CVI`:** SubmitStep 11/37+ · KeyPermissionBadge **0/5** (renders
the raw machine code to the user: *"PROBE_BACKEND_UNAVAILABLE: Upstream 503"*) · CsvSubmitStep 0/6
(no table at all ⇒ no cause, no fix list, no `recoverable` ⇒ **no Retry control**) · SyncPreviewStep
5/7 · ConnectKeyStep/MultiKeyConnectStep union-closed but fed 6/12 venue codes, where
**`WITHDRAW_SCOPE` falls to the substring cascade, matches `includes("withdraw")`, and renders the
`KEY_HAS_TRADING_PERMS` copy — the wrong copy, silently.**

**Remedy.** (a) add the two codes; (b) read `seamErrorCode(data)` at `:119`; (c) the durable fix is
`TYP F2c`'s `WireErrorCode` union, which makes an untranslated wire code a **compile** error at the
table. **Mechanism rows: (a)+(b) hand-typed roster (9/37+) — partial by construction; (c) shared
artefact (100%).**

---

#### H-3 — `SyncPreviewStep` recognises **none** of the seam's four wire codes, renders "we cannot tell which step failed" when the wire told us exactly, and offers the destructive control beside it
`SyncPreviewStep.tsx:147-174` (`KNOWN_KICKOFF_CODES` — 5 members, none of `CIRCUIT_OPEN`,
`UPSTREAM_TIMEOUT`, `UPSTREAM_NETWORK_ERROR`, `SEAM_MISCONFIGURED`), `:593-631`;
`keys/sync/route.ts:544` forwards the seam envelope verbatim.
**CONFIRMED end to end.** **REPL 3** (`OUT O3`, `RFL B-01`, `SF` secondary; + `Q-review I-1` adjacent).

The sibling step does the translation: `SubmitStep.tsx:207-212` calls `recogniseSeamErrorCode`
**before** the membership check, added by 140.3-05 *for exactly this reason*, with a docblock saying
*"the wire vocabulary and the wizard vocabulary are not the same set… all three failed the
membership check below and fell to UNKNOWN."* 140.3-10 then built `KNOWN_KICKOFF_CODES` as a raw
wire-string lookup with **no translation hop**, five plans later, on the route that forwards the
seam envelope most directly. The class was named, fixed once, and re-created at the second site in
the same phase.

**Remedy.** One line, the identical shape as `SubmitStep:207-212`. Ships with C-4 — same file, same
render. **Mechanism row: hand-typed roster today; converges with H-2(c).**

---

#### H-4 — the 400→424 remap put **our own outages** and **permanent caller faults** on the wire as "the caller's exchange is at fault", where the breaker cannot see them
Five members of one class, all **CONFIRMED**, `REPL 2` active (`SF C1/H2/H3/L1`, `OUT O5`) **+ 4
independent quarantined arms** (`Q-SF P1/P2/P3/P8`) — the strongest quarantine corroboration in the
corpus.

| # | site | what it actually is | wire says | breaker |
|---|---|---|---|---|
| a | `exchange.py:398-413`, `:414-435` | **our** `mt5-gateway` down (`classify_mt5_login_error` returns `"transient"` for `-10004`, whose own comment reads *"the terminal bridge isn't attached (gateway down / mid-redeploy)"*, and `"transient"` is the **default** bucket) | 424 | **inert** |
| b | `exchange.py:619-624`, `portfolio.py:2354-2359` | 5 permanent CALLER faults (`PERMISSION_DENIED`, `AUTH_FAILED`, `WITHDRAW_SCOPE`, `TRADE_SCOPE`, `MISSING_SCOPE`) — the whole `validate_key_permissions` vocabulary is passed through, not the venue-fault subset | 424 `recoverable:false` | inert |
| c | `exchange.py:1146-1159` → C6 | `DDOS_PROTECTION` — a geo/ASN block on **our** egress IP, whose producer comment says *"retrying immediately won't help"* | 424 `recoverable:true` | inert |
| d | `exchange.py:1195-1214` → C6 | `VALIDATION_UNEXPECTED` — our own unclassified stdlib bug, at `logger.warning` not `logger.exception` | 424 `recoverable:true` | inert |

**(a) is the sharpest.** One physical Railway redeploy produces two attributions: a failure at
*connect* takes `exchange.py:340-349` → `503 dependency="mt5-gateway"` → `counts:true`; a failure at
`login()` with `-10004` — **the documented modal symptom of that same redeploy** — answers 424 →
`counts:false, breakerKey:null`. The arm that fires most of the time is the one the breaker cannot
see. The diff's own fixture agrees with the diagnosis and ships the wrong status anyway.

**(b) also created an in-file contract contradiction.** `error_contract.py:190-194` declares and
enforces, for the nested form, *"a 424 is recoverable — the venue may come back; marking it
non-retryable produces the B-01/B-22 dead-end render."* C6/C7 emit `424 recoverable:False` for every
member of `PERMANENT_VALIDATION_ERROR_CODES` and the fixture pins it.
`VenueTransientHTTPException.__init__` guards status range, `detail` scalarity, `code` non-emptiness
and `recoverable` **type** — and has **no retryability guard**, so nothing catches it. While these
sites were 400 the rule did not apply; the remap put them in scope without extending the guard.

**Remedy.** Re-home (a) onto the existing 503 `dependency="mt5-gateway"` arm 70 lines above; split
the venue subset out of the `result["error_code"]` pass-through for (b)(c)(d); **add the retryability
guard to `VenueTransientHTTPException.__init__`** so the contradiction becomes unconstructible.
**Mechanism rows: the constructor guard is a shared artefact (100%); the re-homing is per-site.**

> ⚠️ **TRAP.** `analytics-service/tests/fixtures/validate_key_venue_transient_contract.json` pins
> `"status": 424` on all 14 cases, has a **real Python reader** (23 pytest through the live
> `main.app` stack) **and** a TS parity test (48 vitest, bidirectional set containment). Any
> re-homing must move the fixture and **both** sides in one commit. This is the only parity fixture
> in the repo with a genuine cross-language reader — do not break it to land a status change.

---

#### H-5 — `PortfolioOptimizer` renders a partial ranking and an unparseable body as definitive money verdicts, and stamps both as fresh
`portfolio-optimizer/route.ts:158-166` (drops `partial_data`, hardcodes `status:"complete"`);
`PortfolioOptimizer.tsx:218-232`, `:329-331`.
**CONFIRMED.** **REPL 2** (`SF M2`+`H7`; `OUT` scenario 6 re-confirms M2). **Highest money blast
radius of anything in the corpus.**

The Python upstream returns `partial_data`, `computed_strategy_count` and `expected_strategy_count`
**specifically so this does not happen** (`portfolio.py:1862`, `:1874-1878`, with the comment
*"surface partial_data so the UI/caller can show a badge"*), and
`PortfolioOptimizerResponseSchema` is `.passthrough()`, so the field **is** in `data`. The route
drops it, drops the upstream's own `status` and `ok`, and hardcodes `"complete"`. **An allocator
reallocates capital off a ranking computed on half their book, with no indication.**

Second path, same component: a 200 whose body cannot be parsed collapses to `{}`, `res.ok` is true,
`data.status !== "failed"`, so `suggestions = []` renders *"No candidates match your current mandate.
Try relaxing filters"* — a claim about the allocator's **mandate** derived from a parse failure — and
`setLastComputedAt(now)` suppresses the staleness banner, recording the failed run as a fresh
successful one. **The first member of this class was fixed in this same commit range** at
`ReplacementPanel.tsx:79-87` (B-28) with a comment whose sentence applies verbatim; `PortfolioOptimizer`
was edited in the **same commit** for SEAMUX-09 and did not get it.

**Remedy.** Honour `partial_data` (badge); add ReplacementPanel's guard. **Mechanism row: per-site
(2 sites) — but the "unreadable body" guard is a one-leaf candidate.**

---

#### H-6 — `WeightOptimizerSection` tells an allocator to change their strategy selection for a 401, a 429, and a body it simply could not read
`WeightOptimizerSection.tsx:163` (`res.status >= 400 && < 500 ? "refused" : "unavailable"`),
copy at `:112-115`; `:167-169`, `:179`, `:239-246`; route arms at `scenario/optimize/route.ts:69-72`
(401), `:147-150` (429, `userActionLimiter` = 5/60 s).
**CONFIRMED.** **REPL 5** (`REG RG-2`, `REV #1`, `SF M0`, `OUT O6`, `CVI RIM-5`).

Three distinct wrongs at one component:
1. **429** → *"The optimizer answered but would not run this request. Change the objective or the
   selected strategies."* The one true fact (wait ~60 s) is never shown; the route's own body
   literally says *"Try again shortly"*, the sentence this change deleted.
2. **401** (`REG`'s new half, the worse one) → an allocator whose session lapsed is told their
   *portfolio selection* is the problem, with no hint to re-authenticate.
3. **A body that parses but is the wrong shape** → `ok: undefined` → `FALLBACK_EMPTY` *"Couldn't
   suggest weights… Try a different objective or selection."* The correct copy exists —
   `FAILURE_COPY.unreadable`: *"The optimizer answered with something this page could not read, so we
   can't tell whether it ran"* — and `:179` reaches it **only** via `err instanceof SyntaxError`. The
   `unreadable` verdict, introduced in this range specifically to stop this collapse, covers only
   the narrower half.

Also: the component reads `res.status` and discards the body and the `Retry-After` header entirely,
so `seam-copy.ts`'s "ONE sentence every seam emitter reads" is not what the allocator reads, and a
real cooldown the server knew is thrown away (`OUT O6`).

**Remedy.** Exclude 401/403/408/429 from `refused`; make `unreadable` reachable on a shape miss; read
the body and the header. **Mechanism row: per-site.** See §6 P6 — the docblock at `:83-101` argues
the case it gets wrong.

---

#### H-7 — every SEAMUX-08 Sentry capture is a floating promise on a runtime that is not Sentry-wrapped and never flushes
`sentry-capture.ts:144-158` (`void import("@sentry/nextjs").then(…).catch(() => {})`).
**CONFIRMED** — I measured `grep -ci sentry next.config.ts` → **0** (no `withSentryConfig`) and
`grep -rn "flush("` across `sentry-capture.ts` and `instrumentation.ts` → **no hits**. **REPL 2**
(`SF H1`; + `Q-SF F1`).

`captureToSentry` returns synchronously; every call site returns immediately after, with no `await`
and no `after()`. On a serverless instance that freezes at response completion, a module load with
real I/O on a cold instance never resolves — and three separate `catch {}` swallow the loss. The
`void import()` shape is pre-existing, but **this diff took the number of dependent sites from 83 to
115 and made it the sole reporting mechanism for the seam** (41 captures across 15 of 15 routes).
Asymmetry that makes it easy to miss: `instrumentation.ts:38 onRequestError` **is** awaited by the
framework — and the 15 seam routes are exactly the ones that catch their own errors and therefore
rely on the un-awaited path.

**Remedy.** Make `captureToSentry` return the promise, `await`/`after()` it at the route arms, add
`withSentryConfig`. **Mechanism row: chokepoint (100%) — one leaf change covers all 41.**
**Sequencing: this must land BEFORE or WITH C-5.**

---

#### H-8 — four sites assert an EXCHANGE fault for a fault on our own hop — and the branch that was written for the common case cannot match the string it was written for
`ConnectKeyStep.tsx:411`, `SubmitStep.tsx:249`, `SyncPreviewStep.tsx:649` (all
`catch { setErrorCode("KEY_NETWORK_TIMEOUT") }`), plus the server twin at `wizardErrors.ts:1485-1488`;
copy at `wizardErrors.ts:476-486`. **CONFIRMED.** **REPL 4** (`SF H8`, `OUT` scenario 1, `RFL B-02`,
`TST §2`).

`wizardErrors.ts:196-200` states the rule being broken, **by name**: *"KEY_NETWORK_TIMEOUT — we could
not reach the EXCHANGE. Reusing it here would assert a venue fault for a fault on our own hop, which
is exactly the 'copy that asserts something false' class this phase exists to kill."*
`SERVICE_UNREACHABLE` was minted for this and is used at the finalize *body* path and at **none** of
the three transport catches. At `SubmitStep` no exchange call is even in the picture for most failures.

**`RFL B-02` adds a MEASURED fact that changes the fix and must not be lost.**
`analytics-client.ts:54` produces `"Analytics service timed out after 15000ms on …"`, and
`wizardErrors.ts:1485` tests `lower.includes("timeout")`. `"timed out"` **does not contain**
`"timeout"` — measured. **The `KEY_NETWORK_TIMEOUT` branch cannot match the error it was written
for**, so the *common* Railway degradation still renders `UNKNOWN`/500. And `wizardErrors.test.ts:611`
pins `"connect ETIMEDOUT 10.0.0.1:443"`, a string the register **proved** cannot reach the classifier
— so the suite reads as covering a dead arm.

**Remedy.** `SERVICE_UNREACHABLE` at the three catches; fix the substring; re-point the test at a
string that actually reaches the classifier. **Mechanism row: per-site.**

---

#### H-9 — one `mt5-gateway` breaker trip denies key-connect on **every** venue: the exact A-01 harm the per-dependency split was written to remove, half-removed
`resilient-fetch.ts:392-402` (the `validate-key` row — I re-read it: `dependencies: ["mt5-gateway"]`),
`:804-806` (`breakerKeysFor`), `:1005-1017` (`isBreakerOpen` returns on the **first** live lock);
`exchange.py:331-350`. **CONFIRMED** at every step; arrival rate INFERRED. **REPL 1** (`OUT O1`).

Every call spending the `validate-key` budget short-circuits, and that budget is the **first**
upstream call of `create-with-key`, `keys/validate-and-encrypt` and `composite/add-key`. Binance /
Deribit / OKX / Bybit / sFOX users get *"Our service is temporarily unavailable"* — true, and also a
total key-connect outage caused by a dependency they can never reach. **Duty cycle, not a blip:**
while the lock is live MT5 requests are short-circuited so they cannot re-trip it; after 30 s it
closes, MT5 traffic returns, and 5 more failures re-arm it.

> ⚠️ **This directly qualifies a claimed closure.** `RFL A-01` is marked **CLOSED** with the receipt
> *"an `mt5-gateway` trip cannot block `/api/simulator`"* — which is **true**. It does not prove the
> trip cannot block `/api/validate-key` for non-MT5 venues, because containment is keyed on the
> BUDGET ROW and the row is per-**endpoint**: `/api/validate-key` serves all venues and only its MT5
> arm can raise the 503. Both registers are right. The docblock's own tie-break ("when in doubt,
> declare fewer") points at this row and was not applied to it. **REPL 1 does not mean weak here —
> it means only one register asked the question.**

**Remedy.** Split `validate-key` / `validate-key-mt5` budget rows — one union member, no
cross-language change. **Mechanism row: shared artefact (the budget table).**

---

#### H-10 — the publish gate destroys the machine `code`, the `dependency` and the `Retry-After`, then answers one sentence that asserts two things it cannot know
`finalize-wizard/route.ts:167-192` (`fetchLivePermissions:190-192` stringifies the status into a
message), `:507-521` (one generic 502 `KEY_NETWORK_TIMEOUT` for all of them);
producers at `internal.py:246, 300, 316, 330, 471, 495`. **CONFIRMED.** **REPL 2** (`OUT O4`, `RFL B-04`).

Collapsed: a `429 RATE_LIMITED` (our own per-key probe throttle, which said *for how long*), a
`500 KEK_UNAVAILABLE` (our encryption key is unset, needs an operator), and a genuine
`424 EXCHANGE_PROBE_FAILED` all render as *"We could not reach the exchange. The validation request
did not complete in time."* Two of three assert a completed-response-that-never-came about a service
that **did** answer, and one blames the user's exchange for our unset KEK. `RFL B-04` adds that
`Error("INTERNAL_API_TOKEN is not configured")`, thrown at `route.ts:172`, lands on the same arm —
and the honest code for it (`SEAM_MISCONFIGURED`) exists and is emitted at exactly **one**
production site.

**140.3-09/TS-34 fixed exactly this on the OTHER consumer of the SAME upstream endpoint.**
`keys/[id]/permissions/route.ts:126-165` now carries `{status, code, retryAfterSeconds}` on
`Error.cause` and answers a throttle as `429 PROBE_RATE_LIMITED` with the upstream's own header
forwarded. Its docblock calls the old behaviour *"a one-minute throttle read to the user as an
indefinite fault on OUR side"* — a verbatim description of what `finalize-wizard` still does, at the
publish gate, on the same probe. The mechanism (`buildSeamFailureCause` / `readSeamFailureCause`) is
already written and route-local.

**Failing CLOSED is correct and must not change; only the envelope is wrong.**

---

#### H-11 — four guards in this range are silently deletable with green CI, the meta-guard permits deleting 24 of its own 44 rows, and `describe.skip` is an unguarded total bypass
**CONFIRMED** by measured greps; I re-verified the registry floor: `toBeGreaterThanOrEqual(20)` at
`contracts-registry.test.ts:185` against `grep -c '{ path:'` → **44**. **REPL 1 register (`GRD`), 5
independent measurements.**

- **F-15 is the worst.** `src/lib/sentry-capture.test.ts` is unregistered and is the **only** artifact
  asserting SEAMCORE-06's "fold the scrub into the chokepoint" clause. Removing the four scrub calls
  reddens that file **and nothing else in the repo** — so deleting the test file and the scrub calls
  in one commit leaves CI green, and **the path it gates is third-party egress, not a log line.** The
  one plausible indirect catch does not fire: `gdpr-export-coverage-hook.test.ts:60-70` *discovers*
  the deps from source, so dropping the import just yields a shorter list.
- **F-3** `seam-copy.purity.test.ts` unregistered; both its siblings are. It protects
  `seam-copy.ts`'s purity, and that module is rendered by the **unauthenticated** teaser — an import
  added there ships `@upstash/redis` and a `Redis.fromEnv()` module-load side effect to every
  anonymous visitor's bundle.
- **F-10** `tests/redis/seam-breaker.redis.test.ts` and `tests/lib/validate-key-venue-transient-parity.test.ts`
  unregistered. The latter is the only artifact binding the TS wizard verdicts to the committed
  venue-transient bytes; its provenance assertion lives *inside* the deletable file.
- **F-5** the anti-shrink bound is 20 against 44, and `existsSync` is the whole check — a registered
  guard can be `describe.skip`-ped, have its roster emptied, or become `it("todo", () => {})`.
- **F-9** no repo-wide skip gate. For the redis lane this is **total**: wrapping the describe leaves
  one file matching both globs, the empty-corpus preflight still counts 1, vitest reports 7 skipped /
  0 failed and exits 0, `beforeAll`/`afterAll` never run — and there is **no second execution path**
  (deliberately, and correctly, since ~6 main-suite files delete the Upstash env).

**Remedy.** Four registry rows; floor `>= 44`; **widen `ci.yml:1633`'s existing Playwright-scoped
`describe.only|skip` regex to `src/**` + `tests/**`** — one gate closes F-5.2 and F-9 together.
**Mechanism row: the registry itself is the shared artefact — make it derive or pin exactly.**

---

#### H-12 — a dynamic `import()` escapes **all four needles in all three leaf-purity guards**, and this repo's own code proves it is the idiom
`seam-errors.purity.test.ts:56-62`, `seam-discriminator.purity.test.ts:57-63`,
`seam-copy.purity.test.ts:55-61`, `seam-redaction.test.ts:514-520` (byte-identical pattern sets).
**CONFIRMED** by `GRD F-14` against crafted sources. **REPL 1.**

```
ESCAPES  const { Redis } = await import("@upstash/redis");   ← DYNAMIC IMPORT
ESCAPES  import{Redis}from"@upstash/redis";                  ← no space after `import`
ESCAPES  const PAT = "/*"; import …; const END = "*/";       ← `/*` in a string swallows it
```
`/^\s*import\s/m` requires whitespace; `/\brequire\s*\(/` does not match `import(`. And
`sentry-capture.ts:144` already spells `void import("@sentry/nextjs")` **precisely to keep it out of
a bundle** — the same rationale these leaves cite. Prettier is not installed and is not a CI gate, so
formatting does not block the no-space escape. **Refuted and worth recording:** nested block
comments and regex literals are NOT defeats — those were probed and caught.

**Remedy.** Add `/\bimport\s*\(/`; relax `/^\s*import\s/m` → `/^\s*import[\s{"']/m`. Four files, one
line each. **Mechanism row: shared artefact (the pattern set is the artefact) — but it is copy-pasted
four times, so extract it.**

---

#### H-13 — nothing binds `SEAM_ROUTE_BUDGETS`'s 15 rows to the routes that actually make a seam call; both sides are hand-typed
`seam-budgets.invariant.test.ts:443-464` — `ROUTE_ENTRIES.length).toBe(15)` (table vs a literal) and
`toEqual(EXPECTED_ROUTE_BUDGETS)` (table vs a hand-typed twin). **No assertion in the file measures
the population.** **CONFIRMED as a durability gap.** **REPL 2, with a direct counter-measurement**:
`CVI CLOSED-1` measured the roster **complete at HEAD — 20 of 20** seam-reaching files under
`src/app/api` appear in the table or the exclusion list. So this is durability, not a current hole,
and 140.4 should record it that way.

**The uncovered shape is the middle tier: a new consumer of an existing seam wrapper.** A route
calling `computePortfolioAnalytics()` makes a real, budgeted, breaker-feeding, credential-bearing
seam call while matching *neither* of the two needles every guard in the range derives from
(`/resilientFetch\s*\(/` and the ESLint `ANALYTICS_SERVICE_URL` taint). It gets no budget row (no
`maxDuration` check, no headroom arithmetic), no `SEAM_FILES` membership, no lint error, no wiring
failure, no SSR-exposure failure. Today all 9 wrapper consumers and all 5 `postProcessKey` callers
happen to be inside the table — **coincidence maintained by discipline, not by any assertion**, which
is the same shape as the defect this whole programme started from.

**Remedy.** Reuse the working `deriveSeamRoutePaths` that already exists in
`seam-poll-disjointness.pin.test.ts:202-221` and the runtime pin `:111-130`; set-compare against
`Object.keys(SEAM_ROUTE_BUDGETS)`. **Mechanism row: shared artefact (100%).** This one edit converts
H-13 from unguarded to closed **and gives H-1's roster a derivable superset** — it is the single
highest-leverage change identified across all fourteen registers.

---

### MEDIUM

- **M-1 — the TRAP-3 destructure survives at three in-scope seam routes and renders as a negative
  verdict about the allocator's own book.** `bridge/route.ts:114-126` and `simulator/route.ts:144-156`
  (`const { data: portfolio } =` → 404 *"Portfolio not found"*); `portfolio-optimizer/route.ts:139-144`
  via `queries.ts:1268-1280` (a transport error → `false` → **403 "Forbidden" to the portfolio's
  actual owner**). Both routes are in `SEAM_ROUTE_BUDGETS` and both received `CIRCUIT_OPEN` arms in
  this phase — the plan had the files open. CONFIRMED. REPL 3 (`SF M1`, `TRP §2(b)`, `CVI RIM-2`).
  Remedy → WP-2.

- **M-2 — "a failure must not read as an absence" was closed on the client (84/88 observed) and the
  defect moved one layer down: 32 Supabase reads never destructure `error` at all; 21 fail open or
  fabricate an empty 200.** CONFIRMED by enumeration (`CVI RIM-2`). Worst members, in order:
  `alerts/ack/route.ts:84` — the **replay/idempotency gate**: DB fault → `used = null` → guard
  skipped → **a consumed ack token is honoured again** (and the very next query at `:93` *does*
  destructure `error`); `cron/flag-monitor/route.ts:160` — `totalCount ?? 0` → a **fabricated**
  zero-denominator escalation to the founder; `keys/sync:340,347` — venue silently stays `"okx"` so
  a Bybit/Deribit/MT5 key syncs against the wrong venue (also `SF H6`, `TRP §2(a)`; aggravator: the
  TRAP-3-hardened read 180 lines earlier **already selected `api_key_id`**, so `:340` is a redundant
  re-SELECT that reintroduces the pattern the file's own comment says was fixed);
  `portfolio-alerts:57,101` + `alerts/critical:43` — *"you have no alerts"* at HTTP 200 when the DB
  failed; `account/deletion-request:81` — duplicate deletion request + duplicate founder email;
  `finalize-wizard:1473` — a bare `upsert({computation_status:"failed"})` before a `throw`, so a
  strategy is stranded in `pending` forever. Also 3 client members: `MatchQueueIndex.tsx:147, :217`
  (the match-engine **kill switch** — a 403/500 makes the pill snap back and the founder believes the
  engine is OFF when it is ON) and `StrategyActions.tsx:41`. REPL 3.
  **Mechanism row: per-site = 0/32 measured. Do not attempt this without WP-2's helper.**

- **M-3 — a wait is representable end to end at 1 of 8 envelope-minting sites, 0 of 57
  `Retry-After`-emitting routes, and `postProcessKey` throws the header away for all five callers.**
  `TST §3` MEASURED it: driving the real `main.py:516-530` 429 shape through `postProcessKey` gives
  `Retry-After header >>> null`, body `retry_after_seconds >>> 47` **which nothing under `src/`
  reads**. `CVI RIM-3` measured the layers: 8 `buildEnvelope` sites, 1 threads a wait; 57 routes emit
  the header, **zero** browser call sites read it. CONFIRMED. **REPL 5** (`CVI RIM-3`, `OUT O7`,
  `TST §3`, `SF M5b(a)`, `RFL B-11`; + `Q-SF F8`). Consequence: an analytics-side throttle renders as
  a throttle state with **no countdown and an enabled Retry**, which immediately re-429s.
  Remedy: forward the header at `process-key-client.ts:643-648` (**chokepoint, 100% row**), then
  thread `retryAfterSeconds` at the 5 silent minting sites.

- **M-4 — async error announcement: 100% of components routing through `ErrorEnvelope` announce; 0%
  of the six that hand-roll their own error `<p>` do — and two of the six are regressions introduced
  in-range.** `CVI RIM-5` calls this *"the cleanest evidence in this audit"* for the coverage law.
  **RG-1:** `PortfolioOptimizer` lost all three `role="alert"` nodes (`git diff | grep 'role="alert"'`
  → **three deletions, zero additions**, whole diff) and the announcement was the **only** channel —
  the button unmounts on click (`:258`) and focus falls to `<body>`, so a screen-reader user now gets
  silence. `DESIGN.md:317` and `:369` are normative. **RG-3:** `AllocatorMatchQueue` went from a modal
  `alert()` (always announced, steals focus) to a silent inline card with **0** live regions
  file-wide, on an action bound to the `r` keyboard shortcut. CONFIRMED. **REPL 4** (`REG RG-1/RG-3`,
  `REV #3`, `CVI RIM-5`; + `Q-review I-3`). Remedy: two `role="alert"` lines as the stop-gap; **the
  class fix is one more consumer of `ErrorEnvelope` (100% row)**.

- **M-5 — `keys/sync`'s deliberate "a 2xx is not evidence a job was enqueued" signal is honoured by
  one of its three consumers, and the wizard resets the full 15-minute patience clock on a 2xx that
  provably did nothing.** `keys/sync/route.ts:613-621` (deliberately not stamped `ok:true`);
  `ApiKeyManager.tsx:93-110` honours it; `SyncPreviewStep.tsx:637-648` and `:1236-1244` do not.
  `handleRetrySync`'s own docblock states the partial-unique index makes an inflight job a **no-op** —
  and a no-op returns 2xx — so Retry drops the amber banner, overwrites server truth
  (`stalled: false`), resets elapsed to 0, and the user waits another full 15 minutes, indefinitely.
  Its `else` branch is **empty**: a 429 or breaker 503 on the retry POST produces **zero user-visible
  signal**. CONFIRMED. REPL 3 (`SF M4`+`M5c`, `RFL B-15`; + `Q-review I-1`).

- **M-6 — `/api/keys/sync` silently moved the resumed-wedge duplicate from `202 + status:"syncing"`
  to `200 + status:<whatever the old row holds>` + `idempotent:true`.** The `queued === false` removal
  was correct and well argued; re-pointing the branch also moved the case between two response
  envelopes, and the 40-line comment discusses only `queued`. Blast radius today low — both consumers
  are status-agnostic — but the **contract** broke with no SUMMARY, comment or test naming it, and a
  documented `202 Accepted` for a still-enqueued job now answers `200 OK` with a *terminal-looking*
  status. CONFIRMED. REPL 1 (`REG RG-4`).

- **M-7 — TS-13's widened guard left the log asserting the wrong cause and moved a raw upstream body
  onto a common path into the browser.** `csv-finalize/route.ts:1227-1247`. The guard went
  `!isUuid(strategy_id)` → `ok !== true || !isUuid(...)`; the arm's body did not change, so an
  ordinary semantic rejection now logs *"missing/invalid strategy_id in upstream body"* (the log
  lying about which branch fired — the same class 140.3-11 fixed at `seam-discriminator.ts:398-405`)
  and returns `debug_context: { unified_response_body: unifiedBody }` — the raw body — to the browser.
  `verify-strategy/route.ts:335-336`, forty lines from a near-identical arm, explicitly refuses this:
  *"Diagnostics only — never the body, which carries `encrypted_credentials`."* **Not claiming a live
  credential disclosure** — the CSV finalize context is `wizard_session_id / fmt / strategy_name /
  user_id / step`. CONFIRMED as stated. REPL 3 (`SF H5`, `REG §3.6`, `TRP §3`).

- **M-8 — `csv-finalize`'s config-fault arm is the one member of its class with no capture, and it
  guards the persist step.** `csv-finalize/route.ts:1134-1146` vs the byte-identical
  `csv-validate/route.ts:210-231`, which captures at `level: "fatal"` with the rationale written out
  (*"a misconfigured deployment takes the whole CSV upload path down for every user, it can never
  self-heal, and nothing else reports it"*). 140.3-13b touched `csv-validate` and not this arm. If
  `INTERNAL_API_TOKEN` is rotated on Railway and not Vercel, the alert exists but points at
  *validate* while the step that actually creates the strategy row is dark. CONFIRMED. REPL 1.

- **M-9 — `vi.doMock` leaks forward in two route test files and the negative-only oracles beside them
  go vacuous.** `create-with-key/route.test.ts` — 6 `doMock`, **0** `doUnmock`;
  `verify-strategy/route.test.ts` — 17 / 2. **VERIFIED by insertion and by shuffle**: a probe inserted
  where a maintainer would naturally add a sibling observed `expected 401 to be 999`, and a companion
  probe asserting only `expect(validateKeyMock).not.toHaveBeenCalled()` **passed** because the route
  answered 401 and the handler never ran — the incident shape verbatim. Shuffling the file alone gave
  `Tests 10 failed | 53 passed`. Two shipped cases in `verify-strategy` already run on inherited
  state. The files survive on two unenforced accidents. **Structural cause, and it is `RFL D-05`:**
  `src/test-setup.ts:47` is the only global `afterEach` and calls `cleanup()` only — no
  `vi.unstubAllGlobals()`, no `process.env` snapshot/restore. That is this repo's **known CI-only
  failure class** (Node 22 vs 25). CONFIRMED. REPL 2 (`TST §10`, `RFL D-05`). Remedy: add both to
  `test-setup.ts` — **shared artefact, closes the class permanently.**

- **M-10 — the redaction leaf's plain-object fallback dumps the whole object, which is exactly what a
  request body looks like, and the whitelist's stated reason is protected only incidentally.**
  `seam-redaction.ts:174-182` (the rationale) vs `:420` (`JSON.stringify(err)`). `TST §4` PROBED it:
  output `{"api_key":"…","api_secret":"…","passphrase":"hunter2","exchange":"okx"}` verbatim. The
  single test of that branch uses `{ status: 503, upstream: "railway" }` and is the **one one-sided
  case in an otherwise rigorously two-sided file**, one-sided in precisely the direction the header
  forbids. **Mutation M10 is the sharpest evidence:** deleting the whitelist entirely reddened the
  full suite by **exactly one test — the 500-character length bound**, not a credential case. A real
  `{api_key, api_secret, passphrase, exchange}` object is ~130 characters, comfortably under the
  bound, so deleting the whitelist ships green against that payload. CONFIRMED. REPL 3
  (`TST §4`, `REV #4`; + `Q-SF F12`).

- **M-11 — `captureToSentry`'s `secrets:` argument has no roster guard, and Sentry is a third party.**
  108 production call sites; `secrets:` passed at **13**, in four files. The mechanism the phase built
  for the equivalent `console.*` risk — a roster **plus** an HI-02 completeness assertion that
  discovers new credential-bearing routes from disk — has **no Sentry counterpart**
  (`grep captureToSentry src/lib/seam-log-coverage.test.ts` → nothing). So the exact defect HI-02 was
  filed for is closed for `console.error` and open for the sink that leaves our infrastructure.
  `GRD F-16` adds: ~14 sites call Sentry directly, bypassing the chokepoint (**none on a seam file** —
  so this is a claim-overstatement, not a seam gap); 8 credential env vars in `src/` are off
  `SEAM_SECRET_ENV_NAMES`; and `env-manifest.test.ts:83` **already regex-discovers every
  `process.env.X` read in `src/`** and nothing links it to the redaction roster. CONFIRMED. REPL 2.

- **M-12 — `scenario/optimize` flattens every upstream status to a flat 502, and TS-04 in this diff
  made the collapsed 429 far easier to hit.** `route.ts:196-233`: a 429, a 422 and a 500 all become
  the same 502, same sentence, no `Retry-After`, no code. Every sibling forwards 4xx
  (`bridge:173-182`, `simulator:201-206`, `admin/match/eval:210-228`, `admin/match/recompute:165-183`,
  `keys/validate-and-encrypt:319-325`). Why now: `/api/optimize-weights` carries a 20/minute Python
  limiter, and **TS-04 in this diff moved it from a platform bucket to a per-tenant one** — so the
  caller who exhausts it changed from "two concurrent allocators" to "one allocator clicking through
  Scenario Composer". The route's own comment records that the range split was deliberately deferred;
  the tenant-claim flip is what makes the deferral bite. CONFIRMED. REPL 1.

- **M-13 — five type-design defects where the invariant is enforced at a reader and dropped at the
  carrier.** All CONFIRMED at source; each replicated by the quarantined types register.
  **F1** `LivePermissionsSchema.probe_error: z.boolean().optional()` — remove the key from the Python
  fail-closed arm and the body still parses, `undefined` is falsy at the gate, `trade`/`withdraw` are
  both false, and **a key whose live scopes were never probed publishes as read-only-verified**. The
  sibling `detected_at` sixteen lines below is REQUIRED on *identical* provenance (all six arms set
  it). **Latent, not live** — no producer omits it today; the orchestrator settled that the
  regressions register's "preserved across all six Python arms" and this finding are **both true and
  compatible**, not a conflict. One-line fix.
  **F3** `AnalyticsUpstreamError(message, status, seamCode, dependency)` — positions 3 and 4 adjacent,
  identically typed `string | null`, both defaulted; transposing them at
  `analytics-client.ts:465-470` makes a venue slug the `seamCode` (→ UNKNOWN everywhere) and a machine
  code the `dependency`, **which 140.3-11 renders to an admin as the name of the third party that
  failed** — the exact attribution lie TS-18 exists to make impossible. The invariant is validated at
  the reader (`seamDependencyName`'s slug regex) and dropped at the carrier.
  **F4** `SeamBreakerVerdict`'s biconditional (`breakerKey` non-null exactly when `counts`) is a
  **sentence**; all three consumers re-derive it with `&& breakerKey !== null`. A future arm returning
  `counts: true, breakerKey: null` type-checks, all three guards evaluate false, **nothing is
  recorded and no error is raised** — a breaker that silently never trips, in the fail-open direction,
  invisible because the null tests read as defensive hygiene.
  **F5** `mintTenantClaim(payload: string, secret: string)` — two adjacent same-typed strings, one of
  them the platform secret. **`TenantIdentity` exists at `tenant-claim.ts:88` for exactly this threat
  and is NOT applied to this function** (orchestrator-settled fact #1). `mintTenantClaim(process.env.INTERNAL_API_TOKEN ?? "", options.tenantId)`
  compiles, passes all three guards, and puts `<INTERNAL_API_TOKEN>.<exp>.<mac>` into an outbound
  header. **Record at latent-type-design-hazard severity, NOT as a live attacker path** — `ATK R9`'s
  refutation is factually wrong (see §4) but its *conclusion* about today's two call sites holds:
  both pass server-derived values, and two tests pin them. The tests are the wrong layer.
  **F2c** the `WireErrorCode` union — the durable fix for H-2, `TYP F2a`/`F2b` and `CVI RIM-0`. Six
  wire codes have a translation against **~50–90** distinct emitted codes, and `csv_adapter.py:172`
  mints `error_code=first_rule.upper()` from a pandera rule name — **an open string set with no
  registry.** `CsvSubmitStep`'s `ValidationEnvelope.code: string` stores the wire value verbatim into
  `data-error-code` and ships it to PostHog with no membership check at all.

- **M-14 — the 424 venue-attribution feature is tested on the two endpoints that cannot emit 424 and
  absent on the one that does.** `match.py:58` imports only `RETRY_AFTER_SECONDS, service_error` and
  its five statuses are `503, 503, 500, 400, 500` — **no 424 site** — yet four seam-test cases at
  `admin/match/recompute` and `eval` supply `dependency:"binance"`/`"bybit"`, and `venueOutageCopy.ts`
  plus both consumers render a named venue that can never arrive. Meanwhile
  `internal.py:495-501` **does** emit `424 EXCHANGE_PROBE_FAILED` with a venue slug, and its TS
  consumer has **no 424 arm**: `keys/[id]/permissions:470` handles 429 and lets everything else fall
  into the substring cascade → `PROBE_FAILED`/502. Nothing reddens in either direction. CONFIRMED.
  REPL 3 (`TST §7`, `OUT` confirms, `FCP`).

- **M-15 — the test doubles model bodies the boundary provably cannot emit, so the fixes they certify
  are unreachable in production.** Seven instances in `FCP`, two independently confirmed by `TST §8`
  and `§9`. Highest: **all six 429 fixtures at `keys/[id]/permissions` use the wrong one of the two
  429 shapes** (flat D; the real one is nested A, because `internal.py:184` has no slowapi decorator).
  TS-34 exists *specifically* for that throttle and **zero tests drive it against the body it will
  actually receive**; narrowing to a top-level `body.code` read — the obvious "simplification" — keeps
  all six green while the real per-key throttle regresses to `PROBE_FAILED`/502. Also:
  `PortfolioImpactPanel`'s CONTRACT A/B doubles feed nested envelopes into a component that fetches a
  Next route returning `{error: string}` on every path, so `seamErrorCode(raw)`/`seamHumanMessage(raw)`
  — the TS-05 "Class-5 site 3" fix — **can only ever return `null` in production** and is certified
  working by a fabricated body; a body `_validate` **refuses to construct** (500 + `retryable:true`,
  code `SEAM_DEGRADED`, which appears in zero Python files) is the canonical CONTRACT-A fixture in
  **three separate suites**; `analytics-client.test.ts:1839/1866` still build at the pre-remap **400**
  under a comment saying the remap lands "in the next wave" — it landed in this range;
  `/process-key` answers **200**, not 202, encoded in three doubles and one source comment.
  **PROVENANCE NOTE:** `FCP` and `TCC` were produced by child agents of the invalidated run and label
  themselves CORROBORATION-PENDING; their subjects are disjoint from the three files that carried
  stray MUTANT markers, and the orchestrator independently re-verified `TCC` findings 1 and 6. Treat
  `FCP`'s five unconfirmed items as **PLAUSIBLE** pending a check.

### LOW — bundle, no individual planning needed

`SF L1–L7` (VALIDATION_UNEXPECTED as venue fault; sFOX `status == 0` folding our egress-proxy and
parse failures into 424; two routes with a bare `await req.json()` whose rejection becomes a
framework 500 with no body, no `code`, no `NO_STORE_HEADERS` while every peer guards it;
`scrubValue`'s depth cap returning deep values **unscrubbed**, contradicting the fail-safe policy 25
lines below; a failed draft DELETE invisible to the user, and one entry point leaving **two** live
drafts; `MatchEvalDashboard` missing the in-flight generation guard its sibling has; `ApiKeyManager`
claiming the B-27 discipline it does not implement and asserting *"Your existing keys are safe"* from
a read that just failed; the SEAM-01 lint allowlist described as "a CLOSED set … FOUR paths" while
two of the four are open-ended `**` globs; `correlation_id` caller-supplied and echoed into a Sentry
tag and structlog records with **zero** Python-side validation, the whole bound living in one TS
consumer; two `except Exception: pass` in `main.py`) · `SF P1` (`fetch_trades` still answers 503 on a
missing KEK — a permanent operator-only fault that trips the **GLOBAL** breaker key and denies every
unrelated tenant; the sibling was moved off 503 for exactly this reason — **severity HIGH if hit**,
pre-existing and untouched) · `SF P2` · `OUT O8` (`DRAFT_ALREADY_EXISTS` names two controls nothing
renders) · `REG N-2` (ungrammatical shipped copy at `wizardErrors.ts:581`) · `REG RG-5` ·
`GRD F-6/F-7/F-11/F-12/F-13/F-17` (unpinned rosters: `EXPECTED_TIMEOUT_MS` and
`EXPECTED_DEPENDENCIES` have no size pin; `seam-copy.pin` pins a consumer **count** not a **set**, so
a simultaneous drop-and-add nets 10; `VENUE_WIRE_CODE_TO_VERDICT` is a 6-entry production allow-list
with **no size or set assertion anywhere in the repo**; `EXPECTED_CASES = 7` is self-referential —
both sides live in the file; `FIXTURE.cases.length >= 4` is a **floor**, and the one case proving the
secret is an input rather than a constant can be replaced by a duplicate and stay green; the
registry's `invariant` prose is free text nothing machine-checks and **three rows are already stale
in this range**) · `TRP §10` (TRAP-10 violated in letter, premise dead) · `TST §6`, `§11`.

---

## 3. Work packages for 140.4, grouped by remedy mechanism

The **coverage law** measured across everything since Phase 140 is the organising principle:

| mechanism | measured coverage | plan accordingly |
|---|---|---|
| forced through a shared artefact (chokepoint / leaf / table / component) | **100 %** | prefer always |
| hand-typed roster or allow-list | 9/37 codes · 8/15 files · 2/3 codes | **partial by construction — say so in the plan** |
| per-site edit, no artefact | 1/8 · 2/56 · **0/32** | only for a bounded, enumerated set |

**Coverage follows from the mechanism, not the effort.** Every package below is labelled with its row.

---

**WP-1 · DERIVE THE SEAM ROSTER** — *shared artefact, 100 %* — **highest leverage in the document**
Derive `SEAM_FILES` from `SEAM_ROUTE_BUDGETS ∪ SEAM_EXCLUSIONS` + the two lib clients; add the
disk-derived set-compare to `seam-budgets.invariant.test.ts` reusing the existing
`deriveSeamRoutePaths`; extend `CREDENTIAL_BEARING_CALLS` with `postProcessKey(` and
`resilientFetch(`; add the missing `toHaveLength` pin.
**Closes:** H-1 (durability half), H-13, `GRD F-1`/`F-2`, `SF M5`, `RFL A-10`, `TRP §3` mechanism.
**A new seam route then reddens the log guard on the day it is written.** The docblock currently
argues *against* deriving it; the measurement says the alternative already produced a 7-file hole and
`CVI CLOSED-1` proves the budget table is the right source. **Surface that conflict in the plan.**
Copy `resilient-fetch.wiring.test.ts`, do not invent.

**WP-2 · ONE CHECKED READ** — *shared artefact, 100 % (per-site = 0/32 without it)*
A `readOne`/`readCount` helper that throws on `.error`. Apply at the six `SyncPreviewStep` reads
first, then the six worst `RIM-2` members.
**Closes:** C-3, M-1, M-2, `SF H6`, `TRP §2`. **Do not attempt M-2 as 32 per-site edits.**

**WP-3 · THE WAIT TRAVELS** — *shared artefact, 100 %*
Forward `Retry-After` at `process-key-client.ts:643-648` (the chokepoint all five callers pass
through), then thread `retryAfterSeconds` at the five silent `buildEnvelope` sites.
**Closes:** M-3, `OUT O7`, `TST §3`, `RFL B-11`, `SF M5b(a)`.

**WP-4 · ANNOUNCE THROUGH ONE COMPONENT** — *shared artefact, 100 %*
`role="alert"` on `PortfolioOptimizer.tsx:283` and `AllocatorMatchQueue.tsx:405` as the immediate
stop-gap; then route the six hand-rolled error surfaces through `ErrorEnvelope`.
**Closes:** M-4, RG-1, RG-3, `CVI RIM-5`, `REV #3`. Add a `role="alert"` render assertion — no test
in the repo asserts one today (`grep -rln 'role="alert"' tests/ src/__tests__/ e2e/` → one unrelated file).

**WP-5 · CAPTURE DELIVERS, THEN ALERT ON THE BREAKER** — *chokepoint, 100 %* — **ordering is load-bearing**
(1) `captureToSentry` returns its promise; `await`/`after()` at the route arms; add
`withSentryConfig` to `next.config.ts`. (2) *Then* route `emitBreakerTransition` and both store
catches through it. **Closes:** H-7, C-5 breaker half, `RFL A-11`. Doing (2) first builds an alert
on sand.

**WP-6 · ONE ERROR-BODY CONSTRUCTOR** — *per-site today (1/8); promote to shared artefact*
Static 502 messages + `scrubSeamError` at `csv-validate:273-274`; scrub the thrown twin at
`analytics-client.ts:535`; allowlisted `debug_context` + honest branch labels at
`csv-finalize:1227-1247`. **Closes:** C-1, M-7, `CVI RIM-1(a)(c)`, `REV #2`, `ATK A1`, `TRP §3`.
**Carries the TRAP-9 assertion-swap from C-1.**

**WP-7 · THE DESTRUCTIVE CONTROL MUST BE EARNED** — *invert a roster (2/3) into a property (100 %)*
Invert `DESTRUCTIVE_CONTROL_IS_WRONG_FOR`; split `recoverable` from "a kickoff retry will help";
route the delete through the confirm dialog `handleStartFresh` already uses; add
`recogniseSeamErrorCode` at `SyncPreviewStep:601`; add `VALIDATION_FAILED` + `RATE_LIMITED` to
`KNOWN_FINALIZE_CODES` and read `seamErrorCode(data)` at `SubmitStep:119`.
**Closes:** C-4, H-2 (a)(b), H-3, `TRP §1`, `CVI RIM-0`/`RIM-4`, `OUT O3`, `RFL B-01`.
**The code-set half stays a hand-typed roster — a partial fix by construction — until WP-11.**
Founder browser check is a **precondition for closing**, not a follow-up (§7).

**WP-8 · THE CSV DOUBLE-SUBMIT CONSTRAINT** — *shared artefact (a DB constraint), 100 %*
Enumerate the **writers**. **Must land before this branch merges to main.** Reconcile
`wizardErrors.ts:882`'s copy in the same commit.

**WP-9 · 424 MEANS THE CALLER'S VENUE AND NOTHING ELSE** — *constructor guard = 100 %; re-homing = per-site*
Add the retryability guard to `VenueTransientHTTPException.__init__`; re-home the two MT5 arms to the
existing 503; split the venue subset out of the `error_code` pass-through. **Closes:** H-4.
**Move `validate_key_venue_transient_contract.json` and both readers in the same commit.**

**WP-10 · COPY THAT CANNOT LIE ABOUT WHOSE FAULT IT IS** — *per-site, enumerated*
`SERVICE_UNREACHABLE` at the three transport catches; fix the `"timed out"`/`"timeout"` dead branch
and re-point its test; `isRateLimitMisconfigured` at the 11 routes; carry
`{status, code, retryAfterSeconds}` out of `fetchLivePermissions`; narrow the `refused` bucket; add
`PERMISSION_DENIED` and the scope codes to `VENUE_WIRE_CODE_TO_VERDICT`; stop feeding a raw non-JSON
body into the substring cascade. **Closes:** H-6, H-8, H-10, C-5's limiter half, `OUT O2/O4/O5`,
`REG RG-2`, `REV #1`, `RFL B-02`/`B-04`.

**WP-11 · `WireErrorCode`** — *shared artefact (a type), 100 %*
A wire-code union in a dependency-free leaf; route handlers emit `code: WireErrorCode`;
`SEAM_CODE_TO_WIZARD_CODE` becomes `ReadonlyMap<WireErrorCode, WizardErrorCode>`. An untranslated
wire code becomes a **compile** error at the table. Retires `TYP F2a`/`F2b`, the
`candidate as WizardErrorCode` cast, and the hand-typed half of WP-7. **Plan properly; do not squeeze in.**

**WP-12 · GUARD INTEGRITY** — *shared artefact*
Four `CONTRACT_GUARDS` + `REGISTRY.md` rows; floor `>= 44`; widen `ci.yml:1633`'s skip regex to
`src/**` + `tests/**`; add `/\bimport\s*\(/` and relax the import needle in the four purity pattern
sets (and **extract** the copy-pasted set); `vi.unstubAllGlobals()` + env snapshot/restore in
`src/test-setup.ts`; `vi.doUnmock` in the two leaking files.
**Closes:** H-11, H-12, M-9, `GRD F-3/F-5/F-9/F-10/F-14/F-15`, `RFL D-05`.

**WP-13 · TYPE INVARIANTS** — *shared artefact (types), 100 %*
`probe_error: z.boolean()`; options object for `AnalyticsUpstreamError` positions 3–4;
`SeamBreakerVerdict` as a two-member discriminated union (deletes three redundant null-tests and one
silent fail-open); brand `InternalApiToken` and take `TenantIdentity | "public"` at
`mintTenantClaim`. **Closes:** M-13 F1/F3/F4/F5. `ProbeParseMiss` is the in-repo template.

**WP-14 · TEST FIDELITY** — *per-site, enumerated*
The six wrong 429 shapes at `permissions`; `PortfolioImpactPanel`'s CONTRACT A/B;
the `500 + retryable:true` body across three suites; `analytics-client`'s stale 400; the 202-vs-200;
the 424 tested where it cannot arrive and absent where it can; the credential falsifier for the
redaction fallback; the `data-error-code` assertion at `SubmitStep.test.tsx:252`.
**Closes:** M-10, M-14, M-15, `TST §1/§2/§4/§7/§8/§9`, `FCP` 1–7.

**WP-15 · TRUTH PASS ON PROSE AND CITATIONS** — *per-site, but the class fix is structural*
F-1/F-2/F-16 (one now-wrong fact, three sites); F-3 "5 minutes" → 60 s; F-4/F-5 registry counts;
F-6's stale "✅ CLOSED / deferred to TS-34" note in `STATUS_CONTRACT.md`; the `exchange.py` +21
coordinate drift in three files that label the numbers **EVIDENCE**; R-1's "sixteen" in six places
(**delete the integer, do not correct it**). Restate TRAP-1/-4/-8/-10 per §6 P5.
**Class fix: prefer symbol references over line numbers in files this programme is actively editing.**

**WP-16 · ALSO HIGH, NOT SHARING A MECHANISM**
H-5 (`PortfolioOptimizer` `partial_data` + unreadable body), H-9 (split the `validate-key` budget
row), M-5, M-6, M-8, M-11, M-12, and the LOW bundle.

---

## 4. REFUTED — do not re-spend effort here

**Recorded with the killing evidence. Two registers refuted substantial lanes; preserve both.**

1. **`ATK R9`'s refutation of the `mintTenantClaim` transposition is itself REFUTED** (orchestrator,
   first-hand at HEAD). `TenantIdentity` exists at `tenant-claim.ts:88` but is **not applied to
   `mintTenantClaim(payload: string, secret: string)` at `:118`** — two adjacent same-typed strings.
   `TYP F5` is right. **But `ATK`'s narrower conclusion survives:** both live mint sites pass
   server-derived values (`process-key-client.ts:339` = `args.userId` threaded from each route's
   `withAuth` session; `analytics-client.ts:321` = `options.tenantId`), so this is a **latent
   type-design hazard, NOT a live attacker path.** Plan it at that severity (WP-13).
2. **`GRD F-8`'s TRAP-4 claim that `RATE_LIMITED` offers draft deletion as its *only* control is
   REFUTED** by `CVI RIM-4`: its `actions` are `["clear_and_retry", "request_call"]` ⇒
   `recoverable === true` ⇒ a Retry button renders alongside. The genuine sole-control member is
   **`GATE_NO_DATA_SOURCE`**. **Two further facts several registers conflate — keep them separate:**
   (a) `RATE_LIMITED`'s copy is **honest** (*"the cap is ours, not your exchange's"*) and is
   **unreachable at `SubmitStep`** because `KNOWN_FINALIZE_CODES` collapses it to `UNKNOWN` (H-2);
   (b) the code that **does** render at that surface is **`KEY_RATE_LIMIT`**, and *that* is the one
   blaming the exchange (`SF M5b(c)`, `OUT O2`). Any plan touching either must name which.
3. **`REG` also checked and cleared the `RATE_LIMITED` copy directly**: the obvious way it could
   become a lie — a **venue** throttle arriving as wire `RATE_LIMITED` — cannot happen;
   `VENUE_WIRE_CODE_TO_VERDICT` maps that to `KEY_RATE_LIMIT` and the two tables are deliberately
   kept apart. The claim holds.
4. **Eleven attacker lanes, all REFUTED with evidence** (`ATK R1–R11`): the 404-vs-403 ownership
   oracle at `keys/[id]/permissions` (RLS makes a foreign row invisible; the 403 branch is
   unreachable defence in depth); an attacker-influenced breaker key (`serviceDependencyOf`
   membership-checks a frozen closed set and logs+discards anything else; `seamBreakerVerdict` never
   calls `seamCorrelationId`); attacker-controlled `correlation_id` into DOM/clipboard/logs
   (`/^[A-Za-z0-9._:-]{1,128}$/` excludes CR/LF/NUL; React escapes; the clipboard path is
   self-referential — there is no victim); the anonymous teaser leaking upstream internals (explicit
   allowlist, `sanitizeMetricsSnapshot`); cross-tenant rate-limit burn at `keys/sync` (the user id is
   in the bucket key); the new `code` tokens re-opening the `keys/sync` existence hole (not-found and
   not-owned still reach a byte-identical 404); `debug-key-flow` (admin-gated);
   `unusableSeamResponseMessage` (502 falls past the 4xx forward band); the Sentry chokepoint being
   decorative (it genuinely rebuilds the `Error` with scrubbed `name`/`message`/`stack` and folds the
   `cause` chain in **scrubbed** rather than re-attaching it); the 400→424 remap widening what is
   forwarded (both statuses sit inside the same forward band; the strings remain curated module
   constants).
5. **The entire regression lane is largely REFUTED** (`REG §3`). ~10 apparent deletions were moves,
   widenings or consolidations (`PermissionPayload` → a *stronger* zod schema with `probe_error`
   present; ten `CIRCUIT_OPEN_COPY` copies → one byte-identical leaf; four `resilient-fetch.test.ts`
   describes → block-moved, all four alive; the `csv-finalize` guard **gained** a condition;
   `handleStartFresh` became **two-click**). All three hand-typed membership sets were checked for
   narrowing and are **complete or over-inclusive**. `no-raw-analytics-fetch`'s taint went strictly
   **wider**. `SEAM_EXCLUSIONS` unchanged. `CONTRACT_GUARDS`/`REGISTRY.md` — `grep '^-'` returns
   **zero** deleted rows. The log-coverage roster **grew**. `finalize-wizard`'s sum→MAX is correct
   (branches mutually exclusive by construction) and the modelled worst case **rose** 75 s → 150 s.
   **The one relaxed test assertion was relaxing a pin on a defect** and its replacement is strictly
   stronger (seeds an internal host, asserts the stable sentence, adds two negative assertions).
   No `tabIndex`/`onKeyDown`/`htmlFor`/`aria-*`/focus line was deleted anywhere in the range.
   Nested `<a><button>` is the established house idiom at **23** sites — Rule 11, a separate a11y
   sweep, not a regression.
6. **The ESLint rule's teeth are CONFIRMED and six suspected taint holes are REFUTED**: `String.raw`,
   `[base,"api"].join("/")`, object property `cfg.base`, `new URL(base)` then `.pathname =`,
   `new Request(...)` then `fetch(req)`, and the arrow-const helper are all **caught**. Three shapes
   are missed (default parameter, bare assignment with no initializer, `function`-declaration helper)
   and **none exists in `src/` today**. Worth a docblock note, not a code change.
7. **`GRD F-4` is REFUTED as a live defect.** `warmup-analytics.ts` *is* the fourth
   analytics-reaching module and *is* imported by a server-rendered `page.tsx` — but it is
   fire-and-forget with `.catch(() => {})` plus a synchronous try/catch, explicitly because Server
   Components abort render on unhandled rejection in Next 16. **It cannot 500 the page.** The
   compensating control is genuinely strong (`SEAM_ALLOWLIST_EXEMPT.length` `.toBe(4)`). Residual is
   a naming hole only.
8. **`GRD F-16` is REFUTED at seam scope.** The redaction roster is genuinely well built: every
   credential the six seam files read is covered, `CRON_SECRET`/`SUPABASE_SERVICE_ROLE_KEY` are
   over-coverage, and `MIN_REDACTABLE_SECRET_LENGTH = 12` is pinned **both** as a literal **and
   derived** against the shortest preserve token (9 chars) — a real derivation, not self-referential.
   Per-request secrets are handled structurally from `CREDENTIAL_HEADER_NAMES`. Only the *repo-wide*
   claim is overstated.
9. **Five class closures MEASURED and confirmed** (`CVI CLOSED-1..5`): the seam route roster is
   complete over `src/app/api/**` (**20/20**); `maxDuration` (**15/15**); the `ok` discriminator at
   every `/process-key` consumer (**5/5**); SEAMUX-08 Sentry capture on every seam route (**15/15**);
   and the Python `STATUS_CONTRACT.md` fence — falsification was **attempted** against both
   `/api/verify-strategy` and `/api/fetch-trades` and **failed**. `CVI` credits the last as *"the only
   enumeration in the range that states its own exclusions with reasons and survives an attempt to
   break them."* ⚠️ Use `grep -F` when re-checking — a plain grep treats `[id]` as a character class.
10. **TRAPs 2, 5, 6, 7, 9 RESPECTED, mechanically.** TRAP-2 by construction (500 terminates before any
    body is consulted; a peek can only make a key *more* specific). TRAP-5: eight class-closure claims
    independently re-enumerated with zero silent omissions (one subject over-claims —
    `8aee95c9`'s "every consumer branches on `ok`" is true of 2 of 6 — but the ledger scopes it
    correctly and it is not exploitable at HEAD). TRAP-6: `resetUsedTokens` has zero hits in the
    breaker path. TRAP-7: all three recording arms `await` on the caller's path; zero floating
    promises; the store carries its own per-command budget so a fired request deadline does not hand
    an already-aborted signal to the write. TRAP-9 **twice**: `07bdcb32` removed zero assertions
    (`grep -c "^-.*expect("` → 0) with +17 net cases, and `a77d607e` reverted a comment edit rather
    than unfreeze a Phase-52 island.
11. **TRAP-10's stated failure mode no longer reproduces.** `mod.X === leaf.X` holds at vitest 4.1.10
    (measured), and repo-wide grep finds **zero** consumers importing either class from the
    re-exporting modules. Keep the style rule if you like; stop treating "resolves to `undefined`" as
    a live fact.
12. **`RFL`'s 58 CLOSED verdicts are real but bounded.** ⚠️ **`140-RED-closure-refalsify` ran NO
    MUTATIONS** (no-write rule). Every "CLOSED" means *the mechanism is present and correct at
    source*, **not** *the harness bites if you remove it*. Do not quote the 62 % closure rate as
    mutation-tested. The mitigating evidence is structural: pins are hand-typed, rosters are
    oracle-independent by construction (`grep -cE "mod\.|MODULE\."` → 0), discovery passes carry
    vacuity fences, and D-01's live-Redis lane is real and CI-wired.
13. **~18 mechanisms checked and found clean** by `SF`, including `error_contract._validate`
    (degrades nothing — every arm raises, no defaults, no coercion, no `except`); `seamBreakerVerdict`'s
    status-range guard (`0`/`-1` would otherwise classify as SUCCESS and silently disarm the breaker);
    `seamCorrelationId`/`seamErrorCode` reading **both** wire shapes; `parseResponse` throwing despite
    a stale docblock; the wizard publish gate's fail-CLOSED ordering; `keys/[id]/permissions`'s
    throw-not-return cache discipline (a rejected `unstable_cache` callback writes no entry, so no
    unvalidated scope verdict is memoized); catch-ladder ordering across all 15 routes; secret-bearing
    captures naming their per-request credentials at **every** site; `venueOutageCopy`'s `null` branch;
    `ErrorEnvelope`'s double gate on `retry_after_seconds` (**no wait is ever invented at the renderer**).
    Plus `OUT`'s eight clean lanes (the `unstable_cache` × breaker interaction, `readDependencyBody`'s
    tee, the `recordOnce` latch, `instrumentBody`'s `SyntaxError` passthrough, `SeamConfigError` above
    the classification window, breaker key provenance, admin 4xx forwarding, `process-key-client`'s
    two-`ok` contract) and `TST`'s twelve clean test lanes.

---

## 5. CREDITED STRONG — do not disturb

- **`SyncPreviewStep.poll-disjointness.runtime.test.tsx`** — the best guard in the range. Spying on
  `globalThis.fetch` is **indirection-proof by construction**, and the mark provably cannot be
  mis-drawn (`useStrategySyncPoller.ts:184-188` schedules the first poll via `setTimeout(poll, 3000)`
  with **no leading read**). Carries a positive control, a bidirectional matcher self-test, and a
  hand-typed negative member.
- **`resilient-fetch.wiring.test.ts`'s three set equalities** — the only guard in the range that
  closes its class by derivation-compared-against-a-hand-typed-set on all three axes. **WP-1 should
  copy this file, not invent something.**
- **`seam-constants.pin.test.ts`** — sorted-set equality rather than length (explicitly reasoned:
  *a length check passes a swap*), `durationToMs` re-implemented in-test so the conversion is not the
  subject's own arithmetic, oracle-independence mechanically verified.
- **`seam-budgets.invariant.test.ts`** — SC-4d's deep compare and SC-4e's `readCompositeCapFromDisk`
  cross-file link through the route file on disk (the only genuine one available for a Next route
  module), with a `^…/m` anchor that defeats prose.
- **`wizardErrors.test.ts`'s `EXPECTED_TABLE_SIZE`** — exact `.toBe(55)`, twice, with the scans
  iterating the real table. The correct shape of a hand-typed count.
- **`frontend-seam-redis` CI job + `tests/redis/seam-breaker.redis.test.ts`** — wired in **both**
  `needs:` and the strict result loop, digest-pinned, consumes no secret and no repo variable so a
  fork PR cannot silently skip it, explicit empty-corpus preflight that errors on a zero-length glob,
  `passWithNoTests` left at `false`, **no `skipIf` anywhere**, `decodeLock` hand-written so the
  assertions are independent of the production encoder, TTLs read back from real Redis. `GRD`: *"This
  is how a lane should be wired."* `RFL`: *"the artifact whose absence made the breaker unverifiable."*
- **`ProbeParseMiss`** (`finalize-wizard/route.ts:142`) — the diff's counter-example and the template
  `TYP` says the rest should copy: the miss sentinel carries **no scope fields at all**, so a parse
  miss cannot present a scope verdict **by construction**, and it survives reordering of the gates.
  Rated 9/10/9/10.
- **`seam-discriminator.ts`'s five-export surface + `EXPECTED_EXPORTS`** — best-designed unit after
  `ProbeParseMiss`. The `serviceDependencyOf` (closed set, may become a **key**) vs
  `seamDependencyName` (open set, may be **shown**) disjointness is correct and verified against
  `error_contract._validate`. Keeping `nestedDetail` private and rejecting a generic
  `seamDetailField(body, name)` getter were both right calls.
- **`error_contract.py` / `VenueTransientHTTPException`** — the best-documented boundary in the diff:
  the flat-vs-nested departure documented **at the departure site** with the three-code regression
  that forced it, guards raising `ValueError` because a violation is a programming error at a raise
  site. (H-4b adds one missing guard; do not disturb the rest.)
- **`seam-redaction.ts` at seam scope** — env names read at call time, exact `split`/`join` never
  regex, plain-object branch preserving SQLSTATE, the per-request floor correctly **one-sided**, and
  over-redaction pinned two-sidedly (`ECONNREFUSED 10.0.0.1:8002` must survive), asserted against
  `messageBody()` so the leaf's own notice cannot self-satisfy it.
- **`validate_key_venue_transient_contract.json`** — genuinely two-sided, the **only** parity fixture
  with a real Python reader, with a census proving every trigger is both named and driven, anti-shrink
  counts, and `recoverable` polarity pinned in both directions with an `AUTH_FAILED` negative control
  at both collapse sites.
- **The five comment idioms in `CMT §4`** — every one names the measurement behind it. Especially
  `resilient-fetch.ts:1745-1751` (*"TWO CORRECTIONS HAVE NOW LANDED ON THIS ONE COMMENT"*, both wrong
  versions quoted verbatim — a comment that records its own error history gets more trustworthy with
  age) and `seam-poll-disjointness.pin.test.ts:121-125` (*"THIS REPLACED A HAND-TYPED 0 … a hand-typed
  literal that is not the truth is worse than no literal"*). **Institutionalise this.**
- **The one-policy-cited-not-duplicated pattern** at `admin/match/eval/route.ts:57-115` — each
  exclusion carrying its own falsifiable reason, cited (never restated) by both siblings on the
  explicit ground that *"two copies of a policy is how two policies start."* Verified: the siblings
  cite, they do not duplicate.
- **The 10/10 mutation campaign** (`TST §0`) — one mutation at a time, a full 9 792-test run each,
  tight failure counts. **The seam core lane is genuinely falsifiable.** Preserve the method.

---

## 6. Process findings

**P1 — No phase re-measures the facts the previous phase wrote down.** **Seven of seventeen** comment
findings are 140.2 comments **falsified by 140.3 commits inside the same range**. `CMT F-1`, `F-2` and
`F-16` are three separate statements of one now-wrong fact: *"the seam captures nothing to Sentry."*
Measured: **41 `captureToSentry` calls across 15 of 15 seam routes** — and `TCC` adds that it was
**never** true (already 20-across-5 at the commit that introduced the file; **no pair of routes sums
to 10**). Worse, `wizardErrors.ts:1118-1130` names its **own escape condition** — *"If 140.3-13 adds
the missing captures, the claim may come back"* — which two in-range commits satisfied, so the
recorded justification for `UNKNOWN`'s copy staying silent has flipped and nobody will re-open it.
**Remedy shape: a "re-measure the numbers this plan's predecessor wrote" step, or delete the numbers.**

**P2 — Line-number citations are an unowned-count class, and the evidence is unusually sharp.**
Spot-check: **19 checked, 5 wrong.** **Three commits inside this range each broke citations** —
`1f8ad052` (a fix, +21 lines in `exchange.py`, breaking seven citations in three files that label the
values *"EVIDENCE, NOT INTUITION. Derived 2026-07-27"* — one of which I re-read still live in the
`validate-key` budget row), 140.3-14's allow-list insert, and — **the sharpest** — our own gap-closure
commit `2d58fd45`, whose stated purpose was *"a pointer cannot drift"* and which touched
`SyncPreviewStep.tsx` **+7/−1 = net +6**, invalidating four line-number citations that were correct
when written. Of 22 `STATUS_CONTRACT.md` coordinates sampled, **14 miss**, two landing on blank lines.
`§2.1` of that document warns against line numbers and then keeps six of them fifty lines below.
**The substance survived everywhere** — which is exactly why nothing reddened. **Remedy: symbol
references, not line numbers, in files this programme is actively editing. Any remedy that only
removes prose integers leaves this class untouched.**

**P3 — Several guards can be deleted with green CI, and the meta-guard is the loosest artefact in the
range.** Four unregistered guards (three of them shipped in this range, the third time the programme
has found this state after registering against it twice); a floor of 20 against 44; `existsSync` as
the whole check; no repo-wide skip gate. `GRD` puts it plainly: *"the registry itself is the one place
that uses a loose lower bound, and it is the place where looseness costs most."* → WP-12.

**P4 — "CLOSED" ≠ "the harness bites."** `RFL` ran zero mutations. On a branch whose predecessor
certified itself mutation-tested while ten simultaneous mutations produced a byte-identical pass
count, that distinction is the whole game. **State it in the 140.4 plan wherever a 140.3 closure is
relied on.**

**P5 — The TRAP register itself has stale premises, and they misdirect.**
**TRAP-4** pins the hazard to *"denies **codeless**"* — 140.3-10 closed that half, so a plan reading
it literally concludes the trap is discharged. That is exactly the reasoning `SubmitStep.test.tsx:570-577`
encodes, and exactly why nine live members went unexamined. **Restate as the property:** *a terminal
error render must not offer a destructive control as the sole affordance, nor place a retry beside
one; this is a property of the render, not of a code list; and treat `recoverable` as unreliable
because `try_another_key` makes a code "recoverable" whose only retry is destructive.*
**TRAP-1**'s site list names two siblings that are on the roster and clean, while the live leaks are
at three files it never names — naming specific siblings inside a rule *about completeness* invites
treating the named pair as the boundary. Strike the list, keep the two-sided property.
**TRAP-8**'s text supports two opposite readings ("isolate them" vs. the operative "opposite-direction
edits to one file must be ONE task"), so the rule does not discriminate; its evidence died with the
scrapped batches. **TRAP-10**'s premise is dead. **TRAP-3 is *more* correct than written** — the defect
is the **destructure**, not `.single()`.

**P6 — Fixes whose own justification is wrong about their own subject.** `WeightOptimizerSection`'s
docblock argues *"a 4xx means the optimizer ANSWERED and refused"* and *"the identical request will be
refused identically every time"* — both false for the 429 and the 401 it then mis-buckets (`REG`:
*"a case where the fix's own justification is the thing that is wrong"*). `SubmitStep.test.tsx:570-577`
frames the code-set coupling rule entirely as an obligation on **future** additions and nobody applied
it to the members already there; `39ea3b20`'s "IN THE SAME COMMIT" failure message was written **after**
`RATE_LIMITED` had already been admitted without it — *the strongest available evidence that an
instruction alone is not a guard.* **Plan-check should ask: does this docblock's argument survive
being applied to the statuses the route actually emits?**

**P7 — Test doubles that model bodies the boundary cannot emit, so the fix they certify is unreachable
in production.** At least six instances (M-14, M-15). This is a distinct failure mode from a missing
test: the suite is green, the assertion is real, and the production path it claims to cover does not
exist. **Remedy shape: derive fixture shapes from the emitter, or pin the emitter's shape set.**

**P8 — The seven "instance-not-class" stragglers share one shape and one remedy.** `SF` names it:
*the class was closed in one file and left open in its sibling, inside the same commit range, with the
sibling's own comment stating the rule.* H-1, H-5, H-8, H-10, M-1, M-7, M-8 are all this. **The
mechanism that would close it is not more review — it is a completeness assertion per class**, of the
kind `seam-log-coverage.test.ts:298` already builds for one of them (and `SF M5` shows even that one
has a stale membership predicate). This is the coverage law restated from the defect side.

---

## 7. Owed to the founder — three manual verifications

1. **TRAP-4: five clicks in a REAL browser against a live composite draft.** Recorded in
   `.planning/STATE.md` as *FOUNDER OWES, none done*; the allow-list was accepted as the discharge and
   §2 C-4 shows it is not one. **This is a precondition for closing WP-7, not a follow-up.** The live
   path is fully traced at `TRP §1c`: a composite draft mid-first-computation has no
   `data_quality_flags.composite` marker, so `isComposite` stays `false`, the 5/60 s per-strategy
   bucket 429s, `RATE_LIMITED` renders with a Retry, five clicks exhaust it, and the only other button
   fires `void handleDeleteDraft()`.
2. **A cold-start latency measurement for the `process-key-sync` 15 s budget.** `RFL A-07`: the budget
   is now pinned to a literal and is falsifiable in both directions — but **no latency measurement was
   ever taken**, and the harm channel is intact: a cold-Railway enqueue exceeding 15 s is a deadline,
   and a deadline still counts to the **global** breaker key, so a false 504 on the wizard SUBMIT step
   feeds the breaker while the job may already be enqueued. The row's justification is a source
   citation, not a measurement.
3. **Confirm prod carries the `UPSTASH_*` env names, not the Vercel-marketplace `KV_*` shape.**
   `RFL D-06`: `resilient-fetch.ts:716-717` gates on `UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN`
   and `grep -rn "KV_REST_API" src/` → no matches. A `KV_*`-only project gets `redis = null` and a
   **silently disabled breaker**, announced by one `console.warn`. Not verifiable from the tree.

---

## 8. Explicitly OUT OF SCOPE for 140.4

- **A-05 / ME-04** — the anonymous-teaser global-breaker DoS. Documented, pinned, **accepted in code**,
  deferred to Phase 141. `ATK A3` re-derived the arithmetic (20/min allowance × 5 failures in 30 s
  against the widest key in the system) and explicitly does not claim it as a discovery. Note what
  genuinely defends here and **must not be "simplified"**: a `500` does **not** count
  (`seam-discriminator.ts:437-444`), which closes the much cheaper "crash Python five times" variant
  outright.
- **TS-36** — the Python half of the tenant-claim parity gate. Owner Phase 146, disclosed at
  `REGISTRY.md:66` and in the fixture's own `_comment`. `GRD F-13` notes only that
  `describe("…cross-language parity fixture")` *reads* as coverage that does not exist.
- **B-08 / SEAMUX-03** — 7 of 10 emitters carry no `code`. `seam-copy.ts:50-54` is candid it was
  deferred. (Its scope paragraph is wrong in **both** numbers — four envelope shapes, three carrying a
  `code`, not five and two — fix that in WP-15 so the eventual plan sizes off a correct inventory.)
- **DEF-G2-3** — the three stale counts in `TouchTooltip.tsx`. A Phase 52 FROZEN island; deleting it
  to land a **comment** edit would delete a working fence. Correct call, ledgered, do not revisit.
- **The 71 raw Python 4xx raise sites** on endpoints with no TS caller. `CVI RIM-7` explicitly does
  **not** call this a defect and falsified the fence. ⚠️ But record: `exchange.py:781` (a venue fault
  answered as our 500, no code) and `portfolio.py:2326` (a 500 blaming the caller's credentials, on
  the **public teaser** route) are textbook members of the class TS-32 closed seven sites away, and
  are correct today **only because nothing calls them**.
- **Repo-wide nested `<a><button>`** (23 sites) — a separate a11y sweep, CLAUDE.md Rule 11.
- **Branch protection** — settled founder decision, off until paying clients. Every gate statement in
  this document is *"would have caught"*, never *"did stop"*. **Do not re-raise.**

---

*Read-only synthesis. No file outside `.planning/reviews/140-SYNTHESIS.md` was written; `git status`
matches the expected `M TODOS.md` + untracked `analytics-service/scripts/nautilus_factsheet.py`.*
