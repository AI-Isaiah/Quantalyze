import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { isValidPartnerTag } from "@/lib/partner";
import { parseCsv, parseCsvWithSchema } from "@/lib/csv";
import { ensureAuthUser } from "@/lib/supabase/admin-users";
import { adminActionLimiter, checkLimit, isRateLimitMisconfigured } from "@/lib/ratelimit";
import { capAuditMetadata, emitAsUser } from "@/lib/audit";
import {
  validateDisplayName,
  ProfileValidationError,
} from "@/lib/profile-validation";
import type { DisclosureTier } from "@/lib/types";
import { MAGNITUDE_CAPS } from "@/lib/closed-sets";

/**
 * Audit-2026-05-07 red-team R-0003 (HIGH c7): cross-tenant profile
 * overwrite. The pre-fix phase-1 / phase-3 upserts unconditionally
 * rebranded an existing user's profile (partner_tag, role, allocator_
 * status, display_name) and allocator_preferences (mandate_archetype,
 * target_ticket_size_usd). An admin pasting a CSV containing a real
 * existing user (deliberately or by mistake) would silently take over
 * the row. The trust boundary "admin pastes a CSV" is broader than
 * "admin types a tenant model" — the CSV input must be validated
 * against existing tenant ownership before mutating profiles.
 *
 * Thrown when an import row resolves to an existing profile whose
 * partner_tag is set and differs from the import's partner_tag. The
 * catch path maps it to a 400 with the conflicting rows enumerated.
 */
class PartnerTagConflictError extends Error {
  readonly conflicts: Array<{
    email: string;
    existing_tag: string;
    attempted_tag: string;
  }>;
  constructor(
    conflicts: Array<{
      email: string;
      existing_tag: string;
      attempted_tag: string;
    }>,
  ) {
    super(
      `partner_tag conflict on ${conflicts.length} row(s) — refusing to overwrite existing tenant ownership`,
    );
    this.name = "PartnerTagConflictError";
    this.conflicts = conflicts;
  }
}

/**
 * Audit-2026-05-07 red-team R-0004 (MED c8): non-deterministic
 * disclosure_tier conflict. When the same (manager_email, strategy_name)
 * pair appears with conflicting tier values in a single CSV (Excel-paste
 * mistake), exactly one row landed and which tier "won" depended on
 * which concurrent worker picked it up first — institutional vs.
 * exploratory differ on whether demo/match masks the row. Fail loud
 * (rule 12) by enumerating the conflicts and returning a 400 with the
 * row pairs surfaced so the admin can re-paste deterministically.
 */
class StrategyTierConflictError extends Error {
  readonly conflicts: Array<{
    manager_email: string;
    strategy_name: string;
    tiers: DisclosureTier[];
  }>;
  constructor(
    conflicts: Array<{
      manager_email: string;
      strategy_name: string;
      tiers: DisclosureTier[];
    }>,
  ) {
    super(
      `disclosure_tier conflict on ${conflicts.length} (manager,strategy) pair(s) — re-paste with consistent tiers per row`,
    );
    this.name = "StrategyTierConflictError";
    this.conflicts = conflicts;
  }
}

// POST /api/admin/partner-import
//
// T-1.3 from the cap-intro demo sprint. Spins up a white-label pilot from 2
// pasted CSVs — managers (3+ strategies) and allocators (3+ LPs). This is a
// sketch for the first partner meeting, not a fully-baked tenant model:
//   * Uses the shared quote-aware CSV parser from `@/lib/csv` so pasted
//     fields with embedded commas / quotes don't blow up the import.
//   * Upserts everything idempotently so the founder can re-run during a demo.
//   * On `user_already_exists` we MUST fall through to a profiles-by-email
//     lookup and continue — silently skipping a row would kill the demo by
//     under-counting the imported pilot. This is handled in the shared
//     `ensureAuthUser` helper.
//
// Auth: admin only. partner_tag validated via the shared isValidPartnerTag
// helper against the canonical PARTNER_TAG_RE.
//
// Contract v2 (audit-2026-05-07 C-0052): the request MAY pass an explicit
// `?with_header=true|false` query parameter to declare whether the CSV
// payloads (`managers_csv`, `allocators_csv`) include a header row.
// Defaults to `true` so older clients that omit the parameter continue to
// work unchanged; we log a deprecation warning in that case so we can
// retire the implicit-header contract once all in-tree callers pass an
// explicit value. Invalid values (anything other than `true`/`false`) are
// rejected with a 400. The previous parser sniffed the first row and was
// brittle — a data row that happened to spell `manager_email` would be
// misclassified as a header. The query parameter is now the single source
// of truth; the parser never sniffs.

// NEW-C28-01/02/03 (B8): ticket_size_usd ([0, 1e9]), mandate_archetype (≤500),
// and strategy_name (≤80) invariants are enforced at the parse boundary using
// the shared MAGNITUDE_CAPS registry — the same caps validateSelfEditableInput
// (preferences.ts) and the wizard/csv-finalize routes consume, so they cannot
// drift from this admin import path.

