"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { ScopedBanner } from "@/components/ui/ScopedBanner";

// Sample payload the founder can demo cold. Paste-and-go during the cap-intro
// meeting: swap the partner tag, replace the CSVs with the partner's 3+3, hit
// submit. The page auto-navigates to /admin/partner-pilot/{tag} after ~2s.
const SAMPLE_PARTNER_TAG = "acme-capital";

const SAMPLE_MANAGERS_CSV = `manager_email,strategy_name,disclosure_tier
alice@acme.example,Acme Market Neutral,institutional
bob@acme.example,Acme Momentum,institutional
carol@acme.example,Acme Vol Carry,exploratory`;

const SAMPLE_ALLOCATORS_CSV = `allocator_email,mandate_archetype,ticket_size_usd
lp1@acme.example,Market Neutral,5000000
lp2@acme.example,L/S Equity Stat Arb,10000000
lp3@acme.example,Crypto SMA,2500000`;

interface ImportResult {
  managers_created: number;
  strategies_created: number;
  allocators_created: number;
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function PartnerImportPage() {
  const router = useRouter();

  const [partnerTag, setPartnerTag] = useState(SAMPLE_PARTNER_TAG);
  const [managersCsv, setManagersCsv] = useState(SAMPLE_MANAGERS_CSV);
  const [allocatorsCsv, setAllocatorsCsv] = useState(SAMPLE_ALLOCATORS_CSV);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const slug = useMemo(() => slugify(partnerTag), [partnerTag]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setError(null);
      setResult(null);

      try {
        const res = await fetch("/api/admin/partner-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            partner_tag: slug,
            managers_csv: managersCsv,
            allocators_csv: allocatorsCsv,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Import failed (${res.status})`);
        }
        const payload = (await res.json()) as ImportResult;
        setResult(payload);
        // Auto-navigate to the pilot dashboard after a brief celebration.
        setTimeout(() => {
          router.push(`/admin/partner-pilot/${slug}`);
        }, 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [slug, managersCsv, allocatorsCsv, router],
  );

  return (
    <>
      <PageHeader
        title="Partner pilot import"
        description="Paste 2 CSVs (managers + allocators) to spin up a white-label pilot in seconds."
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <h2 className="text-base font-semibold text-text-primary mb-3">
            Partner tag
          </h2>
          <p className="text-xs text-text-muted mb-3">
            Lowercase, digits, and hyphens only. We auto-slugify as you type.
          </p>
          <Input
            value={partnerTag}
            onChange={(e) => setPartnerTag(e.target.value)}
            placeholder="acme-capital"
            disabled={loading}
            aria-label="Partner tag"
          />
          {slug !== partnerTag && (
            <p className="mt-2 text-xs text-text-muted">
              Will be saved as:{" "}
              <span className="font-mono text-text-primary">{slug || "—"}</span>
            </p>
          )}
        </Card>

        <Card>
          <div className="flex items-start justify-between mb-3 gap-4">
            <div>
              <h2 className="text-base font-semibold text-text-primary">
                Managers CSV
              </h2>
              <p className="text-xs text-text-muted mt-1">
                Columns: <span className="font-mono">manager_email</span>,{" "}
                <span className="font-mono">strategy_name</span>,{" "}
                <span className="font-mono">disclosure_tier</span> (institutional | exploratory)
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setManagersCsv(SAMPLE_MANAGERS_CSV)}
              disabled={loading}
            >
              Reset to sample
            </Button>
          </div>
          <Textarea
            value={managersCsv}
            onChange={(e) => setManagersCsv(e.target.value)}
            rows={6}
            className="font-mono text-xs"
            disabled={loading}
            aria-label="Managers CSV"
          />
        </Card>

        <Card>
          <div className="flex items-start justify-between mb-3 gap-4">
            <div>
              <h2 className="text-base font-semibold text-text-primary">
                Allocators CSV
              </h2>
              <p className="text-xs text-text-muted mt-1">
                Columns: <span className="font-mono">allocator_email</span>,{" "}
                <span className="font-mono">mandate_archetype</span>,{" "}
                <span className="font-mono">ticket_size_usd</span>
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setAllocatorsCsv(SAMPLE_ALLOCATORS_CSV)}
              disabled={loading}
            >
              Reset to sample
            </Button>
          </div>
          <Textarea
            value={allocatorsCsv}
            onChange={(e) => setAllocatorsCsv(e.target.value)}
            rows={6}
            className="font-mono text-xs"
            disabled={loading}
            aria-label="Allocators CSV"
          />
        </Card>

        {error && (
          <Card className="border-negative/40">
            <p className="text-sm text-negative">{error}</p>
          </Card>
        )}

        {result && (
          <ScopedBanner
            tone="success"
            title="Pilot imported"
            subtitle={
              <>
                <span className="font-metric text-text-primary">
                  {result.managers_created}
                </span>{" "}
                managers,{" "}
                <span className="font-metric text-text-primary">
                  {result.strategies_created}
                </span>{" "}
                strategies,{" "}
                <span className="font-metric text-text-primary">
                  {result.allocators_created}
                </span>{" "}
                allocators staged for{" "}
                <span className="font-mono text-text-primary">{slug}</span>.
                Opening the pilot dashboard…
              </>
            }
          />
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={loading || !slug}>
            {loading ? "Importing…" : "Import pilot"}
          </Button>
          <p className="text-xs text-text-muted">
            Target: <span className="font-mono">/admin/partner-pilot/{slug || "—"}</span>
          </p>
        </div>
      </form>
    </>
  );
}
