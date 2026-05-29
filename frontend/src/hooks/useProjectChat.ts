"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { config } from "@/lib/config";
import { getAccessToken } from "@/lib/auth";
import { chatApi, type ChatMessage, type ChatMember } from "@/lib/api";

interface TypingUser {
  userSub: string;
  userName: string;
  timer: ReturnType<typeof setTimeout>;
}

interface UseProjectChatReturn {
  messages: ChatMessage[];
  typingNames: string[];
  connected: boolean;
  historyLoading: boolean;
  hasMore: boolean;
  members: ChatMember[];
  sendMessage: (content: string, mentions: string[]) => void;
  sendTyping: () => void;
  loadMore: () => Promise<void>;
  clearMessages: () => void;
}

export function useProjectChat(
  projectId: string,
  enabled: boolean,
  currentUserSub: string
): UseProjectChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [typingUsers, setTypingUsers] = useState<Map<string, TypingUser>>(new Map());

  const wsRef = useRef<WebSocket | null>(null);
  const cursorRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const enabledRef = useRef(enabled);
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  enabledRef.current = enabled;

  const typingNames = Array.from(typingUsers.values()).map((u) => u.userName);

  // ── Fetch history + members ────────────────────────────────────────────────

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    cursorRef.current = null;
    try {
      const [histRes, membersRes] = await Promise.all([
        chatApi.history(projectId),
        chatApi.members(projectId),
      ]);
      setMessages(histRes.messages);
      setHasMore(!!histRes.nextCursor);
      cursorRef.current = histRes.nextCursor ?? null;
      setMembers(membersRes.members);
    } catch {
      // silent — history load failure shouldn't block chat
    } finally {
      setHistoryLoading(false);
    }
  }, [projectId]);

  const loadMore = useCallback(async () => {
    if (!cursorRef.current) return;
    try {
      const res = await chatApi.history(projectId, cursorRef.current);
      setMessages((prev) => [...res.messages, ...prev]);
      setHasMore(!!res.nextCursor);
      cursorRef.current = res.nextCursor ?? null;
    } catch {
      // silent
    }
  }, [projectId]);

  // ── WebSocket lifecycle ────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    let token: string;
    try {
      token = await getAccessToken();
    } catch {
      return;
    }

    const url = `${config.wsUrl}?token=${encodeURIComponent(token)}&projectId=${encodeURIComponent(projectId)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectAttemptsRef.current = 0;
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Auto-reconnect if drawer is still open (max 4 attempts, exponential backoff)
      if (enabledRef.current && reconnectAttemptsRef.current < 4) {
        const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 15000);
        reconnectAttemptsRef.current += 1;
        reconnectTimerRef.current = setTimeout(() => {
          if (enabledRef.current) connect();
        }, delay);
      }
    };

    ws.onerror = () => ws.close();

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);

        if (data.type === "MESSAGE") {
          setMessages((prev) => {
            // De-duplicate in case of reconnect replay
            if (prev.some((m) => m.messageId === data.message.messageId)) return prev;
            return [...prev, data.message as ChatMessage];
          });
          // Clear typing for sender
          setTypingUsers((prev) => {
            const next = new Map(prev);
            for (const [k, v] of next.entries()) {
              if (v.userSub === data.message.senderSub) {
                clearTimeout(v.timer);
                next.delete(k);
              }
            }
            return next;
          });
        }

        if (data.type === "TYPING") {
          const { userSub, userName } = data as { userSub: string; userName: string };
          if (userSub === currentUserSub) return;
          setTypingUsers((prev) => {
            const next = new Map(prev);
            const existing = next.get(userSub);
            if (existing) clearTimeout(existing.timer);
            const timer = setTimeout(() => {
              setTypingUsers((p) => {
                const m = new Map(p);
                m.delete(userSub);
                return m;
              });
            }, 3000);
            next.set(userSub, { userSub, userName, timer });
            return next;
          });
        }
      } catch {
        // ignore malformed frames
      }
    };
  }, [projectId, currentUserSub]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectAttemptsRef.current = 4; // prevent any pending reconnect
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, []);

  useEffect(() => {
    if (enabled) {
      reconnectAttemptsRef.current = 0;
      fetchHistory();
      connect();
    } else {
      disconnect();
      setMessages([]);
      setTypingUsers(new Map());
      cursorRef.current = null;
    }
    return () => {
      if (!enabled) disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, projectId]);

  // ── Send helpers ───────────────────────────────────────────────────────────

  const sendMessage = useCallback((content: string, mentions: string[]) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "sendMessage", content, mentions }));
  }, []);

  const sendTyping = useCallback(() => {
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    typingDebounceRef.current = setTimeout(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: "typing" }));
      }
    }, 400);
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, typingNames, connected, historyLoading, hasMore, members, sendMessage, sendTyping, loadMore, clearMessages };
}
