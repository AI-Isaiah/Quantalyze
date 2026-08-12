import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Phase 154 / WIZCONT-01 — the wizard-draft query is SINGLE-SOURCED.
 *
 * INVARIANT (the CONTEXT.md locked criterion): "One query shape, two callers —
 * a second divergent shape is how the two paths drift apart." The SSR page
 * `/strategies/new/wizard` and the overlay's route handler
 * `/api/strategies/wizard-draft` must BOTH obtain the caller's latest wizard
 * draft through `src/lib/wizard/draft-query.ts`. A third hand-rolled copy —
 * added to the overlay, to a future server action, to a cron — is how the
 * columns, the ordering, or the CSV-vs-composite discriminator silently fork
 * between the two entry points, which is the WIZCONT-01 defect itself.
 *
 * ── HOW THE HEURISTIC WORKS ─────────────────────────────────────────────────
 *
 * Scan A (broad tripwire): a non-test `src/` file is an OFFENDER when it
 *   carries BOTH `.eq("source", "wizard")` AND `.eq("status", "draft")` — the
 *   wizard-draft predicate pair — unless it is on the allow-list below. This is
 *   deliberately broad: any new touch of wizard-draft rows must be a conscious
 *   decision recorded here, not an accident.
 *
 * Scan B (the sharp edge): among those, the files carrying the full LATEST-READ
 *   shape (the pair + `.order("created_at", { ascending: false })` + `.limit(1)`)
 *   are pinned as a FROZEN SET. Scan A can be satisfied by adding a name to the
 *   allow-list; Scan B additionally forces whoever does that to state that they
 *   are adding a second *latest-draft read*, which is the thing this phase
 *   exists to prevent.
 *
 * GREP-GATE HYGIENE: the predicates below match CODE (the `.eq(...)` call
 * shapes), never a filename. A guard that matched its own allow-list strings
 * would report agreement even if the query moved. The allow-list is applied by
 * comparing resolved PATHS, after the regexes have spoken.
 *
 * ── THE ALLOW-LIST, AND WHY EACH ENTRY IS ON IT ─────────────────────────────
 *
 *  1. `src/lib/wizard/draft-query.ts` — THE sanctioned read. Both wizard entry
 *     points import it.
 *
 *  2. `src/app/api/strategies/draft/[id]/route.ts` — NOT a latest-draft read:
 *     it is the DELETE handler's by-id ownership guard, and it re-applies the
 *     same pair on the DELETE itself as a TOCTOU fence (`:148-177`). It has no
 *     ordering and no limit, so Scan B does not see it, and folding it into the
 *     helper would destroy the fence. Asserted structurally below rather than
 *     taken on trust.
 *
 *  3. `src/app/(dashboard)/strategies/page.tsx` — a PRE-EXISTING second
 *     latest-draft read (`:41-49`), feeding the Resume CTA on the strategies
 *     list. It selects a DIFFERENT column set (`id, name, created_at,
 *     review_note`) for a different consumer — `review_note` drives the
 *     rejected-draft notice at `:51+` and is not part of the wizard's hydration
 *     contract — so it could not adopt the helper without widening
 *     `InitialDraft` for a page outside this phase's scope. RECORDED RESIDUAL
 *     (154-02): the /strategies Resume CTA and the wizard's resume decision can
 *     still drift. Folding it in is tracked as follow-up work, not silently
 *     ignored.
 *
 * ── FALSIFIABILITY (demonstrated in development, recorded in 154-02-SUMMARY) ─
 *   Adding a throwaway non-test file under `src/` containing the predicate pair
 *   makes Scan A fail NAMING that file; removing it → green. Adding the
 *   ordering + limit to it additionally fails Scan B. Both were observed red
 *   and then green before this file was committed.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");

/** THE sanctioned wizard-draft read. */
const HELPER = "src/lib/wizard/draft-query.ts";

/** Non-test src/ files permitted to carry the wizard-draft predicate pair. */
const ALLOWED_PAIR_CARRIERS: readonly string[] = [
  HELPER,
  "src/app/api/strategies/draft/[id]/route.ts",
  "src/app/(dashboard)/strategies/page.tsx",
];

/** The files permitted to issue a LATEST-wizard-draft read (Scan B, frozen). */
const ALLOWED_LATEST_READERS: readonly string[] = [
  HELPER,
  "src/app/(dashboard)/strategies/page.tsx",
];

