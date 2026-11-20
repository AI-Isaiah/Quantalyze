# Phase 218: SELFHEAL — the wizard's MT5 key check heals an owed terminal scrub itself - Context

**Gathered:** 2026-11-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Two things, both from the founder's session of 2026-11-19 (see the ROADMAP's Phase 218 entry, which is the binding spec):

1. **Server (analytics-service).** When the validation terminal owes a scrub (`mt5_scrub_owed` — the boot mark set after every analytics deploy — or `mt5_relaunch_debt`), the wizard's MT5 key check (`_validate_mt5_key_probe` in `analytics-service/routers/exchange.py`, the owed gate at the `report_scrub_owed_refusal` arm) pays the scrub INLINE under the lease it already holds, the way the worker does (`run_owed_validation_scrub_in_lease`, `services/ingestion/mt5.py`), and then runs the check in the SAME request. No probe ever runs on an unscrubbed terminal. If the inline scrub does not come to `scrubbed`, the answer names the real cause and never says the terminal is "briefly busy". This reverses Phase 164.6.6.1 D-08's accepted cost ("the first validation after each analytics deploy is refused") and its Decision 6 ("the wizard refuses rather than paying the scrub in-request").
2. **Wizard resume (Next.js).** (a) In a browser without the local draft pointer, the "We saved your progress" banner must not render over the draft's already-mounted step: the wizard holds the step until the founder chooses Resume or Start fresh (`WizardClient.tsx` step initializer vs `deriveWizardResumeOverrides` in `src/lib/wizard/localStorage.ts`). (b) The banner copy matches the key type (an MT5 key re-enters an investor password, not an API secret) and says nothing about re-entry when the resumed step needs none. Same-browser silent resume (matching pointer) stays (founder ruling 2026-11-19, "(a) the silent return is fine").

Out of scope: the held-lease `except Mt5TerminalBusyError` emitter of `MT5_TERMINAL_BUSY` (another check really is holding the terminal there; its copy stays), the worker path, the jobs terminal.

**Triggering observation (not on disk elsewhere):** 2026-11-19 13:14 UTC, wizard correlation `wizard:191eec7c-8d40-4fe5-8c13-d8449ca6d26b`, analytics log outcome `scrub_owed`, cause `owed_validation_refused`; the scheduled scrub finished 13:14:18 (about 6 s); the founder's manual Retry succeeded about 13:15. It was the first wizard validation after the Phase 217 deploy (boot mark).
</domain>

<decisions>
## Implementation Decisions

