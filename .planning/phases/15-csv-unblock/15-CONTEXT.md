# Phase 15: CSV Unblock - Context

**Gathered:** 2026-04-30
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous)
**Last revision:** 2026-04-30 — cross-AI consensus pass (Grok 4.2 multi-agent + fresh Claude review) resolved 9 findings; see `<revision_log>` at bottom.

<domain>
## Phase Boundary

Ship a first-class `flow_type='csv'` adapter so all 10 onboarding teams can submit a verified track record via daily-returns / NAV / trades CSV within 48h, decoupled from the API-key wizard architectural diagnosis Phase 16 will run. Phase 15 is operationally urgent and architecturally minimal — the goal is *unblock customers now*, not *land the unified backbone* (Phase 19's job).

Net-new code on the strategy onboarding wizard. PR #22 (partner-pilot CSV import for managers + allocators) is referenced *thematically* in upstream planning ("we have one CSV side-branch, now make CSV first-class"); it is **not** literal code reuse. Phase 15 builds:

1. `<TrustTierLabel>` component (Phase 17 upgrades to polished pill per DESIGN-01)
2. CSV upload UI as a wizard branch (`/strategies/new/wizard?source=csv`) — including a user-typed "Strategy name" field on the Upload step (locked 2026-04-30; replaces random codename picker)
3. Pandera validation pipeline in `analytics-service` (6 rules — `_check_trading_window` dropped 2026-04-30 because crypto trades 24/7)
4. Migration 093: `strategy_verifications` table with `trust_tier` + status state machine columns
5. Per-team status surfacing via admin page at `/admin/csv-status` (locked 2026-04-30; replaces queryable-rows-only scope)

Out of scope for this phase: broker selector card grid (Phase 17 / DESIGN-03), polished trust-tier badge styling (Phase 17 / DESIGN-01), structured error envelope with `correlation_id` (Phase 16 / OBSERV-06), unified `POST /process-key` RPC (Phase 19 / BACKBONE-01), API path bug fixes (Phase 18 / FIX-01).

</domain>

<decisions>
## Implementation Decisions

### Architecture & Sequencing
- **Migration 093 ships `strategy_verifications` table in Phase 15.** Resolves the table-existence dependency for CSV-03 status rows. Phase 19 keeps reserved migration slots 094–097 (VIEW-shim sequence + fingerprint + idempotency).
- **Schema for migration 093** must align with BACKBONE-03 spec: status state machine (`draft → validated → metrics_captured → encrypted → report_queued → published`) + `trust_tier` column (`api_verified` | `csv_uploaded` | `self_reported`) + `wizard_session_id` UUID column (Phase 19 BACKBONE-07 adds the UNIQUE INDEX). Use `TEXT CHECK` constraint not `ENUM TYPE` (ALTER ergonomics).
- **PR #22 is thematic, not literal reuse.** Phase 15 builds net-new code on strategy onboarding; partner-pilot CSV import remains untouched.
- **Theme 4 entry gate met.** Founder confirmed ≥3 written replies from the 10 onboarding teams. Gate documented as PASS; no `customer-signal-gap.md` log needed.

### CSV Upload UX
- **Route placement:** Branch inside existing wizard via `/strategies/new/wizard?source=csv`. Reuses wizard chrome (auth, header, layout, progress). Phase 17 adds the broker grid + escape-hatch card per DESIGN-03 to drive users into this branch.
- **Format selection:** Segmented control with three explicit options — `daily_returns` / `daily_nav` / `trades`. Pandera schema is per-format; explicit picker beats auto-detect (ambiguous CSVs are common).
- **Strategy name (NEW — locked 2026-04-30 cross-AI revision):** Upload step requires a user-typed strategy name. Required field (1–80 chars). Submit blocked if empty or > 80 chars. Replaces the prior auto-pick from `STRATEGY_NAMES` codename array. Rationale: real customers want their fund branding, not "Aurora" / "Borealis" placeholders. The value flows: client `<input>` → `csv-finalize` route body → RPC parameter `p_strategy_name` → `strategies.name` column. The `STRATEGY_NAMES` import path is dropped from this phase entirely.
- **Upload UI:** Drag-drop zone + file picker button (both). Discoverable for less-technical onboarding contacts. Strategy-name `<input>` sits ABOVE the segmented format picker per UI-SPEC §6.
- **Preview after upload:** Row count + date range + columns detected + first/last 3 rows of data. Validates parsing before strategy creation; surfaces column-mapping issues early.

### Validation Feedback
- **Error collection:** All errors at once. Pandera reports row-level errors; collect them all and present a single batch. User fixes once, not iteratively.
- **Submit blocking:** Block on every CSV-02 rule (max 10MB, monotonic dates, NAV non-zero, daily return > -100% impossible, daily Sharpe > 10 sentinel suspicious, USD-or-blank currency). **Six rules total — `_check_trading_window` was DROPPED 2026-04-30** because crypto markets trade 24/7; flagging weekend dates would fail every real customer CSV. No "warning + override" UX in v0; Phase 17 may relax later if needed.
- **Error envelope shape (v0):** `{ok: false, code, human_message, debug_context: {pandera_errors[]}, correlation_id: null}`. Phase 16 / OBSERV-06 wires real `correlation_id` and Sentry tagging without breaking Phase 15's shape (`null` slot is forward-compat).
- **Error rendering:** Aggregated summary at top ("12 rows failed validation across 3 rule categories") + collapsed `<details>` per-row breakdown. Full error list reachable, default view stays compact.

### Trust-Tier Placeholder Display
- **Placeholder text:** `"CSV uploaded — verification pending"`. Concise, neutral, accurate.
- **Position:** Inline next to strategy name in factsheet header AND below strategy name on marketplace tiles. Same location semantics on both surfaces.
- **Visual treatment (v0):** Plain muted text label, *not* a fake pill. Wrapped in `<TrustTierLabel trustTier="csv_uploaded">` component. Phase 17 upgrades the component internally to render the polished outline pill (`#4A5568`, neutral) per DESIGN-01 — Phase 15 callers don't need to change.
- **Same text both surfaces.** Single source-of-truth string constant in the component. Phase 17 may shorten for tile context.

### Per-Team Status Surface (NEW — locked 2026-04-30 cross-AI revision)
- **Admin status page at `/admin/csv-status`** (replaces "queryable rows only" scope from initial discuss).
- **Plan 15-07** ships the page (~150 LOC, server component, follows `withAdminAuth` pattern from existing admin routes).
- **Query:** `select all strategy_verifications WHERE flow_type='csv' JOIN auth.users(email) JOIN strategies(name) ORDER BY updated_at DESC`.
- **UI columns:** Team Email | Strategy Name | Status | Trust Tier | Submitted At | Actions (link to factsheet).
- **DESIGN.md compliance:** 1px borders, 8px radius (cards), DM Sans body, no gradients, no purples.
- **Access:** Admin-only via redirect on non-admin (`isAdminUser` pattern from existing admin pages).

### Claude's Discretion
- Exact pandera schema definitions per format (`daily_returns` / `daily_nav` / `trades`) — derive from CSV-02 rules (now 6 rules), follow `analytics-service/services/` patterns.
- Which existing wizard step to branch from (likely step 1 source-picker), and how to navigate the user through CSV review → strategy creation → factsheet redirect.
- Component co-location (`<TrustTierLabel>` likely in `src/components/strategy/` or similar — match codebase convention).
- Admin status page layout details (table column widths, empty state copy) within DESIGN.md constraints.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Strategy onboarding wizard** at `src/app/(dashboard)/strategies/new/wizard/` with `steps/` subfolder — provides chrome, draft persistence (`/api/cron/cleanup-wizard-drafts/`), finalize endpoint (`/api/strategies/finalize-wizard/`).
- **Trade upload route** at `src/app/api/trades/upload/` already exists — review for CSV parsing patterns before building from scratch.
- **PII scrub denylist** in `src/lib/admin/pii-scrub.ts` — Phase 18 mirrors this in Python (`analytics-service/services/redact.py`); Phase 15 ships an inline `_redact_preview` helper for CSV preview rows only (defense-in-depth; Phase 18 ships full Python `redact.py`).
- **AES-256-GCM key encryption** primitives already wired (Sprint 6 / v0.6.0.0); `strategy_verifications` schema can mirror `strategies.encrypted_key` shape if storing CSV-derived credentials becomes scope (it should not in Phase 15 — CSVs carry no credentials).
- **Allocator dashboard widgets** + react-grid-layout patterns — irrelevant to Phase 15 but inform component co-location convention.
- **Admin pages** at `src/app/(dashboard)/admin/{compute-jobs,partner-import,usage,...}/page.tsx` — analog for `/admin/csv-status` (server component, `auth.getUser()` + `isAdminUser()` redirect, table render).

### Established Patterns
- Next.js 16 App Router, `(dashboard)` route group for authenticated shell, `(auth)` for unauthenticated.
- API routes at `src/app/api/.../route.ts` — pattern: `withAdminAuth` for admin mutations, server-component fetches for reads.
- Python analytics service at `analytics-service/` (FastAPI, Railway-hosted, `requirements.txt`-pinned) handles data validation, metrics, exchange calls.
- Migrations at `supabase/migrations/NNN_name.sql`. Latest is 092. Phase 15 adds 093 (Phase 19's reserved 094–097 untouched).
- Design tokens at `src/lib/design-tokens/` (Phase 17 adds `trust-tier.ts`).
- Component naming `PascalCase.tsx`, hooks `useFoo.ts`, utilities lowercase.

### Integration Points
- **Wizard branch** → existing `/strategies/new/wizard/` route + `steps/` modules. Add a `?source=csv` query branch that loads CSV-specific steps (upload → preview → submit).
- **Pandera service** → `analytics-service/services/csv_validator.py` (new). Called from a new FastAPI route on the analytics service that the Next.js wizard hits via the existing analytics-client at `src/lib/analytics-client.ts:66` (Phase 16 will add correlation_id here; Phase 15 leaves the call shape forward-compat).
- **Migration 093** → `supabase/migrations/093_strategy_verifications.sql`.
- **TrustTierLabel component** → `src/components/strategy/TrustTierLabel.tsx` (new).
- **Strategy creation path** → ends with redirect to `/factsheet/[id]` or `/strategies/[id]`.
- **Admin status page** → `src/app/(dashboard)/admin/csv-status/page.tsx` (new, plan 15-07).

</code_context>

<specifics>
## Specific Ideas

- Pandera dependency: `pandera==0.20.x` + `python-multipart==0.0.27` (already specified in milestone REQUIREMENTS).
- Per-format pandera schemas derived from CSV-02 (6 rules — trading_window dropped):
  - `daily_returns`: columns `[date, daily_return]`; date monotonic ascending; `-1.0 < daily_return` (impossible to lose more than 100% in a day); daily Sharpe > 10 sentinel suspicious (computed against the dataset); USD-or-blank currency.
  - `daily_nav`: columns `[date, nav]`; NAV non-zero; rest as above.
  - `trades`: columns `[date, side, qty, price, symbol, currency]`; date monotonic per symbol; qty/price > 0; currency USD-or-blank.
- Max file size 10 MB enforced *both* at Next.js intake (rejecting larger uploads early) AND analytics service (defense in depth).
- **Analytics service URL:** `process.env.ANALYTICS_SERVICE_URL` is REQUIRED — no localhost fallback. The CSV path throws on missing env var (locked 2026-04-30 cross-AI revision; eliminates risk of production silently calling localhost).
- Wizard branch UX: 3 sub-steps inside `?source=csv`:
  1. **Upload** — strategy-name `<input>` (NEW — required, 1–80 chars) + segmented format control + drag-drop + file picker
  2. **Preview** — row count, date range, columns, first/last 3 rows; "submit" button enabled iff validation passes; "back" returns to upload
  3. **Submit** — POST to Next.js `/api/strategies/csv-finalize` (which calls `finalize_csv_strategy` RPC); on success redirect to `/strategies/[id]` (with `csv_uploaded` placeholder visible)
- `<TrustTierLabel>` minimal v0 implementation:
  ```tsx
  export function TrustTierLabel({ trustTier }: { trustTier: 'api_verified' | 'csv_uploaded' | 'self_reported' }) {
    if (trustTier === 'csv_uploaded') return <span className="text-muted-foreground text-sm">CSV uploaded — verification pending</span>;
    // api_verified and self_reported render nothing in Phase 15; Phase 17 fills these in
    return null;
  }
  ```
- Founder per-team status: admin page at `/admin/csv-status` (plan 15-07) reads `strategy_verifications` joined to `auth.users.email` + `strategies.name`.

## Migration 093 Schema Sketch (subject to plan-phase refinement)

```sql
CREATE TABLE strategy_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  wizard_session_id UUID NOT NULL,  -- Phase 19 adds UNIQUE INDEX
  status TEXT NOT NULL CHECK (status IN (
    'draft', 'validated', 'metrics_captured', 'encrypted', 'report_queued', 'published'
  )),
  trust_tier TEXT NOT NULL CHECK (trust_tier IN ('api_verified', 'csv_uploaded', 'self_reported')),
  flow_type TEXT NOT NULL CHECK (flow_type IN ('teaser', 'onboard', 'internal_report', 'csv', 'resync')),
  source TEXT NOT NULL CHECK (source IN ('okx', 'binance', 'bybit', 'csv')),
  metrics_snapshot JSONB,
  errors JSONB,  -- error envelope array
  correlation_id UUID,  -- Phase 16 wires real values
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX strategy_verifications_strategy_id_idx ON strategy_verifications(strategy_id);
CREATE INDEX strategy_verifications_status_idx ON strategy_verifications(status);
-- RLS: owner-only writes; Phase 19 will refine for service-role flag-monitor
```

</specifics>

<deferred>
## Deferred Ideas

- **Polished trust-tier outline pill** (DESIGN-01) — Phase 17. `<TrustTierLabel>` component swap is internal; Phase 15 callers don't change.
- **Broker selector 2×3 card grid + CSV escape-hatch card** (DESIGN-03) — Phase 17. Phase 15 ships the wizard branch; Phase 17 ships the source picker that drives users into it.
- **Structured error envelope with `correlation_id`** (OBSERV-06) — Phase 16. Phase 15 uses `correlation_id: null` placeholder; Phase 16 wires real values via `analytics-client.ts:66`.
- **Sentry instrumentation on the CSV validator** (OBSERV-04, OBSERV-05) — Phase 16. Phase 15 logs to existing channels; Phase 16 layers Sentry on top.
- **Unified `POST /process-key` RPC** (BACKBONE-01) — Phase 19. Phase 15 builds CSV path as a standalone FastAPI route; Phase 19 absorbs it into the unified backbone.
- **API-path bug fix** (FIX-01) — Phase 18. Phase 15 only ships the CSV escape hatch; the API-key wizard is untouched.
- **Full Python PII redact.py** (FIX-04) — Phase 18 ships `analytics-service/services/redact.py` mirroring `src/lib/admin/pii-scrub.ts`. Phase 15 ships only an inline `_redact_preview` helper inside `csv_validator.py` that masks CSV preview-row column names matching `/^.*(account|email|user|customer|wallet|address)$/i`. Phase 18 expands to JWT-shape detector, account-id truncator, recursive walker, full denylist.
- **Metrics_snapshot / fingerprint parity for CSV vs API path** — Phase 18 / FIX-03 success gate. Phase 15 E2E asserts the wizard happy path + trust-tier label only; metrics-shape parity is verified by Phase 18 once `compute_similarity` ships.
- **Trading-window rule on CSV-02** — DROPPED entirely 2026-04-30. Crypto markets trade 24/7; the rule would fail every real customer CSV. Not deferred — fully removed from CSV-02 spec.
- **CSV file format auto-detection** — explicitly rejected in favor of segmented control. Reconsider if customer feedback shows it's friction.
- **STRATEGY_NAMES random codename picker** — REPLACED 2026-04-30 by user-typed strategy name on Upload step. The const itself remains in `src/lib/constants.ts` for any other consumer; Phase 15 does NOT import it.

</deferred>

<revision_log>
## Cross-AI Revision Pass (2026-04-30)

Iteration 2/3. Resolved 9 findings from Grok 4.2 multi-agent + fresh-context Claude review.

| # | Severity | Finding | Resolution |
|---|----------|---------|-------------|
| 1 | BLOCKER | Random codename picker burns customer trust | User-typed strategy name field on Upload step. RPC param renamed `p_placeholder_name` → `p_strategy_name`. STRATEGY_NAMES import dropped. |
| 2 | BLOCKER | `_check_trading_window` would fail every crypto CSV | Rule dropped entirely from CSV-02. Updated REQUIREMENTS.md. Removed from `csv_validator.py` schemas + `RULE_LABELS` constant. |
| 3 | BLOCKER | E2E test cleanup depends on env var | Switch to `auth.users` SELECT-by-email at test runtime. No env var dependency. |
| 4 | BLOCKER | Founder per-team status visibility gap | Plan 15-07 ships admin page at `/admin/csv-status`. Wave 3, ~150 LOC, depends only on 15-01. |
| 5 | WARNING | localhost fallback for ANALYTICS_SERVICE_URL | Throw on missing env var. No fallback. Greppable absence in CSV code paths. |
| 6 | WARNING | Dead `csv_finalize` Python endpoint | Remove from `analytics-service/routers/csv.py`. Pure subtraction. |
| 7 | WARNING | Raw row PII in preview / logs | Inline `_redact_preview` helper masks PII column values. Logs only carry row index + rule name. Phase 18 ships full redact.py. |
| 8 | WARNING | E2E missing metrics/fingerprint parity | Add comment block to E2E spec; metrics parity is Phase 18 / FIX-03 gate, not Phase 15. |
| 9 | INFO | WizardClient state machine fragility | Add reviewer_note on plan 15-05 Task 4 calling out the 4x saveWizardState + resume-guard interdependence for code-review focus. |

</revision_log>
