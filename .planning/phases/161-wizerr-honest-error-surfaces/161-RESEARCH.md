# Phase 161: WIZERR — Honest error surfaces - Research

**Researched:** 2026-08-24
**Domain:** In-repo error-surface archaeology (wizard/key/CSV copy, code taxonomy, coverage laws). No external packages.
**Confidence:** HIGH — every file:line below was opened with Read/grep this session at HEAD (`bf00ad0c`), except items explicitly tagged `[ASSUMED]`.

<user_constraints>
## User Constraints (from CONTEXT.md)

> CONTEXT.md mode note, copied: "Smart discuss (autonomous). Recommendations AUTO-ACCEPTED — founder was afk... Every decision below is a default I chose, not one the founder stated. All are cheap to reverse at plan time; none is a one-way door."

### Locked Decisions

**Copy specificity — how much blocker detail reaches the user**
- MT5 copy maps `terminal_info` flags to a human cause ("Algo trading is disabled in the
  terminal", "Trading is not allowed for this account") rather than echoing
  `tradeapi_disabled` / `trade_allowed`. Flag names are internal vocabulary; the founder-hit
  surface gets the cause, not the sensor reading. Fixed as a CLASS across all six carrier
  sites so the next carrier inherits it.
  ⚠️ **Research correction (binding constraint discovered):** the two example sentences above are
  ILLEGAL under the curated-message fence — see § Curated-Message Fence. The decision's *intent*
  (cause, not sensor reading) survives; the example *wording* cannot ship.
- The existing internal-vs-public copy contract stays. Public copy never leaks venue
  internals, key ids, or uids. This is a live constraint, not style: the repo is public and
  factsheets are shareable.
- A correlation id is surfaced only on terminal / non-actionable arms, matching the
  `STALE_CLIENT` precedent set in Phase 160. On an actionable error it is noise that competes
  with the remedy.
- Where retry cannot succeed, the remedy names the real action. `KEY_UNDECRYPTABLE` says
  "reconnect the key". "Try again" is reserved for arms where trying again can actually work.

**Code taxonomy and the `UNKNOWN` fallback**
- New codes are minted as `WizardErrorCode` union members with their own copy entry, not
  aliased onto a near-neighbour.
- `UNKNOWN` stays legitimate for genuinely unclassified 5xx. It is a lie only when the server
  already classified the failure and the client discarded that. That is the WIZFORM-02 class
  and it is what this phase closes.
- The five 5xx→`UNKNOWN` terminal arms (admin match/eval, simulator) forward a recognized
  `seamCode` when one is present, falling back to `UNKNOWN` only when recognition genuinely fails.
- `MT5_GATEWAY_UNREACHABLE`'s `Retry-After` is threaded end-to-end from the server value
  through both key-route catches. The client never invents a duration.

**Coverage law and the anti-vacuity fence**
- Coverage laws derive their population from source (enumerate emitters), never from a
  hand-maintained list.
- The curated-message test fence extends to the `keys/[id]/permissions` private `PROBE_*` cascade.
- ⭐ Every new law is neuter-verified: break the thing it guards, observe RED first-hand,
  restore byte-identical.
- `wizardErrors.invariant.test.ts`'s blindness to `keys/validate-and-encrypt` is closed here
  (4th `ROUTES` row + hand-typed measured site count).

**Scope and sequencing**
- SC-4's "landed together or not at all" is honored as an atomic unit: the 7-row floor on the
  wizard composite arm and `INSUFFICIENT_CSV_HISTORY` rendering its own copy ship in ONE plan.
- Decomposition is one plan per success criterion (4 plans), tracer-first inside each.
- `'nan'` leakage and untrusted-cell echo in the per-row CSV breakdown are treated as
  data-integrity, sanitized at render.
- The 13 requirements stay in one phase. ⚠️ If execution shows SC-4 (CSV) has little in common
  with SC-1..SC-3, flag it for a split rather than pushing through.

### Claude's Discretion
- Exact copy wording, subject to: names the real blocker, names a remedy that can succeed, no
  internal identifiers in public copy.
- Which existing helper carries the flag→cause mapping.
- Plan ordering within each success criterion.

### Deferred Ideas (OUT OF SCOPE)
- i18n / localization of error copy — never raised, out of scope.
- Retry/backoff policy redesign. This phase threads the server's `Retry-After` honestly; it
  does not redesign who retries or when.
- The `secret-scan` workflow_dispatch full-history redness and the stale
  `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env (both booked in TODOS.md from the Phase 160 ship).
</user_constraints>

<phase_requirements>
## Phase Requirements

REQUIREMENTS.md quotes are verbatim from `.planning/REQUIREMENTS.md:34-46` `[VERIFIED: .planning/REQUIREMENTS.md:34-46]`.
⚠️ The `(Lxxx)` refs cite TODOS.md **at the 2026-08-20 snapshot**; the items were DELETED from
TODOS.md at scope commit (`2e67c4a0`). Source texts recovered this session from
`git show 2e67c4a0^:TODOS.md` and re-verified against HEAD code below.

| ID | Description (verbatim) | Research Support |
|----|------------------------|------------------|
| WIZERR-01 | "The MT5 'gateway misconfigured' copy names the actual blocker, derived from the `terminal_info` flags the probe already holds (`tradeapi_disabled` vs `trade_allowed`) — fixed as a class across all six carrier sites, within the curated-message test fence." | § SC-1 inventory; § Curated-Message Fence |
| WIZERR-02 | "'Try another key' never destroys the draft or cascades away composite members." | § SC-2, mutation trace (Q5) |
| WIZERR-03 | "An orphaned live key (no strategy) surfaces an honest remedy instead of a false `DRAFT_ALREADY_EXISTS` 409." | § SC-2, orphan mechanism |
| WIZERR-04 | "The `keys/[id]/permissions` private `PROBE_*` cascade gets a derived-population coverage law, and `KEY_UNDECRYPTABLE`'s remedy sentence says 'reconnect the key', not 'try again'." | § SC-3, PROBE_* cascade |
| WIZERR-05 | "`MT5_GATEWAY_UNREACHABLE`'s server-advertised `Retry-After` threads end-to-end (a fourth optional `AnalyticsUpstreamError` field, relayed by both key-route catches)." | § SC-3, Retry-After thread |
| WIZERR-06 | "The five 5xx→`UNKNOWN` terminal arms (admin match/eval, simulator) forward recognized `seamCode`s instead of collapsing the severe half of the vocabulary." | § SC-3, five-arms count (corrected) |
| WIZERR-07 | "`AllocateDialog`, `RenameStrategyDialog`, and `MarkOwnershipDialog` stop minting `code: UNKNOWN` — the coverage law reaches the dashboard dialogs this class regrew on." | § SC-3, dialog inventory (locations corrected) |
| WIZERR-08 | "The `KEY_INVALID_FORMAT` one-code-many-causes split lands on the remaining 2 routes / 9 sites, honoring their internal-vs-public copy contracts." | § SC-2, 2-routes/9-sites CONFIRMED |
| WIZERR-09 | "The 7-row CSV floor is evaluated on the wizard composite arm, and `INSUFFICIENT_CSV_HISTORY` renders its own copy instead of UNKNOWN — landed together or not at all." | § SC-4 (Q6) |
| WIZERR-10 | "Examined-but-refused verdicts render truthful copy (a fourth outcome replaces the false 'only 0 trade(s)' sentence; the publish-time TOCTOU re-check wording follows), with D-15's oracle re-cut deliberately." | § SC-4, D-15 oracle |
| WIZERR-11 | "Wizard `AUTH_FAILED` copy is parameterized by the selected venue — never names Deribit while Binance is selected." | § SC-2, venue-context mechanism |
| WIZERR-12 | "The csv-finalize A2 409 sentence describes the actual case (same track record, different flow)." | § SC-4, refuse() two-liner |
| WIZERR-13 | "The per-row CSV breakdown renders its data half without leaking `'nan'` or echoing untrusted cell contents." | § SC-4, nan/debug_context trace |
</phase_requirements>

## Summary

This phase closes the recorded WIZFORM-02 open class (Phase 153 span verification FAILED
2026-08-13: server-classified codes still rendering `code: UNKNOWN`). It is 100%
internal-codebase work: copy strings, code taxonomy, and coverage laws across the Next.js
routes/components and the Python analytics-service. No new dependencies; no environment
dependencies beyond the existing test toolchain.

The class has **three regrowth mechanisms**, and the plan must treat them separately because
each has a different closure: (1) the recognition seam's `?? "UNKNOWN"` fallback
(`recogniseSeamErrorCode`, `wizardErrors.ts:3786-3791`) discarding a code the server DID send;
(2) route arms that mint `{ code: "UNKNOWN" }` directly — measured **13 route files** at HEAD
(briefing said ~10) — five of which share one repeated shape (4xx forwards `seamCode`, every
5xx falls to terminal `UNKNOWN`); (3) client components building `buildEnvelope("UNKNOWN")`
for response codes they never read (the three dashboard dialogs). Existing coverage laws
(`wizardErrors.invariant.test.ts` 3-row `ROUTES`, the seam-wire-vocabulary law) are
derived-population + hand-typed-count in form, but are **blind to `keys/validate-and-encrypt`
and to everything outside the wizard-steps directory** — which is exactly where `STALE_CLIENT`
shipped unregistered in Phase 160 and where the dialogs regrew the class.

**Primary recommendation:** four plans mapped 1:1 to SC-1..SC-4 per CONTEXT, tracer-first, in
this order inside each: fix the tracer surface end-to-end → extend the coverage law so the
class cannot regrow → sweep the remaining sites under the now-armed law → neuter-verify the
law (observe RED, restore byte-identical). Two briefing claims are corrected below
(§ Corrections) and one CONTEXT example wording is fence-illegal — the planner must not copy
it into task actions.

## Corrections to the Briefing (measured this session)

1. **Dialog locations.** The briefing said `AllocateDialog` lives in
   `strategies/new/wizard/ValidateWaitCard.tsx`, etc. Measured: those are mention/consumption
   sites. Definitions: `AllocateDialog` →
   `src/app/(dashboard)/allocations/components/AllocateDialog.tsx` (consumed by
   `HoldingsTabPanel.tsx`); `RenameStrategyDialog` →
   `src/components/strategy/RenameStrategyDialog.tsx` (consumed by
   `src/app/factsheet/[id]/v2/FactsheetView.tsx`); `MarkOwnershipDialog` →
   `src/components/strategy/MarkOwnershipDialog.tsx` (consumed by
   `my-strategies/MyStrategiesSection.tsx`). `[VERIFIED: grep -l over src, definitions opened]`
2. **`route-contract-manifest.ts` is NOT the curated-message fence.** It is the Phase-51
   NAV-03 route-CLASS manifest (public/private/admin/exception page routing)
   `[VERIFIED: src/lib/routing/route-contract-manifest.ts:1-56]`. The curated-message fence is
   three Python tests over `MT5_GATEWAY_MISCONFIGURED_DETAIL` — see § Curated-Message Fence.
3. **`.upstream-arm.test.tsx` siblings exist for TWO steps only** (`CsvSubmitStep`,
   `CsvUploadStep`), not all five seam-consuming steps. `ConnectKeyStep` / `MultiKeyConnectStep` /
   `SyncPreviewStep` have `.test.tsx` / `.runtime.test.tsx` files instead
   `[VERIFIED: ls of src/app/(dashboard)/strategies/new/wizard/steps/]`.
4. **Direct `code: "UNKNOWN"` minting: 13 route files, not ~10** `[VERIFIED: grep -rln 'code: "UNKNOWN"' src/app/api --include="*.ts" | grep -v test → 13]`.
5. **REQUIREMENTS.md L-refs are stale.** TODOS.md is 2964 lines at HEAD; L3091 does not exist.
   The source items were recovered from `git show 2e67c4a0^:TODOS.md` (3347 lines) where every
   L-ref resolves `[VERIFIED: per-line sed over the snapshot]`.
6. **WIZERR-06 count reconciliation** — see SC-3: the 4xx-forward/5xx-terminal SHAPE exists in
   **five** route files; the five collapsed **codes** land on three of them.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Error CLASSIFICATION (venue/infra/user fault) | Python analytics-service (`error_contract.py`, `mt5_validation.py`) | Next API routes | Producer classifies; the wire carries `{code, detail, retry_after}` |
| Code → wizard-vocabulary translation | `src/lib/wizardErrors.ts` (client lib) | — | ONE table (`SEAM_CODE_TO_WIZARD_CODE`), one fallback (`UNKNOWN`) |
| Copy rendering + remedies | Wizard step components / dialogs (browser) | `formatKeyError` + `WizardErrorContext` | Copy table is mapped-type-backed; context fields gate parameterized sentences |
| Retry-After transport | Next API routes (headers) + `AnalyticsUpstreamError` (in-process) | Python `_retry_after_headers` | The value originates in `RETRY_AFTER_SECONDS` table server-side; clients never invent one |
| Coverage laws / fences | Vitest invariant tests + pytest parity tests | CI `frontend` / `python` aggregators | Derived populations + hand-typed measured counts (Oracle-Independence rule) |
| CSV validation verdicts | Python `csv_validator.py` + TS `strategyGate.ts` | wizard SyncPreviewStep / admin strategy-review | Gate is shared TS; producer verdicts are Python-stamped |

## Standard Stack

**No new packages. No installs.** This phase edits existing TypeScript (Next.js App Router,
Vitest 4) and Python (FastAPI, pytest) files only. The Package Legitimacy Audit is therefore
**not applicable** (nothing to run the gate against). Ecosystem tooling already present:
vitest + @testing-library (TS), pytest (Python) `[VERIFIED: .planning/codebase/TESTING.md read; vitest.config.ts referenced there]`.

### Reusable in-repo assets (the real "stack" for this phase)

| Asset | Location | Role |
|-------|----------|------|
| `WizardErrorCode` union + `WIZARD_ERROR_COPY` | `src/lib/wizardErrors.ts:58` (union), `:871` (table) | Mapped type `Record<WizardErrorCode, WizardErrorCopy>` — a member without copy fails `tsc` `[VERIFIED: wizardErrors.ts:871]` |
| Copy-table size pin | `src/lib/wizardErrors.test.ts:1888` + `:2275` `const EXPECTED_TABLE_SIZE = 81;` (two pins + divergence guard at `:3535`) | Every new member moves BOTH pins in the same commit `[VERIFIED: wizardErrors.test.ts:1888,2275,3535]` |
| `recogniseSeamErrorCode` + `SEAM_CODE_TO_WIZARD_CODE` | `src/lib/wizardErrors.ts:3751-3791` | 7 explicit rows; `get(seamCode) ?? "UNKNOWN"` — the fallback IS the class `[VERIFIED: wizardErrors.ts:3751-3791, rows quoted in § Regrowth]` |
| `gateFailureToWizardError` | `src/lib/wizardErrors.ts:2966-2996` | Gate-code → wizard-code switch; two arms answer `UNKNOWN` today |
| `WizardErrorContext` | `src/lib/wizardErrors.ts:2651-2761` | `venue?`, `retryAfterSeconds?`, `strategyName?` etc. — the parameterization machinery WIZERR-05/11 ride |
| `checkStrategyGate` + verdict sets | `src/lib/strategyGate.ts` (read in full) | 7-row floor, examined-vs-unexamined split, the false sentence |
| `AnalyticsUpstreamError` | `src/lib/analytics-client.ts:115-170` | 3 optional ctor fields after message; WIZERR-05 adds the 4th |
| Python error contract | `analytics-service/services/error_contract.py:99-220` | `service_error()` validates status-class rules; 503 REQUIRES table-sourced `retry_after` |
| Curated MT5 copy + fence | `analytics-service/services/mt5_probe.py:75-80` + 3 tests | § Curated-Message Fence |
| Invariant-law precedent | `src/lib/wizardErrors.invariant.test.ts:155-280` | Emitter-regex derived population, per-route hand-typed `expectedSites`, roster membership |

## The Class and Its Regrowth Mechanism (orchestrator Q2)

**Mechanism 1 — the recognition fallback.** `[VERIFIED: src/lib/wizardErrors.ts:3786-3791]`:

```typescript
export function recogniseSeamErrorCode(
  seamCode: string | null | undefined,
): WizardErrorCode {
  if (typeof seamCode !== "string") return "UNKNOWN";
  return SEAM_CODE_TO_WIZARD_CODE.get(seamCode) ?? "UNKNOWN";
}
```

The table has exactly these rows `[VERIFIED: wizardErrors.ts:3755-3783]`:
`["VALIDATION_FAILED","VALIDATION_FAILED"]`, `["RATE_LIMITED","RATE_LIMITED"]`,
`["CIRCUIT_OPEN","SERVICE_UNAVAILABLE_RETRY"]`, `["UPSTREAM_TIMEOUT","SERVICE_UNREACHABLE"]`,
`["UPSTREAM_NETWORK_ERROR","SERVICE_UNREACHABLE"]`, `["SEAM_MISCONFIGURED","SEAM_MISCONFIGURED"]`,
`["CSV_RATE_LIMIT","RATE_LIMITED"]`. Any server code not in this table AND not already a
`WizardErrorCode` member renders `UNKNOWN`. **This is how `STALE_CLIENT` shipped unregistered
in Phase 160** (caught only by the closeout review). Note the table is deliberately explicit —
an identity rule would silently admit every future code; do not "fix" the fallback by widening
recognition to identity.

**Mechanism 2 — direct route minting.** 13 route files emit `code: "UNKNOWN"` directly
`[VERIFIED: grep list — bridge, wizard-draft (x2 sites), composite/members (x5), create-with-key (x5), composite/set-members (x3), composite/add-key (x5), admin/strategy-review (x2), admin/match/recompute, admin/match/eval, simulator, keys/validate-and-encrypt (x2), + others]`.
Some are legitimate (genuinely unclassified terminal arms); five share the fixable
4xx-forward/5xx-terminal shape (§ SC-3).

**Mechanism 3 — client-side envelope building outside the law's reach.** The three dashboard
dialogs build `buildEnvelope("UNKNOWN", correlationId)` for any unrecognized failure
(§ SC-3). They live outside the wizard-steps directory that the seam-wire-vocabulary law's
population is derived from.

**Existing coverage laws and their populations:**
- `src/lib/wizardErrors.invariant.test.ts` — `ROUTES` (`:210-226+`) has THREE rows:
  `create-with-key` (statusRe `"400"`, `expectedSites: 12`), `composite/add-key` (`"400"`, 12),
  `finalize-wizard` (`"[45]\\d\\d"`, 32 after three recorded bumps). Population is DERIVED per
  route by regex over the route file (`emitterRe`, `:155-161` — matches
  `NextResponse.json({ code: "X", error: ... }, { status ... })`); the site COUNT is hand-typed
  per the Oracle-Independence rule ("NEVER `derived.length`… three money bugs survived six
  review passes behind self-referential oracles" `[VERIFIED: wizardErrors.invariant.test.ts:195-200]`).
  Roster membership is asserted against hand-typed client rosters `KNOWN_CREATE_WITH_KEY_CODES`
  (ConnectKeyStep) / `KNOWN_ADD_KEY_CODES` (MultiKeyConnectStep) / `KNOWN_FINALIZE_CODES`
  (SubmitStep).
- The booked blindness `[VERIFIED: TODOS.md:653-661 at HEAD]`: "**`wizardErrors.invariant.test.ts`
  is blind to this route.** Its `ROUTES` population covers only `create-with-key`,
  `composite/add-key` and `finalize-wizard`. Nothing forces `keys/validate-and-encrypt`'s
  emitted codes into the `WizardErrorCode` union — which is exactly how `STALE_CLIENT` shipped
  unregistered… Closing it means a fourth `ROUTES` row plus a hand-typed, measured site count,
  and it will likely pull in that route's other emitters — so it is its own change, not a
  same-pass edit. Related: `seam-wire-vocabulary.invariant.test.ts` carries a DECLARED
  BLINDNESS note for the same route's clients (they live outside the wizard-steps directory its
  population is derived from)."
- Second booked finding in the same entry `[VERIFIED: TODOS.md:662-666]`: validate-and-encrypt's
  `const body = await req.json()` has **no try/catch** → malformed JSON = Next default 500 with
  no coded envelope, contradicting "a machine code on EVERY error arm". Pre-existing. The
  planner should fold this into the WIZERR-08/4th-ROUTES-row plan (same file, same law).

**What the 4th ROUTES row needs (measured):** `keys/validate-and-encrypt` emits, at HEAD, codes
at 14 `code: "` sites `[VERIFIED: grep, route.ts:120,135,158,164,238,256,259,315,470,540,649,693,727,749]`:
`KEY_INVALID_FORMAT` ×4, `STALE_CLIENT`, `KEY_RATE_LIMIT`, `SEAM_MISCONFIGURED` ×3,
`KEY_NOT_READ_ONLY`, `UNKNOWN` ×2, `CIRCUIT_OPEN`, `UPSTREAM_TIMEOUT`. ⚠️ The invariant's
emitter regex only matches the `NextResponse.json({ code … }, { status … })` literal shape —
the hand-typed count for the row must be measured under THAT predicate at plan time, not taken
from this raw grep (some sites are object-literal variants, e.g. `throttledBody:` at `:256`).
**There is NO client roster today** for this route's consumers (`ApiKeyForm`, `ApiKeyManager`,
`StrategyForm`, `AllocatorExchangeManager` — `[VERIFIED: grep -l validate-and-encrypt]`; no
`KNOWN_` constant in any of them `[VERIFIED: grep]`) — the row either needs a new roster
constant in a shared consumer module or a row-variant that asserts union membership without a
roster; that is a planner decision to make explicitly, not silently.

