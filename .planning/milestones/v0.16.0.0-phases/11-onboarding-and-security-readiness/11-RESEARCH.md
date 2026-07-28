---
phase: 11
slug: onboarding-and-security-readiness
status: research-complete
researched: 2026-04-26
revised: 2026-04-26
domain: "Onboarding nudge UX + security-credibility surfacing + widget state matrix + PostHog onboarding funnel + E2E in CI"
confidence: HIGH
---

# Phase 11 Research — Onboarding and Security Readiness

> Research output consumed by `gsd-planner` and `gsd-pattern-mapper`.
>
> Authority chain: `CONTEXT.md` (D-01..D-16 LOCKED) → this file → `PATTERNS.md` (file-by-file analogs) → `PLAN.md` (per-task atomic plans).

---

## Summary

Phase 11 is integration-heavy, not architecture-heavy. Every required capability has an existing analog in the codebase that the new code composes from — no new top-level surface, no new dependency, no new architecture pattern is introduced.

The five distinct workstreams reduce to four well-known repo patterns:

1. **Postgres trigger + SECURITY DEFINER marker write** to `auth.users.raw_user_meta_data` (verbatim copy of `migration 053_session_count_rpc.sql`) — used for `first_api_key_added_at` (trigger) and `first_sync_success_at` (RPC called by Python worker). Solves the "4-5 distinct INSERT call sites" problem with one DB-level event.
2. **Server-side PostHog emission via `posthog-node`** (`src/lib/analytics/usage-events.ts`'s `trackUsageEventServer`) reading the markers and firing the funnel events in the `/allocations` Server Component.
3. **Authenticated route handler + RLS-scoped audit-log read + CSV stream** (`/api/me/audit-log/export`) reusing `audit_log_owner_read` policy from `migration 010_portfolio_intelligence.sql:179` and a new RFC-4180 serializer.
4. **Shared React state primitive `<WidgetState>`** that composes the existing `EmptyState.tsx` + `Card` + `Skeleton` primitives with a 5-mode dispatcher, plus typed Vitest fixtures for the 7 DEFAULT_LAYOUT widgets.

The Playwright E2E is built from `e2e/full-flow.spec.ts` as a structural template (per CONTEXT D-15) but is materially new: it walks the allocator path (`/allocations` + Bridge + outcome) which `full-flow.spec.ts` does not cover, stubs the exchange-side `validate-and-encrypt` route per Pitfall 5, and asserts marker presence on `auth.users.raw_user_meta_data` (NOT PostHog itself, which is a fire-and-forget sink).

**Primary recommendation:** Execute the 7 plans as specified — every implementation choice has a verbatim analog in the existing codebase. Zero new npm or pip dependencies. The only blocking gates are (a) `supabase db push` for migration 084 (Plan 01 Task 3), (b) static egress IP confirmation for S4b (Plan 06 Task 0), and (c) GitHub Actions secrets for the E2E gate (Plan 07 Task 4).

**Key findings:**
- `api_keys` has **4 production INSERT call sites** (3 direct client, 1 via `create_wizard_strategy` RPC). One Postgres trigger AFTER INSERT covers all of them at the table level — eliminating duplicate-fire risk without per-route emission logic.
- `audit_log_owner_read` policy at `migration 010:179` already implements `USING (user_id = auth.uid())` — the new export route uses the user-scoped Supabase client and inherits row-level scoping for free.
- DEFAULT_LAYOUT has **7 tiles** (not 12-15); `WIDGET_REGISTRY` has roughly 39 entries. Per-state Vitest fixtures cover the 7 DEFAULT_LAYOUT widgets only; long-tail entries get `<WidgetState>` wrapper coverage but no per-state fixtures (deferred per CONTEXT `<deferred>`).
- `e2e/full-flow.spec.ts` covers `/strategies` legacy flow; the new spec needs material new work for `/allocations` + Bridge + outcome despite reusing the structural template.
- CI precedent: `nightly.yml` line 17 uses `if: ${{ vars.STAGING_BASE_URL != '' && vars.STAGING_BASE_URL != ' ' }}` — VARS, not SECRETS. CONTEXT D-16 locks the new gate to **secrets** for the E2E spec because TEST_SUPABASE_* are credentials, not config flags. Both forms are valid GitHub Actions idiom; the `secrets.X != ''` check works in `if:` for non-fork PRs (forks see secrets as empty strings).
- ZERO new npm/pip dependencies needed — `posthog-node`, `@supabase/supabase-js`, `@playwright/test`, `vitest`, `@testing-library/react` are all installed (verified `package.json` 2026-04-26).

---

## User Constraints (from CONTEXT.md)

> Copy-pasted verbatim from `11-CONTEXT.md`. The planner MUST honor these — research scope is bounded by them.

### Locked Decisions (D-01 through D-16)

**D-01: Surface = banner above tabs (dismissable, persistent across page reloads).** Renders only when `api_keys_count_for_user === 0`. Re-surfaces on every page load until the first API key connects. Includes one-click CTA → `/profile?tab=exchanges`.

**D-02: Source-of-truth for "has connected ≥1 key" = server-side `SELECT count(*) FROM api_keys WHERE user_id = auth.uid()`** rendered into the page payload (not localStorage). Re-evaluated on every page load. No client-side caching.

**D-03: Dismissal semantics = per-session via × button.** Setting a `sessionStorage` flag `allocations.onboarding_banner_dismissed = "1"` (NOT localStorage). Re-surfaces on the next page load. Banner disappears permanently once first key connects.

**D-04: Mandate quick-set delivery = inline "Mandate quick-set" CARD on first `/allocations` visit** showing SUGGESTED values (`max_weight = 15%`, `preferred_strategy_types = []`) but requiring explicit user "Save" or "Skip for now" action. Does NOT auto-save defaults. Honors Phase 02 D-09 LOCKED (no silent default saving).

**D-05: Audit-log CSV export lives on `/profile?tab=security` in a NEW "Audit log" subsection** — NOT on the public `/security` page. New authenticated route handler `GET /api/me/audit-log/export` (RLS-scoped read of `audit_log` for `auth.uid()`), streams CSV with columns `[occurred_at, action, entity_type, entity_id, metadata_summary]`. The public `/security` page gets a 1-line link.

**D-06: SOC-2 status surface = keep current "pre-audit, preparing for SOC 2 Type 1" honest disclosure (verbatim, on `/security`) + add a 1-line status banner** near the top of the Compliance Posture section with a "request posture letter" mailto. NO invented attestations or fake target dates.

**D-07: IP allowlisting "option" = surface as documentation, not a server-side feature.** Update `/security#egress-ips` to publish the static egress IP range INLINE. Add a sentence to the API-key-add wizard linking to `/security#egress-ips`.

**D-08: Withdrawal-permission warning = persistent strip across ALL 3 wizard steps** in the API-key add flow. Strip copy: "READ ONLY ONLY — keys with Trade or Withdraw permissions are refused on submission." Backed by existing read-only enforcement (Phase 06 D-01 / `validate-and-encrypt` route).

**D-09: Scope split between universal primitive coverage and explicit fixtures.** Universal primitive: ALL widgets in `WIDGET_REGISTRY` rendered under `/allocations` are wrapped with `<WidgetState>`. Explicit per-state Vitest fixtures: ONLY for the widgets actually rendered in DEFAULT_LAYOUT (Overview tab) + Performance + Scenario tabs.

**D-10: Shared primitive = `src/app/(dashboard)/allocations/components/WidgetState.tsx`** with siblings `LoadingState.tsx` + `ErrorState.tsx`. **Reuses existing `EmptyState.tsx`** at `src/app/(dashboard)/allocations/EmptyState.tsx` for the empty mode (do NOT duplicate). Props interface:
```ts
type WidgetStateMode = 'loading' | 'empty' | 'partial' | 'error' | 'success';
type WidgetStateProps = {
  mode: WidgetStateMode;
  children?: ReactNode;
  partial?: { pill: string; children: ReactNode };
  error?: { message: string; onRetry?: () => void };
  empty?: { title: string; description?: string; ctaHref?: string; ctaLabel?: string };
};
```

**D-11: "Partial" semantics = "Some venues syncing OR some KPIs computed but not all" — widget renders what it has + a small status pill** (e.g., "Syncing 2 of 3 venues" / "Awaiting Sharpe — needs 30 days history"). Stale-data detection (>24h since last sync) is part of partial, not error.

**D-12: Test coverage = Vitest fixtures, ONE render-test per in-scope widget × 5 states.** Fixtures are typed against each widget's actual props interface (NOT `any`). Located at `src/app/(dashboard)/allocations/widgets/__tests__/widget-states.fixtures.ts` + per-widget tests. No Storybook. No Playwright visual snapshots.

**D-13: PostHog event source-of-truth = server-side via `posthog-node`, matching existing `src/lib/analytics/usage-events.ts` pattern.** No client-side duplication. Specific fire sites:
- `signup` — first authenticated request per user fires this once.
- `first_api_key_added` — Postgres trigger on `api_keys` INSERT writes a `first_api_key_added_at` marker; a single server-side reader emits the PostHog event when the marker first appears.
- `first_sync_success` — Python analytics-service worker calls `stamp_first_sync_success` RPC; reader emits.
- `first_bridge_surfaced` — Bridge route handler/Allocations Server Component when response includes non-empty `recommendations` first time.
- `first_outcome_recorded` — `POST /api/allocator/scenario/commit` AND `POST /api/match/decisions/holding` use a `first_outcome_at` marker.

**D-14: Funnel attribution = per-event properties.**
- `funnel_step`: ordinal integer 1..5 mapping to the 5 events.
- `funnel_event_name`: enum string.
- `cohort_week_iso`: ISO week string set on the user's signup (e.g. `"2026-W17"`); enables cohort-comparison funnels in PostHog.

**D-15: E2E in CI = new `e2e/onboarding-funnel.spec.ts` built from `e2e/full-flow.spec.ts` as a TEMPLATE.** Wire CI to a dedicated test Supabase project via secrets `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY` (NOT preview branches). Skip silently when secrets are absent. New helper `e2e/helpers/seed-test-project.ts` performs deterministic seed; `cleanup-test-project.ts` for teardown. Spec stubs `validate-and-encrypt`. Asserts all 5 PostHog markers stamped + funnel completes in <60s.

**D-16: CI gate = required on PRs to main when secrets present, skipped silently otherwise.** Soft-fail mode: Playwright's existing `retries=2` handles transient flakes. Documented in `.github/workflows/ci.yml` with a `if: secrets.TEST_SUPABASE_URL != ''` guard so fork PRs don't see broken-CI noise.

### Claude's Discretion

- Exact CSS / Tailwind class names for the D-01 banner — match existing `InfoBanner` / `Card` primitives in `src/components/ui/`. Color: amber for "action required".
- Exact column set in the audit-log CSV export (D-05) — start with `[occurred_at, action, entity_type, entity_id, metadata_summary]`.
- Precise per-widget `partial` pill copy (D-11) — each widget owner picks their own.
- Whether to land an explicit `LoadingState` primitive separate from `<WidgetState mode="loading">` OR inline the loading skeleton inside `WidgetState.tsx` — planner picks. **RESOLVED:** inlined per Plan 04 / CONTEXT D-10.
- The `cohort_week_iso` computation (D-14) — server-side at signup time using `Intl.DateTimeFormat` ISO week or a 1-line helper.
- How the Postgres trigger (D-13) writes the `first_api_key_added_at` marker — direct UPDATE on `auth.users` is restricted; `SECURITY DEFINER` function called by the trigger, mirroring `session_count`.

### Deferred Ideas (OUT OF SCOPE)

- Vercel Pro 2-cron limit lift / Railway cron consolidation — explicitly deferred per ROADMAP open-decision note.
- Per-state Vitest fixtures for the long tail of `WIDGET_REGISTRY` widgets outside DEFAULT_LAYOUT + Performance + Scenario.
- In-product server-side IP allowlisting on API keys.
- Storybook visual catalog for widget states.
- Playwright visual snapshots for the state matrix.
- Audit-log JSON export format (CSV only).
- Onboarding-funnel cohort comparison dashboard in PostHog (server-side event firing IS in scope; dashboard config is post-merge ops).
- Real-exchange E2E coverage in CI (no stub).

---

## Phase Requirements

> The 6 requirement IDs the phase MUST address (per `.planning/REQUIREMENTS.md`). Every plan task in `11-VALIDATION.md` traces back to one or more of these.

| ID | Description | Research Support |
|----|-------------|------------------|
| ONBOARD-01 | First authenticated `/allocations` visit nudges the "Connect Exchange" flow proactively (single-step onboarding — dismissable but re-surfaced until the first key is connected) | Pattern 1 (server-rendered count source-of-truth) + Pitfall 6 (SSR-safe sessionStorage) — both inform Plan 05 |
| ONBOARD-02 | Mandate quick-set (minimum: `max_weight` + preferred types) pre-populates proactively on first visit using the existing Phase 02 MANDATE pattern | Existing `update_allocator_mandates` RPC + `MandateForm.tsx` chip pattern — Plan 05 reuses both verbatim |
| ONBOARD-03 | `/security` page audited for institutional LP expectations: SOC-2 status, key-encryption details, IP allowlisting option on API keys, audit-log export link, withdrawal-permission warning on every API-key add step (no new attestations invented — only surface existing truth) | Pattern 3 (audit-log CSV route via `audit_log_owner_read` RLS) + Pitfall 7 (`@audit-skip` pragma) — Plan 02 + Plan 06 |
| ONBOARD-04 | Full state matrix per allocator-facing widget: loading / empty / partial / error / success | Pattern 4 (5-mode `<WidgetState>` primitive composing existing `EmptyState`/`Card`/`Skeleton`) + Pitfall 4 (no internal state) — Plan 04 |
| ONBOARD-05 | PostHog events wired for the onboarding funnel: `signup` → `first_api_key_added` → `first_sync_success` → `first_bridge_surfaced` → `first_outcome_recorded` | Pattern 1 (Postgres trigger + RPC marker writes) + Pattern 2 (single-fire reader via `trackUsageEventServer`) + Pitfall 1 (4 INSERT paths) + Pitfall 3 (PostHog dedupe) — Plans 01 + 03 |
| ONBOARD-06 | Playwright E2E covering the full flow runs in CI (project currently runs 4 of 21 specs — this one gets wired up) | Pattern 5 (E2E template from `full-flow.spec.ts`) + Pitfall 5 (validate-and-encrypt stub) + Pitfall 8 (CI secret gating) — Plan 07 |

---

## Project Constraints (from CLAUDE.md)

> Project-wide directives extracted from `./CLAUDE.md` and `./AGENTS.md`. The planner and executor MUST honor these — they have the same authority as locked decisions.

- **Banned packages:** `axios`, `react-native-international-phone-number`, `react-native-country-select`, `@openclaw-ai/openclawai`. Use native `fetch()` or `undici` instead. Phase 11 introduces ZERO new dependencies — no risk surface here.
- **Next.js 16 doc-first protocol (AGENTS.md):** "This is NOT the Next.js you know. This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code." Plans 03 + 05 + 06 + 07 all touch Next.js Server Components / route handlers / metadata; executors MUST consult `node_modules/next/dist/docs/` per file before implementation.
- **Middleware rename (Next.js 16):** `src/proxy.ts` is the project's middleware file (not `src/middleware.ts`). No Phase 11 file touches the middleware — but document this so executors don't introduce a new `middleware.ts`.
- **Async patterns (Next.js 15+):** `params`, `searchParams`, `cookies()`, `headers()` are all async. `/api/me/audit-log/export/route.ts` (Plan 02) does NOT take params or searchParams (no dynamic segments) — but the user-scoped Supabase client at `src/lib/supabase/server.ts` already uses `await cookies()` internally; the plan inherits this correctly.
- **Design system (DESIGN.md):** All visual decisions consult `DESIGN.md`. Phase 11 UI-SPEC.md already extracts the locked tokens — executors copy from UI-SPEC.md, do NOT re-derive from DESIGN.md.
- **Skill routing:** `/qa` after any UI change (per CLAUDE.md). `/ship` for commits (never manual `git commit`). After Plan 06 ships UI to `/security` + wizard + `/profile?tab=security`, manual `/qa` is the final acceptance gate.
- **Three-client Supabase split (ARCHITECTURE.md):** Plan 02 uses `createClient` (user-scoped, RLS); Plan 03 uses `createAdminClient` (service-role) for the marker stamps. Crossing the boundary is an audited exception per ADR-0003 — Plan 02 explicitly forbids `createAdminClient` in the audit-log export route because RLS handles per-user scoping.
- **`server-only` import:** Required on every module that touches secrets, posthog-node, or admin-client paths. `src/lib/analytics/onboarding-funnel.ts` (Plan 03) MUST start with `import "server-only"`.
- **No `axios`, no custom fetch wrappers:** Use native `fetch()` (browser) or `posthog-node`/`@supabase/supabase-js` (server). Phase 11 obeys.

---

## Architectural Responsibility Map

> Maps each Phase 11 capability to its primary architectural tier owner. Sanity-checks task assignments — e.g., the audit-log CSV download is API-tier, not browser-tier; the onboarding banner visibility is determined server-side, not client-side.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| `api_keys` insert detection (D-13 single-fire) | Database | — | Postgres trigger (statement-level on table) is the only place that fires uniformly for all 4-5 INSERT paths (Pitfall 1). Per-route emission would duplicate or miss. |
| `first_api_key_added` PostHog emission | Frontend Server (RSC) | Database (marker) | Marker stamped by trigger (DB); reader fires PostHog on next dashboard request from `/allocations/page.tsx` Server Component. |
| `first_sync_success` PostHog emission | Worker (Python) + Frontend Server | Database (marker) | Worker calls `stamp_first_sync_success` RPC after first `persist_allocator_holdings`; reader in `/allocations` Server Component fires PostHog. |
| `first_bridge_surfaced` PostHog emission | Frontend Server (RSC) | — | `/allocations` Server Component reads `flaggedHoldings.length` from payload; if `>0` and marker absent, stamp + emit atomically. |
| `first_outcome_recorded` marker stamp | API (route handler) | Database (marker) | `POST /api/allocator/scenario/commit` + `POST /api/match/decisions/holding` route handlers stamp `first_outcome_at` after successful insert; reader emits PostHog. |
| Audit-log CSV export | API (route handler) | Database (RLS) | `GET /api/me/audit-log/export` reads `audit_log` via user-scoped client; `audit_log_owner_read` RLS at `migration 010:179` enforces per-user scoping. |
| OnboardingBanner (S1) visibility | Frontend Server (RSC) | Frontend Client (sessionStorage) | `apiKeysCount` computed server-side (D-02 LOCKED, no localStorage); sessionStorage dismissal is client-only post-mount (Pitfall 6). |
| MandateQuickSetCard (S2) visibility | Frontend Server (RSC) | Frontend Client (sessionStorage) | Same predicate split as S1; uses `mandateIsSet` derived server-side from existing mandate row. |
| `<WidgetState>` primitive | Frontend Client | — | Pure presentational dispatcher; stateless (Pitfall 4). Widget owners manage mode externally. |
| WithdrawalWarningStrip (S5) + WizardIpAllowlistHint (S7) | Frontend Client | — | Static client components mounted in WizardClient parent layout; no data dependencies. |
| `/security` page edits (S4a/S4b/S4c) | Frontend Server (RSC) | — | Public + indexable Server Component; surgical content patches only. No new data dependencies. |
| AuditLogSubsection (S6) | Frontend Client | API (download trigger) | Client component with button → `fetch /api/me/audit-log/export` → Blob download via `URL.createObjectURL`. |
| ProfileTabs `security` tab (allocator-only) | Frontend Server | — | Tab routing logic is server-side via existing `parseTabParam` + `ALLOCATOR_ONLY_KEYS`. |
| E2E spec | E2E (Playwright) | CI | Spec walks browser flow; CI gate (`if: secrets.TEST_SUPABASE_URL != ''`) determines whether the spec runs at all. |

**Sanity check:** Every Phase 11 capability has its primary tier match a verified codebase analog. No tier crossing without an existing precedent (the API → DB tier crossing is mediated by RLS; the worker → DB tier crossing is mediated by `SECURITY DEFINER` RPC; the API → service_role boundary at `createAdminClient` is gated by ADR-0003 categories).

---

## Standard Stack

> Every dependency listed here is ALREADY INSTALLED. Phase 11 introduces ZERO new npm or pip dependencies (verified `package.json` 2026-04-26).

### Core (already installed — verified versions)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | `^16.2.3` | App Router, Server Components, route handlers | Project-wide; AGENTS.md doc-first protocol applies |
| `react` | `19.2.4` | Component library | Project-wide |
| `@supabase/ssr` | `^0.10.0` | Cookie-bridged Supabase client (user-scoped, server-side) | `src/lib/supabase/server.ts` already uses; Plan 02 inherits |
| `@supabase/supabase-js` | `^2.101.1` | Service-role admin client + RPC calls | Plan 01 SQL functions; Plan 03 admin marker writes; Plan 07 E2E seed |
| `posthog-node` | `^5.29.2` | Server-side PostHog event capture | `src/lib/analytics/usage-events.ts` already uses; Plan 03 reuses `trackUsageEventServer` verbatim |
| `posthog-js` | `^1.367.0` | Client-side PostHog (NOT used in Phase 11 — server-side only per D-13) | Existing dependency; Phase 11 explicitly avoids client-side analytics |
| `server-only` | `^0.0.1` | Compile-time leak guard on server modules | Required on `usage-events.ts` and (new) `onboarding-funnel.ts` |
| `vitest` | `^4.1.2` | Unit test runner | Existing test infrastructure |
| `@testing-library/react` | `^16.3.2` | RTL for component tests | Existing |
| `@testing-library/jest-dom` | `^6.9.1` | DOM matchers | Existing |
| `jsdom` | `^29.0.1` | DOM shim for Vitest | Existing |
| `@playwright/test` | `^1.59.1` | E2E runner | Existing; Plan 07 uses |

### Supporting (already installed — used incidentally)

| Library | Purpose | Plan |
|---------|---------|------|
| `@upstash/ratelimit` | Rate limiting | Plan 02 explicitly does NOT use (audit-log size <50KB; not a bucket candidate per RESEARCH §Don't-Hand-Roll). |
| `zod` | Body validation on API routes | Existing `/api/preferences` route uses; Plan 05 calls /api/preferences as-is. |
| `react-markdown`, `rehype-sanitize`, `remark-gfm` | Notes rendering | NOT used by Phase 11 (notes are Phase 08 surface). |

### Python (analytics-service — already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `supabase` | `2.15.1` | Service-role client for RPC calls | Plan 03 Task 2 calls `ctx.supabase.rpc("stamp_first_sync_success", ...)` |
| `pytest` | `7.x` | Test runner | Existing |
| `pytest-asyncio` | — | Async test fixtures | Plan 03 Task 2 worker test |
| `pytest-mock` | — | Mocks | Plan 03 Task 2 mocks `ctx.supabase` |

### Alternatives Considered (and rejected)

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Postgres trigger for `first_api_key_added` | Per-route PostHog emission in 4-5 INSERT call sites | **Rejected:** duplicate/missing fire risk; couples analytics to every new INSERT path. |
| `posthog-python` in analytics-service | Direct Python `posthog.capture()` after sync success | **Rejected:** adds dep + key sprawl; the marker pattern via RPC is the contract. |
| `csv-stringify` npm package for audit-log CSV serialization | RFC 4180 hand-rolled escape | **Rejected:** project precedent (`src/lib/csv.ts`) is hand-rolled; matches existing parse-side idiom. |
| Storybook for widget state catalog | Visual catalog | **Rejected per CONTEXT `<deferred>`:** unanimous Q4 vote on Vitest-only. |
| Playwright visual snapshots | Pixel-perfect state regression | **Rejected per CONTEXT `<deferred>`:** Vitest fixtures sufficient. |
| Supabase preview branches for E2E | Per-PR ephemeral DB | **Rejected per D-15:** too costly + lacks seed scripts; dedicated test project is the path. |

**Installation:** ZERO new packages. `npm install` produces no diff for Phase 11.

**Version verification:**
```bash
npm view posthog-node version          # confirms ^5.29.2 latest
npm view @supabase/ssr version         # confirms ^0.10.0 latest
npm view next version                   # confirms ^16.2.3 latest
```

All three were verified current as of 2026-04-26 against `package.json`. No upgrades needed.

---

## Architecture Patterns

> The 5 numbered patterns below are the structural templates Plans 01-07 reference by line number for executor `read_first` guidance. Section heading parity matters more than absolute line numbers (which may shift slightly when this file is rebuilt).

### Recommended Project Structure

```
src/
├── app/
│   ├── api/
│   │   └── me/
│   │       └── audit-log/
│   │           └── export/
│   │               ├── route.ts            # NEW Plan 02
│   │               └── route.test.ts       # NEW Plan 02
│   ├── security/
│   │   └── page.tsx                        # MOD Plan 06 (S4a/S4b/S4c)
│   └── (dashboard)/
│       ├── allocations/
│       │   ├── page.tsx                    # MOD Plan 03 (4-marker reader)
│       │   ├── EmptyState.tsx              # REUSE — do NOT duplicate
│       │   ├── components/
│       │   │   ├── WidgetState.tsx         # NEW Plan 04 (5-mode primitive)
│       │   │   ├── OnboardingBanner.tsx    # NEW Plan 05 (S1)
│       │   │   └── MandateQuickSetCard.tsx # NEW Plan 05 (S2)
│       │   └── widgets/__tests__/
│       │       └── widget-states.fixtures.ts  # NEW Plan 04
│       ├── strategies/new/wizard/
│       │   ├── WithdrawalWarningStrip.tsx  # NEW Plan 06 (S5)
│       │   ├── WizardIpAllowlistHint.tsx   # NEW Plan 06 (S7)
│       │   └── WizardClient.tsx            # MOD Plan 06 (mount S5+S7)
│       └── profile/
│           └── components/
│               └── AuditLogSubsection.tsx  # NEW Plan 06 (S6)
├── lib/
│   ├── analytics/
│   │   ├── usage-events.ts                 # REUSE (trackUsageEventServer)
│   │   ├── usage-events-types.ts           # MOD Plan 03 (extend USAGE_EVENTS)
│   │   └── onboarding-funnel.ts            # NEW Plan 03 (5 helpers)
│   ├── audit-log-csv.ts                    # NEW Plan 02 (RFC 4180 serializer)
│   └── queries.ts                          # MOD Plan 05 (apiKeysCount + mandateIsSet)
└── components/
    └── auth/
        └── ProfileTabs.tsx                 # MOD Plan 06 (security tab)

supabase/migrations/
└── 084_first_api_key_added_trigger.sql     # NEW Plan 01

analytics-service/
└── services/job_worker.py                  # MOD Plan 03 (RPC call after persist)

e2e/
├── onboarding-funnel.spec.ts               # NEW Plan 07
└── helpers/
    ├── seed-test-project.ts                # NEW Plan 07
    └── cleanup-test-project.ts             # NEW Plan 07

.github/workflows/
└── ci.yml                                  # MOD Plan 07 (gated step)
```

### Pattern 1: Postgres Trigger + SECURITY DEFINER Marker Write

**What:** A Postgres trigger fires on `api_keys` INSERT and idempotently stamps `first_api_key_added_at` on `auth.users.raw_user_meta_data` via a `SECURITY DEFINER` function. A symmetric `stamp_first_sync_success(p_user_id UUID)` RPC is GRANT EXECUTE'd to `service_role` for the Python worker to call after the first successful position sync.

**When to use:** Whenever a user-state marker must fire ONCE per user across MULTIPLE distinct write paths (4 INSERT call sites for `api_keys` per Pitfall 1). Replaces per-route emission logic.

**Verbatim template source:** `supabase/migrations/053_session_count_rpc.sql` (verified file path 2026-04-26 via `ls supabase/migrations/`). The file is 94 lines, transactional (`BEGIN;` / `COMMIT;`), with the 7-element pattern below.

**Reference SQL** (composes 053 preamble + idempotent body + DO verifier):

```sql
-- Migration 084: first_api_key_added_at + first_sync_success_at marker primitives
-- Phase 11 / D-13 — single-fire onboarding funnel event source.
--
-- Why this trigger exists
-- -----------------------
-- The api_keys table has FOUR distinct INSERT paths (verified 2026-04-26):
--   1. POST /api/strategies/create-with-key (calls create_wizard_strategy RPC)
--   2. src/components/exchanges/AllocatorExchangeManager.tsx:485 (client-side .insert)
--   3. src/components/strategy/ApiKeyManager.tsx:119 (client-side .insert)
--   4. src/components/strategy/StrategyForm.tsx:105 (client-side .insert)
-- (Plus migration 031's create_wizard_strategy RPC, which is the path 1 invokes.)
-- Per-route emission would either duplicate or miss.

BEGIN;

CREATE OR REPLACE FUNCTION public.stamp_first_api_key_added()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_meta JSONB;
  v_existing TIMESTAMPTZ;
BEGIN
  -- Lock the auth.users row so concurrent INSERTs serialize.
  SELECT raw_user_meta_data
    INTO v_meta
    FROM auth.users
    WHERE id = NEW.user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    -- Defensive: api_keys has FK to auth.users(id), so this should not
    -- happen under normal operation. Don't crash the INSERT — return.
    RETURN NEW;
  END IF;

  v_meta := COALESCE(v_meta, '{}'::JSONB);
  v_existing := NULLIF(v_meta->>'first_api_key_added_at', '')::TIMESTAMPTZ;

  -- Idempotent: only stamp on the FIRST INSERT per user.
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::JSONB)
                              || jsonb_build_object(
                                   'first_api_key_added_at',
                                   to_char(now() AT TIME ZONE 'UTC',
                                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                 )
   WHERE id = NEW.user_id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_first_api_key_added() FROM PUBLIC;

DROP TRIGGER IF EXISTS api_keys_stamp_first_added ON api_keys;
CREATE TRIGGER api_keys_stamp_first_added
  AFTER INSERT ON api_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_first_api_key_added();

-- Symmetric: Python worker calls this RPC via service-role JWT.
CREATE OR REPLACE FUNCTION public.stamp_first_sync_success(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_meta JSONB;
  v_existing TIMESTAMPTZ;
BEGIN
  SELECT raw_user_meta_data INTO v_meta FROM auth.users
    WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  v_meta := COALESCE(v_meta, '{}'::JSONB);
  v_existing := NULLIF(v_meta->>'first_sync_success_at', '')::TIMESTAMPTZ;
  IF v_existing IS NOT NULL THEN RETURN; END IF;
  UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::JSONB)
                              || jsonb_build_object(
                                   'first_sync_success_at',
                                   to_char(now() AT TIME ZONE 'UTC',
                                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                 )
   WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_first_sync_success(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stamp_first_sync_success(UUID) TO service_role;

-- Self-verifying DO block — fails the migration at install time
-- if the function/trigger isn't installed correctly.
DO $$
DECLARE
  has_trigger_fn BOOLEAN;
  has_trigger BOOLEAN;
  has_sync_fn BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'stamp_first_api_key_added' AND p.prosecdef = TRUE
  ) INTO has_trigger_fn;
  IF NOT has_trigger_fn THEN
    RAISE EXCEPTION 'Migration 084 failed: stamp_first_api_key_added function missing or not SECURITY DEFINER';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'api_keys_stamp_first_added' AND tgrelid = 'public.api_keys'::regclass
  ) INTO has_trigger;
  IF NOT has_trigger THEN
    RAISE EXCEPTION 'Migration 084 failed: api_keys_stamp_first_added trigger missing';
  END IF;
  RAISE NOTICE 'Migration 084: stamp_first_api_key_added trigger installed and verified.';

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'stamp_first_sync_success' AND p.prosecdef = TRUE
  ) INTO has_sync_fn;
  IF NOT has_sync_fn THEN
    RAISE EXCEPTION 'Migration 084 failed: stamp_first_sync_success function missing or not SECURITY DEFINER';
  END IF;
  RAISE NOTICE 'Migration 084: stamp_first_sync_success RPC installed and verified.';
END
$$;

COMMIT;
```

**What to copy verbatim from migration 053:**
- `BEGIN; … COMMIT;` transaction wrapper
- `LANGUAGE plpgsql SECURITY DEFINER` declarator
- `SET search_path = pg_catalog, public` (Pitfall 2 — without this, prod build fails)
- `SELECT … FOR UPDATE` row lock pattern
- `COALESCE(v_meta, '{}'::JSONB) || jsonb_build_object(...)` merge idiom
- `to_char(... AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` ISO timestamp formatter
- `REVOKE ALL ... FROM PUBLIC;` lockdown

**What to vary from 053:**
- Function name → `stamp_first_api_key_added` (no `p_user_id` arg — reads `NEW.user_id` from trigger context).
- Function body → idempotent (early `RETURN NEW` if marker already set, NOT `RAISE EXCEPTION`).
- Bind point → `CREATE TRIGGER api_keys_stamp_first_added AFTER INSERT ON api_keys FOR EACH ROW EXECUTE FUNCTION ...` (no `service_role` GRANT — trigger fires under table-owner role).
- `stamp_first_sync_success(p_user_id UUID)` is the symmetric RPC (callable by Python worker via service-role JWT — explicit GRANT EXECUTE).

### Pattern 2: PostHog Server-Side Capture via posthog-node — Single-Fire via Markers

**What:** A server-only helper reads `auth.users.raw_user_meta_data.${marker}_at` (set by trigger/RPC/route stamp) and `${marker}_emitted_at` (set by this helper). On first call where `${marker}_at` is set AND `${marker}_emitted_at` is absent, fires `posthog-node` capture and stamps `${marker}_emitted_at`. Idempotent across requests.

**When to use:** Any one-shot funnel event whose source is a database row creation, async worker completion, or route side effect.

**Verbatim primitive source:** `src/lib/analytics/usage-events.ts` (verified file 2026-04-26):

```typescript
// src/lib/analytics/usage-events.ts (existing — DO NOT MODIFY)
import "server-only";
import { PostHog } from "posthog-node";
import type { UsageEvent } from "./usage-events-types";

let _serverClient: PostHog | null = null;

function getServerClient(): PostHog | null {
  if (_serverClient !== null) return _serverClient;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;  // graceful no-op when PostHog not configured
  _serverClient = new PostHog(key, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    flushAt: 1,           // ship events even on cold-finish Vercel functions
    flushInterval: 0,
  });
  return _serverClient;
}

export async function trackUsageEventServer(
  event: UsageEvent,
  distinctId: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  const client = getServerClient();
  if (!client) return;
  try {
    client.capture({
      distinctId,
      event,
      properties: { ...(properties ?? {}), source_layer: "server" },
    });
  } catch (err) {
    console.warn("[usage-analytics] server capture failed (non-blocking):", err);
  }
}
```

**New helper** at `src/lib/analytics/onboarding-funnel.ts` (Plan 03 Task 1 ships this):

```typescript
import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { trackUsageEventServer } from "./usage-events";
import { FUNNEL_STEP, type OnboardingMarker, type UsageEvent } from "./usage-events-types";

/**
 * Phase 11 / D-13 + D-14 — single-fire onboarding funnel emitter.
 * Pattern: source side stamps `${marker}_at` (trigger / RPC / explicit stamp);
 * reader (this helper) checks if `${marker}_at` set AND `${marker}_emitted_at`
 * absent. If so, fire PostHog and stamp `${marker}_emitted_at`. Idempotent.
 *
 * At-least-once semantics: if stamp UPDATE fails, next request fires again.
 * PostHog dashboards dedupe by distinct_id + event + properties (Pitfall 3).
 */
export async function maybeEmitOnboardingEvent(
  admin: SupabaseClient,
  user: User,
  marker: Exclude<OnboardingMarker, "signup">,
): Promise<boolean> {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const stampedAt = meta[`${marker}_at`] as string | undefined;
  const emittedAt = meta[`${marker}_emitted_at`] as string | undefined;
  if (!stampedAt || emittedAt) return false;

  await trackUsageEventServer(marker satisfies UsageEvent, user.id, {
    funnel_step: FUNNEL_STEP[marker],
    funnel_event_name: marker,
    cohort_week_iso: (meta.cohort_week_iso as string | undefined) ?? null,
    stamped_at: stampedAt,
  });

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...meta, [`${marker}_emitted_at`]: new Date().toISOString() },
  });
  if (error) {
    console.warn(`[onboarding-funnel] failed to stamp ${marker}_emitted_at:`, error.message);
  }
  return true;
}
```

**5 fire sites** (Plan 03 Task 2 wires these in `/allocations/page.tsx` via `Promise.allSettled`):
1. `signup` — first authenticated `/allocations` request per user (`maybeEmitSignup` helper stamps `signup_emitted_at` + `cohort_week_iso`).
2. `first_api_key_added` — Postgres trigger (Plan 01) sets `first_api_key_added_at`; reader emits.
3. `first_sync_success` — Python worker (Plan 03 Task 2) calls `stamp_first_sync_success` RPC; reader emits.
4. `first_bridge_surfaced` — `/allocations/page.tsx` reads `flaggedHoldings.length`; if `>0` and marker absent, helper stamps `first_bridge_surfaced_at` + emits atomically.
5. `first_outcome_recorded` — `POST /api/allocator/scenario/commit` + `POST /api/match/decisions/holding` (Plan 03 Task 3) call `stampOutcomeMarker(admin, user.id)` after successful insert; reader emits.

### Pattern 3: Authenticated Route Handler + RLS-Scoped Read + CSV Export

**What:** A `GET /api/me/audit-log/export` route handler reads `audit_log` via the user-scoped Supabase client (cookies-bridged), inheriting the existing `audit_log_owner_read` RLS policy at `migration 010_portfolio_intelligence.sql:179` (verified — `USING (user_id = auth.uid())`). Streams CSV with `Content-Disposition: attachment; filename=...`.

**When to use:** Any authenticated read-and-export flow where RLS already encodes the per-user scoping. NEVER use `createAdminClient` for per-user read paths — RLS is the contract.

**Reference shape** (Plan 02 ships this):

```typescript
// src/app/api/me/audit-log/export/route.ts (NEW — Plan 02)
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serializeAuditLogCsv, type AuditLogRow } from "@/lib/audit-log-csv";

/**
 * GET /api/me/audit-log/export — D-05 self-serve audit-log download.
 *
 * Reads audit_log under the existing audit_log_owner_read RLS policy
 * (migration 010:179). No admin client. No new RPC.
 *
 * @audit-skip: read-only export of caller's own audit_log rows. The
 *   download itself does not mutate state; an audit emission for the
 *   download would create an audit-log-of-audit-logs feedback loop.
 *   Out of scope per D-05 ("download a CSV of the last 90 days").
 */
export const dynamic = "force-dynamic";  // never ISR-cache a per-user export

export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from("audit_log")
    .select("created_at, action, entity_type, entity_id, metadata")
    .gte("created_at", ninetyDaysAgo)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[api/me/audit-log/export] query failed:", error);
    return NextResponse.json({ error: "Failed to read audit log" }, { status: 500 });
  }

  const csv = serializeAuditLogCsv((rows ?? []) as AuditLogRow[]);
  const filename = `quantalyze-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
```

**Companion serializer** at `src/lib/audit-log-csv.ts` (Plan 02 Task 1):

```typescript
// src/lib/audit-log-csv.ts (NEW — Plan 02)
//
// Why a new module:
//   src/lib/csv.ts only exports parse-side helpers (sanitizeCsvValue,
//   parseCsvLine, parseCsv, parseCsvWithSchema). Export-side
//   serialization is greenfield.
//
// RFC 4180 escape rules (export side):
//   If value contains , " CR LF → wrap in double-quotes; double internal quotes.
//   Otherwise emit as-is.
//
// CSV injection (formula start chars =, +, -, @, TAB, CR) is handled
// at PARSE time by sanitizeCsvValue in csv.ts. Export side only
// conforms to RFC 4180 — the receiver decides whether to sanitize.

export interface AuditLogRow {
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
}

export function escapeCsvValue(value: string): string {
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function serializeAuditLogCsv(rows: AuditLogRow[]): string {
  const header = "occurred_at,action,entity_type,entity_id,metadata_summary\n";
  const body = rows.map((r) => {
    const summary = r.metadata ? JSON.stringify(r.metadata) : "";
    return [
      r.created_at,
      escapeCsvValue(r.action),
      escapeCsvValue(r.entity_type),
      r.entity_id ?? "",
      escapeCsvValue(summary),
    ].join(",");
  }).join("\n");
  return rows.length === 0 ? header : `${header}${body}\n`;
}
```

**RLS dependency** (verified `migration 010:179`):
```sql
CREATE POLICY audit_log_owner_read ON audit_log FOR SELECT
  USING (user_id = auth.uid());
```

The user-scoped Supabase client (cookies-bridged via `@supabase/ssr`) automatically forwards `auth.uid()` to Postgres. The route handler does NOT need an explicit `WHERE user_id = $caller`; RLS handles it.

**Audit-coverage compatibility:** The `@audit-skip:` pragma above the `.from("audit_log").select(...)` call documents intent for the test in `src/__tests__/audit-coverage.test.ts`. Pitfall 7 below details the regex shape.

### Pattern 4: Shared React State Primitive Composing Existing Primitives

**What:** A stateless 5-mode dispatcher `<WidgetState mode={mode}>` that composes `EmptyState.tsx`, `Card`, and `Skeleton` primitives. Widget owners pass props per mode; the primitive holds NO `useState` / `useEffect` / `useRef` (Pitfall 4). EmptyState.tsx is REUSED for `mode="empty"` — never duplicated.

**When to use:** Wrap any widget body that needs uniform 5-state rendering (loading / empty / partial / error / success). Used by all 7 DEFAULT_LAYOUT widgets + future widget bodies.

**Reference implementation** (Plan 04 ships this):

```typescript
// src/app/(dashboard)/allocations/components/WidgetState.tsx (NEW — Plan 04)
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Phase 11 / D-10 — Shared widget state primitive.
 *
 * Stateless dispatcher on `mode`. Widget owners manage mode externally
 * (Pitfall 4 — primitive holds NO useState/useEffect). Hooks belong
 * above the primitive in the widget owner.
 *
 * EmptyState.tsx (Phase 07) is the visual reference for `mode="empty"`.
 * Mirrors the centered Card layout + accent CTA without duplicating its
 * zero-state copy — the primitive accepts caller-supplied strings via
 * the `empty` prop so each widget tells its own story.
 */
export type WidgetStateMode = "loading" | "empty" | "partial" | "error" | "success";

export interface WidgetStateProps {
  mode: WidgetStateMode;
  children?: ReactNode;
  partial?: { pill: string; children: ReactNode };
  error?: { message: string; onRetry?: () => void };
  empty?: { title: string; description?: string; ctaHref?: string; ctaLabel?: string };
}

export function WidgetState(props: WidgetStateProps) {
  if (props.mode === "loading") {
    return (
      <Card aria-busy="true">
        <Skeleton className="h-5 w-1/3 mb-4" />
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }

  if (props.mode === "empty") {
    return (
      <Card className="text-center py-8">
        {props.empty?.title && (
          <h3 className="text-lg font-semibold text-text-primary mb-2">
            {props.empty.title}
          </h3>
        )}
        {props.empty?.description && (
          <p className="text-sm text-text-secondary max-w-md mx-auto mb-4">
            {props.empty.description}
          </p>
        )}
        {props.empty?.ctaHref && props.empty?.ctaLabel && (
          <Link
            href={props.empty.ctaHref}
            className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            {props.empty.ctaLabel}
          </Link>
        )}
      </Card>
    );
  }

  if (props.mode === "partial") {
    return (
      <div className="relative">
        {props.partial?.pill && (
          <>
            {/* Dual-ARIA — UI-SPEC AC #16: visible aria-hidden + sr-only sibling */}
            <span
              aria-hidden="true"
              className="absolute top-2 right-2 inline-flex items-center rounded-md bg-warning/5 border border-warning px-2 py-0.5 text-xs text-warning"
            >
              {props.partial.pill}
            </span>
            <span className="sr-only">State: {props.partial.pill}</span>
          </>
        )}
        {props.partial?.children}
      </div>
    );
  }

  if (props.mode === "error") {
    return (
      <Card
        role="alert"
        aria-live="polite"
        className="border-negative/30 bg-negative/5"
      >
        <p className="text-sm text-text-primary mb-2">
          {props.error?.message ?? "Something went wrong."}
        </p>
        {props.error?.onRetry && (
          <button
            type="button"
            onClick={props.error.onRetry}
            className="text-sm text-accent underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            Retry
          </button>
        )}
      </Card>
    );
  }

  // mode === "success"
  return <>{props.children}</>;
}
```

**EmptyState reuse** (verified `src/app/(dashboard)/allocations/EmptyState.tsx` 2026-04-26):
The existing primitive renders a `<Card className="text-center py-12">` with Instrument Serif headline + body + accent CTA `<Link href="/profile?tab=exchanges">Connect Exchange →</Link>`. The new `<WidgetState>` primitive's `mode="empty"` branch mirrors this layout (centered text, optional accent CTA) but accepts caller-supplied strings — it does NOT duplicate the "No positions to analyze yet." copy. EmptyState.tsx remains the canonical zero-state for the empty `/allocations` page; `<WidgetState>` provides per-widget zero-states.

**Per-widget × per-state matrix** (Plan 04 Task 2 ships fixtures for all 7 DEFAULT_LAYOUT widgets):

```typescript
// src/app/(dashboard)/allocations/widgets/__tests__/widget-states.fixtures.ts (NEW — Plan 04)
import type { ReactElement } from "react";
import type { WidgetStateProps } from "../../components/WidgetState";

export const commonStateProps = {
  loading: { mode: "loading" as const } satisfies WidgetStateProps,
  empty: {
    mode: "empty" as const,
    empty: {
      title: "Nothing to show yet",
      description: "Connect a key to populate this widget.",
      ctaHref: "/profile?tab=exchanges",
      ctaLabel: "Add data",
    },
  } satisfies WidgetStateProps,
  partial: {
    mode: "partial" as const,
    partial: { pill: "Syncing 2 of 3 venues", children: null },
  } satisfies WidgetStateProps,
  error: {
    mode: "error" as const,
    error: { message: "Could not load this widget." },
  } satisfies WidgetStateProps,
} as const;

// 7 entries — typed against each widget's actual Props (D-12 LOCKED — no `any`)
export const WIDGET_MATRIX: WidgetMatrixEntry<unknown>[] = [
  // Filled by executor with bridge / kpi / equity / holdings / allocation / mandate / outcomes
];
```

### Pattern 5: Playwright E2E with Seeded Test Supabase + Cleanup Helpers

**What:** A Playwright spec that boots a deterministic test allocator in a dedicated test Supabase project (NOT preview branches per CONTEXT D-15), walks the full happy path with `validate-and-encrypt` stubbed via `page.route()`, asserts marker presence on `auth.users.raw_user_meta_data` (NOT PostHog directly — PostHog is fire-and-forget and not query-friendly), and cleans up via `auth.admin.deleteUser` cascade.

**When to use:** Full first-10-minutes happy-path E2E. ONBOARD-06 success gate.

**Template source:** `e2e/full-flow.spec.ts` (verified file 2026-04-26 — covers `/strategies` legacy flow signup → key add → factsheet, NOT the allocator path. The new spec adapts the structural patterns: signup, login, page navigation, but writes new assertions for `/allocations`, Bridge, and outcome).

**Reference shape** (Plan 07 ships this):

```typescript
// e2e/onboarding-funnel.spec.ts (NEW — Plan 07)
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  seedTestAllocator,
  seedBridgeCandidate,
  type SeededAllocator,
} from "./helpers/seed-test-project";
import {
  cleanupTestAllocator,
  cleanupTestStrategy,
} from "./helpers/cleanup-test-project";

const HAS_TEST_DB =
  Boolean(process.env.TEST_SUPABASE_URL) &&
  Boolean(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY);

test.describe(HAS_TEST_DB ? "Onboarding funnel E2E" : "Onboarding funnel E2E (skipped — no TEST_SUPABASE_*)", () => {
  test.skip(!HAS_TEST_DB, "TEST_SUPABASE_URL not configured — D-16 gate");

  let allocator: SeededAllocator;

  test.beforeAll(async () => {
    allocator = await seedTestAllocator();
  });
  test.afterAll(async () => {
    if (allocator) await cleanupTestAllocator(allocator.userId);
  });

  test("full happy-path completes in <60s + 5 funnel markers stamped", async ({ page }) => {
    test.setTimeout(60_000);

    // Pitfall 5 — stub the exchange-side validate-and-encrypt route.
    await page.route("**/api/keys/validate-and-encrypt", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, scopes: ["read"] }),
      });
    });

    // Login + walk full path...
    // (signup → /allocations banner → /profile?tab=exchanges → wizard → key add →
    //  trigger sync via service-role marker stamp → Performance tab populates →
    //  Scenario tab → toggle holding → add Bridge candidate → commit →
    //  /profile?tab=security → Download CSV → verify file)

    // Assert all 5 markers stamped on user_metadata.
    const admin = createClient(
      process.env.TEST_SUPABASE_URL!,
      process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data } = await admin.auth.admin.getUserById(allocator.userId);
    const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
    expect(meta.signup_emitted_at).toBeDefined();
    expect(meta.first_api_key_added_at).toBeDefined();
    expect(meta.first_sync_success_at).toBeDefined();
    expect(meta.first_bridge_surfaced_at).toBeDefined();
    expect(meta.first_outcome_at).toBeDefined();
  });
});
```

**Why marker presence (not PostHog):** PostHog is a fire-and-forget event sink with eventual consistency. Querying it from Playwright would require the PostHog Personal API key + waiting for ingestion lag. The 5 `*_at` markers on `auth.users.raw_user_meta_data` are immediate, queryable via service-role admin API, and are the LOCAL ground truth that the reader fires PostHog from. Marker presence ⇒ PostHog will emit (eventually). This is the contract.

**CI gate** (Plan 07 Task 3 modifies `.github/workflows/ci.yml`):

```yaml
- name: Run onboarding-funnel spec (gated on test Supabase secrets)
  if: ${{ secrets.TEST_SUPABASE_URL != '' }}
  run: |
    npm run start &
    SERVER_PID=$!
    for i in $(seq 1 30); do
      if curl -sf http://localhost:3000 > /dev/null 2>&1; then break; fi
      sleep 1
    done
    npx playwright test e2e/onboarding-funnel.spec.ts --timeout 60000
    kill $SERVER_PID 2>/dev/null || true
  env:
    NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.TEST_SUPABASE_ANON_KEY }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.TEST_SUPABASE_SERVICE_ROLE_KEY }}
    TEST_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
    TEST_SUPABASE_ANON_KEY: ${{ secrets.TEST_SUPABASE_ANON_KEY }}
    TEST_SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.TEST_SUPABASE_SERVICE_ROLE_KEY }}
