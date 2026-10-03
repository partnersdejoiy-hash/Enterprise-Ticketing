import { AppLayout } from "@/components/layout/AppLayout";
import RootCausePanel from "@/components/RootCausePanel";

export default function RootCause() {
  return (
    <AppLayout>
      <div className="p-6">
        <RootCausePanel />
      </div>
    </AppLayout>
  );
}
