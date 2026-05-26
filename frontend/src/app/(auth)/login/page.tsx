"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bug, CheckCircle, Users, Zap, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { loginUser } from "@/lib/auth";
import { useAuth } from "@/context/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await loginUser(email, password);
      if (result.nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
        router.push("/onboarding");
      } else {
        await refresh();
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div
        className="hidden lg:flex lg:w-[52%] flex-col justify-between p-14 text-white"
        style={{ background: "linear-gradient(145deg, oklch(0.72 0.15 50) 0%, oklch(0.60 0.17 44) 100%)" }}
      >
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="TestFlow" className="w-9 h-9 rounded-xl" />
          <span className="text-xl font-extrabold tracking-tight">TestFlow</span>
        </div>

        <div className="space-y-10">
          <div>
            <h1 className="text-[2.6rem] font-extrabold leading-[1.15] mb-4 tracking-tight">
              Streamline your<br />bug reporting workflow
            </h1>
            <p className="text-white/75 text-lg leading-relaxed font-medium">
              One place to capture, track, and resolve bugs — fast.
            </p>
          </div>
          <div className="space-y-5">
            {[
              { icon: Bug, title: "Report bugs instantly", desc: "Screenshots, files, descriptions — in seconds." },
              { icon: CheckCircle, title: "Track resolution status", desc: "Open → Fixed → Verified. Clear lifecycle." },
              { icon: Zap, title: "Get notified instantly", desc: "Email & WhatsApp when a bug is ready to retest." },
              { icon: Users, title: "Invite your team", desc: "Create projects and add testers with one click." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-4">
                <div className="w-9 h-9 bg-white/15 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-sm">{title}</p>
                  <p className="text-white/65 text-sm mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-white/40 text-sm">© 2025 TestFlow. All rights reserved.</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-[360px] space-y-8">
          <div className="flex items-center gap-2 lg:hidden">
            <img src="/logo.svg" alt="TestFlow" className="w-8 h-8 rounded-xl" />
            <span className="text-xl font-extrabold text-primary tracking-tight">TestFlow</span>
          </div>

          <div>
            <h2 className="text-[1.9rem] font-extrabold text-foreground tracking-tight">Welcome back</h2>
            <p className="text-muted-foreground mt-1.5 text-sm">Sign in to your account to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-semibold text-foreground">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 text-sm"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-semibold text-foreground">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 pr-10 text-sm"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {error && (
              <p className="text-sm text-destructive bg-destructive/8 px-3 py-2.5 rounded-lg font-medium">{error}</p>
            )}
            <Button
              type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 font-semibold text-sm tracking-wide"
              disabled={loading}
            >
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            New to TestFlow?{" "}
            <Link href="/signup" className="text-primary font-semibold hover:underline">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
