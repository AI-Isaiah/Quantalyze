# 140-RED-traps — TRAP-by-TRAP audit of 140.1 / 140.2 / 140.3

Range `d1f742c9^..HEAD`, HEAD = `a77d607e`. Every verdict below is from a first-hand read or a
measured command at HEAD, not from a SUMMARY. Branch protection is OFF by settled founder decision,
so every CI gate named here **would have caught** — none **did stop**.

Working tree at audit time: `M TODOS.md` + `?? analytics-service/scripts/nautilus_factsheet.py`.
Nothing else. No file was written outside `.planning/`.

---

## Scoreboard

| TRAP | Verdict | Cost of the residual |
|---|---|---|
| **TRAP-4** — retry must not route into a destructive control | **VIOLATED** — allow-list is 2, **9 of 11** reachable codes are outside it, and the original scenario reproduces verbatim | **HIGHEST** — silent destruction of a composite draft + every `strategy_keys` member |
| **TRAP-3** — naming an arm can turn a vague error into a lie | **VIOLATED in siblings** — fixed at `keys/sync:159`, the identical idiom survives 2 files down in the same file and in 2 sibling seam routes; and 7 reads in `SyncPreviewStep` discard `error` and feed a *specific* lie | HIGH — a transport fault renders as "not enough trade history" / "Portfolio not found" |
| **TRAP-1** — scrubbing must cover every log site | **RESPECTED in the roster, VIOLATED in siblings** | HIGH — live end-user JWT + raw `api_secret` logged raw on a public route |
| **TRAP-5** — enumerate the whole class | **RESPECTED** (8 claims re-enumerated independently; 0 silent omissions) | — |
| **TRAP-8** — fixes collide | **VIOLATED once, caught in-phase** | MED — shipped a permanent dead-end wearing transient copy |
| **TRAP-9** — relaxing an assertion deletes coverage | **RESPECTED, twice, mechanically provable** | — |
| **TRAP-2** — discriminator must handle `text/plain` | **RESPECTED** by construction | — |
| **TRAP-6** — do not use `resetUsedTokens` | **RESPECTED** | — |
| **TRAP-7** — one deadline must not span the write chain | **RESPECTED** | — |
| **TRAP-10** — `import{X};export{X}` → `undefined` | **VIOLATED in letter, unfenced; premise does not reproduce** | LOW — dormant, zero consumers |

**Premise health of the register itself:** TRAP-4 and TRAP-1 now carry *stale enumerations* that
actively misdirect (below). TRAP-8's text is self-contradictory against how the phases read it.
TRAP-10's stated failure mode no longer reproduces. Details in §11.

---

## 1. TRAP-4 — **VIOLATED**. The guard is a 2-member allow-list on an 11-member render.

### 1a. The guard, and what it actually covers

`src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:1347-1358`:

```ts
const DESTRUCTIVE_CONTROL_IS_WRONG_FOR: readonly WizardErrorCode[] = [
  "GATE_DRAFT_GONE",
  "VALIDATION_FAILED",
];
const errorStateHidesDestructiveControl =
  errorCode !== null &&
  DESTRUCTIVE_CONTROL_IS_WRONG_FOR.includes(errorCode as WizardErrorCode);
```

Its render (`:1360-1408`) is reached by **every** `phase === "gate_failed"` state. When the code is
not in the list, the sole non-envelope control is:

```ts
onClick={isComposite && onReviewKeys ? onReviewKeys : onTryAnotherKey}   // :1399
```

`onTryAnotherKey` is `WizardClient.tsx:864-880`, and its body is
`void handleDeleteDraft();` (`:876`) — **fire-and-forget, no confirmation dialog**. The file's own
comment at `:855-857` states the delete "would cascade away every `strategy_keys` member".

### 1b. The eleven codes that reach that render, measured

`setErrorCode(...)` + `setPhase("gate_failed")` occur at `:575`, `:628`, `:649`, `:713`, `:789`,
`:1145`. Resolving each source (`KNOWN_KICKOFF_CODES` at `:147-174`,
`gateFailureToWizardError` at `src/lib/wizardErrors.ts:1256-1280`), and cross-referencing
`recoverable` (derived from `actions` via `RECOVERABLE_ACTIONS = {clear_and_retry, try_another_key}`,
`src/lib/envelope.ts:54-57, :88`):

