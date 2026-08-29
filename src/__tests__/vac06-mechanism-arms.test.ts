/**
 * VAC-06 — the five demonstrated vacuity mechanisms must STAY demonstrable.
 *
 * The demonstrations themselves live in
 *   scripts/mutation-runner/VAC06-DEMOS.md
 * where each of the five mechanisms from the ROADMAP's Phase 164.3 table
 * (:473-479) was re-introduced into the real phase-164 corpus and observed
 * caught, with verbatim detector output.
 *
 * ⛔ WHY THAT PATH AND NOT THE PHASE DIRECTORY (CR-01, 2026-08-29). The record
 * was originally written to
 * `.planning/phases/164.3-…/164.3-VAC06-DEMOS.md`, and this file asserted its
 * existence. That coupling was itself a control that fails for the wrong
 * reason: this test ships in a `src/`-only commit while the record shipped in a
 * `.planning/phases/**` commit, and TWO mandated workflows separate them —
 * `/gsd-pr-branch` (which CLAUDE.md makes non-optional before every PR) DROPS
 * `.planning/phases/**` commits, and `/gsd-complete-milestone` RELOCATES the
 * phase directory into `.planning/milestones/v{X.Y}-phases/`. Either one turns
 * the required `frontend` check red for a reason the change under test did not
 * cause, and the standard remedy for that — tolerating absence — would convert
 * the pin into a no-op. MEASURED before the move: hiding the record made this
 * file fail 2 of 10 with `… /164.3-VAC06-DEMOS.md is missing` and an ENOENT.
 * The record now lives beside its subject, in a normal source path that both
 * workflows preserve, so the assertion can stay unconditional.
 *
 * WHY THIS FILE EXISTS. A demonstration recorded once is a claim; what makes it
 * a control is that something re-proves it without a human. Two things do:
 *
 *   1. the `sql-mutation` CI job, which executes all 30 annotated arms — four of
 *      which are the demo arms — on every push, and exits 1 if any stops biting;
 *   2. this file, which pins that each demo mechanism still HAS its anchor in the
 *      corpus. Deleting or renaming a demo arm's `RED-UNDER-M` annotation would
 *      otherwise remove it from the runner's corpus silently: the runner only
 *      tests arms that are annotated, so an un-annotated arm is not a failing
 *      arm, it is an absent one. `ARMS_FLOOR` catches the count; this catches
 *      the IDENTITY, which is what the demonstrations are about.
 *
 * ⛔ Threat T-164.3-24 in the plan-10 threat register is exactly this: "demos
 * recorded once then silently rotting". A record nobody compares to the thing is
 * this phase's own subject matter.
 *
 * Regexes are written out again here on purpose rather than imported from
 * `parse.mjs` — a pin that agrees with the parser by construction proves nothing
 * about the corpus. Files are read with node:fs, never shell grep, because this
 * repo has a measured NUL-blind file where a bare grep's exit 1 reads as "clean".
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE = join(REPO_ROOT, "supabase", "tests", "test_strategy_shares_rls.sql");
const DEMOS = join(REPO_ROOT, "scripts", "mutation-runner", "VAC06-DEMOS.md");
const FIXTURES = join(REPO_ROOT, "scripts", "lint-sql-gates-fixtures");

/** Line-start anchored, per GRAMMAR.md rule 1. `RED-UNDER:` never matches this. */
const TWIN = /^[ \t]*--[ \t]*RED-UNDER-M:[ \t]*(\{.*\})[ \t]*$/;

/** The comment-strip idiom mechanism 2 defeats when it is absent. */
const COMMENT_STRIP = "regexp_replace(pg_get_functiondef(p.oid), '--[^\\n]*', '', 'g')";
const COMMENT_STRIP_SITES = 3;

type Anchor =
  | { kind: "arm"; arm: string }
  | { kind: "idiom"; needle: string; sites: number; fixtures: string[] };

interface Mechanism {
  n: number;
  what: string;
  detector: string;
  anchor: Anchor;
  /** Strings the DEMOS record must still contain, so doc and corpus cannot drift apart. */
  docNeedles: string[];
  /**
   * Arm IDs the demonstration depends on being present in the GATE FILE as a
   * live `RAISE … 'TEST FAILED (<id>)'` site, distinct from the arm the
   * mechanism was demonstrated against.
   *
   * These are the demonstration's *neighbours*: mechanism 4's is the arm whose
   * remaining terms a narrowed bitmask still satisfies, and mechanism 5's is
   * the EARLIER arm that makes the demonstrated one structurally unreachable.
   * Without the neighbour, the demonstration is not reproducible — and the
   * neighbour's presence is a fact about the corpus, so it is asserted against
   * the corpus rather than against the prose record.
   */
  companionArms?: string[];
}

/**
 * The five mechanisms and the artifact each demonstration hangs on.
 * ⚠️ Editing this list is editing what VAC-06 claims. It is the plan-10 SUMMARY's
 * mechanism -> arm table in machine-readable form.
 */
