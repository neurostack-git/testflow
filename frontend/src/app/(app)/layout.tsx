"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { useAuth } from "@/context/auth-context";
import { Menu } from "lucide-react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-background tf-dot-bg">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        role={user.role}
        userName={user.name}
        userEmail={user.email}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 h-14 px-4 bg-background/95 backdrop-blur-sm border-b border-border shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-1 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <img src="/logo.svg" alt="TestFlow" className="w-7 h-7 rounded-lg" />
          <span className="font-bold text-foreground tracking-tight">TestFlow</span>
        </header>

        <main className="flex-1 overflow-auto min-w-0 tf-page-in">{children}</main>
      </div>
    </div>
  );
}
