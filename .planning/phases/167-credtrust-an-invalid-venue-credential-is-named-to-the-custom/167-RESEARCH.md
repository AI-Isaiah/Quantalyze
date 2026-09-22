# Phase 167: CREDTRUST — Research

**Researched:** 2026-09-22
**Domain:** cross-language error-surface honesty (Python job-worker classification → TypeScript
owner-facing copy), consuming an existing SQL freshness view, on a locked-decision phase (167-CONTEXT.md
carries D-01…D-15; this document researches TO those decisions and does not re-litigate them).
**Confidence:** HIGH on mechanism (everything below is `[VERIFIED: file:line + quote]` against
this checkout at HEAD `36216917`, branch `feat/167-credtrust`) / MEDIUM on remedy shape (D-11 is
still an open `checkpoint:decision` and this document costs it further but does not resolve it).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** The 161.1 ledger refresh is LIVE in production (activated by Phase 164.5.1 plan 09,
  not Phase 164.7 as the ROADMAP `Depends on:` line currently states — that is a ROADMAP
  correction to make at ship time, not during planning).
- **D-02:** A live cron schedule is not a live refresh. The product must never infer "your
  credential is broken" from staleness alone.
- **D-03:** The credential verdict is a CONJUNCTION: (a) the freshness substrate says the track
  record stopped advancing, AND (b) a credential-shaped failure is attached to the key that fed
  it. Conjunct (a) is consumed (`ledger_refresh_staleness`, `FreshnessChip`), never reinvented;
  conjunct (b) is what this phase mostly builds.
- **D-04:** The cause renders on OWNER surfaces only — NEVER in the public factsheet payload
  (`unstable_cache` keyed by strategy id alone, 3600s TTL — a viewer-dependent field leaks to
  every anonymous visitor for the TTL window). A plan touching `fetchAndBuildPayload`, the cached
  wrapper, or the share route earns `checkpoint:decision`.
- **D-05:** The defect lives in TypeScript (owner surface: `AllocatorSyncStatus`'s `error` arm
  renders raw `sync_error` verbatim; wizard surface: the Retry is rendered by TypeScript's
  `RECOVERABLE_ACTIONS`/`buildEnvelope`, not by the Python detail string). A-04 classification is
  NOT reverted.
- **D-06:** The wizard fix is the full cross-language treatment plan 02 (164.5.4) used for
  `KEY_UNDECRYPTABLE`. `seam-venue-vocabulary.invariant.test.ts` forces the
  `VENUE_WIRE_CODE_TO_VERDICT` row by reddening on an undispositioned code. Two
  `EXPECTED_TABLE_SIZE` pins (currently `94`) plus a self-referential regex assertion move.
- **D-07:** Mint a NEW `WizardErrorCode`. Do NOT reuse `KEY_MUST_BE_RECONNECTED` (right action
  shape, wrong cause — asserts a fault on OUR side, not the account) or route at `KEY_AUTH_FAILED`
  (asserts a confident "the exchange rejected these credentials" the classifier deliberately
  refuses to assert on this arm). Copy the shape, not the entry.
- **D-08:** Suppressing the wizard Retry on this arm is affirmatively correct — not taste. A
  Retry re-runs validate against a wedged MT5 terminal, which is the operation implicated in
  wedging/eviction.
- **D-09:** The defect is a COPY FAMILY, already venue-agnostic in its written form (at least 5
  end-user notes ending "— sync will retry automatically." plus a rate-limit note). A plan that
  fixes only the MT5 string is a scope error.
- **D-10:** The retry PROMISE must be a function of the retry DISPOSITION
  (`services.job_worker.classify_exception`, consulted not mirrored). This alone does NOT close
  the phase — the measured MT5 wrong-password case classifies TRANSIENT, so the note stays
  truthful-but-useless without the D-03 conjunction (repetition while the refresh was
  demonstrably running).
- **D-11 ⛔ OPEN — planner-owned `checkpoint:decision`:** does a credential failure get an
  EXISTING `api_keys.sync_status` value (arm A: `revoked` — cheapest, but a FILTER with two
  measured silent side effects), a NEW value (arm B: a CHECK-constraint migration, auto-applies to
  PROD on merge, touches every switch-on-value reader including a silent neutral-pill fallback), or
  a separate additive signal (arm C: reversible, costs a second source of truth)? This research
  adds a fourth measured fact to the costing (see `## D-11 Costing Addendum` below) but does not
  resolve it.
- **D-12:** `ledger_refresh_staleness` is `service_role` only + `security_invoker=true`. No
  `authenticated` role can select it. Any consumption path must be designed around that.
- **D-13:** Any migration goes through `migration-reviewer` + `rls-policy-auditor` +
  `silent-failure-hunter` BEFORE it is proposed for apply.
- **D-14:** In-product only — no email/push notification in this phase.
- **D-15:** No founder question was suppressed; D-11 is genuinely open.

### Claude's Discretion

- The exact wording of the new `WizardErrorCode` copy and the authored owner-surface helper line,
  within DESIGN.md's constraints.
- Whether the owner-surface cause renders as an extra helper line, a distinct pill state, or both —
  downstream of D-11.

### Deferred Ideas (OUT OF SCOPE)

- Proactive notification (email/in-app inbox) on credential-failure state — its own phase (D-14).
- Correcting the ROADMAP's `Depends on:` attribution (D-01) — a one-line edit made at ship time.
- A repo/CI-side liveness assertion that `system_flags.ledger_refresh_enabled` stays TRUE and
  jobid 40 stays active (D-02) — its own ops-observability phase.
- Re-reading/de-duplicating the second `_map_exception_to_sync_status` in
  `equity_reconstruction.py` (confirmed below to be a byte-for-byte duplicate) — not this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

