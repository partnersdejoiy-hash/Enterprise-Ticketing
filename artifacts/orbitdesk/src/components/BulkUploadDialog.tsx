import React, { useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Download, AlertCircle, CheckCircle2, FileText, Loader2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type UploadType = "tickets" | "users" | "departments";

interface ColDef {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
}

interface Config {
  title: string;
  endpoint: string;
  columns: ColDef[];
  templateRows: string[];
}

const CONFIGS: Record<UploadType, Config> = {
  tickets: {
    title: "Bulk Upload Tickets",
    endpoint: "/api/tickets/bulk",
    columns: [
      { key: "subject", label: "subject", required: true },
      { key: "description", label: "description" },
      { key: "priority", label: "priority", hint: "low / medium / high / urgent" },
      { key: "status", label: "status", hint: "open / in_progress / pending / resolved / closed" },
      { key: "department_name", label: "department_name", hint: "exact department name" },
      { key: "assignee_email", label: "assignee_email", hint: "user's email address" },
      { key: "tags", label: "tags", hint: "pipe-separated e.g. hardware|vpn" },
    ],
    templateRows: [
      "subject,description,priority,status,department_name,assignee_email,tags",
      "Laptop not starting,My laptop won't boot up,high,open,IT,agent@company.com,hardware",
      "Password reset,Cannot login to email system,medium,open,IT,,",
      "VPN access required,Need VPN for remote work,low,open,IT,,network|vpn",
    ],
  },
  users: {
    title: "Bulk Upload Users",
    endpoint: "/api/users/bulk",
    columns: [
      { key: "name", label: "name", required: true },
      { key: "email", label: "email", required: true },
      { key: "password", label: "password", required: true },
      { key: "role", label: "role", hint: "employee / agent / manager / admin / external" },
      { key: "department_name", label: "department_name", hint: "exact department name (optional)" },
    ],
    templateRows: [
      "name,email,password,role,department_name",
      "Rahul Sharma,rahul@company.com,Welcome@123,agent,IT",
      "Priya Singh,priya@company.com,Welcome@123,employee,HR",
      "Amit Verma,amit@company.com,Welcome@123,manager,Finance",
    ],
  },
  departments: {
    title: "Bulk Upload Departments",
    endpoint: "/api/departments/bulk",
    columns: [
      { key: "name", label: "name", required: true },
      { key: "description", label: "description" },
      { key: "color", label: "color", hint: "hex code e.g. #3B82F6" },
      { key: "sla_response_hours", label: "sla_response_hours", hint: "number, default 4" },
      { key: "sla_resolution_hours", label: "sla_resolution_hours", hint: "number, default 24" },
    ],
    templateRows: [
      "name,description,color,sla_response_hours,sla_resolution_hours",
      "IT,Information Technology support,#3B82F6,4,24",
      "HR,Human Resources,#8B5CF6,8,48",
      "Finance,Finance and Accounts,#F59E0B,12,72",
    ],
  },
};

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        fields.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    return fields;
  };

  const headers = parseRow(lines[0]).map((h) => h.toLowerCase().trim());
  return lines.slice(1).map((line) => {
    const vals = parseRow(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });
}

interface Props {
  open: boolean;
  onClose: () => void;
  type: UploadType;
  onSuccess?: () => void;
}

