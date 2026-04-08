import React, { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLogin } from "@workspace/api-client-react";
import { useAuthStore } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, Shield, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function GeometricPanel({ id, flip = false }: { id: string; flip?: boolean }) {
  const patternId = `bauhaus-${id}`;
  return (
    <svg
      aria-hidden="true"
      className="w-full h-full"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
      style={flip ? { transform: "scaleX(-1)" } : {}}
    >
      <defs>
        <pattern id={patternId} x="0" y="0" width="160" height="160" patternUnits="userSpaceOnUse">
          <rect x="0"   y="0"   width="80" height="80" fill="#2563EB" />
          <circle cx="40"  cy="40"  r="40" fill="#F59E0B" />
          <rect x="80"  y="0"   width="80" height="80" fill="#EC4899" />
          <circle cx="120" cy="40"  r="28" fill="#1E3A5F" />
          <rect x="0"   y="80"  width="80" height="80" fill="#1E3A5F" />
          <path d="M0,80 Q40,80 40,120 Q40,160 0,160 Z" fill="#06B6D4" />
          <rect x="80"  y="80"  width="80" height="80" fill="#EF4444" />
          <circle cx="120" cy="120" r="40" fill="#06B6D4" />
        </pattern>
        <pattern id={`${patternId}-b`} x="0" y="0" width="160" height="160" patternUnits="userSpaceOnUse">
          <rect x="0"   y="0"   width="80" height="80" fill="#06B6D4" />
          <polygon points="0,0 80,0 0,80" fill="#EF4444" />
          <rect x="80"  y="0"   width="80" height="80" fill="#F59E0B" />
          <circle cx="120" cy="40"  r="40" fill="#2563EB" />
          <rect x="0"   y="80"  width="80" height="80" fill="#EC4899" />
          <circle cx="40"  cy="120" r="32" fill="#F59E0B" />
          <rect x="80"  y="80"  width="80" height="80" fill="#1E3A5F" />
          <path d="M80,80 Q120,80 120,120 Q120,160 80,160 Z" fill="#EC4899" />
        </pattern>
      </defs>
      <rect width="100%" height="50%" fill={`url(#${patternId})`} />
      <rect y="50%" width="100%" height="50%" fill={`url(#${patternId}-b)`} />
    </svg>
  );
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { setAuth } = useAuthStore();
  const { toast } = useToast();
  const loginMutation = useLogin();

  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [accessRevoked, setAccessRevoked] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = (data: LoginFormValues) => {
    setAccessRevoked(false);
    loginMutation.mutate({ data }, {
      onSuccess: (res) => {
        setAuth(res.token, res.user);
        toast({ title: "Login successful", description: `Welcome back, ${res.user.name}` });
        setLocation("/dashboard");
      },
      onError: (err: any) => {
        const msg: string = err?.message || "";
        if (msg.toLowerCase().includes("not authorised") || msg.toLowerCase().includes("access") && msg.toLowerCase().includes("revoked") || err?.error === "AccessRevoked") {
          setAccessRevoked(true);
        } else {
          toast({ title: "Login failed", description: msg || "An error occurred", variant: "destructive" });
        }
      },
    });
  };

  const handleSSOLogin = async () => {
    setSsoLoading(true);
    try {
      const res = await fetch("/api/auth/sso/init");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast({ title: "SSO not configured", description: "Single Sign-On has not been configured. Please contact your IT administrator.", variant: "destructive" });
      }
    } catch {
      toast({ title: "SSO unavailable", description: "Could not reach the SSO service. Please use email and password.", variant: "destructive" });
    } finally {
      setSsoLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!forgotEmail.trim()) {
      toast({ title: "Enter your email", description: "Please enter your registered email address.", variant: "destructive" });
      return;
    }
    setForgotLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail.trim().toLowerCase() }),
      });
      if (!res.ok) throw new Error("Request failed");
      setForgotSent(true);
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setForgotLoading(false);
    }
  };

  const handleForgotClose = () => {
    setForgotOpen(false);
    setForgotEmail("");
    setForgotSent(false);
  };

  return (
    <div className="min-h-screen flex relative overflow-hidden bg-white">
      {/* Left geometric panel — hidden on small phones */}
      <div className="hidden sm:block flex-shrink-0 w-48 md:w-64 lg:w-80 xl:w-96 relative">
        <GeometricPanel id="left" />
      </div>

      {/* Center — clean white */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-10 min-w-0 bg-white">
        <div className="w-full max-w-[420px]">
          <div className="flex flex-col items-center mb-8 gap-2">
            <div className="flex items-center gap-3 mb-1">
              <div className="relative">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-lg shadow-blue-200">
                  <img src="/dejoiy-logo.jpg" alt="Dejoiy" className="w-10 h-10 rounded-xl object-cover" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-orange-500 rounded-full flex items-center justify-center">
                  <span className="text-[9px] font-black text-white">D</span>
                </div>
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-xs font-bold text-blue-600 uppercase tracking-[0.2em]">Dejoiy</span>
                <span className="font-black text-2xl tracking-tight text-gray-900">OrbitDesk</span>
              </div>
            </div>
            <span className="text-sm text-gray-500 font-medium">Enterprise Ticketing System</span>
          </div>

          <Card className="shadow-xl border border-gray-100 bg-white">
            <CardHeader className="space-y-1 text-center pb-4">
              <CardTitle className="text-2xl font-bold tracking-tight text-gray-900">Welcome back</CardTitle>
              <CardDescription className="text-gray-500">Sign in to access your workspace</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {accessRevoked && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5 text-red-500" />
                  <div className="flex-1">
                    <p className="font-semibold text-sm">Access Revoked</p>
                    <p className="text-sm mt-0.5 leading-relaxed">You are not authorised to utilise this tool. Please contact your supervisor or administration.</p>
                  </div>
                </div>
              )}
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-700 font-medium">Email address</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="name@company.com"
                            type="email"
                            autoComplete="email"
                            className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500/20"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel className="text-gray-700 font-medium">Password</FormLabel>
                          <button
                            type="button"
                            className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                            tabIndex={-1}
                            onClick={() => { setForgotOpen(true); setForgotEmail(form.getValues("email") || ""); }}
                          >
                            Forgot password?
                          </button>
                        </div>
                        <FormControl>
                          <Input
                            placeholder="••••••••"
                            type="password"
                            autoComplete="current-password"
                            className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500/20"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    className="w-full h-11 mt-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold shadow-md shadow-blue-200 transition-all"
                    disabled={loginMutation.isPending}
                  >
                    {loginMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Sign In
                  </Button>
                </form>
              </Form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-gray-400 font-medium">or continue with</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full h-11 gap-2 border-gray-200 hover:bg-gray-50 text-gray-700 font-medium"
                onClick={handleSSOLogin}
                disabled={ssoLoading}
              >
                {ssoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4 text-blue-600" />}
                Sign in with SSO
              </Button>
            </CardContent>
          </Card>

          <div className="mt-6 flex flex-col items-center gap-1">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 bg-gradient-to-br from-blue-600 to-blue-800 rounded-md flex items-center justify-center">
                <span className="text-[10px] font-black text-white">D</span>
              </div>
              <span className="text-sm font-bold text-gray-700 tracking-wide">Dejoiy</span>
            </div>
            <p className="text-center text-xs text-gray-400">
              &copy; {new Date().getFullYear()} Dejoiy. All rights reserved.
            </p>
          </div>
        </div>
      </div>

      {/* Right geometric panel — hidden on small phones */}
      <div className="hidden sm:block flex-shrink-0 w-48 md:w-64 lg:w-80 xl:w-96 relative">
        <GeometricPanel id="right" flip />
      </div>

      <Dialog open={forgotOpen} onOpenChange={(v) => { if (!v) handleForgotClose(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Forgot Password?</DialogTitle>
            <DialogDescription>
              Enter your registered email. A password reset ticket will be raised with IT — they will contact you to verify identity and reset your password.
            </DialogDescription>
          </DialogHeader>
          {forgotSent ? (
            <div className="py-6 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="font-semibold text-foreground">Request Submitted!</p>
              <p className="text-sm text-muted-foreground">
                If an account with this email exists, a password reset ticket has been raised with IT. They will contact you shortly.
              </p>
            </div>
          ) : (
            <div className="py-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email">Your Email Address</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="name@company.com"
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleForgotPassword(); }}}
                  autoFocus
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The IT team (and admins) will handle your password reset request via the ticketing system.
              </p>
            </div>
          )}
          <DialogFooter>
            {forgotSent ? (
              <Button onClick={handleForgotClose} className="w-full">Close</Button>
            ) : (
              <>
                <Button variant="outline" onClick={handleForgotClose} disabled={forgotLoading}>Cancel</Button>
                <Button onClick={handleForgotPassword} disabled={forgotLoading}>
                  {forgotLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Submit Request
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
