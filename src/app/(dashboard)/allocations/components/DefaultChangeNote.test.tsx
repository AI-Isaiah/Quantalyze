import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DefaultChangeNote } from "./DefaultChangeNote";

/**
 * Phase 58 / 58-03 Task 2 — DefaultChangeNote (POLISH-03).
 *
 * The one-time union→intersection education note. Shown ONLY when the
 * intersection default truncates the union AND the user has not dismissed it.
 * Dismissal persists per-browser at the registered `composer.` key via the
 * hardened `useCrossTabStorage` primitive (no raw localStorage — B25 lint). The
 * note is SSR-safe: gated on `isHydrated` so a returning-dismissed user never
 * sees a one-frame flash. Root is `role="status" aria-live="polite"` (never
 * `role="alert"`). "Show full range" is the escape hatch calling onShowFullRange.
 *
 * Exercises the REAL primitive (deferred hydration) against a backing
 * localStorage Map — the same idiom as CollapsibleSection.test.tsx — so the
 * SSR-safe gate is genuinely tested, not stubbed away.
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

const KEY = "composer.coverageDefaultChangeNoteDismissed";

beforeEach(() => {
  lsStore.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
});

function renderNote(props: {
  memberCount?: number;
  intersectionTruncatesUnion?: boolean;
  onShowFullRange?: () => void;
}) {
  return render(
    <DefaultChangeNote
      memberCount={props.memberCount ?? 3}
      intersectionTruncatesUnion={props.intersectionTruncatesUnion ?? true}
      onShowFullRange={props.onShowFullRange ?? (() => {})}
    />,
  );
}

describe("DefaultChangeNote (POLISH-03)", () => {
  it("is HIDDEN when the intersection does not truncate the union (spans coincide)", async () => {
    act(() => {
      renderNote({ intersectionTruncatesUnion: false });
    });
    // Even after hydration settles, no note when nothing changed for the user.
    await waitFor(() => {
      expect(
        screen.queryByText(/Now showing the common period/),
      ).not.toBeInTheDocument();
    });
  });

  it("is SHOWN when truncation applies and not dismissed (after hydration)", async () => {
    act(() => {
      renderNote({ memberCount: 3, intersectionTruncatesUnion: true });
    });
    await waitFor(() => {
      expect(
        screen.getByText(/Now showing the common period where all/),
      ).toBeInTheDocument();
    });
    // The verbatim member count is interpolated (in a mono span, so assert the
    // composed textContent of the note rather than a single text node).
    expect(
      screen.getByTestId("scenario-default-change-note").textContent,
    ).toContain("all 3 overlap");
  });

  it("root is a polite live region (role=status, never role=alert)", async () => {
    const { container } = renderNote({ intersectionTruncatesUnion: true });
    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("'Show full range' calls onShowFullRange (the escape hatch)", async () => {
    const onShowFullRange = vi.fn();
    renderNote({ intersectionTruncatesUnion: true, onShowFullRange });
    const btn = await screen.findByRole("button", { name: /Show full range/i });
    fireEvent.click(btn);
    expect(onShowFullRange).toHaveBeenCalledTimes(1);
  });

  it("the × dismiss hides the note AND persists so a remount stays dismissed", async () => {
    const { unmount } = renderNote({ intersectionTruncatesUnion: true });
    const dismiss = await screen.findByRole("button", { name: /Dismiss/i });
    fireEvent.click(dismiss);
    // Immediately hidden.
    await waitFor(() => {
      expect(
        screen.queryByText(/Now showing the common period/),
      ).not.toBeInTheDocument();
    });
    // Persisted at the registered key.
    await waitFor(() => expect(lsStore.get(KEY)).toBe("true"));
    unmount();

    // Remount with the SAME truncation condition: the persisted dismissal wins,
    // the note never reappears (no flash-of-note for a returning user).
    act(() => {
      renderNote({ intersectionTruncatesUnion: true });
    });
    // Give deferred hydration a tick to adopt the stored "true".
    await new Promise((r) => setTimeout(r, 50));
    expect(
      screen.queryByText(/Now showing the common period/),
    ).not.toBeInTheDocument();
  });

  it("STATIC GUARD: no raw localStorage, exact key + verbatim copy, role=status not alert", () => {
    const src = readFileSync(
      path.resolve(
        process.cwd(),
        "src/app/(dashboard)/allocations/components/DefaultChangeNote.tsx",
      ),
      "utf8",
    );
    expect(src).toContain("useCrossTabStorage");
    expect(src).not.toContain("localStorage.setItem");
    expect(src).not.toContain("localStorage.getItem");
    expect(src).toContain(KEY);
    expect(src).toContain("Now showing the common period where all");
    expect(src).not.toContain('role="alert"');
    expect(src).toContain('role="status"');
  });
});
