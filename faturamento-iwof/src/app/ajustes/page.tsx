"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
    Plus,
    Minus,
    History,
    Trash2,
    Save,
    Calendar,
    User,
    Building2,
    DollarSign,
    Clock,
    CheckCircle2,
    Search,
    ChevronDown,
    X,
    Eye,
    Pencil,
    Upload,
    AlertTriangle
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import Modal from "@/components/Modal";

/* ================================================================
   TYPES
   ================================================================ */

type AjusteTipo = "DESCONTO" | "ACRESCIMO";

interface Ajuste {
    id: string;
    cliente_id: string;
    tipo: AjusteTipo;
    valor: number;
    motivo: string;
    nome_profissional: string;
    data_ocorrencia: string;
    status_aplicacao: boolean;
    data_aplicacao: string | null;
    lote_aplicado_id: string | null;
    inicio?: string;
    termino?: string;
    fracao_hora?: number;
    clientes?: {
        nome_fantasia: string;
        razao_social: string;
        nome_conta_azul: string | null;
        cnpj: string;
    };
    observacao_interna?: string;
    repasse_profissional?: boolean;
}

interface ClienteDB {
    id: string;
    razao_social: string;
    nome_fantasia: string | null;
    nome_conta_azul: string | null;
    cnpj: string;
}

/* ================================================================
   UTILS
   ================================================================ */

const fmtCurrency = (val: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);

const fmtDate = (dateStr: string) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return d.toLocaleDateString("pt-BR");
};

const fmtDateTime = (dateStr?: string) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
};

const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(val);
};

const parseBRL = (val: string) => {
    if (!val) return 0;
    return parseFloat(val.replace(/\./g, "").replace(",", ".")) || 0;
};

const parseDinheiroBrasil = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const clean = String(val)
        .replace("R$", "")
        .replace(/\s/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
    return parseFloat(clean) || 0;
};

const limparCNPJ = (cnpj: any): string => {
    if (!cnpj) return "";
    return String(cnpj).replace(/\D/g, "");
};

/* ================================================================
   SUB-COMPONENTS
   ================================================================ */

interface SearchableSelectProps {
    options: ClienteDB[];
    value: string;
    onChange: (client: ClienteDB | null) => void;
    placeholder: string;
}

function SearchableSelect({ options, value, onChange, placeholder }: SearchableSelectProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find(o => o.id === value);

    const filteredOptions = options.filter(o =>
        (o.nome_conta_azul || o.nome_fantasia || o.razao_social || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (o.cnpj || "").includes(searchTerm)
    );

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={containerRef}>
            <div
                className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white p-2.5 rounded-lg text-sm focus-within:border-[var(--primary)] outline-none cursor-pointer flex justify-between items-center"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className={selectedOption ? "text-white" : "text-[var(--fg-dim)]"}>
                    {selectedOption ? (selectedOption.nome_conta_azul || selectedOption.nome_fantasia || selectedOption.razao_social) : placeholder}
                </span>
                <ChevronDown size={16} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>

            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-2xl max-h-60 overflow-y-auto overflow-x-hidden animate-in fade-in slide-in-from-top-1">
                    <div className="p-2 sticky top-0 bg-[var(--bg-card)] border-b border-[var(--border)]">
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 text-[var(--fg-dim)]" size={14} />
                            <input
                                type="text"
                                className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-white pl-8 pr-2 py-1.5 rounded-md text-sm outline-none focus:border-[var(--primary)]"
                                placeholder="Pesquisar..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                autoFocus
                            />
                        </div>
                    </div>
                    <div className="p-1">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map(option => (
                                <div
                                    key={option.id}
                                    className={`p-2 hover:bg-[var(--primary)]/20 rounded cursor-pointer transition-colors ${value === option.id ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'text-white'}`}
                                    onClick={() => {
                                        onChange(option);
                                        setIsOpen(false);
                                        setSearchTerm("");
                                    }}
                                >
                                    <div className="font-medium">{option.nome_conta_azul || option.nome_fantasia || option.razao_social}</div>
                                    <div className="text-[10px] text-[var(--fg-dim)] font-mono">{option.cnpj}</div>
                                </div>
                            ))
                        ) : (
                            <div className="p-4 text-center text-xs text-[var(--fg-dim)]">Nenhuma empresa encontrada</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

interface BatchUploadActionProps {
    onUpload: (files: File[]) => void;
    isLoading: boolean;
    type: "ACRESCIMO" | "DESCONTO";
}

function BatchUploadAction({ onUpload, isLoading, type }: BatchUploadActionProps) {
    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: onUpload,
        accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "text/csv": [".csv"] },
        multiple: false
    });

    return (
        <div
            {...getRootProps()}
            className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl transition-all cursor-pointer space-y-2
                ${isDragActive ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--border)] hover:border-[var(--primary)]/50 hover:bg-[var(--bg-card)]'}`}
        >
            <input {...getInputProps()} />
            <div className={`p-3 rounded-full ${type === 'DESCONTO' ? 'bg-amber-500/10 text-amber-500' : 'bg-[var(--primary)]/10 text-[var(--primary)]'}`}>
                <Upload size={24} />
            </div>
            <div className="text-center">
                <p className="text-sm font-bold text-white">Importar Lote ({type === 'DESCONTO' ? 'Descontos' : 'Acréscimos'})</p>
                <p className="text-[10px] text-[var(--fg-dim)] uppercase tracking-widest mt-1">Excel (.xlsx) ou CSV</p>
            </div>
            {isLoading && (
                <div className="flex items-center gap-2 text-[var(--primary)] animate-pulse">
                    <div className="w-2 h-2 rounded-full bg-current animate-bounce"></div>
                    <span className="text-[10px] font-bold">Processando...</span>
                </div>
            )}
        </div>
    );
}

