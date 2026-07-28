# 140-VERIFY-C3-C5 — adversarial re-verification of C-3, C-4, C-5

**Posture:** refute-first. Default REFUTED unless demonstrated.
**HEAD verified:** `a77d607e` (`feat/v1.16-production-resilience`), in an isolated worktree
reset to that commit. Nothing committed; all probes deleted (`git status` clean at exit).
**Method:** every load-bearing step was run, not reasoned about. Throwaway vitest probes
rendered the real `SyncPreviewStep` against mocked Supabase/fetch and printed the actual DOM;
`checkLimit` / `checkStrategyGate` / `formatKeyError` were executed directly.
**Branch protection is OFF (settled).** Every CI statement below is "would have caught",
never "did stop".

---

## Verdict table

| Claim | Verdict |
|---|---|
| **C-3** — unchecked `.error` on the single-key heavy reads fabricates a measurement | **CONFIRMED**, and **RE-GRADED UP**: the inverse (fail-OPEN) half is worse than the half that was pled |
| **C-4** — 2-member allow-list vs 11 codes, TRAP-4 violated on ~9 | **CONFIRMED-BUT-RE-GRADED**: 11 codes and 9 destructive renders are exact; genuine *sole-route* TRAP-4 violations = **1**, not 9. A different, unpled defect on the other 8 is real and demonstrated |
| **C-5** — one `console.warn` sink; limiter fails CLOSED while breaker fails OPEN; 3/15 routes split; exchange blamed | **CONFIRMED** on every link, with one measured correction: the limiter's posture is *outage-mode dependent* — it fails CLOSED on a store rejection and OPEN on a slow store |

---

# C-3 — CONFIRMED (demonstrated), re-graded UP

## What was attacked, and what survived

### (a) Does supabase-js on the pinned version resolve rather than throw? — **MEASURED: yes**
`@supabase/supabase-js` and `@supabase/postgrest-js` both pinned at **2.110.1**
(`package.json` `^2.110.1`, installed tree 2.110.1). PostgREST failures are returned as the
`{ data, count, error }` value, not thrown. The file's own comment at
`SyncPreviewStep.tsx:699-701` states the same thing about itself.

### (b) Is `.error` checked anywhere in the chain? — **MEASURED: no**
`SyncPreviewStep.tsx:1053-1113`. The `Promise.all` has **seven** members. Six are destructured
`{ data: … }` / `{ count: … }`; the seventh (`keyRowResult`) is kept whole and then read as
`keyRow = keyRowResult.data` at `:1118`. **Zero `.error` reads on any of the seven.** There is no
wrapper, no `throwOnError()`, no outer catch that can see a resolved-with-error value — the
enclosing `try` at `:808` only catches *rejections*, and a PostgREST error is not one.

The class **is** fixed 200 lines up in the same function: the composite arm at `:847-870` checks
`.error` on all four of its reads and throws into the `heavyFetchErrorsRef` escalation. So this is
a same-function inconsistency, not an unknown pattern.

### (c) Does `tradeCount = null` reach that copy, or does an earlier branch intercept? — **DEMONSTRATED: it reaches it**
Probe: rendered the real component; `trades` count read resolves
`{ data: null, count: null, error: { code: "57014", message: "canceling statement due to
statement timeout" } }`; every other read succeeds; analytics status `complete`.

```
=== A (READ FAILED)   code: GATE_INSUFFICIENT_TRADES
This account does not have enough trade history yet.We found only 0 filled trade(s) on this key.
We need at least 5 filled trades before we can compute a verified factsheet. …
=== B (TRULY EMPTY)   code: GATE_INSUFFICIENT_TRADES
This account does not have enough trade history yet.We found only 0 filled trade(s) on this key.
We need at least 5 filled trades before we can compute a verified factsheet. …
```

**A and B are byte-identical.** The user cannot distinguish "our read failed" from "your account
is empty". No interception: `csvRowCount ?? 0` is also 0, so `isDailyReturnsSourced` is false and
the `else` arm reaches `tradeCount < 5 → INSUFFICIENT_TRADES` (`strategyGate.ts:158-165`).

### (d) Is the state terminal, and is the control unconfirmed? — **PARTLY: terminal yes; SOLE no; unconfirmed yes**
- Terminal: `onTerminal` returns `"done"` at `:1153`, so the poll stops. **MEASURED.**
- Controls rendered, **MEASURED from the DOM**: `Retry | Copy diagnostics | Try another key`.
  `GATE_INSUFFICIENT_TRADES` carries `actions: ["try_another_key","request_call"]`, and
  `RECOVERABLE_ACTIONS` (`envelope.ts:54-57`) contains `try_another_key`, so `recoverable` is true
  and the Retry control **does** render. **The claim's word "primary" is right; it is not the sole
  control.**
