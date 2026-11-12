import { demoSignInResponse } from "@/lib/demo-login";

// Tasty Bug showcase demo: signs in the demo owner and opens the dashboard.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return demoSignInResponse(request, { emailEnv: "DEMO_LOGIN_EMAIL", passwordEnv: "DEMO_LOGIN_PASSWORD", landing: "/dashboard" });
}
