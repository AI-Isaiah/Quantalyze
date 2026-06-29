import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runCheck,
  stripComments,
} from "../../scripts/check-route-contract";
import type { RouteEntry } from "../lib/routing/route-contract-manifest";

/**
 * Regression tests for `scripts/check-route-contract.ts` — the CI lockstep
 * gate that prevents a page route from moving (or being added) without an
 * explicit, cross-checked contract declaration (Phase 51 NAV-03, the #512
 * class).
 *
 * Each `it()` asserts a SPECIFIC violation string the gate must emit for a
 * crafted fixture (one rule per describe block), plus a golden no-violation
 * pass. Do NOT soften these assertions — a guard that emits the wrong code (or
 * none) is the regression these pins exist to catch.
 *
 * Strategy (mirrors src/__tests__/check-admin-route-manifest.test.ts): build a
 * tiny `<root>/src/app/.../page.tsx` tree plus a `<root>/src/proxy.ts` fixture
 * carrying a `const PUBLIC_ROUTES = [...]` literal per test, hand-craft a
 * fixture manifest, and assert the returned violations array. No process exit,
 * no console capture — `runCheck` is pure.
 */

let fixtureRoot: string;

function writeRoute(relativePath: string, contents: string): void {
  const abs = join(fixtureRoot, relativePath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, contents, "utf-8");
}

const PAGE_STUB = `export default function Page() {
  return null;
}
`;

// A proxy.ts fixture whose live PUBLIC_ROUTES array lists exactly the given
// routes. The guard parses this exact array literal (proxy.ts line 7 shape).
function proxyWithPublicRoutes(routes: string[]): string {
  const literal = routes.map((r) => `"${r}"`).join(", ");
  return `import { type NextRequest, NextResponse } from "next/server";
const PUBLIC_ROUTES = [${literal}];
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublicRoute =
    path === "/" ||
    PUBLIC_ROUTES.some((route) => path === route || path.startsWith(route + "/"));
  if (!isPublicRoute) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next({ request });
}
`;
}

// The comment-bypass fixture: PUBLIC_ROUTES contains ONLY "/login"; the
// "/legal" string appears solely inside a comment. A guard that parsed the raw
// source (without stripComments) might count the commented "/legal" as a real
// PUBLIC_ROUTES member and wrongly let the Rule-2 lockstep pass for a
// manifest-"public" /legal. The hardened tokenizer must NOT count it.
const PROXY_LEGAL_ONLY_IN_COMMENT = `import { type NextRequest, NextResponse } from "next/server";
// Historical note: "/legal" used to live in this array before the marketing
// move — see the route-contract manifest for the current classification.
const PUBLIC_ROUTES = ["/login"];
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublicRoute =
    path === "/" ||
    PUBLIC_ROUTES.some((route) => path === route || path.startsWith(route + "/"));
  if (!isPublicRoute) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next({ request });
}
`;

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "check-route-contract-"));
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("runCheck — golden path", () => {
  it("PASS: a public route present in BOTH the manifest AND PUBLIC_ROUTES → no violations", () => {
    writeRoute("src/app/(marketing)/legal/page.tsx", PAGE_STUB);
    writeRoute("src/proxy.ts", proxyWithPublicRoutes(["/legal"]));
    const manifest: RouteEntry[] = [
      { route: "/legal", class: "public", notes: "" },
    ];
    const violations = runCheck(fixtureRoot, manifest);
    expect(violations).toEqual([]);
  });
});

describe("runCheck — Rule 2 (#512 lockstep: manifest-public ⊆ PUBLIC_ROUTES)", () => {
  it("emits MISSING-FROM-PUBLIC when a manifest 'public' route is absent from PUBLIC_ROUTES", () => {
    // /legal is on disk and classified public, but PUBLIC_ROUTES only lists
    // /login → the #512 regression: anon recipient would 307→login. Rule 2
    // must catch it.
    writeRoute("src/app/(marketing)/legal/page.tsx", PAGE_STUB);
    writeRoute("src/proxy.ts", proxyWithPublicRoutes(["/login"]));
    const manifest: RouteEntry[] = [
      { route: "/legal", class: "public", notes: "" },
    ];
    const violations = runCheck(fixtureRoot, manifest);
    expect(violations.some((v) => /MISSING-FROM-PUBLIC/.test(v))).toBe(true);
    expect(violations.some((v) => v.includes("/legal"))).toBe(true);
  });
});

describe("runCheck — Rule 5 (inverse #512 lockstep: no private/admin route in PUBLIC_ROUTES)", () => {
  it("emits EXTRA-PUBLIC when a manifest 'private' route is covered by a PUBLIC_ROUTES prefix", () => {
    // /vault is a session-gated page (class "private") but someone added it to
    // PUBLIC_ROUTES — an anon visitor would reach it. This is the INVERSE of
    // Rule 2 and the more dangerous direction (anon EXPOSURE, not lockout): the
    // exact silent-auth-hole the route-contract guard exists to refuse.
    writeRoute("src/app/vault/page.tsx", PAGE_STUB);
    writeRoute("src/proxy.ts", proxyWithPublicRoutes(["/vault"]));
    const manifest: RouteEntry[] = [
      { route: "/vault", class: "private", notes: "" },
    ];
    const violations = runCheck(fixtureRoot, manifest);
    expect(violations.some((v) => /EXTRA-PUBLIC/.test(v))).toBe(true);
    expect(violations.some((v) => v.includes("/vault"))).toBe(true);
  });

  it("does NOT flag a private route that only shares a prefix STRING with a public one (sibling-safe)", () => {
    // PUBLIC_ROUTES has the public "/strategy" artifact; the private
    // "/strategies" route shares the leading substring but is NOT covered by the
    // prefix+"/" matcher. Rule 5 must reuse the sibling-safe matcher so it does
    // not false-positive here (the C-0186 substring hazard, inverted).
    writeRoute("src/app/strategy/page.tsx", PAGE_STUB);
    writeRoute("src/app/strategies/page.tsx", PAGE_STUB);
    writeRoute("src/proxy.ts", proxyWithPublicRoutes(["/strategy"]));
    const manifest: RouteEntry[] = [
      { route: "/strategy", class: "public", notes: "" },
      { route: "/strategies", class: "private", notes: "" },
    ];
    const violations = runCheck(fixtureRoot, manifest);
    expect(violations.some((v) => /EXTRA-PUBLIC/.test(v))).toBe(false);
  });
});

