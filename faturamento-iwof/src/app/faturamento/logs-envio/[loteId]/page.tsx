"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, XCircle, Activity, Mail } from "lucide-react";

interface LogEnvio {
    cliente_nome: string;
    destinatarios: string;
    status: string;
    mensagem_erro?: string;
    created_at: string;
}

interface StatusResponse {
    success: boolean;
    total: number;
    sucesso: number;
    erros: number;
    logsSucesso: LogEnvio[];
    logsErro: LogEnvio[];
}

export default function LogsEnvioPage({ params }: { params: Promise<{ loteId: string }> | { loteId: string } }) {
    const router = useRouter();

    // Compatibilidade com resolved params
    const resolvedParams = params instanceof Promise ? use(params) : params;
    const { loteId } = resolvedParams;

    const [statusData, setStatusData] = useState<StatusResponse>({
        success: true,
        total: 0,
        sucesso: 0,
        erros: 0,
        logsSucesso: [],
        logsErro: []
    });
    
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!loteId) return;

        const fetchStatus = async () => {
            try {
                const res = await fetch(`/api/faturamento/status-envio/${loteId}`);
                if (!res.ok) throw new Error("Erro na rede");
                const data = await res.json();
                
                if (data.success) {
                    setStatusData({
                        success: true,
                        total: data.total,
                        sucesso: data.sucesso,
                        erros: data.erros,
                        logsSucesso: data.logsSucesso,
                        logsErro: data.logsErro
                    });
                }
            } catch (err) {
                console.error("Erro ao fazer polling do status:", err);
            } finally {
                setLoading(false);
            }
        };

        // Fetch inicial e setInterval (Polling de 5 segundos)
        fetchStatus();
        const intervalId = setInterval(fetchStatus, 5000);

        return () => clearInterval(intervalId);
    }, [loteId]);

    return (
        <div className="min-h-screen bg-[var(--bg-main)] p-8">
            <div className="max-w-7xl mx-auto space-y-8">

                {/* header */}
                <div className="flex justify-between items-center bg-[var(--bg-card)] p-6 rounded-2xl border border-[var(--border)] shadow-xl animate-in fade-in slide-in-from-top-4">
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={() => router.push('/faturamento/lotes')}
                            className="btn btn-circle btn-ghost text-[var(--fg-dim)] hover:text-white"
                        >
                            <ArrowLeft size={24} />
                        </button>
                        <div>
                            <h1 className="text-2xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
                                <Activity className="text-[var(--primary)]" size={28} />
                                Status dos Disparos
                            </h1>
                            <p className="text-[var(--fg-dim)] text-sm mt-1">
                                Acompanhamento em tempo real do Lote: <span className="text-[var(--primary)] font-mono">{loteId}</span>
                            </p>
                        </div>
                    </div>
                    {loading && (
                        <div className="badge border-none text-[10px] uppercase font-bold tracking-widest px-3 py-3 gap-2 bg-[var(--primary)]/20 text-[var(--primary)] animate-pulse">
                            <span className="loading loading-spinner loading-xs"></span> CONECTANDO
                        </div>
                    )}
                </div>

                {/* Resumo - Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-[var(--bg-card)] border border-[var(--border)] p-6 rounded-2xl flex items-center justify-between shadow-lg">
                        <div>
                            <p className="text-[10px] uppercase tracking-widest text-[var(--fg-dim)] font-bold">Processados</p>
                            <p className="text-3xl font-black text-white mt-1">{statusData.total}</p>
                        </div>
                        <div className="p-4 bg-gray-500/10 text-gray-400 rounded-full">
                            <Mail size={32} />
                        </div>
                    </div>

                    <div className="bg-[var(--bg-card)] border border-emerald-900/30 p-6 rounded-2xl flex items-center justify-between shadow-lg relative overflow-hidden">
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                        <div>
                            <p className="text-[10px] uppercase tracking-widest text-emerald-500 font-bold">Sucessos</p>
                            <p className="text-3xl font-black text-white mt-1">{statusData.sucesso}</p>
                        </div>
                        <div className="p-4 bg-emerald-500/10 text-emerald-500 rounded-full">
                            <CheckCircle size={32} />
                        </div>
                    </div>

                    <div className="bg-[var(--bg-card)] border border-red-900/30 p-6 rounded-2xl flex items-center justify-between shadow-lg relative overflow-hidden">
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"></div>
                        <div>
                            <p className="text-[10px] uppercase tracking-widest text-red-500 font-bold">Erros Reportados</p>
                            <p className="text-3xl font-black text-white mt-1">{statusData.erros}</p>
                        </div>
                        <div className="p-4 bg-red-500/10 text-red-500 rounded-full">
                            <XCircle size={32} />
                        </div>
                    </div>
                </div>

                {/* Listas Detalhadas */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* SUCESSO */}
                    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] shadow-xl flex flex-col h-[500px]">
                        <div className="p-4 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-card)] rounded-t-2xl z-10 flex justify-between items-center">
                            <h2 className="font-bold text-white flex items-center gap-2">
                                <CheckCircle className="text-emerald-500" size={18} />
                                Lista de Sucessos
                            </h2>
                            <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded">
                                {statusData.logsSucesso.length} CLIENTES
                            </span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2">
                            {statusData.logsSucesso.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-[var(--fg-dim)] opacity-50 space-y-2">
                                    <CheckCircle size={40} />
                                    <p className="text-sm font-bold uppercase tracking-widest">Aguardando envios</p>
                                </div>
                            ) : (
                                <ul className="space-y-2">
                                    {statusData.logsSucesso.map((log, i) => (
                                        <li key={i} className="p-3 bg-[var(--bg-main)] rounded-lg border border-[var(--border)] hover:border-emerald-500/30 transition-colors flex flex-col">
                                            <span className="font-bold text-sm text-white">{log.cliente_nome}</span>
                                            <span className="text-xs text-[var(--fg-dim)] line-clamp-1">{log.destinatarios}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* ERRO */}
                    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] shadow-xl flex flex-col h-[500px]">
                        <div className="p-4 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-card)] rounded-t-2xl z-10 flex justify-between items-center">
                            <h2 className="font-bold text-white flex items-center gap-2">
                                <XCircle className="text-red-500" size={18} />
                                Lista de Falhas
                            </h2>
                            <span className="text-[10px] font-bold text-red-500 bg-red-500/10 px-2 py-1 rounded">
                                {statusData.logsErro.length} FALHAS
                            </span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2">
                            {statusData.logsErro.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-[var(--fg-dim)] opacity-50 space-y-2">
                                    <XCircle size={40} />
                                    <p className="text-sm font-bold uppercase tracking-widest">Nenhuma falha detectada</p>
                                </div>
                            ) : (
                                <ul className="space-y-2">
                                    {statusData.logsErro.map((log, i) => (
                                        <li key={i} className="p-3 bg-red-900/10 rounded-lg border border-red-500/30 hover:border-red-500/60 transition-colors flex flex-col gap-1">
                                            <span className="font-bold text-sm text-red-400">{log.cliente_nome}</span>
                                            <span className="text-xs text-red-300 font-mono bg-red-900/40 p-1 rounded inline-block">
                                                {log.mensagem_erro || "Erro desconhecido ao processar"}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
