"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
    Trash2,
    ExternalLink,
    ChevronLeft,
    Calendar,
    Search,
    AlertCircle,
    CheckCircle2,
    Clock,
    FileText
} from "lucide-react";
import { useRouter } from "next/navigation";

/* ================================================================
   TYPES
   ================================================================ */

interface Lote {
    id: string;
    created_at: string;
    data_competencia: string;
    data_inicio_ciclo: string;
    data_fim_ciclo: string;
    status: "ABERTO" | "FECHADO" | "ENVIADO" | "PENDENTE" | "AGUARDANDO_XML" | "CONCLUIDO";
    total_lojas?: number;
    total_valor?: number;
}

/* ================================================================
   UTILS
   ================================================================ */

const fmtDate = (dateStr: string) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return d.toLocaleDateString("pt-BR");
};

const fmtDateTime = (dateStr: string) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' })}`;
};

const getStatusColor = (status: string) => {
    switch (status) {
        case "ABERTO": return "text-blue-400 bg-blue-400/10 border-blue-400/20";
        case "PENDENTE": return "text-yellow-400 bg-yellow-400/10 border-yellow-400/20";
        case "AGUARDANDO_XML": return "text-purple-400 bg-purple-400/10 border-purple-400/20";
        case "FECHADO": return "text-emerald-400 bg-emerald-400/10 border-emerald-400/20";
        case "ENVIADO": return "text-green-500 bg-green-500/10 border-green-500/20";
        default: return "text-zinc-400 bg-zinc-400/10 border-zinc-400/20";
    }
};

/* ================================================================
   PAGE COMPONENT
   ================================================================ */

export default function LoteHistoryPage() {
    const router = useRouter();
    const supabase = createClient();

    // State
    const [lotes, setLotes] = useState<Lote[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");

    // Fetch Lotes
    const fetchLotes = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("faturamentos_lote")
                .select("*")
                .order("created_at", { ascending: false });

            if (error) throw error;
            setLotes(data || []);
        } catch (err) {
            console.error("Error fetching lotes:", err);
            alert("Erro ao carregar histórico de lotes.");
        } finally {
            setLoading(false);
        }
    }, [supabase]);

    useEffect(() => {
        fetchLotes();
    }, [fetchLotes]);

    // Actions
    const handleDeleteLote = async (id: string) => {
        if (!confirm("TEM CERTEZA? Isso apagará permanentemente o lote e todos os dados associados. Esta ação não pode ser desfeita.")) return;

        try {
            const { error } = await supabase
                .from("faturamentos_lote")
                .delete()
                .eq("id", id);

            if (error) throw error;

            setLotes(prev => prev.filter(l => l.id !== id));
            alert("Lote excluído com sucesso.");
        } catch (err) {
            console.error("Error deleting lote:", err);
            alert("Erro ao excluir lote. Verifique se existem dependências.");
        }
    };

    const handleOpenLote = (id: string) => {
        router.push(`/faturamento/lote/${id}`);
    };

    const filteredLotes = lotes.filter(l =>
        l.id.includes(searchTerm) ||
        l.status.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (l.data_competencia && l.data_competencia.includes(searchTerm))
    );

    if (loading) {
        return (
            <div className="min-h-screen bg-[var(--bg-main)] flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[var(--primary)]"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--bg-main)] p-6 pb-32">
            <div className="max-w-7xl mx-auto space-y-8">

                {/* Header */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <button
                            onClick={() => router.push('/faturamento')}
                            className="flex items-center gap-2 text-[var(--fg-dim)] hover:text-white transition-colors mb-2 text-sm font-medium"
                        >
                            <ChevronLeft size={16} /> Voltar para Dashboard
                        </button>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
                            <Clock className="text-[var(--primary)]" size={32} />
                            Histórico de Lotes
                        </h1>
                        <p className="text-[var(--fg-dim)] mt-1">
                            Gerencie todos os lotes de faturamento gerados.
                        </p>
                    </div>

                    <div className="relative w-full md:w-80">
                        <Search className="absolute left-3 top-3 text-[var(--fg-dim)]" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar por ID, status ou data..."
                            className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white pl-10 pr-4 py-3 rounded-xl focus:border-[var(--primary)] outline-none transition-all shadow-lg"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {/* List */}
                <div className="grid gap-4">
                    {filteredLotes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 bg-[var(--bg-card)] rounded-3xl border border-[var(--border)] border-dashed opacity-50">
                            <AlertCircle size={48} className="text-[var(--fg-dim)] mb-4" />
                            <p className="text-[var(--fg-dim)] font-medium">Nenhum lote encontrado.</p>
                        </div>
                    ) : (
                        filteredLotes.map(lote => (
                            <div
                                key={lote.id}
                                className="group bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 hover:border-[var(--primary)]/30 transition-all shadow-lg hover:shadow-[0_0_30px_rgba(0,0,0,0.3)] relative overflow-hidden"
                            >
                                <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--primary)]/5 rounded-full blur-3xl translate-x-16 -translate-y-16 group-hover:bg-[var(--primary)]/10 transition-all"></div>

                                <div className="flex flex-col gap-1 relative z-10">
                                    <div className="flex items-center gap-3 mb-1">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border ${getStatusColor(lote.status)}`}>
                                            {lote.status.replace("_", " ")}
                                        </span>
                                        <span className="text-[10px] text-[var(--fg-dim)] font-mono">ID: {lote.id}</span>
                                    </div>
                                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                        <Calendar size={18} className="text-[var(--primary)]" />
                                        Competência: {fmtDate(lote.data_competencia)}
                                    </h3>
                                    <div className="flex items-center gap-4 text-xs text-[var(--fg-dim)] mt-1">
                                        <span title="Início do Ciclo">Início: {fmtDate(lote.data_inicio_ciclo)}</span>
                                        <span className="opacity-20">|</span>
                                        <span title="Fim do Ciclo">Fim: {fmtDate(lote.data_fim_ciclo)}</span>
                                        <span className="opacity-20">|</span>
                                        <span title="Criado em">Criado: {fmtDateTime(lote.created_at)}</span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 w-full md:w-auto mt-2 md:mt-0 relative z-10">
                                    <button
                                        onClick={() => handleDeleteLote(lote.id)}
                                        className="p-3 text-red-500/50 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                                        title="Excluir Lote"
                                    >
                                        <Trash2 size={20} />
                                    </button>
                                    <button
                                        onClick={() => handleOpenLote(lote.id)}
                                        className="flex-1 md:flex-none bg-[var(--bg-main)] border border-[var(--border)] hover:border-[var(--primary)]/50 text-white font-bold text-sm uppercase tracking-wide px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-all hover:shadow-[0_0_15px_rgba(37,99,235,0.2)] active:scale-95"
                                    >
                                        Abrir Lote <ExternalLink size={16} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
