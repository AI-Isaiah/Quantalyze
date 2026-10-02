# Phase 11: Onboarding and Security Readiness - Context

**Gathered:** 2026-04-26
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) with multi-voice triangulation (Voice A: Claude in-context; Voice B: Grok 4.20-0309-reasoning; Voice C: fresh-context Claude subagent w/ codebase access)

<domain>
## Phase Boundary

**A real LP's first 10 minutes on Quantalyze are friction-free and credible.** Phase 11 closes the demo→production loop on three fronts:

1. **Onboarding:** A brand-new allocator landing on `/allocations` with zero `api_keys` rows is nudged proactively into the Connect-Exchange flow, and gets a low-friction inline mandate quick-set offer (suggested values, NOT silent defaults — Phase 02 D-09 LOCKED `first-visit fields blank/NULL`).
2. **Credibility:** `/security` page is audited for institutional LP expectations — adding a self-serve audit-log CSV export (on the authenticated `/profile?tab=security` surface, not the public `/security` page), inline egress IP range publication, and a persistent withdrawal-permission warning across all 3 wizard steps.
3. **Resilience + observability:** Every allocator-facing widget under `/allocations` (~46 in `WIDGET_REGISTRY`) gets wrapped with a shared `<WidgetState>` primitive so loading/empty/partial/error/success render correctly with zero ghost-town screens; PostHog onboarding-funnel events (`signup` → `first_api_key_added` → `first_sync_success` → `first_bridge_surfaced` → `first_outcome_recorded`) capture cohort progression server-side; and a new `e2e/onboarding-funnel.spec.ts` runs the full happy-path flow in CI against a dedicated test Supabase project.

**Out of scope (deferred):** Vercel Pro upgrade lifted the prior 2-cron limit, so the Railway-vs-native cron architecture decision is no longer forced — user wants this deferred. Phase 11 must NOT bake in a cron consolidation. Per-state Vitest fixtures for the long tail of WIDGET_REGISTRY widgets that don't appear in DEFAULT_LAYOUT + Performance + Scenario surfaces (~30+ widgets) — covered by the universal primitive only; explicit per-widget × per-state fixtures backlog for Phase 11+1.

</domain>

<decisions>
## Implementation Decisions

### Onboarding nudge UX (ONBOARD-01 + ONBOARD-02)

- **D-01: Surface = banner above tabs (dismissable, persistent across page reloads).** Renders only when `api_keys_count_for_user === 0`. Re-surfaces on every page load until the first API key connects. Includes one-click CTA → `/profile?tab=exchanges`. Voice B caught Voice A's "no dismissal / hijack the Performance tab body" reading as a literal violation of the charter wording "dismissable but re-surfaced until the first key is connected." Empty-state replacement of widgets is preserved as the body when there's no data, but the explicit *nudge* is the banner.
- **D-02: Source-of-truth for "has connected ≥1 key" = server-side `SELECT count(*) FROM api_keys WHERE user_id = auth.uid()`** rendered into the page payload (not localStorage). Re-evaluated on every page load. No client-side caching. Avoids multi-tab / device-switch drift.
- **D-03: Dismissal semantics = per-session via × button.** Setting a `sessionStorage` flag `allocations.onboarding_banner_dismissed = "1"` (NOT localStorage). Re-surfaces on the next page load (since sessionStorage is per-tab, this is the cleanest "dismissable but re-surfaced" reading; alternative: localStorage with a daily TTL — D-03 picks sessionStorage for simplicity). Banner disappears permanently once first key connects (D-02 server-side check returns ≥1).
- **D-04: Mandate quick-set delivery = inline "Mandate quick-set" CARD on first `/allocations` visit (rendered alongside the D-01 banner, beneath it) showing SUGGESTED values (`max_weight = 15%`, `preferred_strategy_types = []`) but requiring explicit user "Save" or "Skip for now" action. Does NOT auto-save defaults.** Voice C flagged that Voice A's original "auto-create default mandate row" recommendation directly contradicts Phase 02 D-09 LOCKED (`first-visit fields blank/NULL, no default pre-fill`) — saving an untouched field persists NULL → Phase 03 `mandate_fit_score = 1.0` graceful fallback. The revised D-04 honors both Phase 02 D-09 (no silent default saving) AND ONBOARD-02 (pre-populates proactively as suggestions). On "Save", calls existing `update_allocator_mandates` RPC with the user-confirmed values. On "Skip for now", dismisses the card per session (sessionStorage) and re-surfaces on next page load until either (a) user saves a mandate or (b) user has had ≥1 sync_success (assumes engagement → manual mandate setup later).

