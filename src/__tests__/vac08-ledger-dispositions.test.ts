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
  /** The name AS THE GATE PARSES IT — trailing whitespace stripped, leading KEPT. */
  gateName: string;
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
      // ⛔ ADDED 2026-09-09. The GATE strips TRAILING whitespace only
      // (`sed 's/[[:space:]]*$//'`, test-ledger-drift-check.sh) while `name`
      // above trims BOTH ends. An indented entry therefore looks fine here and
      // matches nothing at the gate — reported at once as NEW drift AND as a
      // stale baseline line. This field is the gate's view, so the malformed
      // check below can see what the gate would.
      gateName: (hash === -1 ? raw : raw.slice(0, hash)).replace(/\s+$/, ""),
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
// ⛔ NARROWED 2026-09-09 after review measured this scanner 42% blind. `would`
// and `only` negate NOTHING and were dropped; they merely co-occurred.
const QUALIFIER = /\bnot\b|\bnever\b|\bcannot\b|\bmay not\b|\brefuses\b|\bunearned\b/i;

/**
 * The window still spans three lines because the header wraps mid-sentence, but
 * the qualifier must now sit in the SAME SENTENCE as the claim.
 *
 * ⛔ WHY, MEASURED: with a bare 3-line window, the paragraph heading
 * `⚠️ WHAT IT DOES NOT BUY…` spared a bare false claim inserted directly beneath
 * it — the prohibition's own `NOT` licensed the thing it forbids. 56 of 133
 * insertion points (42%) were spared that way. Adjacency is not negation:
 * prohibition prose and the forbidden phrase are NECESSARILY neighbours here,
 * so proximity is the one signal that cannot mean anything.
 */
