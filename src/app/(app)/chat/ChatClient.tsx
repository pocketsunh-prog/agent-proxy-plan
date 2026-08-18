"use client";

import { useRef, useState } from "react";
import type { ModelDTO } from "@/lib/catalog";
import ModelChips from "@/components/ModelChips";
import { formatTokens, formatUSD } from "@/lib/tokenizer";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  meta?: string;
  error?: boolean;
}

interface ChatResult {
  content: string;
  usage: { input: number; output: number; total: number };
  cost: { totalCost: number };
}

export default function ChatClient({ models }: { models: ModelDTO[] }) {
  const [selectedId, setSelectedId] = useState(models[0]?.id ?? "");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: "assistant",
      content:
        "Hello! Select a model and send a message to start. Your usage is tracked and billed to your plan.",
      meta: "System",
    },
  ]);
  const [lastResult, setLastResult] = useState<ChatResult | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selected = models.find((m) => m.id === selectedId);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  async function send() {
    const message = input.trim();
    if (!message || sending) return;

    const history = messages
      .filter((m) => !m.error && m.meta !== "System")
      .map((m) => ({ role: m.role, content: m.content }));
    const outgoing = [...history, { role: "user" as const, content: message }];

    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setInput("");
    setSending(true);
    scrollToBottom();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: selectedId,
          messages: outgoing,
          temperature,
          maxTokens,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      const result: ChatResult = await res.json();
      setLastResult(result);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.content,
          meta:
            result.usage.input +
            "+" +
            result.usage.output +
            " tokens · " +
            formatUSD(result.cost.totalCost),
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Chat failed";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ " + msg, meta: "Error", error: true },
      ]);
    } finally {
      setSending(false);
      scrollToBottom();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>AI Chat</h2>
        <p>Connect to a real AI agent. Usage is tracked and billed to your plan.</p>
      </div>

      <div className="notice notice-info">
        🔑 API keys are managed server-side by an admin — you never enter one
        here.
      </div>

      <div className="card">
        <div className="form-row">
          <label>Model</label>
          <ModelChips
            models={models}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label htmlFor="chat-temperature">Temperature</label>
            <input
              id="chat-temperature"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="chat-max-tokens">Max Output Tokens</label>
            <input
              id="chat-max-tokens"
              type="number"
              min={1}
              max={128_000}
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value) || 1024)}
            />
          </div>
        </div>
      </div>

      <div className="card mt-16 chat-container">
        <div className="chat-messages" ref={scrollRef}>
          {messages.map((m, i) => (
            <div
              key={i}
              className={"chat-msg " + m.role + (m.error ? " error" : "")}
            >
              {m.content}
              {m.meta && <div className="meta">{m.meta}</div>}
            </div>
          ))}
          {sending && (
            <div className="chat-msg assistant">
              <span className="spinner" />
              <div className="meta">Connecting…</div>
            </div>
          )}
        </div>

        <div className="chat-meta-bar">
          {lastResult && selected && (
            <>
              <span>
                <strong style={{ color: "var(--text-dim)" }}>Model: </strong>
                {selected.displayName}
              </span>
              <span>
                <strong style={{ color: "var(--text-dim)" }}>Tokens: </strong>
                {formatTokens(lastResult.usage.total)} total
              </span>
              <span>
                <strong style={{ color: "var(--text-dim)" }}>Cost: </strong>
                {formatUSD(lastResult.cost.totalCost)}
              </span>
            </>
          )}
        </div>

        <div className="chat-input-row">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type your message… (Enter to send, Shift+Enter for newline)"
            rows={1}
          />
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={sending}
          >
            {sending ? <span className="spinner" /> : "Send"}
          </button>
        </div>
      </div>
    </>
  );
}