- Unconfirmed: `onTryAnotherKey` → `WizardClient.tsx:864-877` → `void handleDeleteDraft()` —
  fire-and-forget, **no confirm dialog**, in contrast to `handleStartFresh` (`:728`) which
  140.3-10 deliberately routed through `setConfirmDelete(true)`. **MEASURED.**

### The half that was under-pled — **DEMONSTRATED, and it is worse**
The same missing `.error` in the fail-OPEN direction. `checkStrategyGate` executed directly:

```
=== readable timestamps: {"passed":false,"code":"INSUFFICIENT_DAYS","reason":"Trades span only 2.0 day(s)…"}
=== failed timestamp reads: {"passed":true,"code":null,"reason":null,"detail":null}
```

A 2-day strategy that the gate correctly **blocks** becomes `passed: true` the moment the
`earliest`/`latest` reads fail, because `computeSpanDays(null,null)` returns `null` and
`strategyGate.ts:165`'s `spanDays !== null &&` short-circuits the whole 7-day history gate.
The fabricated-copy half wrongly rejects a good account; **this half publishes an
under-history track record as verified**. For a product whose entire proposition is a verified
factsheet, that is the more expensive direction.

## Verdict
**CONFIRMED**, severity **held at CRITICAL and the remedy widened**: the fix must cover all
seven reads including the two timestamp reads, not only the count that produces the visible lie.
The remedy in the synthesis (a checked-read helper routed into `heavyFetchErrorsRef`) is correct
as written.

---

# C-4 — CONFIRMED-BUT-RE-GRADED (the count is 1, not 9)

## (a) Enumerate the codes that actually reach that render — **MEASURED: 11**
Every `setPhase("gate_failed")` site at HEAD, with the code it sets:

| Site | Code(s) |
|---|---|
| `:575` fresh-resume marker unreadable | `SYNC_FAILED` |
| `:604` + `:628` kickoff `!res.ok` | `KNOWN_KICKOFF_CODES` (`:147-174`) → `RATE_LIMITED`, `GATE_DRAFT_GONE`, `COMPOSITE_MEMBERSHIP_UNKNOWN`, `VALIDATION_FAILED` (×2 wire codes), else `SYNC_FAILED` |
| `:649` kickoff threw | `KEY_NETWORK_TIMEOUT` |
| `:713` heavy-fetch escalation | `SYNC_FAILED` |
| `:789` terminal `failed` | `GATE_ANALYTICS_FAILED` |
| `:1145` gate failure | `gateFailureToWizardError` → `GATE_INSUFFICIENT_TRADES`, `GATE_INSUFFICIENT_DAYS`, `GATE_ANALYTICS_FAILED`, `GATE_NO_DATA_SOURCE`, `UNKNOWN` |

Distinct = **11**. The claim's count is exact. (One of them, `UNKNOWN`, is *statically* reachable
only via gate codes `ANALYTICS_MISSING/PENDING/COMPUTING/INSUFFICIENT_CSV_HISTORY`, which
`onTerminal` cannot produce — it intercepts `failed` at `:786` and otherwise only runs on a
terminal-success status. Practically reachable = **10**.)

`DESTRUCTIVE_CONTROL_IS_WRONG_FOR` at `:1347-1354` has exactly **2** members
(`GATE_DRAFT_GONE`, `VALIDATION_FAILED`). Re-read at HEAD. **MEASURED.**

## (b) Does a non-destructive control render alongside? — **MEASURED, and this is where the claim breaks**
`ErrorEnvelope.tsx` renders exactly two possible controls: `Retry` (iff
`envelope.recoverable && onRetry`) and `Cancel` (iff `onCancel`, which `SyncPreviewStep` never
passes). **`request_call` renders NO control** — I read the component; there is no branch for it.
So each of the 11 states shows either `[Retry, <destructive>]` or `[<destructive>]` or
`[Back to strategies]`.

`recoverable` per code, computed from the shipped `actions` arrays:

