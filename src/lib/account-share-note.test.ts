/**
 * Phase 167.1.2 plan 16 (D-18) — the reader's working-holder rule.
 *
 * WHY THIS MATTERS. The phase goal is that each exchange ACCOUNT is counted
 * exactly once. A key marked 'duplicate' is counted THROUGH its holder only
 * while that holder is working; otherwise it counts on its own. If the reader
 * treated a failing holder as working, an account whose only other key cannot
 * sign in would be counted by nobody. A marked key reads through its holder
 * only while that holder works (D-18), so naming a failing holder would
 * describe the account as read through a key that no longer reads it. D-18
 * (founder, 2026-09-27): a working holder is active, connected, and its last
 * sync is not revoked, sign_in_failed or error. A NULL sync_status counts as
 * working.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accountShareNote,
  isWorkingHolder,
  NOT_WORKING_SYNC_STATUSES,
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
  "This key reads the same exchange account as OKX — Main. We count that account once.";

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

  it("a connected, active holder whose last sync completed is working, and the duplicate shows the counted-once sentence", () => {
    const holder = key({ sync_status: "complete" });
    expect(isWorkingHolder(holder)).toBe(true);
    expect(noteFor(holder)).toBe(DUP_SENTENCE);
  });

  it.each<[string, Partial<AccountShareNoteKey>]>([
    ["idle", { sync_status: "idle" }],
    ["complete", { sync_status: "complete" }],
    ["rate_limited", { sync_status: "rate_limited" }],
    ["never synced (NULL)", { sync_status: null }],
  ])("WORKING: an active, connected holder whose last sync is %s still counts the account", (_name, overrides) => {
    const holder = key(overrides);
    expect(isWorkingHolder(holder)).toBe(true);
    expect(noteFor(holder)).toBe(DUP_SENTENCE);
  });

  it.each<[string, Partial<AccountShareNoteKey>]>([
    ["revoked", { sync_status: "revoked" }],
    ["sign_in_failed", { sync_status: "sign_in_failed" }],
    ["error", { sync_status: "error" }],
    ["inactive (is_active false, last sync complete)", { is_active: false }],
    ["disconnected", { disconnected_at: "2026-09-20T00:00:00Z" }],
  ])("NOT WORKING: a holder that is %s does not count the account, so the duplicate shows no note", (_name, overrides) => {
    const holder = key(overrides);
    expect(isWorkingHolder(holder)).toBe(false);
    expect(noteFor(holder)).toBeNull();
  });
});

/**
 * Phase 183 D-02 — what the note says, and when it says nothing.
 *
 * WHY THIS MATTERS. The founder's reason (183-CONTEXT D-02): "Under your rule,
 * one account behind several logins is intended, so telling the user to
 * disconnect a key is wrong." The note states a fact (this key reads the same
 * exchange account as its holder, and we count that account once) and names no
 * control, so 167.1.2 REVIEW WR-01's per-card verb is retired with the remedy.
 * Two rules from that review keep their force:
 *   - WR-02: the note is silent on a marked key that is itself disconnected,
 *     inactive or failing; such a key shows its own status instead.
 *   - SF-L1: with the holder absent from the caller's key list the holder
 *     cannot be judged working (D-18), so the note says nothing.
 */
