import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A11Y-02 / SC#2 — WCAG 1.4.4 Resize Text source-scan guard.
 *
 * axe finds ~57% of WCAG and STRUCTURALLY CANNOT test Resize Text (1.4.4):
 * a viewport that pins the maximum scale or disables user-scaling silently
 * defeats pinch-zoom on mobile, and no automated DOM-rule can observe it.
 * This is exactly the structural gap the bespoke verification gates close.
 *
 * Cloned from `tests/visual/chart-accessibility-layer.test.ts` (the proven
 * walk() + per-file regex + violations[] pattern): it walks all of `src/`,
 * skips node_modules/.next, and FAILS on any zoom-disabling viewport
 * directive — whether expressed as a Next.js `viewport` export field
 * (the `: 1` / `: false` object-literal shape) or a raw
 * `<meta name="viewport" content="...">` directive.
 *
 * Running this as a Vitest test (not a tsx script + ci.yml step) means it
 * runs unconditionally in the existing `frontend-test` (sharded) and
 * `frontend-coverage` (full) jobs via the `tests/visual/**` include glob
 * (vitest.config.ts) — ZERO ci.yml edits, ZERO seed gate, the lowest
 * possible FLOW-01 risk surface.
 *
 * The guard ONLY reads + regex-tests file content (readFileSync); it never
 * eval()s or import()s scanned files (mirrors the clone target — no code
 * execution of scanned content).
 *
 * Green from the first run: no zoom-disabling directive exists anywhere in
 * src/ today (verified). The explicit zoom-permissive `viewport` export in
 * src/app/layout.tsx (width device-width, initialScale 1, no scale cap and no
 * scaling lock) keeps it green forever.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      out.push(...walk(full));
    } else if (/\.(tsx?|html)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// Zoom-disabling viewport directives. This guard's own file necessarily
// contains the forbidden tokens (in the regexes, labels, error message, and the
// falsifiability test below), so the guard stays honest by SCOPE, not by
// token-absence: it scans only src/, and this file lives in tests/visual/,
// outside that scope. If the scan is ever widened to include tests/, exclude
// this file explicitly (skip its own path in walk()) or it will self-flag.
const FORBIDDEN: { re: RegExp; label: string }[] = [
  { re: /maximumScale\s*:/, label: "maximumScale: (Next Viewport export field)" },
  { re: /userScalable\s*:\s*false/, label: "userScalable: false (Next Viewport export field)" },
  { re: /maximum-scale\s*=/, label: "maximum-scale= (raw <meta name='viewport'> content)" },
  { re: /user-scalable\s*=\s*no/, label: "user-scalable=no (raw <meta name='viewport'> content)" },
];

describe("zoom-meta guard (A11Y-02 / SC#2) — WCAG 1.4.4 Resize Text", () => {
  it("no zoom-disabling viewport directive anywhere in src/", () => {
    const violations: string[] = [];

    for (const path of walk(SRC_DIR)) {
      const src = readFileSync(path, "utf8");
      for (const { re, label } of FORBIDDEN) {
        if (re.test(src)) {
          const rel = path.replace(REPO_ROOT + "/", "");
          violations.push(`${rel}: ${label}`);
        }
      }
    }

    expect(
      violations,
      "viewport must never disable pinch-zoom (WCAG 1.4.4 Resize Text). " +
        "Drop any scale cap or scaling lock from the viewport export, " +
        "and never hand-write a zoom-locking <meta name='viewport'>.",
    ).toEqual([]);
  });

  it("scans a non-empty file set (smoke check the walk() isn't matching 0 files)", () => {
    // Floor kept well below the live src/ file count purely as a
    // walk()/path-regression guard (catches the glob silently matching
    // zero files, which would make the guard vacuously green).
    const files = walk(SRC_DIR);
    expect(files.length).toBeGreaterThan(50);
  });

  it("FORBIDDEN patterns still match known zoom-locking directives (anti-typo guard)", () => {
    // Proves each regex actually matches a real violation. A typo that silently
    // neutered a pattern would let a real zoom-lock slip past the src/ scan
    // while the no-violations test stayed (falsely) green. These samples carry
    // the forbidden tokens by necessity and live here in tests/visual/, outside
    // the src/-only scan scope, by design (see the FORBIDDEN comment above).
    const knownViolations = [
      "export const viewport = { maximumScale: 1 }",
      "export const viewport = { userScalable: false }",
      '<meta name="viewport" content="width=device-width, maximum-scale=1" />',
      '<meta name="viewport" content="width=device-width, user-scalable=no" />',
    ];
    for (const sample of knownViolations) {
      expect(
        FORBIDDEN.some(({ re }) => re.test(sample)),
        `no FORBIDDEN pattern matched a known zoom-lock — a regex was likely typo-broken: ${sample}`,
      ).toBe(true);
    }
  });
});
