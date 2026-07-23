"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Provider {
  id: string;
  displayName: string;
  baseUrl: string;
  chatPath: string;
  enabled: boolean;
  hasKey: boolean;
  keyMask: string;
}

export default function ProvidersClient({
  providers,
}: {
  providers: Provider[];
}) {
  const router = useRouter();
  const [state, setState] = useState(providers);
  // New key input per provider (write-only; blank = leave unchanged).
  const [keyInput, setKeyInput] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  function update(id: string, patch: Partial<Provider>) {
    setState((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  async function save(p: Provider) {
    setError("");
    const newKey = keyInput[p.id] || "";
    const res = await fetch("/api/admin/providers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: p.id,
        displayName: p.displayName,
        baseUrl: p.baseUrl,
        chatPath: p.chatPath,
        enabled: p.enabled,
        ...(newKey ? { apiKey: newKey } : {}),
      }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Save failed");
      return;
    }
    setKeyInput((prev) => ({ ...prev, [p.id]: "" }));
    setMsg(`Saved provider "${p.displayName}"`);
    setTimeout(() => setMsg(""), 2000);
    router.refresh();
  }

  return (
    <>
      <div className="notice notice-warn">
        ⚠️ Provider API keys are stored server-side and never displayed. Leave
        the key field blank to keep the existing key. Rotate any keys that were
        previously committed to source control.
      </div>

      {msg && <div className="notice notice-info">{msg}</div>}
      {error && <div className="notice notice-error">{error}</div>}

      {state.map((p) => (
        <div className="card mt-16" key={p.id}>
          <div className="flex justify-between items-center mb-16">
            <div className="card-title" style={{ margin: 0 }}>
              {p.displayName}{" "}
              <span className={"tag " + (p.enabled ? "tag-on" : "tag-off")}>
                {p.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <label
              className="flex items-center gap-2"
              style={{ margin: 0, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={p.enabled}
                onChange={(e) => update(p.id, { enabled: e.target.checked })}
                style={{ width: "auto" }}
              />
              Enabled
            </label>
          </div>

          <div className="form-grid">
            <div className="form-row">
              <label>Base URL</label>
              <input
                value={p.baseUrl}
                onChange={(e) => update(p.id, { baseUrl: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Chat Path</label>
              <input
                value={p.chatPath}
                onChange={(e) => update(p.id, { chatPath: e.target.value })}
              />
            </div>
          </div>

          <div className="form-row">
            <label>
              API Key{" "}
              <span className="text-muted">
                {p.hasKey ? `(current: ${p.keyMask})` : "(none set)"}
              </span>
            </label>
            <input
              type="password"
              placeholder="Enter a new key to replace, or leave blank"
              value={keyInput[p.id] ?? ""}
              onChange={(e) =>
                setKeyInput((prev) => ({ ...prev, [p.id]: e.target.value }))
              }
              autoComplete="off"
            />
          </div>

          <button className="btn btn-primary" onClick={() => save(p)}>
            Save {p.displayName}
          </button>
        </div>
      ))}
    </>
  );
}
