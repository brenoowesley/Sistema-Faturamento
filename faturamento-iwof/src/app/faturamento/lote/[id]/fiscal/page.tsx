"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import {
    ChevronLeft,
    Upload,
    FileArchive,
    FileCode,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    ArrowRight,
    Building2,
    DollarSign,
    Calculator,
    Save,
    Search,
    RefreshCcw,
    FileSearch,
    Receipt,
    ChevronDown,
    ChevronUp,
    Filter,
    FileText,
    Printer
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/* ================================================================
   TYPES
   ================================================================ */

interface Lote {
    id: string;
    data_competencia: string;
    status: string;
}

interface AjusteItem {
    id: string;
    tipo: "ACRESCIMO" | "DESCONTO" | "IRRF";
    valor: number;
    motivo: string;
    cliente_id?: string;
}

interface LojaConsolidada {
    id: string;
    razao_social: string;
    nome_fantasia: string | null;
    nome_conta_azul: string | null;
    cnpj: string;
    valorBruto: number;
    acrescimos: number;
    descontos: number;
    ajustesDetalhes: AjusteItem[];
    loja_mae_id?: string | null;
    children?: any[];
}

interface XMLData {
    cnpj: string;
    numeroNF: string;
    valorIR: number;
    filename: string;
}

interface ConciliacaoItem {
    loja: LojaConsolidada;
    xml?: XMLData;
    status: "MATCH" | "MISSING" | "CNPJ_MISMATCH";
    irrfCalculado: number;
    boletoFinal: number;
    ncFinal: number;
}

/* ================================================================
   UTILS
   ================================================================ */

const fmtCurrency = (val: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);

const fmtDate = (dateStr: string) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return d.toLocaleDateString("pt-BR");
};

// Advanced Monetary Filter Parser
const checkMonetaryFilter = (filterStr: string, value: number): boolean => {
    const raw = filterStr.trim().toLowerCase();
    if (!raw) return true;

    const extractNum = (s: string) => {
        const clean = s.replace(/[^\d.,]/g, "").replace(",", ".");
        const parsed = parseFloat(clean);
        return isNaN(parsed) ? null : parsed;
    };

    if (raw.includes(" e ")) {
        const parts = raw.split(" e ");
        const min = extractNum(parts[0]);
        const max = extractNum(parts[1]);
        if (min !== null && max !== null) return value >= min && value <= max;
    } else if (raw.includes(" ate ") || raw.includes(" até ")) {
        const parts = raw.split(/ at[eé] /);
        const min = extractNum(parts[0]);
        const max = extractNum(parts[1]);
        if (min !== null && max !== null) return value >= min && value <= max;
    } else if (raw.includes("-")) {
        const parts = raw.split("-");
        const min = extractNum(parts[0]);
        const max = extractNum(parts[1]);
        if (min !== null && max !== null) return value >= min && value <= max;
    }

    if (raw.startsWith(">") || raw.startsWith("a partir de") || raw.startsWith("maior que")) {
        const val = extractNum(raw);
        if (val !== null) return value >= val;
    }

    if (raw.startsWith("<") || raw.startsWith("ate") || raw.startsWith("até") || raw.startsWith("menor que")) {
        const val = extractNum(raw);
        if (val !== null) return value <= val;
    }

    // Default string match (exact or partial string search on formatted value)
    return fmtCurrency(value).toLowerCase().includes(raw);
};

/* ================================================================
   MONETARY FILTER UI COMPONENT
   ================================================================ */

const MonetaryFilterDropdown = ({ value, onChange, placeholder }: { value: string, onChange: (val: string) => void, placeholder: string }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [op, setOp] = useState<"EXACT" | "GTE" | "LTE" | "BETWEEN">("EXACT");
    const [v1, setV1] = useState("");
    const [v2, setV2] = useState("");

    const handleApply = () => {
        if (!v1) {
            onChange("");
        } else {
            if (op === "EXACT") onChange(v1);
            if (op === "GTE") onChange(`a partir de ${v1}`);
            if (op === "LTE") onChange(`até ${v1}`);
            if (op === "BETWEEN") onChange(`${v1} e ${v2}`);
        }
        setIsOpen(false);
    };

    const handleClear = () => {
        setV1(""); setV2(""); setOp("EXACT");
        onChange("");
        setIsOpen(false);
    };

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`w-28 flex items-center justify-between text-[10px] font-medium transition-all text-right rounded-lg px-2 py-1.5 border
                    ${value ? 'border-amber-500/50 text-amber-500 bg-amber-500/10' : 'bg-[var(--bg-main)] border-[var(--border)] text-white hover:border-[var(--primary)]/50'}`}
            >
                <span className="truncate flex-1 text-right">{value || placeholder}</span>
                <ChevronLeft size={12} className={`ml-1 transition-transform ${isOpen ? "rotate-90" : "-rotate-90"}`} />
            </button>
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
                    <div className="absolute top-full mt-2 right-0 w-52 bg-[#18181b] border border-[var(--border)] rounded-xl shadow-2xl p-3 z-50 flex flex-col gap-3 font-sans" onClick={e => e.stopPropagation()}>
                        <div className="flex flex-col gap-1">
                            <label className="text-[9px] uppercase font-black text-[var(--fg-dim)] tracking-widest">Filtrar por</label>
                            <select
                                value={op}
                                onChange={(e) => setOp(e.target.value as any)}
                                className="bg-[var(--bg-main)] border border-[var(--border)] rounded-md px-2 py-2 text-xs font-medium text-white outline-none cursor-pointer"
                                style={{ colorScheme: "dark" }}
                            >
                                <option value="EXACT" className="bg-[#18181b] text-white">Igual a</option>
                                <option value="GTE" className="bg-[#18181b] text-white">A partir de (≥)</option>
                                <option value="LTE" className="bg-[#18181b] text-white">Até (≤)</option>
                                <option value="BETWEEN" className="bg-[#18181b] text-white">Entre limites</option>
                            </select>
                        </div>

                        <div className="flex flex-col gap-2">
                            <input
                                type="text"
                                placeholder={op === "BETWEEN" ? "Valor Inicial..." : "Valor R$..."}
                                value={v1}
                                onChange={(e) => setV1(e.target.value)}
                                className="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-md px-3 py-2 text-xs font-bold text-white outline-none focus:border-[var(--primary)]/50 transition-colors placeholder-[var(--fg-dim)]"
                                onKeyDown={e => e.key === 'Enter' && handleApply()}
                                autoFocus
                            />

                            {op === "BETWEEN" && (
                                <input
                                    type="text"
                                    placeholder="Valor Final..."
                                    value={v2}
                                    onChange={(e) => setV2(e.target.value)}
                                    className="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-md px-3 py-2 text-xs font-bold text-white outline-none focus:border-[var(--primary)]/50 transition-colors placeholder-[var(--fg-dim)]"
                                    onKeyDown={e => e.key === 'Enter' && handleApply()}
                                />
                            )}
                        </div>

                        <div className="flex gap-2 mt-1">
                            <button onClick={handleClear} className="flex-1 bg-transparent hover:bg-white/5 border border-[var(--border)] text-white rounded-md py-2 text-[10px] uppercase font-bold transition-all">
                                Limpar
                            </button>
                            <button onClick={handleApply} className="flex-1 bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-black rounded-md py-2 text-[10px] uppercase font-black transition-all">
                                Aplicar
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

