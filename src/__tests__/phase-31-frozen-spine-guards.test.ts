/**
 * Phase 31 (Graphs-Lead Layout & Collapsible Controls) — exit-gate guards.
 *
 * Phase 31 makes the strategy composition controls (`CompositionList` — the
 * per-strategy toggle / weight / leverage list) collapsible on the unified
 * `ScenarioComposer` so the factsheet-grade graphs (landed Phase 30, already
 * DOM-ordered ABOVE the controls) lead the surface when collapsed. It is a
 * component WRAP + tests: the projection engine is NOT touched, and no panel is
 * reordered. Two invariants define the phase exit, and BOTH fail silently
 * (ship GREEN) unless a content-inspecting test catches them:
 *
 *   (1) FROZEN ENGINE (SCENARIO-05). `src/lib/scenario.ts` AND
 *       `src/lib/scenario.test.ts` have ZERO diff vs the phase baseline — the
 *       252-day-annualization engine and its convention pins. The collapse is a
 *       pure client-side disclosure UI; the engine stays read-only this phase.
 *       A one-line tweak to `scenario.ts` would silently re-base the 252-day
 *       annualization the whole product relies on.
 *
 *   (2) HIDE-DON'T-UNMOUNT (LAYOUT-02 / Pitfall 5). `CompositionList` MUST be an
 *       UNCONDITIONAL child of the lifted `CollapsibleSection` (native
 *       <details> — children stay MOUNTED when collapsed, the browser only
 *       HIDES them), so every in-progress weight + leverage edit survives
 *       collapse→expand (the edit state lives in the parent ScenarioComposer,
 *       above the collapsible boundary). A naive conditional MOUNT
 *       (`{open && <CompositionList ...>}` or `… && <CompositionList`) would
 *       UNMOUNT the controls on collapse and WIPE the edits — the exact
 *       silent-failure surface this guard exists to catch. The behavioral
 *       regression test (ScenarioComposer.test.tsx "LAYOUT-02 …") proves the
 *       edits survive at runtime; THIS guard is the durable STRUCTURAL gate:
 *       it reads ScenarioComposer.tsx from disk and asserts the wrap is present
 *       AND no conditional-mount pattern exists, so a future edit that
 *       reintroduces the unmount fails CI even if no one reruns the behavioral
 *       test against it.
 *
 * HOW IT WORKS
 * ------------
 * Invariant (1) reads the REAL git delta for the phase: every file added or
 * changed between the phase baseline (the merge-base with origin/main) and
 * HEAD, PLUS untracked-but-not-ignored files. Pure git/file inspection — no
 * network, no Supabase round-trip — and runs in well under 2s.
 *
 * Invariant (2) reads `ScenarioComposer.tsx` from disk with readFileSync (NOT a
 * hardcoded snapshot) and runs grep-style content assertions against the live
 * source.
 *
 * Phase 31 ships ZERO migrations (no DB, no schema — LAYOUT-01/02 are UI only).
 * There is therefore no migration assertion here.
 *
 * NON-VACUITY
 * -----------
 * (1) The delta is computed from `git diff`/`git ls-files`, never a hardcoded
 *     list. Appending a no-op line to `src/lib/scenario.ts` makes the engine
 *     assertion FAIL (the file lands in the changed set); reverting restores
 *     green. Same for `src/lib/scenario.test.ts`.
 * (2) The conditional-mount gate reads the live file. Introducing
 *     `{open && <CompositionList ...}` (or any `… && <CompositionList`) into
 *     ScenarioComposer.tsx makes the no-conditional-mount assertion FAIL; and
 *     removing the `<CollapsibleSection>` wrap makes the wrap-present assertion
 *     FAIL. Both were verified by authoring.
 *
 * FAIL-LOUD (project CLAUDE.md Rule 12)
 * -------------------------------------
 * If the baseline ref cannot be resolved AT ALL (no origin/main merge-base AND
 * no fallback base sha reachable), the guard THROWS with an actionable message
 * — it never silently passes / skips. A guard that can't see the delta is worse
 * than no guard, so it must go red, not green.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CWD = process.cwd();

/**
 * The phase branch point on the feature branch at planning/execution time
 * (HEAD before the first Phase 31 Plan 02 commit: 94f36e4e). Used ONLY as a
 * fallback when `git merge-base origin/main HEAD` cannot be computed (e.g. a
 * shallow CI clone with no origin/main ref). If even this sha is unreachable,
 * the guard fails loud rather than skipping.
 */
const FALLBACK_BASE_SHA = "94f36e4e";

/**
 * Run git with an argument array (no shell — execFileSync, not execSync), so no
 * value is ever interpolated into a shell string. Trimmed; throws on non-zero
 * exit.
 */
