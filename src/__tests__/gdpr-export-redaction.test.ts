/**
 * Audit 2026-05-12 — Lane E (P460/P697/P707/P708).
 *
 * GDPR Art. 15/20 entitle the data SUBJECT to data ABOUT THEM, not
 * data ABOUT OTHERS. Two failure modes must be guarded against in
 * the user export:
 *
 *   1. Tables that bundle cross-party state (audit_log, contact_requests)
 *      MUST be projected through a redaction helper that:
 *        - retains ONLY rows where the user is the subject (acted), AND
 *        - blanks PII fields that identify other users
 *          (display_name, email, partner_tag, manager_id, etc.)
 *      with the sentinel "[REDACTED — other user]".
 *
 *   2. The raw `audit_log` table MUST NOT appear in the user export
 *      bundle. The redacted projection `audit_log_for_user` replaces it.
 *
 * This file pins both invariants. Without the fix, the bundle leaks
 * other users' identifiers via:
 *   - audit_log.metadata.partner_tag / .display_name / .email
 *   - contact_requests rows for strategies the user does NOT own
 *     where the strategy_id (and downstream manager identity) belongs
 *     to a different account.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  USER_EXPORT_TABLES,
  collectUserExportBundle,
  redactAuditLogForUser,
  redactApiKeysForUser,
  redactContactRequestForUser,
  API_KEYS_REDACTED_COLUMNS,
  REDACTED_PLACEHOLDER,
} from "@/lib/gdpr-export";

describe("USER_EXPORT_TABLES — raw audit_log must NOT be in the manifest (P460)", () => {
  it("does not include 'audit_log' as a directly-exported table", () => {
    const names = USER_EXPORT_TABLES.map((t) => t.table);
    // Raw audit_log entries can reference OTHER users in metadata —
    // the export uses `audit_log_for_user` (redacted projection) instead.
    expect(names).not.toContain("audit_log");
  });

  it("does include 'audit_log_for_user' (redacted projection) as a direct table", () => {
    const names = USER_EXPORT_TABLES.map((t) => t.table);
    expect(names).toContain("audit_log_for_user");
  });
});

describe("redactAuditLogForUser (P697/P707/P708)", () => {
  const userId = "subject-user";
  const otherUserId = "other-user-A";

  it("retains only rows where user_id === subject (drops rows authored by other actors)", () => {
    const rows = [
      { id: "a", user_id: userId, action: "intro.send", metadata: {} },
      { id: "b", user_id: otherUserId, action: "intro.send", metadata: {} },
      { id: "c", user_id: userId, action: "api_key.decrypt", metadata: {} },
    ];
    const redacted = redactAuditLogForUser(rows, userId);
    expect(redacted).toHaveLength(2);
    expect(redacted.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("redacts other-user identifier fields in metadata (display_name, email, partner_tag)", () => {
    const rows = [
      {
        id: "x",
        user_id: userId,
        action: "intro.send",
        metadata: {
          source: "in_app_list",
          strategy_id: "s1",
          // These are the dangerous fields: they refer to a DIFFERENT user.
          partner_tag: "@manager-handle",
          display_name: "Other User Name",
          email: "other.user@example.com",
          manager_id: otherUserId,
          allocator_email: "third.party@example.com",
        },
      },
    ];
    const redacted = redactAuditLogForUser(rows, userId);
    expect(redacted).toHaveLength(1);
    const meta = redacted[0].metadata as Record<string, unknown>;

    // Safe (non-PII) fields are preserved
    expect(meta.source).toBe("in_app_list");
    expect(meta.strategy_id).toBe("s1");

    // PII-bearing fields are blanked
    expect(meta.partner_tag).toBe(REDACTED_PLACEHOLDER);
    expect(meta.display_name).toBe(REDACTED_PLACEHOLDER);
    expect(meta.email).toBe(REDACTED_PLACEHOLDER);
    expect(meta.manager_id).toBe(REDACTED_PLACEHOLDER);
    expect(meta.allocator_email).toBe(REDACTED_PLACEHOLDER);
  });

  it("handles a row with no metadata gracefully (does not throw)", () => {
    const rows = [{ id: "n1", user_id: userId, action: "role.grant" }];
    expect(() => redactAuditLogForUser(rows, userId)).not.toThrow();
    const redacted = redactAuditLogForUser(rows, userId);
    expect(redacted).toHaveLength(1);
  });

  it("handles metadata=null without crashing", () => {
    const rows = [
      { id: "n2", user_id: userId, action: "role.grant", metadata: null },
    ];
    const redacted = redactAuditLogForUser(rows, userId);
    expect(redacted).toHaveLength(1);
    expect(redacted[0].metadata).toBeNull();
  });

  // Finding 7 part 1 (audit-2026-05-07 red-team): the subject can be the
  // TARGET of an audit row, not just the actor. Retaining only
  // user_id===subject silently drops role grants, admin deletions, etc.
  // GDPR Art. 15 entitles the subject to "data about them" — not just
  // "data they authored".
  it("Finding 7: retains a row where the subject is the entity (entity_id=userId, entity_type='user')", () => {
    const rows = [
      // Subject is the target of an admin's role-grant action.
      {
        id: "t1",
        user_id: otherUserId, // actor is someone else
        action: "role.grant",
        entity_type: "user",
        entity_id: userId,
        metadata: { granted_role: "allocator" },
      },
      // Unrelated row — entity is a different user.
      {
        id: "t2",
        user_id: otherUserId,
        action: "role.grant",
        entity_type: "user",
        entity_id: "third-party",
        metadata: {},
      },
    ];
    const redacted = redactAuditLogForUser(rows, userId);
    expect(redacted).toHaveLength(1);
    expect(redacted[0].id).toBe("t1");
  });

  it("Finding 7: retains a row where metadata.target_user_id matches the subject", () => {
    const rows = [
      // Admin-issued sanitize: the actor is the admin, the metadata
      // captures the subject as target_user_id.
      {
        id: "t3",
        user_id: otherUserId,
        action: "account.sanitize",
        entity_type: "system",
        entity_id: null,
        metadata: { target_user_id: userId, reason: "user_request" },
      },
      // Mismatched target — must NOT be retained.
      {
        id: "t4",
        user_id: otherUserId,
        action: "account.sanitize",
        metadata: { target_user_id: "third-party" },
      },
    ];
    const redacted = redactAuditLogForUser(rows, userId);
    expect(redacted.map((r) => r.id)).toEqual(["t3"]);
    // target_user_id is itself in the redaction key set, so the value
    // is replaced with the sentinel even on the retained row — the
    // subject is entitled to know an action happened ABOUT them but
    // not to re-fetch their own UUID from a redacted output.
    const meta = redacted[0].metadata as Record<string, unknown>;
    expect(meta.target_user_id).toBe(REDACTED_PLACEHOLDER);
    expect(meta.reason).toBe("user_request");
  });

  // Finding 7 part 2: recursive metadata redaction. Pre-fix, array-
  // shaped metadata (e.g., a bulk role-grant whose metadata is
  // `[{user_id, role}, ...]`) was passed through untouched because
  // the redactor only descended into a top-level plain object.
  it("Finding 7: recursively redacts array-shaped metadata", () => {
    const rows = [
      {
        id: "arr1",
        user_id: userId,
        action: "roles.bulk_grant",
        metadata: [
          {
            grantee_id: otherUserId,
            display_name: "Other A",
            email: "a@example.com",
            role: "allocator",
          },
          {
            grantee_id: "third-party",
            display_name: "Other B",
            email: "b@example.com",
            role: "analyst",
          },
        ],
      },
    ];
    const redacted = redactAuditLogForUser(rows, userId);
    expect(redacted).toHaveLength(1);
    const meta = redacted[0].metadata as Array<Record<string, unknown>>;
    expect(Array.isArray(meta)).toBe(true);
    expect(meta).toHaveLength(2);
    for (const entry of meta) {
      // Cross-party PII inside each array element is scrubbed.
      expect(entry.display_name).toBe(REDACTED_PLACEHOLDER);
      expect(entry.email).toBe(REDACTED_PLACEHOLDER);
      // Safe fields preserved.
      expect(entry.role).toBeDefined();
    }
  });

  it("Finding 7: passes non-object array elements through unchanged", () => {
    const rows = [
      {
        id: "arr2",
        user_id: userId,
        action: "tags.assign",
        metadata: ["tag-a", "tag-b", 42, null],
      },
    ];
    const redacted = redactAuditLogForUser(rows, userId);
    expect(redacted).toHaveLength(1);
    expect(redacted[0].metadata).toEqual(["tag-a", "tag-b", 42, null]);
  });
});

describe("redactApiKeysForUser (C-0166)", () => {
  const userId = "key-owner";
  const otherUserId = "other-user";

  it("retains only rows where user_id === subject (drops rows owned by others)", () => {
    const rows = [
      { id: "k1", user_id: userId, exchange: "binance", label: "main" },
      { id: "k2", user_id: otherUserId, exchange: "okx", label: "other" },
      { id: "k3", user_id: userId, exchange: "bybit", label: "secondary" },
    ];
    const redacted = redactApiKeysForUser(rows, userId);
    expect(redacted.map((r) => r.id)).toEqual(["k1", "k3"]);
  });

  it("strips encrypted-credential columns (C-0166): ciphertext + iv MUST NOT appear", () => {
    const rows = [
      {
        id: "k1",
        user_id: userId,
        exchange: "binance",
        label: "main",
        api_key_encrypted: "CIPHERTEXT-KEY",
        api_secret_encrypted: "CIPHERTEXT-SECRET",
        passphrase_encrypted: "CIPHERTEXT-PASS",
        dek_encrypted: "CIPHERTEXT-DEK",
        nonce: "IV-BYTES",
        created_at: "2026-01-01T00:00:00Z",
        last_sync_at: "2026-04-01T00:00:00Z",
        sync_status: "ok",
      },
    ];
    const redacted = redactApiKeysForUser(rows, userId);
    expect(redacted).toHaveLength(1);
    const r = redacted[0];

    // Safe / identifying fields are preserved.
    expect(r.id).toBe("k1");
    expect(r.exchange).toBe("binance");
    expect(r.label).toBe("main");
    expect(r.created_at).toBe("2026-01-01T00:00:00Z");
    expect(r.last_sync_at).toBe("2026-04-01T00:00:00Z");
    expect(r.sync_status).toBe("ok");

    // Ciphertext columns are stripped entirely (NOT replaced with a
    // placeholder — the field MUST NOT be present, because a downstream
    // JSON consumer treating the bundle as ground truth might still see
    // the field name as evidence the column exists).
    for (const col of API_KEYS_REDACTED_COLUMNS) {
      expect(col in r).toBe(false);
    }
    // Sanity: the explicit columns the audit C-0166 named must be gone.
    expect("api_key_encrypted" in r).toBe(false);
    expect("api_secret_encrypted" in r).toBe(false);
    expect("dek_encrypted" in r).toBe(false);
    expect("passphrase_encrypted" in r).toBe(false);
    expect("nonce" in r).toBe(false);
  });

  it("handles a row that does NOT carry the encrypted columns (no-op)", () => {
    const rows = [{ id: "k1", user_id: userId, exchange: "binance", label: "main" }];
    const redacted = redactApiKeysForUser(rows, userId);
    expect(redacted).toHaveLength(1);
    expect(redacted[0]).toEqual({
      id: "k1",
      user_id: userId,
      exchange: "binance",
      label: "main",
    });
  });
});

describe("USER_EXPORT_TABLES — api_keys is exported as a projected redaction (C-0166)", () => {
  it("api_keys appears only as a projected entry (no direct .select('*'))", () => {
    const apiKeyEntries = USER_EXPORT_TABLES.filter((t) => t.table === "api_keys");
    expect(apiKeyEntries).toHaveLength(1);
    expect(apiKeyEntries[0].kind).toBe("projected");
  });

  it("C-0166: API_KEYS_REDACTED_COLUMNS covers every credential/IV column from migration 003", () => {
    // If a future migration adds a new encrypted-credential column on
    // api_keys, the contract is: it MUST be added to
    // API_KEYS_REDACTED_COLUMNS so the GDPR bundle continues to strip
    // ciphertext. This test pins the current set so a new column
    // landing without an update to the redaction set surfaces here.
    expect(API_KEYS_REDACTED_COLUMNS.has("api_key_encrypted")).toBe(true);
    expect(API_KEYS_REDACTED_COLUMNS.has("api_secret_encrypted")).toBe(true);
    expect(API_KEYS_REDACTED_COLUMNS.has("passphrase_encrypted")).toBe(true);
    expect(API_KEYS_REDACTED_COLUMNS.has("dek_encrypted")).toBe(true);
    expect(API_KEYS_REDACTED_COLUMNS.has("nonce")).toBe(true);
    // Size invariant: exactly 5 columns today. If you add one,
    // increment this number AND add the new column above.
    expect(API_KEYS_REDACTED_COLUMNS.size).toBe(5);
  });
});

describe("redactContactRequestForUser (P708)", () => {
  const userId = "allocator-self";

  it("retains rows where user is allocator_id; redacts the cross-party strategy_id link", () => {
    const rows = [
      { id: "cr1", allocator_id: userId, strategy_id: "s-other", status: "pending" },
      { id: "cr2", allocator_id: "other-allocator", strategy_id: "s-x", status: "pending" },
    ];
    const redacted = redactContactRequestForUser(rows, userId);
    // Only the user's own contact_request appears.
    expect(redacted).toHaveLength(1);
    expect(redacted[0].id).toBe("cr1");
    // strategy_id (which links to a DIFFERENT user's strategy) is redacted.
    // The user is entitled to "I sent a contact request" but not to
    // identify the manager-other-user via the strategy_id.
    expect(redacted[0].strategy_id).toBe(REDACTED_PLACEHOLDER);
    // Status (the user's own state) is preserved.
    expect(redacted[0].status).toBe("pending");
  });
});

describe("collectUserExportBundle — audit_log replaced by audit_log_for_user (P460 integration)", () => {
  // Mock client that returns:
  //   - 1 audit_log row authored by the subject (with cross-party metadata)
  //   - 1 audit_log row authored by ANOTHER user (must be dropped)
  function makeClient() {
    const auditRowsRaw = [
      {
        id: "audit-1",
        user_id: "subject",
        action: "intro.send",
        metadata: {
          partner_tag: "@evil-other-user",
          display_name: "Other User",
          email: "other@example.com",
        },
      },
      {
        id: "audit-2",
        user_id: "different-actor",
        action: "intro.send",
        metadata: {},
      },
    ];
    return {
      from: (table: string) => {
        const limit = async () => {
          // Projected fetcher queries the SOURCE table (audit_log)
          // and then post-processes via redactAuditLogForUser.
          if (table === "audit_log") {
            return { data: auditRowsRaw, error: null };
          }
          return { data: [], error: null };
        };
        const indirectLimit = async () => ({ data: [], error: null });
        return {
          select: () => ({
            // H-0456 fix: chain `.order(...)` between `.eq()` and `.limit()`.
            eq: () => ({
              order: () => ({ limit }),
              limit,
            }),
            in: () => ({
              order: () => ({ limit: indirectLimit }),
              limit: indirectLimit,
            }),
          }),
        };
      },
    };
  }

  it("emits audit_log_for_user with rows filtered+redacted; raw audit_log is absent", async () => {
    const mock = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "subject");

    const tableNames = bundle.tables.map((t) => t.table);
    expect(tableNames).not.toContain("audit_log");
    expect(tableNames).toContain("audit_log_for_user");

    const auditTable = bundle.tables.find((t) => t.table === "audit_log_for_user");
    expect(auditTable).toBeDefined();
    // Only the subject-authored row (id=audit-1) survives the filter.
    expect(auditTable!.row_count).toBe(1);
    const onlyRow = auditTable!.rows[0] as { metadata: Record<string, unknown> };
    // Cross-party PII has been replaced with the redaction sentinel.
    expect(onlyRow.metadata.partner_tag).toBe(REDACTED_PLACEHOLDER);
    expect(onlyRow.metadata.display_name).toBe(REDACTED_PLACEHOLDER);
    expect(onlyRow.metadata.email).toBe(REDACTED_PLACEHOLDER);
  });
});

/**
 * Audit 2026-05-07 (specialist apply, pr-test HIGH conf-9 + security
 * MED conf-8): the api_keys ciphertext-stripping projection is unit-
 * tested in isolation, but pre-apply there was no integration test
 * that drove `collectUserExportBundle` against a mock returning
 * ciphertext-bearing api_keys rows and asserted the bundle's
 * api_keys table has every credential column stripped. A future
 * refactor that switched api_keys back to `kind: "direct"` (or
 * dropped the projection from the projected branch) would leave the
 * unit test green while shipping ciphertext in the signed URL.
 *
 * Additionally, the security MED conf-8 finding extended the
 * AUDIT_METADATA_REDACT_KEYS set with the admin-actor UUID keys.
 * The integration test pins that the new keys are redacted in the
 * bundle's audit_log_for_user projection.
 */
