"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle, KeyRound, Lock, Mail, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { ErrorAlert } from "@/components/ui/error-alert";
import { AnimatedBugLogo } from "@/components/ui/animated-bug-logo";
import { cn } from "@/lib/utils";
import { requestPasswordReset, confirmPasswordReset, mapAuthError } from "@/lib/auth";

type Step = "request" | "confirm" | "done";

/**
 * Self-serve password reset (LLD §7.4).
 *
 * Pure Cognito — no backend endpoint. Before this existed a locked-out user had
 * no recovery path at all and had to be deleted and re-invited.
 */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("request");

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await requestPasswordReset(email.trim().toLowerCase());
      setStep("confirm");
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await confirmPasswordReset(email.trim().toLowerCase(), code.trim(), password);
      setStep("done");
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-white">
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-2 mb-8">
          <AnimatedBugLogo />
          <span className="text-xl font-extrabold text-primary tracking-tight">TestFlow</span>
        </div>

        {step === "request" && (
          <div className="space-y-7">
            <div>
              <h2 className="text-[1.9rem] font-extrabold text-foreground tracking-tight">
                Reset password
              </h2>
              <p className="text-muted-foreground mt-1.5 text-sm">
                We&apos;ll email you a code to set a new one.
              </p>
            </div>
            <form onSubmit={handleRequest} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm font-semibold text-foreground">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input id="email" type="email" placeholder="you@example.com" value={email}
                    onChange={(e) => setEmail(e.target.value)} className="h-11 pl-9 text-sm"
                    autoFocus required />
                </div>
              </div>
              <ErrorAlert message={error} className="bg-destructive/8 py-2.5 font-medium" />
              <Button type="submit" className="w-full h-11 font-semibold text-sm tracking-wide"
                disabled={loading || !email.trim()}>
                {loading ? "Sending…" : "Send reset code"}
              </Button>
            </form>
            <Link href="/login"
              className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to sign in
            </Link>
          </div>
        )}

        {step === "confirm" && (
          <div className="space-y-7">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center">
                <KeyRound className="w-7 h-7 text-primary" />
              </div>
              <div>
                <h2 className="text-[1.9rem] font-extrabold text-foreground tracking-tight">
                  Check your email
                </h2>
                <p className="text-muted-foreground mt-1.5 text-sm">
                  We sent a reset code to<br />
                  <span className="font-semibold text-foreground">{email}</span>
                </p>
              </div>
            </div>
            <form onSubmit={handleConfirm} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="code" className="text-sm font-semibold text-foreground">Reset code</Label>
                <Input id="code" type="text" inputMode="numeric" placeholder="Enter 6-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="h-11 text-sm tracking-widest text-center font-semibold"
                  maxLength={6} autoFocus required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="text-sm font-semibold text-foreground">New password</Label>
                <PasswordInput id="new-password" placeholder="Min. 8 characters" leadingIcon={Lock}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  required minLength={8} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm" className="text-sm font-semibold text-foreground">Confirm password</Label>
                <PasswordInput id="confirm" placeholder="Re-enter your password" leadingIcon={Lock}
                  value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  className={cn(
                    passwordsMatch && "border-green-400 focus-visible:ring-green-300",
                    passwordsMismatch && "border-destructive focus-visible:ring-destructive/30"
                  )} required />
                {confirmPassword.length > 0 && (
                  <p className={cn("flex items-center gap-1.5 text-xs font-medium mt-1",
                    passwordsMatch ? "text-green-600" : "text-destructive")}>
                    {passwordsMatch
                      ? <><Check className="w-3.5 h-3.5" /> Passwords match</>
                      : <><X className="w-3.5 h-3.5" /> Passwords do not match</>}
                  </p>
                )}
              </div>
              <ErrorAlert message={error} className="bg-destructive/8 py-2.5 font-medium" />
              <Button type="submit" className="w-full h-11 font-semibold text-sm tracking-wide"
                disabled={loading || code.length < 6 || passwordsMismatch || !password}>
                {loading ? "Resetting…" : "Reset password"}
              </Button>
            </form>
            <p className="text-center text-sm text-muted-foreground">
              Wrong email?{" "}
              <button onClick={() => { setStep("request"); setCode(""); setError(""); }}
                className="text-primary font-semibold hover:underline">
                Go back
              </button>
            </p>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center text-center gap-6">
            <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <div>
              <h2 className="text-[1.9rem] font-extrabold text-foreground tracking-tight">
                Password reset
              </h2>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                You can now sign in with your new password.
              </p>
            </div>
            <Button className="w-full h-11 font-semibold text-sm tracking-wide"
              onClick={() => router.push("/login")}>
              Go to sign in
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
