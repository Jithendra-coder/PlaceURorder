import { redirect } from "next/navigation";
import "./landing.css";
import LandingPage from "@/features/landing/LandingPage";

export default function Home() {
  // The demo deployment opens straight into the signed-in demo dashboard. Production has no
  // DEMO_LOGIN_EMAIL, so its landing page is unchanged.
  if (process.env.DEMO_LOGIN_EMAIL) {
    redirect("/demo");
  }
  return <LandingPage />;
}
