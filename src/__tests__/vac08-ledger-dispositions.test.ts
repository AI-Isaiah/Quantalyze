/**
 * VAC-08 ledger baseline — DISPOSITION contract test (Phase 164.5 criterion 5).
 *
 * WHY THIS FILE EXISTS. `scripts/vac08-ledger-baseline.txt` carries 31 repo
 * migrations MEASURED absent from the TEST ledger, each now annotated with a
 * trailing `# <reason>` naming what the migration does and why it has no ledger
 * row. Those reasons are INVISIBLE to the gate: `test-ledger-drift-check.sh`
 * pipes the file through a `sed` that deletes everything from the first `#`
 * onward BEFORE comparing names, so nothing in the
 * VAC-08 run can ever notice a missing disposition. A per-name review that no
 * machine re-derives decays into a one-time review — the exact defect class
 * this phase exists to remove.
 *
 * So this test re-derives the disposition fact INDEPENDENTLY: its own regexes,
 * its own line split, deliberately NOT importing or shelling out to
 * `test-ledger-drift-check.sh`. A test that agreed with the gate by
 * construction would prove nothing about the file.
 *
 * It fails in BOTH directions:
 *   - an entry added WITHOUT a disposition          → the annotation decayed
 *   - the entry count drifts from the pinned integer → the pin is stale
 *
 * ⚠️ ANTI-VACUITY. A pin over a file that already satisfies it can silently
 * degrade into an assertion that cannot fail. The AIM block below runs the SAME
 * re-derivation over a synthetic in-memory corpus holding one dispositioned and
 * one undispositioned line, and asserts it flags exactly the undispositioned
 * one. If the classifier ever stops classifying, that block goes red even
 * though the real file is clean.
 *
 * Storage pattern: floor-plus-contract-test, as in
 * `src/__tests__/mutation-runner-floors.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "vac08-ledger-baseline.txt");

/**
 * PINNED COUNT. 31 migrations are carried by name. It reached 31 from 32 on
 * 2026-09-07 when `20260823120000_revoke_api_keys_insert` was applied to TEST
 * on founder instruction and its line was deleted — the only line ever removed
 * by an apply. This number may only go DOWN, and only alongside a deletion
 * recorded in the file's header. Raising it means new drift was baselined,
 * which is a decision, not a maintenance edit.
 */
export const ENTRY_COUNT = 31;

/**
 * SECURITY migrations still on the list. Each must disclose, on its own line,
 * that a TEST-side test asserting its grants may be asserting them against a
 * schema that never received them.
 */
export const SEC_ENTRIES = [
  "20260529150000_lock_profile_privileged_columns",
  "20260715120000_grant_anon_execute_current_user_has_app_role",
  "20260814120000_wizard_rpcs_revoke_authenticated",
] as const;

/**
 * Independent re-derivation. These regexes are written out again ON PURPOSE:
 * the gate's own parse is a `sed` pipeline in a shell script, and re-using it
 * (or importing it) would make this test agree with the gate by construction.
 *
 * An ENTRY is a line that does not start with `#` and is not blank. A
 * DISPOSITION is a `#` after the name, followed by at least one non-whitespace
 * character — `foo #` and `foo #   ` are undispositioned, not dispositioned.
 */
const COMMENT_LINE = /^[ \t]*#/;
const BLANK_LINE = /^[ \t]*$/;
const DISPOSITION = /#[ \t]*\S/;

export interface Entry {
  /** 1-based line number in the source text. */
  line: number;
  /** Everything before the first `#`, trimmed — the gate's effective name. */
  name: string;
  /** Everything after the first `#`, trimmed. Empty when undispositioned. */
  reason: string;
  dispositioned: boolean;
}

/** The re-derivation, over TEXT, so the AIM block can drive it with a fixture. */
export function rederive(text: string): Entry[] {
  const out: Entry[] = [];
  text.split("\n").forEach((raw, i) => {
    if (COMMENT_LINE.test(raw) || BLANK_LINE.test(raw)) return;
    const hash = raw.indexOf("#");
    out.push({
      line: i + 1,
      name: (hash === -1 ? raw : raw.slice(0, hash)).trim(),
      reason: hash === -1 ? "" : raw.slice(hash + 1).trim(),
      dispositioned: DISPOSITION.test(raw),
    });
  });
  return out;
}

/**
 * The forbidden claim, and the qualifier that makes an occurrence legitimate.
 *
 * ⚠️ THE WINDOW IS NOT DECORATION — it was forced by measurement. A first cut
 * scanned ONE line for both the phrase and a negation, and went red on the
 * file's own prohibition, whose "It is NOT" sits at the end of the PREVIOUS
 * line because the paragraph wraps. A one-line scan cannot read a wrapped
 * sentence, so the window spans the matching line and its two neighbours.
 */
const STRONG_CLAIM = /zero unledgered migrations/i;
const QUALIFIER = /\bnot\b|\bnever\b|\bcannot\b|\bmay not\b|\bwould\b|\bonly\b/i;

/** Occurrences of the strong claim with no negation anywhere in their window. */
export function unqualifiedStrongClaims(text: string): string[] {
  const lines = text.split("\n");
  return lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => STRONG_CLAIM.test(l))
    .filter(({ i }) => !QUALIFIER.test(lines.slice(Math.max(0, i - 1), i + 2).join(" ")))
    .map(({ i, l }) => `line ${i + 1}: ${l.trim()}`);
}

