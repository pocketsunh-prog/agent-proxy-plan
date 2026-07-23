"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Registration failed.");
      setLoading(false);
      return;
    }

    // Auto sign-in after successful registration.
    const login = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (login?.error) {
      router.push("/login");
      return;
    }
    router.push("/calculator");
    router.refresh();
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <div className="logo" style={{ width: 32, height: 32 }}>
            T
          </div>
          <div>
            <h2 style={{ margin: 0 }}>TokenPlan</h2>
            <span className="text-muted" style={{ fontSize: 12 }}>
              AI Usage Dashboard
            </span>
          </div>
        </div>

        <h2>Create your account</h2>
        <p className="sub">Start estimating and tracking AI usage.</p>

        {error && <div className="notice notice-error">{error}</div>}

        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label htmlFor="name">Name (optional)</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>
          <div className="form-row">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="form-row">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <span className="text-muted" style={{ fontSize: 12 }}>
              At least 8 characters.
            </span>
          </div>
          <button
            className="btn btn-primary full-width"
            type="submit"
            disabled={loading}
          >
            {loading ? <span className="spinner" /> : "Create account"}
          </button>
        </form>

        <div className="foot">
          Already have an account? <Link href="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
