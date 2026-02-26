"use client";

/* ================================================================
   CENTRAL DE LANÇAMENTOS PARCIAIS
   ================================================================
   ⚠️ ESCOPO ISOLADO: Este arquivo é 100% independente.
   - NÃO importa nada de NovoFaturamento.tsx ou seus parsers.
   - NÃO modifica tipagens globais.
   - Para exportação NFE.io usa API route própria (cópia isolada).
   ================================================================ */

import { useState, useCallback, useMemo } from "react";
import { useDropzone } from "react-dropzone";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
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
    // Campos preenchidos pelo XML:
    numeroNFGerada?: string;
    irrf?: number;
    // UI:
    razaoSocialMatch?: string;
    nomeContaAzulMatch?: string;
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

type StepLP = "upload" | "matching" | "xml" | "preview";

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
        const lojaNome = lojaRaw || extrairNomeLoja_LP(descricao);

        dados.push({
            id: gerarId_LP(),
            pedido,
            tipo,
            descricao: descricao || `Pedido ${pedido}`,
            valor,
            lojaNomeSugerido: lojaNome || undefined,
            cnpj: cnpjRaw || undefined,
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
    const [exportando, setExportando] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [preFilterEmpresa, setPreFilterEmpresa] = useState("");

    /* --- Totalizadores --- */
    const totalNF = useMemo(() => lancamentos.filter(l => l.tipo === "NF").reduce((s, l) => s + l.valor, 0), [lancamentos]);
    const totalNC = useMemo(() => lancamentos.filter(l => l.tipo === "NC").reduce((s, l) => s + l.valor, 0), [lancamentos]);
    const matched = useMemo(() => lancamentos.filter(l => l.lojaIdentificadaId).length, [lancamentos]);
    const unmatched = useMemo(() => lancamentos.filter(l => !l.lojaIdentificadaId).length, [lancamentos]);

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
    }, []);

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

    /* ================================================================
       STEP 2: MATCHING AUTOMÁTICO DE LOJAS
       ================================================================ */

    const fetchClientesEmatch = useCallback(async (dados: LancamentoParcial[]) => {
        setLoadingClientes(true);
        setStep("matching");

        // Busca paginada de clientes ativos
        let allClientes: ClienteDB_LP[] = [];
        let from = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data: chunk, error } = await supabase
                .from("clientes")
                .select("id, razao_social, nome_fantasia, nome, nome_conta_azul, cnpj, email_principal, emails_faturamento, endereco, numero, complemento, bairro, cidade, estado, cep, codigo_ibge, status")
                .eq("status", true)
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
                        if (score > bestScore) { bestScore = score; best = c; }
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
    }, [supabase]);

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
        setLancamentos(prev => prev.map(l => {
            if (l.id !== lancId) return l;
            if (field === "valor" || field === "irrf") {
                return { ...l, [field]: parseMoedaBR_LP(rawValue) };
            }
            if (field === "tipo") {
                const v = rawValue.toUpperCase();
                return { ...l, tipo: v === "NC" ? "NC" : "NF" };
            }
            return { ...l, [field]: rawValue };
        }));
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
        }>();

        for (const l of ncItems) {
            const key = `${l.cnpj}_${l.lojaIdentificadaId}`;
            const existing = agrupado.get(key);
            if (existing) {
                existing.totalValor += l.valor;
                if (l.pedido && !existing.pedidos.includes(l.pedido)) {
                    existing.pedidos.push(l.pedido);
                }
                if (l.descricao) existing.descricoes.push(l.descricao);
            } else {
                agrupado.set(key, {
                    loja: l.nomeContaAzulMatch || l.razaoSocialMatch || l.lojaNomeSugerido || "Desconhecido",
                    cnpj: l.cnpj || "",
                    pedidos: l.pedido ? [l.pedido] : [],
                    totalValor: l.valor,
                    descricoes: l.descricao ? [l.descricao] : [],
                });
            }
        }

        const items = Array.from(agrupado.values()).map(g => ({
            loja: g.loja,
            cnpj: g.cnpj,
            estado: "",
            valorBoleto: 0,
            valorNF: g.totalValor * 0.115,
            valorNC: g.totalValor * 0.885,
            descricaoServico: g.pedidos.join(", "),  // envia apenas os números de pedido
        }));

        try {
            const res = await fetch("/api/notas-credito/emitir", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items, nomePasta: "Notas_Credito" }),
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
        setSearchTerm("");
    };

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
        { key: "xml", label: "XML (Opcional)", num: 3 },
        { key: "preview", label: "Preview & Export", num: 4 },
    ];

    const canGoToXml = step === "matching" && lancamentos.length > 0;
    const canGoToPreview = (step === "xml" || step === "matching") && lancamentos.length > 0;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>

            {/* ── STEPPER ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {steps.map((s, i) => (
                    <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <button
                            onClick={() => {
                                if (s.key === "upload") return;
                                if (s.key === "matching" && lancamentos.length > 0) setStep("matching");
                                if (s.key === "xml" && canGoToXml) setStep("xml");
                                if (s.key === "preview" && canGoToPreview) setStep("preview");
                            }}
                            style={{
                                display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
                                borderRadius: 8, border: "1px solid",
                                borderColor: step === s.key ? "var(--accent)" : "var(--border)",
                                background: step === s.key ? "rgba(129,140,248,0.1)" : "transparent",
                                color: step === s.key ? "var(--accent)" : "var(--fg-dim)",
                                fontSize: 13, fontWeight: step === s.key ? 700 : 500, cursor: "pointer",
                                transition: "all 0.2s",
                            }}
                        >
                            <span style={{
                                width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 11, fontWeight: 700,
                                background: step === s.key ? "var(--accent)" : "var(--border)",
                                color: step === s.key ? "#fff" : "var(--fg-dim)",
                            }}>{s.num}</span>
                            {s.label}
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
                <div className="card">
                    <h2 style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Upload da Planilha de Lançamentos</h2>
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
                        <button onClick={() => setStep("preview")} className="btn btn-primary" style={{ padding: "8px 16px", fontSize: 12 }}>
                            {xmlLoaded ? "Continuar" : "Pular"} para Preview <ChevronRight size={14} />
                        </button>
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

            {/* ──────── STEP 4: PREVIEW & EXPORT ──────── */}
            {step === "preview" && (
                <>
                    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
                            <h2 style={{ fontSize: 16, fontWeight: 600, color: "#fff", margin: 0 }}>
                                Preview Consolidado
                                <span className="badge badge-info" style={{ marginLeft: 10, fontSize: 11 }}>{lancamentos.length} lançamentos</span>
                            </h2>
                            <div style={{ position: "relative" }}>
                                <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--fg-dim)" }} />
                                <input type="text" placeholder="Filtrar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                                    className="input" style={{ padding: "8px 8px 8px 32px", fontSize: 12, width: 200 }} />
                            </div>
                        </div>
                        <div style={{ overflowX: "auto", maxHeight: 600, overflowY: "auto" }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Pedido</th>
                                        <th>Tipo</th>
                                        <th>Loja</th>
                                        <th>CNPJ</th>
                                        <th>NF Gerada</th>
                                        <th style={{ textAlign: "right" }}>Valor Base</th>
                                        <th style={{ textAlign: "right" }}>NF (11.5%)</th>
                                        <th style={{ textAlign: "right" }}>NC (88.5%)</th>
                                        <th style={{ textAlign: "right" }}>IRRF</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredLancamentos.map((l, idx) => {
                                        const nf115 = l.valor * 0.115;
                                        const nc885 = l.valor * 0.885;
                                        return (
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
                                                <td>
                                                    {l.lojaIdentificadaId ? (
                                                        <span style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{l.nomeContaAzulMatch || l.razaoSocialMatch}</span>
                                                    ) : (
                                                        <EditableCell value={l.lojaNomeSugerido || ""} onSave={v => handleFieldChange(l.id, "lojaNomeSugerido", v)} placeholder="Nome loja" />
                                                    )}
                                                </td>
                                                <td><EditableCell value={l.cnpj || ""} onSave={v => handleFieldChange(l.id, "cnpj", v)} mono placeholder="CNPJ" /></td>
                                                <td><EditableCell value={l.numeroNFGerada || ""} onSave={v => handleFieldChange(l.id, "numeroNFGerada", v)} placeholder="—" /></td>
                                                <td style={{ textAlign: "right" }}><EditableCell value={fmtBRL_LP(l.valor)} onSave={v => handleFieldChange(l.id, "valor", v)} align="right" bold /></td>
                                                <td style={{ textAlign: "right" }}><span style={{ color: "var(--warning)", fontVariantNumeric: "tabular-nums" }}>{fmtBRL_LP(nf115)}</span></td>
                                                <td style={{ textAlign: "right" }}><span style={{ color: "var(--success)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmtBRL_LP(nc885)}</span></td>
                                                <td style={{ textAlign: "right" }}><EditableCell value={l.irrf ? fmtBRL_LP(l.irrf) : ""} onSave={v => handleFieldChange(l.id, "irrf", v)} align="right" placeholder="—" /></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* ── ACTION BUTTONS ── */}
                    <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                        <div>
                            <p style={{ fontWeight: 600, color: "#fff", margin: 0 }}>Ações de Exportação</p>
                            <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: "4px 0 0" }}>
                                <strong>{lancamentos.filter(l => l.tipo === "NF" && l.lojaIdentificadaId).length}</strong> NFs prontas para NFE.io
                                {" • "}
                                <strong>{lancamentos.filter(l => l.tipo === "NC" && l.lojaIdentificadaId).length}</strong> NCs prontas para GCP
                            </p>
                        </div>
                        <div style={{ display: "flex", gap: 10 }}>
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
                </>
            )}

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
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

function SumCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
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
    const btnRef = { current: null as HTMLButtonElement | null };

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
            <button ref={el => { btnRef.current = el; }} onClick={() => setOpen(true)} title="Vincular Loja"
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
