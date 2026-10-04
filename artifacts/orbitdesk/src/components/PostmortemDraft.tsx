import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, FileText, CheckCircle2, Sparkles, Pencil } from "lucide-react";

async function api(path: string, init?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const r = await fetch("/api" + path, {
    credentials: "same-origin",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token && token !== "cookie-session"
        ? { Authorization: `Bearer ${token}` }
        : {}),
      ...(init?.headers || {}),
    },
  });
  const v = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(v.error || "Request failed");
  return v;
}

const SECTIONS: { key: string; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "impact", label: "Impact" },
  { key: "timeline", label: "Timeline" },
  { key: "detection", label: "Detection" },
  { key: "response", label: "Response" },
  { key: "root_cause", label: "Root Cause (potential)" },
  { key: "contributing_factors", label: "Contributing Factors" },
  { key: "resolution", label: "Resolution" },
  { key: "went_well", label: "What Went Well" },
  { key: "didnt_go_well", label: "What Didn't Go Well" },
  { key: "corrective_actions", label: "Corrective Actions" },
  { key: "preventive_actions", label: "Preventive Actions" },
];

export default function PostmortemDraft({ incidentId }: { incidentId: number }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sections, setSections] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api(`/incidents/${incidentId}/postmortem`);
      setDraft(d);
      setSections(d.sections ?? {});
    } catch (e) {
      // 404 = no draft yet; not an error state.
      if (e instanceof Error && e.message !== "No postmortem draft") {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await api(`/incidents/${incidentId}/postmortem/generate`, {
        method: "POST",
      });
      toast({ title: `Draft generated (confidence ${res.confidence}%)` });
      await load();
    } catch (e) {
      toast({
        title: "Generation failed",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const approve = async () => {
    if (!confirm("Publish this post-incident review? This marks it as final.")) return;
    setApproving(true);
    try {
      await api(`/incidents/${incidentId}/postmortem/approve`, {
        method: "POST",
        body: JSON.stringify({ sections: editing ? sections : undefined }),
      });
      toast({ title: "Postmortem published" });
      setEditing(false);
      await load();
    } catch (e) {
      toast({
        title: "Approval failed",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setApproving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading postmortem…
      </div>
    );
  }
  if (error) {
    return <p className="text-sm text-destructive py-6 text-center">{error}</p>;
  }

  if (!draft) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No post-incident review yet</p>
          <p className="text-sm text-muted-foreground mb-4">
            Generate an AI draft from the incident timeline. It stays a draft
            until a human approves it.
          </p>
          <Button onClick={generate} disabled={generating}>
            {generating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            Generate draft
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={draft.status === "approved" ? "default" : "outline"}>
            {draft.status === "approved" ? (
              <>
                <CheckCircle2 className="h-3 w-3 mr-1" /> Published
              </>
            ) : (
              "DRAFT — needs human approval"
            )}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Confidence {draft.confidence}% ·{" "}
            {new Date(draft.createdAt).toLocaleString("en-IN")}
          </span>
        </div>
        {draft.status !== "approved" && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(!editing)}
            >
              <Pencil className="h-4 w-4 mr-2" />
              {editing ? "Done editing" : "Edit"}
            </Button>
            <Button size="sm" onClick={approve} disabled={approving}>
              {approving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Approve & publish
            </Button>
          </div>
        )}
      </div>

      {draft.sources?.length > 0 && (
        <Card>
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs">Sources cited</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="flex flex-wrap gap-1">
              {draft.sources.map((s: any, i: number) => (
                <Badge key={i} variant="outline" className="text-[10px]">
                  {s.type}: {s.title ?? s.id}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {SECTIONS.map(({ key, label }) => (
        <Card key={key}>
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-sm">{label}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {editing && draft.status !== "approved" ? (
              <Textarea
                value={sections[key] ?? ""}
                onChange={(e) =>
                  setSections({ ...sections, [key]: e.target.value })
                }
                rows={4}
              />
            ) : (
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {sections[key] || "—"}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
