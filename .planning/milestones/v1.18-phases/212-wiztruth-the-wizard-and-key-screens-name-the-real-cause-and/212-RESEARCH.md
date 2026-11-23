# Phase 212: WIZTRUTH — the wizard and key screens name the real cause, and every remedy they offer can work - Research

**Researched:** 2026-11-14
**Domain:** error-surface truth (Next.js wizard + dashboard key forms), curated-copy fences (Python MT5 constants), MT5 terminal-lease timing, contact-pointer copy
**Confidence:** HIGH for SC1, SC2, SC5, SC6 mechanics; MEDIUM for SC3 forwarded-code census (per-code statuses partly unmeasured); HIGH that SC4 has no honest static number (see § SC4)
**Bound to:** worktree HEAD `61cb2c1564cea6c695101552d3379d5d64ba5d5e` (branch `feat/212-wiztruth`, one docs commit on top of `4c4fa1993`). Every `[VERIFIED]` below was read or executed this session at that HEAD. Anchors are cited by symbol first (CLAUDE.md `[164.7-CITATION-DRIFT-01]`); line ranges sit inside the tag.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**MT5 cause-unknown copy (SC2) — founder decision 2026-11-14**
- `MT5_GATEWAY_MISCONFIGURED_DETAIL` becomes, byte for byte: "The MT5 gateway would not let us prove read-only capability, and it did not report why. This needs an operator, not a retry — see docs/runbooks/mt5-go-live.md." This is the founder approval SC2 requires. The arm-3 contract in `.planning/milestones/v1.20-phases/161-wizerr-honest-error-surfaces/161-UI-SPEC.md` is amended to this sentence in the same change. The constant stays the generic fallback AND the `curated_gateway_detail` degradation target, keeps the `Mt5GatewayMisconfigured()` default-argument property, and must pass the MT5 curated-message fence (token lists in `mt5_validation.py`) unrelaxed. Arms 1 and 2 are unchanged. Comment-prose carriers that restate the old parenthetical as arm 3's meaning are corrected in the same pass.

**Contact-support pointers (SC6) — founder decision 2026-11-14**
- Server strings shown to users (csv-finalize `ENQUEUE_LOST_RACE_USER_COPY`, finalize-wizard composite `computation_error`, the two `account/export` messages) say "use the contact form" as plain text, so they become links wherever the rendering screen already goes through `ContactPointerText`, and read as a real next step where it does not. No new response field.
- The two admin-only `audit_warning` strings (`admin/match/send-intro`, `admin/partner-import`) name the admin's actual action instead of a support pointer, e.g. "Add the audit entry by hand; do not re-send." (partner-import keeps its "Do NOT re-run the import" meaning).
- Every in-app string (ProfileForm, SignupForm x2, ScenarioCommitDrawer x2, WeightOptimizerSection, ApiKeyManager and any other census hit) renders through `ContactPointerText` with a `contactHref` topic.
- Census is regenerated at HEAD with the TODOS entry's command (`grep -rni 'contact support' src ... | grep -v wizardErrors.ts | grep -v test`); the 2026-11-14 reading was 13 strings + 2 comments, not the entry's 15. Closing means the regenerate command returns only comments and fixtures, the pinning tests move, and the 164.6.6.3.5 no-email-in-copy sweep extends to the touched modules.

