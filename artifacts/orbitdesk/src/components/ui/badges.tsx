import React from "react";
import { Badge } from "@/components/ui/badge";
import { TicketStatus, TicketPriority } from "@workspace/api-client-react";

export function StatusBadge({ status }: { status: TicketStatus }) {
  const colors: Record<TicketStatus, string> = {
    [TicketStatus.open]: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    [TicketStatus.assigned]: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300 border-orange-200 dark:border-orange-800",
    [TicketStatus.in_progress]: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    [TicketStatus.waiting]: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300 border-purple-200 dark:border-purple-800",
    [TicketStatus.resolved]: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 border-green-200 dark:border-green-800",
    [TicketStatus.closed]: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700",
  };

  const labels: Record<TicketStatus, string> = {
    [TicketStatus.open]: "Open",
    [TicketStatus.assigned]: "Assigned",
    [TicketStatus.in_progress]: "In Progress",
    [TicketStatus.waiting]: "Waiting",
    [TicketStatus.resolved]: "Resolved",
    [TicketStatus.closed]: "Closed",
  };

  return (
    <Badge variant="outline" className={`${colors[status]} capitalize font-medium px-2 py-0.5`}>
      {labels[status]}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const colors: Record<TicketPriority, string> = {
    [TicketPriority.low]: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700",
    [TicketPriority.medium]: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    [TicketPriority.high]: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300 border-orange-200 dark:border-orange-800",
    [TicketPriority.urgent]: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300 border-red-200 dark:border-red-800",
  };

  const labels: Record<TicketPriority, string> = {
    [TicketPriority.low]: "Low",
    [TicketPriority.medium]: "Medium",
    [TicketPriority.high]: "High",
    [TicketPriority.urgent]: "Urgent",
  };

  return (
    <Badge variant="outline" className={`${colors[priority]} capitalize font-medium px-2 py-0.5`}>
      {labels[priority]}
    </Badge>
  );
}
