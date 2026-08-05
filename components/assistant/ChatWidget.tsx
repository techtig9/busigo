"use client";

import { useEffect, useRef, useState } from "react";
import { AssistantIcon } from "./AssistantIcon";
import { X, Send, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "Why did my last run fail?",
  "Which plan fits my usage?",
  "How do credits work?",
  "Help me design a workflow for new signups",
];

const STORAGE_KEY = "busigo-assistant-history";
const WELCOME: ChatMessage = {
  role: "assistant",
  content: "Hi! I'm the busigo Assistant. I can see your plan, workflows, and recent runs — ask me anything about your account, or how to build something.",
};

function loadHistory(): ChatMessage[] {
  if (typeof window === "undefined") return [WELCOME];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [WELCOME];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [WELCOME];
  } catch {
    return [WELCOME];
  }
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Runs once on mount, client-side only — restores any prior conversation for this browser.
  // (Per-account history in the database would require a new table; this is the lighter-weight
  // version, scoped to "survives a reload," not "syncs across devices.")
  useEffect(() => {
    setMessages(loadHistory());
  }, []);

  useEffect(() => {
    if (messages.length <= 1) return; // don't persist just the welcome message
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      // Storage full or blocked — conversation still works, just won't survive a reload.
    }
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setStreaming(true);
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!res.body) throw new Error("No response stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + chunk };
          return copy;
        });
      }
    } catch {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", content: "Sorry — I couldn't reach the assistant just now." };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <>
      {/* Launcher */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close assistant" : "Open busigo assistant"}
        className={cn(
          "fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-panel shadow-lg ring-1 ring-hairline",
          "transition-all duration-300 hover:scale-105 hover:shadow-xl active:scale-95"
        )}
      >
        {open ? <X size={22} className="text-ink" /> : <AssistantIcon size={30} />}
      </button>

      {/* Panel */}
      <div
        className={cn(
          "fixed bottom-24 right-5 z-40 flex w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-lg border border-hairline bg-panel shadow-2xl transition-all duration-300 ease-out",
          open ? "h-[32rem] max-h-[calc(100vh-8rem)] translate-y-0 opacity-100" : "pointer-events-none h-0 translate-y-4 opacity-0"
        )}
      >
        <div className="flex items-center gap-2 border-b border-hairline bg-surface px-4 py-3">
          <AssistantIcon size={22} />
          <div className="flex-1">
            <p className="text-sm font-bold text-ink">busigo Assistant</p>
            <p className="text-xs text-slate">Knows your workflows &amp; usage</p>
          </div>
          {messages.length > 1 && (
            <button
              onClick={() => {
                setMessages([WELCOME]);
                try {
                  localStorage.removeItem(STORAGE_KEY);
                } catch {
                  // non-fatal
                }
              }}
              className="text-xs text-slate transition-colors hover:text-danger"
            >
              Clear
            </button>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed animate-[fadeIn_.2s_ease]",
                  m.role === "user" ? "bg-signal text-white" : "bg-surface text-ink"
                )}
              >
                {m.content || (streaming && i === messages.length - 1 ? <TypingDots /> : "")}
              </div>
            </div>
          ))}

          {messages.length === 1 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-hairline px-2.5 py-1 text-xs text-slate transition-colors hover:border-signal hover:text-signal"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-center gap-2 border-t border-hairline p-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your workflows..."
            className="flex-1 rounded border border-hairline px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-signal text-white transition-colors hover:bg-signal-dark disabled:opacity-40"
            aria-label="Send"
          >
            <Send size={15} />
          </button>
        </form>
      </div>
    </>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 text-slate">
      <Sparkles size={13} className="animate-pulse" />
      <span className="animate-pulse">thinking...</span>
    </span>
  );
}
