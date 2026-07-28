# 140 → 140.1 → 140.2 → 140.3 → G1/G2 — RED TEAM: did the fixes close CLASSES or INSTANCES?

Range `d1f742c9^..a77d607e` (253 commits, 177 files, +51 364 / −813).
Method: for each fix, extract the **predicate** that defines its class, run that
predicate over the **whole repo at HEAD**, and report population / covered /
gap. Every claim below carries the grep that produced it.

Branch protection is OFF by settled founder decision — every gate named here is
advisory at merge. Where a guard exists I say "would have caught", never "did
stop".

---

## HEADLINE ANSWER

**Neither purely. The range produced two structurally different kinds of fix,
and they have opposite coverage profiles.**

1. **Where the fix built a SHARED ARTEFACT that call sites are forced through —
   a leaf, a chokepoint, a table, a component — the class is genuinely closed,
   and I could enumerate the population and find zero gap.** Five such classes
   measured below; all five are 100 % or 100 %-minus-a-documented-exclusion.

2. **Where the fix was a hand-typed roster, an allow-list, or a per-site edit,
   coverage is a well-covered CORE with an UNCOVERED RIM, and the rim is
   systematically the same shape: the members that arrive through the *other*
   call path, the *other* sink, or the *other* setter.**

**Name the rim precisely — it is five things:**

- **THE SECOND ALLOW-LIST.** 140.3-01's two new codes reach the ONE wire→wizard
  table, are correctly translated at the consumer, **and are then thrown away
  one line later by a second, unextended 9-member allow-list in the same
  function.** Verified at source. **The fix executes and produces no effect.**
- **THE SECOND SINK.** The scrub reaches Sentry (chokepoint) and `console` on
  8 named files. It does not reach the `throw new Error` twin four lines below
  the scrubbed call in the same function, nor `console` on the other 7 seam
  route files, nor one HTTP response body. **3 sinks of 4.**
- **THE SECOND SETTER.** The destructive-control guard is a 2-member allow-list
  over codes arriving at `setErrorCode(...)`; it covers both members reachable
  from setter A and misses the one member reachable from setter B in the same
  file. **2 of 3.**
- **THE LAYER BELOW.** `res.ok` is now observed at 84 of 88 client call sites
  (genuinely closed). The identical "a failure reads as an absence" defect
  moved one layer down to Supabase reads that never destructure `error` at all:
  **32 sites, 21 of them fail-open or fabricate an empty 200.**
- **THE CONSUMER THAT NEVER EXISTED.** `Retry-After` is emitted by **57**
  routes and threaded into the envelope at **1 of 8** minting sites; **zero**
  browser code reads the header. The wait is representable, and almost nothing
  represents it.

---

# PART 1 — CLASSES THAT ARE GENUINELY CLOSED

Recorded by name so nobody re-spends the audit on them.

## ✅ CLOSED-1 — the seam route roster is COMPLETE over `src/app/api/**`

**Predicate.** Every file under `src/app` or `src/lib` that imports a seam
client or names `ANALYTICS_SERVICE_URL`, minus those listed in
`SEAM_ROUTE_BUDGETS` or `SEAM_EXCLUSIONS` in `src/lib/resilient-fetch.ts`.

```bash
grep -rln "analytics-client\|process-key-client\|ANALYTICS_SERVICE_URL\|resilient-fetch" \
  src/app src/lib --include="*.ts" --include="*.tsx" | grep -v "\.test\." | sort > /tmp/imp.txt
grep "^src/app/api/" /tmp/imp.txt | while read f; do
  grep -qF "\"$f\"" src/lib/resilient-fetch.ts || echo "MISSING: $f"; done
```

**Measured: 20 API route files reach the seam. 20 of 20 appear in the table
(15 budgeted) or the exclusion list (3: `debug-key-flow`, `cron/warm-analytics`,
`warmup-analytics`). Gap = 0.**

⚠️ Use `grep -F`. A plain `grep` treats the `[id]` in
`src/app/api/keys/[id]/permissions/route.ts` as a character class and reports a
false MISSING. That route IS in the table.

`140.23-RED-guards.md` F-2 is right that *nothing binds* the two sides — but as
a matter of fact at HEAD the roster is complete. F-2 is a durability finding,
not a current gap, and this measurement is the evidence it was missing.

## ✅ CLOSED-2 — `maxDuration` on every seam route: 15 / 15

```bash
while read f; do printf "%s %s\n" "$f" "$(grep -c '^export const maxDuration' "$f")"; done < seamfiles
```
All fifteen budgeted routes pin it. No gap.

## ✅ CLOSED-3 — the `ok` discriminator at every `/process-key` consumer: 5 / 5

**Population** (`grep -rn "postProcessKey(" src/ --include="*.ts" | grep -v test`):
`csv-validate:236`, `finalize-wizard:1557`, `csv-finalize:1176`, `keys/sync:530`,
`verify-strategy:254`. **All five branch on `result.ok`.** Gap = 0 at the
discriminator. (The *body* behind the `ok:true` arm is a separate class —
`140.23-SPEC-silent-failure.md` M8 owns that.)

