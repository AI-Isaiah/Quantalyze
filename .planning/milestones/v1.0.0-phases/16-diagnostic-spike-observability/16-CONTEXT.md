# Phase 16: Diagnostic Spike + Observability - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning
**Mode:** Smart-discuss (4 grey areas, all "Accept all")

<domain>
## Phase Boundary

Make observability load-bearing across Next.js → FastAPI → Supabase → Resend
**before any code is fixed**. Ship the deterministic local-repro harness that closes
Theme 5 ("recurrence is tooling failure"). Produce the Day-2 decision document
template that — once filled by the founder at the gate — determines whether
Phase 19 (Unified Backbone) runs.

In scope:
- 12 OBSERV requirements (correlation_id seam, Sentry boundaries, error envelope,
  /api/debug-key-flow SSE endpoint, vcrpy cassettes + repro script, structlog
  JSON logs, trigger/RLS audit, PostHog mobile audit, restore-e2e-fixtures
  presence assertion).
- WizardErrorEnvelope component for wizard error paths (ConnectKeyStep,
  SyncPreviewStep, SubmitStep) — the visible UI surface produced by this phase.
- Day-2 decision document scaffold (template only; founder fills at the gate).

Out of scope (deferred to later phases):
- Site-wide error envelope rollout (Phase 17 design contract locks the global
  treatment per UC-D).
- Any actual fix to the wizard failure (Phase 18 — fixed only after Phase 16
  diagnostic surfaces the root cause).
- Mobile-readable wizard fallback (Phase 17 conditional on PostHog mobile count).
- Backend unification / `POST /process-key` RPC (Phase 19 — gated on Day-2
  COMMIT verdict).

</domain>

<decisions>
## Implementation Decisions

### Plan Slicing & Wave Structure
- **8 plans total**, organized by REQ groups:
  - **Plan 1** — OBSERV-12 file-presence assertion in CI (closes the entry-gate
    plan-checker hard-block; smallest diff; protects the rest of the phase)
  - **Plan 2** — correlation_id seam + structlog (OBSERV-01, OBSERV-02, OBSERV-09)
  - **Plan 3** — Sentry boundaries (OBSERV-04 Next.js error.tsx + global-error.tsx;
    OBSERV-05 sentry-sdk[fastapi]==2.58.0)
  - **Plan 4** — trigger / RLS audit + integration tests (OBSERV-10)
  - **Plan 5** — Resend tag round-trip verification (OBSERV-03; tags-first with
    `(correlation_id, resend_message_id)` mapping fallback per Pitfall 17)
  - **Plan 6** — WizardErrorEnvelope component + wizard step integration (OBSERV-06)
  - **Plan 7** — `/api/debug-key-flow` SSE endpoint (OBSERV-07)
  - **Plan 8** — vcrpy cassettes + `scripts/repro-key-flow.sh` (OBSERV-08)
  - **Plan 9** — PostHog `wizard_start` mobile audit (OBSERV-11)
  - **Plan 10** — Day-2 decision document scaffold (template only; pre-scaffolded
    so plan-checker validates structure before founder fills it)

  *(Note: 10 plans, not 8 — final count grew when Resend, PostHog audit, and
  Day-2 scaffold were broken out as separate plans during slicing review.)*
- **2 waves**:
  - **Wave 1** (independent plumbing, parallelizable): Plan 1, Plan 2, Plan 3,
    Plan 4, Plan 9, Plan 10
  - **Wave 2** (depends on Wave 1): Plan 5 (needs correlation_id seam from P2),
    Plan 6 (needs envelope shape from P2), Plan 7 (needs Sentry + correlation_id
    from P2/P3), Plan 8 (needs Resend tag verification from P5 + envelope from P6)
- **First plan to ship: Plan 1** — OBSERV-12 file-presence assertion in CI.
  Closes the entry-gate plan-checker hard-block, smallest possible diff, protects
  the remaining plans.
- **Day-2 decision document handling**: Pre-scaffold as Plan 10. Write
  `.planning/phase-16/day-2-decision.md` with empty-section template (candidate
  root causes / regression test snippet / refutation of each Phase 19 task /
  correlation_id evidence chain). Founder fills at the gate. Plan-checker validates
  template structure exists before Phase 18 entry.
- **Wave structure revised during planning to 3 waves** (Plan 03 → Wave 2;
  Plans 07, 08 → Wave 3) due to analytics-service file overlap on `main.py`
  + `requirements.txt` between Plans 02 and 03. See ROADMAP.md for rationale;
  total parallelism preserved within each wave.

