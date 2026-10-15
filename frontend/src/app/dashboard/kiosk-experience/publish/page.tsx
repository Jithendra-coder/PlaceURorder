import { KioskExperiencePage } from "@/features/dashboard/kiosk-experience/KioskExperiencePage";
export default async function Page({ searchParams }: { searchParams: Promise<{ test?: string | string[] }> }) {
  const test = (await searchParams).test;
  return <KioskExperiencePage mode="publish" initialTestOpen={test === "1"} />;
}
