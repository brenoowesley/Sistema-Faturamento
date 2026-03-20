"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Search, Filter, Calendar, FileText, ChevronRight, Loader2, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { useTransfeeraSync, TransfeeraStatus } from "@/hooks/useTransfeeraSync";

interface LoteSaque {
    id: string;
    nome_lote: string;
    tipo_saque: string;
    total_solicitado: number;
    total_real: number;
    status: string;
    created_at: string;
}

interface WorkerHistory {
    id: string; // id_integracao
    lote_id: string;
    nome_usuario: string;
    cpf_favorecido: string;
    chave_pix: string;
    valor: number;
    created_at: string; // we'll fetch from lote
    transfeera_transfer_id?: string;
}

export default function LotesDashboard() {
    const supabase = createClient();
    const router = useRouter();
    const [lotes, setLotes] = useState<LoteSaque[]>([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [searchNome, setSearchNome] = useState("");
    const [dataInicio, setDataInicio] = useState("");
    const [dataFim, setDataFim] = useState("");
    const [tipoFiltro, setTipoFiltro] = useState("");
    
    // Global Search State
    const [globalSearch, setGlobalSearch] = useState("");
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<WorkerHistory[]>([]);
    const [showSearchModal, setShowSearchModal] = useState(false);
    const { statuses, isSyncing, syncBatch, downloadReceipt } = useTransfeeraSync();

    useEffect(() => {
        fetchLotes();
    }, []);

    async function fetchLotes() {
        setLoading(true);
        const { data, error } = await supabase
            .from("lotes_saques")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Erro ao buscar lotes:", error);
        } else {
            setLotes(data || []);
        }
        setLoading(false);
    }

    async function handleGlobalSearch(e: React.FormEvent) {
        e.preventDefault();
        if (!globalSearch.trim()) return;
        
        setIsSearching(true);
        // Search across items for cpf or name
        const { data, error } = await supabase
            .from("itens_saque")
            .select(`
                id, 
                lote_id, 
                nome_usuario, 
                cpf_favorecido, 
                chave_pix, 
                valor,
                transfeera_transfer_id,
                lotes_saques ( created_at )
            `)
            .or(`nome_usuario.ilike.%${globalSearch}%,cpf_favorecido.ilike.%${globalSearch}%,cpf_conta.ilike.%${globalSearch}%`)
            .eq("status_item", "APROVADO")
            .order("id", { ascending: false })
            .limit(20);

        if (!error && data && data.length > 0) {
            const formatted: WorkerHistory[] = data.map((d: any) => ({
                id: d.id,
                lote_id: d.lote_id,
                nome_usuario: d.nome_usuario,
                cpf_favorecido: d.cpf_favorecido,
                chave_pix: d.chave_pix,
                valor: d.valor,
                transfeera_transfer_id: d.transfeera_transfer_id,
                created_at: d.lotes_saques?.created_at || new Date().toISOString()
            }));

            // sort by created_at desc
            formatted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

            setSearchResults(formatted);
            setShowSearchModal(true);
            
            // Trigger Transfeera Sync
            const syncItems = formatted.map(f => ({
                id_interno: f.id,
                transfeera_id: f.transfeera_transfer_id || null
            }));
            
            // Na pesquisa global não temos um único batch_id. 
            // Abortamos a sincronização síncrona, deixando que o webhook 
            // ou a tela de LoteDetalhe lide com as atualizações de batch.
            syncBatch(null, syncItems);
        } else {
            alert("Nenhum trabalhador (com saques exportados) encontrado com este termo.");
        }
        setIsSearching(false);
    }

    const filtered = lotes.filter(l => {
        let match = true;
        if (searchNome && !l.nome_lote.toLowerCase().includes(searchNome.toLowerCase())) match = false;
        if (tipoFiltro && l.tipo_saque !== tipoFiltro) match = false;
        if (dataInicio && new Date(l.created_at) < new Date(dataInicio)) match = false;
        if (dataFim) {
            const end = new Date(dataFim);
            end.setHours(23, 59, 59, 999);
            if (new Date(l.created_at) > end) match = false;
        }
        return match;
    });

    const tipos = Array.from(new Set(lotes.map(l => l.tipo_saque).filter(Boolean)));

    return (
        <div className="space-y-6">
            {/* Global Search Tool */}
            <div className="card" style={{ background: "linear-gradient(to right, rgba(33,118,255,0.05), transparent)", borderLeft: "4px solid var(--accent)" }}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h3 className="text-sm font-bold text-accent uppercase tracking-wider mb-1">Pesquisa Rápida Global</h3>
                        <p className="text-sm text-fg-dim">Procure um trabalhador em todos os lotes exportados pelo Nome ou CPF.</p>
                    </div>
                    <form onSubmit={handleGlobalSearch} className="flex gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" size={16} />
                            <input
                                type="text"
                                placeholder="CPF ou Nome Completo..."
                                className="input pl-10 w-full md:w-64"
                                value={globalSearch}
                                onChange={(e) => setGlobalSearch(e.target.value)}
                            />
                        </div>
                        <button type="submit" className="btn btn-primary" disabled={!globalSearch.trim() || isSearching}>
                            {isSearching ? <Loader2 className="animate-spin" size={16} /> : "Buscar"}
                        </button>
                    </form>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-4 items-end bg-bg-card p-4 rounded-lg border border-border">
                <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-semibold text-fg-dim mb-1 ml-1 uppercase">Nome do Lote</label>
                    <div className="relative">
                        <FileText className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" size={14} />
                        <input
                            type="text"
                            placeholder="Ex: Lote FEB-2026..."
                            className="input pl-9 w-full"
                            value={searchNome}
                            onChange={(e) => setSearchNome(e.target.value)}
                        />
                    </div>
                </div>
                <div>
                    <label className="block text-xs font-semibold text-fg-dim mb-1 ml-1 uppercase">Tipo</label>
                    <select className="input w-40" value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}>
                        <option value="">Todos</option>
                        {tipos.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-semibold text-fg-dim mb-1 ml-1 uppercase">Data Inicial</label>
                    <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" size={14} />
                        <input type="date" className="input pl-9" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
                    </div>
                </div>
                <div>
                    <label className="block text-xs font-semibold text-fg-dim mb-1 ml-1 uppercase">Data Final</label>
                    <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" size={14} />
                        <input type="date" className="input pl-9" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="card p-0 overflow-hidden">
                <table className="data-table w-full">
                    <thead>
                        <tr>
                            <th>Lote</th>
                            <th>Tipo</th>
                            <th>Data Criação</th>
                            <th>Valor Total (R$)</th>
                            <th>Status Banco</th>
                            <th className="text-right">Ação</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={6} className="text-center p-8 text-fg-muted">Carregando lotes...</td></tr>
                        ) : filtered.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="text-center p-12 text-fg-dim">
                                    <Filter size={24} className="mx-auto mb-2 opacity-30" />
                                    Nenhum lote encontrado com os filtros atuais.
                                </td>
                            </tr>
                        ) : (
                            filtered.map(l => (
                                <tr key={l.id} className="hover:bg-bg-highlight/50 transition-colors">
                                    <td className="font-semibold text-fg">{l.nome_lote}</td>
                                    <td>
                                        <span className="badge" style={{ background: "rgba(33,118,255,0.1)", color: "var(--accent)" }}>
                                            {l.tipo_saque}
                                        </span>
                                    </td>
                                    <td className="table-mono text-sm">{new Date(l.created_at).toLocaleDateString('pt-BR')}</td>
                                    <td className="font-bold text-accent">R$ {l.total_real?.toFixed(2)}</td>
                                    <td>
                                        <span className="badge badge-success">{l.status}</span>
                                    </td>
                                    <td className="text-right">
                                        <Link href={`/saques/acompanhamento/${l.id}`} className="btn btn-ghost px-3 py-1.5 text-xs inline-flex items-center gap-1">
                                            Ver Detalhes <ChevronRight size={14} />
                                        </Link>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal de Resultados da Pesquisa Global */}
            {showSearchModal && (
                <Modal 
                    isOpen={true} 
                    onClose={() => setShowSearchModal(false)}
                    title={`Histórico: ${globalSearch}`}
                >
                    <div className="space-y-4 max-w-4xl mx-auto w-full">
                        <p className="text-sm text-fg-dim">
                            Abaixo estão todos os saques exportados encontrados para este trabalhador.
                        </p>
                        
                        <div className="overflow-x-auto border border-border rounded-lg bg-bg-card">
                            <table className="w-full text-left text-sm">
                                <thead>
                                    <tr className="border-b border-border bg-black/20">
                                        <th className="p-3 font-semibold text-fg-muted uppercase text-xs">Data/Lote</th>
                                        <th className="p-3 font-semibold text-fg-muted uppercase text-xs">Colaborador</th>
                                        <th className="p-3 font-semibold text-fg-muted uppercase text-xs">Valor</th>
                                        <th className="p-3 font-semibold text-fg-muted uppercase text-xs">API Transfeera</th>
                                        <th className="p-3 font-semibold text-fg-muted uppercase text-xs text-center">PDF</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {searchResults.map(item => (
                                        <tr key={item.id} className="border-b border-border/50 hover:bg-bg-highlight/50">
                                            <td className="p-3">
                                                <div className="font-semibold text-fg text-xs">
                                                    {new Date(item.created_at).toLocaleDateString('pt-BR')}
                                                </div>
                                                <Link href={`/saques/acompanhamento/${item.lote_id}?highlight=${globalSearch}`} className="text-[10px] text-accent hover:underline flex items-center gap-1 mt-1">
                                                    Ir p/ Lote <ChevronRight size={10} />
                                                </Link>
                                            </td>
                                            <td className="p-3">
                                                <div className="font-medium text-fg">{item.nome_usuario}</div>
                                                <div className="text-xs text-fg-dim font-mono">{item.cpf_favorecido}</div>
                                            </td>
                                            <td className="p-3 font-bold text-fg">
                                                R$ {item.valor?.toFixed(2)}
                                            </td>
                                            <td className="p-3">
                                                <TransfeeraBadge status={statuses[item.id.toLowerCase()]} isSyncing={isSyncing} />
                                            </td>
                                            <td className="p-3 text-center">
                                                {statuses[item.id.toLowerCase()] === 'FINALIZADO' ? (
                                                    <button 
                                                        onClick={() => downloadReceipt(item.id, item.transfeera_transfer_id)}
                                                        className="btn btn-ghost mx-auto p-2 text-indigo-500 hover:bg-indigo-500/10 cursor-pointer transition-colors" 
                                                        title="Baixar Comprovativo PDF"
                                                    >
                                                        <FileText size={16} />
                                                    </button>
                                                ) : (
                                                    <button className="btn btn-ghost mx-auto p-2 opacity-40 cursor-not-allowed" disabled title="Não Disponível">
                                                        <FileText size={16} />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {searchResults.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="p-8 text-center text-fg-dim">Recherche falhou ao encontrar resultados.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex justify-end pt-2">
                            <button className="btn btn-ghost" onClick={() => setShowSearchModal(false)}>Fechar Histórico</button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
}

function TransfeeraBadge({ status, isSyncing }: { status?: TransfeeraStatus, isSyncing: boolean }) {
    if (isSyncing && !status) {
        return (
            <span className="badge inline-flex items-center gap-1 border border-border bg-bg text-fg-muted">
                <Loader2 size={12} className="animate-spin opacity-70" />
                Sincronizando...
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
            return <span className="badge text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 font-bold whitespace-nowrap">
                <CheckCircle2 size={12} /> Concluído
            </span>;
        case "EM_PROCESSAMENTO":
        case "AGENDADO":
            return <span className="badge text-indigo-500 bg-indigo-500/10 border border-indigo-500/20 font-bold whitespace-nowrap">Em Regulação</span>;
        case "DEVOLVIDO":
        case "FALHA":
            return <span className="badge text-red-500 bg-red-500/10 border border-red-500/20 font-bold whitespace-nowrap">Falhou</span>;
        default:
            return <span className="badge border border-border bg-bg text-fg-dim">Sem Status</span>;
    }
}
