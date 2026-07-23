import { prisma } from "@/lib/prisma";
import UsersClient from "./UsersClient";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const [users, plans] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        disabled: true,
        planId: true,
        createdAt: true,
        _count: { select: { usage: true } },
      },
    }),
    prisma.plan.findMany({ select: { id: true, name: true } }),
  ]);

  return (
    <UsersClient
      initialUsers={users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        disabled: u.disabled,
        planId: u.planId,
        createdAt: u.createdAt.toISOString(),
        usageCount: u._count.usage,
      }))}
      plans={plans}
    />
  );
}
