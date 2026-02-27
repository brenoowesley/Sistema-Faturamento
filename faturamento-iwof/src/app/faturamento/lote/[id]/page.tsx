"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
    ChevronLeft,
    Search,
    Info,
    CheckCircle2,
    XCircle,
    ArrowRight,
    Building2,
    DollarSign,
    Calculator,
    AlertCircle,
    FileText,
    Receipt,
    FileSearch,
    Trash2
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/* ================================================================
   TYPES
   ================================================================ */

interface Lote {
    id: string;
    data_competencia: string;
    data_inicio_ciclo: string;
    data_fim_ciclo: string;
    status: string;
}

interface AjusteItem {
    id: string;
    tipo: "ACRESCIMO" | "DESCONTO" | "IRRF";
    valor: number;
    motivo: string;
    cliente_id: string;
}

interface LojaConsolidada {
    id: string;
    razao_social: string;
    nome_fantasia: string | null;
    nome_conta_azul: string | null;
    cnpj: string;
    valorBase: number;
    acrescimos: number;
    descontos: number;
    ajustesDetalhes: AjusteItem[];
    active: boolean;
    ciclo: string;
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

export default function LoteFechamentoPage() {
    const params = useParams();
    const router = useRouter();
    const loteId = params.id as string;
    const supabase = createClient();

    // State
    const [lote, setLote] = useState<Lote | null>(null);
    const [loading, setLoading] = useState(true);
    const [lojas, setLojas] = useState<LojaConsolidada[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [isClosing, setIsClosing] = useState(false);
    const [rejeitados, setRejeitados] = useState<{ loja_id: string; razao_social: string; cnpj: string; motivo: string }[]>([]);
    const [userRole, setUserRole] = useState<string | null>(null);

    // Initial Data Fetch
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            // 0. User Role
            const { data: { user: authUser } } = await supabase.auth.getUser();
            if (authUser) {
                const { data: perfil } = await supabase
                    .from("usuarios_perfis")
                    .select("cargo")
                    .eq("id", authUser.id)
                    .single();
                setUserRole(perfil?.cargo || "USER");
            }
            // 1. Lote Details
            const { data: loteData, error: loteErr } = await supabase
                .from("faturamentos_lote")
                .select("*")
                .eq("id", loteId)
                .single();

            if (loteErr) throw loteErr;
            setLote(loteData);

            // 2. Fetch Validated Appointments (Paginated)
            let allAgendamentos: any[] = [];
            let from = 0;
            const step = 1000;
            let hasMore = true;

            while (hasMore) {
                const { data: chunk, error } = await supabase
                    .from("agendamentos_brutos")
                    .select("loja_id, valor_iwof, clientes(*, ciclos_faturamento(nome))")
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

            // 2.5 Fetch missing/rejected records that couldn't be correctly billed
            const { data: missingRecords, error: missingErr } = await supabase
                .from("agendamentos_brutos")
                .select("loja_id, status_validacao, cnpj_loja, clientes(razao_social, cnpj, endereco, bairro, cidade, estado, cep)")
                .eq("lote_id", loteId);

            if (!missingErr && missingRecords) {
                const missingMap = new Map<string, { loja_id: string; razao_social: string; cnpj: string; motivo: string }>();

                missingRecords.forEach(rec => {
                    const client = rec.clientes as any;
                    const cnpj = client?.cnpj || rec.cnpj_loja || "Desconhecido";
                    const razao = client?.razao_social || "Empresa Desconhecida";

                    if (!client) {
                        missingMap.set(cnpj, { loja_id: rec.loja_id, razao_social: razao, cnpj, motivo: "Cliente não cadastrado no sistema" });
                        return;
                    }

                    if (rec.status_validacao !== "VALIDADO") {
                        missingMap.set(cnpj, { loja_id: rec.loja_id, razao_social: razao, cnpj, motivo: `Status do agendamento: ${rec.status_validacao}` });
                        return;
                    }

                    // Verifica se faltam dados fiscais cruciais (Endereço completo)
                    const faltaEndereco = !client.endereco || !client.bairro || !client.cidade || !client.estado || !client.cep;
                    if (faltaEndereco) {
                        missingMap.set(cnpj, { loja_id: rec.loja_id, razao_social: razao, cnpj, motivo: "Dados de endereço incompletos (Rua, Bairro, Cidade, UF ou CEP)" });
                        return;
                    }
                });

                const rejeitadosList = Array.from(missingMap.values());
                setRejeitados(rejeitadosList);

                if (rejeitadosList.length > 0) {
                    console.group("%c🚨 Lojas Afastadas do Fechamento Fiscal", "color: white; background: #e11d48; font-weight: bold; border-radius: 4px; padding: 2px 6px;");
                    console.table(rejeitadosList.map(r => ({
                        "Empresa": r.razao_social,
                        "CNPJ": r.cnpj,
                        "Motivo do Bloqueio": r.motivo
                    })));
                    console.groupEnd();
                }
            }

            // 3. Get unique store IDs involved
            const storeIds = Array.from(new Set(agendamentos.map(a => a.loja_id)));

            // 4. Fetch Pending Adjustments for these stores
            const { data: ajustes, error: ajErr } = await supabase
                .from("ajustes_faturamento")
                .select("*")
                .in("cliente_id", storeIds)
                .eq("status_aplicacao", false);

            if (ajErr) throw ajErr;

            // 5. Group and Consolidate
            console.log("📦 [AUDITORIA] Total de itens brutos recebidos para agrupamento:", agendamentos.length);
            const consolidatedMap = new Map<string, LojaConsolidada>();

            agendamentos.forEach(a => {
                const client = a.clientes as any;

                if (!a.loja_id || !client?.cnpj) {
                    console.warn("⚠️ [ITEM DESCARTADO NO AGRUPAMENTO]:", {
                        nome: client?.razao_social || "Sem Razão Social",
                        cnpj: client?.cnpj,
                        loja_id: a.loja_id,
                        motivo: "Falta CNPJ ou ID da Loja para agrupar"
                    });
                }

                if (!consolidatedMap.has(a.loja_id)) {
                    consolidatedMap.set(a.loja_id, {
                        id: a.loja_id,
                        razao_social: client.razao_social,
                        nome_fantasia: client.nome_fantasia,
                        nome_conta_azul: client.nome_conta_azul,
                        cnpj: client.cnpj,
                        valorBase: 0,
                        acrescimos: 0,
                        descontos: 0,
                        ajustesDetalhes: [],
                        active: true,
                        ciclo: client.ciclos_faturamento?.nome || "-"
                    });
                }
                const store = consolidatedMap.get(a.loja_id)!;
                store.valorBase += Number(a.valor_iwof) || 0;
            });

            ajustes.forEach(aj => {
                const store = consolidatedMap.get(aj.cliente_id);
                if (store) {
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

            const finalLojas = Array.from(consolidatedMap.values());
            console.log("DADOS AGRUPADOS (DEBUG):", {
                totalAgendamentos: agendamentos.length,
                totalLojas: finalLojas.length,
                detalhes: finalLojas
            });
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

    // Financial calculations
    const filteredLojas = useMemo(() => {
        const lowerSearch = searchTerm.toLowerCase();
        return lojas.filter(l =>
            l.razao_social.toLowerCase().includes(lowerSearch) ||
            l.nome_fantasia?.toLowerCase().includes(lowerSearch) ||
            l.nome_conta_azul?.toLowerCase().includes(lowerSearch) ||
            l.cnpj.includes(searchTerm)
        );
    }, [lojas, searchTerm]);

    const totals = useMemo(() => {
        const boleto = lojas.reduce((acc, curr) => acc + (curr.valorBase + curr.acrescimos) - curr.descontos, 0);
        return {
            boleto,
            nf: boleto * 0.115,
            nc: boleto * 0.885
        };
    }, [lojas]);

    // Actions
    const handleToggleLoja = (id: string) => {
        setLojas(prev => prev.map(l => l.id === id ? { ...l, active: !l.active } : l));
    };

    const handleToggleAll = () => {
        const allFilteredActive = filteredLojas.every(l => l.active);
        const targetIds = new Set(filteredLojas.map(l => l.id));

        setLojas(prev => prev.map(l => {
            if (targetIds.has(l.id)) {
                return { ...l, active: !allFilteredActive };
            }
            return l;
        }));
    };

    const handleFecharLote = async () => {
        if (!confirm("Deseja realmente fechar este lote? Esta ação marcará os ajustes como aplicados e avançará para o fiscal.")) return;

        setIsClosing(true);
        try {
            // 0. Save inactive stores to localStorage to pass to the next screen
            const lojasSemNF = lojas.filter(l => !l.active).map(l => l.id);
            localStorage.setItem(`lojas_sem_nf_${loteId}`, JSON.stringify(lojasSemNF));

            // 1. Get all adjustments ids from ALL stores (toggle only affects NF emission)
            const adjustmentIds = lojas.flatMap(l => l.ajustesDetalhes.map(aj => aj.id));

            // 2. Mark adjustments as applied
            if (adjustmentIds.length > 0) {
                const { error: ajErr } = await supabase
                    .from("ajustes_faturamento")
                    .update({
                        status_aplicacao: true,
                        data_aplicacao: new Date().toISOString().split("T")[0],
                        lote_aplicado_id: loteId
                    })
                    .in("id", adjustmentIds);

                if (ajErr) throw ajErr;
            }

            // 3. Update Lote status
            const { error: loteErr } = await supabase
                .from("faturamentos_lote")
                .update({ status: "AGUARDANDO_XML" })
                .eq("id", loteId);

            if (loteErr) throw loteErr;

            alert("Lote fechado com sucesso!");
            router.push(`/faturamento/lote/${loteId}/fiscal`);

        } catch (err) {
            console.error("Error closing batch:", err);
            alert("Erro ao fechar lote.");
        } finally {
            setIsClosing(false);
        }
    };

    const handleDeleteLote = async () => {
        if (userRole === "ADMIN") {
            if (!confirm("Tem certeza que deseja EXCLUIR este lote permanentemente? Isso resetará os ajustes vinculados.")) return;

            const { error } = await supabase.rpc('safe_delete_lote', { target_lote_id: loteId });
            if (error) {
                alert("Erro ao excluir lote: " + error.message);
            } else {
                alert("Lote excluído com sucesso!");
                router.push("/");
            }
        } else {
            const reason = prompt("Informe o motivo para a solicitação de exclusão:");
            if (!reason) return;

            const { data: { user } } = await supabase.auth.getUser();
            const { error } = await supabase
                .from("faturamentos_lote")
                .update({
                    delete_requested_at: new Date().toISOString(),
                    delete_requested_by: user?.id,
                    delete_reason: reason,
                    delete_request_status: 'PENDING'
                })
                .eq("id", loteId);

            if (error) {
                alert("Erro ao solicitar exclusão: " + error.message);
            } else {
                alert("Solicitação de exclusão enviada ao administrador.");
                fetchData();
            }
        }
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
            {/* Header Toolbar */}
            <div className="sticky top-0 z-30 bg-[var(--bg-main)]/80 backdrop-blur-md border-b border-[var(--border)] p-4 shadow-xl">
                <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-4">
                        <button onClick={() => router.back()} className="btn-icon">
                            <ChevronLeft className="icon-high-contrast" size={24} />
                        </button>
                        <button
                            onClick={handleDeleteLote}
                            className="btn-icon text-red-500 hover:bg-red-500/10"
                            title={userRole === "ADMIN" ? "Excluir Lote" : "Solicitar Exclusão"}
                        >
                            <Trash2 className="icon-high-contrast" size={24} />
                        </button>
                        <div>
                            <h1 className="text-xl font-black text-white uppercase tracking-tighter flex items-center gap-2">
                                <Calculator className="text-[var(--primary)]" size={24} />
                                Fechamento Financeiro
                            </h1>
                            <p className="text-[var(--fg-dim)] text-xs flex items-center gap-2">
                                Lote: <span className="text-white font-mono">{loteId.slice(0, 8)}...</span>
                                <span className="mx-1 opacity-20">|</span>
                                Competência: <span className="text-white font-bold">{lote ? fmtDate(lote.data_competencia) : "-"}</span>
                            </p>
                        </div>
                    </div>

                    <div className="relative w-full md:w-96">
                        <Search className="absolute left-3 top-2.5 text-white/90 stroke-[2.5px]" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar loja, CNPJ ou razão social..."
                            className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white pl-10 pr-4 py-2 rounded-xl text-sm focus:border-[var(--primary)] outline-none transition-all shadow-inner"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <main className="max-w-7xl mx-auto p-6 space-y-6">

                {/* ALERTA LOJAS REJEITADAS */}
                {rejeitados.length > 0 && (
                    <div className="bg-red-950/20 border border-red-900/30 p-5 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-4 text-red-400 text-sm shadow-xl relative overflow-hidden">
                        <div className="absolute inset-0 bg-red-500/5 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 skew-x-12"></div>
                        <div className="flex gap-4 items-center z-10">
                            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 shrink-0">
                                <XCircle size={24} />
                            </div>
                            <div>
                                <h3 className="font-black text-red-400 text-base mb-1 uppercase tracking-tight">Lojas Ausentes do Fechamento</h3>
                                <p className="text-red-300/80">Existem <strong>{rejeitados.length} lojas</strong> que não foram consolidadas por irregularidades na validação inicial ou falta de dados de cadastro (endereço incompleto).</p>
                            </div>
                        </div>
                        <button
                            onClick={handleExportarRejeitados}
                            className="shrink-0 btn px-6 py-3 rounded-2xl bg-red-900/20 border border-red-900/50 text-red-300 hover:bg-red-500 hover:text-white transition-all flex items-center gap-2 font-bold uppercase tracking-tight shadow-lg z-10"
                        >
                            <FileSearch size={18} /> Ver Detalhes (.xlsx)
                        </button>
                    </div>
                )}

                {/* Main calculation Table */}
                <div className="bg-[var(--bg-card)] rounded-3xl border border-[var(--border)] shadow-2xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[var(--bg-main)]/50 text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest border-b border-[var(--border)]">
                                    <th className="p-4 w-28 text-center bg-white/5">
                                        <div className="flex flex-col items-center gap-2">
                                            <span>Emitir NF</span>
                                            <button
                                                onClick={handleToggleAll}
                                                className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${filteredLojas.every(l => l.active) ? 'bg-[var(--primary)] text-white border-[var(--primary)]' : 'bg-transparent text-[var(--fg-dim)] border-[var(--border)] hover:border-[var(--primary)]'}`}
                                            >
                                                {filteredLojas.every(l => l.active) ? 'Desmarcar Todos' : 'Marcar Todos'}
                                            </button>
                                        </div>
                                    </th>
                                    <th className="p-4">Cliente / Loja</th>
                                    <th className="p-4 text-center">Ciclo</th>
                                    <th className="p-4 text-right">Valor Base</th>
                                    <th className="p-4 text-right">Acréscimos</th>
                                    <th className="p-4 text-right">Descontos</th>
                                    <th className="p-4 text-right text-white">Boleto Final</th>
                                    <th className="p-4 text-right text-[var(--primary)]">NF (11,5%)</th>
                                    <th className="p-4 text-right text-emerald-500">NC (88,5%)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredLojas.map(loja => {
                                    const boletoLoja = (loja.valorBase + loja.acrescimos) - loja.descontos;
                                    return (
                                        <tr
                                            key={loja.id}
                                            className={`border-b border-[var(--border)]/50 transition-all duration-300 ${!loja.active ? 'opacity-60 bg-black/10' : 'hover:bg-white/[0.02]'}`}
                                        >
                                            <td className="p-4 text-center">
                                                <div
                                                    onClick={(e) => { e.stopPropagation(); handleToggleLoja(loja.id); }}
                                                    className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-all duration-300 relative pointer-events-auto ${loja.active ? 'bg-[var(--primary)]' : 'bg-zinc-700'}`}
                                                >
                                                    <div className={`w-4 h-4 bg-white rounded-full transition-all duration-300 ${loja.active ? 'translate-x-6' : 'translate-x-0'}`}></div>
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col">
                                                    <span className="text-white font-bold text-sm tracking-tight">{loja.nome_conta_azul}</span>
                                                    <span className="text-[10px] text-[var(--fg-dim)] lowercase opacity-80 leading-tight">
                                                        {loja.razao_social} • {loja.cnpj}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="p-4 text-center text-xs font-semibold text-[var(--fg-dim)] uppercase tracking-wider">{loja.ciclo}</td>
                                            <td className="p-4 text-right text-sm font-medium text-white/70">{fmtCurrency(loja.valorBase)}</td>

                                            {/* ACRESCIMOS WITH TOOLTIP */}
                                            <td className="p-4 text-right text-sm font-bold text-[var(--primary)] group relative">
                                                <div className="flex items-center justify-end gap-1">
                                                    {loja.acrescimos > 0 && <Info size={12} className="text-white ring-1 ring-white/20 rounded-full" />}
                                                    {fmtCurrency(loja.acrescimos)}
                                                </div>
                                                {loja.ajustesDetalhes.filter(aj => aj.tipo === "ACRESCIMO").length > 0 && (
                                                    <div className="invisible group-hover:visible absolute z-50 bottom-full right-0 mb-2 w-64 p-3 bg-zinc-900 border border-[var(--border)] rounded-xl shadow-2xl animate-in fade-in slide-in-from-bottom-2">
                                                        <p className="text-[8px] uppercase font-black text-[var(--primary)] mb-2 tracking-tighter">Detalhes dos Acréscimos</p>
                                                        <div className="space-y-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                                                            {loja.ajustesDetalhes.filter(aj => aj.tipo === "ACRESCIMO").map(aj => (
                                                                <div key={aj.id} className="border-b border-white/5 pb-1 last:border-0">
                                                                    <div className="flex justify-between items-start">
                                                                        <span className="text-[10px] text-white leading-tight">{aj.motivo}</span>
                                                                        <span className="text-[10px] font-bold text-[var(--primary)] ml-2">{fmtCurrency(aj.valor)}</span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </td>

                                            {/* DESCONTOS WITH TOOLTIP */}
                                            <td className="p-4 text-right text-sm font-bold text-amber-500 group relative">
                                                <div className="flex items-center justify-end gap-1">
                                                    {loja.descontos > 0 && <Info size={12} className="text-white ring-1 ring-white/20 rounded-full" />}
                                                    {fmtCurrency(loja.descontos)}
                                                </div>
                                                {loja.ajustesDetalhes.filter(aj => aj.tipo === "DESCONTO").length > 0 && (
                                                    <div className="invisible group-hover:visible absolute z-50 bottom-full right-0 mb-2 w-64 p-3 bg-zinc-900 border border-[var(--border)] rounded-xl shadow-2xl animate-in fade-in slide-in-from-bottom-2">
                                                        <p className="text-[8px] uppercase font-black text-amber-500 mb-2 tracking-tighter">Detalhes dos Descontos</p>
                                                        <div className="space-y-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                                                            {loja.ajustesDetalhes.filter(aj => aj.tipo === "DESCONTO").map(aj => (
                                                                <div key={aj.id} className="border-b border-white/5 pb-1 last:border-0">
                                                                    <div className="flex justify-between items-start">
                                                                        <span className="text-[10px] text-white leading-tight">{aj.motivo}</span>
                                                                        <span className="text-[10px] font-bold text-amber-500 ml-2">{fmtCurrency(aj.valor)}</span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </td>

                                            <td className="p-4 text-right text-lg font-black text-white">{fmtCurrency(boletoLoja)}</td>
                                            <td className="p-4 text-right text-sm font-bold text-[var(--primary)]">{fmtCurrency(boletoLoja * 0.115)}</td>
                                            <td className="p-4 text-right text-sm font-bold text-emerald-500">{fmtCurrency(boletoLoja * 0.885)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {
                        filteredLojas.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-20 bg-white/5">
                                <AlertCircle size={48} className="text-[var(--fg-dim)] opacity-20 mb-4" />
                                <p className="text-[var(--fg-dim)] font-medium">Nenhuma loja encontrada neste lote ou filtro.</p>
                            </div>
                        )
                    }
                </div >
            </main >

            {/* FIXED FOOTER TOTALS */}
            < footer className="fixed bottom-0 left-0 right-0 bg-[#0a0a0b]/90 backdrop-blur-2xl border-t border-[var(--border)] p-6 z-40 shadow-[0_-20px_50px_rgba(0,0,0,0.5)]" >
                <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">

                    {/* Totals Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 w-full md:w-auto">
                        <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-black text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                <Receipt size={12} className="text-white" /> Total Boletos
                            </span>
                            <span className="text-2xl font-black text-white">{fmtCurrency(totals.boleto)}</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-black text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                <FileText size={12} className="text-[var(--primary)]" /> Total NF (11,5%)
                            </span>
                            <span className="text-2xl font-black text-[var(--primary)]">{fmtCurrency(totals.nf)}</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-black text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                <FileText size={12} className="text-emerald-500" /> Total NC (88,5%)
                            </span>
                            <span className="text-2xl font-black text-emerald-500">{fmtCurrency(totals.nc)}</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-black text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                <Building2 size={12} className="text-white" /> Lojas Faturadas
                            </span>
                            <span className="text-2xl font-black text-white">{filteredLojas.length}</span>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-4 w-full md:w-auto justify-end">
                        {/* Show simple navigation if already closed */}
                        {lote && lote.status !== "PENDENTE" && lote.status !== "ABERTO" && (
                            <button
                                onClick={() => router.push(`/faturamento/lote/${loteId}/fiscal`)}
                                className="group relative overflow-hidden bg-[var(--bg-card)] border border-[var(--border)] text-white px-6 py-4 rounded-xl font-bold uppercase tracking-tighter text-xs flex items-center justify-center gap-2 hover:bg-white/5 active:scale-95 transition-all"
                            >
                                Ir para Fiscal <ArrowRight size={14} />
                            </button>
                        )}

                        <button
                            disabled={isClosing || totals.boleto === 0 || !!(lote && lote.status !== "PENDENTE" && lote.status !== "ABERTO")}
                            onClick={handleFecharLote}
                            className="group relative w-full md:w-auto overflow-hidden bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white px-10 py-4 rounded-2xl font-black uppercase tracking-tighter text-sm flex items-center justify-center gap-3 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed shadow-[0_4px_20px_rgba(99,102,241,0.3)] hover:shadow-[0_0_30px_rgba(99,102,241,0.5)]"
                        >
                            {isClosing ? (
                                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                            ) : (
                                <>
                                    Fechar Lote e Avançar para Fiscal
                                    <ArrowRight className="transition-transform group-hover:translate-x-1" size={18} />
                                </>
                            )}
                            <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500 skew-x-12"></div>
                        </button>
                    </div>
                </div>
            </footer >

            <style jsx>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.2);
                }
            `}</style>
        </div >
    );
}
