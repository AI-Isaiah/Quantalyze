import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isUuid } from "@/lib/utils";

/**
 * Closed keyset of every public-schema table name. Audit 2026-05-07
 * M-0522: pre-fix, `table: string` allowed a typo like
 * `allocator_holdngs` to compile, with the CI hook
 * (check-gdpr-export-coverage.ts) as the only late safety net. By
 * narrowing the type to the Supabase-generated key union we move the
 * invariant into `tsc` and surface typos at compile time.
 */
export type PublicTable = keyof Database["public"]["Tables"];

/**
 * Row shape for a public-schema table. Re-exposed so consumers of the
 * export bundle (download scripts, regulator-facing serializers) can
 * recover the per-row contract without re-deriving from the Supabase
 * client. Audit 2026-05-07 M-0521.
 */
export type PublicRow<T extends PublicTable> =
  Database["public"]["Tables"][T]["Row"];

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
 *
 * Audit 2026-05-07 M-0522: `table` is narrowed to `PublicTable` so a
 * typo in the manifest fails at compile time instead of being caught
 * only by the runtime CI hook.
 */
export interface DirectUserTable {
  kind: "direct";
  table: PublicTable;
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
  table: PublicTable;
  /** Foreign-key column on this table. */
  via_column: string;
  /** Parent table whose rows this table is scoped to. */
  parent_table: PublicTable;
  /** User-identifying column on the parent table. */
  parent_user_column: string;
  /**
   * Primary-key column on the parent table used by the two-hop
   * select. Defaults to `"id"` at the call site if omitted, which
   * matches every parent table in the current manifest. Audit
   * 2026-05-07 M-0524: pre-fix, `fetchRowsForSpec` hard-coded
   * `(r: { id: string }) => r.id` — an indirect entry whose parent
   * used a non-`id` PK would have silently returned an empty
   * export. Surfacing the column name in the spec turns the
   * assumption into a contract.
   */
  parent_id_column?: string;
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
 *
 * Note: `table` (the bundle-facing projection name) is INTENTIONALLY
 * a free `string` — `audit_log_for_user` is a synthetic name that
 * does NOT exist as a public table. The narrowed `source_table` IS
 * a `PublicTable` because the SELECT actually hits it.
 */
export interface ProjectedUserTable {
  kind: "projected";
  /** Bundle-facing name (e.g. "audit_log_for_user"). May be synthetic. */
  table: string;
  /** Underlying table name the SELECT hits. */
  source_table: PublicTable;
  /** Column on source_table holding the subject's user id. */
  user_column: string;
  /** Post-fetch redaction function. */
  project: (rows: unknown[], userId: string) => unknown[];
  /**
   * NEW-C16-02 (audit 2026-05-26, HIGH): optional PostgREST `.or()`
   * filter builder. When present, the SELECT uses `.or(or_filter(userId))`
   * INSTEAD of `.eq(user_column, userId)`. This is required for
   * `audit_log_for_user`, whose `project` (redactAuditLogForUser)
   * retains rows where the subject is the ACTOR, the ENTITY
   * (entity_id=subject AND entity_type='user'), OR the metadata
   * target (metadata->>target_user_id=subject) — i.e. "data ABOUT
   * them", per GDPR Art. 15. A bare `.eq(user_column=actor)` only ever
   * returned the actor slice, so admin-on-subject rows (role.grant /
   * revoke, deletion approve/reject, account.sanitize — all written
   * with user_id=ADMIN, entity_id=subject) were SILENTLY absent from
   * the bundle (partial:false). The `.or()` widens the SQL predicate
   * to MATCH the projection's retention criteria so those rows reach
   * `project` and are exported.
   *
   * The `userId` is UUID-validated upstream (`collectUserExportBundle`
   * refuses a non-UUID subject — C-0021), so interpolating it into the
   * filter string is safe. The `project` callback STILL runs as the
   * authoritative redaction/retention gate — the SQL widening only
   * ensures the candidate rows are fetched; no row the projection
   * would reject can survive it.
   *
   * Omit for api_keys / contact_requests: their `.eq(user_column)` IS
   * the exact predicate the projection enforces (a single-owner
   * column), so widening would be incorrect.
   *
   * MAINTENANCE NOTE (NEW-C16-11, L conf-8 red-team): when adding an
   * `or_filter`, EVERY column name referenced in the returned string
   * MUST match the actual column names on `source_table`. In particular,
   * the primary owner column referenced in the filter should match
   * `user_column` declared on this spec. Copying the `audit_log` filter
   * (`user_id.eq.${userId},...`) for a spec with `user_column: "actor_id"`
   * would silently return zero rows for the actor direction — the SQL
   * succeeds but returns nothing, and the export silently omits the data
   * without any error or `partial` signal. The `project` callback does
   * NOT compensate for a wrong SQL predicate (it is a redaction gate,
   * not a re-filter). Verify your filter string against the source
   * table's actual column names before landing.
   */
  or_filter?: (userId: string) => string;
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
  // Audit 2026-05-07 (specialist apply, security MED conf-8):
  // admin/actor UUID keys emitted by every admin-side audit producer
  // when the subject is the entity/target (role.grant, role.revoke,
  // deletion.request.approve/reject, admin/match preferences edit,
  // debug-key-flow). Pre-apply these admin UUIDs survived the
  // projection and the subject could resolve which admin acted on
  // their account. Cross-party UUIDs (the admin's auth.users id)
  // are NOT entitled to be in the subject's bundle.
  "granted_by",
  "revoked_by",
  "approved_by",
  "rejected_by",
  "edited_by",
  "admin_user_id",
  "processed_by",
  "decided_by",
  "invited_by",
  "uploaded_by",
  "reviewer_id",
  "created_by",
  "updated_by",
]);

