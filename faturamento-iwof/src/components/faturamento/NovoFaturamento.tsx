"use client";
import Link from "next/link";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useDropzone } from "react-dropzone";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
    Upload,
    FileSpreadsheet,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    Clock,
    ArrowLeft,
    DollarSign,
    Save,
    ExternalLink,
    Users,
    UserX,
    Plus,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/* ================================================================
   TYPES
   ================================================================ */

interface Ciclo {
    id: string;
    nome: string;
}

interface ClienteDB {
    id: string;
    razao_social: string;
    nome_fantasia: string | null;
    nome: string | null;
    nome_conta_azul: string | null;
    cnpj: string;
    ciclo_faturamento_id: string | null;
    ciclos_faturamento?: { nome: string } | null;
    status: boolean;
}

type ValidationStatus = "OK" | "CANCELAR" | "CORREÇÃO" | "FORA_PERIODO" | "DUPLICATA" | "EXCLUIDO";

interface Agendamento {
    id: string;
    nome: string;
    telefone: string;
    estado: string;
    loja: string;
    vaga: string;
    inicio: Date | null;
    termino: Date | null;
    refAgendamento: string;
    agendadoEm: Date | null;
    iniciadoEm: Date | null;
    concluidoEm: Date | null;
    valorIwof: number;
    fracaoHora: number;
    statusAgendamento: string;
    dataCancelamento: Date | null;
    motivoCancelamento: string;
    responsavelCancelamento: string;

    // Processed fields
    status: ValidationStatus;
    clienteId: string | null;      // matched DB client id
    cicloNome: string | null;      // from DB join
    rawRow: Record<string, string>;

    // Interactive fields
    isRemoved?: boolean;
    manualValue?: number;
    exclusionReason?: string;

    // Suggestion fields (for CORREÇÃO items > 6h)
    suggestedFracaoHora?: number;
    suggestedValorIwof?: number;
    suggestedTermino?: Date | null;
    originalFracaoHora?: number;
    originalValorIwof?: number;
    originalTermino?: Date | null;
}

interface ConciliationResult {
    naoCadastrados: { loja: string; cnpj: string }[];
    ausentesNoLote: ClienteDB[];
}

type Step = "setup" | "results";
type ResultTab = "validacoes" | "duplicatas" | "conciliacao" | "validados" | "excluidos";

/* ================================================================
   COLUMN MAP — case-insensitive header → key
   ================================================================ */

function findCol(headers: string[], ...candidates: string[]): string | null {
    const lower = headers.map((h) => h.toLowerCase().trim());
    for (const c of candidates) {
        const idx = lower.indexOf(c.toLowerCase());
        if (idx >= 0) return headers[idx];
    }
    // partial match fallback
    for (const c of candidates) {
        const idx = lower.findIndex((h) => h.includes(c.toLowerCase()));
        if (idx >= 0) return headers[idx];
    }
    return null;
}

/* ================================================================
   EXCEL DATE HELPER
   ================================================================ */

function parseDate(val: unknown): Date | null {
    if (val == null || val === "") return null;
    const s = String(val).trim();
    // Excel serial number
    const num = Number(s);
    if (!isNaN(num) && num > 10000 && num < 100000) {
        const epoch = new Date(Date.UTC(1899, 11, 30));
        epoch.setUTCDate(epoch.getUTCDate() + num);
        return epoch;
    }
    // Try parsing as date string
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    // dd/mm/yyyy
    const parts = s.split(/[\/\-]/);
    if (parts.length === 3) {
        const day = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1;
        const year = parseInt(parts[2]);
        if (year > 1900) {
            const parsed = new Date(year, month, day);
            if (!isNaN(parsed.getTime())) return parsed;
        }
    }
    return null;
}

