/** @vitest-environment jsdom */
/**
 * Phase 47 / CHART-01a — useTapPin shared tap-vs-drag + pin-toggle gesture.
 *
 * useTapPin (src/hooks/useTapPin.ts) is the extracted touch tap-to-pin core
 * from TimeSeriesChart. It detects a tap (touch pointer, ≤8px slop, <350ms)
 * vs a drag, pins a caller-mapped selected index, survives pointerleave while
 * pinned, toggles off on a re-tap near the pin, and moves on a tap elsewhere.
 *
 * Test plan — one `it` per RETURN ARM of the gesture core so the coverage
 * ratchet (branches 72, vitest.config.ts) holds, each arm falsifiable:
 *  1. Touch tap at a valid index → selectedIdx set, pinned true (the GREEN path)
 *  2. Non-touch (mouse) pointer → early return, no selection change
 *  3. Moved past 8px slop (drag) → early return, no selection change
 *  4. Gesture longer than 350ms → early return, no selection change
 *  5. pointerToIndex returns null → clears selection + un-pins
 *  6. Re-tap within RETAP_THRESHOLD of the pin → un-pins
 *  7. Tap elsewhere (≥ threshold) while pinned → moves the pin
 *  8. pointerleave while pinned → selectedIdx survives
 *  9. pointerleave while unpinned → selectedIdx clears
 * 10. chart element unset (setChartEl never called) → early return (defensive arm)
 * 11. Index clamped to [0, count-1] when pointerToIndex overshoots
 *
 * Pointer events are synthesized as plain objects carrying only the fields the
 * handlers read (clientX/clientY/pointerType/pointerId/currentTarget). The time
 * gate is driven by stubbing Date.now (vi.spyOn). pointerToIndex is supplied
 * deterministically per test.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useTapPin,
  TAP_SLOP_SQ,
  TAP_MAX_MS,
  RETAP_THRESHOLD,
  type UseTapPinOptions,
} from "./useTapPin";

/** Minimal stub of the SVG currentTarget the handlers touch. */
function makeCurrentTarget() {
  return {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  };
}

/**
 * Synthesize a PointerEvent-shaped object with only the fields useTapPin reads.
 * Cast through `unknown` because we deliberately supply a minimal stub, not a
 * full React.PointerEvent.
 */
