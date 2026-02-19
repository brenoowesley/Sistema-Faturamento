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
    Receipt
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
}

interface LojaConsolidada {
    id: string;
    razao_social: string;
    nome_fantasia: string | null;
    cnpj: string;
    valorBruto: number;
    acrescimos: number;
    descontos: number;
    ajustesDetalhes: AjusteItem[];
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

            // Fetch validated appointments (Paginated)
            let allAgendamentos: any[] = [];
            let from = 0;
            const step = 1000;
            let hasMore = true;

            while (hasMore) {
                const { data: chunk, error } = await supabase
                    .from("agendamentos_brutos")
                    .select("loja_id, valor_iwof, clientes(*)")
                    .eq("lote_id", loteId)
                    .eq("status_validacao", "VALIDADO")
                    .range(from, from + step - 1);

                if (error) {
                    console.error("Erro ao buscar agendamentos:", error);
                    break;
                }

                if (chunk && chunk.length > 0) {
                    allAgendamentos = [...allAgendamentos, ...chunk];
                    from += step;
                } else {
                    hasMore = false;
                }

                if (chunk && chunk.length < step) {
                    hasMore = false;
                }
            }

            const agendamentos = allAgendamentos;

            // Fetch adjustments ALREADY applied to this batch (marked in previous step)
            const { data: ajustes, error: ajErr } = await supabase
                .from("ajustes_faturamento")
                .select("*")
                .eq("lote_aplicado_id", loteId);

            if (ajErr) throw ajErr;

            const consolidatedMap = new Map<string, LojaConsolidada>();

            agendamentos.forEach(a => {
                const client = a.clientes as any;
                if (!consolidatedMap.has(a.loja_id)) {
                    consolidatedMap.set(a.loja_id, {
                        id: a.loja_id,
                        razao_social: client.razao_social,
                        nome_fantasia: client.nome_fantasia,
                        cnpj: client.cnpj,
                        valorBruto: 0,
                        acrescimos: 0,
                        descontos: 0,
                        ajustesDetalhes: []
                    });
                }
                const store = consolidatedMap.get(a.loja_id)!;
                store.valorBruto += Number(a.valor_iwof);
            });

            ajustes.forEach(aj => {
                const store = consolidatedMap.get(aj.cliente_id);
                if (store) {
                    if (aj.tipo === "ACRESCIMO") store.acrescimos += Number(aj.valor);
                    if (aj.tipo === "DESCONTO") store.descontos += Number(aj.valor);
                    store.ajustesDetalhes.push({
                        id: aj.id,
                        tipo: aj.tipo,
                        valor: aj.valor,
                        motivo: aj.motivo
                    });
                }
            });

            setLojas(Array.from(consolidatedMap.values()));

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

    // 2. ZIP Processing
    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        if (acceptedFiles.length === 0) return;
        const file = acceptedFiles[0];
        setProcessingZIP(true);

        try {
            const zip = new JSZip();
            const contents = await zip.loadAsync(file);
            const parser = new XMLParser({ ignoreAttributes: false });

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
                const irrf = matchedXML ? matchedXML.valorIR : 0;

                return {
                    loja,
                    xml: matchedXML,
                    status: matchedXML ? "MATCH" : "MISSING",
                    irrfCalculado: irrf,
                    boletoFinal: calcBase - irrf,
                    ncFinal: (calcBase * 0.885) - irrf
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

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { "application/zip": [".zip"] },
        multiple: false
    });

    // 4. Final Consolidation
    const handleConsolidar = async () => {
        if (!confirm("Confirmar valores e consolidar lote? Esta ação encerrará o faturamento deste lote.")) return;

        setIsConsolidating(true);
        try {
            for (const item of conciliacao) {
                const { error } = await supabase
                    .from("faturamento_consolidados")
                    .insert({
                        lote_id: loteId,
                        cliente_id: item.loja.id,
                        valor_bruto: item.loja.valorBruto,
                        acrescimos: item.loja.acrescimos,
                        descontos: item.loja.descontos,
                        valor_irrf: item.irrfCalculado,
                        numero_nf: item.xml?.numeroNF || null,
                        valor_nf_emitida: item.loja.valorBruto * 0.115, // NF base for reference
                        valor_nc_final: item.ncFinal,
                        valor_boleto_final: item.boletoFinal
                    });

                if (error) throw error;
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

    const handleDisparar = async () => {
        if (!confirm("Deseja disparar as tarefas de geração de documentos para o Google Cloud?")) return;

        setIsDispatching(true);
        try {
            const response = await fetch("/api/documentos/disparar-legado", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ loteId })
            });

            const result = await response.json();

            if (!response.ok) throw new Error(result.error || "Erro ao disparar tarefas.");

            alert("Tarefas enviadas com sucesso! Os PDFs aparecerão no Google Drive em poucos minutos.");
            fetchData(); // Refresh to show CONCLUÍDO status

        } catch (err: any) {
            console.error("Error dispatching:", err);
            alert("Erro ao disparar: " + err.message);
        } finally {
            setIsDispatching(false);
        }
    };

