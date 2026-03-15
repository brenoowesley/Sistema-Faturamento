"use client";

import LotesDashboard from "@/components/saques/acompanhamento/LotesDashboard";

export default function AcompanhamentoPage() {
    return (
        <div className="max-w-7xl mx-auto">
            <header className="page-header">
                <h1 className="page-title">Acompanhamento e Rastreabilidade</h1>
                <p className="page-description">
                    Visualize o histórico de lotes e o status dos pagamentos na Transfeera.
                </p>
            </header>

            <LotesDashboard />
        </div>
    );
}
