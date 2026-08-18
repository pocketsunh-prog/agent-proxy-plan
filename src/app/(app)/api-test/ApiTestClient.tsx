"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ModelDTO } from "@/lib/catalog";

interface Props {
  models: ModelDTO[];
}

export default function ApiTestClient({ models }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(models[0]?.id ?? "");
  const [prompt, setPrompt] = useState("Say hello in 3 words.");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(256);

  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [response, setResponse] = useState<string>("");
  const [answer, setAnswer] = useState<string>("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:8914";
  const endpoint = origin + "/api/v1/chat/completions";

  const requestBody = useMemo(
    () =>
      JSON.stringify(
        {
          model,
          messages: [{ role: "user", content: prompt }],
          temperature,
          max_tokens: maxTokens,
        },
        null,
        2
      ),
    [model, prompt, temperature, maxTokens]
  );

  const curl = useMemo(() => {
    const keyShown = apiKey || "tp_live_YOURKEY";
    const body = JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens: maxTokens,
    });
    return `curl ${endpoint} \\
  -H "Authorization: Bearer ${keyShown}" \\
  -H "Content-Type: application/json" \\
  -d '${body}'`;
  }, [apiKey, model, prompt, temperature, maxTokens, endpoint]);

  async function send() {
    if (sending) return;
    setError("");
    if (!apiKey.trim()) {
      setError("Enter an API key. Create one under API Keys.");
      return;
    }
    setSending(true);
    setStatus(null);
    setElapsed(null);
    setResponse("");
    setAnswer("");

    const started = performance.now();
    try {
      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey.trim(),
        },
        body: requestBody,
      });
      setStatus(res.status);
      setElapsed(Math.round(performance.now() - started));

      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
        setResponse(JSON.stringify(parsed, null, 2));
      } catch {
        setResponse(text);
      }

      if (res.ok && parsed && typeof parsed === "object") {
        const content =
          (parsed as { choices?: { message?: { content?: string } }[] })
            .choices?.[0]?.message?.content ?? "";
        setAnswer(content);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSending(false);
    }
  }

  function copyCurl() {
    navigator.clipboard.writeText(curl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const statusClass =
    status === null
      ? ""
      : status >= 200 && status < 300
      ? "tag-on"
      : "tag-off";

  return (
    <>
      <div className="page-header">
        <h2>API Tester</h2>
        <p>
          Send a live request to your OpenAI-compatible endpoint using one of
          your <Link href="/api-keys">API keys</Link>. Usage counts against your
          plan, same as a real call.
        </p>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      <div className="card">
        <div className="form-row">
          <label htmlFor="api-key">API Key</label>
          <input
            id="api-key"
            type="password"
            placeholder="tp_live_…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
          <span className="text-muted" style={{ fontSize: 12 }}>
            Paste a key from <Link href="/api-keys">API Keys</Link>. It&apos;s
            sent only to this app&apos;s endpoint.
          </span>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label htmlFor="model">Model</label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.id})
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="temp">Temperature</label>
            <input
              id="temp"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label htmlFor="max-tokens">Max Output Tokens</label>
            <input
              id="max-tokens"
              type="number"
              min={1}
              max={128_000}
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value) || 256)}
            />
          </div>
        </div>

        <div className="form-row">
          <label htmlFor="prompt">Message</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Type a prompt to send…"
          />
        </div>

        <button className="btn btn-primary" onClick={send} disabled={sending}>
          {sending ? <span className="spinner" /> : "Send request"}
        </button>
      </div>

      {answer && (
        <div className="card mt-16">
          <div className="card-title">Assistant reply</div>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{answer}</div>
        </div>
      )}

      {status !== null && (
        <div className="card mt-16">
          <div className="flex justify-between items-center mb-16">
            <div className="card-title" style={{ margin: 0 }}>
              Raw response
            </div>
            <div className="flex gap-2 items-center">
              <span className={"tag " + statusClass}>HTTP {status}</span>
              {elapsed !== null && (
                <span className="text-muted" style={{ fontSize: 12 }}>
                  {elapsed} ms
                </span>
              )}
            </div>
          </div>
          <pre
            style={{
              margin: 0,
              overflowX: "auto",
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--text-dim)",
            }}
          >
            {response}
          </pre>
        </div>
      )}

      <div className="card mt-16">
        <div className="flex justify-between items-center mb-16">
          <div className="card-title" style={{ margin: 0 }}>
            Equivalent cURL
          </div>
          <button className="btn btn-secondary btn-sm" onClick={copyCurl}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            overflowX: "auto",
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--text-dim)",
          }}
        >
          {curl}
        </pre>
      </div>
    </>
  );
}
