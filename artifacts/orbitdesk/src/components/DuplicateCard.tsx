/**
 * Duplicate Card (Superpower #18).
 * Lists duplicate candidates with similarity scores. Merge / Link / Dismiss
 * are explicit staff actions behind confirmation dialogs — never silent.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useToast } from "@/hooks/use-toast";
import {
  fetchDuplicates,
  mergeDuplicate,
  linkDuplicate,
  dismissDuplicate,
  type DuplicateCandidate,
} from "@/lib/intelligence";
import { Copy, Link2, X } from "lucide-react";

type PendingAction = {
  kind: "merge" | "link" | "dismiss";
  dup: DuplicateCandidate;
} | null;

export function DuplicateCard({
  ticketId,
  canHandle,
}: {
  ticketId: number;
  canHandle: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingAction>(null);

  const query = useQuery({
    queryKey: ["duplicates", ticketId],
    queryFn: () => fetchDuplicates(ticketId),
  });
  const dups = query.data?.duplicates ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["duplicates", ticketId] });
    queryClient.invalidateQueries({ queryKey: ["next-action", ticketId] });
  };

  const actionMutation = useMutation({
    mutationFn: async (p: NonNullable<PendingAction>) => {
      const id = p.dup.relationshipId;
      if (!id) throw new Error("Candidate not yet proposed — reload first");
      if (p.kind === "merge") return mergeDuplicate(id);
      if (p.kind === "link") return linkDuplicate(id);
      return dismissDuplicate(id);
    },
    onSuccess: (data, p) => {
      invalidate();
      setPending(null);
      if (p.kind === "merge" && "closedTicket" in data) {
        toast({
          title: `Merged — ${data.closedTicket} closed as duplicate`,
          description: `${data.keptTicket} kept as the primary ticket.`,
        });
        // The merged-away ticket changed status; refresh the ticket view.
        queryClient.invalidateQueries({ queryKey: ["ticket"] });
      } else {
        toast({
          title:
            p.kind === "link" ? "Tickets linked" : "Suggestion dismissed",
        });
      }
    },
    onError: (e: Error) =>
      toast({
        title: "Action failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const confirmText: Record<string, { title: string; desc: string; cta: string }> = {
    merge: {
      title: "Merge duplicate?",
      desc: "This will CLOSE the duplicate ticket and keep the current one as primary. The closure is recorded in both tickets' history. This cannot be undone automatically.",
      cta: "Merge & close duplicate",
    },
    link: {
      title: "Link as related?",
      desc: "Both tickets stay open. A related_to link is recorded between them.",
      cta: "Link tickets",
    },
    dismiss: {
      title: "Dismiss suggestion?",
      desc: "The duplicate suggestion will be rejected. Nothing else changes.",
      cta: "Dismiss",
    },
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-3">
        <Copy className="h-4 w-4 text-sky-600" /> Possible Duplicates
        {dups.length > 0 && (
          <Badge variant="secondary" className="ml-1">
            {dups.length}
          </Badge>
        )}
      </h3>

      {query.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {query.isError && (
        <div className="text-sm text-muted-foreground">
          Couldn't load duplicate candidates.{" "}
          <button
            className="underline"
            onClick={() => query.refetch()}
          >
            Try again
          </button>
        </div>
      )}

      {query.isSuccess && dups.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No similar open tickets found.
        </p>
      )}

      {dups.length > 0 && (
        <div className="space-y-2">
          {dups.map((d) => (
            <div
              key={d.relationshipId ?? d.ticketId}
              className="border border-border rounded-md p-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground truncate">
                  {d.ticketNumber}
                </span>
                <Badge variant="outline" className="text-xs shrink-0">
                  {d.similarity}% match
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {d.subject}
              </p>
              {canHandle && d.relationshipStatus === "proposed" && (
                <div className="flex gap-1.5 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs flex-1"
                    onClick={() => setPending({ kind: "merge", dup: d })}
                  >
                    Merge
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs flex-1"
                    onClick={() => setPending({ kind: "link", dup: d })}
                  >
                    <Link2 className="h-3 w-3 mr-1" /> Link
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setPending({ kind: "dismiss", dup: d })}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
              {d.relationshipStatus === "active" && (
                <Badge variant="secondary" className="text-xs mt-2">
                  Linked
                </Badge>
              )}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">
            Merge is never automatic — you decide.
          </p>
        </div>
      )}

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending ? confirmText[pending.kind].title : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending
                ? `${confirmText[pending.kind].desc} Ticket: ${pending.dup.ticketNumber} — ${pending.dup.subject}`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={actionMutation.isPending}
              onClick={() => pending && actionMutation.mutate(pending)}
              className={
                pending?.kind === "merge"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }
            >
              {actionMutation.isPending
                ? "Working…"
                : pending
                  ? confirmText[pending.kind].cta
                  : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
