---
phase: 153-wizform-form-errors-belong-on-the-form-mt5-declarable
verified: 2026-08-13T02:05:00Z
status: failed
score: 5/6 requirements verified across the span (WIZFORM-02 FAILED — measured live on PROD 2026-08-12/13 and reproduced from HEAD)
overrides_applied: 0
retroactive: true
span_verification: true
scope: "The PARENT container 153, verified as the SPAN 153.1 → 153.6. Phase 153 has ZERO plans and ZERO summaries of its own; its directory holds only the shared RESEARCH / PATTERNS / UI-SPEC / VALIDATION / EVIDENCE artefacts every sub-phase reads. The question answered here is the one no child VERIFICATION.md could answer: taken together, did the six sub-phases deliver the parent goal and its six requirements?"
verified_against: "branch docs/phase-156-connect-refactor = main @ 24a6392a plus docs-only commits (335ff162, ad92e564, ef0e8426, da6f2de1). No source commit differs from main."
children_verified:
  - "153.1 — VERIFICATION.md present"
  - "153.2 — VERIFICATION.md present"
  - "153.3 — VERIFICATION.md present"
  - "153.4 — VERIFICATION.md present"
  - "153.5 — VERIFICATION.md present (passed, 22/22, 3 warnings)"
  - "153.6 — VERIFICATION.md present (passed_with_concerns, 24/25, 4 warnings) — read as INPUT, not re-verified"
gaps:
  - truth: "WIZFORM-02 — no wizard failure renders `code: UNKNOWN` when the server DID classify it, and the closing sweep is driven from the EMITTING SITES rather than a hand-listed set"
    status: failed
    reason: >-
      The span closed TWO instance families and left the CLASS open. The derived-roster mechanism
      exists and demonstrably works — but its population is structurally scoped to two surfaces that
      exclude the analytics-service ROUTER envelope vocabulary entirely. A server-classified,
      deliberately-permanent 500 (`MT5_GATEWAY_UNCONFIGURED`) therefore reaches the user as
      `code: UNKNOWN` / "We could not classify this failure", live on PROD on 2026-08-12/13 —
      after the whole span shipped. Reproduced from HEAD by direct measurement (see
      *Falsification*, probe P1/P2). The same is true of `MT5_GATEWAY_UNREACHABLE`, the RETRYABLE
      sibling — so the entire mt5-gateway fault family lands on the terminal that admits knowing
      nothing, on the one venue this milestone exists to make usable.
    artifacts:
      - path: "src/lib/wizardErrors.invariant.test.ts"
        issue: >-
          `ROUTES` (:204-272) enumerates exactly THREE Next route files and matches only
          `NextResponse.json({ code: "X", error: ... }, { status: ... })`. The population is
          wizard-route-minted codes. A Python `service_error(...)` code is not in it and cannot be.
      - path: "src/lib/seam-venue-vocabulary.invariant.test.ts"
        issue: >-
          The one guard that DOES derive from Python is rooted at
          `analytics-service/services/**/*.py` (`SERVICES_ROOT`, :70) and matches only
          `error_code =` / `error_code=` / `result["error_code"] =` assignments (`ASSIGNMENT_RE`, :94).
          `analytics-service/routers/exchange.py` is outside the root AND the emission shape is a
          POSITIONAL argument to `service_error(500, "MT5_GATEWAY_UNCONFIGURED", ...)`, so it is
          doubly invisible. The file's own header is honest about being COVERAGE-LAW ROW 2 — a
          hand-typed roster with fail-loud arrival — but the arrival is loud only for the
          venue-classification vocabulary.
      - path: "src/lib/wizardErrors.ts"
        issue: >-
          `SEAM_CODE_TO_WIZARD_CODE` (:3057-3095) is a 7-row hand-typed map and its own docblock
          states the consequence in advance: "`SEAM_DEGRADED`, `MT5_GATEWAY_UNREACHABLE` and the
          venue codes have no wizard member and correctly answer `UNKNOWN`."
          `VENUE_WIRE_CODE_TO_VERDICT` (:2682-2730) has no `MT5_GATEWAY_*` row and
          `VENUE_WIRE_CODES_WITHOUT_VERDICT` (:2746-2795) has no recorded disposition for them
          either — so they are absent from BOTH halves of the coverage law, which is the one state
          the law was built to make impossible for the codes it does cover.
      - path: "src/app/api/strategies/create-with-key/route.ts"
        issue: >-
          The terminal arm (`:1057`, `:1094`) discards the honest machine code:
          `classifyKeyValidationError(err)` reads `err.seamCode` only through
          `VENUE_WIRE_CODE_TO_VERDICT`, falls through to a substring cascade over the human
          sentence, and answers `{ code: "UNKNOWN", status: 500 }`. The route then emits
          `NextResponse.json({ code })`.
      - path: "analytics-service/routers/exchange.py"
        issue: >-
          Four `MT5_GATEWAY_UNCONFIGURED` emitters (`:465`, `:477`, `:620`, `:868`) and one
          `MT5_GATEWAY_UNREACHABLE` emitter (`:628`), each fully classified with `dependency`,
          `retryable` and operator-directed copy — and no TypeScript disposition for any of them.
      - path: ".planning/REQUIREMENTS.md"
        issue: >-
          `KNOWN_CODELESS_FINALIZE_REJECTIONS = 3` (wizardErrors.invariant.test.ts:516) — three
          `finalize-wizard` rejections (500 draft-load, 500 finalize-RPC, 502 upstream-shape) still
          answer code-less, recorded as D-153.2-D. This half of the debt was already known,
          fenced in both directions, and is NOT the new finding.
    missing:
      - "A disposition for the analytics-service ROUTER envelope vocabulary — at minimum `MT5_GATEWAY_UNCONFIGURED` (permanent, operator) and `MT5_GATEWAY_UNREACHABLE` (transient, retryable) need wizard members or explicit `VENUE_WIRE_CODES_WITHOUT_VERDICT` rows with a measured reason."
      - "A DERIVED population covering `analytics-service/routers/**/*.py` `service_error(...)` codes, so the next router code minted reds CI by name instead of arriving on a user's screen. Today the derivation root is `services/` only and the shape matcher is `error_code=` only — either alone would have missed this."
      - "A decision, written down, on whether the coverage law's boundary is the RIGHT one. The two closed instances were 400-family wizard-route codes; this one is a 500-family router code. If the boundary is deliberate, `VENUE_WIRE_CODES_WITHOUT_VERDICT` is where that has to be said — leaving it unrecorded is what made this instance silent."
      - "The three remaining code-less `finalize-wizard` rejections (D-153.2-D), each needing a new copy member."
