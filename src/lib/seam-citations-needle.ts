/**
 * THE CITATION NEEDLE — one regex, two guards (Phase 140.5 / SEAMPROSE-01,
 * hoisted here by Phase 141.1 / D-06).
 *
 * ── WHY THIS IS ITS OWN MODULE ────────────────────────────────────────────────
 *
 * The needle was born module-private inside `seam-citations.invariant.test.ts`,
 * where it scans COMMENTS on the ratified seam surface. Phase 141.1 needed the
 * same needle for a second population — the evidence STRING LITERALS in
 * `seam-retry-registry.ts` — and that second guard lives in a different test
 * file.
 *
 * The obvious move (export it from the invariant test and import that test file)
 * was MEASURED and rejected: vitest re-registers an imported test file's suites
 * into the importing file, so `seam-retry-registry.test.ts` alone ran 73 tests
 * instead of 27 — the invariant file's whole suite counted twice, once under the
 * wrong filename. Hoisting to this non-test leaf is the sanctioned fallback.
 *
 * ⚠️ NEVER WRITE A SECOND COPY OF THIS REGEX. The repo already carries 17
 * unrewired `stripComments` copies — a class this programme has paid for
 * repeatedly. A new consumer imports from here; it does not re-derive.
 *
 * ── WHY THE TWO CONSUMERS APPLY IT DIFFERENTLY, AND MUST ──────────────────────
 *
 * The needle matches a coordinate token in ANY text. What differs is what each
 * guard feeds it:
 *
 *   · `seam-citations.invariant.test.ts` feeds it COMMENT text, via
 *     `extractComments`. Its own `-1` self-test proves the pipeline is silent on
 *     a coordinate inside a STRING LITERAL — a string is data, not prose.
 *   · `seam-retry-registry.test.ts` feeds it the registry's evidence VALUES
 *     DIRECTLY, with no comment extraction. In that one file the string literals
 *     ARE the prose: the registry's premise is "the evidence IS the entry". The
 *     comment guard is therefore structurally blind to exactly the rot that
 *     matters there, which is why both guards exist rather than one.
 */

/**
 * Variants A/B/C, ported from `140.5-citation-census.mjs`, which already
 * survived paren-eating and docstring dedup. Any `<name>.<ext>:<digits>` with an
 * optional range/list tail is a citation.
 *
 * Stateful (`/g`) — every consumer must reset `lastIndex` before use, which
 * `citationsIn` does.
 */
export const CITE =
  /([A-Za-z0-9_./[\]()@-]*[A-Za-z0-9_\])])\.(ts|tsx|py|mjs|cjs|js|jsx|sql|yml|yaml|md|json)\s*:\s*(\d+(?:\s*[-–,]\s*\d+)*)/g;

/** Every citation token inside one piece of text (a comment line, or an evidence string). */
export function citationsIn(
  text: string,
): Array<{ target: string; lines: string }> {
  const out: Array<{ target: string; lines: string }> = [];
  CITE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITE.exec(text)) !== null) {
    let base = m[1];
    const ext = m[2];
    const ln = m[3];
    // Un-eat leading delimiters the char class greedily absorbed, so
    // `(route.ts:NN)` reports target `route.ts`, not `(route.ts` — the
    // paren-eating regression the census fixed once already. (Written with `NN`,
    // not a digit, so this module never plants the exact form it bans.)
    while (base.length && "([".includes(base[0])) {
      const open = base[0];
      const close = open === "(" ? ")" : "]";
      const nOpen = base.split(open).length - 1;
      const nClose = base.split(close).length - 1;
      if (nOpen > nClose) base = base.slice(1);
      else break;
    }
    out.push({ target: `${base}.${ext}`, lines: ln.replace(/\s+/g, "") });
  }
  return out;
}

/**
 * The shared remedy text, so both guards tell a reader the SAME thing. Phrased
 * as the conversion protocol rather than "fix the number", because bumping a
 * coordinate to today's line re-arms the identical rot tomorrow.
 */
export const CONVERSION_PROTOCOL =
  "A bare `file.ext:NN` citation names a coordinate that goes stale the instant " +
  "the target file grows or shrinks a line above it — this milestone was bitten " +
  "by that eight times. Convert it to a SYMBOL-ANCHORED reference: name the " +
  "function, constant or arm (e.g. `assertPortfolioOwnership in queries.ts`, " +
  "`the 4xx-forward arm in simulator/route.ts`), which survives line drift " +
  "because it names the thing, not its address. An OUT-OF-REPO reference with no " +
  "in-repo symbol to anchor to (a pinned third-party dist file) gets an " +
  "allowlist row WITH A REASON — never a bare integer that is unowned by " +
  "construction.";
