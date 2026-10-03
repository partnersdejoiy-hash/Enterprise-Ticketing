import React, { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { BookOpen, Lightbulb, Loader2, Plus, Search, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/lib/auth";

type Article = {
  id: number;
  title: string;
  category: string | null;
  tags: string[];
  status: string;
  version: number;
  view_count: number;
  searchable: boolean;
  updated_at: string;
};

type Gap = {
  id: number;
  suggested_title: string;
  draft_content: string | null;
  ticket_ids: number[];
  occurrence_count: number;
  status: string;
  article_id: number | null;
  article_title: string | null;
  created_at: string;
};

const statusColors: Record<string, string> = {
  draft: "bg-gray-200 text-gray-800",
  in_review: "bg-amber-200 text-amber-800",
  published: "bg-green-200 text-green-800",
  archived: "bg-red-200 text-red-800",
  proposed: "bg-blue-200 text-blue-800",
  approved: "bg-green-200 text-green-800",
  rejected: "bg-red-200 text-red-800",
};

export default function Knowledge() {
  const { token, user } = useAuthStore();
  const { toast } = useToast();
  const [articles, setArticles] = useState<Article[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: "", content: "", category: "", tags: "" });

  const isAdmin = user?.role === "super_admin" || user?.role === "admin";
  const canEdit = isAdmin || ["manager", "agent"].includes(user?.role ?? "");

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const fetchArticles = async () => {
    try {
      const res = await fetch("/api/knowledge/articles", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setArticles(data.articles ?? []);
    } catch {
      toast({ title: "Failed to load articles", variant: "destructive" });
    }
  };

  const fetchGaps = async () => {
    try {
      const res = await fetch("/api/knowledge/gaps", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setGaps(data.gaps ?? []);
    } catch {
      toast({ title: "Failed to load gaps", variant: "destructive" });
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchArticles(), fetchGaps()]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = async () => {
    if (!searchQ.trim()) {
      fetchArticles();
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `/api/knowledge/search?q=${encodeURIComponent(searchQ.trim())}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setArticles(
        (data.results ?? []).map((r: Record<string, unknown>) => ({
          id: r.id,
          title: r.title,
          category: r.category,
          tags: [],
          status: "published",
          version: 0,
          view_count: r.view_count,
          searchable: true,
          updated_at: "",
        })),
      );
    } catch (err) {
      toast({
        title: "Search failed",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setSearching(false);
    }
  };

  const openEditor = (a?: Article) => {
    setEditingId(a?.id ?? null);
    setForm({
      title: a?.title ?? "",
      content: "",
      category: a?.category ?? "",
      tags: (a?.tags ?? []).join(", "),
    });
    if (a) {
      fetch(`/api/knowledge/articles/${a.id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.article) setForm((f) => ({ ...f, content: d.article.content }));
        });
    }
    setEditorOpen(true);
  };

  const saveArticle = async () => {
    try {
      const payload = {
        title: form.title,
        content: form.content,
        category: form.category || null,
        tags: form.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
      };
      const url = editingId
        ? `/api/knowledge/articles/${editingId}`
        : "/api/knowledge/articles";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast({ title: editingId ? "Article updated" : "Draft created" });
      setEditorOpen(false);
      fetchArticles();
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    }
  };

  const changeStatus = async (id: number, status: string) => {
    try {
      const res = await fetch(`/api/knowledge/articles/${id}/status`, {
        method: "POST",
        headers,
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast({ title: `Article ${status.replace("_", " ")}` });
      fetchArticles();
    } catch (err) {
      toast({
        title: "Status change failed",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    }
  };

  const detectGaps = async () => {
    setDetecting(true);
    try {
      const res = await fetch("/api/knowledge/gaps/detect", {
        method: "POST",
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast({
        title: "Gap detection complete",
        description: `${data.gapsCreated} new gap(s) proposed`,
      });
      fetchGaps();
    } catch (err) {
      toast({
        title: "Detection failed",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setDetecting(false);
    }
  };

  const approveGap = async (id: number) => {
    try {
      const res = await fetch(`/api/knowledge/gaps/${id}/approve`, {
        method: "POST",
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast({ title: "Draft article created", description: data.message });
      fetchGaps();
      fetchArticles();
    } catch (err) {
      toast({
        title: "Approve failed",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    }
  };

  const rejectGap = async (id: number) => {
    try {
      await fetch(`/api/knowledge/gaps/${id}/reject`, { method: "POST", headers });
      toast({ title: "Gap rejected" });
      fetchGaps();
    } catch {
      toast({ title: "Reject failed", variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BookOpen className="h-6 w-6" /> Knowledge Base
          </h1>
          {canEdit && (
            <Button onClick={() => openEditor()}>
              <Plus className="mr-2 h-4 w-4" /> New Article
            </Button>
          )}
        </div>

        <Tabs defaultValue="articles">
          <TabsList>
            <TabsTrigger value="articles">Articles</TabsTrigger>
            <TabsTrigger value="gaps">
              Knowledge Gaps
              {gaps.filter((g) => g.status === "proposed").length > 0 && (
                <Badge className="ml-2" variant="secondary">
                  {gaps.filter((g) => g.status === "proposed").length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="articles" className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search published articles..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && search()}
              />
              <Button onClick={search} disabled={searching}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {articles.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  No articles yet. Create the first one to start building your knowledge base.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {articles.map((a) => (
                  <Card key={a.id}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{a.title}</span>
                          <Badge className={statusColors[a.status] ?? ""}>{a.status}</Badge>
                          {a.category && <Badge variant="outline">{a.category}</Badge>}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          v{a.version} · {a.view_count} views
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {canEdit && (
                          <Button size="sm" variant="outline" onClick={() => openEditor(a)}>
                            Edit
                          </Button>
                        )}
                        {a.status === "draft" && canEdit && (
                          <Button size="sm" variant="outline" onClick={() => changeStatus(a.id, "in_review")}>
                            Submit for review
                          </Button>
                        )}
                        {a.status === "in_review" && isAdmin && (
                          <Button size="sm" onClick={() => changeStatus(a.id, "published")}>
                            Publish
                          </Button>
                        )}
                        {a.status === "published" && isAdmin && (
                          <Button size="sm" variant="outline" onClick={() => changeStatus(a.id, "archived")}>
                            Archive
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="gaps" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Repeated unresolved ticket clusters with no covering article.
                Approving creates a draft article for human review.
              </p>
              {isAdmin && (
                <Button onClick={detectGaps} disabled={detecting}>
                  {detecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lightbulb className="mr-2 h-4 w-4" />}
                  Detect gaps
                </Button>
              )}
            </div>
            {gaps.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  No knowledge gaps detected. Run detection to find repeated ticket clusters.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {gaps.map((g) => (
                  <Card key={g.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{g.suggested_title}</span>
                            <Badge className={statusColors[g.status] ?? ""}>{g.status}</Badge>
                            <Badge variant="outline">{g.occurrence_count} tickets</Badge>
                          </div>
                          {g.draft_content && (
                            <p className="mt-2 text-sm text-muted-foreground line-clamp-3">
                              {g.draft_content.slice(0, 300)}
                            </p>
                          )}
                          {g.article_title && (
                            <p className="mt-1 text-xs text-green-700">
                              → Draft: {g.article_title}
                            </p>
                          )}
                        </div>
                        {g.status === "proposed" && isAdmin && (
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => approveGap(g.id)}>
                              <Check className="mr-1 h-3 w-3" /> Approve → Draft
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => rejectGap(g.id)}>
                              <X className="mr-1 h-3 w-3" /> Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Article" : "New Article"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Title</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  maxLength={200}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Category</Label>
                  <Input
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    placeholder="e.g. VPN, Password"
                  />
                </div>
                <div>
                  <Label>Tags (comma-separated)</Label>
                  <Input
                    value={form.tags}
                    onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                    placeholder="vpn, network"
                  />
                </div>
              </div>
              <div>
                <Label>Content (Markdown)</Label>
                <Textarea
                  value={form.content}
                  onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                  rows={12}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditorOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveArticle}>Save Draft</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
