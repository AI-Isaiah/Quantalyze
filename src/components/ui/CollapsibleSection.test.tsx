import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { CollapsibleSection, COLLAPSIBLE_OPEN_ALL_EVENT } from "./CollapsibleSection";

/**
 * B7c — CollapsibleSection open/closed persistence (lifted to src/components/ui).
 *
 * The migration onto `useCrossTabStorage` + a `defaultOpen`-aware
 * `rawStringCodec` must preserve the pre-B7 contract:
 *   - ABSENT key → the section's `defaultOpen` prop wins.
 *   - the literal "closed"/"open" overrides the default.
 *   - junk in storage → falls back to `defaultOpen` (the codec self-coerces).
 *   - a user toggle persists the new state at the raw `storageKey` (byte-compat
 *     "open"/"closed", no JSON envelope).
 *   - the COLLAPSIBLE_OPEN_ALL_EVENT pops the section open AND persists it.
 *   - analytics are decoupled: an injected `onToggle` callback fires ONLY on a
 *     user-initiated toggle (after hydration, when state changed), NOT on the
 *     mount-time default-vs-stored reconciliation.
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

beforeEach(() => {
  lsStore.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
});

const KEY = "factsheet-collapse:strat-1:perf";

function renderSection(props: {
  defaultOpen?: boolean;
  storageKey?: string;
  onToggle?: (open: boolean) => void;
} = {}) {
  return render(
    <CollapsibleSection
      id="perf"
      title="Performance"
      storageKey={props.storageKey ?? KEY}
      defaultOpen={props.defaultOpen}
      onToggle={props.onToggle}
    >
      <p>body</p>
    </CollapsibleSection>,
  );
}

function detailsEl(): HTMLDetailsElement {
  return document.getElementById("perf") as HTMLDetailsElement;
}

describe("CollapsibleSection — hydration from storage", () => {
  it("absent key → defaultOpen=true keeps the section open", () => {
    act(() => {
      renderSection({ defaultOpen: true });
    });
    expect(detailsEl().open).toBe(true);
  });

  it("absent key → defaultOpen=false keeps the section closed", () => {
    act(() => {
      renderSection({ defaultOpen: false });
    });
    expect(detailsEl().open).toBe(false);
  });

  it("'closed' in storage overrides a defaultOpen=true section", () => {
    lsStore.set(KEY, "closed");
    act(() => {
      renderSection({ defaultOpen: true });
    });
    expect(detailsEl().open).toBe(false);
  });

  it("'open' in storage overrides a defaultOpen=false section", () => {
    lsStore.set(KEY, "open");
    act(() => {
      renderSection({ defaultOpen: false });
    });
    expect(detailsEl().open).toBe(true);
  });

  it("junk in storage falls back to defaultOpen (codec self-coerces)", () => {
    lsStore.set(KEY, "garbage-value");
    act(() => {
      renderSection({ defaultOpen: false });
    });
    expect(detailsEl().open).toBe(false);
  });

  it("does not re-persist the default over a stored value (no-clobber on hydration)", async () => {
    // The core B7 invariant for this consumer: mounting a defaultOpen=true
    // section on top of a stored "closed" must adopt "closed" WITHOUT writing
    // the default back over it (the `if (hydrated)` toggle guard +
    // the primitive's dirtyRef observe-without-rewrite). A regression here would
    // silently overwrite the user's collapsed layout with the section default.
    lsStore.set(KEY, "closed");
    localStorageMock.setItem.mockClear();
    act(() => {
      renderSection({ defaultOpen: true });
    });
    // Let any debounced persist tick flush before asserting no write happened.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(detailsEl().open).toBe(false);
    expect(lsStore.get(KEY)).toBe("closed");
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });
});

describe("CollapsibleSection — persist on toggle", () => {
  it("a user toggle persists 'closed'/'open' at the raw storageKey (byte-compat)", async () => {
    act(() => {
      renderSection({ defaultOpen: true });
    });
    // User collapses the section.
    act(() => {
      detailsEl().open = false;
      fireEvent(detailsEl(), new Event("toggle"));
    });
    // The primitive's persist is debounced (default 150ms); await the flush.
    await waitFor(() => expect(lsStore.get(KEY)).toBe("closed"));
    // User re-opens.
    act(() => {
      detailsEl().open = true;
      fireEvent(detailsEl(), new Event("toggle"));
    });
    await waitFor(() => expect(lsStore.get(KEY)).toBe("open"));
  });
});

describe("CollapsibleSection — onToggle analytics callback", () => {
  it("fires onToggle with the new open boolean on a user toggle, and NOT on mount-time hydration", async () => {
    // Mount on top of a stored "closed" while defaultOpen=true: the mount-time
    // reconciliation flips the rendered state from open→closed, but that is NOT
    // a user toggle and MUST NOT fire onToggle.
    lsStore.set(KEY, "closed");
    const onToggle = vi.fn();
    act(() => {
      renderSection({ defaultOpen: true, onToggle });
    });
    // Wait for the deferred hydration to settle (open→closed adoption).
    await waitFor(() => expect(detailsEl().open).toBe(false));
    expect(onToggle).not.toHaveBeenCalled();

    // Now a real user toggle: open the section.
    act(() => {
      detailsEl().open = true;
      fireEvent(detailsEl(), new Event("toggle"));
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(true);

    // And collapse it again.
    act(() => {
      detailsEl().open = false;
      fireEvent(detailsEl(), new Event("toggle"));
    });
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });

  it("toggling still works and persists when no onToggle is provided", async () => {
    act(() => {
      renderSection({ defaultOpen: true });
    });
    act(() => {
      detailsEl().open = false;
      fireEvent(detailsEl(), new Event("toggle"));
    });
    await waitFor(() => expect(lsStore.get(KEY)).toBe("closed"));
    expect(detailsEl().open).toBe(false);
  });
});

describe("CollapsibleSection — open-all event", () => {
  it("COLLAPSIBLE_OPEN_ALL_EVENT pops a closed section open and persists it", async () => {
    lsStore.set(KEY, "closed");
    act(() => {
      renderSection({ defaultOpen: true });
    });
    expect(detailsEl().open).toBe(false);
    act(() => {
      window.dispatchEvent(new Event(COLLAPSIBLE_OPEN_ALL_EVENT));
    });
    expect(detailsEl().open).toBe(true);
    await waitFor(() => expect(lsStore.get(KEY)).toBe("open"));
  });
});

describe("CollapsibleSection — no storageKey", () => {
  it("never reads or writes localStorage when no storageKey is provided", () => {
    act(() => {
      render(
        <CollapsibleSection id="perf" title="Performance" defaultOpen={false}>
          <p>body</p>
        </CollapsibleSection>,
      );
    });
    // Section honors defaultOpen with zero storage IO (the hook is disabled).
    expect(detailsEl().open).toBe(false);
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });
});
