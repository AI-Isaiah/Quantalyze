import Link from "next/link";
import { Card } from "@/components/ui/Card";

/**
 * Right-column panel for CSV-uploaded strategies on the edit page.
 *
 * Replaces the legacy `<CsvUpload>` component, which mislabeled the CSV
 * column contract (the wizard ingests a `daily_return` percentage; the
 * legacy importer's "Daily PnL" label + alias table conflated it with
 * dollar PnL) and wrote synthetic trade rows with `exchange='csv_import'`
 * / `order_type='daily_pnl'` — enum values that do not exist in the
 * `trades` table schema, causing a PostgREST schema-cache error on every
 * upload attempt. The wizard's CSV branch is now the canonical ingest
 * surface and writes the daily-return series to
 * `strategy_analytics.returns_series` JSONB directly, not to `trades`.
 *
 * The metadata form on the left column still works for renames, category
 * changes, etc. — the panel here only documents that the underlying CSV
 * data is immutable post-upload.
 */
export function CsvStrategyEditNote() {
  return (
    <Card>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">
          CSV-uploaded strategy
        </h3>
        <p className="text-xs text-text-secondary leading-relaxed">
          This strategy was created from a CSV daily-return series.
          Metadata on the left can still be edited. The underlying
          daily-return data is fixed at upload time — to publish a new
          series, create a new strategy through the wizard.
        </p>
        <Link
          href="/strategies/new/wizard?source=csv"
          className="inline-flex text-xs font-medium text-accent hover:underline"
        >
          Upload a new CSV strategy →
        </Link>
      </div>
    </Card>
  );
}
