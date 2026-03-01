"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import {
    Ciclo, ClienteDB, Agendamento, ConciliationResult, ValidationStatus
} from "./types";
import { findCol, parseDate, parseNumber, normalizeCnpj, normalizarNome } from "./utils";

import Setup from "./steps/Setup";
import ResumoFaturamento from "./steps/ResumoFaturamento";
import SelecaoFiscal from "./steps/SelecaoFiscal";
import EmissaoNotas from "./steps/EmissaoNotas";
import FechamentoLote from "./steps/FechamentoLote";

export default function WizardFaturamento() {
    const supabase = createClient();

    const [currentStep, setCurrentStep] = useState(1);

    /* --- Setup state --- */
    const [ciclos, setCiclos] = useState<Ciclo[]>([]);
    const [selectedCicloIds, setSelectedCicloIds] = useState<string[]>([]);
    const [periodoInicio, setPeriodoInicio] = useState("");
    const [periodoFim, setPeriodoFim] = useState("");
    const [nomePasta, setNomePasta] = useState("");
    const [fileName, setFileName] = useState("");

    /* --- Queiroz Split State --- */
    const [queirozConfig, setQueirozConfig] = useState<{
        splitDate: string;
        compAnterior: string;
        compAtual: string;
    } | null>(null);

    /* --- Results state --- */
    const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
    const [conciliation, setConciliation] = useState<ConciliationResult>({ naoCadastrados: [], ausentesNoLote: [] });
    const [processing, setProcessing] = useState(false);
    const [dbClientes, setDbClientes] = useState<ClienteDB[]>([]);
    const [duplicates, setDuplicates] = useState<{ identical: Agendamento[][], suspicious: Agendamento[][] }>({ identical: [], suspicious: [] });

    /* --- Save state --- */
    const [saving, setSaving] = useState(false);
    const [saveResult, setSaveResult] = useState<{ ok: number; err: number; loteId?: string } | null>(null);

    /* --- New Steps State --- */
    const [lojasSemNf, setLojasSemNf] = useState<Set<string>>(new Set());
    const [nfseFiles, setNfseFiles] = useState<{ name: string; blob: Blob; buffer: ArrayBuffer }[]>([]);

    useEffect(() => {
        let isMounted = true;
        supabase
            .from("ciclos_faturamento")
            .select("id, nome")
            .order("nome")
            .then(({ data }) => {
                if (data && isMounted) setCiclos(data);
            });
        return () => { isMounted = false; };
    }, [supabase]);

    const financialSummary = useMemo(() => {
        if (agendamentos.length === 0) return { summaryArr: [], globalFaturadas: 0, globalRejeitadas: 0 };

        const sumByCiclo = new Map<string, number>();
        const companiesByCiclo = new Map<string, Set<string>>();
        const globalFaturadas = new Set<string>();
        const globalRejeitadas = new Set<string>();

        let originalBruto = 0;
        let totalLiquido = 0;
        let totalExcluido = 0;
        let totalPendenteCorrecao = 0;
        let totalGeralArquivo = 0;

        const originalBrutoSet = new Set<string>();
        const liquidoLoteSet = new Set<string>();
        const pendentesCorrecaoSet = new Set<string>();
        const excluidosSet = new Set<string>();
        const geralArquivoSet = new Set<string>();

        for (const a of agendamentos) {
            const companyKey = a.clienteId || String(a.refAgendamento) || a.loja;

            originalBruto += a.originalValorIwof ?? a.valorIwof;
            originalBrutoSet.add(companyKey);

            if (!a.isRemoved) {
                const isValuable = a.status === "OK" || a.status === "CORREÇÃO" || a.status === "CICLO_INCORRETO";

                if (a.status === "OK" || a.status === "CORREÇÃO") {
                    globalFaturadas.add(companyKey);
                } else {
                    globalRejeitadas.add(companyKey);
                }

                if (isValuable) {
                    const val = a.status === "CORREÇÃO"
                        ? (a.suggestedValorIwof ?? a.valorIwof)
                        : (a.manualValue ?? a.valorIwof);

                    totalGeralArquivo += val;
                    geralArquivoSet.add(companyKey);

                    if (a.status !== "CICLO_INCORRETO") {
                        const ciclo = a.cicloNome || "Sem Ciclo";
                        sumByCiclo.set(ciclo, (sumByCiclo.get(ciclo) ?? 0) + val);
                        if (!companiesByCiclo.has(ciclo)) companiesByCiclo.set(ciclo, new Set());
                        companiesByCiclo.get(ciclo)!.add(companyKey);

                        totalLiquido += val;
                        liquidoLoteSet.add(companyKey);

                        if (a.status === "CORREÇÃO") {
                            totalPendenteCorrecao += val;
                            pendentesCorrecaoSet.add(companyKey);
                        }
                    }
                }
            } else {
                totalExcluido += a.originalValorIwof ?? a.valorIwof;
                excluidosSet.add(companyKey);
                globalRejeitadas.add(companyKey);
            }
        }

        const summaryArr = Array.from(sumByCiclo.entries()).map(([ciclo, total]) => ({ ciclo: ciclo as string, total: total as number, empresasCount: companiesByCiclo.get(ciclo)?.size || 0 }));
        summaryArr.push({ ciclo: "FATURAMENTO GERAL (ARQUIVO)", total: totalGeralArquivo, empresasCount: geralArquivoSet.size });
        summaryArr.push({ ciclo: "BRUTO ORIGINAL", total: originalBruto, empresasCount: originalBrutoSet.size });
        summaryArr.push({ ciclo: "LÍQUIDO P/ LOTE", total: totalLiquido, empresasCount: liquidoLoteSet.size });
        if (totalPendenteCorrecao > 0) {
            summaryArr.push({ ciclo: "PENDENTES CORREÇÃO", total: totalPendenteCorrecao, empresasCount: pendentesCorrecaoSet.size });
        }
        summaryArr.push({ ciclo: "EXCLUÍDOS", total: totalExcluido, empresasCount: excluidosSet.size });

        return {
            summaryArr,
            globalFaturadas: globalFaturadas.size,
            globalRejeitadas: globalRejeitadas.size
        };
    }, [agendamentos]);

    const processFile = useCallback(async (rawRows: Record<string, string>[]) => {
        if (rawRows.length === 0) return;
        setProcessing(true);

        const headers = Object.keys(rawRows[0]);
        const colNome = findCol(headers, "nome", "profissional", "login", "vendedor");
        const colTelefone = findCol(headers, "telefone");
        const colEstado = findCol(headers, "estado", "uf");
        const colLoja = findCol(headers, "loja", "empresa", "cliente");
        const colVaga = findCol(headers, "vaga");
        const colInicio = findCol(headers, "início", "inicio", "data início", "data inicio", "data_inicio");
        const colTermino = findCol(headers, "término", "termino", "fim", "data fim", "data_fim", "data término");
        const colRef = findCol(headers, "ref agendamento", "ref_agendamento", "id_agendamento", "referencia");
        const colAgendadoEm = findCol(headers, "agendado em", "agendado_em");
        const colIniciadoEm = findCol(headers, "iniciado em", "iniciado_em");
        const colConcluidoEm = findCol(headers, "concluido em", "concluido_em");
        const colValorIwof = findCol(headers, "valor iwof", "valor_iwof", "valor");
        const colFracao = findCol(headers, "fração de hora computada", "fhc", "fracao_hora", "fracao de hora computada");
        const colStatusAgt = findCol(headers, "status");
        const colDataCanc = findCol(headers, "data do cancelamento", "data_cancelamento");
        const colMotivo = findCol(headers, "motivo");
        const colRespCanc = findCol(headers, "responsável pelo cancelamento", "responsavel_cancelamento");
        const colCnpjLoja = findCol(headers, "cnpj", "cnpj loja", "cnpj_loja", "cnpj empresa", "cnpj_empresa");

        const pStart = periodoInicio ? new Date(periodoInicio + "T00:00:00") : null;
        const pEnd = periodoFim ? new Date(periodoFim + "T23:59:59") : null;

        let allClientes: ClienteDB[] = [];
        let from = 0;
        const stepAmount = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data: chunk, error } = await supabase
                .from("clientes")
                .select("id, razao_social, nome_fantasia, nome, nome_conta_azul, cnpj, cep, endereco, numero, bairro, cidade, estado, ciclo_faturamento_id, ciclos_faturamento(nome), status")
                .eq("status", true)
                .range(from, from + stepAmount - 1);

            if (error) {
                console.error("Erro ao buscar clientes:", error);
                break;
            }

            if (chunk && chunk.length > 0) {
                allClientes = [...allClientes, ...(chunk as unknown as ClienteDB[])];
                from += stepAmount;
            } else {
                hasMore = false;
            }

            if (chunk && chunk.length < stepAmount) {
                hasMore = false;
            }
        }

        setDbClientes(allClientes);

        const clienteByContaAzul = new Map<string, ClienteDB>();
        for (const c of allClientes) {
            if (c.nome_conta_azul) {
                clienteByContaAzul.set(normalizarNome(c.nome_conta_azul), c);
            }
        }

        const parsed: Agendamento[] = [];
        const lojasVistas = new Set<string>();

        for (const row of rawRows) {
            const nome = colNome ? String(row[colNome] ?? "").trim() : "";
            const telefone = colTelefone ? String(row[colTelefone] ?? "").trim() : "";
            const estado = colEstado ? String(row[colEstado] ?? "").toUpperCase().trim() : "";
            const loja = colLoja ? String(row[colLoja] ?? "").toUpperCase().trim() : "";
            const vaga = colVaga ? String(row[colVaga] ?? "").trim() : "";
            const inicio = colInicio ? parseDate(row[colInicio]) : null;
            const termino = colTermino ? parseDate(row[colTermino]) : null;
            const refAgendamento = colRef ? String(row[colRef] ?? "").trim() : "";
            const agendadoEm = colAgendadoEm ? parseDate(row[colAgendadoEm]) : null;
            const iniciadoEm = colIniciadoEm ? parseDate(row[colIniciadoEm]) : null;
            const concluidoEm = colConcluidoEm ? parseDate(row[colConcluidoEm]) : null;
            const valorIwof = colValorIwof ? parseNumber(row[colValorIwof]) : 0;
            const fracaoHora = colFracao ? parseNumber(row[colFracao]) : 0;
            const statusAgendamento = colStatusAgt ? String(row[colStatusAgt] ?? "").trim() : "";
            const dataCancelamento = colDataCanc ? parseDate(row[colDataCanc]) : null;
            const motivoCancelamento = colMotivo ? String(row[colMotivo] ?? "").trim() : "";
            const responsavelCancelamento = colRespCanc ? String(row[colRespCanc] ?? "").trim() : "";
            const cnpjDaPlanilha = colCnpjLoja ? normalizeCnpj(String(row[colCnpjLoja] ?? "").trim()) : "";

            if (!loja) continue;

            let matched: ClienteDB | undefined;
            let suggestedClients: ClienteDB[] = [];

            const lojaNormalizada = normalizarNome(loja);

            if (cnpjDaPlanilha) {
                matched = allClientes.find(c => normalizeCnpj(c.cnpj || "") === cnpjDaPlanilha);
            }

            if (!matched) {
                matched = clienteByContaAzul.get(lojaNormalizada);
            }

            if (!matched) {
                matched = allClientes.find(c =>
                    normalizarNome(c.razao_social) === lojaNormalizada ||
                    normalizarNome(c.nome_fantasia || "") === lojaNormalizada ||
                    normalizarNome(c.nome || "") === lojaNormalizada ||
                    normalizarNome(c.nome_conta_azul || "") === lojaNormalizada
                );
            }

            if (!matched) {
                const allPartials = allClientes.filter(c => {
                    const nomesDb = [
                        normalizarNome(c.nome_conta_azul || ""),
                        normalizarNome(c.razao_social),
                        normalizarNome(c.nome_fantasia || ""),
                        normalizarNome(c.nome || "")
                    ].filter(n => n.length > 0);

                    return nomesDb.some(dbName =>
                        lojaNormalizada.includes(dbName) || dbName.includes(lojaNormalizada)
                    );
                });

                if (allPartials.length === 1) {
                    matched = allPartials[0];
                } else if (allPartials.length > 1) {
                    let bestScore = -1;
                    let bestCandidate: ClienteDB | undefined;
                    let tied = false;

                    for (const c of allPartials) {
                        const nomesDb = [
                            normalizarNome(c.nome_conta_azul || ""),
                            normalizarNome(c.nome_fantasia || ""),
                            normalizarNome(c.razao_social),
                            normalizarNome(c.nome || "")
                        ].filter(n => n.length > 0);

                        const score = Math.max(...nomesDb.map(dbName => {
                            if (lojaNormalizada === dbName) return dbName.length + 1000;
                            if (lojaNormalizada.includes(dbName) || dbName.includes(lojaNormalizada)) {
                                return Math.min(dbName.length, lojaNormalizada.length);
                            }
                            return -1;
                        }));

                        if (score > bestScore) {
                            bestScore = score;
                            bestCandidate = c;
                            tied = false;
                        } else if (score === bestScore) {
                            tied = true;
                        }
                    }

                    if (!tied && bestCandidate) {
                        matched = bestCandidate;
                    } else {
                        suggestedClients = allPartials;
                    }
                }
            }

            if (matched) {
                lojasVistas.add(matched.id);
            }

            let status: ValidationStatus = "OK";

            if (inicio && pStart && pEnd) {
                if (inicio < pStart || inicio > pEnd) {
                    status = "FORA_PERIODO";
                }
            }

            if (status === "OK" && selectedCicloIds.length > 0) {
                const lojaTemCiclo = matched?.ciclo_faturamento_id;
                if (lojaTemCiclo && !selectedCicloIds.includes(lojaTemCiclo)) {
                    status = "CICLO_INCORRETO";
                }
            }

            if (status === "OK") {
                if (fracaoHora < 0.16 && fracaoHora > 0) {
                    status = "CANCELAR";
                } else if (fracaoHora > 6) {
                    status = "CORREÇÃO";
                }
            }

            let suggestedFracaoHora: number | undefined;
            let suggestedValorIwof: number | undefined;
            let suggestedTermino: Date | null | undefined;
            if (fracaoHora > 6) {
                const ratio = 6 / fracaoHora;
                suggestedFracaoHora = 6;
                suggestedValorIwof = Math.round(valorIwof * ratio * 100) / 100;
                suggestedTermino = inicio ? new Date(inicio.getTime() + 6 * 60 * 60 * 1000) : termino;
            }

            parsed.push({
                id: `${Date.now()}-${parsed.length}-${Math.random().toString(36).slice(2)}`,
                nome,
                telefone,
                estado,
                loja: loja.toUpperCase(),
                vaga,
                inicio,
                termino,
                refAgendamento,
                agendadoEm,
                iniciadoEm,
                concluidoEm,
                valorIwof,
                fracaoHora,
                statusAgendamento,
                dataCancelamento,
                motivoCancelamento,
                responsavelCancelamento,
                status,
                clienteId: matched?.id ?? null,
                razaoSocial: matched?.razao_social ?? null,
                cnpj: matched?.cnpj ?? null,
                cicloNome: matched?.ciclos_faturamento?.nome ?? null,
                rawRow: row,
                suggestedFracaoHora,
                suggestedValorIwof,
                suggestedTermino,
                originalFracaoHora: fracaoHora > 6 ? fracaoHora : undefined,
                originalValorIwof: fracaoHora > 6 ? valorIwof : undefined,
                originalTermino: fracaoHora > 6 ? termino : undefined,
                suggestedClients: suggestedClients.length > 0 ? suggestedClients : undefined
            });
        }

        let finalParsed: Agendamento[] = [];
        const d1_check = periodoInicio ? new Date(periodoInicio + "T12:00:00") : null;
        const d2_check = periodoFim ? new Date(periodoFim + "T12:00:00") : null;
        const isCrossMonth = d1_check && d2_check && (d1_check.getMonth() !== d2_check.getMonth() || d1_check.getFullYear() !== d2_check.getFullYear());

        if (isCrossMonth && queirozConfig) {
            const splitDateVal = new Date(queirozConfig.splitDate + "T23:59:59").getTime();

            for (const a of parsed) {
                if (a.cicloNome?.includes("QUEIROZ") && a.inicio) {
                    const isAfterSplit = a.inicio.getTime() > splitDateVal;
                    const comp = isAfterSplit ? queirozConfig.compAtual : queirozConfig.compAnterior;
                    const monthSuffix = isAfterSplit ? "Mês Atual" : "Mês Anterior";

                    finalParsed.push({
                        ...a,
                        loja: `${a.loja} (${monthSuffix})`,
                        rawRow: { ...a.rawRow, data_competencia: comp }
                    });
                } else {
                    finalParsed.push(a);
                }
            }
        } else {
            finalParsed = parsed;
        }

        const identicalMap: Map<string, Agendamento[]> = new Map();
        const suspiciousListResult: Agendamento[][] = [];
        const seenIndicesSet = new Set<number>();

        for (let i = 0; i < finalParsed.length; i++) {
            const a = finalParsed[i];
            const key = `${a.nome.toLowerCase()}|${a.loja.toLowerCase()}|${a.inicio?.getTime()}|${a.termino?.getTime()}|${a.valorIwof}|${a.vaga.toLowerCase()}|${a.telefone}|${a.fracaoHora}`;

            if (!identicalMap.has(key)) {
                identicalMap.set(key, []);
            }
            identicalMap.get(key)!.push(a);
        }

        const identicalGroupsResult: Agendamento[][] = [];
        for (const group of identicalMap.values()) {
            if (group.length > 1) {
                identicalGroupsResult.push(group);
                group.forEach(a => {
                    const idx = parsed.indexOf(a);
                    if (idx !== -1) seenIndicesSet.add(idx);
                });
            }
        }

        for (let i = 0; i < parsed.length; i++) {
            const a = parsed[i];
            if (seenIndicesSet.has(i)) continue;

            const suspicious = parsed.filter((b, idx) => {
                if (idx === i || seenIndicesSet.has(idx)) return false;
                const sameInicio = a.inicio?.getTime() === b.inicio?.getTime();
                const sameTermino = a.termino?.getTime() === b.termino?.getTime();
                const sameLoja = a.loja === b.loja;
                if (!sameInicio || !sameTermino || !sameLoja) return false;
                return a.nome.toUpperCase().trim() === b.nome.toUpperCase().trim();
            });

            if (suspicious.length > 0) {
                const group = [a, ...suspicious];
                seenIndicesSet.add(i);
                parsed.forEach((x, idx) => {
                    if (suspicious.includes(x)) seenIndicesSet.add(idx);
                });
                suspiciousListResult.push(group);
            }
        }

        setDuplicates({
            identical: identicalGroupsResult,
            suspicious: suspiciousListResult
        });

        const autoRemovedIds = new Set<string>();
        identicalGroupsResult.forEach(group => {
            group.slice(1).forEach(a => autoRemovedIds.add(a.id));
        });
        if (autoRemovedIds.size > 0) {
            finalParsed.forEach(a => {
                if (autoRemovedIds.has(a.id)) a.isRemoved = true;
            });
        }

        setAgendamentos(finalParsed);

        const naoCadastrados = new Map<string, { loja: string; cnpj: string; suggestions?: ClienteDB[] }>();
        for (const a of finalParsed) {
            if (!a.clienteId) {
                const key = a.loja.toLowerCase();
                if (!naoCadastrados.has(key)) {
                    naoCadastrados.set(key, {
                        loja: a.loja,
                        cnpj: a.cnpj || "",
                        suggestions: a.suggestedClients
                    });
                }
            }
        }

        setConciliation({
            naoCadastrados: Array.from(naoCadastrados.values()),
            ausentesNoLote: [],
        });

        setProcessing(false);
        setCurrentStep(2);
    }, [supabase, periodoInicio, periodoFim, selectedCicloIds, queirozConfig]);

    const handleManualStoreMatch = (lojaRawName: string, clienteId: string) => {
        const cliente = dbClientes.find(c => c.id === clienteId);
        if (!cliente) return;

        setAgendamentos(prev => prev.map(a => {
            if (a.loja === lojaRawName) {
                let newStatus = a.status;
                if (selectedCicloIds.length > 0) {
                    if (!cliente.ciclo_faturamento_id || !selectedCicloIds.includes(cliente.ciclo_faturamento_id)) {
                        newStatus = "CICLO_INCORRETO";
                    } else if (newStatus === "CICLO_INCORRETO") {
                        newStatus = "OK";
                        if (a.fracaoHora < 0.16 && a.fracaoHora > 0) newStatus = "CANCELAR";
                        else if (a.fracaoHora > 6) newStatus = "CORREÇÃO";
                    }
                }

                return {
                    ...a,
                    clienteId: cliente.id,
                    razaoSocial: cliente.razao_social,
                    cnpj: cliente.cnpj,
                    cicloNome: cliente.ciclos_faturamento?.nome ?? null,
                    status: newStatus
                };
            }
            return a;
        }));
    };

    const handleFecharLote = async () => {
        setSaving(true);

        let validosCount = 1;

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Usuário não autenticado");

            const validos = agendamentos.filter(a =>
                !a.isRemoved &&
                (a.status === "OK" || a.status === "CORREÇÃO" || a.status === "CICLO_INCORRETO")
            );
            validosCount = validos.length;

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

            const { data: loteObj, error: loteErr } = await supabase
                .from("faturamentos_lote")
                .insert({
                    nome: nomePasta || `Lote ${new Date().toLocaleString("pt-BR")}`,
                    periodo_inicio: pStartUTC,
                    periodo_fim: pEndUTC,
                    arquivo_origem: fileName,
                    criado_por: user.id,
                    status: "PROCESSANDO",
                    valor_total: valTotal,
                    quantidade_agendamentos: agsInserir.length
                })
                .select()
                .single();

            if (loteErr || !loteObj) throw loteErr || new Error("Erro ao criar o lote.");

            const batchSize = 1000;
            let successCount = 0;
            let errorCount = 0;

            for (let i = 0; i < agsInserir.length; i += batchSize) {
                const chunk = agsInserir.slice(i, i + batchSize).map(x => ({ ...x, lote_id: loteObj.id }));
                const { error: insErr } = await supabase.from("agendamentos_brutos").insert(chunk);
                if (insErr) {
                    console.error("Erro no chunk", i, insErr);
                    errorCount += chunk.length;
                } else {
                    successCount += chunk.length;
                }
            }

            const activeClientsInLote = Array.from(new Set(agsInserir.map(a => a.cliente_id).filter(id => id)));
            const lotesAbertos = activeClientsInLote.map(cid => ({
                lote_id: loteObj.id,
                cliente_id: cid,
                status: "ABERTO",
                valor_total: agsInserir.filter(a => a.cliente_id === cid).reduce((sum, a) => sum + a.valor_iwof, 0)
            }));

            if (lotesAbertos.length > 0) {
                for (let i = 0; i < lotesAbertos.length; i += batchSize) {
                    const chunk = lotesAbertos.slice(i, i + batchSize);
                    await supabase.from("faturamento_consolidados").insert(chunk);
                }
            }

            await supabase.from("faturamentos_lote").update({ status: "FECHADO" }).eq("id", loteObj.id);
            setSaveResult({ ok: successCount, err: errorCount, loteId: loteObj.id });
            return loteObj.id;

        } catch (e: any) {
            console.error("Erro ao consolidar:", e);
            setSaveResult({ ok: 0, err: validosCount, loteId: undefined });
            alert(e.message || "Erro desconhecido ao consolidar");
        } finally {
            setSaving(false);
        }
    };

    /* ================================================================
       WIZARD STEPPER RENDER
       ================================================================ */

    // Pass properties as an object to keep code clean inside steps
    const wizardProps = {
        currentStep, setCurrentStep,
        ciclos, selectedCicloIds, setSelectedCicloIds,
        periodoInicio, setPeriodoInicio,
        periodoFim, setPeriodoFim,
        nomePasta, setNomePasta,
        fileName, setFileName,
        agendamentos, setAgendamentos,
        conciliation,
        processing, processFile,
        duplicates, setDuplicates,
        dbClientes, handleManualStoreMatch,
        financialSummary, handleFecharLote,
        saving, saveResult,
        queirozConfig, setQueirozConfig,
        lojasSemNf, setLojasSemNf,
        nfseFiles, setNfseFiles
    };

    return (
        <div className="w-full max-w-7xl mx-auto flex flex-col gap-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight text-[var(--fg)] mb-1">Faturamento {periodoInicio ? `(${new Date(periodoInicio).getMonth() + 1}/${new Date(periodoInicio).getFullYear()})` : null}</h1>

                {/* Visual Stepper */}
                <div className="flex items-center justify-between w-full relative before:absolute before:top-1/2 before:-translate-y-1/2 before:h-[2px] before:w-full before:bg-[var(--border)] before:z-0 my-6 max-w-4xl mx-auto">
                    {[
                        { num: 1, label: "Setup Inicial" },
                        { num: 2, label: "Resumo Faturamento" },
                        { num: 3, label: "Seleção Fiscal" },
                        { num: 4, label: "Emissão de Notas" },
                        { num: 5, label: "Fechamento do Lote" }
                    ].map(step => {
                        const isActive = currentStep === step.num;
                        const isPast = currentStep > step.num;
                        return (
                            <div key={step.num} className="relative z-10 flex flex-col items-center gap-2">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${isActive ? "bg-[var(--accent)] text-white ring-4 ring-[rgba(33,118,255,0.2)]" :
                                    isPast ? "bg-[var(--success)] text-white" :
                                        "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--fg-dim)]"
                                    }`}>
                                    {isPast ? "✓" : step.num}
                                </div>
                                <span className={`text-xs font-semibold ${isActive ? "text-[var(--accent)]" : isPast ? "text-[var(--success)]" : "text-[var(--fg-dim)]"}`}>
                                    {step.label}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="wizard-step-container min-h-[500px]">
                {currentStep === 1 && <Setup {...wizardProps} />}
                {currentStep === 2 && <ResumoFaturamento {...wizardProps} />}
                {currentStep === 3 && <SelecaoFiscal {...wizardProps} />}
                {currentStep === 4 && <EmissaoNotas {...wizardProps} />}
                {currentStep === 5 && <FechamentoLote {...wizardProps} />}
            </div>
        </div>
    );
}