/* ================================================================
   PAGE COMPONENT
   ================================================================ */

export default function FiscalProcessingPage() {
    const params = useParams();
    const router = useRouter();
    const loteId = params.id as string;
    const supabase = createClient();

    // State
    const [lote, setLote] = useState<Lote | null>(null);
    const [loading, setLoading] = useState(true);
    const [lojas, setLojas] = useState<LojaConsolidada[]>([]);
    const [conciliacao, setConciliacao] = useState<ConciliacaoItem[]>([]);
    const [isConsolidating, setIsConsolidating] = useState(false);
    const [isDispatching, setIsDispatching] = useState(false);
    const [processingZIP, setProcessingZIP] = useState(false);
    const [rejeitados, setRejeitados] = useState<{ loja_id: string; razao_social: string; cnpj: string; motivo: string }[]>([]);
    const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
    const [summaryFilter, setSummaryFilter] = useState<"VALIDADAS" | "PENDENTES">("PENDENTES");

    // Filter State
    const [filters, setFilters] = useState({
        loja: "",
        status: "TODOS",
        nota: "",
        calculoBase: "",
        irrf: "",
        ncFinal: "",
        boletoFinal: ""
    });

    // 1. Initial Data Fetch
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const { data: loteData, error: loteErr } = await supabase
                .from("faturamentos_lote")
                .select("*")
                .eq("id", loteId)
                .single();

            if (loteErr) throw loteErr;
            if (loteData.status !== "AGUARDANDO_XML" && loteData.status !== "PENDENTE") {
                // Allow PENDENTE too if user jumped directly, but usually it comes from AGUARDANDO_XML
            }
            setLote(loteData);

            // 2. Fetch Raw Agendamentos (to get Lojas involved)
            const { data: agendamentos, error: agErr } = await supabase
                .from("agendamentos_brutos")
                .select("loja_id, cnpj_loja, valor_iwof, status_validacao, clientes(razao_social, nome_fantasia, nome_conta_azul, cnpj, loja_mae_id, ciclos_faturamento(nome))")
                .eq("lote_id", loteId)
                .eq("status_validacao", "VALIDADO");

            if (agErr) throw agErr;

            // Fetch missing/rejected records that couldn't be correctly billed for NFE export
            const { data: missingRecords, error: missingErr } = await supabase
                .from("agendamentos_brutos")
                .select("loja_id, status_validacao, cnpj_loja, clientes(razao_social, cnpj, endereco, bairro, cidade, estado, cep)")
                .eq("lote_id", loteId);

            if (!missingErr && missingRecords) {
                const missingMap = new Map<string, { loja_id: string; razao_social: string; cnpj: string; motivo: string }>();

                missingRecords.forEach(rec => {
                    const client = rec.clientes as any;
                    const razao = client?.razao_social || "Empresa Desconhecida";
                    const cnpj = client?.cnpj || rec.cnpj_loja || "Desconhecido";

                    if (!client) {
                        missingMap.set(rec.loja_id, { loja_id: rec.loja_id, razao_social: razao, cnpj, motivo: "Cliente não cadastrado no sistema" });
                        return;
                    }

                    if (rec.status_validacao !== "VALIDADO") {
                        missingMap.set(rec.loja_id, { loja_id: rec.loja_id, razao_social: razao, cnpj, motivo: `Status do agendamento: ${rec.status_validacao}` });
                        return;
                    }

                    // Verifica se faltam dados fiscais cruciais para a Conta Azul (Endereço completo)
                    const faltaEndereco = !client.endereco || !client.bairro || !client.cidade || !client.estado || !client.cep;
                    if (faltaEndereco) {
                        missingMap.set(rec.loja_id, { loja_id: rec.loja_id, razao_social: razao, cnpj, motivo: "Dados de endereço incompletos (Rua, Bairro, Cidade, UF ou CEP)" });
                        return;
                    }
                });

                setRejeitados(Array.from(missingMap.values()));
            }

            // 3. Get unique store IDs involved
            const storeIds = Array.from(new Set((agendamentos || []).map(a => a.loja_id)));

            // 4. Fetch Pending Adjustments for these stores
            const { data: ajustes, error: ajErr } = await supabase
                .from("ajustes_faturamento")
                .select("*")
                .in("cliente_id", storeIds)
                .eq("status_aplicacao", false);

            if (ajErr) throw ajErr;

            // 5. Group and Consolidate strictly by spreadsheet CNPJ (or fallback to lojaId)
            const consolidatedMap = new Map<string, LojaConsolidada>();

            (agendamentos || []).forEach(a => {
                const client = a.clientes as any;
                const uniqueKey = a.loja_id;

                if (!consolidatedMap.has(uniqueKey)) {
                    consolidatedMap.set(uniqueKey, {
                        id: uniqueKey, // use the unique key so they stay distinct
                        razao_social: client?.razao_social || "S/N",
                        nome_fantasia: client?.nome_fantasia || null,
                        nome_conta_azul: client?.nome_conta_azul || null,
                        cnpj: client?.cnpj || a.cnpj_loja || "00000000000000",
                        valorBruto: 0,
                        acrescimos: 0,
                        descontos: 0,
                        ajustesDetalhes: [],
                        active: true,
                        ciclo: client?.ciclos_faturamento?.nome || "-",
                        loja_mae_id: client?.loja_mae_id || null,
                        // Add real loja_id for adjustment matching
                        loja_id_real: a.loja_id
                    } as LojaConsolidada & { loja_id_real: string; loja_mae_id: string | null; ciclo: string });
                }
                const store = consolidatedMap.get(uniqueKey)!;
                store.valorBruto += Number(a.valor_iwof) || 0;
            });

            (ajustes || []).forEach(aj => {
                // Find all stores in our map that belong to this cliente_id
                const matchingStores = Array.from(consolidatedMap.values()).filter(st => {
                    return (st as any).loja_id_real === aj.cliente_id;
                });

                if (matchingStores.length > 0) {
                    const store = matchingStores[0]; // Apply to the first one only, to avoid cloning the monetary value
                    if (aj.tipo === "ACRESCIMO") store.acrescimos += Number(aj.valor) || 0;
                    if (aj.tipo === "DESCONTO") store.descontos += Number(aj.valor) || 0;
                    store.ajustesDetalhes.push({
                        id: aj.id,
                        tipo: aj.tipo,
                        valor: Number(aj.valor) || 0,
                        motivo: aj.motivo,
                        cliente_id: aj.cliente_id
                    });
                }
            });

            const finalMapping = new Map<string, any>();
            Array.from(consolidatedMap.values()).forEach(st => {
                // Agrupamento por loja_mae somente para clientes LETA.
                // Qualquer outra empresa sempre aparece como loja standalone.
                const cicloNome: string = (st as any).ciclo || "";
                const nomeContaAzul: string = (st.nome_conta_azul || "").toUpperCase();
                const isLeta = cicloNome.toUpperCase().includes("LETA") || nomeContaAzul.includes("LETA") || nomeContaAzul.includes("ARCO-MIX") || nomeContaAzul.includes("ARCO MIX");
                const targetKey = (isLeta && st.loja_mae_id) ? st.loja_mae_id : st.id;

                if (!finalMapping.has(targetKey)) {
                    finalMapping.set(targetKey, { ...st, isMother: isLeta && !!st.loja_mae_id, children: [] });
                } else {
                    const mother = finalMapping.get(targetKey)!;
                    mother.valorBruto += st.valorBruto;
                    mother.acrescimos += st.acrescimos;
                    mother.descontos += st.descontos;
                    mother.ajustesDetalhes.push(...st.ajustesDetalhes);
                    if (!mother.children) mother.children = [];
                    mother.children.push(st);
                }
            });

            const finalLojas = Array.from(finalMapping.values());
            setLojas(finalLojas);

        } catch (err) {
            console.error("Error fetching data:", err);
            alert("Erro ao carregar dados do lote.");
        } finally {
            setLoading(false);
        }
    }, [loteId, supabase]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Audit Log for Fiscal Discrepancies
    useEffect(() => {
        if (!loading && (lojas.length > 0 || rejeitados.length > 0)) {
            console.group("%c Auditoria Fiscal: Consolidação do Lote ", "color: white; background: #3b82f6; font-weight: bold; border-radius: 4px; padding: 2px 6px;");

            const totalChildren = lojas.reduce((acc, current) => acc + (current.children?.length || 0), 0);
            const totalDistinctStoresOnLote = lojas.length + totalChildren + rejeitados.length;

            console.log(`%cTotal de Lojas Únicas no Banco (para este lote):%c ${totalDistinctStoresOnLote}`, "font-weight: bold;", "color: #3b82f6; font-weight: bold;");
            console.log(`%cLojas Mãe (Visíveis na Tabela):%c ${lojas.length}`, "font-weight: bold;", "color: #10b981; font-weight: bold;");
            console.log(`%cFiliais Agrupadas (Ocultas):%c ${totalChildren}`, "font-weight: bold;", "color: #fbbf24; font-weight: bold;");
            console.log(`%cLojas Rejeitadas/Omissas:%c ${rejeitados.length}`, "font-weight: bold;", "color: #ef4444; font-weight: bold;");

            if (lojas.some(l => l.children && l.children.length > 0)) {
                console.groupCollapsed("%c Detalhes do Agrupamento (Mothers & Filiais) ", "color: #fbbf24; font-weight: bold;");
                lojas.filter(l => l.children && l.children.length > 0).forEach(m => {
                    console.group(`%cMãe: ${m.razao_social} (%c${m.children?.length} filiais%c)`, "color: white; font-weight: bold;", "color: #fbbf24;", "color: white;");
                    m.children?.forEach(c => {
                        console.log(`%cFilial:%c ${c.razao_social} %c(${c.cnpj || "Sem CNPJ"})`, "color: #94a3b8;", "color: white;", "color: #64748b;");
                    });
                    console.groupEnd();
                });
                console.groupEnd();
            }

            if (rejeitados.length > 0) {
                console.groupCollapsed("%c Detalhes das Lojas Rejeitadas (NÃO entraram na consolidação) ", "color: #ef4444; font-weight: bold;");
                rejeitados.forEach(r => {
                    console.log(`%c[${r.motivo}]%c ${r.razao_social} %c(${r.cnpj})`, "color: #f87171; font-weight: bold;", "color: white;", "color: #94a3b8;");
                });
                console.groupEnd();
            }

            console.groupEnd();
        }
    }, [loading, lojas, rejeitados]);

    // 2. ZIP Processing
    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        if (acceptedFiles.length === 0) return;
        const file = acceptedFiles[0];
        setProcessingZIP(true);

        try {
            const zip = new JSZip();
            const contents = await zip.loadAsync(file);
            // Ignorar attributes mas EVITAR transformar strings totalmente númericas (CNPJ/CPF com zeros a esquerda) em Numbers base
            const parser = new XMLParser({
                ignoreAttributes: false,
                parseTagValue: false
            });

            const parsedXMLs: XMLData[] = [];

            for (const filename of Object.keys(contents.files)) {
                if (filename.toLowerCase().endsWith(".xml")) {
                    const xmlText = await contents.files[filename].async("text");
                    const jsonObj = parser.parse(xmlText);

                    // Helper robusto para buscar uma tag específica recursivamente
                    const findTagInJSON = (obj: any, tag: string): any => {
                        if (!obj || typeof obj !== 'object' || obj === null) return undefined;
                        // Busca no nível atual
                        for (const k in obj) {
                            if (k.toLowerCase() === tag.toLowerCase()) return obj[k];
                        }
                        // Busca recursiva profunda
                        for (const k in obj) {
                            const res = findTagInJSON(obj[k], tag);
                            if (res !== undefined) return res;
                        }
                        return undefined;
                    };

                    // Pega o bloco principal da nota para evitar pegar dados de cancelamento ou do cabeçalho do arquivo
                    const infNfse = findTagInJSON(jsonObj, "InfNfse");
                    const targetContext = infNfse || jsonObj;

                    // 1. CNPJ do TOMADOR: Busca primeiro o bloco Tomador para evitar pegar o do Prestador
                    const tomador = findTagInJSON(targetContext, "TomadorServico") ||
                        findTagInJSON(targetContext, "Tomador") ||
                        findTagInJSON(targetContext, "IdentificacaoTomador");

                    const cnpjRaw = tomador ? (
                        findTagInJSON(tomador, "Cnpj") ||
                        findTagInJSON(tomador, "Cpf") ||
                        findTagInJSON(tomador, "CPFCNPJ")
                    ) : undefined;

                    // 2. Número da Nota: Numero
                    const numeroNF = findTagInJSON(targetContext, "Numero");

                    // 3. Valor IRRF: Valores > ValorIr
                    const valorIRRaw = findTagInJSON(targetContext, "ValorIr") || 0;

                    if (cnpjRaw) {
                        const cleanCNPJ = String(cnpjRaw).replace(/\D/g, "");
                        const safeValorIR = Number(parseFloat(String(valorIRRaw)).toFixed(2)) || 0;

                        parsedXMLs.push({
                            cnpj: cleanCNPJ,
                            numeroNF: String(numeroNF || "S/N"),
                            valorIR: safeValorIR,
                            filename
                        });
                    }
                }
            }

            console.log(`[FISCAL AUDIT] ZIP Processado. Encontrados ${parsedXMLs.length} XMLs válidos.`);
            parsedXMLs.forEach(p => console.log(`[FISCAL AUDIT] XML: ${p.filename} -> CNPJ: ${p.cnpj}, Nota: ${p.numeroNF}, IR: ${p.valorIR}`));

            // 3. Reconciliation
            const res: ConciliacaoItem[] = lojas.map(loja => {
                const cleanCNPJ = loja.cnpj.replace(/\D/g, "");
                const matchedXML = parsedXMLs.find(x => x.cnpj === cleanCNPJ);

                const calcBase = (loja.valorBruto + loja.acrescimos) - loja.descontos;

                // Cálculo Nordestão: (Boleto * 0.115) * 0.015
                let irrf = matchedXML ? matchedXML.valorIR : 0;
                const isNordestao = (loja as any).ciclo === "NORDESTÃO";

                if (isNordestao && irrf === 0) {
                    irrf = Number(((calcBase * 0.115) * 0.015).toFixed(2));
                }

                // O cliente definiu literalmente:
                // 1. Soma do valor = Boleto
                // 2. NC = 88.5% do Boleto
                // 3. NF = 11.5% do Boleto
                const boleto = calcBase;
                const nc = calcBase * 0.885;

                return {
                    loja,
                    xml: matchedXML,
                    status: matchedXML ? "MATCH" : (isNordestao ? "MATCH" : "MISSING"),
                    irrfCalculado: irrf,
                    boletoFinal: boleto,
                    ncFinal: nc
                };
            });

            setConciliacao(res);

        } catch (err) {
            console.error("Error processing ZIP:", err);
            alert("Erro ao processar arquivo ZIP.");
        } finally {
            setProcessingZIP(false);
        }
    }, [lojas]);

    // Computed Filtered Data
    const filteredConciliacao = useMemo(() => {
        return conciliacao.filter(item => {
            const matchesLoja =
                (item.loja.nome_conta_azul || "").toLowerCase().includes(filters.loja.toLowerCase()) ||
                (item.loja.nome_fantasia || "").toLowerCase().includes(filters.loja.toLowerCase()) ||
                (item.loja.razao_social || "").toLowerCase().includes(filters.loja.toLowerCase()) ||
                item.loja.cnpj.includes(filters.loja.replace(/\D/g, ""));

            const matchesStatus = filters.status === "TODOS" || item.status === filters.status;

            const matchesNota = (item.xml?.numeroNF || "-").toLowerCase().includes(filters.nota.toLowerCase());

            const calcBaseReal = (item.loja.valorBruto + item.loja.acrescimos) - item.loja.descontos;

            const matchesCalculoBase = checkMonetaryFilter(filters.calculoBase, calcBaseReal);
            const matchesIrrf = checkMonetaryFilter(filters.irrf, item.irrfCalculado);
            const matchesNcFinal = checkMonetaryFilter(filters.ncFinal, item.ncFinal);
            const matchesBoletoFinal = checkMonetaryFilter(filters.boletoFinal, item.boletoFinal);

            return matchesLoja && matchesStatus && matchesNota && matchesCalculoBase && matchesIrrf && matchesNcFinal && matchesBoletoFinal;
        });
    }, [conciliacao, filters]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { "application/zip": [".zip"] },
        multiple: false
    });

    // 4. Final Consolidation
    const handleConsolidar = async () => {
        if (conciliacao.length === 0) {
            alert("A reconciliação está vazia. Por favor, faça o upload do ZIP com os XMLs novamente.");
            return;
        }
        if (!confirm("Confirmar valores e consolidar lote? Esta ação encerrará o faturamento deste lote.")) return;

        setIsConsolidating(true);
        try {
            for (const item of conciliacao) {
                // 1. Salvar ou Atualizar registro da Mãe (ou Loja Avulsa)
                const { error: errorMother } = await supabase
                    .from("faturamento_consolidados")
                    .upsert({
                        lote_id: loteId,
                        cliente_id: item.loja.id,
                        cnpj_filial: null, // Assegura a compatibilidade com a key
                        valor_bruto: item.loja.valorBruto,
                        acrescimos: item.loja.acrescimos,
                        descontos: item.loja.descontos,
                        valor_ir_xml: item.irrfCalculado,
                        valor_nf_emitida: ((item.loja.valorBruto + item.loja.acrescimos) - item.loja.descontos) * 0.115,
                        valor_nc_final: item.ncFinal,
                        valor_boleto_final: item.boletoFinal,
                        numero_nf: item.xml ? String(item.xml.numeroNF) : null,
                        observacao_report: (item.loja as any).ciclo === "NORDESTÃO" ? `Desconto IRRF: ${fmtCurrency(item.irrfCalculado)}` : null
                    }, {
                        onConflict: "lote_id, cliente_id, cnpj_filial"
                    });

                if (errorMother) throw errorMother;

                // 2. Se houver filiais agrupadas, salvar registros individuais para relatórios (financeiro zerado para a filial)
                if (item.loja.children && item.loja.children.length > 0) {
                    for (const filial of item.loja.children) {
                        const { error: errorFilial } = await supabase
                            .from("faturamento_consolidados")
                            .upsert({
                                lote_id: loteId,
                                cliente_id: filial.id,
                                cnpj_filial: filial.cnpj, // Mapeia o CNPJ da filial
                                valor_bruto: filial.valorBruto,
                                acrescimos: filial.acrescimos,
                                descontos: filial.descontos,
                                valor_ir_xml: 0,
                                valor_nf_emitida: 0,
                                valor_nc_final: 0,
                                valor_boleto_final: 0,
                                observacao_report: null
                            }, {
                                onConflict: "lote_id, cliente_id, cnpj_filial"
                            });
                        if (errorFilial) throw errorFilial;
                    }
                }
            }

            // Update lote status
            const { error: loteErr } = await supabase
                .from("faturamentos_lote")
                .update({ status: "CONSOLIDADO" })
                .eq("id", loteId);

            if (loteErr) throw loteErr;

            alert("Lote consolidado com sucesso! Agora você pode disparar os documentos para o Google Cloud.");
            fetchData(); // Refresh to show the dispatch button

        } catch (err) {
            console.error("Error consolidating:", err);
            alert("Erro ao salvar consolidação.");
        } finally {
            setIsConsolidating(false);
        }
    };

    const handleDispararGCP = async (tipo: "NC" | "HC") => {
        const label = tipo === "NC" ? "Notas de Crédito" : "Faturas / Descritivo de Horas";
        if (!confirm(`Deseja disparar as tarefas de geração de ${label} no Google Cloud Platform?`)) return;

        setIsDispatching(true);
        try {
            const response = await fetch("/api/documentos/disparar-gcp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ loteId, tipo })
            });

            const result = await response.json();

            if (!response.ok) throw new Error(result.error || "Erro ao disparar gerador GCP.");

            alert(`Processamento de ${tipo} iniciado no servidor! Os documentos estarão disponíveis no Drive em instantes.`);

            // Mostrar botão de ir para o drive
            const driveUrl = result.data?.drive_url || process.env.NEXT_PUBLIC_DRIVE_FOLDER_URL || "https://drive.google.com/drive/my-drive";
            window.open(driveUrl, "_blank");

            fetchData();
        } catch (err: any) {
            console.error("Error dispatching GCP:", err);
            alert("Erro na integração com GCP: " + err.message);
        } finally {
            setIsDispatching(false);
        }
    };

    const handleExportarNFE = () => {
        // Trigger download via window.location or hidden link
        const url = `/api/documentos/exportar-nfe?loteId=${loteId}`;
        window.open(url, "_blank");
    };

    const handleExportarRejeitados = async () => {
        if (rejeitados.length === 0) {
            alert("Não há lojas de fora deste fechamento.");
            return;
        }

        try {
            const xlsx = await import("xlsx");
            const dadosRejeitados = rejeitados.map(r => ({
                "CNPJ": r.cnpj,
                "Razão Social": r.razao_social,
                "Motivo da Omissão": r.motivo
            }));

            const workbook = xlsx.utils.book_new();
            const worksheet = xlsx.utils.json_to_sheet(dadosRejeitados);
            xlsx.utils.book_append_sheet(workbook, worksheet, "Lojas Ausentes");
            xlsx.writeFile(workbook, `lojas_ausentes_lote_${loteId.substring(0, 8)}.xlsx`);
        } catch (error) {
            console.error("Erro ao exportar rejeitados:", error);
            alert("Erro ao gerar planilha de lojas ausentes.");
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[var(--bg-main)] flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[var(--primary)]"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--bg-main)] pb-32">
            {/* Header */}
            <div className="sticky top-0 z-30 bg-[var(--bg-main)]/80 backdrop-blur-md border-b border-[var(--border)] p-4 shadow-xl">
                <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-4">
                        <button onClick={() => router.back()} className="p-2 hover:bg-[var(--bg-card)] rounded-full transition-colors text-[var(--fg-dim)]">
                            <ChevronLeft size={24} />
                        </button>
                        <div>
                            <h1 className="text-xl font-black text-white uppercase tracking-tighter flex items-center gap-2">
                                <FileSearch className="text-[var(--primary)]" size={24} />
                                Processamento Fiscal
                            </h1>
                            <p className="text-[var(--fg-dim)] text-xs flex items-center gap-2">
                                Lote: <span className="text-white font-mono">{loteId.slice(0, 8)}...</span>
                                <span className="mx-1 opacity-20">|</span>
                                Status: <span className="text-amber-500 font-bold">{lote?.status}</span>
                            </p>
                        </div>
                    </div>
                    {conciliacao.length > 0 && (
                        <button
                            onClick={() => setConciliacao([])}
                            className="btn btn-ghost btn-sm flex items-center gap-2"
                        >
                            <RefreshCcw size={14} /> Refazer Upload
                        </button>
                    )}
                </div>
            </div>

            <main className="max-w-7xl mx-auto p-6 space-y-8">

                {/* 1. UPLOAD SECTION */}
                {conciliacao.length === 0 && (
                    <div className="max-w-3xl mx-auto">
                        <div
                            {...getRootProps()}
                            className={`border-2 border-dashed rounded-3xl p-16 transition-all cursor-pointer text-center space-y-4
                                ${isDragActive ? 'border-[var(--primary)] bg-[var(--primary)]/5 scale-[1.02]' : 'border-[var(--border)] hover:border-[var(--primary)]/50 hover:bg-[var(--bg-card)]'}`}
                        >
                            <input {...getInputProps()} />
                            <div className="flex justify-center">
                                <div className="w-20 h-20 rounded-2xl bg-[var(--primary)]/10 flex items-center justify-center text-[var(--primary)] shadow-inner">
                                    <FileArchive size={40} />
                                </div>
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-white">Upload de Arquivo ZIP de Retorno</h3>
                                <p className="text-[var(--fg-dim)] mt-2">Arraste e solte o arquivo contendo os XMLs das Notas Fiscais emitidas.</p>
                            </div>
                            <div className="inline-flex items-center gap-2 bg-[var(--bg-card)] px-4 py-2 rounded-xl border border-[var(--border)] text-xs font-mono text-[var(--fg-dim)]">
                                <CheckCircle2 size={12} className="text-emerald-500" /> Somente .ZIP
                            </div>
                        </div>

                        {/* Export Shortcut */}
                        <div className="mt-8 bg-[var(--bg-card)] rounded-3xl border border-[var(--border)] p-6">
                            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                                        <FileSearch size={24} />
                                    </div>
                                    <div>
                                        <h4 className="text-white font-bold">Ainda não tem a planilha para o NFE.io?</h4>
                                        <p className="text-[var(--fg-dim)] text-xs">Gere o arquivo consolidado para importar no sistema de Notas Fiscais.</p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleExportarNFE}
                                    className="btn btn-outline btn-success flex items-center gap-2 px-8 py-3 rounded-xl font-bold uppercase tracking-tight transition-all hover:scale-105 active:scale-95 whitespace-nowrap"
                                >
                                    <FileSearch size={18} /> Exportar Planilha NFE.io (.xlsx)
                                </button>
                            </div>
                        </div>

                        {/* VALIDATION SUMMARY (Collapsible) */}
                        <div className="mt-8 bg-[#18181b] rounded-3xl border border-[var(--border)] overflow-hidden shadow-xl">
                            <div
                                onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
                                className="flex items-center justify-between p-6 cursor-pointer hover:bg-white/[0.02] transition-colors"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
                                        <Filter size={24} />
                                    </div>
                                    <div>
                                        <h4 className="text-white font-bold text-lg">Resumo de Validação do Lote</h4>
                                        <div className="flex gap-4 mt-1 text-sm">
                                            <span className="text-emerald-500 font-medium">{lojas.length} Lojas Validadas</span>
                                            <span className="text-red-400 font-medium">{rejeitados.length} Pendências / Omissões</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="text-[var(--fg-dim)]">
                                    {isSummaryExpanded ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
                                </div>
                            </div>

                            {isSummaryExpanded && (
                                <div className="border-t border-[var(--border)] p-6 animate-in slide-in-from-top-4 fade-in duration-300">
                                    <div className="flex gap-2 mb-6 border-b border-[var(--border)] pb-4">
                                        <button
                                            onClick={() => setSummaryFilter("VALIDADAS")}
                                            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${summaryFilter === "VALIDADAS" ? "bg-emerald-500/20 text-emerald-500 border border-emerald-500/50" : "bg-transparent text-[var(--fg-dim)] hover:bg-white/5"}`}
                                        >
                                            Validadas ({lojas.length})
                                        </button>
                                        <button
                                            onClick={() => setSummaryFilter("PENDENTES")}
                                            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${summaryFilter === "PENDENTES" ? "bg-red-500/20 text-red-500 border border-red-500/50" : "bg-transparent text-[var(--fg-dim)] hover:bg-white/5"}`}
                                        >
                                            Pendentes ({rejeitados.length})
                                        </button>
                                    </div>

                                    <div className="max-h-96 overflow-y-auto custom-scrollbar pr-2">
                                        {summaryFilter === "VALIDADAS" ? (
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest border-b border-[var(--border)]">
                                                        <th className="pb-3 text-emerald-500 font-black">Cliente / Conta Azul</th>
                                                        <th className="pb-3 text-emerald-500 font-black">CNPJ</th>
                                                        <th className="pb-3 text-right text-emerald-500 font-black">Valor Base</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {lojas.map(l => (
                                                        <tr key={l.id} className="border-b border-[var(--border)]/50 last:border-0 hover:bg-white/[0.02]">
                                                            <td className="py-3">
                                                                <div className="flex flex-col">
                                                                    <span className="text-sm text-white font-medium">{l.nome_conta_azul}</span>
                                                                    <span className="text-[10px] text-[var(--fg-dim)] lowercase opacity-80 leading-tight">
                                                                        {l.razao_social} • {l.cnpj}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="py-3 text-xs font-mono text-[var(--fg-dim)]">{l.cnpj}</td>
                                                            <td className="py-3 text-sm text-right font-bold text-[var(--primary)]">{fmtCurrency(l.valorBruto + l.acrescimos - l.descontos)}</td>
                                                        </tr>
                                                    ))}
                                                    {lojas.length === 0 && (
                                                        <tr><td colSpan={3} className="py-8 text-center text-[var(--fg-dim)]">Nenhuma loja validada.</td></tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        ) : (
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest border-b border-[var(--border)]">
                                                        <th className="pb-3 text-red-500 font-black">Razão Social</th>
                                                        <th className="pb-3 text-red-500 font-black">CNPJ</th>
                                                        <th className="pb-3 text-red-500 font-black">Motivo da Exclusão</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {rejeitados.map((r, i) => (
                                                        <tr key={i} className="border-b border-[var(--border)]/50 last:border-0 hover:bg-red-500/5">
                                                            <td className="py-3 text-sm text-white font-medium">{r.razao_social}</td>
                                                            <td className="py-3 text-xs font-mono text-[var(--fg-dim)]">{r.cnpj}</td>
                                                            <td className="py-3 text-xs font-semibold text-red-400">{r.motivo}</td>
                                                        </tr>
                                                    ))}
                                                    {rejeitados.length === 0 && (
                                                        <tr><td colSpan={3} className="py-8 text-center text-[var(--fg-dim)]">Nenhuma loja pendente.</td></tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>

                                    {summaryFilter === "PENDENTES" && rejeitados.length > 0 && (
                                        <div className="mt-4 pt-4 border-t border-[var(--border)] flex justify-end">
                                            <button
                                                onClick={handleExportarRejeitados}
                                                className="btn btn-sm btn-outline border-red-900/50 text-red-400 hover:bg-red-900/40 hover:text-white flex items-center gap-2"
                                            >
                                                <FileSearch size={14} /> Exportar Pendentes (.xlsx)
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {processingZIP && (
                            <div className="mt-8 flex flex-col items-center gap-4">
                                <div className="w-full h-1 bg-[var(--border)] rounded-full overflow-hidden">
                                    <div className="h-full bg-[var(--primary)] animate-[progress_2s_ease-in-out_infinite]" style={{ width: '40%' }}></div>
                                </div>
                                <p className="text-sm font-bold text-[var(--primary)] animate-pulse">Processando XMLs em memória...</p>
                            </div>
                        )}
                    </div>
                )}

                {/* 2. RESULTS SECTION */}
                {conciliacao.length > 0 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-black text-white uppercase tracking-tight flex items-center gap-2">
                                <CheckCircle2 className="text-emerald-500" size={20} /> Preview de Consolidação
                            </h2>
                            <div className="flex items-center gap-4 text-xs font-medium">
                                <span className="flex items-center gap-1 text-[var(--fg-dim)]">
                                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div> XML Encontrado
                                </span>
                                <span className="flex items-center gap-1 text-[var(--fg-dim)]">
                                    <div className="w-2 h-2 rounded-full bg-amber-500"></div> XML Ausente
                                </span>
                            </div>
                        </div>

                        <div className="bg-[var(--bg-card)] rounded-3xl border border-[var(--border)] shadow-2xl overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-[var(--bg-main)]/50 text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest border-b border-[var(--border)]">
                                            <th className="p-4">
                                                <div className="flex flex-col gap-2">
                                                    Loja / CNPJ
                                                    <input
                                                        type="text"
                                                        placeholder="Filtrar..."
                                                        value={filters.loja}
                                                        onChange={e => setFilters({ ...filters, loja: e.target.value })}
                                                        className="bg-[var(--bg-main)] border border-[var(--border)] rounded-lg px-2 py-1 text-[10px] font-medium text-white outline-none focus:border-[var(--primary)]/50 transition-all"
                                                    />
                                                </div>
                                            </th>
                                            <th className="p-4">
                                                <div className="flex flex-col gap-2">
                                                    Status XML
                                                    <select
                                                        value={filters.status}
                                                        onChange={e => setFilters({ ...filters, status: e.target.value as any })}
                                                        className="bg-[var(--bg-main)] border border-[var(--border)] rounded-lg px-2 py-1 text-[10px] font-medium text-white outline-none focus:border-[var(--primary)]/50 transition-all cursor-pointer"
                                                        style={{ colorScheme: "dark" }}
                                                    >
                                                        <option value="TODOS" className="bg-[#18181b] text-white">TODOS</option>
                                                        <option value="MATCH" className="bg-[#18181b] text-white">XML OK</option>
                                                        <option value="MISSING" className="bg-[#18181b] text-white">XML AUSENTE</option>
                                                    </select>
                                                </div>
                                            </th>
                                            <th className="p-4">
                                                <div className="flex flex-col gap-2">
                                                    Nº Nota
                                                    <input
                                                        type="text"
                                                        placeholder="Nº..."
                                                        value={filters.nota}
                                                        onChange={e => setFilters({ ...filters, nota: e.target.value })}
                                                        className="bg-[var(--bg-main)] border border-[var(--border)] rounded-lg px-2 py-1 text-[10px] font-medium text-white outline-none focus:border-[var(--primary)]/50 transition-all"
                                                    />
                                                </div>
                                            </th>
                                            <th className="p-4 text-right">
                                                <div className="flex flex-col gap-2 items-end">
                                                    Cálculo Base
                                                    <MonetaryFilterDropdown
                                                        placeholder="Valor..."
                                                        value={filters.calculoBase}
                                                        onChange={val => setFilters({ ...filters, calculoBase: val })}
                                                    />
                                                </div>
                                            </th>
                                            <th className="p-4 text-right text-amber-500">
                                                <div className="flex flex-col gap-2 items-end">
                                                    IRRF (XML)
                                                    <MonetaryFilterDropdown
                                                        placeholder="IR..."
                                                        value={filters.irrf}
                                                        onChange={val => setFilters({ ...filters, irrf: val })}
                                                    />
                                                </div>
                                            </th>
                                            <th className="p-4 text-right text-[var(--primary)]">
                                                <div className="flex flex-col gap-2 items-end">
                                                    NC Final
                                                    <MonetaryFilterDropdown
                                                        placeholder="NC..."
                                                        value={filters.ncFinal}
                                                        onChange={val => setFilters({ ...filters, ncFinal: val })}
                                                    />
                                                </div>
                                            </th>
                                            <th className="p-4 text-right text-white">
                                                <div className="flex flex-col gap-2 items-end">
                                                    Boleto Final
                                                    <MonetaryFilterDropdown
                                                        placeholder="Boleto..."
                                                        value={filters.boletoFinal}
                                                        onChange={val => setFilters({ ...filters, boletoFinal: val })}
                                                    />
                                                </div>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredConciliacao.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="p-12 text-center text-[var(--fg-dim)] italic text-sm">
                                                    Nenhum registro encontrado para os filtros aplicados.
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredConciliacao.map(item => {
                                                const calcBase = (item.loja.valorBruto + item.loja.acrescimos) - item.loja.descontos;
                                                return (
                                                    <tr key={item.loja.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                                                        <td className="p-4">
                                                            <div className="flex flex-col">
                                                                <span className="text-white font-bold text-sm">
                                                                    {item.loja.nome_conta_azul}
                                                                </span>
                                                                <span className="text-[10px] text-[var(--fg-dim)] lowercase opacity-80 leading-tight">
                                                                    {item.loja.razao_social} • {item.loja.cnpj}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="p-4">
                                                            {item.status === "MATCH" ? (
                                                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-bold">
                                                                    <CheckCircle2 size={10} /> XML OK
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/10 text-amber-500 text-[10px] font-bold">
                                                                    <AlertTriangle size={10} /> XML AUSENTE
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="p-4 font-mono text-sm text-[var(--fg-dim)]">
                                                            {item.xml?.numeroNF || "-"}
                                                        </td>
                                                        <td className="p-4 text-right text-xs text-[var(--fg-dim)]">
                                                            {fmtCurrency(calcBase)}
                                                        </td>
                                                        <td className="p-4 text-right font-bold text-amber-500">
                                                            {fmtCurrency(item.irrfCalculado)}
                                                        </td>
                                                        <td className="p-4 text-right font-bold text-[var(--primary)]">
                                                            {fmtCurrency(item.ncFinal)}
                                                        </td>
                                                        <td className="p-4 text-right font-black text-white text-lg">
                                                            {fmtCurrency(item.boletoFinal)}
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {conciliacao.some(i => i.status === "MISSING") && (
                            <div className="bg-amber-950/20 border border-amber-900/30 p-4 rounded-2xl flex gap-3 text-amber-500 text-sm mt-4">
                                <AlertTriangle className="shrink-0" size={18} />
                                <p>Atenção: Algumas lojas não tiveram o XML correspondente no ZIP. O IRRF será considerado zero para estas lojas.</p>
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* ACTION FOOTER */}
            {lojas.length > 0 && (
                <footer className="fixed bottom-0 left-0 right-0 bg-[#0a0a0b]/90 backdrop-blur-2xl border-t border-[var(--border)] p-6 z-40 shadow-[0_-20px_50px_rgba(0,0,0,0.5)]">
                    <div className="max-w-7xl mx-auto flex justify-between items-center">
                        <div className="flex gap-8">
                            <div className="flex flex-col">
                                <span className="text-[10px] uppercase font-black text-[var(--fg-dim)] tracking-widest">Lojas Conciliadas</span>
                                <span className="text-2xl font-black text-white">
                                    {conciliacao.filter(i => i.status === "MATCH").length} <span className="text-[var(--fg-dim)] text-sm font-medium">/ {conciliacao.length}</span>
                                </span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] uppercase font-black text-[var(--fg-dim)] tracking-widest">Total Boleto Final</span>
                                <span className="text-2xl font-black text-[var(--primary)]">
                                    {fmtCurrency(conciliacao.reduce((acc, curr) => acc + curr.boletoFinal, 0))}
                                </span>
                            </div>
                        </div>

                        <div className="flex flex-col md:flex-row gap-3">
                            <button
                                onClick={handleExportarNFE}
                                className="btn btn-outline btn-success flex items-center gap-2 px-6 py-4 rounded-2xl font-bold uppercase tracking-tight transition-all hover:scale-105 active:scale-95 shadow-lg shadow-emerald-500/10"
                            >
                                <FileSearch size={18} /> Exportar Planilha NFE.io (.xlsx)
                            </button>

                            {lote?.status === "PENDENTE" || lote?.status === "AGUARDANDO_XML" ? (
                                <button
                                    disabled={isConsolidating || (lojas.length > 0 && conciliacao.length === 0)}
                                    onClick={handleConsolidar}
                                    className={`group relative overflow-hidden px-10 py-4 rounded-2xl font-black uppercase tracking-tighter text-sm flex items-center gap-3 transition-all enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_4px_20px_rgba(16,185,129,0.3)] 
                                        ${lojas.length > 0 && conciliacao.length === 0 ? 'bg-amber-500 text-black' : 'bg-emerald-500 text-black'} 
                                        hover:shadow-[0_0_30_rgba(16,185,129,0.5)]`}
                                >
                                    {isConsolidating ? (
                                        <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin"></div>
                                    ) : (
                                        <>
                                            {lojas.length > 0 && conciliacao.length === 0 ? "Aguardando XML (ZIP)" : "Confirmar e Consolidar Lote"}
                                            <Save size={18} />
                                        </>
                                    )}
                                    <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500 skew-x-12"></div>
                                </button>
                            ) : lote?.status === "CONSOLIDADO" ? (
                                <>
                                    <button
                                        onClick={() => router.push(`/faturamento/lote/${loteId}/conta-azul`)}
                                        className="group relative overflow-hidden bg-transparent border border-[#3b82f6] text-[#3b82f6] px-8 py-4 rounded-2xl font-black uppercase tracking-tighter text-sm flex items-center justify-center gap-3 transition-all hover:bg-[#3b82f6]/5 hover:scale-105 active:scale-95 shadow-lg shadow-[#3b82f6]/5"
                                    >
                                        Seguir para emissão de boletos
                                        <ArrowRight className="transition-transform group-hover:translate-x-1" size={18} />
                                    </button>

                                    <button
                                        onClick={() => handleDispararGCP("NC")}
                                        disabled={isConsolidating || isDispatching}
                                        className="group relative overflow-hidden bg-amber-500 text-black px-10 py-4 rounded-2xl font-black uppercase tracking-tighter text-sm flex items-center justify-center gap-3 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 shadow-[0_4px_20px_rgba(245,158,11,0.3)] hover:shadow-[0_0_30px_rgba(245,158,11,0.5)]"
                                    >
                                        {isDispatching ? (
                                            <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin"></div>
                                        ) : (
                                            <>
                                                Gerar Notas de Crédito (NC)
                                                <FileText size={18} />
                                            </>
                                        )}
                                        <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500 skew-x-12"></div>
                                    </button>

                                    <button
                                        onClick={() => handleDispararGCP("HC")}
                                        disabled={isConsolidating || isDispatching}
                                        className="group relative overflow-hidden bg-[#3b82f6] text-white px-10 py-4 rounded-2xl font-black uppercase tracking-tighter text-sm flex items-center justify-center gap-3 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 shadow-[0_4px_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)]"
                                    >
                                        {isDispatching ? (
                                            <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                                        ) : (
                                            <>
                                                Gerar Faturas / HC
                                                <Printer size={18} />
                                            </>
                                        )}
                                        <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500 skew-x-12"></div>
                                    </button>
                                </>
                            ) : (
                                <div className="flex items-center gap-2 text-emerald-500 font-black uppercase tracking-widest text-sm">
                                    <CheckCircle2 size={24} /> Lote Finalizado
                                </div>
                            )}
                        </div>
                    </div>
                </footer>
            )}

            <style jsx>{`
                @keyframes progress {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(250%); }
                }
            `}</style>
        </div >
    );
}
