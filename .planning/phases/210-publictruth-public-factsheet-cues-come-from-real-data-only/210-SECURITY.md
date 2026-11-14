---
phase: 210
slug: publictruth
status: SECURED
asvs_level: 2
block_on: high
threats_total: 15
threats_closed: 15
threats_open: 0
audited_at_sha: d7620a323
---

# Phase 210 PUBLICTRUTH - Security Audit

Audit method: each declared mitigation was located in the implemented code (diff `8fc78b69a...HEAD`, planning files excluded). Summaries and plan prose were not taken as evidence. No config `asvs_level` or `block_on` is set; defaults applied (ASVS L2: mitigation must address the vector at the correct boundary; `block_on: high`).

## Threat Verification

| Threat ID | Category | Severity | Disposition | Status | Evidence |
|-----------|----------|----------|-------------|--------|----------|
| T-210-01 | Information disclosure (RETURNS TABLE allow-list) | high | mitigate | CLOSED | `supabase/migrations/20261114120000_get_published_trade_venues_open_windows.sql` declares `RETURNS TABLE (strategy_id uuid, exchange text)`; the self-verify DO block raises unless `pg_get_function_result` equals `TABLE(strategy_id uuid, exchange text)`. Arm TV-shape in `supabase/tests/test_get_published_trade_venues.sql` edits both migrations (`20261019120000` and `20261114120000`) so a widened shape reds. |
| T-210-02 | Information disclosure (published gate) | high | mitigate | CLOSED | `s.status = 'published'` is present on BOTH arms of the new body (checked by diff against the 20261019120000 body: only the extra window predicate differs, the gate lines are identical). Arms TV-1, TV-unpublished, TV-unpublished-composite are re-pointed at the new file; TV-unpublished-composite's find string keeps the window line so it stays reachable. The `supabase/schema/functions/get_published_trade_venues.sql` mirror matches. |
| T-210-03 | Elevation of privilege (SECDEF search_path) | high | mitigate | CLOSED | `SECURITY DEFINER` + `SET search_path = public, pg_temp` on the function; self-verify checks `prosecdef` and `'search_path=public, pg_temp' = ANY(proconfig)`. Every table reference is schema-qualified (`public.strategies`, `public.api_keys`, `public.strategy_keys`). The rollback file re-asserts the same. |
| T-210-04 | Tampering (open-window predicate) | medium | mitigate | CLOSED | Second arm carries `AND (sk.window_end IS NULL OR sk.window_end > current_date)`; the single-key arm is unchanged (D-02). Self-verify checks `position('sk.window_end > current_date' IN prosrc)`. Behavioural arms TV-closed-window and TV-window-end-today exist with RED-UNDER-M neuters (loosen to `- 3650`, inclusive `>=`) and fixtures built from `current_date` arithmetic (closed, all-closed, ends-today composites). |
| T-210-05 | DoS (blocked deploy on empty TEST tables) | medium | mitigate | CLOSED | Self-verify DO block reads only `pg_proc`, `aclexplode`, `has_function_privilege`, `prosrc`; no application table is read, so it applies on TEST's empty tables. No data-reading `RAISE EXCEPTION` count check. |
| T-210-06 | Elevation of privilege (EXECUTE grants) | medium | mitigate | CLOSED | `REVOKE ALL ON FUNCTION ... FROM PUBLIC;` then `GRANT EXECUTE ... TO anon, authenticated, service_role;`. Self-verify checks anon and authenticated EXECUTE and fails if `aclexplode(...)` shows grantee 0 holding EXECUTE. Existing arms TV-anon-exec and TV-auth-exec are not modified by the diff. |
| T-210-07 | Repudiation (demo figures in public api payload) | medium | mitigate | CLOSED | `src/lib/factsheet/build-payload.ts`: the `computePeerPercentile` / `alignBlend` / `buildAllocatorMetrics` imports, the `peerPercentile` and `allocatorPortfolios` fields and the three canned blends are removed from the `api` arm; `src/lib/factsheet/types.ts` drops both fields from `FactsheetApiPayload` and `AllocatorPortfolioPayload`. `allocator.ts` and `peer-cohort.ts` deleted. Repo-wide grep finds no non-test source reference to either field (one hit is a historical comment in `page.tsx`). Runtime pins `"peerPercentile" in payload` / `"allocatorPortfolios" in payload` === false in `build-payload.test.ts`, `FactsheetBody.no-demo-content.test.tsx`, `audit-c20.test.ts`, `composite-read-path.test.ts`, `figure-parity-pages.test.tsx`, `StressWindowsPanel.unreadable.test.tsx`. |
| T-210-08 | Tampering (snapshot refresh hides drift) | low | mitigate | CLOSED | `git diff --numstat` on `build-payload.test.ts.snap` is exactly 1 line out, 1 in; word-level diff shows only the `peerPercentile` + `allocatorPortfolios` keys removed; zero occurrences of either name remain in the snapshot. |
| T-210-09 | Tampering (FactsheetBody call sites) | low | mitigate | CLOSED | The no-op `hideAllocatorSection` prop was removed from the props type in `FactsheetView.tsx`; grep over `src` finds no remaining caller or reference (tsc would forbid re-adding). No `.skip` / `.only` / `todo` added anywhere in the diff. |
| T-210-10 | Tampering (census weakened) | medium | mitigate | CLOSED | `src/lib/return-stats.single-source.test.ts` diff: only the `allocator.ts` entry removed from `TIER2_SITES` and from `RETIRED`, with the counts (16->15 label, 28->27) adjusted to match; `BASE_EXPECTED` untouched; nothing excluded or skipped. The deleted file is genuinely absent from the tree. |
| T-210-11 | Information disclosure (Sentry extra) | medium | mitigate | CLOSED | `src/lib/factsheet/fetch-and-build-payload.ts`: the `captureToSentry` call passes a constant `Error` message, tags `{stage, reason, strategy_id}` and `extra: { detail: unrecoveredMalformed }`. `readUnrecoveredGaps` in `trade-fetch-provenance.ts` returns `malformed` only from six literal strings (provenance not an object; not an array; entry not an object; date not YYYY-MM-DD; ends before it starts; could not be read); no raw provenance, dates or exception text is interpolated. `captureToSentry` additionally runs `scrubRecord` over tags and extra. Test `T-210-11` in `fetch-and-build-payload.test.ts` asserts serialized `extra` contains neither offending date. |
| T-210-12 | Repudiation (gap record disclosure) | medium | mitigate | CLOSED | `unrecoveredGapsUnavailable: unrecoveredMalformed !== null` is passed from the reader's verdict (`fetch-and-build-payload.ts:1036`), carried in `build-payload.ts:1082`, typed in `types.ts`, and consumed at `FactsheetView.tsx:1655`; `trade-fetch-lines.tsx:192` renders `GAPS_UNAVAILABLE_SENTENCE` when set instead of nothing. Reader tests in `trade-fetch-provenance.test.ts` cover absent vs malformed (incl. hostile getter). |
| T-210-13 | Tampering (stale cached payload) | medium | mitigate | CLOSED | `src/app/factsheet/[id]/v2/page.tsx:306` key part is `factsheet-v2-payload-v25`; `git grep "payload-v24" -- src` returns nothing; pinned in `page.public-cache-key.test.tsx` and `factsheet-share/[token]/page.cache-isolation.test.tsx`. |
| T-210-14 | DoS (Sentry alert flood) | low | accept | CLOSED | Plan 05 accepted-risk entry stands: the report sits in `buildFromResolved`, which runs once per cache miss behind the 1 h `unstable_cache` (revalidate 3600), the same rate as the existing reconstructed-ranges report. Accepted risk is documented below. |
| T-210-SC | Tampering (npm installs) | low | accept | CLOSED | `git diff --stat` shows no change to `package.json` or `package-lock.json`; no dependency added. |

## Accepted Risks Log

| ID | Risk | Rationale | Owner |
|----|------|-----------|-------|
| T-210-14 | One Sentry event per cache miss per strategy with a malformed gap record | Bounded by the 1 h cache; same rate as the existing reconstructed-ranges report; fixed short reason only | founder (plan 05) |
| T-210-SC | No new packages in this phase | Lockfile unchanged | n/a |

## Unregistered Flags

None. All five SUMMARY `## Threat Flags` sections report none or map to T-210-11.

## Observations (informational, not threats)

- `strategy_id` is carried as a Sentry tag; it is the public factsheet's own id (no key material, label or user PII).
- A member whose window opens in the future is intentionally still returned (documented scope decision D-01 in the migration header, not a mitigation gap).
- The migration auto-applies to PROD after `apply-test`; migration-reviewer and rls-policy-auditor clean runs remain a pre-merge step owned by the phase review, outside this audit.

**threats_open:** 0
