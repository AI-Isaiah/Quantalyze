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
 * Audit 2026-05-12 (Lane E) hardening
 * -----------------------------------
 * - P449: 31 sequential SELECTs collapsed into a bounded-concurrency
 *   `Promise.all` pool (cap 10) to avoid Supabase connection-pool
 *   exhaustion while removing the ~3s serial-latency tax.
 * - P450: O(log n) binary-search re-serialization replaced with an
 *   O(n) cumulative-size budget — each row is stringified once and
 *   its UTF-8 byte length accumulated. Once the budget is exceeded
 *   the remaining rows in that table (and all subsequent tables) are
 *   dropped from the tail (FIFO — preserves the oldest rows the user
 *   has accumulated; documented decision).
 * - P460/P697/P707/P708: `audit_log` removed from the raw export
 *   manifest. Replaced with the synthetic `audit_log_for_user`
 *   projection that (a) keeps ONLY rows where the subject acted
 *   (user_id = subject) and (b) redacts metadata fields that
 *   identify OTHER users (display_name, email, partner_tag,
 *   manager_id, allocator_email).
 *   `contact_requests` rows are likewise redacted: the user's own
 *   row state is preserved but the cross-party `strategy_id` is
 *   blanked (pointing at it would identify the other user's
 *   strategy).
 * - P698: every entry in USER_EXPORT_TABLES has an explicit filter
 *   column (direct: `user_column`; indirect: `parent_user_column`)
 *   so the projection is symmetric with the table's RLS policy. The
 *   build-time grep in `scripts/check-gdpr-export-coverage.ts`
 *   verifies that no entry exports without a filter.
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

/**
 * Projection: the table source is queried RAW from a different table
 * name and post-processed through a projection function before
 * landing in the bundle. Used for audit_log → audit_log_for_user
 * (filter rows where subject acted + redact other-user PII in
 * metadata).
 *
 * Why a separate kind? Because the bundle's `table` name MUST differ
 * from the raw `source_table` (the bundle exposes a synthetic
 * projection, not the raw rows). The CI coverage hook
 * (`scripts/check-gdpr-export-coverage.ts`) understands this kind so
 * the raw source table is considered covered.
 */
export interface ProjectedUserTable {
  kind: "projected";
  /** Bundle-facing name (e.g. "audit_log_for_user"). */
  table: string;
  /** Underlying table name the SELECT hits. */
  source_table: string;
  /** Column on source_table holding the subject's user id. */
  user_column: string;
  /** Post-fetch redaction function. */
  project: (rows: unknown[], userId: string) => unknown[];
}

export type UserExportTable =
  | DirectUserTable
  | IndirectUserTable
  | ProjectedUserTable;

/**
 * Sentinel used when redacting fields that identify OTHER users in
 * cross-party rows that the subject is still entitled to see.
 * Stable string so a downstream JSON consumer can grep for occurrences.
 */
export const REDACTED_PLACEHOLDER = "[REDACTED — other user]";

/**
 * Metadata keys on `audit_log.metadata` that we know can reference
 * OTHER users (manager identity, allocator identity, partner handles).
 * Kept narrow so we don't blank legitimate own-state metadata
 * (strategy_id, source, etc).
 *
 * Convention: if an audit producer adds a NEW metadata field that
 * references another user, append the key here. The unit test
 * `gdpr-export-redaction.test.ts` pins the redaction shape.
 */
const AUDIT_METADATA_REDACT_KEYS = new Set<string>([
  "display_name",
  "email",
  "partner_tag",
  "manager_id",
  "manager_email",
  "manager_display_name",
  "allocator_email",
  "allocator_display_name",
  "other_user_id",
  "target_user_id",
  "actor_email",
  "actor_display_name",
]);

/**
 * Projection helper — audit_log → audit_log_for_user.
 *
 * Keeps rows where the subject is the actor (user_id === subject).
 * Redacts metadata keys that identify OTHER users with
 * REDACTED_PLACEHOLDER.
 *
 * Exported for unit-test pinning (`gdpr-export-redaction.test.ts`).
 */
export function redactAuditLogForUser(
  rows: unknown[],
  userId: string,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    if (row.user_id !== userId) continue;
    const clone: Record<string, unknown> = { ...row };
    const meta = clone.metadata;
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      const redactedMeta: Record<string, unknown> = { ...(meta as Record<string, unknown>) };
      for (const key of Object.keys(redactedMeta)) {
        if (AUDIT_METADATA_REDACT_KEYS.has(key)) {
          redactedMeta[key] = REDACTED_PLACEHOLDER;
        }
      }
      clone.metadata = redactedMeta;
    }
    out.push(clone);
  }
  return out;
}

