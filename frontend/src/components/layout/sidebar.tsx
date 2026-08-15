"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { LayoutDashboard, Users, User, LogOut, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/auth-context";
import { LAST_ACTIVITY_KEY } from "@/lib/auth";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { canViewTeam, type Role } from "@/lib/permissions";

// The Team page is Developer/Owner only (D12). Everything else is org-wide,
// including the Bin, which Testers see read-only (A3).
const navFor = (role: Role) => [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  ...(canViewTeam(role) ? [{ href: "/team", label: "Team", icon: Users }] : []),
  { href: "/profile", label: "Profile", icon: User },
];

const INACTIVITY_MS = 48 * 60 * 60 * 1000; // 48 hours
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;

// Last interaction is persisted so the window survives reloads and closed tabs.
// A bare setTimeout is scoped to one page instance, so at 48h it would in
// practice never fire — nobody keeps a tab open that long without refreshing,
// and every reload would silently restart the countdown from zero.
// mousemove fires continuously; only persist at most once per interval.
const PERSIST_THROTTLE_MS = 30 * 1000;

function readLastActivity(): number {
  try {
    const raw = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
}

function writeLastActivity(at: number): void {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(at));
  } catch {
    /* private mode — fall back to in-memory only */
  }
}

interface SidebarProps {
  role: Role;
  userName: string;
  userEmail: string;
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ role, userName, userEmail, open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { logout, avatarUrl, orgName } = useAuth();
  const nav = navFor(role);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close sidebar when navigating (mobile)
  useEffect(() => {
    onClose();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Idle sign-out. The deadline is anchored to a persisted timestamp rather
  // than to when this component mounted, so closing the tab and returning two
  // days later still signs you out.
  useEffect(() => {
    const lastPersistRef = { current: 0 };

    function schedule(from: number) {
      if (timerRef.current) clearTimeout(timerRef.current);
      const remaining = from + INACTIVITY_MS - Date.now();
      if (remaining <= 0) {
        logout();
        return;
      }
      timerRef.current = setTimeout(() => logout(), remaining);
    }

    function onActivity() {
      const now = Date.now();
      // Throttle the write, not the timer — the deadline must always be fresh.
      if (now - lastPersistRef.current >= PERSIST_THROTTLE_MS) {
        lastPersistRef.current = now;
        writeLastActivity(now);
      }
      schedule(now);
    }

    // Resume against the stored deadline; a first-ever load starts a new window.
    const stored = readLastActivity();
    if (!stored) writeLastActivity(Date.now());
    schedule(stored || Date.now());

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    // Another tab may have refreshed the deadline, or signed out entirely.
    window.addEventListener("focus", onActivity);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      window.removeEventListener("focus", onActivity);
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="TestFlow" className="w-8 h-8 rounded-lg block dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mono.svg" alt="TestFlow" className="w-8 h-8 rounded-lg hidden dark:block" />
          <div className="min-w-0">
            <div className="text-lg font-bold text-foreground tracking-tight leading-tight">TestFlow</div>
            {orgName && (
              <div className="text-xs text-muted-foreground truncate max-w-[9rem]">{orgName}</div>
            )}
          </div>
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
                ? "bg-gradient-to-r from-primary to-primary/80 text-primary-foreground shadow-sm shadow-primary/25"
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
        <ThemeToggle />
        <Link
          href="/bin"
          className={cn(
            "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
            pathname === "/bin"
              ? "bg-gradient-to-r from-primary to-primary/80 text-primary-foreground shadow-sm shadow-primary/25"
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