| code | `actions` | `recoverable` → Retry rendered? | in allow-list |
|---|---|---|---|
| `GATE_DRAFT_GONE` | — | no | ✅ |
| `VALIDATION_FAILED` | `request_call` | no | ✅ |
| **`RATE_LIMITED`** | `clear_and_retry`,`request_call` | **YES** | ❌ |
| **`SYNC_FAILED`** | `clear_and_retry`,`request_call` | **YES** | ❌ |
| **`COMPOSITE_MEMBERSHIP_UNKNOWN`** | `clear_and_retry`,`request_call` | **YES** | ❌ |
| **`KEY_NETWORK_TIMEOUT`** | `clear_and_retry`,`request_call` | **YES** | ❌ |
| **`GATE_ANALYTICS_FAILED`** | `clear_and_retry`,`request_call` | **YES** | ❌ |
| **`UNKNOWN`** | `clear_and_retry`,`request_call` | **YES** | ❌ |
| **`GATE_INSUFFICIENT_TRADES`** | `try_another_key`,`request_call` | **YES (spuriously)** | ❌ |
| **`GATE_INSUFFICIENT_DAYS`** | `try_another_key`,`request_call` | **YES (spuriously)** | ❌ |
| **`GATE_NO_DATA_SOURCE`** | `start_fresh`,`request_call` | **no → destructive is SOLE control** | ❌ |

**9 of 11 outside the guard.**

### 1c. The original TRAP-4 scenario reproduces verbatim, at HEAD

TRAP-4's text: *"`/api/keys/sync` is limited to 5/60s and denies **codeless**; if codeless falls
through to a branch that renders the delete-draft button as the SOLE control, five clicks of your
own copy destroys the composite draft."*

140.3-10 closed the *codeless* half — every non-2xx arm now carries a code
(`src/app/api/keys/sync/route.ts:119, :129, …`). The **5/60s** half is untouched:
`route.ts:123-127` uses `userActionLimiter` on `keys-sync:${user.id}:${strategy_id}`, and
`src/lib/ratelimit.ts:94-95` is `makeLimiter(5, "60 s")`.

So the live path is:

1. A composite draft mid-first-computation has no `data_quality_flags.composite` marker yet, so the
   dq early-return at `SyncPreviewStep.tsx:560-565` does **not** fire and `isComposite` stays `false`.
2. Kickoff POSTs `/api/keys/sync`; the per-strategy bucket 429s → `code: "RATE_LIMITED"`.
3. `:600-604` maps it, `:628-629` sets `gate_failed`.
4. `RATE_LIMITED` is recoverable → `ErrorEnvelope` renders **Retry** (`:1379-1381`,
   `src/components/error/ErrorEnvelope.tsx:108, :178`).
5. `isComposite === false`, so `:1399` picks **`onTryAnotherKey`** — not `onReviewKeys`.
6. Retry re-POSTs into the same 5/60s bucket. Five clicks of our own copy, then the only other
   button on screen fires `void handleDeleteDraft()` and cascades away the composite draft and
   every member.

Step 5 is the sharp edge: the composite escape hatch is gated on client state
(`isComposite`) that is only ever set *after* a successful kickoff or a completed marker read —
i.e. it is guaranteed `false` on exactly the arms where the destructive button appears.

### 1d. The two worst individual codes

- **`GATE_INSUFFICIENT_TRADES`** (`wizardErrors.ts:543-554`). Its copy says *"keep trading and come
  back. **Your draft is saved for 30 days.**"* Its only other control **deletes that draft now**.
  It is also spuriously recoverable: `recoverable` is `true` only because the action is
  `try_another_key`, but the handler `onRetry` receives is `handleKickoffRetry` (`:1303-1312`),
  which re-runs the kickoff and re-evaluates an identical gate. The docblock at `:1290-1301`
  asserts the opposite —

  > *"The handler is supplied only where retrying is genuinely the right thing — `recoverable`
  > already encodes that, since it is derived from the code's own `actions`."*

  That is false for the two `try_another_key`-derived members. Before 140.3-10 no `onRetry` was
  passed at all, so `showRetry` was structurally false; **140.3-10's B-22 fix created this false
  affordance.**
