"use client";

import dynamic from "next/dynamic";

const WizardFaturamento = dynamic(
    () => import("@/components/faturamento/WizardFaturamento"),
    { ssr: false }
);

export default function NovoFaturamentoPage() {
    return (
        <div className="pt-4">
            <WizardFaturamento />
        </div>
    );
}