### Inline scrub inside the wizard request — time budget
- The inline scrub is paid INSIDE the existing server worst case (105 s) and D-26's 120 000 ms client ceiling, which do NOT move. The scrub gets its own wizard-side bound, and the probe's end-to-end deadline is what is left of the budget after the scrub (with a floor, so a probe never starts with too little time to be meaningful). The ordering test in `tests/test_mt5_validate.py` that asserts the budget arithmetic is extended to cover the scrub term. — **Reversibility:** costly — D-26's client ceiling is a cross-seam contract owned by Phase 153.4's seam-budget gate; raising it would touch the Next.js routes, the wizard client timeout and that gate together.
- Exact bound values are for research to derive from measurement (the observed boot-mark scrub took about 6 s; `_VALIDATION_SCRUB_BUDGET_S` is 160 s at the worker's rpyc ceiling, which the wizard cannot afford). Env-overridable, following the existing `MT5_VALIDATE_*` convention.
- Safety invariants that must survive the bound: never probe after a non-`scrubbed` kind; never release the lease while a scrub thread is still running on the terminal unless the existing machinery (owed mark / relaunch debt) already guarantees the next holder scrubs first. Research must show which holds for `abandoned` and `skipped_probe_in_flight`, as the worker's comment says "after `abandoned` the scrub thread may still be running under this lease".

### The answer when the inline scrub does not come to `scrubbed`
- A NEW wire code distinct from `MT5_TERMINAL_BUSY`, mapped to a new wizard error key with its own copy, so the wizard names the real cause (the terminal could not be reset/prepared for this check) instead of "briefly busy". `MT5_TERMINAL_BUSY` and `KEY_MT5_TERMINAL_BUSY` stay for the held-lease emitter only; their comments and copy rationale (which today must be true at the owed gate too) are narrowed to that one emitter. — **Reversibility:** costly — a wire code is a contract between analytics-service, both wizard connect routes, `VENUE_WIRE_CODE_TO_VERDICT`, `seam-venue-vocabulary.invariant.test.ts` and the contracts registry.
- `recoverable` is set per scrub kind by what Retry can actually fix: transient kinds (`abandoned`, `skipped_probe_in_flight`, `failed`, `relaunch_unverified`, `refused`) answer recoverable; `skipped_no_house_credentials` (the house credential is unset on our side, Retry cannot help) answers not recoverable with copy that says the problem is on our side. Researcher may refine the per-kind split from what each kind means in `mt5_terminal_scrub.py`; the rule is "recoverable iff a retry can succeed without an operator". The per-cause ERROR alert and the scrub row are kept exactly as the scrub already writes them.
- `trace.outcome` gets a distinct value for the healed path and for the inline-scrub-failed path, so Railway logs tell "owed and healed" apart from "owed and could not heal" (the old `scrub_owed` outcome no longer describes a refusal).

### Wizard resume banner
- Without a matching local pointer, while the banner is showing, NO wizard step is mounted under it: the banner (Resume draft / Start fresh) is the only content until the founder chooses. Resume mounts the draft's resume step; Start fresh mounts the first step. Same-browser silent resume (matching pointer) is unchanged.
- Banner copy by key type: an API-key draft says the API secret must be pasted again; an MT5 draft says the investor password must be entered again; CSV keeps its re-select-the-file copy; when the resumed step needs no secret re-entry, the banner says nothing about re-entry. Wording follows the existing banner voice and DESIGN.md; no new visual treatment.

### Decided autonomously
- [Server] Q: "Where does the healed path live?" → Selected: "In place at the owed gate of `_validate_mt5_key_probe`, calling the existing scrub-under-lease machinery (reuse `run_owed_validation_scrub_in_lease` or a sibling that returns the kind), not a new module" — local to one function; undo is a revert.
- [Server] Q: "Does the scheduled-scrub path (`schedule_validation_terminal_scrub`) stay?" → Selected: "Yes for every post-check scrub; the owed gate no longer schedules, it pays inline" — internal control flow only.
- [Server] Q: "Does the `report_scrub_owed_refusal` reporter stay?" → Selected: "Only where a refusal still happens (the inline scrub failed); a healed check logs at INFO, not ERROR" — logging level and call site only.
- [Tests] Q: "How is the heal proven?" → Selected: "pytest from `analytics-service/` with the scrub stubbed per kind: scrubbed → probe runs in the same request; each non-scrubbed kind → new code, no probe; plus the budget-arithmetic ordering test; vitest for the new wizard error key and both banner behaviours; each gate neutered once to see RED" — tests only.
- [Wizard] Q: "How is 'hold the step' implemented?" → Selected: "Derive whether a choice is pending from the same inputs `deriveWizardResumeOverrides` uses, and render the banner alone while pending, instead of mounting `draftResumeStep` in the `useState` initializer" — component-local state.

### Amended after research (2026-11-19, phase agent; RESEARCH.md Open Questions 1, 2, 3, 7, 8)
- Wire codes: ONE new code `MT5_TERMINAL_NOT_READY` (recoverable true) for the transient non-scrubbed kinds; `skipped_no_house_credentials` answers the existing 500 `MT5_VALIDATION_UNCONFIGURED` (not recoverable, "on our side"). Reason: the TS parity contract pins one `recoverable` value per code, so "recoverable per kind" becomes "code per recoverability class". Supersedes the "per scrub kind recoverable on one new code" wording above. — **Reversibility:** costly — same cross-seam contract as above.
- Logs: the healed path is recorded as a distinct `owed_scrub` stage event (later arms overwrite `trace.outcome`, so an outcome value for "healed" would never be seen); the failure path sets `trace.outcome = "scrub_unhealed"`. Supersedes the "distinct trace.outcome for the healed path" wording above.
- Budget: research Option B — the inline scrub's event-loop wait is bounded at 30 s (env-overridable), the probe deadline is the remainder of the 75 s with a 40 s floor; the stage-below-deadline inversion is accepted only when the scrub and the probe are both slow, and the ordering test states it. The wizard bound applies to the event-loop wait only, never to the scrub thread's own deadline (otherwise `_affordable` starves the relaunch and every heal ends `relaunch_unverified`).
- Banner: the only step a banner resumes onto (`sync_preview`) has no secret input, so API and MT5 banners carry no re-entry sentence at all; CSV keeps its re-select copy. If a resumed step ever does need re-entry, the sentence names the right secret by key type.
- Park skip after a healed inline scrub: downgraded from a page to INFO only when the skip is caused by this phase's inline scrub; every other park skip keeps its level.

### Claude's Discretion
- Exact copy of the new error key (title / cause / fix) and of the per-key-type banner lines, within the spec above and the existing wizardErrors voice (static copy, true at its only emitter, pinned by `wizardErrors.test.ts`).
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `run_owed_validation_scrub_in_lease(host, port, *, site) -> bool` and `_scrub_under_lease(...) -> kind` in `analytics-service/services/mt5_terminal_scrub.py`; `SCRUB_KIND_*` constants; `_VALIDATION_SCRUB_BUDGET_S`.
- The worker's inline owed gate in `analytics-service/services/ingestion/mt5.py` (the pattern to mirror).
- `VenueTransientHTTPException` (flat 424, `recoverable`), `MT5_TERMINAL_BUSY_DETAIL`, `trace.outcome`, `emit_mt5_stage_event` in `routers/exchange.py`.
- `KEY_MT5_TERMINAL_BUSY` entry and `VENUE_WIRE_CODE_TO_VERDICT` in `src/lib/wizardErrors.ts`.
- `deriveWizardResumeOverrides` (`src/lib/wizard/localStorage.ts`), `showResumeBanner`, `handleResume`, `handleStartFresh`, `draftResumeStep` in `WizardClient.tsx`.

### Established Patterns
- Budget arithmetic is documented in the header block of `routers/exchange.py` and ASSERTED by `tests/test_mt5_validate.py`.
- Wire codes are pinned across seams by `src/lib/seam-venue-vocabulary.invariant.test.ts` and `src/__tests__/contracts/contracts-registry.test.ts`.
- Never-raises guards: one `except Exception` with a nested `BaseException` fallback.

### Integration Points
- `strategies/create-with-key` and `strategies/composite/add-key` routes pass the analytics wire code through to the wizard.
- `MultiKeyConnectStep`, `StrategyForm`, `UpdateMt5SecretDialog`, `AllocatorExchangeManager` render `KEY_MT5_TERMINAL_BUSY` today (grep their tests for the new key's reach).
</code_context>

<specifics>
## Specific Ideas

- Founder, 2026-11-19: "it was an incorrect error message ... why did it not just scrub itself and retry, sort of healed itself"; chose "Book a fix: wizard waits (Recommended)".
- Founder, 2026-11-19: "Fix in Phase 218 (Recommended)" for the two resume findings (157 FCONF-01); "(a) the silent return is fine".
</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.
</deferred>