**MT5 connect during a running derive (SC4) — founder decision 2026-11-14**
- Measure, then decide. Read the `mt5.stage` hold times (derive read + restart, and the interactive validate's own duration) from Railway logs, read-only. If p95 derive hold plus our own check fits inside the 120 s client budget (D-26), raise `_MT5_LEASE_WAIT_S` via its `MT5_LEASE_WAIT_S` env default to cover it. Otherwise keep the `KEY_MT5_TERMINAL_BUSY` refusal and change its copy to state the measured retry time instead of "a minute". The measured numbers, their source and window are recorded in the phase artifacts; no number is guessed (if logs cannot yield a measurement, stop and report rather than invent one).

**Decided autonomously**
- [Composite verdict] Q: "How does the composite arm pick its code?" → Selected: "Branch on the real verdict through the same discrimination as the single-key arm and `gateFailureToWizardError`, so `sampled_gapped` and `fill_derived_unproven` render `GATE_SERIES_EXAMINED_REFUSED`; unstamped/null keeps `GATE_SERIES_PROVENANCE_UNVERIFIED`; the 142.2 pin moves with it" — a local branch in one component plus test.
- [Code channel] Q: "How do the three validate-and-encrypt consumers render?" → Selected: "Read `code` and look up `WIZARD_ERROR_COPY` via a roster, following `ConnectKeyStep`'s `recogniseCreateWithKeyCode`; add the fifth surface to `wizardErrors.roster-render.test.tsx` and raise `EXPECTED_POPULATION_MIN` off the new measurement" — client render change, no contract change.
- [Bare 401/403] Q: "Where does a bare upstream 401/403 get its code?" → Selected: "One shared status→seam-code lookup (`UPSTREAM_STATUS_TO_SEAM_CODE`, 401/403 → `SEAM_MISCONFIGURED`) consulted in the classifier's null-`seamCode` branch, so `create-with-key`, `composite/add-key` and `validate-and-encrypt` agree; route tests on both twins with `new AnalyticsUpstreamError('Unauthorized', 401)`" — internal mapping, existing code.
- [Orphan refusal] Q: "When is an orphaned MT5 key refused?" → Selected: "Run the existing two-read orphan resolver before the 120 s validate wherever the key's identity is known before validation, returning the existing `KEY_ORPHANED` refusal" — reorder within one route.
- [Scope] Q: "Migration?" → Selected: "None (SC7)" — none written.
- [Tests] Q: "Proof standard" → Selected: "Each fix has a test shown RED when the fix is reverted (neuter, observe RED, restore from byte backup)" — test-only.

### Claude's Discretion
- Exact code names, file splits and test placement within the above.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

REQUIREMENTS.md maps no IDs to Phase 212. The requirement set is ROADMAP `### Phase 212:` Success Criteria SC1–SC8.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC1 | A composite gated `sampled_gapped` / `fill_derived_unproven` renders `GATE_SERIES_EXAMINED_REFUSED`, not the provenance sentence | § SC1: one predicate export in `strategyGate.ts`, a 2-line branch in `SyncPreviewStep`, one moved pin + 3 new cases |
| SC2 | `MT5_GATEWAY_MISCONFIGURED_DETAIL` names no cause; founder approves copy; 161-UI-SPEC arm 3 moves with it | § SC2: sentence fence-checked by execution; exactly one byte pin moves (`_EXPECTED_GENERIC`) |
| SC3 | Validate-and-encrypt consumers render from `code`; a bare upstream 401/403 answers a named code | § SC3: TWO live consumers (not three); status-aware recogniser required (wire `RATE_LIMITED` is ambiguous); classifier gets a status branch; 3 callers |
| SC4 | MT5 connect during a running derive waits long enough or says it is busy and when to retry; sized from measurement | § SC4: premise false at HEAD (different lock); no measured p95; code-derived ceiling contradicts "a minute" but is NOT a number to ship: founder checkpoint |
| SC5 | Orphaned MT5 key refused before the 120 s validate where identity is known first | § SC5: MT5 credential arm of `create-with-key` only; two existing tests pin the opposite and must move |
| SC6 | Every remaining "contact support" pointer names a real next step | § SC6: census regenerated (13 + 2); one string is byte-tied to SQL (conflict with SC7); survivors outside the `src` census |
| SC7 | No migration | § SC6 conflict is the only place this binds |
| SC8 | Each fix has a test that goes RED when reverted | § Validation Architecture |
</phase_requirements>

## Summary

Phase 212 is copy-and-wiring truth work with no new packages, no migration and no new `WizardErrorCode` (so no `EXPECTED_TABLE_SIZE` pin moves). The research found four places where CONTEXT / UI-SPEC / TODOS premises are wrong or incomplete at HEAD; the planner must carry them into the plans and the orchestrator must put the first three to the founder:

1. **SC4 has no honest static retry number, and the premise changed.** A derive cannot make an interactive validate wait (different `terminal_key`, confirmed from code and by the existing routing pin). No p95 exists (`212-SC4-MEASUREMENT.md`). A code-derived ceiling for the *wizard* holders alone is about 5 minutes at defaults, the *worker* validate holder is bounded only by a 30-minute dispatch ceiling, and the owed-scrub refusal has no finite bound while a scrub keeps failing. So neither "a minute" nor any `{WAIT}` is a truthful guarantee. CONTEXT says stop and report, not invent. Recommendation: keep the bytes, add the structural pin, and make the copy change a founder checkpoint.
2. **SC6 row 8 (csv-finalize `ENQUEUE_LOST_RACE_USER_COPY`) is a deliberate byte-copy of the SQL `computation_error_copy` ELSE arm, and the WR-07 test uses the SQL as its oracle.** Changing the TS literal reds that test; changing the SQL needs a migration, which SC7 forbids. Also the SQL function's other arms (and five Python strings) still say "contact support" and sit outside the `src` census.
3. **SC3 has two live consumers, not three** (`ApiKeyManager` stopped calling the route in Phase 200), and the "translate through the seam map, then roster" recogniser would render a **false sentence** for a venue throttle: wire `RATE_LIMITED` means *our own limiter* at 429 but *the venue* at 424. The recogniser must take the HTTP status.
4. **SC5 reverses a documented Phase 161-05 decision** ("the credentials speak first"). Two existing tests pin the old order and must move; the code comment is corrected in the same change.

**Primary recommendation:** split into nine topic plans in three waves (§ Plan Split). Serialize every `src/lib/wizardErrors.ts` edit into one plan (SC3a) because no other SC needs it; give SC5 and SC3 separate test files for `create-with-key` so they never touch the same test file.

## Project Constraints (from CLAUDE.md)

Directives extracted from the repo `CLAUDE.md` / `AGENTS.md` and the user's global rules; the planner verifies compliance.

- **Cite by symbol, never line number.** Prose and plans re-anchor by symbol; `plan-anchor-verify` (CI job in `ci.yml`) re-resolves every `file:line` anchor and named symbol a pending PLAN.md asserts and fails loud on a miss.
- **Never write a CI skip trailer token** in any commit message or PR body, not even to deny it (CLAUDE.md § CI gate integrity 1).
- **Every ship writes a CHANGELOG entry** in the same commit as the `VERSION` bump (`chore(release): vX.Y.Z.B`), mechanism in CLAUDE.md § CHANGELOG discipline; `VERSION` and `package.json` stay byte-equal 4-digit strings; never `npm version`.
- **Ship deletes the `TODOS.md` entries it closes in the same PR and names them in the CHANGELOG** (CLAUDE.md § TODOS.md holds open work only). LOW/Info review survivors are not booked in `TODOS.md`.
- **A ship branch must change nothing under `.planning`** (the `-pr` filter; memory `ship-planning-guard`). The 161-UI-SPEC amendment and the `WINDOWS.md` update are `.planning` edits and ride planning-only commits, never the ship branch.
- **Verification frontmatter:** `verified_at_sha` + `drift_subjects`; never `covered_digest` / `covered_files`; `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` never in `drift_subjects`.
- **Proof standard:** neuter, observe RED, restore from a byte backup (never `git checkout` / `restore` / `stash` on uncommitted work). Always `grep -a`. pytest only from `analytics-service/`; never `importlib.reload` in tests. A new `supabase/tests` file moves censuses (n/a here: no SQL test is added).
- **Analytics-touching changes must pass CI's mypy strict** (`make typecheck` target path set: `services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`).
- **Next.js here is not the Next.js you know** (AGENTS.md): this phase touches no Next API surface beyond `route.ts` handler exports; keep non-handler exports out of `route.ts` files (a shared map must live in `src/lib`).
- **No AI authorship attribution** in commits (memory) even where a harness reminder suggests otherwise; **no emojis**; no home paths, secrets, PROD ids or account numbers in tracked text.
- **Design:** DESIGN.md is binding; this phase adds no new visual value (UI-SPEC approved, `Tool: none`).
- **Banned packages** (global CLAUDE.md): not relevant, no package is installed.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Composite verdict → code (SC1) | Browser/Client (`SyncPreviewStep`) | shared lib (`strategyGate.ts` predicate) | The verdict is read client-side from `strategy_analytics`; the discrimination must be the gate's own structure, exported once |
| MT5 cause-unknown sentence (SC2) | API/Backend (analytics-service `mt5_probe.py`) | docs (`161-UI-SPEC.md` contract) | Curated constant is Python-owned; no TS mirror exists (grep) |
| Code → copy on dashboard key forms (SC3) | Browser/Client (two forms) | shared lib (`wizardErrors.ts` recogniser) | The route already emits `code`; the client must read it. One recogniser, not two |
| Bare 401/403 → named code (SC3) | API/Backend (Next route handlers via shared classifier) | shared lib (`wizardErrors.ts` map) | Three routes classify through one function; the map must live where all three import it |
| Terminal-busy copy (SC4) | API/Backend (Python `closed_sets.py` carrier) + shared lib (TS twin) | — | Two static carriers must stay byte-equal |
| Orphan refusal timing (SC5) | API/Backend (`create-with-key` route) | — | Server decides before spending the 120 s seam call |
| Contact pointers (SC6) | Browser/Client for in-app strings; API/Backend for wire strings | `ContactPointerText` renderer | Wire strings are plain text; links only where the rendering host already uses the renderer |

## Standard Stack

### Core
No new libraries. Everything is in-repo.

| Library / module | Version | Purpose | Why standard |
|---|---|---|---|
| `src/lib/wizardErrors.ts` (`WIZARD_ERROR_COPY`, `formatKeyError`, `recogniseSeamErrorCode`, `recogniseDashboardDialogCode`, `classifyKeyValidationError`) | repo HEAD | code → copy table and recognisers | The one copy source (DESIGN-05) |
| `src/lib/envelope.ts` `buildEnvelope` + `src/components/error/ErrorEnvelope.tsx` | repo HEAD | uniform error rendering | DESIGN.md authoring rule: every error path calls `buildEnvelope` |
| `src/lib/correlation-id-client.ts` `newCorrelationId(prefix)` | repo HEAD | mint id before request, send as `X-Correlation-Id` | `RenameStrategyDialog` precedent |
| `src/components/contact/ContactPointerText.tsx` + `src/lib/contact.ts` `contactHref` | repo HEAD | link the first `contact form` phrase | 164.6.6.3.5 one-renderer rule |
| vitest (`npm test` = `vitest run`), pytest + mypy (CI venv, Python 3.12) | repo HEAD | proof | existing infrastructure |

### Supporting / Alternatives
None. Do not add shadcn (UI-SPEC `Tool: none`).

**Installation:** none. **Version verification:** not applicable, no package is installed or upgraded.

## Package Legitimacy Audit

No external package is added, removed or upgraded by this phase, so the legitimacy gate (`gsd-tools query package-legitimacy`) has nothing to check. | Package | Registry | Verdict | Disposition | = *none*. **Packages removed (SLOP):** none. **Flagged (SUS):** none.

## Architecture Patterns

### System Architecture Diagram

```
SC3 (dashboard key forms)
 StrategyForm / AllocatorExchangeManager
   │  newCorrelationId() -> X-Correlation-Id header
   ▼
 POST /api/keys/validate-and-encrypt  ──► withAuth ─► limiter ─► validateKey() ─► encryptKey() ─► INSERT api_keys
   │  !res.ok body: { code, error }  (4xx forward: wire seamCode or mapped; 5xx: static error + wire/UNKNOWN code)
   ▼
 recogniseValidateAndEncryptCode(body, res.status)   <-- ONE shared fn in wizardErrors.ts
   ├─ status !== 429 && code==="RATE_LIMITED" -> venue throttle -> KEY_RATE_LIMIT
   ├─ recogniseSeamErrorCode(seamErrorCode(body))     (alias table)
   ├─ KNOWN_VALIDATE_AND_ENCRYPT_CODES.has(code)      (roster, guarded cast)
   └─ else UNKNOWN  (+ "unrecognised" flag)
   ▼
 buildEnvelope(code, correlationId, ctx WITHOUT surface/venue wizard-only slots) -> <ErrorEnvelope/> in mt-4 wrapper, no onRetry
   unrecognised 4xx + curated string error -> UNKNOWN shell with the sentence as `cause`

SC3 bare 401/403 (create-with-key, composite/add-key, rotate-secret share the classifier)
 analytics middleware verify_service_key  ── bare {"detail":"Unauthorized"} 401, seamCode null
   ▼ AnalyticsUpstreamError(status 401, seamCode null)
 classifyKeyValidationError(err): seamCode string? ─no─► NEW: err.status ∈ UPSTREAM_STATUS_TO_SEAM_CODE ─► SEAM_MISCONFIGURED
                                                      └─ else existing cascade (unchanged) ─► UNKNOWN

SC5 (create-with-key credential arm, MT5 only)
 POST body -> guards -> session-fence -> resolveByVenueIdentity(mt5 login)
   draft -> deduped | connected -> VENUE_ALREADY_CONNECTED | NEW: orphaned -> 409 KEY_ORPHANED (before validateKey)
   held / unresolved / none -> falls through -> validateKey (<=120 s) -> RPC -> 23505 arm (ccxt venues, races) unchanged
```

### Recommended Project Structure (touch map only)

```
src/lib/strategyGate.ts                 # SC1: export isSeriesExaminedButRefused
src/lib/wizardErrors.ts                 # SC3a ONLY (+ SC4 copy edit if founder chooses): map, classifier branch, recogniser, docblocks
src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx           # SC1
src/app/api/strategies/create-with-key/route.ts                               # SC5 only
src/app/api/keys/validate-and-encrypt/route.ts                                # SC3a: import the map instead of declaring it
src/components/strategy/StrategyForm.tsx, src/components/exchanges/AllocatorExchangeManager.tsx, src/components/strategy/ApiKeyForm.tsx  # SC3b
analytics-service/services/mt5_probe.py (+ comment carriers)                 # SC2
analytics-service/tests/test_mt5_concurrency.py                              # SC4 pin
```

### Pattern 1: SC1 — discriminate through the gate's own structure
**What:** export a predicate from `strategyGate.ts` over the module-private `SERIES_EXAMINED_BUT_REFUSED` map and call it from the composite arm; map through `gateFailureToWizardError` so there is one gate-code→wizard-code table.
**Why this shape:** `[VERIFIED: src/lib/strategyGate.ts, SERIES_EXAMINED_BUT_REFUSED + checkStrategyGate]` the single-key arm discriminates by `!SERIES_EXAMINED_BUT_REFUSED.has(input.seriesCompleteness ?? "")` (→ `SERIES_PROVENANCE_UNVERIFIED`) and `SERIES_EXAMINED_BUT_REFUSED.get(input.seriesCompleteness ?? "")` (→ `SERIES_EXAMINED_REFUSED`), and `gateFailureToWizardError` maps those two gate codes to `GATE_SERIES_PROVENANCE_UNVERIFIED` / `GATE_SERIES_EXAMINED_REFUSED` (`src/lib/wizardErrors.ts`, `gateFailureToWizardError`).
```typescript
// src/lib/strategyGate.ts — beside isDailyReturnsSourced (same ?? "" coercion, same safe direction)
export function isSeriesExaminedButRefused(seriesCompleteness: string | null): boolean {
  return SERIES_EXAMINED_BUT_REFUSED.has(seriesCompleteness ?? "");
}
// SyncPreviewStep composite arm, replacing the two hardcoded literals (setErrorCode + the wizard_error telemetry `code`)
if (!compositeAdmissible) {
  const verdict = (analyticsRow?.series_completeness as string | null) ?? null;
  const code = gateFailureToWizardError(
    isSeriesExaminedButRefused(verdict) ? "SERIES_EXAMINED_REFUSED" : "SERIES_PROVENANCE_UNVERIFIED",
  );
  setErrorCode(code); setPhase("gate_failed");
  trackForQuantsEventClient("wizard_error", { wizard_session_id: wizardSessionId, step: "sync_preview", code, trade_count: 0 });
  return "done";
}
```
`gateFailureToWizardError` is already imported by the component (import block lists it). The telemetry `code` must equal the rendered code (UI-SPEC).
**Producer reality:** `[VERIFIED: analytics-service/services/job_worker.py, run_stitch_composite_job comment block]` the composite stitch propagates ONLY `sampled_gapped` (`_GAPPED_MEMBER_VERDICT = "sampled_gapped"`); `fill_derived_unproven` members do not downgrade the composite. So `fill_derived_unproven` on a composite is unreachable today; map it anyway (fail-closed drift, and UI-SPEC lists it) and test both.
**Interaction change (expected, per UI-SPEC):** `GATE_SERIES_EXAMINED_REFUSED` has `actions: ["try_another_key"]` and no `clear_and_retry`, so `kickoffRetryCanChangeTheOutcome` is false and the kickoff Retry disappears; `compositeReviewIsAvailable = isComposite && Boolean(onReviewKeys)` keeps "Review your keys". `[VERIFIED: WizardClient.tsx]` `onReviewKeys` is passed to `SyncPreviewStep` in the `step === "sync_preview"` render (a pure step transition, WIZ-03), so the composite always gets the non-destructive control in production; the test must pass `onReviewKeys` explicitly (the existing composite test asserts `wizard-try-another-key` is absent because its `baseProps` carries none; re-read `baseProps` before writing the new cases).

### Pattern 2: SC3 — one recogniser, status-aware
See § SC3 for the full contract. Shape (name is discretionary):
```typescript
// src/lib/wizardErrors.ts, beside recogniseDashboardDialogCode — NOT written twice in two components
export function recogniseValidateAndEncryptCode(
  body: unknown, status: number,
): { code: WizardErrorCode; recognised: boolean }
```

### Pattern 3: SC5 — refuse on `orphaned` inside the existing fence block
Add one `if (venueMatch.kind === "orphaned") return <the existing KEY_ORPHANED 409 body>` after the `connected` arm; extract the body into a small local constant/helper so the pre-validation arm and the 23505 arm cannot drift (the 23505 arm keeps its own `orphaned` branch for ccxt venues and races).

### Anti-Patterns to Avoid
- **A second hand-typed verdict list in the component** (UI-SPEC bans it; use the exported predicate).
- **`instanceof AnalyticsUpstreamError` in the classifier or routes.** Route suites mock `@/lib/analytics-client` wholesale, so the class is `undefined` there; read `status`/`seamCode` as own properties with `typeof` (the classifier already does for `seamCode`).
- **Merging the wire `RATE_LIMITED` meanings.** Two producers, two meanings (see § SC3).
- **Editing `KEY_ORPHANED` copy.** Phase 213 owns it (UI-SPEC SC5); byte-identical here.
- **Adding a `WizardErrorCode`.** Not needed; it would move `EXPECTED_TABLE_SIZE` at both pins plus rosters.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Composite verdict discrimination | a local `["sampled_gapped","fill_derived_unproven"]` array | `isSeriesExaminedButRefused` export | the map is the sentence's existence; a second list drifts (the file's own docblock) |
| Gate code → wizard code | a second switch in the component | `gateFailureToWizardError` | one table, already imported |
| Wire code → wizard code | `code as WizardErrorCode` | `recogniseSeamErrorCode` + guarded roster check (the single guarded cast) | attacker-influenced strings (Pitfall 4 in the file) |
| Seam code from a body | `body.code` only | `seamErrorCode(body)` from `@/lib/seam-discriminator` | handles the nested `service_error` shape |
| Correlation id | `crypto.randomUUID()` | `newCorrelationId("<surface>")` | guarded for non-secure origins |
| Contact link | a bare `<a href="/contact…">` | `ContactPointerText` + `contactHref` | the one encoder / `rel` / sr-only suffix |
| Byte-equal Python/TS copy proof | prose | tests that hand-type the literal on both sides | oracle-independence rule used throughout this repo |

**Key insight:** every defect in this phase is a *second copy* of something that already has one source (a verdict list, a status map, a sentence, a recogniser). The fix in each case is to point at the one source or, where two copies are deliberate, to pin them equal.

## Runtime State Inventory

Not a rename/refactor/migration phase (copy and wiring). **Stored data / live service config / OS-registered state / secrets / build artifacts:** None found for the phase's own change. One adjacent runtime fact worth recording because SC6 touches it: the SQL function `computation_error_copy` (applied to PROD/TEST by migration, mirrored in `supabase/schema/functions/computation_error_copy.sql` and `baseline.sql`) holds "contact support" sentences that are written into `strategy_analytics.computation_error` at runtime; they are NOT changeable without a migration (see § SC6).

## Common Pitfalls

