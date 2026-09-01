/**
 * WR-05 — the local-stack teardown assertion must not pass when its own
 * producer fails.
 *
 * ⛔ THE DEFECT. `scripts/local-stack/run.sh`'s self-test ends with the one
 * control that proves the D-04 orphan class is closed: nothing this lane
 * started may survive `down`. It was written as
 *
 *     leftover="$(running_project_containers || true)"
 *     if [ -z "$leftover" ]; then count=0; else count=…; fi
 *
 * and the `|| true` collapsed EVERY `docker ps` failure — daemon stopped,
 * socket permission denied, docker not on PATH — into an empty string, which
 * became `count=0`, which printed "surviving <id> containers -> 0" and reached
 * SELF-TEST PASSED. "Could not count" and "counted zero" shared one code path,
 * inside the assertion whose entire purpose is the count. Exact triggering
 * input: stop the Docker daemon after `cmd_down` returns.
 *
 * D-04 is not an abstract worry here. Measured 2026-08-28: the predecessor
 * harness left 27 orphaned Postgres volumes (904 MB) and a container up 10
 * days, contributing to a disk-exhaustion incident.
 *
 * ⭐ WHY THIS FILE CAN EXIST AT ALL. `run.sh` reaches Docker through a
 * `DOCKER_BIN` seam and exposes `--assert-teardown`, which runs ONLY the
 * assertion. So all three arms below run with no Docker daemon, no Supabase
 * CLI and no stack — the assertion is driven directly, which is the only way
 * to prove a cleanup control can fail without first creating the mess.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LANE = "scripts/local-stack/run.sh";

/** Write a fake `docker` and return its path. */
function fakeDocker(dir: string, body: string): string {
  const p = join(dir, "fake-docker.sh");
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

function assertTeardown(dockerBody: string): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "local-stack-assert-"));
  try {
    const res = spawnSync("bash", [LANE, "--assert-teardown"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DOCKER_BIN: fakeDocker(dir, dockerBody) },
    });
    return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("WR-05 — 'could not count' never reads as 'counted zero'", () => {
  it("GREEN: docker exits 0 with no names — a MEASURED zero passes", () => {
    const { status, out } = assertTeardown("exit 0");
    expect(status).toBe(0);
    expect(out).toContain("containers -> 0");
    // The line says it measured, so a reader can tell this zero from the other.
    expect(out).toContain("docker ps exited 0");
  });

  it("RED: docker exits NON-ZERO — the assertion refuses to pass on an unread count", () => {
    // The daemon-stopped case, verbatim.
    const { status, out } = assertTeardown(
      'echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock." >&2\nexit 1',
    );
    expect(status).toBe(1);
    expect(out).toContain("MEASURE_FAIL");
    expect(out).toContain("could not be evaluated");
    expect(out).not.toContain("containers -> 0");
  });

  it("RED: docker is not executable at all — the same refusal, not a silent zero", () => {
    const { status, out } = assertTeardown("exit 127");
    expect(status).toBe(1);
    expect(out).toContain("MEASURE_FAIL");
    expect(out).not.toContain("containers -> 0");
  });

  it("RED: docker exits 0 and names survivors — the original purpose still bites", () => {
    const { status, out } = assertTeardown(
      'printf "%s\\n" supabase_db_quantalyze-local-stack supabase_kong_quantalyze-local-stack\nexit 0',
    );
    expect(status).toBe(1);
    expect(out).toContain("container(s) survived teardown");
    expect(out).toContain("supabase_db_quantalyze-local-stack");
  });
});