function parseNumber(val: unknown): number {
    if (val == null || val === "") return 0;
    const s = String(val).replace(",", ".").replace(/[^\d.\-]/g, "");
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

function normalizeCnpj(raw: string): string {
    return raw.replace(/\D/g, "");
}

function fmtCurrency(v: number): string {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(d: Date | null): string {
    if (!d) return "—";
    return d.toLocaleDateString("pt-BR");
}

/* --- Similarity Helper --- */
function getSimilarity(s1: string, s2: string): number {
    const longer = s1.length < s2.length ? s2 : s1;
    const shorter = s1.length < s2.length ? s1 : s2;
    if (longer.length === 0) return 1.0;

    // Simple Levenshtein-ish or token matching overlap
    // For 95% proximity, we'll use a basic character-based distance
    const l1 = longer.toLowerCase();
    const l2 = shorter.toLowerCase();

    let costs = new Array();
    for (let i = 0; i <= l1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= l2.length; j++) {
            if (i == 0) costs[j] = j;
            else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (l1.charAt(i - 1) != l2.charAt(j - 1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) costs[l2.length] = lastValue;
    }
    const distance = costs[l2.length];
    return (longer.length - distance) / longer.length;
}

/* ================================================================
   COMPONENT
   ================================================================ */

export default function NovoFaturamento() {
    const supabase = createClient();

    /* --- Step --- */
    const [step, setStep] = useState<Step>("setup");

    /* --- Setup state --- */
    const [ciclos, setCiclos] = useState<Ciclo[]>([]);
    const [selectedCicloIds, setSelectedCicloIds] = useState<string[]>([]);
    const [periodoInicio, setPeriodoInicio] = useState("");
    const [periodoFim, setPeriodoFim] = useState("");
    const [fileName, setFileName] = useState("");
    const [newCicloName, setNewCicloName] = useState("");
    const [addingCiclo, setAddingCiclo] = useState(false);

    /* --- Results state --- */
    const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
    const [conciliation, setConciliation] = useState<ConciliationResult>({ naoCadastrados: [], ausentesNoLote: [] });
    const financialSummary = useMemo(() => {
        if (agendamentos.length === 0) return [];

        const sumByCiclo = new Map<string, number>();
        let originalBruto = 0;
        let totalLiquido = 0;
        let totalExcluido = 0;

        for (const a of agendamentos) {
            originalBruto += a.valorIwof;
            if (!a.isRemoved && a.status === "OK") {
                const ciclo = a.cicloNome || "Sem Ciclo";
                sumByCiclo.set(ciclo, (sumByCiclo.get(ciclo) ?? 0) + a.valorIwof);
                totalLiquido += a.valorIwof;
            } else if (a.isRemoved) {
                totalExcluido += a.valorIwof;
            }
        }

        const summaryArr = Array.from(sumByCiclo.entries()).map(([ciclo, total]) => ({ ciclo: ciclo as string, total: total as number }));
        summaryArr.push({ ciclo: "BRUTO ORIGINAL", total: originalBruto });
        summaryArr.push({ ciclo: "LÍQUIDO P/ LOTE", total: totalLiquido });
        summaryArr.push({ ciclo: "EXCLUÍDOS", total: totalExcluido });

        return summaryArr;
    }, [agendamentos]);

    const agendamentosMap = useMemo(() => new Map(agendamentos.map(a => [a.id, a])), [agendamentos]);
    const [activeTab, setActiveTab] = useState<ResultTab>("validacoes");
    const [processing, setProcessing] = useState(false);
    const [dbClientes, setDbClientes] = useState<ClienteDB[]>([]);
    const [editingAgendamentoId, setEditingAgendamentoId] = useState<string | null>(null);
    const [tempValue, setTempValue] = useState<string>("");
    const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
    const [isMinimized, setIsMinimized] = useState(false);
    const [duplicates, setDuplicates] = useState<{ identical: Agendamento[][], suspicious: Agendamento[][] }>({ identical: [], suspicious: [] });
    const [removedCount, setRemovedCount] = useState<number | null>(null);

    /* --- Save state --- */
    const [saving, setSaving] = useState(false);
    const [saveResult, setSaveResult] = useState<{ ok: number; err: number; loteId?: string } | null>(null);

    /* --- Fetch ciclos --- */
    useEffect(() => {
        supabase
            .from("ciclos_faturamento")
            .select("id, nome")
            .order("nome")
            .then(({ data }) => {
                if (data) setCiclos(data);
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ================================================================
       PROCESSING PIPELINE
       ================================================================ */

    const processFile = useCallback(
        async (rawRows: Record<string, string>[]) => {
            if (rawRows.length === 0) return;
            setProcessing(true);

            const headers = Object.keys(rawRows[0]);

            /* --- Map columns --- */
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

            /* --- Parse dates for period filter --- */
            const pStart = periodoInicio ? new Date(periodoInicio + "T00:00:00") : null;
            const pEnd = periodoFim ? new Date(periodoFim + "T23:59:59") : null;

            /* --- Fetch all active clients from DB --- */
            const { data: clientesDB } = await supabase
                .from("clientes")
                .select("id, razao_social, nome_fantasia, nome, nome_conta_azul, cnpj, ciclo_faturamento_id, ciclos_faturamento(nome), status")
                .eq("status", true);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const clientes: ClienteDB[] = (clientesDB as any[]) ?? [];
            setDbClientes(clientes);

            /* Build lookup maps */
            const clienteByCnpj = new Map<string, ClienteDB>();
            const clienteByName = new Map<string, ClienteDB>();
            for (const c of clientes) {
                clienteByCnpj.set(normalizeCnpj(c.cnpj), c);
                // Populate name lookup with all name variants
                const names = [c.razao_social, c.nome_fantasia, c.nome].filter(Boolean).map((n) => n!.toLowerCase().trim());
                for (const n of names) {
                    clienteByName.set(n, c);
                }
                // Prioritize nome_conta_azul — set LAST so it overwrites any previous entry with the same key
                if (c.nome_conta_azul) {
                    clienteByName.set(c.nome_conta_azul.toLowerCase().trim(), c);
                }
            }

            /* --- Iterate rows --- */
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

                if (!loja && !refAgendamento) continue; // skip empty rows

                /* --- Match client --- */
                let matched: ClienteDB | undefined;
                if (loja) {
                    matched = clienteByName.get(loja.toLowerCase().trim());
                }

                /* Track which clients appeared */
                if (matched) {
                    lojasVistas.add(matched.id);
                }

                /* --- Validate --- */
                let status: ValidationStatus = "OK";
                if (fracaoHora < 0.16 && fracaoHora > 0) {
                    status = "CANCELAR";
                } else if (fracaoHora > 6) {
                    status = "CORREÇÃO";
                } else if (inicio && pStart && pEnd) {
                    if (inicio < pStart || inicio > pEnd) {
                        status = "FORA_PERIODO";
                    }
                }

                /* --- Pre-compute suggestion for > 6h items --- */
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
                    cicloNome: matched?.ciclos_faturamento?.nome ?? null,
                    rawRow: row,
                    // Suggestion fields for CORREÇÃO items
                    suggestedFracaoHora,
                    suggestedValorIwof,
                    suggestedTermino,
                    originalFracaoHora: fracaoHora > 6 ? fracaoHora : undefined,
                    originalValorIwof: fracaoHora > 6 ? valorIwof : undefined,
                    originalTermino: fracaoHora > 6 ? termino : undefined,
                });
            }

            /* --- Duplicate Detection --- */
            const identicalMap: Map<string, Agendamento[]> = new Map();
            const suspiciousListResult: Agendamento[][] = [];
            const seenIndicesSet = new Set<number>();

            for (let i = 0; i < parsed.length; i++) {
                const a = parsed[i];
                // Exact key matching all core content
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

            // Suspicious: >99% similarity in name + same exact inicio + same exact termino
            for (let i = 0; i < parsed.length; i++) {
                const a = parsed[i];
                if (seenIndicesSet.has(i)) continue;

                const suspicious = parsed.filter((b, idx) => {
                    if (idx === i || seenIndicesSet.has(idx)) return false;

                    const sameInicio = a.inicio?.getTime() === b.inicio?.getTime();
                    const sameTermino = a.termino?.getTime() === b.termino?.getTime();
                    const sameLoja = a.loja === b.loja;
                    if (!sameInicio || !sameTermino || !sameLoja) return false;

                    const nameSim = getSimilarity(a.nome, b.nome);
                    return nameSim >= 0.99;
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

            setAgendamentos(parsed);

            /* --- Conciliation --- */
            // A) Lojas na planilha não cadastradas
            const naoCadastrados = new Map<string, { loja: string; cnpj: string }>();
            for (const a of parsed) {
                if (!a.clienteId) {
                    const key = a.loja.toLowerCase();
                    if (!naoCadastrados.has(key)) {
                        naoCadastrados.set(key, { loja: a.loja, cnpj: a.refAgendamento });
                    }
                }
            }

            setConciliation({
                naoCadastrados: Array.from(naoCadastrados.values()),
                ausentesNoLote: [],
            });

            setProcessing(false);
            setStep("results");
        },
        [supabase, periodoInicio, periodoFim, selectedCicloIds]
    );

    /* ================================================================
       FILE HANDLER
       ================================================================ */

    const onDrop = useCallback(
        (acceptedFiles: File[]) => {
            const file = acceptedFiles[0];
            if (!file) return;
            setFileName(file.name);

            const ext = file.name.split(".").pop()?.toLowerCase();

            if (ext === "csv") {
                // Auto-detect encoding: try UTF-8 first, fallback to ISO-8859-1 if garbled
                const tryParse = (encoding: string) => {
                    Papa.parse(file, {
                        header: true,
                        encoding,
                        skipEmptyLines: true,
                        complete: (result) => {
                            const rows = result.data as Record<string, string>[];
                            // Check for mojibake patterns in headers + first few rows
                            const sample = [Object.keys(rows[0] || {}).join(" "), ...rows.slice(0, 5).map(r => Object.values(r).join(" "))].join(" ");
                            const hasMojibake = /Ã[£¡ªâ©³µ]|Ã\u0083|Ã\u0082|Ã§Ã|Ã­|Ã³|Ãº|Ã\u00A3/.test(sample);

                            if (encoding === "UTF-8" && hasMojibake) {
                                // Retry with Latin-1
                                tryParse("ISO-8859-1");
                            } else {
                                processFile(rows);
                            }
                        },
                    });
                };
                tryParse("UTF-8");
            } else {
                // xlsx / xls
                const reader = new FileReader();
                reader.onload = (e) => {
                    const data = new Uint8Array(e.target?.result as ArrayBuffer);
                    const wb = XLSX.read(data, { type: "array" });
                    const ws = wb.Sheets[wb.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
                    processFile(rows);
                };
                reader.readAsArrayBuffer(file);
            }
        },
        [processFile]
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            "text/csv": [".csv"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
            "application/vnd.ms-excel": [".xls"],
        },
        maxFiles: 1,
    });

    /* --- Interactive Audit Actions --- */
    const toggleRemoval = (id: string) => {
        setAgendamentos((prev) =>
            prev.map((a) => (a.id === id ? { ...a, isRemoved: !a.isRemoved } : a))
        );
    };

    const massRemoveForaPeriodo = () => {
        setAgendamentos((prev) =>
            prev.map((a) => {
                const isSelected = selectedRefs.has(a.id);
                if (isSelected && a.status === "FORA_PERIODO") {
                    return { ...a, isRemoved: true };
                }
                return a;
            })
        );
        setSelectedRefs(new Set());
    };

    const toggleSelect = (id: string) => {
        setSelectedRefs((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = (items: Agendamento[]) => {
        const visibleIds = items.filter(a => !a.isRemoved).map(a => a.id);
        const allSelected = visibleIds.every(id => selectedRefs.has(id));

        setSelectedRefs(prev => {
            const next = new Set(prev);
            if (allSelected) {
                visibleIds.forEach(id => next.delete(id));
            } else {
                visibleIds.forEach(id => next.add(id));
            }
            return next;
        });
    };

    const keepOnlyOne = (ids: string[]) => {
        if (ids.length < 2) return;
        const toRemove = new Set(ids.slice(1));
        setAgendamentos(prev => prev.map(a => {
            if (toRemove.has(a.id)) {
                return { ...a, isRemoved: true };
            }
            return a;
        }));
    };

    const autoClearDuplicates = () => {
        const idsToRemove = new Set<string>();

        // ONLY Identical groups for auto cleanup
        duplicates.identical.forEach(group => {
            group.slice(1).forEach(a => {
                if (!a.isRemoved) idsToRemove.add(a.id);
            });
        });

        if (idsToRemove.size === 0) return;

        setAgendamentos(prev => prev.map(a => {
            if (idsToRemove.has(a.id)) {
                return { ...a, isRemoved: true };
            }
            return a;
        }));

        setRemovedCount(idsToRemove.size);
        setTimeout(() => setRemovedCount(null), 5000);
    };

    const applyCorrection = (id: string, newValue: number) => {
        setAgendamentos((prev) =>
            prev.map((a) =>
                a.id === id ? { ...a, manualValue: newValue, status: "OK" as const } : a
            )
        );
        setEditingAgendamentoId(null);
    };

    /** Confirm the suggested 6h cap — updates termino, fracaoHora, valorIwof */
    const confirmCorrection = (id: string) => {
        setAgendamentos((prev) =>
            prev.map((a) => {
                if (a.id !== id) return a;
                return {
                    ...a,
                    fracaoHora: a.suggestedFracaoHora ?? a.fracaoHora,
                    valorIwof: a.suggestedValorIwof ?? a.valorIwof,
                    termino: a.suggestedTermino ?? a.termino,
                    status: "OK" as const,
                };
            })
        );
    };

    /* ================================================================
       SAVE (Confirmar e Gerar Lote)
       ================================================================ */

    const handleSave = async () => {
        setSaving(true);
        setSaveResult(null);



        /* 1) Create lote */
        const { data: lote, error: loteErr } = await supabase
            .from("faturamentos_lote")
            .insert({
                data_competencia: periodoInicio,
                data_inicio_ciclo: periodoInicio,
                data_fim_ciclo: periodoFim,
                ciclo_faturamento_id: selectedCicloIds[0] || null,
                status: "PENDENTE",
            })
            .select("id")
            .single();

        if (loteErr || !lote) {
            console.error("Erro ao criar lote:", loteErr);
            setSaving(false);
            setSaveResult({ ok: 0, err: 1 });
            return;
        }

        /* 2) Bulk insert agendamentos */
        const allDuplicateIds = new Set([
            ...duplicates.identical.flat().map(d => d.id),
            ...duplicates.suspicious.flat().map(d => d.id)
        ]);

        const rows = agendamentos
            .filter((a) => a.clienteId) // only those with a client match
            .map((a) => {
                let finalStatus = a.status as string;

                if (a.isRemoved) {
                    if (a.status === "CANCELAR") finalStatus = "CANCELADO";
                    else if (allDuplicateIds.has(a.id)) {
                        finalStatus = "DUPLICATA";
                    } else {
                        finalStatus = "EXCLUIDO";
                    }
                } else if (a.status === "OK") {
                    finalStatus = "VALIDADO";
                }

                return {
                    lote_id: lote.id,
                    nome_profissional: a.nome || "N/A",
                    loja_id: a.clienteId!,
                    cnpj_loja: a.refAgendamento || null,
                    data_inicio: a.inicio?.toISOString() ?? periodoInicio,
                    data_fim: a.termino?.toISOString() ?? periodoFim,
                    valor_iwof: a.manualValue ?? a.valorIwof,
                    fracao_hora: a.fracaoHora,
                    status_validacao: finalStatus,
                };
            });

        let ok = 0;
        let err = 0;

        // Batch in chunks of 500
        const CHUNK = 500;
        for (let i = 0; i < rows.length; i += CHUNK) {
            const chunk = rows.slice(i, i + CHUNK);
            const { error } = await supabase.from("agendamentos_brutos").insert(chunk);
            if (error) {
                console.error("Upsert error batch", i, error);
                err += chunk.length;
            } else {
                ok += chunk.length;
            }
        }

        setSaving(false);
        setSaveResult({ ok, err, loteId: lote.id });
    };

    /* ================================================================
       DERIVED DATA
       ================================================================ */

    const excluidos = agendamentos.filter((a) => a.isRemoved);
    const validacoes = agendamentos.filter((a) => !a.isRemoved && (a.status === "CANCELAR" || a.status === "CORREÇÃO"));
    const foraPeriodo = agendamentos.filter((a) => !a.isRemoved && a.status === "FORA_PERIODO");
    const validados = agendamentos.filter((a) => !a.isRemoved && a.status === "OK");
    const selectedCicloNomes = ciclos.filter((c) => selectedCicloIds.includes(c.id)).map((c) => c.nome);

    const setupReady = periodoInicio && periodoFim && selectedCicloIds.length > 0;

    /* --- Agrupamento por Estado --- */
    const getGroupedByEstado = (items: Agendamento[]) => {
        const groups: Record<string, Agendamento[]> = {};
        items.forEach(a => {
            const uf = a.estado || "SEM ESTADO";
            if (!groups[uf]) groups[uf] = [];
            groups[uf].push(a);
        });
        return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
    };

    /* --- Add new ciclo --- */
    const handleAddCiclo = async () => {
        const name = newCicloName.trim().toUpperCase();
        if (!name) return;
        setAddingCiclo(true);
        const { data, error } = await supabase
            .from("ciclos_faturamento")
            .insert({ nome: name })
            .select("id, nome")
            .single();
        if (data && !error) {
            setCiclos((prev) => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)));
            setSelectedCicloIds((prev) => [...prev, data.id]);
        }
        setNewCicloName("");
        setAddingCiclo(false);
    };

    const toggleCiclo = (id: string) => {
        setSelectedCicloIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    /* ================================================================
       RENDER: SETUP STEP
       ================================================================ */

    if (step === "setup") {
        return (
            <div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Left column: Period + Ciclos */}
                    <div className="card">
                        <h3 className="text-lg font-semibold text-white mb-4">Configuração do Lote</h3>

                        {/* Period */}
                        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-dim)] mb-2">
                            Período de Competência
                        </p>
                        <div className="form-grid" style={{ marginBottom: 20 }}>
                            <div className="input-group">
                                <label className="input-label">Período Início</label>
                                <input
                                    type="date"
                                    className="input"
                                    style={{ paddingLeft: 14 }}
                                    value={periodoInicio}
                                    onChange={(e) => setPeriodoInicio(e.target.value)}
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">Período Fim</label>
                                <input
                                    type="date"
                                    className="input"
                                    style={{ paddingLeft: 14 }}
                                    value={periodoFim}
                                    onChange={(e) => setPeriodoFim(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Ciclo multi-select */}
                        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-dim)] mb-2">
                            Ciclos de Faturamento
                            <span className="text-[var(--fg-dim)] font-normal ml-1">(múltipla escolha)</span>
                        </p>
                        <div className="flex flex-wrap gap-2 mb-4">
                            {ciclos.map((c) => {
                                const isSelected = selectedCicloIds.includes(c.id);
                                return (
                                    <button
                                        key={c.id}
                                        className={`badge cursor-pointer transition-all text-sm px-4 py-2 ${isSelected ? "badge-success" : "badge-info"
                                            }`}
                                        style={{
                                            border: isSelected ? "2px solid #22c55e" : "2px solid transparent",
                                        }}
                                        onClick={() => toggleCiclo(c.id)}
                                    >
                                        {isSelected && "✓ "}{c.nome}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Add new ciclo */}
                        <div className="flex items-center gap-2">
                            <input
                                className="input text-sm"
                                placeholder="Novo ciclo..."
                                value={newCicloName}
                                onChange={(e) => setNewCicloName(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleAddCiclo()}
                                style={{ maxWidth: 200, paddingLeft: 12 }}
                            />
                            <button
                                className="btn btn-ghost btn-sm"
                                onClick={handleAddCiclo}
                                disabled={addingCiclo || !newCicloName.trim()}
                            >
                                <Plus size={16} /> Adicionar
                            </button>
                        </div>
                    </div>

                    {/* Right column: Dropzone */}
                    <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
                        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-dim)] mb-3">
                            Planilha de Agendamentos
                        </p>
                        <div
                            {...getRootProps()}
                            className="dropzone"
                            style={{
                                border: isDragActive
                                    ? "2px solid var(--accent)"
                                    : "2px dashed var(--border)",
                                borderRadius: "var(--radius-lg)",
                                padding: "64px 24px",
                                textAlign: "center",
                                cursor: setupReady ? "pointer" : "not-allowed",
                                opacity: setupReady ? 1 : 0.5,
                                background: isDragActive ? "rgba(99,102,241,0.06)" : "transparent",
                                transition: "all 0.2s ease",
                                flex: 1,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <input {...getInputProps()} disabled={!setupReady} />
                            {processing ? (
                                <div className="flex flex-col items-center gap-3">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]" />
                                    <p className="text-sm text-[var(--fg-muted)]">Processando planilha...</p>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-3">
                                    {fileName ? (
                                        <FileSpreadsheet size={48} className="text-[var(--accent)]" />
                                    ) : (
                                        <Upload size={48} className="text-[var(--fg-dim)]" />
                                    )}
                                    <p className="text-sm text-[var(--fg-muted)]">
                                        {!setupReady
                                            ? "Preencha o período e selecione ao menos um ciclo"
                                            : fileName
                                                ? `Arquivo carregado: ${fileName}`
                                                : "Arraste a planilha aqui ou clique para selecionar"}
                                    </p>
                                    <p className="text-xs text-[var(--fg-dim)]">
                                        Formatos aceitos: .xlsx, .xls, .csv
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    /* ================================================================
       RENDER: RESULTS STEP
       ================================================================ */

    const TABS: { key: ResultTab; label: string; count: number }[] = [
        { key: "validacoes", label: "Validações", count: validacoes.length + foraPeriodo.length },
        {
            key: "duplicatas",
            label: "Duplicatas",
            count: duplicates.identical.reduce((acc, group) => {
                const activeCount = group.filter(item => !(agendamentosMap.get(item.id)?.isRemoved)).length;
                return acc + Math.max(0, activeCount - 1);
            }, 0) + duplicates.suspicious.filter(group => {
                const activeCount = group.filter(item => !(agendamentosMap.get(item.id)?.isRemoved)).length;
                return activeCount > 1;
            }).length // Use length of filtered array
        },
        { key: "conciliacao", label: "Conciliação", count: conciliation.naoCadastrados.length + conciliation.ausentesNoLote.length },
        { key: "excluidos", label: "Excluídos", count: excluidos.length },
        { key: "validados", label: "Validados", count: validados.length },
    ];

    return (
        <div>
            {/* Back button */}
            <div className="flex items-center justify-between mb-4">
                <button
                    className="btn btn-ghost"
                    onClick={() => {
                        setStep("setup");
                        setAgendamentos([]);
                        setSaveResult(null);
                        setFileName("");
                    }}
                >
                    <ArrowLeft size={16} /> Voltar ao Setup
                </button>

                <button
                    className="btn btn-ghost btn-sm text-[var(--fg-dim)] gap-2"
                    onClick={() => setIsMinimized(!isMinimized)}
                >
                    {isMinimized ? "Mostrar Detalhes" : "Minimizar Detalhes"}
                </button>
            </div>

            {/* ======== KPI Financial Cards ======== */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {financialSummary.map((fs) => (
                    <div
                        key={fs.ciclo}
                        className="card"
                        style={{
                            borderLeft:
                                fs.ciclo === "BRUTO ORIGINAL"
                                    ? "3px solid var(--accent)"
                                    : fs.ciclo === "EXCLUÍDOS"
                                        ? "3px solid var(--danger)"
                                        : "3px solid #22c55e",
                        }}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-medium uppercase tracking-wider text-[var(--fg-dim)]">
                                    {fs.ciclo}
                                </p>
                                <p
                                    className="text-xl font-bold mt-1"
                                    style={{
                                        color:
                                            fs.ciclo === "BRUTO ORIGINAL"
                                                ? "var(--accent)"
                                                : fs.ciclo === "EXCLUÍDOS"
                                                    ? "var(--danger)"
                                                    : "#22c55e",
                                    }}
                                >
                                    {fmtCurrency(fs.total)}
                                </p>
                            </div>
                            <DollarSign
                                size={24}
                                style={{
                                    color:
                                        fs.ciclo === "BRUTO ORIGINAL"
                                            ? "var(--accent)"
                                            : fs.ciclo === "EXCLUÍDOS"
                                                ? "var(--danger)"
                                                : "#22c55e",
                                    opacity: 0.4,
                                }}
                            />
                        </div>
                    </div>
                ))}
            </div>

            {/* Summary badges */}
            <div className="flex flex-wrap gap-3 mb-5">
                <span className="badge badge-info">{agendamentos.length} linhas lidas</span>
                <span className="badge badge-success">{validados.length} validados</span>
                {validacoes.length > 0 && (
                    <span className="badge badge-danger">{validacoes.length} com problemas</span>
                )}
                {foraPeriodo.length > 0 && (
                    <span className="badge" style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
                        {foraPeriodo.length} fora do período
                    </span>
                )}
                <span className="badge badge-info">Ciclos: {selectedCicloNomes.join(", ")}</span>
            </div>

            {/* Save result banner */}
            {saveResult && (
                <div
                    className={`import-result ${saveResult.err > 0 ? "import-result-warn" : "import-result-ok"} mb-5`}
                >
                    <CheckCircle2 size={18} />
                    <span>
                        Lote criado! {saveResult.ok} agendamento(s) salvos.
                        {saveResult.err > 0 && ` ${saveResult.err} erro(s).`}
                    </span>
                </div>
            )}

            {/* ======== Tabs ======== */}
            <div className="tabs mb-0">
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        className={`tab ${activeTab === tab.key ? "tab-active" : ""}`}
                        onClick={() => setActiveTab(tab.key)}
                    >
                        {tab.label}
                        <span
                            className="ml-2 text-xs font-mono px-2 py-0.5 rounded-full"
                            style={{
                                background: activeTab === tab.key ? "var(--accent)" : "var(--bg-card-hover)",
                                color: activeTab === tab.key ? "#fff" : "var(--fg-dim)",
                            }}
                        >
                            {tab.count}
                        </span>
                    </button>
                ))}
            </div>

            {/* ======== Tab Content ======== */}
            {!isMinimized && (
                <div className="card" style={{ borderTopLeftRadius: 0, marginTop: 0 }}>
                    {/* ----------- TAB: VALIDAÇÕES ----------- */}
                    {activeTab === "validacoes" && (
                        <div>
                            {validacoes.length === 0 && foraPeriodo.length === 0 ? (
                                <p className="text-sm text-[var(--fg-dim)] py-8 text-center">
                                    Nenhum problema de validação encontrado! 🎉
                                </p>
                            ) : (
                                <>
                                    {/* ====== CANCELAR section (< 10 min) — shown first ====== */}
                                    {(() => {
                                        const cancelarItems = validacoes.filter(a => a.status === "CANCELAR");
                                        if (cancelarItems.length === 0) return null;
                                        return (
                                            <div className="mb-10">
                                                <div className="flex items-center gap-2 mb-4">
                                                    <AlertTriangle size={18} className="text-[var(--danger)]" />
                                                    <h4 className="text-base font-semibold text-[var(--danger)]">
                                                        Cancelamentos — Menos de 10 Minutos ({cancelarItems.length})
                                                    </h4>
                                                </div>
                                                <div className="space-y-8">
                                                    {getGroupedByEstado(cancelarItems).map(([uf, items]) => (
                                                        <div key={uf}>
                                                            <div className="flex items-center gap-3 mb-4 bg-[var(--bg-card)] p-2 rounded-lg border-l-4 border-[var(--danger)]">
                                                                <span className="text-xl font-bold text-[var(--danger)] ml-2">{uf}</span>
                                                                <span className="text-xs text-[var(--fg-dim)] uppercase tracking-widest">{items.length} agendamentos</span>
                                                            </div>
                                                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                                                {items.map((a) => (
                                                                    <div key={a.id} className={`card p-4 border-l-4 border-[var(--danger)] transition-all ${a.isRemoved ? "opacity-30 grayscale blur-[1px]" : ""}`}>
                                                                        <div className="flex justify-between items-start mb-3">
                                                                            <div className="flex-1 min-w-0 mr-2">
                                                                                <h5 className="font-bold text-white text-sm leading-tight truncate">{a.loja}</h5>
                                                                                <p className="text-[10px] text-[var(--fg-dim)] uppercase mt-0.5">{a.nome}</p>
                                                                            </div>
                                                                            <span className="badge badge-danger text-[9px] px-1.5 py-0.5 h-auto">CANCELAR</span>
                                                                        </div>
                                                                        <p className="text-[10px] font-medium mb-3 text-[var(--danger)]">MOTIVO: MENOS DE 10 MINUTOS</p>
                                                                        <div className="grid grid-cols-2 gap-y-1.5 text-[10px] mb-4">
                                                                            <div className="text-[var(--fg-dim)] uppercase">Horário</div>
                                                                            <div className="text-right text-[var(--fg-muted)]">{fmtDate(a.inicio)} - {fmtDate(a.termino)}</div>
                                                                            <div className="text-[var(--fg-dim)] uppercase">Duração</div>
                                                                            <div className="text-right font-mono font-bold text-[var(--danger)]">{a.fracaoHora.toFixed(2)}h</div>
                                                                            <div className="text-[var(--fg-dim)] uppercase">Valor Bruto</div>
                                                                            <div className="text-right font-mono text-white">{fmtCurrency(a.valorIwof)}</div>
                                                                        </div>
                                                                        <div className="pt-3 border-t border-[var(--border)] flex justify-between items-center gap-2">
                                                                            <button className={`btn btn-sm h-7 px-2 text-[10px] ${a.isRemoved ? "btn-success" : "btn-danger"}`} onClick={() => toggleRemoval(a.id)}>
                                                                                {a.isRemoved ? "Restaurar" : "Remover"}
                                                                            </button>
                                                                            <a href={`https://administrativo.iwof.com.br/workers/${a.refAgendamento}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm h-7 w-7 p-0 flex items-center justify-center text-[var(--fg-dim)] hover:text-white" title="Perfil Admin">
                                                                                <ExternalLink size={12} />
                                                                            </a>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* ====== CORREÇÃO section (> 6h) — shown second ====== */}
                                    {(() => {
                                        const correcaoItems = validacoes.filter(a => a.status === "CORREÇÃO");
                                        if (correcaoItems.length === 0) return null;
                                        return (
                                            <div className="mb-10">
                                                <div className="flex items-center gap-2 mb-4">
                                                    <Clock size={18} style={{ color: "#f59e0b" }} />
                                                    <h4 className="text-base font-semibold" style={{ color: "#f59e0b" }}>
                                                        Correções — Mais de 6 Horas ({correcaoItems.length})
                                                    </h4>
                                                </div>
                                                <div className="space-y-8">
                                                    {getGroupedByEstado(correcaoItems).map(([uf, items]) => (
                                                        <div key={uf}>
                                                            <div className="flex items-center gap-3 mb-4 bg-[var(--bg-card)] p-2 rounded-lg border-l-4 border-[#f59e0b]">
                                                                <span className="text-xl font-bold ml-2" style={{ color: "#f59e0b" }}>{uf}</span>
                                                                <span className="text-xs text-[var(--fg-dim)] uppercase tracking-widest">{items.length} agendamentos</span>
                                                            </div>
                                                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                                                {items.map((a) => (
                                                                    <div key={a.id} className={`card p-4 border-l-4 border-[#f59e0b] transition-all ${a.isRemoved ? "opacity-30 grayscale blur-[1px]" : ""}`}>
                                                                        <div className="flex justify-between items-start mb-3">
                                                                            <div className="flex-1 min-w-0 mr-2">
                                                                                <h5 className="font-bold text-white text-sm leading-tight truncate">{a.loja}</h5>
                                                                                <p className="text-[10px] text-[var(--fg-dim)] uppercase mt-0.5">{a.nome}</p>
                                                                            </div>
                                                                            <span className="badge badge-info text-[9px] px-1.5 py-0.5 h-auto">CORREÇÃO</span>
                                                                        </div>

                                                                        <p className="text-[10px] font-medium mb-3" style={{ color: "#f59e0b" }}>
                                                                            MOTIVO: MAIS DE 6 HORAS ({(a.originalFracaoHora ?? a.fracaoHora).toFixed(2)}h)
                                                                        </p>

                                                                        {/* Original values */}
                                                                        <div className="grid grid-cols-2 gap-y-1.5 text-[10px] mb-3">
                                                                            <div className="text-[var(--fg-dim)] uppercase">Horário Original</div>
                                                                            <div className="text-right text-[var(--fg-muted)]">{fmtDate(a.inicio)} - {fmtDate(a.originalTermino ?? a.termino)}</div>
                                                                            <div className="text-[var(--fg-dim)] uppercase">Duração Original</div>
                                                                            <div className="text-right font-mono font-bold" style={{ color: "#f59e0b" }}>{(a.originalFracaoHora ?? a.fracaoHora).toFixed(2)}h</div>
                                                                            <div className="text-[var(--fg-dim)] uppercase">Valor Original</div>
                                                                            <div className="text-right font-mono text-white">{fmtCurrency(a.originalValorIwof ?? a.valorIwof)}</div>
                                                                        </div>

                                                                        {/* Suggested values (highlighted box) */}
                                                                        {a.suggestedValorIwof != null && (
                                                                            <div className="bg-[var(--bg-card-hover)] rounded-lg p-3 mb-3 border border-[#f59e0b33]">
                                                                                <p className="text-[9px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#f59e0b" }}>⚡ Sugestão (Cap 6h)</p>
                                                                                <div className="grid grid-cols-2 gap-y-1.5 text-[10px]">
                                                                                    <div className="text-[var(--fg-dim)] uppercase">Horário Sugerido</div>
                                                                                    <div className="text-right font-mono text-[var(--success)]">{fmtDate(a.inicio)} - {fmtDate(a.suggestedTermino ?? null)}</div>
                                                                                    <div className="text-[var(--fg-dim)] uppercase">Duração Sugerida</div>
                                                                                    <div className="text-right font-mono font-bold text-[var(--success)]">{a.suggestedFracaoHora?.toFixed(2)}h</div>
                                                                                    <div className="text-[var(--fg-dim)] uppercase">Valor Sugerido</div>
                                                                                    <div className="text-right font-mono font-bold text-[var(--success)]">{fmtCurrency(a.suggestedValorIwof)}</div>
                                                                                </div>
                                                                            </div>
                                                                        )}

                                                                        {/* Inline manual editor */}
                                                                        {editingAgendamentoId === a.id && (
                                                                            <div className="bg-[var(--bg-card-hover)] p-3 rounded mb-3">
                                                                                <label className="text-[10px] text-[var(--fg-dim)] mb-1 block uppercase">Ajustar Valor Manualmente</label>
                                                                                <div className="flex gap-2">
                                                                                    <input type="number" className="input flex-1 h-8 text-sm" value={tempValue} onChange={(e) => setTempValue(e.target.value)} autoFocus />
                                                                                    <button className="btn btn-primary btn-sm h-8" onClick={() => applyCorrection(a.id, parseFloat(tempValue) || 0)}>Ok</button>
                                                                                    <button className="btn btn-ghost btn-sm h-8" onClick={() => setEditingAgendamentoId(null)}>X</button>
                                                                                </div>
                                                                            </div>
                                                                        )}

                                                                        {/* Action buttons */}
                                                                        <div className="pt-3 border-t border-[var(--border)] flex flex-wrap justify-between items-center gap-2">
                                                                            <div className="flex items-center gap-1 flex-wrap">
                                                                                {!a.isRemoved && a.suggestedValorIwof != null && editingAgendamentoId !== a.id && (
                                                                                    <button className="btn btn-sm h-7 px-3 text-[10px]" style={{ background: "#22c55e", color: "#fff" }} onClick={() => confirmCorrection(a.id)}>
                                                                                        ✓ Confirmar Sugestão
                                                                                    </button>
                                                                                )}
                                                                                {!a.isRemoved && editingAgendamentoId !== a.id && (
                                                                                    <button className="btn btn-ghost btn-sm h-7 px-2 text-[10px] border border-[var(--border)]" onClick={() => { setEditingAgendamentoId(a.id); setTempValue((a.suggestedValorIwof ?? a.valorIwof).toString()); }}>
                                                                                        Editar Valor
                                                                                    </button>
                                                                                )}
                                                                                <button className={`btn btn-sm h-7 px-2 text-[10px] ${a.isRemoved ? "btn-success" : "btn-danger"}`} onClick={() => toggleRemoval(a.id)}>
                                                                                    {a.isRemoved ? "Restaurar" : "Remover"}
                                                                                </button>
                                                                            </div>
                                                                            <a href={`https://administrativo.iwof.com.br/workers/${a.refAgendamento}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm h-7 w-7 p-0 flex items-center justify-center text-[var(--fg-dim)] hover:text-white" title="Perfil Admin">
                                                                                <ExternalLink size={12} />
                                                                            </a>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    <div className="mt-12 pt-12 border-t border-[var(--border)]">
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="flex items-center gap-2">
                                                <Clock size={16} style={{ color: "#f59e0b" }} />
                                                <h4 className="text-sm font-semibold" style={{ color: "#f59e0b" }}>
                                                    Fora do Período ({foraPeriodo.filter(a => !a.isRemoved).length})
                                                </h4>
                                            </div>
                                            {foraPeriodo.some(a => !a.isRemoved) && (
                                                <button
                                                    className="btn btn-ghost btn-xs text-[var(--danger)] gap-1"
                                                    onClick={massRemoveForaPeriodo}
                                                >
                                                    <XCircle size={14} /> Remover Todos
                                                </button>
                                            )}
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="data-table">
                                                <thead>
                                                    <tr>
                                                        <th className="w-8">
                                                            <input
                                                                type="checkbox"
                                                                className="checkbox"
                                                                checked={foraPeriodo.length > 0 && foraPeriodo.filter(a => !a.isRemoved).every(a => selectedRefs.has(a.id))}
                                                                onChange={() => toggleSelectAll(foraPeriodo)}
                                                            />
                                                        </th>
                                                        <th>Loja</th>
                                                        <th>Usuário</th>
                                                        <th>Data Início</th>
                                                        <th>Período Lote</th>
                                                        <th>Valor IWOF</th>
                                                        <th></th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {foraPeriodo.map((a, i) => (
                                                        <tr key={i} className={a.isRemoved ? "opacity-30 line-through grayscale" : ""}>
                                                            <td>
                                                                <input
                                                                    type="checkbox"
                                                                    className="checkbox"
                                                                    checked={selectedRefs.has(a.id)}
                                                                    onChange={() => toggleSelect(a.id)}
                                                                    disabled={a.isRemoved}
                                                                />
                                                            </td>
                                                            <td className="table-primary">{a.loja}</td>
                                                            <td className="text-sm text-[var(--fg-muted)]">{a.nome}</td>
                                                            <td className="table-mono" style={{ color: "#f59e0b" }}>
                                                                {fmtDate(a.inicio)}
                                                            </td>
                                                            <td className="text-xs text-[var(--fg-dim)]">
                                                                {periodoInicio} → {periodoFim}
                                                            </td>
                                                            <td className="table-mono">{fmtCurrency(a.valorIwof)}</td>
                                                            <td className="text-right">
                                                                <button
                                                                    className="btn btn-ghost btn-xs"
                                                                    onClick={() => toggleRemoval(a.id)}
                                                                >
                                                                    {a.isRemoved ? "Restaurar" : "Remover"}
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* ----------- TAB: DUPLICATAS ----------- */}
                    {activeTab === "duplicatas" && (
                        <div className="space-y-8">
                            <div className="flex justify-between items-center bg-[var(--bg-card-hover)] p-4 rounded-xl border border-[var(--border)] mb-4">
                                <div>
                                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Limpeza Automática (100% Idênticos)</h3>
                                    <p className="text-xs text-[var(--fg-dim)]">Remove duplicatas idênticas automaticamente. Itens suspeitos requerem revisão manual.</p>
                                    {removedCount !== null && (
                                        <p className="text-xs text-[var(--success)] mt-1 font-bold">
                                            ✨ {removedCount} agendamentos duplicados foram removidos!
                                        </p>
                                    )}
                                </div>
                                <button
                                    className="btn btn-primary btn-sm flex items-center gap-2"
                                    onClick={autoClearDuplicates}
                                    disabled={duplicates.identical.length === 0}
                                >
                                    <CheckCircle2 size={16} /> Limpar 100% Idênticos
                                </button>
                            </div>

                            {duplicates.identical.length === 0 && duplicates.suspicious.length === 0 ? (
                                <p className="text-sm text-[var(--fg-dim)] py-8 text-center bg-[var(--bg-card-hover)] rounded-xl border border-dashed border-[var(--border)]">
                                    Nenhuma duplicata detectada! ✓
                                </p>
                            ) : (
                                <>
                                    {duplicates.identical.length > 0 && (
                                        <div>
                                            <div className="flex items-center gap-2 mb-4">
                                                <div className="w-2 h-2 rounded-full bg-[var(--danger)]" />
                                                <h4 className="text-sm font-semibold text-white uppercase tracking-wider">
                                                    Duplicatas Idênticas ({duplicates.identical.length} grupos)
                                                </h4>
                                            </div>
                                            <div className="space-y-4">
                                                {duplicates.identical
                                                    .filter(group => group.filter(item => !(agendamentosMap.get(item.id)?.isRemoved)).length > 1)
                                                    .map((group, idx) => (
                                                        <div key={idx} className="bg-[var(--bg-card-hover)] rounded-lg p-4 border border-[var(--border)]">
                                                            <div className="flex justify-between items-center mb-3">
                                                                <div className="text-xs text-[var(--fg-dim)]">
                                                                    Mesmo Profissional, Loja, Horário e Valor
                                                                </div>
                                                                <button
                                                                    className="btn btn-danger btn-xs"
                                                                    onClick={() => keepOnlyOne(group.map(a => a.id))}
                                                                    disabled={
                                                                        group.map(item => agendamentosMap.get(item.id) || item).every(a => a.isRemoved) ||
                                                                        group.slice(1).map(item => agendamentosMap.get(item.id) || item).every(a => a.isRemoved)
                                                                    }
                                                                >
                                                                    Manter Apenas Um
                                                                </button>
                                                            </div>
                                                            <div className="space-y-2 opacity-80">
                                                                {group.map((item, i) => {
                                                                    const a = agendamentosMap.get(item.id) || item;
                                                                    return (
                                                                        <div key={i} className={`flex justify-between text-[11px] ${a.isRemoved ? "line-through opacity-40" : ""}`}>
                                                                            <span>{a.loja} - {a.nome}</span>
                                                                            <span className="font-mono">{fmtCurrency(a.valorIwof)}</span>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    ))}
                                            </div>
                                        </div>
                                    )}

                                    {duplicates.suspicious.length > 0 && (
                                        <div>
                                            <div className="flex items-center gap-2 mb-4">
                                                <div className="w-2 h-2 rounded-full bg-[#f59e0b]" />
                                                <h4 className="text-sm font-semibold text-white uppercase tracking-wider">
                                                    Suspeitas de Duplicidade ({"99%+"})
                                                </h4>
                                            </div>
                                            <div className="space-y-4">
                                                {duplicates.suspicious
                                                    .filter(group => group.filter(item => !(agendamentosMap.get(item.id)?.isRemoved)).length > 1)
                                                    .map((group, idx) => (
                                                        <div key={idx} className="bg-[var(--bg-card-hover)] rounded-lg p-4 border border-[#f59e0b22]">
                                                            <div className="flex justify-between items-center mb-3">
                                                                <div className="text-xs text-[#f59e0b]">
                                                                    Match Suspeito ({" > 99%"}): Requer Revisão Manual
                                                                </div>
                                                                <div className="flex gap-2">
                                                                    <button
                                                                        className="btn btn-ghost btn-xs text-[var(--fg-dim)]"
                                                                        onClick={() => keepOnlyOne(group.map(a => a.id))}
                                                                        disabled={
                                                                            group.map(item => agendamentosMap.get(item.id) || item).every(a => a.isRemoved) ||
                                                                            group.slice(1).map(item => agendamentosMap.get(item.id) || item).every(a => a.isRemoved)
                                                                        }
                                                                    >
                                                                        Manter Um
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <div className="space-y-2">
                                                                {group.map((item, i) => {
                                                                    const a = agendamentosMap.get(item.id) || item;
                                                                    return (
                                                                        <div key={i} className={`flex justify-between text-[11px] ${a.isRemoved ? "line-through opacity-40" : ""}`}>
                                                                            <span>{a.loja} - {a.nome}</span>
                                                                            <div className="flex items-center gap-3">
                                                                                <span className="text-[var(--fg-dim)]">
                                                                                    {fmtDate(a.inicio)} {a.inicio?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                                </span>
                                                                                <span className="font-mono">{fmtCurrency(a.valorIwof)}</span>
                                                                                <button
                                                                                    className="btn btn-ghost btn-xs w-6 h-6 p-0"
                                                                                    onClick={() => toggleRemoval(a.id)}
                                                                                >
                                                                                    {a.isRemoved ? "↩" : "×"}
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                    {activeTab === "conciliacao" && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Não Cadastrados */}
                            <div>
                                <div className="flex items-center gap-2 mb-3">
                                    <UserX size={16} className="text-[var(--danger)]" />
                                    <h4 className="text-sm font-semibold text-[var(--danger)]">
                                        Lojas Não Cadastradas ({conciliation.naoCadastrados.length})
                                    </h4>
                                </div>
                                {conciliation.naoCadastrados.length === 0 ? (
                                    <p className="text-sm text-[var(--fg-dim)] py-4">
                                        Todas as lojas da planilha estão cadastradas ✓
                                    </p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="data-table">
                                            <thead>
                                                <tr>
                                                    <th>Loja</th>
                                                    <th>Refs Detectadas</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {conciliation.naoCadastrados.map((item, i) => (
                                                    <tr key={i} className="row-invalid">
                                                        <td className="table-primary">{item.loja}</td>
                                                        <td className="table-mono text-sm">{item.cnpj || "—"}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            {/* Ausentes no Lote */}
                            <div>
                                <div className="flex items-center gap-2 mb-3">
                                    <Users size={16} style={{ color: "#f59e0b" }} />
                                    <h4 className="text-sm font-semibold" style={{ color: "#f59e0b" }}>
                                        Clientes Ausentes do Lote ({conciliation.ausentesNoLote.length})
                                    </h4>
                                </div>
                                {conciliation.ausentesNoLote.length === 0 ? (
                                    <p className="text-sm text-[var(--fg-dim)] py-4">
                                        Todos os clientes dos ciclos selecionados vieram na planilha ✓
                                    </p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="data-table">
                                            <thead>
                                                <tr>
                                                    <th>Cliente</th>
                                                    <th>CNPJ</th>
                                                    <th>Ciclo</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {conciliation.ausentesNoLote.map((c) => (
                                                    <tr key={c.id}>
                                                        <td className="table-primary">{c.nome || c.razao_social}</td>
                                                        <td className="table-mono text-sm">{c.cnpj}</td>
                                                        <td>
                                                            <span className="badge badge-info" style={{ fontSize: 11 }}>
                                                                {c.ciclos_faturamento?.nome ?? "—"}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ----------- TAB: EXCLUÍDOS ----------- */}
                    {activeTab === "excluidos" && (
                        <div>
                            {excluidos.length === 0 ? (
                                <p className="text-sm text-[var(--fg-dim)] py-8 text-center">
                                    Nenhum agendamento excluído.
                                </p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Loja</th>
                                                <th>Usuário</th>
                                                <th>Valor</th>
                                                <th>Ação</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {excluidos.map((a, i) => (
                                                <tr key={i} className="opacity-60">
                                                    <td>
                                                        <span className="table-primary">{a.loja}</span>
                                                    </td>
                                                    <td className="text-sm text-[var(--fg-muted)]">{a.nome}</td>
                                                    <td className="table-mono">{fmtCurrency(a.valorIwof)}</td>
                                                    <td>
                                                        <button
                                                            className="btn btn-success btn-xs"
                                                            onClick={() => toggleRemoval(a.refAgendamento)}
                                                        >
                                                            Restaurar
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ----------- TAB: VALIDADOS ----------- */}
                    {activeTab === "validados" && (
                        <div>
                            {validados.length === 0 ? (
                                <p className="text-sm text-[var(--fg-dim)] py-8 text-center">
                                    Nenhum agendamento validado.
                                </p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Loja</th>
                                                <th>Usuário</th>
                                                <th>Início</th>
                                                <th>Término</th>
                                                <th>F.H.C</th>
                                                <th>Valor IWOF</th>
                                                <th>Ciclo</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {validados.map((a, i) => (
                                                <tr key={i}>
                                                    <td>
                                                        <span className="table-primary">{a.loja}</span>
                                                        {!a.clienteId && (
                                                            <span className="text-xs text-[var(--danger)] ml-1">(não vinculado)</span>
                                                        )}
                                                    </td>
                                                    <td className="text-sm text-[var(--fg-muted)]">{a.nome}</td>
                                                    <td className="text-sm text-[var(--fg-muted)]">{fmtDate(a.inicio)}</td>
                                                    <td className="text-sm text-[var(--fg-muted)]">{fmtDate(a.termino)}</td>
                                                    <td className="table-mono">{a.fracaoHora.toFixed(2)}</td>
                                                    <td className="table-mono font-semibold" style={{ color: "#22c55e" }}>
                                                        {fmtCurrency(a.valorIwof)}
                                                    </td>
                                                    <td>
                                                        <span className="badge badge-info" style={{ fontSize: 11 }}>
                                                            {a.cicloNome || "—"}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ======== Action bar ======== */}
            <div className="flex items-center justify-between mt-5 pt-4 border-t border-[var(--border)]">
                <div className="text-sm text-[var(--fg-dim)]">
                    {validados.filter((a) => a.clienteId).length} de {validados.length} validados possuem vínculo no banco
                </div>

                {saveResult?.loteId ? (
                    <Link
                        href={`/faturamento/lote/${saveResult.loteId}`}
                        className="btn btn-success"
                    >
                        <CheckCircle2 size={18} /> Ir para Fechamento
                    </Link>
                ) : (
                    <button
                        className="btn btn-primary"
                        disabled={saving || validados.filter((a) => a.clienteId).length === 0}
                        onClick={handleSave}
                    >
                        {saving ? (
                            "Salvando..."
                        ) : (
                            <><Save size={18} /> Confirmar e Gerar Lote</>
                        )}
                    </button>
                )}
            </div>
        </div>
    );
}
