import React, { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Tickets from "@/pages/Tickets";
import CreateTicket from "@/pages/CreateTicket";
import TicketDetail from "@/pages/TicketDetail";
import Departments from "@/pages/Departments";
import Users from "@/pages/Users";
import Settings from "@/pages/Settings";
import Documents from "@/pages/Documents";
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
  const { token } = useAuthStore();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!token) {
      setLocation("/");
    }
  }, [token, setLocation]);

  if (!token) return null;
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Login} />
      <Route path="/dashboard">
        <AuthGuard><Dashboard /></AuthGuard>
      </Route>
      <Route path="/tickets/new">
        <AuthGuard><CreateTicket /></AuthGuard>
      </Route>
      <Route path="/tickets/:id">
        {(params) => <AuthGuard><TicketDetail /></AuthGuard>}
      </Route>
      <Route path="/tickets">
        <AuthGuard><Tickets /></AuthGuard>
      </Route>
      <Route path="/departments">
        <AuthGuard><Departments /></AuthGuard>
      </Route>
      <Route path="/users">
        <AuthGuard><Users /></AuthGuard>
      </Route>
      <Route path="/settings">
        <AuthGuard><Settings /></AuthGuard>
      </Route>
      <Route path="/documents">
        <AuthGuard><Documents /></AuthGuard>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