    const handleExportarNFE = () => {
        // Trigger download via window.location or hidden link
        const url = `/api/documentos/exportar-nfe?loteId=${loteId}`;
        window.open(url, "_blank");
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
                                            <th className="p-4">Loja / CNPJ</th>
                                            <th className="p-4">Status XML</th>
                                            <th className="p-4">Nº Nota</th>
                                            <th className="p-4 text-right">Cálculo Base</th>
                                            <th className="p-4 text-right text-amber-500">IRRF (XML)</th>
                                            <th className="p-4 text-right text-[var(--primary)]">NC Final</th>
                                            <th className="p-4 text-right text-white">Boleto Final</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {conciliacao.map(item => {
                                            const calcBase = (item.loja.valorBruto + item.loja.acrescimos) - item.loja.descontos;
                                            return (
                                                <tr key={item.loja.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                                                    <td className="p-4">
                                                        <div className="flex flex-col">
                                                            <span className="text-white font-bold text-sm">{item.loja.nome_fantasia || item.loja.razao_social}</span>
                                                            <span className="text-[10px] text-[var(--fg-dim)] font-mono">{item.loja.cnpj}</span>
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
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {conciliacao.some(i => i.status === "MISSING") && (
                            <div className="bg-amber-950/20 border border-amber-900/30 p-4 rounded-2xl flex gap-3 text-amber-500 text-sm">
                                <AlertTriangle className="shrink-0" size={18} />
                                <p>Atenção: Algumas lojas não tiveram o XML correspondente no ZIP. O IRRF será considerado zero para estas lojas.</p>
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* ACTION FOOTER */}
            {conciliacao.length > 0 && (
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

                        {lote?.status === "CONSOLIDADO" ? (
                            <div className="flex flex-col md:flex-row gap-3">
                                <button
                                    onClick={handleExportarNFE}
                                    className="btn btn-outline btn-success flex items-center gap-2 px-6 py-4 rounded-2xl font-bold uppercase tracking-tight transition-all hover:scale-105 active:scale-95"
                                >
                                    <FileSearch size={18} /> Exportar Planilha NFE.io (.xlsx)
                                </button>
                                <button
                                    onClick={() => router.push(`/faturamento/lote/${loteId}/conta-azul`)}
                                    className="group relative overflow-hidden bg-[#3b82f6] text-white px-10 py-4 rounded-2xl font-black uppercase tracking-tighter text-sm flex items-center justify-center gap-3 transition-all hover:scale-105 active:scale-95 shadow-[0_4px_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)]"
                                >
                                    Avançar para Conta Azul
                                    <ArrowRight className="transition-transform group-hover:translate-x-1" size={18} />
                                    <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500 skew-x-12"></div>
                                </button>
                            </div>
                        ) : lote?.status === "CONCLUÍDO" ? (
                            <div className="flex items-center gap-2 text-emerald-500 font-black uppercase tracking-widest text-sm">
                                <CheckCircle2 size={24} /> Lote Finalizado
                            </div>
                        ) : (
                            <button
                                disabled={isConsolidating}
                                onClick={handleConsolidar}
                                className="group relative overflow-hidden bg-emerald-500 text-black px-10 py-4 rounded-2xl font-black uppercase tracking-tighter text-sm flex items-center gap-3 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 shadow-[0_4px_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)]"
                            >
                                {isConsolidating ? (
                                    <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin"></div>
                                ) : (
                                    <>
                                        Confirmar e Consolidar Lote
                                        <Save size={18} />
                                    </>
                                )}
                                <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500 skew-x-12"></div>
                            </button>
                        )}
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