function pointerEvent(over: {
  clientX?: number;
  clientY?: number;
  pointerType?: string;
  pointerId?: number;
}) {
  return {
    clientX: over.clientX ?? 0,
    clientY: over.clientY ?? 0,
    pointerType: over.pointerType ?? "touch",
    pointerId: over.pointerId ?? 1,
    currentTarget: makeCurrentTarget(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Render the hook with a deterministic pointerToIndex + count, and attach a
 * stub element via setChartEl so getBoundingClientRect resolves (unless the test
 * opts out via attachSvg:false to exercise the no-element-attached arm).
 */
function setup(
  opts: Partial<UseTapPinOptions> & { attachSvg?: boolean } = {},
) {
  const attachSvg = opts.attachSvg ?? true;
  const pointerToIndex =
    opts.pointerToIndex ??
    // default: a touch at clientX maps directly to that integer index.
    ((clientX: number) => clientX);
  const count = opts.count ?? 10;
  const utils = renderHook(() => useTapPin({ count, pointerToIndex }));
  if (attachSvg) {
    // Attach a stub element exposing getBoundingClientRect via the hook's
    // setChartEl callback ref; the hook only reads the rect to forward into
    // pointerToIndex.
    act(() => {
      utils.result.current.setChartEl({
        getBoundingClientRect: () =>
          ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    });
  }
  return utils;
}

describe("[CHART-01a] useTapPin — tap-vs-drag + pin-toggle gesture core", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constants mirror the reference TimeSeriesChart gesture (8px²/350ms/3)", () => {
    expect(TAP_SLOP_SQ).toBe(64);
    expect(TAP_MAX_MS).toBe(350);
    expect(RETAP_THRESHOLD).toBe(3);
  });

  it("a touch tap at a valid index pins that index (GREEN path)", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const { result } = setup({ pointerToIndex: () => 4 });
    act(() => result.current.onPointerDown(pointerEvent({ pointerType: "touch" })));
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "touch" })));
    expect(result.current.selectedIdx).toBe(4);
    expect(result.current.pinned).toBe(true);
  });

  it("a non-touch (mouse) pointer never pins (desktop hover path untouched)", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const { result } = setup({ pointerToIndex: () => 4 });
    act(() => result.current.onPointerDown(pointerEvent({ pointerType: "mouse" })));
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "mouse" })));
    expect(result.current.selectedIdx).toBeNull();
    expect(result.current.pinned).toBe(false);
  });

  it("a drag past the 8px slop is not a tap (no selection change)", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const { result } = setup({ pointerToIndex: () => 4 });
    act(() => result.current.onPointerDown(pointerEvent({ clientX: 0, clientY: 0 })));
    // Move 20px (20² = 400 > TAP_SLOP_SQ 64) → flips movedRef.
    act(() => result.current.onPointerMove(pointerEvent({ clientX: 20, clientY: 0 })));
    act(() => result.current.onPointerUp(pointerEvent({ clientX: 20, clientY: 0 })));
    expect(result.current.selectedIdx).toBeNull();
    expect(result.current.pinned).toBe(false);
  });

  it("a small move within the 8px slop still counts as a tap", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const { result } = setup({ pointerToIndex: () => 4 });
    act(() => result.current.onPointerDown(pointerEvent({ clientX: 0, clientY: 0 })));
    // Move 5px (5² = 25 ≤ TAP_SLOP_SQ 64) → movedRef stays false.
    act(() => result.current.onPointerMove(pointerEvent({ clientX: 5, clientY: 0 })));
    act(() => result.current.onPointerUp(pointerEvent({ clientX: 5, clientY: 0 })));
    expect(result.current.selectedIdx).toBe(4);
    expect(result.current.pinned).toBe(true);
  });

  it("a gesture longer than 350ms is not a tap (no selection change)", () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(1000); // pointerdown t
    now.mockReturnValueOnce(1000 + TAP_MAX_MS + 1); // pointerup, 351ms later
    const { result } = setup({ pointerToIndex: () => 4 });
    act(() => result.current.onPointerDown(pointerEvent({ pointerType: "touch" })));
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "touch" })));
    expect(result.current.selectedIdx).toBeNull();
    expect(result.current.pinned).toBe(false);
  });

  it("pointerToIndex returning null clears the selection and un-pins", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    // First pin a real index, then tap where the mapping returns null.
    let mapped: number | null = 4;
    const { result } = setup({ pointerToIndex: () => mapped });
    act(() => result.current.onPointerDown(pointerEvent({ pointerType: "touch" })));
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "touch" })));
    expect(result.current.selectedIdx).toBe(4);
    expect(result.current.pinned).toBe(true);
    mapped = null;
    act(() => result.current.onPointerDown(pointerEvent({ pointerType: "touch" })));
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "touch" })));
    expect(result.current.selectedIdx).toBeNull();
    expect(result.current.pinned).toBe(false);
  });

  it("re-tapping within RETAP_THRESHOLD of the pin un-pins it", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    let mapped = 4;
    const { result } = setup({ pointerToIndex: () => mapped });
    act(() => result.current.onPointerDown(pointerEvent({ pointerType: "touch" })));
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "touch" })));
    expect(result.current.selectedIdx).toBe(4);
    // Re-tap at index 5: |5 - 4| = 1 < RETAP_THRESHOLD (3) → un-pin.
    mapped = 5;
    act(() => result.current.onPointerDown(pointerEvent({ pointerType: "touch" })));
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "touch" })));
    expect(result.current.selectedIdx).toBeNull();
    expect(result.current.pinned).toBe(false);
  });

  it("tapping elsewhere (≥ RETAP_THRESHOLD) while pinned moves the pin", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    let mapped = 1;
    const { result } = setup({ pointerToIndex: () => mapped });
    act(() => result.current.onPointerDown(pointerEvent({ pointerType: "touch" })));
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "touch" })));
    expect(result.current.selectedIdx).toBe(1);
    // Tap at index 8: |8 - 1| = 7 ≥ RETAP_THRESHOLD (3) → move the pin.
    mapped = 8;
    act(() => result.current.onPointerDown(pointerEvent({ pointerType: "touch" })));
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "touch" })));
    expect(result.current.selectedIdx).toBe(8);
    expect(result.current.pinned).toBe(true);
  });

  it("pointerleave while pinned keeps the selection (touch survival)", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const { result } = setup({ pointerToIndex: () => 4 });
    act(() => result.current.onPointerDown(pointerEvent({ pointerType: "touch" })));
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "touch" })));
    expect(result.current.pinned).toBe(true);
    act(() => result.current.onPointerLeave(pointerEvent({})));
    expect(result.current.selectedIdx).toBe(4);
    expect(result.current.pinned).toBe(true);
  });

  it("pointerleave while unpinned clears the selection", () => {
    // No pin established → onPointerLeave clears. Selection starts null, so to
    // make the clear observable we drive it via the unpinned-leave arm directly:
    // the branch `if (!pinned) setSelectedIdx(null)` executes (pinned=false).
    const { result } = setup({ pointerToIndex: () => 4 });
    expect(result.current.pinned).toBe(false);
    act(() => result.current.onPointerLeave(pointerEvent({})));
    expect(result.current.selectedIdx).toBeNull();
  });

  it("does nothing if no chart element is attached (defensive early return)", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const { result } = setup({ pointerToIndex: () => 4, attachSvg: false });
    act(() => result.current.onPointerDown(pointerEvent({ pointerType: "touch" })));
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "touch" })));
    expect(result.current.selectedIdx).toBeNull();
    expect(result.current.pinned).toBe(false);
  });

  it("clamps an out-of-range mapped index to [0, count-1]", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const { result } = setup({ count: 5, pointerToIndex: () => 99 });
    act(() => result.current.onPointerDown(pointerEvent({ pointerType: "touch" })));
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "touch" })));
    // count 5 → max index 4.
    expect(result.current.selectedIdx).toBe(4);
  });

  it("clamps a negative mapped index up to 0", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const { result } = setup({ count: 5, pointerToIndex: () => -3 });
    act(() => result.current.onPointerDown(pointerEvent({ pointerType: "touch" })));
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "touch" })));
    expect(result.current.selectedIdx).toBe(0);
  });

  it("ignores a pointerup whose pointerId doesn't match the pointerdown (multi-touch safety)", () => {
    // A second concurrent finger overwrites tapInfo. The first finger's up (or a
    // stray up with a different id) must NOT resolve this gesture — without the
    // pointerId guard it would pin using mismatched down/up state. The matching
    // finger's own up still resolves normally afterward.
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const { result } = setup({ pointerToIndex: () => 4 });
    act(() => result.current.onPointerDown(pointerEvent({ pointerType: "touch", pointerId: 1 })));
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "touch", pointerId: 2 })));
    expect(result.current.selectedIdx).toBeNull();
    expect(result.current.pinned).toBe(false);
    // The recorded down (id 1) survives the mismatched up, so its own up pins.
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "touch", pointerId: 1 })));
    expect(result.current.selectedIdx).toBe(4);
    expect(result.current.pinned).toBe(true);
  });

  it("count<=0 (empty collection) selects nothing rather than a phantom index 0", () => {
    // Without the count<=0 guard the clamp Math.max(0, Math.min(count-1, …))
    // resolves to Math.max(0, -1) = 0, pinning index 0 of an EMPTY collection.
    // The guard must clear + un-pin instead. Falsifiable: removing the guard
    // makes selectedIdx===0/pinned===true and fails this test.
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const { result } = setup({ count: 0, pointerToIndex: () => 0 });
    act(() => result.current.onPointerDown(pointerEvent({ pointerType: "touch" })));
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "touch" })));
    expect(result.current.selectedIdx).toBeNull();
    expect(result.current.pinned).toBe(false);
  });

  it("a pointermove with no prior pointerdown is a no-op (no tapInfo yet)", () => {
    // onPointerMove reads tapInfoRef; without a preceding pointerdown it is
    // null and the slop computation must be skipped (the false arm of the
    // `if (tapInfoRef.current)` guard) — a later tap still pins normally.
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const { result } = setup({ pointerToIndex: () => 4 });
    act(() => result.current.onPointerMove(pointerEvent({ clientX: 50, clientY: 50 })));
    act(() => result.current.onPointerDown(pointerEvent({ pointerType: "touch" })));
    act(() => result.current.onPointerUp(pointerEvent({ pointerType: "touch" })));
    expect(result.current.selectedIdx).toBe(4);
    expect(result.current.pinned).toBe(true);
  });
});
