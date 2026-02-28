"use client";

import { useState, useCallback, useEffect } from "react";
import { ArrowLeft, ChevronRight, FileDown, UploadCloud, FileArchive, CheckCircle2, X, AlertCircle, Info, Search } from "lucide-react";
import { useDropzone } from "react-dropzone";
import JSZip from "jszip";

interface EmissaoNotasProps {
    setCurrentStep: (s: number) => void;
    periodoInicio: string;
    periodoFim: string;
    selectedCicloIds: string[];
    lojasSemNf: Set<string>;
    agendamentos: any[];
    nfseFiles: { name: string; blob: Blob; buffer: ArrayBuffer }[];
    setNfseFiles: React.Dispatch<React.SetStateAction<{ name: string; blob: Blob; buffer: ArrayBuffer }[]>>;
}

export default function EmissaoNotas({
    setCurrentStep,
    periodoInicio,
    periodoFim,
    selectedCicloIds,
    lojasSemNf,
    agendamentos,
    nfseFiles,
    setNfseFiles
}: EmissaoNotasProps) {
    const [isExporting, setIsExporting] = useState(false);
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractError, setExtractError] = useState<string | null>(null);

    // Resumo Data State
    const [resumoData, setResumoData] = useState<any[]>([]);
    const [isLoadingResumo, setIsLoadingResumo] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");

    // Load Resumo on Mount
    useEffect(() => {
        const fetchResumo = async () => {
            try {
                const validados = agendamentos.filter(a =>
                    !a.isRemoved &&
                    (a.status === "OK" || a.status === "CORREÇÃO") &&
                    a.clienteId
                );

                const payloadAgendamentos = validados.map(a => ({
                    clienteId: a.clienteId,
                    status: a.status,
                    valorIwof: a.valorIwof,
                    suggestedValorIwof: a.suggestedValorIwof,
                    manualValue: a.manualValue,
                    rawRow: {
                        data_competencia: a.rawRow?.data_competencia
                    }
                }));

                const response = await fetch("/api/documentos/resumo-nfe", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        agendamentos: payloadAgendamentos,
                        lojasSemNF: Array.from(lojasSemNf)
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    setResumoData(data);
                }
            } catch (err) {
                console.error("Failed to load resumo", err);
            } finally {
                setIsLoadingResumo(false);
            }
        };

        fetchResumo();
    }, [agendamentos, lojasSemNf]);

    const filteredResumo = resumoData.filter(r =>
        (r.nome_conta_azul?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
        (r.razao_social?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
        (r.cnpj || "").includes(searchTerm)
    );

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    const handleDownload = async () => {
        setIsExporting(true);
        try {
            const validados = agendamentos.filter(a =>
                !a.isRemoved &&
                (a.status === "OK" || a.status === "CORREÇÃO") &&
                a.clienteId
            );

            const payloadAgendamentos = validados.map(a => ({
                clienteId: a.clienteId,
                status: a.status,
                valorIwof: a.valorIwof,
                suggestedValorIwof: a.suggestedValorIwof,
                manualValue: a.manualValue,
                rawRow: {
                    data_competencia: a.rawRow?.data_competencia
                }
            }));

            const response = await fetch("/api/documentos/simular-nfe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    agendamentos: payloadAgendamentos,
                    lojasSemNF: Array.from(lojasSemNf),
                    periodoInicio,
                    periodoFim
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || "Erro ao gerar NFE simulada.");
            }

            const blobResponse = await response.blob();
            const blob = new Blob([blobResponse], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.style.display = "none";
            a.href = downloadUrl;
            a.download = `planilha_nfe_iw_${Date.now()}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(downloadUrl);

            setIsExporting(false);
        } catch (e) {
            console.error("Erro ao exportar NFSE", e);
            setIsExporting(false);
        }
    };

    const processDroppedFile = async (file: File) => {
        setIsExtracting(true);
        setExtractError(null);
        try {
            if (file.name.toLowerCase().endsWith('.zip')) {
                const arrayBuffer = await file.arrayBuffer();
                const zip = new JSZip();
                const contents = await zip.loadAsync(arrayBuffer);

                const extractedFiles: { name: string; blob: Blob; buffer: ArrayBuffer }[] = [];

                const pdfFiles = Object.keys(contents.files).filter(name => name.toLowerCase().endsWith('.pdf') || name.toLowerCase().endsWith('.xml'));

                if (pdfFiles.length === 0) {
                    setExtractError("O arquivo ZIP não contém notas fiscais válidas (.pdf ou .xml).");
                    setIsExtracting(false);
                    return;
                }

                for (const filename of pdfFiles) {
                    const zipObj = contents.files[filename];
                    if (!zipObj.dir) {
                        const fileData = await zipObj.async("blob");
                        const fileBuffer = await zipObj.async("arraybuffer");
                        // Clean up filename commonly used by Conta Azul
                        let cleanName = filename.split('/').pop() || filename;
                        extractedFiles.push({
                            name: cleanName,
                            blob: fileData,
                            buffer: fileBuffer
                        });
                    }
                }

                setNfseFiles(extractedFiles);
            } else if (file.name.toLowerCase().endsWith('.xml') || file.name.toLowerCase().endsWith('.pdf')) {
                const arrayBuffer = await file.arrayBuffer();
                setNfseFiles([{
                    name: file.name,
                    blob: file,
                    buffer: arrayBuffer
                }]);
            } else {
                setExtractError("Formato de arquivo não suportado.");
            }
        } catch (e: any) {
            console.error("Failed to process file", e);
            setExtractError("Erro ao processar o arquivo. Certifique-se de que é válido.");
        } finally {
            setIsExtracting(false);
        }
    };

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) {
            processDroppedFile(acceptedFiles[0]);
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            "application/zip": [".zip"],
            "application/x-zip-compressed": [".zip"],
            "text/xml": [".xml"],
            "application/xml": [".xml"],
            "application/octet-stream": [".xml"]
        },
        maxFiles: 1,
    });

    return (
        <div className="flex flex-col gap-6 max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-4">
                <button className="btn btn-ghost text-[var(--fg-dim)] hover:text-[var(--fg)]" onClick={() => setCurrentStep(3)}>
                    <ArrowLeft size={16} /> Voltar Seleção Fiscal
                </button>
                <button
                    className="btn btn-primary"
                    onClick={() => setCurrentStep(5)}
                    disabled={nfseFiles.length === 0}
                >
                    Avançar para Fechamento <ChevronRight size={16} />
                </button>
            </div>

            <div className="text-center mb-6">
                <h2 className="text-3xl font-black text-[var(--fg)] mb-2">Emissão de Notas</h2>
                <p className="text-[var(--fg-dim)] max-w-2xl mx-auto">
                    Exporte a planilha unificada, importe na plataforma emissora (Conta Azul/NFE.IO) e, em seguida, devolva o arquivo ZIP gerado para darmos continuidade ao disparo e faturamento.
                </p>
            </div>

            {/* Resumo Table */}
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] shadow-sm overflow-hidden mb-8">
                <div className="p-5 border-b border-[var(--border)] flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h3 className="text-lg font-bold text-[var(--fg)]">Resumo de Emissão</h3>
                        <p className="text-sm text-[var(--fg-dim)]">Valores consolidados que serão exportados na planilha.</p>
                    </div>
                    <div className="relative w-full md:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-dim)]" size={16} />
                        <input
                            type="text"
                            placeholder="Buscar loja ou CNPJ..."
                            className="w-full bg-[var(--bg-sidebar)] border border-[var(--border)] rounded-full py-2 pl-10 pr-4 text-sm text-[var(--fg)] focus:outline-none focus:border-[var(--accent)]"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                <div className="overflow-x-auto max-h-[400px]">
                    <table className="table w-full table-pin-rows table-pin-cols text-sm">
                        <thead className="bg-[var(--bg-sidebar)] text-[var(--fg-dim)] shadow-[0_1px_0_var(--border)]">
                            <tr>
                                <th className="bg-[var(--bg-sidebar)]">Loja</th>
                                <th className="text-center">NFSE Gerada</th>
                                <th>Ciclo</th>
                                <th className="text-right">Boleto Base</th>
                                <th className="text-right text-emerald-500">Acréscimos</th>
                                <th className="text-right text-rose-500">Descontos</th>
                                <th className="text-right text-[var(--accent)]">NC (88,5%)</th>
                                <th className="text-right text-purple-400">NF (11,5%)</th>
                                <th className="text-right font-bold text-[var(--fg)] bg-[var(--bg-sidebar)]">Boleto Final</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoadingResumo ? (
                                <tr>
                                    <td colSpan={9} className="text-center py-12">
                                        <span className="loading loading-spinner text-[var(--accent)]"></span>
                                        <p className="text-[var(--fg-dim)] mt-2">Calculando resumo consolidado...</p>
                                    </td>
                                </tr>
                            ) : filteredResumo.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="text-center py-12 text-[var(--fg-dim)]">
                                        Nenhum registro encontrado.
                                    </td>
                                </tr>
                            ) : (
                                filteredResumo.map((row) => (
                                    <tr key={row.id} className="hover:bg-[var(--bg-sidebar)]/50 transition-colors group">
                                        <td className="max-w-[250px] bg-[var(--bg-card)] group-hover:bg-[var(--bg-sidebar)]/50 transition-colors">
                                            <div className="font-bold text-[var(--fg)] truncate" title={row.nome_conta_azul || row.razao_social}>
                                                {row.nome_conta_azul || row.razao_social}
                                            </div>
                                            <div className="text-xs text-[var(--fg-dim)] truncate mt-0.5" title={row.razao_social}>
                                                {row.razao_social}
                                            </div>
                                            <div className="text-[10px] text-[var(--fg-dim)]/70 font-mono mt-0.5">
                                                {row.cnpj}
                                            </div>
                                        </td>
                                        <td className="text-center">
                                            {row.gerou_nfse ? (
                                                <div className="badge badge-success badge-sm badge-outline gap-1">Sim</div>
                                            ) : (
                                                <div className="badge badge-ghost badge-sm gap-1 text-[var(--fg-dim)]">Não</div>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap text-[var(--fg-dim)]">
                                            {row.ciclo}
                                        </td>
                                        <td className="text-right whitespace-nowrap text-[var(--fg-dim)]">
                                            {formatCurrency(row.boleto_base)}
                                        </td>
                                        <td className="text-right whitespace-nowrap text-emerald-500/80">
                                            {row.acrescimos > 0 ? formatCurrency(row.acrescimos) : "-"}
                                        </td>
                                        <td className="text-right whitespace-nowrap text-rose-500/80">
                                            {row.descontos > 0 ? formatCurrency(row.descontos) : "-"}
                                        </td>
                                        <td className="text-right whitespace-nowrap font-medium text-[var(--accent)]/90">
                                            {formatCurrency(row.nc)}
                                        </td>
                                        <td className="text-right whitespace-nowrap font-medium text-purple-400/90">
                                            {formatCurrency(row.nf)}
                                        </td>
                                        <td className="text-right font-bold text-[var(--fg)] whitespace-nowrap bg-[var(--bg-card)] group-hover:bg-[var(--bg-sidebar)]/50 transition-colors">
                                            {formatCurrency(row.boleto_final)}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* Column 1: Download NFE */}
                <div className="bg-gradient-to-b from-[var(--bg-sidebar)] to-[rgba(33,118,255,0.05)] border border-[var(--border)] rounded-3xl p-10 flex flex-col items-center justify-center text-center shadow-lg relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-500">
                        <FileDown size={180} />
                    </div>

                    <div className="w-24 h-24 bg-[var(--accent)]/10 rounded-full flex items-center justify-center mb-6 relative z-10 border border-[var(--accent)]/20 shadow-[0_0_30px_rgba(33,118,255,0.2)]">
                        <FileDown size={40} className="text-[var(--accent)]" />
                    </div>

                    <h3 className="text-2xl font-bold text-[var(--fg)] mb-3 relative z-10">Exportar Planilha Base</h3>
                    <p className="text-[var(--fg-dim)] mb-8 relative z-10 text-sm leading-relaxed px-4">
                        Faça o download da planilha padronizada contendo apenas as lojas selecionadas para a emissão. Este é o arquivo que você subirá na plataforma da NFE.IO.
                    </p>

                    <button
                        className="btn btn-primary btn-lg w-full max-w-xs relative z-10"
                        onClick={handleDownload}
                        disabled={isExporting}
                    >
                        {isExporting ? (
                            <><span className="loading loading-spinner"></span> Preparando XLSX...</>
                        ) : (
                            <><FileDown size={18} /> Download Padrão NFE.IO</>
                        )}
                    </button>
                </div>

                {/* Column 2: Upload ZIP */}
                <div
                    {...getRootProps()}
                    className={`w-full h-full min-h-[300px] bg-gradient-to-b from-[var(--bg-sidebar)] to-[#0c1824] border-2 border-dashed rounded-3xl p-10 flex flex-col items-center justify-center text-center shadow-lg transition-all duration-300 relative overflow-hidden focus:outline-none cursor-pointer
                        ${isDragActive ? "border-[var(--accent)] bg-[rgba(33,118,255,0.1)] scale-[1.02]" : "border-[var(--border)] hover:border-[var(--fg-dim)]"}
                        ${nfseFiles.length > 0 ? "border-[var(--success)]/50 from-[var(--bg-sidebar)] to-[rgba(34,197,94,0.05)] cursor-default" : ""}
                    `}
                    onClick={(e) => {
                        // Prevent opening dialog if we already have files, let them click "Remover" instead
                        if (nfseFiles.length > 0) e.preventDefault();
                    }}
                >
                    <input {...getInputProps()} disabled={nfseFiles.length > 0 || isExtracting} />

                    {isExtracting ? (
                        <div className="flex flex-col items-center gap-4 relative z-10 animate-in fade-in">
                            <span className="loading loading-spinner loading-lg text-[var(--accent)]"></span>
                            <p className="font-bold text-[var(--fg)]">Extraindo arquivos do ZIP...</p>
                        </div>
                    ) : nfseFiles.length > 0 ? (
                        <div className="flex flex-col items-center gap-4 relative z-10 animate-in zoom-in duration-300">
                            <div className="w-24 h-24 bg-[var(--success)]/10 rounded-full flex items-center justify-center border border-[var(--success)]/30 mb-2">
                                <CheckCircle2 size={48} className="text-[var(--success)]" />
                            </div>
                            <div>
                                <h3 className="text-2xl font-bold text-[var(--fg)] mb-1">Upload Concluído!</h3>
                                <p className="text-[var(--success)] font-medium bg-[var(--success)]/10 px-4 py-1.5 rounded-full inline-block">
                                    {nfseFiles.length} notas carregadas na memória
                                </p>
                            </div>
                            <button
                                className="btn btn-ghost text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white rounded-full mt-4 transition-colors px-6"
                                onClick={(e) => { e.stopPropagation(); setNfseFiles([]); }}
                            >
                                <X size={16} className="mr-2" /> Remover e Tentar Novamente
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-4 relative z-10">
                            <div className="absolute top-0 right-0 p-8 opacity-5 transition-opacity transform group-hover:scale-110 duration-500 pointer-events-none">
                                <FileArchive size={180} />
                            </div>
                            <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 border transition-all duration-300 ${isDragActive ? "bg-[var(--accent)] text-white border-[var(--accent)] scale-110 shadow-[0_0_40px_rgba(33,118,255,0.4)]" : "bg-[var(--bg-card)] text-[var(--fg-dim)] border-[var(--border)]"}`}>
                                <UploadCloud size={40} className={isDragActive ? "animate-bounce" : ""} />
                            </div>
                            <h3 className="text-2xl font-bold text-[var(--fg)] mb-2">Devolver ZIP com XML/PDFs</h3>
                            <p className="text-[var(--fg-dim)] text-sm max-w-[280px] leading-relaxed mb-4">
                                Após gerar as notas na plataforma, baixe o arquivo comprimido (.zip) e jogue aqui.
                            </p>

                            {extractError && (
                                <div className="bg-[rgba(239,68,68,0.1)] text-[var(--danger)] text-xs px-4 py-2 rounded-lg flex items-center gap-2 mb-2 animate-in slide-in-from-bottom-2">
                                    <AlertCircle size={14} /> {extractError}
                                </div>
                            )}

                            <span className="btn btn-outline border-[var(--border)] text-[var(--fg-dim)] hover:border-[var(--fg)] hover:text-[var(--fg)] transition-colors">
                                Selecionar Arquivo
                            </span>
                        </div>
                    )}
                </div>

            </div>

            {/* Warning block if trying to advance without NF */}
            {nfseFiles.length === 0 && (
                <div className="mt-8 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-center justify-center gap-3 text-sm text-amber-500 max-w-2xl mx-auto">
                    <Info size={16} /> Para avançar para a fase de fechamento de lote (Triagem), é obrigatório o envio das notas.
                </div>
            )}
        </div>
    );
}

