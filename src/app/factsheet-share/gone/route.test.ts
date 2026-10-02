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
// Phase 164 / SHARE-04 (class-honesty sweep): the body no longer asserts a
// CAUSE it cannot know. This handler serves unknown tokens, malformed tokens
// and share-read errors as well as genuine revokes, so "the person who shared
// it turned it off" was false in three of its four reachable states. The
// replacement covers all of them and still refuses to distinguish them, which
// is what keeps the response free of an existence oracle.
const BODY =
  "It may have been turned off by the person who shared it, or it may never " +
  "have been valid. Ask them for a new link.";

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

  it("suppresses the referrer entirely — the SAME-ORIGIN hop is the leak, not the cross-origin one", async () => {
    // ⛔ CORRECTED 2026-08-28. This test's name and comment previously claimed
    // `Referrer-Policy` "does not strip" a path segment, and that the
    // query-param design would have been safer. That is FALSE, and the error
    // was mine — it propagated from 164-CONTEXT.md into three files.
    //
    // Under the default `strict-origin-when-cross-origin`, a CROSS-origin
    // request sends only the origin: neither the path nor the query survives.
    // The path-vs-query choice is therefore Referrer-neutral, and D-01 costs
    // nothing here.
    //
    // The real gap is SAME-ORIGIN, where the full URL — token and all — is sent
    // and lands in our own edge and analytics logs. `no-referrer` is what closes
    // that, and it is why this header is per-route rather than global.
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
