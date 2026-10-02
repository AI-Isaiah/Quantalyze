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
  // RANK-09 (159-07): the uid is now SHAPE-VALIDATED before interpolation, so
  // every happy-path fixture must be a real UUID. `uid-123` used to work here
  // only because nothing checked.
  const OWNER = "00000000-0000-0000-0000-000000000001";
  const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";

  it("appends .or('status.eq.published,user_id.eq.<uid>') and returns the SAME builder (chain preserved)", () => {
    // Fake PostgrestFilterBuilder: .or returns the builder (mirrors the real
    // `this`-polymorphic return) so downstream .order()/.limit()/.single()
    // keep chaining off the helper's result.
    const builder: { or: ReturnType<typeof vi.fn> } = {
      or: vi.fn(() => builder),
    };
    const result = withPublishedOrOwner(builder, OWNER);

    expect(builder.or).toHaveBeenCalledTimes(1);
    // The predicate mirrors the strategies_read RLS shape exactly:
    // published OR the caller's own rows. The id is interpolated verbatim.
    expect(builder.or).toHaveBeenCalledWith(
      `status.eq.published,user_id.eq.${OWNER}`,
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
    withPublishedOrOwner(builder, OWNER);
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
    withPublishedOrOwner(builder, OTHER_OWNER);
    const filter = builder.or.mock.calls[0][0] as string;
    expect(filter).toBe(`status.eq.published,user_id.eq.${OTHER_OWNER}`);
    expect(filter).not.toContain("attacker");
  });

  /**
   * RANK-09 (Phase 159-07, decision D-06) — SHAPE-VALIDATE BEFORE INTERPOLATING.
   *
   * `authUserId` is spliced verbatim into a PostgREST `.or()` filter STRING.
   * PostgREST parses that string as filter syntax, so a value carrying its own
   * commas / parens / operators is not data — it is grammar. Today's only
   * callers hand over a session-derived uid, so this is defence in depth; the
   * point is that the predicate must be safe by CONSTRUCTION rather than by the
   * good behaviour of every present and future caller.
   *
   * D-06 fixes the direction of failure: a non-conforming uid is treated as
   * ANONYMOUS (published-only), never as a permissive fallback. Fail CLOSED,
   * and loudly.
   */
  describe("uid shape validation (RANK-09 / D-06)", () => {
    /** Builder exposing BOTH spies so a test can prove which arm ran. */
    function fakeBuilder() {
      const builder: {
        or: ReturnType<typeof vi.fn>;
        eq: ReturnType<typeof vi.fn>;
      } = {
        or: vi.fn(() => builder),
        eq: vi.fn(() => builder),
      };
      return builder;
    }

    it("never interpolates a malformed uid — an injection-shaped value takes the published-only arm", () => {
      const builder = fakeBuilder();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      // A value engineered to close the `user_id.eq.` term and open its own:
      // if it ever reached `.or()`, PostgREST would parse the attacker's
      // grammar, not a uid.
      const result = withPublishedOrOwner(builder, "x) or (user_id.neq.z");

      expect(builder.or).not.toHaveBeenCalled();
      expect(builder.eq).toHaveBeenCalledTimes(1);
      expect(builder.eq).toHaveBeenCalledWith("status", "published");
      // The chain still survives — callers keep their builder + query type.
      expect(result).toBe(builder);

      spy.mockRestore();
    });

    it("fails LOUD — the rejection is logged under a stable, greppable prefix", () => {
      const builder = fakeBuilder();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      withPublishedOrOwner(builder, "x) or (user_id.neq.z");

      expect(spy).toHaveBeenCalledTimes(1);
      const [message] = spy.mock.calls[0];
      expect(String(message)).toContain("[visibility.withPublishedOrOwner]");
      // The raw value may travel only as a separate console.error ARGUMENT —
      // never spliced into the message template, and never into a filter.
      expect(String(message)).not.toContain("user_id.neq.z");

      spy.mockRestore();
    });

    it("fails CLOSED for every non-conforming shape (empty, undefined-coerced, near-miss UUID)", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      for (const bad of [
        "",
        undefined as unknown as string,
        null as unknown as string,
        "undefined",
        // A near-miss: right character count, wrong grouping.
        "00000000000000000000000000000001",
        // Right shape, but a non-hex character.
        "0000000g-0000-0000-0000-000000000001",
      ]) {
        const builder = fakeBuilder();
        withPublishedOrOwner(builder, bad);
        expect(builder.or, `\`${String(bad)}\` must not reach .or()`).not
          .toHaveBeenCalled();
        expect(builder.eq).toHaveBeenCalledWith("status", "published");
      }

      spy.mockRestore();
    });

    it("leaves the happy path byte-identical — a valid UUID still produces the exact .or payload", () => {
      const builder = fakeBuilder();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      withPublishedOrOwner(builder, OWNER);

      expect(builder.or).toHaveBeenCalledTimes(1);
      expect(builder.or).toHaveBeenCalledWith(
        `status.eq.published,user_id.eq.${OWNER}`,
      );
      expect(builder.eq).not.toHaveBeenCalled();
      // A valid uid is not an incident: nothing is logged.
      expect(spy).not.toHaveBeenCalled();

      spy.mockRestore();
    });
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