No v1.20 `REQUIREMENTS.md` requirement IDs are attached to this phase — the ROADMAP's `### Phase
167` entry states `**Requirements**: TBD (no v1.20 requirement IDs)` and instead attaches four
numbered PROD-measured findings directly in the ROADMAP body (an invalid credential reported as
`MT5 terminal unreachable — sync will retry automatically.`; a 17-day silent stall on an MT5 key
(`<key A>`, real identifier withheld per this document's own no-identifier rule); the `bybit`
`retCode 33004` case failing since 2026-08-14; the existing freshness
substrate to consume). `167-CONTEXT.md`'s D-01…D-15 are the operative acceptance criteria for
planning purposes — there is no separate requirement-ID table to map against.
</phase_requirements>

## Summary

This phase adds a CAUSE to a staleness signal that already renders correctly. The two surfaces
named in scope — the owner-facing key/sync pill (`AllocatorSyncStatus`) and the wizard validate
error path — both already have the right SHAPE for a non-retryable, honest disclosure
(`AllocatorSyncStatus`'s `revoked` arm; `KEY_MUST_BE_RECONNECTED`'s action set). What is missing is
routing the actual failure into that shape, and — this research's central finding — **the failure
that stalls a strategy's FACTSHEET and the failure that shows up on the owner's account-wide
Exchanges pill are, today, two structurally separate signals fed by two separate job pipelines**,
and only one of the two writes anywhere a customer can see it.

**Primary recommendation:** treat this as two independent, already-well-shaped fixes — (1) close
the wizard's transient-arm misrouting via the exact cross-language mechanism 164.5.4 plan 02 used
(mint a `WizardErrorCode`, add one `VENUE_WIRE_CODE_TO_VERDICT` row, extend both `ReadonlySet`
rosters, move the two `EXPECTED_TABLE_SIZE` pins, run every gate rather than counting members) —
and (2) resolve D-11 first, because it gates whether the STRATEGY-level (not holdings-level)
credential failure has anywhere to write at all before any owner-surface copy work can begin.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Retry-disposition classification (transient/permanent/unknown) | API / Backend (`analytics-service/services/job_worker.py::classify_exception`) | — | Already the sole authority; consulted, never mirrored (D-10). |
| Venue-exception → `sync_status` mapping | API / Backend (`allocator_positions.py::_map_exception_to_sync_status`) | — | Scoped to the allocator-HOLDINGS pipeline only (see Q1 finding below) — does NOT cover the strategy-level pipeline that feeds the factsheet. |
| Owner-facing sync pill rendering | Frontend Server / Client (`AllocatorSyncStatus.tsx`, `AllocatorExchangeManager.tsx`) | — | Client component; reads `api_keys.sync_status`/`sync_error` passed from a server-fetched prop. |
| Wizard validate error rendering | Frontend Client (`ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx`, `ErrorEnvelope.tsx`) | API / Backend (`routers/exchange.py::validate_key`, wire code emission) | The wire code originates server-side; the Retry/no-Retry decision is derived entirely in TypeScript (`RECOVERABLE_ACTIONS`). |
| Staleness verdict (conjunct a) | Database / Storage (`public.ledger_refresh_staleness`) | — | Server-side, `service_role`-only, `security_invoker`. Consumed, not rebuilt (D-12). |
| Credential-failure signal (conjunct b) — for STRATEGY-level (non-holdings) syncs | **Nothing today** | — | This research's central finding: no tier currently owns this signal for the factsheet-feeding pipeline. See "The Two-Pipeline Finding" below. |
| New credential-failure persistence (D-11) | Database / Storage (if arm B/C) or reuse of existing column (arm A) | API / Backend (the write site) | Whichever arm is chosen, the WRITE happens in `analytics-service`; the READ happens in Next.js. |

## Standard Stack

No new external libraries are required by this phase. It is entirely: (a) TypeScript copy/routing
changes in an existing cross-language error-vocabulary system, (b) a possible SQL migration for
D-11 arm B, (c) possible Python changes to where a strategy-level sync failure writes its status.
All frameworks (Next.js, Supabase/PostgREST, ccxt, FastAPI) are already pinned in the repo; no
version verification is needed for this phase.

## Package Legitimacy Audit

**Not applicable.** This phase installs no new external packages (npm or pip). No package
legitimacy check was run because there is nothing to check — every symbol referenced in this
document (`ccxt`, `fastapi`, `next`) is an existing, already-vetted repo dependency.

## Architecture Patterns

### System Architecture Diagram (as it exists today, showing the gap)

```
                         ┌─────────────────────────────────────────┐
                         │   Allocator HOLDINGS poll pipeline       │
                         │   (compute_jobs.kind =                   │
                         │    poll_allocator_positions)              │
                         │                                           │
  venue API ───(fetch)──▶│  fetch_allocator_holdings()               │
                         │    │                                      │
                         │    ├─ ccxt.AuthenticationError ───┐        │
                         │    │  (bybit retCode 33004)       │        │
                         │    ▼                              ▼        │
                         │  _must_reach_handler_unwrapped()  classify │
                         │    (consults classify_exception   _exception│
                         │     → "permanent" → re-raise      = permanent│
                         │     UNWRAPPED)                              │
                         │    │                                        │
                         │    ▼                                        │
                         │  run_poll_allocator_positions_job()          │
                         │  outer `except Exception`:                   │
                         │    status_target =                           │
                         │      _map_exception_to_sync_status(exc)       │
                         │      → "revoked"                              │
                         │    human_copy = sync_error_copy("revoked",…)  │
                         │    UPDATE api_keys SET                        │
                         │      sync_status='revoked',                   │
                         │      sync_error=<curated venue-agnostic copy> │
                         └───────────────┬───────────────────────────────┘
                                         │  (writes api_keys.sync_status/sync_error)
                                         ▼
                         AllocatorSyncStatus (owner's /profile Exchanges tab,
                         AllocatorExchangeManager) — CORRECTLY renders "Key
                         revoked" + authored REVOKED_HELPER when this path fires.
                         Also: HoldingsTable / OpenPositionsTable revoked-chip +
                         filter.


                         ┌─────────────────────────────────────────┐
                         │   STRATEGY trade-sync pipeline           │
                         │   (compute_jobs.kind = sync_trades,      │
                         │    feeds strategy_analytics directly     │
                         │    for non-ledger venues, e.g. bybit)    │
                         │                                           │
  venue API ───(fetch)──▶│  run_sync_trades_job()                    │
                         │    fetch_all_trades() / fetch_usdt_balance()│
                         │    raises ccxt.AuthenticationError          │
                         │    (SAME bybit key, SAME retCode 33004)     │
                         │    │                                        │
                         │    ▼                                        │
                         │  propagates to the generic compute-job       │
                         │  dispatcher → classify_exception() =         │
                         │  "permanent" → compute_jobs.error_kind /      │
                         │  last_error (OPS-ONLY, admin surface)          │
                         │                                                │
                         │  ⛔ api_keys.sync_status / sync_error are       │
                         │     NEVER TOUCHED by this pipeline — grep       │
                         │     across job_worker.py finds sync_status       │
                         │     writes ONLY inside                            │
                         │     run_poll_allocator_positions_job (8139-8423).  │
                         └───────────────┬────────────────────────────────────┘
                                         │  (writes nothing customer-visible)
                                         ▼
                         strategy_analytics never advances → factsheet's
                         FreshnessChip reads `stale`/`old` — NO CAUSE, because
                         the one column the owner-facing pill reads was never
                         written by this pipeline.

                         (MT5 ledger-refresh chain — derive_broker_dailies /
                         the 161.1 fan-out — is a THIRD pipeline, routing
                         AROUND run_sync_trades_job entirely for
                         _LEDGER_BACKED_SOURCES; same "writes nothing to
                         api_keys" property applies to its failures.)
```

### The Two-Pipeline Finding (answers the CONTEXT.md Q1 contradiction)

`[VERIFIED: analytics-service/.venv/lib/python3.12/site-packages/ccxt/bybit.py:1123]` —
`'33004': AuthenticationError,  # apikey already expired` — bybit's `retCode 33004` IS mapped by
ccxt itself to `ccxt.AuthenticationError`, confirmed by reading the installed ccxt 4.5.64 source
directly (not assumed from a wire-format guess).

`[VERIFIED: analytics-service/services/allocator_positions.py:353-366]` —
```python
def _map_exception_to_sync_status(exc: Exception) -> str:
    if isinstance(exc, (ccxt.AuthenticationError, ccxt.PermissionDenied)):
        return "revoked"
    if isinstance(exc, ccxt.RateLimitExceeded):
        return "rate_limited"
    return "error"
```

`[VERIFIED: analytics-service/services/job_worker.py:822-828]` —
```python
if isinstance(
    exc,
    (ccxt.AuthenticationError, ccxt.PermissionDenied, ccxt.BadRequest),
):
    return ("permanent", str(exc)[:500])
```

So an `AuthenticationError` IS already correctly classified as `revoked` with correctly-curated
copy (`sync_error_copy("revoked", venue)` → `"{venue} rejected these API credentials — reconnect
the key to resume syncing."`, `[VERIFIED: analytics-service/services/allocator_positions.py:398-402]`)
— **but only inside `run_poll_allocator_positions_job`** (the allocator HOLDINGS/Balances poll,
`compute_jobs.kind='poll_allocator_positions'`).

`[VERIFIED: analytics-service/services/job_worker.py — grep of the whole file for the literal
"sync_status"]` returns exactly 6 lines, and every one of them is inside
`run_poll_allocator_positions_job` (lines 8201, 8239, 8278, 8333, 8361 — the function itself spans
8139-8423). `run_sync_trades_job` (line 1404-onward — the STRATEGY-level trade/daily-PnL sync that
feeds `strategy_analytics` directly for non-ledger ccxt venues such as bybit) contains **zero**
writes to `api_keys.sync_status` or `api_keys.sync_error` anywhere in its body.

**This resolves the ROADMAP's apparent contradiction.** The bybit key can be simultaneously:
correctly shown as `revoked` on the owner's `/profile` Exchanges tab (IF the allocator-holdings
poll for that same key also independently fails, which it does whenever the credential is truly
dead) — while the STRATEGY whose factsheet is going stale is fed by `run_sync_trades_job`, a
different job kind, whose identical `AuthenticationError` failure is correctly classified
`"permanent"` by `classify_exception` but writes only to `compute_jobs` (an ops-only surface the
customer never sees). The customer looking at their stale FACTSHEET has no path from that page (or
from any page reachable from it) to a cause, even though the cause is being computed correctly one
job-kind over. `[VERIFIED: analytics-service/services/ingestion/long_fetch.py:63]` —
`_LEDGER_BACKED_SOURCES: frozenset[str] = frozenset({"deribit", "sfox", "mt5"})` — confirms bybit
is NOT ledger-backed, so its factsheet freshness is fed by `run_sync_trades_job` and not by the
161.1 ledger fan-out; the MT5 case (which IS ledger-backed) is fed by a third pipeline
(`derive_broker_dailies` via the fan-out) that likewise never touches `api_keys.sync_status`.

