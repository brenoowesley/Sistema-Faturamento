"use client";

import LoteDetalhe from "@/components/saques/acompanhamento/LoteDetalhe";
import { use } from "react";

export default function LoteDetalhePage({ params }: { params: Promise<{ id: string }> }) {
    const resolvedParams = use(params);
    return (
        <div className="max-w-7xl mx-auto">
            <LoteDetalhe loteId={resolvedParams.id} />
        </div>
    );
}
