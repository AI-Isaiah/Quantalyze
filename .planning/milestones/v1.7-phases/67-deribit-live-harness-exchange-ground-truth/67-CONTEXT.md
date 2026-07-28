# Phase 67: Deribit Live Harness & Exchange Ground-Truth - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous — recommendations auto-accepted per user's standing decide-autonomously directive)

<domain>
## Phase Boundary

Answer the two design-driving Deribit unknowns from real worker-side data (DRB-01) and prove Bybit ingestion correct against exchange ground truth (BYB-01). Deliverables are EVIDENCE artifacts + any Bybit fix, not product features: an authed harness run from the Railway worker against one LTP Deribit key with recorded answers (funding-netting shape, instrument mix, geo-block body marker), and an end-to-end Bybit reconciliation for one live key. No Deribit boundary wiring (Phase 68), no Deribit ingestion (Phase 70).

</domain>

<decisions>
## Implementation Decisions

### Harness shape & transport
- Committed one-off scripts under `analytics-service/scripts/` (run via the established `railway ssh "cd /app && python -m scripts.X"` idiom; env key name convention is SUPABASE_SERVICE_KEY not _ROLE_KEY). Scripts stay in-repo — they become fixture generators for Phase 70.
- ccxt 4.5.59 (venv freshly synced 2026-07-04 — STATE blocker cleared) with raw-endpoint fallthrough for `private/get_transaction_log` and `private/get_user_trades_by_currency_and_time`; exact call shapes researched at plan time (roadmap research flag).
- Output: structured JSON to stdout, captured through `railway ssh` redirect, committed SANITIZED — no key material, account identifiers masked.
- The same authed run records any Deribit geo-block block-body marker for `geo_block.py` (#415 classifier fail-safe). Dynamic egress caveat: re-probe is cheap, classifier is the fail-safe.

### Credentials & recorded answers
- Deribit key provisioning is a checkpoint:human-action — the founder provides ONE read-only LTP Deribit key via Railway env vars (LTP secrets: env/Keychain only, NEVER tracked files; rotation after onboarding per ONB-02). Harness fails loudly if the key's scopes exceed read-only.
- Recorded answers live TRACKED in-repo at `analytics-service/docs/deribit-ground-truth.md` + sanitized raw JSON evidence alongside — not in the gitignored `.planning/` ledger, because Phases 68/70 design against them.
- The 3 mandated answers (funding-netting shape: netted into realized PnL vs separate rows; inverse/linear/options mix per account; block-body marker) are each recorded WITH the raw evidence excerpt proving them.
- Bonus observation, non-blocking: whatever the one key reveals about LTP account structure (distinct login vs subaccount) is noted for Phase 72; resolving all 3 accounts is NOT this phase.

### Bybit ground-truth reconciliation (BYB-01)
- Subject: the founder's live Bybit key already ingested in prod (the #563 investigation subject).
- "Reconciled" means: exchange-fetched fills + funding (fresh, from the worker) vs DB trades/funding rows via native-id set equality over a fixed window; AND per-key realized+funding dailies recomputed from exchange data vs stored CSV dailies within 1e-9.
- Explicit #563 under-fetch class re-check with the now-clean Amsterdam egress; count deltas recorded even if zero.
- Any discrepancy: root-cause + fix + regression test that fails without the fix. Zero discrepancies: the clean reconciliation itself is the BYB-01 evidence.

### Claude's Discretion
- Script file names/structure, JSON schema of the evidence artifacts, masking scheme for account identifiers.
- Whether Deribit + Bybit probes share helper code (only if it stays trivially simple).
- Exact reconciliation window (long enough to cover the #563 class; bounded for runtime).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `railway ssh "cd /app && python -m scripts.X"` one-off idiom (established; see scripts/backfill_funding.py conventions).
- `geo_block.py` classifier (#415) — target for the block-body marker answer.
- Bybit ingestion path + #563 prior investigation (CSV-approval fix; Bybit fills under-fetch was NOT a P&L bug) — the reconciliation baseline.
- Worker egress: Amsterdam NL, all four exchanges reachable/authed (verified 2026-07-04).

### Established Patterns
- Detection-first, evidence-recorded runtime ops (Phase 66 sweep set the precedent).
- Regression test per found bug, failing without the fix.
- pytest suite in analytics-service with --cov-fail-under=80; B-mypy runs against a CI-pinned uv venv, not the shared local .venv.

### Integration Points
- Railway analytics-service worker (deploy gated on green main CI — flaky-main skips deploys silently; verify `railway deployment list` before ssh runs).
- Supabase prod khslejtfbuezsmvmtsdn for DB-side reconciliation reads (via MCP from main session; executor subagents have no Supabase MCP and no railway auth — worker/prod steps are checkpoint:human-action for the orchestrator).

</code_context>

<specifics>
## Specific Ideas

- Known Deribit ground-truth trade counts from prior research: 18,778 / 21,014 / 61,248 (DRB-04 verification targets) — the harness should capture per-currency counts so Phase 70 can verify pagination completeness against them.
- Success criterion 1 requires the harness OUTPUT recorded as an artifact — the artifact is a deliverable, not a byproduct.

</specifics>

<deferred>
## Deferred Ideas

- Resolving the full LTP 3-account structure (Phase 72 concern; noted-if-observed only).

</deferred>
