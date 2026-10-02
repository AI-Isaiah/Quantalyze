/**
 * Tests for scripts/sql-body-normalize.mjs — the SINGLE shared SQL-body
 * normalizer (Phase 164.3, D-05).
 *
 * WHY THIS FILE EXISTS. D-05 is a MEASURED defect class, not a hypothetical:
 * PROD's 7-param `_enqueue_compute_job_internal` reports 0 `INTO STRICT`
 * occurrences in code but 1 when comments are counted. Any body assertion that
 * matches on raw text therefore compares a claim to something that is not the
 * thing. Mechanism 2 on this phase's own defect list has exactly that shape.
 *
 * The normalizer is shared by BOTH drift gates (scripts/prod-body-drift-check.sh
 * for repo-vs-PROD, scripts/test-ledger-drift-check.sh for repo-vs-TEST) so the
 * comment trap is fixed once, not twice.
 *
 * ⚠️ Every case below must be able to FAIL. Each asserts a specific measured
 * behavior of the normalizer, not merely that it returns a string.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import {
  stripSqlComments,
  normalizeSql,
  normalizeSqlLines,
  extractFunctionDefs,
  diffFunctionBodies,
} from "../../scripts/sql-body-normalize.mjs";

const SCRIPT = "scripts/sql-body-normalize.mjs";

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "sql-body-normalize-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("stripSqlComments", () => {
  it("strips `--` line comments to end-of-line, keeping the newline", () => {
    expect(stripSqlComments("SELECT 1; -- trailing\nSELECT 2;")).toBe(
      "SELECT 1; \nSELECT 2;",
    );
  });

  it("strips a whole-line `--` comment", () => {
    expect(stripSqlComments("-- header\nSELECT 1;")).toBe("\nSELECT 1;");
  });

  it("strips `/* ... */` block comments, including multiline", () => {
    expect(stripSqlComments("SELECT /* a\nb\nc */ 1;")).toBe("SELECT   1;");
  });

  it("strips NESTED block comments (Postgres nests them)", () => {
    // A non-nesting stripper stops at the FIRST `*/` and leaves ` outer */`
    // behind — which would then be compared as if it were code.
    expect(
      stripSqlComments("SELECT /* outer /* inner */ still-comment */ 1;"),
    ).toBe("SELECT   1;");
  });

  it("does NOT strip `--` inside a single-quoted string literal", () => {
    // The scanner is string-aware. A naive regex would delete the rest of the
    // line INCLUDING the closing quote, silently re-framing every byte after it.
    const sql = "RAISE EXCEPTION 'dash -- not a comment'; SELECT 1;";
    expect(stripSqlComments(sql)).toBe(sql);
  });

  it("honors the '' escape inside string literals", () => {
    const sql = "SELECT 'it''s -- fine'; -- gone\nSELECT 2;";
    expect(stripSqlComments(sql)).toBe("SELECT 'it''s -- fine'; \nSELECT 2;");
  });

  it("does NOT strip `--` inside a dollar-quoted string with a custom tag", () => {
    const sql = "SELECT $tag$raw -- text$tag$;";
    expect(stripSqlComments(sql)).toBe(sql);
  });

  it("DOES strip `--` comments inside a $$ ... $$ function body when asked to normalize the body itself", () => {
    // The body is extracted first, then normalized — so at normalize time the
    // enclosing dollar quotes are gone and the `--` is a real comment.
    const body = "BEGIN\n  -- a comment\n  RETURN 1;\nEND";
    expect(stripSqlComments(body)).toBe("BEGIN\n  \n  RETURN 1;\nEND");
  });
});

describe("normalizeSql", () => {
  it("collapses every whitespace run to a single space and trims", () => {
    expect(normalizeSql("  SELECT\n\n\t 1 ;   ")).toBe("SELECT 1 ;");
  });

  it("makes formatting-only differences vanish", () => {
    const a = "BEGIN\n  RETURN 1;\nEND";
    const b = "BEGIN RETURN 1; END";
    expect(normalizeSql(a)).toBe(normalizeSql(b));
  });

  it("D-05 MEASURED FIXTURE: a body whose ONLY `INTO STRICT` sits in a `--` comment normalizes to text without that token", () => {
    // This is the shape of PROD's 7-param _enqueue_compute_job_internal:
    // 0 occurrences in code, 1 including comments.
    const body = [
      "BEGIN",
      "  -- historical note: this used to be SELECT ... INTO STRICT v_id",
      "  SELECT id INTO v_id FROM compute_jobs WHERE idempotency_key = p_key;",
      "  RETURN v_id;",
      "END",
    ].join("\n");
    expect(body).toContain("INTO STRICT");
    expect(normalizeSql(body)).not.toContain("INTO STRICT");
    expect(normalizeSql(body)).toContain("SELECT id INTO v_id");
  });

  it("two bodies differing ONLY by comments and formatting normalize identically", () => {
    const committed = "BEGIN\n  RETURN 1;\nEND";
    const live =
      "BEGIN\n    /* added out of band */\n    -- and a note\n    RETURN 1;\nEND";
    expect(normalizeSql(live)).toBe(normalizeSql(committed));
  });

  it("a body differing in CODE does NOT normalize identically (the gate can fail)", () => {
    const committed = "BEGIN\n  RETURN 1;\nEND";
    const live = "BEGIN\n  RETURN 2;\nEND";
    expect(normalizeSql(live)).not.toBe(normalizeSql(committed));
  });
});

describe("normalizeSqlLines", () => {
  it("returns comment-free, whitespace-collapsed, non-empty lines", () => {
    const sql = "BEGIN\n\n  -- note\n   RETURN    1;\n\nEND";
    expect(normalizeSqlLines(sql)).toEqual(["BEGIN", "RETURN 1;", "END"]);
  });
});

describe("extractFunctionDefs", () => {
  it("extracts name, nargs and dollar-quoted body from CREATE OR REPLACE FUNCTION", () => {
    const sql = [
      "CREATE OR REPLACE FUNCTION public.foo(a UUID, b TEXT)",
      "RETURNS UUID LANGUAGE plpgsql AS $$",
      "BEGIN RETURN a; END",
      "$$;",
    ].join("\n");
    const defs = extractFunctionDefs(sql);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe("foo");
    expect(defs[0].nargs).toBe(2);
    expect(defs[0].bodyKind).toBe("dollar");
    expect(normalizeSql(defs[0].body)).toBe("BEGIN RETURN a; END");
  });

  it("handles a schema-less name and a zero-argument signature", () => {
    const sql =
      "CREATE FUNCTION bar() RETURNS void LANGUAGE plpgsql AS $function$\nBEGIN END\n$function$;";
    const defs = extractFunctionDefs(sql);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe("bar");
    expect(defs[0].nargs).toBe(0);
  });

  it("does NOT count commas inside default expressions or comments as extra arguments", () => {
    const sql = [
      "CREATE OR REPLACE FUNCTION public.baz(",
      "  a TEXT DEFAULT 'x,y,z',  -- a comma, in a comment",
      "  b INT",
      ") RETURNS INT LANGUAGE plpgsql AS $$ BEGIN RETURN b; END $$;",
    ].join("\n");
    expect(extractFunctionDefs(sql)[0].nargs).toBe(2);
  });

  it("extracts BOTH overloads of the same name, in file order", () => {
    const sql = [
      "CREATE OR REPLACE FUNCTION public.f(a INT) RETURNS INT LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$;",
      "CREATE OR REPLACE FUNCTION public.f(a INT, b INT) RETURNS INT LANGUAGE plpgsql AS $$ BEGIN RETURN 2; END $$;",
    ].join("\n");
    const defs = extractFunctionDefs(sql);
    expect(defs.map((d) => d.nargs)).toEqual([1, 2]);
    expect(new Set(defs.map((d) => d.name))).toEqual(new Set(["f"]));
  });

  it("IGNORES a `CREATE OR REPLACE FUNCTION` mention that sits inside a comment", () => {
    const sql = [
      "-- CREATE OR REPLACE FUNCTION public.ghost(a INT) -- not real",
      "/* CREATE OR REPLACE FUNCTION public.phantom() */",
      "CREATE OR REPLACE FUNCTION public.real(a INT) RETURNS INT LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$;",
    ].join("\n");
    expect(extractFunctionDefs(sql).map((d) => d.name)).toEqual(["real"]);
  });

  it("marks a function with no dollar-quoted body as bodyKind 'none' (the gate fails closed on these)", () => {
    const sql =
      "CREATE OR REPLACE FUNCTION public.q(a INT) RETURNS INT LANGUAGE sql RETURN a + 1;";
    const defs = extractFunctionDefs(sql);
    expect(defs).toHaveLength(1);
    expect(defs[0].bodyKind).toBe("none");
  });

  it("parses pg_get_functiondef output, which has no trailing semicolon", () => {
    const sql =
      "CREATE OR REPLACE FUNCTION public.sanitize_user(p_user_id uuid)\n" +
      " RETURNS void\n LANGUAGE plpgsql\n SECURITY DEFINER\nAS $function$\nBEGIN RETURN; END\n$function$\n";
    const defs = extractFunctionDefs(sql);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe("sanitize_user");
    expect(normalizeSql(defs[0].body)).toBe("BEGIN RETURN; END");
  });
});

describe("diffFunctionBodies", () => {
  const snapshot =
    "CREATE OR REPLACE FUNCTION public.f(a INT) RETURNS INT LANGUAGE plpgsql AS $$\nBEGIN\n  RETURN 1;\nEND\n$$;";

  it("reports MATCH when the live body differs only by comments and whitespace", () => {
    const live =
      "CREATE OR REPLACE FUNCTION public.f(a integer)\n RETURNS integer\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n    -- out-of-band comment\n    RETURN 1;\nEND\n$function$";
    const rows = diffFunctionBodies(snapshot, live);
    expect(rows.map((r) => r.status)).toEqual(["MATCH"]);
  });

  it("reports DRIFT with both hashes and a hunk count when the CODE differs", () => {
    const live =
      "CREATE OR REPLACE FUNCTION public.f(a integer)\n RETURNS integer\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n  RETURN 2;\nEND\n$function$";
    const rows = diffFunctionBodies(snapshot, live);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("DRIFT");
    expect(rows[0].candidateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].candidateHash).not.toBe(rows[0].snapshotHash);
    expect(rows[0].hunks).toBeGreaterThan(0);
  });

  it("binds the ack hash to the NORMALIZED live body (so a stale ack cannot pass)", () => {
    const live =
      "CREATE OR REPLACE FUNCTION public.f(a integer) RETURNS integer LANGUAGE plpgsql AS $function$\nBEGIN\n  RETURN 2;\nEND\n$function$";
    const rows = diffFunctionBodies(snapshot, live);
    const expected = createHash("sha256")
      .update(normalizeSql("\nBEGIN\n  RETURN 2;\nEND\n"), "utf8")
      .digest("hex");
    expect(rows[0].candidateHash).toBe(expected);
  });

  it("reports SNAPSHOT_MISSING when the live side has a function the snapshot does not", () => {
    const live =
      "CREATE OR REPLACE FUNCTION public.other(a integer) RETURNS integer LANGUAGE plpgsql AS $function$ BEGIN RETURN 1; END $function$";
    const rows = diffFunctionBodies(snapshot, live);
    expect(rows.map((r) => r.status)).toEqual(["SNAPSHOT_MISSING"]);
  });

  it("reports SNAPSHOT_ONLY (advisory) for a committed overload not present live", () => {
    const twoOverloads =
      snapshot +
      "\nCREATE OR REPLACE FUNCTION public.f(a INT, b INT) RETURNS INT LANGUAGE plpgsql AS $$ BEGIN RETURN 2; END $$;";
    const live =
      "CREATE OR REPLACE FUNCTION public.f(a integer) RETURNS integer LANGUAGE plpgsql AS $function$\nBEGIN\n  RETURN 1;\nEND\n$function$";
    const rows = diffFunctionBodies(twoOverloads, live);
    expect(rows.map((r) => r.status).sort()).toEqual([
      "MATCH",
      "SNAPSHOT_ONLY",
    ]);
  });

  it("reports UNCOMPARABLE rather than a pass when a body cannot be extracted", () => {
    const live =
      "CREATE OR REPLACE FUNCTION public.f(a integer) RETURNS integer LANGUAGE sql RETURN a + 1;";
    const rows = diffFunctionBodies(snapshot, live);
    expect(rows.map((r) => r.status)).toContain("UNCOMPARABLE");
  });

  it("returns NOTHING to compare when the live side is empty (absent in the live DB)", () => {
    expect(
      diffFunctionBodies(snapshot, "").filter(
        (r) => r.status !== "SNAPSHOT_ONLY",
      ),
    ).toEqual([]);
  });
});

describe("CLI", () => {
  it("--normalize prints the normalized text of a file and exits 0", () => {
    withTempDir((dir) => {
      const f = join(dir, "a.sql");
      writeFileSync(f, "SELECT 1; -- gone\n\n  SELECT   2;");
      const out = execFileSync("node", [SCRIPT, "--normalize", f], {
        encoding: "utf8",
      });
      expect(out.trim()).toBe("SELECT 1; SELECT 2;");
    });
  });

  it("--normalize reads stdin when given no file", () => {
    const out = execFileSync("node", [SCRIPT, "--normalize"], {
      encoding: "utf8",
      input: "SELECT   1; /* x */",
    });
    expect(out.trim()).toBe("SELECT 1;");
  });

  it("--hash prints the sha256 of the normalized text", () => {
    withTempDir((dir) => {
      const f = join(dir, "a.sql");
      writeFileSync(f, "SELECT 1; -- gone");
      const out = execFileSync("node", [SCRIPT, "--hash", f], {
        encoding: "utf8",
      }).trim();
      expect(out).toBe(
        createHash("sha256").update("SELECT 1;", "utf8").digest("hex"),
      );
    });
  });

  it("--function-names lists the functions a migration creates or replaces, ignoring commented mentions", () => {
    withTempDir((dir) => {
      const f = join(dir, "m.sql");
      writeFileSync(
        f,
        "-- CREATE OR REPLACE FUNCTION public.ghost()\nCREATE OR REPLACE FUNCTION public.real(a INT) RETURNS INT LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$;\n",
      );
      const out = execFileSync("node", [SCRIPT, "--function-names", f], {
        encoding: "utf8",
      });
      expect(out.trim().split("\n")).toEqual(["real"]);
    });
  });

  it("--diff-bodies prints TSV rows carrying ONLY status, name, nargs, hashes and hunk counts — never body text", () => {
    withTempDir((dir) => {
      const snap = join(dir, "snap.sql");
      const live = join(dir, "live.sql");
      writeFileSync(
        snap,
        "CREATE OR REPLACE FUNCTION public.f(a INT) RETURNS INT LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$;",
      );
      writeFileSync(
        live,
        "CREATE OR REPLACE FUNCTION public.f(a integer) RETURNS integer LANGUAGE plpgsql AS $function$ BEGIN RETURN 2; END $function$",
      );
      const out = execFileSync("node", [SCRIPT, "--diff-bodies", snap, live], {
        encoding: "utf8",
      });
      expect(out).toMatch(/^DRIFT\tf\t1\t[0-9a-f]{64}\t[0-9a-f]{64}\t\d+$/m);
      // Public-log redaction (T-164.3-04): no body text may appear.
      expect(out).not.toContain("RETURN");
      expect(out).not.toContain("BEGIN");
    });
  });

  it("--extract-fn emits only the requested function's statements", () => {
    withTempDir((dir) => {
      const f = join(dir, "dump.sql");
      writeFileSync(
        f,
        "CREATE FUNCTION public.keep(a INT) RETURNS INT LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$;\n" +
          "CREATE FUNCTION public.drop_me(a INT) RETURNS INT LANGUAGE plpgsql AS $$ BEGIN RETURN 9; END $$;\n",
      );
      const out = execFileSync("node", [SCRIPT, "--extract-fn", f, "keep"], {
        encoding: "utf8",
      });
      expect(out).toContain("public.keep");
      expect(out).not.toContain("drop_me");
      expect(extractFunctionDefs(out).map((d) => d.name)).toEqual(["keep"]);
    });
  });

  it("--extract-fn on an absent function emits nothing and exits 0 (a new function is not drift)", () => {
    withTempDir((dir) => {
      const f = join(dir, "dump.sql");
      writeFileSync(
        f,
        "CREATE FUNCTION public.keep() RETURNS INT LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$;\n",
      );
      const out = execFileSync("node", [SCRIPT, "--extract-fn", f, "nope"], {
        encoding: "utf8",
      });
      expect(out.trim()).toBe("");
    });
  });

  it("--self-test exits 0", () => {
    expect(() =>
      execFileSync("node", [SCRIPT, "--self-test"], { encoding: "utf8" }),
    ).not.toThrow();
  });

  it("an unknown mode exits non-zero (never a silent pass)", () => {
    expect(() =>
      execFileSync("node", [SCRIPT, "--nonsense"], {
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow();
  });
});
