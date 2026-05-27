"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { User, Mail, Shield, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { usersApi } from "@/lib/api";
import { useAuth } from "@/context/auth-context";

export default function ProfilePage() {
  const { user, refresh } = useAuth();

  const [name, setName] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");

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
          <div className="h-20 bg-gradient-to-br from-primary/20 via-primary/10 to-transparent" />
          <div className="px-6 pb-6 -mt-8">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div className="flex items-end gap-4">
                <div className="w-16 h-16 rounded-2xl bg-primary/15 border-4 border-background flex items-center justify-center text-primary text-2xl font-extrabold shrink-0 shadow-sm">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="pb-1 min-w-0">
                  <h2 className="text-lg font-extrabold text-foreground tracking-tight leading-tight truncate">{user.name}</h2>
                  <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                </div>
              </div>
              <div className="sm:pb-1">
                <span className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border",
                  user.role === "admin"
                    ? "bg-primary/10 text-primary border-primary/20"
                    : "bg-blue-50 text-blue-700 border-blue-200"
                )}>
                  <Shield className="w-3 h-3" />
                  <span className="capitalize">{user.role}</span>
                </span>
              </div>
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

      </div>
    </div>
  );
}