## SC-1 Inventory — MT5 "gateway misconfigured" (WIZERR-01, orchestrator Q1/Q3)

### The six carrier files — CONFIRMED as six FILES (9 prose/copy locations)

All opened this session:

| # | File:lines | What it carries |
|---|-----------|-----------------|
| 1 | `analytics-service/services/mt5_probe.py:75-80` | **THE user-rendered copy constant** (below); plus class docstring `:83-102`; plus comment `:242-243` carrying the false assertion verbatim: "under MetaQuotes' default-ON \"Disable automatic trading through the external Python API\" — the very setting that makes trade_allowed false" |
| 2 | `analytics-service/services/mt5_validation.py:24, 186, 228-232` | Module + `classify_trade_capability` docstrings; branch-5 comment: "Terminal-level trade permission is OFF — which subsumes [DOC] \"Disable automatic trading through the external Python API\", MetaQuotes' DEFAULT-ON setting." |
| 3 | `analytics-service/services/mt5_client.py:1018-1026` | `terminal_info` docstring: "``trade_allowed`` — the terminal-level AutoTrading permission. It subsumes the terminal option *\"Disable automatic trading through the external Python API\"*" |
| 4 | `analytics-service/services/job_worker.py:645` (comment) + `:668-669` | `classify_exception` arm: `if isinstance(exc, Mt5GatewayMisconfigured): return ("permanent", MT5_GATEWAY_MISCONFIGURED_DETAIL)` |
| 5 | `analytics-service/services/ingestion/mt5.py:315-345` | Raise site 1 (worker/ingestion path) — comment `:317-318` repeats the claim; raises `Mt5GatewayMisconfigured(MT5_GATEWAY_MISCONFIGURED_DETAIL)` |
| 6 | `analytics-service/routers/exchange.py:851-867` | Raise site 2 (interactive validate path) — comment `:853-854` repeats the claim; raises `service_error(500, "MT5_GATEWAY_UNCONFIGURED", … detail="The MetaTrader gateway is not configured. This needs an operator, not a retry.")` |

