/**
 * GDPR Art. 15 (right of access) + Art. 20 (data portability) export
 * MANIFEST — the single source of truth for which tables an export
 * bundle covers, the per-table ownership/filter contract, the
 * cross-party redaction projections, and the deterministic order
 * column for each spec.
 *
 * Why this is a SEPARATE module from `gdpr-export.ts`
 * --------------------------------------------------
 * `gdpr-export.ts` is the runtime engine: it imports `server-only`
 * and the Supabase client and assembles the bundle. The CI coverage
 * hook (`scripts/check-gdpr-export-coverage.ts`) runs under `tsx`,
 * where a top-level `import "server-only"` THROWS — so before B13 the
 * hook regex-scraped the `USER_EXPORT_TABLES` literal out of the
 * source TEXT to diff it against the migrations. That seam silently
 * drifted from the real typed array (a comment edit or a reformatted
 * entry could break the parse, or a new field could slip past it).
 *
 * This module holds the manifest as TYPED DATA with NO `server-only`
 * import and only a type-only `Database` import plus the lazy-Sentry
 * `captureToSentry` helper — so BOTH the server runtime AND the tsx
 * CI hook import the SAME `USER_EXPORT_TABLES` array. The coverage
 * gate now reads the typed array directly; drift is impossible by
 * construction. `gdpr-export.ts` re-exports every symbol here for
 * back-compat (`export * from "@/lib/gdpr-export-manifest"`).
 *
 * Invariant kept by the CI hook: when a migration adds a user-owned
 * table, `USER_EXPORT_TABLES` must be extended in the same PR or the
 * hook exits non-zero. See `scripts/check-gdpr-export-coverage.ts`.
 */
import type { Database } from "@/lib/database.types";
import { captureToSentry } from "@/lib/sentry-capture";

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
  // PR-2 perf #2 (2026-05-28): aggregate drift signals to ONE Sentry
  // capture per redactor invocation. Pre-fix, a SQL-predicate drift
  // exposing N rows would fire N captureToSentry calls — for a power
  // user's 10K-row match_decisions export that's 10K events to Sentry,
  // breaching tier and drowning the alert dashboard. Console.warn stays
  // inside the loop (per-row visibility in Vercel function logs); the
  // Sentry capture batches at function exit with a bounded sample of
  // offending IDs (cap = 10) so a forensic reader can still cluster.
  // Red-team H5 (2026-05-28): use a Set so the bounded sample dedupes
  // by construction. Pre-fix an attacker who controlled row order could
  // fill the first-N array with one repeated allocator_id, hiding the
  // spread of a drift event from the alert page. The Set dedupes
  // distinct UUIDs while still respecting the 10-element cap on Sentry
  // payload size.
  let driftCount = 0;
  const driftSample = new Set<string>();
  const DRIFT_SAMPLE_CAP = 10;
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    // Defense-in-depth: the SQL filter already scopes to the subject,
    // but the projection re-checks (a future query change must not
    // leak other allocators' rows). Log anomalies so operators can
    // detect SQL predicate drift or RLS bypass — silent drops would
    // produce a partial export with partial:false and no alert.
    if (row.allocator_id !== userId) {
      driftCount++;
      if (driftSample.size < DRIFT_SAMPLE_CAP) {
        driftSample.add(String(row.allocator_id));
      }
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
  // Bounded Sentry signal — one capture per invocation, regardless of
  // how many rows drifted. Skipped entirely on the normal path where
  // drift_count == 0.
  if (driftCount > 0) {
    captureToSentry(
      new Error(
        "gdpr-export: allocator_match rows dropped — SQL predicate drift or RLS bypass",
      ),
      {
        tags: { area: "gdpr-export", gate: "allocator_match_redaction_drift" },
        extra: {
          user_id: userId,
          drift_count: driftCount,
          offending_allocator_id_sample: Array.from(driftSample),
          total_rows_processed: rows.length,
        },
        level: "warning",
      },
    );
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
