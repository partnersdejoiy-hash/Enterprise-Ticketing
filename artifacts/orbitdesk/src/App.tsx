import React, { useEffect, useState, lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setAuthTokenGetter } from "@workspace/api-client-react";
const NotFound = lazy(() => import("@/pages/not-found"));
import Login from "@/pages/Login";
const ChangePassword = lazy(() => import("@/pages/ChangePassword"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Tickets = lazy(() => import("@/pages/Tickets"));
const CreateTicket = lazy(() => import("@/pages/CreateTicket"));
const TicketDetail = lazy(() => import("@/pages/TicketDetail"));
const Departments = lazy(() => import("@/pages/Departments"));
const Users = lazy(() => import("@/pages/Users"));
const Settings = lazy(() => import("@/pages/Settings"));
const Documents = lazy(() => import("@/pages/Documents"));
const Training = lazy(() => import("@/pages/Training"));
const AutomationRules = lazy(() => import("@/pages/AutomationRules"));
const EmploymentVerification = lazy(
  () => import("@/pages/EmploymentVerification"),
);
const BackgroundVerification = lazy(
  () => import("@/pages/BackgroundVerification"),
);
const TeamChat = lazy(() => import("@/pages/TeamChat"));
const Incidents = lazy(() => import("@/pages/Incidents"));
const SwarmRoom = lazy(() => import("@/pages/SwarmRoom"));
const Runbooks = lazy(() => import("@/pages/Runbooks"));
const Monitoring = lazy(() => import("@/pages/Monitoring"));
const SlaPolicies = lazy(() => import("@/pages/SlaPolicies"));
const Risks = lazy(() => import("@/pages/Risks"));
const RootCause = lazy(() => import("@/pages/RootCause"));
const Knowledge = lazy(() => import("@/pages/Knowledge"));
const PublicRequest = lazy(() => import("@/pages/PublicRequest"));
const ServiceCatalog = lazy(() => import("@/pages/ServiceCatalog"));
const CommandCenter = lazy(() => import("@/pages/CommandCenter"));
const ExecutiveBrief = lazy(() => import("@/pages/ExecutiveBrief"));
const OperationsMap = lazy(() => import("@/pages/OperationsMap"));
const Changes = lazy(() => import("@/pages/Changes"));
const TicketGraph = lazy(() => import("@/pages/TicketGraph"));
import { useAuthStore } from "@/lib/auth";

setAuthTokenGetter(() => {
  return localStorage.getItem("auth_token");
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
});

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { token, user, logout, updateUser } = useAuthStore();
  const [checked, setChecked] = useState(false);
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!token) {
      setLocation("/");
    }
  }, [token, setLocation]);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) {
          logout();
          return;
        }
        const user = await r.json();
        if (active) {
          updateUser(user);
          setChecked(true);
          if (user.mustChangePassword && location !== "/change-password")
            setLocation("/change-password");
        }
      })
      .catch(() => {
        if (active) {
          logout();
          setLocation("/");
        }
      });
    return () => {
      active = false;
    };
  }, [token]);
  if (
    !token ||
    !checked ||
    (user?.mustChangePassword && location !== "/change-password")
  )
    return null;
  return <>{children}</>;
}

const Integrations = lazy(() => import("@/pages/Integrations"));
function Router() {
  return (
    <Switch>
      <Route path="/" component={Login} />
      <Route path="/change-password">
        <AuthGuard>
          <ChangePassword />
        </AuthGuard>
      </Route>
      <Route path="/dashboard">
        <AuthGuard>
          <Dashboard />
        </AuthGuard>
      </Route>
      <Route path="/tickets/new">
        <AuthGuard>
          <CreateTicket />
        </AuthGuard>
      </Route>
      <Route path="/tickets/:id">
        {(params) => (
          <AuthGuard>
            <TicketDetail />
          </AuthGuard>
        )}
      </Route>
      <Route path="/tickets">
        <AuthGuard>
          <Tickets />
        </AuthGuard>
      </Route>
      <Route path="/departments">
        <AuthGuard>
          <Departments />
        </AuthGuard>
      </Route>
      <Route path="/users">
        <AuthGuard>
          <Users />
        </AuthGuard>
      </Route>
      <Route path="/integrations">
        <AuthGuard>
          <Integrations />
        </AuthGuard>
      </Route>
      <Route path="/settings">
        <AuthGuard>
          <Settings />
        </AuthGuard>
      </Route>
      <Route path="/documents">
        <AuthGuard>
          <Documents />
        </AuthGuard>
      </Route>
      <Route path="/training">
        <AuthGuard>
          <Training />
        </AuthGuard>
      </Route>
      <Route path="/automation-rules">
        <AuthGuard>
          <AutomationRules />
        </AuthGuard>
      </Route>
      <Route path="/sla-policies">
        <AuthGuard>
          <SlaPolicies />
        </AuthGuard>
      </Route>
      <Route path="/employment-verification">
        <AuthGuard>
          <EmploymentVerification />
        </AuthGuard>
      </Route>
      <Route path="/background-verification">
        <AuthGuard>
          <BackgroundVerification />
        </AuthGuard>
      </Route>
      <Route path="/team-chat">
        <AuthGuard>
          <TeamChat />
        </AuthGuard>
      </Route>
      <Route path="/incidents">
        <AuthGuard>
          <Incidents />
        </AuthGuard>
      </Route>
      <Route path="/incidents/:id">
        <AuthGuard>
          <SwarmRoom />
        </AuthGuard>
      </Route>
      <Route path="/runbooks">
        <AuthGuard>
          <Runbooks />
        </AuthGuard>
      </Route>
      <Route path="/intelligence/risks">
        <AuthGuard>
          <Risks />
        </AuthGuard>
      </Route>
      <Route path="/intelligence/root-cause">
        <AuthGuard>
          <RootCause />
        </AuthGuard>
      </Route>
      <Route path="/knowledge">
        <AuthGuard>
          <Knowledge />
        </AuthGuard>
      </Route>
      <Route path="/monitoring">
        <AuthGuard>
          <Monitoring />
        </AuthGuard>
      </Route>
      <Route path="/catalog">
        <AuthGuard>
          <ServiceCatalog />
        </AuthGuard>
      </Route>
      <Route path="/command-center">
        <AuthGuard>
          <CommandCenter />
        </AuthGuard>
      </Route>
      <Route path="/briefs">
        <AuthGuard>
          <ExecutiveBrief />
        </AuthGuard>
      </Route>
      <Route path="/operations-map">
        <AuthGuard>
          <OperationsMap />
        </AuthGuard>
      </Route>
      <Route path="/changes">
        <AuthGuard>
          <Changes />
        </AuthGuard>
      </Route>
      <Route path="/tickets/:id/graph">
        <AuthGuard>
          <TicketGraph />
        </AuthGuard>
      </Route>
      <Route path="/request" component={PublicRequest} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Suspense
            fallback={
              <div className="workspace-empty" role="status">
                Loading workspace…
              </div>
            }
          >
            <Router />
          </Suspense>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
