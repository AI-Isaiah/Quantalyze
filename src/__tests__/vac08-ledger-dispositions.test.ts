/**
 * VAC-08 ledger baseline — DISPOSITION contract test (Phase 164.5 criterion 5,
 * re-cut at zero entries by Phase 164.8 Plan 04).
 *
 * WHY THIS FILE EXISTS. `scripts/vac08-ledger-baseline.txt` is a RATCHET of repo
 * migrations MEASURED absent from the TEST ledger. Every entry must carry a
 * trailing `# <reason>` naming what the migration does and why it has no ledger
 * row. Those reasons are INVISIBLE to the gate: `test-ledger-drift-check.sh`
 * pipes the file through a `sed` that deletes everything from the first `#`
 * onward BEFORE comparing names, so nothing in the VAC-08 run can ever notice a
 * missing disposition. A per-name review that no machine re-derives decays into
 * a one-time review — the exact defect class this phase exists to remove.
 *
 * So this test re-derives the disposition fact INDEPENDENTLY: its own regexes,
 * its own line split, deliberately NOT importing or shelling out to
 * `test-ledger-drift-check.sh`. A test that agreed with the gate by
 * construction would prove nothing about the file.
 *
 * ⛔ THE FILE NOW CARRIES ZERO ENTRIES (2026-09-08, restore run 34274355596),
 * WHICH CHANGES WHAT THIS TEST CAN AND CANNOT CATCH. Stated plainly, because an
 * empty-set assertion that nobody labelled is how a green suite starts lying:
 *
 *   LIVE — these can fail against the file as it stands today:
 *     * the AIM block (it drives `rederive` / `unqualifiedStrongClaims` over
 *       synthetic corpora whose answers are known and are NOT the empty set);
 *     * "the live file is MEASURED empty" — in the GREW direction, and it is
 *       gated by an inline AIM so a stopped classifier fails BEFORE the empty
 *       count is believed;
 *     * "the file states the reading the gate CAN print" (`0 NEW drift`);
 *     * "the file never ASSERTS the stronger reading" — the header deliberately
 *       still QUOTES the forbidden phrase in order to forbid it, so the scanner
 *       has a real subject to spare rather than an absent one to miss;
 *     * "the header carries the lineage that makes the emptiness a reading" —
 *       the assertion that distinguishes this file from a bare empty one.
 *
 *   DORMANT — cannot fail today, fire on the first entry that returns:
 *     * "every entry carries a trailing '#' disposition" (iterates zero rows);
 *     * "no entry name is empty or carries whitespace" (iterates zero rows);
 *     * the CLOSED-SET half of the [SEC] arm (zero marked entries today).
 *   Each is retained on purpose — deleting a guard to make a suite tidy is how
 *   the rule is lost — and each has its classifier proven live in the AIM block,
 *   so a `rederive` that silently stopped classifying reddens there rather than
 *   leaving these three green by accident.
 *
 *   INERT — one branch is now unreachable by arithmetic and is labelled at its
 *   site: the SHRANK half of the both-directions message, since `entries.length`
 *   cannot fall below `ENTRY_COUNT = 0`. It is reachable again the moment the
 *   pin is raised, and it was OBSERVED firing during this edit by setting the
 *   pin to 31 on a scratch copy.
 *
 * Storage pattern: floor-plus-contract-test, as in
 * `src/__tests__/mutation-runner-floors.test.ts`. AIM-first ordering as in
 * `src/__tests__/mutation-annotation-parser.test.ts` (the deliberately-empty
 * `lane-blocked` class).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "vac08-ledger-baseline.txt");

/**
 * PINNED COUNT — ZERO.
 *
 * It reached 0 from 31 on 2026-09-08, and the CAUSE is the whole reason this
 * number is allowed to be 0: restore run `34274355596` at head
 * `88581b8bc66415bfa86b7d5a019741b1cbd0ff49` rebuilt TEST's `public` schema from
 * the PROD dump and SEEDED its migration ledger with all 266 repo files, so all
 * 31 entries turned up PRESENT. CI run `34274161551` (same sha) then reported
 * `31 baseline entr(y/ies) are no longer MEASURED absent` and named every one —
 * this file's own MUST-ONLY-SHRINK rule firing. Deleting them obeyed the rule;
 * nothing was hand-applied to shared TEST.
 *
 * ⛔ This number may only go DOWN as a maintenance edit, and it is already at
 * the floor. RAISING it means new drift was baselined — a founder decision, and
 * it must be recorded in the baseline file's header FIRST.
 */
