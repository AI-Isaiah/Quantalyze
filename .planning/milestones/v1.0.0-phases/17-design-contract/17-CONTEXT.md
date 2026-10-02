# Phase 17: Design Contract - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Lock DESIGN.md additions (trust-tier badges, error envelope wireframe, broker
selector grid, CSV escape-hatch card, mobile fallback deferral note, a11y
minimums, 9-state matrix) and produce the UI-SPEC.md design contract for the
API-key wizard surfaces — BEFORE Phase 19 backend rewrite. Hard exit gate per
REQUIREMENTS.md Phase-Internal Gates: zero TBD cells in DESIGN.md additions
before Phase 19 entry. Phase 17 is documentation + tokens + a11y test
scaffolding only — no UI components beyond the trust-tier token file and the
`wizardErrors.ts` CSV-string absorption land in this phase. The surfaces the
contract describes (broker grid, error envelopes, CSV card, badge variants)
are RENDERED in Phase 18 (root-cause fix) and Phase 19 (unified backbone) per
the design they pin here.

In scope:
- DESIGN-01: Trust-tier badge component variants + `TRUST_TIER_TOKENS` token file + DESIGN.md ↔ token consistency Vitest test
- DESIGN-02: Error envelope render wireframe locking the live `WizardErrorEnvelope.tsx` shape; copy-diagnostics payload format change (JSON → newline-prefixed text); rebrand component to surface-agnostic `ErrorEnvelope`
- DESIGN-03: Broker selector grid (3-cols × 1-row, 3 active cards) + CSV escape-hatch full-width card spec
- DESIGN-04: Mobile fallback deferral note (ship 640px gate as-is per OBSERV-11 N=0 audit; trigger condition = PostHog `wizard_start` mobile count > 0)
- DESIGN-05: 9-state matrix across 9 API-key-flow surfaces; a11y minimums (4.5:1 contrast, ARIA live regions, keyboard-nav stepper, focus management); `wizardErrors.ts` declared source-of-truth and absorbs Phase 15's 19 CSV-branch literal strings

Out of scope (deferred / handled by other phases):
- Rendering the surfaces this contract describes (Phases 18 + 19 ship the implementation)
- Mobile-readable wizard fallback build (deferred to v2 trigger)
- pgvector / similarity UI (v2 per UC-C)
- Manager Workspace surfaces, FoF landing surface, branded LP report (v2)

</domain>

<decisions>
## Implementation Decisions

### DESIGN-01 — Trust-Tier Badge Tokens
- **Self-reported warning hex: `#B45309`** (amber-700, canonical `--color-warning`).
  REQ DESIGN-01 names `#D97706` verbatim, but DESIGN.md retired that on
  2026-04-30 (3.19:1 → AA fail; B45309 = 5.05:1 AA pass). Aligning with system
  canon means the badge passes the DESIGN.md ↔ token consistency Vitest test.
  Plan 17 must include a REQUIREMENTS.md hex-correction edit (DESIGN-01
  spec: `#D97706` → `#B45309`).
- **Token file path: `src/lib/design-tokens/trust-tier.ts`** (REQ-stated). New
  subfolder `design-tokens/` is system-level layering — keeps tokens out of
  feature folders so admin / marketplace / factsheet can import without crossing
  feature boundaries.
- **Export shape: single `TRUST_TIER_TOKENS` nested const**, `as const`, keyed
  by variant (`api_verified | csv_uploaded | self_reported`) → `{fill, text,
  border}` slots. One named export. Mirrors `CHART_TICK_STYLE` precedent;
  type-safe; iterable in tests.
- **Consistency test:** new `tests/a11y/trust-tier-tokens.test.ts` (or similar)
  Vitest assertion that imports `TRUST_TIER_TOKENS` and reads `DESIGN.md`
  content; asserts each hex appears verbatim in the doc. Mirrors
  `tests/a11y/chart-contrast.test.ts` pattern. Atomic CI gate against drift.
