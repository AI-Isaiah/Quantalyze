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
  readdirSync,
  existsSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

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

/**
 * A stub PROD function-name index (WR-01). It lists the names the fetcher's
 * source really holds, so the gate can tell "genuinely not in PROD" from "the
 * extractor returned nothing". `names` defaults to whatever is in `live/`.
 */
function writeStubNameIndex(
  dir: string,
  names?: string[],
  filename = "stub-index.sh",
): string {
  const p = join(dir, filename);
  const body =
    names === undefined
      ? [
          `for f in "${join(dir, "live")}"/*.sql; do`,
          '  [ -e "$f" ] || continue',
          '  basename "$f" .sql',
          "done",
        ]
      : names.map((n) => `echo "${n}"`);
  writeFileSync(
    p,
    ["#!/usr/bin/env bash", ...body, "exit 0"].join("\n"),
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
  opts: {
    prodBody?: string;
    migrationExtra?: string;
    snapshot?: boolean;
    /** Override the PROD name index. Undefined = derive it from live/. */
    indexNames?: string[];
    /**
     * Override the INDEPENDENT cross-check index (SP-C05). Undefined = the
     * same names as the primary, i.e. two readings that agree.
     */
    xcheckNames?: string[];
    /** Replace the migration body outright (e.g. to use another schema). */
    migrationBody?: string;
  },
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
  writeFileSync(
    migration,
    `${opts.migrationExtra ?? ""}\n${opts.migrationBody ?? COMMITTED_BODY}\n`,
  );

  const indexNames =
    opts.indexNames ??
    (opts.prodBody === undefined ? ["other_fn"] : ["demo_fn", "other_fn"]);

  return {
    ...FAKE_CREDS,
    BODY_FETCH_CMD: `bash ${writeStubFetcher(dir)}`,
    // Always non-empty: the gate fails closed on an empty index, and an index
    // derived purely from live/ would be empty in the "absent from PROD" cases.
    // `other_fn` stands for the rest of PROD's catalogue.
    BODY_NAME_INDEX_CMD: `bash ${writeStubNameIndex(dir, indexNames)}`,
    // SP-C05: the gate now requires a SECOND, independently derived index and
    // unions the two. These arms stub it to agree with the primary, so they
    // keep measuring what they were written to measure. The arms that prove
    // the two are really different code paths are in their own describe block
    // below, and they use the REAL CI commands rather than stubs.
    BODY_NAME_INDEX_XCHECK_CMD: `bash ${writeStubNameIndex(dir, opts.xcheckNames ?? indexNames, "stub-index-xcheck.sh")}`,
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

  it("GREEN: a function MEASURED absent from PROD's name index is a NEW function, not drift", () => {
    withTempDir((dir) => {
      const env = scaffoldProdCase(dir, {});
      const { status, out } = run(PROD_GATE, env);
      expect(status).toBe(0);
      expect(out).toContain("measured absent");
      // The zero is stated, not silent — it is the one case where a green run
      // legitimately compares nothing.
      expect(out).toContain("ZERO bodies compared");
      expect(out).toContain("measured zero, not an unread one");
    });
  });

  // ── WR-01 ────────────────────────────────────────────────────────────────
  // `--extract-fn` exits 0 with EMPTY stdout for a name it cannot find, and
  // the gate read that as "absent in PROD — a NEW function (pass)". So any
  // regression in the extractor's name matching turned every name into a pass
  // and the whole gate green having compared nothing.

  it("RED: a name that IS in PROD's index but yields no body is an EXTRACTOR failure, not a new function", () => {
    withTempDir((dir) => {
      // No live/demo_fn.sql (the fetcher returns empty), but PROD's index says
      // demo_fn exists. That combination can only mean extraction failed.
      const env = scaffoldProdCase(dir, { indexNames: ["demo_fn", "other_fn"] });
      const { status, out } = run(PROD_GATE, env);
      expect(status).toBe(1);
      expect(out).toContain("IS in the PROD source's function-name index");
      expect(out).toContain("extraction failure, not a new");
      expect(out).not.toContain("no unacknowledged repo-vs-PROD body drift");
    });
  });

  it("RED: an unset BODY_NAME_INDEX_CMD exits 1 — absence must be measured, not inferred from an empty pipe", () => {
    withTempDir((dir) => {
      const env = scaffoldProdCase(dir, { prodBody: PROD_BODY_EQUIVALENT });
      const { status, out } = run(PROD_GATE, {
        ...env,
        BODY_NAME_INDEX_CMD: "",
      });
      expect(status).toBe(1);
      expect(out).toContain("BODY_NAME_INDEX_CMD is unset");
    });
  });

  it("RED: an EMPTY PROD name index fails closed — a broken index is not a database with no functions", () => {
    withTempDir((dir) => {
      const env = scaffoldProdCase(dir, {
        prodBody: PROD_BODY_EQUIVALENT,
        indexNames: [],
      });
      const { status, out } = run(PROD_GATE, env);
      expect(status).toBe(1);
      expect(out).toContain("index came back EMPTY");
    });
  });

  it("RED: an index command that ERRORS exits 1, and its stderr is withheld", () => {
    withTempDir((dir) => {
      const env = scaffoldProdCase(dir, { prodBody: PROD_BODY_EQUIVALENT });
      const bad = join(dir, "index-boom.sh");
      writeFileSync(
        bad,
        // No user:password here ON PURPOSE. The assertion pins `not.toContain("postgresql://")`,
        // so a credential adds nothing to what is proven — but a password-shaped DSN trips the
        // pre-push credential scanner on every push of this file (measured 2026-08-29, 2 HIGH).
        '#!/usr/bin/env bash\necho "postgresql://host:5432/db" >&2\nexit 9\n',
      );
      chmodSync(bad, 0o755);
      const { status, out } = run(PROD_GATE, {
        ...env,
        BODY_NAME_INDEX_CMD: `bash ${bad}`,
      });
      expect(status).toBe(1);
      expect(out).toContain("could not index PROD's function names");
      expect(out).not.toContain("postgresql://");
    });
  });

  it("VAC04-C3 RED: a grep that ERRORS on the name index is a MEASURE_FAIL, not 'measured absent'", () => {
    // ⛔ [VAC04-C3]. The membership test was a bare
    //     if grep -aqxF -- "$fname" "$TMP/prod-names.txt"; then … else … fi
    // and `grep` exits 0 on a match, 1 on NO match, and >= 2 on an ERROR
    // (unreadable file, I/O failure, a broken locale). Exit 1 and exit 2 both
    // fall to the SAME `else`, which prints
    //     "measured absent — … Treated as a NEW function (pass)."
    // So an index the gate COULD NOT READ was reported as an index it read and
    // found nothing in — turning the one fail-CLOSED arm of this gate (WR-01's
    // "absence is a MEASUREMENT") into a fail-OPEN one. Repeated across every
    // name, it is the whole gate green having compared nothing.
    //
    // MEASURED at this plan's base 420b8fcb, this exact fixture:
    //   "  demo_fn: measured absent — not in the PROD source's 1-name index.
    //    Treated as a NEW function (pass)."
    //   "::notice::…: ZERO bodies compared — all 1 function(s) … measured absent
    //    … This is a measured zero, not an unread one."          exit 0
    // …while the index read had failed outright.
    //
    // Driven with the SP-M01 idiom: a PATH-shim `grep` that delegates to the
    // real one for everything EXCEPT this one call. Keyed on the FLAGS AND the
    // file (`-aqxF` + `*prod-names.txt`) rather than the file alone, because
    // `PROD_NAME_COUNT` counts the same file with `-ac` — targeting the file
    // alone would redden the run one step earlier and prove the wrong branch.
    withTempDir((dir) => {
      const bin = join(dir, "bin");
      mkdirSync(bin, { recursive: true });
      const realGrep = spawnSync("bash", ["-c", "command -v grep"], {
        encoding: "utf8",
      }).stdout.trim();
      expect(realGrep, "no real grep on PATH to delegate to").not.toBe("");
      writeFileSync(
        join(bin, "grep"),
        [
          "#!/usr/bin/env bash",
          "flag=0; idx=0",
          'for a in "$@"; do',
          '  case "$a" in',
          "    -aqxF) flag=1 ;;",
          "    *prod-names.txt) idx=1 ;;",
          "  esac",
          "done",
          '[ "$flag" = 1 ] && [ "$idx" = 1 ] && exit 2',
          `exec ${realGrep} "$@"`,
        ].join("\n"),
      );
      chmodSync(join(bin, "grep"), 0o755);

      // No live/demo_fn.sql -> the fetcher returns empty; the index does not
      // hold demo_fn -> the UNSHIMMED run takes the measured-absent pass. So
      // the only thing that can change this run's verdict is the broken grep.
      const env = scaffoldProdCase(dir, {});
      const clean = run(PROD_GATE, env);
      expect(clean.status, "the fixture must be GREEN before the grep is broken").toBe(0);
      expect(clean.out).toContain("measured absent");

      const { status, out } = run(PROD_GATE, {
        ...env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      });
      expect(status, "an UNREADABLE index was reported as an index that measured absence").toBe(1);
      expect(out).toContain("MEASURE_FAIL");
      // Diagnostic-first (SC-7): it must name the file, the searched name and
      // the exit code — a conclusion without its evidence is the thing this
      // phase exists to stop.
      expect(out).toContain("prod-names.txt");
      expect(out).toContain("demo_fn");
      expect(out).toMatch(/grep exited\s*:\s*2\b/);
      // The fail-OPEN text must be GONE — the whole point of the branch.
      expect(out).not.toContain("Treated as a NEW function (pass)");
      expect(out).not.toContain("no unacknowledged repo-vs-PROD body drift");
    });
  });

  it("VAC04-C3 CONTROL: exit 1 (genuinely not in a READABLE index) is still a measured-absent pass", () => {
    // The other direction. A three-way branch that treats 1 like 2 fails every
    // add-a-function PR; this arm is what stops the C3 fix from being a fix
    // that breaks the gate's only legitimate silent pass. It is the standing
    // arm at "GREEN: a function MEASURED absent…", restated here so the C3
    // branching carries its own control beside it.
    withTempDir((dir) => {
      const env = scaffoldProdCase(dir, { indexNames: ["other_fn"] });
      const { status, out } = run(PROD_GATE, env);
      expect(status, out).toBe(0);
      expect(out).toContain("Treated as a NEW function (pass)");
      expect(out).not.toContain("MEASURE_FAIL");
    });
  });

  it("RED: ZERO comparisons for any reason OTHER than measured absence is a MEASURE_FAIL", () => {
    withTempDir((dir) => {
      // A floor on `checked` alone would be wrong — a PR that only ADDS
      // functions legitimately compares nothing. So the floor is: zero
      // comparisons is acceptable ONLY when every named function was measured
      // absent. Here the fetcher errors, so neither happened.
      const env = scaffoldProdCase(dir, { prodBody: PROD_BODY_EQUIVALENT });
      const boom = join(dir, "fetch-boom.sh");
      writeFileSync(boom, "#!/usr/bin/env bash\nexit 3\n");
      chmodSync(boom, 0o755);
      const { status, out } = run(PROD_GATE, {
        ...env,
        BODY_FETCH_CMD: `bash ${boom}`,
      });
      expect(status).toBe(1);
      expect(out).toContain("ZERO bodies compared, and only 0 of 1");
      expect(out).not.toContain("no unacknowledged repo-vs-PROD body drift");
    });
  });

  it("RED: a definition in a schema the PROD dump does not cover exits 1 instead of passing as 'new'", () => {
    withTempDir((dir) => {
      // The dump is taken with `--schema public`. `private.hidden_fn` is absent
      // from it whatever PROD holds, so "absent = new = pass" would be a pass
      // for something never looked at.
      const env = scaffoldProdCase(dir, {
        migrationBody:
          "CREATE OR REPLACE FUNCTION private.hidden_fn(p_id UUID)\nRETURNS UUID\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  RETURN p_id;\nEND\n$$;",
        indexNames: ["other_fn"],
      });
      const { status, out } = run(PROD_GATE, env);
      expect(status).toBe(1);
      expect(out).toContain("private.hidden_fn");
      expect(out).toContain("covers only schema(s): public");
    });
  });

  it("GREEN: an UNQUALIFIED definition is accepted — it resolves through search_path into the dumped schema", () => {
    withTempDir((dir) => {
      // 56 of the repo's own definitions are unqualified (measured
      // 2026-08-29), so refusing them would break every real PR.
      const env = scaffoldProdCase(dir, {
        migrationBody:
          "CREATE OR REPLACE FUNCTION demo_fn(p_id UUID)\nRETURNS UUID\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  RETURN p_id;\nEND\n$$;",
        prodBody: PROD_BODY_EQUIVALENT,
      });
      const { status, out } = run(PROD_GATE, env);
      expect(status).toBe(0);
      expect(out).toContain("1 match");
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
        // Host-only DSN, same reason as above.
        '#!/usr/bin/env bash\necho "postgresql://host:5432/db" >&2\nexit 7\n',
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

  it("R2-W03 RED: a name whose every comparator row is ADVISORY is short in the disposition sum, even beside a name that compared cleanly", () => {
    // ⛔ This is the case the old `accounted != NAME_COUNT` floor could not
    // see. That counter was incremented once on every path through the loop,
    // so it was guaranteed by the loop's structure and could only be reddened
    // by deleting one of its own increments — which is not a proof.
    //
    // The adversarial input, built from OUTSIDE: a fetcher that returns
    // NON-EMPTY text carrying no extractable definition for one of two names.
    // That is what a psql notice, a stray comment or an error printed on
    // stdout looks like. It survives the empty-body check; the comparator
    // emits a single SNAPSHOT_ONLY row, so `rows` is 1 and the zero-rows guard
    // stays quiet; SNAPSHOT_ONLY increments nothing. The SECOND name is what
    // makes it silent — it compares normally, so `checked` is non-zero and the
    // `checked -eq 0` branch stays quiet too.
    //
    // MEASURED before the fix, this exact fixture:
    //   "1 body comparison(s) … 0 measured-absent" for 2 named functions
    //   "::notice:: no unacknowledged repo-vs-PROD body drift"      exit 0
    // …while `ghost_fn`, which PROD's index says EXISTS, was compared against
    // nothing at all.
    withTempDir((dir) => {
      mkdirSync(join(dir, "snapshot"), { recursive: true });
      mkdirSync(join(dir, "live"), { recursive: true });
      mkdirSync(join(dir, "migrations"), { recursive: true });

      const bodyFor = (n: string) => COMMITTED_BODY.replace("demo_fn", n);
      writeFileSync(join(dir, "snapshot", "good_fn.sql"), bodyFor("good_fn"));
      writeFileSync(join(dir, "snapshot", "ghost_fn.sql"), bodyFor("ghost_fn"));
      writeFileSync(join(dir, "live", "good_fn.sql"), bodyFor("good_fn"));
      writeFileSync(join(dir, "live", "ghost_fn.sql"), "-- no rows returned for ghost_fn\n");

      const migration = join(dir, "migrations", "20260829120000_demo.sql");
      writeFileSync(migration, `${bodyFor("good_fn")}\n\n${bodyFor("ghost_fn")}\n`);

      const { status, out } = run(PROD_GATE, {
        ...FAKE_CREDS,
        BODY_FETCH_CMD: `bash ${writeStubFetcher(dir)}`,
        BODY_NAME_INDEX_CMD: `bash ${writeStubNameIndex(dir, ["good_fn", "ghost_fn", "other_fn"])}`,
        BODY_NAME_INDEX_XCHECK_CMD: `bash ${writeStubNameIndex(dir, ["good_fn", "ghost_fn", "other_fn"], "stub-index-xcheck.sh")}`,
        CHANGED_MIGRATIONS: migration,
        SNAPSHOT_DIR: join(dir, "snapshot"),
      });

      expect(status, "the gate reported a pass for a function it compared against nothing").toBe(1);
      expect(out).toContain("the dispositions sum to 1");
      expect(out).toContain("1 compared / 0 measured-absent / 0 failed");
      expect(out).not.toContain("no unacknowledged repo-vs-PROD body drift");
    });
  });

  it("R2-W03 GREEN: the disposition sum closes for each of the three real dispositions", () => {
    // The other direction. A floor that fires on everything is as useless as
    // one that fires on nothing, and this one is subtractive — it must not go
    // red on the states the gate is supposed to accept. One case per tally.
    withTempDir((dir) => {
      // compared
      const env = scaffoldProdCase(dir, { prodBody: PROD_BODY_EQUIVALENT });
      const a = run(PROD_GATE, env);
      expect(a.status, a.out).toBe(0);
      expect(a.out).not.toContain("dispositions sum to");
    });
    withTempDir((dir) => {
      // measured-absent: the name is not in PROD's index at all
      const env = scaffoldProdCase(dir, { indexNames: ["other_fn"] });
      const b = run(PROD_GATE, env);
      expect(b.status, b.out).toBe(0);
      expect(b.out).toContain("measured absent");
      expect(b.out).not.toContain("dispositions sum to");
    });
    withTempDir((dir) => {
      // failed: the fetcher errors. Exit 1, but on the READ failure, never on
      // an accounting complaint — the sum still closes.
      const env = scaffoldProdCase(dir, { prodBody: PROD_BODY_EQUIVALENT });
      const boom = join(dir, "fetch-boom.sh");
      writeFileSync(boom, "#!/usr/bin/env bash\nexit 3\n");
      chmodSync(boom, 0o755);
      const c = run(PROD_GATE, { ...env, BODY_FETCH_CMD: `bash ${boom}` });
      expect(c.status).toBe(1);
      expect(c.out).toContain("the PROD body fetcher failed");
      expect(c.out, "the fetch failure must not ALSO read as an unaccounted name").not.toContain(
        "dispositions sum to",
      );
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

// ── SP-C05 ───────────────────────────────────────────────────────────────────
//
// ⛔ THE DEFECT, AND WHY THE ARMS ABOVE COULD NOT SEE IT.
//
// VAC-04's one silent pass is "measured absent from PROD's index — a NEW
// function". `prod-body-drift-check.sh` claims in prose that the index makes
// that absence "a MEASUREMENT". It did not: the index (`--function-names`) and
// the body fetcher (`--extract-fn`) were the SAME function
// (`extractFunctionDefs`) over the SAME dump, and that function silently
// `continue`s past any definition it cannot parse. A dropped definition was
// therefore missing from BOTH, the two agreed BY CONSTRUCTION, and the gate
// reported a pass.
//
// The arms above could not detect that, because every one of them stubs the
// index with a shell script — proving the helper, never the wiring. So these
// arms drive the REAL commands the workflow pastes, over a REAL file, with the
// measured input.
describe("SP-C05 — 'absent from PROD' must be measured by an instrument that did not produce the absence", () => {
  /** The measured SP-C05 input: a `$` in the identifier is enough. */
  const DOLLAR_FN =
    "CREATE OR REPLACE FUNCTION public.sanitize_user$v2(p uuid)\n" +
    "RETURNS void\nLANGUAGE plpgsql\nAS $fn$\nBEGIN\n" +
    "  DELETE FROM audit_log WHERE user_id = p;\nEND;\n$fn$;\n";

  /** An ordinary function, so no fixture below is a one-definition special case. */
  const PLAIN_FN =
    "CREATE OR REPLACE FUNCTION public.some_other_fn(a int)\n" +
    "RETURNS int LANGUAGE sql AS $$ SELECT a $$;\n";

  const NORMALIZER = "scripts/sql-body-normalize.mjs";
  const NAIVE = "scripts/sql-function-names-naive.mjs";

  /**
   * The gate wired EXACTLY as `.github/workflows/migration-drift-check.yml`
   * wires it — real normalizer, real independent reader, one dump file.
   */
  function realWiring(dumpPath: string) {
    return {
      BODY_FETCH_CMD: `node ${NORMALIZER} --extract-fn ${dumpPath}`,
      BODY_NAME_INDEX_CMD: `node ${NORMALIZER} --function-names ${dumpPath}`,
      BODY_NAME_INDEX_XCHECK_CMD: `node ${NAIVE} ${dumpPath}`,
    };
  }

  function scaffold(dir: string, dumpBody: string) {
    mkdirSync(join(dir, "snapshot"), { recursive: true });
    const dump = join(dir, "prod-dump.sql");
    writeFileSync(dump, dumpBody);
    const migration = join(dir, "20260829120000_dollar.sql");
    writeFileSync(migration, DOLLAR_FN);
    return {
      ...FAKE_CREDS,
      ...realWiring(dump),
      CHANGED_MIGRATIONS: migration,
      SNAPSHOT_DIR: join(dir, "snapshot"),
    };
  }

  // ── The independence itself, measured from the two real programs ──────────
  // If this arm ever reports agreement, every arm below it becomes vacuous:
  // two readings that see the same thing cannot cross-check each other. It is
  // deliberately the FIRST arm.
  it("the two readings genuinely DISAGREE on the measured input — otherwise nothing below proves anything", () => {
    withTempDir((dir) => {
      const f = join(dir, "in.sql");
      writeFileSync(f, DOLLAR_FN);
      const lexer = spawnSync("node", [NORMALIZER, "--function-names", f], {
        encoding: "utf8",
      });
      const naive = spawnSync("node", [NAIVE, f], { encoding: "utf8" });
      expect(lexer.status, "the normalizer must EXIT 0 — it drops the definition silently, which is the whole problem").toBe(0);
      expect(naive.status).toBe(0);
      expect(
        lexer.stdout.trim(),
        "the lexer-based reading is expected to see NOTHING here (readQualifiedName stops at the `$`)",
      ).toBe("");
      expect(
        naive.stdout.trim(),
        "the independent reading MUST see the definition, or it cannot contradict the first",
      ).toBe("sanitize_user$v2");
    });
  });

  it("the independent reader DEPENDS on nothing but node builtins — 'independent' is a claim about the code, so it is read off the code", () => {
    // ⚠️ A raw `not.toContain("sql-body-normalize")` over the file would be
    // WRONG here, and measurably so: the file names the normalizer a dozen
    // times, in its header and in its own self-test messages, because saying
    // WHICH reading it exists to contradict is the point. So the subject is the
    // set of MODULE SPECIFIERS, static and dynamic — which is what "shares no
    // implementation" is actually a statement about.
    const specifiers = (src: string) => [
      ...[...src.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)"/gm)].map((m) => m[1]),
      ...[...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...src.matchAll(/\brequire\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
    ];

    // Calibration — the extractor is driven against a source that DOES depend
    // on the normalizer, all three ways, so a broken extractor cannot report
    // "no dependencies" for the real file below.
    const planted = specifiers(
      'import { extractFunctionDefs } from "./sql-body-normalize.mjs";\n' +
        'const a = await import("./sql-body-normalize.mjs");\n' +
        'const b = require("./sql-body-normalize.mjs");\n',
    );
    expect(planted.filter((s) => s === "./sql-body-normalize.mjs")).toHaveLength(3);

    const found = specifiers(readFileSync(NAIVE, "utf8"));
    expect(found.length, "a file with NO dependencies at all would make the next assertion vacuous").toBeGreaterThan(0);
    expect(found.every((s) => s.startsWith("node:")), `unexpected dependency: ${found.join(", ")}`).toBe(true);
  });

  // ── The end-to-end defect, RED before and GREEN after ─────────────────────

  it("RED: a definition the normalizer cannot parse but PROD HOLDS now exits 1 — it used to be 'nothing to compare', exit 0", () => {
    withTempDir((dir) => {
      const env = scaffold(dir, PLAIN_FN + DOLLAR_FN);
      const { status, out } = run(PROD_GATE, env);
      expect(status, "PROD holds a body this gate cannot extract; that is a failure to measure, never a pass").toBe(1);
      expect(out).toContain("IS in the PROD source's function-name index");
      expect(out).toContain("extraction failure, not a new");
      // The old silent line must NOT appear: that string is what exit 0 said.
      expect(out).not.toContain("define no functions — nothing to compare");
      expect(out).not.toContain("no unacknowledged repo-vs-PROD body drift");
    });
  });

  it("the same input is still classified honestly when PROD does NOT hold it: measured absent, and the disagreement is REPORTED", () => {
    withTempDir((dir) => {
      const env = scaffold(dir, PLAIN_FN);
      const { status, out } = run(PROD_GATE, env);
      expect(status).toBe(0);
      // It reached a disposition instead of the "no functions" early exit.
      expect(out).toContain("Functions defined or replaced by this PR: 1");
      expect(out).toContain("sanitize_user$v2: measured absent");
      expect(out).toContain("ZERO bodies compared");
      // A name only one reading can see is surfaced, never swallowed.
      expect(out).toContain(
        "the independent name reader found function definition(s) the normalizer's parser did not",
      );
    });
  });

  it("RED: an unset BODY_NAME_INDEX_XCHECK_CMD exits 1 — one index is the instrument measuring itself", () => {
    withTempDir((dir) => {
      const env = scaffold(dir, PLAIN_FN + DOLLAR_FN);
      const { status, out } = run(PROD_GATE, {
        ...env,
        BODY_NAME_INDEX_XCHECK_CMD: "",
      });
      expect(status).toBe(1);
      expect(out).toContain("BODY_NAME_INDEX_XCHECK_CMD is unset");
    });
  });

  it("RED: an EMPTY cross-check index exits 1 — a cross-check that finds nothing cannot contradict anything", () => {
    withTempDir((dir) => {
      const env = scaffold(dir, PLAIN_FN + DOLLAR_FN);
      const empty = join(dir, "empty.sh");
      writeFileSync(empty, "#!/usr/bin/env bash\nexit 0\n");
      chmodSync(empty, 0o755);
      const { status, out } = run(PROD_GATE, {
        ...env,
        BODY_NAME_INDEX_XCHECK_CMD: `bash ${empty}`,
      });
      expect(status).toBe(1);
      expect(out).toContain("cross-check index of PROD's function names came back EMPTY");
    });
  });

  it("RED: pointing the two READINGS at the same program exits 1 — two invocations are not two derivations", () => {
    withTempDir((dir) => {
      const env = scaffold(dir, PLAIN_FN + DOLLAR_FN);
      const { status, out } = run(PROD_GATE, {
        ...env,
        NAIVE_NAMES: NORMALIZER,
      });
      expect(status).toBe(1);
      expect(out).toContain("resolve to the SAME file");
    });
  });

  // ── Non-vacuity: the union must refuse nothing that exists ────────────────

  it("the two readings agree on the ENTIRE real corpus, so the union widens nothing today", async () => {
    const { extractFunctionDefs } = await import(
      "../../scripts/sql-body-normalize.mjs"
    );
    const { naiveFunctionDefs } = await import(
      "../../scripts/sql-function-names-naive.mjs"
    );
    const files: string[] = [];
    for (const d of ["supabase/migrations", "supabase/schema/functions"]) {
      for (const f of readdirSync(d)) if (f.endsWith(".sql")) files.push(`${d}/${f}`);
    }
    expect(files.length, "an empty corpus would make this arm unfailable").toBeGreaterThan(200);
    let definitions = 0;
    const disagreements: string[] = [];
    for (const f of files) {
      const sql = readFileSync(f, "utf8");
      const a = new Set(extractFunctionDefs(sql).map((d: { name: string }) => d.name));
      const b = new Set(naiveFunctionDefs(sql).map((d: { name: string }) => d.name));
      definitions += a.size;
      for (const n of a) if (!b.has(n)) disagreements.push(`${f}: lexer-only ${n}`);
      for (const n of b) if (!a.has(n)) disagreements.push(`${f}: naive-only ${n}`);
    }
    expect(definitions, "zero definitions would make the comparison trivially equal").toBeGreaterThan(100);
    expect(disagreements).toEqual([]);
  });

  // ── The WIRING, not the helper — SP-C05's own complaint about the old test ─

  it("the workflow wires the cross-check to a DIFFERENT script from the fetcher and the primary index", () => {
    const yml = readFileSync(
      ".github/workflows/migration-drift-check.yml",
      "utf8",
    );
    const grab = (name: string) => {
      const m = new RegExp(`export ${name}="([^"]+)"`).exec(yml);
      expect(m, `${name} must be exported by the workflow`).not.toBeNull();
      return (m as RegExpExecArray)[1];
    };
    const fetch = grab("BODY_FETCH_CMD");
    const primary = grab("BODY_NAME_INDEX_CMD");
    const xcheck = grab("BODY_NAME_INDEX_XCHECK_CMD");
    // The old wiring's exact shape: fetcher and index naming one script.
    expect(fetch).toContain("sql-body-normalize.mjs");
    expect(primary).toContain("sql-body-normalize.mjs");
    expect(
      xcheck,
      "the cross-check must not be the program whose blindness it exists to detect",
    ).not.toContain("sql-body-normalize.mjs");
    expect(xcheck).toContain("sql-function-names-naive.mjs");
    // All three read the SAME dump — the disagreement must be about the
    // READING, never about looking at two different things.
    const dumpOf = (cmd: string) => cmd.slice(cmd.lastIndexOf(" ") + 1);
    expect(dumpOf(xcheck)).toBe(dumpOf(primary));
    expect(dumpOf(fetch)).toBe(dumpOf(primary));
    // An edit to the new reader must re-run the gate that depends on it.
    expect(yml).toContain("- 'scripts/sql-function-names-naive.mjs'");
  });

  it("SP-C06: a FAILING `git diff` is a MEASURE_FAIL, not 'no migration files changed'", () => {
    // ⛔ The line read `git diff … > changed.txt || true`, which converted
    // "could not list the changed files" into "the list is empty" and then into
    // the HONEST-EXIT-0 branch — whose own comment asserts that "could not
    // measure" never reaches it. `set -e` would have caught it; the `|| true`
    // is what defeated `set -e`.
    //
    // Driven with a stub `git` that RESOLVES the merge base and then FAILS the
    // diff, which is the exact state the branch could not distinguish (a bad
    // object, a shallow object database, a pathspec error).
    withTempDir((dir) => {
      const bin = join(dir, "bin");
      mkdirSync(bin, { recursive: true });
      const realGit = spawnSync("bash", ["-c", "command -v git"], {
        encoding: "utf8",
      }).stdout.trim();
      expect(realGit, "no real git on PATH to delegate to").not.toBe("");
      writeFileSync(
        join(bin, "git"),
        [
          "#!/usr/bin/env bash",
          'case "$1" in',
          "  merge-base) echo 0000000000000000000000000000000000000000; exit 0;;",
          '  diff) echo "fatal: bad object" >&2; exit 128;;',
          `  *) exec ${realGit} "$@";;`,
          "esac",
        ].join("\n"),
      );
      chmodSync(join(bin, "git"), 0o755);

      const env = scaffold(dir, PLAIN_FN);
      const { status, out } = run(PROD_GATE, {
        ...env,
        // Force the derive-from-git branch.
        CHANGED_MIGRATIONS: "",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      });
      expect(status, "an unreadable file list was read as an empty one").toBe(1);
      expect(out).toContain("could not enumerate this PR's migration changes");
      expect(out).not.toContain("changes no migration files");
      expect(out).not.toContain("no unacknowledged repo-vs-PROD body drift");
    });
  });

  it("SP-I07: a function name that is not a safe path component is REFUSED, not written to disk", () => {
    // ⛔ `live="$TMP/${fname}.live.sql"` and `snapshot="${SNAPSHOT_DIR}/${fname}.sql"`
    // make the function name a path component, and it comes from a reader that
    // accepts a quoted, schema-qualified identifier. `public."../../x"` is a
    // traversal write. Hardening rather than an open hole — it needs a
    // maintainer-authored migration — but a gate whose failure mode is "wrote
    // outside its scratch directory" cannot be the thing that guards PROD.
    withTempDir((dir) => {
      mkdirSync(join(dir, "snapshot"), { recursive: true });
      const dump = join(dir, "prod-dump.sql");
      writeFileSync(dump, PLAIN_FN);
      const migration = join(dir, "20260829120000_traversal.sql");
      writeFileSync(
        migration,
        'CREATE OR REPLACE FUNCTION public."../../pwned"(a int)\nRETURNS int LANGUAGE sql AS $$ SELECT a $$;\n',
      );
      // Calibration: the readers really do surface that name, so the refusal
      // below is refusing something that reached the loop.
      const seen = spawnSync("node", [NAIVE, migration], { encoding: "utf8" });
      expect(seen.stdout.trim()).toBe("../../pwned");

      const { status, out } = run(PROD_GATE, {
        ...FAKE_CREDS,
        ...realWiring(dump),
        CHANGED_MIGRATIONS: migration,
        SNAPSHOT_DIR: join(dir, "snapshot"),
      });
      expect(status).toBe(1);
      expect(out).toContain("refuses to use as a filename component");
      // Nothing was written outside the scratch dir under either name.
      expect(existsSync(join(dir, "pwned.live.sql"))).toBe(false);
      expect(existsSync(join(dir, "snapshot", "../../pwned.sql"))).toBe(false);
    });
  });

  it("SP-I07 the other direction: a `$` is LEGAL in an identifier and must NOT be refused", () => {
    // A guard that refuses everything is as useless as one that refuses
    // nothing — and `$` is exactly the character SP-C05's measured case turns
    // on, so refusing it would make this gate fail on the wrong thing.
    withTempDir((dir) => {
      const env = scaffold(dir, PLAIN_FN);
      const { status, out } = run(PROD_GATE, env);
      expect(status).toBe(0);
      expect(out).not.toContain("refuses to use as a filename component");
      expect(out).toContain("sanitize_user$v2: measured absent");
    });
  });

  it("the independent reader's own self-test passes and is non-empty", () => {
    const r = spawnSync("node", [NAIVE, "--self-test"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const m = /self-test OK \((\d+) checks\)/.exec(r.stdout);
    expect(m, "the self-test must SAY how many checks it ran").not.toBeNull();
    expect(Number((m as RegExpExecArray)[1])).toBeGreaterThan(5);
  });
});

// ── VAC-08 ───────────────────────────────────────────────────────────────────

/** A stub ledger query: emits the names it was told are MISSING from the ledger. */
function writeStubLedger(
  dir: string,
  missing: string[],
  advisory: string[] = [],
  ledgerRows: string | null = null,
): string {
  const p = join(dir, "stub-ledger.sh");
  writeFileSync(
    p,
    [
      "#!/usr/bin/env bash",
      '# $1 = "missing" | "extra" | "ledger_rows" | "shape"',
      'if [ "$1" = "ledger_rows" ]; then',
      // Absent by default, so every pre-existing arm keeps its old behaviour:
      // an unreadable row count leaves the absurdity floor silent rather than
      // letting it decide anything.
      ledgerRows === null ? "  exit 0" : `  echo "${ledgerRows}"`,
      'elif [ "$1" = "shape" ]; then',
      '  echo "rows_total=stub"',
      'elif [ "$1" = "missing" ]; then',
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
  opts: {
    missing?: string[];
    testBody?: string;
    snapshot?: boolean;
    ledgerRows?: string | null;
  },
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

  // Default to an EMPTY baseline. Without this every arm inherits the repo's
  // real 32-entry vac08-ledger-baseline.txt, whose entries are "stale" against
  // a one-migration fixture — a scaffold leaking production data into unit
  // arms. Arms that exercise the ratchet set LEDGER_BASELINE_FILE explicitly.
  const emptyBaseline = join(dir, "baseline.empty.txt");
  writeFileSync(emptyBaseline, "# intentionally empty\n");

  return {
    LEDGER_BASELINE_FILE: emptyBaseline,
    TEST_SUPABASE_DB_URL: "stub-dsn-never-used",
    LEDGER_QUERY_CMD: `bash ${writeStubLedger(dir, opts.missing ?? [], [], opts.ledgerRows ?? null)}`,
    BODY_FETCH_CMD: `bash ${writeStubFetcher(dir)}`,
    MIGRATIONS_DIR: join(dir, "migrations"),
    SNAPSHOT_DIR: join(dir, "snapshot"),
    BODY_CHECK_FUNCTIONS: "demo_fn",
  };
}

describe("VAC-08 — scripts/test-ledger-drift-check.sh", () => {
  // ── ABSURDITY FLOOR ────────────────────────────────────────────────────────
  // Regression pin for the 2026-08-29 defect: VAC-08's FIRST real run reported
  // "253 of 262 repo migrations are not present in the TEST ledger" against a
  // database `e2e-seeded` was passing on in the same run. The number was a
  // wrong join key, not drift — but the gate said the frightening thing, which
  // points a reader at hand-applying migrations to a SHARED database.
  //
  // Three arms, and the CONTROL is load-bearing: without it a floor that fired
  // unconditionally would also pass arm 1.
  // ── RATCHET ────────────────────────────────────────────────────────────────
  // 32 migrations were MEASURED absent from TEST on 2026-08-30 (CI 33277829284)
  // and are carried in a dated baseline. The gate must still fail on drift that
  // is NOT baselined, and must refuse to let the baseline hold stale entries —
  // a baseline allowed to rot is a control that quietly stops controlling.
  describe("baseline ratchet", () => {
    const writeBaseline = (dir: string, names: string[]) => {
      const f = join(dir, "baseline.txt");
      writeFileSync(f, ["# dated baseline", ...names].join("\n") + "\n");
      return f;
    };

    it("RED: drift that is NOT baselined still fails, and is named", () => {
      withTempDir((dir) => {
        const env = scaffoldLedgerCase(dir, { missing: ["20260829120000_demo"] });
        const { status, out } = run(LEDGER_GATE, {
          ...env,
          LEDGER_BASELINE_FILE: writeBaseline(dir, ["20260101000000_something_else"]),
        });
        expect(status).toBe(1);
        expect(out).toContain("NOT baselined");
        expect(out).toContain("20260829120000_demo");
      });
    });

    it("GREEN: the SAME drift passes once it is baselined — and says so", () => {
      withTempDir((dir) => {
        const env = scaffoldLedgerCase(dir, { missing: ["20260829120000_demo"] });
        const { status, out } = run(LEDGER_GATE, {
          ...env,
          LEDGER_BASELINE_FILE: writeBaseline(dir, ["20260829120000_demo"]),
        });
        expect(status).toBe(0);
        // It must not go quiet: a ratchet that hides the carried gap is a mute
        // button. The count has to stay visible in the output.
        expect(out).toContain("1 absent");
        expect(out).toContain("0 NEW drift");
      });
    });

    it("RED: a baseline entry that is now PRESENT is a hard failure, not an advisory", () => {
      withTempDir((dir) => {
        const env = scaffoldLedgerCase(dir, { missing: [] });
        const { status, out } = run(LEDGER_GATE, {
          ...env,
          LEDGER_BASELINE_FILE: writeBaseline(dir, ["20260829120000_demo"]),
        });
        expect(status).toBe(1);
        expect(out).toContain("may only shrink");
        expect(out).toContain("20260829120000_demo");
      });
    });
  });

  describe("distinguishes a broken instrument from a drift finding", () => {
    it("RED: a populated ledger matching under half the repo is MEASURE_FAIL, not drift", () => {
      withTempDir((dir) => {
        const env = scaffoldLedgerCase(dir, {
          missing: ["20260829120000_demo"], // 0 of 1 matched
          ledgerRows: "239", // ...against a clearly populated ledger
        });
        const { status, out } = run(LEDGER_GATE, env);
        expect(status).toBe(1);
        expect(out).toContain("MEASURE_FAIL");
        expect(out).toContain("this is the GATE failing, not the database");
        // It must NOT tell the reader to go apply migrations to shared TEST.
        expect(out).toContain("Do NOT hand-apply migrations to TEST");
      });
    });

    it("CONTROL: the same populated ledger with everything matched stays silent", () => {
      withTempDir((dir) => {
        const env = scaffoldLedgerCase(dir, {
          missing: [], // 1 of 1 matched
          ledgerRows: "239", // same ledger size as the arm above
        });
        const { status, out } = run(LEDGER_GATE, env);
        expect(out).not.toContain("MEASURE_FAIL");
        expect(status).toBe(0);
      });
    });

    it("CONTROL: a SMALL ledger with nothing matched is ordinary drift, not MEASURE_FAIL", () => {
      withTempDir((dir) => {
        // Under 50 rows the ledger is not established enough to accuse the
        // join; the honest report is the drift finding, loudly.
        const env = scaffoldLedgerCase(dir, {
          missing: ["20260829120000_demo"],
          ledgerRows: "12",
        });
        const { status, out } = run(LEDGER_GATE, env);
        expect(status).toBe(1);
        expect(out).not.toContain("MEASURE_FAIL");
        expect(out).toContain("not present in the TEST ledger");
      });
    });
  });

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

  it("SP-I06: a BODY_CHECK_FUNCTIONS name that is not a bare identifier is REFUSED before it reaches SQL", () => {
    // ⛔ Half 1 applies an explicit charset allowlist to migration filenames
    // before interpolating them into SQL, and fails loud. `fname` had no
    // equivalent, and it is interpolated into `p.proname = '$1'` in
    // `default_body_fetch` AND used twice as a filesystem path component.
    // BODY_CHECK_FUNCTIONS is env-overridable, so that is one environment
    // variable away from injecting SQL into the SHARED TEST database.
    withTempDir((dir) => {
      const env = scaffoldLedgerCase(dir, {});
      const hostile = "selftest_fn'; DROP TABLE x; --";
      const { status, out } = run(LEDGER_GATE, {
        ...env,
        BODY_CHECK_FUNCTIONS: hostile,
      });
      expect(status).toBe(1);
      expect(out).toContain("refuses to interpolate into SQL");
      expect(out).not.toContain("ledger and body checks clean");
      // Refused BEFORE any comparison — not caught afterwards by the tallies.
      expect(out).not.toContain("body comparison(s)");
    });

    // The other direction: the SHIPPED DEFAULT must still be accepted, or the
    // guard has quietly disabled half 2 — which is the WR-02 defect it sits
    // beside. Derived from the script, not restated here.
    const src = readFileSync(LEDGER_GATE, "utf8");
    const m = /BODY_CHECK_FUNCTIONS="\$\{BODY_CHECK_FUNCTIONS:-([^}]*)\}"/.exec(src);
    expect(m, "could not read the default BODY_CHECK_FUNCTIONS list").not.toBeNull();
    const defaults = (m as RegExpExecArray)[1].trim().split(/\s+/);
    expect(defaults.length, "an empty default list would make this check vacuous").toBeGreaterThan(2);
    for (const n of defaults) expect(n, `the shipped default "${n}" is refused by the guard`).toMatch(/^[A-Za-z0-9_$]+$/);

    withTempDir((dir) => {
      const env = scaffoldLedgerCase(dir, {});
      const { status } = run(LEDGER_GATE, env);
      expect(status, "the guard reddened the normal green path").toBe(0);
    });
  });

  it("SP-M02: SIGINT EXITS — it does not delete the scratch dir and carry on", () => {
    // ⛔ `trap "rm -rf '$tmp'" EXIT INT TERM`. A bash signal handler RESUMES
    // the script when it returns; it does not exit. So Ctrl-C deleted $tmp and
    // execution CONTINUED against files that no longer exist, inside a function
    // whose whole subject is comparing file contents.
    //
    // Driven: the injected ledger query signals the script that invoked it, so
    // the interrupt lands at a real point in the run rather than at a guessed
    // moment.
    withTempDir((dir) => {
      const env = scaffoldLedgerCase(dir, {});
      const interrupt = join(dir, "interrupt-query.sh");
      writeFileSync(
        interrupt,
        [
          "#!/usr/bin/env bash",
          "# Produce nothing, then interrupt the gate that called us.",
          'kill -INT "$PPID"',
          "exit 0",
        ].join("\n"),
      );
      chmodSync(interrupt, 0o755);

      const { status, out } = run(LEDGER_GATE, {
        ...env,
        LEDGER_QUERY_CMD: `bash ${interrupt}`,
      });
      expect(status, "SIGINT did not terminate the gate — it resumed after the handler").toBe(130);
      // The tell-tale of resumption: the run reaching the COUNT of a file the
      // handler has already deleted.
      expect(out).not.toContain("could not count the missing-migration rows");
      expect(out).not.toContain("ledger and body checks clean");
    });
  });

  it("SP-M01 RED: a grep that ERRORS while counting is a MEASURE_FAIL, not 'counted zero'", () => {
    // ⛔ `missing_count="$(grep -ac … || true)"; missing_count="${missing_count:-0}"`.
    // grep exits 0 with a count, 1 on no match, and >= 2 on an ERROR — and on
    // >= 2 the substitution is EMPTY, `${:-0}` makes it 0, and the gate prints
    // "all N repo migrations found by name."
    //
    // Driven with a `grep` that delegates to the real one for everything EXCEPT
    // the missing-row file, where it exits 2. That is the only way to reach the
    // branch: the file is created inside the script's own scratch dir.
    withTempDir((dir) => {
      const bin = join(dir, "bin");
      mkdirSync(bin, { recursive: true });
      const realGrep = spawnSync("bash", ["-c", "command -v grep"], {
        encoding: "utf8",
      }).stdout.trim();
      expect(realGrep, "no real grep on PATH to delegate to").not.toBe("");
      writeFileSync(
        join(bin, "grep"),
        [
          "#!/usr/bin/env bash",
          'for a in "$@"; do case "$a" in *missing.txt) exit 2;; esac; done',
          `exec ${realGrep} "$@"`,
        ].join("\n"),
      );
      chmodSync(join(bin, "grep"), 0o755);

      // The ledger itself is CLEAN, so the only thing that can redden this run
      // is the unreadable count — otherwise the arm would pass for the wrong
      // reason.
      const env = scaffoldLedgerCase(dir, {});
      const clean = run(LEDGER_GATE, env);
      expect(clean.status, "the fixture must be green before the grep is broken").toBe(0);

      const { status, out } = run(LEDGER_GATE, {
        ...env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      });
      expect(status, "an uncountable result was reported as a count of zero").toBe(1);
      expect(out).toContain("could not count the missing-migration rows");
      expect(out).not.toContain("repo migrations found by name");
      expect(out).not.toContain("ledger and body checks clean");
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

  it("WR-02 RED: a WHITESPACE-ONLY BODY_CHECK_FUNCTIONS exits 1 — half 2 must not compare nothing and pass", () => {
    withTempDir((dir) => {
      // `${BODY_CHECK_FUNCTIONS:-default}` only substitutes for EMPTY, so a
      // single space survives it and then `for fname in $LIST` iterates zero
      // times. MEASURED before the guard: "0 body comparison(s)" … "ledger and
      // body checks clean" … exit 0, with DRIFT-01 unchecked.
      const env = scaffoldLedgerCase(dir, {});
      const { status, out } = run(LEDGER_GATE, {
        ...env,
        BODY_CHECK_FUNCTIONS: " ",
      });
      expect(status).toBe(1);
      expect(out).toContain("half 2 compared NOTHING");
      expect(out).not.toContain("ledger and body checks clean");
    });
  });

  it("WR-02 RED: a non-empty list that yields ZERO comparisons is a MEASURE_FAIL", () => {
    withTempDir((dir) => {
      // The list guard cannot see this shape: the names are there, but the
      // fetcher returns nothing for any of them.
      const env = scaffoldLedgerCase(dir, {});
      const silent = join(dir, "silent-fetch.sh");
      writeFileSync(silent, "#!/usr/bin/env bash\nexit 0\n");
      chmodSync(silent, 0o755);
      const { status, out } = run(LEDGER_GATE, {
        ...env,
        BODY_FETCH_CMD: `bash ${silent}`,
      });
      expect(status).toBe(1);
      expect(out).toContain("ZERO body comparisons");
      expect(out).not.toContain("ledger and body checks clean");
    });
  });

  it("--self-test proves ALL FOUR red modes and the green path, and exits 0", () => {
    const res = spawnSync("bash", [LEDGER_GATE, "--self-test"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    expect(res.status).toBe(0);
    expect(out).toContain("missing-ledger-row RED");
    expect(out).toContain("body-mismatch RED");
    expect(out).toContain("empty-body-check-list RED");
    expect(out).toContain("zero-comparisons RED");
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

describe("IN-04 — the scratch directory does not survive a fail() path", () => {
  it("MEASURED: a failing VAC-08 run leaves no new mktemp directory behind", () => {
    // `trap "rm -rf '$tmp'" RETURN` fires when the FUNCTION returns. Every
    // `fail` inside `check()` `exit`s the shell instead, so all ~8 failure
    // paths leaked their `mktemp -d`. Measured 2026-08-29 with the EXIT trap
    // removed: leaked=1 per failing run; with it: leaked=0.
    //
    // ⛔ R2-W01: ASK the child where its `mktemp -d` lands. Do not compute it.
    //
    // The previous version was `dirname(mkdtempSync(join(tmpdir(), "probe-")))`,
    // which is IDENTICALLY `os.tmpdir()` — mkdtemp creates its directory INSIDE
    // the path it is given, so dirname gives that path straight back. Measured:
    //   test computes tempRoot as:   /var/folders/…/T
    //   os.tmpdir():                 /var/folders/…/T        IDENTICAL: true
    // So the comment claiming it "counts the REAL temp root, not $TMPDIR"
    // described the exact quantity it had just been rewritten to stop using.
    // Under a TMPDIR override — which GSD worktrees and wrapper harnesses set
    // routinely — the two diverge and the assertion goes blind: measured, with
    // the gate's EXIT traps REMOVED and TMPDIR pointed at a scratch dir, this
    // case PASSED while 63 `tmp.*` directories sat in the real temp root.
    //
    // Asking a `bash -c mktemp -d` child is derivation-independent: it is the
    // same primitive, the same interpreter and the same environment the gate
    // itself uses, and it is correct on macOS (confstr, ignores TMPDIR) and on
    // Linux (GNU mktemp, honours TMPDIR) without this test knowing which.
    // It also cleans up after itself — the old probe directory was never removed,
    // so the anti-leak test leaked.
    const probe = spawnSync("bash", ["-c", 'd=$(mktemp -d); printf %s "$d"; rmdir "$d"'], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(
      probe.status,
      "could not locate the shell's temp root — the measurement below would be pointed at nothing",
    ).toBe(0);
    // ⛔ R3-I02: `dirname("")` is `"."`. An empty stdout would point `tempRoot`
    // at the REPO ROOT, and the calibration step below would then plant a
    // `tmp.*` directory in the checkout — a dirty tree, which the mutation
    // runner reports as its own defect kind. The status guard above makes that
    // unreachable for a working `mktemp`, which is exactly why the failure
    // would be a surprise rather than a diagnosis.
    expect(probe.stdout.trim(), "the probe printed no path").toMatch(/^\//);
    const tempRoot = dirname(probe.stdout.trim());

    // ⛔ R2-W02: attribute by CONTENT, never by a bare count of a machine-wide
    // directory. `tmp.` is the default `mktemp -d` prefix used by three scripts
    // in this repo and by a great deal of unrelated software, and vitest runs
    // files in parallel workers — a raw `count - before` is red when a stranger
    // creates one and red again when a stranger removes one. This gate's scratch
    // directory always holds `missing.txt` by the time the fail() path driven
    // below is reached (half 1 writes it; the BODY_CHECK_FUNCTIONS guard is in
    // half 2), so that file is a signature no other process shares.
    const scratchDirs = () =>
      readdirSync(tempRoot)
        .filter((n) => n.startsWith("tmp."))
        .filter((n) => existsSync(join(tempRoot, n, "missing.txt")));

    // CALIBRATION, so a filter that matches nothing cannot masquerade as
    // "no leak". Plant a directory of exactly the shape the detector looks for
    // and require the detector to see it. Without this the two filters above
    // could both be wrong and the case would still read green.
    const planted = mkdtempSync(join(tempRoot, "tmp."));
    try {
      writeFileSync(join(planted, "missing.txt"), "");
      expect(
        scratchDirs(),
        "the leak detector cannot see a planted scratch directory, so it could not see a real one",
      ).toContain(basename(planted));
    } finally {
      rmSync(planted, { recursive: true, force: true });
    }

    withTempDir((dir) => {
      const env = scaffoldLedgerCase(dir, {});
      const before = new Set(scratchDirs());
      const { status } = run(LEDGER_GATE, { ...env, BODY_CHECK_FUNCTIONS: " " });
      expect(status).toBe(1); // it must have taken a fail() path at all
      const added = scratchDirs().filter((n) => !before.has(n));
      expect(
        added,
        "a failing run left its mktemp -d behind. RETURN traps do not fire on exit; this script " +
          "family's stated purpose is that nothing it creates survives.",
      ).toEqual([]);
    });
  });

  it("R3-W03 DRIVEN: a pg-lane run that fails at initdb leaves no scratch directory", () => {
    // ⛔ THIS ARM REPLACES A CLAIM, NOT JUST A GAP. The round-2 fix report said
    // of the structural pin below: "Driving the leak needs a real cluster
    // failure mid-`legacy_run`." That was not true. The script already has the
    // seam — `PGBIN` — and driving it takes three seconds and no PostgreSQL:
    //
    //   pg_ctl stub exits 0  -> run_lane's `[ -x "$PGBIN/pg_ctl" ]` preflight passes
    //   initdb  stub exits 1 -> `set -e` aborts INSIDE legacy_run, after
    //                           OWNED_WORKDIR=$(mktemp -d) and after mkdir "$PGD"
    //   the EXIT trap fires  -> nothing may survive
    //
    // The structural pin below compares LINE NUMBERS and says nothing about
    // what `cleanup` does: deleting the whole `OWNED_WORKDIR` block from
    // `cleanup()` leaves it green while every failing run leaks. That is IN-04's
    // defect restored under a green control. This arm reds on exactly that.
    const probe = spawnSync("bash", ["-c", 'd=$(mktemp -d); printf %s "$d"; rmdir "$d"'], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(probe.status, "could not locate the shell's temp root").toBe(0);
    expect(probe.stdout.trim(), "the probe printed no path").toMatch(/^\//);
    const tempRoot = dirname(probe.stdout.trim());

    // Attribute by CONTENT, as R2-W02 established: `tmp.` is a shared prefix
    // and vitest runs files in parallel workers, so a bare count is red when a
    // stranger creates a directory and red again when one removes it. By the
    // time the stub `initdb` fails, `run_lane` has already done `mkdir -p
    // "$PGD"`, so a `pgd` subdirectory is this lane's signature.
    const laneScratch = () =>
      readdirSync(tempRoot)
        .filter((n) => n.startsWith("tmp."))
        .filter((n) => existsSync(join(tempRoot, n, "pgd")));

    // CALIBRATION: a filter that matches nothing must not read as "no leak".
    const planted = mkdtempSync(join(tempRoot, "tmp."));
    try {
      mkdirSync(join(planted, "pgd"), { recursive: true });
      expect(
        laneScratch(),
        "the leak detector cannot see a planted lane scratch directory, so it could not see a real one",
      ).toContain(basename(planted));
    } finally {
      rmSync(planted, { recursive: true, force: true });
    }

    const bin = mkdtempSync(join(tempRoot, "tmp.pglane-stubbin-"));
    try {
      writeFileSync(join(bin, "pg_ctl"), "#!/bin/sh\nexit 0\n");
      writeFileSync(join(bin, "initdb"), '#!/bin/sh\necho "initdb: stub failure" >&2\nexit 1\n');
      chmodSync(join(bin, "pg_ctl"), 0o755);
      chmodSync(join(bin, "initdb"), 0o755);

      const before = new Set(laneScratch());
      const res = spawnSync("bash", [join(process.cwd(), "scripts", "pg-lane", "run.sh")], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, PGBIN: bin },
        timeout: 120_000,
      });
      expect(
        res.status,
        "the stub must make the lane FAIL — otherwise nothing is driven and this arm proves nothing",
      ).not.toBe(0);

      const added = laneScratch().filter((n) => !before.has(n));
      expect(
        added,
        "the EXIT trap did not remove legacy_run's OWNED_WORKDIR. This script family's stated " +
          "purpose is that nothing it creates survives; D-04's measured cost was 27 orphans and a " +
          "disk-exhaustion incident.",
      ).toEqual([]);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it("pg-lane registers its cleanup trap BEFORE the first mktemp, not inside run_lane", () => {
    // Kept ALONGSIDE the driven arm above, not instead of it. This one is
    // cheap, is independent of the environment, and catches the specific
    // regression of moving the trap back inside `run_lane` — a shape the driven
    // arm would also catch, but only on the paths it exercises.
    //
    // ⚠️ What it does NOT check is what `cleanup` DOES, which is why the arm
    // above exists. The round-2 report's claim that this path could only be
    // driven with a real cluster was wrong, and is corrected there.
    // Line numbers, over EXECUTABLE lines only — a first version of this
    // compared string offsets and matched the words "mktemp -d" inside the
    // very comment that explains the fix, so it failed on correct code.
    const lines = readFileSync("scripts/pg-lane/run.sh", "utf8").split("\n");
    const code = lines.map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => !/^\s*#/.test(l));

    const trapAt = code.find(({ l }) => /^trap cleanup EXIT\b/.test(l))?.n;
    const firstMktemp = code.find(({ l }) => /mktemp -d/.test(l))?.n;

    expect(trapAt, "no TOP-LEVEL `trap cleanup EXIT` in scripts/pg-lane/run.sh").toBeDefined();
    expect(firstMktemp, "no executable `mktemp -d` found — update this test").toBeDefined();
    expect(
      trapAt as number,
      "the cleanup trap is registered AFTER the first mktemp -d, so a failure between them leaks " +
        "the scratch directory (IN-04).",
    ).toBeLessThan(firstMktemp as number);
  });

  it("SP-H01: every SKIP in pg-lane's self-test is TALLIED, and a tallied skip exits 1", () => {
    // ⛔ Arm 2 printed "Not a pass" and NOTHING ACTED ON IT: the arm was
    // silently dropped from the count, the run still printed "SELF-TEST PASSED
    // (5/5)" and exited 0. MEASURED before the fix, with `node` removed from
    // PATH: exit 0, "SKIP non-postgres-listener arm … Not a pass." followed by
    // "=== SELF-TEST PASSED (5/5) ===". The dropped arm is precisely the one
    // proving the collision guard is as WIDE as its message (IN-07).
    //
    // Driving this in vitest would mean standing up four PostgreSQL clusters,
    // so the DRIVEN proof lives in the fix's own measurement (recorded in the
    // commit) and what is pinned here is the structural property: SKIPs and
    // tallies are COUNTED against each other, so a sixth arm that skips without
    // tallying fails.
    const src = readFileSync("scripts/pg-lane/run.sh", "utf8");
    const start = src.indexOf("self_test() {");
    // ⚠️ COMMENTS STRIPPED FIRST. A first version searched the raw text and
    // matched "SELF-TEST PASSED (5/5)" inside the very comment that explains
    // this fix — the same trap the trap-ordering arm above records. The subject
    // is the CODE.
    const body = src
      .slice(start, src.indexOf("\n# ---", start))
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(body.length, "self_test() must be findable in the source").toBeGreaterThan(500);
    expect(body, "the comment stripper removed the code as well").toContain("st_skipped=0");

    const countSkipEchoes = (text: string) =>
      text.split("\n").filter((l) => /^\s*echo "\s*SKIP /.test(l)).length;
    const countTallies = (text: string) =>
      text.split("\n").filter((l) => /st_skipped=\$\(\(st_skipped \+ 1\)\)/.test(l)).length;

    const skips = countSkipEchoes(body);
    expect(skips, "no SKIP branch found — either the arm moved or this predicate stopped matching").toBeGreaterThan(0);
    expect(
      countTallies(body),
      "a self-test arm prints SKIP without incrementing st_skipped, so it is silently dropped from the count",
    ).toBe(skips);

    // Calibration: the same predicates report the mismatch when the tally is
    // deleted, so a matching pair is evidence rather than a coincidence.
    const withoutTally = body
      .split("\n")
      .filter((l) => !/st_skipped=\$\(\(st_skipped \+ 1\)\)/.test(l))
      .join("\n");
    expect(countSkipEchoes(withoutTally)).toBe(skips);
    expect(countTallies(withoutTally)).toBe(0);

    // The verdict subtracts, names the skips, and EXITS 1 — before the
    // "PASSED" line can be reached.
    const incompleteAt = body.indexOf("SELF-TEST INCOMPLETE");
    const passedAt = body.indexOf("SELF-TEST PASSED (5/5)");
    expect(incompleteAt, "no INCOMPLETE verdict — a skipped arm would still read as a pass").toBeGreaterThan(-1);
    expect(passedAt).toBeGreaterThan(-1);
    expect(incompleteAt).toBeLessThan(passedAt);
    expect(body).toMatch(/if \[ "\$st_skipped" -ne 0 \]; then/);
    expect(body.slice(incompleteAt, passedAt)).toContain("exit 1");
    // The count is DERIVED from the tally, not a caption.
    expect(body).toContain("$((5 - st_skipped))/5 run");
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
  //
  // ⛔ R3-W04. The list used to be nine hand-written script paths plus this
  // file. Of the sixteen files round 2 changed it covered THREE — it did not
  // cover `ci.yml`, `GRAMMAR.md`, the self-test SQL fixtures, or ANY of the
  // five test files that round authored. The NUL R2-I02 caught happened to land
  // in a listed file; nothing structural made that so. A hand-list of a moving
  // surface is the same defect as a hand-picked oracle.
  //
  // So the surface is DERIVED: everything under `scripts/` (recursively — that
  // is where every gate, fixture and corpus file this phase owns lives), the CI
  // workflow the gates are wired into, and every test file in `src/__tests__/`.
  // Adding a gate script or a gate test enrols it automatically.
  //
  // ⚠️ `src/lib/wizardErrors.test.ts` carries a DELIBERATE NUL at line 1572 — a
  // known, owned exception that makes `grep` silently blind to that file. It is
  // not under `src/__tests__/`, so this derivation does not reach it, and the
  // derivation is deliberately NOT widened to all of `src/`.
  // ⚠️ Derived from the TRACKED surface, via `git ls-files`, not from a
  // filesystem walk. MEASURED: a `readdirSync` walk of `scripts/` picked up
  // `scripts/__pycache__/*.pyc` — gitignored Python bytecode, dense with C0
  // bytes, which reddened three arms in the main checkout while passing in a
  // clean worktree that had never run the Python scripts. An untracked build
  // artefact is not part of this phase's surface; `git ls-files` says so by
  // construction, and it cannot drift the way an extension denylist would.
  const tracked = (...pathspecs: string[]): string[] => {
    const res = spawnSync("git", ["ls-files", "-z", "--", ...pathspecs], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(res.status, "git ls-files failed — the surface below would be empty").toBe(0);
    return res.stdout.split("\u0000").filter((p) => p.length > 0);
  };

  const SCRIPTS = [
    ...tracked("scripts"),
    ...tracked(".github/workflows/ci.yml"),
    ...tracked("src/__tests__").filter((f) => f.endsWith(".test.ts")),
  ].sort();

  /**
   * Invisible and text-smuggling characters.
   *
   * ⛔ R3-W04 widened the shipped class, which covered only NUL, soft hyphen,
   * U+180E, the ZW-star/bidi block and the BOM. It missed:
   *   - every C0 control except NUL, including U+001B ESC (which injects ANSI
   *     escape sequences into a CI log), and the whole C1 range;
   *   - U+00A0 NBSP and the other space separators (U+2000-200A, U+202F,
   *     U+205F, U+3000). An NBSP inside a shell script's `[ -n "$x" ]` is a
   *     syntax error that is invisible in review — precisely what this pin
   *     exists for;
   *   - U+2028/U+2029, which `.split("\n")` does not separate on either;
   *   - U+FFF9-FFFB interlinear annotation;
   *   - the astral TAG block U+E0000-E007F, the standard modern text-smuggling
   *     range, entirely outside the BMP the old class covered.
   *
   * ⚠️ VARIATION SELECTORS ARE CONDITIONAL, a deliberate departure from the
   * reviewer's suggested class. U+FE0F is the second code point of every emoji
   * this codebase writes in emoji presentation — the warning sign, the no-entry
   * sign, the star, the check mark — so a blanket U+FE00-FE0F ban reports 11
   * offenders in `run.mjs` alone and would have to be switched off, which is
   * worse than a narrower rule that stays on. A variation selector NOT preceded
   * by an Extended_Pictographic has no legitimate use here and is still refused.
   *
   * Written entirely in ESCAPES, per R2-I02: this file is in its own list, and a
   * class written with raw bytes makes the file that forbids invisible
   * characters a tripwire for every scanner that reads it.
   */
  const INVISIBLE = new RegExp(
    "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F" +
      "\\u00A0\\u00AD\\u180E\\u2000-\\u200F\\u2028\\u2029\\u202A-\\u202F" +
      "\\u205F-\\u2064\\u2066-\\u206F\\u3000\\uFEFF\\uFFF9-\\uFFFB]" +
      "|[\\u{E0000}-\\u{E007F}]" +
      "|(?<!\\p{Extended_Pictographic})[\\uFE00-\\uFE0F]",
    "u",
  );

  it("the derived surface is non-empty, covers this phase's gates, and every entry exists", () => {
    // Without this, the loop below is satisfied by a glob that matched nothing.
    expect(SCRIPTS.length).toBeGreaterThan(20);
    for (const rel of SCRIPTS) {
      expect(existsSync(rel), `${rel} is missing — the derivation is broken`).toBe(true);
    }
    // The files round 2 changed that the old hand-list did NOT cover.
    for (const rel of [
      ".github/workflows/ci.yml",
      "scripts/mutation-runner/GRAMMAR.md",
      "scripts/mutation-runner/fixtures/selftest/identity-rewrite-gate.sql",
      "src/__tests__/mutation-runner-neuter.test.ts",
      "src/__tests__/mutation-annotation-parser.test.ts",
      "src/__tests__/verify-plan-anchors.test.ts",
      "src/__tests__/baseline-wiring-claim.test.ts",
      "src/__tests__/local-stack-teardown-assertion.test.ts",
      "src/__tests__/drift-check-scripts.test.ts",
    ]) {
      expect(SCRIPTS, `${rel} is not covered by the derived surface`).toContain(rel);
    }
  });

  it("the class catches every widened category, and does NOT fire on emoji presentation", () => {
    // ⭐ A widened class that cannot fire on its new categories is a widening in
    // name only, and one that fires on the warning sign would be switched off.
    // Both directions are asserted. Every sample is built from ESCAPES.
    const CATEGORIES: Array<[string, string]> = [
      ["NUL", "a\u{0000}b"],
      ["ESC", "a\u{001B}b"],
      ["DEL", "a\u{007F}b"],
      ["C1 control", "a\u{0085}b"],
      ["NBSP", "a\u{00A0}b"],
      ["en quad", "a\u{2000}b"],
      ["narrow no-break space", "a\u{202F}b"],
      ["medium mathematical space", "a\u{205F}b"],
      ["ideographic space", "a\u{3000}b"],
      ["line separator", "a\u{2028}b"],
      ["paragraph separator", "a\u{2029}b"],
      ["soft hyphen", "a\u{00AD}b"],
      ["zero-width space", "a\u{200B}b"],
      ["LTR mark", "a\u{200E}b"],
      ["bidi override", "a\u{202E}b"],
      ["word joiner", "a\u{2060}b"],
      ["bidi isolate", "a\u{2066}b"],
      ["BOM", "a\u{FEFF}b"],
      ["interlinear annotation anchor", "a\u{FFF9}b"],
      ["tag character (astral)", "a\u{E0041}b"],
      ["bare variation selector", "a\u{FE0F}b"],
    ];
    for (const [label, sample] of CATEGORIES) {
      expect(INVISIBLE.test(sample), `the class does not catch ${label}`).toBe(true);
    }
    // Non-vacuity: the table must actually have been walked.
    expect(CATEGORIES.length).toBeGreaterThan(15);

    for (const [label, sample] of [
      ["warning sign in emoji presentation", "\u{26A0}\u{FE0F}"],
      ["check mark in emoji presentation", "\u{2714}\u{FE0F}"],
      ["no-entry sign", "\u{26D4}"],
      ["plain ASCII", "const x = 1;"],
    ] as const) {
      expect(INVISIBLE.test(sample), `the class FALSELY fires on ${label}`).toBe(false);
    }
  });

  for (const rel of SCRIPTS) {
    it(`${rel} carries no invisible or text-smuggling characters`, () => {
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
