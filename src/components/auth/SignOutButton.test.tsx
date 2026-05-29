import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SignOutButton } from "./SignOutButton";
import { APP_NAMESPACED_PREFIXES } from "@/lib/storage-namespaces";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
  }),
}));

// jsdom-via-vitest's default localStorage shim is missing several Storage
// methods in this setup (other tests in the suite stub their own). Install
// a Map-backed Proxy that satisfies BOTH the explicit method API
// (setItem/getItem/removeItem/clear) AND `Object.keys(localStorage)` —
// SignOutButton's purge relies on the latter to enumerate keys.
function installLocalStorageShim(): Map<string, string> {
  const store = new Map<string, string>();
  const proto = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  };
  const proxy = new Proxy(proto, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof typeof target];
      if (prop === "length") return store.size;
      if (typeof prop === "string" && store.has(prop)) return store.get(prop);
      return undefined;
    },
    ownKeys() {
      return Array.from(store.keys());
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === "string" && store.has(prop)) {
        return {
          enumerable: true,
          configurable: true,
          value: store.get(prop),
          writable: true,
        };
      }
      return undefined;
    },
  });
  vi.stubGlobal("localStorage", proxy);
  return store;
}

describe("SignOutButton — T-13-02-01 cross-account localStorage purge", () => {
  beforeEach(() => {
    installLocalStorageShim();
  });

  it("purges every key matching every registered prefix", async () => {
    // Seed one key per registered prefix plus a Supabase auth key that
    // must survive the purge (the SDK owns sb-* — purging it would race
    // the server-side revocation handshake).
    const seeded: Record<string, string> = {
      "quantalyze-dashboard-config": '{"layout":"foo"}',
      "quantalyze-timeframe": "1Y",
      "quantalyze_wizard_state_v1": '{"step":3}',
      "allocations.scenario_v0_15.user-a-uuid": '{"weights":{}}',
      "allocations.tweaks": '{"density":"comfortable"}',
      "widget_state_v2": "true",
      "discovery_view_preferences:user-a:digital-assets": '{"view":"grid"}',
      "discovery.uiV2": "1",
      "admin-compute-jobs-auto-refresh": "true",
      // sb-* must survive
      "sb-access-token": "eyJ-survives",
      // Foreign extension key not owned by this app must survive
      "third-party-extension-state": "should-stay",
    };
    for (const [k, v] of Object.entries(seeded)) {
      window.localStorage.setItem(k, v);
    }

    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    // Wait for the (mocked) async signOut + redirect to settle. The purge
    // is synchronous so it actually runs before the await, but waitFor
    // smooths over react/testing-library scheduling.
    await waitFor(() => {
      expect(window.localStorage.getItem("sb-access-token")).toBe("eyJ-survives");
    });

    // Every registered prefix must have lost at least one key.
    for (const prefix of APP_NAMESPACED_PREFIXES) {
      const matchingKeys = Object.keys(window.localStorage).filter((k) =>
        k.startsWith(prefix),
      );
      expect(
        matchingKeys,
        `Keys with prefix ${prefix} should have been purged`,
      ).toHaveLength(0);
    }

    // sb-* and foreign keys survive.
    expect(window.localStorage.getItem("sb-access-token")).toBe("eyJ-survives");
    expect(window.localStorage.getItem("third-party-extension-state")).toBe(
      "should-stay",
    );
  });

  it("registry covers every concrete app key surveyed at write time", () => {
    // Inventory of every concrete localStorage key the app writes today.
    // Keep this list in sync with grep results for `localStorage.setItem(`
    // across src/ — a missed key here means the purge silently leaks
    // it across user accounts on shared devices (T-13-02-01).
    const KNOWN_APP_KEYS = [
      "quantalyze-dashboard-config", // legacy widget-grid config (writer retired in B7b; still prefix-purged)
      "quantalyze-timeframe", // useTimeframe.ts
      "quantalyze_wizard_state_v1", // wizard/localStorage.ts
      "allocations.scenario_v0_15.{allocatorId}", // scenario-state.ts (templated)
      "allocations.tweaks", // TweaksContext.tsx
      "widget_state_v2", // widget-state-flag.ts
      "discovery_view_preferences:{uid}:{slug}", // discovery-prefs.ts (templated)
      "admin-compute-jobs-auto-refresh", // ComputeJobsTable.tsx
    ];

    for (const key of KNOWN_APP_KEYS) {
      const matched = APP_NAMESPACED_PREFIXES.some((p) => key.startsWith(p));
      expect(
        matched,
        `Key "${key}" has no matching prefix in APP_NAMESPACED_PREFIXES — purge will leak it`,
      ).toBe(true);
    }
  });
});
