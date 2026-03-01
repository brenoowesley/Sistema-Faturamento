"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { ArrowLeft, CheckCircle2, ShieldCheck, FileText, UploadCloud, CloudLightning, Mail, AlertTriangle, Info, FileStack, X, FileArchive, Search, Send, FileCode2, Lock, Save } from "lucide-react";
import { Agendamento, FinancialSummary } from "../types";
import { fmtCurrency, normalizarNome } from "../utils";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/client";

interface FechamentoLoteProps {
    setCurrentStep: (s: number) => void;
    agendamentos: Agendamento[];
    nfseFiles: { name: string; blob: Blob; buffer: ArrayBuffer }[]; // Preserving standard nfse state if already generated
    setNfseFiles?: React.Dispatch<React.SetStateAction<{ name: string; blob: Blob; buffer: ArrayBuffer }[]>>;
    financialSummary: FinancialSummary;
    handleFecharLote: () => Promise<void | string>;
    saving: boolean;
    saveResult?: { ok: number; err: number; loteId?: string } | null;
    loteId?: string | null;
    setLoteId?: (id: string | null) => void;
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
    loteId,
    setLoteId,
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
    const [isLoteConsolidado, setIsLoteConsolidado] = useState(false);
    const supabase = createClient();

    // MODAL STATE
    const [activeModal, setActiveModal] = useState<string | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>("TODAS");

    const boletosInputRef = useRef<HTMLInputElement>(null);
    const nfsInputRef = useRef<HTMLInputElement>(null);
    const [xmlParsedData, setXmlParsedData] = useState<Record<string, { cnpj: string | null; irrf: number }>>({});

    useEffect(() => {
        const parseXmls = async () => {
            const newParsedMap = { ...xmlParsedData };
            let hasChanges = false;

            for (const fileObj of nfseFiles) {
                if (fileObj.name.toLowerCase().endsWith('.xml')) {
                    try {
                        const textDecoder = new TextDecoder('utf-8');
                        const xmlString = textDecoder.decode(fileObj.buffer);
                        const parser = new DOMParser();
                        const xmlDoc = parser.parseFromString(xmlString, "application/xml");

                        const numeroElement = xmlDoc.querySelector("Numero") || xmlDoc.querySelector("nNF");
                        const numeroNF = numeroElement ? numeroElement.textContent?.trim() : null;

                        const tomadorElement = xmlDoc.querySelector("Tomador") || xmlDoc.querySelector("TomadorServico");
                        const cnpjElement = tomadorElement ? tomadorElement.querySelector("Cnpj") || tomadorElement.querySelector("CNPJ") : null;
                        const cnpjTomador = cnpjElement ? cnpjElement.textContent?.replace(/\D/g, '') : null;

                        const irrfElement = xmlDoc.querySelector("ValorIr") || xmlDoc.querySelector("vIRRF");
                        const valorIRRF = irrfElement ? parseFloat(irrfElement.textContent?.trim() || "0") : 0;

                        if (numeroNF && (!newParsedMap[numeroNF] || newParsedMap[numeroNF].cnpj !== cnpjTomador)) {
                            newParsedMap[numeroNF] = { cnpj: cnpjTomador || null, irrf: valorIRRF };
                            hasChanges = true;
                        }
                    } catch (err) {
                        console.error("Failed parsing XML:", fileObj.name, err);
                    }
                }
            }
            if (hasChanges) {
                setXmlParsedData(newParsedMap);
            }
        };

        parseXmls();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nfseFiles]);