// NEW-C28-04: row count cap to prevent unbounded GoTrue createUser fan-out.
// 500 rows = ~100 managers × 5 strategies + 500 allocators, well above any
// realistic single-partner onboarding. Protects against fat-finger paste and
// deliberate resource exhaustion.
const MAX_IMPORT_ROWS = 500;

interface ManagerRow {
  manager_email: string;
  strategy_name: string;
  disclosure_tier: DisclosureTier;
}

interface AllocatorRow {
  allocator_email: string;
  mandate_archetype: string;
  ticket_size_usd: number;
}

/**
 * Audit-2026-05-07 H-0239 (red-team c7): row-count surface.
 *
 * `parseCsv` splits on `\n` BEFORE quote-handling (see src/lib/csv.ts
 * line 15), so a multi-line quoted strategy_name (copy-pasted from
 * Excel) silently corrupts into two malformed rows that both fall
 * through the `if (!row.manager_email) return null` filter. The
 * operator sees N strategies imported when the CSV held N+1 — silent
 * drop. We surface a raw-vs-parsed delta to the caller so the admin
 * can spot the discrepancy and re-paste with quotes stripped.
 *
 * The helpers return both the parsed rows AND a raw-row count so the
 * route can compute `raw_rows_skipped = raw_rows_parsed - mapped`.
 */
interface ParsedCsv<T> {
  rows: T[];
  raw_rows_parsed: number;
}

function parseManagerRows(
  raw: string,
  hasHeader: boolean,
): ParsedCsv<ManagerRow> {
  const rawCount = countDataRows(raw, hasHeader);
  const rows = parseCsvWithSchema(
    raw,
    ["manager_email", "strategy_name", "disclosure_tier"],
    (row) => {
      if (!row.manager_email || !row.strategy_name) return null;
      // NEW-C28-03: strategy_name length + control-char guard. Mirrors
      // validateDisplayName's [\r\n\0] guard and the wizard's 1-80 cap.
      // Reject (drop) rows with overlong names or embedded control chars
      // so they surface in the raw-vs-parsed delta (H-0239), not silently
      // persist as arbitrary-length / control-char-contaminated strings.
      if (row.strategy_name.length > MAGNITUDE_CAPS.MAX_NAME_CHARS) return null;
      if (/[\r\n\0]/.test(row.strategy_name)) return null;
      const tier = row.disclosure_tier.toLowerCase();
      const disclosure_tier: DisclosureTier =
        tier === "institutional" ? "institutional" : "exploratory";
      return {
        manager_email: row.manager_email,
        strategy_name: row.strategy_name,
        disclosure_tier,
      };
    },
    hasHeader,
  );
  return { rows, raw_rows_parsed: rawCount };
}

function parseAllocatorRows(
  raw: string,
  hasHeader: boolean,
): ParsedCsv<AllocatorRow> {
  const rawCount = countDataRows(raw, hasHeader);
  const rows = parseCsvWithSchema(
    raw,
    ["allocator_email", "mandate_archetype", "ticket_size_usd"],
    (row) => {
      if (!row.allocator_email || !row.mandate_archetype) return null;
      // NEW-C28-02: mandate_archetype length cap. Reject rows with overlong
      // mandate cells — they surface in the raw-vs-parsed delta (H-0239) rather
      // than persisting a multi-KB blob.
      const mandate = row.mandate_archetype.trim();
      if (mandate.length === 0 || mandate.length > MAGNITUDE_CAPS.MAX_MANDATE_CHARS) return null;
      // NEW-C28-01: ticket_size_usd invariants. sanitizeCsvValue keeps a leading
      // '-', so raw negative values would land in allocator_preferences; reject
      // rather than clamp (loud failure rule).
      const ticket_size_usd = Number.parseFloat(
        (row.ticket_size_usd || "0").replace(/[,_$]/g, ""),
      );
      if (!Number.isFinite(ticket_size_usd)) return null;
      if (ticket_size_usd < 0) return null;
      if (ticket_size_usd > MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD) return null;
      return {
        allocator_email: row.allocator_email,
        mandate_archetype: mandate,
        ticket_size_usd,
      };
    },
    hasHeader,
  );
  return { rows, raw_rows_parsed: rawCount };
}

/**
 * Count the data-row lines in a raw CSV payload (header row excluded
 * when present, trailing empty lines excluded). Used for the H-0239
 * raw-vs-parsed delta surface — the count uses the same `parseCsv`
 * splitter the downstream parser uses so the delta reflects what the
 * parser actually saw (any multi-line-quote silent split is included
 * in the raw count and will surface as a parsed-vs-raw mismatch).
 *
 * Audit-2026-05-07 C-0052: `hasHeader` is now explicit. When false, row
 * 0 is data and is included in the count; when true (the default for
 * back-compat) row 0 is the header and is excluded.
 */
