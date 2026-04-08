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
import { Loader2, CheckCircle2, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

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

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = (data: LoginFormValues) => {
    loginMutation.mutate(
      { data },
      {
        onSuccess: (res) => {
          setAuth(res.token, res.user);
          toast({
            title: "Login successful",
            description: `Welcome back, ${res.user.name}`,
          });
          setLocation("/dashboard");
        },
        onError: (err) => {
          toast({
            title: "Login failed",
            description: err.message || "An error occurred",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleSSOLogin = async () => {
    setSsoLoading(true);
    try {
      const res = await fetch("/api/auth/sso/init");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast({
          title: "SSO not configured",
          description: "Single Sign-On has not been configured for this organisation. Please contact your IT administrator.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "SSO unavailable",
        description: "Could not reach the SSO service. Please use email and password to sign in.",
        variant: "destructive",
      });
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
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center mb-8 gap-1">
          <div className="flex items-center gap-3">
            <img src="/dejoiy-logo.jpg" alt="Dejoiy" className="w-12 h-12 rounded-xl object-cover shadow-md" />
            <div className="flex flex-col leading-tight">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Dejoiy</span>
              <span className="font-bold text-2xl tracking-tight text-foreground">OrbitDesk</span>
            </div>
          </div>
          <span className="text-xs text-muted-foreground mt-1">Enterprise Ticketing System</span>
        </div>

        <Card className="shadow-lg border-border">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl font-bold tracking-tight">Sign in</CardTitle>
            <CardDescription className="text-muted-foreground">
              Enter your credentials to access your workspace
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input placeholder="name@example.com" type="email" autoComplete="email" {...field} />
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
                        <FormLabel>Password</FormLabel>
                        <button
                          type="button"
                          className="text-sm font-medium text-primary hover:underline"
                          tabIndex={-1}
                          onClick={() => { setForgotOpen(true); setForgotEmail(form.getValues("email") || ""); }}
                        >
                          Forgot password?
                        </button>
                      </div>
                      <FormControl>
                        <Input placeholder="••••••••" type="password" autoComplete="current-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full mt-2"
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Sign In
                </Button>
              </form>
            </Form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={handleSSOLogin}
              disabled={ssoLoading}
            >
              {ssoLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Shield className="h-4 w-4" />
              )}
              Sign in with SSO
            </Button>
          </CardContent>
        </Card>

        <div className="mt-8 flex flex-col items-center gap-1">
          <div className="flex items-center gap-1.5">
            <img src="/dejoiy-logo.jpg" alt="Dejoiy" className="w-4 h-4 rounded object-cover" />
            <span className="text-sm font-semibold text-foreground tracking-wide">Dejoiy</span>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Dejoiy. All rights reserved.
          </p>
        </div>
      </div>

      {/* Forgot Password Dialog */}
      <Dialog open={forgotOpen} onOpenChange={(v) => { if (!v) handleForgotClose(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Forgot Password?</DialogTitle>
            <DialogDescription>
              Enter your registered email address. A password reset ticket will be automatically raised with the IT team — they will contact you to verify your identity and reset your password.
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
