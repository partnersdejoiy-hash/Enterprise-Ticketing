import { AppLayout } from "@/components/layout/AppLayout";
import RiskDashboard from "@/components/RiskDashboard";

export default function Risks() {
  return (
    <AppLayout>
      <div className="p-6">
        <RiskDashboard />
      </div>
    </AppLayout>
  );
}