```

### Anti-Patterns to Avoid

- **Per-route PostHog emission for `first_api_key_added`:** Pitfall 1 demonstrates 4-5 INSERT call sites; emission per-route either duplicates or misses. Trigger is the only safe pattern.
- **Client-side caching of `apiKeysCount`:** D-02 LOCKED forbids — server-renders fresh on every page load.
- **Auto-saving suggested mandate defaults on first render:** Phase 02 D-09 LOCKED forbids silent default save. The user must explicitly click "Save mandate".
- **Duplicating EmptyState.tsx:** D-10 LOCKED reuse mandate. Plan 04 includes a meta-test (`src/__tests__/widget-state-no-duplicate-empty.test.ts`) that walks `src/` via `node:fs` and asserts the "Connect Exchange →" string appears only in allow-listed files.
- **Adding `useState`/`useEffect` to `<WidgetState>`:** Pitfall 4. Primitive must be stateless; widget owners manage mode externally so hook order is preserved.
- **`createAdminClient` in audit-log export route:** RLS handles per-user scoping. Using the admin client would bypass `audit_log_owner_read` and create an IDOR vector.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-route PostHog event emission for `first_api_key_added` | Custom emission logic in 4-5 INSERT call sites | Postgres trigger on `api_keys` AFTER INSERT | Statement-level trigger fires uniformly for all INSERT paths (Pitfall 1). Single source of truth. |
| Posthog ingestion in Python worker | `posthog-python` package | `stamp_first_sync_success` RPC (Plan 01) called from worker; reader in Next.js fires PostHog | Avoids dep + key sprawl in analytics-service; marker pattern is the contract. |
| CSV serializer | `csv-stringify` npm package | Hand-rolled RFC 4180 escape (Plan 02 `src/lib/audit-log-csv.ts`) | Project precedent (`src/lib/csv.ts`) is hand-rolled parse-side; matching idiom for export. |
| Empty-state Card chrome | New `EmptyState`-style component | Reuse `src/app/(dashboard)/allocations/EmptyState.tsx` for `<WidgetState mode="empty">` visual reference | D-10 LOCKED non-duplication mandate; meta-test guards against drift. |
| Loading skeleton primitive | Custom skeleton component | Reuse `src/components/ui/Skeleton.tsx` (`Skeleton`, `SkeletonText`, `SkeletonCard` already exported) | Existing primitive ships `animate-pulse rounded-md bg-border/60` — matches DESIGN.md tokens. |
| Banner / strip chrome | New banner wrapper component | Compose existing `<WarningBanner>` with `className="border-l-4 border-warning bg-warning/5"` override | UI-SPEC AC #14 LOCKED. S1, S5, S7 all share this composition. |
| Card chrome (S2 mandate quick-set) | Custom card with bespoke padding | Use `<Card padding="md">` default (`p-6`) from `src/components/ui/Card.tsx` | UI-SPEC AC #15 LOCKED — no padding override. |
| Audit-log download trigger logic | Server-side streaming pipeline with backpressure | Browser-native `Blob` + `URL.createObjectURL` + `<a download>` click | Audit-log size 5-50 KB per RESEARCH; not a streaming candidate. Plan 02's route handler returns the full CSV in one `NextResponse` body. |
| Test Supabase project setup | Preview branches (Supabase) | Dedicated test project (Plan 07 + user-setup checkpoint) | CONTEXT D-15 LOCKED reasoning: preview branches cost $$/PR + lack seed scripts. |
| ISO week computation in JS | `date-fns/isoWeek` or `dayjs` | 5-line helper in `onboarding-funnel.ts` | One use, ~5 lines, zero added dep. |

**Key insight:** Phase 11 closes capabilities by COMPOSING existing primitives, not by introducing new architecture. Every "don't hand-roll" item has a verified existing analog in the repo. Zero new npm/pip dependencies.

---

## Runtime State Inventory

> Phase 11 is NOT a rename/refactor phase, so this section is informational — but the marker writes to `auth.users.raw_user_meta_data` are runtime state mutations that need explicit cataloging. The 5 markers and their lifecycle are below.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `auth.users.raw_user_meta_data` JSONB — Phase 11 adds 5 marker keys: `first_api_key_added_at`, `first_sync_success_at`, `first_bridge_surfaced_at`, `first_outcome_at`, `signup_emitted_at` (and 4 `*_emitted_at` siblings for the dedupe sentinel). Existing `session_count` and `last_session_start_at` keys (migration 053) are unaffected. | None — markers are append-only via SECURITY DEFINER. No backfill for existing users (RESEARCH §Open Questions: historical onboarding is not retroactive per phase goal "first 10 minutes for a real LP"). |
| Stored data | `audit_log` table (existing — migration 010 + 049 hardening) — Plan 02 adds READ access via `GET /api/me/audit-log/export`. NO new writes; the export route does NOT call `logAuditEvent` (`@audit-skip:` pragma documents intent). | None — read-only consumer of existing table. |
| Stored data | `api_keys` table (existing — migrations 001, 027, 066-079) — Plan 01 adds `AFTER INSERT FOR EACH ROW` trigger `api_keys_stamp_first_added`. No schema change to the table itself. | Verify no pre-existing trigger conflicts. Check migration 077 and 078 (most recent api_keys migrations) for cascading triggers — verified clean (RESEARCH Assumption A8). |
| Live service config | `n8n` workflows / Datadog dashboards / Tailscale ACLs / Cloudflare Tunnel names | None — verified by inspection 2026-04-26. No off-git service config references Phase 11 surfaces. |
| OS-registered state | Vercel Cron jobs / pm2 processes / Windows Task Scheduler / launchd plists | None — verified by inspection. The new ci.yml gated step is GitHub Actions, not OS-registered. |
| Secrets/env vars | `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY` — NEW GitHub Actions secrets (Plan 07 Task 4 user-setup). NOT existing repo state — must be added by the user. | User-setup checkpoint required (Plan 07 Task 4). Without these, the gated step skips silently — which is correct for fork PRs but ALSO means the spec never runs on main-repo PRs unless the user adds them. |
| Secrets/env vars | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (existing) — Phase 11 emission depends on these for non-no-op runs. Already configured in production per `.env.example`. | None — existing infrastructure. |
| Build artifacts / installed packages | `package-lock.json`, `analytics-service/requirements.txt` — Phase 11 introduces ZERO new npm/pip deps. | None — `npm ci` produces no diff. |

**The canonical question:** *After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?* — N/A for Phase 11 (greenfield additive phase, no rename surface).

**Marker lifecycle table** (the 9 user_metadata keys Phase 11 introduces):

| Key | Stamp source | Reader (PostHog emit site) | Idempotent? |
|-----|--------------|----------------------------|-------------|
| `first_api_key_added_at` | Postgres trigger on `api_keys` AFTER INSERT (Plan 01) | `/allocations/page.tsx` Server Component (Plan 03) | Yes — trigger early-returns if already set |
| `first_api_key_added_emitted_at` | `maybeEmitOnboardingEvent` after PostHog capture (Plan 03) | (sentinel — read-only thereafter) | Yes |
| `first_sync_success_at` | Python worker via `stamp_first_sync_success(p_user_id)` RPC (Plan 03 Task 2) | `/allocations/page.tsx` Server Component | Yes — RPC early-returns if already set |
| `first_sync_success_emitted_at` | `maybeEmitOnboardingEvent` after PostHog capture | (sentinel) | Yes |
| `first_bridge_surfaced_at` | `maybeEmitFirstBridgeSurfaced` helper when `flaggedHoldings.length > 0` first time (Plan 03) | (same helper — atomic stamp+emit) | Yes |
| `first_bridge_surfaced_emitted_at` | Same helper | (sentinel) | Yes |
| `first_outcome_at` | `stampOutcomeMarker(admin, user.id)` from `POST /api/allocator/scenario/commit` + `POST /api/match/decisions/holding` (Plan 03 Task 3) | `/allocations/page.tsx` | Yes — helper short-circuits if already set |
| `first_outcome_recorded_emitted_at` | `maybeEmitOnboardingEvent` after PostHog capture | (sentinel) | Yes |
| `signup_emitted_at` + `cohort_week_iso` | `maybeEmitSignup` on first authenticated `/allocations` request (Plan 03) | (same helper — stamp + emit + ISO week) | Yes |

---

## Common Pitfalls

> Numbered pitfalls referenced by Plans 01-07. Plan-level read_first guidance cites these by number ("Pitfall 1", "Pitfall 5", "Pitfall 7", "Pitfall 8" — preserved here).

### Pitfall 1: 4-5 `api_keys` INSERT call sites — single trigger covers all

**What goes wrong:** Per-route PostHog emission misses or duplicates because `api_keys` rows are inserted from MULTIPLE distinct paths.

**Why it happens:** Verified call sites 2026-04-26:
1. `src/components/strategy/StrategyForm.tsx:105` — direct client `.from("api_keys").insert(...)`
2. `src/components/strategy/ApiKeyManager.tsx:119` — direct client `.from("api_keys").insert(...)`
3. `src/components/exchanges/AllocatorExchangeManager.tsx:485-501` — direct client `.from("api_keys").insert(...)` (the allocator-side wizard)
4. `src/app/api/strategies/create-with-key/route.ts:180` — calls `create_wizard_strategy` RPC, which itself INSERTs into `api_keys` (verified `migration 031_wizard_source_column.sql:158`)

(`src/app/api/strategies/finalize-wizard/route.ts` does NOT insert — it only `.update`s `last_sync_at` and calls a different RPC. So 4 production insert paths, not 5.)

A 5th theoretical path exists via test fixtures in migrations 066/067, but those are not production-reachable.

**How to avoid:** Postgres trigger AFTER INSERT FOR EACH ROW on `api_keys` (Plan 01 / Pattern 1). Trigger fires statement-level for ALL paths uniformly. SECURITY DEFINER function with `SET search_path = pg_catalog, public` writes the marker idempotently.

**Warning signs:** If a PostHog dashboard shows duplicate `first_api_key_added` events for a single user, the trigger isn't running OR the reader's emitted_at sentinel check is broken. If the event NEVER fires, check `pg_trigger` table for `api_keys_stamp_first_added`.

### Pitfall 2: Schema push false-positive — typecheck/build green without migration applied

**What goes wrong:** Plan 03's reader code references the `first_api_key_added_at` marker key on `user_metadata`. The TypeScript code compiles cleanly and the Vitest unit tests pass with mocked metadata — even if migration 084 was never applied to the live database. Production `/allocations` requests would silently no-op (marker never present).

**Why it happens:** TypeScript / Vitest do NOT execute the production database. `supabase db push` is a separate manual step. The plan's `[BLOCKING] supabase db push` checkpoint is the gate.

**How to avoid:** Plan 01 Task 3 is `checkpoint:human-verify` with `gate="blocking"` — plan execution cannot continue past Wave 1 without `supabase db push` confirming the trigger + RPC are LIVE in production. Live-DB regression test (`src/__tests__/migration-084-trigger.test.ts`, Plan 01 Task 2) is gated on `HAS_LIVE_DB` env var; with the env set, it inserts a test row and asserts the marker stamps.

**Warning signs:** Production deploy succeeds, all green CI, but `auth.users.raw_user_meta_data.first_api_key_added_at` is never populated for any user. Check `pg_proc` for `stamp_first_api_key_added` with `prosecdef = TRUE`.

### Pitfall 3: PostHog dedupe + at-least-once semantics

**What goes wrong:** The single-fire helper in `onboarding-funnel.ts` fires PostHog and THEN stamps `${marker}_emitted_at`. If the stamp UPDATE fails (e.g., transient Supabase 5xx, network blip), the next request fires PostHog AGAIN.

**Why it happens:** There's no Postgres-level atomic "fire-PostHog-and-stamp" operation; the two are necessarily separate. Plan 03 chose at-least-once over at-most-once because:
- At-most-once would require firing AFTER the stamp succeeds; if the PostHog capture then fails, the event is lost forever.
- At-least-once allows duplicate firing on transient failures.
- PostHog dashboards dedupe on `(distinct_id + event + properties)` — a duplicate fire produces the same row twice (PostHog handles this server-side), but the funnel chart treats it as one event.

**How to avoid:** Document the at-least-once contract in `onboarding-funnel.ts` JSDoc. Trust PostHog's dedupe. If the dedupe is insufficient (e.g., for billing-critical events), add a Postgres-side `INSERT ... ON CONFLICT DO NOTHING` table — but Phase 11's funnel events are observability, not billing. Acceptable.

**Warning signs:** PostHog `signup` (or any other) event count exceeds unique distinct_id count by >1%. Cross-reference with Supabase `auth.users` row count to confirm; investigate the helper's stamp UPDATE error rate via `console.warn` log search.

### Pitfall 4: SSR/Server-Component sessionStorage access

**What goes wrong:** A Client Component reads `sessionStorage["allocations.onboarding_banner_dismissed"]` during render. SSR has no `sessionStorage` (it's a browser-only API); the read throws ReferenceError → Server-side render crashes → Layout shift on hydration even when it doesn't crash.

**Why it happens:** Next.js 16 App Router: `OnboardingBanner.tsx` is `"use client"` but still runs as a Server Component once before hydration (during SSR). `sessionStorage` is `undefined` server-side.

**How to avoid:** The pattern in Plan 05 Task 2:

```typescript
const [mounted, setMounted] = useState(false);
const [dismissed, setDismissed] = useState(false);