### Pitfall 1: wire `RATE_LIMITED` renders the wrong sentence on the dashboard forms
**What goes wrong:** the recogniser translates `RATE_LIMITED` through `SEAM_CODE_TO_WIZARD_CODE` (→ `RATE_LIMITED`, "the cap is ours, not your exchange's"). But `/api/validate-key` answers a venue throttle as a flat 424 with wire `code: "RATE_LIMITED"` (`[VERIFIED: analytics-service/routers/exchange.py, VenueTransientHTTPException(status_code=424, code="RATE_LIMITED", …)]`), and the app-global limiter answers 429 with the same code (`[VERIFIED: analytics-service/main.py, JSONResponse(status_code=429, … "code": "RATE_LIMITED")]`). `VENUE_WIRE_CODE_TO_VERDICT` maps the same string to `KEY_RATE_LIMIT` (`[VERIFIED: wizardErrors.ts, ["RATE_LIMITED", { code: "KEY_RATE_LIMIT", status: 503 }]]`). The table's own docblock records "Telling them apart needs the upstream STATUS".
**Why it happens:** the wizard steps never see wire codes from this route's forward arm (their routes classify first); the dashboard forms do.
**How to avoid:** the recogniser takes `res.status`: 429 → alias (`RATE_LIMITED`); any other status with wire `RATE_LIMITED` → `VENUE_WIRE_CODE_TO_VERDICT.get("RATE_LIMITED")?.code` (typed, no cast). Test both. Amend the `KNOWN_VALIDATE_AND_ENCRYPT_CODES` docblock sentence that says `KEY_RATE_LIMIT` "MUST NOT be added" (it is about the roster; the recogniser returns it from the typed verdict table, so the roster is unchanged, but the docblock must say so).
**Warning signs:** a sweep row for `RATE_LIMITED` passes (429) while no row exercises 424.

### Pitfall 2: the persist-INSERT 500 would lose its true sentence
**What goes wrong:** UI-SPEC rule 5 says "a 5xx … render the UNKNOWN envelope". But the route's persist arm answers `{ code: "UNKNOWN", error: "Your key was verified but couldn't be saved. Please try again." }` at 500 (`[VERIFIED: validate-and-encrypt/route.ts, persist INSERT arm]`), and `StrategyForm.test.tsx` pins that exact sentence (`it("surfaces the route's curated persist-failure copy, not raw Postgres text (H-0405 class)")`). Rendering the generic UNKNOWN card would replace a specific, true sentence ("verified, not saved") with "we could not classify this failure".
**How to avoid:** apply the curated-sentence fallback to `code === "UNKNOWN"` (or unrecognised) + non-empty string `error` for the persist arm regardless of status; keep the generic UNKNOWN envelope only when `error` is absent or is the terminal arm's static "Key validation failed. Please try again." (still render that sentence as `cause` if present; it is true and generic). Decide explicitly in the plan; keep the existing StrategyForm test green (the sentence must still be findable by text).

### Pitfall 3: the shared status map has two source-text scanners and one TODOS pointer
**What goes wrong:** moving `UPSTREAM_STATUS_TO_SEAM_CODE` to `wizardErrors.ts` breaks `wizardErrors.invariant.test.ts` (`deriveStatusMap` reads `VE_ROUTE`'s source for `const UPSTREAM_STATUS_TO_SEAM_CODE`; its SELF-TEST byte-pins the declaration's opening line).
**How to avoid:** `export const UPSTREAM_STATUS_TO_SEAM_CODE: ReadonlyMap<number, string> = new Map<number, string>([` keeps `indexOf("const UPSTREAM_STATUS_TO_SEAM_CODE")` working; re-point `VE_ROUTE` to `UNION_SOURCE` in the `[164.2-05 / WIZFORM-02]` describe and keep `EXPECTED_STATUS_MAP` hand-typed. Pointers to update in the same change: `TODOS.md` `[164.2-SEAMCODE-UNION]` (cites the route file and the invariant-test line numbers), the map's docblock, `roster-render.test.tsx` comment, `validate-and-encrypt/route.test.ts` comment, and the `OUR_DEFECT_KEY_ERROR_CODES` docblock.

