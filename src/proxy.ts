import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Optimistic check only: redirects visitors without a session cookie.
// It does not validate the session; pages and actions call requireSession().
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Each excluded path must end there or continue with "/", so e.g.
    // /loginx still goes through the proxy.
    // Icons and the manifest are public: phones fetch them before logging in.
    "/((?!(?:api/auth|api/health|login|setup|_next/static|_next/image|icon|apple-icon|pwa-icon|manifest\\.webmanifest)(?:/|$)).*)",
  ],
};