/* ================================================================
   COMPONENT
   ================================================================ */

export default function AjustesPage() {
    const supabase = createClient();

    // State
    const [activeTab, setActiveTab] = useState<"descontos" | "acrescimos" | "historico">("descontos");
    const [ajustes, setAjustes] = useState<Ajuste[]>([]);
    const [clientes, setClientes] = useState<ClienteDB[]>([]);
    const [loading, setLoading] = useState(true);

    // Modal state
    const [showModalDesconto, setShowModalDesconto] = useState(false);
    const [showModalAcrescimo, setShowModalAcrescimo] = useState(false);
    const [showModalDetalhes, setShowModalDetalhes] = useState(false);
    const [selectedAjuste, setSelectedAjuste] = useState<Ajuste | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const [pendingAdjustments, setPendingAdjustments] = useState<any[]>([]);
    const [showPreview, setShowPreview] = useState(false);
    const [isProcessingFile, setIsProcessingFile] = useState(false);

    // Bulk action states
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Form states
    const [formData, setFormData] = useState({
        clienteId: "",
        valor: "",
        profissional: "",
        motivo: "",
        data: new Date().toISOString().split("T")[0],
        observacaoInterna: "",
        repasseProfissional: false,
    });

    const fetchAjustes = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from("ajustes_faturamento")
            .select("*, clientes(nome_fantasia, razao_social, nome_conta_azul, cnpj)")
            .order("created_at", { ascending: false });

        if (error) console.error("Error fetching ajustes:", error);
        else setAjustes(data || []);
        setLoading(false);
    }, [supabase]);

    const fetchClientes = useCallback(async () => {
        const { data, error } = await supabase
            .from("clientes")
            .select("id, razao_social, nome_fantasia, cnpj, nome_conta_azul")
            .eq("status", true)
            .order("nome_conta_azul", { ascending: true });

        if (error) console.error("Error fetching clientes:", error);
        else setClientes(data || []);
    }, [supabase]);

    useEffect(() => {
        fetchAjustes();
        fetchClientes();
    }, [fetchAjustes, fetchClientes]);

    const handleSaveDesconto = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);

        const payload = {
            cliente_id: formData.clienteId,
            tipo: "DESCONTO",
            valor: parseBRL(formData.valor),
            nome_profissional: formData.profissional,
            motivo: formData.motivo,
            data_ocorrencia: formData.data,
            observacao_interna: formData.observacaoInterna,
            repasse_profissional: formData.repasseProfissional,
            status_aplicacao: false
        };

        const { error } = await supabase.from("ajustes_faturamento").upsert(payload, {
            onConflict: editingId ? "id" : undefined // If editing, use ID for upsert, else let DB handle new insert
        });

        if (error) {
            alert("Erro ao salvar desconto: " + error.message);
        } else {
            setShowModalDesconto(false);
            resetForm();
            fetchAjustes();
        }
        setIsSaving(false);
    };

    const handleSaveAcrescimo = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);

        const payload = {
            cliente_id: formData.clienteId,
            tipo: "ACRESCIMO",
            valor: parseBRL(formData.valor),
            nome_profissional: formData.profissional,
            motivo: formData.motivo,
            data_ocorrencia: formData.data,
            observacao_interna: formData.observacaoInterna,
            repasse_profissional: formData.repasseProfissional,
            status_aplicacao: false
        };

        const { error } = await supabase.from("ajustes_faturamento").upsert(payload);

        if (error) {
            alert("Erro ao salvar acréscimo: " + error.message);
        } else {
            setShowModalAcrescimo(false);
            resetForm();
            fetchAjustes();
        }
        setIsSaving(false);
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Deseja realmente excluir este lançamento?")) return;

        const { error } = await supabase
            .from("ajustes_faturamento")
            .delete()
            .eq("id", id);

        if (error) alert("Erro ao excluir: " + error.message);
        else fetchAjustes();
    };

    const resetForm = () => {
        setFormData({
            clienteId: "",
            valor: "",
            profissional: "",
            motivo: "",
            data: new Date().toISOString().split("T")[0],
            observacaoInterna: "",
            repasseProfissional: false,
        });
        setEditingId(null);
    };

    const handleEdit = (ajuste: Ajuste) => {
        setFormData({
            clienteId: ajuste.cliente_id,
            valor: formatBRL(ajuste.valor),
            profissional: ajuste.nome_profissional || "",
            motivo: ajuste.motivo || "",
            data: ajuste.data_ocorrencia,
            observacaoInterna: ajuste.observacao_interna || "",
            repasseProfissional: ajuste.repasse_profissional || false,
        });
        setEditingId(ajuste.id);
        if (ajuste.tipo === "DESCONTO") setShowModalDesconto(true);
        else setShowModalAcrescimo(true);
    };
    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(`Deseja realmente excluir os ${selectedIds.size} itens selecionados?`)) return;

        setIsSaving(true);
        try {
            const { error } = await supabase
                .from("ajustes_faturamento")
                .delete()
                .in("id", Array.from(selectedIds));

            if (error) throw error;

            alert(`${selectedIds.size} itens excluídos com sucesso!`);
            setSelectedIds(new Set());
            fetchAjustes();
        } catch (err: any) {
            console.error("Error bulk deleting:", err);
            alert("Erro ao excluir itens: " + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const toggleSelection = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const toggleAll = (ids: string[]) => {
        if (selectedIds.size === ids.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(ids));
        }
    };

    const handleFileUpload = useCallback(async (acceptedFiles: File[], type: AjusteTipo) => {
        if (acceptedFiles.length === 0) return;
        setIsProcessingFile(true);
        const file = acceptedFiles[0];

        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json<any>(sheet);

            const processed: any[] = [];

            for (const row of json) {
                let clienteMatch: ClienteDB | undefined;
                let valor = 0;
                let motivo = "";
                let status = "OK";
                let warning = "";

                if (type === "ACRESCIMO") {
                    // Acréscimos: Nome, Loja, Vaga, Valor IWOF, ...
                    const lojaNome = row["Loja"] || row["LOJA"] || row["Empresa"] || row["EMPRESA"];
                    const profissional = row["Nome"] || row["NOME"] || row["Profissional"] || row["PROFISSIONAL"] || row["Prestador"] || row["PRESTADOR"];
                    const vaga = row["Vaga"] || row["VAGA"] || row["Cargo"] || row["CARGO"];
                    valor = parseDinheiroBrasil(row["Valor IWOF"]);
                    motivo = vaga || "Acréscimo em Lote";

                    const normalizedSearch = (lojaNome || "").toUpperCase().trim();
                    clienteMatch = clientes.find(c =>
                        (c.nome_conta_azul || "").toUpperCase().trim() === normalizedSearch
                    );
                } else {
                    // Descontos: Empresa, CNPJ, Valor, Motivo, Usuário, Aplicado, ...
                    const cnpj = limparCNPJ(row["CNPJ"]);
                    const empresa = row["Empresa"] || row["EMPRESA"];
                    const motivoRaw = row["Motivo"] || row["MOTIVO"];
                    const usuario = row["Usuário"] || row["USUÁRIO"] || row["Usuario"];
                    const jaAplicado = String(row["Aplicado"]).toUpperCase() === "TRUE" || row["Aplicado"] === true;

                    if (jaAplicado) continue; // Skip already applied

                    valor = parseDinheiroBrasil(row["Valor"] || row["VALOR"]);
                    motivo = motivoRaw || "Desconto em Lote";

                    if (!clienteMatch && empresa) {
                        const normalizedEmpresa = (empresa || "").toUpperCase().trim();
                        clienteMatch = clientes.find(c =>
                            (c.nome_conta_azul || "").toUpperCase().trim() === normalizedEmpresa
                        );
                    }
                }

                if (!clienteMatch) {
                    status = "ERROR";
                    warning = "Cliente não encontrado no banco.";
                }

                processed.push({
                    id: crypto.randomUUID(),
                    cliente_id: clienteMatch?.id || null,
                    cliente_nome: clienteMatch ? (clienteMatch.nome_fantasia || clienteMatch.razao_social) : (row["Loja"] || row["Empresa"] || "N/A"),
                    tipo: type,
                    valor,
                    motivo,
                    observacao_interna: type === "DESCONTO" ? (row["Usuário"] || row["USUÁRIO"] || row["Usuario"] ? `Planilha Usuário/Audit: ${row["Usuário"] || row["USUÁRIO"] || row["Usuario"]}` : "") : "",
                    nome_profissional: type === "DESCONTO"
                        ? (row["Usuário"] || row["USUÁRIO"] || row["Usuario"] || row["Nome"] || row["NOME"] || row["Profissional"] || row["PROFISSIONAL"] || "N/A")
                        : (row["Nome"] || row["NOME"] || row["Profissional"] || row["PROFISSIONAL"] || row["Prestador"] || row["PRESTADOR"] || "N/A"),
                    data_ocorrencia: new Date().toISOString().split("T")[0],
                    status,
                    warning
                });
            }

            setPendingAdjustments(processed);
            setShowPreview(true);
        } catch (err) {
            console.error("Error processing file:", err);
            alert("Erro ao processar planilha.");
        } finally {
            setIsProcessingFile(false);
        }
    }, [clientes]);

    const handleSaveBatch = async () => {
        const toSave = pendingAdjustments.filter(p => p.status === "OK" && p.cliente_id);
        if (toSave.length === 0) {
            alert("Nenhum item válido para salvar.");
            return;
        }

        setIsSaving(true);
        try {
            const payload = toSave.map(p => ({
                cliente_id: p.cliente_id,
                tipo: p.tipo,
                valor: p.valor,
                motivo: p.motivo,
                nome_profissional: p.nome_profissional,
                data_ocorrencia: p.data_ocorrencia,
                observacao_interna: p.observacao_interna,
                status_aplicacao: false
            }));

            const { error } = await supabase.from("ajustes_faturamento").insert(payload);
            if (error) throw error;

            alert(`${toSave.length} ajustes salvos com sucesso!`);
            setShowPreview(false);
            setPendingAdjustments([]);
            fetchAjustes();
        } catch (err: any) {
            console.error("Error saving batch:", err);
            alert("Erro ao salvar lote: " + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    // Filtered data
    const descontosPendentes = ajustes.filter(a => a.tipo === "DESCONTO" && !a.status_aplicacao);
    const acrescimosPendentes = ajustes.filter(a => a.tipo === "ACRESCIMO" && !a.status_aplicacao);
    const historico = ajustes.filter(a => a.status_aplicacao);

    const totalDescontos = descontosPendentes.reduce((acc, curr) => acc + curr.valor, 0);
    const totalAcrescimos = acrescimosPendentes.reduce((acc, curr) => acc + curr.valor, 0);

    return (
        <div className="min-h-screen bg-[var(--bg-main)] p-8">
            <div className="max-w-7xl mx-auto space-y-8">

                {/* Header */}
                <div className="flex justify-between items-center bg-[var(--bg-card)] p-6 rounded-2xl border border-[var(--border)] shadow-xl">
                    <div>
                        <h1 className="text-2xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
                            <History className="text-[var(--primary)]" size={28} />
                            Central de Ajustes
                        </h1>
                        <p className="text-[var(--fg-dim)] text-sm mt-1">
                            Gestão de descontos e acréscimos manuais para faturamento contínuo.
                        </p>
                    </div>
                    <div className="flex gap-4">
                        <button
                            onClick={() => { resetForm(); setShowModalDesconto(true); }}
                            disabled={isSaving || isProcessingFile}
                            className="btn btn-primary bg-amber-600 hover:bg-amber-700 border-none flex items-center gap-2 disabled:opacity-50"
                        >
                            {isSaving ? <span className="loading loading-spinner loading-xs"></span> : <Plus size={18} />} Novo Desconto
                        </button>
                        <button
                            onClick={() => { resetForm(); setShowModalAcrescimo(true); }}
                            disabled={isSaving || isProcessingFile}
                            className="btn btn-primary bg-emerald-600 hover:bg-emerald-700 border-none flex items-center gap-2 disabled:opacity-50"
                        >
                            {isSaving ? <span className="loading loading-spinner loading-xs"></span> : <Plus size={18} />} Novo Acréscimo
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden shadow-lg">
                    <div className="flex border-b border-[var(--border)] bg-[var(--bg-card-hover)]">
                        <button
                            onClick={() => setActiveTab("descontos")}
                            className={`px-8 py-4 text-sm font-bold uppercase tracking-widest transition-all ${activeTab === 'descontos' ? 'text-[var(--primary)] border-b-2 border-[var(--primary)] bg-[var(--bg-card)]' : 'text-[var(--fg-dim)] hover:text-white'}`}
                        >
                            Descontos Pendentes
                        </button>
                        <button
                            onClick={() => setActiveTab("acrescimos")}
                            className={`px-8 py-4 text-sm font-bold uppercase tracking-widest transition-all ${activeTab === 'acrescimos' ? 'text-[var(--primary)] border-b-2 border-[var(--primary)] bg-[var(--bg-card)]' : 'text-[var(--fg-dim)] hover:text-white'}`}
                        >
                            Acréscimos Pendentes
                        </button>
                        <button
                            onClick={() => setActiveTab("historico")}
                            className={`px-8 py-4 text-sm font-bold uppercase tracking-widest transition-all ${activeTab === 'historico' ? 'text-[var(--primary)] border-b-2 border-[var(--primary)] bg-[var(--bg-card)]' : 'text-[var(--fg-dim)] hover:text-white'}`}
                        >
                            Histórico (Aplicados)
                        </button>
                    </div>

                    <div className="p-6">
                        {loading ? (
                            <div className="flex justify-center py-20">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--primary)]"></div>
                            </div>
                        ) : (
                            <>
                                {/* TAB CONTENTS */}
                                {activeTab === "descontos" && (
                                    <div className="space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="flex justify-between items-center bg-amber-950/20 p-4 rounded-xl border border-amber-900/30">
                                                <div className="flex flex-col">
                                                    <span className="text-amber-500 font-bold uppercase text-[10px] tracking-widest">Saldo Total Pendente</span>
                                                    <span className="text-2xl font-black text-amber-500">{fmtCurrency(totalDescontos)}</span>
                                                </div>
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <BatchUploadAction
                                                    type="DESCONTO"
                                                    isLoading={isProcessingFile}
                                                    onUpload={(files) => handleFileUpload(files, "DESCONTO")}
                                                />
                                                {selectedIds.size > 0 && (
                                                    <button
                                                        onClick={handleBulkDelete}
                                                        className="btn btn-danger w-full bg-red-600 hover:bg-red-700 flex items-center justify-center gap-2 h-10 rounded-xl transition-all"
                                                    >
                                                        <Trash2 size={16} /> Excluir {selectedIds.size} selecionados
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="table-container">
                                            <table className="w-full">
                                                <thead>
                                                    <tr>
                                                        <th className="w-10">
                                                            <input
                                                                type="checkbox"
                                                                className="checkbox checkbox-xs"
                                                                checked={selectedIds.size === descontosPendentes.length && descontosPendentes.length > 0}
                                                                onChange={() => toggleAll(descontosPendentes.map(d => d.id))}
                                                            />
                                                        </th>
                                                        <th>Empresa</th>
                                                        <th>Profissional</th>
                                                        <th>Motivo</th>
                                                        <th>Data</th>
                                                        <th>Valor</th>
                                                        <th className="text-right">Ação</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {descontosPendentes.map(a => (
                                                        <tr key={a.id} className="hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer group" onClick={() => { setSelectedAjuste(a); setShowModalDetalhes(true); }}>
                                                            <td onClick={(e) => e.stopPropagation()}>
                                                                <input
                                                                    type="checkbox"
                                                                    className="checkbox checkbox-xs"
                                                                    checked={selectedIds.has(a.id)}
                                                                    onChange={() => toggleSelection(a.id)}
                                                                />
                                                            </td>
                                                            <td className="table-primary">
                                                                <div className="flex flex-col">
                                                                    <span className="text-white font-bold">{a.clientes?.nome_conta_azul}</span>
                                                                    <span className="text-[10px] text-[var(--fg-dim)] lowercase opacity-80 leading-tight">
                                                                        {a.clientes?.razao_social} • {a.clientes?.cnpj}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="text-sm">{a.nome_profissional}</td>
                                                            <td className="text-xs text-[var(--fg-dim)]">{a.motivo}</td>
                                                            <td className="table-mono">{fmtDate(a.data_ocorrencia)}</td>
                                                            <td className="table-mono text-amber-500 font-bold">{fmtCurrency(a.valor)}</td>
                                                            <td className="text-right">
                                                                <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    <button onClick={(e) => { e.stopPropagation(); setSelectedAjuste(a); setShowModalDetalhes(true); }} title="Visualizar" className="btn btn-ghost btn-xs text-[var(--primary)]">
                                                                        <Eye size={14} />
                                                                    </button>
                                                                    <button onClick={(e) => { e.stopPropagation(); handleEdit(a); }} title="Editar" className="btn btn-ghost btn-xs text-[var(--primary)]">
                                                                        <Pencil size={14} />
                                                                    </button>
                                                                    <button onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }} title="Excluir" className="btn btn-ghost btn-xs text-[var(--danger)]">
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                    {descontosPendentes.length === 0 && (
                                                        <tr>
                                                            <td colSpan={6} className="text-center py-10 text-[var(--fg-dim)]">Nenhum desconto pendente.</td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}

                                {activeTab === "acrescimos" && (
                                    <div className="space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="flex justify-between items-center bg-[var(--primary)]/10 p-4 rounded-xl border border-[var(--primary)]/20">
                                                <div className="flex flex-col">
                                                    <span className="text-[var(--primary)] font-bold uppercase text-[10px] tracking-widest">Saldo Total Pendente</span>
                                                    <span className="text-2xl font-black text-[var(--primary)]">{fmtCurrency(totalAcrescimos)}</span>
                                                </div>
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <BatchUploadAction
                                                    type="ACRESCIMO"
                                                    isLoading={isProcessingFile}
                                                    onUpload={(files) => handleFileUpload(files, "ACRESCIMO")}
                                                />
                                                {selectedIds.size > 0 && (
                                                    <button
                                                        onClick={handleBulkDelete}
                                                        className="btn btn-danger w-full bg-red-600 hover:bg-red-700 flex items-center justify-center gap-2 h-10 rounded-xl transition-all"
                                                    >
                                                        <Trash2 size={16} /> Excluir {selectedIds.size} selecionados
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="table-container">
                                            <table className="w-full">
                                                <thead>
                                                    <tr>
                                                        <th className="w-10">
                                                            <input
                                                                type="checkbox"
                                                                className="checkbox checkbox-xs"
                                                                checked={selectedIds.size === acrescimosPendentes.length && acrescimosPendentes.length > 0}
                                                                onChange={() => toggleAll(acrescimosPendentes.map(a => a.id))}
                                                            />
                                                        </th>
                                                        <th>Empresa</th>
                                                        <th>Profissional</th>
                                                        <th>Motivo</th>
                                                        <th>Data</th>
                                                        <th>Valor</th>
                                                        <th className="text-right">Ação</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {acrescimosPendentes.map(a => (
                                                        <tr key={a.id} className="hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer group" onClick={() => { setSelectedAjuste(a); setShowModalDetalhes(true); }}>
                                                            <td onClick={(e) => e.stopPropagation()}>
                                                                <input
                                                                    type="checkbox"
                                                                    className="checkbox checkbox-xs"
                                                                    checked={selectedIds.has(a.id)}
                                                                    onChange={() => toggleSelection(a.id)}
                                                                />
                                                            </td>
                                                            <td className="table-primary">
                                                                <div className="flex flex-col">
                                                                    <span className="text-white font-bold">{a.clientes?.nome_conta_azul}</span>
                                                                    <span className="text-[10px] text-[var(--fg-dim)] lowercase opacity-80 leading-tight">
                                                                        {a.clientes?.razao_social} • {a.clientes?.cnpj}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="text-sm">{a.nome_profissional}</td>
                                                            <td className="text-xs text-[var(--fg-dim)]">{a.motivo}</td>
                                                            <td className="table-mono">{fmtDate(a.data_ocorrencia)}</td>
                                                            <td className="table-mono text-[var(--primary)] font-bold">{fmtCurrency(a.valor)}</td>
                                                            <td className="text-right">
                                                                <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    <button onClick={(e) => { e.stopPropagation(); setSelectedAjuste(a); setShowModalDetalhes(true); }} title="Visualizar" className="btn btn-ghost btn-xs text-[var(--primary)]">
                                                                        <Eye size={14} />
                                                                    </button>
                                                                    <button onClick={(e) => { e.stopPropagation(); handleEdit(a); }} title="Editar" className="btn btn-ghost btn-xs text-[var(--primary)]">
                                                                        <Pencil size={14} />
                                                                    </button>
                                                                    <button onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }} title="Excluir" className="btn btn-ghost btn-xs text-[var(--danger)]">
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                    {acrescimosPendentes.length === 0 && (
                                                        <tr>
                                                            <td colSpan={6} className="text-center py-10 text-[var(--fg-dim)]">Nenhum acréscimo pendente.</td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}

                                {activeTab === "historico" && (
                                    <div className="table-container">
                                        <table className="w-full">
                                            <thead>
                                                <tr>
                                                    <th>Empresa</th>
                                                    <th>Tipo</th>
                                                    <th>Profissional</th>
                                                    <th>Data Aplicação</th>
                                                    <th>Valor</th>
                                                    <th>Lote</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {historico.map(a => (
                                                    <tr key={a.id}>
                                                        <td className="table-primary">
                                                            <div className="flex flex-col">
                                                                <span className="text-white font-bold">{a.clientes?.nome_conta_azul}</span>
                                                                <span className="text-[10px] text-[var(--fg-dim)] lowercase opacity-80 leading-tight">
                                                                    {a.clientes?.razao_social} • {a.clientes?.cnpj}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${a.tipo === 'DESCONTO' ? 'bg-amber-900/40 text-amber-500' : 'bg-primary/20 text-primary'}`}>
                                                                {a.tipo}
                                                            </span>
                                                        </td>
                                                        <td className="text-sm">{a.nome_profissional}</td>
                                                        <td className="table-mono">{fmtDate(a.data_aplicacao!)}</td>
                                                        <td className={`table-mono font-bold ${a.tipo === 'DESCONTO' ? 'text-amber-500' : 'text-[var(--primary)]'}`}>
                                                            {fmtCurrency(a.valor)}
                                                        </td>
                                                        <td className="text-xs text-[var(--fg-dim)] truncate max-w-[100px]">{a.lote_aplicado_id || '-'}</td>
                                                    </tr>
                                                ))}
                                                {historico.length === 0 && (
                                                    <tr>
                                                        <td colSpan={6} className="text-center py-10 text-[var(--fg-dim)]">Nenhum registro no histórico.</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* MODAL NOVO DESCONTO */}
            <Modal isOpen={showModalDesconto} onClose={() => { setShowModalDesconto(false); resetForm(); }} title={editingId ? "Editar Desconto" : "Lançar Novo Desconto"} width="800px">
                <form onSubmit={handleSaveDesconto} className="space-y-6">
                    <div className="space-y-4 shadow-inner bg-[var(--bg-main)] p-4 rounded-xl border border-[var(--border)]">
                        <div className="form-group grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    <Building2 size={12} /> Empresa / Loja
                                </label>
                                <SearchableSelect
                                    options={clientes}
                                    value={formData.clienteId}
                                    placeholder="Selecione uma empresa..."
                                    onChange={(client) => setFormData({ ...formData, clienteId: client?.id || "" })}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    CNPJ
                                </label>
                                <div className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-[var(--fg-dim)] p-2.5 rounded-lg text-sm font-mono h-[38px] flex items-center">
                                    {clientes.find(c => c.id === formData.clienteId)?.cnpj || "-"}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    <DollarSign size={12} /> Valor do Desconto
                                </label>
                                <input
                                    type="text" required
                                    className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white p-2 rounded-lg text-sm focus:border-[var(--primary)] outline-none text-right font-mono"
                                    placeholder="0,00"
                                    value={formData.valor}
                                    onChange={e => {
                                        const digits = e.target.value.replace(/\D/g, "");
                                        const num = parseFloat(digits) / 100;
                                        setFormData({ ...formData, valor: formatBRL(num) });
                                    }}
                                />
                            </div>
                        </div>

                        <div className="form-group grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    <User size={12} /> Profissional Envolvido
                                </label>
                                <input
                                    type="text" required
                                    className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white p-2 rounded-lg text-sm focus:border-[var(--primary)] outline-none"
                                    placeholder="Nome do profissional"
                                    value={formData.profissional}
                                    onChange={e => setFormData({ ...formData, profissional: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    <Calendar size={12} /> Data da Ocorrência
                                </label>
                                <input
                                    type="date" required
                                    className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white p-2 rounded-lg text-sm focus:border-[var(--primary)] outline-none"
                                    value={formData.data}
                                    onFocus={(e) => (e.target as any).showPicker?.()}
                                    onChange={e => setFormData({ ...formData, data: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    Motivo / Observação
                                </label>
                                <textarea
                                    className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white p-2 rounded-lg text-sm focus:border-[var(--primary)] outline-none min-h-[80px]"
                                    placeholder="Ex: Quebra de caixa, falta injustificada..."
                                    value={formData.motivo}
                                    onChange={e => setFormData({ ...formData, motivo: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    Observação Interna (Oculta ao Cliente)
                                </label>
                                <textarea
                                    className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white p-2 rounded-lg text-sm focus:border-[var(--primary)] outline-none min-h-[60px]"
                                    placeholder="Notas para auditoria..."
                                    value={formData.observacaoInterna}
                                    onChange={e => setFormData({ ...formData, observacaoInterna: e.target.value })}
                                />
                            </div>
                            <div className="flex items-center gap-3 bg-[var(--bg-card-hover)] p-4 rounded-xl border border-[var(--border)] h-fit mt-5">
                                <input
                                    type="checkbox"
                                    id="repasse_desconto"
                                    className="w-5 h-5 accent-[var(--primary)] cursor-pointer"
                                    checked={formData.repasseProfissional}
                                    onChange={e => setFormData({ ...formData, repasseProfissional: e.target.checked })}
                                />
                                <label htmlFor="repasse_desconto" className="text-sm font-bold text-white cursor-pointer select-none">
                                    Aplicar no Repasse do Profissional
                                </label>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-4">
                        <button type="button" onClick={() => setShowModalDesconto(false)} className="btn btn-ghost text-sm">Cancelar</button>
                        <button type="submit" disabled={isSaving} className="btn btn-primary bg-amber-600 hover:bg-amber-700 min-w-[120px] h-10 flex items-center justify-center gap-2">
                            {isSaving ? <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
                            {editingId ? "Salvar Alterações" : "Salvar Desconto"}
                        </button>
                    </div>
                </form>
            </Modal>

            {/* MODAL NOVO ACRÉSCIMO */}
            <Modal isOpen={showModalAcrescimo} onClose={() => { setShowModalAcrescimo(false); resetForm(); }} title={editingId ? "Editar Acréscimo" : "Lançar Novo Acréscimo"} width="800px">
                <form onSubmit={handleSaveAcrescimo} className="space-y-6">
                    <div className="space-y-4 shadow-inner bg-[var(--bg-main)] p-4 rounded-xl border border-[var(--border)]">
                        <div className="form-group grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    <Building2 size={12} /> Empresa / Loja
                                </label>
                                <SearchableSelect
                                    options={clientes}
                                    value={formData.clienteId}
                                    placeholder="Selecione uma empresa..."
                                    onChange={(client) => setFormData({ ...formData, clienteId: client?.id || "" })}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    CNPJ
                                </label>
                                <div className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-[var(--fg-dim)] p-2.5 rounded-lg text-sm font-mono h-[38px] flex items-center">
                                    {clientes.find(c => c.id === formData.clienteId)?.cnpj || "-"}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    <DollarSign size={12} /> Valor do Acréscimo
                                </label>
                                <input
                                    type="text" required
                                    className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white p-2 rounded-lg text-sm focus:border-[var(--primary)] outline-none text-right font-mono"
                                    placeholder="0,00"
                                    value={formData.valor}
                                    onChange={e => {
                                        const digits = e.target.value.replace(/\D/g, "");
                                        const num = parseFloat(digits) / 100;
                                        setFormData({ ...formData, valor: formatBRL(num) });
                                    }}
                                />
                            </div>
                        </div>

                        <div className="form-group grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    <User size={12} /> Profissional Envolvido
                                </label>
                                <input
                                    type="text" required
                                    className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white p-2 rounded-lg text-sm focus:border-[var(--primary)] outline-none"
                                    placeholder="Nome do profissional"
                                    value={formData.profissional}
                                    onChange={e => setFormData({ ...formData, profissional: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    <Calendar size={12} /> Data da Ocorrência
                                </label>
                                <input
                                    type="date" required
                                    className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white p-2 rounded-lg text-sm focus:border-[var(--primary)] outline-none"
                                    value={formData.data}
                                    onFocus={(e) => (e.target as any).showPicker?.()}
                                    onChange={e => setFormData({ ...formData, data: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    Motivo / Observação
                                </label>
                                <textarea
                                    className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white p-2 rounded-lg text-sm focus:border-[var(--primary)] outline-none min-h-[80px]"
                                    placeholder="Descreva o motivo do acréscimo..."
                                    value={formData.motivo}
                                    onChange={e => setFormData({ ...formData, motivo: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    Observação Interna (Oculta ao Cliente)
                                </label>
                                <textarea
                                    className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white p-2 rounded-lg text-sm focus:border-[var(--primary)] outline-none min-h-[60px]"
                                    placeholder="Notas para auditoria..."
                                    value={formData.observacaoInterna}
                                    onChange={e => setFormData({ ...formData, observacaoInterna: e.target.value })}
                                />
                            </div>
                            <div className="flex items-center gap-3 bg-[var(--bg-card-hover)] p-4 rounded-xl border border-[var(--border)] h-fit mt-5">
                                <input
                                    type="checkbox"
                                    id="repasse_acrescimo"
                                    className="w-5 h-5 accent-[var(--primary)] cursor-pointer"
                                    checked={formData.repasseProfissional}
                                    onChange={e => setFormData({ ...formData, repasseProfissional: e.target.checked })}
                                />
                                <label htmlFor="repasse_acrescimo" className="text-sm font-bold text-white cursor-pointer select-none">
                                    Aplicar no Repasse do Profissional
                                </label>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-4">
                        <button type="button" onClick={() => setShowModalAcrescimo(false)} className="btn btn-ghost text-sm">Cancelar</button>
                        <button type="submit" disabled={isSaving} className="btn btn-primary min-w-[120px] h-10 flex items-center justify-center gap-2">
                            {isSaving ? <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
                            {editingId ? "Salvar Alterações" : "Salvar Acréscimo"}
                        </button>
                    </div>
                </form>
            </Modal>
            {/* MODAL DETALHES */}
            <Modal
                isOpen={showModalDetalhes}
                onClose={() => { setShowModalDetalhes(false); setSelectedAjuste(null); }}
                title={`Detalhes do ${selectedAjuste?.tipo === "DESCONTO" ? "Desconto" : "Acréscimo"}`}
                width="600px"
            >
                {selectedAjuste && (
                    <div className="space-y-6 p-2">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    <Building2 size={12} /> Empresa / Loja
                                </label>
                                <div className="text-sm font-bold text-white bg-[var(--bg-main)] p-3 rounded-lg border border-[var(--border)]">
                                    <div className="flex flex-col">
                                        <span className="text-white font-bold">{selectedAjuste.clientes?.nome_conta_azul}</span>
                                        <span className="text-[10px] text-[var(--fg-dim)] lowercase opacity-80 leading-tight">
                                            {selectedAjuste.clientes?.razao_social} • {selectedAjuste.clientes?.cnpj}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    <DollarSign size={12} /> Valor
                                </label>
                                <div className={`text-xl font-black p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-main)] ${selectedAjuste.tipo === "DESCONTO" ? "text-amber-500" : "text-[var(--primary)]"}`}>
                                    {fmtCurrency(selectedAjuste.valor)}
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    <User size={12} /> Profissional
                                </label>
                                <div className="text-sm text-white bg-[var(--bg-main)] p-3 rounded-lg border border-[var(--border)]">
                                    {selectedAjuste.nome_profissional || "-"}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                    <Calendar size={12} /> Data da Ocorrência
                                </label>
                                <div className="text-sm text-white bg-[var(--bg-main)] p-3 rounded-lg border border-[var(--border)] font-mono">
                                    {fmtDate(selectedAjuste.data_ocorrencia)}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                Motivo / Observação
                            </label>
                            <div className="text-sm text-white bg-[var(--bg-main)] p-4 rounded-lg border border-[var(--border)] min-h-[60px] whitespace-pre-wrap">
                                {selectedAjuste.motivo || "-"}
                            </div>
                        </div>

                        <div className="space-y-1 border-t border-[var(--border)] pt-4 mt-2">
                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                Informação Interna (Auditoria)
                            </label>
                            <div className="text-sm text-[var(--fg-dim)] bg-[var(--bg-card)] p-4 rounded-lg border border-dashed border-[var(--border)] min-h-[60px] italic">
                                {selectedAjuste.observacao_interna || "Nenhuma nota interna registrada."}
                            </div>
                        </div>

                        <div className="flex items-center gap-3 bg-[var(--bg-main)] p-4 rounded-xl border border-[var(--border)]">
                            <div className={`w-3 h-3 rounded-full ${selectedAjuste.repasse_profissional ? "bg-[var(--primary)] shadow-[0_0_10px_var(--primary)]" : "bg-[var(--fg-dim)]"}`}></div>
                            <span className="text-sm font-bold text-white">
                                {selectedAjuste.repasse_profissional ? "Impacta no Repasse do Profissional" : "Não impacta no Repasse do Profissional"}
                            </span>
                        </div>

                        <div className="flex justify-end pt-2">
                            <button onClick={() => { setShowModalDetalhes(false); setSelectedAjuste(null); }} className="btn btn-primary min-w-[120px]">
                                Fechar
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* MODAL PREVIEW BATCH */}
            <Modal
                isOpen={showPreview}
                onClose={() => { setShowPreview(false); setPendingAdjustments([]); }}
                title="Preview de Importação em Lote"
                width="1000px"
            >
                <div className="space-y-6">
                    <div className="bg-[var(--bg-main)] border border-[var(--border)] rounded-xl p-4 flex justify-between items-center shadow-inner">
                        <div className="flex gap-6">
                            <div className="flex flex-col">
                                <span className="text-[10px] uppercase font-black text-[var(--fg-dim)] tracking-widest">Total Identificado</span>
                                <span className="text-xl font-black text-white">{pendingAdjustments.length} itens</span>
                            </div>
                            <div className="flex flex-col border-l border-[var(--border)] pl-6">
                                <span className="text-[10px] uppercase font-black text-[var(--fg-dim)] tracking-widest">Válidos p/ Salvar</span>
                                <span className="text-xl font-black text-emerald-500">{pendingAdjustments.filter(p => p.status === "OK").length} itens</span>
                            </div>
                            <div className="flex flex-col border-l border-[var(--border)] pl-6">
                                <span className="text-[10px] uppercase font-black text-[var(--fg-dim)] tracking-widest">Valor Total</span>
                                <span className="text-xl font-black text-[var(--primary)]">
                                    {fmtCurrency(pendingAdjustments.filter(p => p.status === "OK").reduce((acc, curr) => acc + curr.valor, 0))}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="max-h-[500px] overflow-y-auto border border-[var(--border)] rounded-xl bg-[var(--bg-card)]">
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-[var(--bg-card)] shadow-sm z-10">
                                <tr className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest border-b border-[var(--border)]">
                                    <th className="p-4">Status</th>
                                    <th className="p-4">Cliente (Planilha)</th>
                                    <th className="p-4">Profissional</th>
                                    <th className="p-4">Tipo</th>
                                    <th className="p-4">Motivo</th>
                                    <th className="p-4 text-right">Valor</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pendingAdjustments.map((item) => (
                                    <tr key={item.id} className={`border-b border-[var(--border)]/50 ${item.status === 'ERROR' ? 'bg-red-500/5' : 'hover:bg-white/[0.02]'}`}>
                                        <td className="p-4">
                                            {item.status === "OK" ? (
                                                <div className="flex items-center gap-1.5 text-emerald-500 text-[10px] font-bold">
                                                    <CheckCircle2 size={14} /> OK
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1.5 text-red-500 text-[10px] font-bold" title={item.warning}>
                                                    <AlertTriangle size={14} /> Mismatch
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-col">
                                                <span className={`text-sm font-bold ${item.status === 'ERROR' ? 'text-red-400' : 'text-white'}`}>
                                                    {item.cliente_nome}
                                                </span>
                                                {item.status === 'ERROR' && (
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="text-[9px] text-red-500/80 font-medium uppercase tracking-tight">
                                                            ⚠️ {item.warning}
                                                        </span>
                                                        <a
                                                            href="/clientes"
                                                            target="_blank"
                                                            className="text-[9px] bg-red-500/10 hover:bg-red-500/20 text-red-400 px-2 py-0.5 rounded border border-red-500/20 transition-colors flex items-center gap-1 font-bold no-underline"
                                                        >
                                                            Fix Cadastro <Pencil size={8} />
                                                        </a>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className="text-xs text-white font-medium">{item.nome_profissional}</span>
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${item.tipo === 'DESCONTO' ? 'bg-amber-900/40 text-amber-500' : 'bg-primary/20 text-primary'}`}>
                                                {item.tipo}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-col">
                                                <div className="text-xs text-white max-w-[250px] truncate" title={item.motivo}>
                                                    {item.motivo}
                                                </div>
                                                {item.observacao_interna && (
                                                    <div className="text-[10px] text-[var(--fg-dim)] italic truncate max-w-[250px]">
                                                        {item.observacao_interna}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className={`p-4 text-right font-mono font-bold ${item.tipo === 'DESCONTO' ? 'text-amber-500' : 'text-[var(--primary)]'}`}>
                                            {fmtCurrency(item.valor)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex justify-between items-center pt-2">
                        <p className="text-[10px] text-[var(--fg-dim)] italic">
                            * Apenas itens marcados como <span className="text-emerald-500 font-bold">OK</span> serão salvos no banco.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => { setShowPreview(false); setPendingAdjustments([]); }}
                                className="btn btn-ghost"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleSaveBatch}
                                disabled={isSaving || pendingAdjustments.filter(p => p.status === "OK").length === 0}
                                className="btn btn-primary min-w-[180px] h-12 flex items-center justify-center gap-2 shadow-lg shadow-[var(--primary)]/20"
                            >
                                {isSaving ? <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : <Save size={20} />}
                                Salvar Ajustes no Banco
                            </button>
                        </div>
                    </div>
                </div>
            </Modal>
        </div >
    );
}