warnings:
  - id: W-153-1
    concern: >-
      WIZFORM-05's ARITHMETIC holds and the live evidence CONFIRMS it — but the requirement's
      headline promise ("an honest verdict always arrives inside the budget") is only half true as
      shipped. The 2026-08-12 logs show `stage="initialize"` at 45,169 / 45,159 / 45,177 ms. That is
      NOT a censored verdict: 45,000 ms is `_MT5_VALIDATE_INITIALIZE_TIMEOUT_MS`
      (routers/exchange.py:96), the INNERMOST and deliberately-first-firing layer of the D-02/D-03
      nested chain, sized so the failure carries a real MT5 code. The verdict arrived at ~45 s
      inside a 120 s budget, with the pre-153 30 s inversion gone. What then happened to it is
      WIZFORM-02's failure, not WIZFORM-05's: the honest server verdict was discarded at the
      TypeScript boundary and rendered UNKNOWN. Recorded here so the two are not conflated —
      lengthening the budget further would fix nothing.
    severity: warning
    kind: interaction
    blocking: false
  - id: W-153-2
    concern: >-
      DOCUMENTATION — the parent block's Success Criteria list is MISNUMBERED. `ROADMAP.md:291-297`
      runs 1, 2, 3, **5**, 4, **5**: WIZFORM-05 is numbered 5, WIZFORM-03 is numbered 4, and MT5-14
      is numbered 5 again. "SC5" is therefore ambiguous between the deadline inversion and the MT5
      preselect. Every finding in this report is cited by REQUIREMENT ID for that reason.
    severity: warning
    kind: documentation
    blocking: false
  - id: W-153-3
    concern: >-
      DOCUMENTATION — the phase rollups UNDERCOUNT by one requirement. The ROADMAP checklist line
      (`:60`) summarises 153 as five behaviours — inline field validation, honest error codes,
      transient infra absorbed, venue-appropriate copy, MT5 preselected — with no representation of
      WIZFORM-05 (the deadline inversion), and `REQUIREMENTS.md:1434` writes the rollup literally as
      "153 WIZFORM-01..04 + MT5-14". The detail block (`ROADMAP.md:290`) correctly declares six.
      A reader skimming either rollup undercounts the phase and would not know 153.3/153.4 existed.
    severity: warning
    kind: documentation
    blocking: false
  - id: W-153-4
    concern: >-
      DOCUMENTATION — `REQUIREMENTS.md`'s WIZFORM-03 record is STALE and contradicts its own
      neighbour. The matrix row (`:1366`) states "⛔ `ConnectKeyStep` / `MultiKeyConnectStep` are
      **Phase 153.4's** and still pass neither, so an MT5 user can still read 'switch to a different
      exchange' on the CONNECT step", and the checkbox at `:778` is unticked. Both are false at HEAD:
      `ConnectKeyStep.tsx:1041-1048` and `MultiKeyConnectStep.tsx:1830-1837` each pass
      `surface: "connect"` AND `venue`. The WIZFORM-05 row directly below (`:1368`) even says so
      ("closing D-17 at this surface"). Two adjacent rows describing the same commit disagree.
    severity: warning
    kind: documentation
    blocking: false
  - id: W-153-5
    concern: >-
      The parent phase 153 checkbox (`ROADMAP.md:60`) is unticked while all six children are
      complete and five carry `[x]` plan rows. That is CORRECT today — WIZFORM-02 is genuinely open
      — but the reason is nowhere recorded at the parent, so a reader cannot tell an open
      requirement from an un-updated checkbox. This report is that record.
    severity: warning
    kind: documentation
    blocking: false
