import { useEffect, useState } from "react";
import { Bot, Send, Route, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
type Message = { role: "user" | "assistant"; content: string };
export default function OrbitAssistant() {
  const [open, setOpen] = useState(false),
    [input, setInput] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("Checking server AI…");
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch("/api/ai/status")
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((v) => {
        if (live)
          setStatus(
            v.enabled && v.configured
              ? `Server AI enabled · ${v.model}`
              : "Setup required · superadmin can connect AI in Settings → AI workforce",
          );
      })
      .catch(() => {
        if (live) setStatus("Could not check AI status. Please retry.");
      });
    return () => {
      live = false;
    };
  }, [open]);
  async function send(suggest = false) {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: text }]);
    try {
      const r = await fetch(
        suggest ? "/api/assistant/team-suggestion" : "/api/ai/chat",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        },
      );
      const v = await r.json();
      if (!r.ok) throw Error(v.error || "AI unavailable");
      const answer = suggest
        ? v.departmentName
          ? `Suggested team: ${v.departmentName}. ${v.reason}. No ticket was moved.`
          : v.reason
        : v.text;
      setMessages((m) => [...m, { role: "assistant", content: answer }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: (e as Error).message },
      ]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          className="fixed bottom-5 right-5 z-40 rounded-full shadow-lg gap-2"
          aria-label="Open Orbit assistant"
        >
          <Bot className="h-5 w-5" />
          Orbit assistant
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-4 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Orbit assistant</SheetTitle>
          <SheetDescription>
            Server AI · workflow guidance and drafts
          </SheetDescription>
        </SheetHeader>
        <div className="rounded-xl border bg-muted/40 p-3 text-xs space-y-2">
          <p role="status">{status}</p>
          <p>
            Your question is sent to the configured AI provider. Do not include
            passwords, personal HR details or documents. The assistant cannot
            approve requests or execute changes.
          </p>
          <p>
            Team suggestions use OrbitDesk's local classifier and remain
            available without the LLM.
          </p>
        </div>
        <div
          className="flex-1 min-h-0 overflow-y-auto space-y-3"
          aria-live="polite"
        >
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ask about workflows or draft a non-sensitive response. Settings →
              AI workforce contains your department workers and PA reports.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`rounded-xl p-3 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary/10 ml-8" : "bg-muted mr-4"}`}
            >
              <p className="text-xs font-medium mb-1">
                {m.role === "user" ? "You" : "Orbit"}
              </p>
              {m.content}
            </div>
          ))}
          {busy && (
            <p role="status" className="text-sm">
              Working…
            </p>
          )}
        </div>
        <Textarea
          value={input}
          maxLength={2000}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a workflow question…"
          aria-label="Message Orbit assistant"
          disabled={busy}
        />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !input.trim()} onClick={() => void send()}>
            <Send className="mr-2 h-4 w-4" />
            Ask AI
          </Button>
          <Button
            variant="outline"
            disabled={busy || !input.trim()}
            onClick={() => void send(true)}
          >
            <Route className="mr-2 h-4 w-4" />
            Suggest team
          </Button>
          <Button
            variant="ghost"
            aria-label="Clear conversation"
            disabled={busy}
            onClick={() => setMessages([])}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Each question is independent. Replies are drafts; verify before use.
        </p>
      </SheetContent>
    </Sheet>
  );
}