describe("collectUserExportBundle — api_keys ciphertext stripped end-to-end (specialist apply)", () => {
  it("drops every API_KEYS_REDACTED_COLUMNS column from the bundle's api_keys table", async () => {
    const apiKeyRows = [
      {
        id: "k1",
        user_id: "subject",
        exchange: "binance",
        label: "main",
        api_key_encrypted: "CT-KEY",
        api_secret_encrypted: "CT-SEC",
        passphrase_encrypted: "CT-PASS",
        dek_encrypted: "CT-DEK",
        nonce: "IV",
        created_at: "2026-05-01T00:00:00Z",
      },
    ];
    const limit = async () => ({ data: apiKeyRows, error: null });
    const emptyLimit = async () => ({ data: [], error: null });
    const mock = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: table === "api_keys" ? limit : emptyLimit,
            }),
            limit: table === "api_keys" ? limit : emptyLimit,
          }),
          in: () => ({
            order: () => ({ limit: emptyLimit }),
            limit: emptyLimit,
          }),
        }),
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "subject");
    const tbl = bundle.tables.find((t) => t.table === "api_keys");
    expect(tbl).toBeDefined();
    expect(tbl!.row_count).toBe(1);
    const row = tbl!.rows[0] as Record<string, unknown>;
    // Every column in the contract MUST be absent (not present with
    // a sentinel — the field name itself reveals a column exists).
    for (const col of API_KEYS_REDACTED_COLUMNS) {
      expect(col in row).toBe(false);
    }
    // Safe metadata MUST round-trip.
    expect(row.exchange).toBe("binance");
    expect(row.label).toBe("main");
    expect(row.id).toBe("k1");
  });
});

