-- Migration 014: strategies.codename (disclosure tier pseudonym column)
--
-- Migration 012 introduced the disclosure_tier concept and its comment
-- described exploratory strategies as "codename only", but the column
-- itself was never created. Shipped code depends on it:
--   * analytics-service/routers/match.py selects strategies.codename
--   * src/app/api/admin/match/[allocator_id]/route.ts joins codename
--   * AllocatorMatchQueue/CandidateDetail/SendIntroPanel render
--     codename || name as the displayed strategy label
--
-- Without this column the match engine recompute errors with
-- "column strategies.codename does not exist" and the admin match
-- queue API 500s. Adding it as nullable TEXT preserves all existing
-- rows (codename IS NULL -> UI falls back to name, which is the
-- intended behavior for institutional tier strategies).

ALTER TABLE strategies ADD COLUMN IF NOT EXISTS codename TEXT;

COMMENT ON COLUMN strategies.codename IS
  'Pseudonym shown in place of name when disclosure_tier = exploratory. NULL for institutional.';