export function unqualifiedStrongClaims(text: string): string[] {
  const lines = text.split("\n");
  return lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => STRONG_CLAIM.test(l))
    .filter(({ i }) => {
      const window = lines
        .slice(Math.max(0, i - 1), i + 2)
        .map((l) => l.replace(/^#\s?/, ""))
        .join(" ");
      const sentence = window
        .split(/(?<=\.)\s+/)
        .find((sent) => STRONG_CLAIM.test(sent));
      return !QUALIFIER.test(sentence ?? window);
    })
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

/**
 * Fixture for the malformed-name rule. One indented entry and one bare `#`-less
 * blank-name line. Kept SEPARATE from FIXTURE on purpose: FIXTURE's counts are
 * load-bearing for the disposition AIM, and re-tuning them to carry an unrelated
 * case is how a calibrated fixture quietly stops being calibrated.
 */
const MALFORMED_FIXTURE = [
  "# a header comment, not an entry",
  "20260301000000_clean  # fine.",
  "  20260302000000_leading_space  # indented; the gate would NOT match this.",
].join("\n");

/** The `[SEC]` disclosure rule, re-derived so it can be driven by a fixture. */
export function secEntriesMissingDisclosure(entries: Entry[]): string[] {
  return entries
    .filter((e) => e.reason.includes("[SEC]"))
    .filter((e) => !/never received (it|them)/i.test(e.reason))
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
    it("the malformed-name predicate sees what the GATE sees, not what trim() sees", () => {
      // Without this the malformed check is a dormant assertion whose classifier
      // no fixture ever drives — review found it was the one dormant arm with no
      // AIM behind it. `name` (.trim()) would call the indented entry clean;
      // `gateName` (trailing strip only, as the gate parses) must not.
      const m = rederive(MALFORMED_FIXTURE);
      expect(m.map((e) => e.name)).toEqual([
        "20260301000000_clean",
        "20260302000000_leading_space",
      ]);
      expect(m.filter((e) => e.gateName === "" || /\s/.test(e.gateName)).map((e) => e.gateName)).toEqual([
        "  20260302000000_leading_space",
      ]);
    });

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
    // ⛔ THIS IS THE ASSERTION THAT DISTINGUISHES THIS FILE FROM A BARE EMPTY ONE.
    //
    // ⛔ REWRITTEN 2026-09-09. The first cut asked only `text.includes(needle)`
    // over the WHOLE file, and review measured three ways to satisfy it while
    // gutting the record:
    //   * deleting the FOUNDER DECISION paragraph  -> still green
    //     ("founder decision" matched a 2026-08-30 sentence about hand-applies;
    //      the real line is uppercase and matched NOTHING)
    //   * deleting the restore-run bullet          -> still green
    //     (the run id occurs twice; the second is in the [SEC] paragraph)
    //   * rewriting the cause as a HAND-APPLY of 31 migrations to shared TEST,
    //     ids intact                               -> still green
    // The last one is the one that matters: the file could claim the exact act
    // its own header forbids in capitals, and nothing here objected.
    //
    // So the needles must now live INSIDE the 2026-09-08 block, and the CAUSE
    // is pinned explicitly rather than left to prose nobody checks.
    const startRe = /^# ⭐ 2026-09-08 — 31 -> 0/m;
    const startMatch = startRe.exec(text);
    expect(
      startMatch,
      "scripts/vac08-ledger-baseline.txt no longer opens its 2026-09-08 lineage " +
        "block. That block IS the record that the emptying was a reading; without " +
        "it the file is indistinguishable from a ratchet somebody simply deleted.",
    ).not.toBeNull();
    const after = text.slice(startMatch!.index);
    // The block ends at the next top-level ⚠️/⛔ heading.
    const nextHeading = /\n# [⚠⛔]/.exec(after);
    const block = nextHeading ? after.slice(0, nextHeading.index) : after;

    const required: Array<[RegExp, string]> = [
      [/BY RESTORE, NOT BY HAND-APPLY/, "THE CAUSE — the one claim this block exists to make"],
      [/34274355596/, "the restore run id that made the 31 entries present"],
      [/88581b8bc66415bfa86b7d5a019741b1cbd0ff49/, "the head sha the restore ran at"],
      [/34274161551/, "the CI run that MEASURED the 31 as no longer absent"],
      [/2026-09-08/, "the date of the founder decision"],
      [/founder decision/i, "the authority the removal rests on (case-insensitive: the real line is uppercase)"],
    ];
    const missing = required
      .filter(([re]) => !re.test(block))
      .map(([re, why]) => `${String(re)} (${why})`);
    expect(
      missing,
      "scripts/vac08-ledger-baseline.txt lost part of the lineage that justifies its " +
        "zero entries, or moved it OUT of the 2026-09-08 block. An empty ratchet whose " +
        "cause is not written down reads exactly like a deleted control — and an id " +
        "that merely appears somewhere else in the file is not a record of the cause.",
    ).toEqual([]);

    // The block must be substantial: a one-line stub carrying the ids satisfied
    // the old pin. Measured — that exact stub is what prompted this rewrite.
    expect(
      block.split("\n").length,
      "the 2026-09-08 lineage block shrank to a stub. The ids alone are not the record.",
    ).toBeGreaterThan(12);

    // The TODOS route for the OPEN general case lives outside the block.
    expect(text).toContain("DATA-DEPENDENT-MIGRATION-ESCAPE");
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
    const malformed = entries.filter((e) => e.gateName === "" || /\s/.test(e.gateName));
    expect(
      malformed.map((e) => `line ${e.line}: ${JSON.stringify(e.gateName)}`),
      "an entry name is empty or carries whitespace AS THE GATE PARSES IT. The gate " +
        "compares names verbatim, so such a line is reported simultaneously as NEW " +
        "drift and as a stale baseline entry — two failures with one cause.",
    ).toEqual([]);
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

    // ⛔ ADDED 2026-09-09. The disclosure rule was enforced ONLY against
    // SEC_FIXTURE and never against this file — measured: a [SEC] entry added
    // with no disclosure, with ENTRY_COUNT and SEC_ENTRIES updated exactly as a
    // maintainer would, passed 12/12. The AIM proves the classifier CAN
    // classify; only this line proves it is ever pointed at the real file.
    // Dormant at zero entries, like its neighbours — but now true rather than
    // aspirational on the day an entry returns.
    expect(
      secEntriesMissingDisclosure(entries),
      "a [SEC] entry on the baseline is missing the never-received-it disclosure. " +
        "A TEST-side test asserting that grant may be asserting it against a schema " +
        "that never received it, and the line has to say so.",
    ).toEqual([]);
  });

  it("the GATE still reads THIS file, and still cannot see dispositions", () => {
    // ⛔ ADDED 2026-09-09. This whole test file's rationale — "dispositions are
    // invisible to the gate, so a human-readable reason needs its own machine
    // check" — was PROSE ONLY. Two facts it depends on were asserted nowhere:
    //   * the gate's default baseline path. If it changes, this contract test
    //     polices an orphaned file and stays green forever.
    //   * the comment-stripping parse. If the gate ever starts READING
    //     dispositions, the independence rationale silently stops being true.
    // House precedent for pinning a sibling script's line: WR-04 in
    // src/__tests__/drift-check-scripts.test.ts.
    const gate = readFileSync(join(REPO_ROOT, "scripts", "test-ledger-drift-check.sh"), "utf8");
    expect(
      gate,
      "the VAC-08 gate no longer defaults to vac08-ledger-baseline.txt. This test " +
        "may now be policing a file the gate does not read.",
    ).toContain('${LEDGER_BASELINE_FILE:-$(dirname "$0")/vac08-ledger-baseline.txt}');
    expect(
      gate,
      "the VAC-08 gate no longer strips comments before comparing names. If it now " +
        "READS dispositions, this file's reason for existing has changed.",
    ).toContain(`sed 's/#.*//'`);
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
