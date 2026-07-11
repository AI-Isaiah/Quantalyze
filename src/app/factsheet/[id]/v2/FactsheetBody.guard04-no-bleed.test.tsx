import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * PERMANENT (GUARD-04) — the RT2-class cross-tab-bleed gate; do NOT delete at
 * milestone close.
 *
 * The composer mounts the REAL FactsheetBody under
 * `<FactsheetProvider persist={false}>` (ScenarioFactsheetChart, Phase 38). The
 * persist gate (factsheet-context.tsx:282 read half, :321 write half) is the
 * runtime control that prevents the ephemeral scenario chart's view-state from
 * bleeding cross-tab onto the shared `/allocations` URL / localStorage — the
 * Phase-38 RT2 information-disclosure class.
 *
 * This test pins that invariant at the FULL BODY surface (not just the provider
 * unit, which factsheet-context.provider.test.tsx already covers): it spies on
 * BOTH persistence sinks — `window.localStorage.setItem` AND
 * `window.history.replaceState` — drives a real view-state interaction in the
 * rendered body (the Display "Dark mode" toggle, which flips `darkMode` state →
 * a `?dark=1` URL rewrite + a `factsheet-v2:` localStorage blob on the REAL
 * route), advances past the 250ms write debounce, and asserts ZERO writes
 * SCOPED to the factsheet keyspace/URL.
 *
 * SCOPING (Pitfall 5): the assertions filter on the factsheet keyspace predicate
 * (`/^factsheet-v2|^factsheet-collapse/` for localStorage, `?range|?cmp|?dark`
 * for the URL) — NOT a blanket "setItem was never called". The legitimate
 * composer-collapse UI-pref key `composer-collapse:controls`
 * (ScenarioComposer.tsx) is OUT of scope and must NOT be flagged. This test
 * mounts only the factsheet body (not the full composer), so that key never
 * fires here — but the assertions are written as keyspace predicates so the
 * scoping is documented and a future composer-level reuse stays correct.
 *
 * FALSIFIABILITY (Rule 9): if `persist={false}` were removed from the mount
 * (default true), the write effect would fire and BOTH spies would record a
 * factsheet-keyspace write — every assertion below goes RED. Verified by
 * momentary mutation during authoring (toggle persist → true): the `?dark=1`
 * URL rewrite + the `factsheet-v2:` blob appear and the predicates trip.
 *
 * localStorage + sentry are stubbed because FactsheetProvider's persistence
 * primitive touches them on mount (even at persist={false}, the hook still
 * registers). Stub block mirrors FactsheetBody.scenario-mode.test.tsx verbatim.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => lsStore.clear()),
  key: vi.fn(() => null),
  length: 0,
};
vi.stubGlobal("localStorage", localStorageMock);
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