**Planning consequence:** D-11's costing is incomplete without this fact. Arms A/B/C all assume the
question is "which `sync_status` value does a credential failure get" — but for the STRATEGY-level
pipeline (which is what actually drives the factsheet, i.e. the symptom named in the phase title),
the prior question is "does this pipeline write to `api_keys` AT ALL." Today it does not, for
either the ccxt (`run_sync_trades_job`) or the ledger (`derive_broker_dailies`) strategy-feeding
paths. See `## D-11 Costing Addendum` below.

### Recommended Project Structure

No new directories. Touched files cluster in three existing locations:
- `analytics-service/services/job_worker.py`, `allocator_positions.py`, `equity_reconstruction.py`
  (Python retry-classification / sync-status-write boundary)
- `src/lib/wizardErrors.ts`, `src/lib/wizardErrors.test.ts`, `src/lib/envelope.ts`,
  `src/lib/seam-venue-vocabulary.invariant.test.ts`, `src/lib/dialog-envelope.invariant.test.ts`
  (TypeScript wire-code → WizardErrorCode contract)
- `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx`,
  `MultiKeyConnectStep.tsx` (wizard rosters)
- `src/components/exchanges/AllocatorSyncStatus.tsx`, `AllocatorExchangeManager.tsx` (owner pill)
- `supabase/migrations/` (only if D-11 arm B is chosen)

### Pattern 1: The cross-language wire-code mint (D-06's mechanism, worked example)

**What:** Adding a new `WizardErrorCode` that reaches the browser from a Python-emitted wire code,
with a forced (not diligence-dependent) routing row.
**When to use:** Exactly the shape D-06/D-07 call for — a new code with its own copy, its own
action set (no `RECOVERABLE_ACTIONS` member, per D-08), reachable only via an explicit
`VENUE_WIRE_CODE_TO_VERDICT` row.
**Worked precedent — `164.5.4` plan 02, minting `KEY_MUST_BE_RECONNECTED`**
(`[VERIFIED: .planning/phases/164.5.4-mt5recon-gap-the-mt5-backfill-path-and-the-login-error-class/164.5.4-02-SUMMARY.md]`,
full file read this session). The plan named 2 touch points; running the tests (not counting
members) surfaced **4 real census pins**:

