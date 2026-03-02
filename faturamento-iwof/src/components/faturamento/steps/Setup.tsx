"use client";

import { useCallback, useState } from "react";
import { UploadCloud, CheckCircle2, ChevronRight, FileSpreadsheet, X, AlertTriangle } from "lucide-react";
import { useDropzone } from "react-dropzone";
import * as Papa from "papaparse";
import * as XLSX from "xlsx";
import { Ciclo } from "../types";

interface SetupProps {
    setCurrentStep: (s: number) => void;
    ciclos: Ciclo[];
    selectedCicloIds: string[];
    setSelectedCicloIds: (ids: string[]) => void;
    periodoInicio: string;
    setPeriodoInicio: (v: string) => void;
    periodoFim: string;
    setPeriodoFim: (v: string) => void;
    nomePasta: string;
    setNomePasta: (v: string) => void;
    processFile: (rows: Record<string, string>[]) => Promise<void>;
    processing: boolean;
    setFileName: (name: string) => void;
    queirozConfig: { splitDate: string; compAnterior: string; compAtual: string; } | null;
    setQueirozConfig: React.Dispatch<React.SetStateAction<{ splitDate: string; compAnterior: string; compAtual: string; } | null>>;
}

export default function Setup({
    setCurrentStep,
    ciclos,
    selectedCicloIds,
    setSelectedCicloIds,
    periodoInicio,
    setPeriodoInicio,
    periodoFim,
    setPeriodoFim,
    nomePasta,
    setNomePasta,
    processFile,
    processing,
    setFileName,
    queirozConfig,
    setQueirozConfig
}: SetupProps) {
    const [files, setFiles] = useState<File[]>([]);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) {
            setFiles(prev => {
                const newFiles = [...prev, ...acceptedFiles];
                setFileName(newFiles.map(f => f.name).join(", "));
                return newFiles;
            });
        }
    }, [setFileName]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            "text/csv": [".csv"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
            "application/vnd.ms-excel": [".xls"],
        },
    });

    const handleProcess = async () => {
        if (files.length === 0) return;

        let allRows: Record<string, string>[] = [];

        for (const file of files) {
            await new Promise<void>((resolve) => {
                const reader = new FileReader();

                if (file.name.endsWith(".csv")) {
                    reader.onload = async (e) => {
                        const text = e.target?.result as string;
                        Papa.parse(text, {
                            header: true,
                            skipEmptyLines: true,
                            complete: (results) => {
                                allRows = [...allRows, ...(results.data as Record<string, string>[])];
                                resolve();
                            },
                        });
                    };
                    reader.readAsText(file);
                } else {
                    reader.onload = async (e) => {
                        const data = new Uint8Array(e.target?.result as ArrayBuffer);
                        const workbook = XLSX.read(data, { type: "array" });
                        const firstSheetName = workbook.SheetNames[0];
                        const worksheet = workbook.Sheets[firstSheetName];
                        const rawData = XLSX.utils.sheet_to_json<Record<string, string>>(worksheet, { defval: "" });

                        const normalizedData = rawData.map(row => {
                            const newRow: Record<string, string> = {};
                            for (const key in row) {
                                newRow[key.trim().toLowerCase()] = String(row[key]);
                            }
                            return newRow;
                        });

                        allRows = [...allRows, ...normalizedData];
                        resolve();
                    };
                    reader.readAsArrayBuffer(file);
                }
            });
        }

        await processFile(allRows);
    };

    const d1_check = periodoInicio ? new Date(periodoInicio + "T12:00:00") : null;
    const d2_check = periodoFim ? new Date(periodoFim + "T12:00:00") : null;
    const isCrossMonth = d1_check && d2_check && (d1_check.getMonth() !== d2_check.getMonth() || d1_check.getFullYear() !== d2_check.getFullYear());

    const isReady = files.length > 0 && periodoInicio && periodoFim && selectedCicloIds.length > 0 && nomePasta.trim().length > 0 && (!isCrossMonth || (queirozConfig?.splitDate && queirozConfig?.compAnterior && queirozConfig?.compAtual));

    return (
        <div className="flex flex-col gap-6 max-w-4xl mx-auto">
            <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-[var(--fg)] mb-2">Setup Inicial do Lote</h2>
                <p className="text-[var(--fg-dim)]">Configure o período, o ciclo de faturamento e envie a planilha base.</p>
            </div>

            <div className="bg-[var(--bg-sidebar)] p-6 rounded-2xl border border-[var(--border)]">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-[var(--fg-dim)] mb-2 inline-flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]"></span>
                            Data Início
                        </label>
                        <input
                            type="date"
                            className="input w-full bg-[var(--bg-card)] border-[var(--border)] focus:border-[var(--accent)] text-[var(--fg)]"
                            value={periodoInicio}
                            onChange={(e) => setPeriodoInicio(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-[var(--fg-dim)] mb-2 inline-flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]"></span>
                            Data Fim
                        </label>
                        <input
                            type="date"
                            className="input w-full bg-[var(--bg-card)] border-[var(--border)] focus:border-[var(--accent)] text-[var(--fg)]"
                            value={periodoFim}
                            onChange={(e) => setPeriodoFim(e.target.value)}
                        />
                    </div>
                    <div className="md:col-span-2 lg:col-span-1">
                        <label className="block text-sm font-semibold text-[var(--fg-dim)] mb-2 inline-flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]"></span>
                            Nome da Pasta no Drive
                        </label>
                        <input
                            type="text"
                            className="input w-full bg-[var(--bg-card)] border-[var(--border)] focus:border-[var(--accent)] text-[var(--fg)]"
                            placeholder="Ex: M1, Semanal, etc."
                            value={nomePasta}
                            onChange={(e) => setNomePasta(e.target.value)}
                        />
                    </div>
                    <div className="md:col-span-2 lg:col-span-3">
                        <label className="block text-sm font-semibold text-[var(--fg-dim)] mb-2 inline-flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]"></span>
                            Ciclos a serem processados
                            <span className="text-[var(--fg-muted)] font-normal text-xs ml-1">(múltipla escolha)</span>
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {ciclos.map(c => {
                                const isSelected = selectedCicloIds.includes(c.id);
                                return (
                                    <button
                                        key={c.id}
                                        className={`badge cursor-pointer transition-all text-sm px-4 py-2 ${isSelected ? "badge-success" : "bg-[var(--bg-sidebar)] border border-[var(--border)] text-[var(--fg-dim)] hover:border-[var(--accent)] hover:text-[var(--accent)]"}`}
                                        style={{ border: isSelected ? "2px solid #22c55e" : undefined }}
                                        onClick={() => setSelectedCicloIds(isSelected ? selectedCicloIds.filter(id => id !== c.id) : [...selectedCicloIds, c.id])}
                                    >
                                        {isSelected && "✓ "}{c.nome}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {isCrossMonth && (
                <div className="bg-[var(--bg-sidebar)] border border-amber-500/30 rounded-2xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                        <AlertTriangle size={100} />
                    </div>
                    <h3 className="text-lg font-bold text-amber-500 mb-4 flex items-center gap-2 relative z-10">
                        <AlertTriangle size={20} /> Lote Multi-Mês (Regra Queiroz)
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
                        <div>
                            <label className="block text-sm font-semibold text-[var(--fg-dim)] mb-2 inline-flex items-center gap-2">
                                Data de Corte
                            </label>
                            <input
                                type="date"
                                className="input w-full bg-[var(--bg-card)] border-[var(--border)] focus:border-amber-500 text-[var(--fg)]"
                                value={queirozConfig?.splitDate || ""}
                                onChange={(e) => setQueirozConfig(prev => ({ splitDate: e.target.value, compAnterior: prev?.compAnterior || "", compAtual: prev?.compAtual || "" }))}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-[var(--fg-dim)] mb-2 inline-flex items-center gap-2">
                                Comp. Anterior
                            </label>
                            <input
                                type="month"
                                className="input w-full bg-[var(--bg-card)] border-[var(--border)] focus:border-amber-500 text-[var(--fg)]"
                                value={queirozConfig?.compAnterior || ""}
                                onChange={(e) => setQueirozConfig(prev => ({ splitDate: prev?.splitDate || "", compAnterior: e.target.value, compAtual: prev?.compAtual || "" }))}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-[var(--fg-dim)] mb-2 inline-flex items-center gap-2">
                                Comp. Atual
                            </label>
                            <input
                                type="month"
                                className="input w-full bg-[var(--bg-card)] border-[var(--border)] focus:border-amber-500 text-[var(--fg)]"
                                value={queirozConfig?.compAtual || ""}
                                onChange={(e) => setQueirozConfig(prev => ({ splitDate: prev?.splitDate || "", compAnterior: prev?.compAnterior || "", compAtual: e.target.value }))}
                            />
                        </div>
                    </div>
                </div>
            )}

            <div
                {...getRootProps()}
                className={`relative overflow-hidden group border-2 border-dashed rounded-3xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 min-h-[250px] ${isDragActive ? "border-[var(--accent)] bg-[rgba(33,118,255,0.05)]" :
                    files.length > 0 ? "border-[var(--success)] bg-[rgba(34,197,94,0.05)]" :
                        "border-[var(--border)] bg-[var(--bg-sidebar)] hover:border-[var(--fg-dim)]"
                    }`}
            >
                <input {...getInputProps()} />

                {files.length > 0 ? (
                    <div className="flex flex-col items-center gap-4 relative z-10 animate-in zoom-in duration-300 w-full max-w-lg">
                        <div className="w-16 h-16 rounded-2xl bg-[var(--success)]/20 flex items-center justify-center border border-[var(--success)]/30">
                            <FileSpreadsheet size={32} className="text-[var(--success)]" />
                        </div>
                        <div className="text-center">
                            <p className="font-bold text-[var(--fg)] text-lg">{files.length} arquivo(s) selecionado(s)</p>
                            <p className="text-xs text-[var(--success)] font-medium mt-1">Pronto para processamento</p>
                        </div>
                        <div className="flex flex-col gap-2 w-full mt-2">
                            {files.map((f, i) => (
                                <div key={i} className="flex items-center justify-between bg-[var(--bg-card)] border border-[var(--success)]/30 p-2 rounded-lg">
                                    <span className="text-sm text-[var(--fg)] truncate max-w-[80%]">{f.name}</span>
                                    <button
                                        className="btn btn-sm btn-ghost text-[var(--danger)] px-2 h-auto py-1"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const newFiles = files.filter((_, index) => index !== i);
                                            setFiles(newFiles);
                                            setFileName(newFiles.map(file => file.name).join(", "));
                                        }}
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                        {isDragActive && (
                            <div className="mt-4 text-[var(--accent)] font-semibold text-sm">
                                Solte para adicionar mais arquivos...
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-4 relative z-10">
                        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-colors ${isDragActive ? "bg-[var(--accent)] text-white" : "bg-[var(--bg-card)] text-[var(--fg-dim)] group-hover:text-[var(--accent)] group-hover:bg-[rgba(33,118,255,0.1)]"}`}>
                            <UploadCloud size={32} className={isDragActive ? "animate-bounce" : ""} />
                        </div>
                        <div>
                            <p className="font-bold text-[var(--fg)] text-lg mb-1">Arraste a Planilha da Iwof</p>
                            <p className="text-sm text-[var(--fg-dim)]">.csv ou .xlsx gerado pelo Admin</p>
                        </div>
                    </div>
                )}

                {/* Background glow effect on drag */}
                {isDragActive && <div className="absolute inset-0 bg-gradient-to-tr from-[rgba(33,118,255,0.1)] to-transparent opacity-50 pointer-events-none"></div>}
            </div>

            <div className="flex justify-end pt-4 border-t border-[var(--border)]">
                <button
                    className="btn btn-primary btn-lg px-8 flex items-center gap-2 min-w-[200px] justify-center"
                    disabled={!isReady || processing}
                    onClick={handleProcess}
                >
                    {processing ? (
                        <>
                            <span className="loading loading-spinner w-5 h-5"></span>
                            Processando Lógica...
                        </>
                    ) : (
                        <>
                            Validar Planilha <ChevronRight size={20} />
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}