The user-visible constant `[VERIFIED: mt5_probe.py:75-80]`:

```python
MT5_GATEWAY_MISCONFIGURED_DETAIL: Final[str] = (
    "MT5 gateway refuses automated trading (the 'Disable automatic trading "
    "through the external Python API' option is in force), so read-only "
    "capability cannot be proven. This needs an operator, not a retry — see "
    "docs/runbooks/mt5-go-live.md."
)
```

**The false premise (founder-measured on the live gateway, from the recovered ledger item):**
`terminal_info().tradeapi_disabled` was `False` (the named option OFF) while
`terminal_info().trade_allowed` was `False` (the actual blocker). `Config/terminal.ini
[Experts]` read `Api=0, Enabled=0, Account=1, Profile=1`. `Enabled` (Options → Expert
Advisors → "Allow algorithmic trading") is what makes `trade_allowed` false; `Api` is an
independent checkbox. It RECURS because `Account=1`/`Profile=1` re-set `Enabled=0` on every
account change, and the worker calls `login()` on every job. `[CITED: recovered TODOS
snapshot L75-104 — founder measurement 2026-08-13; measurement not re-runnable this session]`

**Where the flags are in hand at the decision point (Q3):** both raise sites branch on
`operator_fault = terminal_trade_permission_off(terminal)` with the FULL `terminal` dict in
scope (`ingestion/mt5.py:315`, `routers/exchange.py:851`). `read_terminal`
(`mt5_probe.py:134-206`) returns `client.terminal_info()` unprojected, and
`Mt5Client.terminal_info` (`mt5_client.py:1008-1040`) materializes the whole struct
(`return _materialize(info)`) — so `tradeapi_disabled` is available at both sites without a
re-probe. ⚠️ No production code currently READS `tradeapi_disabled`
`[VERIFIED: grep -rn tradeapi_disabled over analytics-service non-test .py → only comments]`;
its presence as a dict key is `[ASSUMED]` from the founder's live measurement + the unprojected
materialization — the plan's tracer task should assert the key defensively (absent key → today's
generic copy, never a KeyError).

