/**
 * Hard-coded demo allocator UUID. Matches the seed-demo-data.ts ALLOCATOR_ACTIVE
 * constant. Referenced by the public /demo + /demo/founder-view routes and by
 * the /api/demo/match/[allocator_id] endpoint's hard-assert check.
 *
 * IMPORTANT: this constant MUST stay in sync with
 * `scripts/seed-demo-data.ts::ALLOCATOR_ACTIVE`. The seed script deliberately
 * keeps its own copy (it is the canonical source of truth for seed UUIDs);
 * any drift between the two will break the public /demo lane.
 */
export const ALLOCATOR_ACTIVE_ID = "aaaaaaaa-0001-4000-8000-000000000002";
