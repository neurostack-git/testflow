"use client";

import React, { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Bell, MessageCircle, AtSign, CheckCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/hooks/useNotifications";
import { type AppNotification } from "@/lib/api";

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function NotifItem({ notif, onRead, onClose }: { notif: AppNotification; onRead: (id: string) => void; onClose: () => void }) {
  const router = useRouter();
  const Icon = notif.type === "mention" ? AtSign : MessageCircle;

  function handleClick() {
    if (!notif.read) onRead(notif.notifId);
    onClose();
    router.push(`/projects/${notif.projectId}?chat=1`);
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        "w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
        !notif.read && "bg-primary/5"
      )}
    >
      <div className={cn(
        "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
        notif.type === "mention" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      )}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground leading-snug">
          {notif.type === "mention" ? (
            <><span className="text-primary">{notif.fromName}</span> mentioned you in <span className="font-semibold">{notif.projectTitle}</span></>
          ) : (
            <>New message from <span className="text-primary">{notif.fromName}</span> in <span className="font-semibold">{notif.projectTitle}</span></>
          )}
        </p>
        {notif.content && (
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 leading-snug">{notif.content}</p>
        )}
        <p className="text-[10px] text-muted-foreground/60 mt-1">{timeAgo(notif.createdAt)}</p>
      </div>
      {!notif.read && <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
    </button>
  );
}

export function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const bellRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  function handleBellClick() {
    if (!open && bellRef.current) {
      const rect = bellRef.current.getBoundingClientRect();
      // Dropdown opens below the bell, right-aligned to the bell button
      setDropdownStyle({
        position: "fixed",
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
        zIndex: 9999,
      });
    }
    setOpen((o) => !o);
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        bellRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <>
      <button
        ref={bellRef}
        onClick={handleBellClick}
        className={cn(
          "relative p-2 rounded-xl transition-colors",
          open
            ? "bg-primary/10 text-primary"
            : unreadCount > 0
              ? "text-primary hover:bg-primary/10"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )}
        title="Notifications"
      >
        <Bell className={cn("w-5 h-5", unreadCount > 0 && !open && "bell-ring")} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center leading-none shadow-sm">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          style={dropdownStyle}
          className="w-80 bg-background border border-border rounded-xl shadow-2xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {notifications.length > 0 && (
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <CheckCheck className="w-3 h-3" />
                    Mark all read
                  </button>
                )}
                <button
                  onClick={clearAll}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                  title="Clear all notifications"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear
                </button>
              </div>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-border">
            {notifications.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <NotifItem
                  key={n.notifId}
                  notif={n}
                  onRead={markRead}
                  onClose={() => setOpen(false)}
                />
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
