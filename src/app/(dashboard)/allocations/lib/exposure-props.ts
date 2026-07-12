import type {
  ExposureSnapshot,
  NetExposurePoint,
  AllocationPoint,
  AsofGap,
} from "@/lib/portfolio-exposure";

/**
 * The distinct, serializable `exposure` prop threaded from the allocations RSC
 * (`page.tsx`) through `AllocationsTabs` into `HoldingsTabPanel` (Phase 99 /
 * 99-04). Kept SEPARATE from `MyAllocationDashboardPayload` on purpose: the
 * dashboard payload has a client refresh/poll path, whereas the exposure reads
 * are a daily-grain 730-day paged scan that runs ONCE per page load. Folding
 * them together would either re-run the heavy scan on every poll or leak the
 * poll cadence onto a read that has no business polling.
 */
export interface ExposureSectionData {
  snapshot: ExposureSnapshot | null;
  netSeries: { points: NetExposurePoint[]; gaps: AsofGap[] };
  allocationSeries: { points: AllocationPoint[]; gaps: AsofGap[] };
}

/**
 * Shared honest-empty fixture: a null snapshot + empty series (no zero-fill,
 * no synthetic asof). Used by the pre-existing allocations test files (to keep
 * the exposure section additive) and by the new integration tests.
 */
export const EMPTY_EXPOSURE: ExposureSectionData = {
  snapshot: null,
  netSeries: { points: [], gaps: [] },
  allocationSeries: { points: [], gaps: [] },
};
