/**
 * middleware.ts
 * -----------------------------------------------------------------------------
 * Route protection:
 *   - Everything under the authenticated app and /admin requires a session.
 *   - /admin/* additionally requires role === "ADMIN".
 * Uses next-auth's withAuth wrapper (JWT is read from the cookie).
 * -----------------------------------------------------------------------------
 */
import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const { token } = req.nextauth;
    const isAdminRoute = req.nextUrl.pathname.startsWith("/admin");
    if (isAdminRoute && token?.role !== "ADMIN") {
      return NextResponse.redirect(new URL("/calculator", req.url));
    }
    return NextResponse.next();
  },
  {
    callbacks: {
      // Authorized if a token exists; role is enforced above.
      authorized: ({ token }) => !!token,
    },
    pages: { signIn: "/login" },
  }
);

export const config = {
  matcher: [
    "/calculator/:path*",
    "/dashboard/:path*",
    "/plans/:path*",
    "/chat/:path*",
    "/admin/:path*",
  ],
};
