"use client";

import LoteDetalhe from "@/components/saques/acompanhamento/LoteDetalhe";

export default function LoteDetalhePage({ params }: { params: { id: string } }) {
    return (
        <div className="max-w-7xl mx-auto">
            <LoteDetalhe loteId={params.id} />
        </div>
    );
}
