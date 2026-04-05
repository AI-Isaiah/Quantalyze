import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import Link from "next/link";

export default function StrategiesPage() {
  return (
    <>
      <PageHeader
        title="My Strategies"
        actions={
          <Link href="/strategies/new">
            <Button>New Strategy</Button>
          </Link>
        }
      />
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-text-muted">
        Strategy management coming in Step 6
      </div>
    </>
  );
}
