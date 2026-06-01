import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { withPublishedOnly } from "./visibility";

describe("withPublishedOnly", () => {
  it("appends .eq('status','published') and returns the SAME builder (chain preserved)", () => {
    // Fake PostgrestFilterBuilder: .eq returns the builder (mirrors the real
    // `this`-polymorphic return) so downstream .order()/.limit()/.single()
    // keep chaining off the helper's result.
    const builder: { eq: ReturnType<typeof vi.fn> } = {
      eq: vi.fn(() => builder),
    };
    const result = withPublishedOnly(builder);

    expect(builder.eq).toHaveBeenCalledTimes(1);
    expect(builder.eq).toHaveBeenCalledWith("status", "published");
    // The exact builder is returned — the caller's chain + query type survive.
    expect(result).toBe(builder);
  });

  it("only appends the predicate — it does not touch the rest of the query", () => {
    const builder: {
      eq: ReturnType<typeof vi.fn>;
      order: ReturnType<typeof vi.fn>;
      limit: ReturnType<typeof vi.fn>;
    } = {
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
    };
    withPublishedOnly(builder);
    // The helper must not order/limit/select on the caller's behalf.
    expect(builder.order).not.toHaveBeenCalled();
    expect(builder.limit).not.toHaveBeenCalled();
  });
});

describe("B10 visibility sweep — by-construction enforcement", () => {
  // Until the B25 lint rule lands, THIS test is the teeth: any new raw
  // published predicate that bypasses withPublishedOnly fails CI, so a future
  // strategy fetcher can't silently drift back to a hand-copied predicate.
  // The matcher is QUOTE- and WHITESPACE-tolerant — `.eq("status","published")`
  // (no space), single quotes, or a multi-line split all match — because
  // nothing in the toolchain (no Prettier; eslint adds no quote/comma-spacing
  // rule) normalises the spelling, so an exact-substring needle would let a
  // no-space variant slip through (the exact gap a review skeptic planted +
  // proved). The only files permitted to contain it are the helper itself
  // (HELPER) and the single sanctioned exception (SANCTIONED).
  const SANCTIONED = new Set<string>(["src/lib/notes/ownership.ts"]);
  const HELPER = "src/lib/visibility.ts";
  const SRC = join(process.cwd(), "src");
  // .eq( "status" , "published" ) — either quote style, any surrounding spacing.
  const RAW_PUBLISHED = /\.eq\(\s*["']status["']\s*,\s*["']published["']\s*\)/;

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...walk(p));
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.(test|spec)\.[tj]sx?$/.test(entry.name)) continue;
      out.push(p);
    }
    return out;
  }

  it("has no raw published predicate outside withPublishedOnly + the one sanctioned exception", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(process.cwd(), file);
      if (rel === HELPER || SANCTIONED.has(rel)) continue;
      if (RAW_PUBLISHED.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
    expect(
      offenders,
      `Raw \`.eq("status","published")\` (any quote/spacing) found — route these ` +
        `through withPublishedOnly() from @/lib/visibility (or, if genuinely a ` +
        `different shape, add a documented \`B10 sanctioned-exception:\` marker ` +
        `+ the path to SANCTIONED): ` +
        offenders.join(", "),
    ).toEqual([]);
  });

  it("the sanctioned exception still uses the raw predicate (guards allowlist rot)", () => {
    // If notes/ownership.ts ever stops using the raw predicate, prune it from
    // SANCTIONED rather than letting a stale allow-entry mask a real offender.
    for (const rel of SANCTIONED) {
      const text = readFileSync(join(process.cwd(), rel), "utf8");
      expect(
        RAW_PUBLISHED.test(text),
        `${rel} no longer contains the raw predicate — drop it from SANCTIONED`,
      ).toBe(true);
    }
  });
});
