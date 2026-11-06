# Phase 161: WIZERR — Honest error surfaces - Context

**Gathered:** 2026-08-24
**Status:** Ready for planning
**Revised:** 2026-08-24 — four `<code_context>` claims CORRECTED after the pattern-mapper
measured them and I re-verified each independently. The errors were mine (a name-grep that matched
mentions, not definitions). Corrections are marked ⚠️ inline; the `<decisions>` section is unaffected.

**Mode:** Smart discuss (autonomous). Recommendations AUTO-ACCEPTED — founder was afk and
asked for autonomous execution. Every decision below is a default I chose, not one the
founder stated. All are cheap to reverse at plan time; none is a one-way door.

<domain>
## Phase Boundary

Every founder-hit wizard, key, and CSV error surface names the ACTUAL blocker in truthful
copy. No `code: UNKNOWN` for a code the server already classified, no sentence that is false
about the user's situation, and no "try again" remedy that cannot succeed.

This phase changes **what the user is told** and **the codes that carry it**. It does not
change what the underlying operations do, with one deliberate exception: where copy is false
because the DATA feeding it is wrong (`'nan'` leakage, untrusted cell echo, the 7-row floor
not being evaluated on the composite arm), the data path is fixed too — otherwise the copy
could only be made truthful by making it vaguer.

IN: the 13 WIZERR requirements as scoped by SC-1..SC-4.
OUT: new error-handling architecture, retry/backoff redesign, i18n.

</domain>

<decisions>
## Implementation Decisions