1. `src/lib/wizardErrors.ts` — the union member + docblock, `WIZARD_ERROR_COPY` entry,
   `VENUE_WIRE_CODE_TO_VERDICT` row, removal of any `VENUE_WIRE_CODES_WITHOUT_VERDICT` exemption
   entry for the same wire code, and the rotate-secret dialog roster row.
2. `src/lib/wizardErrors.test.ts` — **both** `EXPECTED_TABLE_SIZE` pins moved together
   (93→94 in that plan; presently `94` per D-06), each with **its own re-run argument** (the two
   pins front *different* scans — a destructive-action scan and a banned-claims-honesty scan —
   and each needed its own reasoning re-derived, not copy-pasted).
3. `src/lib/dialog-envelope.invariant.test.ts` — a roster non-vacuity pin (`31`→`32`) — **found
   only by running the gate**, not named in the plan.
4. `ConnectKeyStep.tsx`'s `KNOWN_CREATE_WITH_KEY_CODES` AND `MultiKeyConnectStep.tsx`'s
   `KNOWN_ADD_KEY_CODES` — **both** reddened by name via the `[153.7 review W-153.7-1]` gate,
   because the shared classifier can now return a code neither roster previously admitted —
   **also not named in the plan.**

Auto-verifying gates that needed NO manual edit: `src/lib/seam-venue-vocabulary.invariant.test.ts`
("the derived population matches the hand-typed roster, member for member" — stays green because
minting a TS member adds no NEW Python emitter) and the disjointness check ("no code is BOTH
mapped and exempt").

**The transferable lesson for 167's planner:** do not enumerate every file the mint will touch in
the plan text and treat that as complete. Task the executor to run every one of
`wizardErrors.test.ts`, `dialog-envelope.invariant.test.ts`, `seam-venue-vocabulary.invariant.test.ts`,
`wizardErrors.invariant.test.ts` (the `[153.7 review W-153.7-1]` gate), and BOTH wizard-roster
files' own test suites, and read every failure — the census pins the plan doesn't name are the
ones this mechanism exists to catch.

**Example (verbatim source, cited by symbol per repo convention):**
```typescript
// src/lib/wizardErrors.ts:2449-2461 — the shape D-07 says to copy (NOT reuse)
KEY_MUST_BE_RECONNECTED: {
  title: "We can no longer read this stored key.",
  cause:
    "We hold your key encrypted, and our stored copy of this one can no longer be read back — so we cannot use it to reach the account. That is a fault on our side of the store rather than a sign that anything is wrong with the account or its password.",
  fix: [
    "Entering the password again here cannot clear this: every attempt reads the same stored copy.",
    "Connect this account again from your keys list, so we hold a copy we can read.",
    "If it will not connect, email security@quantalyze.com with the correlation id below before deleting anything — your synced history hangs off this key.",
  ],
  docsHref: "/security",
  // actions carries neither RECOVERABLE_ACTIONS member — the ABSENCE is the point (D-08's analog).
```
`actions: ["request_call", "expand_log"]` for this entry — neither is in `RECOVERABLE_ACTIONS`,
so `buildEnvelope` derives `recoverable: false` and no Retry renders.
`[VERIFIED: src/lib/envelope.ts:54-57]` —
```typescript
const RECOVERABLE_ACTIONS: ReadonlySet<WizardErrorAction> = new Set([
  "clear_and_retry",
  "try_another_key",
]);
```

The two codes D-07 forbids routing at, with their exact live copy:

`[VERIFIED: src/lib/wizardErrors.ts:1682-1698]` —
```typescript
KEY_AUTH_FAILED: {
  title: "The exchange rejected these credentials.",
  cause:
    "The exchange could not authenticate this key and secret. The exchange never accepted the pair, so the key or the secret is wrong, was regenerated, or was copied with extra whitespace.",
  ...
  actions: ["clear_and_retry", "request_call"],
}
```
`actions` includes `clear_and_retry` — a `RECOVERABLE_ACTIONS` member — so a Retry WOULD render;
this is exactly the "confident cause + Retry" shape D-07 forbids for this arm.

`[VERIFIED: src/lib/wizardErrors.ts:1993-2011]` —
```typescript
KEY_NETWORK_TIMEOUT: {
  title: "We could not reach the exchange.",
  cause:
    "The validation request did not complete in time. Usually means a temporary exchange issue or a network blip on our side.",
  ...
  actions: ["clear_and_retry", "request_call"],
}
```
`[VERIFIED: src/lib/wizardErrors.ts:4466]` — the current wire-code routing for this arm:
`["NETWORK_UNAVAILABLE", { code: "KEY_NETWORK_TIMEOUT", status: 502 }],` — this is the row that
currently absorbs the genuine-credential-rejection-classified-as-transient case (D-05's wizard
half) and is what the new D-07 code must be routed to INSTEAD of, for the credential-suspected
subset the D-03 conjunction identifies.

### Pattern 2: The wizard roster CORRECTION — read this before trusting 167-CONTEXT.md's `canonical_refs` pointer

`167-CONTEXT.md`'s `<canonical_refs>` section names "`ConnectKeyStep.tsx` and
`SyncPreviewStep.tsx`" as "the two wizard rosters." **This is measurably imprecise** and the
planner should use the corrected pointer below.

`[VERIFIED: TODOS.md:999-1018]` — `ROSTER-DERIVE-01` names the two hand-typed
`ReadonlySet<WizardErrorCode>` rosters explicitly:
> *"`KNOWN_CREATE_WITH_KEY_CODES` (`ConnectKeyStep.tsx`) and `KNOWN_ADD_KEY_CODES`
> (`MultiKeyConnectStep.tsx`) are hand-maintained allow-lists."*

`[VERIFIED: src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:289]` —
`const KNOWN_CREATE_WITH_KEY_CODES: ReadonlySet<WizardErrorCode> = new Set<WizardErrorCode>([...`

`[VERIFIED: src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx:287]` —
`const KNOWN_ADD_KEY_CODES: ReadonlySet<WizardErrorCode> = new Set<WizardErrorCode>([...`

`SyncPreviewStep.tsx`, by contrast, carries a **differently-shaped** structure —
`[VERIFIED: src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:153]` —
`const KNOWN_KICKOFF_CODES: Readonly<Record<string, WizardErrorCode>> = { ... }` — a
**wire-code-keyed Record**, not a `ReadonlySet<WizardErrorCode>` roster, governing the job-kickoff
(post-connect) failure surface rather than the connect-time validate surface. It is a THIRD,
separate membership rule with its own docblock reasoning (line ~799-841: a two-list precedence
between `KNOWN_KICKOFF_CODES` and the route's own `SEAM_CODE_TO_WIZARD_CODE` translation table).

**Planning consequence:** if the new D-07 code needs to be admitted at the wizard's *validate*
step (both single-key connect and multi-key add), the two rosters to extend are
`KNOWN_CREATE_WITH_KEY_CODES` and `KNOWN_ADD_KEY_CODES` — confirmed by the identical mechanism in
the 164.5.4 worked example above, where the exact same two files/rosters were the ones that
reddened. `SyncPreviewStep.tsx`'s `KNOWN_KICKOFF_CODES` is a DIFFERENT gate for a DIFFERENT
failure surface (post-connect job kickoff) and should only be touched if the new code can also be
emitted at kickoff time — which the D-07 mechanism (a `validate_key` transient-arm reclassification)
does not appear to require, but the plan should verify this against the actual emission site
before assuming either way.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Retry disposition (is this failure worth retrying) | A second classifier / hand-copied allow-list in `allocator_positions.py` or a new module | `services.job_worker.classify_exception` | D-10; a hand-copied mirror already caused a production incident (two permanent failures downgraded to transient under "sync will retry automatically" — a promise that could not be kept). |
| Staleness detection | A new "is this factsheet stale" query/column | `public.ledger_refresh_staleness` (`is_stale`, `stale_reason`) | D-03 conjunct (a); already correct, already handles the MT5 weekend/holiday 4-day threshold, already handles composites via both link shapes. |
| Wire-code → user-code routing enforcement | A checklist / PR comment reminding the author to add a disposition row | `src/lib/seam-venue-vocabulary.invariant.test.ts` (SET comparison, reds by name on an undispositioned code) | Already mechanized; D-06 says lean on it. |
| Non-recoverability | A `recoverable: false` flag asserted directly on the copy entry | Derive it structurally by omitting both `RECOVERABLE_ACTIONS` members from `actions` | The established pattern (`164.5.4-02` key-decisions: "Non-recoverability is DERIVED... never asserted off the actions array"). |

**Key insight:** every mechanism this phase needs already exists in the repo in a proven, tested
form for an almost-identical prior defect (164.5.4's `KEY_UNDECRYPTABLE`/`KEY_MUST_BE_RECONNECTED`
pair). The work is routing and copy, not new infrastructure.

## Common Pitfalls

### Pitfall 1: Treating the holdings-poll `revoked` success as evidence the phase is already closed

**What goes wrong:** A planner reads `_map_exception_to_sync_status` and `classify_exception`,
sees that `AuthenticationError` already maps to `revoked` with correct copy, and concludes the
bybit case in the ROADMAP is a stale finding.
**Why it happens:** The mapping IS correct — but only inside `run_poll_allocator_positions_job`,
a DIFFERENT job kind from the one that actually failed the factsheet (`run_sync_trades_job` for
ccxt venues, `derive_broker_dailies` for ledger venues). See "The Two-Pipeline Finding" above.
**How to avoid:** Any plan task that touches `_map_exception_to_sync_status` or
`sync_error_copy` must state explicitly which `compute_jobs.kind` it applies to, and the D-11
decision must be made with the STRATEGY-level pipelines in view, not just the holdings poll.
**Warning signs:** A plan that only touches `allocator_positions.py` and declares the bybit
ROADMAP finding closed, without touching `job_worker.py`'s `run_sync_trades_job` or the ledger
fan-out's failure path.

### Pitfall 2: Fixing the MT5 string alone (D-09's named scope error)

**What goes wrong:** Editing `MT5_UNREACHABLE_NOTE` and stopping.
**Why it happens:** MT5 is the ROADMAP's loudest example (17-day silence, founder-observed).
**How to avoid:** `[VERIFIED: analytics-service/services/allocator_positions.py:143-199]` — the
full retry-promising copy family, verbatim:
- `MT5_UNREACHABLE_NOTE = "MT5 terminal unreachable — sync will retry automatically."`
- `MT5_MISSING_ACCOUNT_REF_NOTE = "MT5 holdings sync couldn't identify this account — sync will retry automatically."`
- `SFOX_FETCH_FAILED_NOTE = "Couldn't fetch balances from sFOX — sync will retry automatically."`
- `DERIVATIVE_FETCH_FAILED_NOTE = "Couldn't read open positions from {venue} — spot balances synced and positions will retry automatically."`
- `SPOT_FETCH_FAILED_NOTE = "Couldn't read balances from {venue} — sync will retry automatically."` (venue-templated — covers binance/bybit/okx/deribit)
- `SYNC_ERROR_COPY_BY_STATUS["rate_limited"] = "{venue} is rate-limiting us — sync will retry automatically."` — this ONE is legitimate (rate limits ARE transient by construction) and should NOT be touched by a D-10 fix.
Each of the first five must become a function of `classify_exception`'s verdict (D-10), not have
its promise deleted unconditionally — a rate-limit note that stops promising a retry would itself
be a new dishonesty.

### Pitfall 3: Routing the new D-07 code by reusing an EXISTING copy string verbatim

**What goes wrong:** Copying `KEY_MUST_BE_RECONNECTED`'s cause text ("a fault on our side of the
store") into the new code because it's structurally close.
**Why it happens:** D-07 says "copy the shape, not the entry" — easy to over-read as "copy the
text."
**How to avoid:** The new code's cause must be honest about UNCERTAINTY (the terminal/exchange
could not be reached, and a dead credential is one of the reasons) — a materially different claim
from `KEY_MUST_BE_RECONNECTED`'s "we hold your key, our copy is unreadable" (a claim about OUR
storage, not the venue) and from `KEY_AUTH_FAILED`'s "the exchange rejected these credentials" (a
confident claim the classifier will not assert on a transient-classified arm).

