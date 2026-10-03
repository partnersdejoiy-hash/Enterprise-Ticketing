import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Bot, Loader2, Send, ShieldCheck, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/lib/auth";

type ProposedChange = {
  description: string;
  diff: Record<string, { before: unknown; after: unknown }>;
  payload: Record<string, unknown>;
};

type ParseResult = {
  intent: string;
  entities: Record<string, string>;
  confidence: number;
  isReadOnly: boolean;
  proposedChange?: ProposedChange;
  confirmationToken?: string;
  data?: Record<string, unknown>[];
  message: string;
};

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function AdminCopilot() {
  const { token } = useAuthStore();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [executing, setExecuting] = useState(false);

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const parse = async () => {
    if (!text.trim()) return;
    setParsing(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin-copilot/parse", {
        method: "POST",
        headers,
        body: JSON.stringify({ text: text.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Parse failed");
      setResult(data as ParseResult);
    } catch (err) {
      toast({
        title: "Copilot error",
        description: err instanceof Error ? err.message : "Failed to parse",
        variant: "destructive",
      });
    } finally {
      setParsing(false);
    }
  };

  const execute = async () => {
    if (!result?.confirmationToken) return;
    setExecuting(true);
    try {
      const res = await fetch("/api/admin-copilot/execute", {
        method: "POST",
        headers,
        body: JSON.stringify({ confirmationToken: result.confirmationToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Execute failed");
      toast({ title: "Applied", description: data.message });
      setConfirmOpen(false);
      setResult(null);
      setText("");
    } catch (err) {
      toast({
        title: "Execution failed",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" /> Admin Copilot
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Describe an admin change in plain language. The copilot proposes an
          exact diff — nothing is applied until you confirm.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder='e.g. Change "Finance" first-response SLA to 2 hours'
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && parse()}
            disabled={parsing}
          />
          <Button onClick={parse} disabled={parsing || !text.trim()}>
            {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>

        {result && (
          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary">{result.intent.replace(/_/g, " ")}</Badge>
              <Badge variant="outline">confidence {result.confidence}%</Badge>
              {result.isReadOnly && !result.data?.length && (
                <Badge variant="outline">no changes</Badge>
              )}
            </div>
            <p className="text-sm">{result.message}</p>

            {result.data && result.data.length > 0 && (
              <div className="max-h-64 overflow-auto rounded border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted">
                      {Object.keys(result.data[0]).map((k) => (
                        <th key={k} className="p-2 text-left font-medium">{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.map((row, i) => (
                      <tr key={i} className="border-t">
                        {Object.values(row).map((v, j) => (
                          <td key={j} className="p-2">{fmt(v)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {result.proposedChange && (
              <div className="space-y-2">
                <p className="text-sm font-medium">{result.proposedChange.description}</p>
                <div className="rounded border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted">
                        <th className="p-2 text-left">Field</th>
                        <th className="p-2 text-left">Before</th>
                        <th className="p-2 text-left">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.proposedChange.diff).map(([field, d]) => (
                        <tr key={field} className="border-t">
                          <td className="p-2 font-mono text-xs">{field}</td>
                          <td className="p-2 text-muted-foreground">{fmt(d.before)}</td>
                          <td className="p-2 font-medium text-green-700">{fmt(d.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => setConfirmOpen(true)}>
                    <ShieldCheck className="mr-2 h-4 w-4" /> Review & Confirm
                  </Button>
                  <Button variant="outline" onClick={() => setResult(null)}>
                    <XCircle className="mr-2 h-4 w-4" /> Discard
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm admin change</AlertDialogTitle>
              <AlertDialogDescription>
                {result?.proposedChange?.description}. This will be applied
                immediately and recorded in the audit log. This cannot be undone
                automatically.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={executing}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={execute} disabled={executing}>
                {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm & Apply"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