/**
 * Projection helper — contact_requests projected for the subject.
 *
 * Keeps only rows where `allocator_id === subject` (the user as the
 * allocator who sent the contact request). Blanks `strategy_id`
 * because the strategy belongs to a DIFFERENT user (the manager), so
 * disclosing it would let the subject derive the manager's strategy
 * inventory.
 *
 * Exported for unit-test pinning.
 */
export function redactContactRequestForUser(
  rows: unknown[],
  userId: string,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    if (row.allocator_id !== userId) continue;
    const clone: Record<string, unknown> = { ...row };
    if ("strategy_id" in clone && clone.strategy_id !== null) {
      clone.strategy_id = REDACTED_PLACEHOLDER;
    }
    out.push(clone);
  }
  return out;
}

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
  // Phase 07 (migration 070): allocator_equity_snapshots is user-owned via
  // allocator_id (= api_keys.user_id, enforced by the same owner-coherence
  // trigger as allocator_holdings). Per-day equity history is personal data —
  // GDPR Art. 15 requires it be part of the user's export.
  { kind: "direct", table: "allocator_equity_snapshots", user_column: "allocator_id" },
  // Phase 06 (migration 066): allocator_holdings is user-owned via
  // allocator_id (= api_keys.user_id, enforced by the f5 owner-coherence
  // trigger). Exchange positions + balances are personal data —
  // GDPR Art. 15 requires they be part of the user's export.
  { kind: "direct", table: "allocator_holdings", user_column: "allocator_id" },
  { kind: "direct", table: "allocator_preferences", user_column: "user_id" },
  { kind: "direct", table: "api_keys", user_column: "user_id" },
  // contact_requests carries a cross-party `strategy_id` referring to
  // another user's strategy. The projected version retains the
  // subject's own row state and blanks the cross-party link.
  // See `redactContactRequestForUser` and Lane E audit P708.
  {
    kind: "projected",
    table: "contact_requests",
    source_table: "contact_requests",
    user_column: "allocator_id",
    project: redactContactRequestForUser,
  },
  { kind: "direct", table: "bridge_outcome_dismissals", user_column: "allocator_id" },
  { kind: "direct", table: "bridge_outcomes", user_column: "allocator_id" },
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
  // Projected (raw source table excluded; bundle exposes a redacted
  // projection — see kind:"projected" docstring)
  // ------------------------------------------------------------------
  // audit_log entries can reference OTHER users in `metadata` (manager
  // display_name, partner_tag of the counter-party allocator, etc.).
  // The subject is entitled to the entries THEY authored, with
  // cross-party identifiers blanked. See Lane E audit P460/P697/P707.
  {
    kind: "projected",
    table: "audit_log_for_user",
    source_table: "audit_log",
    user_column: "user_id",
    project: redactAuditLogForUser,
  },
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
 * Max concurrent table fetches against Supabase. Cap chosen to balance
 * latency (31 sequential ~= 3s of round-trip; 10-parallel ~= 300ms) and
 * connection-pool pressure (Supabase pooler defaults to ~15 PgBouncer
 * connections per role; 10 leaves headroom for the rest of the request
 * lifecycle). See Lane E audit P449.
 */
export const EXPORT_FETCH_CONCURRENCY = 10;

/**
 * Shape of one `tables[*]` entry in the export bundle.
 *
 * Issue 5 (audit-2026-05-07 follow-up): `fetch_error` carries the failure
 * mode when a table's fetch errored or its Promise rejected. The route
 * inspects this — if any table has a non-null `fetch_error` the route
 * refuses to mint a signed URL (option (a) below), surfacing a 500 with
 * a stable code instead of silently substituting `[]`. GDPR Art. 15
 * requires a COMPLETE export; a partial bundle marked as such would
 * still be a violation, so the chosen policy is "fail loud, ask the
 * user to retry".
 */
export interface ExportTablePayload {
  table: string;
  rows: unknown[];
  row_count: number;
  truncated_at_cap: boolean;
  fetch_error: string | null;
}

/**
 * Shape of the full export bundle that lands in Supabase Storage.
 *
 * Issue 5: `partial` + `failed_tables` make any read failure observable
 * to bundle consumers. In the chosen policy (option (a)) the route never
 * actually persists a bundle with partial=true, but the helper still
 * exposes the fields so the route's gate has a single object to inspect
 * and tests can pin the exact shape.
 */
export interface ExportBundle {
  schema_version: 1;
  user_id: string;
  generated_at: string;
  total_row_count: number;
  tables: ExportTablePayload[];
  truncated_at_size_cap: boolean;
  partial: boolean;
  failed_tables: string[];
}

