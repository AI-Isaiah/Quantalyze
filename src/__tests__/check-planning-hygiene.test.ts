import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  runCheck,
  scanFile,
  listTrackedFiles,
  deriveLocalUsername,
  corroborate,
  MAX_ENDEMIC_FILES,
} from "../../scripts/check-planning-hygiene";

/**
 * Regression tests for `scripts/check-planning-hygiene.ts` — the NO-ALLOWLIST
 * gate that fails `npm run lint` when a tracked file carries the local machine
 * username or a local absolute home path (Phase 163 SEC-02, WR-01).
 *
 * ⛔ NO REAL NEEDLE LIVES IN THIS FILE, IN ANY ENCODING.
 * The first cut of this suite carried the username base64-encoded, on the
 * reasoning that a literal needle here would make the gate fail on its own test
 * suite. That reasoning is correct and the remedy was not: base64 is not a
 * redaction, and this file is tracked in a PUBLIC repo, so the name stayed one
 * `base64 -d` away from any clone (WR-01). Rule 1's needle is now INJECTED —
 * every test below passes an explicitly synthetic username — and the live tree
 * is checked against a needle derived from the running machine at test time.
 * Do NOT reintroduce a committed needle in base64, hex, char codes, or split
 * literals; `the tracked tree carries no encoded machine identity` below fails
 * if you do.
 *
 * The properties under test are the ways this class of gate has historically
 * gone blind:
 *   1. path allowlists (why gitleaks missed this entirely) — asserted absent,
 *   2. NUL bytes truncating a read (src/lib/wizardErrors.test.ts line 1572),
 *   3. the scanner's own source tripping — or leaking into — the scan,
 *   4. a walk that finds zero files reading as "OK",
 *   5. a rule that silently stops running and still reports success.
 */

// The structural needles are shapes, not identities — reconstructed from char
// codes only so this file does not trip Rules 2-3 on itself.
const HOME_PREFIX = String.fromCharCode(47, 85, 115, 101, 114, 115, 47);
const SCRATCH_PREFIX = String.fromCharCode(45, 85, 115, 101, 114, 115, 45);

/**
 * Wholly invented identifiers. They belong to nobody, so committing them
 * discloses nothing — which is exactly why an injected needle is the right
 * shape for this suite.
 */
const SYNTHETIC_USERNAME = "quintaxil-vorbek";
const OTHER_USER = "someone-else";

let fixtureRoot: string;

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "planning-hygiene-"));
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function write(relativePath: string, contents: string): void {
  const abs = join(fixtureRoot, relativePath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, contents, "latin1");
}