/**
 * Recursively redact `AUDIT_METADATA_REDACT_KEYS` inside a metadata
 * value. Handles:
 *   - plain objects: clones, redacts matching keys in-place
 *   - arrays: recurses into each element (so array-of-objects metadata
 *     is also scrubbed; non-object array elements pass through)
 *   - primitives / null: passed through unchanged
 *
 * Internal helper — exported only via tests by way of
 * `redactAuditLogForUser`. The recursion is bounded by the input
 * depth; metadata is JSON sourced from `audit_log.metadata` JSONB so
 * the structural depth is bounded by the producer.
 */
function redactMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((el) => redactMetadataValue(el));
  }
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src)) {
      if (AUDIT_METADATA_REDACT_KEYS.has(key)) {
        out[key] = REDACTED_PLACEHOLDER;
      } else {
        out[key] = redactMetadataValue(src[key]);
      }
    }
    return out;
  }
  return value;
}

/**
 * Projection helper — audit_log → audit_log_for_user.
 *
 * Finding 7 (audit-2026-05-07 red-team): pre-fix, the filter retained
 * ONLY rows where the subject acted (row.user_id === userId). Rows where
 * the subject was the TARGET (i.e. another user acted ON them) — role
 * grants, admin-triggered deletions, account.export by an admin, etc. —
 * were silently dropped from the export. GDPR Art. 15 entitles the
 * subject to "data about them", not just "data they authored", so the
 * target-row direction matters.
 *
 * Retains a row when ANY of these conditions hold:
 *   - row.user_id === userId  (the subject acted)
 *   - row.entity_id === userId AND row.entity_type === 'user'
 *     (the subject is the entity an actor operated on)
 *   - row.metadata is a plain object with a `target_user_id` that
 *     matches userId (the subject is the target captured in metadata)
 *
 * Metadata redaction is recursive (Finding 7 part 2): arrays of nested
 * objects (e.g., a bulk role-grant audit row whose metadata is an
 * array of { user_id, role } pairs) now have their inner objects
 * scrubbed too. Pre-fix the recursion only descended into the
 * top-level object and stopped at the array boundary.
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

    // Finding 7 part 1: subject can be actor, entity, OR metadata target.
    const meta = row.metadata;
    const metaIsObject =
      meta !== null &&
      meta !== undefined &&
      typeof meta === "object" &&
      !Array.isArray(meta);
    const metaTargetMatch =
      metaIsObject &&
      (meta as Record<string, unknown>).target_user_id === userId;

    const isActor = row.user_id === userId;
    const isEntity =
      row.entity_id === userId && row.entity_type === "user";
    const isMetaTarget = metaTargetMatch;

    if (!isActor && !isEntity && !isMetaTarget) {
      continue;
    }

    const clone: Record<string, unknown> = { ...row };

    // Finding 7 part 2: recursive metadata redaction. Handles plain
    // objects, arrays, and arrays of objects uniformly.
    if (meta !== null && meta !== undefined) {
      clone.metadata = redactMetadataValue(meta);
    }

    // Audit 2026-05-07 red-team #6 (HIGH conf-7): scrub the top-level
    // `row.user_id` when the subject is retained ONLY because they're
    // the entity / metadata target. In those cases `row.user_id` is
    // the ACTOR's id (typically an admin) — a cross-party identifier
    // the subject is not entitled to see. Pre-fix, the metadata-only
    // redaction left the admin's auth.users UUID in plain sight; the
    // subject could correlate admin UUIDs across role.grant /
    // deletion.request.approve / account.sanitize rows. Blanking
    // row.user_id on entity-only / meta-target-only retention closes
    // that lateral pathway. The actor-retention branch (isActor=true)
    // keeps row.user_id unchanged because it IS the subject's own id
    // — they're entitled to know they acted on themselves.
    if (!isActor) {
      clone.user_id = REDACTED_PLACEHOLDER;
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
 * Cross-party columns blanked by `redactAllocatorMatchForUser`.
 *
 * NEW-C16-05 (audit 2026-05-26, MED conf-8): `match_decisions`,
 * `match_candidates`, and `bridge_outcomes` are owned by the subject
 * (allocator_id = subject) but carry identifiers that belong to OTHER
 * parties:
 *   - `strategy_id` / `original_strategy_id` point at / describe the
 *     MANAGER's strategy — the same cross-party `strategy_id` that
 *     `redactContactRequestForUser` already blanks. Disclosing it lets
 *     the subject derive the manager's strategy inventory.
 *   - `decided_by` (match_decisions only) is set to the ADMIN's auth
 *     UUID by the match console. It is the exact value
 *     `AUDIT_METADATA_REDACT_KEYS` strips from audit_log metadata, so
 *     shipping it raw in this bundle is an inconsistent application of
 *     the same privacy invariant.
 *
 * The subject's OWN fields (rank, score, score_breakdown, reasons,
 * decision, founder_note, notes, kind, status, deltas, timestamps) are
 * preserved — they are the subject's own match/bridge state.
 */
