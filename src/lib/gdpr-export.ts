import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/utils";
import { captureToSentry } from "@/lib/sentry-capture";
import {
  USER_EXPORT_TABLES,
  getOrderColumn,
  type UserExportTable,
  type PublicRow,
} from "@/lib/gdpr-export-manifest";

// B13: the export manifest (types, redactors, USER_EXPORT_TABLES,
// ORDER_COLUMN_OVERRIDES, getOrderColumn) lives in the server-only-free
// `gdpr-export-manifest.ts` so the tsx CI coverage hook imports the SAME
// typed array this runtime uses. Re-export the full surface so existing
// importers of "@/lib/gdpr-export" keep resolving unchanged.
export * from "@/lib/gdpr-export-manifest";


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
 *   build-time check in `scripts/check-gdpr-export-coverage.ts`
 *   walks the imported typed array (B13) and verifies that no entry
 *   exports without a filter.
 *
 * Design constraints
 * ------------------
 * 1. Enumerate EVERY table that references a specific user.
 *    `USER_EXPORT_TABLES` (defined in `gdpr-export-manifest.ts` and
 *    re-exported here) is the single source of truth. When a new
 *    migration adds a user-owned table, both the manifest AND the
 *    migration must land in the same PR — the CI hook exits non-zero
 *    if the manifest drifts from the migrations.
 * 2. 100MB cap. The route assembles one JSON bundle in memory; if the
 *    total serialized size exceeds the cap, the bundle is truncated
 *    deterministically (per-row, sorted by stable column, oldest first)
 *    and `truncated_at_size_cap: true` is set on the envelope. Note:
 *    the V1 implementation does NOT mint a continuation_token — the
 *    docstring previously claimed one but no such field exists on
 *    `ExportBundle` (audit 2026-05-07 H-0456). A future sprint can
 *    switch to true streamed JSON / continuation tokens if the cap is
 *    hit in practice. V1 also caps per-table row counts to bound
 *    memory; both caps surface to the user via per-table flags + the
 *    bundle-level `truncated_at_size_cap` + `parent_id_truncated_tables`.
 * 3. Per-table selector is one of three kinds: `direct` (table has
 *    `user_column`), `indirect` (table is scoped to a user's
 *    strategies/portfolios via `parent_table` + `parent_user_column`),
 *    or `projected` (post-fetch redaction). All three produce the
 *    same output format: ExportTablePayload (table, rows, row_count,
 *    truncated_at_cap, parent_id_truncated, fetch_error).
 *
 * Why the manifest is its own module
 * ----------------------------------
 * The CI hook (`scripts/check-gdpr-export-coverage.ts`) needs to import
 * the table list to diff it against the migrations, but it runs under
 * `tsx` where this file's top-level `import "server-only"` would throw.
 * B13 moved `USER_EXPORT_TABLES` (and its types, redactors, and order
 * columns) into the `server-only`-free `gdpr-export-manifest.ts`, which
 * the hook imports directly as the SAME typed array this runtime uses —
 * replacing the prior brittle source-text regex scrape. This file
 * re-exports the manifest surface for back-compat.
 */


/**
 * Max total serialized size before the export truncates and sets
 * `truncated_at_size_cap: true` on the envelope. 100MB is the Task 7.3
 * spec cap. The cumulative budget is envelope-aware: it counts the
 * bundle skeleton, per-table wrappers, and per-row payload so the
 * final UTF-8 byte-length is strictly ≤ this cap (audit 2026-05-07
 * H-0454).
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
 * Max parent-table id rows probed for an indirect select's two-hop
 * lookup. A `.in()` filter scales linearly with the number of ids, and
 * PostgREST has a request-line-length ceiling that hits ~2.5k elements
 * for UUIDs. The 2000 cap leaves headroom and handles every realistic
 * user (a power user with thousands of strategies is uncommon enough
 * that the explicit truncation flag — `parent_id_truncated` — is the
 * right escape hatch).
 *
 * Audit 2026-05-07 H-0453: pre-fix this cap dropped the parent-id tail
 * silently with no signal in the bundle. The new path sets the
 * `parent_id_truncated` flag on the child-table payload when the
 * probe hits the cap.
 */
export const EXPORT_PARENT_ID_CAP = 2000;

/**
 * Audit 2026-05-07 red-team #10 (MED conf-8): PostgREST encodes
 * `.in(col, ids)` as a single query parameter `?col=in.(u1,u2,...)`.
 * For 2000 UUIDs at ~36 chars/each + comma overhead, the URL is
 * ~75KB — well past common intermediate-proxy limits (Vercel Edge
 * 16KB, CloudFront 8KB, nginx default 8KB) AND a hot-loop URL-string
 * allocator. Even if PostgREST accepts it, an edge proxy may 414 the
 * request, OR (worse) silently truncate the query string, causing
 * the SELECT to read a smaller id list and the bundle to lose data
 * with no error signal (parent_id_truncated reports parent count,
 * not URL truncation, so the truncation cause is mis-attributed).
 *
 * 500 keeps each `.in()` URL under ~18KB (500 × 36 + overhead),
 * within every common proxy budget. For users with > 500 parent
 * rows, we fan out across multiple SELECTs and union the results.
 * Total wall-time impact is bounded — 2000-id worst case is 4
 * SELECTs serially, ~400ms vs the legacy single-shot ~200ms — and
 * the new path is the ONLY one that is correct under intermediate
 * proxies. A regression test (`chunked indirect IN under proxy
 * limits`) pins the chunk size.
 */
export const EXPORT_PARENT_ID_IN_CHUNK = 500;

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
 *
 * Audit 2026-05-07 H-0453: `parent_id_truncated` flags indirect-table
 * fetches whose parent-id probe hit `EXPORT_PARENT_ID_CAP` (2000). A
 * user with >2000 strategies or portfolios silently lost all child
 * rows belonging to the dropped parents — fully invisible to the
 * bundle pre-fix. The flag is only meaningful for `kind: "indirect"`
 * specs (`false` for direct/projected).
 */
export interface ExportTablePayload {
  table: string;
  rows: unknown[];
  row_count: number;
  truncated_at_cap: boolean;
  parent_id_truncated: boolean;
  fetch_error: string | null;
}