### Pitfall 4: Assuming an owner-facing consumer for `ledger_refresh_staleness` already exists

**What goes wrong:** Planning a UI change that reads `is_stale`/`stale_reason` directly from an
`authenticated`-role client query.
**Why it happens:** The view's COMMENT text and column comments read like a ready-made
product signal.
**How to avoid:** `[VERIFIED: supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql]`
— `REVOKE ALL ON public.ledger_refresh_staleness FROM PUBLIC, anon, authenticated; GRANT SELECT ON
public.ledger_refresh_staleness TO service_role;` and the view is declared
`WITH (security_invoker = true)`. Confirmed by the migration's own self-verifying DO block, which
RAISEs if `has_table_privilege('authenticated', ...)` returns true. No `authenticated`-role read
path exists today. The closest in-repo SECDEF precedent is `public.get_published_trust_signals`
(`supabase/migrations/20260719140000_get_published_trust_signals.sql`) — `LANGUAGE sql SECURITY
DEFINER SET search_path = public, pg_temp STABLE`, `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO anon,
authenticated, service_role`, with its column allow-list enforced structurally by `RETURNS TABLE`.
**But that precedent is PUBLIC-gated** (published-strategies-only, no ownership check) — an
owner-scoped equivalent for `ledger_refresh_staleness` would need an additional `s.user_id =
auth.uid()` conjunct inside the function body, which has no exact precedent measured in this
session; D-12's two named traps (SECDEF-inside-an-RLS-policy needs `anon EXECUTE` or reads go
silently empty; delete-guards must exempt `sanitize_user`) apply to the anon/RLS case specifically
and may not both be relevant to a SECURITY DEFINER RPC called directly from an authenticated
Server Component/route rather than embedded in an RLS policy — the planner should verify which
call shape (RLS-embedded vs. directly-invoked RPC) is intended before assuming both traps apply.

