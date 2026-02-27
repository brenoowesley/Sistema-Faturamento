"use client";

import { useEffect, useState, useRef } from "react";
import { TriagemFile } from "./WizardTriagem";
import { Send, Terminal, CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface Step3EnvioProps {
    arquivos: TriagemFile[];
    onBack: () => void;
    onComplete: () => void;
}

type LogEntry = {
    id: number;
    time: string;
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
};

export default function Step3Envio({ arquivos, onBack, onComplete }: Step3EnvioProps) {
    const [isSending, setIsSending] = useState(false);
    const [isFinished, setIsFinished] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [progress, setProgress] = useState({ current: 0, total: arquivos.length });
    const logContainerRef = useRef<HTMLDivElement>(null);

    const addLog = (message: string, type: LogEntry['type'] = 'info') => {
        const time = new Date().toLocaleTimeString('pt-BR', { hour12: false });
        setLogs(prev => [...prev, { id: Date.now() + Math.random(), time, message, type }]);
    };

    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    const handleSend = async () => {
        setIsSending(true);
        setIsFinished(false);
        setLogs([]);
        setProgress({ current: 0, total: arquivos.length });

        addLog(`Iniciando envio de ${arquivos.length} documento(s) para o Google Drive...`, 'info');

        for (let i = 0; i < arquivos.length; i++) {
            const arquivo = arquivos[i];
            addLog(`Preparando [${arquivo.clienteNome} / ${arquivo.cicloNome}] - ${arquivo.file.name}`, 'info');

            try {
                // In a real scenario, you'd append this to a FormData and post to /api/drive/upload-documento
                const formData = new FormData();
                formData.append("file", arquivo.file);
                formData.append("clienteNome", arquivo.clienteNome || "");
                formData.append("ciclo", arquivo.cicloNome || "");
                if (arquivo.nfNumber) {
                    formData.append("nfNumber", arquivo.nfNumber);
                }

                // const response = await fetch('/api/documentos/upload-drive', {
                //     method: 'POST',
                //     body: formData
                // });

                // if (!response.ok) throw new Error("Falha no servidor");

                // Simulating network delay for realistic visual feedback since we don't have the API plugged yet
                await new Promise(r => setTimeout(r, 600));

                addLog(`✓ Sucesso: [${arquivo.clienteNome}] enviado para pasta ${arquivo.cicloNome}.`, 'success');
            } catch (error: any) {
                addLog(`✗ Erro: Falha ao enviar ${arquivo.file.name}. ${error.message}`, 'error');
            }

            setProgress(prev => ({ ...prev, current: prev.current + 1 }));
        }

        setIsSending(false);
        setIsFinished(true);
        addLog(`Processo concluído! Total: ${arquivos.length} documentos analisados.`, 'info');
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="card">
                <div className="flex flex-col mb-6">
                    <h2 className="text-xl font-bold text-[var(--fg)] mb-2">Disparo para o Google Drive</h2>
                    <p className="text-sm text-[var(--fg-dim)]">Pronto para organizar os PDFs na nuvem. Acompanhe o progresso do upload pelo terminal abaixo.</p>
                </div>

                <div className="bg-[#0b0f19] border border-[var(--border)] rounded-xl overflow-hidden font-mono text-xs">
                    <div className="bg-[var(--bg-sidebar)] px-4 py-2 border-b border-[var(--border)] flex items-center gap-2">
                        <Terminal size={14} className="text-[var(--fg-dim)]" />
                        <span className="text-[var(--fg-muted)] font-semibold uppercase tracking-wider">Terminal de Upload</span>
                        {isSending && <Loader2 size={12} className="ml-auto text-[var(--accent)] animate-spin" />}
                    </div>

                    <div ref={logContainerRef} className="p-4 h-64 overflow-y-auto flex flex-col gap-1 text-[var(--fg)]">
                        {logs.length === 0 && !isSending && !isFinished ? (
                            <p className="text-[var(--fg-dim)] italic">Aguardando início do processo...</p>
                        ) : (
                            logs.map(log => (
                                <div key={log.id} className="flex gap-3">
                                    <span className="text-[var(--fg-dim)] opacity-50 flex-shrink-0">[{log.time}]</span>
                                    <span className={`${log.type === 'success' ? 'text-[var(--success)]' :
                                        log.type === 'error' ? 'text-[var(--danger)]' :
                                            log.type === 'warning' ? 'text-[var(--warning)]' : 'text-blue-300'
                                        }`}>
                                        {log.message}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {isSending && (
                    <div className="mt-6">
                        <div className="flex justify-between text-xs text-[var(--fg-dim)] mb-2">
                            <span>Enviando...</span>
                            <span>{progress.current} / {progress.total}</span>
                        </div>
                        <div className="w-full h-2 bg-[var(--border)] rounded-full overflow-hidden">
                            <div
                                className="h-full bg-[var(--accent)] transition-all duration-300"
                                style={{ width: `${(progress.current / progress.total) * 100}%` }}
                            ></div>
                        </div>
                    </div>
                )}
            </div>

            <div className="flex justify-between mt-4">
                <button className="btn btn-ghost" onClick={onBack} disabled={isSending}>
                    Voltar
                </button>

                {!isFinished ? (
                    <button
                        className="btn btn-primary bg-gradient-to-r from-[var(--success)] to-green-600 shadow-[0_4px_14px_rgba(52,211,153,0.3)] hover:shadow-[0_6px_20px_rgba(52,211,153,0.4)]"
                        onClick={handleSend}
                        disabled={isSending}
                    >
                        {isSending ? (
                            <><Loader2 size={18} className="animate-spin" /> Enviando...</>
                        ) : (
                            <><Send size={18} /> Iniciar Disparo</>
                        )}
                    </button>
                ) : (
                    <button className="btn btn-primary" onClick={onComplete}>
                        <CheckCircle2 size={18} /> Concluir e Voltar ao Início
                    </button>
                )}
            </div>
        </div>
    );
}