const ALLOCATOR_MATCH_CROSS_PARTY_COLUMNS: readonly string[] = [
  "strategy_id",
  "original_strategy_id",
];

/**
 * Projection helper — match_decisions / match_candidates /
 * bridge_outcomes projected for the subject (the allocator).
 *
 * Keeps only rows where `allocator_id === subject`. Blanks the
 * cross-party `strategy_id` / `original_strategy_id` (the manager's
 * strategy) to the placeholder, and `decided_by` when it is present
 * and not the subject (the admin's auth UUID). Mirrors
 * `redactContactRequestForUser`.
 *
 * Exported for unit-test pinning.
 */
export function redactAllocatorMatchForUser(
  rows: unknown[],
  userId: string,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    // Defense-in-depth: the SQL filter already scopes to the subject,
    // but the projection re-checks (a future query change must not
    // leak other allocators' rows). Log anomalies so operators can
    // detect SQL predicate drift or RLS bypass — silent drops would
    // produce a partial export with partial:false and no alert.
    if (row.allocator_id !== userId) {
      console.warn(
        `[gdpr-export] defense-in-depth: dropped row with allocator_id=${String(row.allocator_id)} !== userId for table (bridge_outcomes/match_candidates/match_decisions); SQL predicate may have drifted`,
      );
      continue;
    }
    const clone: Record<string, unknown> = { ...row };
    for (const col of ALLOCATOR_MATCH_CROSS_PARTY_COLUMNS) {
      if (col in clone && clone[col] !== null) {
        clone[col] = REDACTED_PLACEHOLDER;
      }
    }
    // decided_by is the ADMIN's auth UUID (match_decisions only). Blank
    // it unless it happens to be the subject themselves.
    if (
      "decided_by" in clone &&
      clone.decided_by !== null &&
      clone.decided_by !== userId
    ) {
      clone.decided_by = REDACTED_PLACEHOLDER;
    }
    out.push(clone);
  }
  return out;
}