### Copy specificity — how much blocker detail reaches the user
- MT5 copy maps `terminal_info` flags to a human cause ("Algo trading is disabled in the
  terminal", "Trading is not allowed for this account") rather than echoing
  `tradeapi_disabled` / `trade_allowed`. Flag names are internal vocabulary; the founder-hit
  surface gets the cause, not the sensor reading. Fixed as a CLASS across all six carrier
  sites so the next carrier inherits it.
- The existing internal-vs-public copy contract stays. Public copy never leaks venue
  internals, key ids, or uids. This is a live constraint, not style: the repo is public and
  factsheets are shareable.
- A correlation id is surfaced only on terminal / non-actionable arms, matching the
  `STALE_CLIENT` precedent set in Phase 160. On an actionable error it is noise that competes
  with the remedy.
- Where retry cannot succeed, the remedy names the real action. `KEY_UNDECRYPTABLE` says
  "reconnect the key". "Try again" is reserved for arms where trying again can actually work.

### Code taxonomy and the `UNKNOWN` fallback
- New codes are minted as `WizardErrorCode` union members with their own copy entry, not
  aliased onto a near-neighbour. Phase 160 measured this trap directly: both reload-adjacent
  candidates for `STALE_CLIENT` were false at the emitter, and the alias table is scoped to
  wire codes from other services.
- `UNKNOWN` stays legitimate for genuinely unclassified 5xx. It is a lie only when the server
  already classified the failure and the client discarded that. That is the WIZFORM-02 class
  and it is what this phase closes.
- The five 5xx→`UNKNOWN` terminal arms (admin match/eval, simulator) forward a recognized
  `seamCode` when one is present, falling back to `UNKNOWN` only when recognition genuinely
  fails.
- `MT5_GATEWAY_UNREACHABLE`'s `Retry-After` is threaded end-to-end from the server value
  through both key-route catches. The client never invents a duration — an invented number is
  a false sentence in the same family this phase exists to kill.

### Coverage law and the anti-vacuity fence
- Coverage laws derive their population from source (enumerate emitters), never from a
  hand-maintained list. A hand list is the same unenforced-contract failure the Phase 160
  review caught in the `api_keys` insert.
- The curated-message test fence extends to the `keys/[id]/permissions` private `PROBE_*`
  cascade.
- ⭐ Every new law is neuter-verified: break the thing it guards, observe RED first-hand,
  restore byte-identical. A law that cannot fail is worse than none. Phase 160 shipped a
  guard that survived deletion of the step it guarded; that must not repeat.
- `wizardErrors.invariant.test.ts`'s blindness to `keys/validate-and-encrypt` is closed here
  (4th `ROUTES` row + hand-typed measured site count). Already booked in TODOS.md from the
  Phase 160 review; this is its phase.

### Scope and sequencing
- SC-4's "landed together or not at all" is honored as an atomic unit: the 7-row floor on the
  wizard composite arm and `INSUFFICIENT_CSV_HISTORY` rendering its own copy ship in ONE plan.
  Splitting them produces a floor that fires with no copy to explain it.
- Decomposition is one plan per success criterion (4 plans), tracer-first inside each: one
  surface fixed end-to-end and verified before the class expansion.
- `'nan'` leakage and untrusted-cell echo in the per-row CSV breakdown are treated as
  data-integrity, sanitized at render. Untrusted cell contents echoed into copy is an
  injection surface, not a wording problem.
- The 13 requirements stay in one phase — they are one class, and splitting invites the
  point-fix pattern the founder has ruled against. ⚠️ If execution shows SC-4 (CSV) has little
  in common with SC-1..SC-3, flag it for a split rather than pushing through.

### Claude's Discretion
- Exact copy wording, subject to: names the real blocker, names a remedy that can succeed, no
  internal identifiers in public copy.
- Which existing helper carries the flag→cause mapping.
- Plan ordering within each success criterion.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/wizardErrors.ts` — the copy table, 81 entries after Phase 160 added `STALE_CLIENT`.
  Mapped-type-backed, so a new member without copy fails `tsc`.
- `recogniseSeamErrorCode` + the `SEAM_CODE_TO_WIZARD_CODE` wire table — the recognition seam
  whose `UNKNOWN` fallback IS the WIZFORM-02 class.
- ⚠️ CORRECTED: `src/lib/routing/route-contract-manifest.ts` is **NOT** the curated-message
  fence — it is a page-routing class manifest. The real 4xx-curated / 5xx-static rule lives at
  `src/app/api/simulator/route.ts:202-214`. Plan against that.
- `.planning/codebase/` maps exist (ARCHITECTURE, CONVENTIONS, CONCERNS, INTEGRATIONS, STACK).

### Established Patterns
- Wizard steps consume `recogniseSeamErrorCode`: `ConnectKeyStep`, `MultiKeyConnectStep`,
  `SyncPreviewStep`, `CsvSubmitStep`, `CsvUploadStep`. ⚠️ CORRECTED: only **2**
  `.upstream-arm.test.tsx` siblings exist (both CSV steps), not one per step. The
  upstream-vs-user-fault test shape is established but NOT yet applied across the roster.
- Server routes mint `code: "UNKNOWN"` directly at ~10 sites incl. `bridge`, `wizard-draft`,
  `composite/set-members`, `composite/members`.
- Anti-vacuity neuter-and-restore is the house verification method.

### Integration Points
- ⚠️ CORRECTED (measured at the `export function` definition, 2026-08-24). My first pass
  recorded these from a grep that matched the first file MENTIONING each name rather than
  defining it — all three were wrong. Real locations:
  `AllocateDialog` → `src/app/(dashboard)/allocations/components/AllocateDialog.tsx:175`;
  `RenameStrategyDialog` → `src/components/strategy/RenameStrategyDialog.tsx:66`;
  `MarkOwnershipDialog` → `src/components/strategy/MarkOwnershipDialog.tsx:52`.
  ⭐ All three match on `body.error`, **not** on `code` — so "stop minting `code: UNKNOWN`"
  understates the work: they do not consume the code channel at all today.
- ⛔ **SC-1 has an unconfirmed premise.** `tradeapi_disabled` / `trade_allowed` have **ZERO**
  occurrences anywhere in `src/` — the sensor is Python
  (`analytics-service/services/mt5_validation.py`). The flags do not currently reach the TS copy
  layer, so "six carrier sites" cannot be taken at face value. Confirm the wire shape (what the
  gateway actually returns to Next) BEFORE planning SC-1, and correct the count by measurement.
- `keys/[id]/permissions` route — the private `PROBE_*` cascade needing a derived-population law.

</code_context>

<specifics>
## Specific Ideas

- WIZFORM-02 is a RECORDED OPEN CLASS, not a fresh discovery: Phase 153 span verification
  FAILED on 2026-08-13 with server-classified codes still rendering `code: UNKNOWN`. This
  phase is its closure, so the exit bar is "the class cannot regrow", not "these 13 sites now
  read better".
- The founder's stopping rule applies: block only on user-facing or data-integrity issues.
  Prose/citation/guard-hygiene findings go to TODOS.md, never blocking.
- Fix the WHOLE class across the surface, not point-fixes.

</specifics>

<deferred>
## Deferred Ideas

- i18n / localization of error copy — never raised, out of scope.
- Retry/backoff policy redesign. This phase threads the server's `Retry-After` honestly; it
  does not redesign who retries or when.
- The `secret-scan` workflow_dispatch full-history redness and the stale
  `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env (both booked in TODOS.md from the Phase 160 ship).

</deferred>
