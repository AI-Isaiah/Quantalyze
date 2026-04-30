/**
 * Live-DB integration test — Migration 092 (positions.duration_days NUMERIC).
 *
 * The intraday-strategies fix in v0.17.1.17 depends on positions.duration_days
 * being NUMERIC, not INTEGER. The Python writer rounds to 4 decimals; an
 * INTEGER column truncates that back to 0 and re-introduces the original
 * sub-day-truncation bug.
 *
 *   T_POS_DURATION_NUMERIC : information_schema.columns.data_type = 'numeric'
 *
 * Pinning this against the live schema means a future migration that narrows
 * the column back to INTEGER (or any other non-fractional type) trips CI
 * before the analytics worker silently regresses on intraday strategies.
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY +
 * an exposed introspection RPC. Skips gracefully when absent (matches the
 * existing live-db test convention).
 */

import { describe, it, expect } from "vitest";
import {
  HAS_LIVE_DB,
  HAS_INTROSPECTION,
  runIntrospectionSql,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

describe("migration 092 — positions.duration_days NUMERIC (live-DB)", () => {
  advertiseLiveDbSkipReason("positions-duration-days-numeric-schema");

  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "T_POS_DURATION_NUMERIC: positions.duration_days data_type = numeric",
    async () => {
      const rows = await runIntrospectionSql<{ data_type: string }>(
        "SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='positions' AND column_name='duration_days'",
      );
      expect(rows.length).toBe(1);
      expect(rows[0].data_type).toBe("numeric");
    },
    30_000,
  );
});