/**
 * Columns on `api_keys` that carry the at-rest-encrypted credential
 * blob or its envelope metadata. Even though they're ciphertext, GDPR
 * Art. 15/20 do NOT require returning them — the user already has the
 * plaintext key in their broker UI, and the underlying credential
 * decrypt is gated by a service-only RPC (`decrypt_api_key`) that
 * applies its own access policy. Including the ciphertext in the
 * export bundle would widen the attack surface: anyone who captures
 * the 1-hour signed URL would also capture the encrypted material,
 * bypassing the decrypt RPC's access controls.
 *
 * Audit 2026-05-07 finding C-0166 (security c5):
 *   The pre-fix manifest exported `api_keys` with `.select('*')` and
 *   shipped every column — including `api_key_encrypted`,
 *   `api_secret_encrypted`, `dek_encrypted`, `passphrase_encrypted`,
 *   and the `nonce` IV. The redacted projection below strips those
 *   columns and keeps only the safe metadata the user genuinely needs
 *   to recognize the key (exchange, label, timestamps, status).
 *
 * Exported for unit-test pinning.
 */
export const API_KEYS_REDACTED_COLUMNS: ReadonlySet<string> = new Set<string>([
  "api_key_encrypted",
  "api_secret_encrypted",
  "passphrase_encrypted",
  "dek_encrypted",
  "nonce",
]);

/**
 * Projection helper — api_keys with credential ciphertext stripped.
 *
 * Retains EVERY row where `user_id === subject` (the user owns the
 * key) and removes the ciphertext / IV columns enumerated in
 * `API_KEYS_REDACTED_COLUMNS`. The remaining columns (`id`, `exchange`,
 * `label`, `created_at`, `last_sync_at`, `sync_status`, etc.) are
 * sufficient for the user to recognise the key and re-create it via
 * their broker UI.
 *
 * Exported for unit-test pinning.
 */