deferred:
  - truth: "The 120 000 ms `validate-key-serialized` budget is PROVISIONAL — the founder's stated staleness tolerance, not a measurement. No uncensored successful MT5 validation exists, so no p50/p95 does either."
    addressed_in: "Phase 155 (MT5-VERIFY)"
    evidence: "D-27, stated in code at `src/lib/resilient-fetch.ts` (`validate-key-serialized` notes) and in `REQUIREMENTS.md:1368`. Phase 155's ROADMAP goal is the live-hardware gate on a trading day; 153.3's `stage` + `duration_ms` instrumentation is what produces the data — and the 45 s figures assessed above are the first fruit of it."
  - truth: "`_WRONG_SERVER_TOKENS` / `_AUTH_TOKENS` / the IPC code-gate set are complete against a real MT5 terminal — the -10005 'IPC timeout' → `wrong_server` misclassification (W-153.6-1)"
    addressed_in: "Phase 155 (MT5-VERIFY), with a ready fix on branch fix/mt5-ipc-timeout-misclassified"
    evidence: "153.6-VERIFICATION.md W-153.6-1; `services/mt5_validation.py:66-83` carries explicit `[ASSUMED] pending the live spike` markers naming Phase 155 as owner."
  - truth: "PARITY-04 remedy (a) — the venue `attested_venue` records is one the SERVER validated"
    addressed_in: "Phase 156 (CONNECT-REFACTOR)"
    evidence: "153.6-VERIFICATION.md deferred[2]; ROADMAP `### Phase 156`; REQUIREMENTS CONNECT-01..05."
human_verification:
  - test: "On PROD with the mt5-gateway deliberately stopped (or its env unset), start a wizard MT5 connect and read the envelope."
    expected: "After the fix, an operator-directed sentence naming the gateway — never `code: UNKNOWN` with 'we cannot tell you whether your last action took effect'. TODAY it renders UNKNOWN; that is the observed defect, reproduced from HEAD but confirmed only in the founder's own 2026-08-12/13 session."
    why_human: "Requires a live PROD gateway fault; the code path is proven from HEAD but the rendered surface is not observable from the repository."
  - test: "Confirm the 2026-08-12 45 s `stage=\"initialize\"` events were three SEPARATE requests, not three stages inside one."
    expected: "Three distinct correlation ids. Three stages inside one request is impossible against a 75 s end-to-end deadline, so this should confirm — but it is the one reading of the logs this verifier cannot take."
    why_human: "Requires the Railway log correlation ids; not observable from the repository."
  - test: "Confirm no OTHER `service_error(...)` router code has reached a user as UNKNOWN since 153.6 shipped (Sentry, surface `strategies-create-with-key`, tag `unclassified-key-error`)."
    expected: "The route DOES `captureToSentry` on every UNKNOWN (`create-with-key/route.ts:1083-1089`), so the population is queryable. Any hit names another member of this class."
    why_human: "Sentry is external to the repository."
---

# Phase 153: WIZFORM — Form errors belong on the form (+ MT5 declarable) — SPAN Verification Report

