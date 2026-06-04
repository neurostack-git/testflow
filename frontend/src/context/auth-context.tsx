"use client";

import "@/lib/amplify";
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getAuthUser, logoutUser, type AuthUser } from "@/lib/auth";
import { usersApi, attachmentsApi } from "@/lib/api";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** Resolved (presigned) avatar URL, fetched once per session. */
  avatarUrl: string | null;
  /** Developer/admin name for testers, from the DynamoDB profile. */
  adminName: string | null;
  refresh: () => Promise<void>;
  /** Re-fetch the DynamoDB profile (avatar + adminName). */
  refreshProfile: () => Promise<void>;
  /** Update the avatar URL locally so every consumer reacts instantly (no refetch). */
  setAvatarUrl: (url: string | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [adminName, setAdminName] = useState<string | null>(null);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const u = await getAuthUser();
      setUser(u);
    } catch {
      setUser(null);
    }
  }, []);

  // Single source of truth for the DynamoDB profile (avatar + adminName).
  // Fetched once when the user becomes known — not on every navigation.
  const refreshProfile = useCallback(async () => {
    try {
      const profile = await usersApi.me();
      setAdminName(profile.adminName ?? null);
      if (profile.avatarKey) {
        try {
          const { url } = await attachmentsApi.viewUrl(profile.avatarKey, true);
          setAvatarUrl(url);
        } catch {
          setAvatarUrl(null);
        }
      } else {
        setAvatarUrl(null);
      }
    } catch {
      /* keep existing values on failure */
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Load the profile once the user is identified; clear it on sign-out.
  useEffect(() => {
    if (user) {
      refreshProfile();
    } else {
      setAvatarUrl(null);
      setAdminName(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.sub]);

  const logout = useCallback(async () => {
    await logoutUser();
    setUser(null);
    setAvatarUrl(null);
    setAdminName(null);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider
      value={{ user, loading, avatarUrl, adminName, refresh, refreshProfile, setAvatarUrl, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
