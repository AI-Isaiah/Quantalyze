import { describe, it, expect } from "vitest";

import { GET } from "./route";

/**
 * Phase 164 / SHARE-03 (ruling D-08) — the 410 emitter.
 *
 * This handler is where EVERY miss on the token lane lands: unknown token,
 * malformed token, revoked token, DB error. Two independent properties are
 * pinned, and they fail in opposite directions:
 *
 *   1. THE STATUS IS HONEST. A dead link must not answer 200. Rendering a
 *      "this link is off" page under a success status is the same dishonesty
 *      class this milestone keeps closing — every automated consumer (curl, a
 *      link checker, an unfurler, a monitoring probe) reads the status line,
 *      not the prose.
 *   2. THE BODY DISCLOSES NOTHING. The person holding a revoked link is, by
 *      construction, someone the owner decided should no longer see the
 *      strategy. A name, an id, a metric or an owner identity in this response
 *      would hand them exactly what the revoke took away.
 *
 * Copy literals are typed HERE, never imported from route.ts — an imported
 * constant makes the oracle self-referential, and a copy rewrite could then
 * never fail this file.
 */

const HEADING = "This link is no longer active";
const BODY = "The person who shared it turned it off. Ask them for a new link.";

describe("GET /factsheet-share/gone — status", () => {
  it("returns a genuine HTTP 410, not a 200 or a 404", async () => {
    const res = await GET();
    // 410 GONE, specifically: 404 would be the bare-id lane's answer (which
    // must stay an existence-oracle-free uniform miss), and 200 would be a
    // status line that says "fine" about a dead link.
    expect(res.status).toBe(410);
  });

  it("is HTML, so a browser following the redirect renders prose rather than downloading a blob", async () => {
    const res = await GET();
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
  });
});

describe("GET /factsheet-share/gone — caching and indexing", () => {
  it("is no-store: a shared cache is keyed on the URL, never on revocation state", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("carries X-Robots-Tag noindex — a 410 body must never be indexed under a share URL", async () => {
    const res = await GET();
    expect(res.headers.get("x-robots-tag")).toMatch(/noindex/);
  });

  it("suppresses the referrer entirely (the token is a PATH segment, which Referrer-Policy does not strip)", async () => {
    // Under the query-param design the origin's
    // `strict-origin-when-cross-origin` would have dropped the token. As a path
    // segment it survives, so this hop opts out of sending a referrer at all.
    const res = await GET();
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("GET /factsheet-share/gone — the body is content-free", () => {
  it("carries the exact dead-link copy", async () => {
    const text = await (await GET()).text();
    expect(text).toContain(HEADING);
    expect(text).toContain(BODY);
  });

  it("names no strategy, no id, and no owner — and carries no UUID shape", async () => {
    const text = await (await GET()).text();
    expect(text).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    for (const forbidden of ["strategy", "Strategy", "owner", "@"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("its <main> content carries no digits at all — no metric or id fragment can hide in it", async () => {
    const text = await (await GET()).text();
    // Read the REAL rendered <main> out of the response (not a re-typed copy of
    // it — that would be an oracle that cannot fail). The <head> is excluded
    // because `initial-scale=1` and `charset=utf-8` are fixed boilerplate.
    const main = /<main>([\s\S]*?)<\/main>/.exec(text)?.[1];
    expect(main, "the response must actually contain a <main> block").toBeTypeOf(
      "string",
    );
    // Tags are stripped before the digit scan — `<h1>` legitimately carries a
    // digit and is structure, not content.
    const prose = main!.replace(/<[^>]*>/g, "");
    // A blunt instrument on purpose. Any future edit that pastes a number into
    // this page — a strategy count, a Sharpe, an id fragment, a support-ticket
    // reference — trips this and has to justify itself.
    expect(prose).not.toMatch(/[0-9]/);
    // Non-vacuity: the extraction really did find the shipped copy, so an
    // extractor silently returning "" cannot green the assertion above.
    expect(prose).toContain(HEADING);
    expect(prose).toContain(BODY);
  });

  it("is small — a content-free page has no room for a payload", async () => {
    const text = await (await GET()).text();
    // Not a style preference: the 410 body is the one surface a revoked-link
    // holder can still fetch, so its size is a proxy for how much could be
    // hidden in it. ~600 bytes is the shipped shell plus the two sentences.
    expect(text.length).toBeLessThan(800);
  });
});