### `/security` gap-fill + key-add warning (ONBOARD-03)

- **D-05: Audit-log CSV export lives on `/profile?tab=security` in a NEW "Audit log" subsection** — NOT on the public `/security` page. Voice C flagged that `/security` is server-rendered, unauthenticated, and indexable (`metadata.robots: { index: true, follow: true }`); embedding an auth-gated download button would mix public + authenticated cognitive contexts. Implementation: new authenticated route handler `GET /api/me/audit-log/export` (RLS-scoped read of `audit_log` for `auth.uid()`), streams CSV with columns `[occurred_at, action, entity_type, entity_id, metadata_summary]`. The public `/security` page gets a 1-line link: "If you have an account, download your audit log from your profile."
- **D-06: SOC-2 status surface = keep current "pre-audit, preparing for SOC 2 Type 1" honest disclosure (verbatim, on `/security`) + add a 1-line status banner near the top of the Compliance Posture section** with a "request posture letter" mailto. NO invented attestations or fake target dates.
- **D-07: IP allowlisting "option" = surface as documentation, not a server-side feature.** Update the existing `#egress-ips` section on `/security` to publish the static egress IP range INLINE (replacing the current "Email security@quantalyze.com for the current IP set" friction copy). Add a sentence to the API-key-add wizard: "Locking your exchange key to an IP allowlist? Allow our egress IPs — see [/security#egress-ips]." The charter wording is "IP allowlisting **option** on API keys" — surfacing the option (so users can configure allowlisting on the exchange side) satisfies the requirement. Voice B initially wanted full server-side allowlisting; reconciliation: the "option" is documented, not built.
- **D-08: Withdrawal-permission warning = persistent strip across ALL 3 wizard steps** in the API-key add flow. Strip copy: "READ ONLY ONLY — keys with Trade or Withdraw permissions are refused on submission." Same component on every step (extract a `WithdrawalWarningStrip` shared by `ConnectKeyStep` and the parent wizard layout). Backed by the existing read-only enforcement (Phase 06 D-01 / wizard `validate-and-encrypt` route — NO behavior change, only UI prominence increase).

### Widget state matrix (ONBOARD-04)

