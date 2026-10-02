# Phase 161: WIZERR — Honest error surfaces - Pattern Map

**Mapped:** 2026-08-24
**Branch:** feat/v1.20-phase-161-wizerr
**Areas mapped:** 6 requested + 3 correction flags
**Analogs found:** 5 strong / 6 requested (area 6 is a partial — see "No Analog Found")

Every file:line below was opened. Where an analog does not exist it says so.

---

## File Classification

| File to create/modify | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `src/lib/wizardErrors.ts` (new union members + copy) | vocabulary/config | transform | itself, `STALE_CLIENT` at `:305` / `:1657` | exact (self-precedent) |
| `src/lib/wizardErrors.test.ts` (table-size constants) | test | derived scan | `:1863-1888` + `:2237-2278` twin literals | exact |
| `src/lib/wizardErrors.invariant.test.ts` (4th `ROUTES` row) | test | source-derived population | `:210-296` `ROUTES` table | exact |
| New coverage law for `PROBE_*` cascade | test | source-derived population | `wizardErrors.invariant.test.ts` whole file | exact |
| `src/app/api/keys/[id]/permissions/route.ts` | route | request-response | itself `:495-570` | exact (self) |
| `src/app/api/keys/validate-and-encrypt/route.ts` (Retry-After threading) | route | request-response | `permissions/route.ts:509-521` | exact |
| 5×5xx→`UNKNOWN` arms (admin match/eval, simulator, …) | route | request-response | `src/app/api/simulator/route.ts:206-214` | exact |
| Three dialogs (Allocate / Rename / MarkOwnership) | component | request-response | `AllocateDialog.tsx:114-159` | exact |
| Wizard-step upstream-arm tests | test | render | `CsvUploadStep.upstream-arm.test.tsx` | exact |
| MT5 flag→cause copy | vocabulary | transform | `FixRequirement` / `VENUE_CAPABILITY_PREDICATES` `wizardErrors.ts:744-836` | role-match |
| CSV 7-row floor on composite arm | service | transform | `src/lib/strategyGate.ts:291-299` | exact |
| CSV `'nan'` / untrusted-cell sanitize at render | component | transform | **no analog** | — |

---

## Pattern Assignments

### 1. Adding a new `WizardErrorCode` + copy entry — the `STALE_CLIENT` worked example