- **`GATE_NO_DATA_SOURCE`** (`wizardErrors.ts:578-589`) is the one non-recoverable, non-allow-listed
  member: no Retry renders, so `onTryAnotherKey` is literally the *sole* control. Its own fix line
  is "Start fresh — the previous draft will be cleaned up", so the destruction is arguably intended
  — but the button is labelled **"Try another key"**, and it deletes without confirmation, unlike
  `handleStartFresh` which 140.3-10 deliberately routed through the confirm dialog
  (`WizardClient.tsx:703-724`).

### 1e. What the programme knew, and where it stopped

`src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.test.tsx:570-577` states the coupling
rule correctly and in the right place:

> *"Admitting a code is a CODE-SET change, so widen `DESTRUCTIVE_CONTROL_IS_WRONG_FOR`
> (`SyncPreviewStep.tsx`) IN THE SAME COMMIT if the new member's copy is non-recoverable."*

The rule is framed entirely as an obligation on **future** additions (`DEF-15-1`). Nobody applied it
to the members already there. And the rule as written is too narrow twice over: it only catches
non-recoverable codes (missing `GATE_INSUFFICIENT_TRADES`), and it ignores that a *recoverable* code
still renders the destructive button beside the Retry — which is the scenario TRAP-4 was authored
from.

`.planning/STATE.md` records "TRAP-4 five clicks in a REAL browser against a live composite draft"
as a **FOUNDER OWES, none done**. The manual check that would have caught this was deferred; the
allow-list was accepted as the discharge.

**Cost:** irreversible user data loss on the most-common transient failure of the wizard's most
expensive flow. Nothing else in this register is close.

---

## 2. TRAP-3 — **VIOLATED in siblings**. The destructure, not the terminal method.

140.3-10 fixed the *stated* instance: `src/app/api/keys/sync/route.ts:137-159` moves the ownership
read to `.maybeSingle()` and splits the transport arm from the not-found arm, and the comment at
`:138-139` names the real defect precisely — *"destructured as `const { data: strategy } =`,
**DISCARDING `error`**"*.

The identical idiom survives at HEAD:

**(a) In the same file, 180 lines below the fix.**
`src/app/api/keys/sync/route.ts:340-351`:
```ts
const { data: stratKey } = await supabase.from("strategies").select("api_key_id")…single();
if (stratKey?.api_key_id) {
  const { data: keyRow } = await admin.from("api_keys").select("exchange")…single();
```
A transport fault on either read silently leaves `resolvedSource = "okx"` (`:339`) — the wrong
venue, chosen by a failed read, with no signal.

**(b) Two sibling seam routes the same phase rewrote.**
`src/app/api/bridge/route.ts:114-125` and `src/app/api/simulator/route.ts:144-155` are byte-identical
in shape:
```ts
const { data: portfolio } = await supabase.from("portfolios").select("id")…single();
if (!portfolio) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 … });
```
That is TRAP-3's sentence with the nouns swapped: a transport error is named "Portfolio not found".
Both routes are in `SEAM_ROUTE_BUDGETS` and both received `CIRCUIT_OPEN` arms in `18e9b377` /
`f33cf542` — the plan had the file open.

**(c) The highest-cost instance: seven discarded `error`s feeding a *specific* lie.**
`SyncPreviewStep.tsx:1053-1114` destructures a seven-way `Promise.all` and discards **every**
`error`:
```ts
const [ { data: analytics }, { count: tradeCount }, { data: earliest }, { data: latest },
        { data: sample }, { count: csvRowCount }, keyRowResult ] = await Promise.all([…]);
…
const keyRow = keyRowResult.data;                                            // :1120
```
supabase-js resolves — it does not throw — on a PostgREST error, so the `catch (heavyErr)` at
`:1191` and its `heavyFetchErrorsRef` escalation (`:1204-1207`) never fire. The same file proves it
knows this: `:550-577` reads `const { data: dqRow, error: dqErr }` and explicitly fails closed to
`SYNC_FAILED` "when the marker row can't be read (error or missing row)". Two hundred lines later
that discipline is gone.

