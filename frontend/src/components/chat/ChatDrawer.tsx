"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { X, Send, MessageCircle, Wifi, WifiOff, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProjectChat } from "@/hooks/useProjectChat";
import { chatApi, attachmentsApi, type ChatMember } from "@/lib/api";

interface ChatDrawerProps {
  projectId: string;
  projectTitle: string;
  open: boolean;
  onClose: () => void;
  currentUserSub: string;
  currentUserName: string;
  currentUserRole: "admin" | "tester";
}

// Highlight @Name tokens that match a project member's name
function renderContent(content: string, members: ChatMember[], isOwn: boolean) {
  // Support both legacy @[Name] format and plain @Name format
  const parts = content.split(/(@\[[^\]]+\]|@\S+)/g);
  return parts.map((part, i) => {
    if (!part.startsWith("@")) return <React.Fragment key={i}>{part}</React.Fragment>;

    // Normalise: strip @[...] brackets if present
    const raw = part.startsWith("@[") && part.endsWith("]")
      ? part.slice(2, -1)
      : part.slice(1);

    const isMember = members.some(
      (m) => m.name.toLowerCase() === raw.toLowerCase() ||
             m.name.split(" ")[0].toLowerCase() === raw.toLowerCase()
    );

    return isMember ? (
      // Own bubble: white + underline (orange-on-orange would be invisible)
      // Others' bubble: primary orange + light bg tint
      <span
        key={i}
        className={
          isOwn
            ? "font-bold opacity-90"
            : "text-primary font-semibold bg-primary/10 rounded px-0.5"
        }
      >
        @{raw}
      </span>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    );
  });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function ChatDrawer({
  projectId,
  projectTitle,
  open,
  onClose,
  currentUserSub,
  currentUserName,
  currentUserRole,
}: ChatDrawerProps) {
  const { messages, typingNames, connected, historyLoading, hasMore, members, sendMessage, sendTyping, loadMore, clearMessages } =
    useProjectChat(projectId, open, currentUserSub);

  const [input, setInput] = useState("");
  const [mentions, setMentions] = useState<{ sub: string; name: string }[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState(false);
  // Map of member sub → resolved avatar URL (presigned)
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const avatarFetchedRef = useRef<Set<string>>(new Set());

  // Resolve avatar URLs for members that have an avatarKey (once each)
  useEffect(() => {
    members.forEach((m) => {
      if (m.avatarKey && !avatarFetchedRef.current.has(m.sub)) {
        avatarFetchedRef.current.add(m.sub);
        attachmentsApi.viewUrl(m.avatarKey, true)
          .then(({ url }) => setAvatarUrls((prev) => ({ ...prev, [m.sub]: url })))
          .catch(() => {});
      }
    });
  }, [members]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (!historyLoading) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, historyLoading]);

  // Focus input when drawer opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 300);
  }, [open]);

  const filteredMembers: ChatMember[] = mentionQuery !== null
    ? members.filter(
        (m) =>
          m.sub !== currentUserSub &&
          m.name.toLowerCase().includes(mentionQuery.toLowerCase())
      )
    : [];

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setInput(val);
      sendTyping();

      // Detect @mention trigger
      const cursor = e.target.selectionStart ?? val.length;
      const textUpToCursor = val.slice(0, cursor);
      const lastAt = textUpToCursor.lastIndexOf("@");
      if (lastAt !== -1) {
        const fragment = textUpToCursor.slice(lastAt + 1);
        // Only trigger if there's no space after the @
        if (!fragment.includes(" ")) {
          setMentionQuery(fragment);
          setMentionStart(lastAt);
          setMentionHighlight(0);
          return;
        }
      }
      setMentionQuery(null);
    },
    [sendTyping]
  );

  const insertMention = useCallback(
    (member: ChatMember) => {
      // Use first name only so no brackets or spaces appear in the textarea
      const firstName = member.name.split(" ")[0];
      const token = `@${firstName} `;
      const before = input.slice(0, mentionStart);
      const after = input.slice(mentionStart + 1 + (mentionQuery?.length ?? 0));
      setInput(before + token + after);
      setMentions((prev) => {
        if (prev.some((m) => m.sub === member.sub)) return prev;
        return [...prev, { sub: member.sub, name: member.name }];
      });
      setMentionQuery(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [input, mentionStart, mentionQuery]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionQuery !== null && filteredMembers.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionHighlight((h) => (h + 1) % filteredMembers.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionHighlight((h) => (h - 1 + filteredMembers.length) % filteredMembers.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          insertMention(filteredMembers[mentionHighlight]);
          return;
        }
        if (e.key === "Escape") {
          setMentionQuery(null);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mentionQuery, filteredMembers, mentionHighlight, insertMention]
  );

  const handleSend = useCallback(() => {
    const content = input.trim();
    if (!content || !connected) return;
    sendMessage(content, mentions.map((m) => m.sub));
    setInput("");
    setMentions([]);
    setMentionQuery(null);
  }, [input, mentions, connected, sendMessage]);

  async function handleClear() {
    setClearing(true);
    setClearError(false);
    try {
      await chatApi.clearHistory(projectId);
      clearMessages();
      setClearConfirm(false);
    } catch {
      // Keep the confirm open and show an error so the admin knows it failed
      setClearError(true);
    } finally {
      setClearing(false);
    }
  }

  return (
    <>
      {/* Overlay (mobile) */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          "fixed top-0 right-0 h-full w-80 z-50 flex flex-col bg-background border-l border-border shadow-2xl transition-transform duration-300 ease-in-out",
          open ? "translate-x-0 pointer-events-auto" : "translate-x-full pointer-events-none"
        )}
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <MessageCircle className="w-4 h-4 text-primary shrink-0" />
            <span className="font-semibold text-sm text-foreground truncate">{projectTitle}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {connected ? (
              <span title="Connected"><Wifi className="w-3.5 h-3.5 text-green-500" /></span>
            ) : (
              <span title="Connecting…"><WifiOff className="w-3.5 h-3.5 text-muted-foreground" /></span>
            )}

            {/* Clear chat — admin only */}
            {currentUserRole === "admin" && (
              clearConfirm ? (
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-muted-foreground">
                    {clearError ? "Failed — retry?" : "Clear all?"}
                  </span>
                  <button
                    onClick={handleClear}
                    disabled={clearing}
                    className="text-[11px] font-semibold text-destructive hover:underline disabled:opacity-50"
                  >
                    {clearing ? "…" : "Yes"}
                  </button>
                  <button
                    onClick={() => { setClearConfirm(false); setClearError(false); }}
                    className="text-[11px] text-muted-foreground hover:underline"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setClearConfirm(true)}
                  className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title="Clear chat history"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )
            )}

            <button
              onClick={onClose}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Message list */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
          {/* Load more */}
          {hasMore && (
            <button
              onClick={loadMore}
              className="w-full text-xs text-primary hover:underline text-center py-1"
            >
              Load earlier messages
            </button>
          )}

          {historyLoading && (
            <div className="flex justify-center py-6">
              <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          )}

          {!historyLoading && messages.length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-8">
              No messages yet. Start the conversation!
            </p>
          )}

          {messages.map((msg) => {
            const isOwn = msg.senderSub === currentUserSub;
            return (
              <div
                key={msg.messageId}
                className={cn("flex flex-col gap-0.5", isOwn ? "items-end" : "items-start")}
              >
                {!isOwn && (
                  <div className="flex items-center gap-1.5 px-1">
                    <div className="w-5 h-5 rounded-full bg-primary/10 overflow-hidden flex items-center justify-center text-primary text-[10px] font-bold shrink-0">
                      {avatarUrls[msg.senderSub]
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={avatarUrls[msg.senderSub]} alt={msg.senderName} className="w-full h-full object-cover" />
                        : msg.senderName.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-[11px] text-muted-foreground font-medium">{msg.senderName}</span>
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed break-words",
                    isOwn
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  )}
                >
                  {renderContent(msg.content, members, isOwn)}
                </div>
                <span className="text-[10px] text-muted-foreground/60 px-1">
                  {formatTime(msg.createdAt)}
                </span>
              </div>
            );
          })}

          {/* Typing indicator */}
          {typingNames.length > 0 && (
            <div className="flex items-start gap-1.5 px-1">
              <div className="bg-muted px-3 py-2 rounded-2xl rounded-bl-sm inline-flex items-center gap-1">
                <span className="text-xs text-muted-foreground">
                  {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing
                </span>
                <span className="flex gap-0.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1 h-1 rounded-full bg-muted-foreground/60 animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* @mention dropdown */}
        {mentionQuery !== null && filteredMembers.length > 0 && (
          <div className="absolute bottom-[72px] left-3 right-3 z-10 bg-background border border-border rounded-xl shadow-lg overflow-hidden">
            {filteredMembers.map((member, idx) => (
              <button
                key={member.sub}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent blur
                  insertMention(member);
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors",
                  idx === mentionHighlight
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted/50 text-foreground"
                )}
              >
                <div className="w-6 h-6 rounded-full bg-primary/10 overflow-hidden flex items-center justify-center text-primary text-xs font-bold shrink-0">
                  {avatarUrls[member.sub]
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={avatarUrls[member.sub]} alt={member.name} className="w-full h-full object-cover" />
                    : member.name.charAt(0).toUpperCase()}
                </div>
                <span className="font-medium">{member.name}</span>
                <span className="text-xs text-muted-foreground ml-auto capitalize">{member.role}</span>
              </button>
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="px-3 py-3 border-t border-border bg-background shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={connected ? "Message… (@ to mention)" : "Connecting…"}
              disabled={!connected}
              rows={1}
              className={cn(
                "flex-1 resize-none rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm",
                "placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30",
                "focus:border-primary/50 transition-colors max-h-28 overflow-y-auto",
                !connected && "opacity-50 cursor-not-allowed"
              )}
              style={{ minHeight: "38px" }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = Math.min(t.scrollHeight, 112) + "px";
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || !connected}
              className={cn(
                "p-2 rounded-xl transition-colors shrink-0",
                input.trim() && connected
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-1.5 px-1">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </>
  );
}
