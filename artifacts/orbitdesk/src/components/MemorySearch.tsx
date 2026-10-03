import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Brain, ExternalLink, Loader2, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/lib/auth";

type MemoryResult = {
  id: number | string;
  kind: "memory" | "article";
  sourceType: string;
  sourceId: string;
  title: string;
  snippet: string;
  sourceLink: string;
};

export function MemorySearch() {
  const { token } = useAuthStore();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MemoryResult[]>([]);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(
        `/api/memory/search?q=${encodeURIComponent(q.trim())}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setResults(data.results ?? []);
    } catch (err) {
      toast({
        title: "Search failed",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" /> Organizational Memory
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Search resolved tickets, incidents, problems and knowledge articles.
          Every result cites its source.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="How did we resolve this problem last year?"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            disabled={loading}
          />
          <Button onClick={search} disabled={loading || !q.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>

        {searched && !loading && results.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No results. Try different keywords, or ask an admin to index more sources.
          </p>
        )}

        <div className="space-y-2">
          {results.map((r) => (
            <div key={`${r.kind}-${r.id}`} className="rounded-md border p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary">{r.sourceType}</Badge>
                <Badge variant="outline">{r.kind}</Badge>
                <span className="text-sm font-medium">{r.title}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground line-clamp-3">
                {r.snippet}
              </p>
              <a
                href={r.sourceLink}
                className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Open source
              </a>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