Consequence: a transient failure of the `trades` count yields `tradeCount ?? 0` → `checkStrategyGate`
returns `INSUFFICIENT_TRADES` → the user reads **"This account does not have enough trade history
yet."** — a specific, false, and unfalsifiable claim about *their* account, caused by *our* read
failing. A failed `api_keys` read (`:1112`, error discarded) sets `isLedgerBacked: false`, routing a
Deribit ledger-backed strategy onto the trade branch and producing the same lie.

**And it converges with §1:** the lie's only escape hatch is `GATE_INSUFFICIENT_TRADES`, whose sole
alternative control deletes the draft.

---

## 3. TRAP-1 — **RESPECTED in the roster, VIOLATED in the siblings the roster cannot see**

The leaf `src/lib/seam-redaction.ts` is sound (env names read at call time `:225-230`, exact
`split/join` never regex `:299`, plain-object branch preserves SQLSTATE `:391-399`), the Sentry
chokepoint scrubs (`src/lib/sentry-capture.ts:124-162`), the per-request floor is correctly
one-sided —
```ts
if (!candidate.perRequest && candidate.value.length < MIN_REDACTABLE_SECRET_LENGTH)   // :281
```
so short per-request secrets *are* redacted — and over-redaction is pinned:
`src/lib/seam-redaction.test.ts:142-149` asserts `ECONNREFUSED 10.0.0.1:8002` survives, against
`messageBody()` so the leaf's own notice cannot self-satisfy it.

**The hole is the guard's completeness predicate.** `src/lib/seam-log-coverage.test.ts:55-64`
hand-types 8 files; its auto-detection (`CREDENTIAL_BEARING_CALLS`, `:329`) keys on
`validateKey(` / `encryptKey(` and **does not know about `postProcessKey(`** — the call that puts raw
`api_key`/`api_secret`/`passphrase` in the body and `X-User-Access-Token` in the headers. The three
routes doing exactly what TRAP-1 describes are therefore invisible to it:

- **`src/app/api/verify-strategy/route.ts` — worst, and public/anonymous.** It declares
  `perRequestSecrets = [userAccessToken, body.api_key, body.api_secret]` (`:248-252`) and applies
  them **to Sentry only**, then logs raw to Vercel at `:384`, `:423`, `:440`.
- **`src/app/api/keys/sync/route.ts`** — imports `scrubSeamError` (`:13`), uses it at `:164`, then
  logs bare at `:222`, `:267`, `:292`, `:384`, `:442`, `:456`. Textbook respected-here-violated-there,
  *within one file*.
- **`src/app/api/strategies/csv-finalize/route.ts`** — forwards the live JWT at `:1197`, logs bare at
  `:532`, `:632`, `:677`, `:689`, `:820`, `:1231`, `:1367-1368`.

`seam-redaction.ts:72-74` itself names the reason `SUPABASE_SERVICE_ROLE_KEY` is on the env list —
"several seam sites log Supabase errors" — and those are precisely the lines above.

Also open: `src/lib/process-key-client.ts:542` passes only the JWT to `scrubSeamError` at the site
its own comment calls *"THE undici site"* (`:533-539`), while the same request's `args.context`
carries the raw exchange credentials. And C-13's TypeScript half is still live —
`csv-finalize/route.ts:1239-1242` returns `unified_response_body: unifiedBody` in `debug_context`,
and `process-key-client.ts:646` relays any non-2xx upstream body untouched. The Python half **is**
closed (`analytics-service/main.py:368-424`, `_validation_detail()` builds a scalar from `type`+`loc`
only, registered app-global at `:424`), so the echo now depends entirely on that handler holding,
with no TS-side allowlist behind it.

---

