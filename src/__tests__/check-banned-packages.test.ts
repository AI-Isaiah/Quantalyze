/**
 * CI hook regression test — `scripts/check-banned-packages.mjs`.
 *
 * Sprint 6 closeout Task 7.6. Verifies that the banned-packages
 * supply-chain scanner behaves correctly on three canonical cases:
 *
 *   1. Current working-tree `package.json` + `package-lock.json` pass
 *      (exit 0). The repo is supposed to be clean — if this fails, CI
 *      itself will also fail, but surfacing the failure in Vitest
 *      makes the fix loop local + fast (mirrors the pattern used by
 *      `gdpr-export-coverage-hook.test.ts`).
 *
 *   2. A PR that adds `axios` to `package.json::dependencies` fails
 *      with a specific error naming the banned package AND its safe
 *      alternative ("Use native fetch() or undici"). This is the
 *      plan's Verification §5 test-case one: "PR adding axios → CI
 *      fails".
 *
 *   3. A PR that introduces `axios` as a TRANSITIVE dep in
 *      `package-lock.json` (not direct in `package.json`) also fails.
 *      Supply-chain attacks typically land through the lockfile, so
 *      the scanner MUST catch both surfaces.
 *
 * The subprocess runs with a temp-dir scratch so the test cannot
 * pollute the working tree. stdout + stderr are captured for the
 * assertion.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  cpSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
// Single source of truth (M-0842/H-1018b): the test imports the SAME BANNED
// list the scanner uses, instead of hand-duplicating package names here.
import { BANNED } from "../../scripts/check-banned-packages.mjs";

const REPO_ROOT = process.cwd();
const HOOK_SCRIPT = join(REPO_ROOT, "scripts", "check-banned-packages.mjs");
const PACKAGE_JSON = join(REPO_ROOT, "package.json");
const PACKAGE_LOCK = join(REPO_ROOT, "package-lock.json");

function prepareScratch(): string {
  const scratch = mkdtempSync(join(tmpdir(), "banned-pkg-hook-test-"));
  mkdirSync(join(scratch, "scripts"), { recursive: true });
  cpSync(HOOK_SCRIPT, join(scratch, "scripts", "check-banned-packages.mjs"));
  // Baseline — copy both files so scan runs against real repo state.
  cpSync(PACKAGE_JSON, join(scratch, "package.json"));
  cpSync(PACKAGE_LOCK, join(scratch, "package-lock.json"));
  return scratch;
}

describe("scripts/check-banned-packages.mjs", () => {
  it("exits 0 against the current checked-in package.json + package-lock.json", () => {
    const result = spawnSync("node", ["scripts/check-banned-packages.mjs"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    if (result.status !== 0) {
      console.error("Hook stdout:", result.stdout);
      console.error("Hook stderr:", result.stderr);
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("clean");
  }, 30_000);

  it("exits 1 when axios is added to package.json::dependencies (direct)", () => {
    const scratch = prepareScratch();

    // Mutate the scratch package.json to add axios as a direct dep.
    const pkg = JSON.parse(readFileSync(join(scratch, "package.json"), "utf8"));
    pkg.dependencies = { ...pkg.dependencies, axios: "1.14.1" };
    writeFileSync(
      join(scratch, "package.json"),
      JSON.stringify(pkg, null, 2),
      "utf8",
    );

    const result = spawnSync("node", ["scripts/check-banned-packages.mjs"], {
      encoding: "utf8",
      cwd: scratch,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("axios");
    // The error message must tell the developer WHICH alternative to
    // reach for — "Use native fetch() or undici" per ~/.claude/CLAUDE.md.
    expect(result.stderr.toLowerCase()).toMatch(/fetch|undici/);
    // The error should call out the source so the reviewer knows
    // whether it's a direct vs transitive hit.
    expect(result.stderr).toContain("package.json:dependencies");
  }, 30_000);

  it("exits 1 when axios appears transitively in package-lock.json", () => {
    const scratch = prepareScratch();

    // Inject axios into the lockfile's `packages` map (v2/v3 shape).
    // package.json stays clean to prove the scanner catches the
    // transitive case — supply-chain attacks land via the lockfile,
    // not the manifest.
    const lock = JSON.parse(
      readFileSync(join(scratch, "package-lock.json"), "utf8"),
    );
    if (!lock.packages) {
      // If the lockfile isn't v2/v3, the test can't fabricate a valid
      // injection; skip cleanly with a console hint.
      console.warn(
        "[check-banned-packages.test] skipping transitive arm — " +
          "lockfile is not v2/v3 (no `packages` map).",
      );
      return;
    }
    lock.packages["node_modules/some-parent/node_modules/axios"] = {
      version: "1.14.1",
      resolved:
        "https://registry.npmjs.org/axios/-/axios-1.14.1.tgz",
      integrity: "sha512-fake",
    };
    writeFileSync(
      join(scratch, "package-lock.json"),
      JSON.stringify(lock, null, 2),
      "utf8",
    );

    const result = spawnSync("node", ["scripts/check-banned-packages.mjs"], {
      encoding: "utf8",
      cwd: scratch,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("axios");
    expect(result.stderr.toLowerCase()).toMatch(/fetch|undici/);
    // Surface prefix identifies the lockfile path.
    expect(result.stderr).toContain("package-lock.json:");
  }, 30_000);

  it("exits 1 for EVERY banned name in the single-source BANNED list (not axios-only)", () => {
    // Drive the matrix from the SAME exported BANNED list the scanner uses, so
    // adding a new compromise to the script automatically extends this test —
    // no third hand-maintained copy of the name list (M-0842).
    const allBanned = BANNED.map((b) => b.name);
    expect(allBanned).toContain("@openclaw-ai/openclawai"); // scoped name present

    for (const name of allBanned) {
      const scratch = prepareScratch();
      const pkg = JSON.parse(
        readFileSync(join(scratch, "package.json"), "utf8"),
      );
      pkg.dependencies = { ...pkg.dependencies, [name]: "1.0.0" };
      writeFileSync(
        join(scratch, "package.json"),
        JSON.stringify(pkg, null, 2),
        "utf8",
      );

      const result = spawnSync("node", ["scripts/check-banned-packages.mjs"], {
        encoding: "utf8",
        cwd: scratch,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(name);
    }
  }, 60_000);

  it("H-1135: detects axios in a v1 lockfile `dependencies` tree (no `packages` map)", () => {
    // Lockfile v1 (legacy npm <7) uses a recursive `dependencies` tree
    // and has NO `packages` map. The v2/v3 surface is covered by the
    // tests above; this proves the v1 walk (scanLockfile lines 141-160)
    // is actually exercised. A downgrade or a tool that emits v1 must
    // still trip the gate — otherwise a banned package buried in a v1
    // tree ships silently.
    const scratch = mkdtempSync(join(tmpdir(), "banned-pkg-v1-"));
    mkdirSync(join(scratch, "scripts"), { recursive: true });
    cpSync(HOOK_SCRIPT, join(scratch, "scripts", "check-banned-packages.mjs"));
    // package.json stays clean — the hit is purely in the v1 lockfile.
    writeFileSync(
      join(scratch, "package.json"),
      JSON.stringify({ name: "probe", version: "1.0.0", dependencies: {} }, null, 2),
      "utf8",
    );
    // v1 shape: a nested transitive axios under `foo`. Crucially there is
    // NO `packages` key, so only the v1 walk can find it.
    const v1Lock = {
      name: "probe",
      lockfileVersion: 1,
      dependencies: {
        foo: {
          version: "1.0.0",
          dependencies: {
            axios: { version: "0.30.4" },
          },
        },
      },
    };
    writeFileSync(
      join(scratch, "package-lock.json"),
      JSON.stringify(v1Lock, null, 2),
      "utf8",
    );

    const result = spawnSync("node", ["scripts/check-banned-packages.mjs"], {
      encoding: "utf8",
      cwd: scratch,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("axios");
    expect(result.stderr.toLowerCase()).toMatch(/fetch|undici/);
    // The v1 walk builds source as `package-lock.json:<parentPath><name>`,
    // so the nested path must surface the parent — proving the recursive
    // walk descended into `foo`'s sub-dependencies rather than only
    // scanning the top level.
    expect(result.stderr).toContain("package-lock.json:foo/axios");
  }, 30_000);

  it("H-1135: detects a DEEPLY nested transitive axios in a v2/v3 lockfile and reports the full node_modules path", () => {
    // The existing transitive arm uses a 2-level path
    // (node_modules/some-parent/node_modules/axios). This pins the
    // contract that the v2/v3 packages-map scan keys on the LAST
    // `node_modules/` segment (scanLockfile lines 123-126), so an
    // arbitrarily deep transitive entry is still caught AND the full key
    // is echoed in the error so a reviewer can locate the offending
    // dependency chain.
    const scratch = mkdtempSync(join(tmpdir(), "banned-pkg-deep-"));
    mkdirSync(join(scratch, "scripts"), { recursive: true });
    cpSync(HOOK_SCRIPT, join(scratch, "scripts", "check-banned-packages.mjs"));
    writeFileSync(
      join(scratch, "package.json"),
      JSON.stringify({ name: "probe", version: "1.0.0", dependencies: {} }, null, 2),
      "utf8",
    );
    const deepKey =
      "node_modules/a/node_modules/b/node_modules/c/node_modules/axios";
    const v3Lock = {
      name: "probe",
      lockfileVersion: 3,
      packages: {
        "": { name: "probe" },
        [deepKey]: { version: "1.14.1" },
      },
    };
    writeFileSync(
      join(scratch, "package-lock.json"),
      JSON.stringify(v3Lock, null, 2),
      "utf8",
    );

    const result = spawnSync("node", ["scripts/check-banned-packages.mjs"], {
      encoding: "utf8",
      cwd: scratch,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("axios");
    // The full path must appear so the reviewer can trace the chain.
    expect(result.stderr).toContain(`package-lock.json:${deepKey}`);
  }, 30_000);

  it("H-1135: a hybrid lockfile (both `packages` and `dependencies`) reports each distinct surface exactly once", () => {
    // npm v7+ writes BOTH a v2/v3 `packages` map AND a legacy
    // `dependencies` tree into the same lockfile for backward-compat.
    // The dedup `seen` set in scanLockfile (lines 108-116) keys on
    // `name@version@source`. The two surfaces produce DISTINCT source
    // strings (`node_modules/axios` vs `axios`), so they are
    // intentionally reported as two findings — the dedup must NOT
    // collapse a legitimately-distinct second surface, and equally must
    // NOT emit either surface more than once. This pins both halves of
    // the dedup contract the finding flags as untested.
    const scratch = mkdtempSync(join(tmpdir(), "banned-pkg-dedup-"));
    mkdirSync(join(scratch, "scripts"), { recursive: true });
    cpSync(HOOK_SCRIPT, join(scratch, "scripts", "check-banned-packages.mjs"));
    writeFileSync(
      join(scratch, "package.json"),
      JSON.stringify({ name: "probe", version: "1.0.0", dependencies: {} }, null, 2),
      "utf8",
    );
    const hybridLock = {
      name: "probe",
      lockfileVersion: 2,
      packages: {
        "": { name: "probe" },
        "node_modules/axios": { version: "1.14.1" },
      },
      dependencies: {
        axios: { version: "1.14.1" },
      },
    };
    writeFileSync(
      join(scratch, "package-lock.json"),
      JSON.stringify(hybridLock, null, 2),
      "utf8",
    );

    const result = spawnSync("node", ["scripts/check-banned-packages.mjs"], {
      encoding: "utf8",
      cwd: scratch,
    });
    expect(result.status).toBe(1);
    // The v2 packages-map surface.
    const v2Line = "package-lock.json:node_modules/axios";
    // The v1 dependencies-tree surface (top-level → no parent prefix).
    const v1Line = "package-lock.json:axios).";
    const v2Count = result.stderr
      .split("\n")
      .filter((l) => l.includes(v2Line)).length;
    const v1Count = result.stderr
      .split("\n")
      .filter((l) => l.includes(v1Line)).length;
    // Each distinct source is reported exactly once — dedup neither
    // suppresses the distinct second surface nor double-reports either.
    expect(v2Count).toBe(1);
    expect(v1Count).toBe(1);
  }, 30_000);

  it("H-0012: exits 1 for every other banned name injected TRANSITIVELY in package-lock.json", () => {
    // H-0012: the matcher must catch the three non-axios banned
    // packages on the LOCKFILE surface too, not just direct
    // package.json deps. Supply-chain attacks land via transitive
    // lockfile entries (a deep dependency pulling in a malicious
    // payload), so a banned package buried under
    // node_modules/some-parent/node_modules/<banned> MUST fail CI even
    // when package.json itself stays clean. Pre-this-test the transitive
    // arm was only exercised for axios; the other three were proven for
    // the direct arm only — leaving the 3×{transitive} corner of the
    // matrix unguarded.
    const otherBanned = [
      "react-native-international-phone-number",
      "react-native-country-select",
      "@openclaw-ai/openclawai",
    ];

    for (const name of otherBanned) {
      const scratch = prepareScratch();

      const lock = JSON.parse(
        readFileSync(join(scratch, "package-lock.json"), "utf8"),
      );
      if (!lock.packages) {
        console.warn(
          "[check-banned-packages.test] skipping transitive arm for " +
            `${name} — lockfile is not v2/v3 (no \`packages\` map).`,
        );
        continue;
      }
      // package.json stays clean — only the transitive lockfile entry
      // carries the banned name. Scoped names (@openclaw-ai/openclawai)
      // must round-trip through the node_modules path key correctly.
      lock.packages[`node_modules/some-parent/node_modules/${name}`] = {
        version: "1.0.0",
        resolved: `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`,
        integrity: "sha512-fake",
      };
      writeFileSync(
        join(scratch, "package-lock.json"),
        JSON.stringify(lock, null, 2),
        "utf8",
      );

      const result = spawnSync("node", ["scripts/check-banned-packages.mjs"], {
        encoding: "utf8",
        cwd: scratch,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(name);
      // Surface prefix must identify the lockfile path so the reviewer
      // knows this is a transitive (not direct) hit.
      expect(result.stderr).toContain("package-lock.json:");
    }
  }, 60_000);

  // H-1018: a banned package landing in a pnpm or yarn lockfile (a common
  // outcome of adding a workspace / switching package managers) must trip the
  // gate — scanning only package-lock.json would silently bypass it.
  function scratchWith(files: Record<string, string>): string {
    const scratch = mkdtempSync(join(tmpdir(), "banned-pkg-pm-"));
    mkdirSync(join(scratch, "scripts"), { recursive: true });
    cpSync(HOOK_SCRIPT, join(scratch, "scripts", "check-banned-packages.mjs"));
    for (const [rel, content] of Object.entries(files)) {
      writeFileSync(join(scratch, rel), content, "utf8");
    }
    return scratch;
  }

  it("H-1018: detects a banned package in pnpm-lock.yaml (no package-lock.json)", () => {
    const scratch = scratchWith({
      "package.json": JSON.stringify({ name: "probe", version: "1.0.0" }),
      // pnpm v9 packages-map key shape.
      "pnpm-lock.yaml":
        'lockfileVersion: "9.0"\npackages:\n  axios@1.14.1:\n' +
        "    resolution: {integrity: sha512-fake}\n",
    });
    const result = spawnSync("node", ["scripts/check-banned-packages.mjs"], {
      encoding: "utf8",
      cwd: scratch,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pnpm-lock.yaml");
    expect(result.stderr).toContain("axios");
  }, 30_000);

  it("H-1018: detects a scoped banned package in yarn.lock", () => {
    const scratch = scratchWith({
      "package.json": JSON.stringify({ name: "probe", version: "1.0.0" }),
      // yarn classic entry-key shape (quoted because of the scope + range).
      "yarn.lock":
        '# yarn lockfile v1\n\n"@openclaw-ai/openclawai@^1.0.0":\n' +
        '  version "1.0.0"\n  resolved "https://registry.npmjs.org/x"\n',
    });
    const result = spawnSync("node", ["scripts/check-banned-packages.mjs"], {
      encoding: "utf8",
      cwd: scratch,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("yarn.lock");
    expect(result.stderr).toContain("@openclaw-ai/openclawai");
  }, 30_000);

  it("H-1018: a name-substring in yarn.lock does NOT false-positive (boundary match)", () => {
    const scratch = scratchWith({
      "package.json": JSON.stringify({ name: "probe", version: "1.0.0" }),
      // `my-axios-wrapper` is NOT axios — the `@`-boundary match must skip it.
      "yarn.lock":
        '# yarn lockfile v1\n\n"my-axios-wrapper@^1.0.0":\n  version "1.0.0"\n',
    });
    const result = spawnSync("node", ["scripts/check-banned-packages.mjs"], {
      encoding: "utf8",
      cwd: scratch,
    });
    expect(result.status).toBe(0);
  }, 30_000);

  it("H-1134: detects a scoped banned package in a v1 lockfile `dependencies` tree", () => {
    const scratch = scratchWith({
      "package.json": JSON.stringify({ name: "probe", version: "1.0.0" }),
      // npm v1 keys a scoped package by its full `@scope/name`.
      "package-lock.json": JSON.stringify({
        name: "probe",
        lockfileVersion: 1,
        dependencies: {
          "@openclaw-ai/openclawai": { version: "1.0.0" },
        },
      }),
    });
    const result = spawnSync("node", ["scripts/check-banned-packages.mjs"], {
      encoding: "utf8",
      cwd: scratch,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@openclaw-ai/openclawai");
  }, 30_000);
});
