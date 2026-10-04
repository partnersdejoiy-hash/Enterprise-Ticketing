// Customer Service Summary (#21) — conversation intelligence.
// Shows recent interactions, open tickets, past resolutions with source links.
// NEVER infers sensitive personal traits.
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserRound, ExternalLink } from "lucide-react";
import { intelFetch } from "@/lib/intel";

interface CustomerSummaryData {
  summary: string;
  stats: { open_tickets: number; resolved_30d: number; avg_first_response_h?: number };
  sources: { type: string; id: string; title: string; url?: string }[];
}

export default function CustomerSummary({ customerId }: { customerId: number }) {
  const { data, isLoading, isError } = useQuery<{ summary: CustomerSummaryData }>({
    queryKey: ["customer-summary", customerId],
    queryFn: () => intelFetch<{ summary: CustomerSummaryData }>(`/customers/${customerId}/summary`),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError || !data?.summary) return null;
  const s = data.summary;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <UserRound className="h-4 w-4 text-muted-foreground" />
          Customer Service Summary
          <Badge variant="outline" className="text-[10px] font-normal ml-auto">AI-generated</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-4 text-sm">
          <div><span className="font-bold">{s.stats.open_tickets}</span> <span className="text-muted-foreground text-xs">open</span></div>
          <div><span className="font-bold">{s.stats.resolved_30d}</span> <span className="text-muted-foreground text-xs">resolved (30d)</span></div>
        </div>
        <p className="text-sm whitespace-pre-wrap">{s.summary}</p>
        {s.sources.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase text-muted-foreground mb-1">Sources</p>
            <ul className="space-y-1">
              {s.sources.slice(0, 6).map((src, i) => (
                <li key={i} className="text-xs flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px]">{src.type}</Badge>
                  {src.url ? (
                    <Link href={src.url} className="hover:underline truncate flex items-center gap-0.5">
                      {src.title} <ExternalLink className="h-2.5 w-2.5" />
                    </Link>
                  ) : (
                    <span className="truncate">{src.title}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
