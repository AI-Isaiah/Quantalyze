# Phase 153: WIZFORM — Form errors belong on the form (+ MT5 declarable) - Context

**Gathered:** 2026-08-08
**Status:** Ready for planning

<domain>
## Phase Boundary

The wizard stops costing submits. A field the user can get wrong is refused **at that
field, before submit**; a server verdict that was classified is never downgraded to
`UNKNOWN`; a transient seam failure is absorbed instead of becoming a user decision;
no venue-shaped copy advises an action the venue makes impossible; and an MT5
strategy can declare MT5 as its venue, preselected from the key already connected.

Six requirements: WIZFORM-01, WIZFORM-02, WIZFORM-03, WIZFORM-04, WIZFORM-05, MT5-14.

**Not in this phase:** wizard continuity / draft resume / stale screens (Phase 154),
live MT5 numeric verification (Phase 155).

</domain>

<decisions>
## Implementation Decisions

### Timeouts and budgets (WIZFORM-05) — founder-locked, do not re-derive

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

### Submit-path re-validation (WIZFORM-04) — founder-locked

- **D-06: The mandated question "is the per-submit re-validation needed at all?" is
  ANSWERED: no.** The founder's staleness tolerance settles it — a recent successful
  validation plus a live synced series is sufficient evidence. **Target shape: zero live
  MT5 calls on submit.** Drop the live re-check, or cache it behind a minutes-scale TTL.
- **D-07: Do NOT open with a retry loop.** The requirement is explicit that a naive retry
  multiplies the budget this route is capped on and feeds `breaker:railway`; retrying
  into an open breaker is how one slow venue takes down every other user's submits.
  Retry is only discussable AFTER D-06 removes the call.

### Honest codes (WIZFORM-02) — ⚠️ SCOPE CORRECTED BY SOURCE OBSERVATION

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
  drifted.** The requirement cites `:338-346`, `:345`, `:298/:324/:333/:355/:381/:392/:427`;
  phases 150–152 shifted the file. The requirement itself says the 2026-07-08 stored
  learning is STALE and must be re-derived — that instruction now also applies to its own
  line numbers.

### Inline field validation (WIZFORM-01)

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

### MT5 declarable (MT5-14)

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

### Venue-shaped copy (WIZFORM-03)

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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap
- `.planning/REQUIREMENTS.md` :647-676 — WIZFORM-01, WIZFORM-02 (incl. the second live
  instance and the STALE-learning warning)
- `.planning/REQUIREMENTS.md` :678-713 — WIZFORM-04, WIZFORM-05
- `.planning/REQUIREMENTS.md` :714-719 — WIZFORM-03
- `.planning/REQUIREMENTS.md` :454-470 — MT5-14 (severity corrected to HARD BLOCKER)
- `.planning/ROADMAP.md` §Phase 153 :285-305 — success criteria + the three binding traps

### The budget contract (WIZFORM-04 / WIZFORM-05)
- `src/lib/resilient-fetch.ts` :537-545 — `SEAM_ROUTE_BUDGETS["validate-key"]`, 30s
- `src/lib/seam-budgets.invariant.test.ts` — recomputes per-request sums with
  `encrypt-key`; the gate any budget change must pass
- `analytics-service/routers/exchange.py` :62, :328, :380, :456 — `_MT5_PROBE_TIMEOUT_S`
  and its three independent applications
- `analytics-service/services/mt5_client.py` :80-85 — `MT5_REQUEST_TIMEOUT_S` (30s) and
  why the inner IPC timeout must stay strictly below it
- `analytics-service/services/mt5_concurrency.py` — the single-terminal lock whose queue
  wait must sit inside the client budget

### Honest codes (WIZFORM-02)
- `src/app/api/strategies/finalize-wizard/route.ts` — the nine code-less 400 arms
- `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` :265-315 —
  `KNOWN_CREATE_WITH_KEY_CODES` (stopgap already applied)