const MECHANISMS: Mechanism[] = [
  {
    n: 1,
    what: "post-rejection probe inside a PL/pgSQL BEGIN...EXCEPTION",
    detector: "mutation runner (no-red)",
    anchor: { kind: "arm", arm: "TENANT 5b" },
    docNeedles: ["TENANT 5b", "no-red"],
  },
  {
    n: 2,
    what: "pg_get_functiondef regex satisfied by an in-body -- comment",
    // No runner arm: this mechanism defeats a TEXT-MATCHING arm, and the repaired
    // idiom is a normalizer rather than an arm, so the anchor is the idiom itself.
    detector: "linter R2 + the D-05 normalizer",
    anchor: {
      kind: "idiom",
      needle: COMMENT_STRIP,
      sites: COMMENT_STRIP_SITES,
      fixtures: [
        "R2-functiondef-comment-strip.red.sql",
        "R2-functiondef-comment-strip.green.sql",
      ],
    },
    docNeedles: ["R2-functiondef-comment-strip", "regexp_replace"],
  },
  {
    n: 3,
    what: "a diagnostic computing pre + 1, overflowing in the state it diagnoses",
    detector: "mutation runner (wrong-first-failure, no-identity)",
    anchor: { kind: "arm", arm: "N1 3a" },
    docNeedles: ["N1 3a", "wrong-first-failure"],
  },
  {
    n: 4,
    what: "partial bitmask — a narrowed trigger satisfies every remaining term",
    detector: "mutation runner (wrong-first-failure)",
    anchor: { kind: "arm", arm: "SHAPE 5" },
    docNeedles: ["SHAPE 5", "wrong-first-failure", "N1 2a"],
    companionArms: ["N1 2a"],
  },
  {
    n: 5,
    what: "an arm made structurally unreachable; the reachable one reports the opposite",
    // ⛔ D-16: no lint rule exists or may exist for this one. The runner's
    // first-failure identity is its ONLY detector, which is why this arm's
    // annotation going missing would leave mechanism 5 with no coverage at all.
    detector: "mutation runner first-failure identity ONLY (D-16)",
    anchor: { kind: "arm", arm: "SANITIZE 1e" },
    docNeedles: ["SANITIZE 1e", "SANITIZE 1c", "wrong-first-failure"],
    companionArms: ["SANITIZE 1c"],
  },
];

/**
 * Every arm ID carried by a line-start-anchored structured twin in the gate file.
 * A malformed twin is collected rather than skipped: silently dropping one would
 * let a broken annotation read as an absent arm, which is the wrong diagnosis.
 */
function readTwins(): { arms: string[]; malformed: string[] } {
  const arms: string[] = [];
  const malformed: string[] = [];
  const lines = readFileSync(GATE, "utf8").split("\n");
  for (const line of lines) {
    const match = TWIN.exec(line);
    if (match === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      malformed.push(line.trim().slice(0, 120));
      continue;
    }
    const arm = (parsed as { arm?: unknown }).arm;
    if (typeof arm === "string" && arm.length > 0) arms.push(arm);
    else malformed.push(line.trim().slice(0, 120));
  }
  return { arms, malformed };
}

describe("VAC-06 — non-vacuity of this file's own premises", () => {
  it("finds the gate file and a non-empty set of structured twins", () => {
    // Without this, every "the corpus still carries arm X" assertion below could
    // be satisfied by a missing file or an empty list rather than by the corpus.
    expect(existsSync(GATE), `${GATE} is missing`).toBe(true);
    const { arms, malformed } = readTwins();
    expect(malformed, `malformed RED-UNDER-M line(s): ${malformed.join(" | ")}`).toEqual([]);
    expect(arms.length).toBeGreaterThan(0);
  });

  it("pins five DISTINCT mechanisms — a duplicated anchor would look complete and cover four", () => {
    expect(MECHANISMS).toHaveLength(5);
    expect(MECHANISMS.map((m) => m.n)).toEqual([1, 2, 3, 4, 5]);
    const armIds = MECHANISMS.filter((m) => m.anchor.kind === "arm").map((m) =>
      m.anchor.kind === "arm" ? m.anchor.arm : "",
    );
    expect(new Set(armIds).size).toBe(armIds.length);
  });
});

