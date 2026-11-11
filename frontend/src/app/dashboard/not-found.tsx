import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { DashboardPage } from "@/components/dashboard/kit";

export default function DashboardNotFound() {
  return (
    <DashboardPage width={720}>
      <EmptyState
        title="Section not found"
        description="The requested dashboard view or resource could not be found."
        headingLevel={1}
        actions={<Button label="Go to Home" variant="primary" href="/dashboard" />}
      />
    </DashboardPage>
  );
}
