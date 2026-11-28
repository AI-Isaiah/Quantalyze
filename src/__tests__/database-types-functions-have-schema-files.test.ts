/**
 * Phase 224 DEADLEFTOVERS, DEAD-05: `src/lib/database.types.ts` declares no
 * function the schema lacks.
 *
 * Decision (CONTEXT, 2026-11-28): that file is a hand-curated partial
 * declaration of the schema, not a full regeneration target, so no
 * regeneration step is added and no workflow file grows. The schema snapshot
 * under `supabase/schema/functions/` (one `.sql` file per function, which every
 * migration PR already regenerates) is the reference it is checked against. A
 * migration that drops a function must remove its declaration in the same PR,
 * or this gate goes RED naming the function.
 *
 * Why it matters: a declared but absent function type-checks an `.rpc()` call
 * that then fails at run time.
 *
 * Liveness: the slice must be found and hold at least MIN_DECLARED names, so a
 * layout change in the types file cannot turn this into a vacuous pass.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TYPES_FILE = join(ROOT, "src", "lib", "database.types.ts");
const FUNCTIONS_DIR = join(ROOT, "supabase", "schema", "functions");
const MIN_DECLARED = 80;

function sliceFunctionsBlock(source: string): {
  start: number;
  end: number;
  block: string;
} {
  const start = source.indexOf("\n    Functions: {");
  const end = start === -1 ? -1 : source.indexOf("\n    Enums: {", start);
  return {
    start,
    end,
    block: start !== -1 && end > start ? source.slice(start, end) : "",
  };
}

function declaredNames(block: string): string[] {
  return [...block.matchAll(/^ {6}"?([A-Za-z0-9_]+)"?: /gm)].map((m) => m[1]);
}

describe("DEAD-05: database.types.ts functions have schema files", () => {
  const source = readFileSync(TYPES_FILE, "utf8");
  const { start, end, block } = sliceFunctionsBlock(source);
  const names = declaredNames(block);

  it("finds the Functions block (both markers, end after start)", () => {
    expect(start, "Functions: { marker").toBeGreaterThan(-1);
    expect(end, "Enums: { marker after Functions").toBeGreaterThan(start);
  });

  it(`declares at least ${MIN_DECLARED} functions (not vacuous)`, () => {
    expect(names.length).toBeGreaterThanOrEqual(MIN_DECLARED);
  });

  it("every declared function has supabase/schema/functions/<name>.sql", () => {
    const files = new Set(
      readdirSync(FUNCTIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .map((f) => f.slice(0, -".sql".length)),
    );
    const missing = names.filter((n) => !files.has(n));
    expect(
      missing,
      "declared in database.types.ts with no supabase/schema/functions file",
    ).toEqual([]);
  });
});