## Code Examples

### The full sync-status write boundary (D-05's "the fix shape is already in the file")

`[VERIFIED: analytics-service/services/job_worker.py:8259-8280]`
```python
except Exception as exc:  # noqa: BLE001
    error_kind, msg = classify_exception(exc)
    sanitized = msg[:500]
    status_target = _map_exception_to_sync_status(exc)
    human_copy = sync_error_copy(status_target, venue)

    def _update_err() -> None:
        ctx.supabase.table("api_keys").update(
            {"sync_status": status_target, "sync_error": human_copy}
        ).eq("id", api_key_id).execute()
    ...
```
This is the ONLY write boundary in the repo where an exception becomes `api_keys.sync_status` +
curated `sync_error`. It is entirely inside `run_poll_allocator_positions_job`. Any D-11 remedy
that needs the STRATEGY-level pipelines to also surface a cause needs an analogous write boundary
added to `run_sync_trades_job` (and/or the ledger fan-out's failure path) — currently absent.

### The owner-pill render boundary (D-05's other half)

`[VERIFIED: src/components/exchanges/AllocatorSyncStatus.tsx:236-259]`
```typescript
let helperText = "";
if (helperOverride !== null && helperOverride !== undefined && helperOverride.length > 0) {
  helperText = helperOverride;
} else if (normalized === "revoked") {
  helperText = REVOKED_HELPER;               // authored, ignores syncError
} else if (normalized === "rate_limited") {
  helperText = `${exchangeDisplayName(exchange)} cooldown remaining`;
} else if (normalized === "error" || normalized === "complete_with_warnings") {
  helperText = syncError ?? "";               // <-- renders the raw DB string verbatim
} ...
```
`REVOKED_HELPER = "Re-add a read-only key from your exchange."` (`AllocatorSyncStatus.tsx:77`) is
the exact shape to imitate for any new pill state D-11 might introduce — an authored line that
ignores `syncError`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The MT5 `-10005` modal-login-dialog IPC-wedge mechanism (cited from `167-CONTEXT.md`/MEMORY.md, not independently re-derived from a live MT5 session this session — doing so would require touching a live terminal, forbidden by this phase's constraints) | D-08 rationale, Pitfall discussion | If the mechanism differs from the CONTEXT.md description, D-08's "Retry is affirmatively harmful, not just useless" argument may be weaker than stated — but D-08 is a LOCKED decision, so this affects justification wording only, not the decision itself. |
| A2 | The exact wording/shape the D-07 `WizardErrorCode` copy should take beyond the structural constraints (no `RECOVERABLE_ACTIONS` member, honest uncertainty) is Claude's Discretion per CONTEXT.md and is left unresolved here by design. | Pattern 1 | Low — explicitly deferred to the planner/executor by CONTEXT.md. |
| A3 | Whether `SyncPreviewStep.tsx`'s `KNOWN_KICKOFF_CODES` needs to admit the new D-07 code depends on whether the wire code in question (`NETWORK_UNAVAILABLE` or a new sibling) can ever be emitted at job-kickoff time rather than only at validate time — not independently traced to the exact emission call site this session. | Pattern 2 | Medium — if the new code CAN reach kickoff, omitting the `SyncPreviewStep.tsx` roster edit would leave an unrecognized-code gap on that surface; the planner should grep the wire code's emission sites in `routers/exchange.py` before finalizing scope. |
| A4 | No repo mechanism exists to track cross-run consecutive failures for a given `api_key` (searched `compute_jobs` schema for `attempt_count`/`consecutive_fail`/`retry_count`/`fail_count` column names and found none beyond the per-row `attempts`/`max_attempts` pair, which the compute-job queue resets to 0 on each new recurring-job row — confirmed by reading `20260411144407_compute_jobs_queue.sql` and `database.types.ts`'s `api_keys` column list). This is reported as an ABSENCE, not a confirmed design decision that none should exist. | D-03 conjunct (b) / D-10 insufficiency discussion | If a repetition-tracking mechanism DOES exist somewhere unsearched (e.g. inside a Sentry-side aggregation, or a column added very recently outside this session's greps), the planner would be re-building something that exists. Recommend a targeted `git log -p --all -S consecutive_fail` / schema re-grep as a first planning-time step if this matters to the chosen D-11 arm. |

## Open Questions

1. **Does D-11's chosen arm need to extend to the STRATEGY-level pipelines (`run_sync_trades_job`,
   the ledger fan-out), or only to the allocator-holdings pipeline that already works?**
   - What we know: the ROADMAP's own measured examples (the 17-day MT5 stall, the bybit
     `retCode 33004` case) are BOTH about a strategy's FACTSHEET going stale — i.e. the
     STRATEGY-level pipelines, not the holdings/balances dashboard.
   - What's unclear: whether the phase's in-scope surfaces (per `<domain>`: "the owner-facing
     key/sync surface and the wizard validate surface") are meant to be fed by a NEW write boundary
     in the strategy pipelines, or whether the existing `AllocatorSyncStatus` pill (fed only by the
     holdings pipeline) is considered "the owner-facing key/sync surface" the phase is scoped to,
     leaving the strategy-level gap for a later phase.
   - Recommendation: this is the single highest-leverage clarifying question for
     `/gsd-plan-phase` to resolve explicitly before task-breakdown — it changes which pipeline(s)
     get a new write boundary, which is the largest cost driver in the phase.

2. **Is there a per-strategy owner-facing surface closer to the factsheet than `/profile`'s
   Exchanges tab, that D-04's "surface where they notice the symptom" wording implies should carry
   the cause?**
   - What we know: today, `AllocatorSyncStatus`/`sync_status` render ONLY on `/profile`
     (`ExchangesTabContent` → `AllocatorExchangeManager`) and inside `ScenarioComposer`; the
     per-strategy edit page's `ApiKeyManager` (`/strategies/[id]/edit`) uses a DIFFERENT component
     (`SyncProgress`) that does not read `sync_status`/`sync_error` at all; the factsheet itself
     (owner OR public lane) renders no key-level detail.
   - What's unclear: whether the ROADMAP's "on the surface where they notice the symptom" language
     is satisfied by the existing `/profile` pill, or whether it implies adding something to the
     factsheet's OWNER lane (which D-04 explicitly permits, distinct from the cached public
     payload) or to `/strategies/[id]/edit`.
   - Recommendation: surface this to the planner as a scoping question; D-04's `checkpoint:decision`
     trigger ("a plan that touches `fetchAndBuildPayload`, the cached wrapper, or the share route")
     would fire if the owner-lane-of-the-factsheet option is chosen.

