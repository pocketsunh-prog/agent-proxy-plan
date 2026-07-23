import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import Sidebar from "@/components/Sidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/calculator");

  const userLabel = session.user.name || session.user.email || "admin";

  return (
    <div className="app-shell">
      <Sidebar userLabel={userLabel} isAdmin />
      <main className="main">
        <div className="page-header">
          <h2>Admin</h2>
          <p>Manage users, usage, plans &amp; pricing, and providers.</p>
        </div>
        <div className="model-chips mb-16">
          <Link className="chip" href="/admin/users">
            Users
          </Link>
          <Link className="chip" href="/admin/usage">
            Usage
          </Link>
          <Link className="chip" href="/admin/plans">
            Plans &amp; Pricing
          </Link>
          <Link className="chip" href="/admin/providers">
            Providers
          </Link>
        </div>
        {children}
      </main>
    </div>
  );
}
