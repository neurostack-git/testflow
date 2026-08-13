"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { User, Mail, Shield, Check, Lock, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { usersApi } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { ErrorAlert } from "@/components/ui/error-alert";
import { AvatarUpload } from "@/components/profile/AvatarUpload";
import { PasswordInput } from "@/components/ui/password-input";
import { changePassword, mapAuthError } from "@/lib/auth";
import { ROLE_LABELS, ROLE_STYLES } from "@/lib/permissions";

export default function ProfilePage() {
  const { user, role, orgName, refresh, avatarUrl, setAvatarUrl } = useAuth();

  const [name, setName] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");

  // Password change (LLD §7.4) — Amplify only, no backend call.
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNew, setConfirmNew] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSaved, setPwSaved] = useState(false);
  const [pwError, setPwError] = useState("");

  const pwMismatch = confirmNew.length > 0 && newPassword !== confirmNew;

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmNew) { setPwError("New passwords do not match."); return; }
    setPwError("");
    setPwSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNew("");
      setPwSaved(true);
      setTimeout(() => setPwSaved(false), 2500);
    } catch (err) {
      setPwError(mapAuthError(err));
    } finally {
      setPwSaving(false);
    }
  }

  useEffect(() => {
    if (user) setName(user.name);
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

  if (!user) return null;

  return (
    <div className="p-4 sm:p-8">
      <div className="w-full">

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Profile</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage your account details</p>
        </div>

        {/* Avatar + identity card */}
        <Card className="mb-5 overflow-hidden">
          {/* Header banner */}
          {/* Brand banner. Dark mode keeps the brand gradient but drops to the
              deeper end of the ramp so a 128px band doesn't glare. */}
          <div className="relative h-32 overflow-hidden bg-gradient-to-br from-primary via-primary/95 to-chart-3 dark:from-primary/90 dark:via-chart-3 dark:to-chart-5">
            <div className="absolute -top-8 -right-8 w-44 h-44 rounded-full bg-white/10" />
            <div className="absolute -bottom-12 right-28 w-32 h-32 rounded-full bg-white/[0.07]" />
            <div className="absolute top-4 right-52 w-14 h-14 rounded-full bg-white/10" />
            <div className="absolute -top-4 left-[38%] w-24 h-24 rounded-full bg-black/[0.04]" />
          </div>

          {/* Identity row */}
          <div className="px-6 pb-5 -mt-10 relative z-10">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <div className="flex items-end gap-4">
                <AvatarUpload
                  avatarUrl={avatarUrl}
                  name={user.name}
                  onAvatarChange={(url) => setAvatarUrl(url)}
                />
                <div className="pb-1 min-w-0">
                  <h2 className="text-xl font-extrabold text-foreground tracking-tight leading-tight truncate">{user.name}</h2>
                  <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                </div>
              </div>
              <div className="sm:pb-1">
                <span className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold",
                  ROLE_STYLES[role]
                )}>
                  <Shield className="w-3 h-3" />
                  {ROLE_LABELS[role]}
                </span>
              </div>
            </div>
          </div>

          {orgName && (
            <div className="px-6 py-3 border-t border-border/50 flex justify-end">
              <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" />
                Workspace: <span className="font-medium text-foreground">{orgName}</span>
              </p>
            </div>
          )}
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
            <ErrorAlert message={nameError} className="bg-transparent p-0" />
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={nameSaving}
                className={cn(
                  "gap-2 h-10 font-semibold text-sm transition-all",
                  // Text colour is pinned here: Button's default is
                  // text-primary-foreground, which is dark in dark mode and
                  // would otherwise land dark-on-green.
                  nameSaved
                    ? "bg-green-600 hover:bg-green-600 text-white dark:bg-green-500 dark:hover:bg-green-500 dark:text-green-950"
                    : "bg-primary hover:bg-primary/90"
                )}
              >
                {nameSaved ? <><Check className="w-4 h-4" />Saved</> : nameSaving ? "Saving…" : "Save Name"}
              </Button>
            </div>
          </form>
        </Card>

        {/* Security — password change goes straight to Cognito (LLD §7.4). */}
        <Card className="p-6 mb-4">
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Lock className="w-4 h-4 text-muted-foreground" />
                Password
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Choose a new password. You&apos;ll stay signed in on this device.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="current-password" className="text-sm font-semibold text-foreground">
                Current password
              </Label>
              <PasswordInput
                id="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="text-sm font-semibold text-foreground">
                  New password
                </Label>
                <PasswordInput
                  id="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-new" className="text-sm font-semibold text-foreground">
                  Confirm new password
                </Label>
                <PasswordInput
                  id="confirm-new"
                  value={confirmNew}
                  onChange={(e) => setConfirmNew(e.target.value)}
                  placeholder="Re-enter new password"
                  autoComplete="new-password"
                  className={cn(pwMismatch && "border-destructive focus-visible:ring-destructive/30")}
                  required
                />
              </div>
            </div>

            {pwMismatch && (
              <p className="text-xs font-medium text-destructive">New passwords do not match.</p>
            )}
            <ErrorAlert message={pwError} className="bg-transparent p-0" />

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={pwSaving || pwMismatch || !currentPassword || !newPassword}
                className={cn(
                  "gap-2 h-10 font-semibold text-sm transition-all",
                  pwSaved
                    ? "bg-green-600 hover:bg-green-600 text-white dark:bg-green-500 dark:hover:bg-green-500 dark:text-green-950"
                    : "bg-primary hover:bg-primary/90"
                )}
              >
                {pwSaved
                  ? <><Check className="w-4 h-4" />Password changed</>
                  : pwSaving ? "Changing…" : "Change password"}
              </Button>
            </div>
          </form>
        </Card>

      </div>
    </div>
  );
}