## ✅ CLOSED-4 — SEAMUX-08 Sentry capture on every seam route: 15 / 15

Every one of the fifteen budgeted routes has ≥1 `captureToSentry(`. The
"4 of 9, then the OTHER five" split in `00aeddbc` / `b22a2047` did land on the
whole population. (Delivery of those captures is a different class —
`140.23-SPEC-silent-failure.md` H1.)

## ✅ CLOSED-5 — the Python status contract, over its DECLARED scope

`analytics-service/docs/STATUS_CONTRACT.md` enumerates S-01..S-24 and carries an
explicit **"Not seam-reachable, deliberately excluded"** list. I tried to falsify
that fence and could not:

- The list cites `routers/portfolio.py:2242,2446` as "`/api/verify-strategy`, no
  TS caller". **Verified:** `src/app/api/verify-strategy/route.ts` imports
  `postProcessKey` and calls `/process-key` — it never calls the Python
  `/api/verify-strategy`. The fence holds.
- It cites six arms in `routers/exchange.py`'s `fetch_trades` handler as
  "`/api/fetch-trades`, no TS caller". **Verified:** no TS file calls it.

**Credit where due: this is the only enumeration in the range that states its
own exclusions with reasons and survives an attempt to break them.** It is the
house style the rest of the range should be held to.

⚠️ Fragility, not a defect: the exclusion coordinates have drifted +21 lines
inside this same range (list says `exchange.py:660/670/685/689/698/760`;
measured `681/…/719/…/781`). `140.23-SPEC-comments.md` F-11 owns it.

---

# PART 2 — CLASSES THAT ARE A CORE WITH A RIM

Ranked by what an uncovered member costs.

## 🔴 RIM-0 (HIGH, and it is the answer to the brief) — the wire vocabulary is ~90 codes; the render side recognises 6, and 140.3-01's two new members are translated and then discarded in the same function

This is the sharpest instance-vs-class result in the audit, and I verified every
load-bearing line at source.

### The population

| side | population | how measured |
|---|---|---|
| **WIRE** | **~90 distinct codes**, plus an **unbounded** pandera-derived set | 21 nested-envelope Python (`service_error`, AST walk) + 5 flat Python (`main.py` app-global handlers + `VenueTransientHTTPException`) + 18 `validate_key_permissions`/adapter codes + 10 `process_key.py`/`csv.py` + 58 TypeScript route literals + 4 `process-key-client` — minus overlaps. `analytics-service/services/ingestion/csv_adapter.py:172` mints `error_code=first_rule.upper()` from a pandera rule name: **an open string set with no registry.** |
| **RENDER** | `SEAM_CODE_TO_WIZARD_CODE` = **6** (`wizardErrors.ts:1551`); `VENUE_WIRE_CODE_TO_VERDICT` = **6** (`:1338`) | direct read |

⚠️ Scoping the emitter scan to `src/app/api/**/route.ts` **under-counts**.
`src/lib/process-key-client.ts:646` is `NextResponse.json(body, { status: res.status })`
— it forwards the Python envelope **byte-for-byte**, so the entire Python
vocabulary is browser-reachable through `finalize-wizard`, `keys/sync`,
`verify-strategy`, `csv-validate` and `csv-finalize`.

### The defect: the fix runs, is correct, and is then discarded

`src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx:206-213`:

```ts
const translated = recogniseSeamErrorCode(data.code);   // "RATE_LIMITED" → "RATE_LIMITED" ✅
const candidate  = translated === "UNKNOWN" ? data.code : translated;
const surfaced: WizardErrorCode =
  candidate && KNOWN_FINALIZE_CODES.has(candidate as WizardErrorCode)
    ? (candidate as WizardErrorCode)
    : "UNKNOWN";                                        // ← RATE_LIMITED is NOT in the set
```

`KNOWN_FINALIZE_CODES` (`:150-194`) has **9** members: `KEY_SCOPE_BROADENED`,
`KEY_NETWORK_TIMEOUT`, `GATE_DRAFT_GONE`, `GUARD_BLOCKED`,
`COMPOSITE_MEMBERSHIP_UNKNOWN`, `COMPOSITE_TOO_MANY_MEMBERS`,
`SERVICE_UNAVAILABLE_RETRY`, `SERVICE_UNREACHABLE`, `SEAM_MISCONFIGURED`.

`SEAM_CODE_TO_WIZARD_CODE` (`wizardErrors.ts:1554-1555`) maps
`"VALIDATION_FAILED" → "VALIDATION_FAILED"` and `"RATE_LIMITED" → "RATE_LIMITED"`
— both valid union members, **neither in the allow-list**. So at SubmitStep a
Python 429 (`main.py:520`) or 422 (`main.py:413`) is translated correctly and
then resolved to `"UNKNOWN"` → *"Something went wrong."*

**The discipline that would have prevented this is written down TWICE in the very
set that drops the codes**, for the two members that DID get admitted:

