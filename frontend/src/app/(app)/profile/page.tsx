"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { User, Mail, Phone, Shield, Check, ArrowRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { usersApi } from "@/lib/api";
import { useAuth } from "@/context/auth-context";

type PhoneStep = "idle" | "enter" | "otp" | "verified";

export default function ProfilePage() {
  const { user, refresh } = useAuth();

  // Name
  const [name, setName] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");

  // Phone OTP flow
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("idle");
  const [phoneInput, setPhoneInput] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneError, setPhoneError] = useState("");

  useEffect(() => {
    if (user) {
      setName(user.name);
      setPhoneInput(user.phone ?? "");
    }
  }, [user]);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setNameError("");
    setNameSaving(true);
    try {
      await usersApi.updateMe({ name });
      await refresh();
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2500);
    } catch (err: unknown) {
      setNameError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setNameSaving(false);
    }
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setPhoneError("");
    setPhoneLoading(true);
    try {
      await usersApi.sendPhoneOtp(phoneInput);
      setPhoneStep("otp");
    } catch (err: unknown) {
      setPhoneError(err instanceof Error ? err.message : "Failed to send code");
    } finally {
      setPhoneLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setPhoneError("");
    setPhoneLoading(true);
    try {
      await usersApi.verifyPhoneOtp(otpInput);
      await refresh();
      setPhoneStep("verified");
      setOtpInput("");
      setTimeout(() => setPhoneStep("idle"), 3000);
    } catch (err: unknown) {
      setPhoneError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setPhoneLoading(false);
    }
  }

  if (!user) return null;

  return (
    <div className="p-8">
      <div className="w-full">

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Profile</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage your account details</p>
        </div>

        {/* Avatar + identity card */}
        <Card className="p-5 mb-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center text-primary text-xl font-extrabold shrink-0">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-bold text-foreground text-base leading-tight">{user.name}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{user.email}</p>
            <div className="flex items-center gap-1.5 mt-1.5">
              <Shield className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs text-primary font-semibold capitalize">{user.role}</span>
            </div>
          </div>
        </Card>

        {/* Name section */}
        <Card className="p-6 mb-4">
          <form onSubmit={handleSaveName} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <User className="w-4 h-4 text-muted-foreground" />
                Full Name
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                className="h-11 text-sm"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Mail className="w-4 h-4 text-muted-foreground" />
                Email
              </Label>
              <Input
                value={user.email}
                readOnly
                className="h-11 text-sm bg-muted/40 text-muted-foreground cursor-not-allowed"
              />
              <p className="text-xs text-muted-foreground">Email cannot be changed.</p>
            </div>
            {nameError && <p className="text-sm text-destructive">{nameError}</p>}
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={nameSaving}
                className={cn(
                  "gap-2 h-10 font-semibold text-sm transition-all",
                  nameSaved ? "bg-green-600 hover:bg-green-600" : "bg-primary hover:bg-primary/90"
                )}
              >
                {nameSaved ? <><Check className="w-4 h-4" />Saved</> : nameSaving ? "Saving…" : "Save Name"}
              </Button>
            </div>
          </form>
        </Card>

        {/* WhatsApp / Phone section — disabled (SNS in sandbox) */}
        <Card className="p-6 relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">WhatsApp Number</span>
            </div>
            <span className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
              Coming Soon
            </span>
          </div>

          <div className="relative select-none pointer-events-none">
            <div className="blur-sm opacity-50">
          {/* idle — show current number + change button */}
          {(phoneStep === "idle" || phoneStep === "verified") && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Input
                  value={user.phone || ""}
                  readOnly
                  placeholder="Not set"
                  className="h-11 text-sm bg-muted/40 text-muted-foreground cursor-not-allowed flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 gap-1.5 font-semibold text-sm shrink-0"
                  onClick={() => { setPhoneStep("enter"); setPhoneError(""); }}
                >
                  {user.phone ? "Change" : "Add Number"}
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
              {phoneStep === "verified" && (
                <p className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
                  <Check className="w-4 h-4" /> Phone number verified and saved!
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Used for WhatsApp notifications when a bug is marked as Fixed.
              </p>
            </div>
          )}

          {/* enter phone */}
          {phoneStep === "enter" && (
            <form onSubmit={handleSendOtp} className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Enter your WhatsApp number. We&apos;ll send a verification code via SMS.
              </p>
              <Input
                type="tel"
                placeholder="+91 98765 43210"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                className="h-11 text-sm"
                autoFocus
                required
              />
              {phoneError && <p className="text-sm text-destructive font-medium">{phoneError}</p>}
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="h-10 text-sm"
                  onClick={() => { setPhoneStep("idle"); setPhoneError(""); }}>
                  Cancel
                </Button>
                <Button type="submit" className="h-10 bg-primary hover:bg-primary/90 font-semibold text-sm gap-2"
                  disabled={phoneLoading || !phoneInput.trim()}>
                  {phoneLoading ? "Sending…" : "Send Code"}
                </Button>
              </div>
            </form>
          )}

          {/* enter OTP */}
          {phoneStep === "otp" && (
            <form onSubmit={handleVerifyOtp} className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Enter the 6-digit code sent to <span className="font-semibold text-foreground">{phoneInput}</span>.
              </p>
              <Input
                type="text"
                inputMode="numeric"
                placeholder="000000"
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="h-11 text-sm tracking-widest text-center font-semibold"
                maxLength={6}
                autoFocus
                required
              />
              {phoneError && <p className="text-sm text-destructive font-medium">{phoneError}</p>}
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="h-10 text-sm gap-1.5"
                  onClick={() => { setPhoneStep("enter"); setOtpInput(""); setPhoneError(""); }}>
                  <RefreshCw className="w-3.5 h-3.5" /> Resend
                </Button>
                <Button type="submit"
                  className="h-10 bg-primary hover:bg-primary/90 font-semibold text-sm"
                  disabled={phoneLoading || otpInput.length < 6}>
                  {phoneLoading ? "Verifying…" : "Verify & Save"}
                </Button>
              </div>
            </form>
          )}
            </div>{/* end blur wrapper */}
          </div>{/* end pointer-events-none */}

          {/* Overlay message */}
          <div className="absolute inset-0 flex items-center justify-center rounded-xl">
            <div className="text-center px-6">
              <p className="text-sm font-semibold text-foreground">This feature is still in development</p>
              <p className="text-xs text-muted-foreground mt-1">WhatsApp notifications will be available soon.</p>
            </div>
          </div>
        </Card>

      </div>
    </div>
  );
}
