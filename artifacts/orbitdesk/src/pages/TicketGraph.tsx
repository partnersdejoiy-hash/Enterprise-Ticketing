// Ticket relationship graph full-page view (#2).
import { useRoute } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import RelationshipGraph from "@/components/RelationshipGraph";

export default function TicketGraph() {
  const [, params] = useRoute("/tickets/:id/graph");
  const ticketId = params?.id ? Number(params.id) : undefined;
  if (!ticketId) return null;
  return (
    <AppLayout>
      <div className="p-6">
        <h1 className="text-xl font-bold mb-4">Ticket Relationship Graph</h1>
        <RelationshipGraph ticketId={ticketId} />
      </div>
    </AppLayout>
  );
}
