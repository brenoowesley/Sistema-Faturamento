"use client";

import GestaoSaques from "@/components/saques/GestaoSaques";
import HistoricoSaques from "@/components/saques/HistoricoSaques";

export default function SaquesPage() {
    return (
        <div className="max-w-7xl mx-auto">
            <header className="page-header">
                <h1 className="page-title">Gestão de Saques</h1>
                <p className="page-description">
                    Importe, valide e exporte lotes de pagamento via PIX para o gateway Transfeera.
                </p>
            </header>

            <GestaoSaques />

            <div className="mt-12">
                <HistoricoSaques />
            </div>
        </div>
    );
}
