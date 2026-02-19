"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
    ChevronLeft,
    Search,
    Download,
    Calendar,
    Settings2,
    CheckCircle2,
    Info,
    LayoutGrid,
    Table as TableIcon,
    Filter,
    ArrowRight,
    Edit3,
    FileSpreadsheet
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import * as xlsx from "xlsx";

/* ================================================================
   TYPES
   ================================================================ */

interface ContaAzulRow {
    id: string;
    dataCompetencia: string;
    dataVencimento: string;
    dataPagamento: string;
    valor: number;
    categoria: string;
    descricao: string;
    cliente: string;
    razao_social: string;
    nome_fantasia: string;
    cnpj: string;
    centroCusto: string;
    observacoes: string;
    // Original data for reference/filters
    estado: string;
}

interface Lote {
    id: string;
    data_inicio_ciclo: string;
    data_fim_ciclo: string;
    ciclo: string;
}

/* ================================================================
   PAGE COMPONENT
   ================================================================ */

const UF_MAP: Record<string, string> = {
    "AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas", "BA": "Bahia",
    "CE": "Ceará", "DF": "Distrito Federal", "ES": "Espírito Santo", "GO": "Goiás",
    "MA": "Maranhão", "MT": "Mato Grosso", "MS": "Mato Grosso do Sul", "MG": "Minas Gerais",
    "PA": "Pará", "PB": "Paraíba", "PR": "Paraná", "PE": "Pernambuco", "PI": "Piauí",
    "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte", "RS": "Rio Grande do Sul",
    "RO": "Rondônia", "RR": "Roraima", "SC": "Santa Catarina", "SP": "São Paulo",
    "SE": "Sergipe", "TO": "Tocantins"
};

