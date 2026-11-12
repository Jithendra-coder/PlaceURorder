import { Suspense } from "react";
import { AdministrationModule } from "@/features/dashboard/administration/AdministrationModule";

// Suspense lets the module read ?tab= (for example the sidebar's Security & sessions link) during static rendering.
export default function AdministrationTeamPage() { return <Suspense fallback={null}><AdministrationModule mode="team" /></Suspense>; }
