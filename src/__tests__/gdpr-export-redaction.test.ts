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
  redactContactRequestForUser,
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
      from: (table: string) => ({
        select: (projection: string) => ({
          eq: () => ({
            limit: async () => {
              // Projected fetcher queries the SOURCE table (audit_log)
              // and then post-processes via redactAuditLogForUser.
              if (table === "audit_log") {
                return { data: auditRowsRaw, error: null };
              }
              if (projection === "id") {
                return { data: [], error: null };
              }
              return { data: [], error: null };
            },
          }),
          in: () => ({ limit: async () => ({ data: [], error: null }) }),
        }),
      }),
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