export function BulkUploadDialog({ open, onClose, type, onSuccess }: Props) {
  const config = CONFIGS[type];
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const [step, setStep] = useState<"upload" | "preview" | "result">("upload");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ created: number; errors: { row: number; error: string }[] } | null>(null);

  const resetState = () => {
    setStep("upload");
    setRows([]);
    setFileName(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleClose = () => { resetState(); onClose(); };

  const downloadTemplate = () => {
    const content = config.templateRows.join("\n");
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.length === 0) {
        toast({ title: "Empty or invalid CSV", description: "No data rows found.", variant: "destructive" });
        return;
      }
      setRows(parsed);
      setStep("preview");
    };
    reader.readAsText(file);
  };

  const handleUpload = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Upload failed");
      setResult(data);
      setStep("result");
      if (data.created > 0) onSuccess?.();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const requiredKeys = config.columns.filter((c) => c.required).map((c) => c.key);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            {config.title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4 py-2">
          {step === "upload" && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <p className="text-sm font-medium text-foreground">Expected CSV columns</p>
                <div className="flex flex-wrap gap-1.5">
                  {config.columns.map((col) => (
                    <span key={col.key} className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-mono border bg-background">
                      {col.required && <span className="text-destructive font-bold">*</span>}
                      {col.key}
                      {col.hint && <span className="text-muted-foreground ml-1">({col.hint})</span>}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground"><span className="text-destructive font-bold">*</span> required fields</p>
              </div>

              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-2">
                  <Download className="h-4 w-4" />
                  Download Template
                </Button>
                <span className="text-xs text-muted-foreground">Download a sample CSV with the correct format</span>
              </div>

              <div
                className="border-2 border-dashed border-border rounded-lg p-10 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm font-medium">Click to select a CSV file</p>
                <p className="text-xs text-muted-foreground mt-1">or drag and drop — .csv only</p>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
              </div>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span className="font-medium text-foreground">{fileName}</span>
                  <Badge variant="secondary">{rows.length} rows</Badge>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setStep("upload"); setRows([]); setFileName(null); if (fileRef.current) fileRef.current.value = ""; }}>
                  <X className="h-4 w-4 mr-1" /> Change file
                </Button>
              </div>

              <div className="rounded-lg border overflow-auto max-h-72">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-muted-foreground font-medium w-10">#</th>
                      {config.columns.map((col) => (
                        <th key={col.key} className="px-2 py-1.5 text-left text-muted-foreground font-medium whitespace-nowrap">
                          {col.key}{col.required ? <span className="text-destructive ml-0.5">*</span> : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.slice(0, 50).map((row, i) => {
                      const missing = requiredKeys.some((k) => !row[k]?.trim());
                      return (
                        <tr key={i} className={missing ? "bg-destructive/5" : "hover:bg-muted/30"}>
                          <td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
                          {config.columns.map((col) => (
                            <td key={col.key} className={`px-2 py-1.5 max-w-[140px] truncate ${col.required && !row[col.key]?.trim() ? "text-destructive font-medium" : ""}`}>
                              {row[col.key] || <span className="text-muted-foreground italic">—</span>}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {rows.length > 50 && (
                  <p className="text-xs text-muted-foreground text-center py-2 border-t">Showing first 50 of {rows.length} rows</p>
                )}
              </div>

              {rows.some((row) => requiredKeys.some((k) => !row[k]?.trim())) && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  Some rows are missing required fields and will be skipped during upload.
                </div>
              )}
            </div>
          )}

          {step === "result" && result && (
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-1 rounded-lg border bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 p-4 text-center">
                  <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-green-700 dark:text-green-400">{result.created}</p>
                  <p className="text-sm text-green-600 dark:text-green-500">Successfully created</p>
                </div>
                {result.errors.length > 0 && (
                  <div className="flex-1 rounded-lg border bg-destructive/5 border-destructive/20 p-4 text-center">
                    <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
                    <p className="text-2xl font-bold text-destructive">{result.errors.length}</p>
                    <p className="text-sm text-destructive/80">Rows with errors</p>
                  </div>
                )}
              </div>

              {result.errors.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Error details</p>
                  <div className="rounded-lg border overflow-auto max-h-40 divide-y divide-border">
                    {result.errors.map((e, i) => (
                      <div key={i} className="flex items-start gap-3 px-3 py-2 text-xs hover:bg-muted/30">
                        <span className="text-muted-foreground w-12 flex-shrink-0">Row {e.row}</span>
                        <span className="text-destructive">{e.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 border-t pt-4">
          {step === "upload" && (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleUpload} disabled={loading || rows.length === 0} className="gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {loading ? "Uploading…" : `Upload ${rows.length} rows`}
              </Button>
            </>
          )}
          {step === "result" && (
            <>
              <Button variant="outline" onClick={resetState}>Upload another file</Button>
              <Button onClick={handleClose}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
