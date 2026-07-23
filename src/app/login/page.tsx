"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="auth-wrap" />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/calculator";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("Invalid email or password (or the account is disabled).");
      return;
    }
    router.push(callbackUrl);
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

        <h2>Welcome back</h2>
        <p className="sub">Sign in to your account to continue.</p>

        {error && <div className="notice notice-error">{error}</div>}

        <form onSubmit={onSubmit}>
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
              autoComplete="current-password"
            />
          </div>
          <button
            className="btn btn-primary full-width"
            type="submit"
            disabled={loading}
          >
            {loading ? <span className="spinner" /> : "Sign in"}
          </button>
        </form>

        <div className="foot">
          Don&apos;t have an account? <Link href="/register">Create one</Link>
        </div>
      </div>
    </div>
  );
}
