import type {
  NetExposurePoint,
  AllocationPoint,
  AsofGap,
} from "@/lib/portfolio-exposure";

/**
 * The distinct, serializable `exposure` prop threaded from the allocations RSC
 * (`page.tsx`) through `AllocationsTabs` into `HoldingsTabPanel` (Phase 99 /
 * 99-04). Kept SEPARATE from `MyAllocationDashboardPayload` on purpose: the
 * dashboard payload has a client refresh/poll path, whereas the two over-time
 * series are a daily-grain 730-day paged scan that runs ONCE per page load.
 * Folding them together would either re-run the heavy scan on every poll or
 * leak the poll cadence onto a read that has no business polling.
 *
 * Phase 170.4 (D-01): the CURRENT snapshot is not carried here. The Exposure
 * card is built from the payload's per-key holdings inside `HoldingsTabPanel`,
 * so it cannot disagree with the Holdings and Open Positions tables.
 */
export interface ExposureSectionData {
  netSeries: { points: NetExposurePoint[]; gaps: AsofGap[] };
  allocationSeries: { points: AllocationPoint[]; gaps: AsofGap[] };
}

/**
 * Shared honest-empty fixture: empty series (no zero-fill, no synthetic asof).
 * Used by the pre-existing allocations test files (to keep the exposure section
 * additive) and by the new integration tests.
 */
export const EMPTY_EXPOSURE: ExposureSectionData = {
  netSeries: { points: [], gaps: [] },
  allocationSeries: { points: [], gaps: [] },
};
