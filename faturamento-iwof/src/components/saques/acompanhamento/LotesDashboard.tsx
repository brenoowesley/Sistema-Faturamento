"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Search, Filter, Calendar, FileText, ChevronRight, Download } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface LoteSaque {
    id: string;
    nome_lote: string;
    tipo_saque: string;
    total_solicitado: number;
    total_real: number;
    status: string;
    created_at: string;
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
    const [globalSearch, setGlobalSearch] = useState("");

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
        // Search across items for cpf or name
        const { data, error } = await supabase
            .from("itens_saque")
            .select("lote_id, nome_usuario, cpf_favorecido, cpf_conta")
            .or(`nome_usuario.ilike.%${globalSearch}%,cpf_favorecido.ilike.%${globalSearch}%,cpf_conta.ilike.%${globalSearch}%`)
            .limit(1);

        if (!error && data && data.length > 0) {
            router.push(`/saques/acompanhamento/${data[0].lote_id}?highlight=${encodeURIComponent(globalSearch)}`);
        } else {
            alert("Nenhum trabalhador encontrado com este termo.");
        }
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
                        <button type="submit" className="btn btn-primary" disabled={!globalSearch.trim()}>Buscar</button>
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
        </div>
    );
}