### WizardErrorEnvelope Component
- **Component path**: `src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.tsx`
  (co-located with wizard; matches existing `WizardChrome.tsx`,
  `WizardClient.tsx`, `WizardIpAllowlistHint.tsx`; no new directory).
- **Props shape**: Single `envelope` object prop matching the REQ shape
  `{ok: boolean, code: string, human_message: string, debug_context: string[],
  correlation_id: string, recoverable: boolean}` plus optional `onRetry` and
  `onCancel` callbacks.
- **Copy-diagnostics mechanism**: Native `<details>` + `<summary>` element with
  a `<button>` that calls `navigator.clipboard.writeText(JSON.stringify(envelope))`.
  ARIA-live "Copied" status message. No third-party library.
- **Phase 16 rollout scope**: Wizard error paths only — `ConnectKeyStep`,
  `SyncPreviewStep`, `SubmitStep`. Non-wizard surfaces keep their current
  patterns; Phase 17 design contract locks the global treatment per UC-D.

### `/api/debug-key-flow` SSE Endpoint
- **Auth gate**: Existing admin-role check (reuse the current admin-route
  pattern via `requireAdmin*` helper) + audit-log row inserted per invocation.
  No new secret or token to manage.
- **Test credentials source**: Env-var-encoded encrypted blobs per broker —
  `DEBUG_KEY_FLOW_OKX_KEY` / `DEBUG_KEY_FLOW_OKX_SECRET` /
  `DEBUG_KEY_FLOW_OKX_PASSPHRASE` (and the same triple for Binance and Bybit),
  decrypted via the existing KEK env-var. Railway is the source of truth per
  the Day-0.5 Vault-from-Railway pre-flight result.
- **SSE event shape**: One JSON event per pipeline step —
  `{step: string, status: "started" | "ok" | "error", correlation_id: string,
  started_at: ISO8601, duration_ms?: number, error?: {code, human_message}}`.
  Terminal event `{step: "done", envelope}` closes the stream with the final
  envelope.
- **Rate limiting**: 5 invocations / hour / admin user (in-memory counter; resets
  on cold start; will tighten if abused). Audit-log row is a hard requirement
  regardless of rate-limit outcome.

### VCR Cassettes + PostHog Audit + Trigger Audit
- **VCR cassette scope**: Per broker (OKX / Binance / Bybit) — happy path
  + 3 failure modes (auth-fail HTTP 401 / rate-limit HTTP 429 /
  schema-drift HTTP 200 with unexpected payload). **12 cassettes total.**
  Path: `analytics-service/tests/cassettes/{broker}/{scenario}.yaml`
- **VCR PII redaction**: `vcrpy` `filter_headers` for `authorization`,
  `x-api-key`, `x-api-signature`, `x-passphrase` (case-insensitive) +
  `before_record_response` callback that strips `accountId`, `userId`, `email`,
  and address-bearing fields via regex. CI smoke-test greps cassettes for known
  test secrets (string literal of each `DEBUG_KEY_FLOW_*` env value) and fails
  on hit.
- **PostHog mobile criterion**: `properties.$device_type === 'Mobile'`
  (PostHog auto-classification) over a trailing 30-day window from execution
  date. Cross-checked with `properties.$viewport_width < 768` for sanity.
  Output committed to `.planning/phase-16/posthog-mobile-audit.md` (full evidence)
  with summary line appended to `TODOS.md` per OBSERV-11.
- **Trigger / RLS audit deliverable**:
  `.planning/phase-16/trigger-rls-audit.md` documenting each of migrations
  `084_first_api_key_added_trigger.sql`, `085_stamp_first_bridge_surfaced.sql`,
  `086_compute_jobs_priority.sql` under the unified-pipeline RLS context
  (service-role calls from Railway where `auth.uid()` returns NULL). Paired
  pgTAP or pytest integration tests assert each `stamp_first_*` RPC fires
  correctly via `NEW.user_id`, not `auth.uid()`.

### Claude's Discretion
The following stay at Claude's discretion during planning, since the user
accepted all area defaults:
- Exact file/symbol naming for new helper modules (e.g., correlation_id
  generator, envelope builder, structlog config) — follow established codebase
  conventions.
- Test framework choice for trigger audit (pgTAP vs pytest+psycopg) —
  whichever sits better next to existing analytics-service tests.
