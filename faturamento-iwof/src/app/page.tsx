import { LayoutDashboard } from "lucide-react";

export default function DashboardPage() {
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-description">
          Visão geral do faturamento e indicadores financeiros.
        </p>
      </div>

      {/* Placeholder KPI cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: "20px",
        }}
      >
        {["Faturamento Mensal", "Clientes Ativos", "Lotes Pendentes", "Ajustes"].map(
          (title) => (
            <div key={title} className="card">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "16px",
                }}
              >
                <span
                  style={{ fontSize: "13px", color: "var(--fg-muted)", fontWeight: 500 }}
                >
                  {title}
                </span>
                <LayoutDashboard size={18} style={{ color: "var(--fg-dim)" }} />
              </div>
              <p style={{ fontSize: "28px", fontWeight: 700, color: "#fff" }}>--</p>
              <p
                style={{ fontSize: "12px", color: "var(--fg-dim)", marginTop: "4px" }}
              >
                Dados serão carregados em breve
              </p>
            </div>
          )
        )}
      </div>
    </>
  );
}
