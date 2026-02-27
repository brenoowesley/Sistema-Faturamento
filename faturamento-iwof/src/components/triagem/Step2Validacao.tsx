"use client";

import { useEffect, useState } from "react";
import { TriagemFile } from "./WizardTriagem";
import { CheckCircle2, AlertTriangle, AlertCircle, FileText, ChevronRight, XCircle } from "lucide-react";

interface Step2ValidacaoProps {
    arquivos: TriagemFile[];
    setArquivos: (files: TriagemFile[]) => void;
    onBack: () => void;
    onNext: () => void;
}

export default function Step2Validacao({ arquivos, setArquivos, onBack, onNext }: Step2ValidacaoProps) {
    const [isMapping, setIsMapping] = useState(true);
    const [notasMapeamento, setNotasMapeamento] = useState<Record<string, string>>({});

    // Simulating cycle options (in a real app, you might fetch these from backend)
    const ciclosOptions = ["Ciclo 1", "Ciclo 2", "Ciclo 3", "Ciclo 4", "Semanal"];

    useEffect(() => {
        let isMounted = true;
        async function fetchMappingAndProcess() {
            try {
                // Fetch dictionary mapping
                const res = await fetch('/api/documentos/notas-mapeamento');
                const data = await res.json();
                const mapping = data.mapeamento || {};

                if (isMounted) {
                    setNotasMapeamento(mapping);
                    processFilesWithMapping(arquivos, mapping);
                }
            } catch (error) {
                console.error("Erro ao buscar mapeamento:", error);
                if (isMounted) {
                    // Fallback to purely name-based guessing if mapping fails
                    processFilesWithMapping(arquivos, {});
                }
            }
        }

        if (arquivos.length > 0 && isMapping) {
            fetchMappingAndProcess();
        }
    }, [arquivos]); // eslint-disable-line react-hooks/exhaustive-deps

    const processFilesWithMapping = (files: TriagemFile[], mapping: Record<string, string>) => {
        const updatedFiles = files.map(item => {
            const fileName = item.file.name;
            let identifiedName = "";
            let matchConfidence = "none";
            let nfNumberClean = "";

            if (fileName.toLowerCase().endsWith('-nfse.pdf')) {
                // Extraction rule: grab the last 5 digits before "-nfse.pdf"
                const parts = fileName.split('-nfse.pdf')[0].split('-');
                const possibleNf = parts[parts.length - 1];

                // Usually it's a 5 digit number. 
                if (/^\d{1,6}$/.test(possibleNf)) {
                    nfNumberClean = possibleNf;
                    // Check dictionary
                    if (mapping[nfNumberClean]) {
                        identifiedName = mapping[nfNumberClean];
                        matchConfidence = "high";
                    }
                }
            } else {
                // Boleto fallback heuristic logic using clean names (mock implementation)
                const cleanName = fileName.replace('.pdf', '').replace(/[\-_0-9]/g, ' ').trim().toUpperCase();

                // We'd ideally do a Levenshtein distance check against all unique clients here.
                // Since we don't have the clients list injected yet, we'll mark it as manual review if we can't be sure
                if (cleanName.length > 3) {
                    identifiedName = cleanName;
                    matchConfidence = "medium";
                }
            }

            return {
                ...item,
                clienteNome: identifiedName,
                nfNumber: nfNumberClean,
                matchConfidence,
                cicloNome: "", // Needs to be selected manually or defaulted
            };
        });

        setArquivos(updatedFiles);
        setIsMapping(false);
    };

    const handleCycleChange = (index: number, newCycle: string) => {
        const arr = [...arquivos];
        arr[index].cicloNome = newCycle;
        setArquivos(arr);
    };

    const handleRemove = (index: number) => {
        const arr = [...arquivos];
        arr.splice(index, 1);
        setArquivos(arr);
    };

    const handleNameManualChange = (index: number, newName: string) => {
        const arr = [...arquivos];
        arr[index].clienteNome = newName;
        // If they manually type a name, we assume they fixed it
        arr[index].matchConfidence = newName.trim() === "" ? "none" : "manual";
        setArquivos(arr);
    }

    const unassignedCount = arquivos.filter(a => !a.clienteNome || !a.cicloNome).length;

    return (
        <div className="flex flex-col gap-6">
            <div className="card">
                <div className="flex flex-col mb-4">
                    <h2 className="text-xl font-bold text-[var(--fg)] mb-2">Validação e Relacionamento</h2>
                    <p className="text-sm text-[var(--fg-dim)]">O sistema tentou adivinhar os nomes de clientes e números de nota. Revise se os nomes estão corretos e defina qual é a pasta do Ciclo.</p>
                </div>

                {unassignedCount > 0 && !isMapping && (
                    <div className="bg-[rgba(245,158,11,0.1)] border border-[var(--warning)] p-4 rounded-xl flex items-center gap-3 mb-6">
                        <AlertTriangle size={20} className="text-[var(--warning)]" />
                        <span className="text-sm font-medium text-[var(--warning)]">
                            Existem {unassignedCount} arquivo(s) faltando o Cliente ou o Ciclo de Faturamento.
                        </span>
                    </div>
                )}

                <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Status</th>
                                    <th>Arquivo Original</th>
                                    <th>Cliente Identificado</th>
                                    <th>Ciclo</th>
                                    <th className="text-right">Ação</th>
                                </tr>
                            </thead>
                            <tbody>
                                {isMapping ? (
                                    <tr>
                                        <td colSpan={5} className="text-center py-12">
                                            <div className="flex flex-col items-center gap-3 justify-center text-[var(--fg-dim)]">
                                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]"></div>
                                                <p>Processando e mapeando arquivos...</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : arquivos.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="table-empty">Nenhum arquivo na fila.</td>
                                    </tr>
                                ) : (
                                    arquivos.map((a, i) => {
                                        const isOk = a.clienteNome && a.clienteNome.length > 2 && a.cicloNome;
                                        return (
                                            <tr key={i} className={isOk ? "bg-[rgba(52,211,153,0.03)]" : "bg-[rgba(248,113,113,0.03)]"}>
                                                <td>
                                                    {isOk ? (
                                                        <CheckCircle2 size={18} className="text-[var(--success)]" />
                                                    ) : (
                                                        <AlertCircle size={18} className="text-[var(--danger)]" />
                                                    )}
                                                </td>
                                                <td>
                                                    <div className="flex items-center gap-2">
                                                        <FileText size={16} className="text-[var(--fg-dim)]" />
                                                        <span className="text-sm font-medium text-[var(--fg)] max-w-[200px] truncate" title={a.file.name}>
                                                            {a.file.name}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <input
                                                        type="text"
                                                        className={`input h-9 text-sm ${a.matchConfidence === 'high' ? 'border-[var(--success)] focus:border-[var(--success)]' : a.matchConfidence === 'none' ? 'border-[var(--danger)] focus:border-[var(--danger)]' : ''}`}
                                                        placeholder="Nome da Loja"
                                                        value={a.clienteNome || ""}
                                                        onChange={(e) => handleNameManualChange(i, e.target.value)}
                                                    />
                                                    {a.nfNumber && (
                                                        <span className="text-[10px] text-[var(--fg-dim)] mt-1 block tracking-wider">
                                                            NF Extraída: <strong className="text-[var(--fg)]">{a.nfNumber}</strong>
                                                        </span>
                                                    )}
                                                </td>
                                                <td>
                                                    <select
                                                        className={`input h-9 text-sm bg-transparent appearance-none ${!a.cicloNome ? 'border-[var(--danger)] text-[var(--danger)]' : ''}`}
                                                        value={a.cicloNome || ""}
                                                        onChange={(e) => handleCycleChange(i, e.target.value)}
                                                    >
                                                        <option value="" disabled className="bg-[var(--bg-card)]">Selecione o Ciclo</option>
                                                        {ciclosOptions.map(c => (
                                                            <option key={c} value={c} className="bg-[var(--bg-card)] text-[var(--fg)]">{c}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td className="text-right">
                                                    <button
                                                        className="btn btn-ghost btn-xs w-8 h-8 p-0 text-[var(--fg-dim)] hover:text-[var(--danger)] hover:bg-[rgba(248,113,113,0.1)]"
                                                        onClick={() => handleRemove(i)}
                                                        title="Remover arquivo"
                                                    >
                                                        <XCircle size={16} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="flex justify-between mt-4">
                <button className="btn btn-ghost" onClick={onBack}>
                    Voltar
                </button>
                <button
                    className="btn btn-primary"
                    onClick={onNext}
                    disabled={isMapping || unassignedCount > 0 || arquivos.length === 0}
                >
                    Confirmar Envio <ChevronRight size={18} />
                </button>
            </div>
        </div>
    );
}