export const ENTRY_COUNT = 0;

/**
 * SECURITY migrations still on the list: NONE.
 *
 * Until 2026-09-08 this held three — `20260529150000_lock_profile_privileged_columns`,
 * `20260715120000_grant_anon_execute_current_user_has_app_role` and
 * `20260814120000_wizard_rpcs_revoke_authenticated` — each required to disclose,
 * on its own line, that a TEST-side test asserting those grants may be asserting
 * them against a schema that never received them. All three reached TEST's
 * ledger by restore run `34274355596`.
 *
 * ⛔ THE RULE OUTLIVED ITS SUBJECTS. The disclosure requirement is NOT deleted
 * with them: it is re-proven every run by the `[SEC]` AIM below, over a synthetic
 * corpus, so the day an entry returns carrying `[SEC]` the rule is enforced
 * rather than merely remembered.
 */
export const SEC_ENTRIES: readonly string[] = [];

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

/**
 * The AIM fixture. Four entries, two of them undispositioned, one `[SEC]` line
 * WITHOUT the required disclosure and one WITH it. Its answers are known and
 * none of them is the empty set — which is the whole point, because every
 * live-file assertion below now expects an empty set.
 */
const FIXTURE = [
  "# a header comment, not an entry",
  "#",
  "20260101000000_dispositioned  # does a thing; UNAPPLIED to TEST.",
  "20260102000000_undispositioned",
  "20260103000000_empty_comment  #   ",
  "",
  "20260104000000_also_dispositioned  # does another thing.",
].join("\n");

const SEC_FIXTURE = [
  "# a header comment, not an entry",
  "20260201000000_sec_without_disclosure  # [SEC] revokes a grant. UNAPPLIED to TEST.",
  "20260202000000_sec_with_disclosure  # [SEC] revokes a grant. UNAPPLIED to TEST. WARNING: a TEST-side test asserting this revoke may be asserting it against a schema that never received it.",
  "20260203000000_not_a_sec_entry  # widens a CHECK constraint. UNAPPLIED to TEST.",
].join("\n");

/** The `[SEC]` disclosure rule, re-derived so it can be driven by a fixture. */
export function secEntriesMissingDisclosure(entries: Entry[]): string[] {
  return entries
    .filter((e) => e.reason.includes("[SEC]"))
    .filter((e) => !e.reason.toLowerCase().includes("never received it"))
    .map((e) => e.name);
}

