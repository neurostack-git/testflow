"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LayoutDashboard, Settings2, User, LogOut, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/auth-context";
import { usersApi, attachmentsApi } from "@/lib/api";

const adminNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin", label: "Admin", icon: Settings2 },
  { href: "/profile", label: "Profile", icon: User },
];

const testerNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/profile", label: "Profile", icon: User },
];

const INACTIVITY_MS = 10 * 60 * 1000;
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;

interface SidebarProps {
  role: "admin" | "tester";
  userName: string;
  userEmail: string;
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ role, userName, userEmail, open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { logout } = useAuth();
  const nav = role === "admin" ? adminNav : testerNav;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    usersApi.me().then(async (profile) => {
      if (profile.avatarKey) {
        const { url } = await attachmentsApi.viewUrl(profile.avatarKey, true);
        setAvatarUrl(url);
      } else {
        setAvatarUrl(null);
      }
    }).catch(() => {});
  }, [pathname]); // refresh on navigation so profile changes show quickly

  // Close sidebar when navigating (mobile)
  useEffect(() => {
    onClose();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => logout(), INACTIVITY_MS);
    }

    resetTimer();
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [logout]);

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-border bg-sidebar h-screen w-60 shrink-0",
        "fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-in-out",
        "lg:sticky lg:top-0 lg:z-auto lg:translate-x-0",
        open ? "translate-x-0 shadow-2xl" : "-translate-x-full"
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between px-5 py-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="TestFlow" className="w-8 h-8 rounded-lg" />
          <span className="text-lg font-bold text-foreground tracking-tight">TestFlow</span>
        </div>
        <button
          onClick={onClose}
          className="lg:hidden p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          aria-label="Close menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
              pathname === href || pathname.startsWith(href + "/")
                ? "bg-gradient-to-r from-primary to-primary/80 text-white shadow-sm shadow-primary/25"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        ))}
      </nav>

      {/* User + Bin + Logout */}
      <div className="px-4 py-4 border-t border-border space-y-1">
        <Link
          href="/profile"
          className="flex items-center gap-3 px-3 py-2 mb-2 rounded-lg hover:bg-accent transition-colors"
        >
          <div className="w-8 h-8 rounded-full bg-primary/10 overflow-hidden flex items-center justify-center text-primary font-semibold text-sm shrink-0">
            {avatarUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={avatarUrl} alt={userName} className="w-full h-full object-cover" />
              : userName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{userName}</p>
            <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
          </div>
        </Link>
        <Link
          href="/bin"
          className={cn(
            "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
            pathname === "/bin"
              ? "bg-gradient-to-r from-primary to-primary/80 text-white shadow-sm shadow-primary/25"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          <Trash2 className="w-4 h-4" />
          Bin
        </Link>
        <button
          onClick={() => logout()}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
