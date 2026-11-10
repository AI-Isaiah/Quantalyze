import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Phase 199 plan 12 (D-03, UI-SPEC "States - merged list"): the loading state
 * has the table's own shape, so the page does not jump when it resolves. Its
 * header cells are the table's leading owner-list columns in order, Health
 * included (`Strategy | Status | Health | Created`), so the skeleton's column
 * count matches the loaded list's. Decorative only: hidden from assistive tech,
 * so the placeholder headers are never announced as a second table.
 */
const SKELETON_COLUMNS = ["Strategy", "Status", "Health", "Created"] as const;

export default function StrategiesLoading() {
  return (
    <div>
      <div className="flex justify-between mb-8">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>
      <table className="w-full border-collapse" aria-hidden>
        <thead>
          <tr>
            {SKELETON_COLUMNS.map((label) => (
              <th
                key={label}
                scope="col"
                className="px-4 py-3 text-left text-micro font-mono uppercase tracking-[0.14em] text-text-muted"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i} className="border-b border-border">
              {SKELETON_COLUMNS.map((label) => (
                <td key={label} className="px-4 py-3">
                  <Skeleton className="h-5 w-full" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
