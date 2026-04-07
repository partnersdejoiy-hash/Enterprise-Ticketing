import React from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { 
  useGetDashboardStats, 
  useGetDepartmentStats, 
  useGetRecentTickets,
  useGetAgentPerformance,
  useGetSlaOverview,
  getGetDashboardStatsQueryKey,
  getGetDepartmentStatsQueryKey,
  getGetRecentTicketsQueryKey,
  getGetAgentPerformanceQueryKey,
  getGetSlaOverviewQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Ticket, AlertCircle, Clock, CheckCircle2, Building2, ShieldAlert, FileText, Plus, ArrowRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Sector } from "recharts";
import { StatusBadge, PriorityBadge } from "@/components/ui/badges";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";

function StatCard({ 
  title, 
  value, 
  description, 
  icon: Icon, 
  trend,
  isLoading 
}: { 
  title: string; 
  value: React.ReactNode; 
  description?: string; 
  icon: any; 
  trend?: { value: number; label: string };
  isLoading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-20 mb-1" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
        
        {description && !isLoading && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
        
        {trend && !isLoading && (
          <div className="flex items-center mt-1 text-xs">
            <span className={trend.value >= 0 ? "text-emerald-600" : "text-rose-600"}>
              {trend.value > 0 ? "+" : ""}{trend.value}%
            </span>
            <span className="text-muted-foreground ml-1">{trend.label}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading: isLoadingStats } = useGetDashboardStats({
    query: { queryKey: getGetDashboardStatsQueryKey() }
  });
  
  const { data: deptStats, isLoading: isLoadingDept } = useGetDepartmentStats({
    query: { queryKey: getGetDepartmentStatsQueryKey() }
  });
  
  const { data: recentTickets, isLoading: isLoadingRecent } = useGetRecentTickets(
    { limit: 5 },
    { query: { queryKey: getGetRecentTicketsQueryKey({ limit: 5 }) } }
  );

  const { data: agentPerf, isLoading: isLoadingAgents } = useGetAgentPerformance({
    query: { queryKey: getGetAgentPerformanceQueryKey() }
  });

  const { data: sla, isLoading: isLoadingSla } = useGetSlaOverview({
    query: { queryKey: getGetSlaOverviewQueryKey() }
  });

  return (
    <AppLayout>
      <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of ticketing operations and agent performance.</p>
        </div>

        {/* Top Stats Row */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Open Tickets"
            value={stats?.openTickets || 0}
            icon={Ticket}
            trend={{ value: 12, label: "from last week" }}
            isLoading={isLoadingStats}
          />
          <StatCard
            title="Urgent Needs Attention"
            value={stats?.urgentTickets || 0}
            icon={AlertCircle}
            description={`${stats?.inProgressTickets || 0} currently in progress`}
            isLoading={isLoadingStats}
          />
          <StatCard
            title="SLA Breached"
            value={stats?.slaBreachedTickets || 0}
            icon={ShieldAlert}
            trend={{ value: -5, label: "from last week" }}
            isLoading={isLoadingStats}
          />
          <StatCard
            title="Avg Resolution Time"
            value={`${stats?.avgResolutionHours.toFixed(1) || 0}h`}
            icon={Clock}
            description="Across all departments"
            isLoading={isLoadingStats}
          />
        </div>

        {/* Quick Actions */}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          {[
            { href: "/documents", icon: FileText, label: "Request Document", desc: "Experience letter, salary slip, etc.", color: "text-blue-600 bg-blue-50 border-blue-100" },
            { href: "/tickets/new", icon: Plus, label: "New Ticket", desc: "Raise a support request", color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
            { href: "/tickets?priority=urgent", icon: AlertCircle, label: "Urgent Tickets", desc: "View tickets needing immediate attention", color: "text-red-600 bg-red-50 border-red-100" },
            { href: "/tickets?status=open", icon: Ticket, label: "Open Tickets", desc: "Browse all open support tickets", color: "text-amber-600 bg-amber-50 border-amber-100" },
          ].map((action) => (
            <Link key={action.href} href={action.href}>
              <div className={`group flex flex-col gap-2 rounded-xl border p-4 cursor-pointer transition-all hover:shadow-sm hover:-translate-y-0.5 ${action.color.split(" ").slice(1).join(" ")}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${action.color.split(" ")[1]} bg-white/70`}>
                  <action.icon className={`h-4 w-4 ${action.color.split(" ")[0]}`} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground leading-tight">{action.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{action.desc}</p>
                </div>
                <ArrowRight className={`h-3.5 w-3.5 ${action.color.split(" ")[0]} opacity-0 group-hover:opacity-100 transition-opacity ml-auto`} />
              </div>
            </Link>
          ))}
        </div>

        <div className="grid gap-6 md:grid-cols-7 lg:grid-cols-7">
          {/* Main Chart */}
          <Card className="md:col-span-4">
            <CardHeader>
              <CardTitle>Department Workload</CardTitle>
              <CardDescription>Open tickets distributed across departments</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                {isLoadingDept ? (
                  <Skeleton className="w-full h-full" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={deptStats || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <XAxis 
                        dataKey="departmentName" 
                        fontSize={12} 
                        tickLine={false} 
                        axisLine={false}
                      />
                      <YAxis 
                        fontSize={12} 
                        tickLine={false} 
                        axisLine={false}
                        tickFormatter={(value) => `${value}`}
                      />
                      <Tooltip 
                        cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                        contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)' }}
                      />
                      <Bar dataKey="openCount" radius={[4, 4, 0, 0]}>
                        {(deptStats || []).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color || 'var(--primary)'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          {/* SLA Chart */}
          <Card className="md:col-span-3">
            <CardHeader>
              <CardTitle>SLA Compliance</CardTitle>
              <CardDescription>Target vs actual response times</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center items-center h-[300px]">
              {isLoadingSla ? (
                <Skeleton className="w-[200px] h-[200px] rounded-full" />
              ) : (
                <div className="relative w-full h-full flex flex-col items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Compliant', value: sla?.compliant || 0, fill: '#10b981' },
                          { name: 'At Risk', value: sla?.atRisk || 0, fill: '#f59e0b' },
                          { name: 'Breached', value: sla?.breached || 0, fill: '#ef4444' },
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={80}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="value"
                      />
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-3xl font-bold">{sla?.complianceRate || 0}%</span>
                    <span className="text-xs text-muted-foreground">Compliance</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Recent Tickets */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest tickets needing attention</CardDescription>
              </div>
              <Link href="/tickets" className="text-sm text-primary hover:underline">
                View all
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {isLoadingRecent ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-3 w-2/3" />
                      </div>
                    </div>
                  ))
                ) : recentTickets?.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">No recent tickets</div>
                ) : (
                  recentTickets?.map((ticket) => (
                    <Link key={ticket.id} href={`/tickets/${ticket.id}`} className="flex items-start gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors -mx-3">
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium leading-none">{ticket.subject}</p>
                          <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                            {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground font-mono">{ticket.ticketNumber}</span>
                          <StatusBadge status={ticket.status} />
                          <PriorityBadge priority={ticket.priority} />
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Agent Performance */}
          <Card>
            <CardHeader>
              <CardTitle>Top Agents</CardTitle>
              <CardDescription>Based on resolution time and volume</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {isLoadingAgents ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    </div>
                  ))
                ) : agentPerf?.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">No data available</div>
                ) : (
                  agentPerf?.slice(0, 5).map((agent) => (
                    <div key={agent.agentId} className="flex items-center gap-4">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={agent.avatar || ""} />
                        <AvatarFallback>{agent.agentName.charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-medium leading-none">{agent.agentName}</p>
                        <p className="text-xs text-muted-foreground">
                          {agent.resolvedCount} resolved • {agent.avgResolutionHours.toFixed(1)}h avg
                        </p>
                      </div>
                      <div className="text-sm font-medium text-emerald-600">
                        {agent.satisfactionScore ? `${agent.satisfactionScore}% CSAT` : '-'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
