"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { DOC_TYPES } from "@/lib/utils";

interface DocumentUploadProps {
  portfolioId: string;
  userId: string;
  strategies: { id: string; name: string }[];
}

const DOC_TYPE_LABELS: Record<string, string> = {
  contract: "Contract",
  note: "Note",
  factsheet: "Factsheet",
  founder_update: "Founder Update",
  other: "Other",
};
const DOC_TYPE_OPTIONS = DOC_TYPES.map((value) => ({ value, label: DOC_TYPE_LABELS[value] }));

export function DocumentUpload({ portfolioId, userId, strategies }: DocumentUploadProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<string>("factsheet");
  const [strategyId, setStrategyId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title.trim()) return;
    setUploading(true);
    setError(null);

    const supabase = createClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const path = `${userId}/${portfolioId}/${crypto.randomUUID()}_${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("portfolio-documents")
      .upload(path, file);
    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const res = await fetch("/api/portfolio-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        portfolio_id: portfolioId,
        title: title.trim(),
        doc_type: docType,
        file_path: path,
        ...(strategyId ? { strategy_id: strategyId } : {}),
      }),
    });
    if (!res.ok) {
      // Clean up orphan file in storage
      await supabase.storage.from("portfolio-documents").remove([path]);
      const { error: apiError } = await res.json().catch(() => ({ error: "Save failed" }));
      setError(apiError ?? "Save failed");
      setUploading(false);
      return;
    }

    setFile(null);
    setTitle("");
    setStrategyId("");
    setUploading(false);
    router.refresh();
  }

  const strategyOptions = [{ value: "", label: "None" }, ...strategies.map((s) => ({ value: s.id, label: s.name }))];

  return (
    <Card>
      <h2 className="text-base font-semibold text-text-primary mb-4">Upload Document</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Q1 2026 factsheet" required />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="Type" value={docType} onChange={(e) => setDocType(e.target.value)} options={DOC_TYPE_OPTIONS} />
          <Select label="Strategy (optional)" value={strategyId} onChange={(e) => setStrategyId(e.target.value)} options={strategyOptions} />
        </div>
        <label className="block">
          <span className="text-sm font-medium text-text-primary block mb-1.5">File</span>
          <input type="file" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-text-secondary file:mr-4 file:rounded-lg file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-accent-hover" />
        </label>
        {error && <p className="text-sm text-negative">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" disabled={uploading || !file || !title.trim()}>
            {uploading ? "Uploading..." : "Upload"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
