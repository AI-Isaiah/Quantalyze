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

### Post-research decisions (locked 2026-08-08, after `153-RESEARCH.md`)

- **D-18 (SUPERSEDED by D-24 — kept for the record):** an earlier reading set the budget at
  `90_000` ms because that was the largest value needing only ONE constant changed under
  the A-25 breaker invariant. **That reasoning was backwards** — it let a test invariant
  pick a production timeout. Founder challenge 2026-08-08: *"I don't know if 90s is the
  right number… maybe you do some research how much is enough time."* Superseded.

- **D-24: ⭐ THE ROOT CAUSE IS NOT THE CLIENT BUDGET — it is an unguarded nested-timeout
  inversion inside Python.** Measured evidence (`scratchpad/mt5-latency-evidence.md`,
  9/9 correlated gateway↔worker failures on 2026-08-06/08) clusters at **30.1–31.0 s**,
  i.e. exactly the rpyc bound — not a broker-latency spread. Cause, verified at source:
  `mt5_client.py:306` calls `self._mt5.initialize()` **with no `timeout=`**, so MetaTrader5's
  vendor default of **60 000 ms** applies, *inside* an rpyc `sync_request_timeout` of
  **30 s** (`MT5_REQUEST_TIMEOUT_S`, `mt5_client.py:82`). The first MT5 call is therefore
  **structurally incapable** of returning a verdict before rpyc gives up. No client-side
  budget — 90 s, 120 s or 10 min — can fix this; it only moves where the pile-up happens.
  **Fix the inversion first.**
  ⚠️ This is the *same* defect class the codebase already knows about: the ordering guard
  at `mt5_client.py:213-219` fails loud on `MT5_LOGIN_TIMEOUT_MS >= request_timeout_s*1000`
  — it covers `login()`, the instance the author had in mind, and **not `initialize()`**,
  the second member. Extend the guard to cover every MT5 call carrying its own timeout.

- **D-25: the worker's `MT5_REQUEST_TIMEOUT_S = 30` must NOT be raised globally.** Its own
  comment (`mt5_client.py:79-81`) records why: a hung terminal must not wedge the
  SEQUENTIAL worker past the ~90 s healthz budget — that is the v1.11 WEDGE-01 wedge class.
  `Mt5Client` already accepts `request_timeout_s` as a constructor argument
  (`mt5_client.py:196`), so **the validate path gets its own longer chain** while the worker
  read path stays byte-unchanged at 30 s. Any plan that raises the module constant has
  reopened WEDGE-01.

- **D-26: the client budget is `120_000` ms, and `BREAKER_LOCK_TOMBSTONE_S` goes 60 → 90 in
  the SAME commit.** 120 s is the founder's stated tolerance (*"if it is 2 minutes old,
  that is fine"*), and the UI-SPEC's `Stop waiting` affordance makes a long wait
  user-abortable, so the cost of generosity is low. A-25 then holds exactly:
  `(30 + 90) × 1000 = 120 000 ≥ 120 000`. The tombstone raise is a one-line change and was
  never a reason to pick a smaller timeout.

- **D-27: this number is PROVISIONAL, and the phase must make it measurable.** No
  uncensored successful MT5 validation exists anywhere — not in Railway logs, not in
  Sentry, not in `docs/evidence/`. Elapsed time is **not instrumented** on the wizard's
  path (`mt5_client.py` and `routers/exchange.py:222-470` contain zero timing).
  ⛔ Do not cite "35–70 s" from `153-UI-SPEC.md:226` as evidence — that line is derived
  from the timeout constants and says so itself. This phase must add per-stage
  `stage` + `duration_ms` instrumentation so the real p50/p95 exists; the budget is then
  tightened from data during **Phase 155** (MT5-VERIFY), which is already live-gated.

- **D-28: `close()` must be bounded separately.** Every one of the 9 failures was followed
  by a *second* full 30.02–30.03 s in `Mt5Client.close: shutdown() raised` — so a failed
  attempt costs ~60 s of server wall clock, already 2× the client budget before any broker
  slowness. The `finally`-close (`exchange.py:448-465`) runs on every path and must keep
  doing so; it needs its own bound, NOT inclusion inside the end-to-end deadline (that
  would leak the RPyC session).
- **D-19: the A-25 pin must be re-cut to DERIVE from the longest budget.** Today
  `seam-constants.pin.test.ts:713-718` asserts `60_000 >= 60_000 - 30_000` with **both
  sides hand-typed literals**, so it stays green while its premise goes false. A pin that
  cannot observe the coupling it guards is decorative. Deriving it is in scope.