    const matchFiles = useMemo(() => {
        const validados = agendamentos.filter(a =>
            !a.isRemoved &&
            (a.status === "OK" || a.status === "CORREÇÃO") &&
            a.clienteId
        );

        const lojasUnicas = new Map<string, { nome: string; id: string; razaoSocial: string; cnpj: string | undefined; totalFaturar: number }>();
        for (const a of validados) {
            if (!lojasUnicas.has(a.clienteId!)) {
                lojasUnicas.set(a.clienteId!, {
                    id: a.clienteId!,
                    nome: a.loja,
                    razaoSocial: a.razaoSocial || a.loja,
                    cnpj: a.cnpj?.replace(/\D/g, ''),
                    totalFaturar: 0
                });
            }
            lojasUnicas.get(a.clienteId!)!.totalFaturar += a.status === "CORREÇÃO" ? (a.suggestedValorIwof ?? a.valorIwof) : (a.manualValue ?? a.valorIwof);
        }

        const reports = Array.from(lojasUnicas.values()).map(loja => {
            const normalizedStoreName = normalizarNome(loja.nome);

            let statusNF: 'PENDENTE' | 'EMITIDA' = 'PENDENTE';
            let numeroNF: string | undefined;
            let descontoIR: number | undefined;

            let nfseMatch = null;
            if (loja.cnpj) {
                // Find any XML NF that matches this store's CNPJ
                const cnpjToMatch = loja.cnpj;
                const matchingNfEntry = Object.entries(xmlParsedData).find(([nfNum, data]) => data.cnpj === cnpjToMatch || (data.cnpj && cnpjToMatch.includes(data.cnpj)));
                if (matchingNfEntry) {
                    const nfNumber = matchingNfEntry[0];
                    statusNF = 'EMITIDA';
                    numeroNF = nfNumber;
                    descontoIR = matchingNfEntry[1].irrf;
                    // Find the physical PDF file belonging to this NF number (usually Conta Azul PDFs have the NF number in the title)
                    nfseMatch = nfseFiles.find(f => f.name.includes(nfNumber)) || null;
                }
            }

            // 2. Fallback: name matching (legacy)
            if (!nfseMatch) {
                nfseMatch = nfseFiles.find(f => normalizarNome(f.name.replace(/nfse|nfe|\.pdf|\.xml/gi, "")).includes(normalizedStoreName) || normalizedStoreName.includes(normalizarNome(f.name.replace(/nfse|nfe|\.pdf|\.xml/gi, "")))) || null;
                if (nfseMatch && statusNF === 'PENDENTE') {
                    statusNF = 'EMITIDA';
                    numeroNF = nfseMatch.name.split('.')[0].replace(/\D/g, '') || undefined;
                }
            }

            const boletoMatch = boletoFiles.find(f => normalizarNome(f.name.replace(/boleto|\.pdf/gi, "")).includes(normalizedStoreName) || normalizedStoreName.includes(normalizarNome(f.name.replace(/boleto|\.pdf/gi, "")))) || null;

            let statusNC: 'NAO_APLICAVEL' | 'PENDENTE' | 'EMITIDA' = 'NAO_APLICAVEL';
            let numeroNC: string | undefined;

            if (statusNF === 'PENDENTE') {
                statusNC = actionState.ncsSuccess ? 'EMITIDA' : 'PENDENTE';
                if (actionState.ncsSuccess) numeroNC = "Gerada";
            }

            return { ...loja, nfse: nfseMatch, boleto: boletoMatch, statusNF, numeroNF, descontoIR, statusNC, numeroNC };
        });

        const matchedNfseNames = new Set(reports.map(r => r.nfse?.name).filter(Boolean));
        const matchedBoletoNames = new Set(reports.map(r => r.boleto?.name).filter(Boolean));

        const orphanNfses = nfseFiles.filter(f => !matchedNfseNames.has(f.name));
        const orphanBoletos = boletoFiles.filter(f => !matchedBoletoNames.has(f.name));

        return { reports, orphanNfses, orphanBoletos };
    }, [agendamentos, nfseFiles, boletoFiles, xmlParsedData, actionState.ncsSuccess]);

    const handleConsolidarLote = async () => {
        let targetLoteId = loteId || saveResult?.loteId;
        if (!targetLoteId) {
            alert("Erro: ID do lote não encontrado. Por favor, volte ao passo anterior e tente novamente.");
            return;
        }

        setLoadingMap(prev => ({ ...prev, consolidar: true }));
        try {
            const updatesList = matchFiles.reports.filter(r => r.numeroNF || r.descontoIR).map(r => {
                return {
                    lote_id: targetLoteId!,
                    loja_id: r.id,
                    numero_nf: r.numeroNF || null,
                    desconto_irrf: r.descontoIR || 0
                };
            });

            if (updatesList.length > 0) {
                // Upsert on faturamento_consolidados requires matching the primary key or unique constraints.
                // Assuming (lote_id, loja_id) is unique, we can iterate or use upsert if configured.
                // We'll update sequentially to ensure precise patching:
                for (const update of updatesList) {
                    const { error } = await supabase
                        .from('faturamento_consolidados')
                        .update({
                            numero_nf: update.numero_nf,
                            desconto_irrf: update.desconto_irrf
                        })
                        .eq('lote_id', targetLoteId)
                        .eq('loja_id', update.loja_id);

                    if (error) {
                        console.error("Erro ao atualizar NF da loja", update.loja_id, error);
                    }
                }
            }

            // Also check agendamentos_brutos to just stamp them if needed, but consolidados is usually enough.
            setIsLoteConsolidado(true);
        } catch (error: any) {
            console.error("Erro geral na consolidação", error);
            alert("Falha ao consolidar o lote. Verifique o console.");
        } finally {
            setLoadingMap(prev => ({ ...prev, consolidar: false }));
        }
    };