useEffect(() => {
  setMounted(true);
  try {
    if (sessionStorage.getItem(STORAGE_KEY) === "1") setDismissed(true);
  } catch {
    // sessionStorage unavailable (private mode etc.) — leave banner visible.
  }
}, []);

if (mounted && dismissed) return null;
// First render: banner visible (server + client agree on first paint — no CLS).
// After mount: client useEffect reads sessionStorage and may HIDE.
```

Server renders the banner unconditionally (apiKeysCount === 0 → render); client useEffect post-mount reads sessionStorage and may HIDE. No CLS on first paint because server and client agree on the initial render.

**Warning signs:** `Hydration error: server rendered X but client rendered Y` console errors. Layout shift visible to users on first navigation to `/allocations`.

### Pitfall 5: Real-exchange round-trips in CI

**What goes wrong:** The E2E spec walks the API-key-add wizard flow which calls `POST /api/keys/validate-and-encrypt` to verify the exchange key + scopes before encrypting. In CI, hitting real Binance/OKX/Bybit APIs is impossible (no test API keys, rate limits, network egress) AND inappropriate (rate-limit pollution).

**Why it happens:** The default wizard flow assumes a real exchange round-trip. Without intervention, the spec hangs or fails on the validate step.

**How to avoid:** Use Playwright's `page.route()` to intercept `validate-and-encrypt` and return a stub:

```typescript
await page.route("**/api/keys/validate-and-encrypt", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, scopes: ["read"] }),
  });
});
```

The wizard advances as if validation succeeded; downstream wizard steps treat the response as authoritative (Phase 06 D-01 — wizard does not re-verify scopes after validate-and-encrypt). The E2E tests the WIZARD flow + ONBOARD funnel, not the exchange integration.

**Warning signs:** E2E spec timeout at the validate step. Real exchange API rate-limit warnings in CI logs.

### Pitfall 6: `audit-coverage.test.ts` gating on `@audit-skip` pragma

**What goes wrong:** The static-analysis test in `src/__tests__/audit-coverage.test.ts` walks `src/` for `.from(...).insert/update/upsert/delete` mutations and asserts each one is followed within 60 lines by a `logAuditEvent(...)` call OR has an `@audit-skip:` pragma within 8 lines above. The new audit-log export route in Plan 02 does NEITHER (it's read-only `.select`, but the regex doesn't distinguish; and there's no `logAuditEvent` because logging the download creates an audit-of-audit feedback loop).

**Why it happens:** The audit-coverage test treats `audit_log` reads with the same scrutiny as other tables. The regex's design assumes any `.from('audit_log')` access is suspect.

**How to avoid:** Add the `@audit-skip:` pragma documenting intent above the `.from("audit_log").select(...)` call (Plan 02 Task 2):

```typescript
// @audit-skip: read-only export of caller's own audit_log rows. The
//   download itself does not mutate state; an audit emission for the
//   download would create an audit-log-of-audit-logs feedback loop.
//   Out of scope per D-05 ("download a CSV of the last 90 days").
const { data: rows, error } = await supabase
  .from("audit_log")
  .select(...)
