"use client";

import { useState } from "react";
import Step1Upload from "./Step1Upload";
import Step2Validacao from "./Step2Validacao";
import Step3Envio from "./Step3Envio";
import { CheckCircle2, UploadCloud, ListChecks, Send } from "lucide-react";

export type TriagemFile = {
    file: File;
    status: 'pending' | 'success' | 'error';
    clienteNome?: string;
    cicloId?: string;
    cicloNome?: string;
    nfNumber?: string;
    errorMessage?: string;
    matchConfidence?: string;
};

export default function WizardTriagem() {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [arquivosProcessados, setArquivosProcessados] = useState<TriagemFile[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    const stepsInfo = [
        { num: 1, title: "Upload", icon: UploadCloud },
        { num: 2, title: "Validação", icon: ListChecks },
        { num: 3, title: "Disparo", icon: Send },
    ];

    return (
        <div className="flex flex-col gap-6">
            {/* Stepper Progress */}
            <div className="card w-full mb-6">
                <div className="flex items-center justify-between relative">
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-[var(--border)] z-0 rounded-full"></div>

                    <div
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-[var(--accent)] z-0 transition-all duration-300 rounded-full"
                        style={{ width: `${((step - 1) / 2) * 100}%` }}
                    ></div>

                    {stepsInfo.map((s) => {
                        const active = step >= s.num;
                        const isCurrent = step === s.num;
                        return (
                            <div key={s.num} className="relative z-10 flex flex-col items-center gap-2">
                                <div className={`w-12 h-12 rounded-full flex items-center justify-center border-4 transition-colors duration-300 ${active
                                        ? 'bg-[var(--accent)] border-[var(--bg-card)] text-white shadow-[0_0_15px_var(--accent-glow)]'
                                        : 'bg-[var(--bg)] border-[var(--border-light)] text-[var(--fg-dim)]'
                                    }`}>
                                    {active && !isCurrent ? <CheckCircle2 size={20} /> : <s.icon size={20} />}
                                </div>
                                <span className={`text-xs font-bold uppercase tracking-wider ${active ? 'text-white' : 'text-[var(--fg-dim)]'}`}>
                                    {s.title}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Step Content */}
            <div className="w-full">
                {step === 1 && (
                    <Step1Upload
                        onNext={(files) => {
                            setArquivosProcessados(files);
                            setStep(2);
                        }}
                        setIsProcessing={setIsProcessing}
                        isProcessing={isProcessing}
                    />
                )}

                {step === 2 && (
                    <Step2Validacao
                        arquivos={arquivosProcessados}
                        setArquivos={setArquivosProcessados}
                        onBack={() => setStep(1)}
                        onNext={() => setStep(3)}
                    />
                )}

                {step === 3 && (
                    <Step3Envio
                        arquivos={arquivosProcessados}
                        onBack={() => setStep(2)}
                        onComplete={() => {
                            setArquivosProcessados([]);
                            setStep(1);
                        }}
                    />
                )}
            </div>
        </div>
    );
}
