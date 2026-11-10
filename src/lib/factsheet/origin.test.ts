/**
 * Phase 196 D-01 / ROUTE-04 — the factsheet back-link origin contract.
 *
 * WHY: the closed map is the open-redirect defence. A `from` or `cat` the
 * viewer supplies must never become an href. A test that only checks the happy
 * labels cannot fail when someone widens the set, so these arms are hostile.
 */
import { describe, it, expect } from "vitest";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { DISCOVERY_LANDING_ROUTE } from "@/lib/routing/default-route";
import {
  FACTSHEET_ORIGINS,
  backTargetFor,
  buildFactsheetHref,
  buildTearsheetHref,
  parseOrigin,
  type FactsheetOrigin,
} from "./origin";

describe("origin tracer", () => {
  it("from=discovery&cat=crypto-sma becomes Back to Discovery -> /discovery/crypto-sma", () => {
    const origin = parseOrigin({ from: "discovery", cat: "crypto-sma" });
    expect(origin).toEqual({ key: "discovery", cat: "crypto-sma" });
    expect(backTargetFor(origin)).toEqual({
      label: "Back to Discovery",
      href: "/discovery/crypto-sma",
    });
  });
});

describe("closed map: every key resolves to its label and fixed href", () => {
  it.each([
    ["allocations", "Back to My allocation", "/allocations"],
    ["strategies", "Back to Strategies", "/strategies"],
    ["recommendations", "Back to Recommendations", "/recommendations"],
    ["admin", "Back to Admin", "/admin"],
  ])("from=%s", (from, label, href) => {
    expect(backTargetFor(parseOrigin({ from }))).toEqual({ label, href });
  });

  it("from=browse without cat falls back to /browse", () => {
    expect(backTargetFor(parseOrigin({ from: "browse" }))).toEqual({
      label: "Back to Browse",
      href: "/browse",
    });
  });

  it("from=browse with a valid cat goes to /browse/<cat>", () => {
    expect(backTargetFor(parseOrigin({ from: "browse", cat: "cfd" }))).toEqual({
      label: "Back to Browse",
      href: "/browse/cfd",
    });
  });

  it("from=discovery with an unknown cat falls back to the default route", () => {
    expect(
      backTargetFor(parseOrigin({ from: "discovery", cat: "not-a-slug" })),
    ).toEqual({ label: "Back to Discovery", href: DISCOVERY_LANDING_ROUTE });
  });

  it("exposes exactly the six documented origins (the my-strategies origin is folded into strategies)", () => {
    expect(Object.keys(FACTSHEET_ORIGINS).sort()).toEqual(
      [
        "admin",
        "allocations",
        "browse",
        "discovery",
        "recommendations",
        "strategies",
      ].sort(),
    );
  });

  it("no origin yields no target", () => {
    expect(backTargetFor(null)).toBeNull();
    expect(parseOrigin({})).toBeNull();
  });
});

describe("legacy from value: an old link still lands on the one list (Phase 199 LEAN-01)", () => {
  // Phase 199 folded the my-strategies origin into strategies. Links already in
  // the wild (bookmarks, emails, a cached page) still carry the old `from`
  // value, so it is READ and mapped, never emitted.
  it("a legacy from=my-strategies reads as the strategies origin (Back to Strategies -> /strategies)", () => {
    const legacy = { from: "my-strategies" };
    expect(parseOrigin(legacy)).toEqual({ key: "strategies" });
    expect(parseOrigin(new URLSearchParams(legacy))).toEqual({ key: "strategies" });
    expect(backTargetFor(parseOrigin(legacy))).toEqual({
      label: "Back to Strategies",
      href: "/strategies",
    });
  });

  it("the legacy value is never emitted: a parsed legacy origin builds the strategies href", () => {
    const parsed = parseOrigin({ from: "my-strategies" });
    expect(buildFactsheetHref("abc", parsed)).toBe("/factsheet/abc?from=strategies");
  });

  it("the legacy map is exact-match: near-misses are no origin", () => {
    for (const from of ["my-strategies ", "MY-STRATEGIES", "my-strategies/x", "my_strategies"]) {
      expect(parseOrigin({ from })).toBeNull();
    }
  });
});

