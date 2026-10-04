import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import PostmortemDraft from "@/components/PostmortemDraft";
import {
  Loader2,
  Send,
  Radio,
  Sparkles,
  CheckCircle2,
  Play,
  Users,
  ListTodo,
} from "lucide-react";

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

interface RoomMessage {
  id: number;
  senderId: number | null;
  senderType: string;
  messageType: string;
  content: string;
  createdAt: string;
  author: string | null;
}
interface RoomTask {
  id: number;
  title: string;
  assigneeId: number | null;
  assigneeName: string | null;
  status: string;
}
interface RoomMember {
  userId: number;
  name: string;
  role: string;
}

const MSG_TYPE_LABEL: Record<string, string> = {
  chat: "Chat",
  note: "Note",
  decision: "Decision",
  status_update: "Status",
};

export default function SwarmRoom() {
  const [, params] = useRoute("/incidents/:id");
  const incidentId = params?.id;
  const { toast } = useToast();
  const [incident, setIncident] = useState<any>(null);
  const [room, setRoom] = useState<any>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [tasks, setTasks] = useState<RoomTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(false);
  const [starting, setStarting] = useState(false);
  const [composer, setComposer] = useState("");
  const [msgType, setMsgType] = useState("chat");
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [resolving, setResolving] = useState(false);
  const lastSeen = useRef<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const loadIncident = async () => {
    try {
      const data = await api(`/incidents/${incidentId}`);
      setIncident(data);
      const active = (data.rooms ?? []).find((r: any) => r.status === "active");
      if (active) {
        const rd = await api(`/swarm/rooms/${active.id}`);
        setRoom(rd);
        setMembers(rd.members);
        setMessages(rd.messages);
        setTasks(rd.tasks);
        const me = JSON.parse(localStorage.getItem("orbit_user") ?? "{}");
        setJoined(rd.members.some((m: RoomMember) => m.userId === me.id));
        const last = rd.messages[rd.messages.length - 1];
        if (last) lastSeen.current = last.createdAt;
        if (rd.aiSummary) {
          try {
            setSummary(JSON.parse(rd.aiSummary));
          } catch {
            /* ignore */
          }
        }
      } else {
        setRoom(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIncident();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  // Poll for new messages every 2s while the room is active.
  useEffect(() => {
    if (!room || room.status !== "active") return;
    const t = setInterval(async () => {
      try {
        const q = lastSeen.current
          ? `?since=${encodeURIComponent(lastSeen.current)}`
          : "";
        const fresh: RoomMessage[] = await api(
          `/swarm/rooms/${room.id}/messages${q}`,
        );
        if (fresh.length > 0) {
          setMessages((prev) => {
            const ids = new Set(prev.map((m) => m.id));
            return [...prev, ...fresh.filter((m) => !ids.has(m.id))];
          });
          lastSeen.current = fresh[fresh.length - 1].createdAt;
          chatEnd.current?.scrollIntoView({ behavior: "smooth" });
        }
      } catch {
        /* polling errors are silent */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [room?.id, room?.status]);

  const startSwarm = async () => {
    setStarting(true);
    try {
      const res = await api(`/swarm/incidents/${incidentId}/start`, { method: "POST" });
      toast({ title: "Swarm room started" });
      const rd = await api(`/swarm/rooms/${res.roomId}`);
      setRoom(rd);
      setMembers(rd.members);
      setMessages(rd.messages);
      setTasks(rd.tasks);
      setJoined(true);
      loadIncident();
    } catch (e) {
      toast({
        title: "Failed to start swarm",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setStarting(false);
    }
  };

  const join = async () => {
    try {
      await api(`/swarm/rooms/${room.id}/join`, { method: "POST" });
      setJoined(true);
      toast({ title: "Joined swarm room" });
    } catch (e) {
      toast({ title: "Join failed", variant: "destructive" });
    }
  };

  const sendMessage = async () => {
    if (!composer.trim() || sending) return;
    setSending(true);
    try {
      const res = await api(`/swarm/rooms/${room.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: composer.trim(), message_type: msgType }),
      });
      const me = JSON.parse(localStorage.getItem("orbit_user") ?? "{}");
      const msg: RoomMessage = {
        id: res.id,
        senderId: me.id ?? null,
        senderType: "user",
        messageType: msgType,
        content: composer.trim(),
        createdAt: res.createdAt,
        author: me.name ?? "You",
      };
      setMessages((prev) => [...prev, msg]);
      lastSeen.current = res.createdAt;
      setComposer("");
      chatEnd.current?.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      toast({
        title: "Failed to send",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const createTask = async () => {
    if (!newTask.trim()) return;
    try {
      await api(`/swarm/rooms/${room.id}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title: newTask.trim() }),
      });
      setNewTask("");
      const rd = await api(`/swarm/rooms/${room.id}`);
      setTasks(rd.tasks);
    } catch (e) {
      toast({ title: "Failed to create task", variant: "destructive" });
    }
  };

  const toggleTask = async (task: RoomTask) => {
    const next = task.status === "done" ? "open" : task.status === "open" ? "in_progress" : "done";
    try {
      await api(`/swarm/rooms/${room.id}/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: next } : t)));
    } catch (e) {
      toast({ title: "Failed to update task", variant: "destructive" });
    }
  };

  const aiSummary = async () => {
    setSummarizing(true);
    try {
      const res = await api(`/swarm/rooms/${room.id}/ai-summary`, {
        method: "POST",
        body: JSON.stringify({ window_minutes: 15 }),
      });
      setSummary(res.summary);
      toast({ title: `Summary generated (confidence ${res.confidence}%)` });
    } catch (e) {
      toast({
        title: "AI summary failed",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setSummarizing(false);
    }
  };

  const resolveRoom = async () => {
    if (!confirm("Resolve this incident and close the swarm room?")) return;
    setResolving(true);
    try {
      await api(`/swarm/rooms/${room.id}/resolve`, { method: "POST" });
      toast({ title: "Incident resolved" });
      setRoom({ ...room, status: "resolved" });
      loadIncident();
    } catch (e) {
      toast({
        title: "Resolve failed",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setResolving(false);
    }
  };

  const notes = messages.filter((m) => m.messageType === "note" || m.messageType === "decision");
  const timeline = messages.filter(
    (m) => m.messageType === "status_update" || m.messageType === "decision",
  );

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading…
        </div>
      </AppLayout>
    );
  }
  if (error || !incident) {
    return (
      <AppLayout>
        <div className="p-6 text-center text-destructive">{error || "Not found"}</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-muted-foreground">
                {incident.incidentNumber}
              </span>
              {incident.isMajor && (
                <Badge variant="destructive">
                  <Radio className="h-3 w-3 mr-1" /> MAJOR
                </Badge>
              )}
              <Badge>{incident.severity}</Badge>
              <Badge variant="outline">{incident.status}</Badge>
              {room && (
                <Badge variant={room.status === "active" ? "default" : "secondary"}>
                  Swarm: {room.status}
                </Badge>
              )}
            </div>
            <h1 className="text-2xl font-bold mt-1">{incident.title}</h1>
            <p className="text-sm text-muted-foreground">
              {incident.commanderName ? `Commander: ${incident.commanderName} · ` : ""}
              Started {new Date(incident.startedAt).toLocaleString("en-IN")}
            </p>
          </div>
          <div className="flex gap-2">
            {!room && (
              <Button onClick={startSwarm} disabled={starting}>
                {starting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Start Swarm
              </Button>
            )}
            {room?.status === "active" && (
              <Button variant="outline" onClick={resolveRoom} disabled={resolving}>
                {resolving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Resolve incident
              </Button>
            )}
          </div>
        </div>

        {!room ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <Radio className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium text-foreground">No swarm room yet</p>
              <p className="text-sm">
                Start a swarm to open the incident command room with live chat,
                tasks, AI summaries, and post-incident review.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="chat">
            <TabsList>
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="notes">Notes & Decisions</TabsTrigger>
              <TabsTrigger value="tasks">
                Tasks ({tasks.filter((t) => t.status !== "done").length})
              </TabsTrigger>
              <TabsTrigger value="ai">AI Summary</TabsTrigger>
              <TabsTrigger value="postmortem">Postmortem</TabsTrigger>
            </TabsList>

            {/* Chat */}
            <TabsContent value="chat">
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Users className="h-4 w-4" /> {members.length} members
                      <span className="text-xs font-normal text-muted-foreground">
                        · live polling every 2s
                      </span>
                    </span>
                    {!joined && room.status === "active" && (
                      <Button size="sm" onClick={join}>Join room</Button>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-96 overflow-y-auto border rounded-md p-3 space-y-3 bg-muted/30">
                    {messages.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No messages yet. Say hello to the swarm.
                      </p>
                    )}
                    {messages.map((m) => (
                      <div key={m.id} className="text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{m.author ?? "Unknown"}</span>
                          <Badge variant="outline" className="text-[10px] px-1">
                            {MSG_TYPE_LABEL[m.messageType] ?? m.messageType}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">
                            {new Date(m.createdAt).toLocaleTimeString("en-IN")}
                          </span>
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap">{m.content}</p>
                      </div>
                    ))}
                    <div ref={chatEnd} />
                  </div>
                  {joined && room.status === "active" ? (
                    <div className="flex gap-2 mt-3">
                      <Select value={msgType} onValueChange={setMsgType}>
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="chat">Chat</SelectItem>
                          <SelectItem value="note">Note</SelectItem>
                          <SelectItem value="decision">Decision</SelectItem>
                          <SelectItem value="status_update">Status</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        value={composer}
                        onChange={(e) => setComposer(e.target.value)}
                        placeholder="Message the swarm…"
                        onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                      />
                      <Button onClick={sendMessage} disabled={sending || !composer.trim()}>
                        {sending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-3 text-center">
                      {room.status !== "active"
                        ? "This room is closed."
                        : "Join the room to post messages."}
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Timeline */}
            <TabsContent value="timeline">
              <Card>
                <CardContent className="py-4">
                  {timeline.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No status updates or decisions yet.
                    </p>
                  ) : (
                    <ol className="relative border-l ml-3 space-y-4">
                      {timeline.map((m) => (
                        <li key={m.id} className="ml-4">
                          <div className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-primary" />
                          <p className="text-xs text-muted-foreground">
                            {new Date(m.createdAt).toLocaleString("en-IN")} · {m.author}
                          </p>
                          <Badge variant="outline" className="text-[10px] my-1">
                            {MSG_TYPE_LABEL[m.messageType]}
                          </Badge>
                          <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Notes & decisions */}
            <TabsContent value="notes">
              <Card>
                <CardContent className="py-4 space-y-3">
                  {notes.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No notes or decisions recorded. Use the Chat tab with type
                      "Note" or "Decision".
                    </p>
                  ) : (
                    notes.map((m) => (
                      <Card key={m.id}>
                        <CardContent className="py-3">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge
                              variant={m.messageType === "decision" ? "default" : "outline"}
                            >
                              {MSG_TYPE_LABEL[m.messageType]}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {m.author} · {new Date(m.createdAt).toLocaleString("en-IN")}
                            </span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tasks */}
            <TabsContent value="tasks">
              <Card>
                <CardContent className="py-4 space-y-3">
                  {joined && room.status === "active" && (
                    <div className="flex gap-2">
                      <Input
                        value={newTask}
                        onChange={(e) => setNewTask(e.target.value)}
                        placeholder="New task…"
                        onKeyDown={(e) => e.key === "Enter" && createTask()}
                      />
                      <Button onClick={createTask}>
                        <ListTodo className="h-4 w-4 mr-2" /> Add
                      </Button>
                    </div>
                  )}
                  {tasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No tasks yet.
                    </p>
                  ) : (
                    tasks.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center gap-3 border rounded-md px-3 py-2"
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleTask(t)}
                          disabled={!joined || room.status !== "active"}
                          title="Advance status"
                        >
                          {t.status === "done" ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <span
                              className={`h-4 w-4 rounded-full border-2 ${
                                t.status === "in_progress"
                                  ? "border-amber-500 bg-amber-200"
                                  : "border-zinc-300"
                              }`}
                            />
                          )}
                        </Button>
                        <span
                          className={`flex-1 text-sm ${
                            t.status === "done" ? "line-through text-muted-foreground" : ""
                          }`}
                        >
                          {t.title}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {t.status.replace("_", " ")}
                        </Badge>
                        {t.assigneeName && (
                          <span className="text-xs text-muted-foreground">{t.assigneeName}</span>
                        )}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* AI Summary */}
            <TabsContent value="ai">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4" /> Incident AI Summary
                    </span>
                    <Button size="sm" onClick={aiSummary} disabled={summarizing}>
                      {summarizing ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      Last 15 min
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!summary ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Generate an AI summary of recent room activity: what happened,
                      what changed, what's blocked, what's next.
                    </p>
                  ) : (
                    <div className="space-y-3 text-sm">
                      {[
                        ["What happened", summary.what_happened],
                        ["What changed", summary.what_changed],
                        ["Being investigated", summary.investigating],
                        ["Blocked", summary.blocked],
                        ["Next", summary.next],
                      ].map(([label, val]) => (
                        <div key={label}>
                          <p className="font-medium">{label}</p>
                          <p className="text-muted-foreground whitespace-pre-wrap">
                            {typeof val === "string" && val ? val : "—"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Postmortem */}
            <TabsContent value="postmortem">
              <PostmortemDraft incidentId={Number(incidentId)} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}
