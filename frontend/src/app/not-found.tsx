import Link from "next/link";

export default function RootNotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "#f8fafc",
      }}
    >
      <div
        className="mt-feedback-state"
        style={{
          maxWidth: "480px",
          width: "100%",
          padding: "36px 28px",
          borderRadius: "16px",
          background: "#fff",
          border: "1px solid #e4e7ec",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <span
          style={{
            fontSize: "13px",
            fontWeight: 700,
            padding: "4px 10px",
            borderRadius: "999px",
            background: "#eff8ff",
            color: "#175cd3",
          }}
        >
          404 Not Found
        </span>
        <h1 style={{ margin: "4px 0 0", fontSize: "22px", fontWeight: 700, color: "#101828" }}>
          Page not found
        </h1>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: "22px", color: "#667085" }}>
          The page you are looking for does not exist, has been removed, or is temporarily unavailable.
        </p>
        <div style={{ marginTop: "8px" }}>
          <Link href="/" className="mt-button mt-button--primary">
            Return to PlaceURorder
          </Link>
        </div>
      </div>
    </main>
  );
}
