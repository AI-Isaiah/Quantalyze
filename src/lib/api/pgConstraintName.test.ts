import { describe, it, expect } from "vitest";

import {
  pgConstraintName,
  VENUE_IDENTITY_CONSTRAINT,
  WIZARD_SESSION_CONSTRAINTS,
} from "./pgConstraintName";

/**
 * Phase 154 / WIZCONT-02 (TWIN-8).
 *
 * ⭐ EVERY EXPECTED VALUE IN THIS FILE IS HAND-TYPED, and the message strings
 * are hand-typed from PostgreSQL's own `errmsg` formats rather than built by
 * calling the module under test. An oracle assembled from the module's own
 * regex would pass no matter what the regex did.
 */
describe("[154-06 / TWIN-8] pgConstraintName", () => {
  it("names the constraint in a unique_violation message", () => {
    expect(
      pgConstraintName({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "api_keys_user_exchange_venue_account_uniq"',
        details: "Key (user_id, exchange, venue_account_id)=(x, mt5, 5551234) already exists.",
      }),
    ).toBe("api_keys_user_exchange_venue_account_uniq");
  });

  it("names the constraint in a check_violation message, not the relation", () => {
    // The `relation "api_keys"` fragment precedes `constraint`, so a regex that
    // grabbed the first quoted token would answer "api_keys" here.
    expect(
      pgConstraintName({
        code: "23514",
        message:
          'new row for relation "api_keys" violates check constraint "api_keys_venue_account_id_nonblank"',
      }),
    ).toBe("api_keys_venue_account_id_nonblank");
  });

  it("names the constraint in a foreign_key_violation message, not the table", () => {
    expect(
      pgConstraintName({
        code: "23503",
        message:
          'insert or update on table "strategies" violates foreign key constraint "strategies_api_key_id_fkey"',
      }),
    ).toBe("strategies_api_key_id_fkey");
  });

  it("answers null when the message names no constraint", () => {
    expect(pgConstraintName({ code: "23505", message: "dup" })).toBeNull();
  });

  it("is TOTAL: null/undefined/string/number/no-message inputs answer null, never throw", () => {
    expect(pgConstraintName(null)).toBeNull();
    expect(pgConstraintName(undefined)).toBeNull();
    expect(pgConstraintName("duplicate key")).toBeNull();
    expect(pgConstraintName(42)).toBeNull();
    expect(pgConstraintName({})).toBeNull();
    expect(pgConstraintName({ message: 12345 })).toBeNull();
  });

  /**
   * ⛔ THE SECURITY PROPERTY, ASSERTED RATHER THAN NARRATED.
   *
   * `details` on a 23505 embeds the offending KEY VALUES — for the venue index
   * that is the MT5 login, which is client-supplied. If the parser read
   * `details`, a caller could put constraint-name text INSIDE their login and
   * steer which arm answers them. Both halves are pinned: a name present only
   * in `details` is NOT found, and a crafted `details` does NOT override the
   * real name in `message`.
   */
  it("NEVER reads `details` — a name only in details is not found", () => {
    expect(
      pgConstraintName({
        code: "23505",
        message: "duplicate key value violates unique constraint",
        details:
          'Key (venue_account_id)=(constraint "api_keys_user_exchange_venue_account_uniq") already exists.',
      }),
    ).toBeNull();
  });

  it("NEVER reads `details` — a crafted details cannot override the real message name", () => {
    expect(
      pgConstraintName({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "api_keys_user_exchange_venue_account_uniq"',
        details:
          'Key (venue_account_id)=(constraint "strategies_user_wizard_session_source_uniq") already exists.',
      }),
    ).toBe("api_keys_user_exchange_venue_account_uniq");
  });

  /**
   * The names themselves are pinned against the migrations that create them —
   * a typo here is a silent mis-route, and both routes read these constants.
   */
  it("pins the constraint names the routes discriminate on", () => {
    // supabase/migrations/20260812083206_api_keys_venue_account_id.sql
    expect(VENUE_IDENTITY_CONSTRAINT).toBe(
      "api_keys_user_exchange_venue_account_uniq",
    );
    // supabase/migrations/20260728120000_csv_finalize_double_submit_idempotency.sql:167
    expect(WIZARD_SESSION_CONSTRAINTS.has("strategies_user_wizard_session_source_uniq")).toBe(true);
    // supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql:52 (superseded/dropped)
    expect(WIZARD_SESSION_CONSTRAINTS.has("strategies_user_wizard_session_uniq")).toBe(true);
    expect(WIZARD_SESSION_CONSTRAINTS.has(VENUE_IDENTITY_CONSTRAINT)).toBe(false);
  });
});
