"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, XCircle, Activity, Mail, Clock, Loader2 } from "lucide-react";

/* ================================================================
   TYPES
   ================================================================ */

interface LogEnvio {
    cliente_nome: string;
    destinatarios: string;
    status: string;
    mensagem_erro?: string;
    created_at: string;
}

interface FilaItem {
    cliente_id: string;
    cliente_nome: string;
    emails: string;
}

interface StatusResponse {
    success: boolean;
    totalEsperado: number;
    total: number;
    sucesso: number;
    erros: number;
    fila: number;
    logsFila: FilaItem[];
    logsSucesso: LogEnvio[];
    logsErro: LogEnvio[];
}

/* ================================================================
   PAGE COMPONENT
   ================================================================ */

export default function LogsEnvioPage({ params }: { params: Promise<{ loteId: string }> | { loteId: string } }) {
    const router = useRouter();

    // Compatibilidade com resolved params
    const resolvedParams = params instanceof Promise ? use(params) : params;
    const { loteId } = resolvedParams;

    const [statusData, setStatusData] = useState<StatusResponse>({
        success: true,
        totalEsperado: 0,
        total: 0,
        sucesso: 0,
        erros: 0,
        fila: 0,
        logsFila: [],
        logsSucesso: [],
        logsErro: []
    });
    
    const [loading, setLoading] = useState(true);
    const [isPolling, setIsPolling] = useState(true);

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
                        totalEsperado: data.totalEsperado,
                        total: data.total,
                        sucesso: data.sucesso,
                        erros: data.erros,
                        fila: data.fila,
                        logsFila: data.logsFila || [],
                        logsSucesso: data.logsSucesso || [],
                        logsErro: data.logsErro || []
                    });

                    // Se fila zerou, parar polling
                    if (data.fila === 0 && data.total > 0) {
                        setIsPolling(false);
                    }
                }
            } catch (err) {
                console.error("Erro ao fazer polling do status:", err);
            } finally {
                setLoading(false);
            }
        };

        // Fetch inicial e setInterval (Polling de 5 segundos)
        fetchStatus();
        const intervalId = setInterval(() => {
            if (isPolling) fetchStatus();
        }, 5000);

        return () => clearInterval(intervalId);
    }, [loteId, isPolling]);

    const progressPercent = statusData.totalEsperado > 0
        ? ((statusData.total) / statusData.totalEsperado) * 100
        : 0;

    return (
        <div className="min-h-screen bg-[var(--bg)] p-8">
            <div className="max-w-[1600px] mx-auto space-y-6">

                {/* ═══════════════ HEADER ═══════════════ */}
                <div className="flex justify-between items-center bg-[var(--bg-card)] p-6 rounded-2xl border border-[var(--border)]">
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={() => router.push('/faturamento/lotes')}
                            className="p-2 rounded-full hover:bg-[var(--bg-card-hover)] transition-colors text-[var(--fg-dim)]"
                        >
                            <ArrowLeft size={22} />
                        </button>
                        <div>
                            <h1 className="text-2xl font-bold text-[var(--fg)] flex items-center gap-3">
                                <div className="p-2 bg-blue-500/10 rounded-lg">
                                    <Activity className="text-blue-500" size={22} />
                                </div>
                                Acompanhamento de Envio
                            </h1>
                            <p className="text-[var(--fg-dim)] text-sm mt-1">
                                Lote: <span className="text-[var(--accent)] font-mono">{loteId.slice(0, 8)}...</span>
                                {isPolling && statusData.fila > 0 && (
                                    <span className="ml-3 inline-flex items-center gap-1 text-[10px] font-bold text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse">
                                        <Loader2 size={10} className="animate-spin" /> Polling ativo
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>
                </div>

                {/* ═══════════════ PROGRESS BAR ═══════════════ */}
                <div className="bg-[var(--bg-card)] border border-[var(--border)] p-5 rounded-2xl">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-wider">
                            Progresso Geral
                        </span>
                        <span className="text-xs text-[var(--fg-dim)]">
                            {statusData.total} / {statusData.totalEsperado} processados ({progressPercent.toFixed(0)}%)
                        </span>
                    </div>
                    <div className="w-full h-2.5 bg-[var(--border)] rounded-full overflow-hidden">
                        <div 
                            className="h-full rounded-full transition-all duration-700 ease-out"
                            style={{ 
                                width: `${progressPercent}%`,
                                background: statusData.erros > 0 
                                    ? 'linear-gradient(90deg, var(--success), var(--warning))' 
                                    : 'linear-gradient(90deg, var(--success), #10b981)'
                            }}
                        />
                    </div>
                    <div className="flex gap-6 mt-3">
                        <span className="text-xs font-semibold text-[var(--fg-dim)] flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-blue-400" />
                            Fila: {statusData.fila}
                        </span>
                        <span className="text-xs font-semibold text-[var(--success)] flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
                            Sucesso: {statusData.sucesso}
                        </span>
                        <span className="text-xs font-semibold text-[var(--danger)] flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-[var(--danger)]" />
                            Erros: {statusData.erros}
                        </span>
                    </div>
                </div>

                {/* ═══════════════ 3 COLUNAS ═══════════════ */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* ───── COLUNA 1: FILA ───── */}
                    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] flex flex-col h-[560px]">
                        <div className="p-4 border-b border-[var(--border)] flex justify-between items-center flex-shrink-0">
                            <h2 className="font-bold text-[var(--fg)] flex items-center gap-2 text-sm">
                                <div className="p-1.5 bg-blue-500/10 rounded-md">
                                    <Clock className="text-blue-400" size={16} />
                                </div>
                                Fila de Envio
                            </h2>
                            <span className="text-[10px] font-bold text-blue-400 bg-blue-400/10 px-2.5 py-1 rounded-full uppercase tracking-wider">
                                {statusData.logsFila.length} Aguardando
                            </span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3">
                            {loading ? (
                                <div className="h-full flex flex-col items-center justify-center text-[var(--fg-dim)] opacity-50 space-y-2">
                                    <Loader2 size={32} className="animate-spin" />
                                    <p className="text-xs font-medium">Carregando...</p>
                                </div>
                            ) : statusData.logsFila.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-[var(--fg-dim)] opacity-40 space-y-2">
                                    <CheckCircle size={36} />
                                    <p className="text-xs font-bold uppercase tracking-widest">
                                        {statusData.total > 0 ? "Fila processada" : "Aguardando início"}
                                    </p>
                                </div>
                            ) : (
                                <ul className="space-y-2">
                                    {statusData.logsFila.map((item, i) => (
                                        <li 
                                            key={item.cliente_id || i} 
                                            className="p-3 bg-[var(--bg)] rounded-xl border border-[var(--border)] flex items-start gap-3 transition-all hover:border-blue-500/20"
                                        >
                                            <div className="p-1 bg-blue-400/10 rounded-md mt-0.5 flex-shrink-0">
                                                <Mail size={12} className="text-blue-400" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <span className="font-semibold text-sm text-[var(--fg)] block truncate">
                                                    {item.cliente_nome}
                                                </span>
                                                <span className="text-[11px] text-[var(--fg-dim)] font-mono block truncate mt-0.5">
                                                    {item.emails || "Sem e-mail"}
                                                </span>
                                            </div>
                                            <div className="flex-shrink-0">
                                                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-blue-400/70 bg-blue-400/5 px-2 py-0.5 rounded-full uppercase">
                                                    <Clock size={8} /> Na fila
                                                </span>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* ───── COLUNA 2: SUCESSO ───── */}
                    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] flex flex-col h-[560px]">
                        <div className="p-4 border-b border-[var(--border)] flex justify-between items-center flex-shrink-0">
                            <h2 className="font-bold text-[var(--fg)] flex items-center gap-2 text-sm">
                                <div className="p-1.5 bg-emerald-500/10 rounded-md">
                                    <CheckCircle className="text-emerald-500" size={16} />
                                </div>
                                Confirmados
                            </h2>
                            <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2.5 py-1 rounded-full uppercase tracking-wider">
                                {statusData.logsSucesso.length} Enviados
                            </span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3">
                            {statusData.logsSucesso.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-[var(--fg-dim)] opacity-40 space-y-2">
                                    <CheckCircle size={36} />
                                    <p className="text-xs font-bold uppercase tracking-widest">Aguardando envios</p>
                                </div>
                            ) : (
                                <ul className="space-y-2">
                                    {statusData.logsSucesso.map((log, i) => (
                                        <li 
                                            key={i} 
                                            className="p-3 bg-[var(--bg)] rounded-xl border border-emerald-500/10 flex items-start gap-3 transition-all hover:border-emerald-500/30 animate-in fade-in slide-in-from-left-2 duration-300"
                                        >
                                            <div className="p-1 bg-emerald-500/10 rounded-md mt-0.5 flex-shrink-0">
                                                <CheckCircle size={12} className="text-emerald-500" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <span className="font-semibold text-sm text-[var(--fg)] block truncate">
                                                    {log.cliente_nome}
                                                </span>
                                                <span className="text-[11px] text-[var(--fg-dim)] font-mono block truncate mt-0.5">
                                                    {log.destinatarios}
                                                </span>
                                            </div>
                                            <div className="flex-shrink-0">
                                                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-500 bg-emerald-500/5 px-2 py-0.5 rounded-full uppercase">
                                                    ✓ OK
                                                </span>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* ───── COLUNA 3: FALHAS ───── */}
                    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] flex flex-col h-[560px]">
                        <div className="p-4 border-b border-[var(--border)] flex justify-between items-center flex-shrink-0">
                            <h2 className="font-bold text-[var(--fg)] flex items-center gap-2 text-sm">
                                <div className="p-1.5 bg-red-500/10 rounded-md">
                                    <XCircle className="text-red-500" size={16} />
                                </div>
                                Falhas
                            </h2>
                            <span className="text-[10px] font-bold text-red-500 bg-red-500/10 px-2.5 py-1 rounded-full uppercase tracking-wider">
                                {statusData.logsErro.length} Erros
                            </span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3">
                            {statusData.logsErro.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-[var(--fg-dim)] opacity-40 space-y-2">
                                    <XCircle size={36} />
                                    <p className="text-xs font-bold uppercase tracking-widest">Nenhuma falha</p>
                                </div>
                            ) : (
                                <ul className="space-y-2">
                                    {statusData.logsErro.map((log, i) => (
                                        <li 
                                            key={i} 
                                            className="p-3 bg-red-500/5 rounded-xl border border-red-500/10 flex flex-col gap-2 transition-all hover:border-red-500/30 animate-in fade-in slide-in-from-right-2 duration-300"
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className="p-1 bg-red-500/10 rounded-md mt-0.5 flex-shrink-0">
                                                    <XCircle size={12} className="text-red-500" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <span className="font-semibold text-sm text-red-400 block truncate">
                                                        {log.cliente_nome}
                                                    </span>
                                                    <span className="text-[11px] text-[var(--fg-dim)] font-mono block truncate mt-0.5">
                                                        {log.destinatarios}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="ml-7 text-[11px] text-red-300/80 font-mono bg-red-950/40 px-2.5 py-1.5 rounded-lg border border-red-500/10">
                                                {log.mensagem_erro || "Erro desconhecido ao processar"}
                                            </div>
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
