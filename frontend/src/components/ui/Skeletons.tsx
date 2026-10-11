"use client";

import type { CSSProperties } from "react";

/**
 * Low-level shimmering block primitive adhering to the design system palette and shimmer animation.
 */
export function SkeletonBlock({
  width = "100%",
  height = "20px",
  borderRadius = "8px",
  style,
  className = "",
}: {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span
      className={`mt-skeleton-block ${className}`}
      aria-hidden="true"
      style={{
        display: "block",
        width,
        height,
        borderRadius,
        background: "linear-gradient(90deg, #f2f4f7 25%, #eaecf0 50%, #f2f4f7 75%)",
        backgroundSize: "200% 100%",
        animation: "mt-skeleton-shimmer 1.4s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

/**
 * Reusable table skeleton with header row and multiple data rows.
 */
export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="mt-card" style={{ padding: "16px", overflow: "hidden" }} aria-label="Loading table data" role="status">
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: "16px", paddingBottom: "12px", borderBottom: "1px solid #eaecf0" }}>
        {Array.from({ length: columns }, (_, i) => (
          <SkeletonBlock key={i} height="16px" width={i === 0 ? "70%" : "50%"} />
        ))}
      </div>
      <div style={{ display: "grid", gap: "14px", paddingTop: "14px" }}>
        {Array.from({ length: rows }, (_, rowIndex) => (
          <div key={rowIndex} style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: "16px", alignItems: "center" }}>
            {Array.from({ length: columns }, (_, colIndex) => (
              <SkeletonBlock
                key={colIndex}
                height="18px"
                width={colIndex === 0 ? "85%" : colIndex === columns - 1 ? "40%" : "60%"}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Reusable card grid skeleton for devices, alerts, or integration providers.
 */
export function CardGridSkeleton({ count = 6, columns = 3 }: { count?: number; columns?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${columns >= 3 ? "280px" : "320px"}, 1fr))`,
        gap: "16px",
      }}
      aria-label="Loading cards"
      role="status"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="mt-card" style={{ padding: "18px", display: "grid", gap: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <SkeletonBlock height="20px" width="55%" />
            <SkeletonBlock height="22px" width="64px" borderRadius="999px" />
          </div>
          <SkeletonBlock height="14px" width="90%" />
          <SkeletonBlock height="14px" width="70%" />
          <div style={{ paddingTop: "8px", display: "flex", justifyContent: "flex-end" }}>
            <SkeletonBlock height="32px" width="80px" borderRadius="8px" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Workspace skeleton for the overall Dashboard shell while verifying workspace or during page loads.
 */
export function WorkspaceSkeleton() {
  return (
    <div className="mt-workspace-skeleton" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#f8fafc" }} aria-label="Loading workspace" role="status">
      {/* Top Header */}
      <header
        style={{
          height: "64px",
          background: "#fff",
          borderBottom: "1px solid #eaecf0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <SkeletonBlock height="32px" width="130px" borderRadius="8px" />
          <SkeletonBlock height="28px" width="160px" borderRadius="8px" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <SkeletonBlock height="36px" width="180px" borderRadius="8px" />
          <SkeletonBlock height="36px" width="36px" borderRadius="50%" />
        </div>
      </header>

      {/* Body: Sidebar + Main Content */}
      <div style={{ display: "flex", flex: 1 }}>
        <aside
          style={{
            width: "240px",
            background: "#fff",
            borderRight: "1px solid #eaecf0",
            padding: "20px 16px",
            display: "grid",
            gap: "16px",
            alignContent: "start",
          }}
        >
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <SkeletonBlock height="18px" width="18px" borderRadius="4px" />
              <SkeletonBlock height="16px" width={`${60 + (i % 3) * 15}%`} />
            </div>
          ))}
        </aside>

        <main style={{ flex: 1, padding: "28px 36px", display: "grid", gap: "24px", alignContent: "start", maxWidth: "1440px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "grid", gap: "8px" }}>
              <SkeletonBlock height="28px" width="260px" borderRadius="6px" />
              <SkeletonBlock height="16px" width="380px" borderRadius="6px" />
            </div>
            <SkeletonBlock height="40px" width="120px" borderRadius="8px" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="mt-card" style={{ padding: "20px", display: "grid", gap: "10px" }}>
                <SkeletonBlock height="14px" width="50%" />
                <SkeletonBlock height="30px" width="70%" />
                <SkeletonBlock height="12px" width="40%" />
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr", gap: "20px" }}>
            <div className="mt-card" style={{ padding: "24px", minHeight: "320px", display: "grid", gap: "16px" }}>
              <SkeletonBlock height="20px" width="160px" />
              <SkeletonBlock height="240px" borderRadius="8px" />
            </div>
            <div className="mt-card" style={{ padding: "24px", minHeight: "320px", display: "grid", gap: "14px" }}>
              <SkeletonBlock height="20px" width="140px" />
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
                  <SkeletonBlock height="16px" width="55%" />
                  <SkeletonBlock height="20px" width="60px" borderRadius="999px" />
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Setup shell skeleton for Onboarding flows.
 */
export function SetupShellSkeleton() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#f8fafc" }} aria-label="Loading setup" role="status">
      <header
        style={{
          height: "64px",
          background: "#fff",
          borderBottom: "1px solid #eaecf0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 28px",
        }}
      >
        <SkeletonBlock height="28px" width="140px" borderRadius="8px" />
        <SkeletonBlock height="24px" width="100px" borderRadius="999px" />
      </header>

      <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px" }}>
        {/* Progress Indicator Rail */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "32px", width: "100%", maxWidth: "600px" }}>
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonBlock key={i} height="8px" borderRadius="999px" style={{ flex: 1 }} />
          ))}
        </div>

        {/* Central Form Card */}
        <div className="mt-card" style={{ width: "100%", maxWidth: "640px", padding: "32px", display: "grid", gap: "20px" }}>
          <SkeletonBlock height="26px" width="60%" />
          <SkeletonBlock height="16px" width="85%" />
          <div style={{ display: "grid", gap: "16px", marginTop: "12px" }}>
            <div style={{ display: "grid", gap: "6px" }}>
              <SkeletonBlock height="14px" width="30%" />
              <SkeletonBlock height="42px" borderRadius="9px" />
            </div>
            <div style={{ display: "grid", gap: "6px" }}>
              <SkeletonBlock height="14px" width="25%" />
              <SkeletonBlock height="42px" borderRadius="9px" />
            </div>
            <div style={{ display: "grid", gap: "6px" }}>
              <SkeletonBlock height="14px" width="35%" />
              <SkeletonBlock height="80px" borderRadius="9px" />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "16px" }}>
            <SkeletonBlock height="40px" width="90px" borderRadius="8px" />
            <SkeletonBlock height="40px" width="130px" borderRadius="8px" />
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Authentic skeleton matching HomePage.tsx.
 */
export function DashboardHomeSkeleton() {
  return (
    <div style={{ display: "grid", gap: "24px" }} aria-label="Loading Home" role="status">
      {/* Hero greeting & command bar */}
      <section className="mt-card" style={{ padding: "28px 32px", display: "grid", gap: "16px", background: "#fff" }}>
        <SkeletonBlock height="16px" width="180px" />
        <SkeletonBlock height="32px" width="480px" />
        <SkeletonBlock height="46px" width="100%" borderRadius="10px" style={{ marginTop: "4px" }} />
      </section>

      {/* KPI Cards */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="mt-card" style={{ padding: "20px", display: "grid", gap: "10px" }}>
            <SkeletonBlock height="14px" width="55%" />
            <SkeletonBlock height="32px" width="75%" />
            <SkeletonBlock height="14px" width="45%" />
          </div>
        ))}
      </section>

      {/* Sales Overview + Kitchen/Orders */}
      <section style={{ display: "grid", gridTemplateColumns: "1.75fr 1.25fr", gap: "20px" }}>
        <div className="mt-card" style={{ padding: "24px", minHeight: "340px", display: "grid", gap: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <SkeletonBlock height="22px" width="160px" />
            <SkeletonBlock height="32px" width="110px" borderRadius="8px" />
          </div>
          <SkeletonBlock height="240px" borderRadius="10px" />
        </div>
        <div className="mt-card" style={{ padding: "24px", minHeight: "340px", display: "grid", gap: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <SkeletonBlock height="22px" width="140px" />
            <SkeletonBlock height="26px" width="70px" borderRadius="999px" />
          </div>
          <div style={{ display: "grid", gap: "12px" }}>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f2f4f7" }}>
                <div style={{ display: "grid", gap: "4px" }}>
                  <SkeletonBlock height="16px" width="120px" />
                  <SkeletonBlock height="12px" width="80px" />
                </div>
                <SkeletonBlock height="24px" width="65px" borderRadius="999px" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Authentic skeleton matching OperationsPage.tsx across its modes.
 */
export function OperationsSkeleton({ mode = "live-orders" }: { mode?: string }) {
  const isBoard = mode === "live-orders" || mode === "kitchen";
  const isTable = mode === "order-history" || mode === "inventory";

  return (
    <div style={{ display: "grid", gap: "20px" }} aria-label="Loading Operations" role="status">
      {/* Header + Actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
        <div style={{ display: "grid", gap: "6px" }}>
          <SkeletonBlock height="28px" width="220px" />
          <SkeletonBlock height="16px" width="340px" />
        </div>
        <SkeletonBlock height="38px" width="100px" borderRadius="8px" />
      </div>

      {/* Filter toolbar */}
      <div className="mt-card" style={{ padding: "12px 16px", display: "flex", gap: "12px", alignItems: "center" }}>
        <SkeletonBlock height="38px" width="180px" borderRadius="8px" />
        <SkeletonBlock height="38px" width="240px" borderRadius="8px" />
        <SkeletonBlock height="24px" width="70px" borderRadius="999px" style={{ marginLeft: "auto" }} />
      </div>

      {/* Board layout (kanban columns) */}
      {isBoard ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", minHeight: "440px" }}>
          {Array.from({ length: 3 }, (_, colIndex) => (
            <div key={colIndex} className="mt-card" style={{ padding: "16px", display: "grid", gap: "12px", alignContent: "start" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "8px", borderBottom: "1px solid #eaecf0" }}>
                <SkeletonBlock height="18px" width="80px" />
                <SkeletonBlock height="22px" width="32px" borderRadius="50%" />
              </div>
              {Array.from({ length: 3 }, (_, cardIndex) => (
                <div key={cardIndex} className="mt-card" style={{ padding: "14px", display: "grid", gap: "8px", border: "1px solid #e4e7ec" }}>
                  <SkeletonBlock height="18px" width="90px" />
                  <SkeletonBlock height="14px" width="140px" />
                  <SkeletonBlock height="22px" width="60px" borderRadius="999px" />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : isTable ? (
        <TableSkeleton rows={6} columns={6} />
      ) : (
        <CardGridSkeleton count={6} columns={3} />
      )}
    </div>
  );
}

/**
 * Authentic skeleton matching BusinessInsightsPage.tsx.
 */
export function InsightsSkeleton() {
  return (
    <div style={{ display: "grid", gap: "22px" }} aria-label="Loading Insights" role="status">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "grid", gap: "6px" }}>
          <SkeletonBlock height="28px" width="240px" />
          <SkeletonBlock height="16px" width="300px" />
        </div>
        <SkeletonBlock height="38px" width="110px" borderRadius="8px" />
      </div>

      {/* Period Filter Toolbar */}
      <div className="mt-card" style={{ padding: "12px 18px", display: "flex", gap: "12px", alignItems: "center" }}>
        <SkeletonBlock height="36px" width="220px" borderRadius="8px" />
        <SkeletonBlock height="36px" width="160px" borderRadius="8px" />
      </div>

      {/* 4 Metric KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="mt-card" style={{ padding: "18px", display: "grid", gap: "8px" }}>
            <SkeletonBlock height="14px" width="55%" />
            <SkeletonBlock height="32px" width="70%" />
            <SkeletonBlock height="14px" width="40%" />
          </div>
        ))}
      </div>

      {/* Large Chart Card */}
      <div className="mt-card" style={{ padding: "24px", minHeight: "320px", display: "grid", gap: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <SkeletonBlock height="20px" width="180px" />
          <SkeletonBlock height="28px" width="90px" borderRadius="6px" />
        </div>
        <SkeletonBlock height="240px" borderRadius="8px" />
      </div>

      {/* Breakdown Table */}
      <TableSkeleton rows={4} columns={5} />
    </div>
  );
}

/**
 * Authentic skeleton matching AdministrationModule.tsx.
 */
export function AdministrationSkeleton() {
  return (
    <div style={{ display: "grid", gap: "20px" }} aria-label="Loading Administration" role="status">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "grid", gap: "6px" }}>
          <SkeletonBlock height="28px" width="220px" />
          <SkeletonBlock height="16px" width="360px" />
        </div>
        <SkeletonBlock height="38px" width="90px" borderRadius="8px" />
      </div>

      {/* Tabs navigation */}
      <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid #eaecf0", paddingBottom: "8px" }}>
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonBlock key={i} height="32px" width="100px" borderRadius="6px" />
        ))}
      </div>

      {/* Content grid */}
      <CardGridSkeleton count={6} columns={3} />
    </div>
  );
}

/**
 * Authentic skeleton matching CounterApp.tsx POS screen.
 */
export function CounterPosSkeleton() {
  return (
    <main className="staff-app counter-app-v2" aria-label="Loading Counter POS" role="status" style={{ minHeight: "100vh" }}>
      {/* Counter Header */}
      <header className="staff-header counter-header" style={{ display: "flex", alignItems: "center", gap: "20px", padding: "0 20px" }}>
        <SkeletonBlock height="24px" width="140px" />
        <SkeletonBlock height="20px" width="180px" />
        <div style={{ marginLeft: "auto", display: "flex", gap: "10px", alignItems: "center" }}>
          <SkeletonBlock height="24px" width="90px" borderRadius="999px" />
          <SkeletonBlock height="36px" width="36px" borderRadius="8px" />
        </div>
      </header>

      {/* Primary Nav */}
      <nav className="staff-primary-nav" style={{ display: "flex", gap: "16px", padding: "0 20px" }}>
        <SkeletonBlock height="32px" width="140px" borderRadius="6px" />
        <SkeletonBlock height="32px" width="130px" borderRadius="6px" />
        <SkeletonBlock height="32px" width="140px" borderRadius="6px" />
      </nav>

      {/* Status Strip */}
      <div className="counter-status-strip" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", padding: "12px 20px", gap: "16px" }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={{ display: "grid", gap: "4px" }}>
            <SkeletonBlock height="11px" width="50%" />
            <SkeletonBlock height="16px" width="70%" />
          </div>
        ))}
      </div>

      {/* Main Grid: Products on left, Cart rail on right */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 390px", gap: "16px", margin: "14px 20px" }}>
        {/* Products pane */}
        <div className="mt-card" style={{ padding: "16px", display: "grid", gap: "16px" }}>
          <div style={{ display: "flex", gap: "8px", overflowX: "hidden" }}>
            {Array.from({ length: 5 }, (_, i) => (
              <SkeletonBlock key={i} height="36px" width="110px" borderRadius="8px" />
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "12px" }}>
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="mt-card" style={{ padding: "10px", display: "grid", gap: "8px" }}>
                <SkeletonBlock height="80px" borderRadius="6px" />
                <SkeletonBlock height="14px" width="80%" />
                <SkeletonBlock height="14px" width="50%" />
              </div>
            ))}
          </div>
        </div>

        {/* Cart rail */}
        <div className="mt-card" style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "16px", minHeight: "500px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <SkeletonBlock height="22px" width="120px" />
            <SkeletonBlock height="22px" width="60px" borderRadius="999px" />
          </div>
          <div style={{ display: "grid", gap: "12px", flex: 1 }}>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f2f4f7" }}>
                <div style={{ display: "grid", gap: "4px" }}>
                  <SkeletonBlock height="15px" width="110px" />
                  <SkeletonBlock height="12px" width="60px" />
                </div>
                <SkeletonBlock height="16px" width="50px" />
              </div>
            ))}
          </div>
          <div style={{ borderTop: "1px solid #eaecf0", paddingTop: "12px", display: "grid", gap: "8px" }}>
            <SkeletonBlock height="14px" width="100%" />
            <SkeletonBlock height="20px" width="100%" />
            <SkeletonBlock height="44px" width="100%" borderRadius="8px" style={{ marginTop: "8px" }} />
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * Authentic skeleton matching KitchenApp.tsx display.
 */
export function KitchenDisplaySkeleton() {
  return (
    <main className="staff-app kitchen-app-v2" aria-label="Loading Kitchen Display" role="status" style={{ minHeight: "100vh" }}>
      {/* Kitchen Header */}
      <header className="staff-header kitchen-header" style={{ display: "flex", alignItems: "center", gap: "24px", padding: "0 24px" }}>
        <SkeletonBlock height="26px" width="160px" />
        <SkeletonBlock height="20px" width="200px" />
        <div style={{ marginLeft: "auto", display: "flex", gap: "12px", alignItems: "center" }}>
          <SkeletonBlock height="28px" width="100px" borderRadius="999px" />
          <SkeletonBlock height="36px" width="36px" borderRadius="8px" />
        </div>
      </header>

      {/* Summary Strip (5 metric cards) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "16px", padding: "14px 24px 0" }}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="mt-card" style={{ padding: "14px", display: "flex", alignItems: "center", gap: "12px" }}>
            <SkeletonBlock height="40px" width="40px" borderRadius="8px" />
            <div style={{ display: "grid", gap: "4px", flex: 1 }}>
              <SkeletonBlock height="12px" width="50%" />
              <SkeletonBlock height="24px" width="35%" />
            </div>
          </div>
        ))}
      </div>

      {/* 3 Kanban Kitchen Lanes */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", padding: "16px 24px", minHeight: "520px" }}>
        {Array.from({ length: 3 }, (_, colIndex) => (
          <div key={colIndex} className="mt-card" style={{ padding: "16px", display: "grid", gap: "12px", alignContent: "start" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "10px", borderBottom: "1px solid #eaecf0" }}>
              <SkeletonBlock height="18px" width="90px" />
              <SkeletonBlock height="22px" width="32px" borderRadius="50%" />
            </div>
            {Array.from({ length: 3 }, (_, cardIndex) => (
              <div key={cardIndex} className="mt-card" style={{ padding: "14px", display: "grid", gap: "10px", border: "1px solid #e4e7ec" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <SkeletonBlock height="18px" width="80px" />
                  <SkeletonBlock height="14px" width="50px" />
                </div>
                <SkeletonBlock height="14px" width="90%" />
                <SkeletonBlock height="14px" width="70%" />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                  <SkeletonBlock height="32px" width="80px" borderRadius="6px" />
                  <SkeletonBlock height="32px" width="90px" borderRadius="6px" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