    /** FILE UPLOAD HANDLERS **/
    const handleBoletoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return;
        setLoadingMap(p => ({ ...p, "zipBoletos": true }));

        try {
            const newFiles: { name: string; fetchUrl: string; file: File }[] = [];

            for (const file of Array.from(e.target.files)) {
                if (file.name.toLowerCase().endsWith(".zip")) {
                    const jsZip = new JSZip();
                    const zip = await jsZip.loadAsync(file);

                    for (const [filename, fileData] of Object.entries(zip.files)) {
                        if (!fileData.dir && filename.toLowerCase().endsWith(".pdf")) {
                            const blob = await fileData.async("blob");
                            const extractedFile = new File([blob], filename, { type: "application/pdf" });
                            newFiles.push({
                                name: filename,
                                file: extractedFile,
                                fetchUrl: URL.createObjectURL(extractedFile)
                            });
                        }
                    }
                } else if (file.name.toLowerCase().endsWith(".pdf")) {
                    newFiles.push({
                        name: file.name,
                        file: file,
                        fetchUrl: URL.createObjectURL(file)
                    });
                }
            }
            setBoletoFiles(prev => [...prev, ...newFiles]);
        } catch (error) {
            console.error("Error reading boletos zip/pdf", error);
            alert("Erro ao processar os arquivos de Boletos.");
        } finally {
            setLoadingMap(p => ({ ...p, "zipBoletos": false }));
        }
    };

    const handleNfsZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return;
        setLoadingMap(p => ({ ...p, "zipNfs": true }));
        try {
            const extractedFiles: { name: string; blob: Blob; buffer: ArrayBuffer }[] = [];

            for (const file of Array.from(e.target.files)) {
                if (file.name.toLowerCase().endsWith(".zip")) {
                    const jsZip = new JSZip();
                    const zip = await jsZip.loadAsync(file);

                    for (const [filename, fileData] of Object.entries(zip.files)) {
                        if (!fileData.dir) {
                            if (filename.toLowerCase().endsWith(".pdf") || filename.toLowerCase().endsWith(".xml")) {
                                const blob = await fileData.async("blob");
                                const buffer = await fileData.async("arraybuffer");
                                extractedFiles.push({ name: filename, blob, buffer });
                            }
                        }
                    }
                } else if (file.name.toLowerCase().endsWith(".xml") || file.name.toLowerCase().endsWith(".pdf")) {
                    const buffer = await file.arrayBuffer();
                    extractedFiles.push({ name: file.name, blob: file, buffer });
                }
            }
            if (setNfseFiles) setNfseFiles(prev => [...prev, ...extractedFiles]);
        } catch (error) {
            console.error("Error reading zip/xml upload", error);
            alert("Erro ao extrair arquivos do ZIP/XML de Notas Fiscais.");
        } finally {
            setLoadingMap(p => ({ ...p, "zipNfs": false }));
        }
    };

    const handleUploadBoletos = async () => {
        setLoadingMap(p => ({ ...p, "boletosSuccess": true }));
        try {
            // Se ainda não fechou o lote, fecha agora
            let targetLoteId = loteId || saveResult?.loteId;
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
            let targetLoteId = loteId || saveResult?.loteId;
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
            let targetLoteId = loteId || saveResult?.loteId;
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
            let targetLoteId = loteId || saveResult?.loteId;
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
            let targetLoteId = loteId || saveResult?.loteId;
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

    const pendingNfCount = matchFiles.reports.filter(r => r.statusNF === 'PENDENTE').length;

    const filteredReports = matchFiles.reports.filter(r => {
        if (filterStatus === "FALTA_NF") return r.statusNF === 'PENDENTE';
        if (filterStatus === "FALTA_NC") return r.statusNC === 'PENDENTE';
        if (filterStatus === "COM_DESCONTO_IR") return r.descontoIR && r.descontoIR > 0;
        return true;
    });

    return (
        <div className="flex flex-col gap-6 max-w-6xl mx-auto pb-16">

            {/* Modal: BOLETOS */}
            {activeModal === "boletos" && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-[var(--bg-card)] border border-[var(--border)] p-6 rounded-2xl max-w-md w-full shadow-2xl">
                        <h3 className="text-xl font-bold mb-2">Enviar Boletos PDF</h3>
                        <p className="text-sm text-[var(--fg-dim)] mb-6">Você pode soltar os PDFs (mesmo todos juntos) ou arquivo <strong>.ZIP</strong> contendo eles, e faremos o cruzamento. Tem certeza de enviar?</p>

                        <div className="flex justify-center border-2 border-dashed border-[var(--border)] rounded-xl py-8 mb-6 hover:bg-[var(--bg-sidebar)] transition-colors cursor-pointer" onClick={() => boletosInputRef.current?.click()}>
                            <div className="flex flex-col items-center gap-2">
                                <UploadCloud className="text-[var(--accent)]" />
                                <span className="font-bold text-sm">{loadingMap["zipBoletos"] ? "Processando arquivos..." : "Selecionar Boletos (PDF/ZIP)"}</span>
                            </div>
                            <input type="file" ref={boletosInputRef} onChange={handleBoletoUpload} multiple accept=".pdf,.zip" className="hidden" />
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
                                <span className="font-bold text-sm">{loadingMap["zipNfs"] ? "Lendo Arquivos..." : "Selecionar ZIP/XMLs"}</span>
                            </div>
                            <input type="file" ref={nfsInputRef} onChange={handleNfsZipUpload} multiple accept=".zip,.xml,.pdf" className="hidden" />
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

                    {/* Botão 1: Consolidar Lote */}
                    <button
                        onClick={handleConsolidarLote}
                        disabled={isLoteConsolidado || loadingMap["consolidar"]}
                        className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${isLoteConsolidado ? "bg-[var(--bg-card)] border-[var(--border)] opacity-60" : "bg-[var(--bg-sidebar)] border-[var(--border)] hover:border-[var(--accent)] shadow-sm hover:shadow-md"
                            }`}
                    >
                        <div className={`p-3 rounded-xl ${isLoteConsolidado ? "bg-green-500/10 text-green-500" : "bg-[var(--accent)]/10 text-[var(--accent)]"}`}>
                            <Save size={24} />
                        </div>
                        <div className="flex-1">
                            <h4 className="font-bold text-sm text-[var(--fg)]">1. Consolidar Lote</h4>
                            <p className="text-xs text-[var(--fg-dim)] mt-0.5">Grava IRRF e NFs no Banco</p>
                        </div>
                        {isLoteConsolidado && <span className="text-xs font-bold px-2 py-1 bg-green-500/20 text-green-500 rounded-lg flex items-center gap-1"><CheckCircle2 size={12} /> Sucesso</span>}
                        {loadingMap["consolidar"] && <span className="loading loading-spinner w-4 h-4 text-[var(--accent)]"></span>}
                    </button>

                    {/* Botão 2: HCs */}
                    <button
                        title={!isLoteConsolidado ? "Consolide o lote primeiro" : ""}
                        onClick={() => setActiveModal("hcs")}
                        disabled={!isLoteConsolidado || actionState.hcsSuccess || loadingMap["hcsSuccess"]}
                        className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${actionState.hcsSuccess ? "bg-[var(--bg-card)] border-[var(--border)] opacity-60" : "bg-[var(--bg-sidebar)] border-[var(--border)] hover:border-[var(--accent)] shadow-sm hover:shadow-md"
                            } ${!isLoteConsolidado && "opacity-50 grayscale cursor-not-allowed pointer-events-none"}`}
                    >
                        <div className={`p-3 rounded-xl ${actionState.hcsSuccess ? "bg-green-500/10 text-green-500" : "bg-purple-500/10 text-purple-500"}`}>
                            <FileText size={24} />
                        </div>
                        <div className="flex-1">
                            <h4 className="font-bold text-sm text-[var(--fg)] flex items-center gap-2">2. Criar HCs {!isLoteConsolidado && <Lock size={14} className="text-[var(--fg-dim)]" />}</h4>
                            <p className="text-xs text-[var(--fg-dim)] mt-0.5">Recibos Honorários</p>
                        </div>
                        {actionState.hcsSuccess && <span className="text-xs font-bold px-2 py-1 bg-green-500/20 text-green-500 rounded-lg flex items-center gap-1"><CheckCircle2 size={12} /> Concluído</span>}
                    </button>

                    {/* Botão 3: NCs */}
                    <button
                        title={!isLoteConsolidado ? "Consolide o lote primeiro" : ""}
                        onClick={() => setActiveModal("ncs")}
                        disabled={!isLoteConsolidado || actionState.ncsSuccess || loadingMap["ncsSuccess"]}
                        className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${actionState.ncsSuccess ? "bg-[var(--bg-card)] border-[var(--border)] opacity-60" : "bg-[var(--bg-sidebar)] border-[var(--border)] hover:border-[var(--accent)] shadow-sm hover:shadow-md"
                            } ${!isLoteConsolidado && "opacity-50 grayscale cursor-not-allowed pointer-events-none"}`}
                    >
                        <div className={`p-3 rounded-xl ${actionState.ncsSuccess ? "bg-green-500/10 text-green-500" : "bg-amber-500/10 text-amber-500"}`}>
                            <FileCode2 size={24} />
                        </div>
                        <div className="flex-1">
                            <h4 className="font-bold text-sm text-[var(--fg)] flex items-center gap-2">3. Criar NCs {!isLoteConsolidado && <Lock size={14} className="text-[var(--fg-dim)]" />}</h4>
                            <p className="text-xs text-[var(--fg-dim)] mt-0.5">Notas de Crédito</p>
                        </div>
                        {actionState.ncsSuccess && <span className="text-xs font-bold px-2 py-1 bg-green-500/20 text-green-500 rounded-lg flex items-center gap-1"><CheckCircle2 size={12} /> Concluído</span>}
                    </button>

                    {/* Botão 4: NFs */}
                    <button
                        title={!isLoteConsolidado ? "Consolide o lote primeiro" : ""}
                        onClick={() => setActiveModal("nfs")}
                        disabled={!isLoteConsolidado || actionState.nfsSuccess || loadingMap["nfsSuccess"]}
                        className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${actionState.nfsSuccess ? "bg-[var(--bg-card)] border-[var(--border)] opacity-60" : "bg-[var(--bg-sidebar)] border-[var(--border)] hover:border-[var(--accent)] shadow-sm hover:shadow-md"
                            } ${!isLoteConsolidado && "opacity-50 grayscale cursor-not-allowed pointer-events-none"}`}
                    >
                        <div className={`p-3 rounded-xl ${actionState.nfsSuccess ? "bg-green-500/10 text-green-500" : "bg-[var(--accent)]/10 text-[var(--accent)]"}`}>
                            <FileArchive size={24} />
                        </div>
                        <div className="flex-1">
                            <h4 className="font-bold text-sm text-[var(--fg)] flex items-center gap-2">4. Organizar NFs {!isLoteConsolidado && <Lock size={14} className="text-[var(--fg-dim)]" />}</h4>
                            <p className="text-xs text-[var(--fg-dim)] mt-0.5">Upload ZIP NFE.io</p>
                        </div>
                        {actionState.nfsSuccess && <span className="text-xs font-bold px-2 py-1 bg-green-500/20 text-green-500 rounded-lg flex items-center gap-1"><CheckCircle2 size={12} /> Concluído</span>}
                    </button>

                    {/* Botão 5: Boletos */}
                    <button
                        title={!isLoteConsolidado ? "Consolide o lote primeiro" : ""}
                        onClick={() => setActiveModal("boletos")}
                        disabled={!isLoteConsolidado || actionState.boletosSuccess || loadingMap["boletosSuccess"]}
                        className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${actionState.boletosSuccess ? "bg-[var(--bg-card)] border-[var(--border)] opacity-60" : "bg-[var(--bg-sidebar)] border-[var(--border)] hover:border-[var(--accent)] shadow-sm hover:shadow-md"
                            } ${!isLoteConsolidado && "opacity-50 grayscale cursor-not-allowed pointer-events-none"}`}
                    >
                        <div className={`p-3 rounded-xl ${actionState.boletosSuccess ? "bg-green-500/10 text-green-500" : "bg-[var(--accent)]/10 text-[var(--accent)]"}`}>
                            <UploadCloud size={24} />
                        </div>
                        <div className="flex-1">
                            <h4 className="font-bold text-sm text-[var(--fg)] flex items-center gap-2">5. Organizar Boletos {!isLoteConsolidado && <Lock size={14} className="text-[var(--fg-dim)]" />}</h4>
                            <p className="text-xs text-[var(--fg-dim)] mt-0.5">Upload de PDFs</p>
                        </div>
                        {actionState.boletosSuccess && <span className="text-xs font-bold px-2 py-1 bg-green-500/20 text-green-500 rounded-lg flex items-center gap-1"><CheckCircle2 size={12} /> Concluído</span>}
                    </button>

                    {/* Botão 6: EMAILS */}
                    <button
                        title={!isLoteConsolidado ? "Consolide o lote primeiro" : ""}
                        onClick={() => setActiveModal("emails")}
                        disabled={!isLoteConsolidado || actionState.emailsSuccess || loadingMap["emailsSuccess"]}
                        className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all mt-4 ${actionState.emailsSuccess ? "bg-green-900/30 border-green-500/50 opacity-60" : "bg-[var(--danger)]/10 border-[var(--danger)]/30 hover:bg-[var(--danger)]/20 hover:border-[var(--danger)] shadow-sm hover:shadow-lg"
                            } ${!isLoteConsolidado && "opacity-30 grayscale cursor-not-allowed pointer-events-none"}`}
                    >
                        <div className={`p-3 rounded-xl ${actionState.emailsSuccess ? "bg-green-500 text-white" : "bg-[var(--danger)] text-white"}`}>
                            <Mail size={24} />
                        </div>
                        <div className="flex-1">
                            <h4 className={`font-bold text-sm flex items-center gap-2 ${actionState.emailsSuccess ? "text-green-500" : "text-[var(--danger)]"}`}>
                                6. Disparar E-mails {!isLoteConsolidado && <Lock size={14} className="opacity-50" />}
                            </h4>
                            <p className={`text-xs mt-0.5 ${actionState.emailsSuccess ? "text-green-500/70" : "text-[var(--danger)]/70"}`}>
                                Encerra o Ciclo
                            </p>
                        </div>
                        {actionState.emailsSuccess && <span className="text-xs font-bold px-2 py-1 bg-green-500/20 text-green-500 rounded-lg flex items-center gap-1"><CheckCircle2 size={12} /> Enviado</span>}
                    </button>

                    {pendingNfCount > 0 && (
                        <div className="text-xs text-[var(--danger)] text-center font-bold px-3 py-2 bg-red-500/10 rounded-xl border border-red-500/20 flex flex-col items-center gap-1">
                            <span>Atenção: {pendingNfCount} {pendingNfCount === 1 ? 'loja ainda está' : 'lojas ainda estão'} sem Nota Fiscal.</span>
                        </div>
                    )}
                </div>

                {/* Tabela Relatório de Conferência */}
                <div className="lg:col-span-2 bg-[var(--bg-sidebar)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-lg h-fit flex flex-col">
                    <div className="px-6 py-4 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between bg-[rgba(0,0,0,0.2)] gap-4">
                        <div>
                            <h3 className="text-lg font-bold text-[var(--fg)] flex items-center gap-2">
                                <ShieldCheck size={20} className="text-[var(--accent)]" /> Painel de Auditoria Fiscal
                            </h3>
                            <p className="text-xs text-[var(--fg-dim)] mt-1">Acoplagem fiscal das {matchFiles.reports.length} empresas p/ o faturamento.</p>
                        </div>

                        {/* Quick Filters */}
                        <div className="flex bg-[var(--bg-card)] border border-[var(--border)] p-1 rounded-xl w-full sm:w-auto overflow-x-auto no-scrollbar">
                            <button
                                onClick={() => setFilterStatus("TODAS")}
                                className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-colors whitespace-nowrap ${filterStatus === "TODAS" ? "bg-[var(--accent)] text-white shadow" : "text-[var(--fg-dim)] hover:text-[var(--fg)]"}`}
                            >
                                Todas
                            </button>
                            <button
                                onClick={() => setFilterStatus("FALTA_NF")}
                                className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-colors whitespace-nowrap ${filterStatus === "FALTA_NF" ? "bg-[var(--danger)] text-white shadow" : "text-[var(--fg-dim)] hover:text-[var(--danger)]"}`}
                            >
                                Falta NF
                            </button>
                            <button
                                onClick={() => setFilterStatus("FALTA_NC")}
                                className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-colors whitespace-nowrap ${filterStatus === "FALTA_NC" ? "bg-amber-500 text-white shadow" : "text-[var(--fg-dim)] hover:text-amber-500"}`}
                            >
                                Falta NC
                            </button>
                            <button
                                onClick={() => setFilterStatus("COM_DESCONTO_IR")}
                                className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-colors whitespace-nowrap ${filterStatus === "COM_DESCONTO_IR" ? "bg-purple-500 text-white shadow" : "text-[var(--fg-dim)] hover:text-purple-500"}`}
                            >
                                Desc. IR
                            </button>
                        </div>
                    </div>

                    <div className="max-h-[500px] overflow-y-auto custom-scrollbar p-0">
                        <table className="w-full text-left text-sm whitespace-nowrap min-w-[700px]">
                            <thead className="bg-[var(--bg-card)] sticky top-0 shadow-sm z-10 border-b border-[var(--border)]">
                                <tr>
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold uppercase text-[10px] tracking-wider">Cliente/Faturamento</th>
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider">Valor Boleto</th>
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold text-center uppercase text-[10px] tracking-wider">Nota Fiscal (NF)</th>
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold text-center uppercase text-[10px] tracking-wider">Nota de Crédito (NC)</th>
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider">Desconto IR</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                                {filteredReports.map((r, i) => (
                                    <tr key={i} className="hover:bg-[rgba(33,118,255,0.02)] transition-colors">
                                        <td className="py-4 px-6">
                                            <p className="font-bold text-[var(--fg)] text-ellipsis overflow-hidden max-w-[200px]">{r.razaoSocial}</p>
                                            <div className="flex gap-2 items-center mt-1">
                                                <span className="text-[10px] text-[var(--fg-muted)] font-mono">{r.cnpj ? r.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : r.nome}</span>
                                            </div>
                                        </td>
                                        <td className="py-4 px-6 text-right">
                                            <span className="font-mono text-[13px] font-bold text-[var(--fg)]">{fmtCurrency(r.totalFaturar)}</span>
                                        </td>
                                        <td className="py-4 px-6 text-center">
                                            {r.statusNF === 'EMITIDA' ? (
                                                <div className="flex flex-col items-center gap-1">
                                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20">
                                                        <CheckCircle2 size={12} /> Emitida
                                                    </span>
                                                    {r.numeroNF && <span className="font-mono text-[10px] text-green-500/80">NF: {r.numeroNF}</span>}
                                                </div>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-red-500/10 text-red-500 border border-red-500/20">
                                                    <AlertTriangle size={12} /> Pendente
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-4 px-6 text-center">
                                            {r.statusNC === 'NAO_APLICAVEL' ? (
                                                <span className="text-[14px] font-bold text-[var(--border)]">—</span>
                                            ) : r.statusNC === 'PENDENTE' ? (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                                    <Info size={12} /> Aguardando NC
                                                </span>
                                            ) : (
                                                <div className="flex flex-col items-center gap-1">
                                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                                        <CheckCircle2 size={12} /> Gerada
                                                    </span>
                                                    {r.numeroNC && <span className="font-mono text-[10px] text-blue-500/80">NC: {r.numeroNC}</span>}
                                                </div>
                                            )}
                                        </td>
                                        <td className="py-4 px-6 text-right">
                                            {r.descontoIR && r.descontoIR > 0 ? (
                                                <span className="font-mono text-[12px] font-bold text-red-400 bg-red-500/5 px-2 py-1 rounded-md">
                                                    - {fmtCurrency(r.descontoIR)}
                                                </span>
                                            ) : (
                                                <span className="font-mono text-[12px] font-medium text-[var(--fg-muted)]">R$ 0,00</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {filteredReports.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="py-12 text-center text-[var(--fg-dim)] text-sm">
                                            Nenhuma loja corresponde ao filtro selecionado.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Orfans Alert */}
            {
                (matchFiles.orphanBoletos.length > 0 || matchFiles.orphanNfses.length > 0) && (
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
                )
            }
        </div >
    );
}
