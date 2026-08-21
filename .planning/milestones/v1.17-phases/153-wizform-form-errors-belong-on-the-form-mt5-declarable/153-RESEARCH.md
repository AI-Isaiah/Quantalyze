# Phase 153: WIZFORM — Form errors belong on the form (+ MT5 declarable) - Research

**Researched:** 2026-08-08
**Domain:** In-repo mechanism archaeology — seam budget arithmetic, breaker invariants, derived-roster source scanning, inline form validation, closed-set pins. **Zero new external dependencies.**
**Confidence:** HIGH (every claim below is `[VERIFIED: source]` against HEAD unless tagged otherwise)

---

## Summary

This phase touches almost no new ground: **every mechanism it needs already exists in this
repo**, and the work is (a) extending three of them, (b) deliberately re-cutting two pins,
and (c) deleting one gate. The research below names each mechanism, its file, and what a
correct extension looks like.

Three findings change the shape of the plan and are not in CONTEXT.md or the UI-SPEC:

1. **The A-25 breaker-tombstone invariant is coupled to the LONGEST seam budget, and its
   test cannot see the coupling break.** `BREAKER_LOCK_TOMBSTONE_S = 60` is justified in
   `resilient-fetch.ts:270-274` by `COOLDOWN(30) + TOMBSTONE(60) = 90s ≥ 60s` (the longest
   budget, `process-key-sync`). A **90 000 ms** MT5 arm keeps that inequality true *exactly*
   (90 ≥ 90). A **120 000 ms** arm breaks it (90 < 120) — and the pin at
   `seam-constants.pin.test.ts:713-718` asserts `60_000 >= 60_000 - 30_000`, **both sides
   hand-typed literals**, so it stays GREEN while its own stated premise becomes false.
   ⇒ **Recommend 90 000 ms**, the top of the founder's D-01 range that requires no second
   constant re-cut. If the planner picks anything above 90 000 ms, `BREAKER_LOCK_TOMBSTONE_S`
   MUST rise to `budget_s − 30` in the same commit.

2. **WIZFORM-04's "is the call needed?" and MT5-14's "stop demanding a ccxt probe" are the
   SAME mechanism.** `runScopeBroadeningProbe(apiKeyId)` is called at
   `finalize-wizard/route.ts:904`, three lines after `apiKeyExchange` is already resolved
   into scope (`:856`). A per-venue capability `scopeProbeSupported` (default `true`,
   `false` for `mt5`) gates that one call site and satisfies D-06, D-14(a) and D-07
   simultaneously — with **zero change to `SEAM_ROUTE_BUDGETS`** (the declared legs stay a
   worst-case bound, which is the safe direction).

3. **The derived-roster mechanism WIZFORM-02 D-09(a) asks for ALREADY EXISTS and is
   CI-wired.** `src/lib/wizardErrors.invariant.test.ts` derives emitted codes from route
   source on disk (`EMITTER_RE` at `:100`, comment-stripped via `src/lib/source-scan.ts`),
   compares them to the hand-typed rosters, and carries self-tests and an anti-vacuity
   floor. The class fix is to add a **third `ROUTES` entry** (`finalize-wizard` ↔
   `SubmitStep.KNOWN_FINALIZE_CODES`) and widen the emitter predicate past `status: 400`.
   Doing so immediately surfaces **two live UNKNOWN instances nobody has recorded**:
   `COMPOSITE_UNSUPPORTED_UNIFIED` and `draft_state_invalid` reach `SubmitStep` with no
   wizard member and render `UNKNOWN` today (documented as an accepted residual at
   `wizardErrors.ts:2149`).

