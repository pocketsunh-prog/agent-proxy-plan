"use client";

import { useState } from "react";

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  disabled: boolean;
  planId: string;
  createdAt: string;
  usageCount: number;
}

interface Props {
  initialUsers: AdminUser[];
  plans: { id: string; name: string }[];
}

export default function UsersClient({ initialUsers, plans }: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  async function refresh(query = q) {
    const res = await fetch(
      "/api/admin/users?q=" + encodeURIComponent(query),
      { cache: "no-store" }
    );
    if (res.ok) setUsers(await res.json());
  }

  async function patch(id: string, data: Partial<AdminUser>) {
    setError("");
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...data }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Update failed");
      return;
    }
    refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this user and all their usage? This cannot be undone."))
      return;
    setError("");
    const res = await fetch("/api/admin/users?id=" + encodeURIComponent(id), {
      method: "DELETE",
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Delete failed");
      return;
    }
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }

  return (
    <div className="card">
      <div className="flex justify-between items-center mb-16">
        <div className="card-title" style={{ margin: 0 }}>
          Users ({users.length})
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search email or name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && refresh()}
            style={{ width: 240 }}
          />
          <button className="btn btn-secondary btn-sm" onClick={() => refresh()}>
            Search
          </button>
        </div>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Usage</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.name || <span className="text-muted">—</span>}</td>
                <td>
                  <select
                    value={u.role}
                    onChange={(e) => patch(u.id, { role: e.target.value })}
                    style={{ width: 110 }}
                  >
                    <option value="USER">USER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </td>
                <td>
                  <select
                    value={u.planId}
                    onChange={(e) => patch(u.id, { planId: e.target.value })}
                    style={{ width: 130 }}
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className={"tag " + (u.disabled ? "tag-off" : "tag-on")}>
                    {u.disabled ? "Disabled" : "Active"}
                  </span>
                </td>
                <td>{u.usageCount}</td>
                <td className="text-muted">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td>
                  <div className="flex gap-2">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => patch(u.id, { disabled: !u.disabled })}
                    >
                      {u.disabled ? "Enable" : "Disable"}
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => remove(u.id)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={8} className="text-muted text-center">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