describe("accountShareNote — the note states a fact and asks for no remedy (Phase 183 D-02)", () => {
  const holder = key({ sync_status: "complete" });
  function dupOf(overrides: Partial<AccountShareNoteKey> = {}): AccountShareNoteKey {
    return key({
      id: "dup-0002",
      label: "Second",
      account_shared_with_api_key_id: holder.id,
      account_share_kind: "duplicate",
      ...overrides,
    });
  }

  it("says the key reads the same account as its holder and that we count that account once (Phase 183 D-02)", () => {
    const dup = dupOf();
    const keysById = new Map([[holder.id, holder], [dup.id, dup]]);
    expect(accountShareNote(dup, keysById)).toBe(DUP_SENTENCE);
  });

  it("no note asks the owner to remove a key, on any venue or working holder status (Phase 183 D-02)", () => {
    const statuses: (string | null)[] = ["idle", "complete", "rate_limited", null];
    const exchanges = ["binance", "okx", "bybit", "deribit", "sfox", "mt5"];
    for (const sync_status of statuses) {
      for (const exchange of exchanges) {
        const h = key({ exchange, sync_status });
        const dup = dupOf({ exchange });
        const note = accountShareNote(dup, new Map([[h.id, h], [dup.id, dup]]));
        const where = `${exchange} / ${String(sync_status)}`;
        expect(note, `a note is shown for ${where}`).not.toBeNull();
        expect(note, `no remedy verb for ${where}`).not.toMatch(/\b(disconnect|delete|remove)\b/i);
        expect(note, `no "one of them" for ${where}`).not.toMatch(/one of them/i);
      }
    }
  });

  it.each<[string, Partial<AccountShareNoteKey>]>([
    ["disconnected", { disconnected_at: "2026-09-20T00:00:00Z" }],
    ["inactive", { is_active: false }],
    ["revoked", { sync_status: "revoked" }],
    ["sign_in_failed", { sync_status: "sign_in_failed" }],
    ["error", { sync_status: "error" }],
  ])("says nothing on a marked key that is itself %s: it counts for nothing and its marker never clears", (_name, overrides) => {
    const dup = dupOf(overrides);
    expect(accountShareNote(dup, new Map([[holder.id, holder], [dup.id, dup]]))).toBeNull();
  });

  it("says nothing when the holder is not in the caller's key list (it cannot be judged working)", () => {
    const dup = dupOf();
    expect(accountShareNote(dup, new Map([[dup.id, dup]]))).toBeNull();
  });
});

/**
 * 167.1.2 REVIEW SF-L3 — the D-18 status list is written twice, once here in
 * TypeScript (the key cards' note) and once in SQL (the KEY_NOT_DEPARTED test
 * of set_departed_key_history_inclusion). If they drift, the card and the
 * history-choice RPC disagree about which holder is working: the card says
 * nothing while the RPC refuses a history choice, or the reverse, and the
 * account is counted by one reader and not the other. The SQL tuple is read
 * out of the shipped files, anchored on the `v_sync_status NOT IN` line (the
 * same function has an unrelated `NOT IN ('include', 'exclude')`).
 */
describe("D-18 parity: the TypeScript not-working statuses equal the SQL tuple", () => {
  function sqlTuple(relPath: string): string[] {
    const text = readFileSync(join(process.cwd(), relPath), "utf8");
    const matches = [...text.matchAll(/v_sync_status\s+NOT\s+IN\s*\(([^)]*)\)/gi)];
    expect(matches, `exactly one v_sync_status NOT IN tuple in ${relPath}`).toHaveLength(1);
    return [...matches[0][1].matchAll(/'([^']*)'/g)].map((m) => m[1]).sort();
  }

  it.each([
    "supabase/migrations/20260927180000_working_holder_rule_d18.sql",
    "supabase/schema/functions/set_departed_key_history_inclusion.sql",
  ])("%s", (relPath) => {
    const tuple = sqlTuple(relPath);
    expect(tuple.length).toBeGreaterThan(0);
    expect(tuple).toEqual([...NOT_WORKING_SYNC_STATUSES].sort());
  });
});

/**
 * 167.1.2 REVIEW IN-03 — the note names the holder by its exchange's display
 * name. The note can fire for every venue that reports an account id, Deribit
 * included, and for MT5 through the login; a holder without a nickname then
 * read "deribit — ••••0001" while the other venues were capitalised. The names
 * are the ones EXCHANGE_DISPLAY (closed-sets.ts) carries.
 */
describe("accountShareNote — the holder's exchange is named by its display name on every venue", () => {
  it.each([
    ["binance", "Binance"],
    ["okx", "OKX"],
    ["bybit", "Bybit"],
    ["deribit", "Deribit"],
    ["sfox", "sFOX"],
    ["mt5", "MT5"],
  ])("%s → %s", (exchange, display) => {
    const holder = key({ exchange, label: "" });
    const dup = key({
      id: "dup-0002",
      exchange,
      account_shared_with_api_key_id: holder.id,
      account_share_kind: "duplicate",
    });
    expect(accountShareNote(dup, new Map([[holder.id, holder], [dup.id, dup]]))).toBe(
      `This key reads the same exchange account as ${display} — ••••0001. We count that account once.`,
    );
  });
});
