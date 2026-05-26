"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { LayoutDashboard, Settings2, User, LogOut, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/auth-context";

const adminNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin", label: "Admin", icon: Settings2 },
  { href: "/profile", label: "Profile", icon: User },
];

const testerNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/profile", label: "Profile", icon: User },
];

const INACTIVITY_MS = 10 * 60 * 1000; // 10 minutes
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;

interface SidebarProps {
  role: "admin" | "tester";
  userName: string;
  userEmail: string;
}

export function Sidebar({ role, userName, userEmail }: SidebarProps) {
  const pathname = usePathname();
  const { logout } = useAuth();
  const nav = role === "admin" ? adminNav : testerNav;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    <aside className="w-60 shrink-0 flex flex-col border-r border-border bg-sidebar h-screen sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-border">
        <img src="/logo.svg" alt="TestFlow" className="w-8 h-8 rounded-lg" />
        <span className="text-lg font-bold text-foreground tracking-tight">TestFlow</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              pathname === href || pathname.startsWith(href + "/")
                ? "bg-primary text-white"
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
        <div className="flex items-center gap-3 px-3 py-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
            {userName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{userName}</p>
            <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
          </div>
        </div>
        <Link
          href="/bin"
          className={cn(
            "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
            pathname === "/bin"
              ? "bg-primary text-white"
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