**Cause predicate to extend, not duplicate:** `terminal_trade_permission_off`
(`mt5_validation.py:243-266`) is THE shared cause seam ("a four-condition shape test copied
twice drifts"). The flag→cause mapping helper (Claude's discretion per CONTEXT) belongs beside
it in `mt5_validation.py` or `mt5_probe.py`, consumed by both raise sites, so the next carrier
inherits it — that is the "fixed as a CLASS" requirement.

**⚠️ TWO distinct user-facing strings, not one.** The ingestion path renders
`MT5_GATEWAY_MISCONFIGURED_DETAIL` (persisted as `sanitized_message` by
`classify_exception`); the router path renders its own `detail="The MetaTrader gateway is not
configured. This needs an operator, not a retry."` under code `MT5_GATEWAY_UNCONFIGURED`
`[VERIFIED: routers/exchange.py:861-867; note the same code is ALSO raised at :615-624 for the
env-gap case with the same detail string — the trace.outcome differs ("gateway_unconfigured"
vs "undetermined")]`. Making copy name the actual blocker means both strings (or a shared
curated builder) change, and the fence must cover whatever carries the cause.

## Curated-Message Fence (orchestrator Q4)

The fence is **three Python tests**, not a manifest file:

1. `analytics-service/tests/test_mt5_validate_parity.py:380-403`
   `test_mt5_gateway_misconfigured_message_is_curated_and_credential_free` — asserts, over
   `MT5_GATEWAY_MISCONFIGURED_DETAIL.lower()`: no token from `_WRONG_SERVER_TOKENS` or
   `_AUTH_TOKENS`, no word from `("password", "investor", "master", "secret")`, non-empty, and
   `str(Mt5GatewayMisconfigured()) == MT5_GATEWAY_MISCONFIGURED_DETAIL` (default-argument pin).
2. `analytics-service/tests/test_job_worker.py:137+`
   `test_mt5_gateway_misconfigured_is_permanent_with_curated_message` — `classify_exception`
   returns the curated constant ("⛔ NEVER str(exc)"), and `len > 40`.
3. `analytics-service/tests/test_ingestion_mt5.py:310+` — pins the TYPE and curated constant at
   the ingestion raise.

The token tables `[VERIFIED: mt5_validation.py:79-96]`:

```python
_WRONG_SERVER_TOKENS: tuple[str, ...] = (
    "server", "connect", "ipc", "network", "terminal", "not found",
)
_AUTH_TOKENS: tuple[str, ...] = (
    "authoriz", "account", "invalid", "password", "login",
)
```

**⛔ Binding consequence for the copy decision:** the new cause-naming copy may not contain
(case-insensitively, substring match) **"terminal"**, **"server"**, **"account"**, **"login"**,
**"invalid"**, "connect", "network", "ipc", "not found", "authoriz", "password", "investor",
"master", "secret". CONTEXT's example wordings — "Algo trading is disabled in the **terminal**"
and "Trading is not allowed for this **account**" — both trip the fence. Legal vocabulary that
still names the cause exists (e.g. "Allow algorithmic trading is turned off in the gateway",
"the gateway re-disables algorithmic trading when it switches users") — exact wording is
Claude's discretion, but every candidate sentence must be checked against the token tables
BEFORE the test is run, and the fence itself must not be relaxed (ledger: "Rewrite within that
fence; do not relax the fence").

**How new copy enters the fence:** if the remedy adds per-cause variants (flag-derived), either
(a) multiple curated constants each pinned by the parity test, or (b) one curated builder whose
every output is fence-checked — the parity test file already drives both callers
(router + ingestion) through shared cases, so extending it is the established shape. Any new
constant must keep the default-argument property (`Mt5GatewayMisconfigured()` can never carry
raw remote text by omission — `mt5_probe.py:97-104`; `mt5linux` interpolates the password into
remotely-eval'd source, T-134-01).

**Fence extension to `PROBE_*` (WIZERR-04, locked decision):** the private cascade's five
user-facing sentences (below) currently have NO fence. The "derived-population law" for that
route should follow the venue-vocabulary law's form (hand-typed roster + both-halves
disposition + vacuity floor), per the recovered ledger's shape note: "give the private cascade
a derived-population law of the same form the venue vocabulary now has… rather than deleting
the cascade in favour of the shared classifier — deleting it is the change its docblock
measured as making things worse."

## SC-2 Inventory — Key-lane remedies

### WIZERR-02 — "Try another key" mutation trace (orchestrator Q5)

Call chain, fully verified:

1. `SyncPreviewStep`'s gate-failure envelope offers the remedy; the callback is passed from
   `WizardClient.tsx:1241-1257` `[VERIFIED]`:
   ```typescript
   onTryAnotherKey={() => {
     setStep("connect_key");
     // Regenerate the idempotency token OPTIMISTICALLY (before the
     // fire-and-forget delete) …
     setWizardSessionId(newWizardSessionId());
     void handleDeleteDraft();
     …
   }}
   ```
2. `handleDeleteDraft` (`WizardClient.tsx:959-1028`) issues
   `wizardFetch("/api/strategies/draft/${strategyId}", { method: "DELETE" })`.
3. The DELETE route deletes the strategy row (cascading `strategy_keys` members — the route's
   own sibling comment `WizardClient.tsx:1053-1054` states "deleted the draft and every
   strategy_keys member under it"), then attempts the atomic key revoke
   `[VERIFIED: src/app/api/strategies/draft/[id]/route.ts:199-236]`: RPC
   `delete_api_key_if_unreferenced`; **on RPC error it SKIPS with a warn**
   (`:220-224` — "Skip + log, never risk breaking a sibling"), leaving a live orphaned
   `api_keys` row.
4. The non-destructive precedent already exists ONE PROP AWAY: `onReviewKeys`
   (`WizardClient.tsx:1229-1240`) is "a pure step transition back to connect_key… does NOT
   handleDeleteDraft (which would cascade away every strategy_keys member) and does NOT
   regenerate wizardSessionId".

⚠️ Design constraints the plan must carry: (a) the optimistic `setWizardSessionId` exists to
close red-team LOW-2 (a failed DELETE + old session id would silently replay the OLD draft +
OLD key on resubmit — `:1243-1251`); a non-destructive remedy changes that calculus and must
re-answer LOW-2 explicitly. (b) The confirm-dialog danger button and `start_fresh` paths are
deliberate deletes (`:1046-1073`) and stay. (c) The recovered ledger classes today's behavior
"DoS (user-inflicted)" and notes MT5-12 removed only the *unwinnable* case — the destructive
remedy is still offered on every other refusal.

### WIZERR-03 — the orphaned-key false 409

Mechanism at HEAD `[VERIFIED: src/app/api/strategies/create-with-key/route.ts]`:
- `resolveByVenueIdentity` (`:176-316`) returns `{kind:"unresolved"}` when a live key exists
  but NO strategy row hangs off it (`:306` `if (!ownerRow?.id) return UNRESOLVED;`) — the
  orphan case, explicitly annotated at `:272-280` ("nothing hangs off the key at all (an
  orphan, e.g. its draft was deleted) — fall through, let the RPC's INSERT trip the index and
  let the 23505 arm answer").
- The 23505 race arm re-runs the resolver; for `unresolved` it deliberately falls through
  (`:959-968`, incl. "deliberately NOT a new WizardErrorCode: minting one would move the
  copy-table pins (EXPECTED_TABLE_SIZE) for a state the user cannot act on differently
  anyway") to the 409 at `:1005-1012`:
  ```typescript
  return NextResponse.json(
    { code: "DRAFT_ALREADY_EXISTS",
      error: "A wizard session with this key is already in progress." },
    { status: 409, headers: NO_STORE_HEADERS },
  );
  ```
  — false for the orphan: no session exists, and retrying can never succeed.
- Sibling emitter: `composite/add-key/route.ts:569` `[VERIFIED: grep]`.
- Orphan SUPPLY: the WIZERR-02 revoke-skip above, plus (recovered ledger, not re-read this
  session `[ASSUMED]`) the nightly sweep `cleanup_abandoned_wizard_drafts.sql:19-24,41-49` is
  scoped to keys attached to ≥7-day-old drafts, so a key whose strategy is already gone is
  never a candidate; "Pre-154 this simply created a second key row and worked."
- Closing it honestly requires a NEW code+copy (moving `EXPECTED_TABLE_SIZE` 81→82 and both
  pins, plus the emitting routes' rosters) OR an unresolved-arm resolver upgrade that
  distinguishes "orphan live key" as a third answer with its own remedy ("disconnect/reconnect
  the key") — the `connected` arm (`venueAlreadyConnectedResponse`, `:318+`) is the in-file
  precedent for a purpose-built refusal body.

### WIZERR-08 — `KEY_INVALID_FORMAT` split: 2 routes / 9 sites CONFIRMED

- `src/app/api/keys/validate-and-encrypt/route.ts` → **4 sites** `[VERIFIED: :120 (sFOX
  disabled), :135 (MT5 disabled), :158 + :164 (missing fields)]`
- `src/app/api/verify-strategy/route.ts` → **5 sites** `[VERIFIED: :89 (invalid JSON body),
  :105 (missing required fields), :113 (invalid email), :131 (unsupported exchange — gated on
  `UI_EXCHANGE_CODES`, the OFFERED set, deliberately NOT `SUPPORTED_EXCHANGES`, per the F3
  disclosure note at :118-127), :144 (sFOX disabled)]`
- The four already-minted split codes with copy `[VERIFIED: wizardErrors.ts:107-141]`:
  `KEY_MISSING_REQUIRED_FIELD`, `KEY_UNSUPPORTED_VENUE`, `KEY_VENUE_NOT_ENABLED`,
  `KEY_INPUT_TOO_LONG`; "`KEY_INVALID_FORMAT` keeps exactly ONE emitter per route — the
  `api_secret.length < 8` check on the ccxt venues" (the 142.2 disposition for the two
  incumbent routes).
- **Copy contracts differ and are load-bearing:** `validate-and-encrypt` is an internal
  (authed dashboard) surface; `verify-strategy` is the PUBLIC anonymous teaser. Its `:118-127`
  comment records that leaking the wider venue set "DISCLOSED sfox in the error enum to anon
  callers pre-launch" — so mapping its sFOX gate to `KEY_VENUE_NOT_ENABLED` copy ("not open
  here yet") on the PUBLIC surface would re-create that disclosure. The recovered ledger:
  "the four new codes' wizard copy is not automatically the right copy there."
- ⚠️ Phase-160 coupling: these are the exact files Phase 160 just reworked (`STALE_CLIENT`,
  `attested_venue`), and Phase 160's Part-A PROD smoke on validate-and-encrypt's
  `persist: true` arm is still OWED (`STATE.md:84` deferred-verification row). Edits here must
  not disturb that arm's behavior before the smoke closes, or must note the interaction in the
  plan.

### WIZERR-11 — venue-parameterized `AUTH_FAILED` copy

The offending copy `[VERIFIED: wizardErrors.ts:1006-1012]` — `KEY_AUTH_FAILED`'s `cause`:
"The exchange could not authenticate this key and secret (e.g. Deribit returns
invalid_credentials)…" and a fix bullet: "Re-copy BOTH values with no leading or trailing
spaces — on Deribit the key is the ClientId and the secret is the ClientSecret."

The machinery to fix it ALREADY EXISTS `[VERIFIED: wizardErrors.ts:2713-2728]`:
`WizardErrorContext.venue` (153.1-03 / WIZFORM-03 / D-17) — "Read ONLY as a lookup key into
the closed capability record; it is never interpolated into copy… ABSENT ⇒ a venue-conditional
bullet STILL RENDERS" — with `requirementMet`/`FixRequirement` gating bullets per-venue. The
fix shape is: make the Deribit-specific example + ClientId bullet venue-conditional (render
only when `venue === "deribit"`, or substitute a per-venue bullet from the closed set), never
free-string interpolation of a caller value. ⚠️ Not verified this session: whether
`ConnectKeyStep`/`MultiKeyConnectStep` currently PASS `venue` in context on the
`KEY_AUTH_FAILED` render path — the planner's tracer task must check the call sites; if absent,
threading the already-selected exchange into context is part of the fix. `[ASSUMED: callers may
not thread venue today]`
Related recorded sibling (stays open unless cheap): the `ValidateWaitCard.tsx` queue-disclosure
sentence names "MetaTrader" literally under a class-shaped `venueIsSerialized` gate
`[CITED: recovered snapshot L1871-1882]` — same family, booked separately; not a WIZERR-11
obligation.

## SC-3 Inventory — Coverage-law reach

### WIZERR-04 — the `keys/[id]/permissions` private `PROBE_*` cascade

`[VERIFIED: src/app/api/keys/[id]/permissions/route.ts]` — the private vocabulary at HEAD:

| Code | Site | Copy |
|------|------|------|
| `CIRCUIT_OPEN` | `:443` | `CIRCUIT_OPEN_COPY` (shared) |
| `PROBE_RATE_LIMITED` | `:509` | "Too many requests" (429; upstream `Retry-After` forwarded verbatim `:512-519`) |
| `PROBE_BACKEND_UNAVAILABLE` | `:561-567` | "Could not reach the permissions service. Try again shortly." |
| `PROBE_TIMEOUT` | `:563-569` | "Permissions probe timed out. Try again." |
| `PROBE_FAILED` | `:565-570` | **"Could not check key scopes. Try again."** ← the arm `KEY_UNDECRYPTABLE` lands on |

The cascade is substring classification over `rawMessage` (`:541-559`:
`INTERNAL_API_TOKEN` / `startsWith("Upstream 5")` / `ECONNREFUSED` → config;
`aborted`/`timeout` → timeout; else `PROBE_FAILED`). It is DELIBERATELY kept separate from
`classifyKeyValidationError` — "routed through that classifier, FIVE of this route's six real
thrown messages fall to `{code:"UNKNOWN", status:500}`" (`:530-540`). **Do not replace the
cascade; give it a law** (locked decision + ledger shape note).

**The cheap copy fix is already wired underneath:** the seam callback attaches the upstream's
machine code to the thrown error's `cause` (`:286-294` `buildSeamFailureCause(res.status,
seamCode, parseRetryAfterSeconds(res.headers))`), and the terminal catch already reads it for
the 429 arm (`:487-488` `const seamFailure = readSeamFailureCause(err); if (seamFailure?.status
=== 429)`). A `KEY_UNDECRYPTABLE` 500 arrives with `seamFailure.code === "KEY_UNDECRYPTABLE"`
in hand — the terminal arm just never consults it. The "reconnect the key" remedy is one new
arm keyed on that code, before the substring cascade. (The three codes recorded as landing
here: `KEY_MISSING_EXCHANGE` 422, `KEY_UNDECRYPTABLE` 500, `KEK_UNAVAILABLE` 500 `[CITED:
recovered snapshot L410-435; the VENUE_WIRE_CODES_WITHOUT_VERDICT rows record them]`.)

**Consumer:** `KeyPermissionBadge` (`src/components/connect/KeyPermissionBadge.tsx:121-122`
`[VERIFIED]`) renders `err.code ? \`${err.code}: ${message}\` : message` — the literal
"CODE: message" text (this is MT5-13's `PROBE_FAILED:` red text on the success screen, a
parked-v1.18 requirement — do NOT absorb MT5-13 here, but don't foreclose its per-venue
capability-flag fix either). Mounted from `SyncPreviewStep.tsx` and
`strategies/[id]/edit/page.tsx` `[VERIFIED: grep -l]`.

### WIZERR-07 — the three dialogs

All six minting sites `[VERIFIED: grep + AllocateDialog opened]`:

| Component | UNKNOWN sites | Existing recognition |
|-----------|--------------|----------------------|
| `src/app/(dashboard)/allocations/components/AllocateDialog.tsx` | `:159` (envelope fallthrough), `:220` (transport catch) | Already reads TWO codes: 429→`RATE_LIMITED` (+parsed Retry-After) and 409 body `error === "not_allocatable"` → `ALLOCATION_NOT_ALLOCATABLE` (`envelopeForResponse`, `:141-160`) — the PATTERN to extend |
| `src/components/strategy/RenameStrategyDialog.tsx` | `:152`, `:161` | not read this session beyond grep `[ASSUMED: same buildEnvelope shape]` |
| `src/components/strategy/MarkOwnershipDialog.tsx` | `:139`, `:151` | not read this session beyond grep `[ASSUMED: same shape]` |

Their server routes: `api/portfolio-strategies/allocation/route.ts` and
`api/strategies/[id]/name/route.ts` appear in the dialog-related grep `[VERIFIED: grep -l]`;
the rename/ownership routes' emitted codes must be inventoried at plan time to know what the
dialogs should recognize instead of falling to UNKNOWN. The class fix per the recovered ledger
(`UNKNOWN-DIALOGS-01`): "these mint `UNKNOWN` directly [distinct] from the five
admin/simulator 5xx-terminal-arm routes… different mechanism… so closing one does not close
the other." The coverage-law extension must reach components OUTSIDE the wizard-steps
directory (the seam-wire-vocabulary law's declared blindness).

### WIZERR-06 — the "five 5xx→UNKNOWN terminal arms" (count reconciled)

The 4xx-forward / 5xx-terminal-UNKNOWN SHAPE exists in **five route files**
`[VERIFIED: grep "err.status < 500" + each arm read]`:

| Route | Forward arm | Terminal arm |
|-------|-------------|--------------|
| `api/admin/match/recompute/route.ts` | `:197-224` (`code: err.seamCode ?? "UNKNOWN"` on 4xx) | `:247-250` `{ error: GENERIC_COPY, code: "UNKNOWN" }, { status: 500 }` |
| `api/admin/match/eval/route.ts` | `:260/:290` | `:315` |
| `api/simulator/route.ts` | `:206-211` | `:232` |
| `api/bridge/route.ts` | `:188-201` | `:219` ("Bridge scoring failed. Please try again.") |
| `api/keys/validate-and-encrypt/route.ts` | `:709-721` | `:748-751` ("Key validation failed. Please try again.") |

The five collapsed **codes** (the requirement's "five") land on THREE of them
`[CITED: recovered snapshot L436-458, measured per-arm at 153.7-02]`:
`ADMIN_CHECK_UNAVAILABLE` (503) + `ROLE_CHECK_UNAVAILABLE` (503) + `SCORING_FAILED` (500) →
match-recompute; `EVAL_FAILED` (500) → match-eval; `SIMULATION_FAILED` (500) → simulator.
So: **requirement satisfied by fixing the five ARMS; the class closes by fixing the shape on
all five files.** The ledger's cheap first step stands: "decide whether the 4xx-forward arm
should widen to any status carrying a recognised `seamCode`, which is one edit per route and
would close all five — versus minting per-code members, which is five copy decisions."

⛔ Constraint on the widening: **on 5xx the `error` MESSAGE must stay static.** Both bridge
(`:208-213` H-1062: "Echoing err.message here leaked Python contract-drift strings… and
FastAPI 5xx detail to authenticated allocators") and validate-and-encrypt (`:704-708` F5b:
"never echo a raw 5xx traceback") forbid forwarding the message on 5xx. Forward the CODE,
keep the static sentence. Also note validate-and-encrypt already has its own recognized-code
arms upstream of the terminal one — its 5xx widening interacts with the 4th-ROUTES-row work
(same file, same plan).

### WIZERR-05 — threading `Retry-After` end-to-end

The full path, each hop verified:

1. **Origin:** `analytics-service/routers/exchange.py:627-634` raises
   `service_error(503, "MT5_GATEWAY_UNREACHABLE", dependency="mt5-gateway", retryable=True,
   retry_after=RETRY_AFTER_SECONDS["mt5-gateway"], detail="The MetaTrader gateway is not
   responding. Try again shortly.")`.
2. **Contract:** `error_contract.py:120-152` — a 503 REQUIRES `retry_after`, and it MUST equal
   `RETRY_AFTER_SECONDS[dependency]` ("a raise site never inlines its own wait"). The wire
   body is the nested envelope; a flat form carries `retry_after_seconds`
   (`error_contract.py:73` comment). The header is set by `_retry_after_headers` (`:80`).
3. **The drop:** `src/lib/analytics-client.ts:556-561` constructs
   `new AnalyticsUpstreamError(seamHumanMessage(error) ?? "Analytics service error",
   res.status, seamErrorCode(error), seamDependencyName(error))` — the envelope's retry_after
   and the response's `Retry-After` header both die at this line. `AnalyticsUpstreamError`
   (`:115-170`) carries `status` / `seamCode` / `dependency` — **no retry-after field**.
   The 4th optional ctor field goes here, fed at `:556` from the header
   (`parseRetryAfterSeconds(res.headers)` — the ONE parser; never `Number(header)`) and/or the
   envelope leaf. ⚠️ Type hazard on the ctor already booked (TODOS §4a: positional
   adjacent-same-typed params, "more call sites [than mintTenantClaim]") — a 4th positional
   `number` after two `string|null`s is at least type-distinct; the planner should still
   consider the trailing-options-object form and decide explicitly.
4. **The relays:** both key-route catches stamp `Retry-After` ONLY for
   `err instanceof CircuitOpenError` — `create-with-key/route.ts:1198-1199` and
   `composite/add-key/route.ts:707-708` (`"Retry-After": String(err.retryAfterS)`). Each
   gains an `AnalyticsUpstreamError`-with-retryAfter branch.
5. **The renderers:** `ConnectKeyStep` / `MultiKeyConnectStep` already run
   `parseRetryAfterSeconds(res.headers)` into `WizardErrorContext.retryAfterSeconds`
   (`wizardErrors.ts:2665-2680` — SECONDS end-to-end; "absence means 'no wait was advertised'
   — never 'zero'… an error arm that invents a wait turns a vague failure into a specific lie
   (TRAP-3)"). Once the routes stamp the header, the client renders the wait with zero client
   edits. `[CITED: recovered snapshot L486-501 (WR-04) for the reachability claim:
   MT5_GATEWAY_UNREACHABLE → SERVICE_UNREACHABLE 503 renders a RECOVERABLE envelope as of
   153.7]`
6. Guard note from the current TODOS (`:1238`): "`composite/members` has no `Retry-After`
   producer (recorded in the guard docblock)" — the wait-threading completeness guard is
   partial; extending it is in-scope hygiene for this plan's law work.

## SC-4 Inventory — CSV verdicts (orchestrator Q6)

### WIZERR-09 — the 7-row floor and the missing copy (atomic pair)

**The floor EXISTS** `[VERIFIED: src/lib/strategyGate.ts:13]`:
`export const STRATEGY_GATE_MIN_CSV_ROWS = 7;` — evaluated inside
`checkStrategyGate` only on the `dailyReturnsSourced` branch (`:291-299`), producing
`INSUFFICIENT_CSV_HISTORY` with reason "CSV history has only ${csvRowCount} day(s) of returns.
A minimum of ${STRATEGY_GATE_MIN_CSV_ROWS} days is required."

**Where it is evaluated today:** the admin approve path
(`api/admin/strategy-review/route.ts:251` calls `checkStrategyGate`) and the wizard
SINGLE-KEY arm (`SyncPreviewStep.tsx:1652-1676`, which passes `csvRowCount`). **The wizard
COMPOSITE arm does NOT** `[VERIFIED: SyncPreviewStep.tsx:1287-1313]` — it calls only
`isDailyReturnsSourced` with the divergence self-recorded:

```
// NOT ADDRESSED, deliberately: the admin path also applies a 7-row
// CSV floor that this arm still does not. That divergence is
// PRE-EXISTING — it predates this phase and is not what FIX 3 is
// about — so closing it here would be scope the review did not ask
// for. Recorded in 142.2-FIXES.md rather than silently fixed.
```

Note the guard directly above (`:1240-1254`) repolls while `series.length === 0`, so the
composite arm's `csvRowCount` equivalent is `series.length` and the reachable failing range is
1..6 rows.

**The missing copy** `[VERIFIED: wizardErrors.ts:2989-2994]`:

```typescript
case "INSUFFICIENT_CSV_HISTORY":
  // Admin-approval-only gate code. The wizard's SyncPreviewStep is the
  // exchange-key path (never CSV-sourced), and the CSV upload branch
  // validates via csv-finalize — so this code never flows through the
  // wizard error mapper. UNKNOWN flags the misuse if it ever does.
  return "UNKNOWN";
```

That premise becomes false the moment the composite arm evaluates the floor — hence "landed
together or not at all" (recovered ledger DEF-142.2-12/13: "Closing 12 without this one ships
a real gate refusal rendered as the generic unknown-error copy"). The pair: composite arm
gains the floor check (routing through `checkStrategyGate` or an explicit floor + code), AND
`GATE_INSUFFICIENT_CSV_HISTORY` (or equivalent) is minted as a `WizardErrorCode` with copy
(→ `EXPECTED_TABLE_SIZE` 81→82, both pins).

### WIZERR-10 — the false "only 0 trade(s)" sentence and D-15's oracle

**The false sentence source** `[VERIFIED: strategyGate.ts:339-345]`:

```typescript
if (input.tradeCount < STRATEGY_GATE_MIN_TRADES) {
  return {
    passed: false,
    code: "INSUFFICIENT_TRADES",
    reason: `Strategy has only ${input.tradeCount} trade(s). A minimum of ${STRATEGY_GATE_MIN_TRADES} trades is required.`,
    …
```

**The half already fixed (do not redo):** the NULL/unrecognized-verdict case already routes to
`SERIES_PROVENANCE_UNVERIFIED` (142.2 FIX 1, `strategyGate.ts:323-337`), maps to real wizard
copy (`gateFailureToWizardError:2976-2981`), and is pinned by
`strategyGate.test.ts:235-257`. **The half this phase closes:** the EXAMINED-but-refused case —
`SERIES_EXAMINED_BUT_REFUSED = {"fill_derived_unproven", "sampled_gapped"}`
(`strategyGate.ts:145-148`) — deliberately kept on the trade branch (`:311-314`: "it looked
and found the series wanting… → keep the existing trade-branch routing. The D-15 acceptance
test pins that case and it is unchanged here"). So a gapped perp with 135 daily rows and 0
fills still reads "only 0 trade(s), a minimum of 5 is required" — false and unwinnable
(and its offered remedy is WIZERR-02's destructive one).

**D-15's oracle to re-cut deliberately** `[VERIFIED: src/lib/strategyGate.test.ts]`:
- `:193-217` "⭐ D-15 ACCEPTANCE: keyed perp with an UNPROVEN fill-derived series + 135 csv
  rows + 0 trades is REFUSED" — asserts `result.code === "INSUFFICIENT_TRADES"` (`:216`).
- `:259-279` "FIX 1: the split is 'did a producer look?', NOT 'do we like the answer?'" —
  asserts the examined arm answers `INSUFFICIENT_TRADES` (`:278-279`).
Both pins move in the same commit as the fourth outcome. **The refusal property must survive
the re-cut** (refuse stays; only the CODE/sentence changes) — the re-cut is "deliberate,
never incidental" (founder's anti-vacuity rule: neuter → observe RED → restore applies to
the re-pointed oracle too).

**The TOCTOU follower:** the publish-time re-check is the admin approve path's SAME
`checkStrategyGate` call (`admin/strategy-review/route.ts:251`; the shared-predicate rationale
at `strategyGate.ts:150-156` — the hand-copied re-check "diverged anyway", now one function).
A fourth GateFailureCode automatically reaches it; the plan must verify the admin surface
renders the new reason (it consumes `gate.reason` directly, not wizard copy `[ASSUMED —
admin render path not read this session]`).

### WIZERR-12 — the csv-finalize A2 sentence (a two-liner plus pins)

`[VERIFIED: src/app/api/strategies/csv-finalize/route.ts:1249-1329]`:
- `refuse(reason: string, humanMessage?: string)` exists (146.2-01 added the optional param);
  default sentence at `:1284`: "This wizard session already created a strategy with a
  different track record, so we refused before writing anything of this submission.
  ${START_NEW_STRATEGY_LABEL} to upload a different file." (code `CSV_SESSION_REUSED`, 409).
- The A2 terminal-status-mismatch arm (`:1322-1329`) calls
  `refuse(\`terminal status mismatch (committed '${existingRow.status}', this submission asked
  for '${args.terminalStatus}')\`)` — NO humanMessage, so the default "different track record"
  sentence ships on a case where the track record is the SAME and the FLOW differs (manager
  resubmit onto a committed `private` contribution row, or the mirror — the arm's own docblock
  `:1293-1310`).
- Fix = pass a case-specific `humanMessage` + re-point the pinned fixtures. ⚠️ The pins:
  `CsvSubmitStep.upstream-arm.test.tsx:96/:105` and the c14 regression suite hold VERBATIM
  fixture strings that are "BOTH the mocked wire payload and the expected DOM text… green for
  ANY string; the correspondence to `csv-finalize/route.ts` is enforced by a comment, not by
  code" `[VERIFIED: TODOS.md:2310-2321 (IN-05) at HEAD]` — whoever moves the sentence must
  hand-verify the fixture↔route byte-equality again and say so, or take the declined
  static-coupling fix if this is "the third drift".

### WIZERR-13 — the per-row breakdown's data half, `'nan'`, and untrusted cells

Three verified facts, one per moving part:

1. **The `'nan'` leak** `[VERIFIED: analytics-service/services/csv_validator.py:762-787]`: in
   the `SchemaErrors` loop, the user-facing message is built as
   `f"Column '{row.get('column')}' failed rule '{rule_name}' at row {row_idx}."` — pandera's
   `failure_cases` `column` is NaN for dataframe-level checks, and `str(nan)` renders the
   literal `'nan'` where a column name belongs. The no-echo discipline is already present and
   must be preserved: `:766-767` "NEVER log row.get('failure_case') — that's the raw cell
   value"; `:775-779` "do NOT echo the raw failing cell value… it is untrusted CSV content
   that can carry PII, and this envelope is persisted into strategy_verifications metadata."
2. **The discarded data half** `[VERIFIED: analytics-service/routers/process_key.py:383-419]`:
   `_envelope_error` rebuilds `"debug_context": {"verification_id": vid} if vid else {}` — any
   per-row error detail upstream of it never reaches the wire on the process-key (submit)
   path.
3. **The client readers** `[VERIFIED: grep]`: `CsvValidationEnvelope.tsx:123` reads
   `envelope.debug_context?.pandera_errors ?? []`; the csv-validate (upload) path works
   because `CsvUploadStep.tsx:441/:496` maps the validate route's `data.errors` into
   `pandera_errors` client-side, and `routers/csv.py:110-113` returns `validate_csv`'s result
   directly (200-with-`ok:false` envelope). The broken half is the SUBMIT path through
   `_envelope_error`. The typed row shape everywhere is
   `{ rule: string; row: number; message: string }` — row index + rule + templated message,
   NO cell values, which is exactly the shape that satisfies "renders its data half without
   … echoing untrusted cell contents": forward `{rule, row, message}` (with the nan-guarded
   column name), never `failure_case`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Retry-After parsing | `Number(header)` | `parseRetryAfterSeconds` (the ONE parser) | HTTP-date form → NaN; repo-wide lint error already exists `[VERIFIED: AllocateDialog.tsx:126-127 comment]` |
| Wire→wizard code translation | per-consumer local tables | `SEAM_CODE_TO_WIZARD_CODE` (the ONE table) | "an ALIAS, recorded here, in the ONE table — never a second local one at a consumer" (`wizardErrors.ts:3712-3720`) |
| Cause detection for MT5 flags | a second 4-condition shape test | extend `terminal_trade_permission_off` / add sibling in `mt5_validation.py` | "a four-condition shape test copied twice drifts" (`:248-253`) |
| Gate predicates | hand-copied re-checks | `checkStrategyGate` / `isDailyReturnsSourced` | the hand-copy "diverged anyway" (`strategyGate.ts:150-156`) |
| Coverage-law size oracles | `expect(found.length).toBe(derived.length)` | hand-typed measured literal | Oracle-Independence; self-referential oracles hid 3 money bugs (`wizardErrors.invariant.test.ts:195-200`) |
| Secret-safe error logging | ad-hoc string scrubbing | `scrubSeamError(err, perRequestSecrets)` | validate-and-encrypt carries RAW credentials in-body (`route.ts:731-737`) |
| Correlation ids | new id scheme | `newCorrelationId(...)` + `X-Correlation-Id` (dialog precedent, `AllocateDialog.tsx:201-216`) | Phase-160 STALE_CLIENT precedent: id on terminal arms only |

## Common Pitfalls

### Pitfall 1: Copy that trips the curated fence
**What goes wrong:** the natural cause-naming words — "terminal", "account", "server",
"login", "invalid" — are ALL in the token denylists; the fence test reds and the fix is
tempted to relax the fence. **Avoid:** draft every candidate sentence against
`_WRONG_SERVER_TOKENS` + `_AUTH_TOKENS` + the credential words FIRST (lowercased substring
match). The fence must not be relaxed (ledger instruction). **Warning sign:** any plan task
whose action quotes CONTEXT's example wordings verbatim.

### Pitfall 2: Moving a pinned sentence without re-cutting its pin in the same commit
**What goes wrong:** `EXPECTED_TABLE_SIZE` (×2 + divergence guard), per-route
`expectedSites`, `KNOWN_*` rosters, the D-15 code assertion, the A2 fixture literals — each is
a deliberate pin; editing the guarded thing without the pin reds CI, and editing the pin
without observing RED first vacuates it. **Avoid:** for every pin moved: neuter → RED →
restore → move deliberately, recorded in the plan's verification.

### Pitfall 3: Forwarding `err.message` on 5xx while widening the seamCode forward
**What goes wrong:** leaks Python tracebacks/contract-drift strings to clients (H-1062, F5b).
**Avoid:** forward the CODE; keep the static sentence on every 5xx arm.

### Pitfall 4: "Fixing" `UNKNOWN` by identity-admitting server codes
**What goes wrong:** `code as WizardErrorCode` admits `SEAM_DEGRADED`, every venue code, and
every future code silently (`wizardErrors.ts:3760-3765` states this is why the table is
explicit). **Avoid:** every new recognition is an explicit row or an explicit union member
with copy.

### Pitfall 5: Treating the wizard-session 23505 arm as the orphan arm
**What goes wrong:** create-with-key's `:1005-1012` 409 is BYTE-PINNED as the
unparseable-constraint fallback ("must keep the behaviour that shipped"); the orphan case
reaches it via `unresolved` fallthrough. Changing the shared arm changes the
wizard-session-fence answer too. **Avoid:** discriminate the orphan BEFORE the fallthrough
(resolver third answer or a race-arm branch), leaving the fence 409 byte-identical for its
own case.

### Pitfall 6: Editing `keys/validate-and-encrypt` while its PROD smoke is owed
**What goes wrong:** Phase 160's Part-A deferred verification (`STATE.md:84`) needs the
`persist: true` arm's first real PROD connect; landing WIZERR-08 edits first muddies whose
change any smoke failure belongs to. **Avoid:** sequence or explicitly note; do not alter the
persist arm's behavior.

### Pitfall 7: The worktree/testing traps (standing, from MEMORY)
GSD worktree agents get NO node_modules (`npx vitest` exits 1); pytest must run FROM
`analytics-service/` (else VCR cassette misses → LIVE broker calls); run
`mypy --strict` before shipping analytics-service changes; CI is Node 22 vs local Node 25.

## Validation Architecture

(nyquist_validation: true in `.planning/config.json` `[VERIFIED]`)

### Test Framework
| Property | Value |
|----------|-------|
| Frameworks | Vitest 4 (TS, jsdom) · pytest (Python, from `analytics-service/`) · Playwright (e2e, not needed this phase) |
| Config | `vitest.config.ts` (coverage thresholds: lines 82 / stmts 80 / fns 74 / branches 72 — blocking) · `analytics-service/pytest.ini` |
| Quick run | `npx vitest run <file>` (repo root, NOT in a worktree) · `cd analytics-service && python3 -m pytest tests/<file> -x` |
| Full suite | `npm run test` · `cd analytics-service && python3 -m pytest` (+ `mypy --strict` before ship) |

### Phase Requirements → Test Map
| Req | Test type | Automated command | Exists? |
|-----|-----------|-------------------|---------|
| WIZERR-01 | pytest parity/fence | `python3 -m pytest tests/test_mt5_validate_parity.py -x` (+ job_worker, ingestion_mt5 pins) | ✅ fence exists; cause-variant cases = Wave 0 additions in same files |
| WIZERR-02/03 | vitest route+component | `npx vitest run src/app/api/strategies/create-with-key/route.test.ts` + WizardClient/SyncPreviewStep suites | ✅ suites exist; new arms need new cases |
| WIZERR-04 | vitest route + NEW law | `npx vitest run 'src/app/api/keys/[id]/permissions/route.test.ts'` (+ `route.seam.test.ts`) | ✅ route tests exist; the derived-population law is NEW (Wave 0) |
| WIZERR-05 | vitest lib+routes | `npx vitest run src/lib/analytics-client.test.ts` + both key-route tests | ✅ exist; retryAfter field cases new |
| WIZERR-06 | vitest 5 route tests | each route has `route.test.ts` (bridge/simulator/match — `[VERIFIED: test files mock AnalyticsUpstreamError locally]`) — ⚠️ they re-declare the class locally; a ctor change must not silently miss them | ✅ |
| WIZERR-07 | vitest component | `npx vitest run src/components/strategy/RenameStrategyDialog.test.tsx` etc. + law extension | ✅ AllocateDialog.test.tsx exists (has the Button/Modal identity carve-out — do not disturb) |
| WIZERR-08 | vitest 2 route tests + 4th ROUTES row | `npx vitest run src/lib/wizardErrors.invariant.test.ts` | ✅ invariant file exists; row is NEW |
| WIZERR-09/10 | vitest gate + step | `npx vitest run src/lib/strategyGate.test.ts src/lib/wizardErrors.test.ts` + SyncPreviewStep.composite.render | ✅; D-15 re-cut deliberate |
| WIZERR-11 | vitest copy tests | `npx vitest run src/lib/wizardErrors.test.ts` | ✅; venue-conditional cases new |
| WIZERR-12 | vitest route + fixtures | `npx vitest run src/__tests__/csv-finalize-c14-regression.test.ts` + CsvSubmitStep.upstream-arm | ✅; fixtures re-pointed by hand |
| WIZERR-13 | pytest validator + vitest envelope | `python3 -m pytest tests/ -k csv_validator -x` + `npx vitest run 'src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.test.tsx'` | ✅ both exist |

### Sampling Rate
- **Per task commit:** the touched file's own suite (commands above).
- **Per wave merge:** `npm run test` (sharded locally is fine) + `cd analytics-service && python3 -m pytest` when Python touched.
- **Phase gate:** full TS + Python suites green, `mypy --strict` on analytics-service, coverage thresholds intact, before `/gsd-verify-work`.
- ⚠️ Ledger rule: every CI gate is ADVISORY at merge (no branch protection until paying clients) — verification wording must say "the workflow **would have** caught it", never "did stop it".

### Wave 0 Gaps
- [ ] NEW: derived-population law over `keys/[id]/permissions` `PROBE_*` vocabulary (venue-vocabulary-law form) — covers WIZERR-04.
- [ ] NEW: 4th `ROUTES` row (`keys/validate-and-encrypt`) + measured `expectedSites` + roster decision — covers WIZERR-08 and the STALE_CLIENT regrowth vector.
- [ ] NEW: law extension reaching the three dialogs (population outside wizard-steps dir) — covers WIZERR-07.
- Everything else lands in existing suites.

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Existing: zod schemas on routes, `pandera` on CSV; this phase must NOT weaken any refusal — copy-only where possible, refusals unchanged |
| V6 Cryptography | touch-adjacent | `validate-and-encrypt` handles RAW credentials — per-request secret scrubbing (`scrubSeamError(err, [api_key, api_secret, passphrase])`) must survive every edited arm |
| V7 Error Handling & Logging | **core of the phase** | No `err.message` forwarded on 5xx; no untrusted CSV cell in copy/logs/Sentry; no credential words in MT5 copy (fence); correlation id only on terminal arms |
| V14 Config | yes | Repo is PUBLIC and `.planning/` is tracked — no PROD refs/secrets in plan docs |

| Threat pattern | STRIDE | Mitigation in-phase |
|----------------|--------|---------------------|
| Untrusted CSV cell echo → PII/injection into persisted metadata | Information Disclosure / Tampering | Forward `{rule,row,message}` only; nan-guard the column name; never `failure_case` (csv_validator discipline already written — keep it) |
| Venue-set disclosure to anon (verify-strategy) | Information Disclosure | Public copy gates on `UI_EXCHANGE_CODES` (offered set); WIZERR-08 split must not name unlaunched venues on the public surface |
| Credential echo through error arms | Information Disclosure | `scrubSeamError` + per-request secrets on validate-and-encrypt; curated MT5 constant default-argument property |
| User-inflicted data loss via destructive remedy | DoS (recorded class) | WIZERR-02 replaces the fire-and-forget delete remedy |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `terminal_info()` dict contains `tradeapi_disabled` as a key on the live gateway (founder measured it 2026-08-13; no production reader exists to confirm shape) | SC-1 | Flag-derived copy falls back to generic; guard defensively so it cannot KeyError |
| A2 | `cleanup_abandoned_wizard_drafts.sql:19-24,41-49` sweep-blindness for already-orphaned keys (from recovered ledger; SQL not re-read this session) | SC-2 / WIZERR-03 | If the sweep now catches them, the orphan 409 is transient not permanent — remedy copy differs |
| A3 | Rename/MarkOwnership dialogs share AllocateDialog's `buildEnvelope` fallthrough shape (grep-verified sites; files not fully read) | SC-3 / WIZERR-07 | Fix pattern may need per-dialog variation |
| A4 | ConnectKeyStep/MultiKeyConnectStep do not currently pass `venue` in `WizardErrorContext` on the KEY_AUTH_FAILED render | SC-2 / WIZERR-11 | If they already do, the fix is copy-table-only |
| A5 | Admin strategy-review renders `gate.reason` directly (so the WIZERR-10 fourth outcome reaches the TOCTOU surface without a wizard-copy hop) | SC-4 | Admin surface may need its own copy mapping |
| A6 | The five Python codes (`ADMIN_CHECK_UNAVAILABLE`, `ROLE_CHECK_UNAVAILABLE`, `SCORING_FAILED`, `EVAL_FAILED`, `SIMULATION_FAILED`) are still the live 5xx emitters behind the three named routes (measured at 153.7-02, 2026-08-14; Python emitters not re-read this session) | SC-3 / WIZERR-06 | Forward-arm widening still closes whatever the current codes are — the fix is code-agnostic |

## Open Questions

1. **Roster form for the 4th ROUTES row.** validate-and-encrypt has four client consumers and
   no `KNOWN_*` roster. New shared roster constant vs. a roster-less union-membership row —
   planner must decide and state why (a roster-less row weakens the "client can render it"
   half of the law).
2. **WIZERR-03's answer shape.** New `WizardErrorCode` (+2 pins +rosters) vs. resolver third
   answer reusing an existing honest body. The create-with-key comment argued "a state the
   user cannot act on differently" — but WIZERR-03 asserts there IS an honest remedy
   (reconnect/disconnect the orphan key), which undercuts that argument. Planner should mint.
3. **WIZERR-02 remedy semantics.** Pure step transition (onReviewKeys precedent) leaves the
   rejected key attached — the next create-with-key with a DIFFERENT key then coexists with
   the old draft. Needs the LOW-2 re-answer and a decision on what happens to the old draft
   (keep-and-resume vs. confirm-delete).
4. **SC-4 split watch.** CONTEXT's own ⚠️: if SC-4 shows little in common with SC-1..3 at
   execution, flag for a split rather than pushing through.

## Environment Availability

Code/config/test-only phase — no external services, no new tooling. SKIPPED (no external
dependencies identified). Standing local notes: pytest from `analytics-service/` only;
`pandera==0.32.1` needed locally for csv_validator imports; Node 22 in CI vs 25 local.

## Sources

### Primary (HIGH confidence — read this session at HEAD bf00ad0c)
- `src/lib/wizardErrors.ts` (union :58-141, copy :871+, context :2651-2761, gate mapper
  :2966-2996, seam table :3751-3791), `src/lib/wizardErrors.test.ts` (:1888, :2275, :3535),
  `src/lib/wizardErrors.invariant.test.ts` (:155-280), `src/lib/strategyGate.ts` (full),
  `src/lib/strategyGate.test.ts` (:185-279), `src/lib/analytics-client.ts` (:80-170,
  :480-590)
- Routes: `create-with-key` (:140-320, :900-1024, :1144-1199), `composite/add-key` (grep +
  :667-708), `draft/[id]` (:185-239), `keys/[id]/permissions` (:255-363, :460-590),
  `keys/validate-and-encrypt` (:700-753 + code grep), `verify-strategy` (:89-144),
  `csv-finalize` (:1249-1410), `admin/match/recompute` (:196-253), `bridge` (:180-224),
  `simulator` (grep), `admin/match/eval` (grep)
- Components: `WizardClient.tsx` (:955-1074, :1215-1260), `SyncPreviewStep.tsx` (:1240-1330,
  :1600-1710), `AllocateDialog.tsx` (:110-244), `KeyPermissionBadge.tsx` (:1-60, :114-141)
- Python: `mt5_probe.py` (:55-206, :235-260), `mt5_validation.py` (:79-96, :150-275),
  `mt5_client.py` (:1008-1041), `ingestion/mt5.py` (:300-360), `routers/exchange.py`
  (:615-880), `job_worker.py` (grep :645,:668), `error_contract.py` (:64-220),
  `process_key.py` (:360-419), `routers/csv.py` (:40-113), `csv_validator.py` (:750-800),
  `tests/test_mt5_validate_parity.py` (:380-420)
- Ledgers: `.planning/REQUIREMENTS.md` (full), `161-CONTEXT.md` (full), `STATE.md` (:1-140),
  `TODOS.md` (targeted), `.planning/config.json`, `.planning/codebase/TESTING.md` (head)

### Secondary (MEDIUM confidence)
- `git show 2e67c4a0^:TODOS.md` — the pre-scope-commit snapshot; all 13 source items recovered
  at their cited lines (L75, L410, L436, L486, L1518, L1779, L1788, L1871-1935, L1948, L2466,
  L2581, L3091). Claims from it that were re-verified against HEAD are tagged [VERIFIED]
  above; the rest are [CITED: recovered snapshot].

### Tertiary (LOW confidence)
- None. No web research performed — the domain is entirely in-repo; no external library
  questions arose.

## Metadata

**Confidence breakdown:**
- Site inventories (SC-1..SC-4): HIGH — measured by grep + file reads at HEAD; counts
  confirmed or corrected with the correction stated.
- Regrowth mechanism / coverage laws: HIGH — laws and blindness read from source + booked
  TODOS entry.
- Remedy designs (WIZERR-02/03 shapes, roster form): MEDIUM — options grounded, decisions
  deliberately left to the planner (flagged in Open Questions).
- Founder-measured MT5 gateway state: MEDIUM — recorded measurement, not re-runnable here.

**Research date:** 2026-08-24
**Valid until:** the next merge touching `src/lib/wizardErrors*`, the five key/CSV routes, or
`analytics-service/services/mt5_*` — line numbers in this file rot with edits (this repo's
citation-rot entry is TODOS.md:1844); re-measure counts at plan execution, per the standing
"Ledger blockers are dated CLAIMS" rule.
