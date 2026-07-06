"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { History, PlusCircle } from "lucide-react";

const CentralLancamentos = dynamic(
    () => import("@/components/lancamentos-parciais/CentralLancamentos"),
    { ssr: false }
);

const PainelHistorico = dynamic(
    () => import("@/components/lancamentos-parciais/PainelHistorico"),
    { ssr: false }
);

export default function LancamentosParciais() {
    const [activeTab, setActiveTab] = useState<"novo" | "historico">("novo");

    return (
        <>
            <div className="page-header" style={{ marginBottom: 16 }}>
                <h1 className="page-title">Central de Lançamentos Parciais</h1>
                <p className="page-description">
                    Processamento de lançamentos parciais para grandes redes e visualização de lotes anteriores.
                </p>
            </div>

            {/* TAB NAVIGATION */}
            <div style={{
                display: "flex", gap: 12, borderBottom: "1px solid var(--border-color)", paddingBottom: 16, marginBottom: 24
            }}>
                <button
                    onClick={() => setActiveTab("novo")}
                    className={`btn ${activeTab === "novo" ? "btn-primary" : "btn-outline"}`}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 8 }}
                >
                    <PlusCircle size={18} />
                    Novo Lote Parcial
                </button>
                <button
                    onClick={() => setActiveTab("historico")}
                    className={`btn ${activeTab === "historico" ? "btn-primary" : "btn-outline"}`}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 8 }}
                >
                    <History size={18} />
                    Histórico de Lotes
                </button>
            </div>

            <div>
                {activeTab === "novo" && <CentralLancamentos />}
                {activeTab === "historico" && <PainelHistorico />}
            </div>
        </>
    );
}