// --- predicates (match CODE, never a filename) ------------------------------
const SOURCE_WIZARD_RE = /\.eq\(\s*["']source["']\s*,\s*["']wizard["']\s*\)/;
const STATUS_DRAFT_RE = /\.eq\(\s*["']status["']\s*,\s*["']draft["']\s*\)/;
const NEWEST_FIRST_RE =
  /\.order\(\s*["']created_at["']\s*,\s*\{\s*ascending:\s*false\s*\}\s*\)/;
const LIMIT_ONE_RE = /\.limit\(\s*1\s*\)/;

function isTestPath(rel: string): boolean {
  return (
    /\.test\.[tj]sx?$/.test(rel) ||
    rel.split(/[\\/]/).includes("__tests__") ||
    rel.includes("test-helpers")
  );
}

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      out.push(...walk(full, exts));
    } else if (exts.some((e) => entry.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

const SRC_FILES = walk(SRC_DIR, [".ts", ".tsx"]).filter(
  (f) => !isTestPath(relative(REPO_ROOT, f)),
);

function carriesPair(src: string): boolean {
  return SOURCE_WIZARD_RE.test(src) && STATUS_DRAFT_RE.test(src);
}

function isLatestRead(src: string): boolean {
  return carriesPair(src) && NEWEST_FIRST_RE.test(src) && LIMIT_ONE_RE.test(src);
}

describe("Phase 154 WIZCONT-01 — the wizard-draft query is single-sourced", () => {
  it("sanity: the helper IS detected by the heuristic (the guard is live, not blind)", () => {
    const src = readFileSync(join(REPO_ROOT, HELPER), "utf8");
    expect(
      isLatestRead(src),
      `${HELPER} no longer matches the latest-wizard-draft heuristic — either the ` +
        `query moved out of the helper (the invariant this file defends is broken) ` +
        `or the regexes have gone stale. Re-tune them; do NOT delete the assertion.`,
    ).toBe(true);
  });

  it("Scan A: no unsanctioned src/ file carries the source='wizard' + status='draft' pair", () => {
    const offenders = SRC_FILES.filter((f) =>
      carriesPair(readFileSync(f, "utf8")),
    )
      .map((f) => relative(REPO_ROOT, f))
      .filter((rel) => !ALLOWED_PAIR_CARRIERS.includes(rel));

    expect(
      offenders,
      `Unsanctioned wizard-draft query/queries: ${offenders.join(", ")}. The ` +
        `wizard-draft read belongs in ${HELPER} — import it. If this file ` +
        `legitimately needs the predicate for something OTHER than reading the ` +
        `latest draft (e.g. an ownership/TOCTOU fence), add it to ` +
        `ALLOWED_PAIR_CARRIERS with the reason written down.`,
    ).toEqual([]);
  });

  it("Scan B: the set of LATEST-wizard-draft readers is frozen", () => {
    const readers = SRC_FILES.filter((f) => isLatestRead(readFileSync(f, "utf8")))
      .map((f) => relative(REPO_ROOT, f))
      .sort();

    expect(
      readers,
      `The latest-wizard-draft read set changed. A NEW entry means a second ` +
        `shape of the read this phase single-sourced — route it through ` +
        `${HELPER} instead. A MISSING entry means the helper's query was ` +
        `changed or removed.`,
    ).toEqual([...ALLOWED_LATEST_READERS].sort());
  });

  it("the by-id DELETE fence is NOT a latest-draft read (its allow-list entry is earned)", () => {
    // Structural, not taken on trust: the DELETE route is allow-listed only
    // because its use of the pair is an ownership + TOCTOU fence on a single
    // id. If it ever grew an ordering + limit it would be a second latest-read
    // wearing a fence's clothes, and Scan B would catch it — this assertion
    // says so explicitly at the one file the reasoning depends on.
    const rel = "src/app/api/strategies/draft/[id]/route.ts";
    const src = readFileSync(join(REPO_ROOT, rel), "utf8");
    expect(carriesPair(src)).toBe(true);
    expect(
      isLatestRead(src),
      `${rel} now orders + limits the wizard-draft predicate — it has become a ` +
        `latest-draft read and must use ${HELPER}.`,
    ).toBe(false);
  });

  it("both wizard entry points import the helper (single source has two callers)", () => {
    const IMPORT_RE = /from\s+["']@\/lib\/wizard\/draft-query["']/;
    for (const rel of [
      "src/app/(dashboard)/strategies/new/wizard/page.tsx",
      "src/app/api/strategies/wizard-draft/route.ts",
    ]) {
      const src = readFileSync(join(REPO_ROOT, rel), "utf8");
      expect(
        IMPORT_RE.test(src) && /readLatestWizardDraft/.test(src),
        `${rel} no longer imports readLatestWizardDraft from ${HELPER} — the two ` +
          `entry paths can now answer differently, which IS the WIZCONT-01 defect.`,
      ).toBe(true);
    }
  });
});
