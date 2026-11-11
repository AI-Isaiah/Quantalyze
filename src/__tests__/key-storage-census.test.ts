// @vitest-environment node
/**
 * Phase 200 MANAGERKEYS, plan 02 (D-14, D-15, LEAN-04) — the key-storage census.
 *
 * THE PROPERTY. The security explanation lives on `/security#key-handling` and nowhere
 * else. Every in-app surface that describes how a key is kept renders the one shared
 * sentence (`KEY_STORAGE_SENTENCE`) and a link to `/security`. No other source under
 * `src/app`, `src/components` or `src/lib` restates the mechanism, because a restated
 * mechanism drifts: before this phase two surfaces named AES-256-GCM and Supabase Vault
 * while `/security` said Fernet with a per-row data key wrapped by a key held by the
 * analytics service, and a third said a per-user KEK. A user handing over an exchange key
 * deserves one account of how it is kept.
 *
 * WHAT IS BANNED. As a whole word: `KEK`, `DEK`, `AES`, `Fernet`, `Vault`, `per-user`.
 * In any case: `envelope encryption`. Form guidance about WHICH key to paste (read-only
 * scopes, no trading or withdrawal permission, the MT5 investor login) is allowed and
 * stays beside the form; it just carries no encryption claim.
 *
 * EXEMPT BY CONSTRUCTION. `src/app/(marketing)/security` (the one place the mechanism is
 * stated on purpose), `src/app/api` (server routes name their own crypto in code and
 * messages), `src/lib/status-surface-copy.ts` (the shared sentence's home) and tests.
 *
 * ORACLE INDEPENDENCE. Every term is typed as a literal here. Nothing is imported from
 * `status-surface-copy.ts`, so a drift in the shared sentence cannot make this file pass
 * against itself.
 *
 * MATCHING. Comments are stripped with `stripCommentsPreserveLines`, so a docblock that
 * QUOTES a banned term (to say it is gone) cannot red a clean tree and reported lines stay
 * real. Matching runs on each file's whole whitespace-collapsed text, so a phrase wrapped
 * across JSX lines is still caught; the line number is computed only to name the hit.
 *
 * ANTI-VACUITY. A census that walks nothing passes. The population is asserted to contain
 * the three components that carried the restatements, and a planted-file self-test drives
 * the REAL `findHits` for each term (in code: caught; in a comment only: not caught).
 *
 * ALLOWLIST. Empty by decision. Each future entry needs a reason and a count pin, so an
 * exemption cannot silently absorb a second restatement in the same file.
 */

import { describe, it, expect } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = process.cwd();

const SCAN_ROOTS = ["src/app", "src/components", "src/lib"] as const;

/** Directories and files exempt by construction (see the header). */
const EXEMPT_PREFIXES = ["src/app/(marketing)/security/", "src/app/api/"] as const;
const EXEMPT_FILES = ["src/lib/status-surface-copy.ts"] as const;

/** The population must contain all of these: they carried the restatements this phase removed. */
const CENSUS_FILES = [
  "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx",
  "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx",
  "src/components/exchanges/AllocatorExchangeManager.tsx",
] as const;

/** Whole-word terms (case-sensitive) and the phrase banned in any case. */
const WORD_TERMS = ["KEK", "DEK", "AES", "Fernet", "Vault", "per-user"] as const;
const PHRASE_TERM = "envelope encryption";

/**
 * Each future entry: a file, a reason, and the exact hit count it is allowed to carry.
 * A count that moves in either direction fails, so the exemption cannot grow unseen.
 */
const ALLOWLIST: ReadonlyArray<{ file: string; reason: string; count: number }> = [];

const WORD_RE = new RegExp(`\\b(?:${WORD_TERMS.join("|")})\\b`, "g");
const PHRASE_RE = new RegExp(PHRASE_TERM, "gi");

function isTestPath(rel: string): boolean {
  return /\.test\.[^/]+$/.test(rel) || rel.split("/").includes("__tests__");
}

function isExempt(rel: string): boolean {
  return EXEMPT_PREFIXES.some((p) => rel.startsWith(p)) || EXEMPT_FILES.includes(rel as never);
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      walk(abs, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    const rel = relative(REPO_ROOT, abs).split("\\").join("/");
    if (!isTestPath(rel) && !isExempt(rel)) out.push(rel);
  }
}

function population(): string[] {
  const out: string[] = [];
  for (const root of SCAN_ROOTS) {
    const abs = join(REPO_ROOT, root);
    if (existsSync(abs)) walk(abs, out);
  }
  return [...new Set(out)].sort();
}

/** 1-based line, in `text`, of the character at `flatIndex` of its whitespace-collapsed form. */
function lineOf(text: string, flatIndex: number): number {
  let n = 0;
  let prevWs = false;
  for (let i = 0; i < text.length; i++) {
    const ws = /\s/.test(text[i]);
    if (!(ws && prevWs)) {
      if (n === flatIndex) return text.slice(0, i).split("\n").length;
      n++;
    }
    prevWs = ws;
  }
  return 1;
}