```

Plan 02 Task 2 acceptance includes `npx vitest run src/__tests__/audit-coverage.test.ts` exits 0 — the pragma is recognized.

**Warning signs:** `audit-coverage.test.ts` failure with message "missing logAuditEvent" pointing at the new export route.

### Pitfall 7: Layout shift / CLS for new banner + card on first paint

**What goes wrong:** Plan 05 ships `<OnboardingBanner>` + `<MandateQuickSetCard>` rendered above `<AllocationsTabs>` when `apiKeysCount === 0`. If the banner is rendered conditionally on a CLIENT-side hook (e.g., reading from a useState that's set in useEffect), the page renders with NO banner first, then the banner pops in — Cumulative Layout Shift (CLS) penalty.

**Why it happens:** Even though the banner's visibility predicate has a server-side input (`apiKeysCount` from page payload), if the conditional render is gated only on a `useEffect`-set state, the initial paint omits the banner.

**How to avoid:** Two mitigations:
1. **Server-side rendering of the banner content:** `apiKeysCount === 0` is a server-rendered prop on `<AllocationsTabs>`. The banner JSX is rendered server-side in the initial HTML. Client useEffect ONLY hides (sets state to dismissed); the banner appears immediately on first paint when not dismissed.
2. **Reserved layout space:** Even when dismissed, the banner's container `<div className="mt-4">` reserves vertical space (mt-4 in the layout, around 16px top margin). The empty banner body collapses, but the container remains so the tabs below don't reflow.

**Warning signs:** Lighthouse CLS score >0.05 on `/allocations` for new allocators. Visual flicker on first paint.

### Pitfall 8: GitHub Actions `secrets.X` vs `vars.X` in `if:` conditions

**What goes wrong:** A naive read of "use vars for non-secret config flags" might lead to using `vars.TEST_SUPABASE_URL` for the gate, but TEST_SUPABASE_URL is a credential (the URL exposes the test project ID — should be a secret).

**Why it happens:** GitHub Actions distinguishes `secrets.*` (encrypted, redacted in logs, NOT visible to fork PRs) from `vars.*` (plain config, visible to fork PRs). Both work in `if:` conditions, but with different security trade-offs:

- `nightly.yml` line 17 uses `if: ${{ vars.STAGING_BASE_URL != '' && vars.STAGING_BASE_URL != ' ' }}` — STAGING_BASE_URL is a public URL config (the staging env URL is not sensitive).
- Phase 11's CI gate uses `if: ${{ secrets.TEST_SUPABASE_URL != '' }}` — TEST_SUPABASE_URL points at a test project's API URL, which combined with anon/service-role keys gives full access. Treat as secret.

CONTEXT D-16 explicitly LOCKS this to `secrets.*`. Both forms are valid GitHub Actions idiom.

**How to avoid:** Use `secrets.TEST_SUPABASE_URL != ''` for the if-gate. On fork PRs, `secrets.*` evaluates to empty string (forks don't see secrets); the gated step skips silently — the desired behavior.

A subtle nuance: in step-level `if:`, GitHub allows reading secrets directly. In job-level `if:`, the same pattern works. Plan 07 Task 3 puts the gate at step level — verified working pattern.

**Warning signs:** Gated step running on fork PRs (would mean secrets are leaking — security bug). Or: gated step skipping on the main repo's PRs even with secrets configured (would mean the if-syntax is wrong).

---

## Code Examples

> Concrete excerpts for the trickier integrations. Every example is verified or grounded in the existing codebase.

### Example 1: Idempotent SECURITY DEFINER marker write (Plan 01)

```sql
-- Phase 11 / migration 084 fragment — idempotent stamp_first_api_key_added.
-- Verbatim derivative of migration 053 lines 42-79 (session_count RPC).

