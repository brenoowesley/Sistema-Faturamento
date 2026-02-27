"use client";

import { useCallback, useState } from "react";
import { UploadCloud, FileType2, Loader2, AlertCircle } from "lucide-react";
import JSZip from "jszip";
import { TriagemFile } from "./WizardTriagem";

interface Step1UploadProps {
    onNext: (files: TriagemFile[]) => void;
    setIsProcessing: (loading: boolean) => void;
    isProcessing: boolean;
}

export default function Step1Upload({ onNext, setIsProcessing, isProcessing }: Step1UploadProps) {
    const [dragActive, setDragActive] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    }, []);

    const extractAndProcessFiles = async (fileList: FileList | File[]) => {
        setIsProcessing(true);
        setErrorMsg(null);
        let extractedFiles: TriagemFile[] = [];

        try {
            for (let i = 0; i < fileList.length; i++) {
                const file = fileList[i];

                // If it's a PDF (Boleto)
                if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
                    extractedFiles.push({ file, status: 'pending' });
                }
                // If it's a ZIP (NFs)
                else if (file.type === "application/zip" || file.type === "application/x-zip-compressed" || file.name.toLowerCase().endsWith(".zip")) {
                    const zip = new JSZip();
                    const contents = await zip.loadAsync(file);

                    const pdfPromises: Promise<void>[] = [];

                    contents.forEach((relativePath, zipEntry) => {
                        if (!zipEntry.dir && relativePath.toLowerCase().endsWith(".pdf")) {
                            pdfPromises.push(
                                zipEntry.async("blob").then(blob => {
                                    // Extract NF number logic: expects pattern "XXXX-nfse.pdf". 
                                    // The old logic took the last 5 digits before "-nfse". We'll refine this in Step 2.
                                    const extractedFile = new File([blob], zipEntry.name, { type: "application/pdf" });
                                    extractedFiles.push({ file: extractedFile, status: 'pending' });
                                })
                            );
                        }
                    });

                    await Promise.all(pdfPromises);
                } else {
                    console.warn("Ignorado: formato não suportado", file.name);
                }
            }

            if (extractedFiles.length === 0) {
                setErrorMsg("Nenhum arquivo PDF válido encontrado.");
                setIsProcessing(false);
                return;
            }

            // Move to Step 2
            onNext(extractedFiles);
        } catch (err: any) {
            console.error(err);
            setErrorMsg("Erro ao processar os arquivos. Certifique-se de que os ZIPs não estão corrompidos.");
            setIsProcessing(false);
        }
    };

    const handleDrop = useCallback(
        async (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setDragActive(false);

            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                await extractAndProcessFiles(e.dataTransfer.files);
            }
        },
        [onNext, setIsProcessing] // eslint-disable-line react-hooks/exhaustive-deps
    );

    const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files.length > 0) {
            await extractAndProcessFiles(e.target.files);
        }
    };

    return (
        <div className="card">
            <div className="flex flex-col mb-6">
                <h2 className="text-xl font-bold text-white mb-2">Upload de Arquivos</h2>
                <p className="text-sm text-[var(--fg-dim)]">Arraste os arquivos PDF de Boletos individuais ou um arquivo ZIP contendo as Notas Fiscais extraídas do portal (NFE.io).</p>
            </div>

            {errorMsg && (
                <div className="bg-[rgba(248,113,113,0.1)] border border-[var(--danger)] text-[var(--danger)] p-4 rounded-xl flex items-center gap-3 mb-6">
                    <AlertCircle size={20} />
                    <span className="text-sm font-medium">{errorMsg}</span>
                </div>
            )}

            <div
                className={`dropzone ${dragActive ? 'dropzone-active' : ''} ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => document.getElementById("file-upload")?.click()}
            >
                {isProcessing ? (
                    <div className="flex flex-col items-center gap-4 py-8">
                        <Loader2 size={48} className="text-[var(--accent)] animate-spin" />
                        <span className="font-semibold text-white tracking-widest uppercase text-sm">Extraindo pacotes...</span>
                    </div>
                ) : (
                    <>
                        <div className="w-16 h-16 rounded-full bg-[rgba(129,140,248,0.1)] flex items-center justify-center mb-2">
                            <UploadCloud size={32} className="text-[var(--accent)]" />
                        </div>
                        <h3 className="text-lg font-bold text-white">Arraste seus PDFs ou ZIPs aqui</h3>
                        <p className="text-sm text-[var(--fg-muted)]">Ou clique para selecionar de uma pasta.</p>
                        <div className="flex gap-3 mt-4">
                            <span className="badge badge-info"><FileType2 size={12} /> PDF (Boletos)</span>
                            <span className="badge badge-warning"><FileType2 size={12} /> ZIP (NFs)</span>
                        </div>
                    </>
                )}
                <input
                    id="file-upload"
                    type="file"
                    multiple
                    accept=".pdf,.zip,application/pdf,application/zip"
                    className="hidden"
                    onChange={handleChange}
                />
            </div>

            <div className="mt-6 flex justify-between items-center bg-[var(--bg-card-hover)] p-4 rounded-lg border border-[var(--border)]">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[rgba(52,211,153,0.15)] text-[var(--success)] flex items-center justify-center">
                        <AlertCircle size={16} />
                    </div>
                    <div>
                        <p className="text-sm font-bold text-white">Como funciona?</p>
                        <p className="text-xs text-[var(--fg-dim)]">Seus ZIPs não sobem diretamente pro servidor. Nós extraimos tudo de forma ultra-rápida no seu navegador e usamos a inteligência artificial para ler os nomes.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
