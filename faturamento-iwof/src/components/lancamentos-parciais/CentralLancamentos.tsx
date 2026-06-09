"use client";

/* ================================================================
   CENTRAL DE LANÇAMENTOS PARCIAIS
   ================================================================
   ⚠️ ESCOPO ISOLADO: Este arquivo é 100% independente.
   - NÃO importa nada de NovoFaturamento.tsx ou seus parsers.
   - NÃO modifica tipagens globais.
   - Para exportação NFE.io usa API route própria (cópia isolada).
   ================================================================ */

import { useState, useCallback, useMemo, useEffect, useRef, ReactNode } from "react";
import { useDropzone } from "react-dropzone";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import * as pdfjsLib from "pdfjs-dist";

if (typeof window !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/workers/pdf.worker.min.mjs';
}
import {
    Upload,
    FileSpreadsheet,
    FileArchive,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Loader2,
    Download,
    RefreshCw,
    DollarSign,
    Building2,
    Search,
    FileText,
    ClipboardList,
    SendHorizonal,
    ChevronRight,
    ChevronLeft,
    X,
    Link2,
    Unlink,
    FileCode,
    Copy,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/* ================================================================
   TIPAGENS EXCLUSIVAS — MÓDULO LANÇAMENTOS PARCIAIS
   ================================================================ */

export interface LancamentoParcial {
    id: string;
    pedido: string;
    tipo: "NF" | "NC";
    descricao: string;
    valor: number;
    lojaIdentificadaId?: string;
    lojaNomeSugerido?: string;
    cnpj?: string;
    periodo_servico?: string;
    // Campos preenchidos pelo XML:
    numeroNFGerada?: string;
    irrf?: number;
    // UI:
    razaoSocialMatch?: string;
    nomeContaAzulMatch?: string;
}

interface ClientBrief_LP {
    id: string;
    razao_social: string;
}

interface ClienteDB_LP {
    id: string;
    razao_social: string;
    nome_fantasia: string | null;
    nome: string | null;
    nome_conta_azul: string | null;
    cnpj: string;
    email_principal?: string | null;
    emails_faturamento?: string | null;
    endereco?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
    codigo_ibge?: string | null;
    status: boolean;
}

type StepLP = "upload" | "matching" | "xml" | "zip" | "preview";

/* ================================================================
   HELPERS EXCLUSIVOS — LANÇAMENTOS PARCIAIS
   ================================================================ */

function gerarId_LP(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizarCNPJ_LP(raw: string): string {
    return (raw ?? "").replace(/\D/g, "");
}

function formatarCNPJ_LP(digits: string): string {
    if (digits.length !== 14) return digits;
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}

/**
 * Converte string monetária para número decimal.
 * Detecta automaticamente o formato:
 *   - Brasileiro: "1.572,30" (ponto = milhar, vírgula = decimal)
 *   - Internacional: "1572.30" ou "1,572.30"
 *   - Número puro: 1572.30
 */
function parseMoedaBR_LP(val: unknown): number {
    if (val == null || val === "") return 0;
    if (typeof val === "number") return val;

    let s = String(val).replace(/R\$\s*/g, "").trim();
    if (!s) return 0;

    const hasComma = s.includes(",");
    const hasDot = s.includes(".");

    if (hasComma && hasDot) {
        const lastComma = s.lastIndexOf(",");
        const lastDot = s.lastIndexOf(".");
        if (lastComma > lastDot) {
            // "1.572,30" → BR
            s = s.replace(/\./g, "").replace(",", ".");
        } else {
            // "1,572.30" → Internacional
            s = s.replace(/,/g, "");
        }
    } else if (hasComma && !hasDot) {
        s = s.replace(",", ".");
    } else if (hasDot && !hasComma) {
        const parts = s.split(".");
        if (parts.length > 2) {
            s = s.replace(/\./g, "");
        }
    }

    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

function fmtBRL_LP(v: number): string {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function normalizarNome_LP(nome?: string): string {
    if (!nome) return "";
    return nome.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function findCol_LP(headers: string[], ...candidates: string[]): string | null {
    const lower = headers.map((h) => h.toLowerCase().trim());
    for (const c of candidates) {
        const idx = lower.indexOf(c.toLowerCase());
        if (idx >= 0) return headers[idx];
    }
    for (const c of candidates) {
        const idx = lower.findIndex((h) => h.includes(c.toLowerCase()));
        if (idx >= 0) return headers[idx];
    }
    return null;
}

/**
 * Regex inteligente para extrair nome de loja de uma descrição livre.
 * Prioridade:
 *   1. Texto APÓS a última data (dd/mm/yyyy) na descrição
 *      Ex: "Serviço de mão de obra 08/12/2025 a 14/12/2025Alecrim" → "Alecrim"
 *   2. Tokens de grandes redes (Nordestão, Superfácil)
 *   3. Texto após separadores comuns (" - ", " – ")
 */
function extrairNomeLoja_LP(descricao: string): string | null {
    if (!descricao) return null;

    // 1. Captura texto APÓS a última data dd/mm/yyyy (com ou sem espaço)
    const datePattern = /\d{2}\/\d{2}\/\d{4}/g;
    let lastDateEnd = -1;
    let m;
    while ((m = datePattern.exec(descricao)) !== null) {
        lastDateEnd = m.index + m[0].length;
    }
    if (lastDateEnd > 0 && lastDateEnd < descricao.length) {
        const afterDate = descricao.slice(lastDateEnd).trim();
        // Remove prefixos comuns: " - ", ",", ";"
        const cleaned = afterDate.replace(/^[\s\-–,;:]+/, "").trim();
        if (cleaned.length >= 2) {
            return cleaned
                .replace(/\s*(LTDA|ME|SA|S\.A\.|EIRELI|EPP|CNPJ).*$/i, "")
                .trim();
        }
    }

    // 2. Tokens de grandes redes
    const upper = descricao.toUpperCase();
    const redePatterns = [
        /NORDEST[AÃ]O\s*[-–]?\s*(FILIAL\s*)?[\w\sÀ-ÿ]+/i,
        /SUPERFACIL\s*[-–]?\s*[\w\sÀ-ÿ]+/i,
        /SUPER\s*F[AÁ]CIL\s*[-–]?\s*[\w\sÀ-ÿ]+/i,
    ];
    for (const re of redePatterns) {
        const match = upper.match(re);
        if (match) {
            return (match[1] || match[0]).trim()
                .replace(/\s*(LTDA|ME|SA|S\.A\.|EIRELI|EPP|CNPJ).*$/i, "").trim();
        }
    }

    // 3. Texto após último separador
    const sepMatch = descricao.match(/(?:.*[-–]\s*)([A-ZÀ-ÿa-zà-ÿ][\w\sÀ-ÿà-ÿ]{2,})\s*$/i);
    if (sepMatch && sepMatch[1]) {
        return sepMatch[1].trim()
            .replace(/\s*(LTDA|ME|SA|S\.A\.|EIRELI|EPP|CNPJ).*$/i, "").trim();
    }

    return null;
}

/* ================================================================
   PARSER EXCLUSIVO — LANÇAMENTOS PARCIAIS
   ================================================================ */

function parsearPlanilha_LP(rawRows: Record<string, string>[]): {
    dados: LancamentoParcial[];
    erros: string[];
} {
    if (rawRows.length === 0) return { dados: [], erros: ["Planilha vazia."] };

    const headers = Object.keys(rawRows[0]);
    const erros: string[] = [];

    const colPedido = findCol_LP(headers, "pedido", "nº pedido", "numero pedido", "num pedido", "numero", "order");
    const colTipo = findCol_LP(headers, "nota", "tipo", "type", "indicador", "tp");
    const colDescricao = findCol_LP(headers, "descrição", "descricao", "desc", "serviço", "servico", "description", "observação", "obs");
    const colValor = findCol_LP(headers, "valor", "vlr", "total", "value", "amount");
    const colCnpj = findCol_LP(headers, "cnpj", "cpf/cnpj", "cpf_cnpj");
    const colLoja = findCol_LP(headers, "loja", "empresa", "cliente", "store", "razão social", "razao social");

    if (!colValor) {
        erros.push("Coluna VALOR não encontrada. Verifique o cabeçalho.");
        return { dados: [], erros };
    }

    const dados: LancamentoParcial[] = [];

    rawRows.forEach((row, idx) => {
        const pedido = colPedido ? String(row[colPedido] ?? "").trim() : String(idx + 1);
        const tipoRaw = colTipo ? String(row[colTipo] ?? "").trim().toUpperCase() : "";
        const descricao = colDescricao ? String(row[colDescricao] ?? "").trim() : "";
        const valor = parseMoedaBR_LP(colValor ? row[colValor] : "");
        const cnpjRaw = colCnpj ? normalizarCNPJ_LP(String(row[colCnpj] ?? "")) : "";
        const lojaRaw = colLoja ? String(row[colLoja] ?? "").trim() : "";

        if (valor === 0 && !descricao && !pedido) return; // linha vazia

        // Detectar tipo via coluna "Nota" ou equivalente
        // Aceita: "NC", "Nota de crédito", "Nota crédito", "NF", "Nota fiscal", "Nota", etc.
        let tipo: "NF" | "NC" = "NF";
        if (tipoRaw.includes("CRÉDITO") || tipoRaw.includes("CREDITO") || tipoRaw === "NC" || tipoRaw.startsWith("NC")) {
            tipo = "NC";
        } else if (tipoRaw.includes("FISCAL") || tipoRaw === "NF" || tipoRaw.startsWith("NF") || tipoRaw === "") {
            tipo = "NF";
        }

        // Extrair nome da loja via regex se não houver coluna explícita
        let lojaNome = lojaRaw;
        let periodo_servico = "";

        // Regex para extrair período: 02/03/2026 à 09/03/2026
        const regexPeriodo = /(\d{2}\/\d{2}\/\d{4}\s*à\s*\d{2}\/\d{2}\/\d{4})/i;
        const matchPeriodo = descricao.match(regexPeriodo);
        if (matchPeriodo) {
            periodo_servico = matchPeriodo[0];
        }

        if (!lojaNome) {
            // Limpeza da descrição para extrair a loja
            let cleanLoja = descricao
                .replace("Serviço de mão de obra", "")
                .replace(regexPeriodo, "")
                .replace(/\bloja\b/gi, "")
                .replace(/\s{2,}/g, " ")
                .trim();
            
            lojaNome = extrairNomeLoja_LP(cleanLoja) || cleanLoja;
        }

        dados.push({
            id: gerarId_LP(),
            pedido,
            tipo,
            descricao: descricao || `Pedido ${pedido}`,
            valor,
            lojaNomeSugerido: lojaNome || undefined,
            cnpj: cnpjRaw || undefined,
            periodo_servico: periodo_servico || undefined,
        });
    });

    if (dados.length === 0) {
        erros.push("Nenhum lançamento válido encontrado na planilha.");
    }

    return { dados, erros };
}

/* ================================================================
   COMPONENT
   ================================================================ */

export default function CentralLancamentos() {
    const supabase = createClient();

    /* --- State --- */
    const [step, setStep] = useState<StepLP>("upload");
    const [lancamentos, setLancamentos] = useState<LancamentoParcial[]>([]);
    const [errosParsing, setErrosParsing] = useState<string[]>([]);
    const [fileName, setFileName] = useState("");
    const [clientes, setClientes] = useState<ClienteDB_LP[]>([]);
    const [loadingClientes, setLoadingClientes] = useState(false);
    const [xmlProcessing, setXmlProcessing] = useState(false);
    const [xmlLoaded, setXmlLoaded] = useState(false);
    const [zipProcessing, setZipProcessing] = useState(false);
    const [uploadLogs, setUploadLogs] = useState<{ nomeArquivo: string, status: 'pendente' | 'sucesso' | 'erro', mensagem: string }[]>([]);
    const [exportando, setExportando] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [preFilterEmpresa, setPreFilterEmpresa] = useState("");
    const [nomePastaGCP, setNomePastaGCP] = useState("Notas_Credito");
    const [filterTipo, setFilterTipo] = useState<"ALL" | "NF" | "NC">("ALL");
    const [availableClients, setAvailableClients] = useState<ClientBrief_LP[]>([]);
    const [matchingTargets, setMatchingTargets] = useState<string[]>([]); // Agora armazena Razão Social
    const [searchTargetTerm, setSearchTargetTerm] = useState("");
    const [importandoNFSe, setImportandoNFSe] = useState(false);
    const [nfseImportLog, setNfseImportLog] = useState<string | null>(null);
    const nfseInputRef = useRef<HTMLInputElement>(null);

    // Área "Enviar NFs" — upload de NF ao Drive
    const [enviandoNFs, setEnviandoNFs] = useState(false);
    const [nfUploadLogs, setNfUploadLogs] = useState<{ nome: string; status: 'aguardando' | 'enviando' | 'ok' | 'erro'; msg: string }[]>([]);
    const nfInputRef = useRef<HTMLInputElement>(null);

    const uniqueRazaoSociais = useMemo(() => {
        const names = availableClients.map(c => c.razao_social).filter(Boolean);
        return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
    }, [availableClients]);

    const filteredRazaoSociais = useMemo(() => {
        if (!searchTargetTerm) return uniqueRazaoSociais;
        const term = searchTargetTerm.toLowerCase();
        return uniqueRazaoSociais.filter(n => n.toLowerCase().includes(term));
    }, [uniqueRazaoSociais, searchTargetTerm]);

    /* --- Fetch initial clients for matchmaking targets --- */
    useEffect(() => {
        const load = async () => {
            const { data, error } = await supabase
                .from("clientes")
                .select("id, razao_social")
                .eq("status", true)
                .order("razao_social");
            if (!error && data) setAvailableClients(data);
        };
        load();
    }, [supabase]);

    /* --- Totalizadores --- */
    const totalNF = useMemo(() => lancamentos.filter(l => l.tipo === "NF").reduce((s, l) => s + l.valor, 0), [lancamentos]);
    const totalNC = useMemo(() => lancamentos.filter(l => l.tipo === "NC").reduce((s, l) => s + l.valor, 0), [lancamentos]);
    const matched = useMemo(() => lancamentos.filter(l => l.lojaIdentificadaId).length, [lancamentos]);
    const unmatched = useMemo(() => lancamentos.filter(l => !l.lojaIdentificadaId).length, [lancamentos]);

    /* ================================================================
       STEP 2: MATCHING AUTOMÁTICO DE LOJAS
       ================================================================ */

    const fetchClientesEmatch = useCallback(async (dados: LancamentoParcial[]) => {
        setLoadingClientes(true);

        // Busca paginada de clientes ativos
        let allClientes: ClienteDB_LP[] = [];
        let from = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
            let query = supabase
                .from("clientes")
                .select("id, razao_social, nome_fantasia, nome, nome_conta_azul, cnpj, email_principal, emails_faturamento, endereco, numero, complemento, bairro, cidade, estado, cep, codigo_ibge, status")
                .eq("status", true);

            // 🎯 Targeted Matchmaking: Filtra pelos alvos se houver seleção
            if (matchingTargets.length > 0) {
                query = query.in("razao_social", matchingTargets);
            }

            const { data: chunk, error } = await query
                .range(from, from + pageSize - 1);

            if (error) { console.error("Erro fetch clientes:", error); break; }
            if (chunk && chunk.length > 0) {
                allClientes = [...allClientes, ...chunk];
                from += pageSize;
            }
            if (!chunk || chunk.length < pageSize) hasMore = false;
        }

        setClientes(allClientes);

        // Build lookup maps
        const byContaAzul = new Map<string, ClienteDB_LP>();
        const byCnpj = new Map<string, ClienteDB_LP>();
        for (const c of allClientes) {
            if (c.nome_conta_azul) byContaAzul.set(normalizarNome_LP(c.nome_conta_azul), c);
            if (c.cnpj) byCnpj.set(normalizarCNPJ_LP(c.cnpj), c);
        }

        // Match cada lançamento
        const matched = dados.map(lanc => {
            let cliente: ClienteDB_LP | undefined;

            // 1. CNPJ exato
            if (lanc.cnpj && lanc.cnpj.length >= 11) {
                cliente = byCnpj.get(lanc.cnpj);
            }

            // 2. Nome Conta Azul exato
            if (!cliente && lanc.lojaNomeSugerido) {
                const norm = normalizarNome_LP(lanc.lojaNomeSugerido);
                cliente = byContaAzul.get(norm);
            }

            // 3. Razão Social / Nome Fantasia / Nome exato
            if (!cliente && lanc.lojaNomeSugerido) {
                const norm = normalizarNome_LP(lanc.lojaNomeSugerido);
                cliente = allClientes.find(c =>
                    normalizarNome_LP(c.razao_social) === norm ||
                    normalizarNome_LP(c.nome_fantasia || "") === norm ||
                    normalizarNome_LP(c.nome || "") === norm
                );
            }

            // 4. Substring parcial — ranking por especificidade
            if (!cliente && lanc.lojaNomeSugerido) {
                const norm = normalizarNome_LP(lanc.lojaNomeSugerido);
                const partials = allClientes.filter(c => {
                    const names = [
                        normalizarNome_LP(c.nome_conta_azul || ""),
                        normalizarNome_LP(c.razao_social),
                        normalizarNome_LP(c.nome_fantasia || ""),
                        normalizarNome_LP(c.nome || ""),
                    ].filter(n => n.length > 0);
                    return names.some(n => norm.includes(n) || n.includes(norm));
                });

                if (partials.length === 1) {
                    cliente = partials[0];
                } else if (partials.length > 1) {
                    // Pega o mais específico
                    let best: ClienteDB_LP | undefined;
                    let bestScore = -1;
                    for (const c of partials) {
                        const names = [
                            normalizarNome_LP(c.nome_conta_azul || ""),
                            normalizarNome_LP(c.razao_social),
                            normalizarNome_LP(c.nome_fantasia || ""),
                        ].filter(n => n.length > 0);
                        const score = Math.max(...names.map(n => {
                            if (n === norm) return n.length + 1000;
                            if (norm.includes(n) || n.includes(norm)) return Math.min(n.length, norm.length);
                            return -1;
                        }));
                        if (score > bestScore && score >= 3) { bestScore = score; best = c; }
                    }
                    if (best) cliente = best;
                }
            }

            return {
                ...lanc,
                lojaIdentificadaId: cliente?.id,
                razaoSocialMatch: cliente?.razao_social,
                nomeContaAzulMatch: cliente?.nome_conta_azul || undefined,
                cnpj: lanc.cnpj || (cliente ? normalizarCNPJ_LP(cliente.cnpj) : undefined),
            };
        });

        setLancamentos(matched);
        setLoadingClientes(false);
    }, [supabase, matchingTargets]);

    /* ================================================================
       STEP 1: UPLOAD E PARSING
       ================================================================ */

    const parseFile = useCallback((file: File) => {
        setErrosParsing([]);
        setLancamentos([]);
        setFileName(file.name);

        const ext = file.name.split(".").pop()?.toLowerCase();

        const processRows = (rawRows: Record<string, string>[]) => {
            const { dados, erros } = parsearPlanilha_LP(rawRows);
            setLancamentos(dados);
            setErrosParsing(erros);
            if (dados.length > 0) {
                setStep("matching");
                fetchClientesEmatch(dados);
            }
        };

        if (ext === "csv") {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                encoding: "UTF-8",
                complete: (result) => processRows(result.data as Record<string, string>[]),
                error: (err) => { setErrosParsing([`Erro CSV: ${err.message}`]); },
            });
        } else if (ext === "xlsx" || ext === "xls") {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const wb = XLSX.read(e.target?.result, { type: "binary" });
                    const ws = wb.Sheets[wb.SheetNames[0]];
                    const raw = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "", raw: false });
                    processRows(raw);
                } catch (err: unknown) {
                    setErrosParsing([`Erro XLSX: ${err instanceof Error ? err.message : "desconhecido"}`]);
                }
            };
            reader.readAsBinaryString(file);
        } else {
            setErrosParsing(["Formato não suportado. Use CSV ou XLSX."]);
        }
    }, [fetchClientesEmatch]);

    const onDropUpload = useCallback((accepted: File[]) => {
        if (accepted.length > 0) parseFile(accepted[0]);
    }, [parseFile]);

    const dzUpload = useDropzone({
        onDrop: onDropUpload,
        accept: {
            "text/csv": [".csv"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
            "application/vnd.ms-excel": [".xls"],
        },
        multiple: false,
    });

    useEffect(() => {
        if (lancamentos.length > 0 && matchingTargets.length > 0 && (step === "matching" || step === "preview")) {
            fetchClientesEmatch(lancamentos);
        }
    }, [matchingTargets]);

    /* --- Manual match --- */
    const handleManualMatch = (lancId: string, clienteId: string) => {
        const cliente = clientes.find(c => c.id === clienteId);
        if (!cliente) return;
        setLancamentos(prev => prev.map(l =>
            l.id === lancId ? {
                ...l,
                lojaIdentificadaId: cliente.id,
                razaoSocialMatch: cliente.razao_social,
                nomeContaAzulMatch: cliente.nome_conta_azul || undefined,
                cnpj: normalizarCNPJ_LP(cliente.cnpj),
            } : l
        ));
    };

    const handleUnmatch = (lancId: string) => {
        setLancamentos(prev => prev.map(l =>
            l.id === lancId ? { ...l, lojaIdentificadaId: undefined, razaoSocialMatch: undefined, nomeContaAzulMatch: undefined } : l
        ));
    };

    /* --- Inline field edit --- */
    const handleFieldChange = (lancId: string, field: keyof LancamentoParcial, rawValue: string) => {
        setLancamentos(prev => {
            const updated = prev.map(l => {
                if (l.id !== lancId) return l;
                if (field === "valor" || field === "irrf") {
                    return { ...l, [field]: parseMoedaBR_LP(rawValue) } as LancamentoParcial;
                }
                if (field === "tipo") {
                    const v = rawValue.toUpperCase();
                    return { ...l, tipo: v === "NC" ? "NC" : "NF" } as LancamentoParcial;
                }
                return { ...l, [field]: rawValue } as LancamentoParcial;
            });

            // ⚠️ Automação: Replicar Nº NF da NF para as NCs da mesma loja/cnpj
            if (field === "numeroNFGerada") {
                const itemOrigem = updated.find(l => l.id === lancId);
                if (itemOrigem?.tipo === "NF") {
                    return updated.map(l => {
                        if (l.tipo === "NC") {
                            const matchId = l.lojaIdentificadaId && itemOrigem.lojaIdentificadaId && l.lojaIdentificadaId === itemOrigem.lojaIdentificadaId;
                            const matchCnpj = l.cnpj && itemOrigem.cnpj && l.cnpj === itemOrigem.cnpj;
                            if (matchId || matchCnpj) {
                                return { ...l, numeroNFGerada: rawValue };
                            }
                        }
                        return l;
                    });
                }
            }

            return updated;
        });
    };

    /* ================================================================
       STEP 3: ENRIQUECIMENTO XML (Opcional)
       ================================================================ */

    const onDropXml = useCallback(async (accepted: File[]) => {
        if (accepted.length === 0) return;
        setXmlProcessing(true);

        try {
            const zip = new JSZip();
            const contents = await zip.loadAsync(accepted[0]);
            const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });

            const xmlMap = new Map<string, { numero: string; irrf: number }>();

            const findTag = (obj: any, tag: string): any => {
                if (!obj || typeof obj !== "object") return undefined;
                for (const k in obj) {
                    if (k.toLowerCase() === tag.toLowerCase()) return obj[k];
                }
                for (const k in obj) {
                    const res = findTag(obj[k], tag);
                    if (res !== undefined) return res;
                }
                return undefined;
            };

            for (const fname of Object.keys(contents.files)) {
                if (!fname.toLowerCase().endsWith(".xml")) continue;
                const xmlText = await contents.files[fname].async("text");
                const jsonObj = parser.parse(xmlText);

                const infNfse = findTag(jsonObj, "InfNfse");
                const ctx = infNfse || jsonObj;

                const tomador = findTag(ctx, "TomadorServico") || findTag(ctx, "Tomador") || findTag(ctx, "IdentificacaoTomador");
                const cnpjRaw = tomador ? (findTag(tomador, "Cnpj") || findTag(tomador, "Cpf") || findTag(tomador, "CPFCNPJ")) : undefined;
                const numero = findTag(ctx, "Numero");
                const valorIR = findTag(ctx, "ValorIr") || 0;

                if (cnpjRaw) {
                    const cleanCnpj = String(cnpjRaw).replace(/\D/g, "");
                    xmlMap.set(cleanCnpj, {
                        numero: String(numero || "S/N"),
                        irrf: Number(parseFloat(String(valorIR)).toFixed(2)) || 0,
                    });
                }
            }

            // Enriquecer lançamentos
            setLancamentos(prev => prev.map(l => {
                if (!l.cnpj) return l;
                const xmlData = xmlMap.get(l.cnpj);
                if (!xmlData) return l;
                return { ...l, numeroNFGerada: xmlData.numero, irrf: xmlData.irrf };
            }));

            setXmlLoaded(true);
            console.log(`[LP] XMLs processados: ${xmlMap.size} CNPJs encontrados`);
        } catch (err) {
            console.error("Erro processando ZIP:", err);
        } finally {
            setXmlProcessing(false);
        }
    }, []);

    const dzXml = useDropzone({
        onDrop: onDropXml,
        accept: { "application/zip": [".zip"] },
        multiple: false,
    });

    /* ================================================================
       IMPORTAR NFS-e NO STEP 5 (sem sair do preview)
       Reutiliza o mesmo parser do Step 3 (onDropXml):
       - Abre um ZIP com XMLs de retorno das NFS-e emitidas
       - Para cada XML: extrai CNPJ do tomador + número da NF
       - Cruza com lançamentos pelo CNPJ → preenche numeroNFGerada
       ================================================================ */
    const importarNFSeFromZip = useCallback(async (file: File) => {
        setImportandoNFSe(true);
        setNfseImportLog(null);

        // Normaliza CNPJ para 14 dígitos com zeros à esquerda
        const normCnpj = (raw: unknown): string =>
            String(raw ?? "").replace(/\D/g, "").padStart(14, "0").slice(-14);

        try {
            const zip = new JSZip();
            const contents = await zip.loadAsync(file);
            const allNames = Object.keys(contents.files);

            const parser = new XMLParser({
                ignoreAttributes: false,
                parseTagValue: false,
                removeNSPrefix: true,
            });

            const xmlMap = new Map<string, { numero: string; irrf: number }>();
            let xmlFilesFound = 0;

            const findTag = (obj: any, tag: string): any => {
                if (!obj || typeof obj !== "object") return undefined;
                for (const k in obj) {
                    const cleanK = k.split(':').pop() || k;
                    if (cleanK.toLowerCase() === tag.toLowerCase()) return obj[k];
                }
                for (const k in obj) {
                    const res = findTag(obj[k], tag);
                    if (res !== undefined) return res;
                }
                return undefined;
            };

            for (const fname of allNames) {
                if (contents.files[fname].dir) continue;
                if (!fname.toLowerCase().endsWith(".xml")) continue;
                xmlFilesFound++;

                const xmlText = await contents.files[fname].async("text");
                const cleanXmlText = xmlText.replace(/<([a-zA-Z0-9_]+:)/g, "<").replace(/<\/([a-zA-Z0-9_]+:)/g, "</");
                const jsonObj = parser.parse(cleanXmlText);

                const infNfse = findTag(jsonObj, "InfNfse");
                const ctx = infNfse || jsonObj;

                const tomador =
                    findTag(ctx, "TomadorServico") ||
                    findTag(ctx, "Tomador") ||
                    findTag(ctx, "IdentificacaoTomador") ||
                    findTag(ctx, "DadosTomador") ||
                    findTag(ctx, "toma");

                const prestador = 
                    findTag(ctx, "PrestadorServico") || 
                    findTag(ctx, "Prestador") ||
                    findTag(ctx, "prest");

                const cnpjRawTomador = tomador
                    ? (findTag(tomador, "Cnpj") ?? findTag(tomador, "Cpf") ?? findTag(tomador, "CPFCNPJ"))
                    : undefined;
                    
                const cnpjPrestador = prestador
                    ? normCnpj(findTag(prestador, "Cnpj") ?? findTag(prestador, "Cpf") ?? "")
                    : "";

                // Usa CNPJ do tomador; se não encontrado, fallback raiz (mas nunca usa o do prestador)
                const cnpjRawFallback = findTag(ctx, "CpfCnpj") ?? findTag(ctx, "Cnpj");
                const cnpjRaw = cnpjRawTomador ?? (cnpjRawFallback && normCnpj(cnpjRawFallback) !== cnpjPrestador ? cnpjRawFallback : undefined);

                // Número da NF: tenta tags do XML; se não encontrar, extrai do nome do arquivo
                // Padrão do arquivo: {cnpj_prestador}-{ano}-{mes}-{numero}-nfse.xml
                const filenameOnly = fname.split("/").pop() || fname;
                const filenameNumMatch = filenameOnly.match(/^\d+-\d{4}-\d{2}-(\d+)-nfse\.xml$/i);
                const numeroFromFilename = filenameNumMatch ? String(parseInt(filenameNumMatch[1], 10)) : undefined;

                const numero =
                    findTag(ctx, "Numero") ??
                    findTag(ctx, "NumeroNfse") ??
                    findTag(ctx, "NumNfse") ??
                    findTag(ctx, "NumeroDaNfse") ??
                    findTag(ctx, "nNFSe") ??
                    numeroFromFilename;
                const valorIR = findTag(ctx, "ValorIr") ?? findTag(ctx, "ValorRetencaoIr") ?? findTag(ctx, "vIRRF") ?? 0;

                const cnpjNorm = normCnpj(cnpjRaw);
                console.log(`[LP NFSe XML] ${fname.split("/").pop()} → cnpjRaw=${cnpjRaw} norm=${cnpjNorm} numero=${numero}`);

                if (cnpjNorm.replace(/^0+/, "") && numero) {
                    if (!xmlMap.has(cnpjNorm)) {
                        xmlMap.set(cnpjNorm, {
                            numero: String(numero),
                            irrf: Number(parseFloat(String(valorIR)).toFixed(2)) || 0,
                        });
                    }
                }
            }

            console.log("[LP NFSe] XMLs encontrados:", xmlFilesFound, "| CNPJs extraídos:", xmlMap.size);

            /* ── FASE 2: PDF OCR — fallback ───────────────────────── */
            const pdfNames = allNames.filter(n =>
                !contents.files[n].dir && n.toLowerCase().endsWith(".pdf")
            );
            const pdfMap = new Map<string, { numero: string }>();

            console.log("[LP NFSe] PDFs encontrados:", pdfNames.length);

            for (const fname of pdfNames) {
                try {
                    const arrayBuffer = await contents.files[fname].async("arraybuffer");
                    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                    const pdfDoc = await loadingTask.promise;
                    let fullText = "";

                    for (let p = 1; p <= pdfDoc.numPages; p++) {
                        const page = await pdfDoc.getPage(p);
                        const tc = await page.getTextContent();
                        fullText += tc.items.map((item: any) => item.str).join(" ") + " ";
                    }

                    // Extrair CNPJ do Tomador — prioriza label TOMADOR
                    let cnpjPDF = "";
                    const tomadorMatch = fullText.match(
                        /TOMADOR[\s\S]{0,200}?([0-9]{2}[.\s]?[0-9]{3}[.\s]?[0-9]{3}[/\/][0-9]{4}-[0-9]{2})/i
                    );
                    if (tomadorMatch) {
                        cnpjPDF = normCnpj(tomadorMatch[1]);
                    } else {
                        const allCnpjs = fullText.match(/[0-9]{2}[.\s]?[0-9]{3}[.\s]?[0-9]{3}[/\/][0-9]{4}-[0-9]{2}/g);
                        console.log(`[LP NFSe PDF] ${fname.split("/").pop()} CNPJs encontrados:`, allCnpjs);
                        if (allCnpjs && allCnpjs.length >= 2) {
                            cnpjPDF = normCnpj(allCnpjs[1]);
                        } else if (allCnpjs && allCnpjs.length === 1) {
                            cnpjPDF = normCnpj(allCnpjs[0]);
                        }
                    }

                    // Extrair Número da NFS-e
                    let numeroPDF = "";
                    const nfseMatch =
                        fullText.match(/N[uú]mero\s+da\s+NFS-e[\s:]*(\d+)/i) ||
                        fullText.match(/NFS-e\s*[Nn][º°oa]?\s*[:\-]?\s*(\d+)/i) ||
                        fullText.match(/Nota\s+Fiscal\s+de\s+Servi[cç]o.*?n[º°]?\s*(\d+)/i) ||
                        fullText.match(/\bN[º°]\s+(\d{3,})/i);
                    if (nfseMatch) numeroPDF = nfseMatch[1];

                    console.log(`[LP NFSe PDF] ${fname.split("/").pop()} → cnpj=${cnpjPDF} numero=${numeroPDF}`);

                    if (cnpjPDF && numeroPDF && !xmlMap.has(cnpjPDF)) {
                        pdfMap.set(cnpjPDF, { numero: numeroPDF });
                    }
                } catch (pdfErr) {
                    console.warn("[LP NFSe] Erro OCR PDF:", fname, pdfErr);
                }
            }

            /* ── FASE 3: Cruzamento ───────────────────────────────── */
            // Lê estado atual para calcular contadores fora do setter
            // (evita closure stale com variáveis locais dentro de setLancamentos)
            let porXml = 0;
            let porPdf = 0;
            let semMatch = 0;

            // Log da tabela de cruzamento para diagnóstico
            console.log("[LP NFSe] xmlMap keys:", [...xmlMap.keys()]);
            console.log("[LP NFSe] pdfMap keys:", [...pdfMap.keys()]);

            setLancamentos(prev => {
                const updated = prev.map(l => {
                    const cnpjLanc = normCnpj(l.cnpj);
                    if (!cnpjLanc.replace(/^0+/, "")) { semMatch++; return l; }

                    console.log(`[LP NFSe] Cruzando lanç. cnpj=${cnpjLanc}...`);

                    const xmlData = xmlMap.get(cnpjLanc);
                    if (xmlData) {
                        porXml++;
                        return { ...l, numeroNFGerada: xmlData.numero, irrf: xmlData.irrf };
                    }

                    const pdfData = pdfMap.get(cnpjLanc);
                    if (pdfData) {
                        porPdf++;
                        return { ...l, numeroNFGerada: pdfData.numero };
                    }

                    semMatch++;
                    return l;
                });

                // Atualiza log APÓS o map (dentro do setter para ter os valores finais)
                const parts: string[] = [];
                if (porXml > 0) parts.push(`${porXml} via XML`);
                if (porPdf > 0) parts.push(`${porPdf} via PDF (OCR)`);
                const total = porXml + porPdf;

                setTimeout(() => {
                    setNfseImportLog(
                        total > 0
                            ? `✅ ${total} preenchidos — ${parts.join(", ")}${semMatch > 0 ? ` • ${semMatch} sem correspondência` : ""}`
                            : `⚠️ Nenhum cruzamento — ${xmlFilesFound} XMLs (${xmlMap.size} CNPJs) e ${pdfNames.length} PDFs (${pdfMap.size} CNPJs) lidos. Verifique o console (F12) para detalhes.`
                    );
                }, 0);

                return updated;
            });

        } catch (err) {
            console.error("[LP] Erro importação NFS-e:", err);
            setNfseImportLog(`❌ Erro ao processar ZIP: ${err instanceof Error ? err.message : "desconhecido"}`);
        } finally {
            setImportandoNFSe(false);
            if (nfseInputRef.current) nfseInputRef.current.value = "";
        }
    }, []);

    /* ================================================================
       STEP 4: EXPORTAÇÃO NFE.io
       ================================================================ */

    const handleExportarNFE = async () => {
        const nfItems = lancamentos.filter(l => l.tipo === "NF" && l.lojaIdentificadaId);
        if (nfItems.length === 0) {
            alert("Nenhum lançamento NF com loja identificada para exportar.");
            return;
        }

        setExportando(true);
        try {
            const response = await fetch("/api/lancamentos-parciais/exportar-nfe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items: nfItems }),
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || `Erro ${response.status}`);
            }

            // Download do XLSX
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `nfe_lancamentos_parciais_${new Date().toISOString().slice(0, 10)}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err: unknown) {
            alert(`Erro ao exportar: ${err instanceof Error ? err.message : "desconhecido"}`);
        } finally {
            setExportando(false);
        }
    };

    /* --- Emissão NC via GCP --- */
    const handleEmitirNC = async () => {
        const ncItems = lancamentos.filter(l => l.tipo === "NC" && l.lojaIdentificadaId && l.cnpj);
        if (ncItems.length === 0) {
            alert("Nenhum lançamento NC com loja e CNPJ identificados.");
            return;
        }

        // Agrupar por loja+cnpj para não duplicar disparos
        const agrupado = new Map<string, {
            loja: string; cnpj: string; pedidos: string[];
            totalValor: number; descricoes: string[];
            listaItens: LancamentoParcial[];
        }>();

        for (const l of ncItems) {
            const key = `${l.cnpj}_${l.lojaIdentificadaId}`;
            const existing = agrupado.get(key);
            if (existing) {
                existing.totalValor += l.valor;
                existing.listaItens.push(l);
            } else {
                agrupado.set(key, {
                    loja: l.nomeContaAzulMatch || l.razaoSocialMatch || l.lojaNomeSugerido || "Desconhecido",
                    cnpj: l.cnpj || "",
                    pedidos: [],
                    totalValor: l.valor,
                    descricoes: [],
                    listaItens: [l],
                });
            }
        }

        const items = Array.from(agrupado.values()).map(g => {
            const descricoes = g.listaItens.map(item => {
                const nf = item.numeroNFGerada || "A Gerar";
                const ped = item.pedido || "S/N";
                return `${nf} - Nº do pedido: ${ped}`;
            });

            return {
                loja: g.loja,
                cnpj: g.cnpj,
                estado: "",
                valorBoleto: 0,
                valorNF: 0,
                valorNC: g.totalValor,
                descricaoServico: descricoes.join("; "),
            };
        });

        try {
            const res = await fetch("/api/notas-credito/emitir", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    items,
                    nomePasta: nomePastaGCP || "Notas_Credito",
                    // Passa o ID da pasta-raiz dos lançamentos parciais para o GCP
                    // salvar as NCs na mesma estrutura Ano/Mês/Cliente que as NFS-e
                    driveFolderId: process.env.NEXT_PUBLIC_DRIVE_ROOT_PARCIAIS
                        || "1JE_1P8vP3JhtBcildWFEoKay3sMXV7YL",
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            alert(`NC disparadas: ${json.enviados || 0} enviadas, ${json.erros || 0} erros.`);
        } catch (err: unknown) {
            alert(`Erro ao emitir NC: ${err instanceof Error ? err.message : "desconhecido"}`);
        }
    };

    const handleReset = () => {
        setStep("upload");
        setLancamentos([]);
        setErrosParsing([]);
        setFileName("");
        setClientes([]);
        setXmlLoaded(false);
        setUploadLogs([]);
        setSearchTerm("");
        setNfUploadLogs([]);
    };

    /* ================================================================
       STEP 5: ENVIAR NFs AO DRIVE
       ================================================================
       Processa ZIP contendo PDFs ou XMLs de NF.
       Cruza pelo CNPJ extraido do nome do arquivo ou OCR/XML.
       Salva em Drive: [Root] / [Ano] / [Mês] / [NomeCliente] / arquivo
    ================================================================ */
    const handleEnviarNFs = useCallback(async (file: File) => {
        setEnviandoNFs(true);
        setNfUploadLogs([]);

        const normCnpj = (raw: unknown): string =>
            String(raw ?? "").replace(/\D/g, "").padStart(14, "0").slice(-14);

        // Constroi mapa CNPJ -> lancamento para cruzamento (XMLs)
        const cnpjToLanc = new Map<string, LancamentoParcial>();
        for (const l of lancamentos) {
            if (l.cnpj) cnpjToLanc.set(normCnpj(l.cnpj), l);
        }

        // Constroi mapa número NF -> lancamento para cruzamento (PDFs)
        const nfToLanc = new Map<string, LancamentoParcial>();
        for (const l of lancamentos) {
            if (l.numeroNFGerada) {
                // Normaliza: remove zeros à esquerda para comparar "00001126" com "1126"
                const nfNorm = l.numeroNFGerada.replace(/^0+/, '');
                nfToLanc.set(nfNorm, l);
            }
        }

        // DEBUG: mostra todos os CNPJs e NFs no mapa
        console.log(`[LP EnviarNF] ═══ MAPA DE CNPJ DOS LANÇAMENTOS (${cnpjToLanc.size} entradas) ═══`);
        cnpjToLanc.forEach((lanc, cnpj) => {
            console.log(`  ${cnpj} → ${lanc.nomeContaAzulMatch || lanc.razaoSocialMatch || lanc.lojaNomeSugerido || '?'} (raw: "${lanc.cnpj}")`);
        });
        console.log(`[LP EnviarNF] ═══ MAPA DE NF DOS LANÇAMENTOS (${nfToLanc.size} entradas) ═══`);
        nfToLanc.forEach((lanc, nf) => {
            console.log(`  NF ${nf} → ${lanc.nomeContaAzulMatch || lanc.razaoSocialMatch || lanc.lojaNomeSugerido || '?'}`);
        });

        try {
            const zip = new JSZip();
            const contents = await zip.loadAsync(file);
            const allNames = Object.keys(contents.files).filter(n => !contents.files[n].dir);

            // Inicializa logs
            setNfUploadLogs(allNames.map(n => ({ nome: n.split("/").pop() || n, status: 'aguardando', msg: 'Na fila...' })));

            for (let i = 0; i < allNames.length; i++) {
                const fname = allNames[i];
                const shortName = fname.split("/").pop() || fname;
                const ext = shortName.toLowerCase().split('.').pop() || '';

                if (!['pdf', 'xml'].includes(ext)) {
                    setNfUploadLogs(prev => prev.map((l, idx) => idx === i ? { ...l, status: 'erro', msg: 'Tipo não suportado' } : l));
                    continue;
                }

                setNfUploadLogs(prev => prev.map((l, idx) => idx === i ? { ...l, status: 'enviando', msg: 'Identificando...' } : l));

                let cnpjFile = "";
                let lancMatch: LancamentoParcial | undefined;

                if (ext === 'xml') {
                    // Parse XML para pegar CNPJ do TOMADOR (não do prestador)
                    try {
                        const xmlText = await contents.files[fname].async("text");
                        // Remove prefixos de namespace para simplificar busca
                        const cleanXml = xmlText.replace(/<([a-zA-Z0-9_]+:)/g, "<").replace(/<\/([a-zA-Z0-9_]+:)/g, "</");
                        const xmlParser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, removeNSPrefix: true });
                        const jsonObj = xmlParser.parse(cleanXml);

                        // Busca recursiva por tag
                        const findTag = (obj: any, tag: string): any => {
                            if (!obj || typeof obj !== "object") return undefined;
                            for (const k in obj) {
                                const cleanK = (k.split(':').pop() || k).toLowerCase();
                                if (cleanK === tag.toLowerCase()) return obj[k];
                            }
                            for (const k in obj) {
                                const res = findTag(obj[k], tag);
                                if (res !== undefined) return res;
                            }
                            return undefined;
                        };

                        // DEBUG: mostra as top-level keys do JSON parseado
                        console.log(`[LP EnviarNF XML] ─── ${shortName} ───`);
                        console.log(`[LP EnviarNF XML] Top-level keys:`, Object.keys(jsonObj));

                        // Busca o bloco do tomador (toma / TomadorServico / Tomador)
                        const tomador = findTag(jsonObj, "toma") || findTag(jsonObj, "TomadorServico") || findTag(jsonObj, "Tomador");
                        console.log(`[LP EnviarNF XML] Bloco tomador encontrado:`, tomador ? JSON.stringify(tomador).slice(0, 300) : 'NÃO ENCONTRADO');

                        // DEBUG: mostra também emit/prest
                        const prestDebug = findTag(jsonObj, "prest") || findTag(jsonObj, "emit");
                        if (prestDebug) {
                            const cnpjPrestDebug = findTag(prestDebug, "Cnpj") ?? findTag(prestDebug, "CNPJ");
                            console.log(`[LP EnviarNF XML] CNPJ prestador (prest/emit): ${cnpjPrestDebug}`);
                        }

                        const cnpjTomador = tomador ? (findTag(tomador, "Cnpj") ?? findTag(tomador, "CNPJ") ?? findTag(tomador, "Cpf")) : undefined;
                        console.log(`[LP EnviarNF XML] CNPJ tomador raw: "${cnpjTomador}" → normalizado: "${cnpjTomador ? normCnpj(cnpjTomador) : 'N/A'}"`);

                        if (cnpjTomador) {
                            cnpjFile = normCnpj(cnpjTomador);
                            lancMatch = cnpjToLanc.get(cnpjFile);
                            console.log(`[LP EnviarNF XML] ${shortName} → CNPJ tomador: ${cnpjFile} | Match: ${lancMatch ? '✅' : '❌'}`);
                        } else {
                            // Fallback: pega todos os CNPJs, exclui o do prestador (emit/prest)
                            const prestador = findTag(jsonObj, "prest") || findTag(jsonObj, "emit") || findTag(jsonObj, "PrestadorServico");
                            const cnpjPrest = prestador ? normCnpj(findTag(prestador, "Cnpj") ?? findTag(prestador, "CNPJ") ?? "") : "";
                            console.log(`[LP EnviarNF XML] Tomador não encontrado. Fallback excluindo prestador: ${cnpjPrest}`);

                            const allCnpjs = cleanXml.match(/<CNPJ>(\d+)<\/CNPJ>/gi);
                            console.log(`[LP EnviarNF XML] Todos os CNPJs no XML:`, allCnpjs?.map(t => t.replace(/<\/?CNPJ>/gi, "")));
                            if (allCnpjs) {
                                for (const tag of allCnpjs) {
                                    const digits = tag.replace(/<\/?CNPJ>/gi, "");
                                    const norm = normCnpj(digits);
                                    if (norm !== cnpjPrest) {
                                        cnpjFile = norm;
                                        lancMatch = cnpjToLanc.get(cnpjFile);
                                        console.log(`[LP EnviarNF XML] ${shortName} → CNPJ fallback: ${cnpjFile} | Match: ${lancMatch ? '✅' : '❌'}`);
                                        break;
                                    }
                                }
                            }
                        }
                    } catch (xmlErr) {
                        console.warn(`[LP EnviarNF] Erro parsing XML ${shortName}:`, xmlErr);
                    }
                }

                // PDFs: extrai número da NF do nome do arquivo e cruza com lançamentos
                // Padrão: {CNPJ_prestador}-{ano}-{mes}-{numero_nf}-nfse.pdf
                // Ex: 48999300000152-2026-06-00001126-nfse.pdf → NF 1126
                if (!lancMatch && (ext === 'pdf' || !cnpjFile)) {
                    const nfMatch = shortName.match(/\d{14}-\d{4}-\d{2}-(\d+)-nfse/i);
                    if (nfMatch) {
                        const numNF = nfMatch[1].replace(/^0+/, ''); // "00001126" → "1126"
                        lancMatch = nfToLanc.get(numNF);
                        console.log(`[LP EnviarNF PDF] ${shortName} → NF extraída: ${numNF} | Match no mapa NF: ${lancMatch ? '✅ ' + (lancMatch.nomeContaAzulMatch || lancMatch.razaoSocialMatch) : '❌ NÃO'}`);
                    } else {
                        console.log(`[LP EnviarNF PDF] ${shortName} → Não conseguiu extrair número NF do nome`);
                    }
                }

                // Resultado final do cruzamento
                if (!lancMatch && cnpjFile) {
                    lancMatch = cnpjToLanc.get(cnpjFile);
                }

                console.log(`[LP EnviarNF] ${shortName} → Resultado final: ${lancMatch ? '✅ MATCH → ' + (lancMatch.nomeContaAzulMatch || lancMatch.razaoSocialMatch) : '❌ SEM MATCH (CNPJ=' + cnpjFile + ')'}`);

                if (!lancMatch) {
                    const motivo = ext === 'pdf'
                        ? `NF não encontrada nos lançamentos (verifique se o número da NF foi preenchido)`
                        : `CNPJ ${cnpjFile || 'não identificado'} não encontrado nos lançamentos`;
                    setNfUploadLogs(prev => prev.map((l, idx) => idx === i
                        ? { ...l, status: 'erro', msg: motivo }
                        : l
                    ));
                    continue;
                }

                const nomeCliente = lancMatch.nomeContaAzulMatch || lancMatch.razaoSocialMatch || lancMatch.lojaNomeSugerido || "Indefinido";
                // Usa data ATUAL para organização das pastas (igual ao faturamento principal em drive/upload)
                const now = new Date();
                const dataCompetencia = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                const mimeType = ext === 'xml' ? 'application/xml' : 'application/pdf';

                setNfUploadLogs(prev => prev.map((l, idx) => idx === i ? { ...l, status: 'enviando', msg: `Enviando para ${nomeCliente}...` } : l));

                try {
                    const fileBase64 = await contents.files[fname].async("base64");
                    const res = await fetch('/api/lancamentos-parciais/upload-nf-drive', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            fileBase64, fileName: shortName, nomeCliente, dataCompetencia, mimeType,
                            nomePasta: nomePastaGCP || 'Lancamentos_Parciais',
                        }),
                    });
                    const json = await res.json();
                    if (json.success) {
                        setNfUploadLogs(prev => prev.map((l, idx) => idx === i
                            ? { ...l, status: 'ok', msg: `✅ Salvo em ${json.path}` }
                            : l
                        ));
                    } else {
                        setNfUploadLogs(prev => prev.map((l, idx) => idx === i
                            ? { ...l, status: 'erro', msg: `❌ ${json.error}` }
                            : l
                        ));
                    }
                } catch (uploadErr: any) {
                    setNfUploadLogs(prev => prev.map((l, idx) => idx === i
                        ? { ...l, status: 'erro', msg: `❌ Erro de rede: ${uploadErr.message}` }
                        : l
                    ));
                }
            }
        } catch (err: any) {
            console.error('[LP] Erro ao processar ZIP de NFs:', err);
            alert(`Erro ao processar ZIP: ${err.message}`);
        } finally {
            setEnviandoNFs(false);
            if (nfInputRef.current) nfInputRef.current.value = "";
        }
    }, [lancamentos]);

    const uploadToDrive = async (fileBase64: string, fileName: string, lanc: LancamentoParcial) => {
        try {
            const clienteNome = lanc.nomeContaAzulMatch || lanc.razaoSocialMatch || lanc.lojaNomeSugerido || "Indefinido";
            const res = await fetch('/api/lancamentos-parciais/upload-nfs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileBase64,
                    fileName,
                    nomeCliente: clienteNome,
                    nomePasta: nomePastaGCP || 'Lancamentos_Parciais',
                })
            });
            return await res.json();
        } catch (e) {
            return { success: false, error: String(e) };
        }
    };

    const onDropZip = useCallback(async (acceptedFiles: File[]) => {
        if (acceptedFiles.length === 0) return;
        const file = acceptedFiles[0];
        setZipProcessing(true);
        setUploadLogs([]);

        try {
            const zip = await JSZip.loadAsync(file);
            const pdfFiles = Object.values(zip.files).filter(f => !f.dir && f.name.toLowerCase().endsWith('.pdf'));

            if (pdfFiles.length === 0) {
                alert("Nenhum PDF encontrado no ZIP.");
                setZipProcessing(false);
                return;
            }

            const initialLogs = pdfFiles.map(f => ({
                nomeArquivo: f.name.split('/').pop() || f.name,
                status: 'pendente' as const,
                mensagem: 'Aguardando matching...'
            }));
            setUploadLogs(initialLogs);

            for (let i = 0; i < pdfFiles.length; i++) {
                const pdf = pdfFiles[i];
                const fileName = pdf.name.split('/').pop() || pdf.name;
                const cleanName = fileName.replace(/\.pdf$/i, "").toUpperCase();
                
                // OCR: Read PDF content to extract CNPJ and NF Number for robust matching
                let pdfCnpj = "";
                let pdfNf = "";
                try {
                    const arrayBuffer = await pdf.async("arraybuffer");
                    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                    const pdfDoc = await loadingTask.promise;
                    let fullText = "";

                    for (let p = 1; p <= pdfDoc.numPages; p++) {
                        const page = await pdfDoc.getPage(p);
                        const textContent = await page.getTextContent();
                        const pageText = textContent.items.map((item: any) => item.str).join(" ");
                        fullText += pageText + " ";
                    }

                    // 1. Extrair CNPJ do Tomador
                    const cnpjMatch = fullText.match(/TOMADOR[\s\S]*?([0-9]{2}\.[0-9]{3}\.[0-9]{3}\/[0-9]{4}-[0-9]{2})/i);
                    if (cnpjMatch) {
                        pdfCnpj = cnpjMatch[1].replace(/\D/g, '').replace(/^0+/, '');
                    } else {
                        // Backup genérico para CNPJ se TOMADOR não for achado nitidamente
                        const genericCnpj = fullText.match(/([0-9]{2}\.[0-9]{3}\.[0-9]{3}\/[0-9]{4}-[0-9]{2})/g);
                        if (genericCnpj && genericCnpj.length > 1) {
                            pdfCnpj = genericCnpj[1].replace(/\D/g, '').replace(/^0+/, ''); // Geralmente o segundo CNPJ é o tomador
                        }
                    }

                    // 2. Extrair Número NF
                    const nfRegex = /Número da NFS-e[\s\S]*?(\d+)/i;
                    const nfMatch = fullText.match(nfRegex);
                    if (nfMatch) pdfNf = nfMatch[1];
                } catch (err) {
                    console.error("Erro no OCR do PDF:", fileName, err);
                }

                const matchedLanc = lancamentos.find(l => {
                    const lCnpj = l.cnpj ? l.cnpj.replace(/\D/g, '').replace(/^0+/, '') : "";
                    const nfNum = l.numeroNFGerada?.toUpperCase();
                    const pedNum = l.pedido.toUpperCase();
                    
                    // Condição 1: CNPJ extraído do PDF bate com o CNPJ da linha (Match Forte)
                    if (pdfCnpj && lCnpj && pdfCnpj === lCnpj) return true;

                    // Condição 2: Nome do arquivo ou OCR contêm a NF (Match XML)
                    if (nfNum && (cleanName.includes(nfNum) || pdfNf.includes(nfNum))) return true;

                    // Condição 3: Nome do arquivo contém o número do pedido ou ID
                    return cleanName.includes(pedNum) || cleanName === l.id.toUpperCase();
                });

                if (matchedLanc) {
                    setUploadLogs(prev => prev.map((log, idx) => idx === i ? { ...log, status: 'pendente', mensagem: 'Enviando ao Drive...' } : log));
                    const content = await pdf.async("base64");
                    const res = await uploadToDrive(content, fileName, matchedLanc);
                    if (res.success) {
                        setUploadLogs(prev => prev.map((log, idx) => idx === i ? { ...log, status: 'sucesso', mensagem: 'Sincronizado' } : log));
                    } else {
                        setUploadLogs(prev => prev.map((log, idx) => idx === i ? { ...log, status: 'erro', mensagem: res.error } : log));
                    }
                } else {
                    setUploadLogs(prev => prev.map((log, idx) => idx === i ? { ...log, status: 'erro', mensagem: 'Não encontrado na tabela' } : log));
                }
            }
        } catch (err) {
            console.error("Erro ZIP:", err);
            alert("Erro ao processar ZIP.");
        } finally {
            setZipProcessing(false);
        }
    }, [lancamentos]);

    const dzZip = useDropzone({
        onDrop: onDropZip,
        accept: { 'application/zip': ['.zip'] },
        multiple: false
    });

    /* ================================================================
       FILTERED DATA
       ================================================================ */
    const filteredLancamentos = useMemo(() => {
        if (!searchTerm) return lancamentos;
        const term = searchTerm.toLowerCase();
        return lancamentos.filter(l =>
            l.pedido.toLowerCase().includes(term) ||
            l.descricao.toLowerCase().includes(term) ||
            (l.lojaNomeSugerido || "").toLowerCase().includes(term) ||
            (l.razaoSocialMatch || "").toLowerCase().includes(term) ||
            (l.cnpj || "").includes(term)
        );
    }, [lancamentos, searchTerm]);

    /* Clientes pré-filtrados pela razão social / empresa */
    const clientesPreFiltrados = useMemo(() => {
        if (!preFilterEmpresa) return clientes;
        const term = preFilterEmpresa.toLowerCase().trim();
        return clientes.filter(c =>
            (c.razao_social || "").toLowerCase().includes(term) ||
            (c.nome_fantasia || "").toLowerCase().includes(term) ||
            (c.nome_conta_azul || "").toLowerCase().includes(term)
        );
    }, [clientes, preFilterEmpresa]);

    /* ================================================================
       RENDER
       ================================================================ */

    const steps: { key: StepLP; label: string; num: number }[] = [
        { key: "upload", label: "Upload", num: 1 },
        { key: "matching", label: "Matching", num: 2 },
        { key: "xml", label: "XML", num: 3 },
        { key: "zip", label: "PDFs", num: 4 },
        { key: "preview", label: "Finalizar", num: 5 },
    ];

    const canGoToXml = step === "matching" && lancamentos.length > 0;
    const canGoToPreview = (step === "xml" || step === "matching" || step === "zip") && lancamentos.length > 0;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>

            {/* ── STEPPER ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {steps.map((s, i) => (
                    <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                            onClick={() => {
                                if (s.key === "upload") return;
                                if (s.key === "matching" && lancamentos.length > 0) setStep("matching");
                                if (s.key === "xml" && canGoToXml) setStep("xml");
                                if (s.key === "zip" && lancamentos.length > 0) setStep("zip");
                                if (s.key === "preview" && canGoToPreview) setStep("preview");
                            }}
                            style={{
                                display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
                                borderRadius: 8, border: "1px solid",
                                borderColor: step === s.key ? "var(--accent)" : "var(--border)",
                                background: step === s.key ? "rgba(129,140,248,0.1)" : "transparent",
                                cursor: "pointer", transition: "all 0.2s"
                            }}
                        >
                            <span style={{
                                width: 22, height: 22, borderRadius: "50%",
                                background: step === s.key ? "var(--accent)" : "var(--border)",
                                color: step === s.key ? "#fff" : "var(--fg-dim)",
                                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700
                            }}>{s.num}</span>
                            <span style={{ fontSize: 13, fontWeight: step === s.key ? 600 : 400, color: step === s.key ? "#fff" : "var(--fg-dim)" }}>{s.label}</span>
                        </button>
                        {i < steps.length - 1 && <ChevronRight size={14} style={{ color: "var(--border-light)" }} />}
                    </div>
                ))}
                {lancamentos.length > 0 && (
                    <button onClick={handleReset} className="btn btn-ghost" style={{ marginLeft: "auto", padding: "8px 14px", fontSize: 12 }}>
                        <RefreshCw size={14} /> Reiniciar
                    </button>
                )}
            </div>

            {/* ── CARDS SUMMARY ── */}
            {lancamentos.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
                    <SumCard label="Total Lançamentos" value={String(lancamentos.length)} icon={<ClipboardList size={18} />} color="var(--accent)" />
                    <SumCard label="NF" value={fmtBRL_LP(totalNF)} icon={<FileText size={18} />} color="var(--warning)" />
                    <SumCard label="NC" value={fmtBRL_LP(totalNC)} icon={<DollarSign size={18} />} color="var(--success)" />
                    <SumCard label="Matched" value={`${matched}/${lancamentos.length}`} icon={<Link2 size={18} />} color={unmatched === 0 ? "var(--success)" : "var(--danger)"} />
                </div>
            )}

            {/* ──────── STEP 1: UPLOAD ──────── */}
            {step === "upload" && (
                <div className="card" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    {/* ALVOS DO MATCHMAKING */}
                    <div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                                <Building2 size={16} style={{ color: "var(--accent)" }} /> Alvos do Matchmaking
                            </h3>
                            <span style={{ fontSize: 11, fontWeight: 600, color: matchingTargets.length > 0 ? "var(--accent)" : "var(--fg-dim)" }}>
                                {matchingTargets.length} razões sociais selecionadas
                            </span>
                        </div>

                        {/* Search Input for Targets */}
                        <div style={{ position: "relative", marginBottom: 12 }}>
                            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--fg-dim)" }} />
                            <input
                                type="text"
                                placeholder="Pesquisar razão social..."
                                value={searchTargetTerm}
                                onChange={e => setSearchTargetTerm(e.target.value)}
                                style={{
                                    width: "100%", padding: "8px 12px 8px 34px", borderRadius: 8, background: "rgba(15,23,42,0.5)",
                                    border: "1px solid var(--border)", fontSize: 12, color: "#fff", outline: "none"
                                }}
                            />
                            {searchTargetTerm && (
                                <button
                                    onClick={() => setSearchTargetTerm("")}
                                    style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--fg-dim)", cursor: "pointer" }}
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        <div style={{
                            display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 120, overflowY: "auto",
                            padding: "12px", background: "rgba(129,140,248,0.03)", borderRadius: 8, border: "1px solid var(--border)"
                        }}>
                            {filteredRazaoSociais.map(name => {
                                const isSelected = matchingTargets.includes(name);
                                return (
                                    <button
                                        key={name}
                                        onClick={() => {
                                            setMatchingTargets(prev =>
                                                isSelected ? prev.filter(n => n !== name) : [...prev, name]
                                            );
                                        }}
                                        style={{
                                            padding: "4px 10px", borderRadius: 16, border: "1px solid", fontSize: 11, fontWeight: 600, cursor: "pointer",
                                            transition: "all 0.2s",
                                            borderColor: isSelected ? "var(--accent)" : "var(--border)",
                                            background: isSelected ? "var(--accent)" : "transparent",
                                            color: isSelected ? "#fff" : "var(--fg-dim)",
                                        }}
                                    >
                                        {name}
                                    </button>
                                );
                            })}
                            {uniqueRazaoSociais.length === 0 && (
                                <p style={{ fontSize: 12, color: "var(--fg-dim)", margin: 0, padding: "4px 8px" }}>Carregando empresas...</p>
                            )}
                            {uniqueRazaoSociais.length > 0 && filteredRazaoSociais.length === 0 && (
                                <p style={{ fontSize: 12, color: "var(--fg-dim)", margin: 0, padding: "4px 8px" }}>Nenhuma razão social encontrada.</p>
                            )}
                        </div>

                        {matchingTargets.length === 0 && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, padding: "6px 10px", background: "rgba(245,158,11,0.05)", borderRadius: 6 }}>
                                <AlertTriangle size={14} style={{ color: "var(--warning)" }} />
                                <span style={{ fontSize: 11, color: "var(--warning)" }}>Nenhuma empresa selecionada: o matchmaking buscará em toda a base de dados.</span>
                            </div>
                        )}
                    </div>

                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 20 }}>
                        <h2 style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 12 }}>Upload da Planilha</h2>
                        <div
                            {...dzUpload.getRootProps()}
                            className={`dropzone ${dzUpload.isDragActive ? "dropzone-active" : ""}`}
                        >
                            <input {...dzUpload.getInputProps()} />
                            {fileName ? (
                                <>
                                    <FileSpreadsheet size={36} style={{ color: "var(--accent)" }} />
                                    <span className="dropzone-filename"><Download size={14} />{fileName}</span>
                                    <p className="dropzone-text" style={{ fontSize: 12 }}>Clique ou arraste para substituir</p>
                                </>
                            ) : (
                                <>
                                    <Upload size={36} className="dropzone-icon" />
                                    <p className="dropzone-text">
                                        Arraste a planilha aqui, ou <strong style={{ color: "var(--accent)" }}>clique para selecionar</strong>
                                    </p>
                                    <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>CSV ou XLSX • Colunas sugeridas: PEDIDO, TIPO, DESCRIÇÃO, VALOR, CNPJ, LOJA</p>
                                </>
                            )}
                        </div>
                        {errosParsing.length > 0 && (
                            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                                {errosParsing.map((e, i) => (
                                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 14px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8 }}>
                                        <AlertTriangle size={16} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }} />
                                        <span style={{ fontSize: 13, color: "var(--danger)" }}>{e}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ──────── STEP 2: MATCHING ──────── */}
            {step === "matching" && (
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)", flexWrap: "wrap", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                            <h2 style={{ fontSize: 16, fontWeight: 600, color: "#fff", margin: 0, whiteSpace: "nowrap" }}>
                                Matching de Lojas
                                {loadingClientes && <Loader2 size={16} style={{ marginLeft: 10, animation: "spin 1s linear infinite", display: "inline" }} />}
                            </h2>
                            {/* PRÉ-FILTRO POR EMPRESA / RAZÃO SOCIAL */}
                            <div style={{ position: "relative" }}>
                                <Building2 size={14} style={{ position: "absolute", left: 10, top: 9, color: preFilterEmpresa ? "var(--accent)" : "var(--fg-dim)" }} />
                                <input
                                    type="text" placeholder="Pré-filtro empresa / razão social…"
                                    value={preFilterEmpresa} onChange={e => setPreFilterEmpresa(e.target.value)}
                                    className="input" style={{
                                        padding: "7px 8px 7px 32px", fontSize: 12, width: 280,
                                        borderColor: preFilterEmpresa ? "var(--accent)" : undefined,
                                        background: preFilterEmpresa ? "rgba(129,140,248,0.06)" : undefined,
                                    }}
                                />
                                {preFilterEmpresa && (
                                    <button onClick={() => setPreFilterEmpresa("")} style={{
                                        position: "absolute", right: 6, top: 7, background: "none", border: "none",
                                        color: "var(--fg-dim)", cursor: "pointer", padding: 2,
                                    }}><X size={14} /></button>
                                )}
                            </div>
                            {preFilterEmpresa && (
                                <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
                                    {clientesPreFiltrados.length} lojas filtradas
                                </span>
                            )}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <div style={{ position: "relative" }}>
                                <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--fg-dim)" }} />
                                <input
                                    type="text" placeholder="Filtrar..."
                                    value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                                    className="input" style={{ padding: "8px 8px 8px 32px", fontSize: 12, width: 200 }}
                                />
                            </div>
                            <button onClick={() => setStep("xml")} className="btn btn-ghost" style={{ padding: "8px 14px", fontSize: 12 }}>
                                Pular para XML <ChevronRight size={14} />
                            </button>
                            <button onClick={() => setStep("preview")} className="btn btn-primary" style={{ padding: "8px 16px", fontSize: 12 }}>
                                Ir para Preview <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                    <div style={{ overflowX: "auto", maxHeight: 600, overflowY: "auto" }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Pedido</th>
                                    <th>Tipo</th>
                                    <th>Descrição</th>
                                    <th>Período</th>
                                    <th style={{ textAlign: "right" }}>Valor</th>
                                    <th>Loja Sugerida</th>
                                    <th>Match</th>
                                    <th>Ação</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredLancamentos.map((l, idx) => (
                                    <tr key={l.id}>
                                        <td style={{ color: "var(--fg-dim)", fontSize: 12 }}>{idx + 1}</td>
                                        <td><EditableCell value={l.pedido} onSave={v => handleFieldChange(l.id, "pedido", v)} mono /></td>
                                        <td>
                                            <select value={l.tipo} onChange={e => handleFieldChange(l.id, "tipo", e.target.value)}
                                                style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: l.tipo === "NF" ? "var(--warning)" : "var(--success)", fontSize: 11, fontWeight: 700, padding: "2px 6px", cursor: "pointer" }}>
                                                <option value="NF">NF</option>
                                                <option value="NC">NC</option>
                                            </select>
                                        </td>
                                        <td style={{ maxWidth: 250 }}>
                                            <EditableCell value={l.descricao} onSave={v => handleFieldChange(l.id, "descricao", v)} maxW={240} />
                                        </td>
                                        <td style={{ fontSize: 11, color: "var(--fg-muted)" }}>
                                            {l.periodo_servico || "—"}
                                        </td>
                                        <td style={{ textAlign: "right" }}>
                                            <EditableCell value={fmtBRL_LP(l.valor)} onSave={v => handleFieldChange(l.id, "valor", v)} align="right" bold />
                                        </td>
                                        <td><EditableCell value={l.lojaNomeSugerido || ""} onSave={v => handleFieldChange(l.id, "lojaNomeSugerido", v)} placeholder="Nome da loja" /></td>
                                        <td>
                                            {l.lojaIdentificadaId ? (
                                                <div style={{ display: "flex", flexDirection: "column" }}>
                                                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--success)", display: "flex", alignItems: "center", gap: 4 }}>
                                                        <CheckCircle2 size={12} /> {l.nomeContaAzulMatch || l.razaoSocialMatch}
                                                    </span>
                                                    {l.cnpj && <span style={{ fontSize: 10, color: "var(--fg-dim)" }}>{formatarCNPJ_LP(l.cnpj)}</span>}
                                                </div>
                                            ) : (
                                                <span style={{ fontSize: 12, color: "var(--danger)", display: "flex", alignItems: "center", gap: 4 }}>
                                                    <Unlink size={12} /> Não encontrado
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            {l.lojaIdentificadaId ? (
                                                <button onClick={() => handleUnmatch(l.id)} title="Desvincular"
                                                    style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 6, padding: "4px 8px", cursor: "pointer", color: "var(--danger)", fontSize: 11 }}>
                                                    <X size={12} />
                                                </button>
                                            ) : (
                                                <ManualMatchSelect
                                                    clientes={clientesPreFiltrados}
                                                    onSelect={(clienteId) => handleManualMatch(l.id, clienteId)}
                                                />
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ──────── STEP 3: XML (Opcional) ──────── */}
            {step === "xml" && (
                <div className="card">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                        <h2 style={{ fontSize: 16, fontWeight: 600, color: "#fff", margin: 0 }}>Enriquecimento via XML (Opcional)</h2>
                        <div style={{ display: "flex", gap: 10 }}>
                            <button onClick={() => setStep("zip")} className="btn btn-primary" style={{ padding: "8px 16px", fontSize: 12 }}>
                                {xmlLoaded ? "Continuar" : "Pular"} para PDFs <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                    <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 16 }}>
                        Faça o upload de um ZIP com os XMLs de retorno das NFs emitidas para preencher automaticamente o número da NF e o IRRF.
                    </p>

                    <div {...dzXml.getRootProps()} className={`dropzone ${dzXml.isDragActive ? "dropzone-active" : ""}`}>
                        <input {...dzXml.getInputProps()} />
                        {xmlProcessing ? (
                            <><Loader2 size={36} className="dropzone-icon" style={{ animation: "spin 1s linear infinite" }} /><p className="dropzone-text">Processando XMLs…</p></>
                        ) : xmlLoaded ? (
                            <><CheckCircle2 size={36} style={{ color: "var(--success)" }} /><p className="dropzone-text" style={{ color: "var(--success)" }}>XMLs processados com sucesso!</p></>
                        ) : (
                            <><FileArchive size={36} className="dropzone-icon" /><p className="dropzone-text">Arraste o ZIP aqui ou <strong style={{ color: "var(--accent)" }}>clique para selecionar</strong></p></>
                        )}
                    </div>
                </div>
            )}

            {/* ──────── STEP 4: ZIP / PDF UPLOAD ──────── */}
            {step === "zip" && (
                <div className="card">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                        <h2 style={{ fontSize: 16, fontWeight: 600, color: "#fff", margin: 0 }}>Upload de PDFs (ZIP)</h2>
                        <button onClick={() => setStep("preview")} className="btn btn-primary" style={{ padding: "8px 16px", fontSize: 12 }}>
                            Continuar para Preview <ChevronRight size={14} />
                        </button>
                    </div>
                    
                    <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 16 }}>
                        Arraste um arquivo .zip contendo os PDFs das faturas. O sistema tentará cruzar o nome do arquivo com o número da NF ou ID do pedido.
                    </p>

                    <div {...dzZip.getRootProps()} className={`dropzone ${dzZip.isDragActive ? "dropzone-active" : ""}`}>
                        <input {...dzZip.getInputProps()} />
                        {zipProcessing ? (
                            <>
                                <Loader2 size={36} className="dropzone-icon" style={{ animation: "spin 1s linear infinite" }} />
                                <p className="dropzone-text">Processando e sincronizando PDFs…</p>
                            </>
                        ) : (
                            <>
                                <FileArchive size={36} className="dropzone-icon" />
                                <p className="dropzone-text">Clique ou arraste o <strong style={{ color: "var(--accent)" }}>ZIP de PDFs</strong> aqui</p>
                            </>
                        )}
                    </div>

                    {uploadLogs.length > 0 && (
                        <div style={{ marginTop: 24 }}>
                            <h3 style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-dim)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Log de Sincronização (Faturamento - Drive)</h3>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto", paddingRight: 4 }}>
                                {uploadLogs.map((log, i) => (
                                    <div key={i} style={{ 
                                        display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", 
                                        background: "rgba(15,23,42,0.3)", borderRadius: 6, border: "1px solid var(--border)"
                                    }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                                            <FileText size={14} style={{ color: "var(--fg-muted)" }} />
                                            <span style={{ fontSize: 12, color: "#fff", fontWeight: 500 }}>{log.nomeArquivo}</span>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <span style={{ 
                                                fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                                                background: log.status === 'sucesso' ? 'rgba(34,197,94,0.1)' : log.status === 'erro' ? 'rgba(239,68,68,0.1)' : 'rgba(129,140,248,0.1)',
                                                color: log.status === 'sucesso' ? 'var(--success)' : log.status === 'erro' ? 'var(--danger)' : 'var(--accent)'
                                            }}>
                                                {log.status.toUpperCase()}
                                            </span>
                                            <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>{log.mensagem}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ──────── STEP 5: PREVIEW & EXPORT ──────── */}
            {step === "preview" && (
                <>
                    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)", flexWrap: "wrap", gap: 12 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                                <h2 style={{ fontSize: 16, fontWeight: 600, color: "#fff", margin: 0 }}>
                                    Preview Consolidado
                                    <span className="badge badge-info" style={{ marginLeft: 10, fontSize: 11 }}>{lancamentos.length} lançamentos</span>
                                </h2>
                                {/* FILTRO DE FLUXO */}
                                <div style={{ display: "flex", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 2 }}>
                                    {(["ALL", "NF", "NC"] as const).map(t => (
                                        <button key={t} onClick={() => setFilterTipo(t)}
                                            style={{
                                                padding: "4px 12px", fontSize: 11, fontWeight: 700, borderRadius: 6, border: "none", cursor: "pointer",
                                                background: filterTipo === t ? "var(--accent)" : "transparent",
                                                color: filterTipo === t ? "#fff" : "var(--fg-dim)",
                                                transition: "all 0.2s"
                                            }}>
                                            {t === "ALL" ? "TODOS" : t}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                <div style={{ position: "relative" }}>
                                    <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--fg-dim)" }} />
                                    <input type="text" placeholder="Filtrar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                                        className="input" style={{ padding: "8px 8px 8px 32px", fontSize: 12, width: 200 }} />
                                </div>
                            </div>
                        </div>

                        {/* FOLDER CONFIG */}
                        <div style={{ padding: "12px 20px", background: "rgba(129,140,248,0.03)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-muted)" }}>Nome da Pasta (GCP):</span>
                            <input
                                type="text"
                                value={nomePastaGCP}
                                onChange={e => setNomePastaGCP(e.target.value)}
                                placeholder="Notas_Credito"
                                className="input"
                                style={{ padding: "6px 12px", fontSize: 12, width: 240 }}
                            />
                            <p style={{ fontSize: 11, color: "var(--fg-dim)", margin: 0 }}>Destino no Google Drive para as NCs.</p>
                        </div>
                        <div style={{ overflowX: "auto", maxHeight: 600, overflowY: "auto" }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Pedido</th>
                                        <th>Tipo</th>
                                        <th>Loja</th>
                                        <th>Período</th>
                                        <th>CNPJ</th>
                                        <th>NF Gerada</th>
                                        <th style={{ textAlign: "right" }}>Valor</th>
                                        <th style={{ textAlign: "right" }}>IRRF</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredLancamentos
                                        .filter(l => filterTipo === "ALL" || l.tipo === filterTipo)
                                        .map((l, idx) => {
                                            const isPendingNF = l.tipo === "NF" && !l.numeroNFGerada;

                                            return (
                                                <tr key={l.id} style={{ background: isPendingNF ? "rgba(245,158,11,0.04)" : undefined }}>
                                                    <td style={{ color: "var(--fg-dim)", fontSize: 12 }}>{idx + 1}</td>
                                                    <td style={{ verticalAlign: "middle" }}>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                            <EditableCell value={l.pedido} onSave={v => handleFieldChange(l.id, "pedido", v)} mono />
                                                            <button onClick={() => { navigator.clipboard.writeText(l.pedido); }} title="Copiar Pedido"
                                                                style={{ background: "none", border: "none", color: "var(--fg-dim)", cursor: "pointer", padding: 2 }}>
                                                                <Copy size={12} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <select value={l.tipo} onChange={e => handleFieldChange(l.id, "tipo", e.target.value)}
                                                            style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: l.tipo === "NF" ? "var(--warning)" : "var(--success)", fontSize: 11, fontWeight: 700, padding: "2px 6px", cursor: "pointer" }}>
                                                            <option value="NF">NF</option>
                                                            <option value="NC">NC</option>
                                                        </select>
                                                    </td>
                                                    <td>
                                                        {l.lojaIdentificadaId ? (
                                                            <span style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{l.nomeContaAzulMatch || l.razaoSocialMatch}</span>
                                                        ) : (
                                                            <EditableCell value={l.lojaNomeSugerido || ""} onSave={v => handleFieldChange(l.id, "lojaNomeSugerido", v)} placeholder="Nome loja" />
                                                        )}
                                                    </td>
                                                    <td style={{ fontSize: 11, color: "var(--fg-dim)" }}>
                                                        {l.periodo_servico || "—"}
                                                    </td>
                                                    <td>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                            <EditableCell value={l.cnpj || ""} onSave={v => handleFieldChange(l.id, "cnpj", v)} mono placeholder="CNPJ" />
                                                            {l.cnpj && (
                                                                <button onClick={() => { navigator.clipboard.writeText(l.cnpj!); }} title="Copiar CNPJ"
                                                                    style={{ background: "none", border: "none", color: "var(--fg-dim)", cursor: "pointer", padding: 2 }}>
                                                                    <Copy size={12} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td><EditableCell value={l.numeroNFGerada || ""} onSave={v => handleFieldChange(l.id, "numeroNFGerada", v)} placeholder="—" bold={isPendingNF} /></td>
                                                    <td style={{ textAlign: "right" }}>
                                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                                                            <EditableCell value={fmtBRL_LP(l.valor)} onSave={v => handleFieldChange(l.id, "valor", v)} align="right" bold />
                                                            <button onClick={() => { navigator.clipboard.writeText(l.valor.toFixed(2).replace(".", ",")); }} title="Copiar Valor"
                                                                style={{ background: "none", border: "none", color: "var(--fg-dim)", cursor: "pointer", padding: 2 }}>
                                                                <Copy size={12} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td style={{ textAlign: "right" }}>
                                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                                                            <EditableCell value={l.irrf ? fmtBRL_LP(l.irrf) : ""} onSave={v => handleFieldChange(l.id, "irrf", v)} align="right" placeholder="—" />
                                                            {l.irrf ? (
                                                                <button onClick={() => { navigator.clipboard.writeText(l.irrf!.toFixed(2).replace(".", ",")); }} title="Copiar IRRF"
                                                                    style={{ background: "none", border: "none", color: "var(--fg-dim)", cursor: "pointer", padding: 2 }}>
                                                                    <Copy size={12} />
                                                                </button>
                                                            ) : null}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* ── ACTION BUTTONS ── */}
                    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        {/* input hidden para o seletor de ZIP com XMLs */}
                        <input
                            ref={nfseInputRef}
                            type="file"
                            accept=".zip"
                            style={{ display: "none" }}
                            onChange={e => {
                                const f = e.target.files?.[0];
                                if (f) importarNFSeFromZip(f);
                            }}
                        />
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                            <div>
                                <p style={{ fontWeight: 600, color: "#fff", margin: 0 }}>Ações de Exportação</p>
                                <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: "4px 0 0" }}>
                                    <strong>{lancamentos.filter(l => l.tipo === "NF" && l.lojaIdentificadaId).length}</strong> NFs prontas para NFE.io
                                    {" • "}
                                    <strong>{lancamentos.filter(l => l.tipo === "NC" && l.lojaIdentificadaId).length}</strong> NCs prontas para GCP
                                </p>
                            </div>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                {/* ── Botão Importar NFS-e ── */}
                                <button
                                    className="btn btn-ghost"
                                    onClick={() => nfseInputRef.current?.click()}
                                    disabled={importandoNFSe}
                                    title="Importar ZIP com XMLs de NFS-e para preencher número e IRRF automaticamente"
                                    style={{ padding: "12px 20px", fontSize: 13, borderColor: "rgba(99,102,241,0.4)" }}
                                >
                                    {importandoNFSe
                                        ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                                        : <FileCode size={16} />}
                                    Importar NFS-e
                                </button>
                                <button className="btn btn-ghost" onClick={handleExportarNFE} disabled={exportando}
                                    style={{ padding: "12px 20px", fontSize: 13 }}>
                                    {exportando ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <FileSpreadsheet size={16} />}
                                    Exportar NFE.io (.xlsx)
                                </button>
                                <button className="btn btn-primary" onClick={handleEmitirNC}
                                    style={{ padding: "12px 20px", fontSize: 13 }}>
                                    <SendHorizonal size={16} />
                                    Emitir NC (GCP)
                                </button>
                            </div>
                        </div>
                        {/* Log de importação NFS-e */}
                        {nfseImportLog && (
                            <div style={{
                                padding: "10px 14px", borderRadius: 8, fontSize: 13,
                                background: nfseImportLog.startsWith("✅") ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                                border: `1px solid ${nfseImportLog.startsWith("✅") ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`,
                                color: nfseImportLog.startsWith("✅") ? "var(--success)" : "var(--danger)",
                                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8
                            }}>
                                <span>{nfseImportLog}</span>
                                <button onClick={() => setNfseImportLog(null)}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 2, opacity: 0.7 }}>
                                    <X size={14} />
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )
            }

            {/* ── CARD: ENVIAR NFs AO DRIVE (step preview) ── */}
            {step === "preview" && lancamentos.length > 0 && (
                <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {/* Input oculto para ZIP de NFs */}
                    <input
                        ref={nfInputRef}
                        type="file"
                        accept=".zip,.pdf,.xml"
                        style={{ display: "none" }}
                        onChange={e => {
                            const f = e.target.files?.[0];
                            if (f) handleEnviarNFs(f);
                        }}
                    />

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                        <div>
                            <p style={{ fontWeight: 600, color: "#fff", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                                <FileText size={16} style={{ color: "var(--warning)" }} />
                                Enviar NFs ao Drive
                            </p>
                            <p style={{ fontSize: 12, color: "var(--fg-muted)", margin: "4px 0 0" }}>
                                Envie um ZIP com PDFs/XMLs de NF. Cada arquivo será alocado na pasta do cliente correspondente (por CNPJ).
                            </p>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {nfUploadLogs.length > 0 && (
                                <button
                                    className="btn btn-ghost"
                                    onClick={() => setNfUploadLogs([])}
                                    style={{ padding: "10px 16px", fontSize: 12 }}
                                >
                                    <X size={14} /> Limpar
                                </button>
                            )}
                            <button
                                className="btn btn-ghost"
                                onClick={() => nfInputRef.current?.click()}
                                disabled={enviandoNFs}
                                style={{ padding: "12px 20px", fontSize: 13, borderColor: "rgba(245,158,11,0.4)" }}
                            >
                                {enviandoNFs
                                    ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                                    : <Upload size={16} />}
                                {enviandoNFs ? "Enviando..." : "Selecionar ZIP de NFs"}
                            </button>
                        </div>
                    </div>

                    {/* Log de envio por arquivo */}
                    {nfUploadLogs.length > 0 && (
                        <div style={{
                            borderRadius: 8, border: "1px solid var(--border)",
                            background: "rgba(0,0,0,0.2)", overflow: "hidden",
                        }}>
                            <div style={{ maxHeight: 260, overflowY: "auto" }}>
                                {nfUploadLogs.map((log, i) => (
                                    <div key={i} style={{
                                        display: "flex", alignItems: "center", gap: 10,
                                        padding: "8px 14px",
                                        borderBottom: i < nfUploadLogs.length - 1 ? "1px solid var(--border)" : "none",
                                        background: log.status === 'ok' ? "rgba(34,197,94,0.04)"
                                            : log.status === 'erro' ? "rgba(239,68,68,0.04)"
                                            : log.status === 'enviando' ? "rgba(129,140,248,0.04)"
                                            : "transparent",
                                    }}>
                                        {log.status === 'ok' && <CheckCircle2 size={13} style={{ color: "var(--success)", flexShrink: 0 }} />}
                                        {log.status === 'erro' && <XCircle size={13} style={{ color: "var(--danger)", flexShrink: 0 }} />}
                                        {log.status === 'enviando' && <Loader2 size={13} style={{ color: "var(--accent)", flexShrink: 0, animation: "spin 1s linear infinite" }} />}
                                        {log.status === 'aguardando' && <AlertTriangle size={13} style={{ color: "var(--fg-dim)", flexShrink: 0 }} />}
                                        <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--fg-dim)", flexShrink: 0, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={log.nome}>
                                            {log.nome}
                                        </span>
                                        <span style={{
                                            fontSize: 11, marginLeft: "auto",
                                            color: log.status === 'ok' ? "var(--success)" : log.status === 'erro' ? "var(--danger)" : "var(--fg-muted)",
                                        }}>
                                            {log.msg}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            {/* Resumo */}
                            <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)", display: "flex", gap: 16, fontSize: 11, color: "var(--fg-dim)" }}>
                                <span style={{ color: "var(--success)" }}>✅ {nfUploadLogs.filter(l => l.status === 'ok').length} enviados</span>
                                <span style={{ color: "var(--danger)" }}>❌ {nfUploadLogs.filter(l => l.status === 'erro').length} erros</span>
                                <span>{nfUploadLogs.filter(l => l.status === 'aguardando').length} na fila</span>
                            </div>
                        </div>
                    )}
                </div>
            )}


            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div >
    );
}

/* ================================================================
   SUBCOMPONENTES
   ================================================================ */

function EditableCell({ value, onSave, mono, bold, align, maxW, placeholder }: {
    value: string; onSave: (v: string) => void;
    mono?: boolean; bold?: boolean; align?: string; maxW?: number; placeholder?: string;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);

    const commit = () => {
        setEditing(false);
        if (draft !== value) onSave(draft);
    };

    if (editing) {
        return (
            <input autoFocus type="text" value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
                style={{
                    background: "rgba(129,140,248,0.08)", border: "1px solid var(--accent)", borderRadius: 4,
                    padding: "3px 6px", fontSize: 12, color: "#fff", width: "100%", maxWidth: maxW,
                    textAlign: (align as any) || "left", fontFamily: mono ? "monospace" : "inherit",
                    fontWeight: bold ? 600 : 400, outline: "none",
                }}
            />
        );
    }

    return (
        <span onClick={() => { setDraft(value); setEditing(true); }}
            title="Clique para editar"
            style={{
                cursor: "pointer", fontSize: 12, padding: "2px 4px", borderRadius: 4,
                display: "inline-block", maxWidth: maxW, overflow: "hidden", textOverflow: "ellipsis",
                whiteSpace: "nowrap", textAlign: (align as any) || "left",
                fontFamily: mono ? "monospace" : "inherit",
                fontWeight: bold ? 600 : 400,
                color: value ? (bold ? "#fff" : "var(--fg-muted)") : "var(--fg-dim)",
                borderBottom: "1px dashed var(--border)",
                fontVariantNumeric: "tabular-nums",
            }}>
            {value || placeholder || "—"}
        </span>
    );
}

function SumCard({ label, value, icon, color }: { label: string; value: string; icon: ReactNode; color: string }) {
    return (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "16px 18px", borderLeft: `3px solid ${color}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color }}>
                {icon}
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
            </div>
            <span style={{ fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px" }}>{value}</span>
        </div>
    );
}

