import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowDown, Loader2, Sparkles, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/lib/auth";

type Generated = {
  name: string;
  description: string;
  triggerType: string;
  conditionLogic: "AND" | "OR";
  priority: number;
  conditions: { field: string; operator: string; value: string }[];
  actions: { type: string; value: string }[];
  notifications: string[];
  slaNote: string | null;
};

function FlowNode({
  label,
  detail,
  kind,
}: {
  label: string;
  detail?: string;
  kind: "trigger" | "condition" | "action" | "note";
}) {
  const colors: Record<string, string> = {
    trigger: "border-blue-400 bg-blue-50",
    condition: "border-amber-400 bg-amber-50",
    action: "border-green-400 bg-green-50",
    note: "border-purple-300 bg-purple-50",
  };
  return (
    <div className={`rounded-lg border-2 px-4 py-2 text-sm ${colors[kind]}`}>
      <div className="font-medium">{label}</div>
      {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}

export function AutomationCopilot({ onCreated }: { onCreated?: () => void }) {
  const { token } = useAuthStore();
  const { toast } = useToast();
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Generated | null>(null);
  const [creating, setCreating] = useState(false);

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const generate = async () => {
    if (!description.trim()) return;
    setLoading(true);
    setPreview(null);
    try {
      const res = await fetch("/api/automation-copilot/preview", {
        method: "POST",
        headers,
        body: JSON.stringify({ description: description.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      setPreview(data.preview as Generated);
    } catch (err) {
      toast({
        title: "Copilot error",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const createDraft = async () => {
    if (!preview) return;
    setCreating(true);
    try {
      const res = await fetch("/api/automation-copilot/create", {
        method: "POST",
        headers,
        body: JSON.stringify({ generated: preview }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      toast({ title: "Draft created", description: data.message });
      setPreview(null);
      setDescription("");
      onCreated?.();
    } catch (err) {
      toast({
        title: "Create failed",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" /> Automation Copilot
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Describe the automation in plain language. Review the generated
          workflow, then create it as an <strong>inactive draft</strong> —
          enable it from the rules list when ready.
        </p>
        <Textarea
          placeholder='e.g. When an urgent Finance ticket is created, set priority to urgent and assign to the least loaded agent'
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          disabled={loading}
        />
        <Button onClick={generate} disabled={loading || !description.trim()}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
          Generate workflow
        </Button>

        {preview && (
          <div className="space-y-2 rounded-md border p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{preview.name}</span>
              <Badge variant="secondary">{preview.triggerType}</Badge>
              <Badge variant="outline">priority {preview.priority}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{preview.description}</p>

            <div className="flex flex-col items-center gap-1 py-2">
              <FlowNode label="Trigger" detail={preview.triggerType} kind="trigger" />
              <ArrowDown className="h-4 w-4 text-muted-foreground" />
              <div className="flex flex-wrap justify-center gap-2">
                {preview.conditions.map((c, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && (
                      <Badge variant="outline" className="self-center">
                        {preview.conditionLogic}
                      </Badge>
                    )}
                    <FlowNode
                      label="Condition"
                      detail={`${c.field} ${c.operator} "${c.value}"`}
                      kind="condition"
                    />
                  </React.Fragment>
                ))}
              </div>
              <ArrowDown className="h-4 w-4 text-muted-foreground" />
              <div className="flex flex-wrap justify-center gap-2">
                {preview.actions.map((a, i) => (
                  <FlowNode
                    key={i}
                    label="Action"
                    detail={`${a.type}: ${a.value}`}
                    kind="action"
                  />
                ))}
              </div>
              {(preview.notifications.length > 0 || preview.slaNote) && (
                <>
                  <ArrowDown className="h-4 w-4 text-muted-foreground" />
                  <div className="flex flex-wrap justify-center gap-2">
                    {preview.notifications.map((n, i) => (
                      <FlowNode key={i} label="Notify" detail={n} kind="note" />
                    ))}
                    {preview.slaNote && (
                      <FlowNode label="SLA note" detail={preview.slaNote} kind="note" />
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-2">
              <Button onClick={createDraft} disabled={creating}>
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create as Draft (inactive)
              </Button>
              <Button variant="outline" onClick={() => setPreview(null)}>
                Discard
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