describe("VAC-06 — each demonstrated mechanism keeps its anchor in the corpus", () => {
  for (const mech of MECHANISMS) {
    if (mech.anchor.kind === "arm") {
      const { arm } = mech.anchor;
      it(`mechanism ${mech.n} (${mech.what}): "${arm}" still carries a line-start RED-UNDER-M twin`, () => {
        const { arms } = readTwins();
        expect(
          arms,
          `The VAC-06 demonstration for mechanism ${mech.n} was performed against arm "${arm}", whose detector is ${mech.detector}. ` +
            `That arm no longer has a line-start-anchored RED-UNDER-M annotation in supabase/tests/test_strategy_shares_rls.sql, ` +
            `so the runner no longer tests it and the demonstration in VAC06-DEMOS.md is no longer re-provable on every push. ` +
            `Restore the annotation, or re-do the demonstration against a different arm and update BOTH this list and the DEMOS record.`,
        ).toContain(arm);
      });
    } else {
      const { needle, sites, fixtures } = mech.anchor;
      it(`mechanism ${mech.n} (${mech.what}): the comment-strip idiom survives at all ${sites} sites`, () => {
        const text = readFileSync(GATE, "utf8");
        const found = text.split(needle).length - 1;
        expect(
          found,
          `The VAC-06 demonstration for mechanism ${mech.n} deletes this idiom and observes linter R2 fire at every downstream match site. ` +
            `It is present ${found}x, expected ${sites}x. Fewer means the repaired idiom was removed from the corpus (the live defect, not a stale pin); ` +
            `more means the corpus grew a site and the DEMOS record's site list is stale.`,
        ).toBe(sites);
      });

      it(`mechanism ${mech.n}: its red/green linter fixture pair still exists`, () => {
        // R2 has no runner arm, so its fixtures are the only thing keeping the
        // rule provably able to fire once this demonstration scrolls out of view.
        for (const fixture of fixtures) {
          expect(existsSync(join(FIXTURES, fixture)), `${fixture} is missing`).toBe(true);
        }
      });
    }

    for (const companion of mech.companionArms ?? []) {
      it(`mechanism ${mech.n}: its companion arm "${companion}" still raises in the gate file`, () => {
        // Asserted against the CORPUS, not against the prose record: the
        // neighbour arm's existence is a fact about
        // supabase/tests/test_strategy_shares_rls.sql, and a fact about the
        // corpus that is only pinned in a markdown file is a claim.
        const text = readFileSync(GATE, "utf8");
        const needle = `TEST FAILED (${companion})`;
        expect(
          text.split(needle).length - 1,
          `The VAC-06 demonstration for mechanism ${mech.n} is only reproducible while arm "${companion}" ` +
            `still raises in supabase/tests/test_strategy_shares_rls.sql — it is the neighbour the mechanism acts through ` +
            `(${mech.n === 5 ? "the EARLIER arm that makes the demonstrated one unreachable" : "the arm a narrowed bitmask still satisfies"}). ` +
            `Expected exactly one '${needle}' raise site. If the arm was renamed or removed, re-do the demonstration and update BOTH this list and VAC06-DEMOS.md.`,
        ).toBe(1);
      });
    }
  }
});

describe("VAC-06 — the demonstration record and the corpus cannot drift apart", () => {
  it("keeps the record on a DURABLE path — not under .planning/phases/ (CR-01)", () => {
    // The assertions below are unconditional on purpose. That is only safe
    // while the record lives somewhere both `/gsd-pr-branch` and
    // `/gsd-complete-milestone` preserve. Re-homing it under
    // `.planning/phases/**` would make this whole describe block fail on a
    // state neither the code nor the corpus caused — and the tempting remedy
    // for that (skip when absent) is the defect this phase exists to remove.
    const rel = DEMOS.slice(REPO_ROOT.length + 1).split("\\").join("/");
    expect(
      rel.startsWith(".planning/"),
      `VAC06-DEMOS.md must not live under .planning/ — it is asserted unconditionally below, and ` +
        `/gsd-pr-branch drops .planning/phases/** commits while /gsd-complete-milestone relocates the phase dir. ` +
        `Current path: ${rel}`,
    ).toBe(false);
    expect(existsSync(DEMOS), `${rel} is missing`).toBe(true);
  });

  it("documents exactly five mechanisms, numbered 1 to 5", () => {
    expect(existsSync(DEMOS), `${DEMOS} is missing`).toBe(true);
    const headings = readFileSync(DEMOS, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("## Mechanism "));
    expect(
      headings,
      "VAC06-DEMOS.md must carry one '## Mechanism N' section per mechanism. " +
        "A mechanism dropped from the record is a mechanism nobody can re-verify.",
    ).toHaveLength(5);
    for (const mech of MECHANISMS) {
      expect(headings.filter((h) => h.startsWith(`## Mechanism ${mech.n} `))).toHaveLength(1);
    }
  });

  it("still names each mechanism's anchor and the defect kind that caught it", () => {
    const doc = readFileSync(DEMOS, "utf8");
    for (const mech of MECHANISMS) {
      for (const needle of mech.docNeedles) {
        expect(
          doc.includes(needle),
          `VAC06-DEMOS.md no longer mentions "${needle}" for mechanism ${mech.n}. ` +
            `The record must keep naming the arm/fixture it was measured against and the defect kind that caught it, ` +
            `or it stops being evidence a verifier can re-execute.`,
        ).toBe(true);
      }
    }
  });
});