| Code | `actions` | `recoverable` | Controls at HEAD |
|---|---|---|---|
| `SYNC_FAILED` | clear_and_retry, request_call | ✔ | Retry + destructive |
| `RATE_LIMITED` | clear_and_retry, request_call | ✔ | Retry + destructive |
| `COMPOSITE_MEMBERSHIP_UNKNOWN` | clear_and_retry, request_call | ✔ | Retry + destructive |
| `KEY_NETWORK_TIMEOUT` | clear_and_retry, request_call | ✔ | Retry + destructive |
| `GATE_ANALYTICS_FAILED` | clear_and_retry, request_call | ✔ | Retry + destructive |
| `UNKNOWN` | clear_and_retry, request_call | ✔ | Retry + destructive |
| `GATE_INSUFFICIENT_TRADES` | try_another_key, request_call | ✔ | Retry + destructive |
| `GATE_INSUFFICIENT_DAYS` | try_another_key, request_call | ✔ | Retry + destructive |
| `GATE_NO_DATA_SOURCE` | start_fresh, request_call | ✘ | **destructive ONLY** |
| `GATE_DRAFT_GONE` | start_fresh, request_call | ✘ | allow-listed → `Back to strategies` |
| `VALIDATION_FAILED` | request_call | ✘ | allow-listed → `Back to strategies` |

Rendered against the real component:

```
=== GATE_NO_DATA_SOURCE:          controls=[Try another key]
=== RATE_LIMITED:                 controls=[Retry | Try another key]
=== COMPOSITE_MEMBERSHIP_UNKNOWN: controls=[Retry | Try another key]
=== GATE_DRAFT_GONE:              controls=[Back to strategies]
```

**Precise count of genuine TRAP-4 (sole-route-to-a-destructive-control) violations: 1 —
`GATE_NO_DATA_SOURCE`. Not 9.** The synthesis already conceded this in its first sub-bullet;
its *heading* does not, and the heading is the thing a fix plan gets sized from. That is a major
re-grade: **9 → 1**.

