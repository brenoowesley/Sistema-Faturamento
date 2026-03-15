"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { ArrowLeft, CheckCircle2, ShieldCheck, FileText, UploadCloud, CloudLightning, Mail, AlertTriangle, Info, FileStack, X, FileArchive, Search, Send, FileCode2, Lock, Save } from "lucide-react";
import { Agendamento, FinancialSummary } from "../types";
import { fmtCurrency, normalizarNome, calcularTotaisFaturamento } from "../utils";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/client";
import * as pdfjsLib from "pdfjs-dist";

// Garante que a versão do worker é exatamente igual à versão da biblioteca instalada
if (typeof window !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
}

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
    const [parsedDocumentData, setParsedDocumentData] = useState<Record<string, { cnpj: string; irrf: number; numero_nf_real: string; valorServicos: number; name: string }>>({});
    const [pendingAdjustments, setPendingAdjustments] = useState<any[]>([]);

    useEffect(() => {
        const parseDocuments = async () => {
            if (!nfseFiles?.length) return;
            console.group("📝 Document Parsing Audit (XML + PDF Fallback)");
            const newParsedMap: Record<string, any> = {};

            for (const f of nfseFiles) {
                const isXml = f.name.toLowerCase().endsWith(".xml");
                const isPdf = f.name.toLowerCase().endsWith(".pdf");

                if (isXml) {
                    try {
                        const xmlText = new TextDecoder().decode(f.buffer);
                        const parser = new DOMParser();
                        const xmlDoc = parser.parseFromString(xmlText, "text/xml");

                        // 1. IGNORAR TAG <Numero> (Bug NFE.io)
                        const match = f.name.match(/(\d+)-nfse\.xml$/i);
                        const numeroNF = match ? String(parseInt(match[1], 10)) : "";

                        const tomadorNode = xmlDoc.getElementsByTagName("TomadorServico")[0] || xmlDoc.getElementsByTagName("tomador_servico")[0] || xmlDoc.getElementsByTagName("Tomador")[0] || xmlDoc.getElementsByTagName("dest")[0];
                        const cnpj = tomadorNode
                            ? (tomadorNode.getElementsByTagName("Cnpj")[0]?.textContent || tomadorNode.getElementsByTagName("cnpj")[0]?.textContent || tomadorNode.getElementsByTagName("CPF")[0]?.textContent || "")
                            : (xmlDoc.getElementsByTagName("Cnpj")[1]?.textContent || xmlDoc.getElementsByTagName("Cnpj")[0]?.textContent || "");

                        const irrfStr = xmlDoc.getElementsByTagName("ValorIr")[0]?.textContent || xmlDoc.getElementsByTagName("valor_irrf")[0]?.textContent || "0";
                        const irrfValue = parseFloat(irrfStr.replace(',', '.'));

                        const valorServicosStr = xmlDoc.getElementsByTagName("ValorServicos")[0]?.textContent || xmlDoc.getElementsByTagName("valor_servicos")[0]?.textContent || "0";
                        const valorServicos = parseFloat(valorServicosStr.replace(',', '.'));

                        if (numeroNF) {
                            newParsedMap[numeroNF] = {
                                cnpj: cnpj.replace(/\D/g, ''),
                                irrf: irrfValue,
                                numero_nf_real: numeroNF,
                                valorServicos,
                                name: f.name
                            };
                            console.log(`[XML Extract] ${f.name} -> NF: ${numeroNF}, CNPJ: ${cnpj}, IRRF: ${irrfValue}`);
                        }
                    } catch (err) {
                        console.error("Erro ao processar XML:", f.name, err);
                    }
                } else if (isPdf) {
                    try {
                        const loadingTask = pdfjsLib.getDocument({ data: f.buffer });
                        const pdf = await loadingTask.promise;
                        let fullText = "";

                        for (let i = 1; i <= pdf.numPages; i++) {
                            const page = await pdf.getPage(i);
                            const textContent = await page.getTextContent();
                            const pageText = textContent.items.map((item: any) => item.str).join(" ");
                            fullText += pageText + " ";
                        }

                        // 1. CNPJ Extração (Tomador): Pega o primeiro CNPJ formatado que aparecer estritamente APÓS a palavra "TOMADOR"
                        const cnpjMatch = fullText.match(/TOMADOR[\s\S]*?([0-9]{2}\.[0-9]{3}\.[0-9]{3}\/[0-9]{4}-[0-9]{2})/i);
                        const cnpjExtraido = cnpjMatch ? cnpjMatch[1] : null;
                        const cnpjClean = cnpjExtraido ? cnpjExtraido.replace(/\D/g, '').replace(/^0+/, '') : null;

                        // 2. Número NF (Primário nome do arquivo, secundário texto)
                        const nameMatch = f.name.match(/(\d+)-nfse\.pdf$/i);
                        let numeroNF = nameMatch ? String(parseInt(nameMatch[1], 10)) : "";

                        if (!numeroNF) {
                            const nfRegex = /Número da NFS-e[\s\S]*?(\d+)/i;
                            const nfMatch = fullText.match(nfRegex);
                            numeroNF = nfMatch ? nfMatch[1] : "";
                        }

                        // 3. IRRF: Ancora na seção "TRIBUTAÇÃO FEDERAL" e extrai o valor logo após "IRRF"
                        const tributacaoBlock = fullText.match(/TRIBUTA[ÇC][AÃ]O FEDERAL[\s\S]{0,500}?(?:VALOR\s+TOTAL|$)/i)?.[0] || fullText;
                        const irrfMatch = tributacaoBlock.match(/\bIRRF\b[\s\S]{0,60}?(?:R\$)?\s*([\d.,]+)/i);
                        let irrfExtraido = 0;
                        if (irrfMatch && irrfMatch[1]) {
                            const limpo = irrfMatch[1].replace(/\./g, '').replace(',', '.');
                            if (!isNaN(parseFloat(limpo))) {
                                irrfExtraido = parseFloat(limpo);
                            }
                        }

                        if (numeroNF) {
                            newParsedMap[numeroNF] = {
                                cnpj: cnpjClean,
                                irrf: irrfExtraido,
                                numero_nf_real: numeroNF,
                                valorServicos: 0,
                                name: f.name
                            };
                            console.log(`[PDF Fallback] ${f.name} -> NF: ${numeroNF}, CNPJ: ${cnpjExtraido}, IRRF: ${irrfExtraido}`);
                        }
                    } catch (err) {
                        console.error("Erro ao processar PDF:", f.name, err);
                    }
                }
            }
            setParsedDocumentData(newParsedMap);
            console.groupEnd();
        };

        parseDocuments();
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

                // CORREÇÃO CRÍTICA: Só bloqueia o botão se realmente houver dados gravados
                setIsLoteConsolidado(data.length > 0);

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

    useEffect(() => {
        const fetchAjustes = async () => {
            const validos = agendamentos.filter(a => !a.isRemoved && (a.status === "OK" || a.status === "CORREÇÃO") && a.clienteId);
            const validStoreIds = Array.from(new Set(validos.map(a => a.clienteId).filter(Boolean))) as string[];
            if (validStoreIds.length === 0) return;

            const { data, error } = await supabase
                .from("ajustes_faturamento")
                .select("*")
                .in("cliente_id", validStoreIds)
                .eq("status_aplicacao", false);

            if (!error && data) {
                setPendingAdjustments(data);
            }
        };

        fetchAjustes();
    }, [agendamentos]);


    interface StoreData {
        consolidadoId: string;
        id: string;
        nome: string;
        razaoSocial: string;
        nomeContaAzul: string;
        cnpj: string | undefined;
        valorBaseFaturavel: number;  // Passo 2: bruto + acrescimos - descontos
        valorBruto: number;          // Passo 1: soma pura de horas
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
        boletoUnificado: boolean;
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
                    valorBruto: 0,
                    valorBaseFaturavel: 0,
                    valorAcrescimos: 0,
                    valorDescontos: 0,
                    isXmlMatched: false,
                    boletoUnificado: a.boleto_unificado ?? false
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

            // Passo 1: acumula bruto puro de horas
            lojaEntry.valorBruto += baseVal;
            // Passo 2: acumula base faturável (bruto +/- ajustes)
            lojaEntry.valorBaseFaturavel += finalVal;

            if (finalVal > baseVal) {
                lojaEntry.valorAcrescimos += (finalVal - baseVal);
            } else if (finalVal < baseVal) {
                lojaEntry.valorDescontos += (baseVal - finalVal);
            }
        }

        // --- PHASE 2.5: Inject DB Pending Adjustments ---
        const injectedAjustes = new Set<string>();
        for (const aj of pendingAdjustments) {
            if (injectedAjustes.has(aj.id)) continue;

            const entryKey = Array.from(lojasUnicas.keys()).find(k => k.startsWith(aj.cliente_id));
            if (entryKey) {
                const lojaEntry = lojasUnicas.get(entryKey)!;
                if (aj.tipo === "ACRESCIMO") {
                    lojaEntry.valorAcrescimos += Number(aj.valor);
                    lojaEntry.valorBaseFaturavel += Number(aj.valor);
                } else if (aj.tipo === "DESCONTO") {
                    lojaEntry.valorDescontos += Number(aj.valor);
                    lojaEntry.valorBaseFaturavel -= Number(aj.valor);
                }
                injectedAjustes.add(aj.id);
            }
        }

        // --- PHASE 5: Decoupled Logic (XML is Data, PDF is Anexo) ---
        const initialReports = Array.from(lojasUnicas.values()).map(loja => {
            let statusNF: 'PENDENTE' | 'EMITIDA' = 'PENDENTE';
            let numeroNF = loja.numero_nf;
            let descontoIR = loja.descontoIR;
            let cnpjFilial = loja.cnpjFilial;
            let nfseMatch: any = null;

            // 1. DADOS (XML Priority with CNPJ Shielding & Auditing)
            const matchingNfEntry = Object.entries(parsedDocumentData).find(([nfNum, entry]) => {
                const data = entry as any;
                if (usedNfIds.has(nfNum)) return false;

                const safeCnpjDb = cleanCnpj(loja.cnpj);
                const safeCnpjXml = cleanCnpj(data.cnpj);

                if (safeCnpjXml) {
                    // Audit log for alignment checks
                    console.log(`[MATCH AUDIT] Loja: ${loja.nome} | DB: ${loja.cnpj} -> ${safeCnpjDb} | XML: ${safeCnpjXml} | NF: ${nfNum}`);
                }

                return safeCnpjDb && safeCnpjXml && safeCnpjDb === safeCnpjXml;
            });

            if (matchingNfEntry) {
                const [nfId, data] = matchingNfEntry;
                usedNfIds.add(nfId);

                statusNF = 'EMITIDA';
                numeroNF = data.numero_nf_real || nfId;
                descontoIR = data.irrf;
                cnpjFilial = data.cnpj; // Use CNPJ from XML for consistency

                // 2. ANEXO (Passive matching, don't block if missing)
                const targetNF = String(numeroNF);
                nfseMatch = pdfNfsFiles?.find(p => p.name.includes(targetNF)) || null;

                if (nfseMatch) {
                    console.log(`[FULL MATCH] XML ${targetNF} + PDF found for ${loja.nome}`);
                } else {
                    console.log(`[INFO] XML ${targetNF} vinculado à loja ${loja.nome}. Aguardando posterior upload do PDF.`);
                }
            } else if (numeroNF) {
                // If it already had a number (from DB), consider it emitted
                statusNF = 'EMITIDA';
                // Try to find the PDF if we already have the number
                const targetNF = String(numeroNF);
                nfseMatch = pdfNfsFiles?.find(p => p.name.includes(targetNF)) || null;
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
                numeroNF,
                descontoIR,
                cnpjFilial
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
    }, [agendamentos, nfseFiles, pdfNfsFiles, parsedDocumentData, boletoFiles, actionState.ncsSuccess, manualMappings, pendingAdjustments]);

    const handleConsolidarLote = async () => {
        try {
            setLoadingMap(prev => ({ ...prev, consolidar: true }));

            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;

            let currentLoteId = loteId || saveResult?.loteId || (typeof window !== "undefined" ? sessionStorage.getItem('currentLoteId') : null);

            const validos = agendamentos.filter(a => !a.isRemoved && (a.status === "OK" || a.status === "CORREÇÃO") && a.clienteId);
            let valTotal = 0;

            const validStoreIds = Array.from(new Set(validos.map(a => a.clienteId).filter(Boolean))) as string[];

            const { data: ajustes, error: ajErr } = await supabase
                .from("ajustes_faturamento")
                .select("*")
                .in("cliente_id", validStoreIds)
                .eq("status_aplicacao", false);

            if (ajErr) throw new Error("Erro buscar ajustes: " + ajErr.message);

            const ajustesMap = new Map<string, { acrescimos: number, descontos: number }>();
            ajustes?.forEach(aj => {
                if (!ajustesMap.has(aj.cliente_id)) {
                    ajustesMap.set(aj.cliente_id, { acrescimos: 0, descontos: 0 });
                }
                const storeAjuste = ajustesMap.get(aj.cliente_id)!;
                if (aj.tipo === "ACRESCIMO") storeAjuste.acrescimos += Number(aj.valor);
                if (aj.tipo === "DESCONTO") storeAjuste.descontos += Number(aj.valor);
            });

            // MAP DOS AGENDAMENTOS (Chaves Corretas)
            const agsInserir = validos.map(a => {
                const finalVal = a.status === "CORREÇÃO" ? (a.suggestedValorIwof ?? a.valorIwof) : (a.manualValue ?? a.valorIwof);
                valTotal += finalVal;
                return {
                    loja_id: a.clienteId,
                    nome_profissional: a.nome,
                    vaga: a.vaga,
                    data_inicio: a.inicio ? a.inicio.toISOString() : null,
                    data_fim: a.termino ? a.termino.toISOString() : null,
                    valor_iwof: finalVal,
                    fracao_hora: a.status === "CORREÇÃO" ? (a.suggestedFracaoHora ?? a.fracaoHora) : a.fracaoHora,
                    status_validacao: "VALIDADO",
                    data_competencia: a.data_competencia || a.dataCompetencia || null
                };
            });

            // 1. GARANTIR A EXISTÊNCIA E O STATUS DO LOTE
            if (!currentLoteId) {
                const compBase = validos.length > 0 ? (validos[0].data_competencia || validos[0].dataCompetencia || periodoInicio) : periodoInicio;
                const { data: lote, error: loteErr } = await supabase
                    .from('faturamentos_lote')
                    .insert({
                        data_competencia: compBase,
                        data_inicio_ciclo: periodoInicio,
                        data_fim_ciclo: periodoFim,
                        nome_pasta: nomePasta || `Lote ${new Date().toLocaleString("pt-BR")}`,
                        status: 'FECHADO'
                    })
                    .select('id').single();

                if (loteErr) throw new Error("Erro ao criar Lote: " + loteErr.message);
                currentLoteId = lote.id;
                if (setLoteId) setLoteId(currentLoteId);
                if (typeof window !== "undefined") sessionStorage.setItem('currentLoteId', currentLoteId!);
            } else {
                // Lote já existe (Rascunho): Atualizar para Fechado e limpar sujeira
                await supabase.from('faturamentos_lote').update({ status: 'FECHADO' }).eq('id', currentLoteId);
                await supabase.from('agendamentos_brutos').delete().eq('lote_id', currentLoteId);
            }

            // 2. INSERIR AGENDAMENTOS BRUTOS SEMPRE (Obrigatoriedade)
            const batchSize = 1000;
            for (let i = 0; i < agsInserir.length; i += batchSize) {
                const chunk = agsInserir.slice(i, i + batchSize).map(x => ({ ...x, lote_id: currentLoteId }));
                const { error: agendamentosErr } = await supabase.from("agendamentos_brutos").insert(chunk);
                if (agendamentosErr) throw new Error("Erro ao salvar agendamentos: " + agendamentosErr.message);
            }

            // 3. INSERIR CONSOLIDADOS FISCAIS
            // Pipeline matemático estrito: Passo 1→2→3→4→5
            const consolidadosPayload = matchFiles.reports.flatMap(r => {
                let finalAcrescimos = r.valorAcrescimos || 0;
                let finalDescontos = r.valorDescontos || 0;

                if (r.id && ajustesMap.has(r.id)) {
                    // Os valores já foram computados no matchFiles (PHASE 2.5)
                    // Se houver split de Queiroz, apply only once per store ID
                    ajustesMap.delete(r.id);
                }

                const totais = calcularTotaisFaturamento(
                    r.valorBruto,
                    finalAcrescimos,
                    finalDescontos,
                    r.descontoIR || 0,
                    r.statusNF === 'EMITIDA',
                    r.boletoUnificado ?? true
                );

                const basePayload = {
                    lote_id: currentLoteId,
                    cliente_id: r.id,
                    data_competencia: r.data_competencia || null,
                    valor_bruto: totais.valorBruto,
                    acrescimos: finalAcrescimos,
                    descontos: finalDescontos,
                    valor_irrf: totais.irrf,
                    numero_nf: r.numeroNF || null,
                    cnpj_filial: r.cnpjFilial || null,
                    valor_ir_xml: r.descontoIR || 0,
                    tipo_documento: r.boletoUnificado === false ? 'MISTO' : 'UNIFICADO',
                    valor_nf_emitida: totais.valorNF,
                    valor_nc_final: totais.valorNC,
                    valor_boleto_final: totais.valorLiquido
                };

                return [basePayload];
            });

            if (consolidadosPayload.length > 0) {
                await supabase.from('faturamento_consolidados').delete().eq('lote_id', currentLoteId);
                const { data: inserted, error: consolidadosErr } = await supabase
                    .from('faturamento_consolidados')
                    .insert(consolidadosPayload)
                    .select('id, cliente_id, data_competencia');

                if (consolidadosErr) throw new Error("Erro ao salvar consolidados: " + consolidadosErr.message);

                if (inserted) {
                    const ajustesIdsParaAtualizar = ajustes?.map(a => a.id) || [];
                    if (ajustesIdsParaAtualizar.length > 0) {
                        const { error: updErr } = await supabase
                            .from("ajustes_faturamento")
                            .update({
                                status_aplicacao: true,
                                data_aplicacao: new Date().toISOString(),
                                lote_aplicado_id: currentLoteId
                            })
                            .in("id", ajustesIdsParaAtualizar);
                        if (updErr) console.error("Erro ao marcar ajustes como aplicados:", updErr);
                    }

                    const idMap: Record<string, string> = {};
                    const validadosParaMap = agendamentos.filter(a => !a.isRemoved && (a.status === "OK" || a.status === "CORREÇÃO") && a.clienteId);
                    inserted.forEach(row => {
                        const client = validadosParaMap.find(v => v.clienteId === row.cliente_id);
                        const isQueiroz = client?.loja.includes('(Mês Anterior)') || client?.loja.includes('(Mês Atual)');
                        const key = isQueiroz ? `${row.cliente_id}_${client?.loja}` : (row.cliente_id || "");
                        idMap[key] = row.id;
                    });
                    setDbConsolidados(idMap);
                }
            }

            alert("✅ Lote e Agendamentos consolidados com sucesso!");
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

            const [ano, mes] = (periodoInicio || "").split("-");
            const reportsWithBoletos = matchFiles.reports.filter(r => r.boleto);

            if (reportsWithBoletos.length === 0) {
                alert("Nenhum boleto pareado para upload.");
                setLoadingMap(p => ({ ...p, "boletosSuccess": false }));
                return;
            }

            // Chunk size 15: PDFs de 5-50KB → ~750KB por chunk (limite Vercel: 4.5MB)
            const chunkSize = 15;
            let mesFolderId: string | null = null;

            for (let i = 0; i < reportsWithBoletos.length; i += chunkSize) {
                const chunk = reportsWithBoletos.slice(i, i + chunkSize);
                const formData = new FormData();
                formData.append("loteId", targetLoteId);

                const metadataArray = [];

                for (const r of chunk) {
                    const fileObj = r.boleto!.file || r.boleto!;
                    const fileName = r.boleto!.name || (fileObj as any).name;
                    formData.append("files", fileObj, fileName);

                    metadataArray.push({
                        filename: fileName,
                        clienteId: r.id,
                        consolidadoId: dbConsolidados[r.id] || r.consolidadoId,
                        nome_conta_azul: r.nomeContaAzul || r.razaoSocial,
                        nomePasta: nomePasta,
                        docType: "hc",
                        nome_empresa_extraido: r.nomeContaAzul || r.razaoSocial,
                        ...(mesFolderId ? { mesFolderId } : {})  // reutiliza nos chunks 2+
                    });
                }

                formData.append("metadata", JSON.stringify(metadataArray));

                const res = await fetch("/api/drive/upload", { method: "POST", body: formData });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(`Erro na API (Boletos Lote ${i / chunkSize + 1}): ${errData.error || res.statusText}`);
                }
                // Captura mesFolderId do primeiro chunk para reutilizar nos seguintes
                const resData = await res.json();
                if (!mesFolderId && resData.mesFolderId) mesFolderId = resData.mesFolderId;
            }

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

            const [ano, mes] = (periodoInicio || "").split("-");
            const reportsWithNf = matchFiles.reports.filter(r => r.nfse);

            if (reportsWithNf.length === 0) {
                alert("Nenhuma NF pareada para upload.");
                setLoadingMap(p => ({ ...p, "nfsSuccess": false }));
                return;
            }

            // Chunk size 15: PDFs de 5-50KB → ~750KB por chunk (limite Vercel: 4.5MB)
            const chunkSize = 15;
            let mesFolderId: string | null = null;

            for (let i = 0; i < reportsWithNf.length; i += chunkSize) {
                const chunk = reportsWithNf.slice(i, i + chunkSize);
                const formData = new FormData();
                formData.append("loteId", targetLoteId);

                const metadataArray = [];

                for (const r of chunk) {
                    const fileContent = r.nfse!.blob || r.nfse!.file || r.nfse!;
                    const fileObj = fileContent instanceof Blob ? fileContent : new File([fileContent], r.nfse!.name, { type: "application/pdf" });
                    formData.append("files", fileObj, r.nfse!.name);

                    metadataArray.push({
                        filename: r.nfse!.name,
                        clienteId: r.id,
                        consolidadoId: dbConsolidados[r.id] || r.consolidadoId,
                        nome_conta_azul: r.nomeContaAzul || r.razaoSocial,
                        nomePasta: nomePasta,
                        docType: "nf",
                        numeroNF: r.numeroNF,
                        ...(mesFolderId ? { mesFolderId } : {})  // reutiliza nos chunks 2+
                    });
                }

                formData.append("metadata", JSON.stringify(metadataArray));

                const res = await fetch("/api/drive/upload", { method: "POST", body: formData });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(`Erro na API (NFs Lote ${i / chunkSize + 1}): ${errData.error || res.statusText}`);
                }
                // Captura mesFolderId do primeiro chunk para reutilizar nos seguintes
                const resData = await res.json();
                if (!mesFolderId && resData.mesFolderId) mesFolderId = resData.mesFolderId;
            }

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

    // Painel de cascata: agrega o pipeline matemático de todos os reports do lote
    const cascataTotais = matchFiles.reports.reduce(
        (acc, r) => {
            const t = calcularTotaisFaturamento(
                r.valorBruto, r.valorAcrescimos, r.valorDescontos,
                r.descontoIR || 0, r.statusNF === 'EMITIDA',
                r.boletoUnificado ?? true
            );
            acc.bruto += t.valorBruto;
            acc.ajustes += (r.valorAcrescimos - r.valorDescontos);
            acc.base += t.valorBaseFaturavel;
            acc.nf += t.valorNF;
            acc.nc += t.valorNC;
            acc.irrf += t.irrf;
            acc.liquido += t.valorLiquido;
            return acc;
        },
        { bruto: 0, ajustes: 0, base: 0, nf: 0, nc: 0, irrf: 0, liquido: 0 }
    );

    const pendingNfReports = matchFiles.reports.filter(r => r.statusNF === 'PENDENTE');
    const pendingNfCount = pendingNfReports.length;

    const filteredReports = matchFiles.reports.filter(r => {
        if (filterStatus === "FALTA_NF") return r.statusNF === 'PENDENTE';
        if (filterStatus === "TEM_NF") return r.statusNF === 'EMITIDA';
        if (filterStatus === "TEM_BOLETO") return !!r.boleto;
        if (filterStatus === "COM_NC") return r.statusNC === 'PENDENTE' || r.statusNC === 'EMITIDA';
        if (filterStatus === "COM_IRRF") return !!r.descontoIR && r.descontoIR > 0;
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

            {/* Cascata Financeira do Lote */}
            {matchFiles.reports.length > 0 && (
                <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--fg-dim)] mb-4">Resumo Financeiro do Lote</h3>
                    <div className="flex flex-col gap-1.5 font-mono text-sm">
                        <div className="flex justify-between">
                            <span className="text-[var(--fg-dim)]">&#x1F4B0; Valor Bruto (horas)</span>
                            <span className="font-semibold">{fmtCurrency(cascataTotais.bruto)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-[var(--fg-dim)]">&#xA0;&#xA0;(+/&#x2212;) Ajustes</span>
                            <span className={cascataTotais.ajustes >= 0 ? "text-[var(--success)] font-semibold" : "text-[var(--danger)] font-semibold"}>
                                {cascataTotais.ajustes >= 0 ? "+" : ""}{fmtCurrency(cascataTotais.ajustes)}
                            </span>
                        </div>
                        <div className="flex justify-between border-t border-[var(--border)] pt-1.5 mt-0.5">
                            <span className="font-bold text-[var(--fg)]">&#xA0;&#xA0;(=) Base Fatur&#xE1;vel</span>
                            <span className="font-bold">{fmtCurrency(cascataTotais.base)}</span>
                        </div>
                        {cascataTotais.nf > 0 && (
                            <div className="flex justify-between pl-4">
                                <span className="text-[var(--fg-dim)]">&#xA0;&#xA0;&#x21B3; NF emitidas</span>
                                <span className="text-[var(--success)]">{fmtCurrency(cascataTotais.nf)}</span>
                            </div>
                        )}
                        {cascataTotais.nc > 0 && (
                            <div className="flex justify-between pl-4">
                                <span className="text-[var(--fg-dim)]">&#xA0;&#xA0;&#x21B3; NC a emitir</span>
                                <span className="text-amber-400">{fmtCurrency(cascataTotais.nc)}</span>
                            </div>
                        )}
                        {cascataTotais.irrf > 0 && (
                            <div className="flex justify-between">
                                <span className="text-[var(--fg-dim)]">&#xA0;&#xA0;(&#x2212;) IRRF retido</span>
                                <span className="text-[var(--danger)]">{fmtCurrency(cascataTotais.irrf)}</span>
                            </div>
                        )}
                        <div className="flex justify-between border-t border-[var(--border)] pt-1.5 mt-0.5">
                            <span className="font-black text-[var(--fg)]">&#xA0;&#xA0;(=) L&#xED;quido a Pagar</span>
                            <span className="font-black text-[var(--accent)] text-base">{fmtCurrency(cascataTotais.liquido)}</span>
                        </div>
                    </div>
                </div>
            )}

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

                    {pendingNfReports.length > 0 && (
                        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 mt-2 flex flex-col gap-3">
                            <div className="flex items-center gap-2 text-[var(--danger)] font-bold text-sm">
                                <AlertTriangle size={18} />
                                <span>Pendência: {pendingNfReports.length} {pendingNfReports.length === 1 ? 'loja sem NF' : 'lojas sem NF'}</span>
                            </div>
                            <p className="text-xs text-red-400/80 leading-tight">
                                As seguintes faturas ficarão retidas como Notas de Crédito (NC) caso o lote seja consolidado agora:
                            </p>
                            <div className="max-h-56 overflow-y-auto custom-scrollbar pr-1 flex flex-col gap-1.5 mt-1">
                                {pendingNfReports.map((r, i) => (
                                    <div key={i} className="text-xs text-red-400 bg-red-500/5 px-2.5 py-2 rounded-lg border border-red-500/10 flex flex-col">
                                        <span className="font-bold truncate" title={r.razaoSocial}>{r.razaoSocial}</span>
                                        <span className="font-mono text-[10px] opacity-80 mt-0.5">
                                            {r.cnpj ? r.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : 'S/ CNPJ'}
                                        </span>
                                    </div>
                                ))}
                            </div>
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
                        <div className="flex flex-wrap bg-[var(--bg-card)] border border-[var(--border)] p-1 rounded-xl w-full sm:w-auto gap-0.5">
                            {([
                                { key: "TODAS", label: "Todas", color: "var(--accent)" },
                                { key: "TEM_NF", label: "✓ NF Emitida", color: "#3b82f6" },
                                { key: "FALTA_NF", label: "⚠ Falta NF", color: "var(--danger)" },
                                { key: "TEM_BOLETO", label: "✓ Boleto", color: "#10b981" },
                                { key: "COM_NC", label: "NC", color: "#f59e0b" },
                                { key: "COM_IRRF", label: "IRRF", color: "#a855f7" },
                            ] as const).map(f => (
                                <button
                                    key={f.key}
                                    onClick={() => setFilterStatus(f.key)}
                                    style={filterStatus === f.key ? { background: f.color } : {}}
                                    className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all whitespace-nowrap ${filterStatus === f.key ? "text-white shadow" : "text-[var(--fg-dim)] hover:text-[var(--fg)]"
                                        }`}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="max-h-[500px] overflow-y-auto custom-scrollbar p-0">
                        <table className="w-full text-left text-sm whitespace-nowrap min-w-[900px]">
                            <thead className="bg-[var(--bg-card)] sticky top-0 shadow-sm z-10 border-b border-[var(--border)]">
                                <tr>
                                    <th className="py-4 px-4 text-[var(--fg-dim)] font-semibold uppercase text-[10px] tracking-wider">Empresa (CNPJ)</th>
                                    <th className="py-4 px-3 text-[var(--fg-dim)] font-semibold text-center uppercase text-[10px] tracking-wider">Nº NF</th>
                                    <th className="py-4 px-3 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider">Base</th>
                                    <th className="py-4 px-3 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider">Pós Ajustes</th>
                                    <th className="py-4 px-3 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider">Descontos</th>
                                    <th className="py-4 px-3 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider">Acréscimos</th>
                                    <th className="py-4 px-3 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider text-amber-400">Valor NC</th>
                                    <th className="py-4 px-3 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider text-blue-400">Valor NF</th>
                                    <th className="py-4 px-3 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider text-purple-400">Valor IRRF</th>
                                    <th className="py-4 px-3 text-[var(--fg-dim)] font-semibold text-right uppercase text-[10px] tracking-wider text-emerald-400">Boleto Final</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                                {filteredReports.map((r, i) => (
                                    <tr key={i} className="hover:bg-[rgba(33,118,255,0.03)] transition-colors group">
                                        {/* Empresa + CNPJ */}
                                        <td className="py-3 px-4">
                                            <p className="font-bold text-[var(--fg)] text-ellipsis overflow-hidden max-w-[200px] text-[13px]" title={r.razaoSocial}>{r.razaoSocial}</p>
                                            <div className="flex gap-2 items-center mt-0.5">
                                                <span className="text-[10px] text-[var(--fg-dim)] font-mono">
                                                    {r.cnpj ? r.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : r.nome}
                                                </span>
                                                {r.boleto && (
                                                    <span className="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded font-bold border border-emerald-500/25">BOLETO ✓</span>
                                                )}
                                            </div>
                                        </td>
                                        {/* Nº NF */}
                                        <td className="py-3 px-3 text-center">
                                            {r.numeroNF ? (
                                                <span className="font-mono text-[11px] font-bold bg-blue-500/10 text-blue-400 px-2 py-1 rounded border border-blue-500/20">
                                                    #{r.numeroNF}
                                                </span>
                                            ) : (
                                                <span className="text-[10px] text-[var(--fg-dim)]/40">—</span>
                                            )}
                                        </td>
                                        {/* Base */}
                                        <td className="py-3 px-3 text-right font-mono text-[11px] text-[var(--fg-dim)]">
                                            {fmtCurrency(r.valorBruto)}
                                        </td>
                                        {/* Pós Ajustes */}
                                        <td className="py-3 px-3 text-right font-mono text-[12px] font-bold text-[var(--fg)]">
                                            {fmtCurrency(r.valorBaseFaturavel)}
                                        </td>
                                        {/* Descontos */}
                                        <td className="py-3 px-3 text-right font-mono text-[11px] text-red-400">
                                            {r.valorDescontos > 0 ? (
                                                <span className="bg-red-500/10 px-1.5 py-0.5 rounded">- {fmtCurrency(r.valorDescontos)}</span>
                                            ) : <span className="text-[var(--fg-dim)]/30">—</span>}
                                        </td>
                                        {/* Acréscimos */}
                                        <td className="py-3 px-3 text-right font-mono text-[11px] text-green-400">
                                            {r.valorAcrescimos > 0 ? (
                                                <span className="bg-green-500/10 px-1.5 py-0.5 rounded">+ {fmtCurrency(r.valorAcrescimos)}</span>
                                            ) : <span className="text-[var(--fg-dim)]/30">—</span>}
                                        </td>
                                        {/* Valor NC — só aparece quando statusNF é PENDENTE (emitirá NC em vez de NF) */}
                                        <td className="py-3 px-3 text-right font-mono text-[11px]">
                                            {r.statusNF === 'PENDENTE' ? (
                                                <span className="text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                                    {fmtCurrency(r.valorBaseFaturavel)}
                                                </span>
                                            ) : <span className="text-[var(--fg-dim)]/30">—</span>}
                                        </td>
                                        {/* Valor NF — valor extraído do XML/PDF quando emitida */}
                                        <td className="py-3 px-3 text-right font-mono text-[11px]">
                                            {r.statusNF === 'EMITIDA' ? (
                                                <div className="flex flex-col items-end gap-0.5">
                                                    <span className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">
                                                        {fmtCurrency(r.xmlValorServicos && r.xmlValorServicos > 0 ? r.xmlValorServicos : r.valorBaseFaturavel)}
                                                    </span>
                                                    {r.isXmlMatched && (
                                                        <span className="text-[9px] text-blue-300/60 font-bold">via XML</span>
                                                    )}
                                                </div>
                                            ) : <span className="text-[var(--fg-dim)]/30">—</span>}
                                        </td>
                                        {/* IRRF */}
                                        <td className="py-3 px-3 text-right font-mono text-[11px]">
                                            {r.descontoIR && r.descontoIR > 0 ? (
                                                <div className="flex flex-col items-end gap-0.5">
                                                    <span className="text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                                                        - {fmtCurrency(r.descontoIR)}
                                                    </span>
                                                    {r.isXmlMatched && (
                                                        <span className="text-[9px] text-purple-300/60 font-bold">via XML</span>
                                                    )}
                                                </div>
                                            ) : <span className="text-[var(--fg-dim)]/30">—</span>}
                                        </td>
                                        {/* Boleto Final = pós ajustes − IRRF */}
                                        <td className="py-3 px-3 text-right">
                                            {(() => {
                                                const totais = calcularTotaisFaturamento(r.valorBruto, r.valorAcrescimos, r.valorDescontos, r.descontoIR || 0, r.statusNF === 'EMITIDA', r.boletoUnificado ?? true);
                                                if (!r.boletoUnificado && totais.valorNF > 0 && totais.valorNC > 0) {
                                                    return (
                                                        <div className="flex flex-col items-end gap-1">
                                                            <span className="font-mono text-[11px] font-bold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20 whitespace-nowrap">
                                                                {fmtCurrency(totais.valorNF - totais.irrf)} <span className="text-[9px] opacity-70">(NF)</span>
                                                            </span>
                                                            <span className="font-mono text-[11px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 whitespace-nowrap">
                                                                {fmtCurrency(totais.valorNC)} <span className="text-[9px] opacity-70">(NC)</span>
                                                            </span>
                                                            <span className="text-[9px] bg-[var(--accent)]/10 text-[var(--accent)] px-1 py-0.5 rounded-sm font-bold border border-[var(--accent)]/20 mt-0.5" title="Cobrança Desmembrada">Desmembrada</span>
                                                        </div>
                                                    );
                                                }
                                                return (
                                                    <span className="font-mono text-[12px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">
                                                        {fmtCurrency(totais.valorLiquido)}
                                                    </span>
                                                );
                                            })()}
                                        </td>
                                    </tr>
                                ))}
                                {filteredReports.length === 0 && (
                                    <tr>
                                        <td colSpan={10} className="py-12 text-center text-[var(--fg-dim)] text-sm">
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
                                                    <option key={r.id + r.nome} value={r.consolidadoId}>{r.nome} ({fmtCurrency(r.valorBaseFaturavel)})</option>
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