**Phase Goal:** The wizard stops costing submits — errors land inline on the offending field, transient infrastructure never becomes a user decision, copy never advises the impossible, and an MT5 strategy can declare its venue.
**Verified:** 2026-08-13T02:05:00Z (retroactive; the span shipped across PRs up to #675 / v0.58.0.0)
**Status:** failed — 5/6 requirements verified, WIZFORM-02 FAILED with a live PROD instance
**Re-verification:** No — initial verification of the PARENT SPAN

---

## What this report is, and what it is not

Phase 153 is a **container**. It was split six ways (founder-approved 2026-08-08) and holds no plans
and no summaries of its own — only the shared artefacts (`153-RESEARCH.md`, `153-PATTERNS.md`,
`153-UI-SPEC.md`, `153-VALIDATION.md`, `153-CONTEXT.md`, `153-EVIDENCE-mt5-latency.md`,
`153-EVIDENCE-mt5-platform.md`) every sub-phase reads. Each of 153.1–153.6 already carries its own
VERIFICATION.md and each of those was scoped to its own file ownership.

This report answers the one question none of them could: **taken together, did the six deliver the
parent goal and its six requirements?** Everything below is traced to source on the current branch.
No child SUMMARY or child VERIFICATION claim is accepted as evidence for a load-bearing statement;
153.6's report (written 2026-08-13, `passed_with_concerns`, 24/25) is read as INPUT only, per the
task's instruction not to re-verify it in depth.

**Citation discipline:** every finding is cited by REQUIREMENT ID. The parent block's Success
Criteria list is misnumbered (W-153-2) — it runs 1, 2, 3, **5**, 4, **5** — so "SC5" is ambiguous
between WIZFORM-05 and MT5-14 and is never used here.

---

## Goal Achievement — the parent goal, clause by clause

| # | Goal clause | Status | Evidence |
|---|---|---|---|
| 1 | "errors land inline on the offending field" | ✓ VERIFIED | WIZFORM-01 below. Client mirror of `MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS` refuses at the field; `FIELD_BY_CODE` routes a server field-level code back to its field instead of an envelope. |
| 2 | "transient infrastructure never becomes a user decision" | ✗ FAILED (connect surface) | The SUBMIT half holds (WIZFORM-04, falsified). The CONNECT half does not: `MT5_GATEWAY_UNREACHABLE` — `retryable=True`, the canonical transient — is measured to classify `UNKNOWN/500`, whose copy offers no action and states we cannot say whether the action took effect. The transient did not become a user *decision*; it became a user *dead end*, which is worse. |
| 3 | "copy never advises the impossible" | ✓ VERIFIED | WIZFORM-03 below. `fixRequires` live and `venue`/`surface` paid at all three surfaces. |
| 4 | "an MT5 strategy can declare its venue" | ✓ VERIFIED | MT5-14 below. Declarable AND preselected, venue-agnostically. |

---

## Requirements Coverage — the span's actual contract

| Requirement | Owner sub-phases | Status | Evidence |
|---|---|---|---|
| **WIZFORM-01** — inline field validation before submit, never a terminal full-page envelope | 153.2 (01/02/03/05) | ✓ VERIFIED | `MetadataStep.tsx:68` refuses on `MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS` (composed, not typed — `:82-87`); category / AUM / capacity refuse through `Field` with aria-derived borders; `AllocateDialog.tsx` converted to `aria-[invalid=true]:border-negative` (D-12). ⭐ The last path is closed by `SubmitStep.tsx:95-120` `FIELD_BY_CODE` — eight `METADATA_*` codes mapped to their field ids — consumed at `:534-539` (`onFieldLevelError` → `WizardClient` step change → `MetadataStep` reveals and focuses the field with values intact). 591 wizard tests green. |
| **WIZFORM-02** — no `code: UNKNOWN` when the server DID classify, driven from EMITTING SITES | 153.1 (05/06), 153.2 (05) | ✗ **FAILED** | See *The WIZFORM-02 finding* below. Mechanism exists, works, and is falsifiable — within a population that structurally excludes the surface the founder hit. `[ ]` unticked in REQUIREMENTS.md, correctly. |
| **WIZFORM-03** — no venue-shaped copy for venues it cannot apply to | 153.1 (03), 153.2 (05), 153.4 (04/05) | ✓ VERIFIED | `fixRequires` class filter live in `wizardErrors.ts` with one filter in `formatKeyError`; and — the half that was open at 153.2 — `venue` + `surface` are now paid at ALL THREE call sites: `SubmitStep.tsx:624+` (`surface: "submit"`), `ConnectKeyStep.tsx:1041-1048` (`surface: "connect"`, `venue: attemptExchange ?? exchange`), `MultiKeyConnectStep.tsx:1830-1837` (`surface: "connect"`, `venue: attemptVenue`, per panel). ⚠️ REQUIREMENTS.md still records this as Partial — W-153-4. |
| **WIZFORM-04** — transient seam failure absorbed; ask first whether the call is needed; never retry into an open breaker | 153.2 (04) | ✓ VERIFIED | Satisfied by REMOVING the call, per the requirement's own ⛔. ONE gated helper `runScopeBroadeningProbe` (`finalize-wizard/route.ts:743`) with `if (!venueSupportsScopeProbe(venue)) return { ok: true }` at `:792`, reached from BOTH call sites (`:1333` single-key, `:1638` per composite member) — so the gate is structurally un-skippable at one site. Fails TOWARD probing on `null` (`closed-sets.ts:199`, `?? true`). Breaker untouched: `CircuitOpenError` still fails CLOSED at `:807-826`. **Falsified M2** below. |
| **WIZFORM-05** — the MT5 validate-key deadline inversion reconciled | 153.3 (02/03/04), 153.4 (01–05) | ✓ VERIFIED (with W-153-1) | Server: the nested chain is documented and PINNED — `initialize/login IPC 45 000 ms < rpyc 55 s < stage 60 s < end-to-end 75 s`, `+10 s` release outside it, `+20 s` bounded lease wait ⇒ `worst_case_ms == 105_000` and `< 120_000`, asserted in `tests/test_mt5_validate.py:1176-1180` against a HAND-TYPED 120 000. Client: `budgetKeyFor(exchange)` selects by CAPABILITY (`analytics-client.ts:702`, `:742`), `validate-key-serialized` = 120 000 ms, plus the client-safe `wizard/validate-budget.ts` twin, `ValidateWaitCard`, and the 165 000 ms `connectAbortDeadlineMsFor`. 67 pytest + 174 TS invariant assertions green. The live 45 s observations CONFIRM rather than contradict this — see W-153-1. |
| **MT5-14** — MT5 declarable in supported-exchanges metadata AND preselected from the connected key | 153.2 (04) | ✓ VERIFIED | `closed-sets.ts:482-495` — `WIZARD_EXCHANGE_CODES` / `WIZARD_EXCHANGES` composed ON TOP of `UI_EXCHANGE_CODES` behind `MT5_UI_ENABLED`, so `CRYPTO_EXCHANGES` and the public marketing count do not move. Consumed at `MetadataStep.tsx:1131` (`items={[...WIZARD_EXCHANGES]}`). **Preselect** at `:432-437` — `canonicalizeWizardExchange(detectedExchange)` → `withDetectedVenue(...)` seeding `supportedExchanges`, and the file names no venue (a Bybit key pins Bybit). The no-widening pin was re-cut with a POSITIVE flag-ON assertion, not merely a relaxed negative (`closed-sets.mt5-flag.test.ts:144-174`), so it can no longer pass by asserting absence. |

**Score: 5/6 requirements verified.**

---

## The WIZFORM-02 finding — did the span close the CLASS, or patch two instances?

**It patched instances. The class is open, and the boundary is structural, not accidental.**

### The mechanism exists and it works

Two derived guards were built and both are real:

1. **`src/lib/wizardErrors.invariant.test.ts`** — `deriveEmittedCodes` scans route SOURCE for
   `NextResponse.json({ code: "X", error: … }, { status: … })` and requires every derived code to
   clear (a) the `WizardErrorCode` union or the alias table, and (b) THAT ROUTE's own client roster.
   Per-route hand-typed site counts (12 / 12 / 29), never `derived.length`. `finalize-wizard` moved
   0 → 25 → 29 sites.
2. **`src/lib/seam-venue-vocabulary.invariant.test.ts`** — derives the emitted-code population from
   the REAL Python sources and requires every member to carry a disposition: a row in
   `VENUE_WIRE_CODE_TO_VERDICT` or an explicit reason in `VENUE_WIRE_CODES_WITHOUT_VERDICT`.

Both are falsifiable and both were falsified here (M1 below). This is not a paper mechanism.

### What its source of truth actually enumerates

| Guard | Derivation root | Emission shape matched | Population |
|---|---|---|---|
| `wizardErrors.invariant` | 3 files: `create-with-key/route.ts`, `composite/add-key/route.ts`, `finalize-wizard/route.ts` (`ROUTES`, :204-272) | `NextResponse.json({ code, error }, { status })` | Codes OUR Next routes mint |
| `seam-venue-vocabulary.invariant` | `analytics-service/services/**/*.py` (`SERVICES_ROOT`, :70) | `error_code =` / `error_code=` / `result["error_code"] =` (`ASSIGNMENT_RE`, :94) | The venue-CLASSIFICATION vocabulary |

### Why a server-classified 500 escapes it

`analytics-service/routers/exchange.py:866-871`:

```python
raise service_error(
    500,
    "MT5_GATEWAY_UNCONFIGURED",
    dependency="mt5-gateway",
    retryable=False,
    detail="The MetaTrader gateway is not configured. This needs an operator, not a retry.",
)
```

This site is invisible to **both** guards, for **two independent reasons** — either alone would
have been enough:

- **Wrong root.** It lives in `routers/`, and the Python derivation is rooted at `services/`.
- **Wrong shape.** The code is a **positional argument** to `service_error(...)`, not an
  `error_code=` assignment. Even relocating the file would not make it visible.

There are five such emitters at HEAD: `MT5_GATEWAY_UNCONFIGURED` at `:465`, `:477`, `:620`, `:868`,
and `MT5_GATEWAY_UNREACHABLE` at `:628`. None has a TypeScript disposition, and — the part that
matters — **none appears in `VENUE_WIRE_CODES_WITHOUT_VERDICT` either.** They are absent from BOTH
halves of the coverage law, which is precisely the state the law exists to make impossible for the
codes it does cover. For a covered code, absence reds CI. For these, absence is silence.

### The consequence, measured from HEAD

The wire code survives all the way to the TypeScript boundary — `AnalyticsUpstreamError` carries
`seamErrorCode(body)` (`analytics-client.ts:552-559`) — and is then discarded:
`classifyKeyValidationError` reads `err.seamCode` **only** through `VENUE_WIRE_CODE_TO_VERDICT`
(`wizardErrors.ts:2865-2875`), finds no row, deliberately does not short-circuit, and falls into a
substring cascade over the human sentence. No needle matches
`"The MetaTrader gateway is not configured. This needs an operator, not a retry."` → terminal
`{ code: "UNKNOWN", status: 500 }`. `create-with-key/route.ts:1094` emits `{ code: "UNKNOWN" }`;
`ConnectKeyStep.tsx:872-879` translates and roster-checks and lands on `UNKNOWN`; the envelope
renders "We could not classify this failure, so we cannot tell you what happened or whether your
last action took effect." — verbatim what the founder saw.

### Judgement on the class boundary

The nuance is real and I state it rather than hide behind it: **the two recorded instances were
400-family codes minted by our own wizard routes; this one is a 500-family code minted by the
analytics ROUTER.** The mechanism's boundary is "codes our Next routes mint" ∪ "the Python
venue-classification `error_code` vocabulary".

**That is the wrong boundary for this requirement.** WIZFORM-02's criterion is written about what
the USER sees and about what the SERVER classified — not about which file or which status family
did the classifying. `MT5_GATEWAY_UNCONFIGURED` is the single most deliberately-classified verdict
in the whole MT5 path: it carries a dependency, an explicit `retryable=False`, and copy that names
the remedy ("This needs an operator, not a retry"). Every bit of that was thrown away, and the user
was told we know nothing. A boundary that excludes the most classified verdict in the subsystem is
not a class fix; it is two instance fixes with a guard around them.

⚠️ **And it is worse for the transient sibling.** `MT5_GATEWAY_UNREACHABLE` (503, `retryable=True`,
`retry_after` stamped) also measures to `UNKNOWN/500` (probe P2). So a temporary gateway blip on the
connect step renders as an unclassifiable terminal with no retry affordance — which is the
WIZFORM-04 harm class ("transient infrastructure becomes a user decision") reached through the door
WIZFORM-02 left open. The two requirements are closing the same wound from opposite sides and the
span closed only one side.

ℹ️ The already-known half of WIZFORM-02 — `KNOWN_CODELESS_FINALIZE_REJECTIONS = 3` (D-153.2-D) — is
correctly fenced in both directions and is NOT what fails this requirement. It is listed under
`missing` for completeness only.

---

## Falsification (measured, not predicted)

Every mutation applied to shipped source and reverted. Final `git status --short src/
analytics-service/ supabase/` → **empty** (asserted below).

| # | Mutation / probe | Guard expected to answer | Result |
|---|---|---|---|
| M1 | `finalize-wizard/route.ts:1053` — `code: "SEAM_MISCONFIGURED"` → `code: "ZZZ_UNADMITTED_CODE"` | `wizardErrors.invariant` union + roster coverage | **RED, both** — `expected [ 'ZZZ_UNADMITTED_CODE' ] to deeply equal []`, naming the code and the remedy. The derived sweep is genuinely load-bearing *within its population*. Restored; 30/30 green. |
| M2 | `closed-sets.ts:146` — `mt5: { scopeProbeSupported: false … }` → `true` | WIZFORM-04 gate + capability class sweeps | **RED ×7** across two files, incl. "an MT5 single-key submit crosses the keys-permissions seam ZERO times (D-06)", both CLASS SWEEPs, both PARITY-04 attested-venue rows, and "EXACTLY ONE venue opts out of the scope probe, and it is mt5". Restored; 204/204 green. |
| P1 | Probe: `MT5_GATEWAY_UNCONFIGURED` + its real detail string through `classifyKeyValidationError` | expected an honest verdict | **`{ code: "UNKNOWN", status: 500 }`** — the PROD defect reproduced from HEAD. Also confirmed: absent from `VENUE_WIRE_CODE_TO_VERDICT` AND from `VENUE_WIRE_CODES_WITHOUT_VERDICT`; `recogniseSeamErrorCode` → `UNKNOWN`. |
| P2 | Probe: `MT5_GATEWAY_UNREACHABLE` (the RETRYABLE sibling) + its real detail string | expected a retryable verdict | **`{ code: "UNKNOWN", status: 500 }`** — the whole mt5-gateway fault family lands on the terminal. |
| P3 | Probe: `SEAM_DEGRADED`, `KEK_UNAVAILABLE`, `EGRESS_PROXY_MISCONFIGURED` through `recogniseSeamErrorCode` | — | All `UNKNOWN`. The gap is a FAMILY, not one code. (`SEAM_DEGRADED` and `MT5_GATEWAY_UNREACHABLE` are named as intentional in the map's own docblock; the other three are not named anywhere.) |

Probe files were written to `src/lib/zzz-verifier-probe.test.ts`, run, and deleted.

---

## Key Link Verification (the span's cross-sub-phase seams)

| From | To | Via | Status |
|---|---|---|---|
| `MetadataStep` (153.2) | `MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS` (153.1) | composed constant, not a typed literal (`:68`, `:82-87`) | WIRED |
| `SubmitStep.FIELD_BY_CODE` (153.2) | `MetadataStep` field ids | `onFieldLevelError` → `WizardClient` step change (`SubmitStep:534-539`) | WIRED |
| `finalize-wizard` probe gate (153.2/153.6) | `VENUE_CAPABILITIES` (153.1) | `venueSupportsScopeProbe(attestedVenue)` at ONE helper, TWO callers | WIRED — falsified M2 |
| `analytics-client.validateKey` (153.4) | `SEAM_BUDGETS["validate-key-serialized"]` | `budgetKeyFor(exchange)` by `serialized` capability | WIRED |
| `ConnectKeyStep` / `MultiKeyConnectStep` (153.4) | `fixRequires` filter (153.1) | `venue` + `surface: "connect"` in `buildEnvelope` context | WIRED — closes the 153.2-era gap |
| `routers/exchange.py` `service_error` codes (153.3) | `VENUE_WIRE_CODE_TO_VERDICT` / `SEAM_CODE_TO_WIZARD_CODE` (153.1) | — | ✗ **NOT WIRED.** No edge exists, and no guard derives one. This is the WIZFORM-02 gap. |
| `services/mt5_client.py` fence (153.5) | five caller surfaces | `except Mt5SessionAbandoned` | WIRED (153.5 verification, 22/22, M1–M5 falsified) |
| `ingestion/mt5.py` (153.6) | `routers/exchange.py`'s 153.3 fixes | parity plans A1–A3 | WIRED (153.6 verification, 24/25) |

---

## Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real? | Status |
|---|---|---|---|---|
| `MetadataStep` description hint / refusal | `MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS` | the same constant the SERVER's `validatePayload` reads | Yes — one source, both sides | FLOWING |
| `MetadataStep` supported-exchanges chips | `WIZARD_EXCHANGES` ← `WIZARD_EXCHANGE_CODES` ← `MT5_UI_ENABLED` | real flag, real registry | Yes | FLOWING |
| `MetadataStep` preselect | `withDetectedVenue(initial, canonicalizeWizardExchange(detectedExchange))` | the connected key's own venue | Yes | FLOWING |
| `ValidateWaitCard` ladder | `validateBudgetSecondsFor(venue)` | client twin of `SEAM_BUDGETS`, pinned to it | Yes | FLOWING |
| Wizard error envelope, MT5 gateway fault | `errorCode` | ✗ the server's honest code is DISCARDED at `classifyKeyValidationError`; the envelope renders a constant terminal | **No** | ⚠️ **HOLLOW** — wired, but the data that reaches the user is a fallback, not the classification the server produced |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| The WIZFORM invariant surface holds | `npx vitest run src/lib/{wizardErrors.invariant,seam-venue-vocabulary.invariant,closed-sets.mt5-flag,seam-budgets.invariant}.test.ts src/lib/wizard/validate-budget.test.ts` | 174 passed (5 files) | PASS |
| The whole wizard UI surface holds | `npx vitest run "src/app/(dashboard)/strategies/new/wizard"` | 591 passed (32 files) | PASS |
| Seam citations + pins + copy tables + registry | `npx vitest run src/lib/{seam-citations.invariant,seam-constants.pin,wizardErrors,closed-sets}.test.ts` | 351 passed | PASS — the 153.1-self-caused `seam-citations` failure is cleared |
| The MT5 validate deadline chain (server) | `cd analytics-service && python3 -m pytest -q tests/test_mt5_validate.py tests/test_mt5_validate_parity.py` | 67 passed in 6.23s | PASS |
| Tree unmodified after all mutations and probes | `git status --short src/ analytics-service/ supabase/` | **empty** | PASS |

## Probe Execution

| Probe | Command | Result | Status |
|---|---|---|---|
| — | — | `find scripts -path '*/tests/probe-*.sh'` returns nothing; no PLAN or SUMMARY in the span declares one | SKIPPED (none declared or discoverable) |

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | No unreferenced `TBD` / `FIXME` / `XXX` introduced by the span's files | — | Debt-marker gate: CLEAN |
| `src/lib/wizardErrors.ts` | 3070 | Docblock states `MT5_GATEWAY_UNREACHABLE` "correctly answer[s] `UNKNOWN`" | ⚠️ Warning | The premise was written for a code with no user-facing surface. Since 153.2 MT5 IS a wizard-submittable venue, so the sentence now justifies the exact defect the founder hit. Prose whose premise has broken — the Pitfall-1 class 153.1 was chartered to close. |
| `src/lib/resilient-fetch.ts` | 538, 594-606 | `MT5_GATEWAY_UNCONFIGURED` is named three times, correctly, as a SERVICE-PERMANENT 500 | ℹ️ Info | The repository already KNEW this code exists and what it means. It was reasoned about for breaker accounting and never for user-facing copy — which is why the gap is a boundary problem, not a knowledge problem. |

---

## Gaps Summary

Five of six requirements are delivered and were verified against source, not against SUMMARY claims;
two of the load-bearing mechanisms were falsified by mutation and restored. WIZFORM-01, WIZFORM-03,
WIZFORM-04, WIZFORM-05 and MT5-14 are all genuinely closed — and WIZFORM-03 is closed *further* than
its own REQUIREMENTS.md row admits (W-153-4).

**WIZFORM-02 is not closed, and the way it is not closed is the finding.** The span built exactly the
remedy the requirement asked for — a derived roster with a coverage assertion, precisely so a
hand-listed set could not drift — and that remedy demonstrably works. But its source of truth
enumerates *codes our Next routes mint* plus *the Python venue-classification `error_code`
vocabulary*, and the analytics-service ROUTER's `service_error(...)` envelope vocabulary is in
neither, for two independent structural reasons (wrong directory root, wrong emission shape). A
fully classified, deliberately permanent 500 — `MT5_GATEWAY_UNCONFIGURED`, carrying a dependency, an
explicit `retryable=False` and operator-directed copy — therefore reaches the user as `code: UNKNOWN`.
Live on PROD on 2026-08-12/13, after the whole span shipped, reproduced from HEAD here. Its retryable
sibling `MT5_GATEWAY_UNREACHABLE` does the same.

So: **the span closed two instances of the class and left a third family structurally invisible.** The
boundary is a real one and it is documented in the guards' own headers — but it is the wrong boundary
for a requirement written about what the user sees, and the fact that these codes appear in *neither*
half of the coverage law (not as a verdict row, not as a recorded no-verdict) means their absence
could never have been loud.

Two things follow that the founder should weigh:

1. **The fix is not "add two rows."** Adding `MT5_GATEWAY_UNCONFIGURED` and `MT5_GATEWAY_UNREACHABLE`
   to the map would close the two instances and reproduce the exact defect one more time. The class
   fix is a DERIVED population over `analytics-service/routers/**/*.py` `service_error(...)` codes,
   so the next router code minted reds CI by name.
2. **WIZFORM-05 is fine and should not be re-opened.** The 45 s figures are its instrumentation
   working, not its budget failing (W-153-1). The verdict arrived in 45 s against a 120 s budget; it
   was thrown away afterwards. Lengthening the budget would fix nothing.

Four documentation defects are recorded (W-153-2 through W-153-5): the misnumbered Success Criteria
list, the two rollups that omit WIZFORM-05, and the stale WIZFORM-03 matrix row that contradicts the
row directly beneath it.

**Tree state on completion:** `git status --short src/ analytics-service/ supabase/` → **empty**.
Verified after every mutation and after deleting both probe files. The only write this verification
made is this file.

---

_Verified: 2026-08-13T02:05:00Z_
_Verifier: Claude (gsd-verifier) — retroactive SPAN verification of Phase 153 across 153.1–153.6_