describe("hostile from values are no origin (open-redirect defence)", () => {
  it.each([
    "evil",
    "https://evil.example",
    "//evil.example",
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
    "",
    "DISCOVERY",
  ])("from=%j", (from) => {
    expect(parseOrigin({ from })).toBeNull();
    expect(parseOrigin(new URLSearchParams({ from }))).toBeNull();
  });

  it("an array from is no origin", () => {
    expect(parseOrigin({ from: ["discovery", "admin"] })).toBeNull();
  });

  it("a repeated from on URLSearchParams is no origin", () => {
    expect(parseOrigin(new URLSearchParams("from=discovery&from=admin"))).toBeNull();
  });

  it("a missing from is no origin", () => {
    expect(parseOrigin({ from: undefined })).toBeNull();
  });
});

describe("hostile cat values never reach an href", () => {
  it.each(["../admin", "//evil.example", "crypto-sma%2F..%2Fadmin", "crypto-sma/../admin", "CFD", ""])(
    "from=discovery&cat=%j falls back",
    (cat) => {
      const origin = parseOrigin({ from: "discovery", cat });
      expect(origin).toEqual({ key: "discovery" });
      expect(backTargetFor(origin)?.href).toBe(DISCOVERY_LANDING_ROUTE);
    },
  );

  it("an array cat falls back", () => {
    expect(parseOrigin({ from: "browse", cat: ["cfd", "crypto-sma"] })).toEqual({
      key: "browse",
    });
  });

  it("cat with from=admin is ignored by parseOrigin", () => {
    expect(parseOrigin({ from: "admin", cat: "cfd" })).toEqual({ key: "admin" });
  });

  it("cat with from=admin is dropped by buildFactsheetHref", () => {
    const origin = { key: "admin", cat: "cfd" } as FactsheetOrigin;
    expect(buildFactsheetHref("abc", origin)).toBe("/factsheet/abc?from=admin");
  });

  it("a cast-through unknown cat is dropped by buildFactsheetHref", () => {
    const origin = { key: "discovery", cat: "../admin" } as unknown as FactsheetOrigin;
    expect(buildFactsheetHref("abc", origin)).toBe("/factsheet/abc?from=discovery");
  });

  it("a cast-through unknown key adds nothing in buildFactsheetHref", () => {
    const origin = { key: "__proto__" } as unknown as FactsheetOrigin;
    expect(buildFactsheetHref("abc", origin)).toBe("/factsheet/abc");
  });
});

describe("buildFactsheetHref", () => {
  it("builds the from/cat shape", () => {
    expect(buildFactsheetHref("abc", { key: "discovery", cat: "cfd" })).toBe(
      "/factsheet/abc?from=discovery&cat=cfd",
    );
  });

  it("builds the bare path with no origin", () => {
    expect(buildFactsheetHref("abc")).toBe("/factsheet/abc");
    expect(buildFactsheetHref("abc", null)).toBe("/factsheet/abc");
  });

  it("encodes the strategy id as one path segment", () => {
    expect(buildFactsheetHref("a/b?c")).toBe("/factsheet/a%2Fb%3Fc");
  });

  const origins: FactsheetOrigin[] = [
    ...DISCOVERY_CATEGORIES.flatMap((c) => [
      { key: "discovery", cat: c.slug } as FactsheetOrigin,
      { key: "browse", cat: c.slug } as FactsheetOrigin,
    ]),
    { key: "discovery" },
    { key: "browse" },
    { key: "allocations" },
    { key: "strategies" },
    { key: "recommendations" },
    { key: "admin" },
  ];

  it.each(origins)("round-trips through parseOrigin: %j", (origin) => {
    const href = buildFactsheetHref("abc", origin);
    const parsed = parseOrigin(new URL(href, "https://example.test").searchParams);
    expect(parsed).toEqual(origin);
  });
});

describe("buildTearsheetHref (the ControlBar Print view link, D-09)", () => {
  it("is the factsheet path plus /tearsheet", () => {
    expect(buildTearsheetHref("abc")).toBe("/factsheet/abc/tearsheet");
  });

  it("encodes the id as one path segment, so a crafted id cannot add segments or a query", () => {
    expect(buildTearsheetHref("a/b?c")).toBe("/factsheet/a%2Fb%3Fc/tearsheet");
  });
});