## 4. TRAP-5 — **RESPECTED**. Eight class-closure claims independently re-enumerated.

I re-derived each denominator from the codebase rather than trusting the commit subject. No silent
omission found.

| claim | commit | claimed | measured | verdict |
|---|---|---|---|---|
| 7 venue-transient sites answer 424 | `1f8ad052`,`d423d7ff` | 7 | 7 (`grep -rn "raise VenueTransientHTTPException"` → `exchange.py:184,199,392,408,430,619` + `portfolio.py:2354`) | ✅ |
| 9 IP-keyed routes rekeyed | `e26f0520` | 9 | 9 of **10** — `simulator.py:92` is the 10th, **enumerated** as FINDING-10 and fenced by an *equality* assertion (`test_limiter_identity.py:103` `IP_KEYED_QUARANTINE = frozenset({"simulator.py"})`, `:476`) so the exemption can neither grow nor rot | ✅ |
| 9 analytics-client wrappers mint `X-Tenant-Claim` | `5c3c4715` | 9 | 9/9, and omission is **unrepresentable**: `tenantId: string` is required on the options type (`analytics-client.ts:269`) | ✅ |
| 9 body-read sites through the core | `85278c52` | 9 | 9/9; uninstrumented path unreachable (`resilient-fetch.ts:1445`, wired `:1842`); one written exemption in `SEAM_EXCLUSIONS` (`:674`) | ✅ |
| 9 zero-capture seam routes | `00aeddbc`+`b22a2047` | 9 | baseline at `00aeddbc~1` measured **exactly 9** of the 15 `SEAM_ROUTE_BUDGETS` routes at zero; all 15 ≥1 at HEAD | ✅ |
| 10 seam breaker copies re-pointed | `3441d19f` | 10 | 10/10; the only production declaration left is `src/lib/seam-copy.ts:66`; the 10th binds via alias `CIRCUIT_OPEN_HUMAN_MESSAGE` | ✅ |

**One subject over-claims.** `8aee95c9` "every `/process-key` consumer branches on `ok`" is true of
**2 of 6** consumers (`verify-strategy:309`, `csv-finalize:1228`). The other four gate on shape
guards instead. It is not exploitable at HEAD — exactly one implicit-200 `ok:false` arm exists
(`process_key.py:779`), its only consumer is `csv-validate`, which proxies the body and whose
terminal reader *does* branch (`CsvUploadStep.tsx:275`) — but `csv-validate/route.ts:261` is a
synchronous-path consumer of that arm saved by a **browser component**, not by the route. The
ledger scopes this correctly; the commit subject does not.

Two venue-attributable arms still answer 500 (`exchange.py:781`, `portfolio.py:2326` — the latter
has no `ccxt.BaseError` arm at all, unlike its two siblings). Both are written down as M-4/M-5 in
`140.1.2-PATTERNS.md:544-545` with reasons. Enumerated, not dropped.

---

## 5. TRAP-8 — **VIOLATED once, caught in-phase**

The rule was respected *deliberately* in two places, and both said so:
`11000b38` — *"C-8: one change, because three separate ones trip TRAP-4"* — and `b98dee1e` —
*"comment inverted same-commit"*.

The collision is `0a73a959` → `e30b0a54`, both in
`src/app/api/strategies/finalize-wizard/route.ts`, both inside 140.2:

- `0a73a959` (140.2-10) added `.limit(MAX_COMPOSITE_MEMBERS)` with a `>=` refusal.
- `e30b0a54` (140.2 ME-02) removed it: *"the cap was off by one … the usable maximum was cap − 1 …
  a genuine 10-member draft got 503 COMPOSITE_MEMBERSHIP_UNKNOWN … **forever**, with the client
  rendering a retry affordance and the user having no path forward."*

A cap fix shipped a permanent dead end wearing transient copy and made every existing at-cap
composite un-finalizable. It was caught by the phase's own review round, not by a plan-check. HEAD
carries the repair (`route.ts:892` `.limit(MAX_COMPOSITE_MEMBERS + 1)`).