/**
 * INTERNAL — module-scoped cache of per-row JSON strings keyed by
 * the ExportTablePayload object identity. Audit 2026-05-07
 * (specialist apply, performance HIGH conf-9): the cumulative-size
 * budget pass already serializes each row once for its UTF-8 byte
 * length. Caching those strings here lets `encodeExportBundle`
 * assemble the final upload from cached fragments without
 * re-stringifying every row inside `JSON.stringify(bundle)`.
 *
 * Using a WeakMap (not a payload field) keeps the cache off the
 * on-the-wire bundle: `JSON.stringify(bundle)` from tests / consumers
 * remains identical in shape and size to the pre-apply bundle. The
 * cache is GC'd automatically when the payload object becomes
 * unreachable.
 *
 * Audit 2026-05-07 red-team #13 (MED conf-8): the WeakMap is module-
 * level but is keyed by ExportTablePayload object IDENTITY. Two
 * concurrent calls to `collectUserExportBundle` produce two separate
 * bundle objects with two separate sets of ExportTablePayload object
 * identities, so cross-call aliasing is impossible by construction.
 * The unit test `concurrent same-user exports observe independent
 * cached rows` pins this invariant.
 *
 * Audit 2026-05-07 red-team #5 (HIGH conf-7): rows ARE deep-frozen
 * after caching (see `deepFreezeRow` below). If a post-collect caller
 * mutates a row in place — replacing a field, redacting at the route
 * layer — the mutation throws in strict mode, surfacing the
 * cache-staleness invariant violation at the point it would otherwise
 * silently emit stale bytes. Tests pin this freeze + the matching
 * throw under mutation.
 */
const ROW_JSON_CACHE: WeakMap<ExportTablePayload, readonly string[]> = new WeakMap();

/**
 * Recursively `Object.freeze` a row + its nested objects/arrays.
 *
 * Audit 2026-05-07 red-team #5 (HIGH conf-7): the ROW_JSON_CACHE
 * freshness check (`cached.length === t.rows.length`) catches length
 * changes but not in-place mutation. Freezing each cached row makes
 * mutation impossible in strict mode — the mutation throws at the
 * call site, surfacing the invariant violation BEFORE
 * `encodeExportBundle` ships pre-mutation cached bytes.
 *
 * Bounded by JSON depth (rows are sourced from PostgREST JSON), so
 * recursion cannot blow the call stack.
 */
function deepFreezeRow(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Object.isFrozen(value)) return;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeRow(item);
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreezeRow((value as Record<string, unknown>)[key]);
  }
}

/**
 * Tables whose bundle rows are the raw Supabase row shape (no
 * projection). `rowsForTable` returns `PublicRow<T>` for these.
 *
 * Audit 2026-05-07 (specialist apply, type-design HIGH conf-9 +
 * code-reviewer MED conf-9): pre-apply, `rowsForTable<T>` accepted
 * any `PublicTable` and returned `Array<PublicRow<T>>` — but for
 * `api_keys` the row is a stripped projection (ciphertext columns
 * removed) and for `contact_requests` the row has a string-sentinel
 * `strategy_id` instead of a UUID. The type lied. We narrow the
 * helper's generic to the unprojected manifest entries and expose
 * a separate `projectedRowsForTable` helper for the redacted shapes
 * (returning the correct `Omit<PublicRow<...>, ...>` shape).
 */
export type UnprojectedBundleTable = Extract<
  (typeof USER_EXPORT_TABLES)[number],
  { kind: "direct" | "indirect" }
>["table"];

/**
 * Projected bundle table names. Includes both synthetic projections
 * (`audit_log_for_user` — source is `audit_log`) and column-strip
 * projections (`api_keys`, `contact_requests` — source matches the
 * table name).
 */
export type ProjectedBundleTable =
  | "api_keys"
  | "contact_requests"
  | "audit_log_for_user";

/**
 * Row shape returned by `rowsForTable` for each projected table.
 * Encodes the contract that the column-strip projection
 * `redactApiKeysForUser` removes the ciphertext columns, that
 * `redactContactRequestForUser` blanks `strategy_id` to a sentinel
 * string, and that `audit_log_for_user` carries the audit_log row
 * shape with redacted metadata.
 */
export type ProjectedRow<T extends ProjectedBundleTable> = T extends "api_keys"
  ? Omit<
      PublicRow<"api_keys">,
      | "api_key_encrypted"
      | "api_secret_encrypted"
      | "passphrase_encrypted"
      | "dek_encrypted"
      | "nonce"
    >
  : T extends "contact_requests"
  ? Omit<PublicRow<"contact_requests">, "strategy_id"> & {
      strategy_id: string | null;
    }
  : T extends "audit_log_for_user"
  ? PublicRow<"audit_log"> & { metadata: unknown }
  : never;

/**
 * Typed view of a per-table payload — non-projected tables only.
 * Audit 2026-05-07 M-0521 + specialist apply (type-design HIGH
 * conf-9): the payload's `rows: unknown[]` loses every per-table
 * contract for downstream consumers. Use this helper to recover the
 * row type at the call site for the 17 direct/indirect manifest
 * entries:
 *
 *   const trades = rowsForTable(bundle, "trades");
 *   //   trades: PublicRow<"trades">[]
 *
 * For the three projected tables (api_keys, contact_requests,
 * audit_log_for_user) use `projectedRowsForTable` instead — those
 * rows have a stripped / blanked shape that does NOT match
 * `PublicRow<T>`.
 *
 * The lookup is by table NAME (string match) — runtime safety still
 * depends on the export function having populated the rows from the
 * named table; the type is a witness to the manifest contract.
 *
 * Audit 2026-05-07 (specialist apply, silent-failure MED conf-9):
 * returns `null` (not `[]`) when the table is missing from the
 * bundle. A missing entry indicates schema drift or a manifest typo,
 * NOT genuine emptiness — surfacing it as `null` forces the caller
 * to disambiguate. The CI hook (check-gdpr-export-coverage.ts)
 * verifies manifest completeness at build time, so a runtime miss
 * is a bug, not user error.
 */
export function rowsForTable<T extends UnprojectedBundleTable>(
  bundle: ExportBundle,
  table: T,
): Array<PublicRow<T>> | null {
  const entry = bundle.tables.find((t) => t.table === table);
  if (!entry) return null;
  return entry.rows as Array<PublicRow<T>>;
}

