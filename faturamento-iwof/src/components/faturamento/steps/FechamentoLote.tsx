"use client";

import { useState, useMemo, useRef } from "react";
import { ArrowLeft, CheckCircle2, ShieldCheck, FileText, UploadCloud, CloudLightning, Mail, AlertTriangle, Info, FileStack, X, FileArchive, Search, Send, FileCode2 } from "lucide-react";
import { Agendamento, FinancialSummary } from "../types";
import { fmtCurrency, normalizarNome } from "../utils";
import JSZip from "jszip";

interface FechamentoLoteProps {
    setCurrentStep: (s: number) => void;
    agendamentos: Agendamento[];
    nfseFiles: { name: string; blob: Blob; buffer: ArrayBuffer }[]; // Preserving standard nfse state if already generated
    setNfseFiles?: React.Dispatch<React.SetStateAction<{ name: string; blob: Blob; buffer: ArrayBuffer }[]>>;
    financialSummary: FinancialSummary;
    handleFecharLote: () => Promise<void | string>;
    saving: boolean;
    saveResult?: { ok: number; err: number; loteId?: string } | null;
    periodoInicio: string;
    periodoFim: string;
    nomePasta: string;
}

export default function FechamentoLote({
    setCurrentStep,
    agendamentos,
    nfseFiles,
    setNfseFiles,
    financialSummary,
    handleFecharLote,
    saving,
    saveResult,
    periodoInicio,
    periodoFim,
    nomePasta
}: FechamentoLoteProps) {

    const [boletoFiles, setBoletoFiles] = useState<{ name: string; fetchUrl: string; file: File }[]>([]);

    // ACTION STATES
    const [actionState, setActionState] = useState({
        boletosSuccess: false,
        nfsSuccess: false,
        ncsSuccess: false,
        hcsSuccess: false,
        emailsSuccess: false
    });

    const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});

    // MODAL STATE
    const [activeModal, setActiveModal] = useState<string | null>(null);

    const boletosInputRef = useRef<HTMLInputElement>(null);
    const nfsInputRef = useRef<HTMLInputElement>(null);

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

            const nfseMatch = nfseFiles.find(f => normalizarNome(f.name.replace(/nfse|nfe|\.pdf|\.xml/gi, "")).includes(normalizedStoreName) || normalizedStoreName.includes(normalizarNome(f.name.replace(/nfse|nfe|\.pdf|\.xml/gi, ""))));
            const boletoMatch = boletoFiles.find(f => normalizarNome(f.name.replace(/boleto|\.pdf/gi, "")).includes(normalizedStoreName) || normalizedStoreName.includes(normalizarNome(f.name.replace(/boleto|\.pdf/gi, ""))));

            return { ...loja, nfse: nfseMatch || null, boleto: boletoMatch || null };
        });

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

    const handleNfsZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return;
        setLoadingMap(p => ({ ...p, "zipNfs": true }));
        try {
            const file = e.target.files[0];
            const jsZip = new JSZip();
            const zip = await jsZip.loadAsync(file);
            const extractedFiles: { name: string; blob: Blob; buffer: ArrayBuffer }[] = [];

            for (const [filename, fileData] of Object.entries(zip.files)) {
                if (!fileData.dir && filename.endsWith(".pdf")) {
                    const blob = await fileData.async("blob");
                    const buffer = await fileData.async("arraybuffer");
                    extractedFiles.push({ name: filename, blob, buffer });
                }
            }
            if (setNfseFiles) setNfseFiles(prev => [...prev, ...extractedFiles]);
        } catch (error) {
            console.error("Error reading zip", error);
            alert("Erro ao extrair arquivos do ZIP de Notas Fiscais.");
        } finally {
            setLoadingMap(p => ({ ...p, "zipNfs": false }));
        }
    };

    const handleUploadBoletos = async () => {
        setLoadingMap(p => ({ ...p, "boletosSuccess": true }));
        try {
            // Se ainda não fechou o lote, fecha agora
            let targetLoteId = saveResult?.loteId;
            if (!targetLoteId) {
                targetLoteId = await handleFecharLote() as string;
                if (!targetLoteId) throw new Error("Falha ao gerar o lote.");
            }

            const formData = new FormData();
            formData.append("loteId", targetLoteId);
            for (const fileObj of boletoFiles) {
                formData.append("files", fileObj.file, fileObj.name);
            }

            const res = await fetch("/api/drive/upload", { method: "POST", body: formData });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || "Erro da API ao enviar boletos.");
            }

            setActionState(p => ({ ...p, boletosSuccess: true }));
        } catch (error: any) {
            console.error(error);
            alert(error.message || "Erro no upload dos boletos");
        } finally {
            setLoadingMap(p => ({ ...p, "boletosSuccess": false }));
            setActiveModal(null);
        }
    };

    const handleUploadNfs = async () => {
        setLoadingMap(p => ({ ...p, "nfsSuccess": true }));
        try {
            let targetLoteId = saveResult?.loteId;
            if (!targetLoteId) {
                targetLoteId = await handleFecharLote() as string;
                if (!targetLoteId) throw new Error("Falha ao gerar o lote.");
            }

            const formData = new FormData();
            formData.append("loteId", targetLoteId);
            for (const fileObj of nfseFiles) {
                formData.append("files", fileObj.blob, fileObj.name);
            }

            const res = await fetch("/api/drive/upload", { method: "POST", body: formData });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || "Erro da API ao enviar NFs.");
            }

            setActionState(p => ({ ...p, nfsSuccess: true }));
        } catch (error: any) {
            console.error(error);
            alert(error.message || "Erro no upload das NFs");
        } finally {
            setLoadingMap(p => ({ ...p, "nfsSuccess": false }));
            setActiveModal(null);
        }
    };

    const handleCriarNCs = async () => {
        setLoadingMap(p => ({ ...p, "ncsSuccess": true }));
        try {
            let targetLoteId = saveResult?.loteId;
            if (!targetLoteId) {
                targetLoteId = await handleFecharLote() as string;
                if (!targetLoteId) throw new Error("Falha ao gerar o lote.");
            }

            const payload = { loteId: targetLoteId, tipo: "NC" };
            const res = await fetch("/api/documentos/disparar-gcp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || "Erro da API ao gerar NCs.");
            }

            setActionState(p => ({ ...p, ncsSuccess: true }));
        } catch (error: any) {
            console.error(error);
            alert(error.message || "Erro na geração de NCs");
        } finally {
            setLoadingMap(p => ({ ...p, "ncsSuccess": false }));
            setActiveModal(null);
        }
    };

    const handleCriarHCs = async () => {
        setLoadingMap(p => ({ ...p, "hcsSuccess": true }));
        try {
            let targetLoteId = saveResult?.loteId;
            if (!targetLoteId) {
                targetLoteId = await handleFecharLote() as string;
                if (!targetLoteId) throw new Error("Falha ao gerar o lote.");
            }

            const payload = { loteId: targetLoteId, tipo: "HC" };
            const res = await fetch("/api/documentos/disparar-gcp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || "Erro da API ao gerar HCs.");
            }

            setActionState(p => ({ ...p, hcsSuccess: true }));
        } catch (error: any) {
            console.error(error);
            alert(error.message || "Erro na geração de HCs");
        } finally {
            setLoadingMap(p => ({ ...p, "hcsSuccess": false }));
            setActiveModal(null);
        }
    };

    const handleDispararEmails = async () => {
        setLoadingMap(p => ({ ...p, "emailsSuccess": true }));
        try {
            let targetLoteId = saveResult?.loteId;
            if (!targetLoteId) throw new Error("Lote não encontrado. Processe uma das etapas anteriores primeiro.");

            const payload = { loteId: targetLoteId };
            const res = await fetch("/api/faturamento/disparar-emails", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || "Erro ao disparar e-mails");
            }
            setActionState(p => ({ ...p, emailsSuccess: true }));
        } catch (error: any) {
            console.error(error);
            alert(error.message || "A etapa finalizou com bugs durante envio de e-mail.");
        } finally {
            setLoadingMap(p => ({ ...p, "emailsSuccess": false }));
            setActiveModal(null);
        }
    };

    const totals = financialSummary.summaryArr.find(v => v.ciclo === "LÍQUIDO P/ LOTE");

    return (
        <div className="flex flex-col gap-6 max-w-6xl mx-auto pb-16">

            {/* Modal: BOLETOS */}
            {activeModal === "boletos" && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-[var(--bg-card)] border border-[var(--border)] p-6 rounded-2xl max-w-md w-full shadow-2xl">
                        <h3 className="text-xl font-bold mb-2">Enviar Boletos PDF</h3>
                        <p className="text-sm text-[var(--fg-dim)] mb-6">Você pode soltar os PDFS (mesmo todos juntos) e faremos o cruzamento automático. Tem certeza de enviar?</p>

                        <div className="flex justify-center border-2 border-dashed border-[var(--border)] rounded-xl py-8 mb-6 hover:bg-[var(--bg-sidebar)] transition-colors cursor-pointer" onClick={() => boletosInputRef.current?.click()}>
                            <div className="flex flex-col items-center gap-2">
                                <UploadCloud className="text-[var(--accent)]" />
                                <span className="font-bold text-sm">Selecionar Boletos</span>
                            </div>
                            <input type="file" ref={boletosInputRef} onChange={handleBoletoUpload} multiple accept=".pdf" className="hidden" />
                        </div>
                        {boletoFiles.length > 0 && <p className="text-xs text-center text-[var(--success)] mb-6 font-bold">{boletoFiles.length} adicionados e cruzados!</p>}

                        <div className="flex gap-4">
                            <button className="flex-1 btn btn-ghost" onClick={() => setActiveModal(null)}>Cancelar</button>
                            <button className="flex-1 btn btn-primary" onClick={handleUploadBoletos} disabled={loadingMap["boletosSuccess"]}>
                                {loadingMap["boletosSuccess"] ? "Enviando..." : "Confirmar Envio"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: NFs */}
            {activeModal === "nfs" && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-[var(--bg-card)] border border-[var(--border)] p-6 rounded-2xl max-w-md w-full shadow-2xl">
                        <h3 className="text-xl font-bold mb-2">Enviar ZIP com NFs</h3>
                        <p className="text-sm text-[var(--fg-dim)] mb-6">Extraia automaticamente as Notas emitidas via NFE.io. O Zip será lido do lado do cliente e enviado aos poucos para não sobrecarregar.</p>

                        <div className="flex justify-center border-2 border-dashed border-[var(--border)] rounded-xl py-8 mb-6 hover:bg-[var(--bg-sidebar)] transition-colors cursor-pointer" onClick={() => nfsInputRef.current?.click()}>
                            <div className="flex flex-col items-center gap-2">
                                <FileArchive className="text-[var(--accent)]" />
                                <span className="font-bold text-sm">{loadingMap["zipNfs"] ? "Lendo ZIP..." : "Selecionar ZIP do NFE.io"}</span>
                            </div>
                            <input type="file" ref={nfsInputRef} onChange={handleNfsZipUpload} accept=".zip" className="hidden" />
                        </div>
                        {nfseFiles.length > 0 && <p className="text-xs text-center text-[var(--success)] mb-6 font-bold">{nfseFiles.length} Extraídos com SUCESSO!</p>}

                        <div className="flex gap-4">
                            <button className="flex-1 btn btn-ghost" onClick={() => setActiveModal(null)}>Cancelar</button>
                            <button className="flex-1 btn btn-primary" onClick={handleUploadNfs} disabled={loadingMap["nfsSuccess"] || nfseFiles.length === 0}>
                                {loadingMap["nfsSuccess"] ? "Enviando..." : "Confirmar Upload GCP"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: NCs */}
            {activeModal === "ncs" && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-[var(--bg-card)] border border-[var(--border)] p-6 rounded-2xl max-w-md w-full shadow-2xl">
                        <h3 className="text-xl font-bold mb-2">Gerar Notas de Crédito</h3>
                        <p className="text-sm text-[var(--fg-dim)] mb-6">Deseja gerar as NCs (Notas de Crédito) para este Lote Base? Clientes como Nordestão e Faturas Parciais serão calculados.</p>

                        <div className="flex gap-4 mt-6">
                            <button className="flex-1 btn btn-ghost" onClick={() => setActiveModal(null)}>Cancelar</button>
                            <button className="flex-1 btn btn-primary bg-amber-500 hover:bg-amber-600 border-none text-white" onClick={handleCriarNCs} disabled={loadingMap["ncsSuccess"]}>
                                {loadingMap["ncsSuccess"] ? "Calculando..." : "Processar NCs"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: HCs */}
            {activeModal === "hcs" && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-[var(--bg-card)] border border-[var(--border)] p-6 rounded-2xl max-w-md w-full shadow-2xl">
                        <h3 className="text-xl font-bold mb-2">Gerar Recibos HCs</h3>
                        <p className="text-sm text-[var(--fg-dim)] mb-6">Este processo verificará se existem clientes que necessitam de Honorários/Contratos em vez de BOLETOS. Deseja prosseguir?</p>

                        <div className="flex gap-4 mt-6">
                            <button className="flex-1 btn btn-ghost" onClick={() => setActiveModal(null)}>Cancelar</button>
                            <button className="flex-1 btn btn-primary bg-purple-500 hover:bg-purple-600 border-none text-white" onClick={handleCriarHCs} disabled={loadingMap["hcsSuccess"]}>
                                {loadingMap["hcsSuccess"] ? "Gerando..." : "Processar HCs"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: EMAILS */}
            {activeModal === "emails" && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-[var(--bg-card)] border border-[var(--border)] p-6 rounded-2xl max-w-md w-full shadow-2xl">
                        <h3 className="text-xl font-bold text-[var(--danger)] mb-2">Atenção Crítica</h3>
                        <p className="text-sm text-[var(--fg-dim)] mb-6">
                            Esta ação enviará os e-mails com Boletos, NFs, NCs e HCs consolidados no Lote para todos os e-mails financeiros dos clientes. <br /><br /><strong>Tem certeza absoluta que deseja FINALIZAR O CICLO?</strong>
                        </p>

                        <div className="flex gap-4 mt-6">
                            <button className="flex-1 btn btn-ghost" onClick={() => setActiveModal(null)}>Cancelar</button>
                            <button className="flex-1 btn btn-primary bg-[var(--danger)] hover:bg-red-600 border-none text-white font-bold" onClick={handleDispararEmails} disabled={loadingMap["emailsSuccess"] || (!actionState.boletosSuccess && !actionState.nfsSuccess)}>
                                {loadingMap["emailsSuccess"] ? "Enviando E-mails..." : "CONFIRMAR DISPARO"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex items-center justify-between mb-2">
                <button className="btn btn-ghost text-[var(--fg-dim)] hover:text-[var(--fg)]" onClick={() => setCurrentStep(4)}>
                    <ArrowLeft size={16} /> Voltar Módulo NFE
                </button>
                <div className="flex items-center gap-2 text-[var(--success)] bg-[rgba(34,197,94,0.1)] px-3 py-1.5 rounded-full text-xs font-bold border border-[rgba(34,197,94,0.2)] shadow-[0_0_15px_rgba(34,197,94,0.1)]">
                    <ShieldCheck size={14} /> Dados Prontos
                </div>
            </div>

            <div className="text-center mb-8">
                <h2 className="text-3xl font-black text-[var(--fg)] mb-2">Fechamento e Triagem Final</h2>
                <p className="text-[var(--fg-dim)] text-sm max-w-2xl mx-auto">
                    Auditoria final. Atrele os boletos aos XML/PDFs das notas emitidas, faça a injeção conjunta do lote no Banco de Dados (Supabase) + Arquivos no Drive (GCP) e lance as cobranças.
                </p>
            </div>

            <div className="grid lg:grid-cols-3 gap-6 relative items-start">
                {/* AÇÕES SEQUENCIAIS */}
                <div className="lg:col-span-1 flex flex-col gap-4 sticky top-6">
                    <h3 className="text-lg font-bold text-[var(--fg)] mb-2 flex items-center gap-2">Ações Definitivas</h3>

                    {/* Botão 1: Boletos */}
                    <button
                        onClick={() => setActiveModal("boletos")}
                        disabled={actionState.boletosSuccess || loadingMap["boletosSuccess"]}
                        className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${actionState.boletosSuccess ? "bg-[var(--bg-card)] border-[var(--border)] opacity-60" : "bg-[var(--bg-sidebar)] border-[var(--border)] hover:border-[var(--accent)] shadow-sm hover:shadow-md"
                            }`}
                    >
                        <div className={`p-3 rounded-xl ${actionState.boletosSuccess ? "bg-green-500/10 text-green-500" : "bg-[var(--accent)]/10 text-[var(--accent)]"}`}>
                            <UploadCloud size={24} />
                        </div>
                        <div className="flex-1">
                            <h4 className="font-bold text-sm text-[var(--fg)]">1. Enviar Boletos</h4>
                            <p className="text-xs text-[var(--fg-dim)] mt-0.5">Upload de PDFs</p>
                        </div>
                        {actionState.boletosSuccess && <span className="text-xs font-bold px-2 py-1 bg-green-500/20 text-green-500 rounded-lg">Concluído</span>}
                    </button>

                    {/* Botão 2: NFs */}
                    <button
                        onClick={() => setActiveModal("nfs")}
                        disabled={actionState.nfsSuccess || loadingMap["nfsSuccess"]}
                        className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${actionState.nfsSuccess ? "bg-[var(--bg-card)] border-[var(--border)] opacity-60" : "bg-[var(--bg-sidebar)] border-[var(--border)] hover:border-[var(--accent)] shadow-sm hover:shadow-md"
                            }`}
                    >
                        <div className={`p-3 rounded-xl ${actionState.nfsSuccess ? "bg-green-500/10 text-green-500" : "bg-[var(--accent)]/10 text-[var(--accent)]"}`}>
                            <FileArchive size={24} />
                        </div>
                        <div className="flex-1">
                            <h4 className="font-bold text-sm text-[var(--fg)]">2. Enviar NFs</h4>
                            <p className="text-xs text-[var(--fg-dim)] mt-0.5">Upload ZIP NFE.io</p>
                        </div>
                        {actionState.nfsSuccess && <span className="text-xs font-bold px-2 py-1 bg-green-500/20 text-green-500 rounded-lg">Concluído</span>}
                    </button>

                    {/* Botão 3: NCs */}
                    <button
                        onClick={() => setActiveModal("ncs")}
                        disabled={actionState.ncsSuccess || loadingMap["ncsSuccess"]}
                        className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${actionState.ncsSuccess ? "bg-[var(--bg-card)] border-[var(--border)] opacity-60" : "bg-[var(--bg-sidebar)] border-[var(--border)] hover:border-[var(--accent)] shadow-sm hover:shadow-md"
                            }`}
                    >
                        <div className={`p-3 rounded-xl ${actionState.ncsSuccess ? "bg-green-500/10 text-green-500" : "bg-amber-500/10 text-amber-500"}`}>
                            <FileCode2 size={24} />
                        </div>
                        <div className="flex-1">
                            <h4 className="font-bold text-sm text-[var(--fg)]">3. Criar NCs</h4>
                            <p className="text-xs text-[var(--fg-dim)] mt-0.5">Notas de Crédito</p>
                        </div>
                        {actionState.ncsSuccess && <span className="text-xs font-bold px-2 py-1 bg-green-500/20 text-green-500 rounded-lg">Concluído</span>}
                    </button>

                    {/* Botão 4: HCs */}
                    <button
                        onClick={() => setActiveModal("hcs")}
                        disabled={actionState.hcsSuccess || loadingMap["hcsSuccess"]}
                        className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${actionState.hcsSuccess ? "bg-[var(--bg-card)] border-[var(--border)] opacity-60" : "bg-[var(--bg-sidebar)] border-[var(--border)] hover:border-[var(--accent)] shadow-sm hover:shadow-md"
                            }`}
                    >
                        <div className={`p-3 rounded-xl ${actionState.hcsSuccess ? "bg-green-500/10 text-green-500" : "bg-purple-500/10 text-purple-500"}`}>
                            <FileText size={24} />
                        </div>
                        <div className="flex-1">
                            <h4 className="font-bold text-sm text-[var(--fg)]">4. Criar HCs</h4>
                            <p className="text-xs text-[var(--fg-dim)] mt-0.5">Honorários Cont.</p>
                        </div>
                        {actionState.hcsSuccess && <span className="text-xs font-bold px-2 py-1 bg-green-500/20 text-green-500 rounded-lg">Concluído</span>}
                    </button>

                    {/* Botão 5: EMAIL */}
                    <button
                        onClick={() => setActiveModal("emails")}
                        disabled={actionState.emailsSuccess || loadingMap["emailsSuccess"]}
                        className={`group flex items-center gap-4 p-4 rounded-2xl border text-left transition-all mt-4 ${actionState.emailsSuccess ? "bg-green-500/5 border-green-500/20 opacity-60" : "bg-green-500/10 border-green-500/30 hover:bg-green-500 hover:text-white hover:border-green-500 hover:shadow-[0_0_20px_rgba(34,197,94,0.4)]"
                            }`}
                    >
                        <div className={`p-3 rounded-xl ${actionState.emailsSuccess ? "bg-green-500/10 text-green-500" : "bg-[var(--bg-sidebar)] text-green-500 group-hover:text-green-500 group-hover:bg-white"}`}>
                            <Send size={24} />
                        </div>
                        <div className="flex-1">
                            <h4 className={`font-bold text-sm ${actionState.emailsSuccess ? "text-green-500" : "text-[var(--fg)] group-hover:text-white"}`}>5. Enviar E-mails</h4>
                            <p className={`text-xs mt-0.5 ${actionState.emailsSuccess ? "text-green-500/70" : "text-[var(--fg-dim)] group-hover:text-white/80"}`}>Ação crítica final</p>
                        </div>
                        {actionState.emailsSuccess && <span className="text-xs font-bold px-2 py-1 bg-green-500/20 text-green-500 rounded-lg">Concluído</span>}
                    </button>
                </div>

                {/* Tabela Relatório de Conferência */}
                <div className="lg:col-span-2 bg-[var(--bg-sidebar)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-lg h-fit">
                    <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[rgba(0,0,0,0.2)]">
                        <div>
                            <h3 className="text-lg font-bold text-[var(--fg)] flex items-center gap-2">
                                <FileStack size={20} className="text-[var(--accent)]" /> Relatório de Conferência (Matches)
                            </h3>
                            <p className="text-xs text-[var(--fg-dim)] mt-1">Status de acoplagem das {matchFiles.reports.length} empresas.</p>
                        </div>
                        <div className="text-right">
                            <p className="text-sm font-semibold text-[var(--fg)]">Total: {totals?.empresasCount} Lojas</p>
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
                                            <p className="font-bold text-[var(--fg)]">{r.razaoSocial}</p>
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
            </div>

            {/* Orfans Alert */}
            {(matchFiles.orphanBoletos.length > 0 || matchFiles.orphanNfses.length > 0) && (
                <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl flex items-start gap-4 mt-6">
                    <AlertTriangle className="text-amber-500 shrink-0 mt-1" />
                    <div>
                        <h4 className="text-amber-500 font-bold mb-1">Arquivos Órfãos na Memória</h4>
                        <p className="text-xs text-amber-200/80 mb-2">Os seguintes arquivos não encontraram lojas no sistema via nome da nota:</p>
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
        </div>
    );
}