- Audit-log table for `/api/debug-key-flow` invocations — reuse existing audit
  table if shape fits; otherwise extend with a `debug_key_flow_invocation` event
  kind.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/wizardErrors.ts` — established source-of-truth pattern with `code`,
  `title`, `cause`, `fix[]`, `actions[]` per error code. Phase 17 will declare
  it the canonical `human_message` source per DESIGN-05; Phase 16 keeps the
  current shape and maps `title` → envelope.human_message, `fix[]` →
  envelope.debug_context for the WizardErrorEnvelope component.
- `src/lib/admin/pii-scrub.ts` — already exists with tested denylist (per
  STATE.md plan-as-drafted reconciliation). Phase 18 ships ONLY the Python
  mirror; Phase 16 references this module as the redaction precedent for
  Sentry `before_send` and structlog filters.
- `src/instrumentation.ts` — framework-level Sentry already wired. Phase 16
  narrows OBSERV-04 to extending into `error.tsx` + `global-error.tsx` route
  boundaries (replaces existing `// TODO: wire Sentry.captureException` markers).
- `src/lib/analytics-client.ts:66` — confirmed seam for OBSERV-01
  correlation_id injection (NOT `src/proxy.ts` per the audit correction in
  STATE.md). Adds `x-correlation-id` header to every outbound fetch.
- Wizard step files at `src/app/(dashboard)/strategies/new/wizard/steps/` —
  ConnectKeyStep.tsx, SyncPreviewStep.tsx, SubmitStep.tsx. All three already
  consume `wizardErrors.ts`. WizardErrorEnvelope drops in here.
- `analytics-service/requirements.txt` — pin `sentry-sdk[fastapi]==2.58.0`,
  `structlog==25.5.0`, `vcrpy==8.1.1`.
- `scripts/` directory exists at repo root (sibling to `seed-full-app-demo.ts`,
  `check-banned-packages.mjs`, etc.) — `repro-key-flow.sh` lives here.

### Established Patterns
- Admin-gated routes use a `requireAdmin*` helper + audit-log insert pattern
  already present in current admin route handlers; reuse for
  `/api/debug-key-flow`.
- Migration drift resolution Path C ratified per `.planning/phase-16/
  migration-drift-resolution.md` — DISCO-05 closed. Migration numbers 084 / 085
  / 086 are the audit targets; numbers 093+ are reserved for Phase 19.
- KEK encryption is a **Railway env-var**, NOT Supabase Vault — STATE.md
  "Plan terminology correction" warns future plans must rephrase any "Vault"
  reference. Day-0.5 pre-flight closed PASS.

### Integration Points
- `restore-e2e-fixtures` PR #111 already merged into the working branch
  (`v1.0.0-api-key-rewrite-15-16`) per STATE.md prep gate 1; Plan 1 only needs
  to add the CI presence assertion, not restore the files.
- `compute_jobs.metadata` JSONB column already exists; OBSERV-01 success
  criterion writes `correlation_id` into `metadata->>'correlation_id'` from
  the FastAPI worker.
- Resend tag plumbing — per Pitfall 17, `tags` array round-trip via Resend's
  webhook payload may be empirically unreliable; Plan 5 verifies and falls
  back to `(correlation_id, resend_message_id)` mapping table if needed.

</code_context>

<specifics>
## Specific Ideas

- WizardErrorEnvelope `<details>` accordion: collapsed by default, no animation
  (matches existing wizard surface aesthetic per DESIGN.md DM Sans / Geist
  Mono / 1px borders / 8px radius).
- SSE endpoint streams the same envelope shape that wizard surfaces render —
  the founder copying the diagnostics blob from a wizard failure should produce
  output structurally identical to a `/api/debug-key-flow` step event.
- Day-2 decision document path: `.planning/phase-16/day-2-decision.md` — exact
  filename referenced by Phase 18 entry gate and Phase 19 entry conditions per
  STATE.md "Phase-Internal Gates" table.
- `scripts/repro-key-flow.sh` documented in repo README troubleshooting
  section so future ops engineers find it without grep.

</specifics>

<deferred>
## Deferred Ideas

- Site-wide error envelope rollout — Phase 17 design contract.
- Actual fix to the wizard failure — Phase 18 (regression test that fails
  without the fix is required at that gate).
- Mobile-readable wizard fallback — Phase 17, conditional on Plan 9 PostHog
  audit count > 0 per DESIGN-04.
- Replacing existing `// TODO: wire Sentry.captureException` markers OUTSIDE
  the wizard error boundary path — Phase 18+ if relevant.

</deferred>
</content>
</invoke>
