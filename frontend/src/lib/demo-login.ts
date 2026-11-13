import { NextResponse } from "next/server";

// Server-side demo sign-in. Credentials come from server-only environment variables (never NEXT_PUBLIC_),
// so passwords never reach the browser. Without them the route sends the visitor to the sign-in page,
// which keeps production deployments unaffected.
export async function demoSignInResponse(request: Request, { emailEnv, passwordEnv, landing }: { emailEnv: string; passwordEnv: string; landing: string }) {
  const signInUrl = new URL("/auth/sign-in", request.url);
  const email = process.env[emailEnv]?.trim();
  const password = process.env[passwordEnv];
  const backend = process.env.BACKEND_API_ORIGIN?.trim().replace(/\/+$/, "");
  if (!email || !password || !backend) {
    return NextResponse.redirect(signInUrl, 303);
  }

  // Pass the visitor's browser through so the session shows the real device in Security & sessions.
  const userAgent = request.headers.get("user-agent");
  let upstream: Response;
  try {
    upstream = await fetch(`${backend}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(userAgent ? { "User-Agent": userAgent } : {}),
      },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.redirect(signInUrl, 303);
  }
  if (!upstream.ok) {
    return NextResponse.redirect(signInUrl, 303);
  }

  const response = NextResponse.redirect(new URL(landing, request.url), 303);
  for (const cookie of upstream.headers.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}
