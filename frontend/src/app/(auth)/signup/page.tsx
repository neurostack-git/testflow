"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bug, CheckCircle, Users, Zap, Eye, EyeOff, Lock, Mail, User, Check, X } from "lucide-react";
import Link from "next/link";
import { registerAdmin, confirmUserSignUp } from "@/lib/auth";
import { cn } from "@/lib/utils";

type Step = "register" | "verify" | "success";

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("register");

  // Register form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Verify form state
  const [code, setCode] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    setError("");
    setLoading(true);
    try {
      await registerAdmin(name, email, password);
      setStep("verify");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await confirmUserSignUp(email, code.trim());
      setStep("success");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed. Check your code and try again.");
    } finally {
      setLoading(false);
    }
  }

  const features = [
    { icon: Bug, title: "Report bugs instantly", desc: "Screenshots, files, descriptions — in seconds." },
    { icon: CheckCircle, title: "Track resolution status", desc: "Open → Fixed → Verified. Clear lifecycle." },
    { icon: Zap, title: "Get notified instantly", desc: "Email & WhatsApp when a bug is ready to retest." },
    { icon: Users, title: "Invite your team", desc: "Create projects and add testers with one click." },
  ];

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div
        className="hidden lg:flex lg:w-[52%] flex-col justify-between p-14 text-white"
        style={{ background: "linear-gradient(145deg, oklch(0.72 0.15 50) 0%, oklch(0.60 0.17 44) 100%)" }}
      >
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="TestFlow" className="w-9 h-9 rounded-xl ring-2 ring-white/40" />
          <span className="text-xl font-extrabold tracking-tight">TestFlow</span>
        </div>
        <div className="space-y-10">
          <div>
            <h1 className="text-[2.6rem] font-extrabold leading-[1.15] mb-4 tracking-tight">
              <span className="inline-block tf-fade-up" style={{ "--anim-delay": "0ms" } as React.CSSProperties}>
                Start managing bugs
              </span>
              <br />
              <span className="inline-block tf-fade-up" style={{ "--anim-delay": "180ms" } as React.CSSProperties}>
                the right way
              </span>
            </h1>
            <p className="text-white/75 text-lg leading-relaxed font-medium tf-fade-up" style={{ "--anim-delay": "340ms" } as React.CSSProperties}>
              Create your admin account, set up projects, and invite testers in minutes.
            </p>
          </div>
          <div className="space-y-5">
            {features.map(({ icon: Icon, title, desc }, i) => (
              <div key={title} className="flex items-start gap-4 tf-fade-up" style={{ "--anim-delay": `${460 + i * 80}ms` } as React.CSSProperties}>
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
        <div className="w-full max-w-[380px]">

          {/* Mobile logo */}
          <div className="flex items-center gap-2 lg:hidden mb-8">
            <img src="/logo.svg" alt="TestFlow" className="w-8 h-8 rounded-xl" />
            <span className="text-xl font-extrabold text-primary tracking-tight">TestFlow</span>
          </div>

          {/* ── Step 1: Register ── */}
          {step === "register" && (
            <div className="space-y-7">
              <div>
                <h2 className="text-[1.9rem] font-extrabold text-foreground tracking-tight">Create account</h2>
                <p className="text-muted-foreground mt-1.5 text-sm">You&apos;ll be set up as an Admin</p>
              </div>
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-sm font-semibold text-foreground">Full name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input id="name" type="text" placeholder="Jane Smith" value={name}
                      onChange={(e) => setName(e.target.value)} className="h-11 pl-9 text-sm" required />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-sm font-semibold text-foreground">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input id="email" type="email" placeholder="you@example.com" value={email}
                      onChange={(e) => setEmail(e.target.value)} className="h-11 pl-9 text-sm" required />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-sm font-semibold text-foreground">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input id="password" type={showPassword ? "text" : "password"} placeholder="Min. 8 characters"
                      value={password} onChange={(e) => setPassword(e.target.value)}
                      className="h-11 pl-9 pr-10 text-sm" required minLength={8} />
                    <button type="button" onClick={() => setShowPassword(v => !v)} tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm" className="text-sm font-semibold text-foreground">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input id="confirm" type={showConfirmPassword ? "text" : "password"} placeholder="Re-enter your password"
                      value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                      className={cn("h-11 pl-9 pr-10 text-sm",
                        passwordsMatch && "border-green-400 focus-visible:ring-green-300",
                        passwordsMismatch && "border-destructive focus-visible:ring-destructive/30"
                      )} required />
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
                {error && <p className="text-sm text-destructive bg-destructive/8 px-3 py-2.5 rounded-lg font-medium">{error}</p>}
                <Button type="submit" className="w-full h-11 bg-primary hover:bg-primary/90 font-semibold text-sm tracking-wide"
                  disabled={loading || passwordsMismatch}>
                  {loading ? "Creating account…" : "Create account"}
                </Button>
              </form>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="text-primary font-semibold hover:underline">Sign in</Link>
              </p>
            </div>
          )}

          {/* ── Step 2: Verify email ── */}
          {step === "verify" && (
            <div className="space-y-7">
              <div className="flex flex-col items-center text-center gap-3">
                <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center">
                  <Mail className="w-7 h-7 text-primary" />
                </div>
                <div>
                  <h2 className="text-[1.9rem] font-extrabold text-foreground tracking-tight">Check your email</h2>
                  <p className="text-muted-foreground mt-1.5 text-sm">
                    We sent a verification code to<br />
                    <span className="font-semibold text-foreground">{email}</span>
                  </p>
                </div>
              </div>
              <form onSubmit={handleVerify} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="code" className="text-sm font-semibold text-foreground">Verification code</Label>
                  <Input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    placeholder="Enter 6-digit code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="h-11 text-sm tracking-widest text-center font-semibold"
                    maxLength={6}
                    autoFocus
                    required
                  />
                </div>
                {error && <p className="text-sm text-destructive bg-destructive/8 px-3 py-2.5 rounded-lg font-medium">{error}</p>}
                <Button type="submit" className="w-full h-11 bg-primary hover:bg-primary/90 font-semibold text-sm tracking-wide"
                  disabled={loading || code.length < 6}>
                  {loading ? "Verifying…" : "Verify email"}
                </Button>
              </form>
              <p className="text-center text-sm text-muted-foreground">
                Wrong email?{" "}
                <button onClick={() => { setStep("register"); setCode(""); setError(""); }}
                  className="text-primary font-semibold hover:underline">
                  Go back
                </button>
              </p>
            </div>
          )}

          {/* ── Step 3: Success ── */}
          {step === "success" && (
            <div className="flex flex-col items-center text-center gap-6">
              <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <h2 className="text-[1.9rem] font-extrabold text-foreground tracking-tight">Account created!</h2>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  Your account has been verified successfully.<br />You can now sign in to TestFlow.
                </p>
              </div>
              <Button
                className="w-full h-11 bg-primary hover:bg-primary/90 font-semibold text-sm tracking-wide"
                onClick={() => router.push("/login")}
              >
                Go to sign in
              </Button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