> `:159` — *"it is admitted HERE IN THE SAME COMMIT that the route started
> emitting it. Without this line the new code fails the membership check below,
> falls through to UNKNOWN … the whole obligation ships invisible while every
> route-side test is green."*
>
> `:181` — *"Admitted HERE IN THE SAME COMMIT that the client starts emitting
> it … That is `140.3-14`'s M81, one plan ago, on a different code."*

The rule was applied to `COMPOSITE_TOO_MANY_MEMBERS` (140.3-14) and
`SEAM_MISCONFIGURED` (140.3-15), and **skipped for the two codes 140.3-01
minted**. Same file, same set, same range.

### Second, independent structural gap at the same surface

`SubmitStep.tsx:119` reads `data.code` **top-level**. All **21** §1a Python codes
live at `body.detail.code` (nested). `seamErrorCode(data)` — the leaf that
handles both shapes — exists and **is already imported in this file**
(`seamCorrelationId(data)` is called at `:216`). So those 21 codes are
structurally unreadable at SubmitStep no matter what any table contains.

### Per-consumer coverage — measured

| surface | route | recognised / reachable | worst-case render |
|---|---|---|---|
| **SubmitStep** `:148` | `finalize-wizard` | **11 / 37+** (~30 %; `37+` because the pandera set is open) | UNKNOWN "Something went wrong." — **and this is the surface 140.3-01 targeted** |
| **KeyPermissionBadge** `:122` | `keys/[id]/permissions` | **0 / 5** | `` `${err.code}: ${message}` `` — the raw machine code is rendered to the user: *"PROBE_BACKEND_UNAVAILABLE: Upstream 503"* |
| **CsvSubmitStep** `:191` | `csv-finalize` | **0 / 6** (pass-through, no table) | server sentence renders, but `formatKeyError` never runs ⇒ no cause, no fix list, **no `recoverable` ⇒ no Retry control** |
| **CsvUploadStep** `:190` | `csv-validate` | **3 / 4** (`CSV_INVALID_FORMAT` missing) | — |
| **SyncPreviewStep** `:147` | `keys/sync` | **5 / 7** | `SYNC_FAILED` default (honest, non-specific) |
| **ConnectKeyStep** `:215` / **MultiKeyConnectStep** `:183` | `create-with-key` / `composite/add-key` | union-closed 16/16, but the upstream feed is **6 / 12** venue codes | **`WITHDRAW_SCOPE` falls to the substring cascade and matches `lower.includes("withdraw")` ⇒ renders `KEY_HAS_TRADING_PERMS` copy — the WRONG copy, silently.** `UNSUPPORTED_EXCHANGE`, `VALIDATION_UNEXPECTED`, `MISSING_SCOPE` ⇒ UNKNOWN |
| **MultiKeyConnectStep** set-members `:216` | `composite/set-members` | **4 / 4 — closed** | — |
| AllocatorMatchQueue / MatchEvalDashboard / PortfolioImpactPanel | match, eval, simulator | n/a — **status-keyed by design** (`venueOutageMessage` branches on 424 + `dependency`) | not a defect |

### Dead vocabulary (the other direction)

**15 of 55** `WizardErrorCode` union members have zero emitter anywhere:
`SYNC_TIMEOUT`, `SUBMIT_NOTIFY_FAILED`, `METADATA_DESCRIPTION_REQUIRED`,
`GATE_INSUFFICIENT_TRADES`, `GATE_INSUFFICIENT_DAYS`, `GATE_NO_DATA_SOURCE`,
and ten `CSV_*` members orphaned when `CSV_RULE_LABELS` (keyed on the pandera
**rule name**, not the code) superseded them.

⚠️ Note the collision with RIM-4: `GATE_NO_DATA_SOURCE` has no *wire* emitter
but IS reachable internally via `gateFailureToWizardError`, which is exactly why
the destructive-control gap there is easy to miss.

### Also uncovered, and cheap

`finalize-wizard/route.ts:598` — the route's own 429 carries `Retry-After` and
**no `code` field at all**, so `data.code === undefined` ⇒ UNKNOWN. The route's
own throttle is invisible to the route's own renderer.

---

## 🔴 RIM-1 (HIGH) — credential scrubbing reaches 1 of 4 sinks as a class

**The class predicate, taken from the guard's own docblock**
(`src/lib/seam-log-coverage.test.ts:16-22`): *an error-derived string
constructed on the seam path must pass a scrubber before reaching any sink.*

**Sink population = 4.** Measured coverage:

| Sink | Mechanism | Population | Covered | Gap |
|---|---|---|---|---|
| Sentry | scrub folded into `captureToSentry` chokepoint (`sentry-capture.ts:1`) | 109 `captureToSentry` sites | **109** | 0 for the seam¹ |
| `console.error/warn` | `seam-log-coverage.test.ts` source scan over a hand-typed `SEAM_FILES` roster | 8 files | **8** | **7 more seam files, 8 sites** |
| thrown `Error.message` | — nothing | 1 constructive site | **0** | **1** |
| HTTP response body | — nothing | 1 echoing site | **0** | **1** |