SELECT raw_user_meta_data INTO v_meta FROM auth.users
  WHERE id = NEW.user_id FOR UPDATE;
IF NOT FOUND THEN RETURN NEW; END IF;

v_meta := COALESCE(v_meta, '{}'::JSONB);
v_existing := NULLIF(v_meta->>'first_api_key_added_at', '')::TIMESTAMPTZ;

-- Idempotent: only stamp on first INSERT per user.
IF v_existing IS NOT NULL THEN RETURN NEW; END IF;

UPDATE auth.users
   SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::JSONB)
                            || jsonb_build_object(
                                 'first_api_key_added_at',
                                 to_char(now() AT TIME ZONE 'UTC',
                                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                               )
 WHERE id = NEW.user_id;
```

### Example 2: ISO 8601 week-of-year computation (Plan 03)

```typescript
// Phase 11 / D-14 — cohort_week_iso = "YYYY-Www" (e.g. "2026-W17").
// 5-line helper avoids adding date-fns / dayjs as a dependency.

export function isoWeekString(date: Date): string {
  // ISO 8601: week 1 contains the first Thursday of the year.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
```

### Example 3: Browser CSV download trigger (Plan 06 S6)

```typescript
// Phase 11 / S6 / Plan 06 — AuditLogSubsection download flow.
// Calls Plan 02 route handler; uses Blob + URL.createObjectURL for the download.

const handleDownload = async () => {
  setDownloading(true);
  setError(null);
  try {
    const res = await fetch("/api/me/audit-log/export", {
      method: "GET",
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") ?? "";
    const m = cd.match(/filename="?([^";]+)"?/);
    const filename = m?.[1] ?? `quantalyze-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    setError("Could not download audit log. Please try again.");
    console.warn("[AuditLogSubsection] download failed:", err);
  } finally {
    setDownloading(false);
  }
};
```

### Example 4: 5-marker `Promise.allSettled` reader pattern (Plan 03)

```typescript
// Phase 11 / D-13 — fire onboarding funnel events from /allocations Server Component.
// Non-blocking: failures logged but never crash the page render.
// All 5 helpers run in PARALLEL via Promise.allSettled — total latency = max of 5 (not sum).

import { createAdminClient } from "@/lib/supabase/admin";
import {
  maybeEmitSignup,
  maybeEmitOnboardingEvent,
  maybeEmitFirstBridgeSurfaced,
} from "@/lib/analytics/onboarding-funnel";

// ... in the Server Component, after auth + payload fetch ...
const admin = createAdminClient();
await Promise.allSettled([
  maybeEmitSignup(admin, user),
  maybeEmitOnboardingEvent(admin, user, "first_api_key_added"),
  maybeEmitOnboardingEvent(admin, user, "first_sync_success"),
  maybeEmitOnboardingEvent(admin, user, "first_outcome_recorded"),
  maybeEmitFirstBridgeSurfaced(admin, user, payload.flaggedHoldings?.length ?? 0),
]);
```

### Example 5: SSR-safe sessionStorage with CLS guard (Plan 05)

```typescript
// Phase 11 / S1 / Plan 05 — OnboardingBanner.tsx
// Pitfall 4 (SSR) + Pitfall 7 (CLS) both addressed.

"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { WarningBanner } from "@/components/ui/WarningBanner";

const STORAGE_KEY = "allocations.onboarding_banner_dismissed";

export function OnboardingBanner() {
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === "1") setDismissed(true);
    } catch {
      // sessionStorage unavailable (private mode) — leave banner visible.
    }
  }, []);

  const handleDismiss = () => {
    try { sessionStorage.setItem(STORAGE_KEY, "1"); } catch {}
    setDismissed(true);
  };

  // Server + client first paint AGREE (banner visible).
  // Client useEffect post-mount may HIDE.
  if (mounted && dismissed) return null;

  return (
    <WarningBanner className="border-l-4 border-warning bg-warning/5">
      {/* heading + body + accent CTA + dismiss × — verbatim UI-SPEC §S1 copy */}
    </WarningBanner>
  );
}
```

---

## State of the Art

> Newer patterns/best-practices that constrain Phase 11 vs older approaches. Verified against current Next.js 16 + Supabase + PostHog docs.

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `src/middleware.ts` | `src/proxy.ts` (Next.js 16 rename) | Next.js 16 release | Phase 11 does NOT touch middleware — but executors must NOT introduce a `src/middleware.ts` if a future task adds middleware-level logic (none planned in Phase 11). |
| Sync `params` / `searchParams` in Server Components | `await params`, `await searchParams` (Next.js 15+) | Next.js 15.0 | Phase 11 page components use only static routes (no dynamic segments), so this isn't directly invoked. Plan 06 modifies `src/app/security/page.tsx` which has no `params`/`searchParams`. |
| Sync `cookies()` returning `ReadonlyRequestCookies` | `await cookies()` (Next.js 15+) | Next.js 15.0 | `src/lib/supabase/server.ts:createClient()` already uses `await cookies()` internally — Phase 11 calls inherit this. |
| `next/dynamic` with `ssr: false` from Server Components | Cannot disable SSR from Server Components in Next.js 15+; use Client Component boundary | Next.js 15.0 | Phase 11's banner/card/strips are all Client Components — Pitfall 4 SSR-safe pattern applies. |
| `posthog-js` client-side capture for funnel events | Server-side `posthog-node` (project precedent + CONTEXT D-13 LOCKED) | N/A — project choice | Faster (no client RTT), more reliable (server-side retries via `flushAt: 1`), no client bundle bloat. |
| Hand-rolled `<EmptyState>` per widget | Composed `<WidgetState mode="empty">` reusing `EmptyState.tsx` for visual reference | Phase 07 + Phase 11 D-10 | One source of truth; meta-test enforces non-duplication. |
| Per-route audit-log emission for download | `@audit-skip:` pragma documents read-only intent | Phase 11 D-05 | Avoids audit-of-audit feedback loop. |
| Preview branches for E2E DBs | Dedicated test Supabase project (D-15 LOCKED) | Phase 11 D-15 | Cost + seed-script control. |

**Deprecated/outdated:**
- `posthog-js` server-side capture in route handlers — replaced by `posthog-node` (existing pattern; verified `src/lib/analytics/usage-events.ts`).
- Manual middleware imports of cookies — replaced by `@supabase/ssr` createClient (verified `src/lib/supabase/server.ts`).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The 4 production INSERT call sites for `api_keys` are exhaustive (StrategyForm.tsx:105, ApiKeyManager.tsx:119, AllocatorExchangeManager.tsx:485, create_wizard_strategy RPC). [VERIFIED via grep 2026-04-26] | Pitfall 1 | If a 5th path exists in untracked or generated code, the trigger still fires uniformly (statement-level). Risk is contained by the trigger pattern. |
| A2 | `auth.users.raw_user_meta_data` is read-only via the user-facing API; only SECURITY DEFINER + service-role can write the markers. [CITED: ARCHITECTURE.md envelope encryption section + Supabase docs] | Pattern 1 | If a user could pre-stamp `*_at`, the funnel reader would skip emit. Not a security risk (only delays/prevents the user's own funnel event, not spoofs others'). Acceptable. |
| A3 | Migration 077, 078, 079 (most recent api_keys-related migrations) do NOT install conflicting triggers. [VERIFIED via grep 2026-04-26] | Pitfall 1 | If a conflicting trigger exists, Plan 01 Task 1's read_first guidance instructs the executor to verify before authoring. The DO block at end of migration 084 catches install-time issues. |
| A4 | The dedicated test Supabase project is created and configured by the user BEFORE Plan 07 Task 4 (CI gate flips). [ASSUMED — user-setup checkpoint] | Pattern 5 | Without the project, the gated step is silently skipped on every PR. Correct fork-PR behavior, but ALSO means the spec never runs on main-repo PRs. Plan 07 Task 4 is the user-verify checkpoint. |
| A5 | The static egress IP range(s) for the analytics-service deployment exist and can be published. [ASSUMED — Plan 06 Task 0 is the user-action checkpoint] | UI-SPEC §S4b | If no static IPs exist (Vercel/Railway use dynamic outbound), the executor MUST stop and ask. UI-SPEC §S4b LOCKED: "do NOT invent IPs." Plan 06 Task 0 captures the resolution path (escalate to defer or downgrade to CIDR). |
| A6 | PostHog dashboards dedupe on (distinct_id + event + properties). [CITED: PostHog docs — "events are deduplicated server-side based on distinct_id, event name, and properties hash"] | Pitfall 3 | If dedupe is weaker than assumed, at-least-once retries inflate event counts. Acceptable for observability funnel — PostHog billing is on captures, but Phase 11 expects ≤1.01x amplification. |
| A7 | The new `src/lib/audit-log-csv.ts` does NOT need to coordinate with the existing `src/lib/csv.ts`. [VERIFIED — `src/lib/csv.ts` exports parse-side helpers only: `sanitizeCsvValue`, `parseCsvLine`, `parseCsv`, `parseCsvWithSchema`. No serialize-side exports.] | Pattern 3 | If a future refactor consolidates them, Plan 02's serializer can be moved into `csv.ts`. Independent module is fine for now. |
| A8 | `audit_log_owner_read` RLS policy at `migration 010:179` has not been overridden or weakened. [VERIFIED — `migration 049_audit_log_hardening.sql` adds DENY UPDATE/DELETE but preserves owner-read] | Pattern 3 | If the policy was changed to admin-only, the route would 200 with empty CSVs. Plan 02 Task 2 includes a live-DB integration test (gated on HAS_LIVE_DB) that asserts allocator A cannot see allocator B's rows. |
| A9 | The `posthog-node` library version `^5.29.2` supports `flushAt: 1` and `flushInterval: 0` for cold-finish-friendly capture. [CITED: posthog-node README + verified in `usage-events.ts:46-50`] | Pattern 2 | If a future SDK breaking change drops these flags, server-side captures could miss in cold-start serverless environments. Out of Phase 11 scope to address. |
| A10 | Production allocators do NOT have stale `first_api_key_added_at` markers from prior testing. [ASSUMED — verified via spot-check of 2-3 admin user_metadata; full audit not run] | Runtime State Inventory | If markers exist for production users, they will NOT re-fire (correct behavior). New users get the full funnel. No backfill is part of Phase 11. |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed. (This table is NOT empty — A4, A5, A10 are explicit `[ASSUMED]` and require user acknowledgment via the Plan 06 + Plan 07 user-setup checkpoints.)

---

## Open Questions (RESOLVED)

> 5 questions surfaced during research; ALL RESOLVED via plan decisions.

### Q1: What is the exact path of `POST /api/match-decisions`?

**What we know:** CONTEXT D-13 lists `POST /api/match-decisions` as a fire site for `first_outcome_recorded`. The path uses kebab-case but the actual route file might be elsewhere.

**What was unclear:** Whether the route is at `/api/match-decisions/route.ts` or under a nested path.

**RESOLVED:** Plan 11-03 Task 3 uses the verified path `src/app/api/match/decisions/holding/route.ts` (Phase 09 LIVE-04). The `match/decisions/holding` shape reflects the holding-side of the outcome flow (where the allocator records that they took action on a flagged holding). Plan 03 Task 3 modifies this route to call `stampOutcomeMarker(admin, user.id)` after the successful insert.

### Q2: What is the existing `src/lib/csv.ts` API shape?

**What we know:** A `csv.ts` file exists at `src/lib/csv.ts` per the codebase glob.

**What was unclear:** Whether it exports a serialize-side helper that Plan 02 should reuse vs. ship a new serializer.

**RESOLVED:** Plan 11-02 ships a new module `src/lib/audit-log-csv.ts`. Verified via `grep -n '^export' src/lib/csv.ts`: csv.ts exports ONLY parse-side helpers (`sanitizeCsvValue`, `parseCsvLine`, `parseCsv`, `parseCsvWithSchema`). Serialize-side is greenfield. The new module mirrors csv.ts's RFC 4180 idiom but for export. `escapeCsvValue` + `serializeAuditLogCsv` are the new exports.

### Q3: Should `LoadingState.tsx` and `ErrorState.tsx` ship as separate files alongside `WidgetState.tsx`, or be inlined inside `WidgetState.tsx`?

**What we know:** CONTEXT D-10 mentions "siblings `LoadingState.tsx` + `ErrorState.tsx`" as one option, but explicitly leaves the file layout to Claude's discretion.

**What was unclear:** Whether any non-widget surface needs to reuse the loading skeleton independently.

**RESOLVED:** Plan 11-04 Task 1 INLINES the loading and error renderers inside `WidgetState.tsx`. Rationale (per Plan 04 read_first): no non-widget surface in Phase 11 needs a standalone `LoadingState` component; the existing `Skeleton` + `SkeletonCard` primitives in `src/components/ui/Skeleton.tsx` are the standalone primitives for any non-widget loading surface. Inlining keeps the API surface minimal — one import, one component, five modes. CONTEXT D-10 explicitly permits this choice.

### Q4: Where does `first_bridge_surfaced` fire — Bridge route handler, allocations Server Component, or some other site?

**What we know:** CONTEXT D-13 says "fired in the Bridge route handler when the response includes a non-empty `recommendations` payload for the first time per user."

**What was unclear:** The Bridge endpoints are scattered across `src/app/api/match/...` routes; finding the canonical "Bridge response with recommendations" emission site was nontrivial.

**RESOLVED:** Plan 11-03 Task 1 + Task 2 implement `maybeEmitFirstBridgeSurfaced(admin, user, flaggedCount)` in `src/lib/analytics/onboarding-funnel.ts`. The HELPER is the source side (atomic stamp + emit). The READER fire site is `/allocations/page.tsx` Server Component, which reads `payload.flaggedHoldings.length` from `MyAllocationDashboardPayload` (verified `src/lib/queries.ts` Phase 09 output). When the count is `>0` and the marker is absent, the helper fires both. This sidesteps the "find the right Bridge route" question — the dashboard render is the canonical render where the user SEES the surfaced recommendations.

### Q5: Migration 053 verbatim filename (was it `053_session_count_rpc.sql` or `053_increment_user_session_count.sql`)?

**What we know:** CONTEXT and PATTERNS.md reference migration 053 as the verbatim template.

**What was unclear:** Some notes called the file `053_increment_user_session_count.sql` (after the function name); voice review correction wanted `053_session_count_rpc.sql`.

**RESOLVED:** Verified 2026-04-26 via `ls supabase/migrations/`: the actual filename is **`053_session_count_rpc.sql`**. The function inside is `increment_user_session_count`. Plan 11-01 Task 1 read_first guidance correctly references `supabase/migrations/053_session_count_rpc.sql`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Frontend build + Vitest + Playwright | ✓ | 20.9+ (CI pinned) / 24 LTS (Vercel default) | — |
| npm | Package management | ✓ | matches Node | — |
| Python 3.12+ | analytics-service worker (Plan 03 Task 2) | ✓ | 3.12 (Docker) / 3.14+ (local) | — |
| Supabase CLI | `supabase db push` for migration 084 (Plan 01 Task 3) | ✓ | required for `supabase db push` | Fallback: Supabase Management API (used in Phase 07/08 precedent for migration-history drift) |
| pip | analytics-service deps | ✓ | — | — |
| `posthog-node` | Plan 03 Task 1 server-side capture | ✓ (5.29.2 installed) | — | When `NEXT_PUBLIC_POSTHOG_KEY` missing, capture is no-op (existing pattern) |
| `@playwright/test` | Plan 07 Task 2 E2E spec | ✓ (1.59.1 installed) | — | — |
| Test Supabase project | Plan 07 Task 4 user-setup | ✗ (must be created) | — | Without it, the gated CI step skips silently on every PR (correct fork-PR behavior, but ALSO means the spec never runs on main-repo PRs). Plan 07 Task 4 captures the user-action. |
| GitHub Actions secrets `TEST_SUPABASE_*` | Plan 07 Task 3 + 4 | ✗ (must be set) | — | Same as above — silent skip until configured. |
| Static egress IP range (S4b) | Plan 06 Task 0 | ✗ (must be located in infra docs) | — | UI-SPEC §S4b LOCKED: "do NOT invent IPs." Escalate via Plan 06 Task 0 user-action — either provision IPs (out of phase scope) or defer S4b. |

**Missing dependencies with no fallback:** None blocking the development path. The 3 user-setup items (test project, GitHub secrets, static IPs) gate the FINAL acceptance — but development of the code can proceed without them; the gates only block CI integration and S4b copy completion.

**Missing dependencies with fallback:**
- Test Supabase project — fallback is "spec skips silently" until configured.
- GitHub secrets — same fallback.
- Static egress IPs — fallback is to defer S4b (escalation path documented in Plan 06 Task 0).

---

## Validation Architecture

> Per-phase Nyquist contract. Every task has an `<automated>` verify command. See `11-VALIDATION.md` for the full per-task table — this section provides the framework summary.

### Test Framework

| Property | Value |
|----------|-------|
| Framework (frontend) | Vitest 4.1.2 + @testing-library/react 16.3.2 + jsdom 29.0.1 |
| Framework (e2e) | Playwright 1.59.1 (chromium) |
| Framework (analytics-service) | pytest 7.x with pytest-asyncio + pytest-mock |
| Config files | `vitest.config.ts`, `playwright.config.ts`, `analytics-service/pytest.ini` |
| Quick run command | `npm test` (Vitest single-run) |
| Full suite command | `npm run typecheck && npm run lint && npm test && cd analytics-service && pytest` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| ONBOARD-01 | OnboardingBanner renders when apiKeysCount=0; sessionStorage dismissal works; SSR-safe | unit (RTL) | `npx vitest run src/app/(dashboard)/allocations/components/OnboardingBanner.test.tsx` | ❌ Wave 0 (Plan 05) |
| ONBOARD-02 | MandateQuickSetCard suggests 15% but does NOT auto-save; Save calls /api/preferences | unit (RTL) | `npx vitest run src/app/(dashboard)/allocations/components/MandateQuickSetCard.test.tsx` | ❌ Wave 0 (Plan 05) |
| ONBOARD-03 | /security S4a/S4b/S4c content; WithdrawalWarningStrip + WizardIpAllowlistHint mount; AuditLogSubsection downloads CSV | unit (RTL) + RTL | `npx vitest run src/app/security/page.test.tsx src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.test.tsx ...` | ❌ Wave 0 (Plan 06) |
| ONBOARD-04 | WidgetState 5-mode dispatcher; meta-test for EmptyState non-duplication; 7 widgets × 5 states matrix | unit (RTL) + meta | `npx vitest run src/app/(dashboard)/allocations/components/WidgetState.test.tsx src/__tests__/widget-state-no-duplicate-empty.test.ts src/app/(dashboard)/allocations/widgets/__tests__/widget-states.test.tsx` | ❌ Wave 0 (Plan 04) |
| ONBOARD-05 | Migration 084 trigger + RPC; 5 funnel events fire single-fire; Python worker calls RPC | unit + live-DB + Python pytest | `npx vitest run src/__tests__/migration-084-trigger.test.ts src/lib/analytics/onboarding-funnel.test.ts && cd analytics-service && pytest tests/test_job_worker_first_sync_marker.py` | ❌ Wave 0 (Plans 01 + 03) |
| ONBOARD-06 | E2E walks full path in <60s; 5 markers stamped; Pitfall 5 stub; D-16 silent-skip | E2E (Playwright, gated) | `npx playwright test e2e/onboarding-funnel.spec.ts` | ❌ Wave 0 (Plan 07) |

### Sampling Rate

- **Per task commit:** `npm test` (Vitest single run, ~30s) — runs ALL Vitest tests
- **Per wave merge:** `npm run typecheck && npm run lint && npm test` (~60s) + `cd analytics-service && pytest` (~120s)
- **Phase gate:** Full suite green + `npx playwright test e2e/onboarding-funnel.spec.ts` (gated on TEST_SUPABASE_URL; skips otherwise) + manual `/qa` per project skill routing

### Wave 0 Gaps

Every test file is created in a corresponding plan task — no orphan test references:

- [ ] `src/__tests__/migration-084-trigger.test.ts` — created in Plan 01 Task 2
- [ ] `src/lib/audit-log-csv.test.ts` — Plan 02 Task 1
- [ ] `src/app/api/me/audit-log/export/route.test.ts` — Plan 02 Task 2
- [ ] `src/app/(dashboard)/allocations/components/WidgetState.test.tsx` — Plan 04 Task 1
- [ ] `src/__tests__/widget-state-no-duplicate-empty.test.ts` — Plan 04 Task 1
- [ ] `src/app/(dashboard)/allocations/widgets/__tests__/widget-states.fixtures.ts` + `widget-states.test.tsx` — Plan 04 Task 2
- [ ] `src/lib/analytics/onboarding-funnel.test.ts` — Plan 03 Task 1
- [ ] `analytics-service/tests/test_job_worker_first_sync_marker.py` — Plan 03 Task 2
- [ ] `src/app/(dashboard)/allocations/components/OnboardingBanner.test.tsx` + `MandateQuickSetCard.test.tsx` + `AllocationsTabs.onboarding.test.tsx` — Plan 05 Tasks 2+3
- [ ] `src/app/security/page.test.tsx` — Plan 06 Task 1
- [ ] `src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.test.tsx` + `WizardIpAllowlistHint.test.tsx` — Plan 06 Task 2
- [ ] `src/app/(dashboard)/profile/components/AuditLogSubsection.test.tsx` — Plan 06 Task 3
- [ ] `e2e/onboarding-funnel.spec.ts` — Plan 07 Task 2
- [ ] `e2e/helpers/seed-test-project.ts` + `cleanup-test-project.ts` — Plan 07 Task 1

**Framework install: NONE.** Vitest, Playwright, jsdom, RTL, pytest, pytest-asyncio, pytest-mock all already configured per `STACK.md` and `analytics-service/pytest.ini`.

---

## Security Domain

> 45 threats T-11-01 through T-11-45 are enumerated across the 7 plans' `<threat_model>` blocks. This section maps the threats to ASVS categories and stack-specific patterns.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth (cookies-bridged via `@supabase/ssr`); `auth.getUser()` is the authoritative network-verified check (ADR-0022). Phase 11 inherits — adds no new auth surfaces. |
| V3 Session Management | yes | Supabase session cookies (HttpOnly, SameSite). sessionStorage in Phase 11 stores ONLY UI dismissal state — no session tokens, no PII. |
| V4 Access Control | yes | RLS-as-primary-authorization (ARCHITECTURE.md). `audit_log_owner_read` policy at migration 010:179 is the LOAD-BEARING control for Plan 02; the new ProfileTabs `security` tab is allocator-only via `ALLOCATOR_ONLY_KEYS` (defense-in-depth — RLS on the route is the auth control). |
| V5 Input Validation | yes | `zod` for body validation on existing routes (`/api/preferences` already uses; Plan 05's MandateQuickSetCard calls /api/preferences which runs the existing zod schema). The new audit-log export route has NO body — only a GET request — so input validation is primarily on the cookie-derived `auth.uid()`. |
| V6 Cryptography | yes | Envelope encryption for exchange API keys via Fernet (analytics-service). Phase 11 does NOT touch cryptography — the wizard's withdrawal warning surfaces existing read-only enforcement (Phase 06 D-01) and the IP allowlist hint surfaces existing static IPs. No new crypto primitives. |

### Known Threat Patterns for Next.js + Supabase + Postgres

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR via guessing audit_log row IDs | Information Disclosure | RLS at DB layer (`audit_log_owner_read USING (user_id = auth.uid())`); user-scoped Supabase client (cookies-bridged). Live-DB integration test in Plan 02 Task 2 asserts allocator A cannot see allocator B's rows. (T-11-08, T-11-09) |
| CSV injection (formula start chars in audit_log entries) | Tampering | RFC 4180 quoting in `escapeCsvValue`; documented that parse-side `sanitizeCsvValue` in csv.ts handles import-time injection. Receiving spreadsheet may still execute formulas — documented in module header. (T-11-10) |
| Cross-user metadata write (user A INSERTs api_keys with user_id=B's id) | Elevation of Privilege | RLS on api_keys (Phase 06) restricts INSERT scope. Trigger reads `NEW.user_id` — no spoof vector across users. (T-11-02) |
| Pre-stamping `*_emitted_at` to spoof funnel | Tampering | Markers are written by SECURITY DEFINER + service-role only; user cannot pre-stamp via the user-facing API. Tampering only DELAYS or PREVENTS the user's own funnel event, doesn't spoof for others. Distinct ID is server-derived. (T-11-03, T-11-19) |
| PostHog API key leak via client bundle | Information Disclosure | All emission server-side via `posthog-node`; no `posthog-js` bundling for funnel events. `import "server-only"` on every relevant module. (T-11-20) |
| Test secrets leak via CI logs | Information Disclosure | GitHub Actions auto-redacts secret values. Helpers do NOT log env values (only env-var ABSENCE is logged). (T-11-40) |
| Fork PR exfil of secrets | Elevation of Privilege | GitHub Actions does NOT pass repo secrets to fork PRs by default. `if: secrets.TEST_SUPABASE_URL != ''` evaluates false on forks; step skips. (T-11-41) |
| Session theft → spoof signup | Spoofing | Auth surface inherited from Supabase Auth; Phase 11 introduces no new vectors. (T-11-25) |
| Audit-log download CSRF | Spoofing | GET-only route — CSRF defense is for state-mutating verbs. Same-site cookie attribute on Supabase auth cookie is the broader mitigation. (T-11-14) |
| /security accidentally auth-gated | Spoofing | Test 8 in Plan 06 Task 1 asserts `metadata.robots.index === true`. UI-SPEC AC #10 LOCKED public + indexable. (T-11-34) |
| Test project URL accidentally points at production | Tampering | Plan 07 Task 4 user-verify checkpoint requires explicit confirmation. Long-term: spec could assert URL contains "test"/"staging" — out of phase scope. (T-11-39) |

**Threat Register Summary:** 45 threats (T-11-01 through T-11-45) catalogued across 7 plans. Disposition breakdown:
- **mitigate:** 32 (DB-layer, server-side, or pragma-documented)
- **accept:** 13 (acceptable residual risk; rationale documented per threat)

The mitigate-vs-accept ratio is consistent with project precedent. No high-severity unmitigated risks.

---

## Sources

### Primary (HIGH confidence)

- `supabase/migrations/053_session_count_rpc.sql` — verbatim template for SECURITY DEFINER + JSONB merge pattern (Pattern 1)
- `supabase/migrations/010_portfolio_intelligence.sql:179` — `audit_log_owner_read` RLS policy
- `supabase/migrations/049_audit_log_hardening.sql` — DENY UPDATE/DELETE on audit_log + log_audit_event RPC
- `src/lib/analytics/usage-events.ts` — verbatim `trackUsageEventServer` shape (Pattern 2)
- `src/lib/analytics/usage-events-types.ts` — UsageEvent union (Plan 03 extends)
- `src/app/(dashboard)/allocations/EmptyState.tsx` — D-10 LOCKED reuse target
- `src/components/ui/Card.tsx` + `Skeleton.tsx` + `WarningBanner.tsx` — composition primitives
- `src/components/auth/ProfileTabs.tsx` — ALL_TABS + ALLOCATOR_ONLY_KEYS pattern
- `src/app/(dashboard)/allocations/lib/dashboard-defaults.ts` — DEFAULT_LAYOUT (7 tiles, verified)
- `src/app/security/page.tsx` — 8 anchor IDs verified preserved (Plan 06 Task 1)
- `e2e/full-flow.spec.ts` — D-15 LOCKED template
- `playwright.config.ts` — `retries: 2` (CI), 60s timeout default
- `.github/workflows/ci.yml` lines 87-148 — existing e2e job structure
- `.github/workflows/nightly.yml` line 17 — VARS-vs-SECRETS precedent
- `package.json` 2026-04-26 — verified zero new dependencies needed
- `.planning/codebase/ARCHITECTURE.md` — three-tier split-stack + RLS-as-primary-authorization
- `.planning/codebase/CONVENTIONS.md` — route handler + audit emission patterns
- `.planning/codebase/STACK.md` — verified versions (next 16.2.3, react 19.2.4, posthog-node 5.29.2)
- `.planning/codebase/TESTING.md` — Vitest + Playwright + pytest framework summary

### Secondary (MEDIUM confidence)

- Phase 09.1 PR1 `widget-registry.ts` (~39 entries; not exact count — file is 634 lines with mixed structures)
- AGENTS.md Next.js 16 doc-first protocol
- DESIGN.md token reference (consumed via UI-SPEC.md, not directly)

### Tertiary (LOW confidence — flagged for validation)

- Static egress IP range (Plan 06 Task 0 user-action checkpoint resolves)
- Test Supabase project provisioning (Plan 07 Task 4 user-verify checkpoint resolves)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep verified installed in `package.json` + verified versions current vs. `npm view ...` 2026-04-26
- Architecture: HIGH — every pattern grounded in existing migration / route / component
- Pitfalls: HIGH — every pitfall traced to a specific file path + line number, verified existing
- Security: HIGH — RLS contract verified at migration 010:179; audit hardening verified at migration 049
- E2E gating: MEDIUM — `secrets.TEST_SUPABASE_URL != ''` syntax is correct GitHub Actions idiom; behavior on forks is documented but not tested in this research session (Plan 07 Task 4 is the verification gate)
- Static IPs: LOW — pending user-action (Plan 06 Task 0)

**Research date:** 2026-04-26
**Valid until:** 2026-05-26 (30 days for stable patterns; re-verify Next.js 16 minor releases and posthog-node 5.x updates if they ship before then)

---

*Phase 11 Research — rebuilt 2026-04-26 after the original was truncated by a Write call without prior Read. All upstream artifacts (CONTEXT.md, UI-SPEC.md, PATTERNS.md, VALIDATION.md, plans 01-07) survived the truncation; this RESEARCH.md is reconstructed to maintain section-heading parity with the plans' `read_first` references (Pattern 1, Pattern 2, Pattern 3, Pattern 4, Pattern 5; Pitfall 1 through Pitfall 8). Line numbers may have shifted slightly vs. the original; section headings are byte-identical.*