describe("runCheck — Rule 1 (every page route classified)", () => {
  it("emits UNCLASSIFIED for a page.tsx with no manifest entry", () => {
    // A page exists on disk but the manifest is empty → unclassified route.
    writeRoute("src/app/orphan/page.tsx", PAGE_STUB);
    writeRoute("src/proxy.ts", proxyWithPublicRoutes(["/login"]));
    const violations = runCheck(fixtureRoot, []);
    expect(violations.some((v) => /UNCLASSIFIED/.test(v))).toBe(true);
    expect(violations.some((v) => v.includes("/orphan"))).toBe(true);
  });
});

describe("runCheck — Rule 3 (redirectFrom has a matching redirects() source)", () => {
  it("emits MISSING-REDIRECT when a manifest entry's redirectFrom has no next.config.ts redirects() entry", () => {
    // /new-legal was moved from /legal but next.config.ts has an empty
    // redirects() → the old /legal link would 404. Rule 3 must catch it.
    writeRoute("src/app/new-legal/page.tsx", PAGE_STUB);
    writeRoute("src/proxy.ts", proxyWithPublicRoutes(["/new-legal"]));
    writeRoute(
      "next.config.ts",
      `import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  async redirects() {
    return [];
  },
};
export default nextConfig;
`,
    );
    const manifest: RouteEntry[] = [
      {
        route: "/new-legal",
        class: "public",
        redirectFrom: "/legal",
        notes: "moved during the marketing consolidation",
      },
    ];
    const violations = runCheck(fixtureRoot, manifest);
    expect(violations.some((v) => /MISSING-REDIRECT/.test(v))).toBe(true);
    expect(violations.some((v) => v.includes("/legal"))).toBe(true);
  });
});

describe("runCheck — Rule 4 (no STALE manifest entries)", () => {
  it("emits STALE when a manifest entry maps to no real page file", () => {
    // The manifest declares /ghost but there is no src/app/ghost/page.tsx.
    writeRoute("src/proxy.ts", proxyWithPublicRoutes(["/login"]));
    const manifest: RouteEntry[] = [
      { route: "/ghost", class: "private", notes: "" },
    ];
    const violations = runCheck(fixtureRoot, manifest);
    expect(violations.some((v) => /STALE/.test(v))).toBe(true);
    expect(violations.some((v) => v.includes("/ghost"))).toBe(true);
  });
});

describe("runCheck — comment-bypass carve-out (the stripComments regression)", () => {
  it("a manifest 'public' /legal whose ONLY PUBLIC_ROUTES match is commented-out still violates Rule 2", () => {
    // The proxy fixture's live PUBLIC_ROUTES is ["/login"]; "/legal" appears
    // only inside a comment. A guard that parsed the raw source would count
    // the commented "/legal" and wrongly pass the lockstep. The hardened
    // stripComments tokenizer must erase the comment so /legal still reads as
    // MISSING-FROM-PUBLIC. (Mirrors the admin guard's S1 comment-bypass pin.)
    writeRoute("src/app/(marketing)/legal/page.tsx", PAGE_STUB);
    writeRoute("src/proxy.ts", PROXY_LEGAL_ONLY_IN_COMMENT);
    const manifest: RouteEntry[] = [
      { route: "/legal", class: "public", notes: "" },
    ];
    const violations = runCheck(fixtureRoot, manifest);
    expect(violations.some((v) => /MISSING-FROM-PUBLIC/.test(v))).toBe(true);
    expect(violations.some((v) => v.includes("/legal"))).toBe(true);
  });

  it("stripComments erases a commented-out '/legal' so it cannot read as a live PUBLIC_ROUTES member", () => {
    // Directly pin the tokenizer property the carve-out relies on: the
    // "/legal" inside the comment must be gone post-strip. (stripComments
    // whitespaces ALL string CONTENTS too — including the live "/login" — so
    // the route strings are read from the ORIGINAL source within the located
    // span, never from the stripped text. The stripped text is used ONLY to
    // locate the LIVE `const PUBLIC_ROUTES = [` declaration, which survives;
    // a commented-out PUBLIC_ROUTES line leaves no such declaration.)
    const stripped = stripComments(PROXY_LEGAL_ONLY_IN_COMMENT);
    // The commented "/legal" mention is erased — it cannot be matched.
    expect(stripped.includes("/legal")).toBe(false);
    // The live `const PUBLIC_ROUTES = [ ... ]` declaration survives so the
    // parser can still locate the live (non-commented) array.
    expect(stripped).toMatch(/const PUBLIC_ROUTES\s*=\s*\[/);
  });
});
