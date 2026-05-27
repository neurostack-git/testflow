"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Check, X } from "lucide-react";
import { completeNewPassword, mapAuthError } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/auth-context";
import { usersApi } from "@/lib/api";

export default function OnboardingPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Please enter your name."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    try {
      await completeNewPassword(password);
      await usersApi.updateMe({ name: name.trim() });
      await refresh();
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 via-white to-white p-6">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <img src="/logo.svg" alt="TestFlow" className="w-12 h-12 rounded-2xl shadow-lg shadow-primary/20" />
          <div>
            <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Welcome to TestFlow</h1>
            <p className="text-muted-foreground mt-1.5 text-sm">Set a new password to activate your account</p>
          </div>
        </div>

        <div className="bg-white border border-border rounded-2xl shadow-sm p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-sm font-semibold text-foreground">Full Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="Your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11 text-sm"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-semibold text-foreground">New Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Min. 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 pr-10 text-sm"
                  required
                  minLength={8}
                />
                <button type="button" onClick={() => setShowPassword(v => !v)} tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm" className="text-sm font-semibold text-foreground">Confirm Password</Label>
              <div className="relative">
                <Input
                  id="confirm"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={cn(
                    "h-11 pr-10 text-sm",
                    passwordsMatch && "border-green-400 focus-visible:ring-green-300",
                    passwordsMismatch && "border-destructive focus-visible:ring-destructive/30"
                  )}
                  required
                />
                <button type="button" onClick={() => setShowConfirmPassword(v => !v)} tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmPassword.length > 0 && (
                <p className={cn("flex items-center gap-1.5 text-xs font-medium mt-1",
                  passwordsMatch ? "text-green-600" : "text-destructive")}>
                  {passwordsMatch
                    ? <><Check className="w-3.5 h-3.5" /> Passwords match</>
                    : <><X className="w-3.5 h-3.5" /> Passwords do not match</>}
                </p>
              )}
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/8 px-3 py-2.5 rounded-lg font-medium">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 font-semibold text-sm tracking-wide"
              disabled={loading || passwordsMismatch}
            >
              {loading ? "Setting up…" : "Complete Setup"}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground">Having trouble? Contact your admin.</p>
      </div>
    </div>
  );
}