describe("VAC-08 ledger baseline — every entry is dispositioned by name", () => {
  // node:fs, never a shell grep: grep is silently NUL-blind in this repo.
  const text = readFileSync(BASELINE_PATH, "utf8");
  const entries = rederive(text);

  // ── AIM, DECLARED FIRST ────────────────────────────────────────────────────
  // Without this, every live-file assertion below is an empty-set expectation
  // over a file that satisfies it by being empty, and a `rederive` that quietly
  // stopped classifying would keep them all green. This drives the SAME
  // functions with synthetic corpora whose answers are known and NOT empty.
  //
  // It is declared BEFORE the live-file block on purpose (the ordering
  // `mutation-annotation-parser.test.ts` uses for its deliberately-empty
  // `lane-blocked` class): a reader of a failure report sees the classifier
  // break before they see the file's emptiness asserted.
  describe("AIM — the re-derivation actually classifies", () => {
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

    // ⛔ THE [SEC] RULE, RE-PROVEN WITHOUT ANY [SEC] SUBJECTS IN THE REAL FILE.
    // This replaces the per-name arm that ran over the three security entries
    // until 2026-09-08. Those entries are gone; the rule they enforced is not.
    // A synthetic corpus is the ONLY way to keep it falsifiable at zero entries.
    it("flags a [SEC] entry that omits the never-received-it disclosure, and spares one that carries it", () => {
      const secEntries = rederive(SEC_FIXTURE);
      expect(
        secEntries.filter((e) => e.reason.includes("[SEC]")).map((e) => e.name),
        "the [SEC] marker itself stopped being detected",
      ).toEqual([
        "20260201000000_sec_without_disclosure",
        "20260202000000_sec_with_disclosure",
      ]);
      expect(
        secEntriesMissingDisclosure(secEntries),
        "the disclosure rule stopped discriminating: it must flag EXACTLY the [SEC] line " +
          "that omits 'never received it', and spare both the compliant [SEC] line and the " +
          "non-[SEC] line",
      ).toEqual(["20260201000000_sec_without_disclosure"]);
    });

    // The strong-claim scan below returns [] against a file that only QUOTES the
    // phrase in order to forbid it. Same trap: an empty result proves nothing
    // unless the scanner is shown catching one.
    it("the strong-claim scan flags a BARE assertion and spares a qualified one", () => {
      const bare = "VAC-08 now reports zero unledgered migrations after this change.";
      expect(unqualifiedStrongClaims(bare)).toEqual([
        "line 1: VAC-08 now reports zero unledgered migrations after this change.",
      ]);

      const qualified = [
        "That is 0 NEW drift with the ledger seeded. It is NOT",
        '"zero unledgered migrations", and no prose may upgrade it to that.',
      ].join("\n");
      expect(unqualifiedStrongClaims(qualified)).toEqual([]);
    });
  });

  // ── THE LIVE FILE, ONLY AFTER THE AIM ──────────────────────────────────────

  it("the live file is MEASURED empty — beside the AIM above, in BOTH directions", () => {
    // (a) THE AIM, INLINE AND FIRST. `expect(entries.length).toBe(0)` on a
    // corpus that a broken `rederive` reports as empty is indistinguishable from
    // the same assertion on a genuinely empty file. So the classifier must be
    // shown producing a NON-empty answer here, before the count below is
    // believed. This duplicates the AIM block above deliberately: the ordering
    // guarantee has to hold inside the assertion, not merely in the file.
    expect(
      rederive(FIXTURE).map((e) => e.name),
      "rederive() stopped classifying — the emptiness of the live file below is " +
        "therefore unproven, whatever it reports",
    ).toHaveLength(4);

    // (b) AND ONLY THEN the live file. MEASURED 0 as of 2026-09-08 (restore run
    // 34274355596; CI run 34274161551 named all 31 stale lines, which were then
    // deleted).
    //
    // ⚠️ INERT BRANCH, LABELLED: with ENTRY_COUNT at 0 the SHRANK arm is
    // unreachable — a length cannot fall below zero. It is kept because it
    // becomes reachable the instant the pin is raised, and it was OBSERVED
    // firing during the 164.8-04 edit by setting the pin to 31 on a scratch
    // copy of this file (message: `SHRANK to 0`). The GREW arm is live today.
    const direction =
      entries.length > ENTRY_COUNT
        ? `GREW to ${entries.length}: an entry was added — that is a founder decision; record it in the baseline file's header FIRST, then raise the pin deliberately`
        : `SHRANK to ${entries.length}: a migration reached TEST — record the cause in the file header, then lower the pin`;
    expect(
      entries.length,
      entries.length === ENTRY_COUNT ? "" : `ENTRY_COUNT pin is ${ENTRY_COUNT} but the file ${direction}`,
    ).toBe(ENTRY_COUNT);
  });

  it("the header carries the lineage that makes the emptiness a READING, not a default", () => {
    // ⛔ THIS IS THE ASSERTION THAT DISTINGUISHES THIS FILE FROM A BARE EMPTY
    // ONE, and it is LIVE — gutting the header reddens here even though every
    // entry-level check above would stay green over zero rows. A ratchet emptied
    // without its cause recorded is the mute button the file's own header
    // forbids, and "the file is empty" cannot by itself tell the two apart.
    const required: Array<[string, string]> = [
      ["MUST ONLY SHRINK", "the ratchet contract itself"],
      ["34274355596", "the restore run id that made the 31 entries present"],
      [
        "88581b8bc66415bfa86b7d5a019741b1cbd0ff49",
        "the head sha that restore ran at",
      ],
      ["34274161551", "the CI run that MEASURED the 31 as no longer absent"],
      ["2026-09-08", "the date of the founder decision to empty the ratchet"],
      ["founder decision", "the authority the removal rests on"],
      [
        "DATA-DEPENDENT-MIGRATION-ESCAPE",
        "the TODOS route for the OPEN general case (a migration that cannot reach TEST)",
      ],
    ];
    const missing = required
      .filter(([needle]) => !text.includes(needle))
      .map(([needle, why]) => `${JSON.stringify(needle)} (${why})`);
    expect(
      missing,
      "scripts/vac08-ledger-baseline.txt lost part of the lineage that justifies its " +
        "zero entries. An empty ratchet whose cause is not written down reads exactly " +
        "like a deleted control.",
    ).toEqual([]);
  });

  it("every entry carries a trailing '#' disposition with non-empty prose", () => {
    // DORMANT at zero entries: iterates nothing. Retained because it is the ONLY
    // check that can see an undispositioned addition — the gate strips comments
    // before comparing, so VAC-08 itself is blind to it. Its classifier is
    // proven live by the AIM above.
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
    // DORMANT at zero entries; fires on the first malformed addition.
    const malformed = entries.filter((e) => e.name === "" || /\s/.test(e.name));
    expect(malformed.map((e) => `line ${e.line}: ${JSON.stringify(e.name)}`)).toEqual([]);
  });

  it("the [SEC] marker set on the live file is CLOSED and matches SEC_ENTRIES", () => {
    // DORMANT at zero entries: both sides are empty today. It is the stale-pin
    // detector for SEC_ENTRIES — a [SEC] line re-added without updating the
    // constant must be NOTICED rather than absorbed. The disclosure RULE those
    // entries were subject to is enforced by the AIM above, not here, precisely
    // so it does not go quiet with its subjects.
    const marked = entries.filter((e) => e.reason.includes("[SEC]")).map((e) => e.name);
    expect(
      marked.sort(),
      "a [SEC] entry is on the baseline but not in SEC_ENTRIES (or vice versa). " +
        "Re-adding a security migration to the ratchet is a founder decision: record it " +
        "in the file header, add the never-received-it disclosure to its line, and list " +
        "it here.",
    ).toEqual([...SEC_ENTRIES].sort());

    // Non-vacuity in the other direction: every name in SEC_ENTRIES must still
    // BE on the baseline. At zero this iterates nothing; it fires the moment the
    // constant and the file disagree.
    for (const name of SEC_ENTRIES) {
      expect(
        entries.find((e) => e.name === name),
        `${name} is in SEC_ENTRIES but missing from the baseline`,
      ).toBeDefined();
    }
  });

  it("the file states the reading the gate CAN print", () => {
    // LIVE. P-01, positive half. VAC-08's own success line is
    // `ledger presence: 0 absent, all 0 baselined (…); 0 NEW drift.` and the
    // header has to say so, or the honest reading lives only in a plan nobody
    // opens again.
    expect(text).toContain("0 NEW drift");
  });

  it("the file never ASSERTS the stronger reading the gate cannot print", () => {
    // LIVE, and deliberately kept with a real subject. The 266 ledger rows were
    // SEEDED from the repo file set, not produced by executing 266 migrations
    // against TEST, so "zero unledgered migrations" in the EXECUTION sense is
    // still unearned. The header quotes the phrase in order to FORBID it — which
    // means this scan has something to spare, rather than scanning for a subject
    // that is simply absent. A bare line match is not the test; see the window.
    expect(unqualifiedStrongClaims(text)).toEqual([]);
  });
});
