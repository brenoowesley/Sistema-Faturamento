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
    nfseFiles: {
        name: string;
        blob: Blob;
        buffer: ArrayBuffer;
        fiscalData?: {
            numero: string;
            valorIr: number;
            cnpj: string;
            valorServicos: number;
        }
    }[];
    setNfseFiles?: React.Dispatch<React.SetStateAction<any[]>>;
    financialSummary: FinancialSummary;
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
    saving,
    saveResult,
    loteId,
    setLoteId,
    periodoInicio,
    periodoFim,
    nomePasta
}: FechamentoLoteProps) {

    const [boletoFiles, setBoletoFiles] = useState<{ name: string; fetchUrl: string; file: File }[]>([]);
    const [pdfNfsFiles, setPdfNfsFiles] = useState<{ name: string; blob: Blob; buffer: ArrayBuffer }[]>([]);

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
    const [dbConsolidados, setDbConsolidados] = useState<Record<string, string>>({}); // uniqueKey -> consolidadoId
    const [existingConsolidados, setExistingConsolidados] = useState<any[]>([]);

    const boletosInputRef = useRef<HTMLInputElement>(null);
    const nfsInputRef = useRef<HTMLInputElement>(null);
    const [manualMappings, setManualMappings] = useState<Record<string, { consolidadoId: string; type: 'nfse' | 'boleto' }>>({});
    const [xmlParsedData, setXmlParsedData] = useState<Record<string, { cnpj: string; valorIr: number; numero_nf_real: string; valorServicos: number; name: string }>>({});

    useEffect(() => {
        const parseXmls = async () => {
            if (!nfseFiles?.length) return;
            const newParsedMap: Record<string, any> = {};

            for (const f of nfseFiles) {
                if (f.name.toLowerCase().endsWith(".xml")) {
                    try {
                        const xmlText = new TextDecoder().decode(f.buffer);
                        const parser = new DOMParser();
                        const xmlDoc = parser.parseFromString(xmlText, "text/xml");

                        // 1. IGNORAR TAG <Numero> (Bug NFE.io)
                        // Extração exclusivamente do nome do arquivo
                        const match = f.name.match(/(\d+)-nfse\.xml$/i);
                        // Remove zeros à esquerda: ex 00019894 -> 19894
                        const numeroNF = match ? String(parseInt(match[1], 10)) : "";

                        // 2. Extração de Cnpj e ValorIr (Continuam necessárias)
                        const tomadorNode = xmlDoc.getElementsByTagName("TomadorServico")[0] || xmlDoc.getElementsByTagName("tomador_servico")[0] || xmlDoc.getElementsByTagName("Tomador")[0] || xmlDoc.getElementsByTagName("dest")[0];
                        const cnpj = tomadorNode
                            ? (tomadorNode.getElementsByTagName("Cnpj")[0]?.textContent || tomadorNode.getElementsByTagName("cnpj")[0]?.textContent || tomadorNode.getElementsByTagName("CPF")[0]?.textContent || "")
                            : (xmlDoc.getElementsByTagName("Cnpj")[1]?.textContent || xmlDoc.getElementsByTagName("Cnpj")[0]?.textContent || "");

                        const valorIrStr = xmlDoc.getElementsByTagName("ValorIr")[0]?.textContent || xmlDoc.getElementsByTagName("valor_ir")[0]?.textContent || "0";
                        const valorIr = parseFloat(valorIrStr.replace(',', '.'));

                        const valorServicosStr = xmlDoc.getElementsByTagName("ValorServicos")[0]?.textContent || xmlDoc.getElementsByTagName("valor_servicos")[0]?.textContent || "0";
                        const valorServicos = parseFloat(valorServicosStr.replace(',', '.'));

                        if (numeroNF) {
                            console.group(`[XML Extract] Arquivo: ${f.name}`);
                            console.log(`NF Real Extraída (Nome): ${numeroNF}`);
                            console.log(`CNPJ Fiscal (Interno): ${cnpj}`);
                            console.log(`IRRF Fiscal (Interno): ${valorIr}`);
                            console.groupEnd();

                            newParsedMap[numeroNF] = {
                                cnpj: cnpj.replace(/\D/g, ''),
                                valorIr,
                                numero_nf_real: numeroNF,
                                valorServicos,
                                name: f.name
                            };
                        }
                    } catch (e) {
                        console.error("Erro ao processar XML:", f.name, e);
                    }
                }
            }
            setXmlParsedData(newParsedMap);
        };

        parseXmls();
    }, [nfseFiles]);

    useEffect(() => {
        const fetchExisting = async () => {
            const currentLoteId = loteId || saveResult?.loteId || (typeof window !== "undefined" ? sessionStorage.getItem('currentLoteId') : null);
            if (!currentLoteId) return;

            const { data, error } = await supabase
                .from('faturamento_consolidados')
                .select('*')
                .eq('lote_id', currentLoteId);

            if (!error && data) {
                setExistingConsolidados(data);
                setIsLoteConsolidado(true);

                // Also populate dbConsolidados map for upload handlers
                const idMap: Record<string, string> = {};
                data.forEach(row => {
                    const client = agendamentos.find(v => v.clienteId === row.cliente_id);
                    const isQueiroz = client?.loja.includes('(Mês Anterior)') || client?.loja.includes('(Mês Atual)');
                    const key = isQueiroz ? `${row.cliente_id}_${client?.loja}` : (row.cliente_id || "");
                    idMap[key] = row.id;
                });
                setDbConsolidados(idMap);
            }
        };

        fetchExisting();
    }, [loteId, saveResult, agendamentos]);


    interface StoreData {
        consolidadoId: string;
        id: string;
        nome: string;
        razaoSocial: string;
        nomeContaAzul: string;
        cnpj: string | undefined;
        totalFaturar: number;
        valorBase: number;
        valorAcrescimos: number;
        valorDescontos: number;
        data_competencia?: string;
        ciclo: string;
        numero_nf?: string | null;
        descontoIR: number;
        cnpjFilial?: string | null;
        isXmlMatched?: boolean;
        xmlValorServicos?: number;
        pdfNfMatch?: any;
    }


    const matchFiles = useMemo(() => {
        const validados = agendamentos.filter(a =>
            !a.isRemoved &&
            (a.status === "OK" || a.status === "CORREÇÃO") &&
            a.clienteId
        );

        const lojasUnicas = new Map<string, StoreData>();
        const usedNfIds = new Set<string>();
        const cleanCnpj = (c?: string | null) => c ? c.replace(/\D/g, '').replace(/^0+/, '') : '';

        for (const a of validados) {
            const isQueirozSplit = a.loja.includes('(Mês Anterior)') || a.loja.includes('(Mês Atual)');
            const uniqueKey = isQueirozSplit ? `${a.clienteId}_${a.loja}` : a.clienteId!;

            if (!lojasUnicas.has(uniqueKey)) {
                lojasUnicas.set(uniqueKey, {
                    consolidadoId: a.id!,
                    id: a.clienteId!,
                    nome: a.loja,
                    razaoSocial: a.razaoSocial || a.loja,
                    nomeContaAzul: a.nome_conta_azul || a.razaoSocial || a.loja, // Prioridade para nome_conta_azul
                    cnpj: a.cnpj?.replace(/\D/g, ''),
                    data_competencia: a.data_competencia || a.dataCompetencia,
                    ciclo: (a as any).ciclo || "-", // Captura o ciclo para a hierarquia do Drive
                    numero_nf: null,
                    descontoIR: 0,
                    valorBase: 0,
                    totalFaturar: 0,
                    valorAcrescimos: 0,
                    valorDescontos: 0,
                    isXmlMatched: false
                });
            }

            const lojaEntry = lojasUnicas.get(uniqueKey)!;

            // Try to find if we already have this in Supabase
            const existing = existingConsolidados.find(ec =>
                ec.cliente_id === a.clienteId &&
                (!lojaEntry.data_competencia || ec.data_competencia?.slice(0, 7) === lojaEntry.data_competencia?.slice(0, 7))
            );

            if (existing) {
                lojaEntry.numero_nf = existing.numero_nf;
                lojaEntry.descontoIR = existing.valor_irrf || 0;
                lojaEntry.cnpjFilial = existing.cnpj_filial || null;
                // Preserve ciclo if coming from existing
                if ((existing as any).ciclo) {
                    lojaEntry.ciclo = (existing as any).ciclo;
                }
            }
            const baseVal = a.originalValorIwof ?? a.valorIwof;
            const finalVal = a.status === "CORREÇÃO" ? (a.suggestedValorIwof ?? a.valorIwof) : (a.manualValue ?? a.valorIwof);

            lojaEntry.valorBase += baseVal;
            lojaEntry.totalFaturar += finalVal;

            if (finalVal > baseVal) {
                lojaEntry.valorAcrescimos += (finalVal - baseVal);
            } else if (finalVal < baseVal) {
                lojaEntry.valorDescontos += (baseVal - finalVal);
            }

            // --- XML Data Matching (Refined Senior Rule with ID-based pairing & Sequential Pool) ---
            // 1. Search for XML by Cleaned CNPJ in the indexed data (Sequential allocation)
            const matchingXmlEntry = Object.entries(xmlParsedData).find(([nfNum, data]) => {
                if (usedNfIds.has(nfNum)) return false; // Pula se já foi atribuída (Sequential Pool)

                const safeCnpjDb = cleanCnpj(lojaEntry.cnpj);
                const safeCnpjXml = cleanCnpj(data.cnpj);

                return safeCnpjDb && safeCnpjXml && safeCnpjDb === safeCnpjXml;
            });

            if (matchingXmlEntry) {
                const [numeroNF, data] = matchingXmlEntry;
                usedNfIds.add(numeroNF); // Marca como consumida para evitar duplicação em múltiplas lojas do mesmo cliente

                lojaEntry.numero_nf = numeroNF;
                lojaEntry.descontoIR = data.valorIr;
                lojaEntry.isXmlMatched = true;
                lojaEntry.xmlValorServicos = data.valorServicos;

                // 2. Pair with the physical PDF uploaded in Step 5 using the precise numeroNF
                const matchingPdf = pdfNfsFiles.find(p => p.name.includes(numeroNF));
                if (matchingPdf) {
                    lojaEntry.pdfNfMatch = matchingPdf;
                    console.log(`[Full Match] Unified XML + PDF for ${lojaEntry.nome}: NF ${numeroNF}, IR ${data.valorIr}`);
                } else {
                    console.warn(`[Partial Match] XML found for ${lojaEntry.nome} (NF ${numeroNF}), but PDF file "${numeroNF}-nfse.pdf" is missing.`);
                }
            }
        }

        const initialReports = Array.from(lojasUnicas.values()).map(loja => {
            let statusNF: 'PENDENTE' | 'EMITIDA' = 'PENDENTE';
            let nfseMatch = null;

            if (loja.pdfNfMatch) {
                nfseMatch = loja.pdfNfMatch;
            }

            if (nfseMatch) {
                statusNF = 'EMITIDA';
            }

            // Fallback: manual mapping for NF
            if (!nfseMatch) {
                const manual = Object.entries(manualMappings).find(([fileName, map]) => map.consolidadoId === loja.consolidadoId && map.type === 'nfse');
                if (manual) {
                    nfseMatch = nfseFiles.find(f => f.name === manual[0]) || null;
                    if (nfseMatch) statusNF = 'EMITIDA';
                }
            }

            return {
                ...loja,
                nfse: nfseMatch,
                statusNF,
                numeroNF: loja.numero_nf,
                descontoIR: loja.descontoIR,
                cnpjFilial: loja.cnpjFilial
            };
        });

        // 3. SMART MATCH BOLETOS (Conta Azul style with Queue for splits)
        const matchedNfseNames = new Set(initialReports.map(r => r.nfse?.name).filter(Boolean));
        const orphanNfses = pdfNfsFiles.filter(f => !matchedNfseNames.has(f.name));

        const matchedBoletoNames = new Set<string>();
        const reportsWithBoletos = initialReports.map(report => {
            // Try manual mapping first
            const manual = Object.entries(manualMappings).find(([fileName, map]) => map.consolidadoId === report.consolidadoId && map.type === 'boleto');
            if (manual) {
                const file = boletoFiles.find(f => f.name === manual[0]);
                if (file) {
                    matchedBoletoNames.add(file.name);
                    return { ...report, boleto: file };
                }
            }

            // Automatic Smatch Match (normalized name) with priority for nomeContaAzul
            const normalizedStoreName = normalizarNome(report.nomeContaAzul);
            const normalizedRazao = normalizarNome(report.razaoSocial);

            // SEQUENTIAL ALLOCATION (Senior Rule): find the first available boleto that matches the store
            const boletoMatch = boletoFiles.find(f => {
                if (matchedBoletoNames.has(f.name)) return false;
                if (!f.name.toLowerCase().endsWith(".pdf")) return false; // PDF only (Senior Rule)

                // Normalization Rule: replace _, remove ', remove accents, lowercase
                const normalizedFile = normalizarNome(f.name.replace(/\.pdf$/i, ""));

                return normalizedFile === normalizedStoreName || normalizedFile === normalizedRazao ||
                    normalizedFile.includes(normalizedStoreName) || normalizedStoreName.includes(normalizedFile);
            });

            if (boletoMatch) {
                matchedBoletoNames.add(boletoMatch.name);
                return { ...report, boleto: boletoMatch };
            }

            return { ...report, boleto: null };
        });

        const orphanBoletos = boletoFiles.filter(f => !matchedBoletoNames.has(f.name));

        const finalReports = reportsWithBoletos.map(r => {
            let statusNC: 'NAO_APLICAVEL' | 'PENDENTE' | 'EMITIDA' = 'NAO_APLICAVEL';
            let numeroNC: string | undefined;

            if (r.statusNF === 'PENDENTE') {
                statusNC = actionState.ncsSuccess ? 'EMITIDA' : 'PENDENTE';
                if (actionState.ncsSuccess) numeroNC = "Gerada";
            }
            return { ...r, statusNC, numeroNC };
        });

        return { reports: finalReports, orphanNfses, orphanBoletos };
    }, [agendamentos, nfseFiles, pdfNfsFiles, xmlParsedData, boletoFiles, actionState.ncsSuccess, manualMappings]);

    const handleConsolidarLote = async () => {
        try {
            setLoadingMap(prev => ({ ...prev, consolidar: true }));

            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;
            if (!user) throw new Error("Usuário não autenticado para consolidar o lote.");

            // 1. CRIAR O LOTE (se ainda não existir)
            let currentLoteId = loteId || saveResult?.loteId || (typeof window !== "undefined" ? sessionStorage.getItem('currentLoteId') : null);

            if (!currentLoteId) {
                const validos = agendamentos.filter(a => !a.isRemoved && (a.status === "OK" || a.status === "CORREÇÃO") && a.clienteId);
                let valTotal = 0;

                const agsInserir = validos.map(a => {
                    const finalVal = a.status === "CORREÇÃO" ? (a.suggestedValorIwof ?? a.valorIwof) : (a.manualValue ?? a.valorIwof);
                    valTotal += finalVal;
                    return {
                        cliente_id: a.clienteId,
                        nome_profissional: a.nome,
                        vaga: a.vaga,
                        inicio: a.inicio ? a.inicio.toISOString() : null,
                        termino: a.termino ? a.termino.toISOString() : null,
                        valor_iwof: finalVal,
                        fracao_hora: a.status === "CORREÇÃO" ? (a.suggestedFracaoHora ?? a.fracaoHora) : a.fracaoHora,
                        ref_agendamento: a.refAgendamento,
                        data_cancelamento: a.dataCancelamento ? a.dataCancelamento.toISOString() : null,
                        motivo_cancelamento: a.motivoCancelamento,
                        responsavel_cancelamento: a.responsavelCancelamento,
                        raw_data: a.rawRow
                    };
                });

                const pStartUTC = periodoInicio ? new Date(periodoInicio + "T00:00:00Z").toISOString() : null;
                const pEndUTC = periodoFim ? new Date(periodoFim + "T23:59:59Z").toISOString() : null;

                const { data: lote, error: loteErr } = await supabase
                    .from('faturamentos_lote')
                    .insert({
                        nome: nomePasta || `Lote ${new Date().toLocaleString("pt-BR")}`,
                        periodo_inicio: pStartUTC,
                        periodo_fim: pEndUTC,
                        status: 'FECHADO',
                        quantidade_agendamentos: agsInserir.length,
                        valor_total: valTotal,
                        criado_por: user.id
                    })
                    .select('id').single();

                if (loteErr) {
                    console.error("🚨 ERRO LOTE:", loteErr);
                    alert("Falha ao criar o Lote no banco de dados: " + loteErr.message);
                    return;
                }

                currentLoteId = lote.id;

                if (setLoteId) setLoteId(currentLoteId);
                if (typeof window !== "undefined") sessionStorage.setItem('currentLoteId', currentLoteId!);
                console.log("✅ LOTE CRIADO NO SUPABASE COM ID:", currentLoteId);

                // 2. INSERIR AGENDAMENTOS BRUTOS
                const batchSize = 1000;
                for (let i = 0; i < agsInserir.length; i += batchSize) {
                    const chunk = agsInserir.slice(i, i + batchSize).map(x => ({ ...x, lote_id: currentLoteId }));
                    const { error: agendamentosErr } = await supabase.from("agendamentos_brutos").insert(chunk);
                    if (agendamentosErr) {
                        console.error("🚨 ERRO AGENDAMENTOS:", agendamentosErr);
                        alert("Falha ao salvar agendamentos extraídos: " + agendamentosErr.message);
                        return;
                    }
                }
            }

            // 3. INSERIR CONSOLIDADOS FISCAIS (Faturamento por Loja Final)
            const consolidadosPayload = matchFiles.reports.map(r => ({
                lote_id: currentLoteId,
                cliente_id: r.id,
                data_competencia: r.data_competencia || null, // FIX: Preserva a competência em caso de split
                valor_bruto: r.totalFaturar || 0,
                acrescimos: 0,
                descontos: 0,
                valor_irrf: r.descontoIR || 0,
                numero_nf: r.numeroNF || null,
                valor_nf_emitida: r.statusNF === 'EMITIDA' ? r.totalFaturar : 0,
                valor_nc_final: r.statusNF === 'PENDENTE' ? r.totalFaturar : 0, // FIX: Se não tem NF no XML, o valor é provisionado para NC
                valor_boleto_final: r.totalFaturar - (r.descontoIR || 0),
                cnpj_filial: r.cnpjFilial || null, // FIX: Gravando o emissor
                valor_ir_xml: r.descontoIR || 0
            }));

            if (consolidadosPayload.length > 0) {
                // Remove antigos antes de re-inserir para garantir idempotência ao clicar múltiplas vezes
                await supabase.from('faturamento_consolidados').delete().eq('lote_id', currentLoteId);

                const { data: inserted, error: consolidadosErr } = await supabase
                    .from('faturamento_consolidados')
                    .insert(consolidadosPayload)
                    .select('id, cliente_id, data_competencia');

                if (consolidadosErr) {
                    console.error("🚨 ERRO CONSOLIDADOS:", consolidadosErr);
                    alert("Falha ao criar painel de consolidados (IRRF e Totais da NF): " + consolidadosErr.message);
                    return;
                }

                if (inserted) {
                    const idMap: Record<string, string> = {};
                    const validadosParaMap = agendamentos.filter(a => !a.isRemoved && (a.status === "OK" || a.status === "CORREÇÃO") && a.clienteId);
                    inserted.forEach(row => {
                        // Recria a uniqueKey p/ o mapeamento
                        const client = validadosParaMap.find(v => v.clienteId === row.cliente_id);
                        const isQueiroz = client?.loja.includes('(Mês Anterior)') || client?.loja.includes('(Mês Atual)');
                        const key = isQueiroz ? `${row.cliente_id}_${client?.loja}` : (row.cliente_id || "");
                        idMap[key] = row.id;
                    });
                    setDbConsolidados(idMap);
                }
            }

            alert("✅ Lote, agendamentos e consolidados fiscais gravados com pleno sucesso!");
            console.log("🟢 Consolidação Definitiva Executada no Lote:", currentLoteId);
            setIsLoteConsolidado(true);

        } catch (error: any) {
            console.error("🚨 ERRO CRÍTICO NO CÓDIGO DA CONSOLIDAÇÃO:", error);
            alert("Erro interno ao processar o salvamento. Verifique o F12 (Console) para mais detalhes tecnológicos.");
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
                            if (filename.toLowerCase().endsWith(".pdf")) {
                                const blob = await fileData.async("blob");
                                const buffer = await fileData.async("arraybuffer");
                                extractedFiles.push({ name: filename, blob, buffer });
                            }
                        }
                    }
                } else if (file.name.toLowerCase().endsWith(".pdf")) {
                    const buffer = await file.arrayBuffer();
                    extractedFiles.push({ name: file.name, blob: file, buffer });
                }
            }
            setPdfNfsFiles(prev => [...prev, ...extractedFiles]);
        } catch (error) {
            console.error("Error reading zip/pdf upload", error);
            alert("Erro ao extrair arquivos de Notas Fiscais (PDFs).");
        } finally {
            setLoadingMap(p => ({ ...p, "zipNfs": false }));
        }
    };

    const handleUploadBoletos = async () => {
        setLoadingMap(p => ({ ...p, "boletosSuccess": true }));
        try {
            const targetLoteId = loteId || saveResult?.loteId || (typeof window !== "undefined" ? sessionStorage.getItem('currentLoteId') : null);
            if (!targetLoteId) throw new Error("Falha ao encontrar o lote.");

            const formData = new FormData();
            formData.append("loteId", targetLoteId);

            const metadataArray: any[] = [];
            const [ano, mes] = (periodoInicio || "").split("-");

            for (const r of matchFiles.reports) {
                if (r.boleto) {
                    formData.append("files", r.boleto.file, r.boleto.name);
                    metadataArray.push({
                        filename: r.boleto.name,
                        clienteId: r.id,
                        consolidadoId: dbConsolidados[r.id] || r.consolidadoId,
                        nome_conta_azul: r.nomeContaAzul || r.razaoSocial,
                        ciclo: r.ciclo || "Geral",
                        ano: ano || new Date().getFullYear().toString(),
                        mes: mes || (new Date().getMonth() + 1).toString().padStart(2, '0'),
                        docType: "hc"
                    });
                }
            }

            if (metadataArray.length === 0) {
                alert("Nenhum boleto pareado para upload.");
                return;
            }

            formData.append("metadata", JSON.stringify(metadataArray));

            const res = await fetch("/api/drive/upload", { method: "POST", body: formData });
            if (!res.ok) throw new Error("Erro no upload dos boletos.");

            setActionState(p => ({ ...p, boletosSuccess: true }));
            alert("Boletos enviados e vinculados com sucesso!");
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
            const targetLoteId = loteId || saveResult?.loteId || (typeof window !== "undefined" ? sessionStorage.getItem('currentLoteId') : null);
            if (!targetLoteId) throw new Error("Falha ao encontrar o lote.");

            const formData = new FormData();
            formData.append("loteId", targetLoteId);

            const metadataArray: any[] = [];
            const [ano, mes] = (periodoInicio || "").split("-");

            for (const r of matchFiles.reports) {
                if (r.nfse) {
                    const file = new File([r.nfse.blob], r.nfse.name, { type: "application/pdf" });
                    formData.append("files", file, r.nfse.name);
                    metadataArray.push({
                        filename: r.nfse.name,
                        clienteId: r.id,
                        consolidadoId: dbConsolidados[r.id] || r.consolidadoId,
                        nome_conta_azul: r.nomeContaAzul || r.razaoSocial,
                        ciclo: r.ciclo || "Geral",
                        ano: ano || new Date().getFullYear().toString(),
                        mes: mes || (new Date().getMonth() + 1).toString().padStart(2, '0'),
                        docType: "nf"
                    });
                }
            }

            if (metadataArray.length === 0) {
                alert("Nenhuma NF pareada para upload.");
                return;
            }

            formData.append("metadata", JSON.stringify(metadataArray));

            const res = await fetch("/api/drive/upload", { method: "POST", body: formData });
            if (!res.ok) throw new Error("Erro no upload das NFs.");

            setActionState(p => ({ ...p, nfsSuccess: true }));
            alert("Notas Fiscais enviadas e vinculadas com sucesso!");
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
            let targetLoteId = loteId || saveResult?.loteId || (typeof window !== "undefined" ? sessionStorage.getItem('currentLoteId') : null);
            if (!targetLoteId) {
                throw new Error("Falha ao encontrar o lote inicial gerado. Retorne aos passos anteriores.");
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
            let targetLoteId = loteId || saveResult?.loteId || (typeof window !== "undefined" ? sessionStorage.getItem('currentLoteId') : null);
            if (!targetLoteId) {
                throw new Error("Falha ao encontrar o lote inicial gerado. Retorne aos passos anteriores.");
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
            let targetLoteId = loteId || saveResult?.loteId || (typeof window !== "undefined" ? sessionStorage.getItem('currentLoteId') : null);
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
                                <span className="font-bold text-sm">{loadingMap["zipNfs"] ? "Lendo Arquivos..." : "Selecionar ZIP/PDFs"}</span>
                            </div>
                            <input type="file" ref={nfsInputRef} onChange={handleNfsZipUpload} multiple accept=".zip,.pdf" className="hidden" />
                        </div>
                        {pdfNfsFiles.length > 0 && <p className="text-xs text-center text-[var(--success)] mb-6 font-bold">{pdfNfsFiles.length} PDFs Extraídos!</p>}

                        <div className="flex gap-4">
                            <button className="flex-1 btn btn-ghost" onClick={() => setActiveModal(null)}>Cancelar</button>
                            <button className="flex-1 btn btn-primary" onClick={handleUploadNfs} disabled={loadingMap["nfsSuccess"] || pdfNfsFiles.length === 0}>
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

                    {/* Botão Exportação Conta Azul */}
                    <button
                        title={!isLoteConsolidado ? "Consolide o lote primeiro" : ""}
                        onClick={() => {
                            const targetLoteId = loteId || saveResult?.loteId || (typeof window !== "undefined" ? sessionStorage.getItem('currentLoteId') : null);
                            if (targetLoteId) window.open(`/faturamento/lote/${targetLoteId}/conta-azul`, '_blank');
                        }}
                        disabled={!isLoteConsolidado}
                        className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all bg-[var(--bg-sidebar)] border-[var(--border)] hover:border-[var(--accent)] shadow-sm hover:shadow-md ${!isLoteConsolidado && "opacity-50 grayscale cursor-not-allowed pointer-events-none"}`}
                    >
                        <div className="p-3 rounded-xl bg-blue-500/10 text-blue-500">
                            <FileCode2 size={24} />
                        </div>
                        <div className="flex-1">
                            <h4 className="font-bold text-sm text-[var(--fg)] flex items-center gap-2">Exportar Conta Azul {!isLoteConsolidado && <Lock size={14} className="text-[var(--fg-dim)]" />}</h4>
                            <p className="text-xs text-[var(--fg-dim)] mt-0.5">Gerar CSV de Boletos</p>
                        </div>
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
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold uppercase text-[10px] tracking-wider">Nome conta azul (CNPJ ABAIXO)</th>
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider">Valor boleto base</th>
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider">Valor boleto pós ajustes</th>
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider">Valor descontos</th>
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider">Valor acréscimos</th>
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider">Valor NC</th>
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider">Valor NF</th>
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider">Valor IRRF</th>
                                    <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider">Boleto final</th>
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
                                        <td className="py-4 px-6 text-right font-mono text-[12px] text-[var(--fg-muted)]">
                                            {fmtCurrency(r.valorBase)}
                                        </td>
                                        <td className="py-4 px-6 text-right font-mono text-[13px] font-bold text-[var(--fg)]">
                                            {fmtCurrency(r.totalFaturar)}
                                        </td>
                                        <td className="py-4 px-6 text-right font-mono text-[12px] text-red-400">
                                            {r.valorDescontos > 0 ? `- ${fmtCurrency(r.valorDescontos)}` : '—'}
                                        </td>
                                        <td className="py-4 px-6 text-right font-mono text-[12px] text-green-400">
                                            {r.valorAcrescimos > 0 ? `+ ${fmtCurrency(r.valorAcrescimos)}` : '—'}
                                        </td>
                                        <td className="py-4 px-6 text-right font-mono text-[12px] text-amber-500">
                                            {r.statusNF === 'PENDENTE' ? fmtCurrency(r.totalFaturar) : '—'}
                                        </td>
                                        <td className="py-4 px-6 text-right font-mono text-[12px] text-blue-400">
                                            {r.statusNF === 'EMITIDA' ? fmtCurrency(r.totalFaturar) : '—'}
                                        </td>
                                        <td className="py-4 px-6 text-right font-mono text-[12px] text-purple-400">
                                            <div className="flex flex-col items-end">
                                                {r.descontoIR && r.descontoIR > 0 ? `- ${fmtCurrency(r.descontoIR)}` : '—'}
                                                {r.isXmlMatched && (
                                                    <span className="text-[9px] bg-purple-500/20 text-purple-400 px-1 rounded border border-purple-500/30 mt-0.5 font-bold">XML</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-4 px-6 text-right">
                                            <span className="font-mono text-[13px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md">
                                                {fmtCurrency(r.totalFaturar - (r.descontoIR || 0))}
                                            </span>
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

            {/* Orfans & Manual Mapping UI */}
            {(matchFiles.orphanBoletos.length > 0 || matchFiles.orphanNfses.length > 0) && (
                <div className="bg-[var(--bg-card)] border border-amber-500/30 p-6 rounded-2xl shadow-xl mt-6 animate-in fade-in slide-in-from-bottom-4">
                    <div className="flex items-center gap-3 mb-4">
                        <AlertTriangle className="text-amber-500" size={24} />
                        <h4 className="text-amber-500 font-bold text-lg">Tratamento de Arquivos Órfãos</h4>
                    </div>
                    <p className="text-sm text-[var(--fg-dim)] mb-6">Estes arquivos não foram associados automaticamente. Por favor, vincule-os manualmente às lojas do lote.</p>

                    <div className="grid md:grid-cols-2 gap-8 mb-8">
                        {/* NFs Órfãs */}
                        {matchFiles.orphanNfses.length > 0 && (
                            <div className="space-y-4">
                                <h5 className="text-[10px] uppercase tracking-widest font-black text-amber-500/80 mb-2">NOTAS FISCAIS ({matchFiles.orphanNfses.length})</h5>
                                <div className="max-h-[300px] overflow-y-auto pr-2 space-y-2">
                                    {matchFiles.orphanNfses.map(file => (
                                        <div key={file.name} className="flex flex-col gap-1 p-3 bg-[var(--bg-sidebar)] rounded-xl border border-[var(--border)] hover:border-amber-500/30 transition-all">
                                            <span className="text-xs font-mono font-bold truncate text-[var(--fg)]">{file.name}</span>
                                            <select
                                                className="select select-xs bg-[var(--bg-card)] border-[var(--border)] text-[11px]"
                                                value={manualMappings[file.name]?.consolidadoId || ""}
                                                onChange={(e) => {
                                                    if (e.target.value) {
                                                        setManualMappings(prev => ({ ...prev, [file.name]: { consolidadoId: e.target.value, type: 'nfse' } }));
                                                    }
                                                }}
                                            >
                                                <option value="">Vincular a uma loja...</option>
                                                {matchFiles.reports.map(r => (
                                                    <option key={r.id + r.nome} value={r.consolidadoId}>{r.nome} ({r.numeroNF || 'Sem NF'})</option>
                                                ))}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Boletos Órfãos */}
                        {matchFiles.orphanBoletos.length > 0 && (
                            <div className="space-y-4">
                                <h5 className="text-[10px] uppercase tracking-widest font-black text-emerald-500/80 mb-2">BOLETOS ({matchFiles.orphanBoletos.length})</h5>
                                <div className="max-h-[300px] overflow-y-auto pr-2 space-y-2">
                                    {matchFiles.orphanBoletos.map(file => (
                                        <div key={file.name} className="flex flex-col gap-1 p-3 bg-[var(--bg-sidebar)] rounded-xl border border-[var(--border)] hover:border-emerald-500/30 transition-all">
                                            <span className="text-xs font-mono font-bold truncate text-[var(--fg)]">{file.name}</span>
                                            <select
                                                className="select select-xs bg-[var(--bg-card)] border-[var(--border)] text-[11px]"
                                                value={manualMappings[file.name]?.consolidadoId || ""}
                                                onChange={(e) => {
                                                    if (e.target.value) {
                                                        setManualMappings(prev => ({ ...prev, [file.name]: { consolidadoId: e.target.value, type: 'boleto' } }));
                                                    }
                                                }}
                                            >
                                                <option value="">Vincular a uma loja...</option>
                                                {matchFiles.reports.map(r => (
                                                    <option key={r.id + r.nome} value={r.consolidadoId}>{r.nome} ({fmtCurrency(r.totalFaturar)})</option>
                                                ))}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="mt-8 flex justify-center border-t border-amber-500/20 pt-6">
                        <button
                            onClick={async () => {
                                await handleUploadNfs();
                                await handleUploadBoletos();
                            }}
                            disabled={!isLoteConsolidado || loadingMap["boletosSuccess"] || loadingMap["nfsSuccess"]}
                            className="btn btn-primary btn-lg shadow-lg hover:shadow-amber-500/20 gap-3 px-12"
                        >
                            <Send size={20} />
                            {loadingMap["boletosSuccess"] || loadingMap["nfsSuccess"] ? "Enviando para o Drive..." : "Confirmar e Enviar Todos para o Drive"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