describe("scanFile — the three needle classes", () => {
  it("flags an injected username on its own", () => {
    const v = scanFile(
      "docs/notes.md",
      `authored by ${SYNTHETIC_USERNAME} on a laptop`,
      SYNTHETIC_USERNAME,
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("LOCAL-USERNAME");
    expect(v[0]).toContain("docs/notes.md");
  });

  it("matches the username case-insensitively", () => {
    const v = scanFile(
      "docs/notes.md",
      `USER=${SYNTHETIC_USERNAME.toUpperCase()}`,
      SYNTHETIC_USERNAME,
    );
    expect(v.some((s) => s.startsWith("LOCAL-USERNAME"))).toBe(true);
  });

  it("never echoes the needle into the violation text", () => {
    // CI logs on a public repo are public: a message that printed the needle
    // would republish exactly what the scrub removed.
    const v = scanFile("docs/notes.md", SYNTHETIC_USERNAME, SYNTHETIC_USERNAME);
    expect(v).toHaveLength(1);
    expect(v[0]).not.toContain(SYNTHETIC_USERNAME);
  });

  it("flags an absolute home path even with a DIFFERENT username", () => {
    // The structural rule is what makes this gate outlive one machine: a
    // teammate's absolute path must fail too, or the gate only guards one laptop.
    const v = scanFile(
      "docs/x.md",
      `see ${HOME_PREFIX}${OTHER_USER}/notes.txt`,
      SYNTHETIC_USERNAME,
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("ABSOLUTE-HOME-PATH");
  });

  it("flags the dash-mangled scratchpad form of a home path", () => {
    const v = scanFile(
      "docs/x.md",
      `/private/tmp/claude-501${SCRATCH_PREFIX}${OTHER_USER}-projects/run.log`,
      SYNTHETIC_USERNAME,
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("SCRATCH-HOME-PATH");
  });

  it("reports the line number so the violation is actionable", () => {
    const v = scanFile(
      "docs/x.md",
      `clean\nclean\n${HOME_PREFIX}${OTHER_USER}/f\n`,
      SYNTHETIC_USERNAME,
    );
    expect(v[0]).toContain("docs/x.md:3");
  });
});

describe("the placeholder is exempted BY VALUE, never by path", () => {
  it("does not flag the redaction placeholder in a home path", () => {
    expect(
      scanFile("docs/x.md", `${HOME_PREFIX}<user>/notes.txt`, SYNTHETIC_USERNAME),
    ).toEqual([]);
  });

  it("does not flag the dash-mangled placeholder form", () => {
    expect(
      scanFile("docs/x.md", `${SCRATCH_PREFIX}<user>-projects`, SYNTHETIC_USERNAME),
    ).toEqual([]);
  });

  it("does not flag the ESCAPED spelling of the pattern", () => {
    // Docs, plans and this gate's own source must be able to NAME the pattern.
    const escaped = String.fromCharCode(92, 47, 85, 115, 101, 114, 115, 92, 47);
    expect(scanFile("docs/x.md", `the ${escaped} prefix`, SYNTHETIC_USERNAME)).toEqual(
      [],
    );
  });

  it("still flags a real path in a file that a path allowlist would exempt", () => {
    // The gitleaks blindness reproduced deliberately: these are exactly the
    // paths a path-based allowlist would carve out. They must STILL fail.
    for (const p of [
      "supabase/migrations/20260517013000_applied.sql",
      ".planning/phases/163/163-03-SUMMARY.md",
      "scripts/check-planning-hygiene.ts",
      "src/__tests__/check-planning-hygiene.test.ts",
      "node_modules/pkg/readme.md",
    ]) {
      const v = scanFile(p, `${HOME_PREFIX}${OTHER_USER}/x`, SYNTHETIC_USERNAME);
      expect(v, `${p} must not be exempted by path`).toHaveLength(1);
    }
  });
});

describe("deriveLocalUsername — the needle comes from the machine, never the tree", () => {
  it("prefers the explicit override so CI can inject it from a secret", () => {
    const { username, status } = deriveLocalUsername({
      envOverride: SYNTHETIC_USERNAME,
      homeDir: `${HOME_PREFIX}someone`,
      osUsername: "someone",
    });
    expect(username).toBe(SYNTHETIC_USERNAME);
    expect(status.active).toBe(true);
  });

  it("falls back to the home-directory basename — the form that actually leaks", () => {
    const { username, status } = deriveLocalUsername({
      envOverride: "",
      homeDir: `${HOME_PREFIX}${SYNTHETIC_USERNAME}`,
      osUsername: "ignored-because-home-wins",
    });
    expect(username).toBe(SYNTHETIC_USERNAME);
    expect(status.active).toBe(true);
  });

  it("falls back to the OS user record when there is no home directory", () => {
    const { username } = deriveLocalUsername({
      envOverride: undefined,
      homeDir: undefined,
      osUsername: SYNTHETIC_USERNAME,
    });
    expect(username).toBe(SYNTHETIC_USERNAME);
  });

  it("REFUSES a generic CI account name rather than flagging ordinary prose", () => {
    // MEASURED on this repo 2026-08-26: the GitHub Actions account name occurs
    // 2800 times across 507 tracked files. Searching for it would make
    // `frontend-lint` permanently red on a tree with zero real leakage.
    const { username, status } = deriveLocalUsername({
      homeDir: "/home/runner",
      osUsername: "runner",
    });
    expect(username).toBeNull();
    expect(status.active).toBe(false);
    expect(status.reason).toContain("generic");
  });

  it("REFUSES an implausibly short name", () => {
    const { username, status } = deriveLocalUsername({ osUsername: "ana" });
    expect(username).toBeNull();
    expect(status.reason).toContain("shorter than");
  });

  it("REFUSES when nothing at all can be derived", () => {
    const { username, status } = deriveLocalUsername({
      envOverride: undefined,
      homeDir: undefined,
      osUsername: undefined,
    });
    expect(username).toBeNull();
    expect(status.active).toBe(false);
  });

  it("never puts the derived value into the reason string", () => {
    const { status } = deriveLocalUsername({ envOverride: SYNTHETIC_USERNAME });
    expect(status.reason).not.toContain(SYNTHETIC_USERNAME);
  });
});

describe("an inactive Rule 1 disables ONLY Rule 1, and says so", () => {
  it("emits no LOCAL-USERNAME violation when the needle is null", () => {
    write("a.md", `authored by ${SYNTHETIC_USERNAME}\n`);
    const { violations, usernameRule } = runCheck(fixtureRoot, ["a.md"], null);
    expect(violations).toEqual([]);
    expect(usernameRule.active).toBe(false);
  });

  it("STILL emits structural violations when the needle is null", () => {
    // The failure this pins: a disabled Rule 1 quietly taking Rules 2-3 with it.
    write("a.md", `${HOME_PREFIX}${OTHER_USER}/x\n`);
    const { violations } = runCheck(fixtureRoot, ["a.md"], null);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("ABSOLUTE-HOME-PATH");
  });

  it("reports the rule as ACTIVE when a needle is supplied", () => {
    write("a.md", "clean\n");
    const { usernameRule } = runCheck(fixtureRoot, ["a.md"], SYNTHETIC_USERNAME);
    expect(usernameRule.active).toBe(true);
  });
});

describe("corroboration — the gate must not cry wolf on a clean tree", () => {
  /**
   * The reviewed defect (phase 163, finding 5). `deriveLocalUsername` accepted
   * any name that stayed off the denylist and cleared the 6-character floor, so
   * an ordinary container home directory became a case-insensitive substring
   * search over every tracked file. MEASURED on this repo immediately before
   * the fix: `HYGIENE_LOCAL_USERNAME=developer` produced 153 violations across
   * 102 files on a tree with ZERO real leakage, and — the gate having no path
   * allowlist by construction — no escape but the variable that caused it.
   *
   * ⭐ The fix must hold BOTH ends: no crying wolf, and no lost detection.
   * Every test below pins one end or the other; none of them exempts a path.
   */
  const bare = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => `doc-${i}.md`);

  function writeBareOccurrences(count: number): string[] {
    const files = bare(count);
    for (const f of files) write(f, `the ${SYNTHETIC_USERNAME} pattern\n`);
    return files;
  }

  it("stands DOWN when the word is endemic and never home-shaped", () => {
    const files = writeBareOccurrences(MAX_ENDEMIC_FILES + 1);
    const { violations, usernameRule } = runCheck(
      fixtureRoot,
      files,
      SYNTHETIC_USERNAME,
    );
    expect(violations).toEqual([]);
    expect(usernameRule.active).toBe(false);
    expect(usernameRule.reason).toContain(`${MAX_ENDEMIC_FILES + 1} tracked files`);
  });

  it("still FIRES at exactly the rarity boundary — the leak end of the trade", () => {
    // Pins `<=` against a drift to `<`. One file fewer than the stand-down
    // threshold must still be treated as an identity, or a real leak that
    // happens to touch eight files would pass.
    const files = writeBareOccurrences(MAX_ENDEMIC_FILES);
    const { violations, usernameRule } = runCheck(
      fixtureRoot,
      files,
      SYNTHETIC_USERNAME,
    );
    expect(violations).toHaveLength(MAX_ENDEMIC_FILES);
    expect(usernameRule.active).toBe(true);
  });

  it("FIRES on an endemic word the moment ONE occurrence is home-shaped", () => {
    // ⛔ The detection end. `/home/<name>` is caught by no structural rule —
    // rules 2-3 only know the macOS forms — so this is exactly the leak that
    // Rule 1 exists for, and endemic-ness must not excuse it.
    const files = writeBareOccurrences(MAX_ENDEMIC_FILES + 1);
    write("leak.md", `/home/${SYNTHETIC_USERNAME}/quantalyze/notes.md\n`);
    const { violations, usernameRule } = runCheck(
      fixtureRoot,
      [...files, "leak.md"],
      SYNTHETIC_USERNAME,
    );
    expect(usernameRule.active).toBe(true);
    expect(violations).toHaveLength(MAX_ENDEMIC_FILES + 2);
    // The home-shaped hit is the actionable one, so it must not be buried
    // under the bare fallout.
    expect(violations[0]).toContain("leak.md");
    expect(violations[0]).toContain("inside a home-directory path");
  });

  it("treats the dash-mangled and tilde home forms as corroborating too", () => {
    for (const leak of [
      `${SCRATCH_PREFIX}${SYNTHETIC_USERNAME}-projects`,
      `~${SYNTHETIC_USERNAME}/notes`,
      `-home-${SYNTHETIC_USERNAME}-x`,
    ]) {
      const files = writeBareOccurrences(MAX_ENDEMIC_FILES + 1);
      write("leak.md", `${leak}\n`);
      const { usernameRule } = runCheck(
        fixtureRoot,
        [...files, "leak.md"],
        SYNTHETIC_USERNAME,
      );
      expect(usernameRule.active, `${leak} must corroborate`).toBe(true);
    }
  });

  it("a CLEAN tree leaves Rule 1 ACTIVE — zero hits is not endemic", () => {
    // ⭐ The subtlest failure mode available here: if "no evidence" read as
    // "not corroborated", the rule would switch itself off precisely when the
    // tree is clean, and the first leak after a successful scrub would land
    // unnoticed. That is a gate that cannot fail.
    write("a.md", "wholly unrelated prose\n");
    const { violations, usernameRule } = runCheck(
      fixtureRoot,
      ["a.md"],
      SYNTHETIC_USERNAME,
    );
    expect(violations).toEqual([]);
    expect(usernameRule.active).toBe(true);
  });

  it("corroborates on zero hits and on a lone home-shaped hit", () => {
    expect(corroborate([]).corroborated).toBe(true);
    expect(
      corroborate([{ relPath: "a.md", line: 1, homeShaped: true }]).corroborated,
    ).toBe(true);
  });

  it("does NOT send the reader in a circle when the OVERRIDE caused the stand-down", () => {
    // The advice used to be a fixed "set HYGIENE_LOCAL_USERNAME" line. For a
    // needle that came FROM that variable, that instruction is circular.
    const hits = bare(MAX_ENDEMIC_FILES + 1).map((relPath) => ({
      relPath,
      line: 1,
      homeShaped: false,
    }));
    const result = corroborate(hits);
    expect(result.corroborated).toBe(false);
    if (result.corroborated) return;
    expect(result.status.advice).not.toContain("HYGIENE_LOCAL_USERNAME");
    expect(result.status.advice.length).toBeGreaterThan(0);
  });

  it("never leaks the needle into the stand-down text", () => {
    const files = writeBareOccurrences(MAX_ENDEMIC_FILES + 1);
    const { usernameRule } = runCheck(fixtureRoot, files, SYNTHETIC_USERNAME);
    expect(usernameRule.reason).not.toContain(SYNTHETIC_USERNAME);
    expect(usernameRule.advice).not.toContain(SYNTHETIC_USERNAME);
  });

  it("corroboration is a TREE decision, never a per-path exemption", () => {
    // Once corroborated, the files a path allowlist would have carved out are
    // flagged like any other — including this test file's own path.
    const files = [
      "supabase/migrations/20260517013000_applied.sql",
      ".planning/phases/163/163-03-SUMMARY.md",
      "scripts/check-planning-hygiene.ts",
      "src/__tests__/check-planning-hygiene.test.ts",
    ];
    for (const f of files) write(f, `owner ${SYNTHETIC_USERNAME}\n`);
    const { violations } = runCheck(fixtureRoot, files, SYNTHETIC_USERNAME);
    expect(violations).toHaveLength(files.length);
  });
});

describe("the denylist covers names corroboration cannot", () => {
  // `deployer` occurs exactly ONCE in this repo (measured 2026-08-26), so the
  // rarity test would call it an identity and fail a clean tree for anyone
  // whose container home is /home/deployer. Only the denylist catches it.
  it.each(["developer", "workspace", "deployer"])(
    "refuses %s, an ordinary non-personal home-directory name",
    (name) => {
      const { username, status } = deriveLocalUsername({ homeDir: `/home/${name}` });
      expect(username).toBeNull();
      expect(status.reason).toContain("generic");
    },
  );

  it("tells the reader that nothing is broken", () => {
    const { status } = deriveLocalUsername({ homeDir: "/home/developer" });
    expect(status.advice).toContain("NOTHING IS WRONG");
  });
});

describe("end to end over real files — a planted needle is detected, its removal clears", () => {
  it("goes RED on a planted username and GREEN once it is removed", () => {
    write("notes.md", `owner: ${SYNTHETIC_USERNAME}\n`);
    const red = runCheck(fixtureRoot, ["notes.md"], SYNTHETIC_USERNAME);
    expect(red.filesScanned).toBe(1);
    expect(red.violations).toHaveLength(1);
    expect(red.violations[0]).toContain("LOCAL-USERNAME");

    write("notes.md", "owner: <user>\n");
    const green = runCheck(fixtureRoot, ["notes.md"], SYNTHETIC_USERNAME);
    expect(green.filesScanned).toBe(1);
    expect(green.violations).toEqual([]);
  });
});

describe("NUL-safety — the src/lib/wizardErrors.test.ts blind spot", () => {
  it("scans past a NUL byte to find an occurrence after it", () => {
    // `grep`/`git grep -I` classify this content as binary and skip it; exit 1
    // then reads as a clean pass. That is the recorded failure this pins.
    const contents = `header\n${String.fromCharCode(0)}\n${HOME_PREFIX}${OTHER_USER}/late.txt\n`;
    const v = scanFile("src/lib/withNul.test.ts", contents, SYNTHETIC_USERNAME);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("ABSOLUTE-HOME-PATH");
  });

  it("reads a NUL-carrying file off disk without truncating", () => {
    write(
      "fixture.txt",
      `a\n${String.fromCharCode(0)}\n${HOME_PREFIX}${OTHER_USER}/late.txt\n`,
    );
    const { violations, filesScanned } = runCheck(fixtureRoot, ["fixture.txt"], null);
    expect(filesScanned).toBe(1);
    expect(violations).toHaveLength(1);
  });

  it("finds a username planted AFTER a NUL byte", () => {
    write("fixture.txt", `a\n${String.fromCharCode(0)}\n${SYNTHETIC_USERNAME}\n`);
    const { violations } = runCheck(fixtureRoot, ["fixture.txt"], SYNTHETIC_USERNAME);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("LOCAL-USERNAME");
  });
});

describe("anti-vacuity — an empty walk is a failure, not a pass", () => {
  it("reports EMPTY-SCAN when the file list is empty", () => {
    const { violations, filesScanned } = runCheck(fixtureRoot, [], SYNTHETIC_USERNAME);
    expect(filesScanned).toBe(0);
    expect(violations.some((v) => v.startsWith("EMPTY-SCAN"))).toBe(true);
  });

  it("counts every file it scanned, including clean ones", () => {
    write("a.md", "clean\n");
    write("b.md", "also clean\n");
    const { violations, filesScanned } = runCheck(
      fixtureRoot,
      ["a.md", "b.md"],
      SYNTHETIC_USERNAME,
    );
    expect(filesScanned).toBe(2);
    expect(violations).toEqual([]);
  });
});

describe("the live repository", () => {
  it("enumerates a plausible number of tracked files", () => {
    // Guards the enumeration itself: if `git ls-files` ever returns nothing
    // (wrong cwd, detached state), the gate would go green over zero files.
    expect(listTrackedFiles(process.cwd()).length).toBeGreaterThan(1000);
  });

  it("has zero violations at HEAD — the scanner's own source included", () => {
    const { violations, filesScanned } = runCheck(process.cwd());
    expect(violations).toEqual([]);
    expect(filesScanned).toBeGreaterThan(1000);
  });

  it("the tracked tree carries no ENCODED form of this machine's identity", () => {
    // ⭐ The WR-01 regression itself. Rule 1's plain-text search cannot catch a
    // committed base64 needle, and that is precisely how the username survived
    // a 940-occurrence scrub that then reported zero.
    //
    // This deliberately uses the RAW machine identities, bypassing the
    // plausibility filter that Rule 1 applies: a generic account name like the
    // CI runner's is too collision-prone to search for in PLAIN text, but its
    // base64/hex blob is not, so this check is meaningful on every machine and
    // never degrades to a no-op.
    const identities = new Set<string>();
    try {
      identities.add(basename(homedir()));
    } catch {
      /* no home directory — nothing to check from this source */
    }
    try {
      identities.add(userInfo().username);
    } catch {
      /* no OS user record — nothing to check from this source */
    }

    const forms = new Map<string, string>();
    for (const id of identities) {
      if (!id || id.length < 3) continue;
      const buf = Buffer.from(id);
      forms.set("base64", buf.toString("base64"));
      forms.set("base64-unpadded", buf.toString("base64").replace(/=+$/, ""));
      forms.set("base64url", buf.toString("base64url"));
      forms.set("hex", buf.toString("hex"));
      forms.set("hex-upper", buf.toString("hex").toUpperCase());
      // Never compare an "encoded" form that is byte-identical to the plain
      // name — that is Rule 1's job and would false-positive on generic names.
      for (const [name, value] of [...forms]) {
        if (value === id) forms.delete(name);
      }
    }
    expect(
      forms.size,
      "no machine identity could be derived, so this check would be vacuous",
    ).toBeGreaterThan(0);

    const root = process.cwd();
    const tracked = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "buffer",
      maxBuffer: 1 << 28,
    })
      .toString("utf-8")
      .split("\0")
      .filter(Boolean);

    const hits = new Set<string>();
    for (const rel of tracked) {
      let contents: string;
      try {
        // latin1: byte-exact, so a NUL cannot hide what follows it.
        contents = readFileSync(resolve(root, rel), "latin1");
      } catch {
        continue;
      }
      for (const value of forms.values()) {
        if (contents.includes(value)) hits.add(rel);
      }
    }

    // ⛔ ZERO, AND EXACT — not an allowlist, and emphatically not a path
    // exemption. The scanner has neither by construction, and neither does this
    // test. Asserting the empty set means the check fails the moment ANY tracked
    // file starts encoding the machine identity in ANY of the forms above.
    //
    // History worth keeping: this assertion was briefly a COUNTDOWN carrying one
    // entry. The WR-01 review reported two leaking files; this test found a
    // third — a planning artifact quoting the original base64 needle — which the
    // fix pass could not touch because it lay outside the file set that pass
    // owned. The literal has since been replaced with a runtime derivation, so
    // the countdown reached zero and was deleted, exactly as its own message
    // instructed. Do not reintroduce an entry here: a leak is a fix, not a note.
    expect(
      [...hits].sort(),
      "tracked files encode the local machine identity in a recoverable form — redact the occurrence; do NOT add it to an exemption list",
    ).toEqual([]);
  });
});
