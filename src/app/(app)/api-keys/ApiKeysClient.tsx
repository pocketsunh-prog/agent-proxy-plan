"use client";

import { useState } from "react";

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  revoked: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export default function ApiKeysClient({
  initialKeys,
}: {
  initialKeys: ApiKeyRow[];
}) {
  const [keys, setKeys] = useState(initialKeys);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    const res = await fetch("/api/keys", { cache: "no-store" });
    if (res.ok) setKeys(await res.json());
  }

  async function create() {
    if (!name.trim() || creating) return;
    setCreating(true);
    setError("");
    setNewKey(null);
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    setCreating(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Create failed");
      return;
    }
    const data = await res.json();
    setNewKey(data.key);
    setName("");
    refresh();
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key? Applications using it will stop working.")) {
      return;
    }
    const res = await fetch("/api/keys?id=" + encodeURIComponent(id), {
      method: "DELETE",
    });
    if (res.ok) refresh();
  }

  function copyKey() {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:8080";

  return (
    <>
      <div className="page-header">
        <h2>API Keys</h2>
        <p>
          Create a key to call the AI API programmatically. Authenticate with{" "}
          <code>Authorization: Bearer &lt;key&gt;</code>.
        </p>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      {newKey && (
        <div className="notice notice-warn" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <div style={{ marginBottom: 8 }}>
            ✅ Key created. Copy it now — it won&apos;t be shown again.
          </div>
          <div className="flex gap-2 items-center">
            <input readOnly value={newKey} style={{ fontFamily: "monospace" }} />
            <button className="btn btn-secondary btn-sm" onClick={copyKey}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Create a new key</div>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="Key name (e.g. My laptop, Production)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            maxLength={60}
          />
          <button
            className="btn btn-primary"
            onClick={create}
            disabled={creating || !name.trim()}
          >
            {creating ? <span className="spinner" /> : "Create key"}
          </button>
        </div>
      </div>

      <div className="card mt-16">
        <div className="card-title">Your keys</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Status</th>
                <th>Last used</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted text-center">
                    No keys yet. Create one above.
                  </td>
                </tr>
              ) : (
                keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td style={{ fontFamily: "monospace" }}>{k.prefix}…</td>
                    <td>
                      <span
                        className={"tag " + (k.revoked ? "tag-off" : "tag-on")}
                      >
                        {k.revoked ? "Revoked" : "Active"}
                      </span>
                    </td>
                    <td className="text-muted">
                      {k.lastUsedAt
                        ? new Date(k.lastUsedAt).toLocaleString()
                        : "Never"}
                    </td>
                    <td className="text-muted">
                      {new Date(k.createdAt).toLocaleDateString()}
                    </td>
                    <td>
                      {!k.revoked && (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => revoke(k.id)}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mt-16">
        <div className="card-title">Usage example</div>
        <pre
          style={{
            margin: 0,
            overflowX: "auto",
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--text-dim)",
          }}
        >
{`curl ${origin}/api/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "LongCat-2.0",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}
        </pre>
        <p className="text-muted mt-8" style={{ fontSize: 13 }}>
          OpenAI-compatible — you can also point the OpenAI SDK at{" "}
          <code>{origin}/api/v1</code> with your key.
        </p>
      </div>
    </>
  );
}