/**
 * Typed view for projected-table payloads. Returns the projection's
 * actual row shape (stripped columns / sentinel strings) rather than
 * the raw `PublicRow<source_table>`.
 *
 *   const apiKeys = projectedRowsForTable(bundle, "api_keys");
 *   //   apiKeys: ProjectedRow<"api_keys">[] | null
 *   //          = Omit<PublicRow<"api_keys">, "api_key_encrypted" | ...>[]
 *
 * Returns `null` for a missing entry (see `rowsForTable` rationale).
 */
export function projectedRowsForTable<T extends ProjectedBundleTable>(
  bundle: ExportBundle,
  table: T,
): Array<ProjectedRow<T>> | null {
  const entry = bundle.tables.find((t) => t.table === table);
  if (!entry) return null;
  return entry.rows as Array<ProjectedRow<T>>;
}

/**
 * V1 bundle shape. Audit 2026-05-07 M-0523: `schema_version` is the
 * discriminant for a future `ExportBundleV1 | ExportBundleV2` union.
 * Today `ExportBundle = ExportBundleV1`; when v2 ships, change the
 * alias to a union and downstream readers will be forced (by tsc) to
 * narrow on the version tag before reaching v2-only fields.
 */
/**
 * Shape of the full export bundle that lands in Supabase Storage.
 *
 * Issue 5: `partial` + `failed_tables` make any read failure observable
 * to bundle consumers. In the chosen policy (option (a)) the route never
 * actually persists a bundle with partial=true, but the helper still
 * exposes the fields so the route's gate has a single object to inspect
 * and tests can pin the exact shape.
 *
 * Audit 2026-05-07 H-0453: `parent_id_truncated_tables` lists every
 * indirect-table whose parent-id probe hit `EXPORT_PARENT_ID_CAP`
 * (2000). The route can surface this to the user (e.g., "Your export
 * includes data scoped to your first 2000 strategies. Contact support
 * if you have more.") instead of dropping the tail silently.
 *
 * Audit 2026-05-07 M-0523: `schema_version: 1` is a literal so the
 * bundle is versionable. A future v2 reader will see schema_version=1
 * and route to the v1 parser; the contract is encoded in the type.
 * The current bundle is the V1 variant of the discriminated union
 * `ExportBundleV1 | ExportBundleV2` that future migrations can extend.
 */
export interface ExportBundleV1 {
  schema_version: 1;
  user_id: string;
  generated_at: string;
  total_row_count: number;
  tables: ExportTablePayload[];
  truncated_at_size_cap: boolean;
  parent_id_truncated_tables: string[];
  /**
   * NEW-C16-08: indirect tables whose parent-id probe dropped a row with a
   * NULL primary key, so child rows of that parent are absent. Marks the
   * bundle incomplete with a reason distinct from the 2000-row cap.
   */
  parent_id_null_dropped_tables: string[];
  partial: boolean;
  failed_tables: string[];
}

/**
 * Active bundle shape. Audit 2026-05-07 M-0523: aliased so the
 * downstream `ExportBundle` reference remains stable while the
 * version-narrowing happens at the V1/V2 boundary. When V2 ships,
 * change this to `export type ExportBundle = ExportBundleV1 |
 * ExportBundleV2;` and consumers will be forced to discriminate on
 * `schema_version`.
 */
export type ExportBundle = ExportBundleV1;

/**
 * Module-level shared encoder. Audit 2026-05-07 (specialist apply,
 * performance LOW conf-7): pre-apply each per-row encode and the
 * final upload encode each allocated a fresh `new TextEncoder()`.
 * TextEncoder is cheap to construct but reusing one trims a constant
 * per-call overhead and gives the encoder a single hoist point if
 * we ever swap it (e.g., for a streaming variant).
 */
const SHARED_ENCODER = new TextEncoder();

/**
 * Assemble the export bundle into a Uint8Array suitable for upload.
 *
 * Audit 2026-05-07 (specialist apply, performance HIGH conf-9):
 * pre-apply, the route called `new TextEncoder().encode(JSON.stringify(bundle))`,
 * which re-stringified every row inside `bundle.tables[*].rows` even
 * though the cumulative-size budget pass had already stringified
 * each row once. For a 50,000-row table at ~800 bytes/row this was
 * ~40MB of redundant serialization (and ~80MB of intermediate string
 * allocations). The peak heap held the bundle object + the 100MB
 * intermediate string + the 100MB Uint8Array simultaneously —
 * ~300MB peak on a 1024MB Vercel Fluid lambda.
 *
 * The fix stitches the upload from the cached per-row JSON strings
 * stored in `ExportTablePayload.__cached_rows_json`. Each row's JSON
 * is encoded once during the budget pass and written directly into
 * the output Uint8Array here. The envelope fields (schema_version,
 * user_id, generated_at, total_row_count, parent_id_truncated_tables,
 * partial, failed_tables, truncated_at_size_cap) and the per-table
 * wrapper fields are still serialized via `JSON.stringify` because
 * they are tiny (kilobytes total).
 *
 * The internal `__cached_rows_json` field is omitted from the
 * upload by definition — this function never serializes it.
 *
 * Fallback: if a caller hand-constructs a bundle without the cache
 * (testing-only), the function falls back to per-row JSON.stringify,
 * matching legacy behaviour.
 */
