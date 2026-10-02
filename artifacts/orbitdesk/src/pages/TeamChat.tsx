import { useCallback, useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Bot,
  Send,
  Plus,
  Search,
  Users,
  Loader2,
  Trash2,
  Sparkles,
  Mail,
} from "lucide-react";

interface BotInfo {
  id: number;
  kind: string;
  name: string;
  enabled: boolean;
  department: string | null;
  role: string;
}
interface ThreadInfo {
  id: number;
  kind: "direct" | "huddle";
  title: string;
  worker_id: number | null;
  worker_name: string | null;
  worker_kind: string | null;
  department: string | null;
  participants: { id: number; name: string; kind: string }[];
  unread: number;
  last_message: string | null;
  updated_at: string;
}
interface ChatMsg {
  id: number;
  sender: "user" | "bot";
  author: string;
  worker_id: number | null;
  content: string;
  created_at: string;
}

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

const AVATAR_COLORS = [
  "bg-violet-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-indigo-500",
  "bg-teal-500",
  "bg-orange-500",
];
function avatarColor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export default function TeamChat() {
  const { toast } = useToast();
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [threads, setThreads] = useState<ThreadInfo[]>([]);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [activeThread, setActiveThread] = useState<ThreadInfo | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [huddleOpen, setHuddleOpen] = useState(false);
  const [huddleBots, setHuddleBots] = useState<number[]>([]);
  const [huddleTopic, setHuddleTopic] = useState("");
  const [startingHuddle, setStartingHuddle] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshThreads = useCallback(async () => {
    try {
      const v = await api("/ai/chat/threads");
      setThreads(v.threads);
    } catch {
      /* keep old list */
    }
  }, []);

  useEffect(() => {
    api("/ai/chat/roster")
      .then((v) => setBots(v.bots))
      .catch((e) =>
        toast({
          title: "Could not load bots",
          description: e.message,
          variant: "destructive",
        }),
      );
    api("/ai/status")
      .then((v) => setAiReady(!!(v.enabled && v.configured)))
      .catch(() => setAiReady(false));
    refreshThreads();
    const t = setInterval(refreshThreads, 20000);
    return () => clearInterval(t);
  }, [refreshThreads, toast]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const openThread = useCallback(
    async (id: number) => {
      setActiveId(id);
      setLoadingThread(true);
      try {
        const v = await api(`/ai/chat/threads/${id}`);
        setActiveThread(v.thread);
        setMessages(v.messages);
        refreshThreads();
      } catch (e: any) {
        toast({
          title: "Could not open chat",
          description: e.message,
          variant: "destructive",
        });
      } finally {
        setLoadingThread(false);
      }
    },
    [refreshThreads, toast],
  );

  useEffect(() => {
    if (activeId == null) return;
    const t = setInterval(async () => {
      if (busy) return;
      try {
        const v = await api(`/ai/chat/threads/${activeId}`);
        setMessages(v.messages);
      } catch {
        /* ignore */
      }
    }, 10000);
    return () => clearInterval(t);
  }, [activeId, busy]);

  const openBot = async (bot: BotInfo) => {
    if (!bot.enabled) {
      toast({
        title: `${bot.name} is disabled`,
        description: "Enable this worker in Settings → AI workforce first.",
      });
      return;
    }
    try {
      const v = await api("/ai/chat/threads", {
        method: "POST",
        body: JSON.stringify({ workerId: bot.id }),
      });
      openThread(v.threadId);
    } catch (e: any) {
      toast({
        title: "Could not open chat",
        description: e.message,
        variant: "destructive",
      });
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy || activeId == null) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [
      ...m,
      {
        id: -Date.now(),
        sender: "user",
        author: "You",
        worker_id: null,
        content: text,
        created_at: new Date().toISOString(),
      },
    ]);
    try {
      await api(`/ai/chat/threads/${activeId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      const v = await api(`/ai/chat/threads/${activeId}`);
      setMessages(v.messages);
      refreshThreads();
    } catch (e: any) {
      toast({
        title: "Message not delivered",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const startHuddle = async () => {
    if (huddleBots.length < 2 || !huddleTopic.trim() || startingHuddle) return;
    setStartingHuddle(true);
    try {
      const v = await api("/ai/chat/threads", {
        method: "POST",
        body: JSON.stringify({
          workerIds: huddleBots,
          topic: huddleTopic.trim(),
        }),
      });
      setHuddleOpen(false);
      setHuddleBots([]);
      setHuddleTopic("");
      refreshThreads();
      openThread(v.threadId);
    } catch (e: any) {
      toast({
        title: "Could not start huddle",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setStartingHuddle(false);
    }
  };

  const deleteThread = async () => {
    if (activeId == null) return;
    try {
      await api(`/ai/chat/threads/${activeId}`, { method: "DELETE" });
      setActiveId(null);
      setActiveThread(null);
      setMessages([]);
      refreshThreads();
    } catch (e: any) {
      toast({
        title: "Could not delete",
        description: e.message,
        variant: "destructive",
      });
    }
  };

  const sendEmailAsBot = async () => {
    if (activeId == null || sendingEmail) return;
    setSendingEmail(true);
    try {
      await api(`/ai/chat/threads/${activeId}/email`, {
        method: "POST",
        body: JSON.stringify({
          to: emailTo,
          subject: emailSubject,
          body: emailBody,
        }),
      });
      setEmailOpen(false);
      setEmailTo("");
      setEmailSubject("");
      setEmailBody("");
      toast({ title: "Email sent" });
      openThread(activeId);
    } catch (e: any) {
      toast({
        title: "Could not send email",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setSendingEmail(false);
    }
  };

  const filteredBots = bots.filter((b) =>
    `${b.name} ${b.department ?? ""} ${b.role}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const huddles = threads.filter((t) => t.kind === "huddle");
  const threadUnread = (t: ThreadInfo) => t.unread;
  const botUnread = (botId: number) =>
    threads.find((t) => t.kind === "direct" && t.worker_id === botId)?.unread ??
    0;
  const totalUnread = threads.reduce((n, t) => n + t.unread, 0);

  const threadTitle = activeThread
    ? activeThread.kind === "direct"
      ? activeThread.worker_name || "Bot"
      : activeThread.title || "Huddle"
    : "";
  const threadSubtitle = activeThread
    ? activeThread.kind === "direct"
      ? `${activeThread.department ?? "Workspace"} · ${activeThread.worker_kind === "pa" ? "Personal assistant" : activeThread.worker_kind === "draft" ? "Response drafting" : "Triage & review"}`
      : `${activeThread.participants.length} bots`
    : "";

  return (
    <AppLayout>
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Sparkles className="h-6 w-6" /> AI Team Chat
              {totalUnread > 0 && (
                <Badge variant="destructive">{totalUnread} new</Badge>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              Chat 1:1 with any bot, or start a huddle and let the bots discuss.
            </p>
          </div>
          <Button
            onClick={() => setHuddleOpen(true)}
            disabled={aiReady === false}
          >
            <Plus className="h-4 w-4 mr-1" /> New huddle
          </Button>
        </div>

        {aiReady === false && (
          <Card className="mb-4 border-amber-300">
            <CardContent className="pt-4 text-sm">
              Server AI is not enabled — bots cannot reply yet. Ask the
              superadmin to connect and enable it in Settings → AI workforce.
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4">
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search bots…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[520px]">
                <div className="px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                  Bots ({filteredBots.length})
                </div>
                {filteredBots.map((b) => {
                  const unread = botUnread(b.id);
                  const isActive =
                    activeThread?.kind === "direct" &&
                    activeThread.worker_id === b.id;
                  return (
                    <button
                      key={b.id}
                      onClick={() => openBot(b)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/60 ${isActive ? "bg-muted" : ""} ${b.enabled ? "" : "opacity-50"}`}
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarFallback
                          className={`${avatarColor(b.name)} text-white text-sm`}
                        >
                          {b.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate flex items-center gap-1">
                          {b.name}
                          {!b.enabled && (
                            <Badge variant="outline" className="text-[10px]">
                              off
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {b.department ?? "Workspace"} · {b.role}
                        </div>
                      </div>
                      {unread > 0 && (
                        <Badge variant="destructive">{unread}</Badge>
                      )}
                    </button>
                  );
                })}
                {huddles.length > 0 && (
                  <>
                    <Separator className="my-2" />
                    <div className="px-3 py-2 text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1">
                      <Users className="h-3 w-3" /> Huddles ({huddles.length})
                    </div>
                    {huddles.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => openThread(t.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/60 ${activeId === t.id ? "bg-muted" : ""}`}
                      >
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-slate-600 text-white text-sm">
                            <Users className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">
                            {t.title}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {t.participants.map((p) => p.name).join(", ")}
                          </div>
                        </div>
                        {threadUnread(t) > 0 && (
                          <Badge variant="destructive">{threadUnread(t)}</Badge>
                        )}
                      </button>
                    ))}
                  </>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="flex flex-col overflow-hidden">
            {!activeThread ? (
              <CardContent className="flex-1 flex flex-col items-center justify-center text-center py-24 text-muted-foreground">
                <Bot className="h-12 w-12 mb-3 opacity-40" />
                <p className="font-medium">Pick a bot to start chatting</p>
                <p className="text-sm mt-1 max-w-sm">
                  Or start a huddle — give the bots a topic and watch them
                  discuss it. You can jump in any time.
                </p>
              </CardContent>
            ) : (
              <>
                <CardHeader className="pb-3 border-b">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{threadTitle}</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {threadSubtitle}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {activeThread.kind === "direct" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEmailOpen(true)}
                          title="Send email as bot"
                        >
                          <Mail className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={deleteThread}
                        title="Delete chat"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <ScrollArea className="flex-1 h-[440px] p-4">
                  {loadingThread ? (
                    <div className="flex justify-center py-10">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {messages.map((m) => (
                        <div
                          key={m.id}
                          className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                              m.sender === "user"
                                ? "bg-primary text-primary-foreground rounded-br-md"
                                : "bg-muted rounded-bl-md"
                            }`}
                          >
                            {m.sender === "bot" && (
                              <div className="text-[11px] font-semibold text-violet-600 mb-0.5">
                                {m.author}
                              </div>
                            )}
                            {m.content}
                          </div>
                        </div>
                      ))}
                      {busy && (
                        <div className="flex justify-start">
                          <div className="bg-muted rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />{" "}
                            thinking…
                          </div>
                        </div>
                      )}
                      <div ref={bottomRef} />
                    </div>
                  )}
                </ScrollArea>
                <div className="p-3 border-t flex gap-2">
                  <Input
                    placeholder={
                      activeThread.kind === "huddle"
                        ? "Jump into the discussion…"
                        : `Message ${threadTitle}…`
                    }
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                    disabled={busy || aiReady === false}
                    maxLength={2000}
                  />
                  <Button
                    onClick={send}
                    disabled={busy || !input.trim() || aiReady === false}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      <Dialog open={huddleOpen} onOpenChange={setHuddleOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New huddle</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium mb-1">
                Topic for the bots to discuss
              </div>
              <Textarea
                placeholder="e.g. How should we handle the spike in IT tickets this week?"
                value={huddleTopic}
                onChange={(e) => setHuddleTopic(e.target.value)}
                maxLength={500}
                rows={2}
              />
            </div>
            <div>
              <div className="text-sm font-medium mb-1">
                Pick bots ({huddleBots.length}/6)
              </div>
              <ScrollArea className="h-56 border rounded-md p-2">
                {bots
                  .filter((b) => b.enabled)
                  .map((b) => (
                    <label
                      key={b.id}
                      className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-muted/60 cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={huddleBots.includes(b.id)}
                        onCheckedChange={(checked) =>
                          setHuddleBots((prev) =>
                            checked
                              ? prev.length < 6
                                ? [...prev, b.id]
                                : prev
                              : prev.filter((id) => id !== b.id),
                          )
                        }
                      />
                      <Avatar className="h-7 w-7">
                        <AvatarFallback
                          className={`${avatarColor(b.name)} text-white text-xs`}
                        >
                          {b.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{b.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {b.department ?? "Workspace"} · {b.role}
                      </span>
                    </label>
                  ))}
              </ScrollArea>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHuddleOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={startHuddle}
              disabled={
                huddleBots.length < 2 || !huddleTopic.trim() || startingHuddle
              }
            >
              {startingHuddle && (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              )}
              Start huddle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send email as {threadTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium mb-1">To</div>
              <Input
                placeholder="recipient@example.com"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                maxLength={320}
              />
            </div>
            <div>
              <div className="text-sm font-medium mb-1">Subject</div>
              <Input
                placeholder="Subject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                maxLength={200}
              />
            </div>
            <div>
              <div className="text-sm font-medium mb-1">Message</div>
              <Textarea
                placeholder="Write the email…"
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                maxLength={20000}
                rows={6}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              This email will be sent from {threadTitle}&rsquo;s agent address (
              {`${(activeThread?.worker_name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")}-orbitdesk@dejoiy.com`}
              ). The message is posted to this chat once sent.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={sendEmailAsBot}
              disabled={
                sendingEmail ||
                !emailTo.trim() ||
                !emailSubject.trim() ||
                !emailBody.trim()
              }
            >
              {sendingEmail && (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              )}
              Send email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