- `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx` :214+ —
  `KNOWN_ADD_KEY_CODES`
- `src/lib/wizardErrors.ts` — the `WizardErrorCode` union and copy table (`EXPECTED_TABLE_SIZE`
  guards its size; Phase 151 moved it 63→64)

### MT5-14
- `src/app/api/strategies/finalize-wizard/route.ts` :220 — the
  `permissions?force_refresh=true` probe; :617, :628 — the `KEY_NETWORK_TIMEOUT` mapping
- `src/lib/closed-sets.ts` :105-125 — `MT5_UI_ENABLED` and the no-widening reasoning
- `src/lib/closed-sets.mt5-flag.test.ts` — the pin that must be re-cut deliberately

### Design
- `DESIGN.md` — read before any visual decision (inline error presentation, in-progress copy)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/wizardErrors.ts`: the established home for wizard error codes + user copy,
  with a size guard. Phase 151 added `ALLOCATION_NOT_ALLOCATABLE` here — the same
  additive pattern applies to any code this phase mints.
- `classifyKeyValidationError` (shared): already the single classifier the rosters
  claim to enumerate — the natural source of truth for a DERIVED roster (D-09a).
- `SEAM_ROUTE_BUDGETS` + `seam-budgets.invariant.test.ts`: a working budget contract
  with a live recomputing test; extend it, do not bypass it.

### Established Patterns
- **Census / no-drift pins** (`closed-sets.*.test.ts`, `EXPECTED_TABLE_SIZE`): this
  codebase pins closed sets and makes widening a deliberate, visible act. MT5-14
  requires re-cutting one such pin rather than routing around it.
- **Additive persisted-schema discipline**: optional/nullish zod, never a version bump
  for an added field — a zod reject resets and DELETES the user's saved draft.
- **Honest-code discipline** (Phase 142.2): rejection sites carry codes; the client maps
  known codes to copy and falls back to `UNKNOWN`. The failure mode this phase closes is
  a code-less server arm or an unlisted client code silently becoming `UNKNOWN`.

### Integration Points
- `finalize-wizard/route.ts` is the hot file for three of the six requirements
  (WIZFORM-01's server bound, WIZFORM-02's code-less arms, MT5-14's probe + mapping) —
  expect plan contention here and sequence it deliberately.
- The MT5 arm crosses the TS↔Python seam twice (validate-key, permissions probe), so
  WIZFORM-05 and MT5-14 both touch `routers/exchange.py`.

</code_context>

<specifics>
## Specific Ideas

- Founder 2026-08-07 on MT5 validate latency: *"why not give it more than 40 seconds? I
  don't need absolute exact time data. if it is 2 minutes old, that is fine."*
- Founder on the submit retry (WIZFORM-04, verbatim): *"clicking twice is not
  acceptable, especially with this mistake message. A user would just not know what to
  do."*
- Founder 2026-08-08, on the 35s trap: challenged a 35s budget as obviously insufficient
  "when we always timed out" — the correct reading, and the reason D-01 fixes ~90–120s
  and D-02 records what the `+5` actually is.

</specifics>

<deferred>
## Deferred Ideas

- Wizard draft-aware entry chooser, stale-screen root cause, token-less credential dedup
  — **Phase 154** (WIZCONT/STALE).
- Live MT5 numeric verification against an external oracle on a trading day — **Phase 155**
  (MT5-VERIFY), human- and calendar-gated.
- ⚠️ **Open founder decision carried from the v0.54.0.0 land, NOT this phase:**
  `size_at_decision_usd` is recorded on a NOTIONAL basis while the composer sizes on an
  EQUITY basis. Logged in `TODOS.md`; decide before the next mandate commit on a
  derivatives book.

</deferred>

---

*Phase: 153-wizform-form-errors-belong-on-the-form-mt5-declarable*
*Context gathered: 2026-08-08*
