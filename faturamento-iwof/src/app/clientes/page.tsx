"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { List, Upload } from "lucide-react";

const ClientesList = dynamic(() => import("@/components/clientes/ClientesList"), {
    ssr: false,
});
const ImportWizard = dynamic(() => import("@/components/clientes/ImportWizard"), {
    ssr: false,
});

const TABS = [
    { key: "lista", label: "Lista de Clientes", icon: List },
    { key: "import", label: "Importar Dados", icon: Upload },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function ClientesPage() {
    const [activeTab, setActiveTab] = useState<TabKey>("lista");

    return (
        <>
            <div className="page-header">
                <h1 className="page-title">Clientes</h1>
                <p className="page-description">
                    Gerencie sua base de clientes, cadastre manualmente ou importe via
                    planilha.
                </p>
            </div>

            {/* Tabs */}
            <div className="tabs">
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        className={`tab ${activeTab === tab.key ? "tab-active" : ""}`}
                        onClick={() => setActiveTab(tab.key)}
                    >
                        <tab.icon size={18} />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div style={{ marginTop: 24 }}>
                {activeTab === "lista" && <ClientesList />}
                {activeTab === "import" && <ImportWizard />}
            </div>
        </>
    );
}