function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: CWD,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Does `ref` resolve to a commit in this repo? */
function refExists(ref: string): boolean {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the phase baseline ref. Prefer the merge-base with origin/main
 * (correct in CI and locally); fall back to the documented branch-point sha if
 * origin/main is absent; FAIL LOUD if neither resolves (Rule 12 — never a
 * silent skip).
 */
function resolveBaselineRef(): string {
  if (refExists("origin/main")) {
    try {
      const base = git(["merge-base", "origin/main", "HEAD"]);
      if (base) return base;
    } catch {
      // fall through to the constant fallback
    }
  }
  if (refExists(FALLBACK_BASE_SHA)) {
    return FALLBACK_BASE_SHA;
  }
  throw new Error(
    "Phase 31 frozen-spine guard could not resolve a baseline ref: neither " +
      "`git merge-base origin/main HEAD` nor the fallback base sha " +
      `\`${FALLBACK_BASE_SHA}\` is reachable. The guard refuses to pass ` +
      "without a real diff base (CLAUDE.md Rule 12 — fail loud, never " +
      "silently skip an exit gate). Fetch origin/main (`git fetch origin " +
      "main`) or run against a non-shallow clone, then re-run.",
  );
}

/**
 * Build the set of files added or changed in this phase vs `base`:
 *   - `git diff --name-only <base> HEAD` — committed adds/changes
 *   - `git ls-files --others --exclude-standard` — untracked, not-ignored files
 * `.planning/` is gitignored, so it never pollutes the set.
 */
function changedFiles(base: string): string[] {
  const committed = git(["diff", "--name-only", base, "HEAD"])
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  return [...new Set([...committed, ...untracked])];
}

const BASE = resolveBaselineRef();
const CHANGED = changedFiles(BASE);

const FROZEN_ENGINE = "src/lib/scenario.ts";
const FROZEN_ENGINE_TEST = "src/lib/scenario.test.ts";

const COMPOSER_PATH = join(
  CWD,
  "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx",
);
const COMPOSER_SRC = readFileSync(COMPOSER_PATH, "utf8");

describe("Phase 31 frozen-spine + hide-don't-unmount exit-gate guards", () => {
  it("resolves a real phase baseline ref (fails loud if it cannot — Rule 12)", () => {
    // `resolveBaselineRef()` already threw at module load if unresolvable, so
    // reaching here proves a base was found. Pin the invariant explicitly so a
    // future refactor that swallows the error is caught.
    expect(BASE, "phase baseline ref must resolve to a non-empty sha").toBeTruthy();
    expect(typeof BASE).toBe("string");
  });

  it("exit gate (frozen engine SCENARIO-05): src/lib/scenario.ts is zero-diff vs baseline", () => {
    expect(
      CHANGED,
      `Phase 31 exit gate VIOLATED — ${FROZEN_ENGINE} changed in the phase ` +
        "delta. The projection engine is FROZEN (SCENARIO-05; the 252-day " +
        "annualization basis the whole product relies on). Phase 31 only wraps " +
        "the existing CompositionList in the lifted CollapsibleSection — a " +
        "client-side disclosure UI. The engine must not be edited. Revert " +
        `${FROZEN_ENGINE} to the baseline.`,
    ).not.toContain(FROZEN_ENGINE);
  });

  it("exit gate (frozen engine pins): src/lib/scenario.test.ts is zero-diff vs baseline", () => {
    expect(
      CHANGED,
      `Phase 31 exit gate VIOLATED — ${FROZEN_ENGINE_TEST} changed in the ` +
        "phase delta. That file holds the 252-day annualization convention " +
        "pins — the SOLE proof the frozen engine's math was not loosened (it " +
        "FAILS SILENTLY otherwise). It must stay byte-unchanged this phase. " +
        `Revert ${FROZEN_ENGINE_TEST} to the baseline.`,
    ).not.toContain(FROZEN_ENGINE_TEST);
  });

  it("hide-don't-unmount (LAYOUT-02 / Pitfall 5): CompositionList is WRAPPED in the lifted CollapsibleSection", () => {
    // The lifted primitive must be imported from its generalized home (NOT the
    // factsheet-local copy) so the composer reuses the shared, factsheet-
    // agnostic component.
    expect(
      COMPOSER_SRC,
      "ScenarioComposer.tsx must import the lifted CollapsibleSection from " +
        "@/components/ui/CollapsibleSection — the generalized primitive (31-01).",
    ).toContain('from "@/components/ui/CollapsibleSection"');

    // A <CollapsibleSection ...> must ENCLOSE the <CompositionList ...> render
    // site — i.e. CollapsibleSection opens before CompositionList appears, with
    // no intervening close of the section. We assert the ordered, enclosing
    // relationship on the live source (readFileSync), not a hardcoded snapshot.
    const WRAP_RE = /<CollapsibleSection\b[\s\S]*?<CompositionList\b/;
    expect(
      WRAP_RE.test(COMPOSER_SRC),
      "Phase 31 exit gate VIOLATED — <CollapsibleSection> must enclose " +
        "<CompositionList> so the controls are collapsible and the graphs lead " +
        "(LAYOUT-01). The wrap is missing or CompositionList is no longer a " +
        "child of CollapsibleSection.",
    ).toBe(true);

    // Tighter: between the opening <CollapsibleSection and the first
    // <CompositionList there must be NO </CollapsibleSection> close tag — i.e.
    // CompositionList is genuinely INSIDE the section, not a sibling after it.
    // Anchor on the LAST <CollapsibleSection BEFORE the first <CompositionList
    // (its genuine enclosing open tag), not the first <CollapsibleSection in the
    // file — robust if a second, unrelated CollapsibleSection is ever added above
    // the wrap (WR-02).
    const compIdx = COMPOSER_SRC.indexOf("<CompositionList");
    const openIdx = COMPOSER_SRC.lastIndexOf("<CollapsibleSection", compIdx);
    expect(
      openIdx,
      "Phase 31 exit gate VIOLATED — no <CollapsibleSection> open tag precedes " +
        "<CompositionList>; the wrap is missing.",
    ).toBeGreaterThanOrEqual(0);
    const closeBetween = COMPOSER_SRC.slice(openIdx, compIdx).includes(
      "</CollapsibleSection>",
    );
    expect(
      closeBetween,
      "Phase 31 exit gate VIOLATED — a </CollapsibleSection> close tag appears " +
        "BEFORE <CompositionList>, so CompositionList is a sibling AFTER the " +
        "section rather than enclosed by it. The controls would not be " +
        "collapsible.",
    ).toBe(false);
  });

  it("hide-don't-unmount (LAYOUT-02 / Pitfall 5): NO conditional MOUNT of CompositionList — it must never be `{open && <CompositionList}` (which would wipe edits on collapse)", () => {
    // The silent-failure surface this gate exists to catch: rendering
    // CompositionList behind a JS `&&` (or ternary) guard conditioned on the
    // open/collapsed state UNMOUNTS it on collapse, destroying the parent-held
    // weight + leverage edits the moment the user hides the panel. The native
    // <details> wrapper instead HIDES a mounted child — that is the whole point.
    //
    // We forbid ANY conditional mount of CompositionList — both the `&&` form
    // and the ternary form, INCLUDING the Prettier-idiomatic parenthesized /
    // fragment-wrapped variants a multi-line JSX refactor produces. The optional
    // `\(?` and `(?:<>\s*)?` cover `&& (\n <CompositionList`, `? (<CompositionList`,
    // and `&& (<><CompositionList` — the forms the naive `&&\s*<CompositionList`
    // missed (WR-01). `\s` spans newlines, so multi-line wraps are caught.
    const CONDITIONAL_AND = /&&\s*\(?\s*(?:<>\s*)?<CompositionList\b/;
    const CONDITIONAL_TERNARY = /[?:]\s*\(?\s*(?:<>\s*)?<CompositionList\b/;

    // Non-vacuity self-pin: the gate's own sensitivity. If these regexes ever
    // stop catching the parenthesized/fragment/inline forms, the gate is dead
    // weight — assert it catches each synthetic violation it exists to block.
    expect(CONDITIONAL_AND.test("{open && <CompositionList />}")).toBe(true);
    expect(CONDITIONAL_AND.test("{open && (\n  <CompositionList />\n)}")).toBe(true);
    expect(CONDITIONAL_AND.test("{open && (<><CompositionList /></>)}")).toBe(true);
    expect(CONDITIONAL_TERNARY.test("{open ? <CompositionList /> : null}")).toBe(true);
    expect(CONDITIONAL_TERNARY.test("{open ? (\n  <CompositionList />\n) : null}")).toBe(true);

    expect(
      CONDITIONAL_AND.test(COMPOSER_SRC),
      "Phase 31 exit gate VIOLATED — CompositionList is conditionally MOUNTED " +
        "via a `&& <CompositionList` guard (inline or parenthesized). This " +
        "unmounts the controls on collapse and WIPES in-progress weight + " +
        "leverage edits (Pitfall 5). CompositionList MUST be an unconditional " +
        "child of <CollapsibleSection> so the native <details> hides (never " +
        "unmounts) it.",
    ).toBe(false);

    expect(
      CONDITIONAL_TERNARY.test(COMPOSER_SRC),
      "Phase 31 exit gate VIOLATED — CompositionList is conditionally MOUNTED " +
        "via a ternary (inline or parenthesized). Same hazard as the `&&` form: " +
        "collapse would unmount the controls and wipe edits. Render it " +
        "unconditionally inside <CollapsibleSection>.",
    ).toBe(false);
  });
});