## Environment Availability

Not applicable — no external tool/service dependency beyond what the repo already has installed
and verified (ccxt, Supabase CLI linked to PROD per this checkout's standing constraint, Python
3.12 venv, Node/npm). No new environment probe was needed.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (TS) | Vitest (`vitest run`), `npm run test` / `npm run test:coverage` |
| Framework (Python) | pytest, run ONLY from `analytics-service/` via its `.venv/bin/python` |
| Config file | `vitest.config.ts` (repo root); `analytics-service/pytest.ini`/`pyproject.toml` |
| Quick run command (TS, scoped) | `npx vitest run src/lib/ src/app/api/keys/` (the exact scope 164.5.4-02 used and reported green) |
| Quick run command (Python, scoped) | `.venv/bin/python -m pytest tests/test_allocator_positions.py tests/test_job_worker.py -x` (run from `analytics-service/`) |
| Full suite command (TS) | `npm run test:coverage` |
| Full suite command (Python) | `.venv/bin/python -m pytest` (from `analytics-service/`) |

### Phase Requirements → Test Map

No formal `REQUIREMENTS.md` IDs exist for this phase (see `<phase_requirements>`); the map below
keys on the locked CONTEXT.md decision IDs instead.

| Decision | Behavior | Test Type | Automated Command | File Exists? |
|----------|----------|-----------|-------------------|-------------|
| D-06/D-07 | New `WizardErrorCode` is reachable from its wire code, not UNKNOWN | unit | `npx vitest run src/lib/wizardErrors.test.ts` | ✅ |
| D-06 | Both `EXPECTED_TABLE_SIZE` pins agree | unit | `npx vitest run src/lib/wizardErrors.test.ts -t EXPECTED_TABLE_SIZE` | ✅ |
| D-06 | No wire code is BOTH mapped and exempt | unit | `npx vitest run src/lib/seam-venue-vocabulary.invariant.test.ts` | ✅ |
| D-08 | New code's envelope is `recoverable: false` | unit | `npx vitest run src/lib/wizardErrors.test.ts -t recoverable` | ✅ |
| Pattern 2 (rosters) | Both wizard rosters admit the new code | unit | `npx vitest run src/lib/wizardErrors.invariant.test.ts -t "153.7 review W-153.7-1"` | ✅ |
| D-09/D-10 | Retry-promising copy is a function of `classify_exception`'s verdict | unit | `.venv/bin/python -m pytest tests/test_allocator_positions.py -k retry` (from `analytics-service/`) | ✅ (file exists; new cases needed — Wave 0 gap) |
| D-12 | `ledger_refresh_staleness` grants stay `service_role`-only after any new consumer is added | integration | the view's own migration self-verify DO block (re-run via `supabase db push --dry-run` equivalent, or a new `supabase/tests/*.sql` gate) | ⚠️ Wave 0 gap if D-11/D-12 work adds a new consumer function — needs its own SQL gate test |
| D-04 | Public factsheet payload never carries the new cause field | integration | `npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` (existing guard — verify it still covers any new field) | ✅ (existing; extend if new field added to the payload type) |

