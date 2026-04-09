-- Migration 025: allocator-provided investment alias.
--
-- After the v0.4.0 pivot, the My Allocation page is a Scenarios-style
-- live view of the allocator's actual exchange-connected investments.
-- Each row is an investment the allocator made by giving a team a
-- read-only API key on their exchange account. The allocator needs to
-- be able to give each investment a human-readable name ("my Helios
-- allocation", "Atlas momentum sleeve", etc.) because the strategy's
-- own display name may not match the allocator's mental model of what
-- they actually bought.
--
-- Nullable: when NULL, the UI falls back to the strategy's own
-- display name (strategies.name or strategies.codename per disclosure
-- tier). When set, the alias takes priority in the allocator's view
-- only. Other viewers (the manager, public pages) still see the
-- canonical strategy name.
--
-- Idempotent: uses IF NOT EXISTS to match the convention from prior
-- migrations (009, 012, 014, 016, 023, 024).

ALTER TABLE public.portfolio_strategies
  ADD COLUMN IF NOT EXISTS alias TEXT;

COMMENT ON COLUMN public.portfolio_strategies.alias IS
  'Allocator-provided display name override for this investment row. NULL means fall back to the strategy''s canonical display name. Scoped per portfolio_strategies row so two allocators can label the same strategy differently.';