- **D-20: MT5-14 ships as Option B — a narrow wizard-declarable set plus a POSITIVE pin
  assertion.** The public marketing count (`(marketing)/page.tsx:115` renders
  `{EXCHANGES.length} exchanges supported`) does not move, and MT5 is not asserted to be
  an "exchange" in public copy. ⛔ `CRYPTO_EXCHANGES` must stay mt5-free — membership
  there drives √365 vs √252 annualization and would silently corrupt risk metrics.
  ⚠️ **CORRECTION 2026-08-09 (153.2 planning, verified at source): choosing Option B silently
  FALSIFIED the research's "the preselect already works".** That claim holds only under Option A.
  `canonicalizeExchange` (`src/lib/constants.ts:92`) loops `EXCHANGES` and returns its input
  unchanged on no match — and `closed-sets.ts:119` states outright that mt5 stays OUT of
  `EXCHANGES`. So `canonicalizeExchange("mt5")` returns lowercase `"mt5"` and can never match an
  `"MT5"` chip. Shipping Option B without noticing would have widened the chip set with a DEAD
  preselect — precisely the combination D-15 forbids, and it would have looked fine in review.
  **Fix: mint a separate `canonicalizeWizardExchange` in `closed-sets.ts` and leave
  `constants.ts`'s `canonicalizeExchange` BYTE-UNCHANGED** — widening the shared one changes what
  `supported_exchanges` persists for every caller, including two server routes
  (`finalize-wizard/route.ts:526` and `csv-finalize`).
- **D-21: `Validating...` (ASCII) wins; the UI-SPEC's `Validating…` is CORRECTED, not
  blended.** Rule 7 — there is a recorded superseding decision plus four live call sites.
  One spelling, chosen, everywhere.
- **D-22: sFOX keeps the submit-time scope probe byte-unchanged.** Only `mt5` opts out,
  via the capability. The probe is a security control: it must fail *toward* probing when
  the venue is unknown/null.
- **D-23: mint a `MIN_DESCRIPTION_CHARS` constant.** The `10` is a bare literal at
  `finalize-wizard/route.ts:389`; the field guard, the submit guard and the server arm
  must all read the same constant or they will drift apart again.

**Corrections to earlier decisions, verified at source by research — the substantive
claims survive, the numbers do not:**
- D-08 says "22 members"; the true count is **24** (a `[A-Z_]+` regex misses
  `KEY_MT5_MASTER_PASSWORD` / `KEY_MT5_WRONG_SERVER`). All three stopgap codes are
  present and the two rosters are identical, as D-08 claims.
- D-16 says the `closed-sets.mt5-flag` pin covers four sets; it asserts **two**
  (`UI_EXCHANGE_CODES`, `EXCHANGES`).

- **D-34: ⚠️ the emitter-order trap is SIX PRE-EXISTING sites, not one — and widening the
  status predicate makes them ALL invisible at once.** Found by the planner, verified at
  HEAD 2026-08-08. `wizardErrors.invariant.test.ts:100-101` requires `code:` as the FIRST
  key and matches `[A-Z][A-Z0-9_]*`. In `finalize-wizard/route.ts` the existing coded arms
  are written the WRONG way round at **`:573`** (`CIRCUIT_OPEN`), **`:617`**
  (`KEY_NETWORK_TIMEOUT`), **`:767`** and **`:1293`** (`GATE_DRAFT_GONE`), **`:1310`**
  (`GUARD_BLOCKED`) — all `{ error, code }` — and **`:1319`** (`draft_state_invalid`) is
  `code:`-first but **lowercase**, so it fails the literal class as well.
  ⛔ The danger is compound: today `EMITTER_RE` also gates on `status: 400`, so these six
  are simply out of scope. The moment the third `ROUTES` entry lands **and** the predicate
  widens past 400, all six become sites the scanner *should* see and silently does not —
  the coverage assertion goes blind on the **pre-existing** arms, not merely on the nine
  new ones. **Reordering these six is IN SCOPE**, and the site-count vacuity floor must be
  sized against the reordered total, not against the nine.
  ⚠️ **CORRECTION 2026-08-09 (153.1 planning, verified at source): it is FOURTEEN sites, not
  six.** The six above are the *single-line* `{ error, code }` occurrences. Eight more put
  `error:` on its own line inside a multi-line object literal and are therefore invisible to a
  single-line grep — spot-verified at `:605-608`, `:952-955`, `:1754-1758`; the full set is
  `:605-608 :625-628 :637-640 :952-955 :1007-1010 :1087-1093 :1754-1758 :1778-1782`. Same
  defect, different formatting. **Size the floor against fourteen.**
  ⚠️ **A THIRD blindness class, previously unrecorded:** `EMITTER_RE`'s `error:[^}]*\}` cannot
  cross a `${…}` template interpolation, so four bodies (`:428 :439 :503 :1091`) stay invisible
  even after the reorder AND the status widening. One of them is the arm whose own comment
  argues for the defect.
  ⚠️ **`deriveRoster` would be BORN BLIND on the third route.** Verified by execution
  2026-08-09: `SubmitStep.tsx:230-231` breaks the line between `(` and `[`, so
  `source.indexOf("([", start)` returns **`-1`** and the roster derives to `[]`. The two LIVE
  rosters (`KNOWN_CREATE_WITH_KEY_CODES`, `KNOWN_ADD_KEY_CODES`) DO resolve, so today's gate is
  **not** vacuous — but the moment `KNOWN_FINALIZE_CODES` joins `ROUTES` the new assertion would
  match nothing and pass. `deriveRoster` must be hardened BEFORE the third entry lands, and
  reformatting `SubmitStep.tsx` is NOT the fix (Prettier re-breaks the ~93-char line).