function ManualMatchSelect({ clientes, onSelect }: { clientes: ClienteDB_LP[]; onSelect: (id: string) => void }) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");

    const filtered = useMemo(() => {
        if (!search) return clientes.slice(0, 30);
        const term = search.toLowerCase();
        return clientes.filter(c =>
            (c.razao_social || "").toLowerCase().includes(term) ||
            (c.nome_conta_azul || "").toLowerCase().includes(term) ||
            (c.cnpj || "").includes(term)
        ).slice(0, 30);
    }, [clientes, search]);

    if (!open) {
        return (
            <button onClick={() => setOpen(true)} title="Vincular Loja"
                style={{ background: "rgba(129,140,248,0.08)", border: "1px solid rgba(129,140,248,0.2)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", color: "var(--accent)", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                <Link2 size={12} /> Vincular
            </button>
        );
    }

    return (
        <div style={{ position: "relative" }}>
            <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
            <div style={{
                position: "absolute", right: 0, bottom: "100%", marginBottom: 4, zIndex: 50, width: 320,
                background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12,
                boxShadow: "0 -8px 30px rgba(0,0,0,0.4)", padding: 12,
            }}>
                <input
                    autoFocus type="text" placeholder="Buscar loja, CNPJ..."
                    value={search} onChange={e => setSearch(e.target.value)}
                    className="input" style={{ padding: "8px 12px", fontSize: 12, marginBottom: 8, width: "100%" }}
                />
                <div style={{ maxHeight: 220, overflowY: "auto" }}>
                    {filtered.map(c => (
                        <button key={c.id} onClick={() => { onSelect(c.id); setOpen(false); setSearch(""); }}
                            style={{
                                display: "flex", flexDirection: "column", width: "100%", textAlign: "left",
                                padding: "8px 10px", borderRadius: 6, border: "none", background: "transparent",
                                cursor: "pointer", color: "var(--fg)", fontSize: 12, transition: "background 0.15s",
                            }}
                            onMouseOver={e => (e.currentTarget.style.background = "var(--bg-card-hover)")}
                            onMouseOut={e => (e.currentTarget.style.background = "transparent")}
                        >
                            <span style={{ fontWeight: 600 }}>{c.nome_conta_azul || c.razao_social}</span>
                            <span style={{ fontSize: 10, color: "var(--fg-dim)" }}>{c.cnpj} • {c.razao_social}</span>
                        </button>
                    ))}
                    {filtered.length === 0 && <p style={{ fontSize: 12, color: "var(--fg-dim)", padding: 8, textAlign: "center" }}>Nenhum resultado</p>}
                </div>
            </div>
        </div>
    );
}
