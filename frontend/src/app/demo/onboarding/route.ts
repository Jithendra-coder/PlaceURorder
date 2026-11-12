import { demoSignInResponse } from "@/lib/demo-login";

// Onboarding showcase: signs in the Tasty Bug demo owner and opens the setup screens as a read-only preview.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return demoSignInResponse(request, { emailEnv: "DEMO_LOGIN_EMAIL", passwordEnv: "DEMO_LOGIN_PASSWORD", landing: "/setup/business-type?preview=onboarding" });
}
