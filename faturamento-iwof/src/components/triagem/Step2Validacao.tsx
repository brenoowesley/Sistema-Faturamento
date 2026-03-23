"use client";

import { useEffect, useState, useCallback } from "react";
import { TriagemFile } from "./WizardTriagem";
import { CheckCircle2, AlertTriangle, AlertCircle, FileText, ChevronRight, XCircle, UploadCloud, FolderUp, Check, X } from "lucide-react";
import { useDropzone } from "react-dropzone";
import JSZip from "jszip";
import * as pdfjsLib from "pdfjs-dist";
import { createClient } from "@/lib/supabase/client";

// Configura o worker do PDF.js para funcionar no navegador
if (typeof window !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

interface Step2ValidacaoProps {
    arquivos: TriagemFile[];
    setArquivos: (files: TriagemFile[]) => void;
    onBack: () => void;
    onNext: () => void;
}

type LogSync = {
    nomeArquivo: string;
    status: 'sucesso' | 'erro';
    clienteEncontrado?: string;
    numeroNota?: string;
};

export default function Step2Validacao({ arquivos, setArquivos, onBack, onNext }: Step2ValidacaoProps) {
    const [isMapping, setIsMapping] = useState(true);
    const [notasMapeamento, setNotasMapeamento] = useState<Record<string, string>>({});
    
    // Novos estados para a funcionalidade de sincronização de Notas (OCR)
    const [logSincronizacao, setLogSincronizacao] = useState<LogSync[]>([]);
    const [nomePastaGcp, setNomePastaGcp] = useState("Notas_Fiscais");
    const [isSyncing, setIsSyncing] = useState(false);
    const [isUploadingDrive, setIsUploadingDrive] = useState(false);
    const [hasSuccessSync, setHasSuccessSync] = useState(false);
    const supabase = createClient();

    // Simulating cycle options (in a real app, you might fetch these from backend)
    const ciclosOptions = ["Ciclo 1", "Ciclo 2", "Ciclo 3", "Ciclo 4", "Semanal"];

    useEffect(() => {
        let isMounted = true;
        async function fetchMappingAndProcess() {
            try {
                // Fetch dictionary mapping
                const res = await fetch('/api/documentos/notas-mapeamento');
                const data = await res.json();
                const mapping = data.mapeamento || {};

                if (isMounted) {
                    setNotasMapeamento(mapping);
                    processFilesWithMapping(arquivos, mapping);
                }
            } catch (error) {
                console.error("Erro ao buscar mapeamento:", error);
                if (isMounted) {
                    // Fallback to purely name-based guessing if mapping fails
                    processFilesWithMapping(arquivos, {});
                }
            }
        }

        if (arquivos.length > 0 && isMapping) {
            fetchMappingAndProcess();
        }
    }, [arquivos]); // eslint-disable-line react-hooks/exhaustive-deps

    const processFilesWithMapping = (files: TriagemFile[], mapping: Record<string, string>) => {
        const updatedFiles = files.map(item => {
            const fileName = item.file.name;
            let identifiedName = "";
            let matchConfidence = "none";
            let nfNumberClean = "";

            if (fileName.toLowerCase().endsWith('-nfse.pdf')) {
                // Extraction rule: grab the last 5 digits before "-nfse.pdf"
                const parts = fileName.split('-nfse.pdf')[0].split('-');
                const possibleNf = parts[parts.length - 1];

                // Usually it's a 5 digit number. 
                if (/^\d{1,6}$/.test(possibleNf)) {
                    nfNumberClean = possibleNf;
                    // Check dictionary
                    if (mapping[nfNumberClean]) {
                        identifiedName = mapping[nfNumberClean];
                        matchConfidence = "high";
                    }
                }
            } else {
                // Boleto fallback heuristic logic using clean names (mock implementation)
                const cleanName = fileName.replace('.pdf', '').replace(/[\-_0-9]/g, ' ').trim().toUpperCase();

                // We'd ideally do a Levenshtein distance check against all unique clients here.
                // Since we don't have the clients list injected yet, we'll mark it as manual review if we can't be sure
                if (cleanName.length > 3) {
                    identifiedName = cleanName;
                    matchConfidence = "medium";
                }
            }

            return {
                ...item,
                clienteNome: identifiedName,
                nfNumber: nfNumberClean,
                matchConfidence,
                cicloNome: "", // Needs to be selected manually or defaulted
            };
        });

        setArquivos(updatedFiles);
        setIsMapping(false);
    };

    const handleCycleChange = (index: number, newCycle: string) => {
        const arr = [...arquivos];
        arr[index].cicloNome = newCycle;
        setArquivos(arr);
    };

    const handleRemove = (index: number) => {
        const arr = [...arquivos];
        arr.splice(index, 1);
        setArquivos(arr);
    };

    const handleNameManualChange = (index: number, newName: string) => {
        const arr = [...arquivos];
        arr[index].clienteNome = newName;
        // If they manually type a name, we assume they fixed it
        arr[index].matchConfidence = newName.trim() === "" ? "none" : "manual";
        setArquivos(arr);
    }

    /* ================================================================
       FUNCIONALIDADE DE OCR E SINCRONIZAÇÃO DE NOTAS
       ================================================================ */
    
    // Função para extrair texto de PDF baseada em worker configurado acima
    const extrairTextoPdf = async (pdfData: Uint8Array): Promise<string> => {
        try {
            const loadingTask = pdfjsLib.getDocument({ data: pdfData });
            const pdfDoc = await loadingTask.promise;
            if (pdfDoc.numPages === 0) return "";
            const page = await pdfDoc.getPage(1);
            const textContent = await page.getTextContent();
            return textContent.items.map((item: any) => item.str).join(" ");
        } catch (e) {
            console.error("Erro extraindo PDF:", e);
            return "";
        }
    };

    const sincronizarNotas = async (file: File) => {
        setIsSyncing(true);
        setHasSuccessSync(false);
        const novosLogs: LogSync[] = [];
        
        try {
            // Busca todos os clientes para cruzamento de CNPJ
            const { data: clientesData, error } = await supabase.from('clientes').select('id, razao_social, nome_conta_azul, cnpj');
            if (error) throw error;
            const mapCnpjCliente = new Map<string, any>();
            clientesData?.forEach(c => {
                if (c.cnpj) mapCnpjCliente.set(c.cnpj.replace(/\D/g, ''), c);
            });

            const zip = new JSZip();
            const contents = await zip.loadAsync(file);
            const pdfFiles = Object.values(contents.files).filter(f => !f.dir && f.name.toLowerCase().endsWith(".pdf"));

            if (pdfFiles.length === 0) {
                alert("Nenhum PDF encontrado no ZIP.");
                return;
            }

            const stateArquivos = [...arquivos];
            let sucessos = 0;

            for (const pdf of pdfFiles) {
                const pdfData = await pdf.async("uint8array");
                const texto = await extrairTextoPdf(pdfData);

                const matchNota = texto.match(/Nº da Nota:[\s\|]*0*(\d+)/i) || texto.match(/Número da Nota:\s*(\d+)/i) || texto.match(/Número da NFS-e\s*(\d+)/i);
                const matchCnpj = texto.match(/CPF\/CNPJ\/NIF:[\s\S]*?(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i) || texto.match(/CPF\/CNPJ.*?\s(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i);

                if (!matchCnpj) {
                    novosLogs.push({ nomeArquivo: pdf.name, status: 'erro' });
                    continue;
                }

                const numeroExtraido = matchNota ? matchNota[1] : undefined;
                const cnpjExtraido = matchCnpj[1].replace(/\D/g, '');
                const clienteAchaado = mapCnpjCliente.get(cnpjExtraido);

                if (!clienteAchaado) {
                    novosLogs.push({ nomeArquivo: pdf.name, status: 'erro' });
                    continue;
                }

                const nomeClienteIdentificado = clienteAchaado.nome_conta_azul || clienteAchaado.razao_social;
                
                // Encontrar o arquivo correspondente na tabela da triagem
                // O critério pode ser string includes ou match exato
                const indexArquivo = stateArquivos.findIndex(a => 
                    a.clienteNome && a.clienteNome.toUpperCase() === nomeClienteIdentificado.toUpperCase() ||
                    a.clienteNome && nomeClienteIdentificado.toUpperCase().includes(a.clienteNome.toUpperCase())
                );

                if (indexArquivo === -1) {
                    // Cnpj existe no Supabase, mas este cliente não está no batch atual
                    novosLogs.push({ nomeArquivo: pdf.name, status: 'erro' });
                    continue;
                }

                // Atualizando estado
                stateArquivos[indexArquivo].numero_nf = numeroExtraido;
                stateArquivos[indexArquivo].numero_nc = numeroExtraido;
                stateArquivos[indexArquivo].pdfBlob = new Blob([pdfData as any], { type: 'application/pdf' });

                novosLogs.push({ 
                    nomeArquivo: pdf.name, 
                    status: 'sucesso', 
                    clienteEncontrado: nomeClienteIdentificado, 
                    numeroNota: numeroExtraido 
                });
                
                sucessos++;
            }

            setArquivos(stateArquivos);
            setLogSincronizacao(prev => [...prev, ...novosLogs]);
            if (sucessos > 0) setHasSuccessSync(true);

        } catch (err) {
            console.error("Erro sincronizando notas:", err);
            alert("Erro ao ler ZIP.");
        } finally {
            setIsSyncing(false);
        }
    };

    const dzSync = useDropzone({
        onDrop: (files) => {
            if (files.length > 0) sincronizarNotas(files[0]);
        },
        accept: { 'application/zip': ['.zip'] },
        multiple: false
    });

    const handleEnviarPastas = async () => {
        setIsUploadingDrive(true);
        let countEnvios = 0;
        
        try {
            for (let i = 0; i < arquivos.length; i++) {
                const aqv = arquivos[i];
                if (aqv.pdfBlob && aqv.clienteNome) {
                    const fd = new FormData();
                    const nomeFileFinal = aqv.numero_nf ? `NF_${aqv.numero_nf}.pdf` : `NF_SYNC_${Date.now()}.pdf`;
                    fd.append('file', aqv.pdfBlob, nomeFileFinal);
                    fd.append('clienteNome', aqv.clienteNome);
                    fd.append('folderNameCustom', nomePastaGcp);
                    fd.append('cnpj', ''); // Se soubermos, poderíamos enviar aqui
                    
                    const res = await fetch('/api/triagem/upload', {
                        method: 'POST',
                        body: fd
                    });
                    if (res.ok) countEnvios++;
                }
            }
            alert(`${countEnvios} arquivos enviados para as pastas no Google Drive estruturalmente!`);
        } catch(err) {
            console.error("Erro no envio GCP da triagem:", err);
            alert("Houve erros durante o processamento de envio.");
        } finally {
            setIsUploadingDrive(false);
        }
    };

    const unassignedCount = arquivos.filter(a => !a.clienteNome || !a.cicloNome).length;

    return (
        <div className="flex flex-col gap-6">
            <div className="card">
                <div className="flex flex-col mb-4">
                    <h2 className="text-xl font-bold text-[var(--fg)] mb-2">Validação e Relacionamento</h2>
                    <p className="text-sm text-[var(--fg-dim)]">O sistema tentou adivinhar os nomes de clientes e números de nota. Revise se os nomes estão corretos e defina qual é a pasta do Ciclo.</p>
                </div>

                {unassignedCount > 0 && !isMapping && (
                    <div className="bg-[rgba(245,158,11,0.1)] border border-[var(--warning)] p-4 rounded-xl flex items-center gap-3 mb-6">
                        <AlertTriangle size={20} className="text-[var(--warning)]" />
                        <span className="text-sm font-medium text-[var(--warning)]">
                            Existem {unassignedCount} arquivo(s) faltando o Cliente ou o Ciclo de Faturamento.
                        </span>
                    </div>
                )}

                <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Status</th>
                                    <th>Arquivo Original</th>
                                    <th>Cliente Identificado</th>
                                    <th>Ciclo</th>
                                    <th className="text-center">Nº NF</th>
                                    <th className="text-center">Nº NC</th>
                                    <th className="text-right">Ação</th>
                                </tr>
                            </thead>
                            <tbody>
                                {isMapping ? (
                                    <tr>
                                        <td colSpan={5} className="text-center py-12">
                                            <div className="flex flex-col items-center gap-3 justify-center text-[var(--fg-dim)]">
                                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]"></div>
                                                <p>Processando e mapeando arquivos...</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : arquivos.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="table-empty">Nenhum arquivo na fila.</td>
                                    </tr>
                                ) : (
                                    arquivos.map((a, i) => {
                                        const isOk = a.clienteNome && a.clienteNome.length > 2 && a.cicloNome;
                                        return (
                                            <tr key={i} className={isOk ? "bg-[rgba(52,211,153,0.03)]" : "bg-[rgba(248,113,113,0.03)]"}>
                                                <td>
                                                    {isOk ? (
                                                        <CheckCircle2 size={18} className="text-[var(--success)]" />
                                                    ) : (
                                                        <AlertCircle size={18} className="text-[var(--danger)]" />
                                                    )}
                                                </td>
                                                <td>
                                                    <div className="flex items-center gap-2">
                                                        <FileText size={16} className="text-[var(--fg-dim)]" />
                                                        <span className="text-sm font-medium text-[var(--fg)] max-w-[200px] truncate" title={a.file.name}>
                                                            {a.file.name}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <input
                                                        type="text"
                                                        className={`input h-9 text-sm ${a.matchConfidence === 'high' ? 'border-[var(--success)] focus:border-[var(--success)]' : a.matchConfidence === 'none' ? 'border-[var(--danger)] focus:border-[var(--danger)]' : ''}`}
                                                        placeholder="Nome da Loja"
                                                        value={a.clienteNome || ""}
                                                        onChange={(e) => handleNameManualChange(i, e.target.value)}
                                                    />
                                                    {a.nfNumber && (
                                                        <span className="text-[10px] text-[var(--fg-dim)] mt-1 block tracking-wider">
                                                            NF Extraída: <strong className="text-[var(--fg)]">{a.nfNumber}</strong>
                                                        </span>
                                                    )}
                                                </td>
                                                <td>
                                                    <select
                                                        className={`input h-9 text-sm bg-transparent appearance-none ${!a.cicloNome ? 'border-[var(--danger)] text-[var(--danger)]' : ''}`}
                                                        value={a.cicloNome || ""}
                                                        onChange={(e) => handleCycleChange(i, e.target.value)}
                                                    >
                                                        <option value="" disabled className="bg-[var(--bg-card)]">Selecione o Ciclo</option>
                                                        {ciclosOptions.map(c => (
                                                            <option key={c} value={c} className="bg-[var(--bg-card)] text-[var(--fg)]">{c}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td className="text-center">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${a.numero_nf ? 'bg-[var(--warning)] text-white' : 'bg-transparent text-[var(--fg-dim)]'}`}>
                                                        {a.numero_nf || "—"}
                                                    </span>
                                                </td>
                                                <td className="text-center">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${a.numero_nc ? 'bg-[var(--success)] text-white' : 'bg-transparent text-[var(--fg-dim)]'}`}>
                                                        {a.numero_nc || "—"}
                                                    </span>
                                                </td>
                                                <td className="text-right">
                                                    <button
                                                        className="btn btn-ghost btn-xs w-8 h-8 p-0 text-[var(--fg-dim)] hover:text-[var(--danger)] hover:bg-[rgba(248,113,113,0.1)]"
                                                        onClick={() => handleRemove(i)}
                                                        title="Remover arquivo"
                                                    >
                                                        <XCircle size={16} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* ================================================================
                NOVA SECTION: OCR E SINCRONIZAÇÃO DE PASTAS
                ================================================================ */}
            <div className="card mt-2">
                <div className="flex flex-col mb-4">
                    <h2 className="text-lg font-bold text-[var(--fg)] mb-2 flex items-center gap-2">
                        <FolderUp size={20} className="text-[var(--accent)]" /> OCR e Destinação (Opcional)
                    </h2>
                    <p className="text-sm text-[var(--fg-dim)]">Arraste um arquivo ZIP contendo as Notas Fiscais emitidas. O sistema lerá os PDFs (CNPJ/Nº da Nota) e atualizará a tabela acima. Depois, envie diretamente para as pastas de seus respectivos clientes no Google Drive.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                    {/* Area 1: Dropzone */}
                    <div>
                        <div
                            {...dzSync.getRootProps()}
                            className={`dropzone ${dzSync.isDragActive ? 'dropzone-active' : ''} ${isSyncing ? 'opacity-50 pointer-events-none' : ''}`}
                            style={{ minHeight: '140px', padding: '20px' }}
                        >
                            <input {...dzSync.getInputProps()} />
                            {isSyncing ? (
                                <div className="flex flex-col items-center gap-2">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]"></div>
                                    <span className="text-xs font-semibold text-[var(--fg)]">Lendo CNPJs dos PDFs...</span>
                                </div>
                            ) : (
                                <>
                                    <div className="w-12 h-12 rounded-full bg-[rgba(129,140,248,0.1)] flex items-center justify-center mb-2 mx-auto">
                                        <UploadCloud size={24} className="text-[var(--accent)]" />
                                    </div>
                                    <h3 className="text-sm font-bold text-[var(--fg)]">Upload Notas Fiscais (ZIP)</h3>
                                </>
                            )}
                        </div>

                        <div className="mt-4 flex flex-col gap-2">
                            <label className="text-xs font-semibold text-[var(--fg-dim)] uppercase tracking-wider">Nome da Pasta (GCP)</label>
                            <input 
                                type="text"
                                className="input h-10 w-full"
                                value={nomePastaGcp}
                                onChange={e => setNomePastaGcp(e.target.value)}
                                placeholder="Notas_Fiscais_Credito"
                            />
                        </div>

                        <div className="mt-4 flex gap-3">
                            <button className="btn btn-primary flex-1" disabled={isSyncing} onClick={() => {
                                // O Sincronizar pelo box já é feito no drop
                                alert("Arraste o arquivo ZIP no quadro pontilhado acima para sincronizar automaticamente.");
                            }}>
                                {isSyncing ? "Processando..." : "Sincronizar Notas"}
                            </button>
                            <button 
                                className="btn flex-1" 
                                style={{ 
                                    background: hasSuccessSync ? "var(--success)" : "rgba(52,211,153,0.1)", 
                                    color: hasSuccessSync ? "#fff" : "rgba(52,211,153,0.4)",
                                    border: hasSuccessSync ? "none" : "1px solid rgba(52,211,153,0.2)"
                                }} 
                                disabled={!hasSuccessSync || isUploadingDrive}
                                onClick={handleEnviarPastas}
                            >
                                {isUploadingDrive ? "Enviando..." : "Enviar para as Pastas"}
                            </button>
                        </div>
                    </div>

                    {/* Area 2: Logs */}
                    <div className="bg-[var(--bg-card-hover)] border border-[var(--border)] rounded-xl p-4 min-h-[140px] max-h-[290px] overflow-y-auto">
                        <h3 className="text-sm font-bold text-[var(--fg)] mb-3">Logs de Sincronização</h3>
                        {logSincronizacao.length === 0 ? (
                            <p className="text-xs text-[var(--fg-dim)] text-center mt-8">Nenhum OCR realizado ainda.</p>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {logSincronizacao.map((log, idx) => (
                                    <div key={idx} className="flex items-center gap-3 p-2 rounded bg-[var(--bg-card)] border border-[var(--border)]">
                                        {log.status === 'sucesso' ? (
                                            <Check size={16} className="text-[var(--success)] flex-shrink-0" />
                                        ) : (
                                            <X size={16} className="text-[var(--danger)] flex-shrink-0" />
                                        )}
                                        <div className="flex flex-col">
                                            <span className="text-[11px] font-mono text-[var(--fg-muted)] truncate max-w-[150px]">{log.nomeArquivo}</span>
                                            {log.status === 'sucesso' && (
                                                <span className="text-[10px] text-[var(--accent)] font-bold">
                                                    Match: {log.clienteEncontrado} | NF: {log.numeroNota}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex justify-between mt-4">
                <button className="btn btn-ghost" onClick={onBack}>
                    Voltar
                </button>
                <button
                    className="btn btn-primary"
                    onClick={onNext}
                    disabled={isMapping || unassignedCount > 0 || arquivos.length === 0}
                >
                    Confirmar Envio <ChevronRight size={18} />
                </button>
            </div>
        </div>
    );
}
