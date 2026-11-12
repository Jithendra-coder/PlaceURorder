import { demoSignInResponse } from "@/lib/demo-login";

// Onboarding showcase: signs in a demo account that has no business yet, so the setup flow opens for a new owner.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return demoSignInResponse(request, { emailEnv: "DEMO_ONBOARDING_EMAIL", passwordEnv: "DEMO_ONBOARDING_PASSWORD", landing: "/setup/business-type" });
}