describe("IN-03 — the env handoff's protection is credited to the mechanism that provides it", () => {
  it("no `umask` sits in write_env_handoff claiming to create the file", () => {
    // `mktemp` creates at 0600; `umask` affects neither an existing file's mode
    // nor a `>` redirect. A comment crediting the wrong mechanism is how the
    // real protection gets moved or dropped by the next reader.
    const res = spawnSync(
      "node",
      [
        "-e",
        `const fs=require("fs");
         const t=fs.readFileSync("${LANE}","utf8");
         const start=t.indexOf("write_env_handoff() {");
         const end=t.indexOf("\\n}", start);
         if (start<0||end<0) { console.log("FUNCTION-NOT-FOUND"); process.exit(0); }
         const body=t.slice(start,end);
         console.log(/^[ \\t]*umask\\b/m.test(body) ? "HAS-UMASK" : "NO-UMASK");
         console.log(/chmod 600/.test(body) ? "HAS-CHMOD" : "NO-CHMOD");
         console.log(/mktemp/.test(body) ? "HAS-MKTEMP" : "NO-MKTEMP");`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const out = res.stdout.trim().split("\n");
    expect(out).toContain("NO-UMASK");
    // The actual protections must still be there — otherwise this test would
    // pass on a function that protects nothing.
    expect(out).toContain("HAS-CHMOD");
    expect(out).toContain("HAS-MKTEMP");
  });
});

describe("R2-I03 — every dispatched mode is documented, and usage() prints only the header", () => {
  // The two new seams (`--assert-teardown`, `--print-baseline-path`) were
  // dispatched but absent from the INVOCATIONS block, which is the block
  // `usage()` prints — so `run.sh` with no argument documented neither. And
  // `usage()` was a hardcoded `sed -n '3,45p'`; line 45 became
  // `set -euo pipefail` once the header grew, so the help text ended with a
  // shell option.
  //
  // Derived on both sides rather than asserted as a list: the modes come from
  // the `case` dispatch, the help text from running the script. A mode added
  // to the dispatch without a line in the header reds this.
  const usage = () => {
    const res = spawnSync("bash", [LANE], { cwd: process.cwd(), encoding: "utf8" });
    // A no-argument run is a usage error by design.
    expect(res.status).toBe(2);
    return `${res.stdout ?? ""}${res.stderr ?? ""}`;
  };

  it("the help text names every mode the case statement dispatches", () => {
    const src = readFileSync(LANE, "utf8");
    const block = src.slice(src.indexOf('case "${1:-}" in'));
    const modes = [...block.matchAll(/^ {2}(--?[a-z-]+|up|down)\)/gm)].map((m) => m[1]);

    // Non-vacuity: an empty mode list would satisfy every assertion below.
    expect(modes.length, "found no dispatched modes — the case statement moved").toBeGreaterThan(3);

    const text = usage();
    for (const mode of modes) {
      // ⛔ R3-I01: `expect(text).toContain("up")` is UNFALSIFIABLE. `modes`
      // includes the bare words `up` and `down`, and the header's own
      // "run.sh up --no-schema" line — or the word "backup", or "up to" in any
      // sentence — satisfies a bare substring check. Two of the five assertions
      // this loop makes could not have failed.
      //
      // Anchor a bare-word mode to the invocation it must appear in. The `--`
      // modes carry their own signal and are checked as-is.
      const needle = mode.startsWith("--") ? mode : `run.sh ${mode}`;
      expect(
        text,
        `mode "${mode}" is dispatched but absent from the INVOCATIONS block (looked for ${JSON.stringify(needle)})`,
      ).toContain(needle);
    }
  });

  it("R3-I01/SP-C04: the anchored check FIRES on the real header with the invocation removed; a bare one does not", () => {
    // ⛔ SP-C04. This arm used to read:
    //     const prose = "the stack comes up and the baseline is loaded";
    //     expect(prose).toContain("up");
    //     expect(prose).not.toContain("run.sh up");
    // Both assertions are about a string literal defined two lines above. They
    // are true regardless of run.sh, of usage(), of anything in the repo —
    // they would still pass if the entire lane were deleted. Its stated
    // purpose was "non-vacuity for the arm above, DRIVEN rather than argued",
    // and it was neither.
    //
    // So it is driven now: the SUBJECT is mutilated (the invocation line is
    // deleted from the REAL usage() text) and the two needles are applied to
    // what comes back.
    const text = usage();
    for (const mode of ["up", "down"]) {
      const anchored = `run.sh ${mode}`;
      expect(text, `the real header must carry "${anchored}", or the mutilation below removes nothing`).toContain(anchored);

      const mutilated = text
        .split("\n")
        .filter((l) => !l.includes(anchored))
        .join("\n");
      // Calibration: the deletion really happened.
      expect(mutilated.length, "the mutilation removed nothing").toBeLessThan(text.length);

      // ⭐ THE POINT. On the mutilated header the ANCHORED needle fires…
      expect(
        mutilated,
        `the anchored needle survived deletion of every "${anchored}" line — it is not anchored to anything`,
      ).not.toContain(anchored);
      // …while a BARE one is still satisfied, by the header's own prose. That
      // is why the loop above cannot use a bare needle.
      expect(
        mutilated,
        `the bare word "${mode}" no longer appears at all, so this comparison shows nothing — pick a mode the header discusses in prose`,
      ).toContain(mode);
    }
  });

  it("the help text stops at the header — it does not print shell code", () => {
    const text = usage();
    expect(text).toContain("INVOCATIONS");
    expect(text, "usage() ran past the header and printed a shell directive").not.toContain(
      "set -euo pipefail",
    );
    // Every non-blank line it prints is a comment line.
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      expect(line, `usage() printed a non-comment line: ${JSON.stringify(line)}`).toMatch(/^\s*#/);
    }
  });
});