- **D-09: Scope split between universal primitive coverage and explicit fixtures.**
  - Universal primitive: ALL widgets in `WIDGET_REGISTRY` rendered under `/allocations` with `allocations.ui_v2 = true` are wrapped with the new shared `<WidgetState mode={...}>` primitive (~46 widgets per Voice C's count of `widget-registry.ts`). This means every widget gets correct loading / empty / partial / error / success rendering FOR FREE via the wrapper.
  - Explicit per-state Vitest fixtures: ONLY for the ~12-15 widgets actually rendered in DEFAULT_LAYOUT (Overview tab) + Performance + Scenario tabs (the surfaces a new LP sees in their first 10 minutes — directly aligned with the phase goal). Remaining WIDGET_REGISTRY widgets get coverage via the primitive but no per-state fixture (deferred to Phase 11+1 backlog item).
- **D-10: Shared primitive = `src/app/(dashboard)/allocations/components/WidgetState.tsx`** with siblings `LoadingState.tsx` + `ErrorState.tsx`. **Reuses existing `EmptyState.tsx`** at `src/app/(dashboard)/allocations/EmptyState.tsx` for the empty mode (do NOT duplicate). Props interface:
  ```ts
  type WidgetStateMode = 'loading' | 'empty' | 'partial' | 'error' | 'success';
  type WidgetStateProps = {
    mode: WidgetStateMode;
    children?: ReactNode;          // rendered when mode === 'success'
    partial?: { pill: string; children: ReactNode }; // partial mode renders children + status pill
    error?: { message: string; onRetry?: () => void };
    empty?: { title: string; description?: string; ctaHref?: string; ctaLabel?: string };
  };
  ```
- **D-11: "Partial" semantics = "Some venues syncing OR some KPIs computed but not all" — widget renders what it has + a small status pill** with examples like "Syncing 2 of 3 venues" / "Awaiting Sharpe — needs 30 days history". Phase 07 warmup logic (`StaleBanner`, `KpiStrip` warmup paths) is the canonical reference. Stale-data detection (>24h since last sync) is part of partial, not error (data is showable, just not fresh).
- **D-12: Test coverage = Vitest fixtures, ONE render-test per in-scope widget × 5 states.** Fixtures are typed against each widget's actual props interface (NOT `any`) so prop-shape drift breaks the test. Located at `src/app/(dashboard)/allocations/widgets/__tests__/widget-states.fixtures.ts` (shared fixtures) + per-widget `*.states.test.tsx` files. No Storybook (none in repo). No Playwright visual snapshots.

### PostHog onboarding funnel + Playwright CI (ONBOARD-05 + ONBOARD-06)

- **D-13: PostHog event source-of-truth = server-side via `posthog-node`, matching existing `src/lib/analytics/usage-events.ts` pattern.** No client-side duplication. Specific fire sites:
  - `signup` — Supabase auth hook (or post-signup callback in `src/app/auth/callback/route.ts`); user's first authenticated request fires this once.
  - `first_api_key_added` — Voice C flagged that NO single `POST /api/keys` route exists (api_keys rows are inserted via the `create_wizard_strategy` RPC called from `src/app/api/strategies/create-with-key/route.ts:180` AND from `src/app/api/strategies/finalize-wizard/route.ts`). Two fire sites = duplicate-event risk. **Solution: new Postgres trigger on `api_keys` insert that writes a `first_api_key_added_at` marker into `auth.users.raw_user_meta_data` (mirrors the existing `session_count` pattern documented in `usage-events.ts`); a single server-side reader emits the PostHog event when the marker first appears.** This eliminates duplicate-fire risk without coupling event-emission logic to two distinct route handlers.
  - `first_sync_success` — fired in the Python analytics-service worker (`analytics-service/services/allocator_positions.py`) on the first successful `persist_allocator_holdings` call for that allocator. Worker calls `posthog.capture()` with the user's auth.uid().
  - `first_bridge_surfaced` — fired in the Bridge route handler when the response includes a non-empty `recommendations` payload for the first time per user.
  - `first_outcome_recorded` — fired in `POST /api/allocator/scenario/commit` (Phase 10) AND `POST /api/match-decisions` (Phase 01 outcome route) — these are canonical and don't have the duplicate-fire problem of `first_api_key_added`. Use a `first_outcome_at` marker on `auth.users.raw_user_meta_data` to ensure single-fire.
- **D-14: Funnel attribution = per-event properties.**
  - `funnel_step`: ordinal integer 1..5 mapping to the 5 events (1=signup, 2=first_api_key_added, ..., 5=first_outcome_recorded).
  - `funnel_event_name`: enum string (the event name itself, for PostHog dashboards that key on properties).
  - `cohort_week_iso`: ISO week string set on the user's `posthog.identify()` call at signup (e.g. `"2026-W17"`); enables cohort-comparison funnels in PostHog without recomputing.
- **D-15: E2E in CI = new `e2e/onboarding-funnel.spec.ts` built from `e2e/full-flow.spec.ts` as a TEMPLATE (Voice C flag — don't greenfield when an existing spec covers most of the steps). Wire CI to a dedicated test Supabase project via secrets `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY` (NOT preview branches per Voice C — preview branches cost $$ per PR + require seed scripts that don't exist).** Skip silently when secrets are absent (e.g., fork PRs). New helper `e2e/helpers/seed-test-project.ts` performs deterministic seed (creates a test allocator with a specific email, inserts a placeholder Bridge candidate strategy, etc.) + a `cleanup-test-project.ts` for teardown. Spec walks: signup → API key add (skips real exchange call by stubbing the validate-and-encrypt route to a 200 with mocked scopes) → Performance tab populated → open Scenario tab → toggle a holding off → add a Bridge-recommended strategy → commit → outcome recorded. Asserts that all 5 PostHog events fired (via the test endpoint that captures sent events) and that the funnel completes in <60s.
- **D-16: CI gate = required on PRs to main when secrets present, skipped silently otherwise.** Soft-fail mode: Playwright's existing `retries=2` (in `playwright.config.ts:7`) handles transient flakes. After retries exhausted, the spec fails the PR. Documented in `.github/workflows/ci.yml` with a `if: secrets.TEST_SUPABASE_URL` guard so fork PRs don't see broken-CI noise.

### Claude's Discretion

The following implementation details are explicitly at Claude's discretion (no specific direction set in discuss):

- Exact CSS / Tailwind class names for the D-01 banner — match existing `InfoBanner` / `Card` primitives in `src/components/ui/`. Color: amber for "action required" (consistent with Phase 06 D-08 sync_status pill colors).
- Exact column set in the audit-log CSV export (D-05) — start with `[occurred_at, action, entity_type, entity_id]` plus a flattened `metadata_summary` field; planner can extend if there's an obvious additional value field already populated by `log_audit_event`.
- Precise per-widget `partial` pill copy (D-11) — each widget owner picks their own pill text; no central registry of partial-state strings needed in this phase.
- Whether to land an explicit `LoadingState` primitive separate from `<WidgetState mode="loading">` rendering a Tailwind animate-pulse skeleton, or inline the loading skeleton inside `WidgetState.tsx` — planner picks based on whether any non-widget surface needs to reuse the loading skeleton.
- The `cohort_week_iso` computation (D-14) — server-side at signup time using `Intl.DateTimeFormat` ISO week or a 1-line helper; planner picks.
- How the Postgres trigger (D-13) writes the `first_api_key_added_at` marker — direct UPDATE on `auth.users` is restricted; likely a `SECURITY DEFINER` function called by the trigger, mirroring the existing `session_count` increment pattern.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/app/(dashboard)/allocations/EmptyState.tsx`** — existing empty-state primitive with Card and InfoBanner variants. Routes to `/profile?tab=exchanges` for the no-key-connected case. Direct reuse for `<WidgetState mode="empty">` rendering — DO NOT duplicate (Voice C flag).
- **`src/lib/analytics/usage-events.ts` + `usage-events-client.ts`** — server-side PostHog wiring via `posthog-node`, with the `auth.users.raw_user_meta_data` marker pattern (e.g. `session_count`) that D-13 mirrors for `first_api_key_added_at` and `first_outcome_at` markers.
- **`update_allocator_mandates(p_fields jsonb)` SECURITY DEFINER RPC** (Phase 02) — D-04's "Save" action calls this verbatim. No new RPC needed.
- **`audit_log` table + `log_audit_event` function** — D-05's CSV export reads `audit_log` directly via RLS-scoped query. Append-only RLS already enforced.
- **`InfoBanner` + `Card` primitives in `src/components/ui/`** — direct base for D-01 banner styling.
- **`e2e/full-flow.spec.ts`** — D-15 template. Already covers signup → API key add → analytics-service worker → factsheet display, but uses the legacy /strategies path. New `onboarding-funnel.spec.ts` adapts it for the allocator path (`/allocations` + Bridge + outcome).
- **`api_keys.sync_status` taxonomy from Phase 06 D-07** — D-11 partial-state pills directly read this column for "Syncing 2 of 3 venues" copy.
- **Phase 09.1 `<WidgetPicker>` and `WIDGET_REGISTRY`** — D-09 universal-primitive scope = every entry in `WIDGET_REGISTRY` rendered under ui_v2.

### Established Patterns

- **Server Component data fetch + render** (`page.tsx` files use `force-dynamic` or default-dynamic) — D-02's server-side `api_keys` count fits naturally into the existing `MyAllocationDashboardPayload` shape; no new endpoint needed, just an extra count field.
- **`auth.users.raw_user_meta_data` marker for single-fire events** — Phase ?? `session_count` pattern. D-13 copies this verbatim for `first_api_key_added_at` and `first_outcome_at`.
- **SECURITY DEFINER RPC on `auth.uid()`** (adr-0001, adr-0005) — D-13's Postgres trigger function follows the same pattern when writing to `auth.users.raw_user_meta_data`.
- **Three-tier RLS** (owner-select / owner-insert / admin-select / service-role-all) — D-05's audit-log read uses the existing owner-select policy on `audit_log`; no policy change.
- **Atomic commit per task with TDD RED→GREEN cadence** — Phase 10 Plan 04 precedent. Phase 11 plans follow the same.

### Integration Points

- **Route entry `src/app/(dashboard)/allocations/page.tsx`** UNCHANGED. The D-01 banner is rendered conditionally inside `MyAllocationClient.tsx` (or `AllocationDashboardV2.tsx`) based on a new `apiKeysCount` prop in `MyAllocationDashboardPayload`.
- **Wizard layout `src/app/(dashboard)/strategies/new/wizard/`** — D-08's persistent withdrawal warning strip extracts to a shared `WithdrawalWarningStrip` component injected into the wizard layout (NOT each step individually).
- **`/security` page `src/app/security/page.tsx`** — D-06 (SOC-2 banner) + D-07 (inline egress IPs) are content-only edits on this server component. No new auth-aware islands.
- **`/profile` route `src/app/(dashboard)/profile/page.tsx`** (or wherever the profile tabs live) — D-05's "Audit log" subsection adds a new tab/subsection here. Confirm exact layout via planner research.
- **GitHub Actions CI `.github/workflows/ci.yml`** — D-15 + D-16 add a new step in the e2e job (or a parallel job) gated on `secrets.TEST_SUPABASE_URL` presence.
- **`/api/me/audit-log/export/route.ts`** — D-05's NEW route (greenfield namespace `src/app/api/me/`; Voice C flag — confirm naming with planner before scaffolding).
- **Postgres triggers** — D-13's `first_api_key_added` trigger goes in a new migration file (next available number: 084 based on Phase 10's last migration being 083 race-safe M7). Planner confirms.

</code_context>

<specifics>
## Specific Ideas

- **The `/security` page is excellent and editorial — Phase 11 makes minimal, surgical edits to it.** Specifically: (1) inline static egress IP range in `#egress-ips` section, (2) add a 1-line "SOC 2 status: pre-attestation. Type 1 in progress." banner near the top of the Compliance Posture section. The bulk of credibility work happens in /profile?tab=security (D-05 audit-log download) and the wizard (D-08 withdrawal warning strip).
- **No new top-level Connect Exchange surface.** D-01 banner reuses the existing `/profile?tab=exchanges` route for the actual key-add flow (Phase 06 + Phase 08 precedent).
- **Voice C's flag on `widget-registry.ts` count (46 not 39+) is informational** — the universal `<WidgetState>` primitive doesn't care about the exact count; it just wraps every entry. The number affects only the per-state Vitest fixture scope (~12-15 in DEFAULT_LAYOUT + Performance + Scenario).
- **The existing `e2e/full-flow.spec.ts` is the structural template for `onboarding-funnel.spec.ts`.** Don't reinvent signup/auth helpers; adapt them.
- **Phase 02 D-09 + ONBOARD-02 reconciliation:** the Mandate quick-set CARD (D-04) shows SUGGESTED values but does NOT save them silently. User has to click "Save" to persist. This satisfies both LOCKED Phase 02 D-09 AND ONBOARD-02 wording.

</specifics>

<deferred>
## Deferred Ideas

- **Vercel Pro 2-cron limit lift / Railway cron consolidation** — explicitly deferred per the open-decision note in ROADMAP.md (2026-04-26): Vercel Pro upgrade lifted the prior 2-cron limit, so Railway-vs-native cron is no longer forced. Phase 11 must NOT bake in any cron-architecture changes. Re-open when user decides direction.
- **Per-state Vitest fixtures for the long tail of WIDGET_REGISTRY widgets** outside DEFAULT_LAYOUT + Performance + Scenario (~30+ widgets). Universal `<WidgetState>` primitive provides coverage; explicit fixtures are a Phase 11+1 backlog item.
- **In-product server-side IP allowlisting on API keys** — Voice B initially wanted this. Reconciliation: the charter says "IP allowlisting **option**" which is satisfied by D-07 (publish egress IPs inline + wizard link). A server-side allowlist control is a future feature.
- **Storybook visual catalog for widget states** — Voice A considered, dropped per Voice C / unanimous Q4 vote on Vitest-only. Reopen if visual regression detection becomes a problem.
- **Playwright visual snapshots for the state matrix** — same disposition as Storybook above.
- **Audit-log JSON export format** — D-05 ships CSV only. JSON can be added later if a customer asks; CSV is the LP default for data export.
- **Onboarding-funnel cohort comparison dashboard in PostHog** — D-14 sets up the property structure (`cohort_week_iso`); building the actual PostHog dashboard is post-merge ops work, not Phase 11 code.
- **Real-exchange E2E coverage in CI (no stub)** — D-15 stubs the `validate-and-encrypt` route in CI. Real exchange round-trip in CI is gated on rate-limited test API keys + a separate nightly job (post-Phase 11).

</deferred>
