"use client";

import "@/lib/amplify";
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getAuthUser, logoutUser, takePendingOrgName, type AuthUser } from "@/lib/auth";
import { usersApi, attachmentsApi, orgApi, ApiError } from "@/lib/api";
import type { Role } from "@/lib/permissions";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** Authoritative role from the DynamoDB profile — NOT the JWT claim. */
  role: Role;
  orgId: string | null;
  orgName: string | null;
  /** True when the account exists but has no workspace yet (LLD §7.1). */
  needsOrg: boolean;
  /** Resolved (presigned) avatar URL, fetched once per session. */
  avatarUrl: string | null;
  refresh: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Create the workspace for a newly signed-up Owner. */
  createOrg: (name: string) => Promise<void>;
  setAvatarUrl: (url: string | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("tester");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [needsOrg, setNeedsOrg] = useState(false);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      setUser(await getAuthUser());
    } catch {
      setUser(null);
    }
  }, []);

  /** The single source of truth for role, org and avatar.
   *
   *  A freshly confirmed Owner has a Cognito account but no profile row yet,
   *  which the API reports as `org_not_provisioned`. If the signup form stashed
   *  a workspace name we create it transparently; otherwise `needsOrg` sends
   *  them to /onboarding to supply one.
   */
  const refreshProfile = useCallback(async () => {
    try {
      const profile = await usersApi.me();
      setRole(profile.role);
      setOrgId(profile.orgId ?? null);
      setOrgName(profile.orgName ?? null);
      setNeedsOrg(false);

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
    } catch (err) {
      if (err instanceof ApiError && err.code === "org_not_provisioned") {
        const pending = takePendingOrgName();
        if (pending) {
          try {
            await orgApi.create(pending);
            await refreshProfile();
            return;
          } catch {
            /* fall through to the onboarding prompt */
          }
        }
        setNeedsOrg(true);
        return;
      }
      /* keep existing values on any other failure */
    }
  }, []);

  const createOrg = useCallback(async (name: string) => {
    await orgApi.create(name, user?.name);
    setNeedsOrg(false);
    await refreshProfile();
  }, [user?.name, refreshProfile]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Load the profile once the user is identified; clear it on sign-out.
  useEffect(() => {
    if (user) {
      refreshProfile();
    } else {
      setAvatarUrl(null);
      setOrgId(null);
      setOrgName(null);
      setNeedsOrg(false);
      setRole("tester");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.sub]);

  const logout = useCallback(async () => {
    await logoutUser();
    setUser(null);
    setAvatarUrl(null);
    setOrgId(null);
    setOrgName(null);
    setNeedsOrg(false);
    setRole("tester");
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider
      value={{
        user, loading, role, orgId, orgName, needsOrg, avatarUrl,
        refresh, refreshProfile, createOrg, setAvatarUrl, logout,
      }}
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
