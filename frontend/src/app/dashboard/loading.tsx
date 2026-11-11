import { DashboardPageSkeleton } from "@/components/dashboard/kit";

// Shown inside the live shell while a dashboard page loads, so the layout never changes shape.
export default function DashboardLoading() {
  return <DashboardPageSkeleton />;
}
