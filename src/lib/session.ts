/**
 * Server-side session helpers for route handlers and server components.
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function getSession() {
  return getServerSession(authOptions);
}

/** Return the session or null; use in server components. */
export async function requireUser() {
  const session = await getSession();
  return session?.user ?? null;
}

/** True if the current session belongs to an admin. */
export async function isAdmin() {
  const session = await getSession();
  return session?.user?.role === "ADMIN";
}