Beyond that pair I found no reintroduction. `src/lib/resilient-fetch.ts` took 15 commits and 93
add-then-remove line pairs, but sampling them shows consolidation into leaves, not reversal.

⚠️ **The residual `e30b0a54` deliberately left open is now §1's problem**: *"the arm still shares the
transient membership-unknown envelope, and a permanent condition should not render a retry
affordance."* At HEAD `COMPOSITE_MEMBERSHIP_UNKNOWN` is still recoverable and still not in
`DESTRUCTIVE_CONTROL_IS_WRONG_FOR`.

---

## 6. TRAP-9 — **RESPECTED, twice, mechanically**

- `07bdcb32` reconciled 25 casualties. Measured: `git show 07bdcb32 | grep -c "^-.*expect("` → **0**.
  Zero assertions removed; +17 net cases. The one case that had to change was rewritten *stronger*
  (its premise — forcing `ok: true` over an upstream `ok: false` — was itself the defect).
- `a77d607e` is the model outcome. The GC-4 prose cleanup in `2d58fd45` touched
  `src/components/charts/TouchTooltip.tsx`, which `phase-52-frozen-spine-guards.test.ts` freezes
  zero-diff. Rather than unfreeze an island to land a **comment**, the edit was reverted and the
  three stale counts routed to `DEF-G2-3`. *"Removing an island to land a COMMENT edit would delete
  a working fence — TRAP-9, which this plan is bound by."* Correct call.

---

## 7. TRAP-2 — **RESPECTED** by construction

`src/lib/seam-discriminator.ts:438-445` terminates on 500 **before** any body is consulted:
```ts
if (status === 500) return { attributability: "service-permanent", counts: false, breakerKey: null, dependency: null };
```
and `:447-449` reads a dependency only on 503. `resilient-fetch.ts:1567-1579`'s
`readDependencyBody` returns `undefined` unless `status === 503` and swallows a `text/plain` parse
failure into the global key — so a peek can only make a key *more specific*, never flip counting.
A caller's `res.json()` on `text/plain` throws `SyntaxError`, rethrown raw with **no** `recordOnce`
(`:1475-1477`). Measured: `npx vitest run src/lib/resilient-fetch.test.ts
src/lib/seam-discriminator.test.ts` → **170 passed**, including
`seam-discriminator.test.ts:238` "500 bodyless text/plain (TRAP-2 — Starlette's unhandled exception)".

## 8. TRAP-6 — **RESPECTED**

`resetUsedTokens` appears only in two pre-existing unrelated routes
(`portfolio-optimizer/route.ts:124`, `account/export/route.ts:367`); **zero** hits in
`resilient-fetch.ts`, `tests/redis/seam-breaker.redis.test.ts`, or `src/test/helpers/upstash-breaker.ts`.
`resilient-fetch.ts:182-186` names the ban and accepts the [30s, 60s] recovery band instead. The
breaker owns bounded keys: counter `breaker:breaker:<key>:failures:<window>` PEXPIREd at 61s by the
unmodified slidingWindow Lua; lock `breaker:<dep>` written `{ ex: 90 }` (`:1155`, `:1167`, `:1215`);
`analytics: false` (`:787`) — which is exactly what prevents the unbounded `…:events:*` `TTL=-1`
growth the finding measured. The Redis lane never touches production: `vitest.redis.config.ts`
includes `tests/redis/**` only, against digest-pinned local containers, and cleanup is
`keys("breaker:*")`+`del`, never `FLUSHALL`.

## 9. TRAP-7 — **RESPECTED**

All three recording arms `await` on the caller's path — `resilient-fetch.ts:1508`, `:1804`, `:1828`
— and `recordOnce` awaits `recordSeamFailure` (`:1726`). Grep for `void (async` / `(async () => {`
in the file: **zero**. No floating promise. The request deadline
(`const deadline = AbortSignal.timeout(timeoutMs)`, `:1731`) has exactly one consumer — `signal:
deadline` inside `fetch` (`:1764`) — while the breaker store carries its **own** per-command budget
via `signal: () => AbortSignal.timeout(BREAKER_STORE_TIMEOUT_MS)` (`:723`). So when the request
deadline fires, the write gets a fresh 2000 ms budget rather than an already-aborted signal. Log
direction branches on `isDeadlineError` (`:1337`, used `:1486-1490`, `:1794-1798`). The open
transition is single-command (`SET key value GET EX ttl`, `:1215`) so a deadline cannot half-complete
it, and A-25 (`:1150`) stops a timed-out long-budget request re-arming a lock it never observed.