describe("redactAuditLogForUser — admin-actor UUID redaction (specialist apply, security MED conf-8)", () => {
  const userId = "subject";
  it("redacts granted_by/revoked_by/approved_by/rejected_by/edited_by/admin_user_id in metadata", () => {
    const rows = [
      {
        id: "a1",
        user_id: "admin-actor-A",
        action: "role.grant",
        entity_id: userId,
        entity_type: "user",
        metadata: {
          role: "allocator",
          granted_by: "admin-actor-A",
        },
      },
      {
        id: "a2",
        user_id: "admin-actor-B",
        action: "deletion.request.approve",
        entity_id: userId,
        entity_type: "user",
        metadata: {
          target_user_id: userId,
          approved_by: "admin-actor-B",
        },
      },
      {
        id: "a3",
        user_id: "admin-actor-C",
        action: "match.preference.edit",
        entity_id: userId,
        entity_type: "user",
        metadata: {
          edited_by: "admin-actor-C",
          admin_user_id: "admin-actor-C",
        },
      },
    ];
    const out = redactAuditLogForUser(rows, userId);
    expect(out).toHaveLength(3);
    // The cross-party UUID keys are redacted in every row.
    for (const row of out) {
      const md = row.metadata as Record<string, unknown>;
      for (const k of [
        "granted_by",
        "approved_by",
        "edited_by",
        "admin_user_id",
        "target_user_id",
      ]) {
        if (k in md) {
          expect(md[k]).toBe(REDACTED_PLACEHOLDER);
        }
      }
    }
    // Audit 2026-05-07 red-team #6 (HIGH conf-7): the top-level
    // `row.user_id` IS the admin's UUID on every row in this test
    // (subject is retained via entity_id, not as actor). It MUST
    // also be redacted — pre-fix the metadata-only redaction left
    // the admin's auth.users id in plain sight.
    for (const row of out) {
      expect(row.user_id).toBe(REDACTED_PLACEHOLDER);
    }
    // The safe own-state field (role) survives.
    expect((out[0].metadata as Record<string, unknown>).role).toBe("allocator");
  });
});
