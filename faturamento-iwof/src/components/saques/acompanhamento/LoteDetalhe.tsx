"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Search, ArrowLeft, Download, FileText, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTransfeeraSync, TransfeeraStatus } from "@/hooks/useTransfeeraSync";

interface SaqueItem {
    id: string;
    nome_usuario: string;
    cpf_conta: string;
    cpf_favorecido: string;
    chave_pix: string;
    tipo_pix: string;
    valor: number;
    status_item: string;
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
    const [statusFilter, setStatusFilter] = useState("TODOS");

    const { statuses, isSyncing, syncBatch, downloadReceipt } = useTransfeeraSync();

    useEffect(() => {
        if (highlight) {
            setSearchTerm(highlight);
        }
        fetchData();
    }, [loteId, highlight]);

    // Sincronizar com Transfeera após carregar itens
    useEffect(() => {
        if (!itens || itens.length === 0) return;
        const approvedItems = itens.filter(i => i.status_item === 'APROVADO' || i.status_item === 'EM_PROCESSAMENTO' || i.status_item === 'AGENDADO' || i.status_item === 'RETORNADO' || i.status_item === 'FALHA');
        if (approvedItems.length === 0) return;

        // Mapear para o novo formato de sincronização
        const syncItems = approvedItems.map(item => ({
            id_interno: item.id,
            transfeera_id: item.transfeera_transfer_id || null
        }));

        console.log(`[LoteDetalhe] ⚡ Tentando sincronizar ${syncItems.length} itens:`, syncItems);

        syncBatch(lote?.transfeera_batch_id || null, syncItems);
    }, [itens, lote, syncBatch]);

    async function fetchData() {
        setLoading(true);
        // Fetch Lote
        const { data: loteData, error: loteErr } = await supabase
            .from("lotes_saques")
            .select("*")
            .eq("id", loteId)
            .single();

        if (loteData) setLote(loteData);

        // Fetch Itens
        const { data: itensData, error: itensErr } = await supabase
            .from("itens_saque")
            .select("*")
            .eq("lote_id", loteId)
            .order("nome_usuario", { ascending: true });

        if (itensData) setItens(itensData);

        setLoading(false);
    }

    const filteredItens = useMemo(() => {
        let result = itens;

        if (statusFilter === "EXPORTADOS") {
            result = result.filter(i => i.status_item === "APROVADO");
        } else if (statusFilter === "REMOVIDOS") {
            result = result.filter(i => i.status_item !== "APROVADO");
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
    }, [itens, searchTerm, statusFilter]);

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
                    <p className="text-sm text-fg-dim">Detalhes e acompanhamento dos {itens.length} pagamentos do lote.</p>
                </div>
                <div className="ml-auto text-right">
                    <p className="text-xs font-semibold text-fg-dim uppercase tracking-wider mb-1">Total do Lote</p>
                    <p className="text-2xl font-bold text-accent">R$ {lote.total_real?.toFixed(2)}</p>
                </div>
            </div>

            {/* Toolbar */}
            <div className="card bg-bg-card p-4 rounded-lg flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto flex-1">
                    <div className="relative w-full sm:w-80">
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
                    <select 
                        className="input w-full sm:w-48"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="TODOS">Todos os Registros</option>
                        <option value="EXPORTADOS">Apenas Exportados</option>
                        <option value="REMOVIDOS">Removidos / Bloqueados</option>
                    </select>
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
                                            {item.status_item === 'APROVADO' ? (
                                                <TransfeeraBadge status={statuses[item.id.toLowerCase()]} isSyncing={isSyncing} />
                                            ) : (
                                                <span className="badge badge-danger text-xs px-2 py-0.5" title="Não enviado para transfeera">
                                                    Removido da Exportação
                                                </span>
                                            )}
                                        </td>
                                        <td className="text-center">
                                            {item.status_item === 'APROVADO' && statuses[item.id.toLowerCase()] === 'FINALIZADO' ? (
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

function TransfeeraBadge({ status, isSyncing }: { status?: TransfeeraStatus, isSyncing: boolean }) {
    if (isSyncing && !status) {
        return (
            <span className="badge inline-flex items-center gap-1 border border-border bg-bg text-fg-muted">
                <Loader2 size={12} className="animate-spin opacity-70" />
                A Sincronizar...
            </span>
        );
    }

    if (!status || status === "NAO_SUBMETIDO") {
         return (
            <span className="badge inline-flex items-center gap-1 border border-border bg-bg text-fg-dim">
                Não Submetida
            </span>
        );
    }

    switch (status) {
        case "FINALIZADO":
        case "EFETIVADO":
            return (
                <span className="badge text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 font-bold flex items-center gap-1">
                    <CheckCircle2 size={12} /> Concluído
                </span>
            );
        case "EM_PROCESSAMENTO":
        case "AGENDADO":
            return <span className="badge text-indigo-500 bg-indigo-500/10 border border-indigo-500/20 font-bold">Em Regulação</span>;
        case "DEVOLVIDO":
        case "FALHA":
            return <span className="badge text-red-500 bg-red-500/10 border border-red-500/20 font-bold">Pagamento Falhou</span>;
        case "ERRO_CONSULTA":
            return <span className="badge text-orange-500 bg-orange-500/10 border border-orange-500/20 font-bold">Erro Transfeera</span>;
        case "ERRO_REDE":
            return <span className="badge text-orange-500 bg-orange-500/10 border border-orange-500/20 font-bold">Erro de Rede</span>;
        default:
            if ((status as any)?.startsWith("ERRO_")) {
                return (
                    <span className="badge text-orange-500 bg-orange-500/10 border border-orange-500/20 font-bold" title="Erro HTTP da API">
                        Transfeera {(status as any).replace("ERRO_", "")}
                    </span>
                );
            }
            return <span className="badge border border-border bg-bg text-fg-dim">A Aguardar Sincronização</span>;
    }
}