// Healthy full-resolution returns series (~300 points → the body is fully
// populated: every panel has real data, the ControlBar renders all actions
// including the Display menu's Dark-mode toggle).
function makeReturnsSeries(n: number, drift = 0.0015): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2023, 0, 1));
  for (let i = 0; i < n; i++) {
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin(i * 0.27) * 0.005,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

const populatedPayload = buildScenarioFactsheetPayload({
  portfolioDaily: makeReturnsSeries(300),
  benchmark: null,
});

// The factsheet view-state keyspace the persist gate owns. A write to any of
// these (or a URL mutation carrying one of the view-state params) is the RT2
// cross-tab-bleed surface this guard forbids under persist={false}.
const FACTSHEET_KEY_RE = /^factsheet-v2|^factsheet-collapse/;
const FACTSHEET_URL_PARAM_RE = /[?&](range|cmp|dark)=/;

/** Keyspace-scoped predicate: a setItem call writing into the factsheet keyspace. */
function isFactsheetKeyWrite(call: unknown[]): boolean {
  const key = call[0];
  return typeof key === "string" && FACTSHEET_KEY_RE.test(key);
}

/** Keyspace-scoped predicate: a replaceState call mutating a factsheet view-state URL param. */
function isFactsheetUrlWrite(call: unknown[]): boolean {
  // replaceState(state, unused, url) — the URL is the 3rd arg.
  const url = call[2];
  return typeof url === "string" && FACTSHEET_URL_PARAM_RE.test(url);
}

function renderBodyNoPersist() {
  return render(
    <FactsheetProvider payload={populatedPayload} persist={false}>
      <FactsheetBody
        payload={populatedPayload}
        scenarioMode
        hideHeader
        hideAllocatorSection
        hideFooter={false}
      />
    </FactsheetProvider>,
  );
}

beforeEach(() => {
  lsStore.clear();
  localStorageMock.setItem.mockClear();
  localStorageMock.getItem.mockClear();
  localStorageMock.removeItem.mockClear();
  // Reset the URL between tests; the write effect (when armed) mutates it.
  window.history.replaceState(null, "", "/allocations?tab=scenario");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FactsheetBody — PERMANENT no-cross-tab-bleed gate (GUARD-04, RT2 class)", () => {
  it("persist={false}: a Dark-mode toggle writes NOTHING to the factsheet keyspace or URL", async () => {
    const setItemSpy = vi.spyOn(window.localStorage, "setItem");
    const replaceSpy = vi.spyOn(window.history, "replaceState");

    act(() => {
      renderBodyNoPersist();
    });

    // Flush the provider's deferred storage load + hydration effect so
    // `hydrated.current` latches (the write effect arms only after that). The
    // latch happens REGARDLESS of persist — the gate is an early return AFTER
    // the latch — so any write suppression below is due to persist={false}, not
    // an un-hydrated provider.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const urlBefore = window.location.search;
    setItemSpy.mockClear();
    replaceSpy.mockClear();

    // Drive a real view-state mutation in the body: the Display "Dark mode"
    // toggle flips `darkMode` false→true. On the REAL route (persist=true) this
    // fires the debounced write effect → `?dark=1` URL rewrite + a
    // `factsheet-v2:` localStorage blob. Under persist={false} the effect's
    // `|| !persist` early-return must suppress BOTH halves.
    act(() => {
      fireEvent.click(screen.getByText("Dark mode"));
    });

    // Give the 250ms write debounce ample room to fire if the gate were absent.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    // localStorage WRITE gate (keyspace-scoped predicate, NOT "never called"):
    // no setItem touched the factsheet keyspace. composer-collapse:controls is
    // out of scope and would NOT be flagged by this predicate (it never fires
    // here anyway — only the body is mounted, not the composer).
    const factsheetKeyWrites = setItemSpy.mock.calls.filter(isFactsheetKeyWrite);
    expect(factsheetKeyWrites).toEqual([]);
    expect(lsStore.has(`factsheet-v2:${populatedPayload.strategyId}`)).toBe(false);

    // URL WRITE gate (keyspace-scoped predicate): no replaceState rewrote a
    // factsheet view-state param (?range / ?cmp / ?dark).
    const factsheetUrlWrites = replaceSpy.mock.calls.filter(isFactsheetUrlWrite);
    expect(factsheetUrlWrites).toEqual([]);
    expect(window.location.search).toBe(urlBefore);
    expect(window.location.search).not.toMatch(FACTSHEET_URL_PARAM_RE);
  });

  it("persist={false}: a Reset-view interaction writes NOTHING to the factsheet keyspace or URL", async () => {
    const setItemSpy = vi.spyOn(window.localStorage, "setItem");
    const replaceSpy = vi.spyOn(window.history, "replaceState");

    act(() => {
      renderBodyNoPersist();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const urlBefore = window.location.search;
    setItemSpy.mockClear();
    replaceSpy.mockClear();

    // "Reset view" calls resetXRange() + setComparator() — another view-state
    // mutation path through the same debounced write effect.
    act(() => {
      fireEvent.click(screen.getByText("Reset view"));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(setItemSpy.mock.calls.filter(isFactsheetKeyWrite)).toEqual([]);
    expect(replaceSpy.mock.calls.filter(isFactsheetUrlWrite)).toEqual([]);
    expect(window.location.search).toBe(urlBefore);
    expect(window.location.search).not.toMatch(FACTSHEET_URL_PARAM_RE);
  });

  // Phase 90.5 (LEV-01, GUARD-04 extension, T-90.5-15) — the ephemeral leverage
  // control must write NOTHING (no storage / URL / cookie) and a fresh view must
  // open at 1× (no persisted, shareable modeled state). This pins the
  // Repudiation mitigation: a modeled what-if can never be persisted or shared as
  // if it were the real track.
  it("persist={false}: changing LEVERAGE on a single-key v5 payload writes NOTHING to storage/URL/cookies, and a fresh view opens at 1×", async () => {
    const setItemSpy = vi.spyOn(window.localStorage, "setItem");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const cookieBefore = document.cookie;

    // Single-key v5 payload (periodsPerYear present) — the ONLY shape that
    // renders the leverage control.
    const v5 = { ...populatedPayload, periodsPerYear: 365 } as typeof populatedPayload;
    let first!: ReturnType<typeof render>;
    act(() => {
      first = render(
        <FactsheetProvider payload={v5} persist={false}>
          <FactsheetBody payload={v5} hideHeader hideAllocatorSection hideFooter={false} />
        </FactsheetProvider>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const urlBefore = window.location.search;
    setItemSpy.mockClear();
    replaceSpy.mockClear();

    const input = first.container.querySelector(
      "#leverage-factsheet",
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    act(() => {
      fireEvent.change(input, { target: { value: "2" } });
    });
    // Give any (absent) debounced write ample room to fire if the control leaked.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    // The modeled state IS live locally (input reflects 2×) — but nothing bled.
    expect(input.value).toBe("2");
    expect(setItemSpy.mock.calls.filter(isFactsheetKeyWrite)).toEqual([]);
    expect(lsStore.has(`factsheet-v2:${v5.strategyId}`)).toBe(false);
    expect(replaceSpy.mock.calls.filter(isFactsheetUrlWrite)).toEqual([]);
    expect(window.location.search).toBe(urlBefore);
    expect(document.cookie).toBe(cookieBefore);

    // Reload-equivalence: unmount (the reload) then a fresh render of the SAME
    // payload opens at L=1 — no persisted leverage (ephemeral by construction).
    first.unmount();
    const fresh = render(
      <FactsheetProvider payload={v5} persist={false}>
        <FactsheetBody payload={v5} hideHeader hideAllocatorSection hideFooter={false} />
      </FactsheetProvider>,
    );
    const freshInput = fresh.container.querySelector(
      "#leverage-factsheet",
    ) as HTMLInputElement;
    expect(freshInput).not.toBeNull();
    expect(freshInput.value).toBe("1");
  });

  it("documents the scope: the keyspace predicate ALLOWS a composer-collapse write while forbidding factsheet keys", () => {
    // This is a pure predicate-scoping assertion (no render) — it pins the
    // Pitfall-5 boundary so a future reader knows the guard is keyspace-scoped,
    // not a blanket "no localStorage write". The legitimate composer UI-pref key
    // `composer-collapse:controls` is OUT of scope (allowed); only the factsheet
    // view-state keyspace is forbidden.
    expect(isFactsheetKeyWrite(["composer-collapse:controls", "open"])).toBe(false);
    expect(isFactsheetKeyWrite(["factsheet-v2:abc", "{}"])).toBe(true);
    expect(isFactsheetKeyWrite(["factsheet-collapse:abc", "{}"])).toBe(true);
    expect(isFactsheetUrlWrite([null, "", "/allocations?tab=scenario"])).toBe(false);
    expect(isFactsheetUrlWrite([null, "", "/allocations?dark=1"])).toBe(true);
    expect(isFactsheetUrlWrite([null, "", "/factsheet/x/v2?range=10-120"])).toBe(true);
  });
});
