# Phase 160: PROVENANCE — The server's venue is the venue that annualizes - Context

**Gathered:** 2026-08-23
**Status:** Ready for planning

<domain>
## Phase Boundary

No client-supplied venue can differ from the venue the server validated, and the √365/√252 annualization stamp derives from the server's attestation — without ever stamping √252 onto a crypto strategy through a NULL attestation. Covers RANK-03 (server-authoritative `api_keys.exchange` at every INSERT path) and RANK-04 (attestation-derived `asset_class` stamp with null-attestation SKIP guard). The B-M1 PROD census is the phase's FIRST task and gates everything downstream.

</domain>

<decisions>
## Implementation Decisions

### B-M1 census & B-D1 scope gating
- Census is a committed early phase artifact (`160-CENSUS.md`) with pinned counts — discipline copied from migration `20260811210000` (count-pinned, abort-on-drift).
- The census decides B-D1 scope mechanically (all of B-1..B-4 vs B-4-alone-with-null-guard): threshold documented in the artifact, no separate user gate.
- At REVOKE time, the migration guard re-runs the count-pinned census and aborts on drift.

### Server-authoritative INSERT rollout
- Writer = extend `validate-and-encrypt` (already knows the canonical venue) to insert the `api_keys` row and return `{ api_key_id }` — Phase-156 service-role-writer pattern.
- Client INSERT sites (`ApiKeyManager.tsx:254`, `StrategyForm.tsx:140`) stop inserting; DELETE (`ApiKeyManager.tsx:352`) stays client-side — REVOKE INSERT only. Grep every `.from("api_keys")` mutation before the REVOKE.
- Two PRs: writer deploy FIRST, soak, then the REVOKE migration — ⚠️ never migration-first.
- Soak = one deploy cycle + prod smoke of the wizard key-add flow before landing the REVOKE PR.

### asset_class stamp + B-D2 oracle
- The `finalize-wizard` stamp derives from the attested venue, and the swap lands in the SAME change as the null-attestation extension of `skipAssetClassWrite`: a NULL attestation SKIPS — never stamps `traditional`/√252 (the `isCryptoExchange(null) === false` trap).
- Oracle pins the ECONOMICS ("a null attestation annualizes on nothing — it skips"), never the implementation's own expression (founder testing rule).
- Census-identified affected strategies get golden-parity re-annualization; no blanket backfill.

### Claude's Discretion
- Exact census SQL shape, artifact formatting, and the documented B-D1 threshold value.
- Test file placement and naming, following existing route.test.ts conventions.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase-156 service-role-writer pattern in `validate-and-encrypt` (knows the canonical venue).
- `skipAssetClassWrite` guard and `isCryptoExchange` in `finalize-wizard/route.ts:1288-1311` / `src/lib/closed-sets.ts`.
- Census discipline template: migration `20260811210000`.

### Established Patterns
- Deploy-first / revoke-second discipline for moving client writes server-side.
- Economic-invariant oracles for money-math tests (never self-referential).

### Integration Points
- Client INSERT sites: `src/components/strategy/ApiKeyManager.tsx:254`, `src/components/strategy/StrategyForm.tsx:140` (live DELETE at `ApiKeyManager.tsx:352` stays).
- `src/app/api/strategies/finalize-wizard/route.ts`, `create-with-key/route.ts`.

</code_context>

<specifics>
## Specific Ideas

- ⚠️ TODOS.md's "one-identifier change" framing is measured WRONG — `attested_venue` is NULL for trigger-scrubbed and pre-backfill rows.
- Merging `supabase/migrations/**` to main AUTO-applies to PROD — REVOKE migration lands only in the second PR after soak.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
