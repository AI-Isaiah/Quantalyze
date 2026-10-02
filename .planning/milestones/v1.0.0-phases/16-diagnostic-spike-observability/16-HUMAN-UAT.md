---
status: partial
phase: 16-diagnostic-spike-observability
source: [16-VERIFICATION.md]
started: 2026-05-01T13:10:00Z
updated: 2026-05-01T14:25:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Plan 16-07 Task 5 — Stage Railway DEBUG_KEY_FLOW_* env vars and smoke-test SSE
expected:
  - 7 `DEBUG_KEY_FLOW_*` env vars set on Railway analytics-service for OKX (KEY/SECRET/PASSPHRASE), Binance (KEY/SECRET), Bybit (KEY/SECRET) — encrypted via existing KEK Fernet helper.
  - `INTERNAL_API_TOKEN` SHA-256 hash matches between Railway and Vercel preview.
  - `RESEND_WEBHOOK_SECRET` set on Vercel (Plan 16-05 dep).
  - Triggering Railway redeploy.
  - From an admin browser session at a Vercel preview URL, `POST /api/debug-key-flow` with `{ "broker": "okx" }` returns:
    - `Content-Type: text/event-stream`
    - 3 streamed step events (validate_key_permissions / encryption_round_trip / fetch_raw_trades) ending in `{"step":"done","envelope":{...}}`
    - `: keepalive` lines roughly every 15s
    - At least one event with `status: ok` or `status: error` (NOT 503/401)
  - One row appended to `audit_log` with `action='debug_key_flow.invoke'`, `entity_type='debug_session'`, and `entity_id` matching the request's correlation_id (or a derived UUID if header was absent/malformed).
result: [pending]

### 2. Plan 16-08 Task 3 — Record 12 vcrpy cassettes against test broker creds
expected:
  - 12 YAML files committed under `analytics-service/tests/cassettes/{okx,binance,bybit}/{happy,auth-fail,rate-limit,schema-drift}.yaml`.
  - Every cassette passes the leak detector grep — every `authorization` / `api[-_]?key` / `secret` / `passphrase` / `signature` / `x-bapi-sign` / `ok-access-sign` / `x-mbx-apikey` line redacted to `[REDACTED]` (no live values).
  - `ls analytics-service/tests/cassettes/{okx,binance,bybit}/{happy,auth-fail,rate-limit,schema-drift}.yaml | wc -l` returns `12`.
  - With `DEBUG_KEY_FLOW_*` env vars UNSET, `bash scripts/repro-key-flow.sh` exits `0` (full replay path, no network).
  - `cd analytics-service && pytest tests/test_repro_key_flow.py -x -q --vcr-record=none` passes all 12 cases.
result: partial — 4/12 cassettes recorded for OKX (commit 1dfe93d on 2026-05-01T14:22Z): happy + auth-fail are real ccxt+VCR captures against founder-provided read-only test creds; rate-limit + schema-drift are derived from happy by mutating the final response code. All 4 OKX pytest cases pass on replay; leak audit clean (no fragment of live creds present). 8 cassettes still pending for Binance (KEY/SECRET) + Bybit (KEY/SECRET); each broker requires its own DEBUG_KEY_FLOW_*_KEY / *_SECRET test creds.

### 3. Plan 16-10 (Day-2 decision) — Fill `.planning/phase-16/day-2-decision.md`
expected:
  - All 7 frontmatter keys populated: `decision: SKIP|COMMIT|HOLD`, `decided_at`, `decided_by`, `deliberation_minutes` (≥120), `correlation_id_evidence_chain` (non-empty array of UUIDs), `regression_test_files`, `phase_19_skip_rationale` (or `phase_19_commit_scope`).
  - `## TL;DR` section non-empty.
  - 12-row BACKBONE/FINGERPRINT refutation table fully filled — no `TBD` cells in either column.
  - 9 falsifiable checkboxes resolved (each either `[x]` or `[ ]` with explicit "N/A — reason" inline).
  - `regression-test snippet` block holds the actual test code that fails without the chosen fix (or "N/A — SKIP path; no fix needed" with rationale).
  - At least one entry in `correlation_id_evidence_chain` traces a single UUID from Next.js Sentry → Python Sentry → Supabase audit_log → (Resend webhook OR compute_jobs.metadata) — the layer Phase 19 fix would touch.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

(populated as items move out of `pending`)
