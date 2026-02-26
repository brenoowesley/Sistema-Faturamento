"use client";

import dynamic from "next/dynamic";

const CentralLancamentos = dynamic(
    () => import("@/components/lancamentos-parciais/CentralLancamentos"),
    { ssr: false }
);

export default function LancamentosParciais() {
    return (
        <>
            <div className="page-header">
                <h1 className="page-title">Central de Lançamentos Parciais</h1>
                <p className="page-description">
                    Processamento de lançamentos parciais para grandes redes. Upload da planilha, matching de lojas, enriquecimento via XML e exportação NFE.io / GCP.
                </p>
            </div>
            <div style={{ marginTop: 24 }}>
                <CentralLancamentos />
            </div>
        </>
    );
}
