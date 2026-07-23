"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

interface SidebarProps {
  userLabel: string;
  isAdmin: boolean;
}

const NAV = [
  { href: "/calculator", icon: "🧮", label: "Calculator" },
  { href: "/dashboard", icon: "📊", label: "Dashboard" },
  { href: "/plans", icon: "💳", label: "Plans" },
  { href: "/chat", icon: "🤖", label: "AI Chat" },
  { href: "/api-keys", icon: "🔑", label: "API Keys" },
  { href: "/api-test", icon: "🧪", label: "API Tester" },
];

export default function Sidebar({ userLabel, isAdmin }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="logo">T</div>
        <div>
          <h1>TokenPlan</h1>
          <span>AI Usage Dashboard</span>
        </div>
      </div>

      <nav className="nav">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={
              "nav-item" + (pathname === item.href ? " active" : "")
            }
          >
            <span className="icon">{item.icon}</span> {item.label}
          </Link>
        ))}

        {isAdmin && (
          <Link
            href="/admin"
            className={
              "nav-item" + (pathname.startsWith("/admin") ? " active" : "")
            }
          >
            <span className="icon">🛠️</span> Admin
          </Link>
        )}
      </nav>

      <div className="sidebar-user">Signed in as {userLabel}</div>
      <button
        className="btn btn-secondary btn-sm full-width"
        onClick={() => signOut({ callbackUrl: "/login" })}
        style={{ marginTop: 8 }}
      >
        Sign out
      </button>

      <div className="sidebar-footer">v2.0 · TokenPlan</div>
    </aside>
  );
}
