/**
 * Red/green proof for the two drift gates (Phase 164.3, VAC-04 + VAC-08).
 *
 * ⛔ FOUNDER RULE, MACHINE-CHECKED HERE: a control that cannot fail is worse
 * than no control. Every case below drives a real invocation of the real shell
 * script with a stubbed data source, and asserts the EXIT CODE — the only
 * channel CI reads. A gate is only shipped once this file proves it goes red
 * with the condition present and green with it absent.
 *
 * Both gates take their live-database access through an INJECTABLE command
 * (`BODY_FETCH_CMD`, `LEDGER_QUERY_CMD`) precisely so this file can exercise
 * them without touching PROD or the SHARED TEST database.
 *
 * ⚠️ SCOPE BOUNDARY, stated rather than implied: these cases prove the gates'
 * DECISION LOGIC and exit codes. They do not prove the SQL the CI steps hand to
 * psql — that is proven by the object-level measurements recorded in
 * 164.3-CONTEXT.md (VERIFIED CORRECTION 1) and by the first live run.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeSql } from "../../scripts/sql-body-normalize.mjs";
import { createHash } from "node:crypto";

const PROD_GATE = "scripts/prod-body-drift-check.sh";
const LEDGER_GATE = "scripts/test-ledger-drift-check.sh";

/** Credentials the VAC-04 gate asserts the PRESENCE of. Values are never read. */
const FAKE_CREDS = {
  SUPABASE_PROJECT_REF: "stub-ref",
  SUPABASE_ACCESS_TOKEN: "stub-token",
  SUPABASE_DB_PASSWORD: "stub-password",
};

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "drift-check-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(script: string, env: Record<string, string>) {
  const res = spawnSync("bash", [script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

/** A stub fetcher: `stub.sh <name>` cats live/<name>.sql, or emits nothing. */
function writeStubFetcher(dir: string): string {
  const p = join(dir, "stub-fetch.sh");
  writeFileSync(
    p,
    [
      "#!/usr/bin/env bash",
      'f="' + join(dir, "live") + '/$1.sql"',
      'if [ -f "$f" ]; then cat "$f"; fi',
      "exit 0",
    ].join("\n"),
  );
  chmodSync(p, 0o755);
  return p;
}

const COMMITTED_BODY =
  "CREATE OR REPLACE FUNCTION public.demo_fn(p_id UUID)\nRETURNS UUID\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  RETURN p_id;\nEND\n$$;";

/** Same code, re-rendered the way pg_get_functiondef/pg_dump renders it. */
const PROD_BODY_EQUIVALENT =
  "CREATE OR REPLACE FUNCTION public.demo_fn(p_id uuid)\n RETURNS uuid\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n    -- an out-of-band comment, and different indentation\n    RETURN p_id;\nEND\n$function$\n";

/** Genuine drift: a different body. This is DRIFT-02's shape. */
const PROD_BODY_DRIFTED =
  "CREATE OR REPLACE FUNCTION public.demo_fn(p_id uuid)\n RETURNS uuid\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n  RETURN gen_random_uuid();\nEND\n$function$\n";

function prodBodyHash(rendered: string): string {
  const m = /AS \$function\$([\s\S]*)\$function\$/.exec(rendered);
  if (!m) throw new Error("fixture is not shaped as expected");
  return createHash("sha256").update(normalizeSql(m[1]), "utf8").digest("hex");
}

/** Lay out snapshot/, live/ and migrations/ and return the env for the gate. */
function scaffoldProdCase(
  dir: string,
  opts: { prodBody?: string; migrationExtra?: string; snapshot?: boolean },
): Record<string, string> {
  mkdirSync(join(dir, "snapshot"), { recursive: true });
  mkdirSync(join(dir, "live"), { recursive: true });
  mkdirSync(join(dir, "migrations"), { recursive: true });

  if (opts.snapshot !== false) {
    writeFileSync(join(dir, "snapshot", "demo_fn.sql"), COMMITTED_BODY);
  }
  if (opts.prodBody !== undefined) {
    writeFileSync(join(dir, "live", "demo_fn.sql"), opts.prodBody);
  }
  const migration = join(dir, "migrations", "20260829120000_demo.sql");
  writeFileSync(migration, `${opts.migrationExtra ?? ""}\n${COMMITTED_BODY}\n`);

  return {
    ...FAKE_CREDS,
    BODY_FETCH_CMD: `bash ${writeStubFetcher(dir)}`,
    CHANGED_MIGRATIONS: migration,
    SNAPSHOT_DIR: join(dir, "snapshot"),
  };
}

describe("VAC-04 — scripts/prod-body-drift-check.sh", () => {
  it("RED: a missing credential exits 1 and says so — it NEVER skips and never exits 0", () => {
    withTempDir((dir) => {
      const env = scaffoldProdCase(dir, { prodBody: PROD_BODY_EQUIVALENT });
      const { status, out } = run(PROD_GATE, {
        ...env,
        SUPABASE_DB_PASSWORD: "",
      });
      expect(status).toBe(1);
      expect(out).toContain("SUPABASE_DB_PASSWORD is not configured");
      expect(out).toContain("HARD FAILURE, not a skip");
      // Proof it failed on the credential and not on the work: no comparison ran.
      expect(out).not.toContain("body comparison(s)");
    });
  });

  it("RED: the credential check runs BEFORE work detection — an unconfigured gate with nothing to do still exits 1", () => {
    withTempDir((dir) => {
      const env = scaffoldProdCase(dir, { prodBody: PROD_BODY_EQUIVALENT });
      const { status } = run(PROD_GATE, {
        ...env,
        SUPABASE_ACCESS_TOKEN: "",
        CHANGED_MIGRATIONS: "",
        BASE_REF: "HEAD",
      });
      expect(status).toBe(1);
    });
  });

  it("RED: an unset BODY_FETCH_CMD exits 1 — a gate that cannot read cannot pass", () => {
    withTempDir((dir) => {
      const env = scaffoldProdCase(dir, { prodBody: PROD_BODY_EQUIVALENT });
      const { status, out } = run(PROD_GATE, { ...env, BODY_FETCH_CMD: "" });
      expect(status).toBe(1);
      expect(out).toContain("BODY_FETCH_CMD is unset");
    });
  });

  it("RED: a body mismatch with NO acknowledgment exits 1, printing hashes and a hunk count", () => {
    withTempDir((dir) => {
      const env = scaffoldProdCase(dir, { prodBody: PROD_BODY_DRIFTED });
      const { status, out } = run(PROD_GATE, env);
      expect(status).toBe(1);
      expect(out).toContain("PROD's live body is NOT the committed body");
      expect(out).toMatch(/PROD\s+sha256 : [0-9a-f]{64}/);
      expect(out).toMatch(/differing lines\s+: [1-9]/);
    });
  });

  it("GREEN: a mismatch WITH a correct-hash acknowledgment exits 0 and warns", () => {
    withTempDir((dir) => {
      const ack = `-- prod-body-ack: ${prodBodyHash(PROD_BODY_DRIFTED)}`;
      const env = scaffoldProdCase(dir, {
        prodBody: PROD_BODY_DRIFTED,
        migrationExtra: ack,
      });
      const { status, out } = run(PROD_GATE, env);
      expect(status).toBe(0);
      expect(out).toContain("acknowledged by a matching");
      expect(out).toContain("1 acknowledged drift");
    });
  });

  it("RED: an acknowledgment carrying the WRONG hash does NOT wave drift through", () => {
    withTempDir((dir) => {
      // The hash of the COMMITTED body, not of PROD's — the shape of an ack
      // written without looking at what PROD actually holds.
      const wrong = createHash("sha256")
        .update(normalizeSql("\nBEGIN\n  RETURN p_id;\nEND\n"), "utf8")
        .digest("hex");
      const env = scaffoldProdCase(dir, {
        prodBody: PROD_BODY_DRIFTED,
        migrationExtra: `-- prod-body-ack: ${wrong}`,
      });
      const { status } = run(PROD_GATE, env);
      expect(status).toBe(1);
    });
  });

  it("GREEN: bodies differing ONLY by comments and formatting exit 0 (D-05)", () => {
    withTempDir((dir) => {
      const env = scaffoldProdCase(dir, { prodBody: PROD_BODY_EQUIVALENT });
      const { status, out } = run(PROD_GATE, env);
      expect(status).toBe(0);
      expect(out).toContain("no unacknowledged repo-vs-PROD body drift");
      expect(out).toContain("1 match");
    });
  });

  it("GREEN: a function absent from PROD is a NEW function, not drift", () => {
    withTempDir((dir) => {
      const env = scaffoldProdCase(dir, {});
      const { status, out } = run(PROD_GATE, env);
      expect(status).toBe(0);
      expect(out).toContain("absent in PROD");
    });
  });

  it("RED: PROD has the function but the committed snapshot does not — stale snapshot, fail loud", () => {
    withTempDir((dir) => {
      const env = scaffoldProdCase(dir, {
        prodBody: PROD_BODY_EQUIVALENT,
        snapshot: false,
      });
      const { status, out } = run(PROD_GATE, env);
      expect(status).toBe(1);
      expect(out).toContain("The snapshot is STALE");
    });
  });

  it("RED: a fetcher that ERRORS exits 1, and its stderr is withheld from the public log", () => {
    withTempDir((dir) => {
      const env = scaffoldProdCase(dir, { prodBody: PROD_BODY_EQUIVALENT });
      const bad = join(dir, "boom.sh");
      writeFileSync(
        bad,
        '#!/usr/bin/env bash\necho "postgresql://user:pw@host:5432/db" >&2\nexit 7\n',
      );
      chmodSync(bad, 0o755);
      const { status, out } = run(PROD_GATE, {
        ...env,
        BODY_FETCH_CMD: `bash ${bad}`,
      });
      expect(status).toBe(1);
      expect(out).toContain("stderr withheld");
      expect(out).not.toContain("postgresql://");
    });
  });

  it("REDACTION: a successful run prints no body text (public repo, T-164.3-04)", () => {
    withTempDir((dir) => {
      const env = scaffoldProdCase(dir, { prodBody: PROD_BODY_EQUIVALENT });
      const { out } = run(PROD_GATE, env);
      expect(out).not.toContain("gen_random_uuid");
      expect(out).not.toContain("RETURN p_id");
      expect(out).not.toContain("out-of-band comment");
    });
  });
});

// ── VAC-08 ───────────────────────────────────────────────────────────────────

/** A stub ledger query: emits the names it was told are MISSING from the ledger. */
function writeStubLedger(
  dir: string,
  missing: string[],
  advisory: string[] = [],
): string {
  const p = join(dir, "stub-ledger.sh");
  writeFileSync(
    p,
    [
      "#!/usr/bin/env bash",
      '# $1 = "missing" | "extra"',
      'if [ "$1" = "missing" ]; then',
      "  true",
      ...missing.map((m) => `  echo "${m}"`),
      "else",
      "  true",
      ...advisory.map((m) => `  echo "${m}"`),
      "fi",
      "exit 0",
    ].join("\n"),
  );
  chmodSync(p, 0o755);
  return p;
}

function scaffoldLedgerCase(
  dir: string,
  opts: { missing?: string[]; testBody?: string; snapshot?: boolean },
): Record<string, string> {
  mkdirSync(join(dir, "snapshot"), { recursive: true });
  mkdirSync(join(dir, "live"), { recursive: true });
  mkdirSync(join(dir, "migrations"), { recursive: true });
  writeFileSync(
    join(dir, "migrations", "20260829120000_demo.sql"),
    COMMITTED_BODY,
  );
  if (opts.snapshot !== false) {
    writeFileSync(join(dir, "snapshot", "demo_fn.sql"), COMMITTED_BODY);
  }
  writeFileSync(
    join(dir, "live", "demo_fn.sql"),
    opts.testBody ?? PROD_BODY_EQUIVALENT,
  );

  return {
    TEST_SUPABASE_DB_URL: "stub-dsn-never-used",
    LEDGER_QUERY_CMD: `bash ${writeStubLedger(dir, opts.missing ?? [])}`,
    BODY_FETCH_CMD: `bash ${writeStubFetcher(dir)}`,
    MIGRATIONS_DIR: join(dir, "migrations"),
    SNAPSHOT_DIR: join(dir, "snapshot"),
    BODY_CHECK_FUNCTIONS: "demo_fn",
  };
}

describe("VAC-08 — scripts/test-ledger-drift-check.sh", () => {
  it("RED: a repo migration with no matching schema_migrations.name row exits 1 and names it", () => {
    withTempDir((dir) => {
      const env = scaffoldLedgerCase(dir, { missing: ["20260829120000_demo"] });
      const { status, out } = run(LEDGER_GATE, env);
      expect(status).toBe(1);
      expect(out).toContain("20260829120000_demo");
      expect(out).toContain("not present in the TEST ledger");
    });
  });

  it("RED: a TEST body that differs from the committed snapshot exits 1 with hashes only", () => {
    withTempDir((dir) => {
      const env = scaffoldLedgerCase(dir, { testBody: PROD_BODY_DRIFTED });
      const { status, out } = run(LEDGER_GATE, env);
      expect(status).toBe(1);
      expect(out).toContain("does not match the committed body");
      expect(out).not.toContain("gen_random_uuid");
    });
  });

  it("GREEN: every migration present and every body matching after normalization exits 0", () => {
    withTempDir((dir) => {
      const env = scaffoldLedgerCase(dir, {});
      const { status, out } = run(LEDGER_GATE, env);
      expect(status).toBe(0);
      expect(out).toContain("ledger and body checks clean");
    });
  });

  it("RED: with NO injected commands and no TEST_SUPABASE_DB_URL, the real path exits 1 — never a silent skip", () => {
    withTempDir((dir) => {
      const env = scaffoldLedgerCase(dir, {});
      // Drop the seams so the gate takes its production route, then withhold
      // the DSN. This is the sql-tests "Run SQL self-tests" contract, not the
      // mutex step's exit 0: a work step with no credential FAILS.
      const { status, out } = run(LEDGER_GATE, {
        ...env,
        LEDGER_QUERY_CMD: "",
        BODY_FETCH_CMD: "",
        TEST_SUPABASE_DB_URL: "",
      });
      expect(status).toBe(1);
      expect(out).toContain("TEST_SUPABASE_DB_URL is required and is not set");
    });
  });

  it("RED: an EMPTY migrations corpus is an error, not a quiet pass (F11's shape)", () => {
    withTempDir((dir) => {
      const env = scaffoldLedgerCase(dir, {});
      rmSync(join(dir, "migrations"), { recursive: true, force: true });
      mkdirSync(join(dir, "migrations"), { recursive: true });
      const { status, out } = run(LEDGER_GATE, env);
      expect(status).toBe(1);
      expect(out).toContain("that is not a pass");
    });
  });

  it("--self-test proves BOTH red modes and the green path, and exits 0", () => {
    const res = spawnSync("bash", [LEDGER_GATE, "--self-test"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    expect(res.status).toBe(0);
    expect(out).toContain("missing-ledger-row RED");
    expect(out).toContain("body-mismatch RED");
    expect(out).toContain("green path");
  });

  it("--self-test FAILS when the gate is neutered (the self-test itself can fail)", () => {
    // Drives the gate through its own stub seam with a condition present but
    // the assertion inverted, proving the self-test's arms are not decorative.
    const res = spawnSync(
      "bash",
      [LEDGER_GATE, "--self-test", "--expect-inverted"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );
    expect(res.status).toBe(1);
  });
});

describe("IN-02 — no INVISIBLE characters in the Phase 164.3 gate scripts", () => {
  // Two of these files carried a U+200B inside a JSDoc block comment, put there
  // to stop the comment terminating early (`a/*c*<ZWSP>/b`). It worked, and it
  // is the wrong tool: an invisible control character cannot be seen in review,
  // it trips this environment's injection scanners on every read, and this repo
  // already has one measured file that a bare `grep` is silently blind to
  // because of an embedded NUL. A gate script is the last place a reader should
  // have to trust that what they see is what is there. Escape visibly instead
  // (`a/*c*\/b`).
  //
  // Read with node:fs, never shell grep, for the reason above.
  const SCRIPTS = [
    "scripts/sql-body-normalize.mjs",
    "scripts/verify-plan-anchors.mjs",
    "scripts/lint-sql-gates.mjs",
    "scripts/mutation-runner/run.mjs",
    "scripts/mutation-runner/parse.mjs",
    "scripts/prod-body-drift-check.sh",
    "scripts/test-ledger-drift-check.sh",
    "scripts/pg-lane/run.sh",
    "scripts/local-stack/run.sh",
  ];

  /** Zero-width and directional-formatting characters, plus a bare NUL. */
  const INVISIBLE =
    /[ ­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/;

  it("the file list itself is non-empty and every entry exists", () => {
    // Without this, the loop below is satisfied by a typo'd path list.
    expect(SCRIPTS.length).toBeGreaterThan(0);
    for (const rel of SCRIPTS) {
      expect(existsSync(rel), `${rel} is missing — update this list`).toBe(true);
    }
  });

  for (const rel of SCRIPTS) {
    it(`${rel} carries no zero-width or bidi control characters`, () => {
      const offenders = readFileSync(rel, "utf8")
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => INVISIBLE.test(line))
        .map(({ n, line }) => `${rel}:${n}: ${JSON.stringify(line.trim().slice(0, 100))}`);
      expect(
        offenders,
        `Invisible character(s) found. They cannot be seen in review and they trip secret/injection scanners. ` +
          `If you needed to stop a block comment terminating, escape it visibly: a/*c*\\/b.`,
      ).toEqual([]);
    });
  }
});

describe("OPS-08-F9 — the anti-skip floors are already raised (verify and record, do NOT change)", () => {
  it("ci.yml still declares SENTINEL_FLOOR=8 and ARMS_FLOOR=166 at HEAD", () => {
    // VERIFIED CORRECTION 3: the TODOS entry prescribes a 7->8 / 63->68 raise
    // that is ALREADY DONE (and ARMS is far past it). This pins the measured
    // values so a silent REDUCTION is caught; it is not a raise.
    const res = spawnSync(
      "grep",
      ["-ac", "SENTINEL_FLOOR=8", ".github/workflows/ci.yml"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );
    expect(res.status).toBe(0);
    expect(Number(res.stdout.trim())).toBeGreaterThanOrEqual(1);

    const arms = spawnSync(
      "grep",
      ["-ac", "ARMS_FLOOR=166", ".github/workflows/ci.yml"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );
    expect(arms.status).toBe(0);
    expect(Number(arms.stdout.trim())).toBeGreaterThanOrEqual(1);
  });
});