### Sampling Rate
- **Per task commit:** the scoped quick-run commands above, matching the file(s) touched.
- **Per wave merge:** full TS + Python suites, matching this repo's standing `npm run
  test:coverage` + `.venv/bin/python -m pytest` (from `analytics-service/`) convention.
- **Phase gate:** Full suite green before `/gsd-verify-work`, per repo convention (CLAUDE.md).

### Wave 0 Gaps
- [ ] A Python unit test proving `SYNC_ERROR_COPY_BY_STATUS`/the retry-promising notes become
      conditional on `classify_exception`'s verdict (D-10) — no such test exists today; the
      existing `test_allocator_positions.py` cases assert the CURRENT unconditional strings.
- [ ] If D-11 arm B or C is chosen: a new `supabase/tests/test_*.sql` gate proving the new
      column/value's access control (mirroring `ledger_refresh_staleness`'s own self-verify DO
      block pattern) — none exists yet because the column/value doesn't exist yet.
- [ ] If a new write boundary is added to `run_sync_trades_job` or the ledger fan-out: a Python
      test proving that boundary writes the SAME curated-copy contract `sync_error_copy` already
      enforces for the holdings pipeline (never a raw exception string) — no such test exists
      because no such write boundary exists yet.

*(None of the existing `wizardErrors.test.ts`/`seam-venue-vocabulary.invariant.test.ts`/
`dialog-envelope.invariant.test.ts` gates are gaps — they are the proven, reusable mechanism from
164.5.4 and will simply gain new cases/pins.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | This phase does not touch how credentials are validated, only how their failure is DISCLOSED. |
| V3 Session Management | No | Not touched. |
| V4 Access Control | **Yes** | D-12's grant posture (`service_role` only) must be preserved by any new consumer of `ledger_refresh_staleness`; any SECDEF wrapper must add an explicit ownership predicate (`auth.uid()`), per D-12's two named traps. |
| V5 Input Validation | No new user input surfaces are added by this phase. | — |
| V6 Cryptography | No | Not touched — this phase is about a DECRYPTABLE key's venue rejecting it, not about the decryption mechanism itself (that is 164.5.4's `KEY_MUST_BE_RECONNECTED` territory, explicitly NOT to be reused per D-07). |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A viewer-dependent field (the new credential cause) leaking into the id-keyed public factsheet cache | Information Disclosure | D-04's hard constraint — never write it into `fetchAndBuildPayload`'s cached return value; `checkpoint:decision` required if that boundary is touched. Existing guard: `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts`. |
| A SECDEF function (if D-11/D-12 work adds one) embedded inside an RLS policy without `anon EXECUTE`, silently returning zero rows | Information Disclosure (fails safe, but silently — a debugging/observability risk rather than a leak) | D-12's named trap — grant EXECUTE to the calling role explicitly; assert it in a self-verify DO block, mirroring `ledger_refresh_staleness`'s own migration. |
| A CHECK-constraint migration (D-11 arm B) that partially rolls out, leaving `AllocatorSyncStatus`'s `PILL_STYLES` unknown-value fallback (a NEUTRAL idle pill) rendering a broken key as healthy | Tampering / integrity of displayed state (not an attacker threat, but a fail-UNSAFE default) | D-11's own costing already names this; if arm B is chosen, the `PILL_STYLES` map and any new value must land in the SAME commit as the migration, never a follow-up. |
| A delete-guard on `api_keys` (rotate-secret / disconnect flows) not exempting `sanitize_user` if D-11 adds a new column touched by that flow | Denial of Service (a legitimate sanitize/delete op aborts) | D-12's second named trap — verify the exemption is present for any NEW column added to a delete-guarded table. |

## D-11 Costing Addendum

The three arms in `167-CONTEXT.md` are costed against the allocator-HOLDINGS pipeline (where
`sync_status`/`sync_error` already live and are already written). This research adds one fact not
in the original costing: **for the STRATEGY-level pipelines that actually drive the factsheet
(the symptom in the phase title), none of the three arms has anywhere to write today** — arm A
(`revoked`) and arm B (a new value) both still require a NEW write boundary to be added to
`run_sync_trades_job` and/or the ledger fan-out, exactly like the existing one in
`run_poll_allocator_positions_job` (`[VERIFIED: analytics-service/services/job_worker.py:8259-8280]`),
before either arm's `sync_status` value ever reaches `api_keys` for a strategy-only (no
allocator-holdings) credential failure. Arm C (a separate additive signal) has the identical
requirement. This does not change which arm is cheapest, but it means the "cheapest" framing in
the original costing (arm A is "cheapest by far") undercounts arm A's true cost if the strategy
pipelines are in scope (see Open Question 1) — the write-boundary work is common to all three arms
and is not zero for any of them.

## Sources

### Primary (HIGH confidence — read this session, verified against installed source/live files)
- `analytics-service/.venv/lib/python3.12/site-packages/ccxt/bybit.py:1123` — the `33004 →
  AuthenticationError` mapping, read from the ACTUAL installed ccxt 4.5.64, not assumed from wire
  format.
- `analytics-service/services/job_worker.py` — `classify_exception` (lines 683-833),
  `run_poll_allocator_positions_job` (8139-8423), `run_sync_trades_job` (1404-2080+), grepped for
  every `sync_status` write site.
- `analytics-service/services/allocator_positions.py` — the full copy family (119-417),
  `_map_exception_to_sync_status`, `sync_error_copy`, `_must_reach_handler_unwrapped`.
- `analytics-service/services/equity_reconstruction.py:453-458` — confirmed byte-identical
  duplicate `_map_exception_to_sync_status`.
- `src/components/exchanges/AllocatorSyncStatus.tsx` — full file read, the render boundary.
- `src/lib/wizardErrors.ts` — `KEY_AUTH_FAILED`, `KEY_NETWORK_TIMEOUT`, `KEY_MUST_BE_RECONNECTED`
  entries and the `NETWORK_UNAVAILABLE` routing row, read at their exact line ranges.
- `src/lib/envelope.ts:54-57` — `RECOVERABLE_ACTIONS`.
- `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx`,
  `MultiKeyConnectStep.tsx`, `SyncPreviewStep.tsx` — roster definitions, read directly.
- `supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql` — full file read, access
  control posture.
- `supabase/migrations/20260719140000_get_published_trust_signals.sql` — the closest SECDEF
  precedent, read directly.
- `supabase/migrations/20260420073003_allocator_holdings.sql:297-315` — the `sync_status` CHECK
  constraint's 8-value literal.
- `.planning/phases/164.5.4-mt5recon-gap-the-mt5-backfill-path-and-the-login-error-class/164.5.4-02-SUMMARY.md`
  — the full worked example for D-06.
- `TODOS.md:999-1018` — `ROSTER-DERIVE-01`, correcting the CONTEXT.md roster-file pointer.
- `.planning/ROADMAP.md` → `### Phase 167` — the four PROD-measured findings, read in full.
- `DESIGN.md` §Error Envelope, §Color, §9-State Matrix — read in full.

### Secondary (MEDIUM confidence)
- `167-CONTEXT.md`'s own D-01…D-15 and `<canonical_refs>` — locked decisions, treated as
  authoritative per this agent's role, EXCEPT the one measured correction noted in Pattern 2.

### Tertiary (LOW confidence / not independently re-verified this session)
- The MT5 `-10005` modal-login-dialog mechanism (A1 in Assumptions Log) — cited from CONTEXT.md/
  MEMORY.md lineage, not re-derived from a live terminal (forbidden by this phase's constraints).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; scope is entirely existing-repo mechanism reuse.
- Architecture (the two-pipeline finding): HIGH — verified by direct source read + exhaustive grep,
  not inferred.
- Pitfalls: HIGH — each pitfall is grounded in a `[VERIFIED]` file:line citation.
- D-11 remedy shape: MEDIUM — costed further, not resolved; genuinely a planner-owned
  `checkpoint:decision` per CONTEXT.md.

**Research date:** 2026-09-22
**Valid until:** ~14 days (fast-moving phase-adjacent codebase; re-verify file:line citations if
this document is consumed after further phases land, per this repo's own citation-drift class
`[164.7-CITATION-DRIFT-01]`).