export function encodeExportBundle(bundle: ExportBundle): Uint8Array {
  // Strategy: produce the JSON in two halves separated at `tables`.
  // The envelope JSON is built once (small — ~200 bytes); the tables
  // array is stitched from the per-table wrapper + per-row cached
  // JSON strings without re-stringifying any row.
  //
  // Field order matches `JSON.stringify(bundle)` exactly (insertion
  // order of the ExportBundle literal returned by collectUserExportBundle):
  //   schema_version, user_id, generated_at, total_row_count,
  //   tables, truncated_at_size_cap, parent_id_truncated_tables,
  //   partial, failed_tables.
  // Tests assert against the BUNDLE OBJECT (not the encoded bytes),
  // but downstream consumers parsing the upload need the on-the-wire
  // shape to round-trip cleanly through JSON.parse.
  //
  // Audit 2026-05-07 red-team #8 (MED conf-8): `JSON.stringify(undefined)`
  // returns the JS value `undefined`, NOT a string — concatenated into
  // a template literal it stringifies to the literal 4 characters
  // 'undefined' (unquoted), producing invalid JSON. Wrap every field
  // serialization in `safeStringify` so `undefined` coerces to JSON
  // `null`. This matches the field-level interpretation a downstream
  // JSON.parse'er would apply to an explicit-null field, and keeps
  // the upload guaranteed-parseable even if a future schema_version=2
  // makes some envelope/wrapper field genuinely optional.
  const safeStringify = (v: unknown): string => {
    const s = JSON.stringify(v);
    return s === undefined ? "null" : s;
  };
  const chunks: Uint8Array[] = [];

  // Opener: everything up to `"tables":[`.
  const opener =
    `{"schema_version":${safeStringify(bundle.schema_version)},` +
    `"user_id":${safeStringify(bundle.user_id)},` +
    `"generated_at":${safeStringify(bundle.generated_at)},` +
    `"total_row_count":${safeStringify(bundle.total_row_count)},` +
    `"tables":[`;
  chunks.push(SHARED_ENCODER.encode(opener));

  for (let i = 0; i < bundle.tables.length; i += 1) {
    const t = bundle.tables[i];
    if (i > 0) chunks.push(SHARED_ENCODER.encode(","));
    chunks.push(
      SHARED_ENCODER.encode(
        `{"table":${safeStringify(t.table)},"rows":[`,
      ),
    );
    const cached = ROW_JSON_CACHE.get(t);
    if (cached && cached.length === t.rows.length) {
      for (let r = 0; r < cached.length; r += 1) {
        if (r > 0) chunks.push(SHARED_ENCODER.encode(","));
        chunks.push(SHARED_ENCODER.encode(cached[r]));
      }
    } else {
      // Fallback for hand-constructed bundles (tests). Same undefined-
      // safety applies: `JSON.stringify(undefined)` for a sparse-array
      // slot would corrupt the wire encoding otherwise.
      for (let r = 0; r < t.rows.length; r += 1) {
        if (r > 0) chunks.push(SHARED_ENCODER.encode(","));
        chunks.push(SHARED_ENCODER.encode(safeStringify(t.rows[r])));
      }
    }
    chunks.push(
      SHARED_ENCODER.encode(
        `],"row_count":${safeStringify(t.row_count)},` +
          `"truncated_at_cap":${safeStringify(t.truncated_at_cap)},` +
          `"parent_id_truncated":${safeStringify(t.parent_id_truncated)},` +
          `"fetch_error":${safeStringify(t.fetch_error)}}`,
      ),
    );
  }

  // Closer: close tables + remaining envelope fields.
  const closer =
    `],"truncated_at_size_cap":${safeStringify(bundle.truncated_at_size_cap)},` +
    `"parent_id_truncated_tables":${safeStringify(bundle.parent_id_truncated_tables)},` +
    `"parent_id_null_dropped_tables":${safeStringify(bundle.parent_id_null_dropped_tables)},` +
    `"partial":${safeStringify(bundle.partial)},` +
    `"failed_tables":${safeStringify(bundle.failed_tables)}}`;
  chunks.push(SHARED_ENCODER.encode(closer));

  // Concatenate. The bundle keeps each cached chunk alive briefly —
  // because the chunks are small Uint8Arrays referencing their own
  // backing memory (not slices of the bundle), the original bundle
  // object can be GC'd once this function returns.
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
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
  // Audit-2026-05-07 C-0021 (security c9): defense-in-depth ownership
  // assertion. This helper runs as service_role and bypasses RLS on
  // every read. Today's sole caller (POST /api/account/export) locks
  // `userId` to `auth.getUser().id` and never accepts a request-body
  // alternative, but a future refactor (admin export wrapper, fan-out
  // worker, CSV-export aggregator) that wires this helper to an
  // attacker-influenced id would silently exfil any user's full PII
  // bundle. We hard-refuse here unless `userId` is a UUID — the natural
  // shape of `auth.users.id`. Non-UUID values include:
  //   - an empty string (caller forgot to .eq() a filter — every row),
  //   - a request-body string (caller forgot to authz),
  //   - a SQL-fragment attempt (PostgREST quotes it, but the cost is
  //     still a full table scan).
  // Throwing here surfaces the misuse at the call site instead of
  // shipping a bundle the caller didn't intend. The route's outer
  // try/catch turns this into a clean 500 with operator-visible logs.
  if (!isUuid(userId)) {
    throw new Error(
      `[gdpr-export] collectUserExportBundle requires a UUID auth.users.id; refusing service-role read for non-UUID subject. C-0021 defense-in-depth.`,
    );
  }
  // Phase 1: parallel fetch across all USER_EXPORT_TABLES entries
  // (bounded concurrency).
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
    parent_id_truncated: boolean;
    /** NEW-C16-08: indirect parent probe dropped NULL-PK rows (child rows missing). */
    parent_id_null_dropped: boolean;
    /**
     * Audit 2026-05-07 (specialist apply, code-reviewer HIGH conf-9):
     * true when the source SELECT returned > EXPORT_PER_TABLE_ROW_CAP
     * rows. For projected specs this is detected pre-projection so
     * the post-projection row count cannot silently lose the cap-hit
     * signal.
     */
    source_truncated: boolean;
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
          fetched[start + i] = {
            spec,
            rows: [],
            error: result.error,
            parent_id_truncated: result.parent_id_truncated,
            parent_id_null_dropped: result.parent_id_null_dropped,
            source_truncated: result.source_truncated,
          };
        } else {
          fetched[start + i] = {
            spec,
            rows: result.rows,
            error: null,
            parent_id_truncated: result.parent_id_truncated,
            parent_id_null_dropped: result.parent_id_null_dropped,
            source_truncated: result.source_truncated,
          };
        }
      } else {
        const reason =
          r.reason instanceof Error
            ? r.reason.message
            : String(r.reason ?? "unknown rejection");
        console.error(
          `[gdpr-export] batch fetch rejected for ${spec.table}: ${reason}`,
        );
        fetched[start + i] = {
          spec,
          rows: [],
          error: reason,
          parent_id_truncated: false,
          parent_id_null_dropped: false,
          source_truncated: false,
        };
      }
    }
  }

  // Phase 2: cumulative-size budget. O(n) over the rows, NOT
  // O(log n) over the full bundle.
  //
  // Audit 2026-05-07 H-0454: the legacy budget only accounted for
  // per-row payload bytes; the bundle envelope itself (schema_version,
  // user_id, generated_at, total_row_count, tables[], etc.) plus the
  // per-table wrapper objects (table name + flags) and the inter-row
  // comma separators were never reserved, so the final JSON could
  // overrun EXPORT_SIZE_CAP_BYTES by up to ~1–2MB. We now seed
  // `bytesUsed` with a conservative envelope reservation derived from
  // a synthetic empty bundle, plus a per-table wrapper estimate. The
  // resulting cap is strictly conservative — final upload size is at
  // or below `EXPORT_SIZE_CAP_BYTES`.
  const tables: ExportTablePayload[] = [];
  const failedTables: string[] = [];
  const parentTruncatedTables: string[] = [];
  // NEW-C16-08: indirect tables whose probe dropped a NULL-PK parent row.
  // Tracked separately from the 2000-row cap so the route's refusal reason
  // is accurate (the data subject is told WHY child rows are missing).
  const parentNullDroppedTables: string[] = [];
  let totalRowCount = 0;
  const encoder = new TextEncoder();

  // Envelope reservation: stringify a bundle skeleton with NO rows,
  // measure its UTF-8 byte length, and seed `bytesUsed` with it. The
  // synthetic skeleton uses placeholder values whose serialized lengths
  // are at least as long as the real values, so the reservation is an
  // upper bound. Per-table overhead (`{ "table": "...", "rows": [...],
  // "row_count": N, "truncated_at_cap": false, "parent_id_truncated":
  // false, "fetch_error": null },`) is bounded by ~140 bytes plus the
  // table name length — we account for this by reserving a per-table
  // line below as each table starts.
  const envelopeSkeleton: ExportBundle = {
    schema_version: 1,
    user_id: userId,
    generated_at: new Date(0).toISOString(),
    total_row_count: 0,
    tables: [],
    truncated_at_size_cap: false,
    parent_id_truncated_tables: [],
    parent_id_null_dropped_tables: [],
    partial: false,
    failed_tables: [],
  };
  let bytesUsed = encoder.encode(JSON.stringify(envelopeSkeleton)).byteLength;
  let truncatedAtSizeCap = false;

  // Audit 2026-05-07 (specialist apply, performance HIGH conf-9):
  // cache per-row UTF-8 byte payloads during the budget pass so the
  // final upload can be assembled from the cached strings without a
  // second JSON.stringify of every row. Pre-apply, each row was
  // serialized twice — once for the size budget and again inside
  // `JSON.stringify(bundle)` in the route — costing ~2× CPU and
  // peaking memory at ~3× the payload size (object + intermediate
  // string + Uint8Array). The shared `__cached_rows_json` array on
  // the ExportTablePayload carries the JSON strings of each row so
  // `encodeExportBundle` can stitch them directly into a Uint8Array.
  for (const entry of fetched) {
    if (!entry) continue;
    const { spec, rows, error: fetchError, parent_id_truncated, parent_id_null_dropped, source_truncated } = entry;

    if (fetchError) {
      failedTables.push(spec.table);
    }
    if (parent_id_truncated) {
      parentTruncatedTables.push(spec.table);
    }
    // NEW-C16-08: a NULL-PK parent drop makes the bundle incomplete (child
    // rows missing) — surface it so the route refuses to ship it as complete.
    if (parent_id_null_dropped) {
      parentNullDroppedTables.push(spec.table);
    }

    // Reserve the per-table wrapper bytes BEFORE counting rows so the
    // cumulative budget reflects the real shape of the upload.
    // Audit 2026-05-07 (specialist apply, code-reviewer MED conf-8):
    // when `truncatedAtSizeCap` is already true, we STILL push an
    // empty payload for completeness — but pre-apply the wrapper
    // bytes were never accumulated, so a tail of ~22 empty tables
    // could overflow the final upload by ~3KB. Reserve the wrapper
    // bytes uniformly across both branches and surface
    // `truncated_at_cap` only when the SIZE cap actually trimmed
    // rows (or the source cap clipped before the projection ran).
    const tableWrapperBytes = encoder.encode(
      JSON.stringify({
        table: spec.table,
        rows: [],
        row_count: 0,
        truncated_at_cap: false,
        parent_id_truncated,
        fetch_error: fetchError,
      }) + ",",
    ).byteLength;

    if (truncatedAtSizeCap) {
      bytesUsed += tableWrapperBytes;
      const payload: ExportTablePayload = {
        table: spec.table,
        rows: [],
        row_count: 0,
        // truncated_at_cap signals "the size cap or the source cap
        // dropped data for this table". A fetch-error row never had
        // a chance to fill rows — keep the flag false there so
        // forensic readers don't conflate "fetch failed" with
        // "size cap trimmed me".
        truncated_at_cap: fetchError ? false : true,
        parent_id_truncated,
        fetch_error: fetchError,
      };
      ROW_JSON_CACHE.set(payload, []);
      tables.push(payload);
      continue;
    }

    if (bytesUsed + tableWrapperBytes > EXPORT_SIZE_CAP_BYTES) {
      truncatedAtSizeCap = true;
      bytesUsed += tableWrapperBytes;
      const payload: ExportTablePayload = {
        table: spec.table,
        rows: [],
        row_count: 0,
        truncated_at_cap: fetchError ? false : true,
        parent_id_truncated,
        fetch_error: fetchError,
      };
      ROW_JSON_CACHE.set(payload, []);
      tables.push(payload);
      continue;
    }
    bytesUsed += tableWrapperBytes;

    const includedRows: unknown[] = [];
    const includedRowsJson: string[] = [];
    // source_truncated is the SQL-side cap signal (set by
    // fetchRowsForSpec when the source SELECT hit > cap rows). For
    // direct/indirect we also fall back to the post-fetch length
    // check (rows.length >= cap) — both are correct because no
    // projection collapses the count for those kinds. For projected
    // entries source_truncated is the ONLY accurate signal.
    let tableTruncated =
      source_truncated || (rows.length >= EXPORT_PER_TABLE_ROW_CAP);

    for (const row of rows) {
      const rowJson = JSON.stringify(row);
      // Per-row size includes the trailing comma the outer
      // JSON.stringify would insert; small constant overhead.
      // Audit 2026-05-07 (specialist apply, performance MED conf-8):
      // `+ ","` previously allocated a fresh string each loop;
      // the comma is always 1 UTF-8 byte so we add 1 directly.
      const rowBytes = encoder.encode(rowJson).byteLength + 1;
      if (bytesUsed + rowBytes > EXPORT_SIZE_CAP_BYTES) {
        truncatedAtSizeCap = true;
        tableTruncated = true;
        break;
      }
      // Audit 2026-05-07 red-team #5 (HIGH conf-7): freeze the row
      // before caching its JSON. Any in-place mutation post-collect
      // (route-layer re-redaction, test fixture twiddle) throws in
      // strict mode, surfacing the cache-staleness invariant
      // violation BEFORE encodeExportBundle ships pre-mutation bytes.
      deepFreezeRow(row);
      includedRows.push(row);
      includedRowsJson.push(rowJson);
      bytesUsed += rowBytes;
    }

    const payload: ExportTablePayload = {
      table: spec.table,
      rows: includedRows,
      row_count: includedRows.length,
      truncated_at_cap: tableTruncated,
      parent_id_truncated,
      fetch_error: fetchError,
    };
    // Freeze the rows array itself so length-mutation (push/pop) also
    // throws in strict mode — the cache's length-equality freshness
    // check then cannot be defeated by a length-preserving splice.
    Object.freeze(includedRows);
    ROW_JSON_CACHE.set(payload, includedRowsJson);
    tables.push(payload);
    totalRowCount += includedRows.length;
  }

  return {
    schema_version: 1,
    user_id: userId,
    generated_at: new Date().toISOString(),
    total_row_count: totalRowCount,
    tables,
    truncated_at_size_cap: truncatedAtSizeCap,
    parent_id_truncated_tables: parentTruncatedTables,
    parent_id_null_dropped_tables: parentNullDroppedTables,
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
  /**
   * Indirect-spec only: true when the parent-id probe hit
   * `EXPORT_PARENT_ID_CAP` and child rows belonging to the dropped
   * tail were not loaded. Always `false` for direct/projected specs.
   * See audit 2026-05-07 H-0453.
   */
  parent_id_truncated: boolean;
  /**
   * NEW-C16-08 (audit 2026-05-26, silent-failure): true when the
   * indirect parent-id probe dropped one or more rows with a NULL
   * primary key, so child rows of those parents are absent from the
   * bundle. Distinct from `parent_id_truncated` (the 2000-row cap):
   * the user-facing incompleteness REASON differs, so it carries its
   * own flag + bundle list rather than overloading the cap signal.
   * Like the cap path it marks the bundle incomplete (the route refuses
   * with a 500 `export_truncated` + a rate-limit token refund), NOT a hard
   * fetch failure (that would re-break the
   * red-team #3 contract that one legacy null row must not lock a data
   * subject out of their Art. 15 export).
   */
  parent_id_null_dropped: boolean;
  /**
   * Audit 2026-05-07 (specialist apply, code-reviewer HIGH conf-9):
   * true when the SOURCE-side SELECT hit `EXPORT_PER_TABLE_ROW_CAP`
   * before the projection callback ran. For direct/indirect specs
   * this is the same as the post-fetch row count (no projection
   * shrinks the count), but for projected specs the projection can
   * drop rows — pre-fix the post-projection length check missed the
   * cap-hit signal and the bundle silently lost data.
   */
  source_truncated: boolean;
}


