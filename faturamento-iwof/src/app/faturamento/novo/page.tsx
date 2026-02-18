"use client";

import dynamic from "next/dynamic";

const NovoFaturamento = dynamic(
    () => import("@/components/faturamento/NovoFaturamento"),
    { ssr: false }
);

export default function NovoFaturamentoPage() {
    return (
        <>
            <div className="page-header">
                <h1 className="page-title">Novo Faturamento</h1>
                <p className="page-description">
                    Configure o período, selecione o ciclo e faça o upload da planilha de agendamentos.
                </p>
            </div>
            <div style={{ marginTop: 24 }}>
                <NovoFaturamento />
            </div>
        </>
    );
}