describe("VAC-08 ledger baseline — every entry is dispositioned by name", () => {
  // node:fs, never a shell grep: grep is silently NUL-blind in this repo.
  const text = readFileSync(BASELINE_PATH, "utf8");
  const entries = rederive(text);

  it("the entry count matches the pinned integer, in BOTH directions", () => {
    // Stale-low (an entry was baselined without moving the pin) and stale-high
    // (an entry was deleted without recording it) are both failures here. The
    // message names which way it moved so the reader is not sent hunting.
    const direction =
      entries.length > ENTRY_COUNT
        ? `GREW to ${entries.length}: new drift was baselined — that is a decision, record it in the file header and move the pin deliberately`
        : `SHRANK to ${entries.length}: a migration reached TEST — record the apply in the file header, then lower the pin`;
    expect(
      entries.length,
      entries.length === ENTRY_COUNT ? "" : `ENTRY_COUNT pin is ${ENTRY_COUNT} but the file ${direction}`,
    ).toBe(ENTRY_COUNT);
  });

  it("every entry carries a trailing '#' disposition with non-empty prose", () => {
    const undispositioned = entries.filter((e) => !e.dispositioned);
    expect(
      undispositioned.map((e) => `line ${e.line}: ${e.name}`),
      "an entry was added to the VAC-08 ledger baseline with no disposition. " +
        "The gate CANNOT see this — it strips comments before comparing — so " +
        "this test is the only thing that can. Append `  # <what the migration " +
        "does, and why it has no TEST ledger row>`.",
    ).toEqual([]);
  });

  it("no entry name is empty or carries whitespace (the gate compares names verbatim)", () => {
    const malformed = entries.filter((e) => e.name === "" || /\s/.test(e.name));
    expect(malformed.map((e) => `line ${e.line}: ${JSON.stringify(e.name)}`)).toEqual([]);
  });

  it("the three SECURITY entries are marked [SEC] and disclose the never-received-it risk", () => {
    // ⛔ These are the ones where an absent apply is not merely bookkeeping: a
    // TEST-side RLS/grant assertion could be passing against a schema that
    // never received the grant. The disclosure lives on the line, where a
    // reader of that entry sees it, not only in the header.
    for (const name of SEC_ENTRIES) {
      const entry = entries.find((e) => e.name === name);
      expect(entry, `${name} is missing from the baseline`).toBeDefined();
      expect(entry!.reason, `${name} is not marked [SEC]`).toContain("[SEC]");
      expect(
        entry!.reason.toLowerCase(),
        `${name}'s disposition does not disclose that a test may be asserting this against a schema that never received it`,
      ).toContain("never received it");
    }
    // The marker set is CLOSED: a fourth [SEC] line means the class grew and
    // SEC_ENTRIES went stale, which must be noticed rather than absorbed.
    const marked = entries.filter((e) => e.reason.includes("[SEC]")).map((e) => e.name);
    expect(marked.sort()).toEqual([...SEC_ENTRIES].sort());
  });

  it("the file states the reading the gate CAN print", () => {
    // P-01, positive half. Dispositioning yields `0 NEW drift` — the exact
    // wording of the gate's own success line — and the header has to say so,
    // or the honest reading lives only in a plan nobody opens again.
    expect(text).toContain("0 NEW drift");
  });

  it("the file never ASSERTS the stronger reading the gate cannot print", () => {
    // P-01, negative half. Only applying the 31 to shared TEST would earn
    // "zero unledgered migrations", and that is a founder decision reserved by
    // [VAC08-LEDGER-32]. The file legitimately QUOTES the phrase in order to
    // FORBID it, so a bare line match is not the test — see the window below.
    expect(unqualifiedStrongClaims(text)).toEqual([]);
  });

  // ── AIM ────────────────────────────────────────────────────────────────────
  // Without this, every assertion above is a pin over a file that already
  // satisfies it, and a `rederive` that quietly stopped classifying would keep
  // them all green. This drives the SAME function with a synthetic corpus whose
  // answer is known and NOT the empty set.
  describe("AIM — the re-derivation actually classifies", () => {
    const FIXTURE = [
      "# a header comment, not an entry",
      "#",
      "20260101000000_dispositioned  # does a thing; UNAPPLIED to TEST.",
      "20260102000000_undispositioned",
      "20260103000000_empty_comment  #   ",
      "",
      "20260104000000_also_dispositioned  # does another thing.",
    ].join("\n");

    it("finds exactly the four entries, ignoring comments and blanks", () => {
      expect(rederive(FIXTURE).map((e) => e.name)).toEqual([
        "20260101000000_dispositioned",
        "20260102000000_undispositioned",
        "20260103000000_empty_comment",
        "20260104000000_also_dispositioned",
      ]);
    });

    it("flags exactly the undispositioned entries — including a '#' with no prose", () => {
      const flagged = rederive(FIXTURE)
        .filter((e) => !e.dispositioned)
        .map((e) => e.name);
      expect(flagged).toEqual([
        "20260102000000_undispositioned",
        "20260103000000_empty_comment",
      ]);
    });

    it("reads the name as the text BEFORE the '#', exactly as the gate's sed does", () => {
      const [first] = rederive("20260101000000_x  # reason\n");
      expect(first.name).toBe("20260101000000_x");
      expect(first.reason).toBe("reason");
    });

    // The strong-claim scan above returns [] on the real file. Same trap: an
    // empty result proves nothing unless the scanner is shown catching one.
    it("the strong-claim scan flags a BARE assertion and spares a qualified one", () => {
      const bare = "VAC-08 now reports zero unledgered migrations after this change.";
      expect(unqualifiedStrongClaims(bare)).toEqual([
        "line 1: VAC-08 now reports zero unledgered migrations after this change.",
      ]);

      const qualified = [
        "That is 0 NEW drift with 31 named dispositions. It is NOT",
        '"zero unledgered migrations", and no prose may upgrade it to that.',
      ].join("\n");
      expect(unqualifiedStrongClaims(qualified)).toEqual([]);
    });
  });
});