**Primary recommendation:** Set the MT5 client budget to **90 000 ms** via a **new
`SEAM_BUDGETS` row** selected by a `budgetKeyFor(exchange)` helper (mirroring
`process-key-client.ts:111`'s `budgetKeyFor(flowType)`), declare it on the three
`validate-key` routes as a **labelled `branch`** so SC-4b takes a MAX not a SUM, gate the
finalize-wizard probe on a shared per-venue capability record in `closed-sets.ts`, and
extend `wizardErrors.invariant.test.ts` rather than writing a new roster mechanism.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Timeouts and budgets (WIZFORM-05) — founder-locked, do not re-derive**

- **D-01: The client `validate-key` budget goes venue-aware and LONG on the MT5 arm —
  target ~90–120s, NOT 35s.** Founder 2026-08-07, verbatim: *"why not give it more than
  40 seconds? I don't need absolute exact time data. if it is 2 minutes old, that is
  fine."* ⛔ **35s is a trap number.** It appears three times in REQUIREMENTS.md and
  ROADMAP.md, but always as a description of the *existing server-side bug*
  (`_MT5_PROBE_TIMEOUT_S`), never as a target. A slow MT5 broker login legitimately
  takes **35–70s+** to fail, so a 35s client ceiling would still abandon the request
  before the honest verdict lands and would keep producing `UNKNOWN`.
- **D-02: The `+ 5.0` in `_MT5_PROBE_TIMEOUT_S = MT5_REQUEST_TIMEOUT_S + 5.0`
  (`routers/exchange.py:62`) is NOT a deadline budget and must not be treated as one.**
  It is a margin over the inner rpyc `sync_request_timeout` (`mt5_client.py:82`, default
  30s) so the inner client timeout fires first and yields a real MT5 error rather than a
  bare `asyncio.TimeoutError` with no venue detail. It is a diagnostic-ordering device
  between two nested timeouts.
- **D-03: The server gets ONE bounded end-to-end probe deadline, replacing three
  independent 35s stages.** Today `_MT5_PROBE_TIMEOUT_S` is applied separately at
  `routers/exchange.py:328` (connect/login), `:380` (probe) and `:456` (close), so the
  honest worst case is ~105s **before** the single-terminal MT5 lock queue wait.
- **D-04: The invariant to satisfy is `client ceiling > server worst case`**, sized
  END-TO-END so lock-queue wait sits *inside* the client budget, not on top of it.
  Every change must survive `src/lib/seam-budgets.invariant.test.ts`, which recomputes
  per-request sums together with `encrypt-key`. That test is the thing that stops a
  naive bump.
- **D-05: A long budget requires honest in-progress copy, never a silent spinner.** A
  ~2-minute wait with no explanation is a worse product than a fast wrong answer.

**Submit-path re-validation (WIZFORM-04) — founder-locked**

- **D-06: The mandated question "is the per-submit re-validation needed at all?" is
  ANSWERED: no.** The founder's staleness tolerance settles it — a recent successful
  validation plus a live synced series is sufficient evidence. **Target shape: zero live
  MT5 calls on submit.** Drop the live re-check, or cache it behind a minutes-scale TTL.
- **D-07: Do NOT open with a retry loop.** The requirement is explicit that a naive retry
  multiplies the budget this route is capped on and feeds `breaker:railway`; retrying
  into an open breaker is how one slow venue takes down every other user's submits.
  Retry is only discussable AFTER D-06 removes the call.

**Honest codes (WIZFORM-02) — ⚠️ SCOPE CORRECTED BY SOURCE OBSERVATION**

- **D-08: The "SECOND LIVE INSTANCE" roster gap is ALREADY CLOSED — the 3-member
  stopgap landed.** Verified at source 2026-08-08: `KNOWN_CREATE_WITH_KEY_CODES`
  (`ConnectKeyStep.tsx:312-314`) and `KNOWN_ADD_KEY_CODES` (`MultiKeyConnectStep.tsx`)
  BOTH now contain `SERVICE_UNREACHABLE`, `KEY_MISSING_READ_SCOPE` and
  `KEY_PERMISSION_DENIED` (22 members each, identical sets). ⛔ Do not re-fix this.
  REQUIREMENTS.md still describes it as open ("A 3-member stopgap may land earlier via
  hotfix; the class fix stays here") — the stopgap is the thing that landed.
- **D-09: What REMAINS is the CLASS fix, and it is two distinct problems.**
  **(a)** Both rosters are still **hand-listed** `new Set([...])` literals — the header
  even says "enumerated from the route rather than remembered", which is a convention,
  not a mechanism. The sweep must be **derived from the emitting sites** with a coverage
  assertion, so the next added code cannot silently fall to `UNKNOWN`.
  **(b)** **All nine `validatePayload` 400 arms in `finalize-wizard/route.ts` are still
  code-less** — verified at source: `:347` ("Invalid request body"), `:374`, `:383`,
  `:396` ("description must be 10-5000 characters" — the arm that cost 3 submits),
  `:405`, `:428`, `:439`, `:474`, `:503`.
- **D-10: Re-derive every line number from source; the ones in REQUIREMENTS.md have
  drifted.**

**Inline field validation (WIZFORM-01)**

- **D-11: The client already knows the rule — refuse at the field.** The 10–5000
  character description bound is enforced server-side at `finalize-wizard`; the same
  bound must refuse inline, next to the field, with the offending input highlighted,
  before submit is reachable.
- **D-12: The allocation-amount form added by Phase 150 (OWN-03) is IN SCOPE.** A
  freshly-shipped wizard step must not re-introduce the terminal-envelope class this
  phase deletes.
- **D-13: The acceptance bar is behavioural, not cosmetic.** The observed failure was
  not "an ugly error" — a misleading error sent the founder to **corrupt unrelated
  fields** (adding sFOX to an MT5 account). A fix that makes the error prettier but
  still ambiguous about WHICH field is wrong does not satisfy WIZFORM-01.

**MT5 declarable (MT5-14)**

- **D-14: Both halves ship together, or neither.** (a) the ccxt scope probe must handle
  MT5 — or `finalize-wizard` must stop demanding a ccxt probe for a venue that has none
  (read-only is already proven by `_validate_mt5_key`); (b) the catch-all that maps
  **every** probe failure to `KEY_NETWORK_TIMEOUT` must stop, so a PERMANENT
  venue-unsupported condition stops being reported as a temporary blip that says "try
  again". The founder clicked Retry **five times** against a failure that can never
  succeed.
- **D-15: Do not ship the widening without the preselect.** MT5 must be preselected from
  the key already connected, not asked again.
- **D-16: The `closed-sets.mt5-flag` no-widening pin WILL go red — that is the guard
  working.** Re-cut it deliberately **in the same commit**, with its reasoning updated.
  `closed-sets.ts:119-122` currently states mt5 stays OUT of `UI_EXCHANGE_CODES` /
  `EXCHANGES` / `FUNDING_EXCHANGES` / `CRYPTO_EXCHANGES` regardless of the flag; that
  exclusion was a deliberate decision that MT5-14 now outgrows. ⛔ This is NOT the MT5-11
  drift class — do not route around it.

**Venue-shaped copy (WIZFORM-03)**

- **D-17: "Switch to a different exchange" must never render for MT5.** Unwinnable-remedy
  class — the account IS the venue. Same family as MT5-13 and the deleted "0 trades"
  message.

### Claude's Discretion

- Whether WIZFORM-05's client-side fix is a per-venue entry in `SEAM_ROUTE_BUDGETS` or a
  venue parameter on the existing entry — either satisfies D-01/D-04.
- The mechanism for the derived roster in D-09(a) (generated union, exported const from
  the route module, or a build-time assertion) — the requirement mandates the property
  ("driven from the emitting sites"), not the technique.
- Exact inline-validation presentation, within DESIGN.md.

### Deferred Ideas (OUT OF SCOPE)

- Wizard draft-aware entry chooser, stale-screen root cause, token-less credential dedup
  — **Phase 154** (WIZCONT/STALE).
- Live MT5 numeric verification against an external oracle on a trading day — **Phase 155**
  (MT5-VERIFY), human- and calendar-gated.
- ⚠️ **Open founder decision carried from the v0.54.0.0 land, NOT this phase:**
  `size_at_decision_usd` is recorded on a NOTIONAL basis while the composer sizes on an
  EQUITY basis. Logged in `TODOS.md`; decide before the next mandate commit on a
  derivatives book.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **WIZFORM-01** | Field-level rules refuse inline at the field, never a terminal envelope | §Pattern 4 (the house inline-validation shape: `Field` + `aria-[invalid=true]:border-negative`), §Pitfall 2 (the FLAG-3 `handleSubmit` predicate trap), §Finding 8 (there is **no** `MIN_DESCRIPTION_CHARS` constant — it must be minted) |
| **WIZFORM-02** | No `UNKNOWN` for a classified verdict; sweep DERIVED from emitting sites | §Finding 3 (`wizardErrors.invariant.test.ts` is the existing derivation), §Table A (the nine 400 arms + proposed codes), §Finding 4 (two live UNKNOWN instances the derivation will surface) |
| **WIZFORM-03** | No venue-shaped copy for venues it cannot apply to | §Pattern 3 (capability record in `closed-sets.ts`), §Finding 6 (`buildEnvelope` passes `copy.fix` through verbatim ⇒ gating must live inside `formatKeyError`) |
| **WIZFORM-04** | Transient seam failure absorbed; answer "is the call needed" first | §Finding 2 (one gate at `route.ts:904`, `apiKeyExchange` already in scope), §Finding 2b (composite loop at `:1102` needs the member venue added to the `select`) |
| **WIZFORM-05** | MT5 validate-key deadline inversion reconciled | §Finding 1 (the A-25 coupling — **90 000 ms is the safe number**), §Table B (SC-4b arithmetic, all three routes), §Table C (the full pin surface a new budget row must clear), §Finding 7 (the Python end-to-end deadline shape that preserves D-02) |
| **MT5-14** | MT5 declarable in the metadata step AND preselected from the connected key | §Finding 5 (the preselect ALREADY works via `canonicalizeExchange`; only the display entry is missing), §Finding 5b (widening `UI_EXCHANGE_CODES` changes a **public marketing count** and six other surfaces — two candidate shapes documented), §Table D (the pin's real assertion surface, narrower than D-16 states) |
</phase_requirements>

## Project Constraints (from CLAUDE.md / AGENTS.md)

| Directive | Source | Bearing on this phase |
|-----------|--------|----------------------|
| **Read `node_modules/next/dist/docs/` before writing Next.js code** | `AGENTS.md` | This phase edits a route handler and client components. Do **not** assume Next.js route-segment or `NextResponse` API shapes from training data. |
| **Read `DESIGN.md` before any visual or UI decision; flag deviations** | `CLAUDE.md` | The UI-SPEC already encodes this; the executor must not re-derive tokens. |
| **Coverage is a BLOCKING CI gate** (lines 82 / statements 80 / functions 74 / branches 72) | `CLAUDE.md` | New branches (venue capability arms, escalation ladder thresholds) must carry tests or they push branch coverage down toward the 72 floor. |
| **Rule 3 — surgical changes; Rule 11 — match conventions** | global `CLAUDE.md` | This phase's whole risk is collateral edits to pinned constants. Every pin touched must be touched *deliberately*, in the same commit, with its reasoning rewritten. |
| **Rule 7 — surface conflicts, don't average them** | global `CLAUDE.md` | Two live conflicts found: the ellipsis (§Finding 9) and the D-16 pin scope (§Table D). Both are named below rather than silently reconciled. |
| **Banned packages list** | global `CLAUDE.md` | Not engaged — this phase installs nothing. |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Inline field refusal (WIZFORM-01) | Browser/Client (`MetadataStep`, `AllocateDialog`) | API (server bound stays, as the trust boundary) | The client mirrors a rule it can evaluate; the server never stops enforcing it. ASVS V5: client validation is UX, server validation is the control. |
| Field-level 400 → field routing | Browser/Client | API (must mint the code) | A field-level code must map to exactly one field id client-side; the server only has to name the field's code honestly. |
| Honest 400 codes (WIZFORM-02) | API (`finalize-wizard/route.ts`) | Test tier (`wizardErrors.invariant.test.ts` as the derivation) | The emitting site is the source of truth; the roster is derived from it. |
| Client budget selection (WIZFORM-05) | Frontend Server (Next route handler → `analytics-client`) | — | `validateKey(exchange, …)` already receives the venue at `analytics-client.ts:672`; the budget is a server-side seam concern, never a browser one. |
| Server probe deadline (WIZFORM-05) | Python service (`routers/exchange.py`) | — | The nested-timeout ordering (D-02) is entirely inside the Python process. |
| Scope re-probe skip (WIZFORM-04 / MT5-14a) | API (`finalize-wizard/route.ts:904`, `:1102`) | Shared lib (`closed-sets.ts` capability record) | The decision is per-venue data; the enforcement is at the one call site. |
| Venue-shaped copy gating (WIZFORM-03) | Shared isomorphic lib (`wizardErrors.ts` `formatKeyError`) | Browser (call sites pass `venue` + `surface`) | `buildEnvelope` is a pass-through; only `formatKeyError` can filter `fix[]`. |
| MT5 chip offer + preselect (MT5-14) | Browser (`MetadataStep`) | Shared lib (`closed-sets.ts` venue sets) | The chip set is a UI-offered set; the preselect derives from `detectedExchange`, already a prop. |

---

## Standard Stack

**No new packages. No new registry. No new icon set.** [VERIFIED: `153-UI-SPEC.md` §Registry
Safety, re-confirmed by grep — this phase adds zero imports outside `src/` and
`analytics-service/`.]

### In-repo mechanisms this phase EXTENDS (never replaces)

| Mechanism | Path | Role here | Verified |
|-----------|------|-----------|----------|
| `SEAM_BUDGETS` / `SEAM_ROUTE_BUDGETS` | `src/lib/resilient-fetch.ts:513-838` | The budget table; `validate-key` at `:537-538` is `timeoutMs: 30_000, retries: SEAM_RETRIES(0), dependencies:["mt5-gateway"]` | [VERIFIED: source] |
| `budgetKeyFor(flowType)` | `src/lib/process-key-client.ts:111-133` | **The precedent** for many-to-one budget-key selection, with an exhaustiveness throw | [VERIFIED: source] |
| `seam-budgets.invariant.test.ts` | `src/lib/` | SC-4a/b/d/e/f — the gate any budget change must pass | [VERIFIED: read in full] |
| `seam-constants.pin.test.ts` | `src/lib/` | Hand-typed literal pins for every budget key, timeout, dependency, retry count, and the six breaker constants | [VERIFIED: source] |
| `wizardErrors.invariant.test.ts` | `src/lib/` | **The existing derived-roster scanner** — emitter regex + comment-strip + self-tests + vacuity floor | [VERIFIED: read in full] |
| `source-scan.ts` (`stripCommentsPreserveLines`) | `src/lib/` | The tokenizer the scanner runs on | [VERIFIED: imported at `wizardErrors.invariant.test.ts:6`] |
| `Field` | `src/components/ui/Field.tsx` | Wires `htmlFor`↔`id`, `aria-describedby=[hint,error]`, `aria-invalid="true"`. Container is `flex flex-col gap-1.5` (**6px**, per UI-SPEC FLAG-7) | [VERIFIED: read in full] |
| `buildEnvelope` / `RECOVERABLE_ACTIONS` | `src/lib/envelope.ts:54-91` | Derives `recoverable` from `copy.actions`; **passes `copy.fix` through unmodified** | [VERIFIED: read in full] |
| `formatKeyError` / `WizardErrorContext` | `src/lib/wizardErrors.ts:1599-1700` | The ONLY interpolation seam; six existing optional context fields | [VERIFIED: source] |
| `SEAM_CODE_TO_WIZARD_CODE` / `recogniseSeamErrorCode` | `src/lib/wizardErrors.ts:2158-2196` | The ONE wire→wizard alias table; `CIRCUIT_OPEN → SERVICE_UNAVAILABLE_RETRY` lives here | [VERIFIED: source] |
| `MAGNITUDE_CAPS` | `src/lib/closed-sets.ts:529-546` | `MAX_DESCRIPTION_CHARS: 5000`, pinned at `closed-sets.test.ts:323` | [VERIFIED: source] |
| Venue capability shape (`ExchangeOption`) | `ConnectKeyStep.tsx:38-79` | The `passphraseSecret` / `requiresSecret` **absent→default-preserves-ccxt** precedent MT5-13 cites | [VERIFIED: source] |
| `UI_EXCHANGE_CODES` flag-gated widening | `src/lib/closed-sets.ts:199-217` | `SFOX_UI_ENABLED ? WITH_SFOX : BASE` — **the house pattern for exactly this widening** | [VERIFIED: source] |
| `_validate_mt5_key` | `analytics-service/routers/exchange.py:222-465` | Three independent `_MT5_PROBE_TIMEOUT_S` `wait_for`s at `:328` (connect), `:380` (probe), `:456` (close) | [VERIFIED: source] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `SEAM_BUDGETS` row for the MT5 arm | Raise the single `validate-key` row to 90s for **all** venues | Simpler pin surface (one literal + the magnitudes assertion) but a dead ccxt venue would hold a Vercel lambda 3× longer than today, and the A-25 coupling fires identically. **Rejected** — D-01 says venue-aware. |
| New `SEAM_BUDGETS` row | `timeoutMsOverride` at the call site | ⛔ **Forbidden in production.** `analytics-client.ts:314-320` states the override is "**TESTS ONLY** since 140-05 removed the last production override", and SC-4b's arithmetic reads only the table — an override is invisible to the headroom assertion. **Do not use.** |
| Two `branch`-labelled legs on the validate-key routes | Two unlabelled legs (plain sum) | Summing both venue arms describes a path no request takes; SC-4b would charge ~210 000 ms where the real worst case is 180 000 ms. The `branch` machinery at `seam-budgets.invariant.test.ts:566-584` exists for exactly this. |
| Extending `wizardErrors.invariant.test.ts` | A new build-time codegen'd roster | The existing file already has the scanner, the self-tests and the vacuity floor. A second derivation is the duplication this repo repeatedly warns against. |
| Widening `UI_EXCHANGE_CODES` (sFOX precedent) | A new, narrow `WIZARD_EXCHANGE_CHOICES` set | See §Finding 5b — this is a real decision with a public-marketing consequence. |

**Installation:** none.

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages.** [VERIFIED: `153-UI-SPEC.md`
§Registry Safety "no third-party registry, no new package, no new icon set introduced by this
phase (verified 2026-08-08)"; independently confirmed here by reading every file the phase
touches — all edits are to existing in-repo modules.]

No `slopcheck` run was required. If the planner later introduces a package (it should not),
the Package Legitimacy Gate must run first.

---

## Architecture Patterns

### System Architecture Diagram

```
                        ┌──────────────────────────────────────────┐
   USER TYPES A KEY ───▶│ ConnectKeyStep / MultiKeyConnectStep     │
                        │  • venue card (ExchangeOption caps)      │
                        │  • long-wait card (NEW, Surface 1)       │
                        └───────────────┬──────────────────────────┘
                                        │ POST /api/strategies/create-with-key
                                        ▼
                        ┌──────────────────────────────────────────┐
                        │ Next route  ──▶ analytics-client         │
                        │  validateKey(exchange, …)                │
                        │      │                                   │
                        │      ├─ NEW: budgetKeyFor(exchange)      │
                        │      │    mt5 → "validate-key-serialized"│
                        │      │    else → "validate-key"          │
                        │      ▼                                   │
                        │  resilientFetch(budgetKey, …)            │
                        │      ├─ isBreakerOpen(budgetKey)  ──────▶ Upstash
                        │      │    keys = deps + breaker:railway  │
                        │      │    OPEN ⇒ CircuitOpenError, NO fetch
                        │      └─ AbortSignal.timeout(budget)      │
                        └───────────────┬──────────────────────────┘
                                        │  Railway seam
                                        ▼
                        ┌──────────────────────────────────────────┐
                        │ analytics-service POST /api/validate-key │
                        │  exchange=="mt5" ─▶ _validate_mt5_key    │
                        │     NEW: ONE end-to-end wait_for         │
                        │       ├ stage: connect  (35s ceiling)    │
                        │       ├ stage: probe    (35s ceiling)    │
                        │       └ finally: close  (own small bound)│
                        │     inner: rpyc sync_request_timeout 30s │
                        │            < MT5_LOGIN_TIMEOUT 20 000ms  │
                        └──────────────────────────────────────────┘

   USER SUBMITS ──────▶ ┌──────────────────────────────────────────┐
                        │ MetadataStep (WIZFORM-01)                │
                        │  client mirror: 10 ≤ len ≤ 5000 + cat    │
                        │  refuse INLINE ─────▶ Field(error)       │
                        │  (never reaches the network)             │
                        └───────────────┬──────────────────────────┘
                                        │ POST /api/strategies/finalize-wizard
                                        ▼
                        ┌──────────────────────────────────────────┐
                        │ validatePayload()  9 arms, 400           │
                        │   NOW each carries a `code`  ────────────┼──▶ SubmitStep
                        │                                          │    routes a
                        │ resolve apiKeyExchange (:856)            │    FIELD-level
                        │   NEW gate: scopeProbeSupported(venue)?  │    code back to
                        │     no  ─▶ SKIP probe   (WIZFORM-04 /    │    the FIELD
                        │             MT5-14a, zero seam calls)    │
                        │     yes ─▶ runScopeBroadeningProbe(:904) │
                        │              resilientFetch("keys-…")    │
                        └──────────────────────────────────────────┘
```

### Pattern 1 — Venue-aware budget selection (the `budgetKeyFor` precedent)

**What:** A pure function maps a runtime discriminator to a `SeamBudgetKey`, with an
exhaustiveness throw. The seam core, the breaker keying, the retry gate and SC-4b's
arithmetic all read the table row — nothing at the call site.

**Why this and not a parameter:** `analytics-client.ts:349` resolves
`options.timeoutMs ?? SEAM_BUDGETS[budgetKey].timeoutMs`, and its own docblock declares the
override **tests-only** since 140-05. SC-4b reads only the table. A parameter is invisible to
the invariant.

```typescript
// Source: src/lib/process-key-client.ts:111-133 (the shape to mirror)
function budgetKeyFor(flowType: FlowType): SeamBudgetKey {
  switch (flowType) {
    case "onboard":
    case "resync":
      return "process-key-enqueue";
    case "teaser":
    case "csv":
      return "process-key-sync";
    default: {
      const _exhaustive: never = flowType;
      throw new Error(
        `budgetKeyFor: unhandled flow_type — FlowType grew without a budget arm? ` +
          `got=${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}
```

The venue is already in hand: `validateKey(exchange, apiKey, apiSecret, passphrase, tenant)`
at `analytics-client.ts:672` takes `exchange` as its first parameter and today hardcodes
`{ budgetKey: "validate-key" }` at `:684`. That one literal becomes
`budgetKeyFor(exchange)`.

⚠️ `exchange` is caller-supplied. `budgetKeyFor` must map **unknown → the default row**, never
throw on an unrecognised venue string, and never interpolate the venue into a breaker key
(threat T-140-01, `resilient-fetch.ts:102-108`: "MODULE CONSTANT — never interpolate user
input"). A closed-set `switch` over `SupportedExchange` with a `default:` returning
`"validate-key"` is the safe shape here — the opposite of `budgetKeyFor(flowType)`'s
exhaustiveness throw, and for a stated reason.

### Pattern 2 — Mutually exclusive `branch` legs (so SC-4b takes a MAX, not a SUM)

**What:** `SEAM_ROUTE_BUDGETS` legs carry an optional `branch` label. `branchesOf()`
(`seam-budgets.invariant.test.ts:566-584`) groups them; SC-4b sums *within* a branch and
maximises *across* branches. An unlabelled leg is shared and charged to every branch.

**When to use:** exactly here — a `validate-key` request spends the ccxt arm **or** the MT5
arm, never both.

```typescript
// Source: src/lib/resilient-fetch.ts:810-817 (the only labelled row today)
"src/app/api/strategies/finalize-wizard/route.ts": {
  expectedMaxDurationS: 300,
  budgets: [
    { key: "keys-permissions", calls: 10, branch: "composite" },
    { key: "keys-permissions", calls: 1,  branch: "single-key" },
    { key: "process-key-enqueue", calls: 1, branch: "single-key" },
  ],
},
```

⚠️ Adding branch labels to the three `validate-key` routes **breaks a hand-typed roster**:
`seam-budgets.invariant.test.ts:931-943` asserts `multiBranch` equals exactly
`[FINALIZE_WIZARD_ROUTE]`. That assertion must gain the new rows in the same commit.

### Pattern 3 — Per-venue capability, DEFAULT preserves today's behaviour

**What:** an optional boolean whose **absence** means the incumbent behaviour, so every ccxt
venue stays byte-identical and only the new venue opts out. The repo has this twice already.

```typescript
// Source: src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:38-79
interface ExchangeOption {
  // Absent → true (every ccxt exchange). sFOX authenticates with a SINGLE Bearer token…
  requiresSecret?: boolean;
  // Absent → true, which is OKX's behaviour, so every existing and future venue that
  // omits the key renders byte-identically to today (D-03…). MT5 sets false…
  passphraseSecret?: boolean;
}
```

**Where the NEW capabilities must live:** `ExchangeOption` is a **client-local** array inside
`ConnectKeyStep.tsx`. This phase needs the same facts on the **server** (`finalize-wizard`'s
probe gate) and in an **isomorphic** module (`wizardErrors.ts`'s copy gating). The one home
that satisfies all three is `src/lib/closed-sets.ts` — already isomorphic (client components
import `isCryptoExchange` from it, `MetadataStep.tsx:18`), already the venue registry
(`EXCHANGE_DISPLAY`, `CRYPTO_EXCHANGES`), and already carries the
`as const satisfies Record<SupportedExchange, …>` discipline that makes a new venue a
compile error.

Recommended shape (planner's discretion on names):

```typescript
// src/lib/closed-sets.ts — ONE record, three consumers, closed over SupportedExchange.
export const VENUE_CAPABILITIES = {
  binance:  {},                                   // absent → all defaults (ccxt)
  okx:      {},
  bybit:    {},
  deribit:  {},
  sfox:     { scopeProbeSupported: false },       // ⚠️ see the note below
  mt5:      { scopeProbeSupported: false, substitutable: false, serialized: true },
} as const satisfies Record<SupportedExchange, VenueCapabilities>;
```

⚠️ **Whether sFOX also opts out of the scope probe is an OPEN QUESTION, not a research
finding.** sFOX asserts `read_only=True` **structurally** (`exchange.py` `_validate_sfox_key`
docstring: "the SfoxClient adapter has no order/withdraw/transfer surface … sFOX exposes no
per-key scope endpoint"), which is the same argument MT5 makes. But changing sFOX's submit
path is outside this phase's six requirements. **Default the record so sFOX behaviour is
byte-unchanged**, and record the question. See §Open Questions Q2.

### Pattern 4 — Inline field validation: the aria-derived red border

**What:** the control carries `aria-[invalid=true]:border-negative`; `Field` sets
`aria-invalid="true"` **iff** `error` is truthy (`Field.tsx:72`). A red border without correct
aria wiring becomes structurally impossible.

**Three sites already do this correctly** [VERIFIED: grep]:
- `MetadataStep.tsx:334` (the description textarea — **the exact element this phase edits**)
- `CsvUploadStep.tsx:624`
- `RenameStrategyDialog.tsx:178`

**One site does NOT** — `AllocateDialog.tsx:355` colours via a JS ternary
`fieldError ? "border-negative" : "border-border"`. It is correct *today* only because
`fieldError` also feeds `Field`'s `error` prop. D-12 puts it in scope; converting it to the
aria mechanism is the UI-SPEC's FLAG-1.

**The behavioural precedent is `AllocateDialog.handleSave`** (`:248-262`): mirror the server
rule, refuse inline, `focus()` the field, **never disable the CTA for a validation reason**
(comment at `:370-372`).

### Anti-Patterns to Avoid

- **`if (venue === "mt5")`** — the instance-not-class defect this repo has paid for once
  (memory: P140, 37 fix commits scrapped). Use the capability record.
- **A `timeoutMs` production override** — invisible to SC-4b; explicitly retired at 140-05.
- **Raising `STORE_COMMANDS_PER_SEAM_CALL.failing` to absorb a retry** — fenced by a
  hand-typed 277 500 pin at `seam-budgets.invariant.test.ts:836-872` ("WRONG FIX A").
- **Deleting `MetadataStep.tsx:491`'s `disabled` without widening the `handleSubmit`
  predicate at `:230`** — see §Pitfall 2. This *re-ships* the WIZFORM-01 defect.
- **A second `dict`/`Set` roster** — `MultiKeyConnectStep.tsx:201-213` argues at length that
  the ONE shared table is consulted first and a member here would be "a hand-typed
  allow-list edit owed again at every surface".
- **Hardcoding `10` / `5,000` in copy** while forbidding literal seconds — UI-SPEC FLAG-5.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deriving an error-code roster from emitting sites | A new codegen step / build script | Extend `src/lib/wizardErrors.invariant.test.ts` | It already has `EMITTER_RE`, comment-stripping, four self-tests, a hand-typed site count and an anti-vacuity floor. A second derivation is exactly the duplication this file's own docblock warns about. |
| Comment-safe source scanning | A regex over raw source | `stripCommentsPreserveLines(src, "ts")` from `src/lib/source-scan.ts` | The 14-vs-12 lesson is written into the invariant test's docblock: a raw grep counts comment prose as emitters. |
| A11y wiring for an inline error | Hand-wired `<label>`/`aria-describedby` | `Field` | `Field.tsx:64-75` wires `htmlFor`↔`id`, both describedby ids in `[hint, error]` order, and `aria-invalid`. `CsvUploadStep` is the recorded example of hand-wiring getting it half-right. |
| Suppressing a Retry control | A new `hideRetry` prop on `ErrorEnvelope` | Give the copy entry no member of `RECOVERABLE_ACTIONS` | `envelope.ts:54-57, 88` derives `recoverable` from `actions`. Four existing codes use this mechanism (`SEAM_MISCONFIGURED`, `COMPOSITE_TOO_MANY_MEMBERS`, `KEY_SCOPE_CHECK_UNAVAILABLE`, `ALLOCATION_NOT_ALLOCATABLE`). **The absence IS the fix.** |
| A wait/deadline number in copy | A typed literal | Interpolate from the configured budget constant | UI-SPEC forbidden-item #8; and TRAP-3 ("a surface must NEVER invent a duration it did not receive", `wizardErrors.ts:1617-1627`). |
| Announcing a form-level error | A bespoke `aria-live` div | `LiveRegion` | `LiveRegion.tsx:30-51`: hard-coded `sr-only`, pinned to EXACTLY that class, renders before its message arrives. ⚠️ Its contract says "the SAME sentence the surface already renders visually — never a place to author new copy" (UI-SPEC FLAG-6). |
| Venue display casing | A local capitalize | `EXCHANGE_DISPLAY` / `canonicalizeExchange` | `closed-sets.ts:48-55` already maps `mt5 → "MT5"`. |

**Key insight:** every "new mechanism" this phase appears to need is an *extension of one
that is already CI-wired*. The failure mode here is not building the wrong thing — it is
building a **second** thing beside a working one, which is how the two hand-listed rosters
came to exist in the first place.

---

## Findings

### Finding 1 — ⭐ The A-25 breaker invariant is coupled to the longest budget, and its pin cannot see the break

`BREAKER_LOCK_TOMBSTONE_S = 60` is justified verbatim at `resilient-fetch.ts:268-274`:

> *60 s, because the guard must span the longest budget in `SEAM_BUDGETS`
> (`process-key-sync`, 60 000 ms) measured from the instant a lock is armed:
> `BREAKER_COOLDOWN_S + BREAKER_LOCK_TOMBSTONE_S = 90 s ≥ 60 s`* [VERIFIED: source]

The failure it prevents (A-25): a request admitted the instant *before* a lock is armed, and
failing at the end of the longest budget, must still be able to READ that lock — otherwise
`recordSeamFailure` re-arms a fresh cooldown on stale evidence.

The pin at `seam-constants.pin.test.ts:704-718`:

```typescript
expect(BREAKER_LOCK_TOMBSTONE_S * 1_000, /* … */).toBeGreaterThanOrEqual(60_000 - 30_000);
```

**Both sides are hand-typed literals.** The `60_000` is a restatement of "the longest seam
budget". Introduce a 120 000 ms budget and the assertion still evaluates
`60_000 >= 30_000` → **GREEN**, while the real invariant `30 + 60 ≥ 120` is **FALSE**.

| MT5 client budget | `COOLDOWN + TOMBSTONE` | A-25 holds? | Action required |
|---|---|---|---|
| 90 000 ms | 90 s | ✅ **exactly** | Update the pin literal `60_000` → `90_000` (assertion still passes: `60_000 >= 60_000`) |
| 100 000 ms | 90 s | ❌ | Raise `BREAKER_LOCK_TOMBSTONE_S` to ≥ 70, update its docblock, update the pin literal |
| 120 000 ms | 90 s | ❌ | Raise `BREAKER_LOCK_TOMBSTONE_S` to ≥ 90, update its docblock, update the pin literal |

**Recommendation: 90 000 ms.** It sits inside the founder's locked D-01 range (~90–120 s), is
3× the current ceiling (which is what the founder actually asked for — "more than 40
seconds"), and is the largest value that needs **no second breaker constant re-cut**. If the
planner chooses higher, the tombstone raise is mandatory and must land in the same commit.

Confidence: **HIGH** — every constant read from source; the arithmetic is three additions.

### Finding 2 — ⭐ WIZFORM-04 and MT5-14(a) are one gate at one line

`finalize-wizard/route.ts`:

```
:841-856   resolve apiKeyExchange from api_keys.exchange   ← the venue, already in scope
:857-899   asset_class write (uses apiKeyExchange)
:902-905   if (apiKeyId) { const probe = await runScopeBroadeningProbe(apiKeyId);
                           if (!probe.ok) return probe.response; }
```
[VERIFIED: source]

The venue is resolved **48 lines before** the probe call, into a variable
(`apiKeyExchange: string | null`) that is already used by the code between them. D-06's
"zero live MT5 calls on submit" is one conditional:

```typescript
if (apiKeyId && venueSupportsScopeProbe(apiKeyExchange)) {
  const probe = await runScopeBroadeningProbe(apiKeyId);
  if (!probe.ok) return probe.response;
}
```

⚠️ **Fail direction.** `apiKeyExchange` is `null` on a lookup fault (the route already logs
and continues). `venueSupportsScopeProbe(null)` **must return `true`** — an unresolved venue
falls back to probing, preserving today's fail-CLOSED scope-broadening defence. Skipping on
`null` would silently disable the defence for every key whose venue read blipped. The
`skipAssetClassWrite` block at `:864-872` is the local precedent for treating `null` as
"do the conservative thing".

**Why this satisfies D-14(a) too:** MT5-14 says *"the ccxt scope probe must handle MT5 — **or**
`finalize-wizard` must stop demanding a ccxt probe for a venue that has none (read-only is
already proven by `_validate_mt5_key`)"*. That is this gate.

**Why it satisfies D-07:** no retry loop is added; the budget is unchanged; `breaker:railway`
sees strictly fewer calls, never more.

**Why `SEAM_ROUTE_BUDGETS` need not change:** SC-4b's arithmetic is a *worst-case* bound.
Removing calls in some cases leaves the declared bound conservative. ⚠️ The converse is not
true — do **not** delete the `keys-permissions` legs to "reflect reality": that would break
four assertions at once (the 277 500 pin at `:836`, the two-branch assertion at `:909`, the
`MAX_COMPOSITE_MEMBERS` cross-file link at `:876`, and the "exercises the branch MAX" fence
at `:931`).

#### Finding 2b — the composite loop needs the member's venue, which is NOT selected today

```
:978-993   .from("strategy_keys").select("api_key_id")   ← only the id
:1097-1104 for (const member of members ?? []) { … runScopeBroadeningProbe(memberKeyId) }
```
[VERIFIED: source]

To gate the composite arm per-venue the planner must either widen the select
(`.select("api_key_id, api_keys(exchange)")`) or batch a second admin read. ⚠️ The `.limit()`
is `MAX_COMPOSITE_MEMBERS + 1` and the `+1` is a **truncation detector** whose arrival IS the
refusal (`:983-992`) — do not change the limit while touching the select.

⚠️ A composite is a *crypto-only* construct today (`:808` — "Every composite member venue is a
crypto exchange this…"), so an MT5 member may not be reachable. **The planner should confirm
whether the composite arm needs the gate at all**, rather than assuming it does.

Confidence: **HIGH** for the single-key arm, **MEDIUM** for the composite arm's necessity.

### Finding 3 — ⭐ The derived-roster mechanism already exists and is CI-wired

`src/lib/wizardErrors.invariant.test.ts` (Phase 142.2-07). Its parts:

| Part | Line | What it does |
|---|---|---|
| `EMITTER_RE` | `:100-101` | `NextResponse.json({ code: "X", error: … }, { … status: 400 …` — code literal FIRST, then `error:`, status 400 |
| `ROUTES` | `:114-127` | Two entries today: `create-with-key`↔`KNOWN_CREATE_WITH_KEY_CODES`, `composite/add-key`↔`KNOWN_ADD_KEY_CODES` |
| `deriveUnionMembers` | `:145-152` | Reads `WizardErrorCode`'s members, **bounded at the terminating `;`** so it cannot wander into the copy table |
| `deriveRoster` | `:155-163` | Reads the string literals out of `const <name> … new Set([ … ])` |
| `EXPECTED_SITES_PER_ROUTE = 12` | `:183` | Hand-typed, never `derived.length` |
| `DERIVED_FLOOR = 14` | `:203` | Anti-vacuity: an empty derivation is green forever |
| Four SELF-TESTs | `:333-410` | Prove the scanner reads real emitter syntax, ignores commented mentions, excludes the three documented shapes, and stops at the right boundaries |

**The class fix for D-09(a):** add a third `ROUTES` entry —
`finalize-wizard/route.ts` ↔ `SubmitStep.tsx` / `KNOWN_FINALIZE_CODES` — and **widen the
predicate past `status: 400`**, because finalize-wizard's coded arms answer 400/403/404/502/503.

⚠️ **The emitter regex constrains the code shape you must write.** It requires `code:` as the
**first** key of the object literal, immediately followed by `error:`. Today's nine arms are
`{ error: "…" }`. If the planner writes `{ error: "…", code: "…" }` the scanner will not see
them and the coverage assertion will be **blind, not satisfied**. Either write
`{ code: "…", error: "…" }` at all nine sites, or relax the regex — and if you relax it, add a
SELF-TEST proving the relaxed form is matched, matching the file's existing discipline.

**How the assertion FAILS when a new emitting site is added without roster membership:** the
derived code set is compared against the roster set, per route, and the failure message names
the code. That is already the file's behaviour — extending `ROUTES` inherits it.

⚠️ `KNOWN_FINALIZE_CODES` is declared **inside a function body** at `SubmitStep.tsx:230`
(indented). `deriveRoster` uses `source.indexOf("const KNOWN_FINALIZE_CODES")`, which still
matches. But the executor should verify this rather than assume it.

Confidence: **HIGH** (file read in full).

### Finding 4 — ⚠️ Two live UNKNOWN instances the derivation will surface

Diffing `finalize-wizard`'s emitted codes against `SubmitStep.KNOWN_FINALIZE_CODES`
(comment-stripped, scripted 2026-08-08):

```
finalize-wizard emits: CIRCUIT_OPEN, COMPOSITE_MEMBERSHIP_UNKNOWN, COMPOSITE_TOO_MANY_MEMBERS,
                       COMPOSITE_UNSUPPORTED_UNIFIED, GATE_DRAFT_GONE, GUARD_BLOCKED,
                       KEY_NETWORK_TIMEOUT, KEY_SCOPE_BROADENED, KEY_SCOPE_CHECK_UNAVAILABLE
SubmitStep roster:     COMPOSITE_MEMBERSHIP_UNKNOWN, COMPOSITE_TOO_MANY_MEMBERS, GATE_DRAFT_GONE,
                       GUARD_BLOCKED, KEY_NETWORK_TIMEOUT, KEY_SCOPE_BROADENED,
                       KEY_SCOPE_CHECK_UNAVAILABLE, SEAM_MISCONFIGURED, SERVICE_UNAVAILABLE_RETRY,
                       SERVICE_UNREACHABLE, UNKNOWN, WIZARD_DUPLICATE
EMITTED, NOT IN ROSTER: CIRCUIT_OPEN, COMPOSITE_UNSUPPORTED_UNIFIED
```

- **`CIRCUIT_OPEN` is FINE** — it is a WIRE code deliberately kept out of `WizardErrorCode`
  and aliased to `SERVICE_UNAVAILABLE_RETRY` in `SEAM_CODE_TO_WIZARD_CODE`
  (`wizardErrors.ts:2163`). The derivation must consult the alias table, exactly as
  `MultiKeyConnectStep.tsx:201-207` describes ("coverage-law row 1").
- **`COMPOSITE_UNSUPPORTED_UNIFIED` is a LIVE `UNKNOWN`.** `wizardErrors.ts:2149-2151`
  records it: *"(`draft_state_invalid` and `COMPOSITE_UNSUPPORTED_UNIFIED` also reach
  SubmitStep without a wizard member — both are deliberately out of scope here and are
  recorded in the TS-35 ledger row, NOT silently absorbed.)"* [VERIFIED: source]

WIZFORM-02's success criterion is *"No wizard failure renders `code: UNKNOWN` when the server
DID classify it."* These two are classified and render UNKNOWN. **They are in scope by the
criterion's own words**, and the derived coverage assertion will red on them the moment
`finalize-wizard` joins `ROUTES`. The plan must either mint members / aliases for them or
carry an explicit, reasoned exemption in the assertion — silence will not compile.

Confidence: **HIGH** for the diff; **HIGH** for the `wizardErrors.ts:2149` citation.

### Finding 5 — MT5-14: the preselect already works; only the display entry is missing

```typescript
// Source: MetadataStep.tsx:110-113
const [supportedExchanges, setSupportedExchanges] = useState<string[]>(
  initial?.supportedExchanges ??
    (detectedExchange ? [canonicalizeExchange(detectedExchange)] : []),
);
```

`canonicalizeExchange(name)` (`constants.ts:92-100`) loops `EXCHANGES` case-insensitively and
**returns the input unchanged when unknown** [VERIFIED: source].

⇒ **Today, for an MT5 key: `canonicalizeExchange("mt5")` returns `"mt5"`.** That lowercase
string is seeded into `supportedExchanges`, never matches a chip (`EXCHANGES` has no MT5
member, so no chip exists), renders nowhere, and is POSTed verbatim into
`supported_exchanges`. `validateStringArray` (`route.ts:276-281`) only filters non-strings
and caps at 20 — **there is no closed-set check on `supported_exchanges` server-side**, so
`"mt5"` persists as-is. `EXCHANGE_DISPLAY` already maps `mt5: "MT5"` (`closed-sets.ts:53`).

⇒ MT5-14's preselect half needs **only** MT5 to become a member of whatever set the chip
group renders. `canonicalizeExchange` then returns `"MT5"`, the chip matches, and the
pre-selection works with **zero changes to `MetadataStep`'s state logic**. No second venue
question exists anywhere in the flow (D-15 is satisfied by construction).

#### Finding 5b — ⚠️ the widening's real blast radius, and the two candidate shapes

`EXCHANGES` is **derived**: `closed-sets.ts:246-248` — `UI_EXCHANGE_CODES.map(code => EXCHANGE_DISPLAY[code])`.
Its consumers [VERIFIED: grep, non-test]:

| Consumer | Effect of adding MT5 |
|---|---|
| `src/app/(marketing)/page.tsx:115` and `:215` — **`{EXCHANGES.length} exchanges supported`** | A **public marketing claim** changes 4 → 5 |
| `components/strategy/ApiKeyForm.tsx` / `StrategyForm.tsx` | The manager `<Select>` gains MT5 — **the exact thing the pin's reasoning forbids** |
| `components/strategy/StrategyFilters.tsx` | Discovery filter chips gain MT5 |
| `components/mandate/MandateForm.tsx` | Mandate chips gain MT5 (note: `MandateForm` is a literal-narrowing consumer per `closed-sets.ts:243-245`) |
| `components/admin/PreferencesPanel.tsx` | Admin prefs gain MT5 |
| `components/landing/VerificationForm.tsx` | Public teaser dropdown gains MT5 |
| `api/verify-strategy/route.ts` · `api/strategies/csv-finalize/route.ts` | Server-side canonicalisation widens |
| `MetadataStep.tsx:446` — the chips | ✅ the thing we actually want |

⚠️ **`NEXT_PUBLIC_MT5_ENABLED=true` is already set in production** [ASSUMED — from the
project memory record `project_v1_15_metatrader5_milestone`; the planner should confirm
against Vercel before landing]. If true, option A ships all eight consequences **live on
merge**, including the marketing count.

| | **Option A — sFOX precedent** | **Option B — narrow wizard set** |
|---|---|---|
| Shape | `UI_EXCHANGE_CODES = MT5_UI_ENABLED ? [...BASE_OR_SFOX, "mt5"] : …` mirroring `closed-sets.ts:199-217` | New `WIZARD_EXCHANGE_CHOICES` = `EXCHANGES` (+ `"MT5"` when the flag is on), consumed **only** by `MetadataStep`'s `InlineChipGroup` |
| Follows the house pattern? | ✅ literally the sFOX pattern | ⚠️ new set (but `closed-sets.ts` already holds four decoupled venue sets and argues per-set decoupling at `:185-190`, `:221-226`) |
| Honours the pin's stated *reason* ("the manager `<Select>` must not silently widen")? | ❌ it widens it | ✅ |
| Marketing count | 4 → 5 | unchanged |
| Pin re-cut | Invert both negatives at `closed-sets.mt5-flag.test.ts:55-71` | Keep both negatives, **add a positive**: MT5 present in the new set when the flag is on, absent when off |
| Extra work | Verify all 8 consumers render "MT5" acceptably (incl. two public surfaces) | One new export + one import |

**Neither is "routing around" D-16** — both re-cut the pin deliberately. Option B keeps the
pin's *reasoning* intact and adds a guard where none exists; Option A retires the reasoning.
⚠️ Option B is only honest if the pin gains the **positive** assertion — a widening with no
guard is worse than the pin it replaced.

**This is a decision the planner must make explicitly and record**, because it has a
user-visible public consequence either way. See §Open Questions Q1.

Confidence: **HIGH** for the mechanics and the consumer list; **MEDIUM** on the prod flag
state (memory-sourced).

### Finding 6 — `buildEnvelope` is a pass-through, so `fix[]` gating must live in `formatKeyError`

```typescript
// Source: src/lib/envelope.ts:80-90
const copy = formatKeyError(code, context);
return { …, debug_context: copy.fix, recoverable: copy.actions.some(a => RECOVERABLE_ACTIONS.has(a)), … };
```

`copy.fix` is `string[]` and is forwarded verbatim. ⇒ UI-SPEC Gates B (`surface`) and C
(`venue` / `substitutable`) **cannot** be implemented in `buildEnvelope`; they must be
implemented in `formatKeyError` (`wizardErrors.ts:1635-1701`), which is the only function
that already returns a *modified copy* of a table entry (five existing interpolation arms).

⚠️ `formatKeyError`'s existing arms are all `if (code === "X" && context?.y)` — an
instance-shaped cascade. Adding three more instance arms for `KEY_PROBE_FAILED`,
`KEY_RATE_LIMIT` and `KEY_NETWORK_TIMEOUT` (`wizardErrors.ts:484`, `:701`, `:713` — the three
venue-substitution bullets) would be the **instance-not-class defect**. The class shape is to
make `fix` entries carry a *requirement*, e.g. `fix: [ "…", { text: "…", requires: "substitutable" } ]`
or a parallel `fixRequires?: (null | Requirement)[]`, and filter once. The planner chooses the
representation; the property to satisfy is **one filter, not three conditionals**.

⚠️ `WizardErrorCopy.fix: string[]` is consumed by `ErrorEnvelope` as `debug_context` and by
`wizardErrors.test.ts`'s table walk. Changing the field's *type* has a wide blast radius;
adding a **parallel optional field** is additive and cheaper. [ASSUMED — the planner should
grep `\.fix\b` consumers before choosing.]

Confidence: **HIGH** for the pass-through; **MEDIUM** for the recommended representation.

### Finding 7 — The Python end-to-end deadline that preserves D-02

Today (all [VERIFIED: `analytics-service/routers/exchange.py`]):

| Layer | Constant | Value | Site |
|---|---|---|---|
| MT5 IPC pipe | `MT5_LOGIN_TIMEOUT_MS` | 20 000 ms | `mt5_client.py:88` |
| rpyc round-trip | `MT5_REQUEST_TIMEOUT_S` | 30 s | `mt5_client.py:82` |
| stage ceiling | `_MT5_PROBE_TIMEOUT_S = MT5_REQUEST_TIMEOUT_S + 5.0` | 35 s | `exchange.py:62` |
| applied ×3 | connect `:328`, probe `:380`, close `:456` | 35 s each | — |

Worst case = **105 s**, and `close` runs in a `finally` on **every** path (`:449-465`) — so a
timed-out probe still pays the close stage.

**D-02's ordering property, stated precisely:** `MT5_LOGIN_TIMEOUT_MS(20s) < MT5_REQUEST_TIMEOUT_S(30s) < _MT5_PROBE_TIMEOUT_S(35s)`.
Each inner bound fires first so the error carries venue detail rather than a bare
`asyncio.TimeoutError`. **Any new number must preserve this chain, not replace it.**

**Recommended shape** (D-03: one end-to-end deadline replacing three independent ones):

```
NEW  _MT5_VALIDATE_DEADLINE_S  ≈ 70 s     — ONE wait_for around connect + probe
KEEP _MT5_PROBE_TIMEOUT_S      = 35 s     — per-stage ceiling, unchanged (D-02 margin intact)
KEEP the finally-close on its OWN small bound (mirror _ACLOSE_TIMEOUT_S, ~10 s)
                                ⇒ server worst case ≈ 80 s
CLIENT budget                   = 90 000 ms   ⇒ 90 > 80, a 10 s margin  (D-04 satisfied)
```

⚠️ **The close must stay outside the end-to-end deadline.** If the outer `wait_for` wraps the
`finally`, a deadline fired during the probe would abandon the RPyC session without closing
it — the session-leak the `finally` block's comment (`:449-455`) exists to prevent, and a
regression of the WEDGE-01 class.

⚠️ **`_validate_mt5_key` takes NO asyncio lock** [VERIFIED: grep for `lock` in
`routers/exchange.py` returns nothing on this path; `services/mt5_concurrency.py`'s registry
is imported only by `job_worker` / `allocator_positions`, and its own docstring says "ACROSS
worker replicas / the separate FastAPI validate process it does NOT [serialize]"]. So D-04's
"lock-queue wait" is **not** an in-process queue on this path — the contention is at the Wine
terminal / mt5-gateway, and it manifests **inside** the RPyC round-trip latency, i.e. already
inside the 35 s stage ceilings. This is good news for the arithmetic and should be recorded
so nobody budgets for a queue that has no measurable pre-stage.

Confidence: **HIGH** for the constants and the lock absence; **MEDIUM** for the specific 70 s
figure (it is a design proposal, not a measurement — no distribution of *successful* MT5
logins exists; see UI-SPEC's own refusal to state a typical range).

### Finding 8 — There is no `MIN_DESCRIPTION_CHARS` constant; UI-SPEC FLAG-5 requires minting one

[VERIFIED: grep across `src/`]

```
finalize-wizard/route.ts:389    description.length < 10 ||                    ← BARE LITERAL
finalize-wizard/route.ts:390    description.length > MAGNITUDE_CAPS.MAX_DESCRIPTION_CHARS
closed-sets.ts:535              MAX_DESCRIPTION_CHARS: 5000,
closed-sets.test.ts:323         expect(MAGNITUDE_CAPS.MAX_DESCRIPTION_CHARS).toBe(5000);
```

The upper bound is single-sourced; **the lower bound is a naked `10` in one route**. FLAG-5
("character bounds must read from the constant, like durations do") therefore requires
*minting* `MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS: 10`, re-pointing `:389` at it, and adding it
to the hand-typed pin block at `closed-sets.test.ts:320-330`. The client mirror then reads
both bounds from the same record — which is the only way the copy `Add at least {min}
characters` and the server rule cannot drift.

Confidence: **HIGH**.

### Finding 9 — ⚠️ Conflict: the UI-SPEC's typographic ellipsis vs a recorded test decision

UI-SPEC Copywriting Contract: *"Primary CTA (connect) … in flight: `Validating…`"* (U+2026).

But `MultiKeyConnectStep.test.tsx:19-21` records the opposite as a **decision**:

> *"String literals are byte-copied from the ConnectKeyStep source (the busy label is ASCII
> `"Validating..."`, **superseding the UI-SPEC's typographic ellipsis**) or the UI-SPEC copy
> table."* [VERIFIED: source]

Live sites [VERIFIED: grep]:
- ASCII `"Validating..."`: `ConnectKeyStep.tsx:782`, `MultiKeyConnectStep.tsx:1637`,
  `ApiKeyForm.tsx:199`, `StrategyForm.tsx:356`
- U+2026 `"Validating…"`: `CsvUploadStep.tsx:751`
- **`e2e/api-key-flow.spec.ts:212`** asserts `getByRole("button", { name: /Validating/i })` —
  a *prefix* regex, so it survives either form. ✅ no e2e break either way.

Per global Rule 7 the planner must **pick one and say why**, not blend. The cheapest correct
answer: leave the ASCII label alone (it is the incumbent at 4 of 5 sites and has a recorded
superseding decision) and log the inconsistency to `TODOS.md`. Changing it is a repo-wide
copy sweep this phase did not scope.

⚠️ Related: memory `project_milestone_v1_10_backbone_unification` — *"e2e grep-gates scan
`src/` ONLY → grep the WHOLE repo before disclosure-deletes AND RENAMES; sweep BACKWARD:
every string `e2e/` asserts must still exist in `src/`."* Any copy change in this phase
(e.g. the new escalation lines, the `Stop waiting` control) must be swept backward against
`e2e/`.

### Finding 10 — Roster member count correction (incidental)

D-08 states the two rosters hold "22 members each". Scripted count with a digit-inclusive
literal regex gives **24 each** (the naive `[A-Z_]+` regex misses `KEY_MT5_MASTER_PASSWORD`
and `KEY_MT5_WRONG_SERVER`). The **substantive** claim in D-08 — that all three stopgap codes
are present and the sets are identical — is **CONFIRMED**. Flagged only so nobody types `22`
into a new count assertion. [VERIFIED: scripted count 2026-08-08]

---

## Reference Tables

### Table A — the nine code-less `validatePayload` 400 arms, with proposed codes

All line numbers re-derived from HEAD 2026-08-08 [VERIFIED]. `validatePayload` is at `:337`.
Line = the `{ status: 400 …}` line; the body line is one above.

| # | Line | Condition | Current body | Field-level? | Proposed code (planner's call) |
|---|---|---|---|---|---|
| 1 | `:347` | `!body \|\| typeof body !== "object"` | `Invalid request body` | no | `VALIDATION_FAILED` (already a `WizardErrorCode`) |
| 2 | `:374` | `!isUuid(strategy_id)` | `strategy_id must be a valid UUID` | no (never user-typed) | `VALIDATION_FAILED` |
| 3 | `:383` | `!STRATEGY_NAME_SET.has(name)` | `name must be one of the allowed codenames` | **yes** → `name` `<Select>` | new, e.g. `METADATA_NAME_INVALID` |
| 4 | `:396` | `len < 10 \|\| len > MAX_DESCRIPTION_CHARS` | `description must be 10-5000 characters` | **yes** → description | `METADATA_DESCRIPTION_TOO_SHORT` / `_TOO_LONG` (UI-SPEC mints both) |
| 5 | `:405` | `!isUuid(category_id)` | `category_id must be a valid UUID` | **yes** → category `<Select>` | new, e.g. `METADATA_CATEGORY_REQUIRED` |
| 6 | `:428` | `!isValidDollar(aum)` | `aum must be a finite non-negative number under …` | **yes** → AUM input | new, e.g. `METADATA_AUM_INVALID` |
| 7 | `:439` | `!isValidDollar(max_capacity)` | `max_capacity must be …` | **yes** → capacity input | new, e.g. `METADATA_CAPACITY_INVALID` |
| 8 | `:474` | `entry_context ∉ {manager, contribution}` | `entry_context must be 'manager' or 'contribution'` | no (never user-visible) | `VALIDATION_FAILED` |
| 9 | `:503` | `!isCapitalOwnership(capital_ownership)` | `capital_ownership must be '…' or '…'` | **yes** → the OWN-03 radio group | new, e.g. `METADATA_CAPITAL_OWNERSHIP_INVALID` |

⚠️ **Arm 9 carries a comment that ARGUES FOR the defect** (`route.ts:486-495`):

> *"Deliberately mirrors the entry_context arm above: a bare `error` string with **NO `code`**,
> because every code the wizard renders must exist in its error roster — an unknown one
> renders the UNKNOWN card, which tells the user nothing (Pitfall 7)."* [VERIFIED: source]

That reasoning was correct *given a hand-listed roster*. WIZFORM-02 removes the premise.
**The comment must be rewritten in the same edit**, or the next reader will restore the bug.

⚠️ Every new `WizardErrorCode` member moves `EXPECTED_TABLE_SIZE` at **two** sites —
`wizardErrors.test.ts:1437` and `:1649`, both currently `64` [VERIFIED]. UI-SPEC FLAG-4
already restates this as **64 → 67** for *its* three members; each additional member from
Table A pushes it further. The final number must be computed from the actual member list, not
copied from the UI-SPEC.

⚠️ **Not every arm needs a NEW member.** `VALIDATION_FAILED` already exists and already means
"a request that failed its shape check". Minting a member per arm inflates the table and is
the vocabulary-lying failure `SEAM_CODE_TO_WIZARD_CODE`'s docblock warns about. Mint members
only where a **field-level** message must be routed back to a **specific field**
(UI-SPEC Surface 2: *"each field-level 400 code maps to exactly one field id"*).

### Table B — SC-4b arithmetic under a 90 000 ms MT5 arm

Formula (`seam-budgets.invariant.test.ts:596-664`), per branch:
`Σ(timeoutMs × calls × (1+retries)) + Σ(retries × calls × (BACKOFF+JITTER)) + Σ(storeCmds(state) × (1+retries) × 4 250 × calls)`
where `STORE_COMMAND_WORST_CASE_MS = 4 250` and `storeCmds = {closed:1, open:1, failing:3}`.
All the legs below are `retries: 0`, so both retry terms vanish.

| Route | Branch | closed | open | **failing** | ceiling | headroom (failing) |
|---|---|---|---|---|---|---|
| `keys/validate-and-encrypt` | ccxt (30+30+60k) | 132 750 | 12 750 | 158 250 | 300 000 | 141 750 |
| `keys/validate-and-encrypt` | **mt5** (90+30+60k) | 222 750 | 12 750 | **248 250** | 300 000 | **51 750** |
| `strategies/create-with-key` | ccxt (30+30k) | 68 500 | 8 500 | 85 500 | 300 000 | 214 500 |
| `strategies/create-with-key` | **mt5** (90+30k) | 128 500 | 8 500 | **145 500** | 300 000 | **154 500** |
| `strategies/composite/add-key` | **mt5** (90+30k) | 128 500 | 8 500 | **145 500** | 300 000 | 154 500 |
| `strategies/finalize-wizard` | composite | 192 500 | 42 500 | **277 500** | 300 000 | 22 500 *(unchanged — the tightest row in the table, pinned as a literal)* |

**All fit.** The 300 s `expectedMaxDurationS` does not move, confirming the CONTEXT's
"~300s of unused headroom" reading. `finalize-wizard` remains the binding route at 22 500 ms.

⚠️ These figures are **hand-computed from the tables** and must be re-derived by running the
test, not trusted. The invariant test's own header carries a headroom table that will need
updating with these rows. [VERIFIED: formula read from source; arithmetic performed here —
**not executed**.]

### Table C — the full pin surface a new `SEAM_BUDGETS` row must clear

| # | File · site | What breaks | Action |
|---|---|---|---|
| 1 | `resilient-fetch.ts:415` `SeamBudgetKey` union | type error | add the key |
| 2 | `resilient-fetch.ts` `SEAM_BUDGETS` | — | add the row: `timeoutMs: 90_000`, `dependencies: ["mt5-gateway"]`, `retries: SEAM_RETRIES`, `notes` |
| 3 | `resilient-fetch.ts` `SEAM_ROUTE_BUDGETS` ×3 routes | — | add branch-labelled legs on `validate-and-encrypt`, `create-with-key`, `composite/add-key` |
| 4 | `seam-constants.pin.test.ts:97-112` `EXPECTED_TIMEOUT_MS` | `it.each` lookup | add the row |
| 5 | `seam-constants.pin.test.ts:119-133` `EXPECTED_BUDGET_KEYS` | **sorted set equality** (`:267-272`) | add the key |
| 6 | `seam-constants.pin.test.ts:157-171` `EXPECTED_DEPENDENCIES` | equality (`:315`) | add `["mt5-gateway"]` |
| 7 | `seam-constants.pin.test.ts:185-199` `EXPECTED_RETRIES` | equality | add `0` |
| 8 | `seam-constants.pin.test.ts:558-565` "uses exactly **three** magnitudes — 15s, 30s and 60s" | ⚠️ **prose becomes false; the assertions still pass** | rewrite the `it` name and the comment; add a fourth representative |
| 9 | **`seam-constants.pin.test.ts:704-718` A-25 tombstone** | ⚠️ **stays GREEN while its premise breaks** | update the `60_000` literal to the new longest budget — see §Finding 1 |
| 10 | `resilient-fetch.ts:268-274` `BREAKER_LOCK_TOMBSTONE_S` docblock | prose names `process-key-sync, 60 000 ms` as the longest | rewrite; raise the constant if budget > 90 000 |
| 11 | `seam-retry-registry.ts` + `.test.ts:188-191` `EXPECTED_ALL_ANALYTICS_KEYS` union equality | equality | add the key to `RETRY_AUDIT_NO_ANALYTICS` with its audit verdict |
| 12 | `seam-constants.pin.test.ts:411-444` registry size literals | hand-typed counts | bump the matching count |
| 13 | `seam-budgets.invariant.test.ts:386-469` `EXPECTED_ROUTE_BUDGETS` | **deep equality** (`:705-720`) | mirror the new legs |
| 14 | `seam-budgets.invariant.test.ts:931-943` "exercises the branch MAX on at least one row" | asserts `multiBranch === [FINALIZE_WIZARD_ROUTE]` | add the new multi-branch routes |
| 15 | `seam-budgets.invariant.test.ts:85-131` header headroom table | prose | update with Table B's rows |
| 16 | `analytics-client.ts:684` | — | `budgetKey: budgetKeyFor(exchange)` |

⚠️ Items **8, 9 and 10 are the dangerous ones**: they are *prose or literal restatements* of a
property, and none of them fails on its own when the property breaks.

### Table D — what the `closed-sets.mt5-flag` pin ACTUALLY asserts

D-16 says the pin covers `UI_EXCHANGE_CODES` / `EXCHANGES` / `FUNDING_EXCHANGES` /
`CRYPTO_EXCHANGES`. **The docblock at `closed-sets.ts:119-122` names four sets; the TEST
asserts only two.** [VERIFIED: `closed-sets.mt5-flag.test.ts` read in full — 72 lines]

| Set | Asserted in the pin? | Site |
|---|---|---|
| `UI_EXCHANGE_CODES` | ✅ flag-ON `:62` and flag-OFF `:69` | `.includes("mt5") === false` |
| `EXCHANGES` | ✅ flag-ON `:63` and flag-OFF `:70` | `.includes("MT5") === false` |
| `FUNDING_EXCHANGES` | ❌ **not asserted here** | — |
| `CRYPTO_EXCHANGES` | ❌ **not asserted here** — but `closed-sets.test.ts:110-116` DOES pin `mt5 ∉ CRYPTO_EXCHANGES`, and that is a **√252-vs-√365 annualization** fact that MT5-14 must NOT disturb | `closed-sets.test.ts` |

**Two further pins in the neighbourhood, flag-OFF so unaffected by Option A but worth knowing:**
- `closed-sets.test.ts:202-207` — `expect(EXCHANGES).toEqual(["Binance","OKX","Bybit","Deribit"])`
- `closed-sets.test.ts:192-200` — `SUPPORTED_EXCHANGES` already contains `"mt5"` (the key-save
  boundary was widened in Phase 135); **this needs no change**.

⚠️ **`CRYPTO_EXCHANGES` must stay mt5-free.** `closed-sets.test.ts:80-83` and `:119-127` pin
`isCryptoExchange("mt5") === false` and `fromExchange("mt5") === 252`. Widening it would
silently annualize an MT5 series on the crypto √365 clock — a money-math regression, not a UI
one. **The D-16 re-cut is about the UI-offered sets only.**

---

## Common Pitfalls

### Pitfall 1 — ⭐ A hand-typed pin that restates a property cannot see the property break
**What goes wrong:** A-25's assertion (`60_000 >= 60_000 - 30_000`) and the
"three magnitudes" assertion both encode "the longest seam budget is 60 s" as a *literal on
both sides*. Introduce a longer budget and both stay green while the invariant they describe
becomes false.
**Why:** the file's own doctrine — "never derive the oracle from the module under test" —
produces literal-vs-literal assertions, which are immune to the module *and* to reality.
**How to avoid:** treat every hand-typed number that *restates* a table fact as a **manual
checklist item** (Table C rows 8-10), and grep the docblocks for the old number after the
change.
**Warning signs:** an assertion whose failure message names a concept ("the longest seam
budget") that appears nowhere in the expression.

### Pitfall 2 — ⛔ Deleting `MetadataStep.tsx:491`'s `disabled` without widening `:230` re-ships the exact defect
`MetadataStep.tsx:491` is `disabled={!description.trim() || !categoryId}`. The UI-SPEC deletes
it. But `handleSubmit`'s early return at `:222-233` is **`.trim()`-only** and does not check
`categoryId` at all — its comment at `:225-229` justifies the narrowness with *"The Submit
button stays disabled until both are present."* [VERIFIED: source]

Delete `:491` alone and a **2-character description passes `.trim()` and POSTs** — the
WIZFORM-01 defect, restored by the fix. The client mirror (`10 ≤ len ≤ 5000` **and**
`categoryId` present) must become the `handleSubmit` predicate, and the stale comment must be
rewritten in the same edit. (UI-SPEC ⛔ FLAG-3.)

### Pitfall 3 — The emitter regex will not see `{ error, code }` order
See §Finding 3. `EMITTER_RE` requires `code:` **first**. A coverage assertion that matches
nothing is *blind*, not satisfied — and the file's own `DERIVED_FLOOR` exists because that
exact failure mode is silent.
**Warning sign:** the derived count for `finalize-wizard` comes back `0` or suspiciously low.

### Pitfall 4 — Skipping the scope probe on an UNRESOLVED venue disables a security control
`apiKeyExchange` is `null` on a lookup fault. The gate must fail **toward probing**. See
§Finding 2.

### Pitfall 5 — Retrying into an open breaker (the trap ROADMAP names)
`isBreakerOpen(budgetKey)` checks `breakerKeysFor(budgetKey)` = the row's declared
dependencies **plus** the global `breaker:railway` (`resilient-fetch.ts:989-990`). A new MT5
budget row declaring `["mt5-gateway"]` inherits both keys. In the **open** state
`CircuitOpenError` is thrown *before* `fetch`, so the request budget is not spent
(`STATE_SPENDS_REQUEST_BUDGET.open === false`). ⇒ **retry is not merely discouraged, it is
structurally wasteful**: a retry re-runs `isBreakerOpen`, charges a second store round, and
throws again. D-07 is satisfied by adding no retry at all; `retries: 0` on the new row and
absence from `RETRY_SAFE_ANALYTICS` are the two mechanical statements of that.

### Pitfall 6 — Wrapping the MT5 `finally`-close inside the new end-to-end deadline
Leaks the RPyC session on the timeout path. See §Finding 7.

### Pitfall 7 — A copy string this phase changes that `e2e/` still asserts
The backward-sweep rule from `project_milestone_v1_10_backbone_unification`. Verified today:
`e2e/api-key-flow.spec.ts:212` uses a prefix regex `/Validating/i` and survives. **Re-run the
sweep for every new/changed string before landing.**

### Pitfall 8 — Widening `CRYPTO_EXCHANGES` while widening the UI sets
See Table D. Annualization regression, not a UI one.

---

## Code Examples

### Venue-aware budget selection (the one-literal change)

```typescript
// Source: src/lib/analytics-client.ts:672-687 (HEAD)
export async function validateKey(
  exchange: string,              // ← the venue is ALREADY here
  apiKey: string,
  apiSecret: string,
  passphrase: string | undefined,
  tenant: TenantIdentity,
) {
  const data = await analyticsRequest(
    "/api/validate-key",
    { exchange, api_key: trimCredential(apiKey), api_secret: trimCredential(apiSecret),
      passphrase: passphrase ?? null },
    { budgetKey: "validate-key", tenantId: tenant.userId },   // ← this literal
  );
  return parseResponse(ValidateKeyResponseSchema, data, "/api/validate-key");
}
```

### The structural Retry suppression (do NOT add a prop)

```typescript
// Source: src/lib/envelope.ts:54-57, 88
const RECOVERABLE_ACTIONS: ReadonlySet<WizardErrorAction> = new Set([
  "clear_and_retry",
  "try_another_key",
]);
// …
recoverable: copy.actions.some((a) => RECOVERABLE_ACTIONS.has(a)),
```

A copy entry whose `actions` are `["request_call", "expand_log"]` yields `recoverable: false`
and `ErrorEnvelope` renders no Retry control. Four existing codes rely on this.

### The flag-gated venue-set widening (the sFOX precedent, if Option A is chosen)

```typescript
// Source: src/lib/closed-sets.ts:199-217
const UI_EXCHANGE_CODES_BASE = ["binance","okx","bybit","deribit"] as const
  satisfies readonly SupportedExchange[];
const UI_EXCHANGE_CODES_WITH_SFOX = ["binance","okx","bybit","deribit","sfox"] as const
  satisfies readonly SupportedExchange[];
export const UI_EXCHANGE_CODES: readonly SupportedExchange[] = SFOX_UI_ENABLED
  ? UI_EXCHANGE_CODES_WITH_SFOX
  : UI_EXCHANGE_CODES_BASE;
```

⚠️ Two independent flags means **four** literals under Option A, not two. `as const satisfies`
must be preserved on each so the closed-set guarantee survives.

---

## Runtime State Inventory

> Included because this phase changes constants that live in more than one runtime.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | **None affecting behaviour.** `strategies.supported_exchanges` may already hold the lowercase string `"mt5"` for keys connected before MT5-14 (see §Finding 5: `canonicalizeExchange("mt5")` returns `"mt5"` unchanged today, and the server applies no closed-set check). After the widening, `canonicalizeExchangeList` case-insensitively dedupes on **load**, so a resumed draft self-heals; a **finalized** row keeps `"mt5"`. | Code edit only. **No data migration is required** for correctness — but the planner should decide whether a display-time canonicalisation is needed on `ReviewStep` / admin views, or accept `"mt5"` rendering as-is on already-finalized rows. |
| **Live service config** | `NEXT_PUBLIC_MT5_ENABLED` and `MT5_ENABLED` are Vercel/Railway env vars, **not in git**. Memory records both as `true` in production. Option A (§Finding 5b) ships its full blast radius the moment the code merges, because the flag is already on. | **Confirm the live flag state before merging.** No config change is needed by this phase. |
| **OS-registered state** | None — this phase registers nothing. | None. |
| **Secrets / env vars** | `MT5_REQUEST_TIMEOUT_S`, `MT5_LOGIN_TIMEOUT_MS`, `MT5_DERIVE_READ_TIMEOUT_S`, `MT5_RESTART_TIMEOUT_S` are all **env-overridable** (`os.getenv` defaults in `mt5_client.py:82,88` and `mt5_concurrency.py:60,70`). A new `_MT5_VALIDATE_DEADLINE_S` should follow the same `os.getenv(..., default)` convention. ⚠️ If any of these is *set* in the Railway environment, the D-02 ordering chain is governed by the env value, not the code default. | **Verify the Railway env for `MT5_*` overrides** before sizing the deadline. No key rename. |
| **Build artifacts** | None — no packaging change, no `pyproject.toml` rename. | None. |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node / npm | vitest, tsc, eslint | ✓ | repo-pinned | — |
| vitest | the whole TS gate | ✓ | `^4.1.2` (`package.json:71`) | — |
| `@vitest/coverage-v8` | the blocking coverage gate | ✓ | `^4.1.10` | — |
| playwright | `npm run test:e2e` | ✓ | in `package.json` | — |
| Python 3 + pytest | `analytics-service/` gate | ✓ | — | ⚠️ **must be run from `analytics-service/`** (memory: repo-root run misses the VCR cassette dir and makes LIVE broker calls) |
| `pandera` | `csv_validator` / `middleware` / `mt5` python tests | ⚠️ often missing locally | `0.32.1` | `pip install 'pandera==0.32.1' --break-system-packages` |
| `mypy --strict` | pre-ship gate for `analytics-service` | ✓ | — | memory: **run before `/ship`** — the GSD milestone runs pytest only |
| Live MT5 gateway | not needed | — | — | This phase is code + constants; **no live MT5 run is required** (that is Phase 155). |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `pandera` (documented install line above).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (TS) | vitest `^4.1.2` |
| Config file | `vitest.config.ts` (coverage thresholds: lines 82 / statements 80 / functions 74 / branches 72) |
| Quick run command | `npx vitest run <file>` |
| Full suite command | `npm test` (= `vitest run`) |
| Coverage command | `npm run test:coverage` — **blocking CI gate** |
| Framework (Python) | pytest, `--cov-fail-under=80` |
| Python run command | `cd analytics-service && python3 -m pytest tests/test_exchange*.py -x` ⚠️ **must run from `analytics-service/`** |
| Lint | `npm run lint` (eslint + two manifest scripts) |
| e2e | `npx playwright test e2e/api-key-flow.spec.ts` |

### Phase Requirements → Test Map

| Req | Behaviour | Type | Automated command | File exists? |
|-----|-----------|------|-------------------|--------------|
| WIZFORM-01 | A 2-char description is refused inline; no POST fires | unit (RTL) | `npx vitest run src/app/\(dashboard\)/strategies/new/wizard/steps/MetadataStep.test.tsx` | ✅ extend |
| WIZFORM-01 | Submit with errors focuses the FIRST invalid control, opening a collapsed `<details>` first | unit (RTL) | same file | ✅ extend |
| WIZFORM-01 | The submit button is **not** `disabled` for a validation reason; the `handleSubmit` predicate refuses instead (Pitfall 2) | unit (RTL) | same file | ✅ extend |
| WIZFORM-01 / D-12 | An `AllocateDialog` amount fixed after an error clears the red **live**, and the border derives from `aria-invalid` | unit (RTL) | `npx vitest run src/app/\(dashboard\)/allocations/components/AllocateDialog.test.tsx` | ✅ extend |
| WIZFORM-02 | Every `finalize-wizard` emitted code clears `KNOWN_FINALIZE_CODES` or the alias table — **derived from disk** | invariant (source scan) | `npx vitest run src/lib/wizardErrors.invariant.test.ts` | ✅ extend `ROUTES` |
| WIZFORM-02 | The derivation is NOT vacuous (site-count floor for the third route) | invariant | same file | ❌ **Wave 0** — add the floor beside the new route |
| WIZFORM-02 | SELF-TEST: the widened emitter predicate matches the new arm shape | invariant | same file | ❌ **Wave 0** |
| WIZFORM-02 | Each of the nine 400 arms returns its code | route unit | `npx vitest run src/app/api/strategies/finalize-wizard/route.test.ts` | ✅ extend |
| WIZFORM-02 | `EXPECTED_TABLE_SIZE` moves at **both** sites (`:1437`, `:1649`) | unit | `npx vitest run src/lib/wizardErrors.test.ts` | ✅ update |
| WIZFORM-03 | A `substitutable: false` venue never receives a venue-substitution `fix[]` bullet — asserted over the **whole copy table**, not one code | unit | `npx vitest run src/lib/wizardErrors.test.ts` | ❌ **Wave 0** — a class-level sweep, not three instance cases |
| WIZFORM-03 | A `fix[]` bullet presupposing a surface is **suppressed** when `context.surface` is absent | unit | same | ❌ **Wave 0** |
| WIZFORM-04 | An MT5 submit makes **zero** `keys-permissions` seam calls | route unit (mock `resilientFetch`, assert call count 0) | `npx vitest run src/app/api/strategies/finalize-wizard/route.test.ts` | ✅ extend |
| WIZFORM-04 | An **unresolved** venue (`null`) still probes (fail-toward-probing, Pitfall 4) | route unit | same | ❌ **Wave 0** |
| WIZFORM-04 | A ccxt submit still probes — byte-identical behaviour | route unit | same | ✅ extend |
| WIZFORM-05 | `budgetKeyFor("mt5")` selects the long row; every other venue selects `validate-key`; an unknown string falls back to `validate-key` | unit | `npx vitest run src/lib/analytics-client.*.test.ts` (locate) | ❌ **Wave 0** |
| WIZFORM-05 | SC-4a/b/d/e/f still green with the new legs | invariant | `npx vitest run src/lib/seam-budgets.invariant.test.ts` | ✅ update rosters |
| WIZFORM-05 | Every budget key / timeout / dependency / retry pin | pin | `npx vitest run src/lib/seam-constants.pin.test.ts` | ✅ update literals |
| WIZFORM-05 | ⭐ **A-25 holds against the NEW longest budget** — `(COOLDOWN + TOMBSTONE) × 1000 ≥ max(timeoutMs over SEAM_BUDGETS)` | pin | same file | ❌ **Wave 0** — see below |
| WIZFORM-05 | The Python probe's end-to-end deadline is bounded, and the nested ordering `LOGIN_MS < REQUEST_S < STAGE_S < DEADLINE_S` holds | unit | `cd analytics-service && python3 -m pytest tests/ -k mt5 -x` | ✅ extend |
| WIZFORM-05 | The `finally`-close still runs when the end-to-end deadline fires | unit | same | ❌ **Wave 0** |
| MT5-14 | Flag OFF ⇒ no MT5 in any offered set (byte-identical) | pin | `npx vitest run src/lib/closed-sets.mt5-flag.test.ts` | ✅ re-cut |
| MT5-14 | Flag ON ⇒ MT5 **is** offered in the wizard chip set (the **positive** assertion the pin lacks today) | pin | same | ❌ **Wave 0** |
| MT5-14 | `CRYPTO_EXCHANGES` stays mt5-free; `isCryptoExchange("mt5") === false` | pin | `npx vitest run src/lib/closed-sets.test.ts` | ✅ already exists — **must stay green** |
| MT5-14 | MT5 is **preselected** from `detectedExchange`, and the pinned chip is a `<span>` (not a disabled `<button>`) | unit (RTL) | `MetadataStep.test.tsx` | ❌ **Wave 0** |
| MT5-14 | `supportedExchanges` always contains the detected venue in the submitted payload | unit (RTL) | same | ❌ **Wave 0** |
| Cross-cutting | e2e wizard flow still green | e2e | `npx playwright test e2e/api-key-flow.spec.ts` | ✅ |
| Cross-cutting | a11y (new long-wait card, new inline errors) | e2e axe | `npx playwright test e2e/axe-app-wide.spec.ts` | ✅ |

⭐ **The A-25 test is the single highest-value new assertion in this phase.** Write it so it
**derives** the longest budget from `SEAM_BUDGETS` and compares it to the **hand-typed**
breaker constants — derivation-vs-hand-typed, the shape `SC-4f` uses. That converts §Finding 1
from a checklist item into a mechanism, and it fails automatically for **any** future budget
raise, not just this one:

```typescript
const longestBudgetMs = Math.max(...Object.values(SEAM_BUDGETS).map(b => b.timeoutMs));
expect((BREAKER_COOLDOWN_S + BREAKER_LOCK_TOMBSTONE_S) * 1_000).toBeGreaterThanOrEqual(longestBudgetMs);
```
Keep the existing literal-vs-literal assertion **beside** it (it catches the constants moving);
this one catches the *coupling* breaking. Neither implies the other — the same reasoning the
invariant test uses at `:1091-1108`.

### Sampling Rate

- **Per task commit:** the single vitest file(s) the task touched, plus `npx tsc --noEmit`.
- **Per wave merge:** `npm test` (full vitest) + `npm run lint` + `cd analytics-service && python3 -m pytest -x`.
- **Phase gate:** full vitest with `--coverage` (thresholds are blocking), `mypy --strict` on
  `analytics-service`, full playwright, then `/gsd:verify-work`.
- ⚠️ **CI is Node 22, local is Node 25.** A CI-only vitest failure is not a flake —
  reproduce with `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm test`.
- ⚠️ **Never run the python and e2e-seeded suites concurrently against the shared TEST DB.**

### Wave 0 Gaps

- [ ] ⭐ A-25 derived-longest-budget assertion in `src/lib/seam-constants.pin.test.ts` — covers WIZFORM-05
- [ ] `budgetKeyFor(exchange)` unit tests incl. the unknown-venue fallback — WIZFORM-05
- [ ] Vacuity floor + SELF-TEST for the widened emitter predicate in `wizardErrors.invariant.test.ts` — WIZFORM-02
- [ ] Class-level sweep asserting no `substitutable:false` venue receives a substitution bullet — WIZFORM-03
- [ ] Surface-absent ⇒ bullet suppressed — WIZFORM-03
- [ ] Fail-toward-probing on an unresolved venue in `finalize-wizard/route.test.ts` — WIZFORM-04
- [ ] Python: `finally`-close survives the end-to-end deadline; ordering-chain assertion — WIZFORM-05
- [ ] Flag-ON positive assertion in `closed-sets.mt5-flag.test.ts` — MT5-14
- [ ] MT5 preselect + `<span>`-not-`<button>` pinned chip in `MetadataStep.test.tsx` — MT5-14
- [ ] Framework install: **none needed**

---

## Security Domain

`security_enforcement` is not disabled in `.planning/config.json` ⇒ enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard control in this phase |
|---------------|---------|-------------------------------|
| V2 Authentication | no | No auth change. `finalize-wizard` stays `withAuth`. |
| V3 Session Management | no | No session change. |
| V4 Access Control | **yes** | ⚠️ `runScopeBroadeningProbe` **is a security control** — the scope-broadening defence that stops a key broadened to trade/withdraw between Connect and Submit from being promoted. Skipping it for MT5 is safe **only** because MT5 read-only is enforced structurally (`Mt5Client` composes only read methods, no `__getattr__` passthrough) **plus** behaviourally (`order_check` master-login rejection) at `_validate_mt5_key`. That justification must be written at the skip site, and the skip must fail **toward** probing on an unresolved venue (Pitfall 4). The user-scoped + belt-and-braces `user_id` ownership filter at `:715-724` is untouched. |
| V5 Input Validation | **yes** | The nine `validatePayload` arms are the server-side control. **Client mirrors are UX; the server arms must not weaken.** Adding a `code` to a 400 changes the response body, not the decision. ⚠️ `supported_exchanges` has **no closed-set check** server-side (`validateStringArray` only filters strings and caps at 20) — widening the UI set does not create a new injection path, but it also means the server will accept any 20 strings. That is pre-existing and out of scope; **do not "fix" it here** without checking every consumer of `strategies.supported_exchanges`. |
| V6 Cryptography | no | Untouched. `validate-key` is strictly pre-encrypt / pre-RPC (diagnosis 2026-08-05: nothing is persisted server-side), which is exactly why the UI-SPEC's `Stop waiting` needs no confirmation. |
| V7 Error Handling / Logging | **yes** | Every new error path must route through `scrubSeamError` (`@/lib/seam-redaction`). ⛔ Do **not** re-introduce a route-local scrubber (`route.ts:283-305` records why). ⛔ No raw exception, Python identifier, HTTP status, module path or env-var name may reach user copy (UI-SPEC). |
| V13 API / Web Service | **yes** | The new budget row must **not** interpolate any wire value into a breaker key (T-140-01, `resilient-fetch.ts:102-108`). `budgetKeyFor` must map over a closed set with a safe default. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard mitigation, as applied here |
|---|---|---|
| User-influenced breaker key ⇒ cross-tenant DoS or a breaker that never trips (T-140-01) | Denial of Service | `budgetKeyFor` returns one of a **closed set of module constants**; never `\`validate-key-${exchange}\`` |
| Weakening a security control while "removing a call" | Elevation of Privilege | The probe skip is per-venue, justified by a *different* enforcement mechanism, and fails toward probing |
| Retry amplification into an open breaker ⇒ one venue takes down every submit | Denial of Service | `retries: 0` on the new row + absence from `RETRY_SAFE_ANALYTICS` + no loop added (D-07) |
| Longer budget ⇒ longer lambda hold ⇒ more concurrent MT5 waiters | Denial of Service | ⚠️ **Recorded, not mitigated:** a 90 s MT5 budget triples the worst-case hold for that arm. The `100/hour` per-tenant limiter on `/api/validate-key` (`exchange.py:469-471`) is the only bound. Vercel's per-IP cap is no defence against a distributed caller — the same accepted exposure `process-key-sync`'s ME-04 note records. |
| Credential material in a log line | Information Disclosure | `scrubSeamError` at every catch; `ConnectKeyStep.tsx:595-603` records the measurement that this route's rejections carry no credential |
| A red field without `aria-invalid` (a11y control silently degraded) | — | The border **derives** from the aria state (`aria-[invalid=true]:border-negative`), making the degraded state structurally unreachable |

---

## State of the Art

| Old approach | Current approach | When changed | Impact here |
|---|---|---|---|
| Per-call `AbortSignal.timeout()` constants inside routes | `SEAM_BUDGETS` table + `resilientFetch(budgetKey, …)` | Phase 140 / SEAM-01 | Budgets are table data; a call-site override is a **regression** |
| A production `timeoutMs` override | Removed at 140-05; the option is **tests-only** | Phase 140-05 | Rules out the "venue parameter" reading of Claude's-discretion |
| `SEAM_RETRIES = 0` module-wide | Per-row `retries` + `retriesOverride` gate fed by `RETRY_SAFE_*` registries | Phase 141 / SEAM-06 | A new row needs a registry verdict, not just a number |
| Flat breaker store cost | `(1 + retries)` charged **per leg** | Phase 141.1 / D-15 | Zero-extra for `retries: 0` rows — the new MT5 row is unaffected |
| Route budgets as a plain sum | `branch`-labelled mutually exclusive legs, MAX across branches | Plan 140.2-10 / A-29 | **The mechanism this phase should reuse** |
| Hand-listed client error rosters | Rosters **derived from disk** and asserted (`wizardErrors.invariant.test.ts`) | Phase 142.2-07 | The class fix WIZFORM-02 needs is an extension, not an invention |
| `KEY_INVALID_FORMAT` swallowing 12 guards | Split into four honest codes | Phase 142.2 / MT5-04 | The precedent for splitting the nine 400 arms |
| `code`-less 400 as a *deliberate* choice ("the roster would reject it") | WIZFORM-02 inverts the premise | **this phase** | ⚠️ `route.ts:486-495`'s comment must be rewritten, not left |

**Deprecated / outdated:**
- **`35s` as a target for anything** — it is `MT5_REQUEST_TIMEOUT_S + 5.0`, a nested-timeout
  ordering margin. D-01/D-02.
- **The REQUIREMENTS.md line numbers for `finalize-wizard`** — re-derived here; see Table A.
- **`resilient-fetch.ts:268-274`'s "the longest budget is `process-key-sync`, 60 000 ms"** —
  false the moment this phase lands.

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | `NEXT_PUBLIC_MT5_ENABLED=true` and `MT5_ENABLED=true` in production (memory-sourced, not verified against Vercel/Railway in this session) | Finding 5b | Option A's marketing-count change would land live on merge rather than staying dark. **Verify before choosing.** |
| A2 | The recommended Python end-to-end deadline of ~70 s (⇒ ~80 s server worst case) | Finding 7 | It is a design proposal, not a measurement. No distribution of *successful* MT5 logins exists — only failure figures (35–70 s+). If real successes exceed 70 s, the deadline becomes the new inversion. |
| A3 | Adding a parallel optional field to `WizardErrorCopy` is cheaper than changing `fix`'s type | Finding 6 | If `.fix` has few consumers, the structured-entry shape may be cleaner. Grep `\.fix\b` before deciding. |
| A4 | The composite arm at `route.ts:1102` may not need the venue gate at all (composites are crypto-only per `:808`) | Finding 2b | If an MT5 composite is reachable, an ungated composite submit still makes live MT5 calls and D-06 is only half-satisfied. |
| A5 | `deriveRoster`'s `indexOf("const KNOWN_FINALIZE_CODES")` matches a function-scoped declaration | Finding 3 | If it does not, the derived roster comes back empty and the coverage assertion is blind. Cheap to verify by running the test. |
| A6 | Table B's SC-4b figures (hand-computed from the tables, **not executed**) | Table B | If wrong in the unsafe direction a route could breach its 300 s ceiling. Run `npx vitest run src/lib/seam-budgets.invariant.test.ts` after the change; it recomputes independently. |
| A7 | No `supported_exchanges` consumer rejects the value `"MT5"` | Finding 5 | A downstream display/filter could break on the new member. The DB column has no CHECK named in the sources read here, but this was not exhaustively verified. |

---

## Open Questions

1. **Which MT5-14 widening shape — Option A (widen `UI_EXCHANGE_CODES`, sFOX precedent) or
   Option B (a narrow wizard-only chip set)?**
   - What we know: both re-cut the pin deliberately; A follows the house pattern exactly and
     retires the pin's reasoning; B honours the reasoning and adds the positive guard the pin
     lacks. A changes a **public marketing count** and seven other surfaces, live on merge if
     A1 holds.
   - What's unclear: whether the founder wants MT5 offered on the manager `<Select>`, the
     discovery filters, the mandate form and the public teaser dropdown — none of which
     MT5-14 asks for.
   - Recommendation: **Option B**, with the pin re-cut to keep both negatives and gain a
     positive assertion on the new set. It delivers exactly the requirement's words ("MT5 is
     declarable in the **supported-exchanges metadata step**") with no unrequested surface
     change. ⚠️ Escalate to the founder if the planner disagrees — this is a product decision,
     not a technical one.

2. **Does sFOX also opt out of the submit-time scope probe?**
   - What we know: sFOX asserts `read_only=True` **structurally** for the same reason MT5
     does (`_validate_sfox_key` docstring), and sFOX exposes no per-key scope endpoint.
   - What's unclear: whether the ccxt permissions probe currently *succeeds* for sFOX, or
     whether sFOX has been silently paying a failing probe.
   - Recommendation: **default the capability record so sFOX is byte-unchanged**, and log the
     question to `TODOS.md`. Changing sFOX's submit path is outside the six requirements.

3. **Which of the nine 400 arms deserve a NEW `WizardErrorCode` member vs `VALIDATION_FAILED`?**
   - What we know: only field-level codes need a 1:1 field mapping (UI-SPEC Surface 2). Arms
     1, 2 and 8 are never user-typed.
   - Recommendation: mint members only for the six field-level arms; route the other three to
     the existing `VALIDATION_FAILED`. That keeps `EXPECTED_TABLE_SIZE`'s growth honest.

4. **`ConnectKeyStep.tsx:781` still disables submit for validation reasons**
   (`!apiKey || (requiresSecret && !apiSecret) || …`), which contradicts the standing founder
   direction the UI-SPEC quotes ("no disabled buttons") — but the UI-SPEC only scopes the
   `MetadataStep` deletion.
   - Recommendation: **leave it** (Rule 3, surgical), and log it to `TODOS.md`. Widening the
     phase to every disabled button is a separate campaign.

5. **The `Validating...` vs `Validating…` conflict (§Finding 9).**
   - Recommendation: keep ASCII (incumbent at 4 of 5 sites, with a recorded superseding
     decision at `MultiKeyConnectStep.test.tsx:19-21`); log the inconsistency.

---

## Sources

### Primary (HIGH confidence) — in-repo source, read this session
- `src/lib/resilient-fetch.ts` — `SEAM_BUDGETS`, `SEAM_ROUTE_BUDGETS`, breaker constants + docblocks
- `src/lib/seam-budgets.invariant.test.ts` — read in full (1 191 lines)
- `src/lib/seam-constants.pin.test.ts` — pin tables, A-25 assertion, magnitudes assertion
- `src/lib/seam-retry-registry.test.ts` — registry key-set equalities
- `src/lib/wizardErrors.ts` — union, copy table, `formatKeyError`, `WizardErrorContext`, `SEAM_CODE_TO_WIZARD_CODE`
- `src/lib/wizardErrors.invariant.test.ts` — read in full; the derived-roster mechanism
- `src/lib/envelope.ts` — read in full
- `src/lib/closed-sets.ts` — venue sets, `EXCHANGE_DISPLAY`, `MT5_UI_ENABLED`, `MAGNITUDE_CAPS`
- `src/lib/closed-sets.mt5-flag.test.ts` — read in full (72 lines)
- `src/lib/closed-sets.test.ts` — `EXCHANGES` pin, `CRYPTO_EXCHANGES` pins, `MAGNITUDE_CAPS` pin
- `src/lib/constants.ts` — `canonicalizeExchange`, `canonicalizeExchangeList`
- `src/lib/analytics-client.ts` — `analyticsRequest`, `validateKey`
- `src/lib/process-key-client.ts` — `budgetKeyFor` precedent
- `src/app/api/strategies/finalize-wizard/route.ts` — `validatePayload`, `fetchLivePermissions`, `runScopeBroadeningProbe`, the venue resolve, both probe call sites
- `src/components/ui/Field.tsx` — read in full
- `src/components/ui/LiveRegion.tsx` — contract docblock
- `src/app/(dashboard)/strategies/new/wizard/steps/{MetadataStep,ConnectKeyStep,MultiKeyConnectStep,SubmitStep,SyncPreviewStep}.tsx`
- `src/app/(dashboard)/allocations/components/AllocateDialog.tsx`
- `src/app/(marketing)/page.tsx` — the `EXCHANGES.length` marketing count
- `analytics-service/routers/exchange.py` — `_MT5_PROBE_TIMEOUT_S`, `_validate_mt5_key`, `validate_key`
- `analytics-service/services/mt5_client.py` — `MT5_REQUEST_TIMEOUT_S`, `MT5_LOGIN_TIMEOUT_MS`
- `analytics-service/services/mt5_concurrency.py` — the lock registry and its single-event-loop scope
- `package.json`, `src/app/globals.css` — commands and design tokens

### Secondary (MEDIUM confidence)
- `.planning/phases/153-*/153-CONTEXT.md` — founder-locked decisions (authoritative for intent, corrected here on two incidental counts)
- `.planning/phases/153-*/153-UI-SPEC.md` — approved design contract 6/6 + the nine checker FLAGs
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` — requirement text and binding traps

### Tertiary (LOW confidence — flagged for validation)
- Project memory `project_v1_15_metatrader5_milestone` — production MT5 flag state (A1)
- Project memory `project_milestone_v1_10_backbone_unification` — the backward e2e sweep rule
- Project memory `reference_ci_node22_vs_local_node25`, `reference_pytest_must_run_from_analytics_service_dir`, `reference_local_python_missing_pandera` — test-environment gotchas

**No external documentation was consulted and none was needed** — this phase adds no library.
Per `AGENTS.md`, any Next.js API the executor touches must be checked against
`node_modules/next/dist/docs/` at implementation time; this research asserts no Next.js API
beyond what was read from the repo's own source.

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — no external dependency; every in-repo mechanism read at source
- Architecture / mechanism identification: **HIGH** — `budgetKeyFor`, `branch` legs, the
  capability record, the derived roster and the aria-derived border are all existing,
  CI-wired precedents
- Budget arithmetic (Table B): **HIGH** on the formula, **MEDIUM** on the numbers (hand-computed, not executed)
- The A-25 finding: **HIGH** — three constants and their docblocks read verbatim
- Pitfalls: **HIGH** — each is a source-verified property, not a general caution
- MT5-14 widening blast radius: **HIGH** on the consumer list, **MEDIUM** on the live flag state
- Python deadline sizing: **MEDIUM** — a design proposal against an absent measurement

**Research date:** 2026-08-08
**Valid until:** 2026-09-07 (30 days — in-repo mechanisms, stable; re-derive line numbers if
any phase lands in `finalize-wizard/route.ts`, `resilient-fetch.ts` or `closed-sets.ts` first)