**Canonical commit:** `1cb975c1` (v1.20 Phase 160 closeout, PR #705). Squash-merged; the union+copy
half is isolated in `git show 1cb975c1 -- src/lib/wizardErrors.ts src/lib/wizardErrors.test.ts`
(85 insertions in the source, 35 in the test).

**EXACTLY which files must change together.** Missing one is the known failure mode, and each
mechanism below is different, so `tsc` catches only the first two:

| # | File | What changes | Enforced by |
|---|---|---|---|
| 1 | `src/lib/wizardErrors.ts` — union | new `\| "CODE"` member in `export type WizardErrorCode` (`:58`, member added at `:305`) | nothing (it's a type) |
| 2 | `src/lib/wizardErrors.ts` — copy | new key in `const WIZARD_ERROR_COPY: Record<WizardErrorCode, WizardErrorCopy>` (`:871`, entry at `:1657-1677`) | **`tsc`** — the `Record<Union, …>` mapped type is total, so a member with no copy fails typecheck. This is "the mapped-type totality mechanism". |
| 3 | `src/lib/wizardErrors.test.ts:1888` | `const EXPECTED_TABLE_SIZE = 80` → `81` inside `describe("[140.3-10 / TRAP-4] …")` | hand-typed size guard |
| 4 | `src/lib/wizardErrors.test.ts:2278` | **the twin** `const EXPECTED_TABLE_SIZE = 80` → `81` inside `describe("[140.3-12 / SEAMUX-04] …")` | hand-typed size guard |
| 5 | `src/lib/wizardErrors.test.ts` (end of file) | a third guard added at 153.1-04 reads this source and reds when literals 3 and 4 disagree — no edit needed, but it fires if you move only one | derived reconciliation |
| 6 | the step's roster, if a wizard step reads the code | `KNOWN_CREATE_WITH_KEY_CODES` (`ConnectKeyStep.tsx:265`), `KNOWN_ADD_KEY_CODES` (`MultiKeyConnectStep.tsx:214`), `KNOWN_FINALIZE_CODES` (`SubmitStep.tsx:230`) | `wizardErrors.invariant.test.ts` |
| 7 | `wizardErrors.invariant.test.ts` `expectedSites` for the emitting route | hand-typed per-route count, `ROUTES[].expectedSites` | itself |

**The copy-entry shape to copy verbatim** (`wizardErrors.ts:1657-1677`):

```typescript
STALE_CLIENT: {
  title: "This page is out of date.",
  cause: "This tab has been open since before we changed how keys are added, …",
  fix: [ /* imperative sentences, one per remedy step */ ],
  docsHref: "/security",
  actions: ["leave_and_return", "expand_log"],
},
```

**Recoverability is DERIVED, never declared.** `src/lib/envelope.ts:54` holds
`RECOVERABLE_ACTIONS` (`clear_and_retry`, `try_another_key`); `buildEnvelope` (`envelope.ts:75-88`)
sets `recoverable: copy.actions.some(a => RECOVERABLE_ACTIONS.has(a))`, and `ErrorEnvelope`
renders a Retry control only when true. **This is the mechanism the phase's "no 'try again' remedy
that cannot succeed" criterion runs on** — to suppress Retry you omit both members from `actions`,
you do not add a flag. `STALE_CLIENT`'s comment at `:1667-1676` states this explicitly.

**The alias table is NOT the place for a new code.** `SEAM_CODE_TO_WIZARD_CODE`
(`wizardErrors.ts:3751`) translates codes **another service** put on the wire. A code our own
route mints is a union member outright — see the ⛔ block at `:268-272`.

**Comment convention on a new member** (`:258-305`): a multi-paragraph block above the union member
stating (a) what rendered before, (b) ⛔ why it is not an alias, (c) ⚠️ why each near-neighbour
incumbent was rejected *read at the emitter, not matched on its name*, (d) the recoverability
derivation. Copy that structure; the repo's reviewers expect it and Phase 160's block is the model.

---

### 2. A derived-population coverage law — the template

**Canonical file:** `src/lib/wizardErrors.invariant.test.ts` (1759 lines). This is the strongest
derived-population example in the repo and the planner should copy its skeleton wholesale.

Structure, in order:

1. **`// @vitest-environment node`** first line (`:1`) — it reads the filesystem.
2. **Import the LIVE table rather than re-parsing it where possible** (`:12`,
   `import { VENUE_WIRE_CODE_TO_VERDICT } from "./wizardErrors"`) — comment at `:7-11` explains
   that this is what makes a new row join the population with **no test edit**.
3. **A docblock stating the EMITTER PREDICATE in full prose** (`:76-100`) so any count can be
   reproduced without reading the regex.
4. **`stripCommentsPreserveLines(src, "ts")` before counting** (`:296-298`) — the "14 vs 12" lesson
   at `:54-61`: a raw grep counts comment prose as emitters.
5. **A `RouteUnderTest` interface + a `ROUTES` const** (`:163-296`), one row per emitter site, each
   carrying `label`, `route`, `rosterFile`, `rosterName`, `statusRe`, and a **hand-typed
   `expectedSites`**.
6. **⚠️ `expectedSites` is NEVER `derived.length`** (`:194-201`): "A size compared against its own
   derivation cannot fail: delete every guard in the route and both sides go to zero together."
   This is the Oracle-Independence rule and it is binding.
7. **Derivation helpers**: `deriveEmittedCodes` (`:307`), `deriveUnionMembers` (`:323`, bounded at
   the declaration's terminating `;` so it cannot wander into `WIZARD_ERROR_COPY` and read the
   record keys instead — `:317-322`), `deriveRoster` (`:360`), `deriveAliasPairs` (`:406`),
   `deriveRejectionSites` (`:468`).
8. **`it.each(ROUTES.map(r => r.label))`** for the per-route assertions (`:772`, `:792`, `:822`) —
   per-route, never a merged set (`:39-45`: a merged check passes while each roster silently admits
   the other route's codes).
9. **A block of `it("SELF-TEST — …")` cases at the bottom** — see §5.

**Concrete template for the phase's new `PROBE_*` law** (adapt `ROUTES` shape):

```typescript
// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripCommentsPreserveLines } from "./source-scan";

const REPO = process.cwd();
function stripped(path: string): string {
  return stripCommentsPreserveLines(readFileSync(path, "utf-8"), "ts");
}
// hand-typed, measured; NEVER derived.length
const EXPECTED_PROBE_SITES = /* measure it */;
```

**The 4th `ROUTES` row this phase owes** (booked in TODOS.md from the Phase 160 review) is
`keys/validate-and-encrypt`: `route: join(REPO, "src/app/api/keys/validate-and-encrypt/route.ts")`,
a `rosterFile`/`rosterName` pair (confirm the reading step at plan time — `ApiKeyManager.tsx` and
`AllocatorExchangeManager.tsx` are the measured `STALE_CLIENT` readers, and neither is a wizard
step, so the roster field may need to be optional), a `statusRe` wide enough for its 409, and a
hand-typed measured `expectedSites`.

**Second, lighter derived-population example:** `src/lib/seam-wire-vocabulary.invariant.test.ts`
— `describe("[140.5-05 / SEAMPROSE-08] the populations are real (a scanner that matches nothing
agrees forever)")` at `:165`, then ROSTER COMPLETENESS at `:580`. Same shape, smaller.

Other `readFileSync`-derived laws to browse for local idiom: `seam-budgets.invariant.test.ts`,
`seam-ratelimit-posture.invariant.test.ts`, `seam-citations.invariant.test.ts`,
`src/__tests__/no-store-coverage.test.ts`.

---

### 3. The `.upstream-arm.test.tsx` sibling pattern

**Population is exactly TWO files** (measured, `find src -name "*.upstream-arm.test.tsx"`):
- `src/app/(dashboard)/strategies/new/wizard/steps/CsvUploadStep.upstream-arm.test.tsx`
- `src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.upstream-arm.test.tsx`

⚠️ **Correction to CONTEXT.md:** CONTEXT says `ConnectKeyStep`, `MultiKeyConnectStep`,
`SyncPreviewStep`, `CsvSubmitStep`, `CsvUploadStep` "each with an `.upstream-arm.test.tsx`
sibling". Only the two CSV steps have one. `SyncPreviewStep` instead has seven differently-named
siblings (`.render`, `.runtime`, `.stale.runtime`, `.poll-disjointness.runtime`, …).

**Naming/structure convention** (`CsvUploadStep.upstream-arm.test.tsx:1-90`):
- `/** @vitest-environment jsdom */` first line.
- Docblock headed `── WHAT THIS FILE EXISTS TO STOP, IN BOTH DIRECTIONS ──` enumerating
  DIRECTION 1 (the live defect), DIRECTION 2 (the obvious fix that would be worse), DIRECTION 3
  (a code in *both* vocabularies), then `── THE ARM, IN ITS BINDING ORDER ──` as a numbered list.
- `// Hand-typed literals. These are the REAL sentences the two producers emit, transcribed from
  the route source rather than imported, so the assertion and the implementation are independent
  oracles (Oracle Independence)." (`:48-52`) — **do not import the copy constants into these
  tests.**
- A local `jsonResponse(body, status, headers)` helper (`:82-90`).
- `vi.spyOn` + `mockRestore`, **never `vi.stubGlobal`** (DEF-16-1, stated at `:40`).
- The load-bearing assertions are the **NEGATIVE CONTROLS**: that the generic seam copy
  (`FALSE_HERE_NOTHING_SUBMITTED = "Nothing was submitted"`,
  `FALSE_HERE_NEVER_LEFT = "never left our servers"`, `:79-80`) does **not** appear when the
  route's own vocabulary should win.

**What it asserts, in one line:** that the three-way `!res.ok` arm binds in the order
route-roster → shared wire→wizard hop → founder §4a copy, and that neither outer branch swallows
the middle one.

---

### 4. Server route error envelope shape + no-store convention

**Canonical shape** (`src/app/api/simulator/route.ts:210-213`):

```typescript
return NextResponse.json(
  { error: err.message, code: err.seamCode ?? "UNKNOWN" },
  { status: err.status, headers: NO_STORE_HEADERS },
);
```

- `NO_STORE_HEADERS` is `{ "Cache-Control": "private, no-store" } as const`, defined once at
  **`src/lib/api/headers.ts:13`**. Its docblock (`:1-12`) says every authenticated route's **error
  AND success** responses must carry it, co-located with `withAuth` so route helpers import from
  one source. `src/__tests__/no-store-coverage.test.ts` is the repo-wide fence.
- **Key ordering matters to the scanner.** `wizardErrors.invariant.test.ts`'s `emitterRe`
  (`:155-161`) only sees `NextResponse.json({ code: "LITERAL", error: … }, { …status… })` — `code`
  FIRST, then `error`, both as literals. An arm written `{ error, code }` or with a shorthand
  `{ code }` is **invisible to the coverage law** (documented at `:120-133`; the shorthand
  exclusion is why the count is 12 and not 13). Any new emitter this phase adds must be written
  `code`-first-with-a-string-literal or the law will not see it.

**The `Retry-After` threading pattern to copy** (`src/app/api/keys/[id]/permissions/route.ts:503-521`):

```typescript
return NextResponse.json(
  { error: "Too many requests", code: "PROBE_RATE_LIMITED" },
  {
    status: 429,
    headers:
      seamFailure.retryAfterSeconds === undefined
        ? NO_STORE_HEADERS
        : { ...NO_STORE_HEADERS, "Retry-After": String(seamFailure.retryAfterSeconds) },
  },
);
```

⭐ The absent-value branch omits the header entirely rather than defaulting. The counter-example the
phase must not repeat is documented at `admin/match/eval/route.ts:254-256`: "a forwarded upstream
429 reaches the client WITHOUT its `Retry-After`, and inventing one would name a wait no upstream
stated." That sentence is the phase's own rule already written down.

**The 4xx-forward / 5xx-static split** — the rule governing SC-3's five arms
(`simulator/route.ts:202-214`, restated at `admin/match/eval/route.ts:244-256`): a 4xx `detail` is
operator-curated copy and is forwarded with `err.seamCode ?? "UNKNOWN"`; a 5xx `message` carries
the FastAPI detail, the `parseResponse()` contract-drift string and the service base URL, so it
falls through to a STATIC body (T-140-11). **This means the phase's "forward a recognized
`seamCode` on the 5xx arms" work must forward the CODE only, never the message** — the existing
4xx arm is the analog for the code half, and the 5xx static body stays.

**Client-side read of that envelope** — the three dialogs, §"Unexpected owner" below.

---

### 5. Anti-vacuity: neuter-and-restore expressed in code comments

Two established conventions, both live:

**(a) `it("SELF-TEST — …")` cases inside the law file.** `wizardErrors.invariant.test.ts:1022-1120`
carries five, each with a comment naming the blindness it disproves:

```typescript
it("SELF-TEST — the scanner reads a code out of real emitter syntax", () => {
  // The POSITIVE half, and the load-bearing one: a regex narrowed until it
  // matches nothing satisfies every "missing is empty" assertion above.
  const real = [ /* real emitter syntax, hand-built */ ].join("\n");
  expect(deriveEmittedCodes(real)).toEqual(["REAL_CODE"]);
});
```

The five are: positive scan, comment-is-not-an-emitter, excluded-shapes-really-excluded,
widened-status-sees-502, and narrow-status-still-refuses-502. Every derived law this phase adds
should carry at least the positive half plus one negative.

Same idiom at `src/lib/scenario-backbone-gates.test.ts:220`:
`it("neutered-gate detection — the matcher DOES fire on a synthetic banned-token string", …)`.

**(b) A `MEASURED at <plan-id> by <the mutation>` line in the docblock.**
`wizardErrors.invariant.test.ts:677-686`:

```
 *     that route's literal reds. MEASURED at 153.1-06 by reordering one
 *     route's literal.
 *     else. MEASURED at 153.1-06 by breaking the emitter regex: 13 assertions
 *     went red.
```

**(c) `// FALSIFIABILITY:` inline markers.**
`src/app/(dashboard)/allocations/components/__tests__/bridge-to-composer-seam.test.tsx:184-206`:

```typescript
// neutered to `return draft` (the candidate is never pushed).
// FAILS when neutered (no weightOverride entry is ever written for uuid-2).
// FALSIFIABILITY: with `addStrategyBridge` neutered to `return draft`, …
```

**The prose form for a commit/summary** (from `1cb975c1`'s message, the house sentence):
> "Neutered (spread moved back below the columns) it goes RED with the attacker's uid actually
> landing in the row — 'expected …eeee to be …aaaa' — which is the vulnerability made visible, not
> merely a failing assertion. Restored: 101 passed, tsc and eslint clean."

Copy that three-part shape: **what was mutated → the observed RED message → restored + counts.**

---

### 6. Copy contract split — internal vs public

**Honest answer: there is no single per-code "public vs internal" flag.** A code does not declare
which contract it honors. What exists is three separate, weaker mechanisms — the planner must
design any stronger contract, not assume one:

1. **Per-surface bullet gating (the closest thing to a declared contract).**
   `wizardErrors.ts:735` `export type WizardSurface = "connect" | "submit" | "csv" | "allocate"`,
   `:780-787` `FixRequirement` with `{ kind: "surface"; surface: WizardSurface }`, constants
   `REQUIRES_SUBMIT_SURFACE` (`:812`) and `REQUIRES_CONNECT_SURFACE` (`:833`), applied by the single
   filter `applyFixRequirements` (`:2798-2814`) via the `fixRequires` array **index-aligned to
   `fix`**. ⛔ The docblock at `:770-779` forbids re-expressing any of these as a per-code equality
   arm inside `formatKeyError` — and warns that the acceptance gate counts occurrences of the
   prohibited pattern, so **do not write the prohibited pattern out in prose either**.
   *This is the mechanism the MT5 flag→cause work should use* (Claude's-discretion item "which
   existing helper carries the flag→cause mapping"): a new `FixRequirement` kind, or a new
   `VenueCapabilityName` in `VENUE_CAPABILITY_PREDICATES` (`:744-758`) — "one member here plus one
   entry, never a new branch inside `formatKeyError`" (`:739-742`).

2. **Anonymous/public surface copy is STATIC BY DESIGN.** `src/lib/seam-copy.ts:26-33`:
   `CIRCUIT_OPEN_COPY` carries no upstream URL, no status, no cooldown vocabulary, no error detail;
   "the only dynamic value a breaker arm may publish is the `Retry-After` header. Do not make this
   a function, a template, or a per-route variant." That module is a **zero-import load-bearing
   leaf** (enforced by `seam-copy.purity.test.ts`) because it reaches the browser bundle for every
   anonymous visitor — ⛔ importing `NO_STORE_HEADERS`, a wizard code union, or the envelope builder
   into it would break the purity test in one line (`:16-18`).

3. **Log-side redaction is a separate leaf.** `src/lib/seam-redaction.ts` — `SEAM_SECRET_ENV_NAMES`
   read from `process.env` at call time, `MIN_REDACTABLE_SECRET_LENGTH`, `SEAM_PRESERVE_TOKENS`
   verified AFTER redaction. Two-sided: under-redacting leaks a credential, over-redacting eats
   `ECONNREFUSED` and destroys the diagnosis (`:19-34`). `scrubSeamError(err)` is the call
   (`permissions/route.ts:501`).

**Live precedent for "internal vocabulary stays internal"**: `permissions/route.ts:525-540` keeps
the private `PROBE_*` cascade deliberately un-shared with `classifyKeyValidationError`, because
routed through it "FIVE of this route's six real thrown messages fall to `{code:"UNKNOWN",
status:500}`". The user-facing sentences are three curated strings (`:566-572`); the raw message
stays server-side.

---

## Shared Patterns

### Client error rendering — `buildEnvelope` + `<ErrorEnvelope>`
**Source:** `src/lib/envelope.ts:25-88`, `src/components/error/ErrorEnvelope.tsx:38-65`
**Apply to:** all three SC-3 dialogs and every wizard step.

```typescript
setEnvelope(buildEnvelope(code, correlationId));
// …
<ErrorEnvelope … />
```
Recoverability, and therefore the Retry control, is derived from `actions` (see §1). A dialog
"never invents a bespoke error sentence" — `MarkOwnershipDialog.tsx:150`.

### Correlation id
`src/lib/wizard/wizard-correlation.ts`, with `_resetWizardCorrelationIdForTests` for jsdom tests
(used at `CsvUploadStep.upstream-arm.test.tsx:47`). Per CONTEXT, surface it only on terminal /
non-actionable arms — `STALE_CLIENT`'s `actions: [… , "expand_log"]` is the precedent.

### Logging
`console.error("[keys/permissions] …", scrubSeamError(err))` — bracketed module tag, structured
context, scrubbed error. `permissions/route.ts:496-502`.

### Sentry capture policy
Capture on the terminal arm ONLY. `permissions/route.ts:571-600` states the policy and names its
source (`admin/match/eval/route.ts`): the breaker-trip arm and the 429-throttle arm capture
nothing, because a trip is an expected infrastructure fact and a throttle is the limiter working.

### Gate-code → wizard-code mapping
`gateFailureToWizardError` (`wizardErrors.ts:2966-2995`) — an exhaustive `switch` over
`GateFailureCode`, no `default`, so a new gate code fails `tsc`. **`INSUFFICIENT_CSV_HISTORY`
currently returns `"UNKNOWN"` at `:2989-2994`** with the comment "this code never flows through the
wizard error mapper. UNKNOWN flags the misuse if it ever does." SC-4 makes that comment false —
the atomic plan must flip this arm to a real member **in the same commit** the composite arm starts
evaluating the floor, or the floor fires with copy that says "we could not classify this failure".

---

## Unexpected owners / locations — measured corrections to CONTEXT.md

⚠️ **The three SC-3 dialogs do NOT live where CONTEXT.md says.** CONTEXT's "Integration Points"
gives `ValidateWaitCard.tsx`, `factsheet/[id]/v2/FactsheetView.tsx`, `MyStrategiesSection.tsx`.
Measured by `grep -rln "function <Name>\|const <Name>"`:

| Component | CONTEXT.md claim | **Actual definition** |
|---|---|---|
| `AllocateDialog` | `strategies/new/wizard/ValidateWaitCard.tsx` | `src/app/(dashboard)/allocations/components/AllocateDialog.tsx` |
| `RenameStrategyDialog` | `factsheet/[id]/v2/FactsheetView.tsx` | `src/components/strategy/RenameStrategyDialog.tsx` |
| `MarkOwnershipDialog` | `my-strategies/MyStrategiesSection.tsx` | `src/components/strategy/MarkOwnershipDialog.tsx` |

Each dialog lives in its own PascalCase file, matching CONVENTIONS.md. The CONTEXT paths are
*mentions*: `ValidateWaitCard.tsx:294` merely names `AllocateDialog.test.tsx` in a comment;
`MyStrategiesSection.tsx:26` **imports** `MarkOwnershipDialog` from `@/components/strategy/`;
and `src/app/(dashboard)/factsheet/[id]/v2/FactsheetView.tsx` **does not exist** (the v2 factsheet
body is under `src/app/factsheet/[id]/v2/`). Do not plan edits against the CONTEXT paths.

Their current error arms (all three collapse to `UNKNOWN`, which is SC-3's target):
- `AllocateDialog.tsx:114-159` — the one acted-on refusal is matched on `body.error ===
  NOT_ALLOCATABLE_CODE`; `:159` and `:220` both `buildEnvelope("UNKNOWN", …)`. `:132-138` records
  the exact defect class: "the route has emitted 409 `{error:"not_allocatable"}` since Phase 150
  … and NO client read it: it fell to `UNKNOWN`."
- `RenameStrategyDialog.tsx:141-161` — reads `body.error` through `ROUTE_FIELD_ERRORS`, else
  `buildEnvelope("UNKNOWN")` at `:152` and `:161`.
- `MarkOwnershipDialog.tsx:123-151` — matches `refusal.error === "live_allocation"`, else
  `buildEnvelope("UNKNOWN")` at `:139` and `:151`.

⚠️ **All three match on `error` (a lowercase sentence-ish token), not on `code`.** The phase's
"forward the server-classified code" work has to decide per dialog whether the route grows a `code`
or the client keeps reading `error` — and if a route grows a `code`, the `code`-first-literal
ordering from §4 is required for the coverage law to see it.

⚠️ **MT5 `terminal_info` flags are Python-side only.** `grep -rn "tradeapi_disabled|trade_allowed|
terminal_info" src/` returns **zero non-comment TS hits**. The flags live in
`analytics-service/services/mt5_validation.py:178-266`
(`terminal_trade_permission_off(terminal_info)` at `:243`) and `mt5_client.py:1008-1037`. So the
"six carrier sites" for SC-1 are a wire/copy concern in TS but the *sensor* is Python — confirm the
wire shape at plan time before assuming the flag names reach the TS layer at all. The only TS
mentions of `MT5_GATEWAY_UNREACHABLE` are `wizardErrors.ts:3174`
(`VENUE_WIRE_CODE_TO_VERDICT` → `SERVICE_UNREACHABLE` 503) and prose in `resilient-fetch.ts:518-630`.

⚠️ **`route-contract-manifest.ts` is not the curated-message fence.** CONTEXT calls it "the
curated-message fence's manifest". Measured: `src/lib/routing/route-contract-manifest.ts` is a
**page-routing** manifest (`RouteClass = "public"|"private"|"admin"|"exception"`, `:56`), read only
by `src/__tests__/contracts/contracts-registry.test.ts`, and the word "curated" appears in it once
at `:189` in unrelated prose. The "curated copy" idiom the phase actually means is the 4xx-forward
rule in `simulator/route.ts:205` and `admin/match/eval/route.ts:248`. Planner should treat the
CONTEXT sentence as an error.

---

## No Analog Found

| Need | Role | Data flow | Why no analog |
|---|---|---|---|
| Sanitizing `'nan'` and untrusted cell contents at CSV per-row render | component | transform | `CsvValidationEnvelope.tsx` has no sanitizer; `grep -rn "nan"` over it returns nothing but the word "breakdown" context at `:134`. There is no render-time cell-escaping helper anywhere in `src/components/`. `seam-redaction.ts` is log-side and length-floored, not a render sanitizer. **Planner must design this**, and CONTEXT correctly classes it as data-integrity (an injection surface), not wording. |
| A per-code "public vs internal contract" declaration | vocabulary | transform | Partial only — see §6. `WizardSurface` + `FixRequirement` gate *bullets*, not *codes*. If the phase wants a code-level contract, that is new design. |
| A roster for `keys/validate-and-encrypt` codes | client roster | — | The two measured `STALE_CLIENT` readers (`ApiKeyManager.tsx`, `AllocatorExchangeManager.tsx`) are **not wizard steps** and hold no `KNOWN_*_CODES` set. The 4th `ROUTES` row therefore cannot copy the incumbent shape unchanged — either those components grow a roster, or `rosterFile`/`rosterName` become optional on `RouteUnderTest`. This is a real design decision the plan must make. |

---

## Metadata

**Search scope:** `src/lib/`, `src/app/api/`, `src/app/(dashboard)/strategies/new/wizard/`,
`src/components/strategy/`, `src/components/error/`, `analytics-service/services/`,
`git log -S` over `src/lib/wizardErrors.ts`.
**Files opened:** 161-CONTEXT.md, CONVENTIONS.md, ARCHITECTURE.md, `wizardErrors.ts` (targeted
ranges), `wizardErrors.invariant.test.ts` (1-340, 1000-1130), `wizardErrors.test.ts` (via diff),
`CsvUploadStep.upstream-arm.test.tsx` (1-90), `keys/[id]/permissions/route.ts` (495-600),
`simulator/route.ts` (201-225), `admin/match/eval/route.ts` (244-266), `api/headers.ts`,
`seam-copy.ts`, `seam-redaction.ts`, `strategyGate.ts` (15-24, 291-310), the three dialogs.
**Commits read:** `1cb975c1` (STALE_CLIENT, the canonical worked example).
**Date:** 2026-08-24
