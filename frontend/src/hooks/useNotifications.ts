"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { notificationsApi, type AppNotification } from "@/lib/api";

interface UseNotificationsReturn {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  markRead: (notifId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  clearAll: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useNotifications(): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await notificationsApi.list();
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
    } catch {
      // silent — bell shouldn't crash the app
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));

    // Poll every 60 seconds
    intervalRef.current = setInterval(refresh, 60_000);

    // Also refresh on window focus (user comes back to tab)
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const markRead = useCallback(async (notifId: string) => {
    try {
      await notificationsApi.markRead(notifId);
      setNotifications((prev) =>
        prev.map((n) => (n.notifId === notifId ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // silent
    }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await notificationsApi.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // silent
    }
  }, []);

  const clearAll = useCallback(async () => {
    try {
      await notificationsApi.clearAll();
      setNotifications([]);
      setUnreadCount(0);
    } catch {
      // silent
    }
  }, []);

  return { notifications, unreadCount, loading, markRead, markAllRead, clearAll, refresh };
}
