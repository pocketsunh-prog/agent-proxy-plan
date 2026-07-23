/**
 * Guard for admin API routes. Returns the admin session or a NextResponse
 * error to return early.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function requireAdmin() {
  const session = await getSession();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.user.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}
