"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Search, ArrowLeft, Download, FileText, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

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
}

interface LoteSaque {
    id: string;
    nome_lote: string;
    tipo_saque: string;
    total_real: number;
    status: string;
    created_at: string;
}

export default function LoteDetalhe({ loteId }: { loteId: string }) {
    const supabase = createClient();
    const searchParams = useSearchParams();
    const highlight = searchParams.get("highlight");

    const [lote, setLote] = useState<LoteSaque | null>(null);
    const [itens, setItens] = useState<SaqueItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState(highlight || "");

    useEffect(() => {
        if (highlight) {
            setSearchTerm(highlight);
        }
        fetchData();
    }, [loteId, highlight]);

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
        if (!searchTerm) return itens;
        const lowerSearch = searchTerm.toLowerCase();
        return itens.filter(i => 
            (i.nome_usuario?.toLowerCase().includes(lowerSearch)) ||
            (i.cpf_favorecido?.includes(searchTerm)) ||
            (i.cpf_conta?.includes(searchTerm))
        );
    }, [itens, searchTerm]);

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
                <div className="relative w-full sm:w-96">
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
                                            <span className="badge inline-flex items-center gap-1 border border-border bg-bg text-fg-muted">
                                                <CheckCircle2 size={12} className="opacity-50" />
                                                A Aguardar Sincronização
                                            </span>
                                        </td>
                                        <td className="text-center">
                                            <button className="btn btn-ghost mx-auto p-2 opacity-40 cursor-not-allowed" disabled title="Em breve">
                                                <FileText size={16} />
                                            </button>
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
