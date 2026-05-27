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

      </div>
    </div>
  );
}