function countDataRows(raw: string, hasHeader: boolean): number {
  const rows = parseCsv(raw);
  if (rows.length === 0) return 0;
  const startIdx = hasHeader ? 1 : 0;
  // Exclude header (when present). Empty rows (length 0) are already
  // dropped by parseCsvWithSchema; we mirror that here so the delta
  // only reflects rows the schema mapper SAW and chose to drop, not
  // raw blank lines.
  let nonEmpty = 0;
  for (let i = startIdx; i < rows.length; i++) {
    if (rows[i].length > 0 && rows[i].some((cell) => cell.trim() !== "")) {
      nonEmpty += 1;
    }
  }
  return nonEmpty;
}

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Audit-2026-05-07 maintainability (Phase-2 fix): DRY the partner-import
 * rollup-audit metadata between the catch path and the success path so a
 * future field add/rename can't drift between forensic surfaces. Returns
 * the shared shape; the caller flips `partial_completion` and optionally
 * passes `error_message` on the catch side.
 */
interface PartnerImportMetadataInput {
  partner_tag: string;
  managers_created: number;
  strategies_created: number;
  strategies_skipped_existing: number;
  allocators_created: number;
  managers_rows_skipped: number;
  allocators_rows_skipped: number;
  partial_completion: boolean;
  error_message?: string;
}

function buildPartnerImportMetadata(
  input: PartnerImportMetadataInput,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    partner_tag: input.partner_tag,
    managers_created: input.managers_created,
    strategies_created: input.strategies_created,
    strategies_skipped_existing: input.strategies_skipped_existing,
    allocators_created: input.allocators_created,
    managers_rows_skipped: input.managers_rows_skipped,
    allocators_rows_skipped: input.allocators_rows_skipped,
    partial_completion: input.partial_completion,
  };
  if (input.error_message !== undefined) {
    metadata.error_message = input.error_message;
  }
  return metadata;
}

/**
 * Zero-dep concurrency limiter. Spawns `concurrency` workers that pull
 * indices from a shared counter and run `fn(items[idx])` until exhausted.
 * Preserves input order in the returned results. Used by the partner
 * importer because Supabase GoTrue `admin.createUser` is rate-limited,
 * so we can't just `Promise.all(items.map(fn))` — unbounded concurrency
 * trips the auth service. A small cap (5) gets ~5× speedup in practice
 * without hitting the rate limit.
 *
 * Fail-stop semantics: when any worker throws, the shared `aborted` flag
 * is set so the other workers skip their remaining items. Already-started
 * work still has to complete (there is no generic way to cancel an
 * in-flight fetch), but no NEW rows are picked up after the first failure.
 * This is the closest analogue to the old sequential loop's "stop on
 * first error" behaviour.
 */
async function mapConcurrent<T, U>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let nextIdx = 0;
  let aborted = false;
  let firstError: unknown;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (!aborted) {
        const idx = nextIdx++;
        if (idx >= items.length) return;
        try {
          results[idx] = await fn(items[idx], idx);
        } catch (err) {
          if (!aborted) {
            aborted = true;
            firstError = err;
          }
          return;
        }
      }
    },
  );
  await Promise.all(workers);
  if (aborted) throw firstError;
  return results;
}

/**
 * Deduplicate rows by a key-producing function. Last write wins (the later
 * row in the CSV replaces the earlier one). Used before `mapConcurrent` to
 * prevent the `ensureAuthUser` race where two workers for the same email
 * both hit the createUser path — the first wins, the second falls into
 * the "exists in auth but has no profile row" branch because the first
 * worker hasn't upserted the profile yet.
 */
function dedupeBy<T>(rows: T[], keyFn: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    byKey.set(keyFn(row), row);
  }
  return Array.from(byKey.values());
}