## 10. TRAP-10 — **VIOLATED in letter, unfenced; premise does not reproduce**

Two live sites of the banned idiom in files modified in range:
- `src/lib/resilient-fetch.ts:3` `import { CircuitOpenError, SeamBodyReadError } …` → `:76`
  `export { CircuitOpenError, SeamBodyReadError };`
- `src/lib/analytics-client.ts:28` → `:49` `export { CircuitOpenError };`

Nothing prevents it: `eslint.config.mjs` has no `no-restricted-syntax` for `ExportNamedDeclaration`,
and none of the 9 rules in `tools/eslint-plugin-quantalyze/rules/` addresses re-exports. The only
adjacent guard, `seam-errors.purity.test.ts:119`, scans **the leaf** — the opposite direction — so
it cannot see either violation.

Harm is currently nil: `npx vitest run src/lib/resilient-fetch.test.ts -t "re-exports the leaf's
CircuitOpenError class identity"` → **1 passed** (`:462` asserts
`mod.CircuitOpenError === leaf.CircuitOpenError`), and repo-wide grep finds **zero** consumers
importing either class from `resilient-fetch` or `analytics-client`. Both re-exports are documented
back-compat (`resilient-fetch.ts:60-75`, `analytics-client.ts:37-48`).

---

## 11. Are the TRAPs themselves still correct?

Three carry premises that are now false or stale, and all three are load-bearing.

### ⚠️ TRAP-4's premise is stale in the direction that misdirects — **fix this first**

Its text pins the hazard to *"denies **codeless**"*. 140.3-10 closed that: every `/api/keys/sync`
non-2xx arm now carries a code. A plan reading TRAP-4 literally will look for the codeless
fall-through, find it closed, and conclude the trap is discharged — which is exactly the reasoning
`SubmitStep.test.tsx:570-577` encodes, and exactly why the nine live members in §1b went unexamined.

The 5/60s half **is** still true (`ratelimit.ts:94-95`). The correct restatement is the property, not
the mechanism:

> *A terminal error render must not offer a destructive control as the sole affordance, and must not
> place a retry beside one. This is a property of the **render**, not of a code list — audit the
> reachable code set of every terminal render, and treat `recoverable` as unreliable: it is derived
> from `actions` and `try_another_key` makes a code "recoverable" whose only retry is destructive.*

### ⚠️ TRAP-1's site enumeration is stale and reads as the class

*"there are ≥5, incl. `keys/validate-and-encrypt` and `keys/[id]/permissions`"*. Those two are on
the 8-file roster and are clean. The live leaks are at three files the trap never names
(`verify-strategy`, `keys/sync`, `csv-finalize`). Naming two specific siblings inside a rule about
completeness invites treating the named pair as the boundary — the instance-not-class defect this
programme keeps producing. Strike the site list; keep the two-sided property (cover every site;
do not destroy `ECONNREFUSED`).

### ⚠️ TRAP-8's text contradicts how the phases read it

