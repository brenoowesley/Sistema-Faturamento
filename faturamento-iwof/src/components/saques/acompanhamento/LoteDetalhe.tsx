"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Search, ArrowLeft, Download, FileText, CheckCircle2, Loader2, RefreshCw, Banknote, TrendingUp, ArrowDownCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTransfeeraSync } from "@/hooks/useTransfeeraSync";

interface SaqueItem {
    id: string;
    nome_usuario: string;
    cpf_conta: string;
    cpf_favorecido: string;
    chave_pix: string;
    tipo_pix: string;
    valor: number;
    valor_solicitado: number | null;
    status_item: string;
    status_transfeera?: string;
    motivo_bloqueio?: string;
    transfeera_transfer_id?: string;
}

interface LoteSaque {
    id: string;
    nome_lote: string;
    tipo_saque: string;
    total_real: number;
    status: string;
    created_at: string;
    transfeera_batch_id?: string;
}

export default function LoteDetalhe({ loteId }: { loteId: string }) {
    const supabase = createClient();
    const searchParams = useSearchParams();
    const highlight = searchParams.get("highlight");

    const [lote, setLote] = useState<LoteSaque | null>(null);
    const [itens, setItens] = useState<SaqueItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState(highlight || "");
    const [statusFilters, setStatusFilters] = useState<string[]>([]);

    const { isSyncing, syncBatch, downloadReceipt } = useTransfeeraSync();
    const hasAutoSynced = useRef(false); // Evita loop de auto-sync

    useEffect(() => {
        if (highlight) setSearchTerm(highlight);

        const loadAndAutoSync = async () => {
            setLoading(true);
            // 1. Carrega os dados iniciais rápidos da sua base de dados
            const { data: lData } = await supabase.from("lotes_saques").select("*").eq("id", loteId).single();
            if (lData) setLote(lData);

            const { data: iData } = await supabase.from("itens_saque").select("*").eq("lote_id", loteId).order("nome_usuario", { ascending: true });
            if (iData) setItens(iData);
            setLoading(false); // Libera a tela para o utilizador ver

            // 2. Faz o Auto-Sync na Transfeera de forma invisível (apenas na 1ª vez)
            if (!hasAutoSynced.current && lData?.transfeera_batch_id && iData && iData.length > 0) {
                hasAutoSynced.current = true;
                
                const syncItems = iData.map(item => ({
                    id: item.id,
                    transfeera_id: item.transfeera_transfer_id || null,
                }));
                
                const success = await syncBatch(lData.transfeera_batch_id, syncItems);
                if (success) {
                    // 3. Atualiza os dados da tabela silenciosamente (sem loading)
                    const { data: updatedItens } = await supabase.from("itens_saque").select("*").eq("lote_id", loteId).order("nome_usuario", { ascending: true });
                    if (updatedItens) setItens(updatedItens);
                }
            }
        };

        loadAndAutoSync();
    }, [loteId, highlight, syncBatch, supabase]);

    // O botão manual agora só recarrega a tabela após o sync
    const handleSincronizar = async () => {
        if (!itens || !lote?.transfeera_batch_id) return;
        const success = await syncBatch(lote.transfeera_batch_id, itens);
        if (success) {
            const { data } = await supabase.from("itens_saque").select("*").eq("lote_id", loteId).order("nome_usuario", { ascending: true });
            if (data) setItens(data);
        }
    };

    const filteredItens = useMemo(() => {
        let result = itens;

        if (statusFilters.length > 0) {
            result = result.filter(i => statusFilters.includes(i.status_item));
        }

        if (searchTerm) {
            const lowerSearch = searchTerm.toLowerCase();
            result = result.filter(i => 
                (i.nome_usuario?.toLowerCase().includes(lowerSearch)) ||
                (i.cpf_favorecido?.includes(searchTerm)) ||
                (i.cpf_conta?.includes(searchTerm))
            );
        }

        return result;
    }, [itens, searchTerm, statusFilters]);

    // ═══ Dynamic Financial Metrics (based on item-level status) ═══
    // These constants and the useMemo MUST be before any early returns (React Rules of Hooks)
    const SUCCESS_STATUSES = ["CONCLUIDO", "FINALIZADO", "EFETIVADO", "PAGO"];
    const FAIL_STATUSES = ["FALHA", "DEVOLVIDO", "REMOVIDO", "BLOQUEADO"];

    const financialMetrics = useMemo(() => {
        // Defensive: itens may be empty during initial load — fallback gracefully
        const safeItens = itens ?? [];
        const efetivados = safeItens.filter(i => SUCCESS_STATUSES.includes(i.status_item?.toUpperCase() || ""));
        const falhas = safeItens.filter(i => FAIL_STATUSES.includes(i.status_item?.toUpperCase() || ""));

        const vlrSolicitadoEfetivado = efetivados.reduce((s, i) => s + (Number(i.valor_solicitado) || Number(i.valor) || 0), 0);
        const vlrPagoReal = efetivados.reduce((s, i) => s + (Number(i.valor) || 0), 0);
        const receitaReal = vlrSolicitadoEfetivado - vlrPagoReal;
        const vlrDevolvido = falhas.reduce((s, i) => s + (Number(i.valor_solicitado) || Number(i.valor) || 0), 0);

        return { vlrSolicitadoEfetivado, vlrPagoReal, receitaReal, vlrDevolvido };
    }, [itens]);

    if (loading) {
        return <div className="p-12 text-center text-fg-muted font-mono">Carregando detalhes do lote...</div>;
    }

    if (!lote) {
        return (
            <div className="p-12 text-center">
                <h2 className="text-xl font-bold text-danger">Lote não encontrado</h2>
                <Link href="/saques/acompanhamento" className="text-accent hover:underline mt-4 inline-block">Voltar para o Dashboard</Link>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4 mb-2">
                <Link href="/saques/acompanhamento" className="btn btn-ghost px-2">
                    <ArrowLeft size={18} />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-fg flex items-center gap-3">
                        {lote.nome_lote}
                        <span className="badge" style={{ background: "rgba(33,118,255,0.1)", color: "var(--accent)" }}>
                            {lote.tipo_saque}
                        </span>
                    </h1>
                    <div className="flex items-center gap-4 mt-1">
                        <p className="text-sm text-fg-dim">Detalhes e acompanhamento dos {itens.length} pagamentos do lote.</p>
                        
                        <button
                            onClick={handleSincronizar}
                            disabled={isSyncing || !lote.transfeera_batch_id}
                            className={`btn btn-xs flex items-center gap-1.5 transition-all ${
                                isSyncing 
                                    ? 'bg-accent/20 text-accent cursor-not-allowed' 
                                    : 'bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20'
                            }`}
                        >
                            {isSyncing ? (
                                <Loader2 size={12} className="animate-spin" />
                            ) : (
                                <RefreshCw size={12} />
                            )}
                            {isSyncing ? "Sincronizando..." : "Sincronizar Status"}
                        </button>
                    </div>
                </div>
                <div className="ml-auto text-right">
                    <p className="text-xs font-semibold text-fg-dim uppercase tracking-wider mb-1">Total do Lote</p>
                    <p className="text-2xl font-bold text-accent">R$ {lote.total_real?.toFixed(2)}</p>
                </div>
            </div>

            {/* Financial Metric Cards — Dynamic Reconciliation */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="card" style={{ padding: "16px 20px", borderColor: "rgba(167,139,250,0.15)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <Banknote size={16} color="#a78bfa" />
                        <span style={{ fontSize: 10, color: "var(--fg-dim)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 }}>Vlr. Solicitado (Efetivado)</span>
                    </div>
                    <span style={{ fontSize: 22, fontWeight: 800, color: "#a78bfa" }}>R$ {financialMetrics.vlrSolicitadoEfetivado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="card" style={{ padding: "16px 20px", borderColor: "rgba(33,118,255,0.15)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <ArrowDownCircle size={16} color="#2176ff" />
                        <span style={{ fontSize: 10, color: "var(--fg-dim)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 }}>Valor Pago (Saída Real)</span>
                    </div>
                    <span style={{ fontSize: 22, fontWeight: 800, color: "#2176ff" }}>R$ {financialMetrics.vlrPagoReal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="card" style={{ padding: "16px 20px", borderColor: "rgba(34,197,94,0.15)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <TrendingUp size={16} color="#22c55e" />
                        <span style={{ fontSize: 10, color: "var(--fg-dim)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 }}>Receita Financeira Real</span>
                    </div>
                    <span style={{ fontSize: 22, fontWeight: 800, color: "#22c55e" }}>R$ {financialMetrics.receitaReal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="card" style={{ padding: "16px 20px", borderColor: "rgba(249,115,22,0.15)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <RotateCcw size={16} color="#f97316" />
                        <span style={{ fontSize: 10, color: "var(--fg-dim)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 }}>Valor Devolvido / Falhas</span>
                    </div>
                    <span style={{ fontSize: 22, fontWeight: 800, color: "#f97316" }}>R$ {financialMetrics.vlrDevolvido.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                </div>
            </div>

            {/* Toolbar */}
            <div className="card bg-bg-card p-4 rounded-lg flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex flex-col lg:flex-row gap-4 w-full flex-1">
                    <div className="relative w-full lg:w-80">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" size={16} />
                        <input
                            type="text"
                            placeholder="Procurar utilizador ou CPF neste lote..."
                            className="input pl-10 w-full"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            autoFocus={!!highlight}
                        />
                    </div>
                    <div className="flex flex-wrap gap-3 text-sm text-fg-dim items-center">
                        <span className="font-semibold text-xs uppercase tracking-wider">Filtrar:</span>
                        {[
                            { value: 'CONCLUIDO', label: 'Efetivados' },
                            { value: 'APROVADO', label: 'Em Processamento' },
                            { value: 'FALHA', label: 'Falhas' },
                            { value: 'BLOQUEADO', label: 'Bloqueados' },
                            { value: 'REMOVIDO', label: 'Cancelados' }
                        ].map(opt => (
                            <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer hover:text-fg transition-colors">
                                <input 
                                    type="checkbox" 
                                    className="accent-accent"
                                    checked={statusFilters.includes(opt.value)}
                                    onChange={(e) => {
                                        if (e.target.checked) setStatusFilters(prev => [...prev, opt.value]);
                                        else setStatusFilters(prev => prev.filter(v => v !== opt.value));
                                    }}
                                />
                                {opt.label}
                            </label>
                        ))}
                    </div>
                </div>
                <div className="text-sm text-fg-muted whitespace-nowrap">
                    Exibindo {filteredItens.length} de {itens.length} registros
                </div>
            </div>

            {/* Table */}
            <div className="card p-0 overflow-hidden">
                <table className="data-table w-full">
                    <thead>
                        <tr>
                            <th>Trabalhador</th>
                            <th>CPF</th>
                            <th>Chave PIX</th>
                            <th>Valor (R$)</th>
                            <th>Status Transfeera</th>
                            <th className="text-center">Comprovativo</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredItens.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="text-center p-12 text-fg-dim">
                                    Nenhum trabalhador encontrado com os filtros atuais.
                                </td>
                            </tr>
                        ) : (
                            filteredItens.map(item => {
                                const isHighlighted = highlight && searchTerm && (
                                    item.nome_usuario?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                    item.cpf_favorecido?.includes(searchTerm)
                                );
                                
                                return (
                                    <tr key={item.id} className={`hover:bg-bg-highlight/50 transition-colors ${isHighlighted ? 'bg-accent/10' : ''}`}>
                                        <td className="font-semibold text-fg text-sm">
                                            {item.nome_usuario || "—"}
                                            {item.status_item !== 'APROVADO' && (
                                                <span className="block text-xs text-danger mt-0.5">{item.motivo_bloqueio}</span>
                                            )}
                                        </td>
                                        <td className="table-mono text-sm">{item.cpf_favorecido}</td>
                                        <td>
                                            <div className="text-sm table-mono">{item.chave_pix}</div>
                                            <div className="text-xs text-fg-dim">{item.tipo_pix}</div>
                                        </td>
                                        <td className="font-bold text-fg">R$ {item.valor?.toFixed(2)}</td>
                                        <td>
                                            <TransfeeraBadge statusItem={item.status_item} isSyncing={isSyncing} />
                                        </td>
                                        <td className="text-center">
                                            {item.status_item !== 'REMOVIDO' && item.status_item === 'CONCLUIDO' ? (
                                                <button 
                                                    onClick={() => downloadReceipt(item.id, item.transfeera_transfer_id)}
                                                    className="btn btn-ghost mx-auto p-2 text-indigo-500 hover:bg-indigo-500/10 cursor-pointer transition-colors" 
                                                    title="Baixar Comprovativo PDF"
                                                >
                                                    <FileText size={16} />
                                                </button>
                                            ) : (
                                                <button className="btn btn-ghost mx-auto p-2 opacity-40 cursor-not-allowed" disabled title="Indisponível">
                                                    <FileText size={16} />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function TransfeeraBadge({ statusItem, isSyncing }: { statusItem: string, isSyncing: boolean }) {
    if (isSyncing) {
        return (
            <span className="badge inline-flex items-center gap-1 border border-border bg-bg text-fg-muted">
                <Loader2 size={12} className="animate-spin opacity-70" />
                A Sincronizar...
            </span>
        );
    }

    switch (statusItem) {
        case "CONCLUIDO":
            return (
                <span className="badge text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 font-bold flex items-center gap-1">
                    <CheckCircle2 size={12} /> Efetivado
                </span>
            );
        case "FALHA":
            return <span className="badge text-red-500 bg-red-500/10 border border-red-500/20 font-bold">Falhou / Devolvido</span>;
        case "REMOVIDO":
            return <span className="badge text-gray-500 bg-gray-500/10 border border-gray-500/20 font-bold">Cancelado</span>;
        case "APROVADO":
            return <span className="badge text-indigo-500 bg-indigo-500/10 border border-indigo-500/20 font-bold">Em Processamento</span>;
        case "BLOQUEADO":
            return <span className="badge text-orange-500 bg-orange-500/10 border border-orange-500/20 font-bold">Bloqueado Internamente</span>;
        default:
            return <span className="badge border border-border bg-bg text-fg-dim">Não Submetido</span>;
    }
}



