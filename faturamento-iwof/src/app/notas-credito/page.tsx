"use client";

import dynamic from "next/dynamic";

const EmissaoNotaCredito = dynamic(
    () => import("@/components/notas-credito/EmissaoNotaCredito"),
    { ssr: false }
);

export default function EmissaoNotaCreditoPage() {
    return (
        <>
            <div className="page-header">
                <h1 className="page-title">Emissão de Notas de Crédito</h1>
                <p className="page-description">
                    Faça o upload da planilha NC (CSV ou XLSX), revise o preview e dispare a emissão para o GCP.
                </p>
            </div>
            <div style={{ marginTop: 24 }}>
                <EmissaoNotaCredito />
            </div>
        </>
    );
}
