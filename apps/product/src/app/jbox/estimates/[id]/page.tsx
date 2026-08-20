export default async function EstimateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div style={{ padding: "2rem", color: "#e2e8f0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "2rem",
        }}
      >
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#f59e0b" }}>
          Bid #{id}
        </h1>
        <a
          href="/jbox/estimates"
          style={{
            color: "#94a3b8",
            textDecoration: "none",
            fontSize: "0.875rem",
          }}
        >
          &larr; All Estimates
        </a>
      </div>

      <div
        style={{
          display: "flex",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <a
          href={`/jbox/estimates/${id}/sketch`}
          style={{
            display: "inline-block",
            padding: "0.625rem 1.25rem",
            background: "#f59e0b",
            color: "#0f172a",
            borderRadius: "0.375rem",
            fontWeight: 600,
            fontSize: "0.875rem",
            textDecoration: "none",
          }}
        >
          Open Sketch Canvas
        </a>
      </div>

      <div
        style={{
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: "0.5rem",
          padding: "1.5rem",
          marginBottom: "1.5rem",
        }}
      >
        <h2
          style={{
            fontSize: "1.125rem",
            fontWeight: 600,
            marginBottom: "0.75rem",
            color: "#f59e0b",
          }}
        >
          Scope of Work &amp; Fixed Estimate
        </h2>
        <p style={{ color: "#64748b", fontSize: "0.875rem" }}>
          No scope items yet. Connect a database to start building out this bid.
        </p>
      </div>

      <div
        style={{
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: "0.5rem",
          padding: "1.5rem",
        }}
      >
        <h2
          style={{
            fontSize: "1.125rem",
            fontWeight: 600,
            marginBottom: "0.75rem",
            color: "#f59e0b",
          }}
        >
          Bid Actions
        </h2>
        <p style={{ color: "#64748b", fontSize: "0.875rem" }}>
          No actions available. This is a stub page while the data layer is
          being built.
        </p>
      </div>
    </div>
  );
}
