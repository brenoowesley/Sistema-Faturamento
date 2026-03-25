"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { 
    Check, 
    X, 
    AlertTriangle, 
    Loader2, 
    ShieldAlert, 
    Clock, 
    Banknote, 
    Layers,
    Calendar,
    Send,
    Trash2
} from "lucide-react";
import { useTheme } from "next-themes";

export const dynamic = 'force-dynamic';

interface LoteAprovacao {
    id: string;
    nome_lote: string;
    tipo_saque: string;
    total_real: number;
    created_at: string;
    status: string;
    item_count?: number;
}

export default function AprovacoesPage() {
    const supabase = createClient();
    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);
    const [lotes, setLotes] = useState<LoteAprovacao[]>([]);
    const [processingId, setProcessingId] = useState<string | null>(null);

    useEffect(() => {
        async function checkAccessAndLoad() {
            setLoading(true);
            try {
                // 1. Verificar Acesso
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;

                const { data: perfil } = await supabase
                    .from("usuarios_perfis")
                    .select("cargo")
                    .eq("id", user.id)
                    .single();

                if (perfil?.cargo === "ADMIN" || perfil?.cargo === "APROVADOR") {
                    setAuthorized(true);
                    
                    // 2. Buscar Lotes
                    const { data: lotesData, error: lotesError } = await supabase
                        .from("lotes_saques")
                        .select(`
                            *,
                            itens_saque(count)
                        `)
                        .eq("status", "AGUARDANDO_APROVACAO")
                        .order("created_at", { ascending: false });

                    if (lotesError) throw lotesError;

                    const formattedLotes = (lotesData || []).map((l: any) => ({
                        ...l,
                        item_count: l.itens_saque?.[0]?.count || 0
                    }));

                    setLotes(formattedLotes);
                }
            } catch (err) {
                console.error("Erro ao carregar aprovações:", err);
            } finally {
                setLoading(false);
            }
        }

        checkAccessAndLoad();
    }, [supabase]);

    async function handleApprove(loteId: string) {
        if (!confirm("Tem certeza que deseja aprovar este lote e enviar para a Transfeera?")) return;
        
        setProcessingId(loteId);
        try {
            const res = await fetch("/api/transfeera/aprovar-lote", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ lote_id: loteId }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Erro ao aprovar lote");
            }

            alert("Lote aprovado e enviado com sucesso!");
            setLotes(prev => prev.filter(l => l.id !== loteId));
        } catch (err: any) {
            alert("Erro: " + err.message);
        } finally {
            setProcessingId(null);
        }
    }

    async function handleReject(loteId: string) {
        if (!confirm("ATENÇÃO: Rejeitar o lote irá excluí-lo permanentemente, junto com todos os seus itens. Deseja continuar?")) return;

        setProcessingId(loteId);
        try {
            // Devido ao CASCADE no banco, deletar o lote remove os itens
            const { error } = await supabase
                .from("lotes_saques")
                .delete()
                .eq("id", loteId);

            if (error) throw error;

            alert("Lote rejeitado e excluído com sucesso.");
            setLotes(prev => prev.filter(l => l.id !== loteId));
        } catch (err: any) {
            alert("Erro ao rejeitar lote: " + err.message);
        } finally {
            setProcessingId(null);
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-20 gap-4">
                <Loader2 className="animate-spin text-accent" size={40} />
                <p className="text-[var(--fg-dim)]">Carregando aprovações pendentes...</p>
            </div>
        );
    }

    if (!authorized) {
        return (
            <div className="flex flex-col items-center justify-center p-20 text-center space-y-4">
                <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 mb-2">
                    <ShieldAlert size={40} />
                </div>
                <h1 className="text-2xl font-black text-white">Acesso Negado</h1>
                <p className="text-[var(--fg-dim)] max-w-md">
                    Esta área é restrita a Administradores e Aprovadores. 
                    Se você acredita que deveria ter acesso, entre em contato com o suporte.
                </p>
            </div>
        );
    }

    return (
        <main className="p-8 max-w-6xl mx-auto space-y-8 pb-20">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-white flex items-center gap-3">
                        <Clock className="text-accent" size={32} />
                        Aprovações Pendentes
                    </h1>
                    <p className="text-[var(--fg-dim)] text-sm">
                        Analise e autorize o envio de lotes de saque para a Transfeera.
                    </p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 flex items-center gap-3">
                    <div className="text-right">
                        <p className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest">Total Pendente</p>
                        <p className="text-lg font-black text-white">R$ {lotes.reduce((acc, curr) => acc + curr.total_real, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center text-accent">
                        <Banknote size={20} />
                    </div>
                </div>
            </header>

            {lotes.length === 0 ? (
                <div className="card p-20 text-center space-y-4 bg-white/[0.02]">
                    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center text-[var(--fg-dim)] mx-auto">
                        <Check size={32} />
                    </div>
                    <div>
                        <h3 className="text-white font-bold">Tudo em dia!</h3>
                        <p className="text-[var(--fg-dim)] text-sm">Não há lotes aguardando aprovação no momento.</p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {lotes.map((lote) => (
                        <div key={lote.id} className="card p-6 flex flex-col justify-between hover:border-accent/40 transition-all border-white/10 group">
                            <div className="space-y-4">
                                <div className="flex justify-between items-start">
                                    <span className="px-2 py-1 rounded-md bg-accent/10 border border-accent/20 text-accent text-[10px] font-bold tracking-widest uppercase">
                                        {lote.tipo_saque}
                                    </span>
                                    <div className="flex items-center gap-1.5 text-[var(--fg-dim)] text-[10px] font-bold uppercase">
                                        <Calendar size={12} />
                                        {new Date(lote.created_at).toLocaleDateString('pt-BR')}
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-white font-bold text-lg group-hover:text-accent transition-colors truncate" title={lote.nome_lote}>
                                        {lote.nome_lote}
                                    </h3>
                                    <div className="flex items-center gap-4 mt-2">
                                        <div className="flex items-center gap-1.5 text-[var(--fg-dim)] text-xs">
                                            <Layers size={14} className="text-[var(--fg-dim)]" />
                                            <span>{lote.item_count} itens</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white/5 rounded-xl p-4 border border-white/5 space-y-1">
                                    <p className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-wider">Custo do Lote</p>
                                    <p className="text-2xl font-black text-white">R$ {lote.total_real.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 mt-8">
                                <button
                                    onClick={() => handleReject(lote.id)}
                                    disabled={processingId !== null}
                                    className="btn border border-red-500/30 bg-red-500/5 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center gap-2 py-2.5 text-xs font-bold transition-all rounded-xl"
                                >
                                    {processingId === lote.id ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                                    Rejeitar
                                </button>
                                <button
                                    onClick={() => handleApprove(lote.id)}
                                    disabled={processingId !== null}
                                    className="btn bg-accent text-white hover:opacity-90 flex items-center justify-center gap-2 py-2.5 text-xs font-bold transition-all rounded-xl shadow-[0_4px_12px_rgba(33,118,255,0.3)]"
                                >
                                    {processingId === lote.id ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                                    Aprovar
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="card p-4 bg-orange-500/5 border-orange-500/10 flex items-start gap-3">
                <AlertTriangle className="text-orange-500 shrink-0 mt-0.5" size={18} />
                <div>
                    <p className="text-xs font-bold text-orange-200/80">Aviso Importante</p>
                    <p className="text-[10px] text-orange-200/50 leading-relaxed mt-1">
                        Aprovar um lote iniciará imediatamente o processamento financeiro na Transfeera. 
                        Certifique-se de que há saldo suficiente na conta bancária vinculada antes de confirmar a operação.
                        Lotes rejeitados são arquivados permanentemente.
                    </p>
                </div>
            </div>
        </main>
    );
}
