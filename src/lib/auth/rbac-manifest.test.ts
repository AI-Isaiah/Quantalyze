import { describe, it, expect } from "vitest";
import {
  ADMIN_ROUTE_MANIFEST,
  type AdminGateMechanism,
} from "./rbac-manifest";

/**
 * Contract tests for the ADMIN_ROUTE_MANIFEST — the single source of
 * truth for which admin-gating mechanism every `/api/admin/**` route uses.
 *
 * audit-2026-05-07 testing T2 (HIGH conf 8): the CI check
 * `scripts/check-admin-route-manifest.ts` enforces current-vs-disk
 * agreement, but it does NOT enforce the invariants the manifest's OWN
 * documentation claims (alphabetical ordering, no duplicates, target ==
 * 'withRole' per ADR-0005 except the documented carve-out, non-empty
 * notes when current != target). A reviewer who reorders, duplicates, or
 * sets the wrong target slips through. These tests close that gap.
 */

describe("ADMIN_ROUTE_MANIFEST — data invariants", () => {
  it("is non-empty (sanity)", () => {
    expect(ADMIN_ROUTE_MANIFEST.length).toBeGreaterThan(0);
  });

  it("is alphabetical by `route` (the file's own contract on line 74)", () => {
    const routes = ADMIN_ROUTE_MANIFEST.map((e) => e.route);
    const sorted = [...routes].sort((a, b) => a.localeCompare(b));
    // localeCompare matches the deterministic ordering reviewers use; if
    // the file mixes locales / case, this surfaces it loudly.
    expect(routes).toEqual(sorted);
  });

  it("has no duplicate `route` strings", () => {
    const routes = ADMIN_ROUTE_MANIFEST.map((e) => e.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("every entry's `route` starts with the admin-API prefix", () => {
    for (const entry of ADMIN_ROUTE_MANIFEST) {
      expect(entry.route.startsWith("src/app/api/admin/")).toBe(true);
    }
  });

  it("every entry's `route` ends with `/route.ts` (Next App Router convention)", () => {
    for (const entry of ADMIN_ROUTE_MANIFEST) {
      expect(entry.route.endsWith("/route.ts")).toBe(true);
    }
  });

  it("ADR-0005 target invariant: target is 'withRole' unless current is 'authenticated-non-admin' (the only documented carve-out)", () => {
    for (const entry of ADMIN_ROUTE_MANIFEST) {
      if (entry.current === "authenticated-non-admin") {
        // Carve-out: target stays on 'authenticated-non-admin' — see
        // rbac-manifest.ts:40-46 for the rationale.
        expect(entry.target).toBe("authenticated-non-admin");
      } else {
        expect(entry.target).toBe<AdminGateMechanism>("withRole");
      }
    }
  });

  it("every entry where current != target has a non-empty `notes` string", () => {
    for (const entry of ADMIN_ROUTE_MANIFEST) {
      if (entry.current !== entry.target) {
        expect(entry.notes.length).toBeGreaterThan(0);
      }
    }
  });

  it("the `authenticated-non-admin` carve-out has at most one entry (notify-submission), per the file docstring", () => {
    // audit-2026-05-07 C-0153: new uses of the carve-out require explicit
    // review. If this count grows without an update to rbac-manifest.ts's
    // docstring (line 40-46) AND this test, the reviewer caught it.
    const carveOuts = ADMIN_ROUTE_MANIFEST.filter(
      (e) => e.current === "authenticated-non-admin",
    );
    expect(carveOuts.length).toBeLessThanOrEqual(1);
    if (carveOuts.length === 1) {
      expect(carveOuts[0].route).toContain("notify-submission");
    }
  });
});
