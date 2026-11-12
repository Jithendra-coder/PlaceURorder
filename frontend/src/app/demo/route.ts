import { NextResponse } from "next/server";

// Demo sign-in for a public showcase deployment. Only active when DEMO_LOGIN_EMAIL and
// DEMO_LOGIN_PASSWORD are set on the server (never with NEXT_PUBLIC_ prefixes), so the
// password never reaches the browser and production deployments are unaffected.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const signInUrl = new URL("/auth/sign-in", request.url);
  const email = process.env.DEMO_LOGIN_EMAIL?.trim();
  const password = process.env.DEMO_LOGIN_PASSWORD;
  const backend = process.env.BACKEND_API_ORIGIN?.trim().replace(/\/+$/, "");
  if (!email || !password || !backend) {
    return NextResponse.redirect(signInUrl, 303);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${backend}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.redirect(signInUrl, 303);
  }
  if (!upstream.ok) {
    return NextResponse.redirect(signInUrl, 303);
  }

  const response = NextResponse.redirect(new URL("/dashboard", request.url), 303);
  for (const cookie of upstream.headers.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}