- **Existing `TrustTierLabel.tsx` upgrade:** internals swap to render the
  outline pill per the new token file; the call signature MUST NOT change
  (Phase 15 callers don't refactor — see `15-CONTEXT.md` "Trust-Tier
  Placeholder Display").

### DESIGN-02 — Error Envelope Wireframe & Copy-Diagnostics
- **Retry CTA placement:** below `human_message` paragraph + above the
  `<details>` accordion. Codifies live `WizardErrorEnvelope.tsx` (lines 83–96).
  No migration on already-shipped OBSERV-06 components.
- **Copy-diagnostics payload format:** newline-delimited prefixed text block:
  ```
  QUANTALYZE_DIAG
  {code}
  {correlation_id}
  {ISO timestamp}
  {user_agent}
  {debug_context joined with "\n - "}
  --- pii-scrubbed ---
  ```
  Passes `pii-scrub.ts` before `navigator.clipboard.writeText`. Single-paste
  support thread; survives plain-text email/Slack/Linear. Replaces the
  current `JSON.stringify(envelope, null, 2)` in `WizardErrorEnvelope.tsx:33`.
- **`<details>` default state:** always collapsed (REQ-stated). Sentry captures
  full payload server-side regardless of expand state.
- **Component rebrand:** rename `WizardErrorEnvelope` → `ErrorEnvelope`
  (path: `src/components/error/ErrorEnvelope.tsx` — moves out of wizard
  folder); add re-export shim at the old wizard path so the 3 wizard step
  consumers keep working without churn this phase. Surface-agnostic component
  is the prerequisite for the all-surfaces wireframe scope (Q4).
- **Wireframe scope: all error surfaces** — wizard, CSV upload, factsheet
  load failure, admin status page, future error.tsx route boundaries.
  Closes the milestone success gate "no Something went wrong anywhere".
  DESIGN-02 spec describes the canonical layout once; surfaces reference it.

### DESIGN-03 — Broker Grid + CSV Escape-Hatch
- **Grid geometry: 3-cols × 1-row, 3 active cards** (OKX, Binance, Bybit).
  Drops the literal "2×3" interpretation in REQ. v1 source scope per UC-B is
  exactly OKX/Binance/Bybit; existing `ConnectKeyStep.tsx:222` already renders
  this layout. DESIGN-03 codifies the visual contract (white surface, 1px
  `#E2E8F0` border, 8px radius, hover state with accent border per existing
  pattern) without committing to v2 brokers.
- **Per-source field schema location: UI-SPEC.md §per-source-fields.**
  DESIGN.md stays narrow (tokens, typography, visual contracts).
  UI-SPEC.md enumerates: passphrase required for OKX, IP allowlist hint per
  source, `<input>` label copy, `data-testid` patterns. Source-of-truth
  separation prevents DESIGN.md from drifting into per-form territory.
- **CSV escape-hatch card visual weight: full-width below grid.** Same 1px
  `#E2E8F0` border, 8px radius, white surface. Visually equal-but-distinct;
  no accent bg (avoids competing with `api_verified` accent identity).
- **CSV card title (verbatim):** `"Don't have an API key? Upload CSV instead"`
  (REQ DESIGN-03 verbatim). Single source-of-truth between DESIGN.md spec
  and the rendered card; question framing is directive without pushy.
- **Card accepted-formats segmented control:** `daily_nav` / `daily_returns`
  / `trades` (Phase 15 `15-CONTEXT.md` lock). Max 10MB. DESIGN-03 references
  the Phase 15 locks rather than duplicating them.

### DESIGN-04 — Mobile Fallback Deferral
- **Ship 640px `DesktopGate.tsx` as-is for v1.** OBSERV-11 audit returned
  `wizard_start` mobile count = 0 with credential-gap caveat (PostHog admin
  + capture keys not configured in Vercel; `posthog-js` short-circuits in
  production). REQ DESIGN-04 conditional on count > 0; gate honored.
- **DESIGN-04 spec section records explicit deferral:**
  "Mobile-readable wizard fallback deferred to v2. Trigger condition:
  PostHog `wizard_start` event with `device_type='mobile'` count > 0
  over a rolling 7-day window in production. Audit cron logs the count
  to `.planning/audits/wizard-mobile-count.md` weekly. When trigger
  fires, build the read-only review state spec (single column, 16px
  base, no chrome reflow, copy-only — full mobile responsive polish
  remains v2 scope per PROJECT.md)."
  Future contributors find a single decision record, not silence.
- **`DesktopGate.tsx` itself:** unchanged this phase (already shipped Phase
  15, 640px breakpoint).

### DESIGN-05 — 9-State Matrix + A11y Minimums + wizardErrors Source-of-Truth
- **Matrix scope: 9 surfaces.**
  1. Broker selector grid (`/strategies/new/wizard` step 1)
  2. ConnectKeyStep (step 2 API path)
  3. SyncPreviewStep (step 3 API path)
  4. SubmitStep (step 4 API path)
  5. CsvUploadStep (`?source=csv` step 1)
  6. CsvPreviewStep (CSV step 2)
  7. CsvSubmitStep (CSV step 3)
  8. Factsheet trust badge area (`/strategies/[id]` header)
  9. Admin CSV-status page (`/admin/csv-status` — Phase 15 Plan 15-07)
  Each surface gets a row × 9 columns (loading / empty / error / partial /
  success / retry-in-flight / stale / optimistic / offline). Zero TBD cells
  before Phase 19 entry (hard gate). Surfaces explicitly outside the matrix:
  allocator dashboard widgets, marketplace tiles, factsheet body panels,
  `/for-quants` LP page (none in API-key flow).
- **A11y test methodology: BOTH layers.**
  1. Extend axe-core CI (already wired for `/strategy/[id]/v2` + `/discovery/[slug]`)
     to `/strategies/new/wizard` + `/admin/csv-status`. Configuration mirrors
     existing axe rules: `wcag2a` + `wcag2aa` + `best-practice`.
  2. New `tests/a11y/wizard-contrast.test.ts` mirroring `chart-contrast.test.ts`:
     computes WCAG sRGB-luminance ratio, asserts each badge variant
     (`fill, text, border` slots) and stepper active/inactive/focus tokens
     hit ≥ 4.5:1 against their bg context. Same Vitest pattern as the
     2026-04-30 axe-pass migration.
- **A11y minimums spec:** 4.5:1 contrast (computed against page-bg `#F8F9FA`
  for self_reported outline; against surface `#FFFFFF` for inline badges); ARIA
  live regions on every state transition (loading → success/error etc.) via
  `role="status"` + `aria-live="polite"` for non-blocking, `role="alert"`
  for blocking errors (existing `WizardErrorEnvelope` pattern). Keyboard-nav
  stepper: `aria-current="step"` on active, `aria-label="Step N of M: …"`,
  Tab/Shift+Tab moves focus, Enter activates next CTA. Focus management
  between wizard steps: on step transition, focus moves to step's first
  interactive control (matches existing `ConnectKeyStep` pattern via
  `useEffect` mount focus).
- **`wizardErrors.ts` source-of-truth expansion:** Phase 17 absorbs the 19
  CSV-branch literal strings Phase 15 left as `// TODO(phase-17): hoist into
  wizardErrors`. Adds CSV-specific error codes to `WizardErrorCode` union:
  `CSV_PARSE_FAILED`, `CSV_SCHEMA_VIOLATION`, `CSV_FILE_TOO_LARGE`,
  `CSV_NON_MONOTONIC_DATES`, `CSV_NAV_ZERO`, `CSV_RETURN_OUT_OF_RANGE`,
  `CSV_SHARPE_SUSPICIOUS`, `CSV_CURRENCY_INVALID`, `CSV_STRATEGY_NAME_REQUIRED`,
  `CSV_STRATEGY_NAME_TOO_LONG`, plus 9 more identified during plan-phase grep
  of Phase 15 step components. Each gets the 5-field `WizardErrorCopy` shape
  (title / cause / fix[] / docsHref / actions) consistent with existing
  KEY_/SYNC_/GATE_/SESSION_ codes.
- **DESIGN-05 declares envelope's `human_message` field = wizardErrors `title`
  (existing buildEnvelope mapping at `src/lib/envelope.ts:50`). DESIGN.md
  entry locks this mapping so future code-reviews block any inline string
  authoring outside `wizardErrors.ts`.**

### Claude's Discretion
- Exact REQUIREMENTS.md edit syntax for the `#D97706 → #B45309` correction
  (likely a one-line update to the DESIGN-01 row + a Decisions Log entry in
  DESIGN.md noting the alignment).
- Final wording of the DESIGN-04 deferral paragraph.
- Plan-slicing wave structure across the 5 REQs (likely 1 plan per REQ + 1
  plan for the wizardErrors.ts CSV absorption + 1 plan for the consistency
  + a11y test files = ~6-7 plans).
- Whether the `ErrorEnvelope` rename ships in Phase 17 or is deferred to a
  separate refactor; default = ship the rebrand in Phase 17 since the
  surface-agnostic intent is core to DESIGN-02's all-surfaces scope.
- Specific axe-core route configuration syntax (mirrors existing
  `tests/a11y/strategy-v2-axe.spec.ts` or equivalent).
- Final 9-state matrix cell content (e.g., "loading" cell for the broker
  grid is likely the existing skeleton state; "offline" cell is likely a
  ServiceWorker-detected banner with retry CTA — fill all 81 cells during
  plan-phase research with concrete DOM/copy specs).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/strategy/TrustTierLabel.tsx` (Phase 15 v0 — plain muted
  text). Phase 17 upgrades internals to render outline pill from new
  `TRUST_TIER_TOKENS`; call signature unchanged.
- `src/lib/wizardErrors.ts` (360 LOC) — declared source-of-truth.
  `WizardErrorCode` union + `WIZARD_ERROR_COPY` Record + `formatKeyError`
  formatter + 5-field `WizardErrorCopy` shape already shipped.
- `src/lib/envelope.ts` (59 LOC) — `buildEnvelope` maps wizardErrors copy →
  RFC 9457-style `ErrorEnvelope`. Mapping is locked by Phase 16 and Phase 17
  pins it as the canonical bridge.
- `src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.tsx` (99 LOC)
  — live envelope renderer. Phase 17 rebrands → `ErrorEnvelope`, moves to
  `src/components/error/`, swaps `JSON.stringify` payload for
  newline-delimited diag block, adds `pii-scrub.ts` pass.
- `src/lib/admin/pii-scrub.ts` — used by Sentry already (Phase 16 OBSERV-04/05);
  Phase 17 uses it on the clipboard write path.
- `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx`
  — existing 3-broker selector (lines 52-72 EXCHANGES + lines 222-237
  card render). Phase 17 codifies this as DESIGN-03 grid; no behavior
  change.
- `src/app/(dashboard)/strategies/new/wizard/steps/Csv*Step.tsx` (Upload /
  Preview / Submit) — Phase 17 absorbs hardcoded literal copy strings.
- `src/app/(dashboard)/strategies/new/wizard/DesktopGate.tsx` — 640px
  responsive gate (Phase 15 lock). Phase 17 documents deferral, no edits.
- `tests/a11y/chart-contrast.test.ts` — pattern for new
  `wizard-contrast.test.ts` and `trust-tier-tokens.test.ts`.

### Established Patterns
- **Token files use `as const` named exports** (`CHART_TICK_STYLE` precedent).
- **Vitest a11y assertions** read DESIGN.md text and assert hex presence
  (chart-contrast pattern).
- **`role="alert"` for blocking errors, `role="status" + aria-live="polite"`
  for non-blocking** — already in `WizardErrorEnvelope`.
- **`data-testid` + `data-{semantic}` attributes** on visual primitives
  for VR and parity testing (existing `data-trust-tier`, `data-error-code`,
  `data-testid="wizard-exchange-${id}"`).
- **`buildEnvelope(code, correlation_id, context)` is the only sanctioned
  way to author error envelopes** — wizardErrors.ts is the only string
  source.
- **Single source-of-truth strings live with named exports** (e.g.,
  `CSV_UPLOADED_LABEL` from `TrustTierLabel.tsx`); Phase 17 generalizes
  this to all error / state copy via wizardErrors.

### Integration Points
- **DESIGN.md line 95-100 (Component Patterns) gains 5 new sub-sections:
  Trust-Tier Badges, Error Envelope, Broker Selector Grid, CSV Escape-Hatch
  Card, 9-State Matrix.** Insertion point is between "Component Patterns"
  and "Data density principle".
- **Decisions Log (DESIGN.md lines 126-141)** gains 5 new rows dated
  2026-05-01 (one per DESIGN REQ).
- **REQUIREMENTS.md DESIGN-01 row** gets a one-line hex correction
  (`#D97706` → `#B45309`).
- **`tests/a11y/`** gains `trust-tier-tokens.test.ts` + `wizard-contrast.test.ts`.
- **axe-core CI config** extended to cover `/strategies/new/wizard` +
  `/admin/csv-status`.
- **`src/components/error/ErrorEnvelope.tsx`** new file (rename from wizard
  path); old wizard path keeps a 1-line re-export shim.

</code_context>

<specifics>
## Specific Ideas

- **DESIGN.md ↔ token consistency test must run on DESIGN.md text** (read via
  `fs.readFileSync` in the Vitest), not on a parsed DESIGN.md AST. Mirrors
  `chart-contrast.test.ts` pattern. The test does NOT validate that DESIGN.md
  prose mentions the variant by name — just that every hex in
  `TRUST_TIER_TOKENS` appears as a string in the file. This catches the
  drift case (someone updates DESIGN.md to a new accent without updating
  tokens, or vice versa).

- **Self-reported badge variant gets a stricter contrast pin: 4.56:1 on
  `bg-warning/5` fills** — that's the `#FEF3C7` chip surface used for the
  HoldingsTable revoked-key indicator. Same pin pattern as the 2026-04-30
  amber-700 shift logged in DESIGN.md decisions row.

- **Copy-diagnostics format change is a behavior change** in Phase 17 — the
  existing `WizardErrorEnvelope` test (`WizardErrorEnvelope.test.tsx`)
  asserts `JSON.parse(text)` round-trip. Phase 17 plan must update this test
  to assert the new newline-delimited format and that `pii-scrub.ts`
  redacted any sensitive context fields.

- **The `ErrorEnvelope` rebrand can ship as a simple file move + named
  re-export.** Old path:
  ```ts
  // src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.tsx
  export { ErrorEnvelope as WizardErrorEnvelope } from "@/components/error/ErrorEnvelope";
  export type { ErrorEnvelope as WizardErrorEnvelopeProps } from "@/components/error/ErrorEnvelope";
  ```
  Lets the 3 wizard step files keep their existing import; new surfaces
  import from the new path. No churn this phase.

- **wizardErrors.ts CSV expansion specific:** the 19 strings live in the
  three CSV step files (`CsvUploadStep` / `CsvPreviewStep` / `CsvSubmitStep`)
  + `CsvValidationEnvelope`. Phase 15 UI-SPEC §8.8 enumerates them; the
  Phase 17 plan greps for `// TODO(phase-17): hoist into wizardErrors`
  markers (~19 expected) and migrates each to a `WIZARD_ERROR_COPY` entry
  with a stable code id. Code ids follow the existing `CATEGORY_REASON`
  pattern (e.g., `CSV_PARSE_FAILED`, `CSV_SCHEMA_VIOLATION`).

- **The `BadgeShape` exported by the token file is purely a data contract —
  no JSX** — so the file remains framework-neutral and importable from
  Vitest tests, the existing `TrustTierLabel.tsx` consumer, future admin
  surfaces, and a future Storybook story. Plan should NOT import React in
  the token file.

- **DESIGN-04 deferral cron:** the "PostHog wizard_start mobile count > 0
  trigger" is a LOG-ONLY decision record this phase. Phase 17 does NOT
  build a cron; it documents the trigger condition. If/when the trigger
  fires, a future phase (likely v2-mobile-fallback) builds the spec
  + read-only review state.

</specifics>

<deferred>
## Deferred Ideas

- **Mobile-readable wizard fallback** — deferred to v2 trigger (PostHog
  `wizard_start` mobile count > 0 over rolling 7-day window in production).
  DESIGN-04 spec section records the deferral; no v1 build.
- **Full mobile-responsive polish on strategy pages** — out of scope per
  PROJECT.md ("Mobile-responsive polish on strategy pages — desktop-only
  acceptable for v1 LP demo").
- **Storybook stories for trust-tier badges + ErrorEnvelope variants** —
  no Storybook in repo; revisit if/when adopted.
- **Visual-regression snapshot tests for the 9-state matrix** — would
  require rendering each cell; deferred to a future phase that builds
  the surfaces (Phase 18 / 19). Phase 17 ships the SPEC, not the
  snapshots.
- **Per-surface variants of `ErrorEnvelope`** — explicitly rejected in
  Area 3 Q4. All surfaces use the same component + wireframe.
- **Disabled "Coming v2" broker tiles** (Deribit / MT5 / IBKR) —
  explicitly rejected in Area 2 Q1; v1 ships 3 active cards only.
- **2-source-of-truth for wizard error copy** (wizardErrors.ts +
  csvWizardErrors.ts) — explicitly rejected in Area 4 Q4.

</deferred>
