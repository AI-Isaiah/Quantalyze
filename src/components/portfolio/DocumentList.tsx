import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DOC_TYPES } from "@/lib/utils";

interface DocumentListProps {
  documents: {
    id: string;
    title: string;
    doc_type: string;
    file_url: string;
    file_name: string | null;
    created_at: string;
    portfolio_id: string | null;
  }[];
  strategyNames: Record<string, string>;
}

const TYPE_LABELS: Record<string, string> = {
  contract: "Contract",
  note: "Note",
  factsheet: "Factsheet",
  founder_update: "Founder Update",
  other: "Other",
};

const TYPE_ORDER: readonly string[] = DOC_TYPES;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function DocumentList({ documents }: DocumentListProps) {
  if (documents.length === 0) {
    return (
      <Card className="text-center py-12">
        <p className="text-text-muted">No documents uploaded yet</p>
        <p className="text-sm text-text-secondary mt-2">
          Upload contracts, factsheets, and founder updates to keep them organized.
        </p>
      </Card>
    );
  }

  const grouped = documents.reduce<Record<string, typeof documents>>((acc, doc) => {
    const key = doc.doc_type || "other";
    (acc[key] ??= []).push(doc);
    return acc;
  }, {});

  const orderedGroups = TYPE_ORDER.filter((t) => grouped[t]?.length);

  return (
    <div className="space-y-6">
      {orderedGroups.map((type) => (
        <div key={type}>
          <h3 className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">
            {TYPE_LABELS[type] ?? type}
          </h3>
          <Card padding="sm">
            <ul className="divide-y divide-border">
              {grouped[type].map((doc) => (
                <li key={doc.id} className="flex items-center justify-between py-3 first:pt-1 last:pb-1">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary truncate">{doc.title}</p>
                    <p className="text-xs text-text-muted mt-0.5">{formatDate(doc.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <Badge label={TYPE_LABELS[type] ?? type} type="strategy" />
                    <a
                      href={doc.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-accent hover:text-accent-hover"
                    >
                      Download
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ))}
    </div>
  );
}