/**
 * Every `file:line` in `files` whose comment-stripped, whitespace-collapsed text matches
 * `re`. Paths in `files` may be repo-relative or absolute (the self-test plants files in a
 * temp dir).
 */
function findHits(files: readonly string[], re: RegExp): string[] {
  const hits: string[] = [];
  for (const rel of files) {
    const text = stripCommentsPreserveLines(readFileSync(resolve(REPO_ROOT, rel), "utf8"));
    const flat = text.replace(/\s+/g, " ");
    for (const m of flat.matchAll(new RegExp(re.source, re.flags))) {
      hits.push(`${rel}:${lineOf(text, m.index ?? 0)}`);
    }
  }
  return hits;
}

const FILES = population();

/**
 * Every distinct `file:line` in the population, sorted, with allowlisted files filtered out.
 * Distinct, because one sentence carrying several terms is one restatement to fix.
 */
function censusHits(): string[] {
  const all = [...new Set([...findHits(FILES, WORD_RE), ...findHits(FILES, PHRASE_RE)])].sort();
  const pinned = new Set(ALLOWLIST.map((a) => a.file));
  return all.filter((h) => !pinned.has(h.replace(/:\d+$/, "")));
}

describe("key-storage census (200, D-15)", () => {
  it("no in-app source restates how a key is stored outside /security", () => {
    const hits = censusHits();
    expect(
      hits,
      "the security explanation lives on /security#key-handling only; render KEY_STORAGE_SENTENCE " +
        "with KEY_STORAGE_LINK instead of restating the mechanism (D-14). Hits listed as file:line",
    ).toEqual([]);
  });

  it("every allowlist entry carries a reason and a count pin that matches the file", () => {
    for (const entry of ALLOWLIST) {
      expect(entry.reason.trim().length, `${entry.file}: an allowlist entry needs a reason`).toBeGreaterThan(0);
      expect(entry.count, `${entry.file}: an allowlist entry needs a count pin`).toBeGreaterThan(0);
      const actual = findHits([entry.file], WORD_RE).length + findHits([entry.file], PHRASE_RE).length;
      expect(actual, `${entry.file}: the allowlisted hit count moved`).toBe(entry.count);
    }
  });

  it("anti-vacuity: the population is non-empty, holds every CENSUS_FILES entry and skips the exempt ones", () => {
    expect(FILES.length).toBeGreaterThan(0);
    const missing = CENSUS_FILES.filter((f) => !FILES.includes(f));
    expect(missing, "the census walked past a surface it must cover").toEqual([]);
    const exemptWalked = FILES.filter(isExempt);
    expect(exemptWalked, "an exempt path leaked into the population").toEqual([]);
  });

  it("the matcher fires: each term alone is caught in code and ignored in a comment", () => {
    // A matcher that cannot fire makes the census pass for the wrong reason, so plant files
    // and run the REAL findHits (comment stripper and whitespace collapse included).
    const dir = mkdtempSync(join(tmpdir(), "key-census-selftest-"));
    try {
      const plant = (name: string, body: string): string => {
        const abs = join(dir, name);
        writeFileSync(abs, body);
        return abs;
      };
      for (const [i, term] of WORD_TERMS.entries()) {
        const code = plant(`w${i}.tsx`, `export const x = <p>keys use ${term} here</p>;\n`);
        expect(findHits([code], WORD_RE), `"${term}" planted in code`).toEqual([`${code}:1`]);
        const commented = plant(`wc${i}.tsx`, `/* ${term} */\n// ${term}\nexport const y = 1;\n`);
        expect(findHits([commented], WORD_RE), `"${term}" quoted in a comment`).toEqual([]);
      }
      // Whole-word: an identifier that merely contains a term is not a restatement.
      const inside = plant("inside.tsx", "export const DEKORATOR = 1;\nexport const Vaulted = 2;\n");
      expect(findHits([inside], WORD_RE)).toEqual([]);
      // The phrase, in any case, and wrapped across two lines as JSX wraps prose.
      const lower = plant("p1.tsx", "export const a = <p>envelope encryption</p>;\n");
      expect(findHits([lower], PHRASE_RE)).toEqual([`${lower}:1`]);
      const title = plant("p2.tsx", "export const a = <p>Envelope Encryption at rest</p>;\n");
      expect(findHits([title], PHRASE_RE)).toEqual([`${title}:1`]);
      const wrapped = plant("p3.tsx", "export const a = (\n  <p>\n    Envelope\n    encryption\n  </p>\n);\n");
      expect(findHits([wrapped], PHRASE_RE)).toEqual([`${wrapped}:3`]);
      const phraseComment = plant("p4.tsx", "// envelope encryption\nexport const y = 1;\n");
      expect(findHits([phraseComment], PHRASE_RE)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