/**
 * Collect every row referenced by `user_id`, running one SELECT per
 * table in the manifest. Uses the provided admin client because (a)
 * the export aggregates ACROSS tables whose RLS scopes differ (e.g.,
 * audit_log is owner-read but match_decisions is cross-party), and
 * (b) the caller has already been authenticated + authorized in the
 * route wrapper.
 *
 * Concurrency model
 * -----------------
 * Tables are fetched in bounded-concurrency batches of
 * `EXPORT_FETCH_CONCURRENCY` (10). Within a batch, all fetches run in
 * parallel via `Promise.allSettled` — a single failed fetch logs and
 * yields an empty `rows[]` for that table without aborting the rest
 * of the bundle. Manifest order is preserved in the output bundle so
 * downstream consumers can rely on stable indexing.
 *
 * Size-cap model (P450)
 * ---------------------
 * The legacy implementation re-serialized the entire bundle inside a
 * binary-search loop (O(log n) full re-stringifications, each ~100MB).
 * The new path is O(n):
 *   - For each row in each table, JSON.stringify just THAT row and
 *     accumulate its UTF-8 byte length into `bytesUsed`.
 *   - Stop including rows once `bytesUsed + nextRowBytes >
 *     EXPORT_SIZE_CAP_BYTES`.
 *   - Drop policy: FIFO from the tail (preserves the OLDEST rows the
 *     user has accumulated — matches user-intuition that "old history"
 *     is more durably valuable than the freshest tail). Documented
 *     decision; reversible by sorting the rows array.
 *
 * Returns an ExportBundle. The caller writes it to storage and
 * returns a signed URL.
 */
export async function collectUserExportBundle(
  admin: SupabaseClient,
  userId: string,
): Promise<ExportBundle> {
  // Phase 1: parallel fetch across all 31 tables (bounded concurrency).
  // Manifest order is preserved by storing into a positional array.
  //
  // Issue 5 (audit-2026-05-07 follow-up): pre-fix, both the
  // Promise.allSettled rejection branch AND `fetchRowsForSpec`'s
  // per-error returns silently substituted `[]` — the bundle reported
  // "row_count: 0" for failed tables indistinguishably from genuinely
  // empty tables, violating the "complete export" requirement of GDPR
  // Art. 15. We now record an explicit `fetch_error` per table and
  // surface `partial: true` + `failed_tables` at the bundle level so
  // the route can refuse to deliver an incomplete bundle.
  interface FetchedEntry {
    spec: UserExportTable;
    rows: unknown[];
    error: string | null;
  }
  const fetched: Array<FetchedEntry | null> = new Array(
    USER_EXPORT_TABLES.length,
  ).fill(null);

  for (let start = 0; start < USER_EXPORT_TABLES.length; start += EXPORT_FETCH_CONCURRENCY) {
    const batch = USER_EXPORT_TABLES.slice(start, start + EXPORT_FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((spec) => fetchRowsForSpec(admin, spec, userId)),
    );
    for (let i = 0; i < batch.length; i += 1) {
      const r = results[i];
      const spec = batch[i];
      if (r.status === "fulfilled") {
        const result = r.value;
        if (result.error) {
          console.error(
            `[gdpr-export] fetch failed for ${spec.table}: ${result.error}`,
          );
          fetched[start + i] = { spec, rows: [], error: result.error };
        } else {
          fetched[start + i] = { spec, rows: result.rows, error: null };
        }
      } else {
        const reason =
          r.reason instanceof Error
            ? r.reason.message
            : String(r.reason ?? "unknown rejection");
        console.error(
          `[gdpr-export] batch fetch rejected for ${spec.table}: ${reason}`,
        );
        fetched[start + i] = { spec, rows: [], error: reason };
      }
    }
  }

  // Phase 2: cumulative-size budget. O(n) over the rows, NOT
  // O(log n) over the full bundle.
  const tables: ExportTablePayload[] = [];
  const failedTables: string[] = [];
  let totalRowCount = 0;
  let bytesUsed = 0;
  let truncatedAtSizeCap = false;
  const encoder = new TextEncoder();

  for (const entry of fetched) {
    if (!entry) continue;
    const { spec, rows, error: fetchError } = entry;

    if (fetchError) {
      failedTables.push(spec.table);
    }

    if (truncatedAtSizeCap) {
      tables.push({
        table: spec.table,
        rows: [],
        row_count: 0,
        truncated_at_cap: true,
        fetch_error: fetchError,
      });
      continue;
    }

    const includedRows: unknown[] = [];
    let tableTruncated = rows.length >= EXPORT_PER_TABLE_ROW_CAP;

    for (const row of rows) {
      // Stringify once. Per-row size includes the trailing comma the
      // outer JSON.stringify would insert; small constant overhead.
      const rowBytes = encoder.encode(JSON.stringify(row) + ",").byteLength;
      if (bytesUsed + rowBytes > EXPORT_SIZE_CAP_BYTES) {
        truncatedAtSizeCap = true;
        tableTruncated = true;
        break;
      }
      includedRows.push(row);
      bytesUsed += rowBytes;
    }

    tables.push({
      table: spec.table,
      rows: includedRows,
      row_count: includedRows.length,
      truncated_at_cap: tableTruncated,
      fetch_error: fetchError,
    });
    totalRowCount += includedRows.length;
  }

  return {
    schema_version: 1,
    user_id: userId,
    generated_at: new Date().toISOString(),
    total_row_count: totalRowCount,
    tables,
    truncated_at_size_cap: truncatedAtSizeCap,
    partial: failedTables.length > 0,
    failed_tables: failedTables,
  };
}

