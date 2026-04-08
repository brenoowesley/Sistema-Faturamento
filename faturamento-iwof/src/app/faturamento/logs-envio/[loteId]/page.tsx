"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, XCircle, Activity, Mail, Clock, Loader2, RefreshCw, Send, X, PlayCircle } from "lucide-react";

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
    naoEnviados: FilaItem[];
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
        logsErro: [],
        naoEnviados: []
    });
    
    const [loading, setLoading] = useState(true);
    const [isPolling, setIsPolling] = useState(true);
    const [resending, setResending] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [showReenvioModal, setShowReenvioModal] = useState(false);
    const [reenvioAssunto, setReenvioAssunto] = useState("");
    const [continuing, setContinuing] = useState(false);
    const [showContinuarModal, setShowContinuarModal] = useState(false);
    const [continuarAssunto, setContinuarAssunto] = useState("");
    const [pendentesLoading, setPendentesLoading] = useState(false);

    /* ── Reenviar Lote Completo ── */
    const handleConfirmarReenvio = async () => {
        setResending(true);
        setShowReenvioModal(false);
        try {
            const res = await fetch('/api/faturamento/disparar-emails', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    loteId,
                    ...(reenvioAssunto.trim() ? { assunto: reenvioAssunto.trim() } : {})
                }),
            });
            const data = await res.json();
            if (data.success) {
                alert(`✅ ${data.message}`);
                setIsPolling(true);
            } else {
                alert(`❌ Erro: ${data.error}`);
            }
        } catch (err: any) {
            alert(`❌ Erro de rede: ${err.message}`);
        } finally {
            setResending(false);
        }
    };

    /* ── Continuar Envio: Abrir modal com lista de pendentes ── */
    const handleAbrirContinuar = async () => {
        setContinuarAssunto('');
        setPendentesLoading(true);
        setShowContinuarModal(true);
        try {
            const res = await fetch(`/api/faturamento/status-envio/${loteId}`);
            if (!res.ok) throw new Error('Erro na rede');
            const data = await res.json();
            if (data.success) {
                setStatusData(prev => ({ ...prev, naoEnviados: data.naoEnviados || [] }));
            }
        } catch (err) {
            console.error('Erro ao buscar pendentes:', err);
        } finally {
            setPendentesLoading(false);
        }
    };

    /* ── Continuar Envio: Confirmar disparo ── */
    const handleConfirmarContinuar = async () => {
        setContinuing(true);
        setShowContinuarModal(false);
        try {
            const res = await fetch('/api/faturamento/disparar-emails', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    loteId,
                    continuar: true,
                    ...(continuarAssunto.trim() ? { assunto: continuarAssunto.trim() } : {})
                }),
            });
            const data = await res.json();
            if (data.success) {
                alert(`✅ ${data.message}`);
                setIsPolling(true);
            } else {
                alert(`❌ Erro: ${data.error}`);
            }
        } catch (err: any) {
            alert(`❌ Erro de rede: ${err.message}`);
        } finally {
            setContinuing(false);
        }
    };

    /* ── Refresh Manual ── */
    const handleRefresh = async () => {
        setRefreshing(true);
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
                    logsErro: data.logsErro || [],
                    naoEnviados: data.naoEnviados || []
                });
                if (data.fila === 0 && data.total > 0) setIsPolling(false);
            }
        } catch (err) {
            console.error("Erro ao atualizar:", err);
        } finally {
            setRefreshing(false);
        }
    };

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
                        logsErro: data.logsErro || [],
                        naoEnviados: data.naoEnviados || []
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
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-[var(--border)] text-[var(--fg-dim)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--fg)] transition-all duration-200 disabled:opacity-50"
                            title="Atualizar status"
                        >
                            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                            Atualizar
                        </button>
                        <button
                            onClick={handleAbrirContinuar}
                            disabled={continuing || pendentesLoading}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-amber-600 to-amber-500 text-white hover:from-amber-500 hover:to-amber-400 transition-all duration-200 shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {continuing ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : (
                                <PlayCircle size={16} />
                            )}
                            {continuing ? 'Continuando...' : 'Continuar Envio'}
                        </button>
                        <button
                            onClick={() => { setReenvioAssunto(''); setShowReenvioModal(true); }}
                            disabled={resending}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-500 hover:to-blue-400 transition-all duration-200 shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {resending ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : (
                                <Send size={16} />
                            )}
                            {resending ? 'Reenviando...' : 'Reenviar Lote'}
                        </button>
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

            {/* ═══════════════ MODAL REENVIO ═══════════════ */}
            {showReenvioModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-lg mx-4 shadow-2xl shadow-black/40 animate-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
                            <h3 className="text-lg font-bold text-[var(--fg)] flex items-center gap-2">
                                <Send size={18} className="text-blue-400" />
                                Reenviar E-mails do Lote
                            </h3>
                            <button
                                onClick={() => setShowReenvioModal(false)}
                                className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--fg-dim)] transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-wider mb-2">
                                    Assunto do E-mail (opcional)
                                </label>
                                <input
                                    type="text"
                                    value={reenvioAssunto}
                                    onChange={(e) => setReenvioAssunto(e.target.value)}
                                    placeholder="Ex: Faturamento iWof {Período faturado} | {Loja}"
                                    className="w-full px-4 py-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-[var(--fg)] text-sm placeholder:text-[var(--fg-dim)]/50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all"
                                />
                                <p className="text-[11px] text-[var(--fg-dim)] mt-2">
                                    Deixe vazio para usar o assunto padrão. Variáveis disponíveis: <code className="text-blue-400/80 bg-blue-400/5 px-1 rounded">{'{Loja}'}</code> <code className="text-blue-400/80 bg-blue-400/5 px-1 rounded">{'{Período faturado}'}</code> <code className="text-blue-400/80 bg-blue-400/5 px-1 rounded">{'{Ciclo}'}</code>
                                </p>
                            </div>

                            <div className="bg-blue-500/5 border border-blue-500/10 rounded-xl p-3">
                                <p className="text-xs text-blue-300/80">
                                    <strong>ℹ️ Nota:</strong> Todos os demais dados (destinatários, anexos, template) serão mantidos conforme o envio original.
                                </p>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center gap-3 p-5 border-t border-[var(--border)]">
                            <button
                                onClick={() => setShowReenvioModal(false)}
                                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border border-[var(--border)] text-[var(--fg-dim)] hover:bg-[var(--bg-card-hover)] transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmarReenvio}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-500 hover:to-blue-400 transition-all shadow-lg shadow-blue-500/20"
                            >
                                <Send size={16} />
                                Confirmar Reenvio
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* ═══════════════ MODAL CONTINUAR ENVIO ═══════════════ */}
            {showContinuarModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-2xl mx-4 shadow-2xl shadow-black/40 animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
                        {/* Header */}
                        <div className="flex items-center justify-between p-5 border-b border-[var(--border)] flex-shrink-0">
                            <h3 className="text-lg font-bold text-[var(--fg)] flex items-center gap-2">
                                <PlayCircle size={18} className="text-amber-400" />
                                Continuar Envio
                            </h3>
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-full uppercase tracking-wider">
                                    {statusData.naoEnviados.length} pendentes
                                </span>
                                <button
                                    onClick={() => setShowContinuarModal(false)}
                                    className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--fg-dim)] transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        {/* Body (scrollable) */}
                        <div className="flex-1 overflow-y-auto p-5 space-y-4">
                            {/* Lista de empresas não enviadas */}
                            <div>
                                <label className="block text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-wider mb-3">
                                    Empresas que não receberam o e-mail
                                </label>
                                {pendentesLoading ? (
                                    <div className="flex items-center justify-center py-8 text-[var(--fg-dim)]">
                                        <Loader2 size={24} className="animate-spin mr-2" />
                                        <span className="text-sm">Buscando pendentes...</span>
                                    </div>
                                ) : statusData.naoEnviados.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-8 text-[var(--fg-dim)] opacity-50">
                                        <CheckCircle size={32} />
                                        <p className="text-sm mt-2 font-semibold">Todos os e-mails foram enviados!</p>
                                    </div>
                                ) : (
                                    <div className="bg-[var(--bg)] rounded-xl border border-[var(--border)] max-h-[280px] overflow-y-auto">
                                        <ul className="divide-y divide-[var(--border)]">
                                            {statusData.naoEnviados.map((item, i) => (
                                                <li key={item.cliente_id || i} className="px-4 py-3 flex items-center gap-3 hover:bg-[var(--bg-card-hover)] transition-colors">
                                                    <div className="p-1.5 bg-amber-500/10 rounded-md flex-shrink-0">
                                                        <Mail size={12} className="text-amber-400" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <span className="font-semibold text-sm text-[var(--fg)] block truncate">
                                                            {item.cliente_nome}
                                                        </span>
                                                        <span className="text-[11px] text-[var(--fg-dim)] font-mono block truncate mt-0.5">
                                                            {item.emails || "Sem e-mail configurado"}
                                                        </span>
                                                    </div>
                                                    <span className="text-[9px] font-bold text-amber-400/70 bg-amber-400/5 px-2 py-0.5 rounded-full uppercase flex-shrink-0">
                                                        Pendente
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>

                            {/* Assunto */}
                            <div>
                                <label className="block text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-wider mb-2">
                                    Assunto do E-mail (opcional)
                                </label>
                                <input
                                    type="text"
                                    value={continuarAssunto}
                                    onChange={(e) => setContinuarAssunto(e.target.value)}
                                    placeholder="Ex: Faturamento iWof {Período faturado} | {Loja}"
                                    className="w-full px-4 py-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-[var(--fg)] text-sm placeholder:text-[var(--fg-dim)]/50 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/40 transition-all"
                                />
                                <p className="text-[11px] text-[var(--fg-dim)] mt-2">
                                    Deixe vazio para usar o assunto padrão. Variáveis: <code className="text-amber-400/80 bg-amber-400/5 px-1 rounded">{'{Loja}'}</code> <code className="text-amber-400/80 bg-amber-400/5 px-1 rounded">{'{Período faturado}'}</code> <code className="text-amber-400/80 bg-amber-400/5 px-1 rounded">{'{Ciclo}'}</code>
                                </p>
                            </div>

                            <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-3">
                                <p className="text-xs text-amber-300/80">
                                    <strong>⚡ Como funciona:</strong> Logs de erro anteriores serão limpos e somente os <strong>{statusData.naoEnviados.length}</strong> clientes listados acima serão processados. Os <strong>{statusData.sucesso}</strong> já enviados com sucesso serão preservados.
                                </p>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center gap-3 p-5 border-t border-[var(--border)] flex-shrink-0">
                            <button
                                onClick={() => setShowContinuarModal(false)}
                                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border border-[var(--border)] text-[var(--fg-dim)] hover:bg-[var(--bg-card-hover)] transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmarContinuar}
                                disabled={statusData.naoEnviados.length === 0 || pendentesLoading}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-amber-600 to-amber-500 text-white hover:from-amber-500 hover:to-amber-400 transition-all shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <PlayCircle size={16} />
                                Disparar {statusData.naoEnviados.length} pendentes
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
