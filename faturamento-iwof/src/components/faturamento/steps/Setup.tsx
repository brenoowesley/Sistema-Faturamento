"use client";

import { useCallback, useState } from "react";
import { UploadCloud, CheckCircle2, ChevronRight, FileSpreadsheet, X } from "lucide-react";
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
    processFile: (rows: Record<string, string>[]) => Promise<void>;
    processing: boolean;
    setFileName: (name: string) => void;
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
    processFile,
    processing,
    setFileName
}: SetupProps) {
    const [file, setFile] = useState<File | null>(null);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) {
            setFile(acceptedFiles[0]);
            setFileName(acceptedFiles[0].name);
        }
    }, [setFileName]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            "text/csv": [".csv"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
            "application/vnd.ms-excel": [".xls"],
        },
        maxFiles: 1,
    });

    const handleProcess = async () => {
        if (!file) return;

        const reader = new FileReader();

        if (file.name.endsWith(".csv")) {
            reader.onload = async (e) => {
                const text = e.target?.result as string;
                Papa.parse(text, {
                    header: true,
                    skipEmptyLines: true,
                    complete: async (results) => {
                        await processFile(results.data as Record<string, string>[]);
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

                // Normalizando as chaves para lowercase e trim
                const normalizedData = rawData.map(row => {
                    const newRow: Record<string, string> = {};
                    for (const key in row) {
                        newRow[key.trim().toLowerCase()] = String(row[key]);
                    }
                    return newRow;
                });

                await processFile(normalizedData);
            };
            reader.readAsArrayBuffer(file);
        }
    };

    const isReady = file && periodoInicio && periodoFim && selectedCicloIds.length > 0;

    return (
        <div className="flex flex-col gap-6 max-w-4xl mx-auto">
            <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-white mb-2">Setup Inicial do Lote</h2>
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
                            className="input w-full bg-[var(--bg-card)] border-[var(--border)] focus:border-[var(--accent)] text-white"
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
                            className="input w-full bg-[var(--bg-card)] border-[var(--border)] focus:border-[var(--accent)] text-white"
                            value={periodoFim}
                            onChange={(e) => setPeriodoFim(e.target.value)}
                        />
                    </div>
                    <div className="md:col-span-2 lg:col-span-1">
                        <label className="block text-sm font-semibold text-[var(--fg-dim)] mb-2 inline-flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]"></span>
                            Ciclo(s)
                        </label>
                        <select
                            multiple
                            className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-[var(--accent)] transition-colors text-white h-[42px] custom-scrollbar"
                            value={selectedCicloIds}
                            onChange={(e) => {
                                const options = Array.from(e.target.selectedOptions);
                                setSelectedCicloIds(options.map(o => o.value));
                            }}
                            title="Segure CTRL (ou CMD) para selecionar múltiplos ciclos"
                        >
                            {ciclos.map(c => (
                                <option key={c.id} value={c.id} className="py-1">
                                    {c.nome}
                                </option>
                            ))}
                        </select>
                        <p className="text-[10px] text-[var(--fg-muted)] mt-1">Geralmente "A2" ou "M2". Segure CRTL para múltiplos.</p>
                    </div>
                </div>
            </div>

            <div
                {...getRootProps()}
                className={`relative overflow-hidden group border-2 border-dashed rounded-3xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 min-h-[250px] ${isDragActive ? "border-[var(--accent)] bg-[rgba(33,118,255,0.05)]" :
                    file ? "border-[var(--success)] bg-[rgba(34,197,94,0.05)]" :
                        "border-[var(--border)] bg-[var(--bg-sidebar)] hover:border-[var(--fg-dim)]"
                    }`}
            >
                <input {...getInputProps()} />

                {file ? (
                    <div className="flex flex-col items-center gap-4 relative z-10 animate-in zoom-in duration-300">
                        <div className="w-16 h-16 rounded-2xl bg-[var(--success)]/20 flex items-center justify-center border border-[var(--success)]/30">
                            <FileSpreadsheet size={32} className="text-[var(--success)]" />
                        </div>
                        <div>
                            <p className="font-bold text-white text-lg">{file.name}</p>
                            <p className="text-xs text-[var(--success)] font-medium mt-1">Pronto para processamento</p>
                        </div>
                        <button
                            className="btn btn-sm btn-ghost text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white rounded-full mt-2"
                            onClick={(e) => { e.stopPropagation(); setFile(null); }}
                        >
                            <X size={14} className="mr-1" /> Remover
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-4 relative z-10">
                        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-colors ${isDragActive ? "bg-[var(--accent)] text-white" : "bg-[var(--bg-card)] text-[var(--fg-dim)] group-hover:text-[var(--accent)] group-hover:bg-[rgba(33,118,255,0.1)]"}`}>
                            <UploadCloud size={32} className={isDragActive ? "animate-bounce" : ""} />
                        </div>
                        <div>
                            <p className="font-bold text-white text-lg mb-1">Arraste a Planilha da Iwof</p>
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