export async function POST(request: Request): Promise<NextResponse> {
  const csrfError = assertSameOrigin(request as NextRequest);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  // silent-failure-hunter HIGH (review Finding 3): destructure the error field
  // so a Supabase network error / JWT failure surfaces as 500, not a silent
  // 401 indistinguishable from "user not logged in". Without this, an auth
  // infrastructure outage is invisible in logs and Sentry.
  const { data: { user }, error: getUserErr } = await supabase.auth.getUser();
  if (getUserErr) {
    console.error("[api/admin/partner-import] auth.getUser failed:", getUserErr);
    return NextResponse.json({ error: "Authentication check failed" }, { status: 500 });
  }
  // P444 (audit-2026-05-07) — RFC 7235: 401 unauthenticated, 403 forbidden.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rl = await checkLimit(adminActionLimiter, `partner-import:${user.id}`);
  if (!rl.success) {
    // silent-failure-hunter HIGH (review Finding 6): mirror the roles route —
    // distinguish Upstash misconfiguration (503) from genuine quota exhaustion
    // (429) so an Upstash outage isn't silently collapsed into normal throttling.
    if (isRateLimitMisconfigured(rl)) {
      return NextResponse.json(
        { error: "Rate limiter unavailable", code: "ratelimit_misconfigured" },
        { status: 503, headers: { "Retry-After": String(rl.retryAfter) } },
      );
    }
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // Contract v2 (C-0052): resolve the with_header flag from the URL
  // BEFORE parsing the JSON body. Three states:
  //   * absent → default to `true` and log a deprecation warning so we
  //     can retire the implicit-header contract once all callers
  //     migrate.
  //   * "true" / "false" (case-insensitive) → use as-is.
  //   * anything else → 400. Strict rejection is the whole point of the
  //     fix; silently coercing "yes"/"1"/"y" would re-introduce the
  //     brittle sniff-style behaviour we're trying to eliminate.
  const url = new URL(request.url);
  const withHeaderRaw = url.searchParams.get("with_header");
  let hasHeader: boolean;
  if (withHeaderRaw === null) {
    hasHeader = true;
    console.warn(
      "[api/admin/partner-import] DEPRECATION: request omitted `with_header` query parameter; defaulting to true. Pass `?with_header=true|false` explicitly. (audit-2026-05-07 C-0052)",
    );
  } else {
    const normalized = withHeaderRaw.toLowerCase();
    if (normalized === "true") {
      hasHeader = true;
    } else if (normalized === "false") {
      hasHeader = false;
    } else {
      return NextResponse.json(
        {
          error:
            "with_header must be 'true' or 'false' (audit-2026-05-07 C-0052: explicit contract v2)",
        },
        { status: 400 },
      );
    }
  }

  let body: {
    partner_tag?: unknown;
    managers_csv?: unknown;
    allocators_csv?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const partner_tag = typeof body.partner_tag === "string" ? body.partner_tag : "";
  const managersCsv = typeof body.managers_csv === "string" ? body.managers_csv : "";
  const allocatorsCsv = typeof body.allocators_csv === "string" ? body.allocators_csv : "";

  if (!isValidPartnerTag(partner_tag)) {
    return NextResponse.json(
      { error: "partner_tag must match ^[a-z0-9-]+$" },
      { status: 400 },
    );
  }

  let managers: ManagerRow[];
  let allocators: AllocatorRow[];
  let managersRawCount = 0;
  let allocatorsRawCount = 0;
  try {
    const managersParsed = parseManagerRows(managersCsv, hasHeader);
    const allocatorsParsed = parseAllocatorRows(allocatorsCsv, hasHeader);
    managers = managersParsed.rows;
    allocators = allocatorsParsed.rows;
    managersRawCount = managersParsed.raw_rows_parsed;
    allocatorsRawCount = allocatorsParsed.raw_rows_parsed;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid CSV" },
      { status: 400 },
    );
  }

  if (managers.length === 0 && allocators.length === 0) {
    return NextResponse.json(
      { error: "Both CSVs are empty — nothing to import" },
      { status: 400 },
    );
  }

  // NEW-C28-04 (red-team H conf=7): reject requests with too many rows BEFORE
  // the import phases run. Each row fans out to admin.createUser + 2-3 DB
  // writes; an unbounded CSV hammers the GoTrue limiter and pins the function.
  // The adminActionLimiter caps requests/min but not rows-per-request.
  // Enforce a hard ceiling here so a fat-finger paste or deliberate DoS cannot
  // spawn unbounded GoTrue calls.
  const totalRows = managers.length + allocators.length;
  if (totalRows > MAX_IMPORT_ROWS) {
    return NextResponse.json(
      {
        error: `Import exceeds the maximum of ${MAX_IMPORT_ROWS} rows (managers + allocators combined). Got ${totalRows}. Split into multiple requests.`,
        code: "too_many_rows",
        managers_rows: managers.length,
        allocators_rows: allocators.length,
        max_rows: MAX_IMPORT_ROWS,
      },
      { status: 400 },
    );
  }

  // Audit-2026-05-07 red-team R-0004 (MED c8): reject CSVs that contain
  // conflicting disclosure_tier values for the same (manager_email,
  // strategy_name) pair BEFORE the import phases run. The downstream
  // intra-batch dedup (existingStrategyKeys add-after-check) would land
  // exactly one row but the surviving tier was non-deterministic — and
  // the tier governs whether demo/match masks the row. Fail loud with
  // the conflicting pairs enumerated so the admin can re-paste cleanly.
  {
    const tiersByKey = new Map<string, Set<DisclosureTier>>();
    for (const row of managers) {
      const key = `${row.manager_email}::${row.strategy_name}`;
      const set = tiersByKey.get(key) ?? new Set<DisclosureTier>();
      set.add(row.disclosure_tier);
      tiersByKey.set(key, set);
    }
    const tierConflicts: Array<{
      manager_email: string;
      strategy_name: string;
      tiers: DisclosureTier[];
    }> = [];
    for (const [key, tiers] of tiersByKey) {
      if (tiers.size > 1) {
        const [manager_email, strategy_name] = key.split("::");
        tierConflicts.push({
          manager_email,
          strategy_name,
          tiers: Array.from(tiers),
        });
      }
    }
    if (tierConflicts.length > 0) {
      return NextResponse.json(
        {
          error: new StrategyTierConflictError(tierConflicts).message,
          conflicts: tierConflicts,
          code: "strategy_tier_conflict",
        },
        { status: 400 },
      );
    }
  }

  // Audit-2026-05-07 H-0239 (red-team c7): raw-vs-parsed row-count
  // delta. parseCsv splits on `\n` BEFORE quote-handling so a multi-
  // line quoted field (Excel copy-paste of a strategy name with an
  // embedded newline) silently splits into two malformed rows that
  // both fall through the schema validator. Surface the delta so the
  // admin can spot the discrepancy and re-paste with newlines stripped.
  const managersRowsSkipped = Math.max(0, managersRawCount - managers.length);
  const allocatorsRowsSkipped = Math.max(
    0,
    allocatorsRawCount - allocators.length,
  );

  const admin = createAdminClient();
  let managers_created = 0;
  let strategies_created = 0;
  let allocators_created = 0;

  // The managers CSV intentionally allows one `manager_email` to appear on
  // multiple rows — that's how a manager with 3 strategies is represented.
  // Dedupe ONLY for the auth-user + profile upsert step (one write per
  // email) so parallel workers can't race on `ensureAuthUser`, then insert
  // every strategy row against the pre-resolved user id map.
  //
  // Allocators are naturally one-row-per-email (each allocator has a
  // single preferences row), but we dedupe defensively in case a
  // malformed CSV repeats an allocator — last-write-wins on preferences.
  const uniqueManagerEmails = dedupeBy(managers, (r) => r.manager_email);
  const dedupedAllocators = dedupeBy(allocators, (r) => r.allocator_email);

  // Concurrency cap for the per-row Supabase fan-out. Set to 5 because
  // Supabase GoTrue `admin.createUser` is the bottleneck and it rate-limits
  // at ~low single-digit concurrent calls. Each row also does 1-2 follow-up
  // DB writes; at N=20 rows this takes the total from ~20 sequential RTTs
  // down to ~4 batches of 5 concurrent RTTs.
  const IMPORT_CONCURRENCY = 5;

  // Audit-2026-05-07 C-0056 (security c6): use crypto.randomUUID() for
  // the import run identifier instead of a hand-stamped sha256(partner_tag
  // + Date.now()) UUID-shaped hex. The pre-fix value was DETERMINISTIC
  // (same partner_tag + same ms → same id), guessable, and not RFC 4122
  // v4. The audit anchor only needs uniqueness, not content-addressability;
  // the partner_tag + timestamp already ride in metadata where ops can grep
  // them.
  //
  // Also audit-2026-05-07 C-0054 (red-team c6): allocating the importUuid
  // BEFORE the import phases (not after) lets us emit an audit row on
  // partial-completion paths — the catch branch below now references this
  // same anchor.
  const importUuid = crypto.randomUUID();

  // Track skipped duplicate strategies for the response/audit (C-0055).
  let strategies_skipped_existing = 0;

  try {
    // Audit-2026-05-07 red-team R-0003 (HIGH c7): cross-tenant profile
    // overwrite pre-check. Look up existing profiles by email BEFORE
    // any phase-1 / phase-3 upsert. If a profile row already exists AND
    // its partner_tag is set AND differs from the import's partner_tag,
    // bail out with a 400 enumerating the conflicting rows so the admin
    // sees the takeover attempt rather than silently rebranding real
    // tenants. The check uses email (not user_id) because that's the
    // input the operator types — and the existing profiles already have
    // a 1-1 (id, email) mapping via auth.users.
    const allEmails = Array.from(
      new Set<string>([
        ...uniqueManagerEmails.map((r) => r.manager_email),
        ...dedupedAllocators.map((r) => r.allocator_email),
      ]),
    );
    if (allEmails.length > 0) {
      const { data: existingProfiles, error: profilesErr } = await admin
        .from("profiles")
        .select("email, partner_tag")
        .in("email", allEmails);
      if (profilesErr) throw profilesErr;
      const partnerTagConflicts: Array<{
        email: string;
        existing_tag: string;
        attempted_tag: string;
      }> = [];
      for (const existing of existingProfiles ?? []) {
        const { partner_tag: existingTag, email: existingEmail } = existing as {
          partner_tag?: string | null;
          email?: string;
        };
        if (
          typeof existingTag === "string" &&
          existingTag.length > 0 &&
          existingTag !== partner_tag &&
          typeof existingEmail === "string"
        ) {
          partnerTagConflicts.push({
            email: existingEmail,
            existing_tag: existingTag,
            attempted_tag: partner_tag,
          });
        }
      }
      if (partnerTagConflicts.length > 0) {
        throw new PartnerTagConflictError(partnerTagConflicts);
      }
    }

    // Phase 1: one auth user + profile per distinct manager email.
    const managerIdByEmail = new Map<string, string>();
    await mapConcurrent(uniqueManagerEmails, IMPORT_CONCURRENCY, async (row) => {
      // C-0181 (audit-2026-05-07): pass policy=create_or_resolve_pilot
      // with the import's partner_tag so the library refuses to bind to
      // a real (untagged) user or a cross-partner pilot row. Defense-
      // in-depth behind the route-level pre-check at lines 484-515.
      const userId = await ensureAuthUser(admin, {
        email: row.manager_email,
        policy: { mode: "create_or_resolve_pilot", partnerTag: partner_tag },
      });

      // @audit-skip: bulk-import row; rolled up into a single
      // admin.partner_import audit event after the whole import completes.
      // Per-row events would generate O(N) audit log rows with no forensic
      // gain over the summary event.
      // Audit-2026-05-07 P325: validate display_name BEFORE the upsert.
      // displayNameFromEmail() generates a clean string from the email
      // local-part for partner-import, but a malformed email column in
      // the CSV (CR/LF/NUL embedded — possible if a hostile partner
      // uploaded the file) would propagate straight into profiles.
      // Throwing here aborts the import for that row's batch and is
      // caught by the existing try/catch around the partner-import
      // pipeline, which returns a 4xx with the offending row.
      const managerDisplayName = validateDisplayName(
        displayNameFromEmail(row.manager_email),
      );
      const { error: profileErr } = await admin.from("profiles").upsert(
        {
          id: userId,
          email: row.manager_email,
          display_name: managerDisplayName,
          role: "manager",
          partner_tag,
        },
        { onConflict: "id" },
      );
      if (profileErr) throw profileErr;
      managerIdByEmail.set(row.manager_email, userId);
      managers_created += 1;
    });

    // Audit-2026-05-07 C-0055 (red-team c9): no UNIQUE(user_id, name)
    // constraint on strategies — a re-run of partner-import (network
    // glitch, double-click, retry after partial fail) used to duplicate
    // every strategy row. The comment promised idempotence; reality was
    // duplication. Pre-fetch existing (user_id, name) pairs for the
    // resolved manager set and skip rows that already exist. A
    // separate migration adding UNIQUE(user_id, name) is the proper
    // fix but is out-of-scope for this PR (it would require a partner-
    // import data backfill to dedupe pre-existing rows first); the
    // pre-check closes the demo-day re-run window in the meantime.
    const managerUserIds = Array.from(new Set(managerIdByEmail.values()));
    const existingStrategyKeys = new Set<string>();
    if (managerUserIds.length > 0) {
      const { data: existingStrategies, error: existingErr } = await admin
        .from("strategies")
        .select("user_id, name")
        .in("user_id", managerUserIds);
      if (existingErr) throw existingErr;
      for (const row of existingStrategies ?? []) {
        existingStrategyKeys.add(`${row.user_id}::${row.name}`);
      }
    }

    // Phase 2: insert EVERY strategy row, including multi-strategy managers.
    // Uses the pre-resolved user id map so there's no auth race.
    await mapConcurrent(managers, IMPORT_CONCURRENCY, async (row) => {
      const userId = managerIdByEmail.get(row.manager_email);
      if (!userId) {
        throw new Error(
          `partner-import: missing user id for manager ${row.manager_email} (phase 1 should have resolved it)`,
        );
      }
      const key = `${userId}::${row.strategy_name}`;
      if (existingStrategyKeys.has(key)) {
        strategies_skipped_existing += 1;
        return;
      }
      // Track the key so concurrent workers in this same batch don't
      // also try to insert the same (user_id, name) pair (multi-strategy
      // CSV with duplicated strategy_name rows for the same manager).
      existingStrategyKeys.add(key);
      // @audit-skip: bulk-import row; rolled up into admin.partner_import.
      const { error: strategyErr } = await admin.from("strategies").insert({
        user_id: userId,
        name: row.strategy_name,
        status: "draft",
        // Migration 031 introduced `source` to discriminate wizard drafts
        // from legacy and admin-imported drafts. Partner-import seeds
        // belong in the `admin_import` bucket so the Sprint 2 cleanup
        // cron (which only sweeps `source='wizard'`) never touches them.
        source: "admin_import",
        is_example: false,
        disclosure_tier: row.disclosure_tier,
        partner_tag,
      });
      if (strategyErr) throw strategyErr;
      strategies_created += 1;
    });

    await mapConcurrent(dedupedAllocators, IMPORT_CONCURRENCY, async (row) => {
      // C-0181 (audit-2026-05-07): same policy as manager phase — refuse
      // to bind to a real allocator account or a cross-partner pilot.
      const userId = await ensureAuthUser(admin, {
        email: row.allocator_email,
        policy: { mode: "create_or_resolve_pilot", partnerTag: partner_tag },
      });

      // @audit-skip: bulk-import row; rolled up into admin.partner_import.
      // Audit-2026-05-07 P325: validate display_name at insert boundary.
      // See partner-import phase-1 comment for rationale.
      const allocatorDisplayName = validateDisplayName(
        displayNameFromEmail(row.allocator_email),
      );
      const { error: profileErr } = await admin.from("profiles").upsert(
        {
          id: userId,
          email: row.allocator_email,
          display_name: allocatorDisplayName,
          role: "allocator",
          allocator_status: "verified",
          partner_tag,
        },
        { onConflict: "id" },
      );
      if (profileErr) throw profileErr;
      allocators_created += 1;

      // @audit-skip: bulk-import row; rolled up into admin.partner_import.
      const { error: prefErr } = await admin
        .from("allocator_preferences")
        .upsert(
          {
            user_id: userId,
            mandate_archetype: row.mandate_archetype,
            target_ticket_size_usd: row.ticket_size_usd,
          },
          { onConflict: "user_id" },
        );
      if (prefErr) throw prefErr;
    });
  } catch (err) {
    console.error("[api/admin/partner-import] failed:", err);

    // Extract message from Error / Supabase PostgrestError-like objects
    // / plain strings uniformly. Supabase's row-error shape is
    // `{ message, code, details, hint }` — NOT an Error subclass — so
    // `err instanceof Error` is false. Reading `.message` from the
    // shape produces a useful audit metadata value rather than
    // `[object Object]`.
    const errorMessage =
      err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);

    // Audit-2026-05-07 C-0053 / C-0054 (red-team c8 / c6): partial-
    // completion auditing. The pre-fix audit emission lived AFTER the
    // try block, so on partial completion (phase 1 succeeded, phase 2
    // threw mid-batch) the audit_log was silent even though real Auth
    // users + profiles were created. Emit a rollup audit row here with
    // `partial_completion: true` and the failed-phase metadata so the
    // forensic trail captures the actual DB state.
    //
    // Audit-2026-05-07 maintainability (Phase-2): derive partial_completion
    // from observed state rather than emitting it unconditionally. A pure
    // bad-input rejection (`ProfileValidationError` on the FIRST row, or
    // a phase-1 throw before any counter advanced) leaves no persisted
    // rows, so emitting `partial_completion: true` would conflate "input
    // rejected" with "phase-2 partial persistence" and lose the C-0053 /
    // C-0054 forensic signal. Skip the catch-path audit entirely when no
    // counters advanced; the C-0053 / C-0054 anchor requires real
    // persistence to fire.
    const observedPartialCompletion =
      managers_created > 0 ||
      strategies_created > 0 ||
      allocators_created > 0;
    if (observedPartialCompletion) {
      // NEW-C28-05 (red-team M conf=8): await the audit emit synchronously so
      // a transient failure surfaces as 5xx rather than producing a completed
      // import with no forensic anchor. The fire-and-forget wrappers
      // (logAuditEvent / logAuditEventAsUser) schedule via after() — usable
      // for read paths, but insufficient for a write-heavy admin import where
      // the audit row IS the forensic anchor for "which admin imported partner
      // X, how many rows". NEW-C28-06 (red-team L conf=9): use emitAsUser
      // (the underlying async emitter) with the admin client so auth.uid()
      // inside the log_audit_event RPC resolves to user.id correctly — the
      // documented anti-pattern for service-role routes.
      // silent-failure-hunter HIGH (review Findings 4 + IMPORTANT-1):
      // emitAsUser re-throws on permission_denied and unknown RPC errors.
      // A bare await here lets that throw propagate out of the catch block,
      // losing the original err context and all partial-completion counters.
      // Wrap in try/catch — audit failure is non-fatal on the error path;
      // the structured 500 response below is more important than an audit row.
      try {
        await emitAsUser(admin, user.id, {
          action: "admin.partner_import",
          entity_type: "partner_import",
          entity_id: importUuid,
          metadata: capAuditMetadata(
            buildPartnerImportMetadata({
              partner_tag,
              managers_created,
              strategies_created,
              strategies_skipped_existing,
              allocators_created,
              managers_rows_skipped: managersRowsSkipped,
              allocators_rows_skipped: allocatorsRowsSkipped,
              partial_completion: true,
              error_message: errorMessage,
            }),
          ),
        });
      } catch (auditErr) {
        console.error("[api/admin/partner-import] partial-completion audit emit failed (non-fatal):", auditErr);
        // Do NOT rethrow — continue with the original error path below.
      }
    }

    // Audit-2026-05-07 red-team R-0003 (HIGH c7): PartnerTagConflictError
    // is a bad-input signal (the CSV would rebrand existing tenants), NOT
    // a server fault. Return 400 with the enumerated conflicts so the
    // admin UI can show "row X belongs to partner Y; remove or merge".
    // The catch path is preferred over an early return so the audit-log
    // signal lands automatically when (and only when) earlier phase
    // counters advanced.
    if (err instanceof PartnerTagConflictError) {
      return NextResponse.json(
        {
          error: err.message,
          conflicts: err.conflicts,
          code: "partner_tag_conflict",
          managers_created,
          strategies_created,
          strategies_skipped_existing,
          allocators_created,
          managers_rows_skipped: managersRowsSkipped,
          allocators_rows_skipped: allocatorsRowsSkipped,
          // Audit-2026-05-07 C-0053 (red-team c8): surface the partial-
          // state flag on the response body so the admin UI / retry
          // tooling can branch on it. PartnerTagConflictError is thrown
          // BEFORE phase 1 runs, so counters are always zero here, but
          // we include the flag uniformly for client parity.
          partial_completion: observedPartialCompletion,
        },
        { status: 400 },
      );
    }

    // Audit-2026-05-07 P325: ProfileValidationError is a bad-input signal
    // (CSV row contained CR/LF/NUL or an over-long display_name), not a
    // server fault — return 400 with the structured field/reason so the
    // admin UI can highlight the offending row.
    if (err instanceof ProfileValidationError) {
      return NextResponse.json(
        {
          error: err.message,
          field: err.field,
          reason: err.reason,
          managers_created,
          strategies_created,
          strategies_skipped_existing,
          allocators_created,
          managers_rows_skipped: managersRowsSkipped,
          allocators_rows_skipped: allocatorsRowsSkipped,
          partial_completion: observedPartialCompletion,
        },
        { status: 400 },
      );
    }
    // Audit-2026-05-07 C-0053 (red-team c8): the operator-facing 500
    // response now mirrors the audit metadata by surfacing
    // `partial_completion`. Pre-fix the catch path returned only counters
    // — an operator could not tell from the response alone whether re-
    // running the import would create duplicate auth users / profile rows,
    // or whether nothing landed and a retry was safe.
    return NextResponse.json(
      {
        error: errorMessage || "Import failed",
        managers_created,
        strategies_created,
        strategies_skipped_existing,
        allocators_created,
        managers_rows_skipped: managersRowsSkipped,
        allocators_rows_skipped: allocatorsRowsSkipped,
        partial_completion: observedPartialCompletion,
      },
      { status: 500 },
    );
  }

  // Sprint 6 Task 7.1b — single rollup audit event for the whole
  // partner import. Per-row events would generate 10s-100s of audit
  // rows per import run with identical metadata; the summary is more
  // useful as a forensic anchor ("which admin imported partner X, when,
  // and how many rows landed").
  //
  // Audit-2026-05-07 C-0056 (security c6): entity_id is now
  // crypto.randomUUID() (allocated up-front so the catch branch can
  // reference the same anchor). The pre-fix value was a deterministic
  // sha256 slice with hand-stamped version/variant nybbles — guessable,
  // not RFC 4122. The audit anchor only needs uniqueness; partner_tag
  // + timestamp still ride in metadata for grep-ability.
  //
  // Audit-2026-05-07 H-0238 (security c8): cap audit metadata via
  // `capAuditMetadata` so attacker-influenced `partner_tag` cannot
  // bloat audit_log.metadata or reflect a multi-MB payload back
  // through /api/me/audit-log/export.
  // Audit-2026-05-07 maintainability (Phase-2): rollup payload built via
  // shared `buildPartnerImportMetadata` so the success-path surface stays
  // in lockstep with the catch-path surface. H-0239 (red-team c7) raw-
  // row count delta still rides through unchanged.
  // NEW-C28-05 / NEW-C28-06: await emitAsUser directly (see catch-path comment
  // above for rationale). For the success path, a failed audit emit surfaces
  // as 5xx rather than silently producing a completed import with no record.
  //
  // silent-failure-hunter HIGH (review Finding 5): wrap in try/catch so that
  // when emitAsUser throws (permission_denied / unknown RPC error) the caller
  // still learns the import SUCCEEDED with all its counters. Without this, a
  // transient audit RPC failure after a fully-committed import returns a bare
  // 500 — the operator cannot tell whether the import committed and risks
  // re-running it (creating duplicate auth users).
  try {
    await emitAsUser(admin, user.id, {
      action: "admin.partner_import",
      entity_type: "partner_import",
      entity_id: importUuid,
      metadata: capAuditMetadata(
        buildPartnerImportMetadata({
          partner_tag,
          managers_created,
          strategies_created,
          strategies_skipped_existing,
          allocators_created,
          managers_rows_skipped: managersRowsSkipped,
          allocators_rows_skipped: allocatorsRowsSkipped,
          partial_completion: false,
        }),
      ),
    });
  } catch (auditErr) {
    console.error("[api/admin/partner-import] success-path audit emit failed:", auditErr);
    // M-02 (red-team MEDIUM): 207 Multi-Status is misleading here — generic
    // HTTP clients (and the admin UI) treat any 2xx as success, ignore the
    // body, and may re-submit the import creating duplicate GoTrue users.
    // A 500 with the import counters in the body unambiguously signals that
    // the import committed but the side-effect (audit) failed, and prevents
    // callers from retrying the import itself. The counters in the body let
    // operators verify what actually happened without a second request.
    return NextResponse.json({
      managers_created,
      strategies_created,
      strategies_skipped_existing,
      allocators_created,
      managers_rows_skipped: managersRowsSkipped,
      allocators_rows_skipped: allocatorsRowsSkipped,
      partial_completion: false,
      audit_warning: "Import succeeded but the audit record could not be written. Contact support. Do NOT re-run the import.",
    }, { status: 500 });
  }

  return NextResponse.json({
    managers_created,
    strategies_created,
    strategies_skipped_existing,
    allocators_created,
    // Audit-2026-05-07 H-0239: surface row-count delta on the response
    // so the admin UI can warn the operator before they hit "Import
    // run" again on a CSV with silent newline splits.
    managers_rows_skipped: managersRowsSkipped,
    allocators_rows_skipped: allocatorsRowsSkipped,
    // Audit-2026-05-07 C-0053 (red-team c8): emit `partial_completion`
    // on every response (always `false` here on the success branch).
    // The catch branch sets `true` when phase counters advanced before
    // the throw. Clients can switch on this flag uniformly instead of
    // inferring partial state from a 500 status code.
    partial_completion: false,
  });
}
