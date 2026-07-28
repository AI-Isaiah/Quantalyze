# Phase 18: Root-Cause Fix + Founder LP Skeleton - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the v1.0.0 wizard-reliability loop and ship the founder dogfood loop, scoped against what is already in `main` after PRs #116–#122. The wizard root-cause fix (bridge race, missing `compute_analytics` chain link, validate-key swallow sites) and Bug #1 forensic patch (correlation_id thread on the 3 `enqueue_compute_job` callsites in `keys/sync` + `intro` + adjacent routes) shipped in-flight against Phase 18 commit prefixes (`fix(phase-18): …`); they enter Phase 18 as **already-shipped, traceability-only**. Plan-phase converts the remaining items into formal plans:

In scope (Phase 18 plans):
- **FIX-01 traceability** — record the wizard root-cause fix (PR #116, commit `3932842`), regression test (`TestSyncTradesEnqueuesComputeAnalytics` in `analytics-service/tests/test_job_worker.py:553`), and Bug #1 forensic patch (commits `a48a92e` + `1960f54`) as Phase 18 deliverables in CONTEXT.md and SUMMARY notes; do not re-plan.
- **FIX-02 verification** — Founder OKX test key passes wizard end-to-end in production-equivalent environment with `strategies.status='active'` + `encrypted_key` decrypts cleanly via Railway KEK. Plan-phase verifies live; commits the smoke evidence to `.planning/phase-18/founder-okx-smoke.md`.
- **FIX-03 (10-team onboarding tracker)** — `.planning/phase-18/team-status.md` with one row per team (status + correlation_id of their wizard run); referenced from TODOS.md. Plan ships the tracker artifact + initial pass.
- **FIX-04 (`redact.py` Python mirror)** — `analytics-service/services/redact.py` with `scrub_pii(value)`, `truncate_account_id(s)`, `scrub_freeform_string(s)` — snake_case mirror of `src/lib/admin/pii-scrub.ts`. Wired into 3 boundaries: Sentry `before_send` (replaces `_redact_before_send` placeholder), structlog processor, audit-log writer. Shared 20-bad / 5-good fixture corpus at `tests/fixtures/redact-corpus.json`. Vitest TS↔Python parity test asserts each TS denylist key appears in `redact.py` text.
- **LP-01 (Founder LP cron)** — `/api/cron/founder-lp-report` Vercel cron at `0 9 1 * *` (1st of month, 09:00 UTC); reuses existing `/api/factsheet/[id]/pdf` endpoint as-is; strategy id from `FOUNDER_LP_STRATEGY_ID` Vercel env var. Cron registered in `vercel.json` `crons` array (NOT `vercel.ts` — repo currently uses `vercel.json`; migration to `vercel.ts` is out of scope).
- **LP-02 (Failure handling)** — Sentry capture with `cron-failure` tag + `correlation_id`; Resend alert email to founder on cron failure. Silent failure prohibited.
- **LP-02 (Delivery)** — Resend email to founder with PDF attached on success (closes the dogfood loop end-to-end).
- **LP-03 (Dogfood commitment file)** — `.planning/phase-18/dogfood-commitment.md` shipped as a stub with TODO for the founder to fill at /ship time with the unedited verbal-in-writing commitment text (≤14 days send-to-real-LP commitment); Claude does not author the commitment text.

Out of scope (deferred to other phases):
- **PR #116 + Bug #1 forensic patch + Bybit broker quirks (PR #117–#120)** — record-only as Phase 18 traceability, no replan.
- **BACKBONE-06 (open-perp correctness) + BACKBONE-07 (TWR ≠ YTD reconciliation)** — pushed to **Phase 19**. They pair naturally with `IngestionAdapter.reconstruct_positions` and equity-curve refactor; isolating them from Phase 18 keeps the boundary clean. Day-2 doc Section 5 lists them as IN under Phase 18; this CONTEXT.md updates that decision (rationale: Phase 18 is already heavy with redact.py + LP cron + 10-team verification; splitting backbone correctness into its own phase reduces wave-4 risk).
- **Phase 19 entry-prep artifacts** (`.planning/phase-19/route-inventory.md` + `.planning/phase-19/migration-plan.md`) — produced as Phase 19 day-0 prep, NOT as Phase 18 plans. Per STATE.md L106-107, they are Phase 19 entry gates.
- **`src/lib/redact.ts`** — anti-feature per REQUIREMENTS.md ("`pii-scrub.ts` already exists with tested denylist"); Phase 18 ships ONLY the Python mirror.
- **Hypothesis #13 (drop `decrypt_credentials` call) + #14 (wire real broker calls into debug_key_flow placeholders)** — already wired via PRs #121 + #122 per Day-2 Appendix A; record-only.

Phase 18 entry gate (Theme 4 Metaworld) — **SATISFIED** as of 2026-05-06; commitment text logged in `.planning/phase-18/metaworld-commitment.md`. Phase 19 marketplace-credibility scope retained (no reduction).

</domain>

<decisions>
## Implementation Decisions

### Phase 18 Plan Scope & In-Flight Reconciliation

- **PR #116 wizard root-cause fix** (bridge race in `main_worker.py:155-165` + missing `run_sync_trades_job → compute_analytics` chain link + validate-key swallow sites in `routers/exchange.py` + `services/exchange.py`) — **shipped 2026-05-05 in-flight**, recorded as Phase 18 traceability in CONTEXT.md + SUMMARY only. No re-plan; commit reference `3932842`. Regression artefact: `analytics-service/tests/test_job_worker.py:553 TestSyncTradesEnqueuesComputeAnalytics` + migration `099_mark_compute_job_atomic_status_bridge.sql` self-verifying invariant DO-block.
- **Bug #1 forensic patch** (correlation_id threaded into `compute_jobs.metadata` via `p_metadata` argument on `enqueue_compute_job` calls) — **shipped via commits `a48a92e` + `1960f54`**; verified at `src/app/api/keys/sync/route.ts:94`, `src/app/api/intro/route.ts:220`, plus follow-up `compute_intro_snapshot` thread in `src/app/api/intro/route.test.ts:265-291` ("Phase 18 Bug #1 follow-up" test name). No re-plan.
- **Bybit broker quirks** (PRs #117–#120: readOnly STRING vs INT, permission detection precedence, fetchCurrencies disable, INTERNAL_API_TOKEN parity, load_markets best-effort) — already shipped; recorded as Phase 18 traceability only. These belong to a longer-term broker-quality SLA pattern (out of scope for v1.0.0).
- **BACKBONE-06 (open-perp correctness) + BACKBONE-07 (TWR ≠ YTD reconciliation)** — **pushed to Phase 19** despite Day-2 Section 5 listing them as IN under Phase 18. Rationale: Phase 19's `IngestionAdapter.reconstruct_positions` + equity-curve unification absorbs the same call sites; Phase 18 is already heavy. ROADMAP.md and the Phase 19 entry doc must be updated to reflect this.
- **Phase 19 entry-prep artifacts** (`route-inventory.md` + `migration-plan.md` for migrations 093–097 reservation) — produced during Phase 19 plan-phase, NOT in Phase 18. Plan-checker enforces them as Phase 19 entry gates per STATE.md L106-107.

### `redact.py` Mirror (FIX-04)

- **Module path:** `analytics-service/services/redact.py` (REQ FIX-04 verbatim).
- **API surface (snake_case mirror of TS exports):**
  - `scrub_pii(value: Any) -> Any` — recursive walker, denylist-key redaction, JWT-shape detection on string values, returns `[REDACTED]` / `[REDACTED_JWT]` sentinels.
  - `truncate_account_id(s: str) -> str` — `***<last4>` for strings ≥ 8 chars; pass-through for shorter strings or non-strings.
  - `scrub_freeform_string(s: str) -> str` — three-pass redaction (sensitive `key: value` substring → whole-string JWT → embedded-substring JWT). Required for Resend / clipboard / freeform error context fields.
- **Denylist parity (8 keys verbatim from REQ FIX-04 + TS additions):** `apikey`, `apisecret`, `api_key`, `api_secret`, `secret`, `signature`, `passphrase`, `authorization`, `x-mbx-apikey`, `ok-access-sign`, `x-internal-token` (TS pii-scrub.ts L16-36 superset). Prefix denylist: `sb-ec-`. Case-insensitive key match.
- **JWT detector:** anchored 3-segment regex `^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$` for whole-string match; substring detector `[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}` for embedded matches (mirrors TS `JWT_SHAPE` + `JWT_SUBSTRING`).
- **Sensitive key:value detector** mirrors TS `SENSITIVE_KEY_VALUE` regex verbatim — Python `re.compile(..., re.IGNORECASE)`.
- **Wire-up boundaries (3):**
  1. **Sentry `before_send`** — replaces the `_redact_before_send` placeholder per OBSERV-05 in `analytics-service/sentry_init.py`. Drops `event.extra` + `event.contexts` through `scrub_pii`; runs `scrub_freeform_string` on `event.message`.
  2. **structlog processor** — registered in `analytics-service/services/logging_config.py`. Walks every `logger.info/error/exception` event_dict through `scrub_pii` before JSON serialization.
  3. **Audit-log writer** — every `audit.py` write that includes user-supplied JSON passes through `scrub_pii` first.
- **Shared fixture corpus:** `tests/fixtures/redact-corpus.json` (repo root, sibling to `analytics-service/`); shape `{"bad": [...20], "good": [...5]}` where `bad[]` items are `{input: <unknown>, expected: <redacted form>}` and `good[]` items are `{input: <unknown>}` (must round-trip unchanged). Loaded by both Vitest (`tests/lib/admin/pii-scrub.test.ts` extension) and pytest (`analytics-service/tests/test_redact.py`). Single source of truth across runtimes.
- **Drift-prevention test:** `tests/lib/admin/pii-scrub-python-parity.test.ts` (Vitest) reads `analytics-service/services/redact.py` text via `fs.readFileSync` and asserts each TS denylist key appears verbatim in the Python file. Same pattern as `tests/a11y/chart-contrast.test.ts` and the DESIGN-01 token-consistency test.
- **Grep gate:** Phase 18 exit criterion — grep over Supabase log table after a smoke test run shows zero credential-shaped strings (REQ FIX-04 verbatim).

### Founder LP Cron (LP-01 / LP-02)

- **Cron route path:** `/api/cron/founder-lp-report` (matches existing `/api/cron/*` convention: `warm-analytics`, `alert-digest`, `cleanup-wizard-drafts`, `sync-funding`, `reconcile-strategies`, `cleanup-ack-tokens`).
- **Schedule:** `0 9 1 * *` (1st of month, 09:00 UTC) — predictable LP-touchpoint cadence; first-of-month is conventional reporting trigger. Registered in `vercel.json` `crons` array (NOT `vercel.ts` — repo currently uses `vercel.json`).
- **Strategy ID source:** `FOUNDER_LP_STRATEGY_ID` Vercel env var (UUID). No DB schema add, no admin UI; founder rotates by editing the env var. Matches existing secret-style env-var pattern.
- **PDF generation:** reuse `/api/factsheet/[id]/pdf` endpoint as-is (REQ LP-01 verbatim — "no branded design dependency"). Cron handler does an internal fetch with the founder strategy ID and forwards the bytes.
- **Delivery:** Resend email to the founder (recipient = `FOUNDER_LP_REPORT_TO` env var, defaults to founder email) with PDF attached. Subject line includes month + strategy name.
- **Failure handling — both alerts (silent failure prohibited per LP-02):**
  - Sentry capture with `tag: cron-failure` + `correlation_id`.
  - Resend alert email to founder on any catch path with the exception class + message + correlation_id (separate from the success email).
- **Auth:** standard Vercel cron header check (`x-vercel-cron-signature` or `Authorization: Bearer ${CRON_SECRET}` per existing crons in repo).
- **Test strategy:** unit test mocks `fetch` for `/api/factsheet/[id]/pdf` + Resend client; asserts both happy-path (success email sent) and failure-path (Sentry capture + Resend alert email both fire).

### Entry-Gate Files + Commitments

- **`metaworld-commitment.md`:** SATISFIED 2026-05-06 in this session. Verbatim text: "Metaworld is excited to choose strategies from the marketplace. This will simplify our work drastically." Source: founder via /gsd-autonomous --only 18 entry-gate prompt. Theme 4 risk mitigated; Phase 19 marketplace-credibility scope retained.
- **`dogfood-commitment.md` (LP-03):** Phase 18 final plan ships an empty stub file with a TODO for the founder to fill at /ship time. Claude does not author the verbal-in-writing commitment text — that violates the meaning of "verbal-in-writing." Stub format:
  ```markdown
  ---
  gate: phase-18-exit-dogfood-commitment
  status: PENDING
  ---
  # Founder LP Dogfood Commitment

  > Required: founder pastes the unedited verbal-in-writing commitment to send the cron-generated LP PDF to a real LP within 14 days of v1.0.0 milestone close.

  ## Commitment Text (verbatim)

  <TODO: founder fills in at /ship time>
  ```
- **`team-status.md` (FIX-03):** one row per onboarding team:
  - Columns: team_name, source (okx/binance/bybit/csv), wizard_run_correlation_id, status (`pending`/`validated`/`published`), notes
  - Initial pass populated from existing data; updated as teams flow through.
  - Linked from TODOS.md.

### Claude's Discretion

- Exact slicing of plans across the 5 in-scope deliverables (FIX-01 traceability + FIX-02 + FIX-03 + FIX-04 + LP-01/02/03). Likely 4–5 plans:
  1. Phase 18 traceability + FIX-02 founder OKX smoke + FIX-03 team-status tracker (single small plan).
  2. FIX-04 `redact.py` mirror — Python module, wire-up at 3 boundaries, fixture corpus, parity test.
  3. LP-01/02 founder LP cron — route handler, env vars, vercel.json registration, Sentry + Resend wiring, tests.
  4. LP-03 dogfood-commitment.md stub + ROADMAP/STATE update reflecting BACKBONE-06/-07 push to Phase 19.
- Test file locations within established patterns (e.g., `analytics-service/tests/test_redact.py`, `src/app/api/cron/founder-lp-report/route.test.ts`).
- Whether the cron handler returns a structured response on success (recommended yes, with `correlation_id` + `pdf_bytes_emitted` for observability).
- Exact Resend template id (or inline HTML) and email body copy — defaults to a minimal "Founder LP report — {month}" subject + PDF attachment + correlation_id in body.
- The exact REQUIREMENTS.md / ROADMAP.md / STATE.md edits to push BACKBONE-06/-07 from Phase 18 to Phase 19 (pure docs update; ships in plan 4).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/admin/pii-scrub.ts` — canonical TS denylist + JWT detector + recursive walker + freeform-string 3-pass redactor. Phase 18 mirrors this in Python.
- `analytics-service/sentry_init.py` (referenced in OBSERV-05; check for `_redact_before_send` placeholder during plan-phase).
- `analytics-service/services/logging_config.py` — structlog wiring; new `redact.py` processor plugs in here.
- `analytics-service/services/audit.py` — audit-log writer.
- `src/app/api/factsheet/[id]/pdf/route.ts` — existing PDF endpoint reused as-is by the LP cron (no edits).
- `src/app/api/cron/{warm-analytics,alert-digest,cleanup-wizard-drafts,sync-funding,reconcile-strategies,cleanup-ack-tokens}/route.ts` — established cron handler pattern. New `founder-lp-report` follows the same shape.
- `vercel.json` `crons` array — registration target.
- `tests/a11y/chart-contrast.test.ts` and DESIGN-01 token-consistency test — pattern for the TS↔Python denylist parity test.

### Established Patterns
- **Python module style:** type hints, docstring matching the TS module's purpose, snake_case function names.
- **Cron handlers:** export `GET` (or `POST`), guard with Vercel cron signature, return JSON with `{ ok, correlation_id }`. Errors call `Sentry.captureException` with `tag: cron-failure`.
- **Resend wiring:** uses existing client at `src/lib/resend/*` (already wired for tag round-trip per OBSERV-03).
- **Vitest TS↔file-text drift tests:** read sibling files via `fs.readFileSync` and assert content invariants. No AST parsing.
- **Shared fixture corpora:** kept at repo root under `tests/fixtures/` to be importable by both runtimes.
- **`p_metadata` correlation_id thread:** every new `enqueue_compute_job` callsite must thread `correlation_id` (locked by Bug #1 forensic patch).

### Integration Points
- **`vercel.json` `crons` array** gains one entry: `{ "path": "/api/cron/founder-lp-report", "schedule": "0 9 1 * *" }`.
- **`src/app/api/cron/founder-lp-report/route.ts`** new file (cron handler).
- **`analytics-service/services/redact.py`** new file.
- **`analytics-service/sentry_init.py`** edited — `_redact_before_send` placeholder swapped for real `redact.scrub_pii` call.
- **`analytics-service/services/logging_config.py`** edited — new structlog processor entry.
- **`analytics-service/services/audit.py`** edited — `scrub_pii` invocation on JSON payloads.
- **`tests/fixtures/redact-corpus.json`** new file.
- **`analytics-service/tests/test_redact.py`** new file.
- **`tests/lib/admin/pii-scrub-python-parity.test.ts`** new file.
- **`.planning/phase-18/{metaworld-commitment.md,dogfood-commitment.md,team-status.md,founder-okx-smoke.md}`** new files.
- **`vercel.json`** + **`.env.example`** — new env vars `FOUNDER_LP_STRATEGY_ID`, `FOUNDER_LP_REPORT_TO`.
- **`REQUIREMENTS.md` + `ROADMAP.md` + `STATE.md`** edits to push BACKBONE-06/-07 from Phase 18 to Phase 19.

</code_context>

<specifics>
## Specific Ideas

- **redact.py docstring** mirrors the pii-scrub.ts header verbatim (purpose, denylist rationale, JWT shape rationale, cycle behavior). Keeps reviewer cognitive load low.
- **redact.py has zero runtime dependencies** — pure stdlib (`re`, `typing`). No new entries in `analytics-service/requirements.txt`.
- **LP cron handler returns 200 with `{ ok: true, correlation_id, strategy_id, pdf_bytes }` on success, 5xx with `{ ok: false, correlation_id, error_class, error_message }` on failure.** Both call paths fire Sentry + Resend per the failure-handling rules.
- **Cron schedule note:** `0 9 1 * *` UTC = 09:00 UTC on the 1st. Founder EU local time = 10:00 (winter) / 11:00 (summer); intentional morning slot.
- **Drift-prevention parity test does NOT validate the Python file is syntactically valid** — that's pytest's job. The Vitest test only asserts denylist key strings appear in the file text.
- **The shared fixture corpus is opinionated:** the 20 bad cases include realistic `Authorization: Bearer eyJ...` substrings, snake-case `api_key` fields, OK-Access-Sign headers; the 5 good cases include realistic but non-sensitive JSON (allocator names, ISO timestamps, ratios).
- **`team-status.md` is a regular markdown table, not YAML frontmatter** — readable in GitHub web UI, scannable per-team. STATE.md links to it; Phase 18 final plan populates it.
- **Phase 18 plan-checker enforces** that Plan 1's CONTEXT-traceability records the PR #116 + Bug #1 + Bybit-quirk commit hashes verbatim (no paraphrase).
- **`founder-okx-smoke.md`** captures the FIX-02 evidence: `correlation_id`, `strategies.id`, `encrypted_key` decrypt round-trip evidence (NOT the plaintext key — only the assertion + redacted ciphertext fingerprint), and the timestamp of the production-equivalent run.

</specifics>

<deferred>
## Deferred Ideas

- **`src/lib/redact.ts`** — explicitly anti-feature per REQUIREMENTS.md ("`pii-scrub.ts` already exists with tested denylist"); Phase 18 ships ONLY the Python mirror. Discussed and rejected.
- **BACKBONE-06 (open-perp correctness) + BACKBONE-07 (TWR ≠ YTD reconciliation)** — moved to Phase 19 (rationale above). Day-2 Section 5 wording superseded by this CONTEXT.md.
- **Phase 19 entry-prep artifacts (`route-inventory.md` + `migration-plan.md`)** — Phase 19 day-0 prep, not Phase 18 plans.
- **`vercel.ts` migration** — repo currently uses `vercel.json`; migration is out of scope for v1.0.0 (would change deployment-config surface mid-milestone).
- **Branded LP report design (Eltican Positron Dashboard reference)** — v2 per UC-F.
- **Multi-strategy bundle editor for fund-level LP report** — v2 per LP-BRANDED-02.
- **PDF storage in Supabase Blob / Vercel Blob** — not needed for v1; Resend email is the dogfood-loop closure.
- **Hypothesis #13 + #14 fixes (debug_key_flow placeholders)** — already shipped via PRs #121 + #122 per Day-2 Appendix A; record-only.
- **Bybit broker-quality SLA pattern** — out of scope for v1.0.0; future phase after Phase 19 stability window.
- **PostHog mobile fallback build** — Phase 17 deferral remains (OBSERV-11 N=0).

</deferred>
