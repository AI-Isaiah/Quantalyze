/**
 * Phase 154 / WIZCONT-02 (TWIN-8) — the ONE reader of "which constraint did
 * Postgres actually refuse on".
 *
 * WHY IT EXISTS. Two wizard-write routes carry the same undifferentiated arm:
 * `create-with-key/route.ts` and `composite/add-key/route.ts` both mapped ANY
 * 23505 to `DRAFT_ALREADY_EXISTS` ("A wizard session with this key is already
 * in progress."). That was a single-constraint world and the copy was true in
 * it. Migration 20260812120000 adds a SECOND unique index over `api_keys`
 * (`api_keys_user_exchange_venue_account_uniq`), so a 23505 is no longer one
 * fact — and reporting a venue-identity collision as a duplicate DRAFT tells
 * the user something that is simply not the case. Discriminating is the
 * difference between the right answer and a plausible one.
 *
 * ⛔ IT PARSES `message` AND DELIBERATELY NEVER `details`. This is the
 * load-bearing decision in the file and it is a security choice, not a
 * simplification:
 *
 *   · A PostgreSQL `unique_violation` puts the OFFENDING KEY VALUES in
 *     `details` — `Key (user_id, exchange, venue_account_id)=(…, mt5, 5551234)
 *     already exists.` For the venue-identity index that value IS the MT5
 *     broker login. Reading `details` to make a control decision means the
 *     control's input is partly CLIENT-SUPPLIED: a caller who puts the text
 *     `constraint "strategies_user_wizard_session_source_uniq"` inside their
 *     login would be steering which arm answers them. `message` for both
 *     `unique_violation` and `check_violation` is composed by Postgres from
 *     catalog names only and carries no row data, so it is the only honest
 *     input.
 *   · The same property keeps the identity out of anything derived from the
 *     return value — a caller can log `pgConstraintName(error)` freely, which
 *     is exactly what the routes do instead of logging the raw error on a
 *     23505 (T-154-06-C).
 *
 * ⚠️ A `null` return means "no constraint name was parseable", NOT "no
 * constraint was violated". Callers must treat `null` as the UNKNOWN case and
 * keep their pre-existing behaviour for it — inventing a fact from an absent
 * name is the "absence is not a value" defect this phase exists to close.
 *
 * Zero imports on purpose: this is a leaf called from inside error arms, where
 * a module-load failure would replace the caller's real error with an import
 * error (same rule `seam-redaction.ts` states at length).
 */

/**
 * Matches the constraint name Postgres quotes in its own message text.
 *
 * Covers every shape the wizard routes can see:
 *   unique_violation    `duplicate key value violates unique constraint "x"`
 *   check_violation     `new row for relation "api_keys" violates check constraint "x"`
 *   foreign_key         `insert or update on table "t" violates foreign key constraint "x"`
 *   exclusion_violation `conflicting key value violates exclusion constraint "x"`
 *
 * The `relation "…"` / `table "…"` fragments precede the word `constraint`, so
 * the first match is always the constraint and never the table. Identifier
 * charset is bounded to what a Postgres constraint name can be here, and the
 * length is capped so a pathological message cannot produce an unbounded token.
 */
const CONSTRAINT_NAME_PATTERN = /constraint "([A-Za-z0-9_]{1,128})"/;

/**
 * The `api_keys` venue-identity index from migration 20260812120000. A 23505
 * naming THIS is "these credentials are already connected", never "this wizard
 * session already has a draft".
 */
export const VENUE_IDENTITY_CONSTRAINT =
  "api_keys_user_exchange_venue_account_uniq";

/**
 * The wizard-session fences, whose 23505 IS the pre-existing
 * `DRAFT_ALREADY_EXISTS` fact and must keep answering byte-identically.
 *
 * ⚠️ TWO NAMES ON PURPOSE. `strategies_user_wizard_session_source_uniq`
 * (20260728120000:167) SUPERSEDED `strategies_user_wizard_session_uniq`
 * (20260602190000:52), and the older index was DROPped in the same migration
 * that replaced it (20260728120000:181) — so only the first is reachable on any
 * database at or past that migration. The superseded name is listed anyway
 * because the cost of listing it is nothing and the cost of omitting it is a
 * 500 where a 409 belongs, on an older database, on the wizard's only API path.
 */
export const WIZARD_SESSION_CONSTRAINTS: ReadonlySet<string> = new Set([
  "strategies_user_wizard_session_source_uniq",
  "strategies_user_wizard_session_uniq",
]);

/**
 * The constraint name a Postgres/PostgREST error names, or `null` when the
 * error carries no parseable one.
 *
 * Total by construction — it is called from inside catch/error arms and must
 * never itself throw, so every input shape that is not a string `message`
 * simply answers `null`.
 */
export function pgConstraintName(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  const match = CONSTRAINT_NAME_PATTERN.exec(message);
  return match ? match[1] : null;
}
