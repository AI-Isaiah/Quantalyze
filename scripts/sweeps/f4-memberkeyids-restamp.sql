-- ============================================================================
-- One-off sweep: F-4 deploy-skew memberKeyIds re-stamp (CF-03)
-- Phase 66 / Plan 66-02
-- ============================================================================
-- Red-team finding F-4: during the v1.6 mixed-version deploy window a client
-- running old code could Update-save a scenario at schema_version >= 4 while
-- DROPPING the memberKeyIds key that a genuine v4 write always carries. Such a
-- row silently degrades share-caption honesty (the caption can no longer tell
-- book-membership from per-key membership) until the draft is reopened.
--
-- This is a DETECTION-FIRST, IDEMPOTENT, SELECT-before-mutate sweep — the same
-- contract as scripts/backfill_funding.py (one-shot; re-runs are no-ops). It is
-- run ONCE against prod (khslejtfbuezsmvmtsdn) from the main session via the
-- Supabase MCP (executor subagents have NO Supabase MCP). Per phase decision D
-- there is NO cron and NO migration — the deploy window is closed, so a one-off
-- correction is the honest fix, not a persistent pathway.
--
-- The three sections below are run in order. A 0-row DETECT result is a VALID,
-- evidence-recorded closure (no mutation needed) — record it verbatim.
--
-- ---------------------------------------------------------------------------
-- Correctness grounding — the sweep MIRRORS the runtime reopen re-derive so a
-- swept row is byte-equal to what a reopen would have produced:
--   - runtime reopen normalize:  ScenarioComparePanel.tsx:252-261
--     (draft.memberKeyIds === undefined
--        ? setMemberKeyIds(draft, deriveMembershipFromGate(gate, eligibleIds))
--        : draft)
--   - derive rule:               scenario-state.ts:670-675
--     deriveMembershipFromGate(gate, eligibleIds) = gate ? [...eligibleIds] : []
--   - eligible-key predicate:    src/lib/queries.ts:2241-2249 (isPerKeyDailiesEligibleKey)
--     is_active = true AND sync_status IS DISTINCT FROM 'revoked'
--       AND disconnected_at IS NULL
--   - gate predicate:            src/lib/queries.ts:2205-2214 (allActiveKeysHavePerKeyDailies)
--     eligible set non-empty AND EVERY eligible key has a non-empty per-key
--     csv_daily_returns series
--   - series-derive filter:      src/lib/queries.ts:2257-2271 (buildPerKeyReturnsByApiKeyId)
--     "non-empty per-key series" is NOT "a row exists": the runtime KEEPS a
--     row only when its api_key_id is non-null AND its daily_return is finite
--     (Number.isFinite drops NaN/±Infinity). So has_series below MUST apply
--     the same finite filter — otherwise a key whose only rows are non-finite
--     would count as has_series=true here yet derive an EMPTY runtime series,
--     and the sweep could stamp eligible ids where a reopen would stamp []
--     (WR-01), breaking the byte-equal-to-a-reopen invariant.
--   - series-fetch window:       src/lib/queries.ts:2571-2584 (.gte "date")
--     the runtime fetches csv_daily_returns bounded to the last 730 days
--     the last 730 days (UTC-pinned: the runtime bound is UTC-derived via
--     Date.now(), and CURRENT_DATE would follow the SESSION timezone) BEFORE
--     the gate runs, so rows older
--     than the window are invisible to the runtime series. has_series below
--     MUST apply the SAME 730-day date window — otherwise a key whose only
--     finite rows are >730 days old counts as has_series=true here yet derives
--     an EMPTY runtime series (CR-2), the same class of byte-equality break as
--     WR-01 but on the time axis rather than the finiteness axis.
--
-- The stamped id array is normalized ORDER BY api_key_id for determinism —
-- caption honesty depends on the SET of member keys, not their order.
--
-- Genuine-v4 invariant (A1): a genuine v4 write ALWAYS carries the memberKeyIds
-- key (blank save persists [], book save persists ids). Key ABSENCE on a
-- schema_version >= 4 row is therefore the downgrade signature. The DISCRIMINATOR
-- keys on presence (draft ? 'memberKeyIds'), NOT on the gate — so a genuine
-- blank-save row (memberKeyIds: []) is untouchable.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- (1) SANITY — prove assumption A1 against prod BEFORE trusting the
--     discriminator: known genuine schema_version >= 4 rows must carry the key.
--     Expect has_member_key_ids = true for every genuine write below.
-- ---------------------------------------------------------------------------
SELECT
  id,
  allocator_id,
  schema_version,
  (draft ? 'memberKeyIds')          AS has_member_key_ids,
  updated_at
FROM scenarios
WHERE schema_version >= 4
ORDER BY updated_at DESC
LIMIT 25;


