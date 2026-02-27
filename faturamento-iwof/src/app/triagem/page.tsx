"use client";

import { useState } from "react";
import WizardTriagem from "@/components/triagem/WizardTriagem";
import { ThemeProvider } from "next-themes"; // we already have it in layout, but just in case, or we just rely on layout

export default function TriagemPage() {
    return (
        <div className="max-w-6xl mx-auto p-6">
            <header className="mb-8">
                <h1 className="text-3xl font-bold text-white mb-2">Triagem e Disparo de Faturamento</h1>
                <p className="text-[var(--fg-muted)]">Faça o upload de boletos individuais em PDF ou pacotes de NFs em ZIP para organizar e disparar para os clientes.</p>
            </header>

            <WizardTriagem />
        </div>
    );
}
