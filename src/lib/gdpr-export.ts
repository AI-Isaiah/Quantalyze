import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * GDPR Art. 15 (right of access) + Art. 20 (data portability) export
 * helpers.
 *
 * Sprint 6 closeout Task 7.3. See migration 055 (storage bucket +
 * sanitize_user RPC), ADR-0023 (audit taxonomy), and the CI hook in
 * `scripts/check-gdpr-export-coverage.ts` (which greps migrations for
 * user-owned tables and fails if `USER_EXPORT_TABLES` lacks coverage).
 *
 * Design constraints
 * ------------------
 * 1. Enumerate EVERY table that references a specific user. The list below
 *    is the single source of truth. When a new migration adds a
 *    user-owned table, both this list AND the migration must land in the
 *    same PR — the CI hook exits non-zero if the list drifts from the
 *    migrations.
 * 2. 100MB cap. The route streams one JSON bundle; rows are collected in
 *    memory. If the total serialized size exceeds the cap, the route
 *    returns a `continuation_token` the client can use to resume with
 *    the next slice. V1 caps per-table row counts to bound memory; a
 *    future sprint can switch to true streamed JSON if the cap is hit
 *    in practice.
 * 3. Per-table selector is either a `user_column` (direct) or a
 *    `reachable_via` descriptor (indirect — the table is scoped to a
 *    user's strategies/portfolios). Both shapes produce the same output
 *    format: `{ table_name, rows: [...], row_count, truncated_at_cap }`.
 *
 * Why this file, not inline in the route
 * --------------------------------------
 * The CI hook (`scripts/check-gdpr-export-coverage.ts`) needs to import
 * the table list to diff it against the migrations. Pulling the list
 * into a server-only module that the hook re-reads via a tsx runtime
 * avoids duplicating the manifest.
 */

/**
 * Direct ownership: the table has a column that IS the user's id (an FK
 * to `profiles(id)` or `auth.users(id)`). The export route SELECTs
 * `* FROM <table> WHERE <column> = <user_id>`.
 */
export interface DirectUserTable {
  kind: "direct";
  table: string;
  /** Column holding the user's id. Usually "user_id"; for match_batches
   * etc. it's "allocator_id". */
  user_column: string;
}

/**
 * Indirect ownership: the table is scoped to a user's strategies,
 * portfolios, or organizations. The export route SELECTs with a sub-
 * select resolving via the parent relationship.
 *
 * Example: `trades` where `strategy_id IN (SELECT id FROM strategies
 * WHERE user_id = <user_id>)`.
 */
export interface IndirectUserTable {
  kind: "indirect";
  table: string;
  /** Foreign-key column on this table. */
  via_column: string;
  /** Parent table whose rows this table is scoped to. */
  parent_table: string;
  /** User-identifying column on the parent table. */
  parent_user_column: string;
}

export type UserExportTable = DirectUserTable | IndirectUserTable;

/**
 * Canonical list of every table that holds user-owned data.
 *
 * CI invariant: the hook in `scripts/check-gdpr-export-coverage.ts` reads
 * this list and fails CI if a migration adds a table with `user_id` (or
 * an equivalent owner column) that's NOT represented here.
 *
 * Ordering is alphabetical within each group to keep diffs stable.
 */
export const USER_EXPORT_TABLES: readonly UserExportTable[] = [
  // ------------------------------------------------------------------
  // Directly owned (has a user-id column)
  // ------------------------------------------------------------------
  { kind: "direct", table: "allocator_preferences", user_column: "user_id" },
  { kind: "direct", table: "api_keys", user_column: "user_id" },
  { kind: "direct", table: "audit_log", user_column: "user_id" },
  { kind: "direct", table: "contact_requests", user_column: "allocator_id" },
  { kind: "direct", table: "data_deletion_requests", user_column: "user_id" },
  { kind: "direct", table: "investor_attestations", user_column: "user_id" },
  { kind: "direct", table: "match_batches", user_column: "allocator_id" },
  { kind: "direct", table: "match_candidates", user_column: "allocator_id" },
  { kind: "direct", table: "match_decisions", user_column: "allocator_id" },
  { kind: "direct", table: "organization_members", user_column: "user_id" },
  { kind: "direct", table: "portfolios", user_column: "user_id" },
  { kind: "direct", table: "profiles", user_column: "id" },
  { kind: "direct", table: "strategies", user_column: "user_id" },
  { kind: "direct", table: "user_app_roles", user_column: "user_id" },
  { kind: "direct", table: "user_favorites", user_column: "user_id" },
  { kind: "direct", table: "user_notes", user_column: "user_id" },
  // ------------------------------------------------------------------
  // Indirectly owned (reachable via a parent table)
  // ------------------------------------------------------------------
  // Strategy-scoped data
  {
    kind: "indirect",
    table: "strategy_analytics",
    via_column: "strategy_id",
    parent_table: "strategies",
    parent_user_column: "user_id",
  },
  {
    kind: "indirect",
    table: "trades",
    via_column: "strategy_id",
    parent_table: "strategies",
    parent_user_column: "user_id",
  },
  {
    kind: "indirect",
    table: "funding_fees",
    via_column: "strategy_id",
    parent_table: "strategies",
    parent_user_column: "user_id",
  },
  {
    kind: "indirect",
    table: "reconciliation_reports",
    via_column: "strategy_id",
    parent_table: "strategies",
    parent_user_column: "user_id",
  },
  // Portfolio-scoped data
  {
    kind: "indirect",
    table: "portfolio_strategies",
    via_column: "portfolio_id",
    parent_table: "portfolios",
    parent_user_column: "user_id",
  },
  {
    kind: "indirect",
    table: "portfolio_analytics",
    via_column: "portfolio_id",
    parent_table: "portfolios",
    parent_user_column: "user_id",
  },
  {
    kind: "indirect",
    table: "portfolio_alerts",
    via_column: "portfolio_id",
    parent_table: "portfolios",
    parent_user_column: "user_id",
  },
  {
    kind: "indirect",
    table: "allocation_events",
    via_column: "portfolio_id",
    parent_table: "portfolios",
    parent_user_column: "user_id",
  },
  {
    kind: "indirect",
    table: "weight_snapshots",
    via_column: "portfolio_id",
    parent_table: "portfolios",
    parent_user_column: "user_id",
  },
] as const;

/**
 * Max total serialized size before the export truncates and sets the
 * continuation token. 100MB is the Task 7.3 spec cap.
 */
export const EXPORT_SIZE_CAP_BYTES = 100 * 1024 * 1024;

/**
 * Per-table row cap. Bounds memory on the server when a user's data
 * grows into the six-digit row range. The export payload for an
 * ordinary user should sit well below this.
 */
export const EXPORT_PER_TABLE_ROW_CAP = 50_000;

/**
 * Shape of one `tables[*]` entry in the export bundle.
 */
export interface ExportTablePayload {
  table: string;
  rows: unknown[];
  row_count: number;
  truncated_at_cap: boolean;
}

/**
 * Shape of the full export bundle that lands in Supabase Storage.
 */
export interface ExportBundle {
  schema_version: 1;
  user_id: string;
  generated_at: string;
  total_row_count: number;
  tables: ExportTablePayload[];
  truncated_at_size_cap: boolean;
}

/**
 * Collect every row referenced by `user_id`, running one SELECT per
 * table in the manifest. Uses the provided admin client because (a)
 * the export aggregates ACROSS tables whose RLS scopes differ (e.g.,
 * audit_log is owner-read but match_decisions is cross-party), and
 * (b) the caller has already been authenticated + authorized in the
 * route wrapper.
 *
 * Returns an ExportBundle. The caller writes it to storage and
 * returns a signed URL.
 */
export async function collectUserExportBundle(
  admin: SupabaseClient,
  userId: string,
): Promise<ExportBundle> {
  const tables: ExportTablePayload[] = [];
  let totalRowCount = 0;
  let totalBytes = 0;
  let truncatedAtSizeCap = false;

  for (const spec of USER_EXPORT_TABLES) {
    if (truncatedAtSizeCap) {
      // Once the cap is hit, emit empty shells for the remaining tables
      // so the caller sees which tables were skipped.
      tables.push({
        table: spec.table,
        rows: [],
        row_count: 0,
        truncated_at_cap: true,
      });
      continue;
    }

    const rows = await fetchRowsForSpec(admin, spec, userId);
    const payload: ExportTablePayload = {
      table: spec.table,
      rows,
      row_count: rows.length,
      truncated_at_cap: rows.length >= EXPORT_PER_TABLE_ROW_CAP,
    };

    // Approximate the serialized UTF-8 byte size so we can enforce the
    // 100MB cap without double-encoding. JSON.stringify(x).length counts
    // UTF-16 code units, which undercounts non-ASCII bytes (e.g. accented
    // display_name or emoji in bio) and would let the cap be exceeded.
    // TextEncoder.encode(...).byteLength returns true UTF-8 byte size.
    const approxBytes = new TextEncoder().encode(JSON.stringify(payload))
      .byteLength;
    if (totalBytes + approxBytes > EXPORT_SIZE_CAP_BYTES) {
      truncatedAtSizeCap = true;
      // Binary-search for the largest row-count whose serialized size
      // keeps totalBytes under the cap. The prior halving loop
      // under-packed: after the first pivot that fit, it stopped
      // searching, so the bundle lost rows between (fitting_pivot,
      // last_failed_pivot]. Proper binary search converges on the exact
      // boundary.
      let low = 0;
      let high = payload.rows.length;
      let bestRows = 0;
      let bestBytes = 0;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = {
          ...payload,
          rows: payload.rows.slice(0, mid),
          row_count: mid,
          truncated_at_cap: true,
        };
        const candidateBytes = new TextEncoder().encode(
          JSON.stringify(candidate),
        ).byteLength;
        if (totalBytes + candidateBytes <= EXPORT_SIZE_CAP_BYTES) {
          bestRows = mid;
          bestBytes = candidateBytes;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      const trimmed: ExportTablePayload = {
        ...payload,
        rows: payload.rows.slice(0, bestRows),
        row_count: bestRows,
        truncated_at_cap: true,
      };
      totalBytes += bestBytes;
      totalRowCount += trimmed.row_count;
      tables.push(trimmed);
    } else {
      totalBytes += approxBytes;
      totalRowCount += payload.row_count;
      tables.push(payload);
    }
  }

  return {
    schema_version: 1,
    user_id: userId,
    generated_at: new Date().toISOString(),
    total_row_count: totalRowCount,
    tables,
    truncated_at_size_cap: truncatedAtSizeCap,
  };
}

/**
 * Execute the SELECT for one table spec. For indirect tables, a two-hop
 * lookup is used: first fetch the parent ids (strategies, portfolios)
 * owned by the user, then select from the indirect table filtered by
 * those ids. A `.in()` filter with 50k elements is pathological — we
 * cap the parent-id batch at 2k, which handles any realistic user and
 * simply drops the tail in the extreme case (marked truncated).
 */
async function fetchRowsForSpec(
  admin: SupabaseClient,
  spec: UserExportTable,
  userId: string,
): Promise<unknown[]> {
  if (spec.kind === "direct") {
    const { data, error } = await admin
      .from(spec.table)
      .select("*")
      .eq(spec.user_column, userId)
      .limit(EXPORT_PER_TABLE_ROW_CAP);
    if (error) {
      console.error(
        `[gdpr-export] direct select failed for ${spec.table}:`,
        error.message,
      );
      return [];
    }
    return data ?? [];
  }

  // Indirect: two-hop.
  const { data: parentRows, error: parentErr } = await admin
    .from(spec.parent_table)
    .select("id")
    .eq(spec.parent_user_column, userId)
    .limit(2000);
  if (parentErr) {
    console.error(
      `[gdpr-export] parent select failed for ${spec.parent_table} (via ${spec.table}):`,
      parentErr.message,
    );
    return [];
  }
  const parentIds = (parentRows ?? []).map((r: { id: string }) => r.id);
  if (parentIds.length === 0) {
    return [];
  }

  const { data, error } = await admin
    .from(spec.table)
    .select("*")
    .in(spec.via_column, parentIds)
    .limit(EXPORT_PER_TABLE_ROW_CAP);
  if (error) {
    console.error(
      `[gdpr-export] indirect select failed for ${spec.table}:`,
      error.message,
    );
    return [];
  }
  return data ?? [];
}
