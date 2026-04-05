"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface CsvUploadProps {
  strategyId: string;
}

interface ParsedTrade {
  timestamp: string;
  symbol: string;
  side: string;
  price: string;
  quantity: string;
  fee: string;
  order_type: string;
}

const REQUIRED_COLUMNS = ["timestamp", "symbol", "side", "price", "quantity"];
const OPTIONAL_COLUMNS = ["fee", "order_type"];
const ALL_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];

// Fuzzy column name matching
const COLUMN_ALIASES: Record<string, string[]> = {
  timestamp: ["time", "date", "datetime", "executed_at", "trade_time", "created_at"],
  symbol: ["pair", "market", "instrument", "ticker"],
  side: ["direction", "type", "buy_sell", "trade_side"],
  price: ["avg_price", "execution_price", "fill_price", "trade_price"],
  quantity: ["amount", "size", "qty", "volume", "filled"],
  fee: ["commission", "fees", "cost", "trading_fee"],
  order_type: ["ordertype", "order_kind"],
};

function matchColumn(header: string): string | null {
  const h = header.toLowerCase().trim();
  for (const [col, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (h === col || aliases.includes(h)) return col;
  }
  if (ALL_COLUMNS.includes(h)) return h;
  return null;
}

function sanitizeCsvValue(val: string): string {
  // Prevent CSV injection: strip leading formula characters
  return val.replace(/^[=+\-@\t\r]+/, "").trim();
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(sanitizeCsvValue(current.trim()));
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(sanitizeCsvValue(current.trim()));
  return fields;
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => parseCsvLine(line));

  return { headers, rows };
}

export function CsvUpload({ strategyId }: CsvUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ headers: string[]; mapping: Record<number, string>; rows: string[][]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    if (f.size > 10 * 1024 * 1024) {
      setError("File too large. Maximum 10MB.");
      return;
    }

    if (!f.name.endsWith(".csv")) {
      setError("Only CSV files are accepted.");
      return;
    }

    setFile(f);
    setError(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const { headers, rows } = parseCsv(text);

      if (headers.length === 0 || rows.length === 0) {
        setError("CSV file is empty or has no data rows.");
        return;
      }

      // Auto-map columns
      const mapping: Record<number, string> = {};
      headers.forEach((h, i) => {
        const match = matchColumn(h);
        if (match) mapping[i] = match;
      });

      // Check required columns
      const mappedCols = new Set(Object.values(mapping));
      const missing = REQUIRED_COLUMNS.filter((c) => !mappedCols.has(c));
      if (missing.length > 0) {
        setError(`Missing required columns: ${missing.join(", ")}. Found: ${headers.join(", ")}`);
        return;
      }

      setPreview({ headers, mapping, rows: rows.slice(0, 5), total: rows.length });
    };
    reader.readAsText(f);
  }

  async function handleUpload() {
    if (!file || !preview) return;
    setUploading(true);
    setError(null);

    try {
      const text = await file.text();
      const { rows } = parseCsv(text);
      const { mapping } = preview;

      // Transform rows to trade objects
      const trades: ParsedTrade[] = rows.map((row) => {
        const trade: Record<string, string> = {};
        for (const [idx, col] of Object.entries(mapping)) {
          trade[col] = row[parseInt(idx)] ?? "";
        }
        return {
          timestamp: trade.timestamp ?? "",
          symbol: trade.symbol ?? "",
          side: trade.side?.toLowerCase() ?? "",
          price: trade.price ?? "0",
          quantity: trade.quantity ?? "0",
          fee: trade.fee ?? "0",
          order_type: trade.order_type ?? "unknown",
        };
      });

      // Validate
      const invalid = trades.filter(
        (t) => !t.timestamp || !t.symbol || !["buy", "sell"].includes(t.side) || isNaN(parseFloat(t.price)) || isNaN(parseFloat(t.quantity)),
      );
      if (invalid.length > 0) {
        setError(`${invalid.length} rows have invalid data (missing fields or non-numeric price/quantity). Check your CSV format.`);
        setUploading(false);
        return;
      }

      // Upload via server route (service-role client bypasses RLS)
      const tradeRows = trades.map((t) => ({
        strategy_id: strategyId,
        exchange: "csv_import",
        symbol: t.symbol,
        side: t.side,
        price: parseFloat(t.price),
        quantity: parseFloat(t.quantity),
        fee: t.fee ? parseFloat(t.fee) : 0,
        order_type: t.order_type,
        timestamp: t.timestamp,
      }));

      const uploadRes = await fetch("/api/trades/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy_id: strategyId, trades: tradeRows }),
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Trade upload failed");
      }

      // Trigger analytics computation
      await fetch("/api/keys/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy_id: strategyId }),
      }).catch(() => {
        // Non-critical: analytics will compute on next sync
      });

      setFile(null);
      setPreview(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function downloadTemplate() {
    const csv = "timestamp,symbol,side,price,quantity,fee,order_type\n2024-01-15T10:30:00Z,BTCUSDT,buy,42500.00,0.1,4.25,market\n2024-01-15T14:00:00Z,BTCUSDT,sell,43100.00,0.1,4.31,market\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "quantalyze-trade-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-primary">Import Trade History (CSV)</h3>
        <Button size="sm" variant="ghost" onClick={downloadTemplate}>
          Download Template
        </Button>
      </div>

      {!preview ? (
        <div
          className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-accent/50 transition-colors"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) {
              const input = fileInputRef.current;
              if (input) {
                const dt = new DataTransfer();
                dt.items.add(f);
                input.files = dt.files;
                input.dispatchEvent(new Event("change", { bubbles: true }));
              }
            }
          }}
        >
          <p className="text-sm text-text-muted mb-1">
            Drop a CSV file here or click to browse
          </p>
          <p className="text-xs text-text-muted">
            Required: timestamp, symbol, side, price, quantity. Max 10MB.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-primary font-medium">
              {file?.name} ({preview.total} trades)
            </p>
            <Button size="sm" variant="ghost" onClick={() => { setPreview(null); setFile(null); setError(null); }}>
              Clear
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {preview.headers.map((h, i) => (
                    <th key={i} className="px-2 py-1.5 text-left font-medium text-text-muted">
                      {h}
                      {preview.mapping[i] && (
                        <span className="ml-1 text-accent">({preview.mapping[i]})</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {row.map((cell, j) => (
                      <td key={j} className="px-2 py-1.5 text-text-secondary font-metric">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.total > 5 && (
            <p className="text-xs text-text-muted">Showing 5 of {preview.total} rows</p>
          )}

          <Button onClick={handleUpload} disabled={uploading} className="w-full">
            {uploading ? "Uploading..." : `Upload ${preview.total} trades`}
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-negative mt-3">{error}</p>}
    </Card>
  );
}
