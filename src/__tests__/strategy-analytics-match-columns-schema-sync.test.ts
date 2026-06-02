import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// @/lib/admin/match.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";
import { STRATEGY_ANALYTICS_MATCH_COLUMNS } from "@/lib/admin/match";

/**
 * STRATEGY_ANALYTICS_MATCH_COLUMNS schema sync (regression guard for the
 * total_aum bug, audit-2026-05-07 schema-mismatch sweep).
 *
 * getAllocatorMatchPayload enriches every match candidate with a
 * strategy_analytics projection. Through 0.24.15.x that projection listed
 * `total_aum` — a column that lives on portfolio_analytics, NOT
 * strategy_analytics. Because createAdminClient does not throwOnError and the
 * call site swallowed the error, the resulting PostgREST 42703 silently
 * blanked the ENTIRE analytics panel (sharpe/sortino/sparkline/...) for every
 * candidate on both the admin Match-queue and the public demo — the exact F3
 * dead-column failure class, just non-fatal.
 *
 * Two layers (mirrors mandate-columns-schema-sync.test.ts):
 *   1. Offline: parse strategy_analytics' real columns from the migrations
 *      (CREATE TABLE + every ALTER ... ADD COLUMN) and assert the projection
 *      is a subset. Runs in CI. FAILS if total_aum (or any drift) creeps back.
 *   2. Live-DB (HAS_LIVE_DB gate): projection select against the live table —
 *      PostgREST 400s on an unknown column, surfacing as a non-null error.
 */

const PROJECTION_COLUMNS = STRATEGY_ANALYTICS_MATCH_COLUMNS.split(",").map((c) =>
  c.trim(),
);

advertiseLiveDbSkipReason("strategy-analytics-match-columns-schema-sync");

/**
 * Parse the real strategy_analytics column set from the migrations:
 *   - the CREATE TABLE strategy_analytics ( ... ) block in initial_schema, and
 *   - every `ALTER TABLE [public.]strategy_analytics ADD COLUMN [IF NOT EXISTS] <name>`
 *     across all migrations (word-boundary anchored so strategy_analytics_series
 *     and other tables are excluded).
 */
function parseStrategyAnalyticsColumns(): Set<string> {
  const migrationsDir = path.resolve(__dirname, "..", "..", "supabase", "migrations");
  const cols = new Set<string>();

  const initial = fs.readFileSync(
    path.join(migrationsDir, "20260405061911_initial_schema.sql"),
    "utf8",
  );
  // Extract the CREATE TABLE strategy_analytics ( ... ); block.
  const createMatch = initial.match(
    /CREATE TABLE\s+(?:public\.)?strategy_analytics\s*\(([\s\S]*?)\n\)\s*;/i,
  );
  expect(createMatch).not.toBeNull();
  const constraintLead = /^(PRIMARY|FOREIGN|CHECK|UNIQUE|CONSTRAINT)\b/i;
  for (const rawLine of createMatch![1].split("\n")) {
    const line = rawLine.replace(/--.*$/, "").trim();
    if (!line || constraintLead.test(line)) continue;
    const m = line.match(/^([a-z_][a-z0-9_]*)/i);
    if (m) cols.add(m[1].toLowerCase());
  }

  // ALTER ... ADD COLUMN across all migrations, scoped to strategy_analytics.
  const addColumn = /\bADD COLUMN\s+(?:IF NOT EXISTS\s+)?([a-z_][a-z0-9_]*)/i;
  const alterSa = /ALTER TABLE\s+(?:public\.)?strategy_analytics\b/i;
  const alterOther = /ALTER TABLE\s+(?:public\.)?(?!strategy_analytics\b)\w/i;
  const stmtEnd = /;\s*$/;
  for (const file of fs.readdirSync(migrationsDir)) {
    if (!file.endsWith(".sql")) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    let inAlterSa = false;
    for (const rawLine of sql.split("\n")) {
      const line = rawLine.replace(/--.*$/, "");
      if (alterSa.test(line)) inAlterSa = true;
      else if (alterOther.test(line)) inAlterSa = false;
      if (inAlterSa) {
        const m = line.match(addColumn);
        if (m) cols.add(m[1].toLowerCase());
      }
      if (stmtEnd.test(line)) inAlterSa = false;
    }
  }
  return cols;
}

describe("strategy_analytics match-projection schema sync", () => {
  it("never reintroduces total_aum (it lives on portfolio_analytics, not strategy_analytics)", () => {
    expect(PROJECTION_COLUMNS).not.toContain("total_aum");
  });

  it("every column in STRATEGY_ANALYTICS_MATCH_COLUMNS exists on strategy_analytics (per migrations)", () => {
    const realColumns = parseStrategyAnalyticsColumns();
    // Sanity: the parser actually found the table (guards a vacuous pass if the
    // initial-schema file is ever renamed).
    expect(realColumns.has("sharpe")).toBe(true);
    expect(realColumns.has("sparkline_returns")).toBe(true);
    expect(realColumns.size).toBeGreaterThan(10);

    const missing = PROJECTION_COLUMNS.filter((c) => !realColumns.has(c));
    expect(missing).toEqual([]);
  });

  it.skipIf(!HAS_LIVE_DB)(
    "every column in STRATEGY_ANALYTICS_MATCH_COLUMNS actually exists in the live strategy_analytics schema",
    async () => {
      const admin = createLiveAdminClient();
      const { error } = await admin
        .from("strategy_analytics")
        .select(STRATEGY_ANALYTICS_MATCH_COLUMNS)
        .limit(0);
      if (error) {
        throw new Error(
          `strategy_analytics select(${STRATEGY_ANALYTICS_MATCH_COLUMNS}) failed: ${error.message}. ` +
            `A column in the match projection was renamed/removed, or never existed (e.g. total_aum).`,
        );
      }
      expect(error).toBeNull();
    },
    60_000,
  );
});