export default function ContaAzulStagingPage() {
    const params = useParams();
    const router = useRouter();
    const loteId = params.id as string;
    const supabase = createClient();

    // State
    const [loading, setLoading] = useState(true);
    const [lote, setLote] = useState<Lote | null>(null);
    const [data, setData] = useState<ContaAzulRow[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Filters
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedState, setSelectedState] = useState("TODOS");
    /* ... (columnFilters unchanged) ... */
    const [columnFilters, setColumnFilters] = useState({
        dataCompetencia: "",
        dataVencimento: "",
        dataPagamento: "",
        valor: "",
        categoria: "",
        descricao: "",
        cliente: "",
        cnpj: "",
        centroCusto: "",
        observacoes: ""
    });

    // Bulk Edit State
    const [bulkData, setBulkData] = useState({
        dataCompetencia: new Date().toISOString().split('T')[0],
        dataVencimento: "",
        categoria: "",
        centroCusto: ""
    });

    // Fetch Data
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            // 1. Fetch Lote
            const { data: loteData, error: loteErr } = await supabase
                .from("faturamentos_lote")
                .select(`*, ciclos_faturamento(nome)`)
                .eq("id", loteId)
                .single();
            if (loteErr) throw loteErr;

            const currentLote: Lote = {
                id: loteData.id,
                data_inicio_ciclo: loteData.data_inicio_ciclo,
                data_fim_ciclo: loteData.data_fim_ciclo,
                ciclo: (loteData as any).ciclos_faturamento?.nome || "MENSAL"
            };
            setLote(currentLote);

            // 2. Fetch Consolidados
            const { data: records, error: recErr } = await supabase
                .from("faturamento_consolidados")
                .select(`
                    *,
                    clientes (*)
                `)
                .eq("lote_id", loteId);
            if (recErr) throw recErr;

            const fmtDate = (d: string) => {
                if (!d) return "";
                const [y, m, day] = d.split('-');
                return `${day}/${m}/${y}`;
            };

            const newMappedRows: ContaAzulRow[] = [];
            (records || []).forEach(r => {
                const c = r.clientes as any;
                const siglaEstado = c.estado?.toUpperCase() || "";
                const nomeEstado = UF_MAP[siglaEstado] || siglaEstado;

                // Cálculo automático de vencimento (Hoje + Prazo do cliente)
                const today = new Date();
                const prazo = c.tempo_pagamento_dias || 30;
                const venc = new Date(today);
                venc.setDate(today.getDate() + prazo);
                const vencimentoISO = venc.toISOString().split('T')[0];

                const baseRow = {
                    dataCompetencia: new Date().toISOString().split('T')[0],
                    dataVencimento: vencimentoISO,
                    dataPagamento: "",
                    categoria: `FATURAMENTO ${currentLote.ciclo.toUpperCase()}`,
                    descricao: `Horas consumidas de: ${fmtDate(currentLote.data_inicio_ciclo)} à ${fmtDate(currentLote.data_fim_ciclo)}`,
                    cliente: c.nome_fantasia || c.razao_social,
                    nome_fantasia: c.nome_fantasia || "",
                    razao_social: c.razao_social || "",
                    cnpj: c.cnpj,
                    centroCusto: nomeEstado,
                    estado: siglaEstado
                };

                if (!c.boleto_unificado && r.valor_nf_emitida > 0 && (r.valor_boleto_final - r.valor_nf_emitida) > 0) {
                    // Split into NF and NC
                    // 1. NF Line
                    newMappedRows.push({
                        ...baseRow,
                        id: `${r.id}_NF`,
                        valor: r.valor_nf_emitida,
                        observacoes: `[NF] NF - ${r.numero_nf || "PENDENTE"} | Ref: ${c.nome_fantasia || c.razao_social}`,
                    });
                    // 2. NC Line (Remainder)
                    newMappedRows.push({
                        ...baseRow,
                        id: `${r.id}_NC`,
                        valor: Number((r.valor_boleto_final - r.valor_nf_emitida).toFixed(2)),
                        observacoes: `[NC] Nota de Crédito | Ref: ${c.nome_fantasia || c.razao_social}`,
                    });
                } else {
                    // Unified or single value
                    newMappedRows.push({
                        ...baseRow,
                        id: r.id,
                        valor: r.valor_boleto_final,
                        observacoes: `NF - ${r.numero_nf || "PENDENTE"} R$${r.valor_nf_emitida?.toFixed(2) || "0.00"}`,
                    });
                }
            });

            setData(newMappedRows);
            setSelectedIds(new Set()); // Reset selection on fetch
        } catch (err) {
            console.error("Error fetching Conta Azul data:", err);
            alert("Erro ao carregar dados para o Conta Azul.");
        } finally {
            setLoading(false);
        }
    }, [loteId, supabase]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Suggestions for filters
    const filterSuggestions = useMemo(() => {
        const s = {
            dataCompetencia: new Set<string>(),
            dataVencimento: new Set<string>(),
            categoria: new Set<string>(),
            descricao: new Set<string>(),
            cliente: new Set<string>(),
            cnpj: new Set<string>(),
            centroCusto: new Set<string>(),
            observacoes: new Set<string>(),
        };

        data.forEach(row => {
            if (row.dataCompetencia) s.dataCompetencia.add(row.dataCompetencia);
            if (row.dataVencimento) s.dataVencimento.add(row.dataVencimento);
            if (row.categoria) s.categoria.add(row.categoria);
            if (row.descricao) s.descricao.add(row.descricao);
            if (row.cliente) s.cliente.add(row.cliente);
            if (row.cnpj) s.cnpj.add(row.cnpj);
            if (row.centroCusto) s.centroCusto.add(row.centroCusto);
            if (row.observacoes) s.observacoes.add(row.observacoes);
        });

        return {
            dataCompetencia: Array.from(s.dataCompetencia).sort(),
            dataVencimento: Array.from(s.dataVencimento).sort(),
            categoria: Array.from(s.categoria).sort(),
            descricao: Array.from(s.descricao).sort(),
            cliente: Array.from(s.cliente).sort(),
            cnpj: Array.from(s.cnpj).sort(),
            centroCusto: Array.from(s.centroCusto).sort(),
            observacoes: Array.from(s.observacoes).sort(),
        };
    }, [data]);

    // Format Currency for filter search
    const fmtCurrency = (val: number) =>
        new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);

    // Filtering
    const filteredData = useMemo(() => {
        return data.filter(row => {
            const matchesSearch =
                row.cliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
                row.razao_social.toLowerCase().includes(searchTerm.toLowerCase()) ||
                row.nome_fantasia.toLowerCase().includes(searchTerm.toLowerCase()) ||
                row.cnpj.replace(/\D/g, "").includes(searchTerm.replace(/\D/g, ""));

            const matchesState = selectedState === "TODOS" || row.estado === selectedState;

            // Column specific filters
            const matchesComp = row.dataCompetencia.includes(columnFilters.dataCompetencia);
            const matchesVenc = row.dataVencimento.includes(columnFilters.dataVencimento);
            const matchesValor = fmtCurrency(row.valor).includes(columnFilters.valor);
            const matchesCat = row.categoria.toLowerCase().includes(columnFilters.categoria.toLowerCase());
            const matchesDesc = row.descricao.toLowerCase().includes(columnFilters.descricao.toLowerCase());
            const matchesCliente = row.cliente.toLowerCase().includes(columnFilters.cliente.toLowerCase());
            const matchesCNPJ = row.cnpj.includes(columnFilters.cnpj.replace(/\D/g, ""));
            const matchesCC = row.centroCusto.toLowerCase().includes(columnFilters.centroCusto.toLowerCase());
            const matchesObs = row.observacoes.toLowerCase().includes(columnFilters.observacoes.toLowerCase());

            return matchesSearch && matchesState && matchesComp && matchesVenc && matchesValor &&
                matchesCat && matchesDesc && matchesCliente && matchesCNPJ && matchesCC && matchesObs;
        });
    }, [data, searchTerm, selectedState, columnFilters]);

    const states = useMemo(() => {
        const s = new Set(data.map(r => r.estado).filter(Boolean));
        return ["TODOS", ...Array.from(s).sort()];
    }, [data]);

    // Handlers
    const handleToggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleToggleAll = () => {
        const allFilteredIds = filteredData.map(f => f.id);
        const areAllSelected = allFilteredIds.every(id => selectedIds.has(id));

        if (areAllSelected) {
            setSelectedIds(prev => {
                const next = new Set(prev);
                allFilteredIds.forEach(id => next.delete(id));
                return next;
            });
        } else {
            setSelectedIds(prev => {
                const next = new Set(prev);
                allFilteredIds.forEach(id => next.add(id));
                return next;
            });
        }
    };

    const handleUpdateRow = (id: string, field: keyof ContaAzulRow, value: string) => {
        setData(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row));
    };

    const handleApplyBulk = () => {
        const targetIds = selectedIds.size > 0
            ? Array.from(selectedIds)
            : filteredData.map(f => f.id);

        if (targetIds.length === 0) {
            alert("Nenhuma linha selecionada ou filtrada para editar.");
            return;
        }

        if (!confirm(`Deseja aplicar estas alterações a ${targetIds.length} linhas selecionadas?`)) return;

        const targetSet = new Set(targetIds);
        setData(prev => prev.map(row => {
            if (targetSet.has(row.id)) {
                return {
                    ...row,
                    dataCompetencia: bulkData.dataCompetencia || row.dataCompetencia,
                    dataVencimento: bulkData.dataVencimento || row.dataVencimento,
                    categoria: bulkData.categoria || row.categoria,
                    centroCusto: bulkData.centroCusto || row.centroCusto
                };
            }
            return row;
        }));

        alert("Alterações em massa aplicadas!");
        if (selectedIds.size > 0) setSelectedIds(new Set());
    };

    const handleExport = () => {
        const fmtDateExt = (iso: string) => {
            if (!iso) return "";
            const [y, m, d] = iso.split('-');
            return `${d}/${m}/${y}`;
        };

        const exportData = filteredData.map(r => ({
            "Data de Competência": fmtDateExt(r.dataCompetencia),
            "Data de Vencimento": fmtDateExt(r.dataVencimento),
            "Data de Pagamento": r.dataPagamento,
            "Valor": r.valor,
            "Categoria": r.categoria,
            "Descrição": r.descricao,
            "Cliente/Fornecedor": r.cliente,
            "CNPJ/CPF Cliente/Fornecedor": r.cnpj,
            "Centro de Custo": r.centroCusto,
            "Observações": r.observacoes
        }));

        const ws = xlsx.utils.json_to_sheet(exportData);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, "Conta Azul");
        xlsx.writeFile(wb, `conta_azul_lote_${loteId.slice(0, 8)}.xlsx`);
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
                <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-4">
                        <button onClick={() => router.back()} className="p-2 hover:bg-[var(--bg-card)] rounded-full transition-colors text-[var(--fg-dim)]">
                            <ChevronLeft size={24} />
                        </button>
                        <div>
                            <h1 className="text-xl font-black text-white uppercase tracking-tighter flex items-center gap-2">
                                <FileSpreadsheet className="text-[#3b82f6]" size={24} />
                                Preparação Conta Azul
                            </h1>
                            <p className="text-[var(--fg-dim)] text-xs flex items-center gap-2">
                                Staging Area do Lote: <span className="text-white font-mono">{loteId.slice(0, 8)}...</span>
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleExport}
                            className="btn btn-primary bg-emerald-600 hover:bg-emerald-500 border-none flex items-center gap-2 px-8 py-3 rounded-xl font-bold uppercase tracking-tight transition-all hover:scale-105 active:scale-95 shadow-[0_4px_20px_rgba(16,185,129,0.3)]"
                        >
                            <Download size={18} /> Exportar Conta Azul (.xlsx)
                        </button>
                    </div>
                </div>
            </div>

            <main className="max-w-[1600px] mx-auto p-6 space-y-8">

                {/* BULK EDIT PANEL */}
                <section className="bg-[var(--bg-card)] rounded-3xl border border-[var(--border)] p-6 shadow-2xl">
                    <div className="flex items-center gap-2 mb-6">
                        <div className="p-2 bg-[#3b82f6]/10 rounded-lg text-[#3b82f6]">
                            <Settings2 size={20} />
                        </div>
                        <h2 className="text-lg font-bold text-white uppercase tracking-tight">Edição em Massa (Bulk Edit)</h2>
                        <span className="ml-auto text-xs text-[var(--fg-dim)] bg-white/5 px-3 py-1 rounded-full border border-white/5">
                            {selectedIds.size > 0
                                ? `Afetará ${selectedIds.size} linhas selecionadas`
                                : `Afetará ${filteredData.length} linhas filtradas`}
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] ml-1">Data Competência</label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-dim)]" size={16} />
                                <input
                                    type="date"
                                    value={bulkData.dataCompetencia}
                                    onChange={e => setBulkData({ ...bulkData, dataCompetencia: e.target.value })}
                                    className="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-xl py-3 pl-10 pr-4 text-white text-sm focus:border-[#3b82f6] outline-none transition-all"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] ml-1">Data Vencimento</label>
                            <input
                                type="date"
                                value={bulkData.dataVencimento}
                                onChange={e => setBulkData({ ...bulkData, dataVencimento: e.target.value })}
                                className="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-xl py-3 px-4 text-white text-sm focus:border-[#3b82f6] outline-none transition-all"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] ml-1">Categoria</label>
                            <input
                                type="text"
                                placeholder="Ex: FATURAMENTO MENSAL"
                                value={bulkData.categoria}
                                onChange={e => setBulkData({ ...bulkData, categoria: e.target.value.toUpperCase() })}
                                className="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-xl py-3 px-4 text-white text-sm focus:border-[#3b82f6] outline-none transition-all"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] ml-1">Centro de Custo</label>
                            <input
                                type="text"
                                placeholder="Ex: RN"
                                value={bulkData.centroCusto}
                                onChange={e => setBulkData({ ...bulkData, centroCusto: e.target.value.toUpperCase() })}
                                className="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-xl py-3 px-4 text-white text-sm focus:border-[#3b82f6] outline-none transition-all"
                            />
                        </div>
                        <div className="flex items-end">
                            <button
                                onClick={handleApplyBulk}
                                className="w-full h-[46px] bg-[#3b82f6] text-white rounded-xl font-bold text-sm uppercase flex items-center justify-center gap-2 hover:bg-[#2563eb] transition-all active:scale-95 shadow-lg shadow-[#3b82f6]/20"
                            >
                                <CheckCircle2 size={18} /> {selectedIds.size > 0 ? "Aplicar aos Selecionados" : "Aplicar aos Filtrados"}
                            </button>
                        </div>
                    </div>
                </section>

                {/* TABLE FILTERS */}
                <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                    <div className="relative w-full md:w-96">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--fg-dim)]" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar cliente ou CNPJ..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl py-3 pl-12 pr-4 text-white outline-none focus:border-[#3b82f6] shadow-inner"
                        />
                    </div>
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <div className="flex items-center gap-2 text-xs font-bold text-[var(--fg-dim)] uppercase">
                            <Filter size={14} /> Filtrar Estado:
                        </div>
                        <select
                            value={selectedState}
                            onChange={e => setSelectedState(e.target.value)}
                            className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl py-2 px-4 text-white text-sm outline-none cursor-pointer hover:border-[#3b82f6] transition-all"
                        >
                            {states.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                </div>

                {/* INTERACTIVE TABLE */}
                <div className="bg-[var(--bg-card)] rounded-3xl border border-[var(--border)] shadow-2xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[1200px]">
                            <thead>
                                <tr className="bg-[var(--bg-main)]/50 text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest border-b border-[var(--border)]">
                                    <th className="p-4 w-10 text-center">
                                        <input
                                            type="checkbox"
                                            checked={filteredData.length > 0 && filteredData.every(f => selectedIds.has(f.id))}
                                            onChange={handleToggleAll}
                                            className="w-4 h-4 rounded border-[var(--border)] bg-[var(--bg-main)] text-[#3b82f6] focus:ring-[#3b82f6] cursor-pointer"
                                        />
                                    </th>
                                    <th className="p-4 w-32">
                                        <div className="flex flex-col gap-1">
                                            Competência
                                            <input type="text" list="list-comp" placeholder="Filtrar..." value={columnFilters.dataCompetencia} onChange={e => setColumnFilters({ ...columnFilters, dataCompetencia: e.target.value })} className="bg-[var(--bg-main)] border border-[var(--border)] rounded px-1 py-0.5 text-[9px] font-normal text-white outline-none" />
                                            <datalist id="list-comp">
                                                {filterSuggestions.dataCompetencia.map(s => <option key={s} value={s} />)}
                                            </datalist>
                                        </div>
                                    </th>
                                    <th className="p-4 w-32">
                                        <div className="flex flex-col gap-1">
                                            Vencimento
                                            <input type="text" list="list-venc" placeholder="Filtrar..." value={columnFilters.dataVencimento} onChange={e => setColumnFilters({ ...columnFilters, dataVencimento: e.target.value })} className="bg-[var(--bg-main)] border border-[var(--border)] rounded px-1 py-0.5 text-[9px] font-normal text-white outline-none" />
                                            <datalist id="list-venc">
                                                {filterSuggestions.dataVencimento.map(s => <option key={s} value={s} />)}
                                            </datalist>
                                        </div>
                                    </th>
                                    <th className="p-4 w-28 text-center text-red-500/50">Pagamento</th>
                                    <th className="p-4 w-32 text-right">
                                        <div className="flex flex-col gap-1 items-end">
                                            Valor
                                            <input type="text" placeholder="R$..." value={columnFilters.valor} onChange={e => setColumnFilters({ ...columnFilters, valor: e.target.value })} className="bg-[var(--bg-main)] border border-[var(--border)] rounded px-1 py-0.5 text-[9px] font-normal text-white outline-none w-20 text-right" />
                                        </div>
                                    </th>
                                    <th className="p-4">
                                        <div className="flex flex-col gap-1">
                                            Categoria
                                            <input type="text" list="list-cat" placeholder="Filtrar..." value={columnFilters.categoria} onChange={e => setColumnFilters({ ...columnFilters, categoria: e.target.value })} className="bg-[var(--bg-main)] border border-[var(--border)] rounded px-1 py-0.5 text-[9px] font-normal text-white outline-none" />
                                            <datalist id="list-cat">
                                                {filterSuggestions.categoria.map(s => <option key={s} value={s} />)}
                                            </datalist>
                                        </div>
                                    </th>
                                    <th className="p-4">
                                        <div className="flex flex-col gap-1">
                                            Descrição
                                            <input type="text" list="list-desc" placeholder="Filtrar..." value={columnFilters.descricao} onChange={e => setColumnFilters({ ...columnFilters, descricao: e.target.value })} className="bg-[var(--bg-main)] border border-[var(--border)] rounded px-1 py-0.5 text-[9px] font-normal text-white outline-none" />
                                            <datalist id="list-desc">
                                                {filterSuggestions.descricao.map(s => <option key={s} value={s} />)}
                                            </datalist>
                                        </div>
                                    </th>
                                    <th className="p-4">
                                        <div className="flex flex-col gap-1">
                                            Cliente / CNPJ
                                            <input type="text" list="list-cliente" placeholder="Filtrar..." value={columnFilters.cliente} onChange={e => setColumnFilters({ ...columnFilters, cliente: e.target.value })} className="bg-[var(--bg-main)] border border-[var(--border)] rounded px-1 py-0.5 text-[9px] font-normal text-white outline-none" />
                                            <datalist id="list-cliente">
                                                {filterSuggestions.cliente.map(s => <option key={s} value={s} />)}
                                            </datalist>
                                        </div>
                                    </th>
                                    <th className="p-4 w-24 text-center">
                                        <div className="flex flex-col gap-1 items-center">
                                            CC
                                            <input type="text" list="list-cc" placeholder="UF" value={columnFilters.centroCusto} onChange={e => setColumnFilters({ ...columnFilters, centroCusto: e.target.value })} className="bg-[var(--bg-main)] border border-[var(--border)] rounded px-1 py-0.5 text-[9px] font-normal text-white outline-none w-16 text-center" />
                                            <datalist id="list-cc">
                                                {filterSuggestions.centroCusto.map(s => <option key={s} value={s} />)}
                                            </datalist>
                                        </div>
                                    </th>
                                    <th className="p-4 min-w-[200px]">
                                        <div className="flex flex-col gap-1">
                                            Observações
                                            <input type="text" list="list-obs" placeholder="Filtrar..." value={columnFilters.observacoes} onChange={e => setColumnFilters({ ...columnFilters, observacoes: e.target.value })} className="bg-[var(--bg-main)] border border-[var(--border)] rounded px-1 py-0.5 text-[9px] font-normal text-white outline-none" />
                                            <datalist id="list-obs">
                                                {filterSuggestions.observacoes.map(s => <option key={s} value={s} />)}
                                            </datalist>
                                        </div>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredData.map(row => (
                                    <tr key={row.id} className={`border-b border-[var(--border)]/50 transition-colors group ${selectedIds.has(row.id) ? 'bg-[#3b82f6]/5' : 'hover:bg-white/[0.02]'}`}>
                                        <td className="p-4 text-center">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(row.id)}
                                                onChange={() => handleToggleSelect(row.id)}
                                                className="w-4 h-4 rounded border-[var(--border)] bg-[var(--bg-main)] text-[#3b82f6] focus:ring-[#3b82f6] cursor-pointer"
                                            />
                                        </td>
                                        <td className="p-2">
                                            <input
                                                type="date"
                                                value={row.dataCompetencia}
                                                onChange={e => handleUpdateRow(row.id, "dataCompetencia", e.target.value)}
                                                className="w-full bg-transparent p-2 text-xs text-white rounded outline-none border border-transparent focus:border-[#3b82f6]/50 focus:bg-white/5"
                                            />
                                        </td>
                                        <td className="p-2">
                                            <input
                                                type="date"
                                                value={row.dataVencimento}
                                                onChange={e => handleUpdateRow(row.id, "dataVencimento", e.target.value)}
                                                className="w-full bg-transparent p-2 text-xs text-white rounded outline-none border border-transparent focus:border-[#3b82f6]/50 focus:bg-white/5"
                                                placeholder="Definir..."
                                            />
                                        </td>
                                        <td className="p-4 text-center text-xs text-white/20 italic">
                                            Sempre Vazio
                                        </td>
                                        <td className="p-4 text-right">
                                            <span className="text-white font-black text-sm">
                                                {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(row.valor)}
                                            </span>
                                        </td>
                                        <td className="p-2">
                                            <input
                                                type="text"
                                                value={row.categoria}
                                                onChange={e => handleUpdateRow(row.id, "categoria", e.target.value.toUpperCase())}
                                                className="w-full bg-transparent p-2 text-xs text-white rounded outline-none border border-transparent focus:border-[#3b82f6]/50 focus:bg-white/5 font-medium"
                                            />
                                        </td>
                                        <td className="p-2">
                                            <input
                                                type="text"
                                                value={row.descricao}
                                                onChange={e => handleUpdateRow(row.id, "descricao", e.target.value)}
                                                className="w-full bg-transparent p-2 text-[10px] text-[var(--fg-dim)] group-hover:text-white rounded outline-none border border-transparent focus:border-[#3b82f6]/50 focus:bg-white/5 transition-colors"
                                            />
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-col max-w-[250px]">
                                                <span className="text-white font-extrabold text-sm truncate uppercase tracking-tighter" title={row.cliente}>
                                                    {row.cliente}
                                                </span>
                                                <span className="text-[10px] text-[var(--fg-dim)] font-mono">{row.cnpj}</span>
                                            </div>
                                        </td>
                                        <td className="p-2 text-center">
                                            <input
                                                type="text"
                                                value={row.centroCusto}
                                                onChange={e => handleUpdateRow(row.id, "centroCusto", e.target.value.toUpperCase())}
                                                className="w-12 mx-auto bg-transparent p-2 text-xs text-amber-500 font-black text-center rounded outline-none border border-transparent focus:border-[#3b82f6]/50 focus:bg-white/5"
                                            />
                                        </td>
                                        <td className="p-2">
                                            <input
                                                type="text"
                                                value={row.observacoes}
                                                onChange={e => handleUpdateRow(row.id, "observacoes", e.target.value)}
                                                className="w-full bg-transparent p-2 text-[10px] text-[var(--fg-dim)] font-mono rounded outline-none border border-transparent focus:border-[#3b82f6]/50 focus:bg-white/5"
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="flex justify-between items-center text-[10px] text-[var(--fg-dim)] uppercase font-bold tracking-widest px-4">
                    <span>Exibindo {filteredData.length} de {data.length} registros</span>
                    <div className="flex items-center gap-2">
                        <Info size={12} className="text-[#3b82f6]" />
                        Clique nas células para edição individual
                    </div>
                </div>

            </main>
        </div>
    );
}
