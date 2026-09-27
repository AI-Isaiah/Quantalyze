/**
 * Phase 167.1.2 plan 16 (D-18) — the reader's working-holder rule.
 *
 * WHY THIS MATTERS. The phase goal is that each exchange ACCOUNT is counted
 * exactly once. A key marked 'duplicate' is counted THROUGH its holder only
 * while that holder is working; otherwise it counts on its own. If the reader
 * treated a failing holder as working, an account whose only other key cannot
 * sign in would be counted by nobody, and the card would tell the owner to
 * disconnect the one key that still works. D-18 (founder, 2026-09-27): a
 * working holder is active, connected, and its last sync is not revoked,
 * sign_in_failed or error. A NULL sync_status counts as working.
 */
import { describe, expect, it } from "vitest";
import {
  accountShareNote,
  isWorkingHolder,
  type AccountShareNoteKey,
} from "@/lib/account-share-note";

function key(overrides: Partial<AccountShareNoteKey> = {}): AccountShareNoteKey {
  return {
    id: "holder-0001",
    exchange: "okx",
    label: "Main",
    is_active: true,
    sync_status: "complete",
    disconnected_at: null,
    account_shared_with_api_key_id: null,
    account_share_kind: null,
    ...overrides,
  };
}

const DUP_SENTENCE =
  "This key reads the same exchange account as OKX — Main. Disconnect one of them.";

function noteFor(holder: AccountShareNoteKey): string | null {
  const dup = key({
    id: "dup-0002",
    label: "Second",
    account_shared_with_api_key_id: holder.id,
    account_share_kind: "duplicate",
  });
  return accountShareNote(dup, new Map([[holder.id, holder], [dup.id, dup]]));
}

describe("isWorkingHolder (D-18)", () => {
  it("a connected, active holder whose sign-in fails is NOT working, so the duplicate counts on its own and shows no note", () => {
    const holder = key({ sync_status: "sign_in_failed" });
    expect(isWorkingHolder(holder)).toBe(false);
    expect(noteFor(holder)).toBeNull();
  });

  it("a connected, active holder whose last sync completed is working, and the duplicate shows the unchanged sentence", () => {
    const holder = key({ sync_status: "complete" });
    expect(isWorkingHolder(holder)).toBe(true);
    expect(noteFor(holder)).toBe(DUP_SENTENCE);
  });
});
