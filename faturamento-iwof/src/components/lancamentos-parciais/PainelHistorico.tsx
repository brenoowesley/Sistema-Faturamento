"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ChevronDown, ChevronUp, FileText, Calendar, Box, Database, Receipt, ShieldAlert } from "lucide-react";
import "./historico.css";

interface LoteParcial {
    id: string;
    created_at: string;
    nome_arquivo: string;
    total_nfs: number;
    total_ncs: number;
    qtd_itens: number;
    notas: string;
}

interface ItemParcial {
    id: string;
    pedido: string;
    tipo: string;
    descricao: string;
    valor: number;
    loja_nome_sugerido: string;
    cnpj: string;
    periodo_servico: string;
    numero_nf_gerada: string;
    irrf: number;
}

export default function PainelHistorico() {
    const supabase = createClient();
    const [lotes, setLotes] = useState<LoteParcial[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedLoteId, setExpandedLoteId] = useState<string | null>(null);
    const [itensLote, setItensLote] = useState<ItemParcial[]>([]);
    const [loadingItens, setLoadingItens] = useState(false);

    useEffect(() => {
        carregarLotes();
    }, []);

    const carregarLotes = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from("lotes_parciais")
            .select("*")
            .order("created_at", { ascending: false });
        
        if (data) setLotes(data);
        if (error) console.error("Erro ao buscar lotes", error);
        setLoading(false);
    };

    const toggleLote = async (loteId: string) => {
        if (expandedLoteId === loteId) {
            setExpandedLoteId(null);
            setItensLote([]);
            return;
        }

        setExpandedLoteId(loteId);
        setLoadingItens(true);
        const { data, error } = await supabase
            .from("lancamentos_parciais_itens")
            .select("*")
            .eq("lote_id", loteId)
            .order("tipo", { ascending: false }); // NFs primeiro

        if (data) setItensLote(data);
        if (error) console.error("Erro ao buscar itens", error);
        setLoadingItens(false);
    };

    const fmtMoeda = (val: number) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const fmtData = (isoStr: string) => new Date(isoStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    return (
        <div className="glass-dashboard">
            <style jsx global>{`
                @import url('https://fonts.googleapis.com/css2?family=Syne:wght@500;700;800&display=swap');
            `}</style>
            
            <header className="gd-header">
                <div className="gd-title-area">
                    <Database size={28} className="gd-icon-glow" />
                    <h2 className="gd-title">Histórico de Lançamentos</h2>
                </div>
                <p className="gd-subtitle">Consulte o acervo de todos os lotes parciais processados e exportados.</p>
            </header>

            <main className="gd-content">
                {loading ? (
                    <div className="gd-loading">Carregando lotes...</div>
                ) : lotes.length === 0 ? (
                    <div className="gd-empty">
                        <ShieldAlert size={48} opacity={0.5} />
                        <p>Nenhum lote parcial encontrado no histórico.</p>
                    </div>
                ) : (
                    <div className="gd-list">
                        {lotes.map(lote => (
                            <div key={lote.id} className={`gd-card ${expandedLoteId === lote.id ? 'expanded' : ''}`}>
                                <div className="gd-card-header" onClick={() => toggleLote(lote.id)}>
                                    <div className="gd-card-left">
                                        <h3 className="gd-lote-title">
                                            <FileText size={18} />
                                            {lote.nome_arquivo || "Lote Sem Nome"}
                                        </h3>
                                        <div className="gd-lote-meta">
                                            <span><Calendar size={14}/> {fmtData(lote.created_at)}</span>
                                            <span><Box size={14}/> {lote.qtd_itens} Lançamentos</span>
                                        </div>
                                    </div>
                                    
                                    <div className="gd-card-right">
                                        <div className="gd-badges">
                                            <div className="gd-badge gd-badge-nf">
                                                <span className="gd-badge-label">Total NF</span>
                                                <span className="gd-badge-val">{fmtMoeda(Number(lote.total_nfs))}</span>
                                            </div>
                                            <div className="gd-badge gd-badge-nc">
                                                <span className="gd-badge-label">Total NC</span>
                                                <span className="gd-badge-val">{fmtMoeda(Number(lote.total_ncs))}</span>
                                            </div>
                                        </div>
                                        <button className="gd-expand-btn">
                                            {expandedLoteId === lote.id ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
                                        </button>
                                    </div>
                                </div>

                                {/* ACORDEON DETALHES */}
                                {expandedLoteId === lote.id && (
                                    <div className="gd-card-body">
                                        {loadingItens ? (
                                            <div className="gd-loading-small">Carregando detalhes...</div>
                                        ) : (
                                            <div className="gd-table-wrap">
                                                <table className="gd-table">
                                                    <thead>
                                                        <tr>
                                                            <th>Tipo</th>
                                                            <th>Loja</th>
                                                            <th>CNPJ</th>
                                                            <th>Pedido</th>
                                                            <th>Nº NF</th>
                                                            <th className="text-right">IRRF</th>
                                                            <th className="text-right">Valor Final</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {itensLote.map(item => (
                                                            <tr key={item.id}>
                                                                <td>
                                                                    <span className={`gd-tag ${item.tipo === 'NF' ? 'gd-tag-nf' : 'gd-tag-nc'}`}>
                                                                        <Receipt size={12} /> {item.tipo}
                                                                    </span>
                                                                </td>
                                                                <td className="font-medium text-white">{item.loja_nome_sugerido}</td>
                                                                <td className="text-gray-400">{item.cnpj}</td>
                                                                <td className="text-gray-400">{item.pedido || '-'}</td>
                                                                <td className="text-gray-400">{item.numero_nf_gerada || '-'}</td>
                                                                <td className="text-right text-gray-400">{item.irrf > 0 ? fmtMoeda(Number(item.irrf)) : '-'}</td>
                                                                <td className="text-right font-bold text-white">{fmtMoeda(Number(item.valor))}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