Reachability of the one survivor, since a violation nobody can reach is not worth CRITICAL:
`GATE_NO_DATA_SOURCE` needs `!apiKeyId && tradeCount === 0 && csvRowCount === 0`
(`strategyGate.ts:114`). `apiKeyId` is falsy at this render on a **resumed composite draft**
(`WizardClient.tsx:195` initialises it from `initialDraft.api_key_id`, and a composite's
`strategies.api_key_id` is NULL by construction — stated in `SEAM_ROUTE_BUDGETS`' own
finalize-wizard comment), and a composite strategy_id has 0 `trades` and 0 `csv_daily_returns`
rows (the composite arm's comment at `:809-814` says so). It also needs `isComposite === false`,
which requires the kickoff 2xx body to fail to carry `composite: true`. **Reachable, but narrow.**
I grade the surviving TRAP-4 violation **HIGH, not CRITICAL**.

## (c) Does the five-clicks scenario reproduce? — **MECHANISM CONFIRMED, framing corrected**
- Limits: `/api/keys/sync` consumes **two** buckets — `keysSyncUserLimiter` 30/60s per user
  (`ratelimit.ts:103`, route `:116`) and `userActionLimiter` **5/60s** per (user, strategy)
  (`ratelimit.ts:97`, route `:123-131`). The 5/60s figure is correct. Six kickoffs inside 60s
  ⇒ 429 `{code:"RATE_LIMITED"}`. `handleKickoffRetry` (`:1303-1312`) bumps `kickoffNonce`,
  which re-runs the effect and re-POSTs. **MEASURED.**
- `isComposite` on the kickoff-`!res.ok` arm: it is only set true from a **2xx** body
  (`:643`) or from a COMPLETE composite marker on resume (`:562`). On every non-2xx kickoff it is
  still `false`. **DEMONSTRATED**: with `onReviewKeys` explicitly supplied, both `RATE_LIMITED`
  and `COMPOSITE_MEMBERSHIP_UNKNOWN` still render the button labelled **"Try another key"**, i.e.
  the `isComposite && onReviewKeys` escape at `:1399` is not taken and the destructive
  `onTryAnotherKey` handler is what fires.
- `handleDeleteDraft` on that path is genuinely unconfirmed (`WizardClient.tsx:876`
  `void handleDeleteDraft()`), and it cascades every `strategy_keys` member — the file's own
  `onReviewKeys` comment at `:852-858` says exactly that.

**So: the destruction mechanism reproduces, but the click sequence is not forced.** After the
fifth retry a `Retry` control is still on screen next to the destructive one, so this is
"we offer an unconfirmed cascade-delete labelled *Try another key* to a user holding a composite
draft, on an error that has nothing to do with their key" — not "the only way out destroys it".
The sharpest instance is **`COMPOSITE_MEMBERSHIP_UNKNOWN`**: a code that is *by name* about a
composite renders the single-key destructive control, because `isComposite` cannot be true when
that code is emitted. That instance is not called out in the synthesis and should be.

## (d) `GATE_INSUFFICIENT_TRADES` copy + spurious `recoverable` — **CONFIRMED, with one qualifier**
- Copy vs control: **DEMONSTRATED.** Rendered fix line 2 reads *"If this is a new strategy, keep
  trading and come back. Your draft is saved for 30 days."*, and the button beside it deletes that
  draft immediately and unconfirmed. `GATE_INSUFFICIENT_DAYS` carries the same sentence
  (`wizardErrors.ts:561`). Both true.
- `recoverable` derivation: **CONFIRMED.** `actions: ["try_another_key","request_call"]` and
  `RECOVERABLE_ACTIONS` (`envelope.ts:54-57`) contains `try_another_key`, so Retry renders —
  and the handler wired to Retry is `handleKickoffRetry`, which **does not** try another key. The
  render hint was earned by an action the control does not perform. That is a genuine
  mis-derivation and the synthesis is right to want `recoverable` split from
  "a kickoff retry will help".
- **Qualifier — "spurious" is too strong.** `handleKickoffRetry` re-POSTs `/api/keys/sync`, which
  enqueues a real re-sync, so for `INSUFFICIENT_TRADES`/`INSUFFICIENT_DAYS` a retry *after more
  trading* genuinely can change the outcome; it is useless only when clicked immediately. Grade it
  as **a mislabelled affordance, not a false one**.

## Verdict
**CONFIRMED-BUT-RE-GRADED.** Exact parts: 11 reachable codes, 2-member allow-list, 9 destructive
renders, unconfirmed cascade delete, the 30-days-vs-delete-now copy contradiction, the
`recoverable` mis-derivation, `isComposite` false wherever the kickoff arm fires.
**Dead part: "TRAP-4 is violated for ~9 of them." The sole-route count is 1.**
The remedy (INVERT the guard, split `recoverable`, confirm the delete) is unchanged by the
re-grade — but the *sizing* should be: 1 sole-route HIGH + a labelling/confirmation defect across
the other 8, not 9 criticals.

---

# C-5 — CONFIRMED (every link measured), with one correction

### (a) Is `captureToSentry` absent, and is there another sink? — **MEASURED: absent; no alternative**
- `grep -c captureToSentry` → **0** in `src/lib/resilient-fetch.ts` and **0** in
  `src/lib/ratelimit.ts`, while 122 files repo-wide reference it.
- The breaker's transition sink is a single `console.warn` at `resilient-fetch.ts:922`, and the
  function's own docstring at `:900-912` declares it a plain structured log *by design*.
- Both store-failure catches log and swallow: `:1027-1036` (`isBreakerOpen` → `{open:false}`) and
  `:1234-1242` (`recordSeamFailure` records nothing). Confirmed by reading both.
- **No alternative path exists.** `src/instrumentation.ts` is the only Sentry wiring: `register()`
  calls `Sentry.init` with **no `integrations` array**, so `captureConsoleIntegration` is not
  enabled and console output never reaches Sentry. The only other Sentry entry point is
  `onRequestError`, which fires on uncaught route errors — a caught-and-swallowed store failure is
  not one. A Vercel log drain cannot be verified from the repo; there is no evidence of one and
  no code that depends on one.

### (b) Do the limiter and the breaker have opposite postures? — **DEMONSTRATED, with a correction**
Executed both:

```
=== limiter on store REJECTION (VERCEL_ENV=production):
    {"success":false,"retryAfter":60,"reason":"ratelimit_misconfigured"}  misconfigured=true
=== limiter on store TIMEOUT sentinel (VERCEL_ENV=production):
    {"success":true}
=== breaker with NO store (VERCEL_ENV=production):
    {"open":false}
=== module-load notice:
    [resilient-fetch] Upstash not configured — the Railway circuit breaker is disabled (all seam calls pass through).
```

Opposite postures **CONFIRMED** for the rejection mode, and `resilient-fetch.ts:729-739` states the
inversion as deliberate policy.

**Correction the synthesis does not carry.** The limiter's posture is *outage-mode dependent*, and
I measured why. `@upstash/ratelimit` v2.0.8 races the store call against a 5000 ms default timeout
(`dist/index.js:766`, `:929-942`) that resolves `{success:true, reason:"timeout"}`. `checkLimit`
destructures only `{success, reset}`, so:
- Upstash answers **HTTP 5xx** → `@upstash/redis` v1.38.0 does **not** retry non-ok responses
  (`chunk-2X4SLXT7.mjs:194-202` throws `UpstashError` immediately) → `limit()` rejects fast →
  **fail CLOSED, 429 on the first click.**
- Upstash is **unreachable at the socket** → fetch throws → retried 5× with
  `Math.exp(i)*50` backoff ≈ 4.29 s of sleep plus six attempts' latency → **races the 5 s timeout**;
  either posture, non-deterministically.
- Upstash is **slow/hanging** → the 5 s sentinel wins → `{success:true}` → **fail OPEN**, and the
  request also eats 5 s of the user's latency budget.

This makes the finding *worse*, not better: during one outage the limiter can be closed for some
users and open for others, and nothing anywhere records which.

### (c) Count the routes yourself — **MEASURED: 3 of 15, exactly as claimed**
`SEAM_ROUTE_BUDGETS` (`resilient-fetch.ts:573-661`) has **15** rows. Cross-referencing a repo-wide
`isRateLimitMisconfigured` grep and a `checkLimit(` grep:

- **Split present (3):** `bridge`, `simulator`, `strategies/finalize-wizard`.
- **Limiter but no split → answers 429 (11):** `keys/validate-and-encrypt`, `strategies/create-with-key`,
  `strategies/composite/add-key`, `portfolio-optimizer`, `scenario/optimize`, `admin/match/recompute`,
  `keys/sync`, `verify-strategy`, `strategies/csv-validate`, `strategies/csv-finalize`,
  `keys/[id]/permissions`.
- **No limiter (1):** `admin/match/eval`.

3 / 11 / 1. Independently reproduced.

### (d) Does `KEY_RATE_LIMIT` blame the exchange? — **DEMONSTRATED, quoted verbatim**
`create-with-key/route.ts:223-235` emits `{ code: "KEY_RATE_LIMIT" }` at 429 for a denial by
**our own** `userActionLimiter`. `ConnectKeyStep.tsx:223` admits that code, and `formatKeyError`
returns:

```
KEY_RATE_LIMIT (what create-with-key:229 emits):
  title: The exchange rate-limited this request.
  cause: The exchange asked us to slow down. This is a transient, exchange-side throttle
         and not a problem with your key.
RATE_LIMITED (the honest sibling):
  title: You have reached our request limit.
  cause: We cap how often this action can run and this attempt went over the cap. Nothing was
         submitted and nothing was changed — the cap is ours, not your exchange's.
```

The two are **not** confused in this verdict: the honest sentence exists, and the route that
denies on our own limiter reaches for the other one. `composite/add-key:242` and
`composite/set-members:101` do the same. Three sites, one wrong verdict.
`wizardErrors.ts:1320-1327` explicitly documents that these two codes mean opposite things —
which makes this a live contradiction of the file's own stated contract, not an oversight.

### (e) Is "first click" right? — **DEMONSTRATED: yes**
`checkLimit`'s misconfigured branch depends only on the store call failing, not on any counter
state. The probe above ran against an identifier never seen before
(`"probe:first-request-ever"`) and returned `success:false, reason:"ratelimit_misconfigured"`.
No prior traffic is required. In the rejection mode this is true for every user simultaneously
for as long as the store is down.

## Verdict
**CONFIRMED**, severity held at CRITICAL, with the added measured nuance in (b): the limiter's
posture under a real Upstash outage is not a single posture but three, and none of them is
recorded anywhere.

The synthesis's sequencing note stands and should be enforced: routing these through
`captureToSentry` is worthless until **H-7** lands, because `captureToSentry` is un-awaited on a
runtime with no Sentry wrapper and no flush.

---

## What CI would have caught, and did not

None of these three would have been caught. There is no guard that renders `gate_failed` for each
member of the code set and asserts the control roster (C-4), no guard that drives a
resolved-with-`error` Supabase read through the single-key heavy arm (C-3), and no guard that
asserts an observability sink exists for the breaker's own transitions (C-5). Branch protection is
OFF by settled founder decision, so even if such guards existed they would have been advisory at
merge.

## Owed to the founder (unchanged by this verification)
`.planning/STATE.md`'s **"TRAP-4 five clicks in a REAL browser against a live composite draft"**
is still undischarged. The allow-list is not the discharge, and neither is this document: I
demonstrated the control roster in jsdom, not the delete against a live composite.
