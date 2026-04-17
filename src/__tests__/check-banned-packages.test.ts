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

  it("exits 1 for every other banned name in the CLAUDE.md table", () => {
    // The four banned packages per ~/.claude/CLAUDE.md:
    //   axios (tested above), react-native-international-phone-number,
    //   react-native-country-select, @openclaw-ai/openclawai.
    // We exercise the other three here to prove the matcher isn't
    // axios-only.
    const otherBanned = [
      "react-native-international-phone-number",
      "react-native-country-select",
      "@openclaw-ai/openclawai",
    ];

    for (const name of otherBanned) {
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
});
