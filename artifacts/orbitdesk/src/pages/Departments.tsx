import React from "react";
import { useListDepartments } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Monitor, Users, ShieldCheck, Building2, Scale, 
  DollarSign, Cog, Headphones, Clock, TicketIcon, UserCheck
} from "lucide-react";

const iconMap: Record<string, React.ElementType> = {
  Monitor, Users, ShieldCheck, Building2, Scale,
  DollarSign, Cog, Headphones, HeadphonesIcon: Headphones,
};

const defaultColors = [
  "#3B82F6", "#8B5CF6", "#F59E0B", "#10B981",
  "#EF4444", "#06B6D4", "#F97316", "#EC4899",
];

export default function Departments() {
  const { data: departments, isLoading } = useListDepartments();

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Departments</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {departments?.length ?? 0} departments configured
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {(departments ?? []).map((dept, idx) => {
              const color = dept.color ?? defaultColors[idx % defaultColors.length];
              const IconComponent = dept.icon ? (iconMap[dept.icon] ?? Building2) : Building2;

              return (
                <div
                  key={dept.id}
                  className="bg-card border border-border rounded-lg p-5 hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${color}1A`, border: `1px solid ${color}30` }}
                      >
                        <IconComponent className="h-5 w-5" style={{ color }} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground text-sm">{dept.name}</h3>
                        {dept.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{dept.description}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mt-4">
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                        <TicketIcon className="h-3.5 w-3.5" />
                      </div>
                      <p className="text-lg font-bold text-foreground">{dept.openTicketCount}</p>
                      <p className="text-xs text-muted-foreground">Open</p>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                        <UserCheck className="h-3.5 w-3.5" />
                      </div>
                      <p className="text-lg font-bold text-foreground">{dept.agentCount}</p>
                      <p className="text-xs text-muted-foreground">Agents</p>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                        <Clock className="h-3.5 w-3.5" />
                      </div>
                      <p className="text-lg font-bold text-foreground">{dept.slaResolutionHours}h</p>
                      <p className="text-xs text-muted-foreground">SLA</p>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-border">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Response SLA: <span className="font-medium text-foreground">{dept.slaResponseHours}h</span></span>
                      <span>Resolution SLA: <span className="font-medium text-foreground">{dept.slaResolutionHours}h</span></span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
