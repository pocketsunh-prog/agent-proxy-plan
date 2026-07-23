import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import Sidebar from "@/components/Sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const userLabel = session.user.name || session.user.email || "user";
  const isAdmin = session.user.role === "ADMIN";

  return (
    <div className="app-shell">
      <Sidebar userLabel={userLabel} isAdmin={isAdmin} />
      <main className="main">{children}</main>
    </div>
  );
}