The register says *"Sequence and **isolate** them; two fixes touching the same file in one pass
reintroduced each other's bugs."* The operative reading in practice — and in the brief — is the
opposite: *opposite-direction edits to one file must be **ONE** task* (`11000b38`: "one change,
because three separate ones trip TRAP-4"). Both readings are defensible from the text, which means
the rule does not discriminate. Its evidence (`C5 undid C6`) died with the scrapped batches and is
unauditable at HEAD. Restate as: **edits that could reverse each other belong in one task; edits that
merely share a file belong in separate commits.**

### TRAP-10's stated failure mode no longer reproduces

`mod.X === leaf.X` holds under vitest 4.1.10 at HEAD (measured, §10). Keep the rule as a style
constraint if you like, but stop treating "resolves to `undefined`" as a live fact — a plan that
believes it will mis-diagnose the next `undefined` it meets.

### Still correct as written

TRAP-2, TRAP-3, TRAP-5, TRAP-6, TRAP-7, TRAP-9. TRAP-3 in particular is *more* correct than the
register implies: the defect is the **destructure**, not `.single()`, and §2 shows it is live in
four places.

---

## 12. Bonus: the "a pointer cannot drift" failure, measured

`1f8ad052` (140.3-06) is the **sole** commit touching `analytics-service/routers/exchange.py` after
140.1.2's three coordinate-correcting docs commits (`9a82d4ea`, `335c4fbf`, `b70ad840`). It is
`+30 −9` on that file — **net +21** — and its own message ends *"Zero TypeScript modified."* It did
not touch `STATUS_CONTRACT.md`. Every `exchange.py` coordinate above the shift is now off by exactly
21, in three files, all of which label the numbers **evidence**:

**`analytics-service/docs/STATUS_CONTRACT.md:133-138`** — *"`VenueTransientHTTPException`'s seven
raise sites **at HEAD**: `exchange.py:163, :178, :371, :387, :409, :598`"*. Measured real sites:
`184, 199, 392, 408, 430, 619`. **6 of 7 stale.** (`portfolio.py:2354` is correct.) Of 22 coordinates
I sampled across that document, **14 miss** — including `main.py:574` and `:608`, which land on
blank lines.

**`src/lib/resilient-fetch.ts:350-364`**, under the banner *"⚠️ EVERY ENTRY IS EVIDENCE, NOT
INTUITION. Derived 2026-07-27"*: claims `exchange.py:314,324` (mt5-gateway 503) → real `335,345`;
`exchange.py:626` (kek) → real `647`; `exchange.py:276,287` → real `297,308`; `exchange.py:547`
(venue 424) → real `568`.

**`src/lib/seam-constants.pin.test.ts:140-146`** repeats the same stale `exchange.py:314,324` and
calls the values EVIDENCE.

**The substance is intact** — I verified each real site's status (`exchange.py:335,345` are 503
`MT5_GATEWAY_UNREACHABLE`; `:297,308` are 500 `MT5_GATEWAY_UNCONFIGURED`; `:647` is `kek`; `:568` is
the venue) — so `EXPECTED_DEPENDENCIES` is still correct and nothing reddened. That is precisely why
this went unnoticed: the guards were deliberately re-based onto AST fingerprints and value maps
(`3bca3c73`, `0ff9446e` — the right call), which left the prose coordinates they replaced entirely
unfenced. A reader who "re-derives by grep before trusting them", as `STATUS_CONTRACT.md:139`
instructs, is fine; a reader who trusts the words **"at HEAD"** is not.

Note the TypeScript-side pointers I sampled are **accurate**
(`finalize-wizard/route.ts:1551` ✓, `wizard/page.tsx:120` ✓). The drift is entirely
Python-coordinate, entirely attributable to one commit, and entirely repairable with one `grep -n`
pass.

---

## Recommended order

1. **TRAP-4** (§1) — widen the guard to the property, or better, invert it: render the destructive
   control only for codes that *earn* it. Split `recoverable` from "a kickoff retry will help".
   Do the founder's five-clicks browser check against a live composite draft.
2. **TRAP-3 (c)** (§2) — capture `error` on the seven `SyncPreviewStep` reads and fail closed to
   `SYNC_FAILED`, the way `:550-577` already does. Ships with #1; same file, same render.
3. **TRAP-1 siblings** (§3) — widen `CREDENTIAL_BEARING_CALLS` to include `postProcessKey(`; close
   `verify-strategy:384/423/440` first (public route, live JWT + raw secret).
4. **TRAP-3 (a)(b)** (§2) — `keys/sync:340,347`, `bridge:114`, `simulator:144`.
5. **§12 coordinates** — one grep pass across three files.
6. **TRAP-10** (§10) — two-line change to `export … from`, plus a `no-restricted-syntax` rule so it
   cannot come back.