export function redactApiKeysForUser(
  rows: unknown[],
  userId: string,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    if (row.user_id !== userId) continue;
    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      if (API_KEYS_REDACTED_COLUMNS.has(key)) continue;
      clone[key] = row[key];
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
  // api_keys is exported as a REDACTED projection: GDPR Art. 15
  // entitles the user to know which keys exist on their account, but
  // not to receive the encrypted credential blob (which is internal
  // storage — the user already has the plaintext in their broker
  // UI). Stripping the ciphertext closes the 1-hour-signed-URL
  // exfiltration vector described in audit 2026-05-07 finding
  // C-0166. The post-fetch projection `redactApiKeysForUser` removes
  // `api_key_encrypted`, `api_secret_encrypted`, `passphrase_encrypted`,
  // `dek_encrypted`, and `nonce` from every row.
  {
    kind: "projected",
    table: "api_keys",
    source_table: "api_keys",
    user_column: "user_id",
    project: redactApiKeysForUser,
  },
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
  // NEW-C16-08 (audit 2026-05-26, HIGH): bridge_outcome_dismissals carries
  // `strategy_id NOT NULL` pointing at the MANAGER's strategy — the same
  // cross-party FK that NEW-C16-05 explicitly blanks in bridge_outcomes,
  // match_candidates, and match_decisions. Exporting it raw leaks the
  // manager's strategy UUID and breaks the privacy invariant applied
  // consistently to the sibling tables. Converting to a projected spec using
  // `redactAllocatorMatchForUser` blanks `strategy_id` (and
  // `original_strategy_id` if ever added) while preserving the allocator's
  // own dismissal metadata (dismissed_at, expires_at).
  {
    kind: "projected",
    table: "bridge_outcome_dismissals",
    source_table: "bridge_outcome_dismissals",
    user_column: "allocator_id",
    project: redactAllocatorMatchForUser,
  },
  // NEW-C16-05: bridge_outcomes carries cross-party strategy_id/original_strategy_id
  // (manager's strategy) and no decided_by — projected to blank cross-party columns.
  {
    kind: "projected",
    table: "bridge_outcomes",
    source_table: "bridge_outcomes",
    user_column: "allocator_id",
    project: redactAllocatorMatchForUser,
  },
  { kind: "direct", table: "data_deletion_requests", user_column: "user_id" },
  { kind: "direct", table: "investor_attestations", user_column: "user_id" },
  { kind: "direct", table: "match_batches", user_column: "allocator_id" },
  // NEW-C16-05: match_candidates carries cross-party strategy_id/original_strategy_id
  // (manager's strategy) — projected to blank cross-party columns.
  {
    kind: "projected",
    table: "match_candidates",
    source_table: "match_candidates",
    user_column: "allocator_id",
    project: redactAllocatorMatchForUser,
  },
  // NEW-C16-05: match_decisions carries cross-party strategy_id/original_strategy_id
  // AND decided_by (the admin's auth UUID) — projected to blank all cross-party fields.
  {
    kind: "projected",
    table: "match_decisions",
    source_table: "match_decisions",
    user_column: "allocator_id",
    project: redactAllocatorMatchForUser,
  },
  { kind: "direct", table: "organization_members", user_column: "user_id" },
  { kind: "direct", table: "portfolios", user_column: "user_id" },
  { kind: "direct", table: "profiles", user_column: "id" },
  { kind: "direct", table: "strategies", user_column: "user_id" },
  { kind: "direct", table: "user_app_roles", user_column: "user_id" },
  { kind: "direct", table: "user_favorites", user_column: "user_id" },
  { kind: "direct", table: "user_notes", user_column: "user_id" },
  // ------------------------------------------------------------------
  // Projected — bundle exposes a redacted projection of the source.
  // The bundle-facing `table` name MAY differ from `source_table`
  // (when the projection IS a synthetic name, e.g.
  // audit_log_for_user) or MAY match (when the table itself is just
  // having columns stripped, e.g. api_keys -> drops ciphertext).
  // See kind:"projected" docstring for details.
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
    // NEW-C16-02 (HIGH): widen the SQL predicate to MATCH the
    // projection's retention criteria. redactAuditLogForUser keeps a
    // row when the subject is the ACTOR, the ENTITY (entity_id=subject
    // AND entity_type='user'), OR the metadata target
    // (metadata->>target_user_id=subject). A bare .eq(user_id) only
    // returned the actor slice, so admin-on-subject rows (role.grant /
    // revoke, deletion.request.approve / reject, account.sanitize —
    // written with user_id=ADMIN, entity_id=subject) never reached the
    // projection and were silently absent from the export. The .or()
    // below fetches all three directions; the projection remains the
    // authoritative redaction gate.
    or_filter: (userId: string) =>
      `user_id.eq.${userId},and(entity_id.eq.${userId},entity_type.eq.user),metadata->>target_user_id.eq.${userId}`,
  },
  // NEW-C16-03 (audit 2026-05-26, HIGH): audit_log_cold is the 2yr+
  // archive that the `audit_log_hot_to_cold` cron MOVEs rows into
  // (migration 20260417110539_retention_crons.sql). It mirrors the hot
  // audit_log schema exactly (same columns, same owner-read RLS). The
  // export read ONLY the hot table, so an account >2yr old received an
  // Art. 15 bundle missing its most forensically-relevant old entries
  // (early events, old role grants/deletions) with NO `partial` signal
  // (the rows were never fetched). We UNION the cold archive into the
  // export as a second projection over the SAME redactor + the SAME
  // entity/metadata-target widening (NEW-C16-02). Bundle-facing name is
  // distinct (`audit_log_cold_for_user`) so it does not collide with
  // the hot projection. Sanitize parity: audit_log_cold is PRESERVE
  // (mirroring hot) — recorded in SANITIZE_PARITY_ALLOWLIST in
  // scripts/check-gdpr-export-coverage.ts (the cold table's PRESERVE
  // policy lives in the same retention-cron migration that creates it,
  // not the sanitize_user matrix the parity scan reads).
  {
    kind: "projected",
    table: "audit_log_cold_for_user",
    source_table: "audit_log_cold",
    user_column: "user_id",
    project: redactAuditLogForUser,
    or_filter: (userId: string) =>
      `user_id.eq.${userId},and(entity_id.eq.${userId},entity_type.eq.user),metadata->>target_user_id.eq.${userId}`,
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
  // NEW-C16-04 (audit 2026-05-26, HIGH): positions + position_snapshots
  // are strategy-scoped user trading data (FK strategy_id NOT NULL ->
  // strategies), the same indirect shape as trades. They were wrongly
  // EXCLUDED from the export ("Portfolio-scoped... indirect via
  // portfolios" — wrong on both counts), so a user's live positions and
  // historical position snapshots (Art. 15 personal trading data) were
  // entirely absent. Sanitize side is covered by the existing PRESERVE
  // rows in the sanitize_user matrix.
  {
    kind: "indirect",
    table: "positions",
    via_column: "strategy_id",
    parent_table: "strategies",
    parent_user_column: "user_id",
  },
  {
    kind: "indirect",
    table: "position_snapshots",
    via_column: "strategy_id",
    parent_table: "strategies",
    parent_user_column: "user_id",
  },
  // NEW-C16-09 (audit 2026-05-26, HIGH): csv_daily_returns is a user's
  // CSV-ingested daily return series (Art. 15 / Art. 20 portable personal
  // financial data). Migration 20260522111839 adds it with
  // `strategy_id NOT NULL REFERENCES strategies` — the same indirect shape
  // as trades / funding_fees / positions / position_snapshots. It was absent
  // from the export and from EXCLUDED_TABLES (no documented rationale), so
  // Art. 15 bundles silently omitted the user's CSV performance data.
  // The coverage-hook regex does NOT flag indirect tables (FK is strategy_id,
  // not a bare user_id column); manual addition to the manifest is required.
  {
    kind: "indirect",
    table: "csv_daily_returns",
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
            source_truncated: result.source_truncated,
          };
        } else {
          fetched[start + i] = {
            spec,
            rows: result.rows,
            error: null,
            parent_id_truncated: result.parent_id_truncated,
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
    const { spec, rows, error: fetchError, parent_id_truncated, source_truncated } = entry;

    if (fetchError) {
      failedTables.push(spec.table);
    }
    if (parent_id_truncated) {
      parentTruncatedTables.push(spec.table);
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

/**
 * Tables in USER_EXPORT_TABLES that have NO `id` column, mapped to the
 * NOT-NULL column that supplies their deterministic ORDER BY instead.
 *
 * NEW-C16-01 (audit 2026-05-26, CRITICAL): the previous
 * `getOrderColumn` returned `"id"` for every non-audit spec on the
 * stale assumption that "every user-owned table has an `id` UUID
 * column". Eight manifest tables have composite/natural PKs and NO `id`
 * column — verified against `src/lib/database.types.ts`:
 *   - `user_app_roles`          PK (user_id, role)              — order by granted_at
 *   - `user_favorites`          PK (user_id, strategy_id)       — order by created_at
 *   - `allocator_preferences`   keyed on user_id                — order by updated_at
 *   - `portfolio_strategies`    PK (portfolio_id, strategy_id)  — order by added_at
 *   - `allocator_equity_snapshots` PK (allocator_id, asof)      — order by asof
 *   - `investor_attestations`   PK (user_id)                    — order by attested_at
 *   - `organization_members`    PK (organization_id, user_id)   — order by joined_at
 *   - `csv_daily_returns`       PK (strategy_id, date)          — order by date (NEW-C16-09)
 * A `.order("id")` against any of them raised Postgres 42703
 * (`column "id" does not exist`), which `fetchRowsForSpec` surfaced as
 * a `fetch_error` → `partial: true` → the route returned HTTP 500
 * (`export_partial`) for EVERY user on EVERY call. The unit suite
 * mocked `.order()` as a no-op so the regression shipped green; the
 * `gdpr-export-schema.test.ts` schema-validation test now pins each
 * order column against `database.types.ts` so a mock cannot mask it.
 *
 * Each chosen column is `NOT NULL` in the table's Row type, so the
 * ORDER BY is total (no NULL-ordering ambiguity) and deterministic.
 *
 * Exported so the schema-validation regression test
 * (`gdpr-export-schema.test.ts`) can assert each override column
 * actually exists on its table in `database.types.ts` — a pure mock
 * cannot reproduce the 42703 these overrides exist to prevent.
 */
export const ORDER_COLUMN_OVERRIDES: Readonly<Record<string, string>> = {
  user_app_roles: "granted_at",
  user_favorites: "created_at",
  allocator_preferences: "updated_at",
  portfolio_strategies: "added_at",
  allocator_equity_snapshots: "asof",
  investor_attestations: "attested_at",
  organization_members: "joined_at",
  // NEW-C16-09: csv_daily_returns has a composite PK (strategy_id, date) —
  // no id column. `date` is the natural chronological sort key for a daily-
  // return series; matches the RPC's upsert key and the worker's SELECT order.
  csv_daily_returns: "date",
};

/**
 * The Postgres column that determines stable ORDER BY for a given
 * spec. Audit 2026-05-07 H-0456: PostgreSQL does NOT guarantee row
 * order without an explicit ORDER BY, so two calls to the same export
 * can return DIFFERENT 50K subsets for a user with >50K rows. The
 * size-cap truncation also depends on this ordering — without it the
 * bundle is non-deterministic. We sort by `created_at` for the audit
 * trail tables, by an explicit override for id-less tables
 * (see ORDER_COLUMN_OVERRIDES), and by `id` for everything else.
 */
export function getOrderColumn(spec: UserExportTable): string {
  // audit_log (hot) + audit_log_cold (2yr+ archive, NEW-C16-03) entries
  // have created_at as their natural time-ordering field — chronological
  // packing of the size-cap tail. Both lack an `id`-as-sort-key
  // semantics worth preferring over the temporal axis.
  if (
    spec.kind === "projected" &&
    (spec.source_table === "audit_log" ||
      spec.source_table === "audit_log_cold")
  ) {
    return "created_at";
  }
  // NEW-C16-01: the column the SELECT actually orders by is on
  // `spec.table` for direct/indirect specs AND `spec.source_table` for
  // projected specs (the SELECT hits the SOURCE table, not the bundle-
  // facing name). Look up ORDER_COLUMN_OVERRIDES by the table that is
  // actually queried, not the bundle name; fall back to the UUID PK `id`
  // for every table that has one.
  //
  // NEW-C16-11 (audit 2026-05-26, MED conf-8 red-team): the original
  // NEW-C16-01 fix keyed ORDER_COLUMN_OVERRIDES on `spec.table` for ALL
  // kinds, including projected. For projected specs `spec.table` is the
  // bundle-facing name (e.g. "audit_log_for_user") but the SELECT is
  // against `spec.source_table` ("audit_log"). Today all projected specs
  // happen to have spec.table === spec.source_table for the non-audit
  // entries, so the lookup was accidentally correct; but a future
  // projected spec where they differ (e.g. a synthetic view name over a
  // source table that lacks an id column) would silently fall through to
  // the "id" fallback even if the correct override key was registered
  // under the source name — producing a runtime 42703 the schema test
  // would not catch because the test uses orderedTableForSpec()
  // (source_table) while this function was using spec.table. This fix
  // makes both consistent: projected specs look up by source_table, all
  // others by spec.table.
  const lookupKey = spec.kind === "projected" ? spec.source_table : spec.table;
  return ORDER_COLUMN_OVERRIDES[lookupKey] ?? "id";
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
        source_truncated: false,
      };
    }
    const arr = data ?? [];
    return {
      rows: arr,
      error: null,
      parent_id_truncated: false,
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
      source_truncated: false,
    };
  }
  if (nonNullParentIds.length < parentIdsRaw.length) {
    // Null parent ids: legitimate dropped rows. Log so schema drift is
    // observable but DO NOT fail the bundle — the user's other rows
    // are still exportable.
    const nullCount = parentIdsRaw.length - nonNullParentIds.length;
    console.warn(
      `[gdpr-export] dropped ${nullCount} null parent id(s) for ${spec.parent_table}.${parentIdColumn} (via ${spec.table}); child rows of those parents are absent from the bundle`,
    );
  }
  const parentIdTruncated = parentRowsArr.length >= EXPORT_PARENT_ID_CAP;
  if (parentIds.length === 0) {
    return {
      rows: [],
      error: null,
      parent_id_truncated: parentIdTruncated,
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
      source_truncated: false,
    };
  }
  return {
    rows: aggregated,
    error: null,
    parent_id_truncated: parentIdTruncated,
    source_truncated:
      aggregatedTruncated || aggregated.length >= EXPORT_PER_TABLE_ROW_CAP,
  };
}
