import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { withPublishedOnly, withPublishedOrOwner } from "./visibility";

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

describe("withPublishedOrOwner", () => {
  it("appends .or('status.eq.published,user_id.eq.<uid>') and returns the SAME builder (chain preserved)", () => {
    // Fake PostgrestFilterBuilder: .or returns the builder (mirrors the real
    // `this`-polymorphic return) so downstream .order()/.limit()/.single()
    // keep chaining off the helper's result.
    const builder: { or: ReturnType<typeof vi.fn> } = {
      or: vi.fn(() => builder),
    };
    const result = withPublishedOrOwner(builder, "uid-123");

    expect(builder.or).toHaveBeenCalledTimes(1);
    // The predicate mirrors the strategies_read RLS shape exactly:
    // published OR the caller's own rows. The id is interpolated verbatim.
    expect(builder.or).toHaveBeenCalledWith(
      "status.eq.published,user_id.eq.uid-123",
    );
    expect(result).toBe(builder);
  });

  it("only appends the predicate — it does not order/limit on the caller's behalf", () => {
    const builder: {
      or: ReturnType<typeof vi.fn>;
      order: ReturnType<typeof vi.fn>;
      limit: ReturnType<typeof vi.fn>;
    } = {
      or: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
    };
    withPublishedOrOwner(builder, "uid-123");
    expect(builder.order).not.toHaveBeenCalled();
    expect(builder.limit).not.toHaveBeenCalled();
  });

  it("embeds EXACTLY the id it is given — no other id can enter the predicate", () => {
    // Wiring guarantee for the browse route: the ONLY id in the filter is the
    // argument. A caller that fed a client-supplied param instead of the
    // session id would change this string — which is what the route test pins.
    const builder: { or: ReturnType<typeof vi.fn> } = {
      or: vi.fn(() => builder),
    };
    withPublishedOrOwner(builder, "session-owner");
    const filter = builder.or.mock.calls[0][0] as string;
    expect(filter).toBe("status.eq.published,user_id.eq.session-owner");
    expect(filter).not.toContain("attacker");
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