async function fetchRowsForSpec(
  admin: SupabaseClient,
  spec: UserExportTable,
  userId: string,
): Promise<FetchRowsResult> {
  const orderCol = getOrderColumn(spec);

  if (spec.kind === "direct") {
    const { data, error } = await admin
      .from(spec.table)
      .select("*")
      .eq(spec.user_column, userId)
      .order(orderCol, { ascending: true })
      .limit(EXPORT_PER_TABLE_ROW_CAP);
    if (error) {
      // Issue 5 fix: surface the error to the bundle instead of silently
      // substituting `[]`. The route's gate refuses to mint a signed URL
      // when ANY table reports a fetch_error.
      const msg = `direct select failed for ${spec.table}: ${error.message}`;
      console.error(`[gdpr-export] ${msg}`);
      return {
        rows: [],
        error: msg,
        parent_id_truncated: false,
        parent_id_null_dropped: false,
        source_truncated: false,
      };
    }
    const arr = data ?? [];
    return {
      rows: arr,
      error: null,
      parent_id_truncated: false,
      parent_id_null_dropped: false,
      // No projection drops rows for direct specs, so the post-fetch
      // length matches the SQL cap exactly. The Phase 2 fallback
      // (rows.length >= cap) still applies symmetrically, but setting
      // the flag here lets all three kinds use a single signal.
      source_truncated: arr.length >= EXPORT_PER_TABLE_ROW_CAP,
    };
  }

  if (spec.kind === "projected") {
    // Fetch raw rows from the source table, filtered to the subject.
    // Audit 2026-05-07 (specialist apply, code-reviewer HIGH conf-9):
    // the source LIMIT bounds rows BEFORE the projection prunes them
    // down. A user whose audit_log source contains > 50K total rows
    // where only a fraction match the subject filter would silently
    // lose later rows about themselves — the post-projection
    // `rows.length >= cap` check in Phase 2 would read false, GDPR
    // Art. 15 would silently fail. We probe with `cap + 1` rows so
    // the caller can detect source-side truncation BEFORE the
    // projection collapses the count.
    //
    // Audit 2026-05-07 red-team #11 (MED conf-8): `source_truncated`
    // semantics — for `api_keys` and `contact_requests`, the SQL filter
    // `.eq(user_column, userId)` is the EXACT same predicate the
    // projection enforces; the projection's per-row check is a defense-
    // in-depth no-op, so `source_truncated` accurately reflects the
    // pre-projection cap-hit.
    //
    // NEW-C16-02 (2026-05-26): `audit_log_for_user` (and
    // `audit_log_cold_for_user`) now use an `.or(actor | entity |
    // metadata-target)` filter that MATCHES the projection's full
    // retention criteria. `source_truncated` is therefore accurate for
    // the COMPLETE union — the pre-fix limitation ("ACTOR slice only,
    // tracked as a follow-up") is resolved by the or_filter below.
    // When the spec declares an `or_filter`, the SQL predicate matches
    // the projection's broader retention criteria (actor OR entity OR
    // metadata target) — a bare `.eq(user_column)` would return only
    // the actor slice and silently drop admin-on-subject rows the
    // subject is entitled to under Art. 15. For specs without an
    // `or_filter` (api_keys, contact_requests) the single-owner `.eq()`
    // IS the exact predicate the projection enforces. `userId` is
    // UUID-validated upstream (C-0021), so interpolating it into the
    // PostgREST filter string is safe.
    const filtered = admin
      .from(spec.source_table)
      .select("*");
    const scoped = spec.or_filter
      ? filtered.or(spec.or_filter(userId))
      : filtered.eq(spec.user_column, userId);
    const { data, error } = await scoped
      .order(orderCol, { ascending: true })
      .limit(EXPORT_PER_TABLE_ROW_CAP + 1);
    if (error) {
      const msg = `projected select failed for ${spec.source_table} (->${spec.table}): ${error.message}`;
      console.error(`[gdpr-export] ${msg}`);
      return {
        rows: [],
        error: msg,
        parent_id_truncated: false,
        parent_id_null_dropped: false,
        source_truncated: false,
      };
    }
    const sourceArr = data ?? [];
    const sourceTruncated = sourceArr.length > EXPORT_PER_TABLE_ROW_CAP;
    // Run the redaction projection. This is where cross-party PII in
    // metadata gets blanked.
    return {
      rows: spec.project(
        sourceTruncated
          ? sourceArr.slice(0, EXPORT_PER_TABLE_ROW_CAP)
          : sourceArr,
        userId,
      ),
      error: null,
      parent_id_truncated: false,
      parent_id_null_dropped: false,
      source_truncated: sourceTruncated,
    };
  }

  // Indirect: two-hop. Order the parent-id probe so the dropped tail
  // is at least deterministic between requests (H-0456); same for the
  // child select.
  const parentIdColumn = spec.parent_id_column ?? "id";
  const { data: parentRows, error: parentErr } = await admin
    .from(spec.parent_table)
    .select(parentIdColumn)
    .eq(spec.parent_user_column, userId)
    .order(parentIdColumn, { ascending: true })
    .limit(EXPORT_PARENT_ID_CAP);
  if (parentErr) {
    const msg = `parent select failed for ${spec.parent_table} (via ${spec.table}): ${parentErr.message}`;
    console.error(`[gdpr-export] ${msg}`);
    return {
      rows: [],
      error: msg,
      parent_id_truncated: false,
      parent_id_null_dropped: false,
      source_truncated: false,
    };
  }
  // M-0524 fix: read parent id by the configured column name. Default
  // 'id' covers every parent in the current manifest; an indirect
  // entry whose parent uses a non-`id` PK can override via
  // `parent_id_column` without falling through to a silent
  // `{ id: undefined }` cast.
  //
  // The double-cast (`as unknown as ...`) is necessary because the
  // Supabase typed select can return a union including
  // `GenericStringError`; the runtime `error` branch above already
  // returned, so the residual type still includes the error sentinel
  // that never satisfies the `Record<string, unknown>` index
  // signature. The cast is type-only; the runtime shape is verified
  // by the .filter((v): v is string) below.
  //
  // Type assumption: every parent table in the current manifest
  // (strategies, portfolios) uses a UUID string PK. If a future
  // manifest entry introduces a non-string PK (e.g., bigint), the
  // filter below will drop ALL parent ids and the indirect child
  // will silently return zero rows — re-examine `parent_id_column`
  // + the filter widening in that PR.
  const parentRowsArr = ((parentRows ?? []) as unknown) as Array<
    Record<string, unknown>
  >;
  const parentIdsRaw = parentRowsArr.map((r) => r[parentIdColumn]);
  // Audit 2026-05-07 red-team #3 (HIGH conf-8): split null tolerance
  // from non-null type-mismatch detection. Pre-fix, ANY value that
  // wasn't a string (including null) triggered fail-loud, which then
  // refused the ENTIRE export. A single legacy row with id=NULL
  // (failed migration, buggy seed) took down GDPR Art. 15 for that
  // user permanently — combined with the rate-limit-token-consumed
  // chain (#2), the user couldn't even retry.
  //
  // The intent of the fail-loud was to catch a future bigint/composite
  // PK silently dropping ids (the audit comment below this block is
  // about the bigint case). Nulls are a legitimate dropped-row signal
  // — they should be filtered silently (with a console.warn metric so
  // schema drift is still observable in logs) and the bundle should
  // still build with only the affected child rows missing.
  const nonNullParentIds = parentIdsRaw.filter((v) => v !== null);
  const parentIds = nonNullParentIds.filter(
    (v): v is string => typeof v === "string",
  );
  // NEW-C16-08: did the probe drop any NULL-PK parent rows? Hoisted so
  // every return path below can report it. Child rows of NULL-keyed
  // parents are silently absent without this signal.
  const parentIdNullDropped = nonNullParentIds.length < parentIdsRaw.length;
  if (parentIds.length < nonNullParentIds.length) {
    // Genuine type mismatch: non-null, non-string. This is the bigint
    // / composite PK case the original fail-loud targeted. Bundle gate
    // refuses the export — manifest needs a parent_id_column override
    // OR the filter widening.
    const msg = `indirect parent id type mismatch for ${spec.parent_table}.${parentIdColumn} (via ${spec.table}): expected string PK, dropped ${nonNullParentIds.length - parentIds.length}/${nonNullParentIds.length} non-null rows`;
    console.error(`[gdpr-export] ${msg}`);
    return {
      rows: [],
      error: msg,
      parent_id_truncated: false,
      parent_id_null_dropped: parentIdNullDropped,
      source_truncated: false,
    };
  }
  if (parentIdNullDropped) {
    // Null parent ids: legitimate dropped rows. Log so schema drift is
    // observable but DO NOT fail the bundle — the user's other rows
    // are still exportable.
    //
    // PR-2 code-reviewer #1 (2026-05-28): promoted to captureToSentry so
    // a parent-id-null drift class becomes observable on the alert path
    // alongside the redactor drift signal. The 2000-row parent-id cap
    // bounds the capture count (no Sentry-flood risk).
    const nullCount = parentIdsRaw.length - nonNullParentIds.length;
    console.warn(
      `[gdpr-export] dropped ${nullCount} null parent id(s) for ${spec.parent_table}.${parentIdColumn} (via ${spec.table}); child rows of those parents are absent from the bundle`,
    );
    captureToSentry(
      new Error(
        "gdpr-export: indirect path dropped null parent ids — schema drift candidate",
      ),
      {
        tags: { area: "gdpr-export", gate: "parent_id_null_drift" },
        extra: {
          parent_table: spec.parent_table,
          parent_id_column: parentIdColumn,
          via_table: spec.table,
          null_count: nullCount,
        },
        level: "warning",
      },
    );
  }
  const parentIdTruncated = parentRowsArr.length >= EXPORT_PARENT_ID_CAP;
  if (parentIds.length === 0) {
    return {
      rows: [],
      error: null,
      parent_id_truncated: parentIdTruncated,
      parent_id_null_dropped: parentIdNullDropped,
      source_truncated: false,
    };
  }

  // Audit 2026-05-07 (specialist apply, silent-failure MED conf-8 +
  // performance LOW conf-7): use the same orderCol the direct branch
  // uses so determinism is single-sourced. Today getOrderColumn
  // returns 'id' for everything except audit_log (which is never an
  // indirect spec), so behavior is unchanged; the future-proofing
  // matters because the audit comment claims this branch is "same
  // for the child select" — making the code match the doc.
  //
  // Audit 2026-05-07 red-team #10 (MED conf-8): the `.in()` call is
  // chunked at EXPORT_PARENT_ID_IN_CHUNK (500) to stay under common
  // intermediate-proxy URL limits. For users with > 500 parent rows
  // we fan out across multiple SELECTs and concatenate the results.
  //
  // NEW-C16-07 (audit 2026-05-26, MED conf-8): pre-fix, the loop used
  // `remainingBudget` (= cap - aggregated.length) as the per-chunk
  // LIMIT and short-circuited early once the running total hit the cap.
  // This is INCORRECT for >1 chunk: each chunk is ordered within itself
  // by orderCol, but the concatenation is ordered by (chunk index, then
  // orderCol) — NOT globally by orderCol. The cap then drops whichever
  // rows happened to sit at the tail of the last processed chunk rather
  // than the globally-oldest rows, violating the H-0456 determinism
  // contract and silently omitting a non-deterministic subset.
  //
  // FIX: each chunk queries `EXPORT_PER_TABLE_ROW_CAP + 1` rows (one
  // extra so we can detect source-side truncation within a single chunk
  // — mirrors the projected-path probe pattern). After ALL chunks are
  // collected, the full aggregated list is sorted GLOBALLY by orderCol
  // (ascending, string-compare — correct for both UUID and ISO-8601
  // timestamp columns, which are the only orderCol shapes in the
  // current manifest). The row cap is then applied as a post-sort slice
  // so the retained subset matches a single global
  // `ORDER BY orderCol LIMIT cap`. `aggregatedTruncated` is set when
  // the pre-cap total exceeds the cap (we had more globally-sorted rows
  // to give than the cap allows).
  //
  // NEW-C16-10 (audit 2026-05-26, MED conf-9): the original NEW-C16-07
  // fix fetched up to EXPORT_PER_TABLE_ROW_CAP (50K) rows PER chunk with
  // no early-exit, accumulating up to 4 × 50K = 200K rows in the heap
  // before the post-sort splice. With EXPORT_FETCH_CONCURRENCY = 10, up
  // to 10 such indirect fetches can be in-flight simultaneously → ~600MB
  // of heap pressure, a DoS amplification vector. The global-sort
  // correctness requirement is preserved: we break after the first chunk
  // that pushes the aggregate ABOVE the cap (we already have enough rows
  // to determine truncation AND produce a globally-sorted cap-row subset).
  // Memory ceiling is now cap + EXPORT_PARENT_ID_IN_CHUNK × max_row_width
  // instead of 4 × cap.
  const aggregated: unknown[] = [];
  let aggregatedError: string | null = null;
  for (let start = 0; start < parentIds.length; start += EXPORT_PARENT_ID_IN_CHUNK) {
    const chunk = parentIds.slice(start, start + EXPORT_PARENT_ID_IN_CHUNK);
    const { data: chunkData, error: chunkErr } = await admin
      .from(spec.table)
      .select("*")
      .in(spec.via_column, chunk)
      .order(orderCol, { ascending: true })
      .limit(EXPORT_PER_TABLE_ROW_CAP + 1);
    if (chunkErr) {
      aggregatedError = `indirect select failed for ${spec.table}: ${chunkErr.message}`;
      console.error(`[gdpr-export] ${aggregatedError}`);
      break;
    }
    const chunkRows = chunkData ?? [];
    aggregated.push(...chunkRows);
    // NEW-C16-10: early-exit once we have more rows than the cap. We now
    // know truncation will occur; additional chunks cannot change the
    // post-sort slice. This bounds heap to cap + one chunk's worth of
    // rows regardless of how many parent-id chunks remain.
    if (aggregated.length > EXPORT_PER_TABLE_ROW_CAP) {
      break;
    }
  }
  // Global stable sort by orderCol across all chunks (NEW-C16-07).
  // String comparison is monotone for both UUID and ISO-8601 columns.
  aggregated.sort((a, b) => {
    const av = (a as Record<string, unknown>)[orderCol];
    const bv = (b as Record<string, unknown>)[orderCol];
    if (av == null && bv == null) return 0;
    if (av == null) return -1;
    if (bv == null) return 1;
    return String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
  });
  const aggregatedTruncated = aggregated.length > EXPORT_PER_TABLE_ROW_CAP;
  if (aggregatedTruncated) {
    aggregated.splice(EXPORT_PER_TABLE_ROW_CAP);
  }
  if (aggregatedError) {
    // Audit 2026-05-07 red-team #12 (MED conf-8, chain): precedence
    // rule — when `fetch_error` is set on an indirect payload, clear
    // `parent_id_truncated`. The parent-id cap was an UNUSED auxiliary
    // signal because the child fetch never used those ids. Forensic
    // readers see ONE cause per failed table (the fetch error), not
    // a double-signal that conflates a transient infra failure with a
    // permanent data-volume issue. The retry guidance ("retry to fix
    // transient") and the support-escalation guidance ("contact
    // support — permanent cap-hit") then map cleanly to the single
    // surviving signal.
    return {
      rows: [],
      error: aggregatedError,
      parent_id_truncated: false,
      parent_id_null_dropped: parentIdNullDropped,
      source_truncated: false,
    };
  }
  return {
    rows: aggregated,
    error: null,
    parent_id_truncated: parentIdTruncated,
    parent_id_null_dropped: parentIdNullDropped,
    source_truncated:
      aggregatedTruncated || aggregated.length >= EXPORT_PER_TABLE_ROW_CAP,
  };
}