### Pitfall 4: the classifier's new branch changes more than the bare 401
**What goes wrong:** the map has four rows (401, 403 → `SEAM_MISCONFIGURED`; 422 → `VALIDATION_FAILED`; 429 → `RATE_LIMITED`). Consulting all four before the substring cascade changes today's answers: a 429 whose message contains `rate`/`429` currently answers `KEY_RATE_LIMIT`/503; a 422 whose message contains `signature` currently answers `KEY_INVALID_SIGNATURE`/400. Also `classifyKeyValidationError` has **three** callers, not two: `create-with-key`, `composite/add-key` and `keys/[id]/rotate-secret` (`[VERIFIED: grep over src/app/api]`), and rotate-secret's dialog roster (`DASHBOARD_DIALOG_ROUTE_CODES["keys/[id]/rotate-secret"]`) already includes `SEAM_MISCONFIGURED`.
**How to avoid (recommended, strictly additive):** consult the shared map **only for 401/403** (or consult all four but only at the cascade's terminal, i.e. replacing `return { code: "UNKNOWN", status: 500 }`), so only `UNKNOWN` verdicts can change. State this in the plan; the locked decision names only 401/403 → `SEAM_MISCONFIGURED`. Status to return: **500**, matching the three existing `SEAM_MISCONFIGURED` verdict rows (`EGRESS_PROXY_MISCONFIGURED`, `SERVICE_KEY_UNCONFIGURED`, `KEK_UNAVAILABLE` → `{ code: "SEAM_MISCONFIGURED", status: 500 }` `[VERIFIED: wizardErrors.ts]`). Do not echo 401 to the browser from these routes (`validate-and-encrypt` echoes `err.status` today; no client reads status for this code).
**Paging coupling (decision for the planner, recommended: record, do not change):** today a bare 401 answers `UNKNOWN`, which IS in `OUR_DEFECT_KEY_ERROR_CODES` and pages Sentry from the route. `SEAM_MISCONFIGURED` is NOT in that set (its docblock says it "never reaches this check on the key routes … add it the day a key route can answer it"). After this change a key route can answer it for a bare 401, and the Next-side page for a stale service key stops. The Python middleware already captures that fault (`_capture_secret_misconfig("mismatched", "SERVICE_KEY")` `[VERIFIED: analytics-service/main.py verify_service_key]`), and the classifier already returned `SEAM_MISCONFIGURED` for `KEK_UNAVAILABLE` and two other wire codes without paging, so recording it is consistent. If the founder wants the Next-side page back, add the code to the set in the same plan and move the two `[WR-06]` route-test twins.

### Pitfall 5: route-test shape for the upstream error
TODOS/CONTEXT say to test with `new AnalyticsUpstreamError("Unauthorized", 401)`. In `create-with-key/route.test.ts` the module is mocked (`vi.mock("@/lib/analytics-client", () => ({ validateKey, encryptKey }))`) so the class is `undefined`; existing cases build a plain object `{ name: "AnalyticsUpstreamError", status, seamCode, … }` thrown from the `validateKey` mock. Use that shape (own `status: 401`, `seamCode: null`). `[VERIFIED: create-with-key/route.test.ts, vi.mock factory + the `name: "AnalyticsUpstreamError"` cases]`.

### Pitfall 6: SC6 row 8 vs the SQL twin (see § SC6 Conflict)

### Pitfall 7: the no-email sweep needs allowlist entries for two touched files
`src/__tests__/no-email-in-copy.test.ts` arm 2 scans `USER_FACING_SOURCES` for email-shaped literals. Measured: `SignupForm.tsx` contains the placeholder `you@example.com`, and `admin/match/send-intro/route.ts` contains the comment text `local@host.tld`; adding either file to the list without a `SOURCE_ALLOWLIST` entry (exact file + literal + reason > 20 chars) reds. The other ten touched files measured 0 hits.

### Pitfall 8: the roster-render sweep's telemetry oracle is wizard-specific
Every row in `[164.2-09 / WIZFORM-02] every server-classified code renders as itself` ends with `expect(trackedWizardErrorCode()).toBe(row.expectedCode)`. The two dashboard forms emit no `wizard_error` telemetry (no `trackForQuantsEventClient` in either; `ErrorEnvelope` emits none). The fifth surface must therefore be exempt from that last oracle (branch on `row.surface`), with the DOM oracle (`data-error-code`, title text, no UNKNOWN card) carrying the proof. Do not add telemetry to the forms to satisfy the sweep (new behavior, out of scope).

### Pitfall 9: the orphan reversal needs both a code comment and two test moves (see § SC5)

### Pitfall 10: `.planning` edits and the ship guard
The 161-UI-SPEC arm-3 amendment and `.planning/WINDOWS.md` entry #12 (`D-161-05-B`, mark fixed with `gsd-tools windows fixed 12`) are `.planning` paths. Put them in a planning-only commit (or the records PR), never in the code ship branch.

## Code Examples

### SC3 recogniser (sketch; the planner finalises names)
```typescript
// Source: modelled on recogniseCreateWithKeyCode (ConnectKeyStep.tsx) + recogniseDashboardDialogCode (wizardErrors.ts)
export function recogniseValidateAndEncryptCode(body: unknown, status: number) {
  const wire = seamErrorCode(body as never) ?? (typeof (body as { code?: unknown })?.code === "string" ? (body as { code: string }).code : null);
  if (wire === "RATE_LIMITED" && status !== 429) {
    const venue = VENUE_WIRE_CODE_TO_VERDICT.get("RATE_LIMITED");
    if (venue) return { code: venue.code, recognised: true };            // KEY_RATE_LIMIT: the VENUE throttled us
  }
  const translated = recogniseSeamErrorCode(wire);                        // alias table first (same order as ConnectKeyStep)
  if (translated !== "UNKNOWN") return { code: translated, recognised: true };
  if (wire && KNOWN_VALIDATE_AND_ENCRYPT_CODES.has(wire as WizardErrorCode))
    return { code: wire as WizardErrorCode, recognised: true };           // guarded: membership proven first
  return { code: "UNKNOWN", recognised: false };
}
```
Render rules, per UI-SPEC SC3: `ctx` carries no `surface` and no `venue` wizard-only slots (so `REQUIRES_CONNECT_SURFACE` bullets such as "Your draft is saved." are suppressed); no `onRetry`; mint `newCorrelationId("key-validate")` before the request and send it as `X-Correlation-Id` (`getCorrelationId()` in the route reads it); unparseable body logs `status`/`statusText` only (the `ConnectKeyStep` A-6 sentinel pattern) and renders the `UNKNOWN` envelope. Unrecognised + non-empty string `error` → `{ ...buildEnvelope("UNKNOWN", cid), cause: error }` inside `<ErrorEnvelope>` (`ErrorEnvelope` is a plain object contract: `{ ok, code, human_message, cause, debug_context, correlation_id, recoverable, retry_after_seconds }` `[VERIFIED: envelope.ts buildEnvelope]`).

### SC4 structural pin (pytest, `tests/test_mt5_concurrency.py`)
```python
# Shape only. Read the real signatures: mt5_terminal_lease(terminal_key, *, wait_s=None, holder=None, site=None);
# holders/sites: HOLDER_VALIDATION (mt5_client), SITE_DERIVE / SITE_VALIDATE_WIZARD (mt5_handover).
# 1. env: job pair A, validation pair B (both private hosts: is_private_gateway_host refuses others).
# 2. keys differ:  mt5_terminal_key(*read_env_gateway_endpoint()) != mt5_terminal_key(*read_env_validation_gateway_endpoint())
# 3. behavioural: hold the JOB key's lease (site=SITE_DERIVE); `async with mt5_terminal_lease(validation_key, wait_s=0.05, ...)` acquires with no Mt5TerminalBusyError.
# 4. RED control, same test: set the validation env EQUAL to the job pair -> the same acquisition raises Mt5TerminalBusyError.
```
Assertion 4 documents the honest limit (below).

## State of the Art

| Old approach | Current approach | When | Impact |
|---|---|---|---|
| A derive holds the terminal an interactive validate waits on (TODOS 0.51: "20 s against a 40 s derive read plus a 10 s restart") | Validate leases the VALIDATION terminal key; derive/allocator/sync/equity_backfill lease the JOB terminal key | Phase 164.6.6 D-02/D-05 | SC4's stated premise is false at HEAD |
| Orphan refused only after validate ("credentials speak first", 161-05) | Refuse first where the identity is in the request | this phase (SC5) | Supersedes a documented 161-05 decision |
| Dashboard forms render `err.error` prose | Render from `code` through `buildEnvelope` | this phase (SC3) | Closes `[WIZFORM-02-VE-CODECHANNEL]` and WIZFORM-02 (0.013) |

**Deprecated/outdated:** the `KNOWN_VALIDATE_AND_ENCRYPT_CODES` docblock's "Three components POST … (`ApiKeyManager`, …)" and the `roster-render.test.tsx` header's "THREE consumers / FIVE surfaces" prose; the `[164.2-09]` "fifth surface is excluded" describe (replace, do not silently delete).

## SC-by-SC Findings

### SC1 — composite arm (the 142.2 pin and the render test)
- **Pin that moves:** `[VERIFIED: SyncPreviewStep.composite.render.test.tsx, it("REFUSES a composite carrying a verdict the gate does not trust")]` currently asserts `data-error-code` is `"GATE_SERIES_PROVENANCE_UNVERIFIED"` for `series_completeness: "sampled_gapped"`. Change it to `GATE_SERIES_EXAMINED_REFUSED`, and rename it (its title says "a verdict the gate does not trust").
- **Cases that must not move (negative controls):** the `null` case (`"REFUSES a composite whose stitch never stamped a verdict…"`) and the EVALUATION-ORDER case in `[161-07 / WIZERR-09]` (6 days AND `series_completeness: null` → still `GATE_SERIES_PROVENANCE_UNVERIFIED`; an inadmissible verdict is answered before the 7-day floor). The healthy `composite_stitched` case stays green.
- **New cases:** `fill_derived_unproven` → `EXAMINED_REFUSED`; an unknown value (hand-typed `"some_future_verdict"`) → `PROVENANCE_UNVERIFIED` (fail-closed drift direction); for the two examined verdicts also assert (a) the `wizard_error` telemetry `code` equals the rendered code, (b) the kickoff Retry control is absent, (c) with `onReviewKeys` passed, the "Review your keys" control (`data-testid="wizard-try-another-key"`, label "Review your keys") is present and calls `onReviewKeys`, never `onTryAnotherKey`; for the unknown/null verdict assert Retry is present (`clear_and_retry`).
- **Gate unit test:** `strategyGate.test.ts` gains `isSeriesExaminedButRefused` cases (both members true; `null`, `""`, `"complete"`/`"ledger_complete"`, unknown false). `strategyGate.invariant.test.ts` does not pin the export count (it checks `checkStrategyGate` and `isDailyReturnsSourced` are present and the allow-list is exactly three), so a new export is safe.
- **Other `GATE_SERIES_PROVENANCE_UNVERIFIED` hits** (`SyncPreviewStep.render.test.tsx` distinct-code floors, `.own04-link.test.tsx` comment, `.stale-refusal.runtime.test.tsx` const) are the single-key arm or comments: no edit. The render-sweep floors (`driven >= 15`, `observed.size >= 14`) are lower bounds on the single-key arm and do not move.
- **Truth check the executor must record (UI-SPEC):** `GATE_SERIES_EXAMINED_REFUSED.fix` = "Connect a Deribit key instead — Deribit gives us the venue's full transaction ledger rather than a fill feed, so the record behind the series is whole." and "Or create this strategy from a CSV upload instead: a track record you supply yourself carries its own completeness record, which we do accept." `[VERIFIED: wizardErrors.ts GATE_SERIES_EXAMINED_REFUSED]`. On the composite surface: a Deribit key is a legal composite member (`composite/add-key` accepts any `isSupportedExchange` venue; `[VERIFIED: add-key/route.ts]`), and CSV upload is a real alternative path from the wizard's first step, so both bullets read true as "instead". Default: no copy change and therefore no `wizardErrors.ts` edit from SC1. If the executor judges a bullet false on the composite, gating needs a new `WizardSurface` member (`"connect" | "preselect" | "submit" | "csv" | "allocate"` today) plus a `requirementMet` arm — that is a `wizardErrors.ts` edit and must be re-routed into the SC3a plan, not made in the SC1 plan.

### SC2 — MT5 cause-unknown sentence
- **Fence evidence (executed this session, worktree code via the main checkout's Python 3.12 venv, read-only):** the founder sentence has length **159**; `classify_mt5_login_error(Mt5ClientError(0, text))` returned **`transient`**; none of `password`, `investor`, `master`, `secret` appears; no member of `_AUTH_PHRASES` or `_WRONG_SERVER_PHRASES` is a substring. `[VERIFIED: executed against analytics-service/services/mt5_validation.py + test_mt5_validate_parity.py::test_every_builder_emittable_constant_is_curated_and_credential_free's checks]`. This is evidence, not a substitute for the test run. The sentence also contains "needs an operator, not a retry" and "mt5-go-live.md", which the arm-1 and worker tests assert for other arms, and none of the flag tokens (`tradeapi_disabled`, `trade_allowed`, `terminal_info`) the parity sweep rejects.
- **The constant** `[VERIFIED: analytics-service/services/mt5_probe.py, MT5_GATEWAY_MISCONFIGURED_DETAIL]` today reads "MT5 gateway refuses automated trading (the 'Disable automatic trading through the external Python API' option is in force), so read-only capability cannot be proven. This needs an operator, not a retry — see docs/runbooks/mt5-go-live.md." It is also `MT5_GATEWAY_MISCONFIGURED_DETAILS[0]`, the `mt5_gateway_misconfigured_detail(None|{}|no-cause)` return, `curated_gateway_detail`'s degradation target, and `Mt5GatewayMisconfigured.__init__`'s default. Arms 1/2 (`MT5_GATEWAY_TRADE_PERMISSION_OFF_DETAIL`, `MT5_GATEWAY_EXTERNAL_API_BLOCKED_DETAIL`) are unchanged; arm 1 at HEAD no longer says the gateway "switches it off again" (164.6.5-06).
- **Pins that move — exactly one byte pin:** `[VERIFIED: tests/test_mt5_validate_parity.py, _EXPECTED_GENERIC]` is the hand-typed copy of the old sentence, used by the parametrised arm-selection cases (five `_EXPECTED_GENERIC` rows), `test_worker_sink_lets_a_curated_cause_through_but_never_raw_remote_text`, and the anchor in `test_the_exception_docstring_names_the_sink_the_worker_actually_calls`. Re-type it as the founder sentence (hand-typed, never imported). Pins that import the constant stay self-consistent and need no edit: `test_job_worker.py::test_mt5_gateway_misconfigured_is_permanent_with_curated_message` (`msg == MT5_GATEWAY_MISCONFIGURED_DETAIL`), `test_ingestion_mt5.py` (`msg in MT5_GATEWAY_MISCONFIGURED_DETAILS`), and the family-size/distinct/default-argument pins (`len == 3`, `len(set) == 3`, `str(Mt5GatewayMisconfigured()) == MT5_GATEWAY_MISCONFIGURED_DETAIL`). No TS file mirrors the sentence (`[VERIFIED: grep over src/, docs/, e2e/ for the old lead and parenthetical: only TODOS.md, planning archives and the Python files below]`).
- **Comment carriers (read and classify each; no blanket replace — arm 2 legitimately carries the parenthetical):**
  - Rewrite (they state arm 3's meaning): the `#:` docblock above `MT5_GATEWAY_MISCONFIGURED_DETAIL` in `mt5_probe.py` (says the sentence "names a SPECIFIC option, so it is only truthful where a cause is genuinely unknown … re-wording it to a cause-free fallback is a copy decision for the phase owner") and the `Mt5GatewayMisconfigured` class docstring lead ("Operator fault: the gateway refuses automated trading, so an investor password cannot be distinguished…") if the executor judges it arm-3-specific.
  - Likely keep (describe the fault family or arm 2 correctly): `job_worker.py` `classify_exception` comment ("The MT5 gateway terminal refuses automated trading …", 153.6/A3), `tests/test_job_worker.py` docstring ("a terminal that refuses automated trading" describes pre-153.6 behavior), `tests/test_mt5_validate_parity.py` `test_order_check_short_circuit…` docstring, and the parenthetical hits in `mt5_validation.py`, `mt5_client.py`, `ingestion/mt5.py`, `routers/exchange.py`, `docs/runbooks/mt5-go-live.md` (arm 2 / the option itself).
- **Contract amendment (a `.planning` edit):** in `161-UI-SPEC.md` § Copy Spec → WIZERR-01, arm 3 ("**Flags absent/ambiguous:** today's generic constant, unchanged (honest fallback — never guess a cause).") becomes the founder sentence plus a dated note citing Phase 212 and the founder's 2026-11-14 approval. Edit nothing else in that file. `161-RESEARCH.md`, `161-02-SUMMARY.md` and the 153.6 planning files quote the old text as history: leave them.
- **TODOS:** delete entry `0.09` in the closing plan.

### SC3 — validate-and-encrypt consumers and the bare 401/403

**Consumer census (re-measured):** `[VERIFIED: grep for the route string over src/ and e2e/]` exactly two browser `fetch("/api/keys/validate-and-encrypt")` callers: `StrategyForm.tsx` (`handleApiKeySubmit`) and `AllocatorExchangeManager.tsx` (`handleAddKey`). `ApiKeyManager.tsx` has no hit for the route string. `e2e/api-key-flow.spec.ts` and `e2e/onboarding-funnel.spec.ts` hit the route directly (not render consumers). `roster-render.test.tsx`'s own `derivePosters` derives the same two and pins `toBe(2)`, with the comment "2 since Phase 200 plan 08 moved ApiKeyManager's Add Key to the Profile tab". So UI-SPEC's correction holds: SC3 covers two live consumers; correct the `KNOWN_VALIDATE_AND_ENCRYPT_CODES` docblock ("Three components …") in the same change; never invent a third.

**Where each error renders today:** `StrategyForm`: `throw new Error(err.error || "Key validation failed")` → `apiError` → `<p className="text-sm text-negative">` inside the connect-key modal. `AllocatorExchangeManager`: `setFormError(result.error ?? "Validation failed")` → `ApiKeyForm`'s `error` prop → `{error && <p className="text-sm text-negative mt-3">{error}</p>}`; `ApiKeyForm` has one caller (`AllocatorExchangeManager`). Note `AllocatorExchangeManager` does `await response.json()` unguarded: a non-JSON body throws into the outer catch and shows `err.message` ("Unexpected token…" style text). The A-6-style guarded parse closes that too and is in scope of "unparseable body" (UI-SPEC rule 5).

**What the route emits (census for the recogniser).**
- Route-literal `code:` values `[VERIFIED: validate-and-encrypt/route.ts]`: `KEY_MISSING_REQUIRED_FIELD`, `KEY_VENUE_NOT_ENABLED`, `STALE_CLIENT`, `RATE_LIMITED` (own limiter, 429), `SEAM_MISCONFIGURED` (503, two sites), `KEY_NOT_READ_ONLY`, `KEY_VENUE_ALREADY_CONNECTED`, `UNKNOWN` (persist-INSERT 500 with curated sentence), `CIRCUIT_OPEN` (503, alias → `SERVICE_UNAVAILABLE_RETRY`), `UPSTREAM_TIMEOUT` (504, alias → `SERVICE_UNREACHABLE`).
- Computed channel, 4xx forward arm: `code: err.seamCode ?? mappedCode ?? "UNKNOWN"` where `mappedCode` (status map: 401/403 → `SEAM_MISCONFIGURED`, 422 → `VALIDATION_FAILED`, 429 → `RATE_LIMITED`) is computed only when `seamCode` is absent, and in that case `error` is replaced by `WIZARD_ERROR_COPY[recogniseSeamErrorCode(mappedCode)].title`. With a seamCode present, `error` is the upstream's curated 4xx detail and `code` is the raw wire code.
- Computed channel, terminal arm: `code: seamCode ?? "UNKNOWN"` with static `error: "Key validation failed. Please try again."` at 500.
- Roster today `[VERIFIED: wizardErrors.ts KNOWN_VALIDATE_AND_ENCRYPT_CODES]`: `KEY_MISSING_REQUIRED_FIELD`, `KEY_VENUE_NOT_ENABLED`, `KEY_NOT_READ_ONLY`, `STALE_CLIENT`, `SEAM_MISCONFIGURED`, `RATE_LIMITED`, `KEY_VENUE_ALREADY_CONNECTED`, `UNKNOWN`.
- **Forwarded wire codes (the planner's measured disposition list).** A forwarded 4xx carries a wire code from the `/api/validate-key` family. Every key of `VENUE_WIRE_CODE_TO_VERDICT` is a candidate: `RATE_LIMITED`, `PROBE_FAILED`, `AUTH_FAILED`, `EXCHANGE_UNAVAILABLE`, `NETWORK_UNAVAILABLE`, `DDOS_PROTECTION`, `MISSING_SCOPE`, `PERMISSION_DENIED`, `WITHDRAW_SCOPE`, `TRADE_SCOPE`, `MT5_GATEWAY_UNCONFIGURED`, `MT5_GATEWAY_UNREACHABLE`, `MT5_TERMINAL_UNRESPONSIVE`, `EGRESS_PROXY_MISCONFIGURED`, `SERVICE_KEY_UNCONFIGURED`, `KEK_UNAVAILABLE`, `EXCHANGE_PROBE_FAILED`, `ADAPTER_INIT_FAILED`, `INTERNAL`, `MT5_VALIDATE_INVARIANT_VIOLATION`, `KEY_UNDECRYPTABLE`, `SIGN_IN_FAILED`, `MT5_SERVER_UNKNOWN`, `MT5_VALIDATION_UNCONFIGURED`, `MT5_TERMINAL_BUSY`. `[VERIFIED: wizardErrors.ts, the VENUE_WIRE_CODE_TO_VERDICT map literal]`. Which of them arrive at **<500** (the 4xx forward) versus **>=500** (the terminal arm) is partly unmeasured by me: read directly are the venue-transient family (`VenueTransientHTTPException` is a 4xx-only class by its `__init__` guard, with 424 at the seven sites; `RATE_LIMITED`, `SIGN_IN_FAILED`, `MT5_SERVER_UNKNOWN`, `MT5_TERMINAL_BUSY` are stated 424 in the table comments), the rest `[ASSUMED]`. **Method for the plan:** derive the population from the Python emitters the way `seam-venue-vocabulary.invariant.test.ts` does (it already derives the emitted-code population from the real Python sources and requires a disposition per code), then give each code one disposition: (a) recognised on these surfaces with a `WIZARD_ERROR_COPY` entry that is true there, (b) recorded as rendered via the curated-sentence fallback, or (c) recorded as a finding.
- **Recommended disposition rule (keeps scope inside the locked decision):** the recogniser reads alias → roster only (identical to `recogniseCreateWithKeyCode`), plus the one status-aware `RATE_LIMITED` split above. Forwarded 4xx wire codes outside that set (`AUTH_FAILED`, `MISSING_SCOPE`, `SIGN_IN_FAILED`, …) take the UI-SPEC rule-5 branch: the `UNKNOWN` shell with the route's curated sentence as `cause`. That is true on both surfaces and avoids consulting `VENUE_WIRE_CODE_TO_VERDICT` for 5xx codes, which the roster docblock warns is the WIZERR-06 W1 hazard (a recognised code arriving on a 5xx carrying a remedy authored for a 4xx arm). Mapping the common 4xx venue codes (`AUTH_FAILED` → `KEY_AUTH_FAILED` etc.) to their richer copy is a worthwhile follow-up but needs the per-code truth audit below; do not fold it in by default.
- **Truth audit (UI-SPEC):** read each recognised code's `title`/`cause`/`fix` as the StrategyForm modal and the allocator Add-key form would show it, with `ctx` lacking `surface`. Gated bullets are suppressed when no surface is named (`surface` kind: absent ⇒ suppressed); `surfaceIsNot` bullets render on absent surface. Specific hazards found: `KEY_MT5_TERMINAL_BUSY.fix[2]` ("Your draft is saved.") is gated on `REQUIRES_CONNECT_SURFACE` (suppressed here, correct); `GATE_*`/`KEY_ORPHANED` are not emitted by this route; `STALE_CLIENT` and `KEY_VENUE_ALREADY_CONNECTED` bullets must be read against "no draft, no strategy" on these forms.
- **Curated 4xx sentences that still say "Contact support":** Python strings forwarded as the `error` sentence include `VALIDATION_UNEXPECTED` ("Key validation failed unexpectedly. Contact support if this persists.", `analytics-service/services/exchange.py`). If rendered as `cause` it is plain text with no link. These Python strings are outside the SC6 `src` census; record as a survivor (see § SC6).

**Roster-render sweep (`src/lib/wizardErrors.roster-render.test.tsx`):**
- `SURFACES` has four entries (`connect-key`, `multi-key-add`, `multi-key-set-members`, `csv-submit`); `EXPECTED_POPULATION_MIN = 78` at HEAD (typed from 82 measured at authoring). The population is the union of (a) seam-map keys on surfaces that consult the alias table, (b) the surface's roster read by `deriveRoster(source, name)` (finds `const <name>` and the first `([ … ])`), (c) the route's `code:` literals (`deriveCodeLiterals`). For the fifth surface use `rosterFile` = `src/lib/wizardErrors.ts`, `rosterName` = `KNOWN_VALIDATE_AND_ENCRYPT_CODES`, `routeFile` = the validate-and-encrypt route, `consultsSeamMap: true`, new hand-typed floors measured on the new population, and **recompute `EXPECTED_POPULATION_MIN` from a fresh measurement** (never `POPULATION.length`; add the new surface's population to the 82, floor a few under; the code also derives `copyRows.length >= EXPECTED_POPULATION_MIN - 6`, which moves with it). Do not restate the old 78 in prose.
- The `HARNESS` needs a fifth entry that drives a real component through its real fetch to the real error render. The cheapest honest harness is `StrategyForm` (the connect-key modal); add a second row set for `AllocatorExchangeManager` if the population is to prove both consumers read `code` (recommended: a small dedicated pair of cases per consumer plus the sweep over one).
- **The `[164.2-09] the FIFTH surface is excluded` describe is replaced, not deleted silently.** Its two cases (`CONSUMERS` pin via `codeChannelReads`, `derivePosters` pins `toBe(2)`) invert: assert each consumer now reads `code` (the live assertion that goes RED if a consumer stops), keep the census case (still two posters). Also update the header prose that says four surfaces / THREE consumers / `theFifthSurface`.
- `164.2-09-SUMMARY.md` § `## Surfaces not rendered` is a historical artifact: do not edit it; the gate comment in the test is the live pointer.
- Named extra cases (not population rows, because the population oracle `mustRenderAs` is alias-or-identity and surface-agnostic): the venue-throttle row (424 + wire `RATE_LIMITED` renders `KEY_RATE_LIMIT`), the bare-401 PROD row on the fifth surface (`{ error: "Unauthorized", code: "SEAM_MISCONFIGURED" }`-style: assert the envelope, `data-error-code="SEAM_MISCONFIGURED"`, no Retry control), the persist-failure curated sentence, an unparseable body, and the 4xx curated-sentence fallback.

**Bare 401/403:**
- **Where the map lives:** `UPSTREAM_STATUS_TO_SEAM_CODE` is route-private in `validate-and-encrypt/route.ts` (`ReadonlyMap<number,string>` with 401/403/422/429). A Next `route.ts` must not export it, so move it to `src/lib/wizardErrors.ts` (exported, same declaration text) and import it in the route (the route's `mappedCode` expression and its docblock move with it).
- **Classifier branch:** in `classifyKeyValidationError`, after the `seamCode` string block and `seamTransportCode` block and before the message cascade, add: if `typeof (error as {status?: unknown}).status === "number"` and the map has it (restricted to 401/403 per Pitfall 4) → `{ code: recogniseSeamErrorCode(mapped), status: 500 }`. Read `status` as an own property with `typeof`, never `instanceof`.
- **Truth check (UI-SPEC, executed):** the 401 originates in `verify_service_key` middleware (`return JSONResponse({"detail": "Unauthorized"}, status_code=401)` and the `SERVICE_KEY_ABSENT` coded variant) which returns **before** `call_next`, so no handler, no venue I/O, no row write has occurred: "The request never left our servers" holds for the 401 `[VERIFIED: analytics-service/main.py, verify_service_key]`. For a bare 403 the analytics service's 403 emitters are internal-token gates (`routers/internal.py`, `routers/process_key.py`) and `routers/exchange.py`'s `/fetch-trades` owner check ("API key does not belong to strategy owner"); the last is on `/fetch-trades`, not on the key-validation path these routes call. So a bare 403 on the three key routes is a gate-level refusal; `[ASSUMED]` that no 403 on `/api/validate-key` or `/encrypt-key` carries a venue-side meaning. Record this as a finding, as UI-SPEC asks, without overriding the locked mapping.
- **Callers and tests:** three callers (`create-with-key`, `composite/add-key`, `keys/[id]/rotate-secret`). Add route tests on both locked twins and one on rotate-secret. Because `create-with-key/route.test.ts` is owned by SC5, put the SC3 bare-401 case for `create-with-key` in a **new file** (for example `route.bare-401.test.ts` beside it), reusing the same `vi.mock` factory shape; `composite/add-key/route.test.ts` is SC3-only and can be edited. Also add unit cases to `wizardErrors.test.ts` for the classifier branch (401, 403 → `SEAM_MISCONFIGURED`/500; 400 stays through the cascade; a 429 with `rate` in the message still answers `KEY_RATE_LIMIT`; a 401 carrying a string `seamCode` still uses the verdict table first).
- **Invariant-test moves:** re-point the `[164.2-05 / WIZFORM-02]` describe's `VE_ROUTE` to `UNION_SOURCE`; keep `EXPECTED_STATUS_MAP` hand-typed and unchanged; keep the "every value is a key of `SEAM_CODE_TO_WIZARD_CODE`" and "has copy AND is a union member" cases. `validate-and-encrypt/route.test.ts` (the 401/403/422/429 route cases around the comment citing `UPSTREAM_STATUS_TO_SEAM_CODE`) stays green unchanged if the route's behavior is unchanged.

### SC4 — MT5 connect during a running derive

**Premise, confirmed from code at HEAD.** `[VERIFIED: analytics-service/services/mt5_relogin.py, read_env_validation_gateway_endpoint docstring]` "Phase 164.6.6 D-02: a key validation leases the validation terminal's `terminal_key`, never the job terminal's … The routing pin in `tests/test_mt5_concurrency.py` reds if any other production function calls this reader." `[VERIFIED: tests/test_mt5_concurrency.py, _VALIDATE_SITES + test_only_the_validate_sites_read_the_validation_endpoint]` the pin names exactly `("routers/exchange.py", "_validate_mt5_key_probe")` and `("services/ingestion/mt5.py", "validate")`, with two mark-only/liveness readers allowed separately. So a derive (job terminal key) cannot make a wizard validate (validation key) wait.

**Measurements are the orchestrator's, not mine:** `[CITED: 212-SC4-MEASUREMENT.md]` no `mt5.stage` / `duration_ms` / `lease_wait` entries are retrievable; two `mt5_terminal_lease` waits of 16.2 s and 18.3 s exist, both under the 20 s bound; no p95. I took no PROD measurement and do not restate PROD figures as mine.

**What the validation terminal can be held by (code-derived, at code defaults).** Defaults executed against the worktree code: `_MT5_LEASE_WAIT_S` 20.0, `_MT5_RESTART_TIMEOUT_S` 10.0, `_MT5_VALIDATE_DEADLINE_S` 75.0, `_MT5_RELEASE_TIMEOUT_S` 10.0, `_VALIDATION_SCRUB_BUDGET_S` 160.0, `_SCRUB_PROBE_WAIT_S` 60.0, `SCRUB_RELAUNCH_RESERVE_CROSSINGS` 5 `[VERIFIED: executed import of services.mt5_terminal_scrub / mt5_concurrency / routers.exchange / mt5_relogin]`. Railway env overrides (`MT5_LEASE_WAIT_S`, `MT5_VALIDATE_DEADLINE_S`, `MT5_REQUEST_TIMEOUT_S`, `MT5_VALIDATE_REQUEST_TIMEOUT_S`, …) are unknown to me, so every figure below is "at code defaults".
- **Wizard validation (`validate_wizard`):** lease held ≤ `_MT5_VALIDATE_DEADLINE_S` + `_MT5_RELEASE_TIMEOUT_S` = 75 + 10 = 85 s (the file's own header: "Server worst case = 75 + 10 = 85s"; the acquisition wait sits outside the deadline).
- **Its post-verdict scrub (`terminal_scrub`):** its OWN lease with `wait_s=None` (`scrub_validation_terminal`), bounded inside by `_wait_for_unfinished_probes` (≤ `_SCRUB_PROBE_WAIT_S` = 60 s) then `_VALIDATION_SCRUB_BUDGET_S` (≤ 160 s; module note "5 x 30 s + 10 s = 160 s at the defaults"), so ≤ 220 s. It runs after the response, so no request budget covers it.
- **Worker validation (`validate_worker`, `services/ingestion/mt5.py`):** `wait_s=None` and it pays an owed scrub **inline** under the lease it holds; it is bounded only by the long-fetch dispatch ceiling, `TIMEOUT_PER_KIND["process_key_long"] = 30 * 60` `[VERIFIED: job_worker.py TIMEOUT_PER_KIND]` (the module's own comment: "the outer per-kind dispatch ceiling is what stops a genuinely wedged queue"). So the worst by-construction holder is 30 minutes.
- **Session monitor / liveness probe:** lease with a 2.0 s default wait (`_MT5_RELOGIN_LEASE_WAIT_DEFAULT_S`) and short credential-free reads; not the long pole.
- **Owed-scrub emitter:** `routers/exchange.py` refuses with the recoverable 424 whenever `mt5_scrub_owed(key) or mt5_relaunch_debt(key)` and schedules the scrub. The code comment states "while the scrub keeps failing (the house credential unset or wrong, the terminal unreachable), EVERY wizard validation is refused here". So this emitter has **no finite bound** when a scrub fails.
- **Held-lease emitter:** refuses after the 20 s `wait_s`; the terminal is then free only after the holder (≤ 85 s, or its scrub ≤ 220 s, or a worker validate ≤ 30 min) finishes.

**Consistency of "Try again in a minute" with the ceiling (the question asked):** it is **not** a by-construction truth. Wizard-only holders give a ceiling of roughly 85 + 220 − 20 = 285 s (about 5 minutes) for the held-lease case and 220 s (about 4 minutes) for the owed-scrub case; the worker holder gives 30 minutes; the failing-scrub case is unbounded; and queued validations from other users can chain. It is *consistent with typical* behavior only by the unmeasured observations (waits of 16–18 s; validations 13–29 s apart in `cron_runs`, `[CITED: 212-SC4-MEASUREMENT.md]`). Both static carriers (Python `MT5_TERMINAL_BUSY_DETAIL` in `closed_sets.py`; TS `KEY_MT5_TERMINAL_BUSY` `title` "Our MetaTrader terminal is briefly busy." and `fix[0]` "Try again in a minute.") are true at **both** emitters only as a vague hope.
- **Do not choose a number.** UI-SPEC's `{WAIT}` rule (`N = ceil(R/60)`) would print "5 minutes" from a ceiling that is neither a measurement (CONTEXT: "stop and report rather than invent") nor a guarantee (chained validations, 30-minute worker holder, failing scrub), and would mislead users in the typical seconds-long case. **Recommendation:** keep the 20 s bound and the refusal; keep both carriers byte-identical; ship the structural pin below; and put a founder checkpoint (`checkpoint:decision`) in the plan with the three options (keep "a minute"; ceiling-derived "5 minutes"; remove the number: "Try again shortly" — which UI-SPEC forbids as an adjective-for-a-number unless the founder lifts it). The copy-edit task is conditional on that answer and lives in Wave 3 (it touches `wizardErrors.ts`).
- **If the founder picks a number:** carrier pins that move: `EXPECTED_MT5_TERMINAL_BUSY_DETAIL` in `tests/test_validate_key_venue_transient.py`, the fixture literal in `src/app/api/keys/[id]/rotate-secret/route.test.ts`, the `wizardErrors.test.ts` busy-copy pin, and the Python/TS byte-equality test; fences on the Python carrier stay (`test_mt5_server_known.py::test_terminal_busy_detail_collides_with_no_cascade_needle` and the module note's banned words "terminal", "lease", "queue", "lock", "timeout", "rate", "probe", "trading", "withdraw").
- **Do not raise `_MT5_LEASE_WAIT_S`.** Raising it toward 75–285 s would push the interactive validate past the 120 s client budget (D-26: 20 s + 85 s = 105 s today with 15 s margin) — `[VERIFIED: routers/exchange.py header: "inside D-26's 120 000ms client ceiling with 15s of margin"]`.

**The structural pin (the orchestrator's default, with its honest limit).** `[VERIFIED: grep for an equality guard in read_env_validation_gateway_endpoint / main.py came back empty]` nothing refuses `MT5_VALIDATION_GATEWAY_*` equal to `MT5_GATEWAY_*`. So "validate and derive never share a lock" is a **configuration fact plus a reader-routing fact**, not a code invariant. The existing routing pin proves *who reads which endpoint* lexically. Add a behavioral pin (sketch in § Code Examples) that: (1) with distinct job/validation env pairs the two `terminal_key`s differ; (2) a lease held on the job key does not delay a validation-key acquisition at `wait_s=0.05`; (3) as a RED control, with the pairs set equal the validation acquisition raises `Mt5TerminalBusyError`. The test documents, rather than hides, the config dependence. Also record as a finding (not a fix): a deploy that sets the two pairs equal silently re-creates SC4's original premise; an equality refusal in `read_env_validation_gateway_endpoint` would be a behavior change outside this phase.

### SC5 — orphaned MT5 key refused before the 120 s validate
- **Where identity is known first:** `[VERIFIED: create-with-key/route.ts, `let venueAccountId: string | null = isMt5 ? api_key.trim() : null;` + the `if (venueAccountId) { const venueMatch = await resolveByVenueIdentity(...)` block]` the MT5 login is the request's `api_key`, so the credential arm resolves it before `validateKey`. That block already short-circuits `draft` (→ `deduped`) and `connected` (→ `venueAlreadyConnectedResponse`) and, for `held` and `orphaned`, deliberately falls through; the in-code comment records the 161-05 reasoning ("the credentials speak first") and the cost ("an orphaned MT5 user waits out a full validation").
- **The change:** add `if (venueMatch.kind === "orphaned") return NextResponse.json({ code: "KEY_ORPHANED", error: "This key is already stored, but no strategy uses it." }, { status: 409, headers: NO_STORE_HEADERS })` after the `connected` arm, reusing the exact body of the 23505 arm (extract a shared constant). `held` is the same latency class (a composite uses the key) but is **out of scope** (UI-SPEC SC5 names only the orphan; record it). `unresolved` (dark resolver) keeps falling through (a refusal is never invented from an error — Rule 12, pinned by the "OWNER read faulting" test).
- **Which arms are in each group (the plan must name them):** *identity known before validation* — the credential arm of `create-with-key` for `exchange === "mt5"` only. *Identity known only after validation* — ccxt venues (`venue_account_id` comes from the validator's response, 167.1.2), sFOX (no id), and any 23505 race; these keep the existing 23505-arm orphan resolution unchanged. *No validation at all* — the `reuse_api_key_id` arm (`handleReuseExistingKey`): there `orphaned` is the case the arm exists to resume, not refuse. `composite/add-key` has no venue-identity fence and no `KEY_ORPHANED` emitter (its own comment: it does not mint `KEY_ORPHANED`), so it is not an SC5 site. Note Phase 213 decision (c) will block MT5 composite members; this does not affect SC5.
- **Truthfulness cost, to state in the plan:** refusing first means a user with an orphaned key AND a wrong password is told about the orphan first. That is true (correct credentials would be refused identically) and the resolver is scoped by `user.id`, so it discloses nothing about other users. The `KEY_ORPHANED` copy and actions (`try_another_key`, `expand_log`) are unchanged (Phase 213 owns the copy).
- **Tests that must move (both pin the OLD behavior and will go RED, correctly):** in `create-with-key/route.test.ts`: `it("an ORPHANED key is still an orphan — 'no strategy at all' must not become a refusal")` (currently expects 200 and one `rpcMock` call) and `it("the PRE-RPC fence lets the orphan through to validate — the credentials speak first")` (expects `validateKeyMock` and `rpcMock` called). Invert them: orphaned → 409 `KEY_ORPHANED`, `validateKeyMock` **not called**, `rpcMock` **not called**, body byte-equal to the 23505-arm body. Keep `it("the OWNER read faulting falls through to the RPC …")` and the 23505-arm orphan cases (`"a live key with no strategy behind it answers 409 KEY_ORPHANED …"`, `"an ORPHANED key on the same account → 409 KEY_ORPHANED"`) green: they cover ccxt/race. Add: wrong-credentials + orphan → `KEY_ORPHANED` with `validateKeyMock` not called (proves "before the 120 s validate"); a non-MT5 venue with an orphan still validates first. RED proof: revert the new arm, the new "not called" assertions fail.
- **Client:** no `ConnectKeyStep` change needed (`KEY_ORPHANED` is in `KNOWN_CREATE_WITH_KEY_CODES`); the validating state / `ValidateWaitCard` simply never appears long, because the response is fast. A browser/jsdom assertion is optional.
- **Pointers:** delete TODOS `0.012`; `.planning/WINDOWS.md` #12 → fixed (planning-only commit); correct the in-route comment block (the "⚠️ THE COST IS LATENCY" paragraph and the `orphaned` rationale) and the two test-comment passages that restate the old order, e.g. the 161-05 notes near `describe("[161-05 / WIZERR-03] the orphan answers KEY_ORPHANED …")`.
- **Collision note:** Phase 213 also edits `create-with-key/route.ts` (the `deduped` flag, session-key comparison). Different regions; expect a rebase, no shared test edits if SC3's new test is a separate file.

### SC6 — contact-support pointers

**Census, regenerated at HEAD with the TODOS command** (`grep -rni 'contact support' src | grep -v wizardErrors.ts | grep -v test`): 13 strings + 2 comments, matching CONTEXT. `[VERIFIED: command run this session]`:
`csv-finalize/route.ts` (`ENQUEUE_LOST_RACE_USER_COPY`), `finalize-wizard/route.ts` (composite `computation_error`), `admin/partner-import/route.ts` (`audit_warning`), `admin/match/send-intro/route.ts` (`audit_warning`), `account/export/route.ts` (2), `ScenarioCommitDrawer.tsx` (2), `WeightOptimizerSection.tsx` (1), `ProfileForm.tsx` (1), `SignupForm.tsx` (2), `ApiKeyManager.tsx` (1); comments: `lib/gdpr-export.ts`, `lib/factsheet/fetch-and-build-payload.ts`. (`wizardErrors.ts` is excluded by the command; its two hits are a comment and an exempt-reason doc string quoting a Python detail, internal.)

**Per-string consumer and render path** (UI-SPEC rows 1–13 hold; additions the planner needs):
- Row 1 `ProfileForm`, rows 2–3 `SignupForm`, rows 4–5 `ScenarioCommitDrawer`, row 6 `WeightOptimizerSection`: in-app; swap the text node for `<ContactPointerText text=… href={contactHref({ topic: "support" })} newTab />` per the UI-SPEC table (`topic` values available: `general`, `support`, `security`, `privacy`; `contactHref` also takes `ref`, `draft`, `strategy`). `/contact` is a public route (UI-SPEC measured it in `PUBLIC_ROUTES`), so the signed-out `SignupForm` may link to it.
- Row 7 `ApiKeyManager` `SYNC_UNAVAILABLE_COPY`: it flows through `EnqueueAnswerError.message` into **two** render sites — the `error` state's `<p className="text-sm text-negative">{error}</p>` and the `syncError` state passed to `SyncProgress`. Both must go through `ContactPointerText`; `supportContactHref = contactHref({ topic: "support", strategy: strategyId })` already exists in the component (the file already imports both).
- Rows 8–9 (wire strings written to `strategy_analytics.computation_error`): readers are `SyncPreviewStep`, `ApiKeyManager` (`setSyncError(info.computationError)`) and `SyncProgress`. `SyncProgress` imports `ContactPointerText` and `contactHref` and holds `strategyId`; its `syncError` paragraph (`{syncStatus === "error" && … <p className="text-xs text-text-secondary mb-2">{syncError}</p>}`) is a plain `<p>`: route it through `ContactPointerText` with `{ topic: "support", strategy: strategyId }` and the copy then links wherever that panel renders it. Where a reader is plain text (e.g. `SyncPreviewStep` envelope paths that already use the shared renderer) check each; do not assume.
- Rows 10–11 `account/export`: `[VERIFIED: grep]` no in-app caller of `POST /api/account/export` exists under `src/` (only comments and the route); `gdpr-export-route.test.ts` asserts the `code` (`export_truncated`, `export_manifest_drift`) and not the message text, so these two strings have no text pin to move. Plain wire text, no link.
- Rows 12–13 admin `audit_warning`: `[VERIFIED: grep]` no test pins the strings (`redteam-b02-regressions.test.ts` only locates `audit_warning` to check the status); rewrite per UI-SPEC.

**CONFLICT, row 8 vs SC7 (must reach the founder).** `[VERIFIED: csv-finalize/route.ts ENQUEUE_LOST_RACE_USER_COPY + supabase/schema/functions/computation_error_copy.sql ELSE arm]` the route literal "Analytics could not complete for this strategy. Retry the sync, or contact support if this persists." is byte-identical to the SQL function's ELSE arm. `[VERIFIED: csv-finalize/route.test.ts CURATED_DEFAULT_COPY]` the WR-07 test parses the SQL (`sql.match(/\bELSE\s*\n\s*'([^']+)'/)`) and asserts the route's written sentence equals it ("the route's literal loses its only tie to the SQL it is a copy of"). Changing the TS literal alone reds that test. Changing the SQL requires a migration, and SC7 and CONTEXT say none. Options for the plan (recommended first):
  1. **Change the TS literal; re-cut the WR-07 oracle** from "equals the SQL ELSE arm" to a hand-typed expected sentence, keep every independent assertion (jargon-free, no `/automatic/`, no unscrubbed operator text) and record the divergence in the test header and a booked TODOS entry (the SQL arm still says "contact support" and needs a migration in a later phase). This honors CONTEXT's locked server-string decision and SC7.
  2. Leave row 8 unchanged and record it (contradicts CONTEXT).
  3. Add a migration (contradicts SC7, needs migration-reviewer / rls-policy-auditor).
  The orchestrator should surface this as a premise change; the research default is option 1.
- **Survivors outside the `src` census (SC6's ROADMAP wording is broader than the command):** the SQL `computation_error_copy` arms (`permanent`: "…Contact support if you need this strategy computed."; `transient` and `unknown`: "…Retry the sync, or contact support if it keeps failing.") are written into the same column and rendered by the same `SyncProgress`/`SyncPreviewStep`; and Python strings `services/exchange.py` ("Key validation failed unexpectedly. Contact support if this persists."), `services/csv_validator.py`, `services/job_worker.py` (two), `routers/portfolio.py`. None is in the `src` grep. `SyncPreviewStep.render.test.tsx` and `.composite.render.test.tsx` use "Contact support" sentences as **fixtures/negative assertions** (the composite one asserts `not.toContain("Contact support if you need")`); they are fixtures and stay. Book the survivors as one TODOS entry owned by a later migration phase (user-facing, so it is bookable under the TODOS rule); do not rewrite them here.
- **Tests that pin old in-app wording (move with the string):** `ApiKeyManager.test.tsx` (`SYNC_UNAVAILABLE_SENTENCE` hand-typed, "contact support if it keeps failing"), `ApiKeyManager.poll.test.tsx` (`TIMEOUT_COPY` "Analytics computation timed out. Please retry or contact support." is a different, server-fixture string — read before touching), `csv-finalize/route.test.ts` (WR-07 block above). `ProfileForm`, `SignupForm`, `ScenarioCommitDrawer`, `WeightOptimizerSection` tests: the grep found no assertion of the old sentences, but add render tests asserting the `contact form` link href (`/contact?topic=support…`) and `target="_blank"` / sr-only suffix where `newTab`.
- **No-email sweep extension:** extend `USER_FACING_SOURCES` in `src/__tests__/no-email-in-copy.test.ts` with the touched modules (see Pitfall 7 for the two allowlist entries). It already lists `csv-finalize/route.ts`. Its arm 1 (walk of exported values of `wizardErrors`, `status-surface-copy`, `key-card-copy`, `contact`) needs no change unless copy moves into those modules (it does not).
- **Closing condition:** the TODOS regenerate command returns only the two comments and fixtures; with rewritten strings, no string may contain "contact support" in any case (the grep is case-insensitive).
- **TODOS to delete:** `CONTACT-SUPPORT-POINTERS-01` (its stated closing requirement includes the sweep extension).

## Cross-cutting

### WizardErrorCode table-size pins and KNOWN_* rosters
No new code is minted by any recommended path, so `EXPECTED_TABLE_SIZE` (both pins in `wizardErrors.test.ts`, plus the divergence guard and `dialog-envelope.invariant.test.ts`'s census) does not move. Roster/census files that DO move: `KNOWN_VALIDATE_AND_ENCRYPT_CODES` (unchanged membership under the recommended recogniser; only its docblock), the `wizardErrors.invariant.test.ts` `[164.2-05]` describe (path re-point), and `roster-render.test.tsx` (fifth surface, `EXPECTED_POPULATION_MIN`, floors). `wizardErrors.invariant.test.ts`'s fourth `ROUTES` row (`label: "keys/validate-and-encrypt"`, `expectedSites: 13`) counts the route's `NextResponse.json({ code: … })` literals; moving the map out of the route does not change that count. If the planner chose to add a code or a route literal, `expectedSites` moves with it.

### How to run tests
- **Environment finding:** the worktree has **no `node_modules` and no Python venv**. Run `npm ci` in the worktree under Node 22 (`PATH=/opt/homebrew/opt/node@22/bin:$PATH npm ci`), or symlink the main checkout's `node_modules` for a read-only trial; create the venv with `make install` in `analytics-service/` (CI uses Python 3.12; the system Python here is 3.14, which the Makefile calls out as a segfault venv). **Disclosure:** for the fence and constants checks above I ran the worktree's Python source with the main checkout's existing Python 3.12 venv interpreter (read-only, `-I`, `PYTHONDONTWRITEBYTECODE=1`); nothing was written in either checkout.
- Vitest: `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run <path>` (full: `npm test`); typecheck `npm run typecheck`; lint `npm run lint` (includes `check-planning-hygiene.ts`).
- Pytest: from `analytics-service/` only: `<venv>/bin/pytest tests/test_mt5_validate_parity.py tests/test_job_worker.py tests/test_ingestion_mt5.py tests/test_mt5_concurrency.py -x`. mypy as CI runs it: `make typecheck` (`mypy --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`).

### TODOS entries closed, and every pointer to them
Close and **delete** (same PR, name in CHANGELOG): `0.07`, `0.09`, `0.012`, `0.013`, `0.51`, `[WIZFORM-02-VE-CODECHANNEL]`, `[164.2-WIZARD-BARE401]`, `CONTACT-SUPPORT-POINTERS-01`. `0.51` closes only if the SC4 outcome is "recorded and structurally pinned"; if the founder wants the measurement kept, re-home its measurement remainder instead of deleting.
Pointers found (`[VERIFIED: repo-wide grep excluding the frozen milestone archives]`): `.planning/WINDOWS.md` row/JSON id 12 (`D-161-05-B`; mark fixed); `.planning/STATE.md` history line citing `D-161-07-A` (history, leave); `CHANGELOG.md` entries already booking Phase 212 (the ship entry is new); `TODOS.md` cross-references inside `0.013` ↔ `[WIZFORM-02-VE-CODECHANNEL]` ↔ `[164.2-WIZARD-BARE401]` ↔ `[164.2-SEAMCODE-UNION]` (the last stays open but its `route.ts:123` / `invariant.test.ts:2681-2755` citations go stale: re-point by symbol) and the Phase 145 ship-review entry `OPTION CSV_FINALIZE_MOVED`, whose "GATED ON WIZFORM-02 CLOSING" gate **opens** when `0.013` closes (update its text; do not pick it up). No hit in `CLAUDE.md`, `docs/`, `scripts/` or tests names these ids as live owners. In code/docs: the `KNOWN_VALIDATE_AND_ENCRYPT_CODES` docblock, `roster-render.test.tsx` header + the `[164.2-09]` fifth-surface describe, `ConnectKeyStep`/`MultiKeyConnectStep` docblocks that say "none of the three consumers reads `code`" (grep `wizardErrors.ts` for "three consumers" / "none … reads"), and the frozen `164.2-09-SUMMARY.md` (do not edit). The `GATED ON WIZFORM-02 CLOSING` marker text in `0.013` goes with the entry.

## Plan Split (topic plans, waves, file ownership)

`src/lib/wizardErrors.ts` is the hotspot, and **only SC3a (and the conditional SC4 copy edit) needs it**; SC1/SC2/SC5/SC6 need zero edits there by design. Serialize by wave.

| Wave | Plan | Owns (exclusive) | Depends |
|---|---|---|---|
| 1 | **01 SC2 MT5 sentence** | `analytics-service/services/mt5_probe.py`; comment carriers in `services/job_worker.py`, `tests/test_job_worker.py`, `tests/test_mt5_validate_parity.py` (incl. `_EXPECTED_GENERIC`), other carrier files as classified; `161-UI-SPEC.md` amendment (planning-only commit) | — |
| 1 | **02 SC1 composite verdict** | `src/lib/strategyGate.ts`, `src/lib/strategyGate.test.ts`, `SyncPreviewStep.tsx`, `SyncPreviewStep.composite.render.test.tsx` | — |
| 1 | **03 SC5 orphan before validate** | `src/app/api/strategies/create-with-key/route.ts`, `…/route.test.ts` | — |
| 1 | **04 SC6a in-app pointers** | `ProfileForm.tsx`, `SignupForm.tsx`, `ScenarioCommitDrawer.tsx`, `WeightOptimizerSection.tsx`, `ApiKeyManager.tsx`, `SyncProgress.tsx` and their tests | — |
| 1 | **05 SC6b server strings** | `csv-finalize/route.ts` + its WR-07 oracle re-cut in `csv-finalize/route.test.ts`, `finalize-wizard/route.ts`, `account/export/route.ts`, `admin/match/send-intro/route.ts`, `admin/partner-import/route.ts` and their tests | SC6/SC7 conflict decision |
| 2 | **06 SC3a classifier + shared map + recogniser** | `src/lib/wizardErrors.ts` (all SC3 edits and docblock corrections), `src/lib/wizardErrors.test.ts`, `src/lib/wizardErrors.invariant.test.ts`, `src/app/api/keys/validate-and-encrypt/route.ts` (+ its test), `src/app/api/strategies/composite/add-key/route.test.ts`, NEW `create-with-key/route.bare-401.test.ts`, `keys/[id]/rotate-secret` bare-401 case | — (no overlap with Wave 1) |
| 2 | **07 SC4 structural pin** | `analytics-service/tests/test_mt5_concurrency.py` only | — |
| 3 | **08 SC3b dashboard consumers** | `StrategyForm.tsx`, `AllocatorExchangeManager.tsx`, `ApiKeyForm.tsx`, their tests, `wizardErrors.roster-render.test.tsx` | 06 (the exported recogniser) |
| 3 | **09 SC4 copy (CONDITIONAL on founder checkpoint) + no-email sweep + closing records** | `wizardErrors.ts` busy copy + `closed_sets.py` + 3 byte pins **only if** a number is chosen; `src/__tests__/no-email-in-copy.test.ts` (single owner of the sweep list); `TODOS.md`, `CHANGELOG.md`/`VERSION`/`package.json` at ship; `.planning/WINDOWS.md` (planning-only) | 06, 08 |

Rules for the planner: every `files_modified` list must be disjoint within a wave; the SC3 `create-with-key` test goes in a new file so plan 03 owns the existing one; plan 09's `wizardErrors.ts` edit runs after plan 06 merges; planning-only edits never ride a code commit; anchor by symbol (the `plan-anchor-verify` gate).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A bare 403 on `/api/validate-key` / `/encrypt-key` carries no venue-side meaning (403 emitters read are internal-token gates and `/fetch-trades`) | § SC3 truth check | A venue-meaningful 403 would be shown as `SEAM_MISCONFIGURED` ("our configuration is wrong") |
| A2 | Per-code HTTP statuses for the forwarded wire codes other than the venue-transient 424 family and the four listed (`RATE_LIMITED`, `SIGN_IN_FAILED`, `MT5_SERVER_UNKNOWN`, `MT5_TERMINAL_BUSY`) | § SC3 census | The 4xx/5xx split in the disposition list could be off; the plan must measure it from the emitters |
| A3 | Railway env overrides of `MT5_*` timeout constants equal the code defaults | § SC4 | The ceilings would differ (they are labelled "at code defaults") |
| A4 | The unmeasured typical scrub/validate durations are short (16–18 s waits, 13–29 s gaps are the only observations) | § SC4 | Only affects how misleading a ceiling number would be; no copy is changed on this assumption |
| A5 | No other in-app reader of `computation_error` beyond `SyncPreviewStep`, `ApiKeyManager`, `SyncProgress` renders rows 8–9 as plain text | § SC6 | A plain-text reader would show the sentence without a link (still a real next step) |
| A6 | Returning HTTP 500 for the bare-401 classifier verdict is acceptable (no client reads the status for this code) | § SC3 | Low: a different status changes only wire telemetry |

## Open Questions (RESOLVED)

1. **SC4: what retry copy, if any number, does the founder want?**
   - Known: no p95; premise false at HEAD; wizard-only ceiling about 5 min at defaults, worker holder 30 min, failing scrub unbounded.
   - Unclear: whether the founder accepts a ceiling-derived number, wants the text de-numbered, or wants it left as is.
   - Recommendation: `checkpoint:decision` in plan 09; default = leave bytes, ship the pin, delete `0.51` only after the founder's answer is recorded.
   - RESOLVED (default, founder-pending): CONTEXT "Pending founder questions / SC4 busy copy" keeps the `KEY_MT5_TERMINAL_BUSY` bytes ("Try again in a minute.") until the founder answers. Plan 09 Task 2 applies that default as a recorded assumption, not a checkpoint, and isolates the copy so a different answer changes that task only. `0.51` closes at ship as "recorded and structurally pinned", or is re-homed if the founder answers otherwise (plan 09 Task 3).
2. **SC6 row 8: re-cut the WR-07 oracle (option 1) or leave the string?** CONTEXT locked the string change; SC7 forbids the SQL twin's migration. Recommendation: option 1 plus a booked TODOS entry for the SQL arms and the five Python strings; the orchestrator should confirm with the founder because it is a premise change.
   - RESOLVED (default, founder-pending): CONTEXT "Pending founder questions / SC6 csv-finalize" rewrites the TS string, re-cuts the WR-07 oracle to a hand-typed sentence, and books the SQL `computation_error_copy` arms plus the Python strings outside the `src` census as survivors. Plan 07 Task 3 carries it in isolation; plan 09 Task 3 books the survivor entry for ship.
3. **SC3: curated-sentence fallback scope.** UI-SPEC rule 5 covers unrecognised 4xx; the persist-INSERT 500 also carries a specific true sentence (Pitfall 2). Recommendation: apply the fallback to `code === "UNKNOWN"`/unrecognised + string `error` at any status; decide explicitly in plan 08.
   - RESOLVED: CONTEXT post-research decision "[Post-research, SC3] Recogniser shape" (a 5xx keeps its specific static sentence, a 4xx with an unrecognised code renders its curated sentence as the cause). Plan 08's objective states the fallback rule at any status.
4. **SC3: add `SEAM_MISCONFIGURED` to `OUR_DEFECT_KEY_ERROR_CODES`?** Recommendation: no (Python already captures; precedent), record it. Founder/planner may overrule.
   - RESOLVED: CONTEXT post-research decision "[Post-research, SC3] Add SEAM_MISCONFIGURED to OUR_DEFECT_KEY_ERROR_CODES?" answers no and records the Sentry consequence. Plan 08's objective keeps it out of the roster.
5. **SC5: `held` has the same latency class.** Recommendation: record in the plan's notes, do not change.
   - RESOLVED: CONTEXT post-research decision "[Post-research, SC5] Scope of the early refusal" puts `held` latency out of scope and recorded. Plan 03's objective records it unchanged.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 | vitest / tsc / lint | yes (Homebrew `node@22`) | 22.x | — |
| `node_modules` in the worktree | all TS proof | **no** | — | `npm ci` in the worktree (network) or symlink the main checkout's for a trial |
| Python 3.12 venv in the worktree | pytest / mypy | **no** | system Python is 3.14 (unsuitable) | `make install` in `analytics-service/` (CI-matching 3.12); a main-checkout venv exists for read-only trials |
| Railway / Supabase PROD | none | not used | — | the SC4 measurements are the orchestrator's (`212-SC4-MEASUREMENT.md`) |
| Web / Context7 / registry lookups | none | not used | — | no external library is involved |

**Missing dependencies with no fallback:** none. **With fallback:** `node_modules` and the venv (install steps above).

## Validation Architecture

(`workflow.nyquist_validation` is `true` in `.planning/config.json`.)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (TS, jsdom + node environments) ; pytest 9 + mypy 2 (analytics-service, Python 3.12 in CI) |
| Config file | `vitest.config.ts`; `analytics-service/pytest.ini`, `pyproject.toml` |
| Quick run command | `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run <file>` ; `cd analytics-service && <venv>/bin/pytest <file> -x` |
| Full suite command | `npm test` ; `cd analytics-service && make test` ; `make typecheck` |

### Phase Requirements → Test Map
| Req | Behavior | Test type | Automated command | File exists? |
|-----|----------|-----------|-------------------|-------------|
| SC1 | composite `sampled_gapped` / `fill_derived_unproven` → `GATE_SERIES_EXAMINED_REFUSED`; null/unknown → provenance; telemetry code equals rendered; Retry absent / Review present | component render | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx" src/lib/strategyGate.test.ts` | edit existing |
| SC2 | founder sentence byte-exact; fence green; family of three distinct; default-argument pin | pytest | `cd analytics-service && pytest tests/test_mt5_validate_parity.py tests/test_job_worker.py tests/test_ingestion_mt5.py -x` ; `make typecheck` | edit existing (`_EXPECTED_GENERIC`) |
| SC3 (code channel) | both forms render `ErrorEnvelope` from `code`; status-aware `RATE_LIMITED`; curated-sentence fallback; unparseable body; sweep fifth surface | component + sweep | `npx vitest run src/components/strategy/StrategyForm.test.tsx src/components/exchanges/AllocatorExchangeManager.test.tsx src/lib/wizardErrors.roster-render.test.tsx` | edit existing + new cases |
| SC3 (bare 401/403) | classifier answers `SEAM_MISCONFIGURED` for status 401/403 with null seamCode on all three callers; cascade unchanged otherwise | unit + route | `npx vitest run src/lib/wizardErrors.test.ts src/lib/wizardErrors.invariant.test.ts src/app/api/strategies/composite/add-key/route.test.ts "src/app/api/strategies/create-with-key/route.bare-401.test.ts" "src/app/api/keys/[id]/rotate-secret/route.test.ts" src/app/api/keys/validate-and-encrypt/route.test.ts` | new + edit |
| SC4 | validate and job leases use different keys; job-key hold does not delay validation-key acquisition; equal config shares a lock (RED control); copy bytes unchanged (or equal across carriers if changed) | pytest | `cd analytics-service && pytest tests/test_mt5_concurrency.py tests/test_validate_key_venue_transient.py tests/test_mt5_server_known.py -x` ; `npx vitest run src/lib/wizardErrors.test.ts "src/app/api/keys/[id]/rotate-secret/route.test.ts"` | new test in existing file |
| SC5 | MT5 orphan → 409 `KEY_ORPHANED`, `validateKey` and RPC not called, even with wrong credentials; ccxt orphan still validates first; resolver fault falls through | route | `npx vitest run src/app/api/strategies/create-with-key/route.test.ts` | edit existing |
| SC6 | each string rewritten; links render with the topic/strategy params and `newTab` rules; WR-07 oracle re-cut; no-email sweep covers touched modules; census command returns only comments/fixtures | component + route + census | `npx vitest run src/__tests__/no-email-in-copy.test.ts src/app/api/strategies/csv-finalize/route.test.ts src/components/strategy/ApiKeyManager.test.tsx src/components/auth` ; `grep -rni 'contact support' src | grep -v wizardErrors.ts | grep -v test` (expect only the two comments) | edit existing |
| SC7 | no migration | file census | `git diff --name-only <base>...HEAD -- supabase/migrations` prints nothing | n/a |
| SC8 | each fix RED when reverted | neuter protocol | below | n/a |

### Sampling Rate
- **Per task commit:** the single owning test file for that task (commands above).
- **Per wave merge:** all of that wave's files plus `npm run typecheck` and, for Python plans, `make typecheck`.
- **Phase gate:** `npm test`, `npm run lint`, `npm run typecheck`, `make typecheck`, full `pytest`, all green before `/gsd-verify-work`.

### RED-on-revert method per SC (neuter, observe RED, restore from a byte backup; never `git checkout`/`stash`)
For each: `cp <file> <scratch>/<name>.bak`, apply the neuter, run the named test, record the failing assertion, `cp` back, `cmp` clean, rerun GREEN.
- **SC1:** neuter = restore the hardcoded `"GATE_SERIES_PROVENANCE_UNVERIFIED"` in the composite arm → the renamed `sampled_gapped` case and the new `fill_derived_unproven` case go RED; the null/unknown cases stay GREEN (they are the over-refusal controls).
- **SC2:** neuter = restore the old constant → `_EXPECTED_GENERIC` rows (five parametrised cases, the worker-sink case, the docstring-anchor case) go RED.
- **SC3 code channel:** neuter = make the form read `err.error` again → the sweep's live `codeChannelReads` assertion and the envelope cases go RED; neuter the status split (drop the `status !== 429` branch) → the venue-throttle case goes RED while the 429 row stays GREEN.
- **SC3 bare 401:** neuter = remove the classifier status branch → the three route cases answer `UNKNOWN` and go RED.
- **SC4:** neuter = make `read_env_validation_gateway_endpoint` return the job pair → the behavioral pin's keys-differ and non-blocking assertions go RED (and the control case flips).
- **SC5:** neuter = delete the new `orphaned` arm → the two inverted tests and the wrong-credentials case go RED (validate/RPC called).
- **SC6:** neuter = restore one old string → its updated pin / link assertion goes RED; neuter the sweep list entry → not applicable (it is a coverage extension, prove with a planted address in a touched module as the file's own self-test does).

### Wave 0 Gaps
- [ ] Install dependencies in the worktree (`npm ci`, `make install`) before any task can prove anything.
- [ ] New test file `src/app/api/strategies/create-with-key/route.bare-401.test.ts` (SC3; separate from SC5's file).
- [ ] No new framework or fixtures needed.

## Security Domain

(`security_enforcement` is not set to false in `.planning/config.json`: included.)

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | partial | bare 401/403 means OUR service key is rejected; mapped to `SEAM_MISCONFIGURED` ("not your key"), never "your key was rejected" |
| V3 Session Management | no | no session change |
| V4 Access Control | yes | `resolveByVenueIdentity` and the reuse resolver are scoped by `user.id`; the SC5 refusal discloses only the caller's own row |
| V5 Input Validation | yes | the recogniser never casts an unproven wire string (`recogniseSeamErrorCode` Map lookup, then roster membership, then `UNKNOWN`); render bodies as text, never markup |
| V6 Cryptography | no | no crypto change |
| V7 Error handling / logging | yes | unparseable body: log `status`/`statusText` only, never the body (credentials ride the request, errors may echo); 5xx bodies stay static, only the CODE is forwarded; correlation id minted client-side and echoed, never derived from secrets |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prototype keys (`constructor`, `__proto__`) as a wire code | Tampering | `Map` lookups only; guarded roster cast (the existing tables' stated reason) |
| Credential echo in an error body or log | Information disclosure | keep `scrubSeamError(err, perRequestSecrets)` at the route sinks untouched; the forms log status only |
| False remedy shown on a new surface (a "draft saved" claim with no draft) | Spoofing/Repudiation of state | `fixRequires` surface gating; `ctx` carries no wizard-only slots on dashboard forms |
| Reverse tabnabbing on new contact links | Tampering | `ContactPointerText` `newTab` sets `rel="noopener noreferrer"` (T-164.6.6.3.5-20) |
| Oracle leakage: orphan refusal reveals a key's existence | Information disclosure | resolver scoped to the caller's `user.id`; one refusal shape; no identity echoed (T-154-06-C) |

## Sources

### Primary (HIGH confidence) — read or executed this session at HEAD
- `212-CONTEXT.md`, `212-UI-SPEC.md`, `212-SC4-MEASUREMENT.md`, ROADMAP `### Phase 212:`, TODOS entries `0.012 0.013 0.07 0.09 0.51 CONTACT-SUPPORT-POINTERS-01 WIZFORM-02-VE-CODECHANNEL 164.2-WIZARD-BARE401 164.2-SEAMCODE-UNION`.
- `src/lib/strategyGate.ts`, `src/lib/wizardErrors.ts` (`classifyKeyValidationError`, `SEAM_CODE_TO_WIZARD_CODE`, `VENUE_WIRE_CODE_TO_VERDICT`, `OUR_DEFECT_KEY_ERROR_CODES`, `DASHBOARD_DIALOG_ROUTE_CODES`, `KNOWN_VALIDATE_AND_ENCRYPT_CODES`, `recogniseDashboardDialogCode`, `gateFailureToWizardError`, the fix-requirement gating, `KEY_MT5_TERMINAL_BUSY`, `GATE_SERIES_*`, `SEAM_MISCONFIGURED`), `src/lib/envelope.ts`, `src/lib/contact.ts`, `ContactPointerText.tsx`.
- `SyncPreviewStep.tsx` (composite arm, control derivation), `WizardClient.tsx` (`onReviewKeys`), `ConnectKeyStep.tsx` (`recogniseCreateWithKeyCode`), `StrategyForm.tsx`, `AllocatorExchangeManager.tsx`, `ApiKeyForm.tsx`, `ApiKeyManager.tsx`, `SyncProgress.tsx`.
- Routes: `keys/validate-and-encrypt`, `strategies/create-with-key`, `strategies/composite/add-key`, `strategies/csv-finalize`, `strategies/finalize-wizard`, `account/export`, `admin/*`; tests: `SyncPreviewStep.composite.render.test.tsx`, `create-with-key/route.test.ts`, `csv-finalize/route.test.ts`, `wizardErrors.invariant.test.ts`, `wizardErrors.roster-render.test.tsx`, `no-email-in-copy.test.ts`, `strategyGate.invariant.test.ts`, `gdpr-export-route.test.ts`.
- `analytics-service/services/mt5_probe.py`, `mt5_terminal_scrub.py`, `mt5_concurrency.py`, `mt5_relogin.py`, `ingestion/mt5.py`, `mt5_client.py`, `closed_sets.py`, `error_contract.py`, `job_worker.py`, `routers/exchange.py`, `main.py`; tests `test_mt5_validate_parity.py`, `test_job_worker.py`, `test_mt5_concurrency.py`; `supabase/schema/functions/computation_error_copy.sql`.
- Executed probes (read-only, Python 3.12, worktree source): the SC2 fence classification; the SC4 constants at code defaults.
- Local only (no external docs): no Context7, web, or registry source was needed or used; no external library is involved.

### Secondary / Tertiary
- None. Anything not read directly is tagged `[ASSUMED]` in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all modules read.
- Architecture: HIGH for SC1/SC2/SC5/SC6; MEDIUM for SC3 forwarded-code census (statuses partly unmeasured, method given).
- Pitfalls: HIGH — each pitfall points at a read symbol or a test that pins the opposite.
- SC4: HIGH that no honest static number exists; no measurement was taken or invented.

**Research date:** 2026-11-14
**Valid until:** 2026-11-28 (the wizard error surface moves with every key-flow phase; Phase 213 edits `create-with-key` and `KEY_ORPHANED`; re-measure line-sensitive census before executing).