-- ---------------------------------------------------------------------------
-- (2) DETECT — the locked discriminator. Record the full result set (ids,
--     allocator_ids, updated_at). If this returns 0 rows: STOP — record
--     "0 downgraded rows as of <timestamp>" as the closure evidence; F-4 is
--     honestly closed with no mutation. NEVER run the RESTAMP without a
--     same-session DETECT first.
-- ---------------------------------------------------------------------------
SELECT
  id,
  allocator_id,
  schema_version,
  updated_at
FROM scenarios
WHERE schema_version >= 4
  AND NOT (draft ? 'memberKeyIds');


-- ---------------------------------------------------------------------------
-- (2b) BEFORE snapshot — run ONLY if DETECT returned rows. Capture the
--      pre-mutation state of every affected row for the evidence trail.
-- ---------------------------------------------------------------------------
SELECT
  id,
  allocator_id,
  schema_version,
  draft -> 'memberKeyIds'           AS member_key_ids_before,   -- expected NULL (key absent)
  updated_at
FROM scenarios
WHERE schema_version >= 4
  AND NOT (draft ? 'memberKeyIds');


-- ---------------------------------------------------------------------------
-- (3) RESTAMP — idempotent re-derive UPDATE. Stamps memberKeyIds ONLY for rows
--     matching the discriminator (schema_version >= 4 AND NOT (draft ?
--     'memberKeyIds')), so re-runs and genuine-v4 rows (including the blank-save
--     memberKeyIds: [] shape) are untouched. The derived value mirrors
--     deriveMembershipFromGate server-side per allocator:
--       gate true  -> JSONB array of that allocator's eligible api_key ids
--       gate false -> '[]'::jsonb
--     updated_at is deliberately NOT bumped — this is a data-integrity
--     correction, not a user edit, and the original timestamp is evidence.
-- ---------------------------------------------------------------------------
UPDATE scenarios s
SET draft = jsonb_set(
  s.draft,
  '{memberKeyIds}',
  (
    SELECT CASE
      -- gate = eligible set non-empty AND every eligible key has a series
      -- (allActiveKeysHavePerKeyDailies, queries.ts:2205-2214)
      WHEN count(*) > 0 AND bool_and(ek.has_series)
        THEN COALESCE(
               jsonb_agg(to_jsonb(ek.api_key_id::text) ORDER BY ek.api_key_id),
               '[]'::jsonb
             )
      ELSE '[]'::jsonb
    END
    FROM (
      -- eligible keys for this allocator (isPerKeyDailiesEligibleKey,
      -- queries.ts:2241-2249), each tagged with whether it has a non-empty
      -- per-key csv_daily_returns series.
      SELECT
        k.id AS api_key_id,
        EXISTS (
          -- Mirror buildPerKeyReturnsByApiKeyId's drop rule
          -- (queries.ts:2257-2271): count a row ONLY when the runtime would
          -- keep it. The api_key_id = k.id join already drops the
          -- null-api_key_id rows the runtime skips. daily_return is
          -- DOUBLE PRECISION NOT NULL, so no NULL guard is needed (the column
          -- forbids NULL); but a float8 column with no finiteness CHECK CAN
          -- hold NaN/±Infinity, which the runtime's Number.isFinite drops.
          -- NOTE: Postgres treats NaN = NaN as TRUE (non-IEEE ordering for
          -- float8), so the `x = x` NaN test does NOT work here — exclude the
          -- three non-finite float8 literals explicitly.
          SELECT 1 FROM csv_daily_returns c
          WHERE c.api_key_id = k.id
            -- CR-2: mirror the runtime's 730-day DATE WINDOW. The runtime
            -- fetches csv_daily_returns with .gte("date", now-730d)
            -- (queries.ts:2577) BEFORE the gate, so a key whose ONLY finite
            -- rows are older than 730 days derives an EMPTY runtime series
            -- (gate false). Without this bound the sweep would see has_series
            -- = true and stamp eligible ids where a reopen stamps [],
            -- breaking the byte-equal-to-a-reopen invariant.
            AND c.date >= ((now() AT TIME ZONE 'UTC')::date - INTERVAL '730 days')
            AND c.daily_return <> 'NaN'::float8
            AND c.daily_return <> 'Infinity'::float8
            AND c.daily_return <> '-Infinity'::float8
        ) AS has_series
      FROM api_keys k
      WHERE k.user_id = s.allocator_id
        AND k.is_active
        AND k.sync_status IS DISTINCT FROM 'revoked'
        AND k.disconnected_at IS NULL
    ) ek
  ),
  true   -- create_missing: the discriminator guarantees the key is absent
)
WHERE s.schema_version >= 4
  AND NOT (s.draft ? 'memberKeyIds');


-- ---------------------------------------------------------------------------
-- (4) AFTER / VERIFY — post-condition. This MUST return 0 rows: every
--     schema_version >= 4 row now carries the memberKeyIds key. Also re-run
--     an AFTER snapshot of the previously-detected ids to record the stamped
--     values in the evidence trail.
-- ---------------------------------------------------------------------------
SELECT count(*) AS remaining_downgraded_rows
FROM scenarios
WHERE schema_version >= 4
  AND NOT (draft ? 'memberKeyIds');