¹ 14 sites call `Sentry.captureException` directly, bypassing the chokepoint —
none is on a seam file. (`140.23-RED-guards.md` F-16 owns the durability half.)

### The gap, enumerated

**(a) The thrown twin — `src/lib/analytics-client.ts:529-536`.** In ONE function,
four lines apart:

```ts
console.error(
  `[analytics-client] Contract validation failed for ${endpoint}:`,
  scrubSeamString(JSON.stringify(result.error.issues)),   // ← SCRUBBED
);
throw new Error(
  `Analytics response contract violation on ${endpoint}: ${result.error.issues.map(...).join("; ")}`,  // ← NOT
);
```

The comment immediately above the scrubbed call states the rule the throw
breaks: *"a zod issue array is error-DERIVED and can echo request-derived
values back into the line (a `received` field on a credential-shaped input, an
unexpected key carrying a token)."* This is the exact shape the brief names —
**the class closed on one sink and left open on its twin, in the same commit,
with the sibling's own comment stating the rule.**

`parseResponse` is reached from **8 of the 9** analytics-client wrappers
(`analytics-client.ts:587,608,637,671,686,704,732,770`), so this string is
producible on every seam route.

**(b) Where that string lands — 6 route files, 8 `console.error(…, err)` sites,
none on the guard's roster:**

| file:line |
|---|
| `src/app/api/bridge/route.ts:194` |
| `src/app/api/simulator/route.ts:219` |
| `src/app/api/portfolio-optimizer/route.ts:236` |
| `src/app/api/scenario/optimize/route.ts:245` |
| `src/app/api/admin/match/eval/route.ts:185, 245` |
| `src/app/api/admin/match/recompute/route.ts:136, 201` |

The guard's roster comment says the budget table "lists fifteen ROUTES, of which
only five carry credential-bearing error logs". **That is a claim about a
population, and nothing measures it.** The other seven budgeted routes (`bridge`,
`simulator`, `portfolio-optimizer`, `scenario/optimize`, both admin/match,
`csv-validate`, `csv-finalize`, `keys/sync`, `verify-strategy`) contain 46
`console.error/warn` sites the guard structurally cannot see.

`grep -c scrubSeam` per seam file: **8 of 17 seam files have ZERO reference to
the scrubber** (`bridge` 0, `simulator` 0, `portfolio-optimizer` 0,
`scenario/optimize` 0, `admin/match/recompute` 0, `csv-validate` 0,
`csv-finalize` 0 — the last with 12 console sites).