### Founder architecture call — 2026-08-08 (BINDING, sets WIZFORM-05's posture)

Presented with the one-concurrent-user ceiling and the read-only fail-open
(`153-EVIDENCE-mt5-platform.md`), the founder chose: **ship 153 as beta with a
one-account cap.** Keep the single terminal; do not buy a managed provider yet; do not
block 153 on running the 134 spike. WIZFORM-05 proceeds — but as an honest beta, not as
a claim of multi-tenancy.

- **D-29 (REVISED 2026-08-08 — founder: *"We need to update MT5 accounts per client only
  once [per day]. So potentially, one account can do a lot of them throughout the day.
  Without concurrency"*). The cap is on CONCURRENCY, not on ACCOUNTS.**
  The earlier reading ("one-account cap") was wrong. MT5 binds one account per terminal
  *at a time* — that is a **serialization** constraint, not a capacity one. A daily sync is
  sequential and latency-tolerant, so ONE terminal can cycle through many accounts across a
  day: capacity ≈ (usable daily window ÷ per-account cycle time), which is hundreds, not one.
  **There is therefore NO account cap. The number of MT5 clients is not architecturally
  limited.** What must never overlap is two *simultaneous* uses of the terminal.
  - ⭐ **The mechanism already exists and the validate path simply does not use it.**
    `_mt5_terminal_lock_for` / `_MT5_TERMINAL_LOCKS` (`services/mt5_concurrency.py:126-134`)
    is acquired by `job_worker.py:364`, `job_worker.py:3572` and
    `allocator_positions.py:656` — and **`routers/exchange.py` acquires it ZERO times**
    (verified). The wizard's validate path is the ONE caller that skips the lease. That is
    the whole bug. Fix = take the same lease.
  - **The lease needs a BOUNDED acquisition timeout**, separate from the operation timeout.
    Today `wait_for` sits *inside* the lock, so a queued caller's wait is unbounded and its
    own timer only starts once it holds the lock. An interactive validation must be able to
    give up waiting for the terminal without waiting for the terminal.
  - **Queueing is surfaced honestly, not hidden**: "waiting for the connection" is a
    different state from "validating", and the UI-SPEC's long-wait card + `Stop waiting`
    already provide the affordance. Copy names an action (WIZFORM-04) and leaks no
    infrastructure (WIZFORM-03).
  - ⚠️ Only the **interactive** path needs the bounded wait. The daily batch should queue
    patiently — it has all day.
- **D-30: `shutdown()` comes OUT of the request path.** `routers/exchange.py:449-466`
  calls `close()` in `finally:` on every validate; on a shared session that tears down the
  IPC pipe for any concurrent caller (`-10004`). Attach once, do not tear down per request.
  ⚠️ This REPLACES D-28's "bound `close()` separately" — with `shutdown()` off the request
  path there is no per-request close to bound. D-28 is superseded.
- **D-31: 🔒 close the read-only fail-open — `terminal_info()` guard.** `is_trade_capable`
  (`services/mt5_validation.py:133-149`) infers investor mode from two negative signals,
  but the terminal's **default-ON** *"Disable automatic trading through the external Python
  API"* makes both negative for a MASTER account too. Read `terminal_info()`
  (called NOWHERE today — verified) and **fail CLOSED**: if the terminal-level trade
  disable is on, we cannot distinguish investor from master, so REFUSE the key rather than
  stamp it read-only. Also stop asserting `_TRADE_RETCODE_DONE = 10009` alone — `10017
  TRADE_RETCODE_TRADE_DISABLED` is the documented investor signal and is never tested.
- **D-32: instrument before tuning.** Emit `stage` + `duration_ms` around each MT5 stage.
  D-26's 120 000 ms stands as the provisional client budget; the instrumentation is what
  makes the next number evidence rather than judgement (D-27).
- **D-33: pin the gateway to a SINGLE replica.** Ops, not code — but the one-session
  invariant is false the moment a second replica exists. Record it in the runbook; a
  scale-up is a correctness change, not a capacity change.

⚠️ **Explicitly NOT in this phase** (recorded so the planner does not drift into them):
buying a managed provider; a per-account container fleet; the two-level broker→server
picker (backlog — a curated `broker → servers[]` table, since MetaQuotes' directory is
binary/undocumented and parsing it risks ToS); moving the server name out of
`passphrase_encrypted` into a plain `mt5_server` column; running the Phase-134 spike.

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