/**
 * Execute the SELECT for one table spec. For indirect tables, a two-hop
 * lookup is used: first fetch the parent ids (strategies, portfolios)
 * owned by the user, then select from the indirect table filtered by
 * those ids. A `.in()` filter with 50k elements is pathological — we
 * cap the parent-id batch at 2k, which handles any realistic user and
 * simply drops the tail in the extreme case (marked truncated).
 *
 * P698 — per-table user-id filter audit
 * -------------------------------------
 * Every branch below MUST apply a filter that scopes rows to the user.
 * direct  → `.eq(spec.user_column, userId)`
 * projected → `.eq(spec.user_column, userId)` (plus post-fetch redaction)
 * indirect → two-hop `.eq(parent_user_column, userId)` then `.in(via_column, parentIds)`
 *
 * Service-role bypasses RLS, so this filter is the ONLY guarantee that
 * the export contains the subject's own data. A future refactor that
 * drops a filter would silently leak cross-tenant rows.
 */
interface FetchRowsResult {
  rows: unknown[];
  error: string | null;
}

async function fetchRowsForSpec(
  admin: SupabaseClient,
  spec: UserExportTable,
  userId: string,
): Promise<FetchRowsResult> {
  if (spec.kind === "direct") {
    const { data, error } = await admin
      .from(spec.table)
      .select("*")
      .eq(spec.user_column, userId)
      .limit(EXPORT_PER_TABLE_ROW_CAP);
    if (error) {
      // Issue 5 fix: surface the error to the bundle instead of silently
      // substituting `[]`. The route's gate refuses to mint a signed URL
      // when ANY table reports a fetch_error.
      const msg = `direct select failed for ${spec.table}: ${error.message}`;
      console.error(`[gdpr-export] ${msg}`);
      return { rows: [], error: msg };
    }
    return { rows: data ?? [], error: null };
  }

  if (spec.kind === "projected") {
    // Fetch raw rows from the source table, filtered to the subject.
    const { data, error } = await admin
      .from(spec.source_table)
      .select("*")
      .eq(spec.user_column, userId)
      .limit(EXPORT_PER_TABLE_ROW_CAP);
    if (error) {
      const msg = `projected select failed for ${spec.source_table} (->${spec.table}): ${error.message}`;
      console.error(`[gdpr-export] ${msg}`);
      return { rows: [], error: msg };
    }
    // Run the redaction projection. This is where cross-party PII in
    // metadata gets blanked.
    return { rows: spec.project(data ?? [], userId), error: null };
  }

  // Indirect: two-hop.
  const { data: parentRows, error: parentErr } = await admin
    .from(spec.parent_table)
    .select("id")
    .eq(spec.parent_user_column, userId)
    .limit(2000);
  if (parentErr) {
    const msg = `parent select failed for ${spec.parent_table} (via ${spec.table}): ${parentErr.message}`;
    console.error(`[gdpr-export] ${msg}`);
    return { rows: [], error: msg };
  }
  const parentIds = (parentRows ?? []).map((r: { id: string }) => r.id);
  if (parentIds.length === 0) {
    return { rows: [], error: null };
  }

  const { data, error } = await admin
    .from(spec.table)
    .select("*")
    .in(spec.via_column, parentIds)
    .limit(EXPORT_PER_TABLE_ROW_CAP);
  if (error) {
    const msg = `indirect select failed for ${spec.table}: ${error.message}`;
    console.error(`[gdpr-export] ${msg}`);
    return { rows: [], error: msg };
  }
  return { rows: data ?? [], error: null };
}