**(c) The body echo — `src/app/api/strategies/csv-validate/route.ts:264-274.**
`const message = err instanceof Error ? err.message : …` →
`csvErrorEnvelope("CSV_UPSTREAM_FAIL", message, {}, 502)`. The sibling route
`bridge/route.ts:190-193` carries the rule verbatim in a comment:

> *"H-1062: genuine 5xx / unexpected exceptions return a STATIC message.
> Echoing err.message here leaked Python contract-drift strings (the multi-line
> Zod issue list parseResponse() throws) and FastAPI 5xx detail to authenticated
> allocators. Keep the detail server-side only."*

Same class, same range, opposite decision, one route apart.
(`140.23-SPEC-tests.md` §1 reached the same site from the token angle.)

**Cost of an uncovered member:** a credential or a request-derived token in a
Vercel log (b) or in a browser response (c).

**Structural cause, stated plainly:** the covered set is a HAND-TYPED roster of
8 files, and the uncovered set is everything the roster does not name. The
roster's own docblock says so — *"`SEAM_FILES` is hand-typed for that reason"* —
and HI-02 already proved once, inside this range, that two credential-bearing
routes were missing from it. The mechanism that failed once is unchanged.

---

## 🔴 RIM-2 (HIGH) — "a failure must not read as an absence": closed on the client, wide open one layer below

**Client half — GENUINELY CLOSED.** Predicate: every `fetch(`/`wizardFetch(`/
`resilientFetch(` call site in `"use client"` files and browser libs, classified
by whether a `res.ok`/`res.status` failure branch exists.

**Population 88. OBSERVED 84. PARSE-ONLY 0. IGNORED 3.** The three fix targets
named by 140.3-08 are all OBSERVED (`ApiKeyManager.tsx:299`, `:374`;
`AllocatorMatchQueue.tsx:233`), and two `keys/sync` call sites the phase never
named (`SyncPreviewStep.tsx:588`, `:1236`) are OBSERVED too. **This is a real
class closure.**

Residue — 3 members, all literally `await fetch(...)` with the response discarded:

| # | file:line | cost |
|---|---|---|
| 1 | `src/components/admin/MatchQueueIndex.tsx:217` | match-engine **kill switch** toggle; a 403/500/503 makes the pill snap back silently — the founder believes the engine is OFF when it is ON |
| 2 | `src/components/admin/MatchQueueIndex.tsx:147` | the same switch, re-enable direction |
| 3 | `src/components/strategy/StrategyActions.tsx:41` | founder-notify POST; a 4xx/5xx is invisible, submission sits unreviewed |

**Server half — THE RIM, and it is not the shape anyone looked for.**
`{ data, error }` destructures that ignore `error`: **0 of 146.** That sub-class
is clean. The defect migrated one step earlier: **32 sites never destructure
`error` at all**, so a DB fault collapses to `data === null` and is re-read as
"not found" / "none" / "zero".

| direction | count | meaning |
|---|---|---|
| FAIL-OPEN (`if (x)` / `x?.`) | 13 | error → guard skipped → request proceeds |
| NO GUARD (`?? []`, `?? 0`) | 8 | error → fabricated empty/zero, returned as **200** |
| FAIL-CLOSED (`if (!x)`) | 11 | error → 403/404; wrong reason, safe direction |
| bare `await admin…` write | 3 | write failure completely invisible |

Worst members:

| rank | file:line | why |
|---|---|---|
| 1 | `src/app/api/alerts/ack/route.ts:84` | the **replay/idempotency gate**: DB fault → `used = null` → `if (used)` skipped → a consumed ack token is honoured again. The very next query at `:93` DOES destructure `error`. |
| 2 | `src/app/api/cron/flag-monitor/route.ts:160` | `totalCount ?? 0` → `handleZeroDenominator` fires a **fabricated** escalation to the founder |
| 3 | `src/app/api/keys/sync/route.ts:340, 347` | venue resolution silently stays `"okx"` → a Bybit/Deribit/MT5 key syncs against the wrong venue (`140.23-SPEC-silent-failure.md` H6 reached this from the capture angle) |
| 4 | `portfolio-alerts/route.ts:57,101`; `alerts/critical/route.ts:43` | `(portfolios ?? [])` → "you have no alerts" at HTTP 200 when the DB failed |
| 5 | `account/deletion-request/route.ts:81` | 24h dedupe read → duplicate deletion request + duplicate founder email |
| 6 | `finalize-wizard/route.ts:1473` | bare `upsert({computation_status:"failed"})` before a `throw`; if it fails the strategy is stranded in `pending` forever |

**Verdict: the fix closed the class it named and did not look one layer down.
21 of the 32 uncovered members fail open or fabricate an empty 200.**

---

## 🟠 RIM-3 (MEDIUM-HIGH) — "a wait is representable end to end": 1 of 8, and 0 of 57

140.3-09 (SEAMUX-06) added `retry_after_seconds` to the envelope
(`src/lib/envelope.ts:51, 89`) and one renderer
(`src/components/error/ErrorEnvelope.tsx:128`).

**Layer A — envelope minting sites. Population 8, covered 1.**

```bash
grep -rn "buildEnvelope(" src/ --include="*.ts*" | grep -v "\.test\.\|export function"
```

| file:line | threads a wait? |
|---|---|
| `SyncPreviewStep.tsx:1279` | **YES** (`retryAfterSeconds` at `:1286`) |
| `ConnectKeyStep.tsx:423` | no |
| `SubmitStep.tsx:262` | no |
| `MultiKeyConnectStep.tsx:816, 839, 844, 935, 1131` | no (×5) |

The five silent minting sites sit on flows whose routes DO publish a wait:
`create-with-key:597`, `composite/add-key:529`, `keys/validate-and-encrypt:309`,
`finalize-wizard`, all set `Retry-After` on the breaker arm.

**Layer B — the HTTP header. Population 57, consumers 0.**

```bash
grep -rln '"Retry-After"' src/app/api --include="*.ts" | grep -v test | wc -l   # 57
grep -rn 'headers\.get("Retry-After")' src/ --include="*.ts*" | grep -v test
# → only src/app/cron/flag-monitor/route.ts:116 (reads SENTRY's header, server-side)
```

**Fifty-seven routes advertise a wait. Zero browser code reads the header.**
The single wizard path that shows a countdown reads it server-side and re-emits
it as a body field.

`140.23-RED-outage.md` O7 measured this as "1 of 3". The population is 8 at the
envelope layer and 57 at the header layer.

**Cost:** every rate-limited or breaker-tripped user outside `SyncPreviewStep`
is told "try again in a moment" while the system knows the exact number of
seconds and has already put it on the wire.

---

## 🟠 RIM-4 (MEDIUM-HIGH) — the destructive-control guard covers 2 of 3, and the third comes from the other setter

`SyncPreviewStep.tsx:1347` — `DESTRUCTIVE_CONTROL_IS_WRONG_FOR`, a hand-typed
2-member allow-list. Its own docblock states the PROPERTY correctly:

> *"The set is HAND-TYPED and the flag is now about the PROPERTY (states where a
> destructive control is the wrong and only way out), not about one code — an
> `===` against a single member is the instance-check this programme keeps
> finding."*

**Predicate derived from the render** (`:1379-1404`): the branch is EXCLUSIVE —
guarded ⇒ `Back to strategies` (`<Link>`), unguarded ⇒ `Try another key` →
`handleDeleteDraft()`, which destroys the draft and every `strategy_keys` member.
The Retry control above it renders only when `envelope.recoverable`, and
`recoverable = actions ∩ {clear_and_retry, try_another_key} ≠ ∅`
(`envelope.ts:88`). **So: a NON-RECOVERABLE code at `phase === "gate_failed"`
leaves the destructive button as the SOLE control.**

**Population = codes reachable at `gate_failed` × non-recoverable.**
55 codes in the copy table carry an `actions` list; 11 are non-recoverable.
Intersecting with the four `setErrorCode(...)`-then-`gate_failed` sites:

| setter | reachable codes | non-recoverable member | guarded? |
|---|---|---|---|
| `:628` `setErrorCode(surfaced)` — from `KNOWN_KICKOFF_CODES` | `RATE_LIMITED`, `GATE_DRAFT_GONE`, `COMPOSITE_MEMBERSHIP_UNKNOWN`, `VALIDATION_FAILED`, `SYNC_FAILED` | `GATE_DRAFT_GONE`, `VALIDATION_FAILED` | ✅ ✅ |
| `:1145` `setErrorCode(wizardCode)` — from `gateFailureToWizardError` | 13 outputs | **`GATE_NO_DATA_SOURCE`** | ❌ |
| `:575`, `:713` | `SYNC_FAILED` | — (recoverable) | n/a |
| `:649` | `KEY_NETWORK_TIMEOUT` | — (recoverable) | n/a |

**`GATE_NO_DATA_SOURCE` is the uncovered member. 2 of 3.**

It is not a near-miss — it is the *same* case. Its copy
(`wizardErrors.ts:590-600`) is:

- `actions: ["start_fresh", "request_call"]` — **byte-identical action set to
  `GATE_DRAFT_GONE`**, the code the guard was created for;
- `fix[0]: "Start fresh — the previous draft will be cleaned up."`

The guard's own justification for `GATE_DRAFT_GONE` is *"it is the state's OWN
fix line: 'Start a new strategy from the strategies page.' Navigating away
destroys nothing."* `GATE_NO_DATA_SOURCE` says the same thing and gets the
destructive button instead.

**Correction to a parallel register.** `140.23-RED-guards.md` F-8 names
`RATE_LIMITED` as the missing member "offering draft deletion as its only
control". **That is wrong and I could not reproduce it:** `RATE_LIMITED`'s
actions are `["clear_and_retry", "request_call"]` (`wizardErrors.ts:1081`), so
`recoverable === true`, so `onRetry` is passed and a Retry button renders
alongside. Draft deletion is not its *only* control. The genuine third member is
`GATE_NO_DATA_SOURCE`.

---

## 🟠 RIM-5 (MEDIUM) — async error announcement: closed exactly where a shared component exists

**Predicate:** every component touched in this range that sets an error string
after an async call and renders it — does the rendering element carry
`role="alert"` / `role="status"` / `aria-live`?

**Population 15 touched components. Covered 9. Gap 6.**

| component | announces? | via |
|---|---|---|
| `components/error/ErrorEnvelope.tsx` | ✅ `role="alert"` `:134` | own |
| `wizard/steps/ConnectKeyStep.tsx` | ✅ | delegates → `WizardErrorEnvelope` → `ErrorEnvelope` |
| `wizard/steps/SubmitStep.tsx` | ✅ | same |
| `wizard/steps/MultiKeyConnectStep.tsx` | ✅ | same |
| `wizard/steps/SyncPreviewStep.tsx` | ✅ | same + `role="status"` ×3 |
| `connect/KeyPermissionBadge.tsx` | ✅ `role="alert"` `:191` | own |
| `admin/MatchEvalDashboard.tsx` | ✅ `role="status"` `:122` | own |
| `portfolio/PortfolioImpactPanel.tsx` | ✅ `role="alert"` `:389` | own |
| `wizard/WizardClient.tsx` | ✅ | delegates |
| **`allocations/components/WeightOptimizerSection.tsx`** | ❌ | `status === "error"` → bare `EmptyStateCard` `:230` |
| **`portfolio/PortfolioOptimizer.tsx`** | ❌ | `:240` (RG-1 owns) |
| **`portfolio/ReplacementPanel.tsx`** | ❌ | `{error}` at `:208-210` |
| **`strategy/ApiKeyManager.tsx`** | ❌ | `:327`, `:355` |
| **`admin/AllocatorMatchQueue.tsx`** | ❌ | `:207`, `:294` (RG-3 owns) |
| **`landing/VerificationForm.tsx`** | ❌ | `{error}` at `:195-197` |

**The split is perfectly structural: 100 % of the components that route through
`ErrorEnvelope` announce; 0 % of the components that hand-roll their own error
`<p>` announce.** That is the cleanest evidence in this audit for the general
rule — *a class closes when a shared artefact exists and does not otherwise* —
and it means the remedy is not six edits, it is one more consumer of
`ErrorEnvelope`.

---

## 🟡 RIM-6 (MEDIUM) — body-shape validation at a gate: 2 sites, ~54 unvalidated peers

140.3-03 added `LivePermissionsSchema.safeParse` at the publish gate and
`KeyPermissionsPayloadSchema.safeParse` at the permissions route.

```bash
grep -rn "safeParse(await res\|Schema\.safeParse(await" src/ --include="*.ts*" | grep -v test
# → EXACTLY 2:
#   src/app/api/strategies/finalize-wizard/route.ts:215
#   src/app/api/keys/[id]/permissions/route.ts:330
```

**Population:** 56 sites use the fail-OPEN parse idiom
`await res.json().catch(() => ({}))` / `(() => null)`
(`grep -rn "\.json()\.catch(" src/ | grep -v test | wc -l` → 56), and ~55 sites
cast a parsed body with `as` and no runtime check. The two gate sites are the
only ones validated.

I am **not** claiming all 56 need a schema — most read a display string. The
sub-class that matters is *a parsed body that drives a gate decision*, and the
range fixed exactly the two members it named. There is no artefact anywhere that
would identify a third. **Default verdict per the evidence standard: instance,
not class** — I cannot demonstrate the population was enumerated.

---

## 🟡 RIM-7 (MEDIUM) — Python machine-code attribution: 32 of 103 raise sites

**Predicate:** every raise site in `analytics-service/routers/**` +
`services/**` + `main.py`, split by whether it goes through the error contract
(`raise service_error(...)` / `raise VenueTransientHTTPException(...)`) or is a
bare `raise HTTPException(...)`.

```bash
# script in this session; counts raise-lines per file
```

| file | contract | raw |
|---|---|---|
| `routers/exchange.py` | 15 | 17 |
| `routers/internal.py` | 6 | 5 |
| `routers/match.py` | 5 | 4 |
| `routers/portfolio.py` | 4 | **21** |
| `routers/simulator.py` | 1 | 8 |
| `routers/csv.py` | 0 | 4 |
| `routers/debug_key_flow.py` | 0 | 3 |
| `routers/cron.py` | 0 | 2 |
| `routers/process_key.py` | 0 | 2 |
| `services/analytics_runner.py` | 0 | 4 |
| `services/portfolio_limits.py` | 0 | 1 |
| **TOTAL** | **32** | **71** |

Status distribution of the 71 raw sites: `400`×35, `404`×8, `500`×8, `403`×6,
`429`×4, `503`×3, `422`×2, `409`×2, `413`×2, `401`×1.

**This is the one rim I am NOT calling a defect.** All 11 raw 5xx sites are on
the STATUS_CONTRACT's explicit not-seam-reachable list, and I falsified-and-failed
against it (CLOSED-5). The 71 raw sites are 4xx client errors on endpoints with
no TS caller. **Recorded as a scope statement, not a gap** — but note that
`routers/exchange.py:781` (`500 "Failed to fetch trades from exchange"` — a
VENUE failure answered as OUR 500, with no code) and `routers/portfolio.py:2326`
(`500 "Key validation failed. Please check your credentials."` — a 500 blaming
the caller) are textbook members of the very class TS-32 closed seven sites
away. They are correct *today* only because nothing calls them. The day a TS
caller appears, they are live defects with no guard watching.

---

# PART 3 — THE STRUCTURAL FINDING

Sort every class in this audit by the *mechanism* the fix used, and the coverage
falls out deterministically:

| mechanism | classes | coverage |
|---|---|---|
| **shared artefact call sites are forced through** (chokepoint, leaf, table, component) | CLOSED-1..4, RIM-5's covered half, RIM-2's client half | **100 %** |
| **hand-typed roster / allow-list** | RIM-0 (`KNOWN_FINALIZE_CODES`), RIM-1 (`SEAM_FILES`), RIM-4 (`DESTRUCTIVE_CONTROL_IS_WRONG_FOR`) | **9/37+ codes, 8/15 files, 2/3 codes** |
| **per-site edit, no artefact** | RIM-3, RIM-6, RIM-2's server half | **1/8, 2/56, 0/32** |

**RIM-0 is the purest specimen and deserves its own sentence.** 140.3-01 did the
*class-shaped* thing — it put the mapping in the ONE wire→wizard table
(`SEAM_CODE_TO_WIZARD_CODE`) rather than a second copy at the consumer, and the
comment above that table says exactly why. It then failed anyway, because a
**second** allow-list sits between the table and the render, and nothing binds
the two. A fix can be class-shaped at the layer it touches and still be an
instance because the class spans two layers. That is the generalisation this
range most needs.

The project record says the pattern-mapper gap produced "3 of 5 log sites, 5 of
7 routes". **The same ratio is reproduced at HEAD by the same mechanism** — the
hand-typed roster. `seam-log-coverage.test.ts`'s own docblock already records
that HI-02 caught two missing members *inside this range*, and the response was
to add the two members, not to change the mechanism. The measurement above says
the roster is still short by seven files and eight sites.

**The single highest-leverage change is not any of the eleven fixes below.** It
is to derive `SEAM_FILES` from `SEAM_ROUTE_BUDGETS ∪ SEAM_EXCLUSIONS` (which
CLOSED-1 proves is complete over `src/app/api/**`) and add the two lib clients,
so that adding a seam route reddens the log guard on the day it is written. The
docblock argues against deriving it — *"a derived list would silently widen or
narrow this guard whenever the budget table moved"* — but the measurement shows
the alternative already produced a 7-file hole, and CLOSED-1 shows the budget
table is exactly the right source.

---

# RANKED ACTION LIST

| # | fix | class | cost of leaving it |
|---|---|---|---|
| 1 | add `VALIDATION_FAILED` + `RATE_LIMITED` to `KNOWN_FINALIZE_CODES` (`SubmitStep.tsx:150`) | RIM-0 | **140.3-01 currently ships with zero user-visible effect**; a throttle or a malformed request renders "Something went wrong" |
| 2 | `SubmitStep.tsx:119` — read `seamErrorCode(data)`, not `data.code` (the leaf is already imported at `:216`) | RIM-0 | 21 nested-envelope Python codes are unreadable at this surface regardless of any table |
| 3 | scrub `analytics-client.ts:535`'s thrown message, same as its console twin four lines up | RIM-1(a) | request-derived tokens in 6 route logs |
| 4 | `csv-validate/route.ts:274` — return a static 502 message, as `bridge/route.ts:190` already does | RIM-1(c) | error detail (incl. config-throw text) to the browser |
| 5 | `KeyPermissionBadge.tsx:122` — stop concatenating `err.code` into the visible string | RIM-0 | users read raw machine codes |
| 6 | derive `SEAM_FILES` from the budget table + exclusions; +2 lib clients | RIM-1(b), structural | the mechanism that produced the 7-file hole is unchanged |
| 7 | `alerts/ack/route.ts:84` — destructure and branch on `error` | RIM-2 | ack-token replay on a DB blip |
| 8 | add `GATE_NO_DATA_SOURCE` to `DESTRUCTIVE_CONTROL_IS_WRONG_FOR` | RIM-4 | draft + all `strategy_keys` members destroyed by the only button on screen |
| 9 | `WITHDRAW_SCOPE`/`TRADE_SCOPE`/`MISSING_SCOPE` → `VENUE_WIRE_CODE_TO_VERDICT` (6 → 12) | RIM-0 | a withdrawal-scoped key renders the *trading*-scope copy via the substring cascade |
| 10 | observe `res.ok` at `MatchQueueIndex.tsx:147, :217` | RIM-2 | founder mis-reads the match-engine kill switch |
| 11 | `cron/flag-monitor/route.ts:160` — branch on the count error | RIM-2 | fabricated zero-denominator escalation |
| 12 | thread `retryAfterSeconds` at the 5 silent `buildEnvelope` sites | RIM-3 | every non-SyncPreview user loses the wait we already computed |
| 13 | route the 6 hand-rolled error surfaces through `ErrorEnvelope` | RIM-5 | screen-reader users get no announcement on 6 async failures |
| 14 | `keys/sync/route.ts:340, 347` — branch on the venue-lookup error | RIM-2 | a Bybit key syncs as `okx` |
| 15 | give `finalize-wizard/route.ts:598`'s own 429 a `code` | RIM-0 | the route's throttle is invisible to the route's renderer |
| 16 | re-derive the STATUS_CONTRACT exclusion coordinates | CLOSED-5 | a correct fence that no longer points at the arms it fences |

---

# WHAT I CHECKED AND FOUND CLEAN

- Seam roster completeness over `src/app/api/**` — 20/20 (CLOSED-1).
- `maxDuration` — 15/15.
- `postProcessKey` `ok`-branching — 5/5.
- `captureToSentry` seam coverage — 15/15 routes.
- Direct `Sentry.captureException` bypassing the scrub chokepoint — 14 sites,
  **none on a seam file**.
- `{ data, error }` destructures that ignore `error` — **0 of 146**.
- Client `fetch` PARSE-ONLY sites — **0 of 88**.
- `X-Tenant-Claim` minting — the mint is one function (`tenant-claim.ts:118`)
  read by both seam clients (`analytics-client.ts:321`,
  `process-key-client.ts:339`); no third caller mints its own.
- `CIRCUIT_OPEN_COPY` — one declaration, ten import sites; the five budgeted
  routes that do NOT import it return a bare `{ code }` for the wizard to
  render, which is a different (disclosed) envelope shape, not a second copy.
- The STATUS_CONTRACT "no TS caller" fence — attempted falsification on both
  `/api/verify-strategy` and `/api/fetch-trades`; the fence holds.

*Read-only pass. No files in the working tree were modified; `git status`
matches the expected `M TODOS.md` + untracked
`analytics-service/scripts/nautilus_factsheet.py`.*
