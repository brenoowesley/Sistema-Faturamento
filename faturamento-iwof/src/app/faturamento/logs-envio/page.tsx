"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, RefreshCw, CheckCircle2, XCircle, Search, Calendar, FileText, Mail } from "lucide-react";
import Link from "next/link";

interface LogEmail {
    id: string;
    created_at: string;
    lote_id: string;
    cliente_nome: string;
    destinatarios: string;
    assunto: string;
    status: string;
    mensagem_erro: string | null;
}

export default function LogsEnvioEmail() {
    const supabase = createClient();
    const [logs, setLogs] = useState<LogEmail[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("logs_envio_email")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(100);

            if (error) throw error;
            setLogs(data || []);
        } catch (err) {
            console.error("Erro ao buscar logs:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    const filteredLogs = logs.filter(log => 
        log.cliente_nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.assunto?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.destinatarios?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const fmtData = (isoStr: string) => {
        return new Date(isoStr).toLocaleString("pt-BR", {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    return (
        <div className="p-6 md:p-10 max-w-[1400px] mx-auto animate-in fade-in zoom-in-95 duration-500">
            {/* Cabecalho */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div>
                    <Link href="/faturamento" className="btn btn-ghost btn-sm mb-4 gap-2 text-[var(--fg-dim)] hover:text-[var(--fg)] px-0">
                        <ArrowLeft size={16} />
                        Voltar para Faturamento
                    </Link>
                    <div className="flex items-center gap-3">
                        <div className="bg-blue-500/10 p-3 rounded-xl border border-blue-500/20">
                            <Mail className="text-blue-500" size={28} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-[var(--fg)]">Auditoria de E-mails</h1>
                            <p className="text-[var(--fg-dim)] max-w-2xl mt-1">
                                Histórico e rastreabilidade dos disparos de faturamento em lote.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative w-64">
                        <input 
                            type="text" 
                            placeholder="Buscar cliente, assunto..."
                            className="input input-bordered w-full pl-10 bg-[var(--bg-card)] text-[var(--fg)] border-[var(--border)]"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-dim)]" size={16} />
                    </div>
                    <button 
                        onClick={fetchLogs} 
                        className="btn btn-primary gap-2"
                        disabled={loading}
                    >
                        <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                        Atualizar
                    </button>
                </div>
            </div>

            {/* Tabela de Logs */}
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="table w-full relative table-pin-rows">
                        <thead className="bg-[#f8fafc] dark:bg-[#0f172a]/40 text-[#64748b] dark:text-[#94a3b8] uppercase text-[10px] font-bold tracking-widest [&>tr>th]:border-b [&>tr>th]:border-[var(--border)]">
                            <tr>
                                <th className="px-6 py-4">Data / Hora</th>
                                <th>Cliente</th>
                                <th>Assunto</th>
                                <th>Destinatários</th>
                                <th className="text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {loading && logs.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="text-center py-20 text-[var(--fg-dim)]">
                                        <span className="loading loading-spinner loading-md mb-2"></span>
                                        <p>Carregando logs...</p>
                                    </td>
                                </tr>
                            ) : filteredLogs.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="text-center py-20 text-[var(--fg-dim)]">
                                        <div className="flex flex-col items-center gap-3">
                                            <FileText size={40} className="opacity-20" />
                                            <p>Nenhum registro de e-mail encontrado.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredLogs.map((log) => (
                                    <tr key={log.id} className="hover:bg-[var(--bg-sidebar)] transition-colors border-b border-[var(--border)] last:border-none">
                                        <td className="px-6 py-4 font-mono text-[11px] text-[var(--fg-dim)] whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                <Calendar size={12} />
                                                {fmtData(log.created_at)}
                                            </div>
                                        </td>
                                        <td>
                                            <div className="font-bold text-[var(--fg)] max-w-[200px] truncate" title={log.cliente_nome}>
                                                {log.cliente_nome}
                                            </div>
                                        </td>
                                        <td>
                                            <div className="text-[12px] text-[var(--fg-dim)] max-w-[250px] truncate" title={log.assunto}>
                                                {log.assunto}
                                            </div>
                                        </td>
                                        <td>
                                            <div className="text-[11px] font-mono text-blue-500/80 max-w-[200px] truncate" title={log.destinatarios}>
                                                {log.destinatarios}
                                            </div>
                                        </td>
                                        <td className="text-center">
                                            {log.status === "Sucesso" ? (
                                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[10px] font-bold uppercase">
                                                    <CheckCircle2 size={12} /> Sucesso
                                                </div>
                                            ) : (
                                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-500 text-[10px] font-bold uppercase" title={log.mensagem_erro || "Erro desconhecido"}>
                                                    <XCircle size={12} /> Erro
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
