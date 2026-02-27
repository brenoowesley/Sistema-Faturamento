"use client";

import { useState, useMemo, useRef } from "react";
import { ArrowLeft, CheckCircle2, ShieldCheck, FileText, UploadCloud, CloudLightning, Mail, AlertTriangle, Info, FileStack, X } from "lucide-react";
import { Agendamento, FinancialSummary } from "../types";
import { fmtCurrency, normalizarNome } from "../utils";

interface FechamentoLoteProps {
    setCurrentStep: (s: number) => void;
    agendamentos: Agendamento[];
    nfseFiles: { name: string; blob: Blob; buffer: ArrayBuffer }[];
    financialSummary: FinancialSummary;
    handleFecharLote: () => void;
    saving: boolean;
    periodoInicio: string;
    periodoFim: string;
    nomePasta: string;
}

export default function FechamentoLote({
    setCurrentStep,
    agendamentos,
    nfseFiles,
    financialSummary,
    handleFecharLote,
    saving,
    periodoInicio,
    periodoFim,
    nomePasta
}: FechamentoLoteProps) {

    const [boletoFiles, setBoletoFiles] = useState<{ name: string; fetchUrl: string; file: File }[]>([]);
    const [uploadingGcp, setUploadingGcp] = useState(false);
    const [gcpSuccess, setGcpSuccess] = useState(false);
    const [emailDispatched, setEmailDispatched] = useState(false);
    const [isSendingEmails, setIsSendingEmails] = useState(false);

    const boletosInputRef = useRef<HTMLInputElement>(null);

    const matchFiles = useMemo(() => {
        const validados = agendamentos.filter(a =>
            !a.isRemoved &&
            (a.status === "OK" || a.status === "CORREÇÃO") &&
            a.clienteId
        );

        const lojasUnicas = new Map<string, { nome: string; id: string; razaoSocial: string; totalFaturar: number }>();
        for (const a of validados) {
            if (!lojasUnicas.has(a.clienteId!)) {
                lojasUnicas.set(a.clienteId!, {
                    id: a.clienteId!,
                    nome: a.loja,
                    razaoSocial: a.razaoSocial || a.loja,
                    totalFaturar: 0
                });
            }
            lojasUnicas.get(a.clienteId!)!.totalFaturar += a.status === "CORREÇÃO" ? (a.suggestedValorIwof ?? a.valorIwof) : (a.manualValue ?? a.valorIwof);
        }

        const reports = Array.from(lojasUnicas.values()).map(loja => {
            const normalizedStoreName = normalizarNome(loja.nome);

            // Look for matching NFSE
            const nfseMatch = nfseFiles.find(f => normalizarNome(f.name.replace(/nfse|nfe|\.pdf|\.xml/gi, "")).includes(normalizedStoreName) || normalizedStoreName.includes(normalizarNome(f.name.replace(/nfse|nfe|\.pdf|\.xml/gi, ""))));

            // Look for matching Boleto
            const boletoMatch = boletoFiles.find(f => normalizarNome(f.name.replace(/boleto|\.pdf/gi, "")).includes(normalizedStoreName) || normalizedStoreName.includes(normalizarNome(f.name.replace(/boleto|\.pdf/gi, ""))));

            return {
                ...loja,
                nfse: nfseMatch || null,
                boleto: boletoMatch || null
            };
        });

        // Orfans (Files that didn't match any store)
        const matchedNfseNames = new Set(reports.map(r => r.nfse?.name).filter(Boolean));
        const matchedBoletoNames = new Set(reports.map(r => r.boleto?.name).filter(Boolean));

        const orphanNfses = nfseFiles.filter(f => !matchedNfseNames.has(f.name));
        const orphanBoletos = boletoFiles.filter(f => !matchedBoletoNames.has(f.name));

        return { reports, orphanNfses, orphanBoletos };
    }, [agendamentos, nfseFiles, boletoFiles]);

    const handleBoletoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return;
        const files = Array.from(e.target.files).map(f => ({
            name: f.name,
            file: f,
            fetchUrl: URL.createObjectURL(f)
        }));
        setBoletoFiles(prev => [...prev, ...files]);
    };

    const handleMoveToGcp = async () => {
        setUploadingGcp(true);
        try {
            // First, trigger saving to Database (the handleFecharLote logic from WizardFaturamento)
            await handleFecharLote();

            // Next, we would assemble multipart form data and send the matching files
            // Mocking for now as per instructions to move to API route later
            await new Promise(r => setTimeout(r, 2000));
            setGcpSuccess(true);
        } catch (e) {
            console.error("Erro no GCP", e);
            alert("Falha ao organizar diretórios no Google Drive");
        } finally {
            setUploadingGcp(false);
        }
    };

    const handleDispararEmails = async () => {
        setIsSendingEmails(true);
        try {
            const res = await fetch("/api/faturamento/disparar-emails", { method: "POST" });
            if (!res.ok) throw new Error("Erro ao disparar e-mails");
            setEmailDispatched(true);
        } catch (error) {
            console.error(error);
            alert("A etapa finalizou com bugs durante envio de e-mail.");
        } finally {
            setIsSendingEmails(false);
        }
    };

    const totals = financialSummary.summaryArr.find(v => v.ciclo === "LÍQUIDO P/ LOTE");

    return (
        <div className="flex flex-col gap-6 max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-2">
                <button className="btn btn-ghost text-[var(--fg-dim)] hover:text-white" onClick={() => setCurrentStep(4)}>
                    <ArrowLeft size={16} /> Voltar Módulo NFE
                </button>
                <div className="flex items-center gap-2 text-[var(--success)] bg-[rgba(34,197,94,0.1)] px-3 py-1.5 rounded-full text-xs font-bold border border-[rgba(34,197,94,0.2)] shadow-[0_0_15px_rgba(34,197,94,0.1)]">
                    <ShieldCheck size={14} /> Dados Prontos
                </div>
            </div>

            <div className="text-center mb-8">
                <h2 className="text-3xl font-black text-white mb-2">Fechamento e Triagem Final</h2>
                <p className="text-[var(--fg-dim)] text-sm max-w-2xl mx-auto">
                    Auditoria final. Atrele os boletos aos XML/PDFs das notas emitidas, faça a injeção conjunta do lote no Banco de Dados (Supabase) + Arquivos no Drive (GCP) e lance as cobranças.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-6">

                {/* Tabela Relatório de Conferência */}
                <div className="bg-[var(--bg-sidebar)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-lg">
                    <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[rgba(0,0,0,0.2)]">
                        <div>
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <FileStack size={20} className="text-[var(--accent)]" /> Relatório de Conferência (Matches Automáticos)
                            </h3>
                            <p className="text-xs text-[var(--fg-dim)] mt-1">Status de acoplagem dos arquivos com {matchFiles.reports.length} empresas.</p>
                        </div>
                        <div className="text-right">
                            <p className="text-sm font-semibold text-white">Total: {totals?.empresasCount} Lojas</p>
                            <p className="text-[10px] text-[var(--success)] font-mono">{fmtCurrency(totals?.total || 0)} LÍQUIDOS</p>
                        </div>
                    </div>

                    <div className="max-h-[500px] overflow-y-auto custom-scrollbar p-0">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-[var(--bg-card)] sticky top-0 shadow-sm z-10 border-b border-[var(--border)]">
                                <tr>
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold uppercase text-[10px] tracking-wider">Cliente/Faturamento</th>
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold text-center uppercase text-[10px] tracking-wider w-[200px]">Nota Fiscal (API/ZIP)</th>
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold text-center uppercase text-[10px] tracking-wider w-[200px]">Boleto/Fatura</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                                {matchFiles.reports.map((r, i) => (
                                    <tr key={i} className="hover:bg-[rgba(33,118,255,0.02)] transition-colors">
                                        <td className="py-4 px-6">
                                            <p className="font-bold text-white">{r.razaoSocial}</p>
                                            <div className="flex gap-2 items-center mt-1">
                                                <span className="text-[10px] text-[var(--fg-muted)]">{r.nome}</span>
                                                <span className="font-mono text-[10px] font-bold text-[var(--accent)] px-2 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10">{fmtCurrency(r.totalFaturar)}</span>
                                            </div>
                                        </td>
                                        <td className="py-4 px-6 text-center">
                                            {r.nfse ? (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20">
                                                    <CheckCircle2 size={12} /> {r.nfse.name.length > 20 ? r.nfse.name.substring(0, 18) + '...' : r.nfse.name}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                                    <Info size={12} /> Sem NF Vinculada
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-4 px-6 text-center">
                                            {r.boleto ? (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20">
                                                    <CheckCircle2 size={12} /> {r.boleto.name.length > 20 ? r.boleto.name.substring(0, 18) + '...' : r.boleto.name}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-[var(--danger)]/10 text-[var(--danger)] border border-[var(--danger)]/20">
                                                    <X size={12} /> Pendente
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Orfans Alert */}
                {(matchFiles.orphanBoletos.length > 0 || matchFiles.orphanNfses.length > 0) && (
                    <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl flex items-start gap-4">
                        <AlertTriangle className="text-amber-500 shrink-0 mt-1" />
                        <div>
                            <h4 className="text-amber-500 font-bold mb-1">Arquivos Órfãos na Memória</h4>
                            <p className="text-xs text-amber-200/80 mb-2">Os seguintes arquivos carregados não encontraram lojas no banco com nomes compatíveis:</p>
                            <div className="grid grid-cols-2 gap-4 mt-2">
                                <div>
                                    <strong className="text-[10px] uppercase tracking-wider text-amber-500/80 mb-1 block">NFs Órfãs ({matchFiles.orphanNfses.length})</strong>
                                    <ul className="text-[10px] text-amber-100/60 list-disc list-inside">
                                        {matchFiles.orphanNfses.slice(0, 5).map(f => <li key={f.name}>{f.name}</li>)}
                                        {matchFiles.orphanNfses.length > 5 && <li>...</li>}
                                    </ul>
                                </div>
                                <div>
                                    <strong className="text-[10px] uppercase tracking-wider text-amber-500/80 mb-1 block">Boletos Órfãos ({matchFiles.orphanBoletos.length})</strong>
                                    <ul className="text-[10px] text-amber-100/60 list-disc list-inside">
                                        {matchFiles.orphanBoletos.slice(0, 5).map(f => <li key={f.name}>{f.name}</li>)}
                                        {matchFiles.orphanBoletos.length > 5 && <li>...</li>}
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Action Buttons Matrix */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
                    <button
                        className="btn btn-outline border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] bg-[var(--bg-sidebar)] h-auto py-8 rounded-2xl flex flex-col items-center gap-3 transition-all relative group overflow-hidden"
                        onClick={() => boletosInputRef.current?.click()}
                    >
                        <UploadCloud size={32} className="text-[var(--fg-dim)] group-hover:text-[var(--accent)] transition-colors" />
                        <span className="font-bold text-sm">Subir Boletos PDF</span>
                        <input type="file" ref={boletosInputRef} onChange={handleBoletoUpload} multiple accept=".pdf" className="hidden" />
                        <div className="absolute top-2 right-3 text-[10px] bg-[var(--bg-card)] border border-[var(--border)] px-2 py-0.5 rounded-full">{boletoFiles.length} arquivos</div>
                    </button>

                    <button
                        className="btn btn-primary h-auto py-8 rounded-2xl flex flex-col items-center gap-3 border border-[rgba(33,118,255,0.4)] shadow-[0_0_20px_rgba(33,118,255,0.15)] disabled:opacity-50 disabled:cursor-not-allowed group relative overflow-hidden"
                        onClick={handleMoveToGcp}
                        disabled={uploadingGcp || gcpSuccess || (saving && !uploadingGcp)} // Disable if already saved DB without GCP
                    >
                        {uploadingGcp || saving ? (
                            <>
                                <span className="loading loading-spinner text-white w-8 h-8"></span>
                                <span className="font-bold text-sm">Escrevendo DB & GCP...</span>
                            </>
                        ) : gcpSuccess ? (
                            <>
                                <CheckCircle2 size={32} className="text-white" />
                                <span className="font-bold text-sm">Consolidado!</span>
                            </>
                        ) : (
                            <>
                                <CloudLightning size={32} className="text-white group-hover:scale-110 transition-transform" />
                                <span className="font-bold text-sm">Mover tudo para GCP</span>
                            </>
                        )}
                        <span className="text-[10px] opacity-80 px-4">Salva Supabase e empurra binários das NFs e Boletos na árvore de diretórios Google Drive.</span>
                    </button>

                    <button
                        className="btn h-auto py-8 rounded-2xl flex flex-col items-center gap-3 border border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all relative overflow-hidden group"
                        onClick={handleDispararEmails}
                        disabled={!gcpSuccess || isSendingEmails || emailDispatched}
                    >
                        {isSendingEmails ? (
                            <>
                                <span className="loading loading-spinner w-8 h-8"></span>
                                <span className="font-bold text-sm">Enviando...</span>
                            </>
                        ) : emailDispatched ? (
                            <>
                                <CheckCircle2 size={32} />
                                <span className="font-bold text-sm">E-mails Disparados!</span>
                            </>
                        ) : (
                            <>
                                <Mail size={32} className="group-hover:scale-110 transition-transform" />
                                <span className="font-bold text-sm">Disparar E-mails</span>
                            </>
                        )}
                        <span className="text-[10px] opacity-80 px-4">Envia notificação via AWS SES para as lojas faturadas com faturas e NF.</span>
                    </button>
                </div>
            </div>

        </div>
    );
}
