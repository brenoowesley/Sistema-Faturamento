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
    AlertTriangle,
    FileText,
    FileArchive,
    Filter
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import Modal from "@/components/Modal";
import { RelatorioTemplate } from "./RelatorioTemplate";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import JSZip from "jszip";

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
    const [activeMainTab, setActiveMainTab] = useState<"gestao" | "relatorios">("gestao");
    const [activeTab, setActiveTab] = useState<"descontos" | "acrescimos" | "historico">("descontos");
    const [ajustes, setAjustes] = useState<Ajuste[]>([]);
    const [clientes, setClientes] = useState<ClienteDB[]>([]);
    const [loading, setLoading] = useState(true);

    // Relatorios State
    const [ciclosOptions, setCiclosOptions] = useState<{ id: string, nome: string }[]>([]);
    const [razoesSociais, setRazoesSociais] = useState<string[]>([]);
    const [filtroCiclo, setFiltroCiclo] = useState("");
    const [filtroRazaoSocial, setFiltroRazaoSocial] = useState("");
    const [filtroMesAno, setFiltroMesAno] = useState(new Date().toISOString().substring(0, 7));
    const [relatoriosData, setRelatoriosData] = useState<any[]>([]);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
    const [isGeneratingZip, setIsGeneratingZip] = useState(false);

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
    const [userRole, setUserRole] = useState("USER");
    const isAdminOrAprovador = userRole === "ADMIN" || userRole === "APROVADOR";

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

    // Filtros
    const [filterDataInicio, setFilterDataInicio] = useState("");
    const [filterDataFim, setFilterDataFim] = useState("");
    const [filterClienteId, setFilterClienteId] = useState("");
    const [filterSearchText, setFilterSearchText] = useState("");
    const [filterDateType, setFilterDateType] = useState<"ocorrencia" | "aplicacao">("aplicacao");

    const applyFilters = useCallback((lista: Ajuste[]) => {
        return lista.filter(item => {
            if (filterClienteId && item.cliente_id !== filterClienteId) return false;
            
            // Filtro por termo de busca (Razão Social / Nome Fantasia / CNPJ)
            if (filterSearchText) {
                const search = filterSearchText.toLowerCase();
                const match = (item.clientes?.nome_conta_azul || "").toLowerCase().includes(search) ||
                              (item.clientes?.razao_social || "").toLowerCase().includes(search) ||
                              (item.clientes?.cnpj || "").includes(search) ||
                              (item.nome_profissional || "").toLowerCase().includes(search);
                if (!match) return false;
            }

            // Filtro por Data (Ocorrência ou Aplicação)
            const dateToCompare = filterDateType === "aplicacao" ? item.data_aplicacao : item.data_ocorrencia;
            if (filterDataInicio || filterDataFim) {
                if (!dateToCompare) return false; // Se está filtrando por data e o item não tem a data selecionada
                const dateOnly = dateToCompare.split("T")[0];
                if (filterDataInicio && dateOnly < filterDataInicio) return false;
                if (filterDataFim && dateOnly > filterDataFim) return false;
            }

            return true;
        });
    }, [filterClienteId, filterDataInicio, filterDataFim, filterSearchText, filterDateType]);

    const handleExportXLSX = () => {
        const targetLista = activeTab === "descontos" ? descontosPendentes 
                          : activeTab === "acrescimos" ? acrescimosPendentes 
                          : historico;
                          
        // Se houver seleção manual (Checkboxes), exporta apenas os selecionados.
        // Caso contrário, exporta a lista filtrada da aba ativa.
        const dataToExport = selectedIds.size > 0 
            ? targetLista.filter(item => selectedIds.has(item.id))
            : targetLista;
                          
        if (dataToExport.length === 0) {
            alert("Nenhum dado para exportar com os filtros ou seleção atual.");
            return;
        }

        const exportData = dataToExport.map(item => ({
            "Profissional": item.nome_profissional || "-",
            "Empresa (Conta Azul)": item.clientes?.nome_conta_azul || "-",
            "Razão Social": item.clientes?.razao_social || "-",
            "CNPJ": item.clientes?.cnpj || "-",
            "Valor": item.valor,
            "Status": item.status_aplicacao ? "Aplicado" : "Pendente",
            "Data da aplicação": item.data_aplicacao ? fmtDate(item.data_aplicacao) : "-",
            "Data da ocorrência": fmtDate(item.data_ocorrencia),
            "Tipo": item.tipo,
            "Motivo": item.motivo || "-",
            "Obs Interna": item.observacao_interna || "-",
            "Lote": item.lote_aplicado_id || "-"
        }));

        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Ajustes");
        const today = new Date().toISOString().split("T")[0];
        const tabName = activeTab.charAt(0).toUpperCase() + activeTab.slice(1);
        XLSX.writeFile(wb, `Relatorio_Ajustes_${tabName}_${today}.xlsx`);
    };

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

        if (!error && data) {
            setClientes(data);
            const uniqueRazoes = Array.from(new Set(data.map(c => c.razao_social).filter(Boolean)));
            setRazoesSociais(uniqueRazoes.sort());
        }
    }, [supabase]);

    const fetchCiclos = useCallback(async () => {
        const { data } = await supabase.from("ciclos_faturamento").select("id, nome").order("nome");
        if (data) setCiclosOptions(data);
    }, [supabase]);

    useEffect(() => {
        fetchAjustes();
        fetchClientes();
        fetchCiclos();
        const fetchRole = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data } = await supabase.from("usuarios_perfis").select("cargo").eq("id", user.id).single();
                if (data?.cargo) setUserRole(data.cargo);
            }
        };
        fetchRole();
    }, [fetchAjustes, fetchClientes, supabase]);

    const handleSaveDesconto = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);

        const payload: any = {
            cliente_id: formData.clienteId,
            tipo: "DESCONTO",
            valor: parseBRL(formData.valor),
            nome_profissional: formData.profissional,
            motivo: formData.motivo,
            data_ocorrencia: formData.data,
            observacao_interna: formData.observacaoInterna,
            repasse_profissional: formData.repasseProfissional
        };

        if (editingId) {
            payload.id = editingId;
        } else {
            payload.status_aplicacao = false;
        }

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

        const payload: any = {
            cliente_id: formData.clienteId,
            tipo: "ACRESCIMO",
            valor: parseBRL(formData.valor),
            nome_profissional: formData.profissional,
            motivo: formData.motivo,
            data_ocorrencia: formData.data,
            observacao_interna: formData.observacaoInterna,
            repasse_profissional: formData.repasseProfissional
        };

        if (editingId) {
            payload.id = editingId;
        } else {
            payload.status_aplicacao = false;
        }

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

    const handleRevertToPending = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(`Deseja realmente voltar os ${selectedIds.size} itens selecionados para pendente?`)) return;

        setIsSaving(true);
        try {
            const { error } = await supabase
                .from("ajustes_faturamento")
                .update({ status_aplicacao: false, data_aplicacao: null, lote_aplicado_id: null })
                .in("id", Array.from(selectedIds));

            if (error) throw error;

            alert(`${selectedIds.size} itens voltaram para pendentes com sucesso!`);
            setSelectedIds(new Set());
            fetchAjustes();
        } catch (err: any) {
            console.error("Error reverting items:", err);
            alert("Erro ao reverter itens: " + err.message);
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

    // REPORTS GENERATION LOGIC
    const handleBuscarRelatorios = async () => {
        if (!filtroRazaoSocial) {
            alert("Selecione um Agrupador (Empresa/Razão Social) para buscar os relatórios.");
            return;
        }

        setLoading(true);
        let query = supabase
            .from("faturamento_consolidados")
            .select(`
                *,
                faturamentos_lote ( data_inicio_ciclo, data_fim_ciclo ),
                clientes!inner ( id, razao_social, nome_fantasia, cnpj, ciclo_faturamento_id, ciclos_faturamento (nome) )
            `)
            .eq("clientes.razao_social", filtroRazaoSocial)
            .eq("status", "FECHADO");

        if (filtroCiclo) query = query.eq("clientes.ciclo_faturamento_id", filtroCiclo);

        const { data, error } = await query;
        if (error) {
            console.error("Erro buscar relatorios", error);
            alert("Erro ao buscar dados consolidados: " + error.message);
        } else {
            const yearMonth = filtroMesAno;
            const finalData = data.filter((d: any) => {
                const dataAvaliada = d.data_competencia || d.created_at;
                return dataAvaliada && dataAvaliada.startsWith(yearMonth);
            });

            const validData = finalData.map((d: any) => ({
                ...d,
                valor_bruto: Number(d.valor_bruto || 0),
                acrescimos: Number(d.acrescimos || 0),
                descontos: Number(d.descontos || 0),
                valor_liquido_boleto: Number(d.valor_liquido_boleto || 0)
            })).sort((a,b) => (a.clientes?.nome_fantasia || "").localeCompare(b.clientes?.nome_fantasia || ""));

            setRelatoriosData(validData);
            if (validData.length === 0) alert("Nenhuma loja processada encontrada neste Agrupador para a competência informada.");
        }
        setLoading(false);
    };

    const generatePdfBlobForStore = async (lojaId: string) => {
        const el = document.getElementById(`pdf-content-${lojaId}`);
        if (!el) throw new Error("Template not found for " + lojaId);
        
        el.style.left = "0px";
        el.style.top = "0px";
        el.style.zIndex = "-10";
        el.style.opacity = "1";

        const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false });
        
        el.style.left = "-9999px";
        
        const imgData = canvas.toDataURL("image/png");
        const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
        pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
        
        return pdf.output("blob");
    };

    const gerarRelatorioZip = async () => {
        if (relatoriosData.length === 0) return;
        setIsGeneratingZip(true);
        try {
            const zip = new JSZip();
            for (const rel of relatoriosData) {
                const blob = await generatePdfBlobForStore(rel.clientes?.id);
                const rawName = rel.clientes?.nome_fantasia || rel.clientes?.razao_social || "Loja";
                const cleanName = rawName.replace(/[^a-zA-Z0-9_-]/g, '_');
                const fileName = `Relatorio_${cleanName}_${filtroMesAno}.pdf`;
                zip.file(fileName, blob);
            }
            const content = await zip.generateAsync({ type: "blob" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(content);
            link.download = `Relatorios_${filtroRazaoSocial.replace(/[^a-zA-Z0-9_-]/g, '_')}_${filtroMesAno}.zip`;
            link.click();
        } catch (e: any) {
            console.error(e);
            alert("Erro na geração do ZIP");
        } finally {
            setIsGeneratingZip(false);
        }
    };

    const gerarRelatorioUnificado = async () => {
        if (relatoriosData.length === 0) return;
        setIsGeneratingPdf(true);
        try {
            const unifiedPdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
            
            for (let i = 0; i < relatoriosData.length; i++) {
                const rel = relatoriosData[i];
                const el = document.getElementById(`pdf-content-${rel.clientes?.id}`);
                if (!el) continue;
                
                el.style.left = "0px";
                el.style.top = "0px";
                el.style.zIndex = "-10";
                
                const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false });
                
                el.style.left = "-9999px";
                
                const imgData = canvas.toDataURL("image/png");
                const pdfWidth = unifiedPdf.internal.pageSize.getWidth();
                const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
                
                if (i > 0) unifiedPdf.addPage();
                unifiedPdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
            }
            
            unifiedPdf.save(`Relatorio_Unificado_${filtroRazaoSocial.replace(/[^a-zA-Z0-9_-]/g, '_')}_${filtroMesAno}.pdf`);
        } catch (e) {
            console.error(e);
            alert("Erro na geração do PDF Único");
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    // Filtered data
    const descontosPendentes = applyFilters(ajustes.filter(a => a.tipo === "DESCONTO" && !a.status_aplicacao));
    const acrescimosPendentes = applyFilters(ajustes.filter(a => a.tipo === "ACRESCIMO" && !a.status_aplicacao));
    const historico = applyFilters(ajustes.filter(a => a.status_aplicacao));

    const totalDescontos = descontosPendentes.reduce((acc, curr) => acc + curr.valor, 0);
    const totalAcrescimos = acrescimosPendentes.reduce((acc, curr) => acc + curr.valor, 0);

    return (
        <div className="min-h-screen bg-[var(--bg-main)] p-8 overflow-hidden">
            <div className="max-w-7xl mx-auto space-y-8 relative">

                {/* GLOBAL TABS VIEW */}
                <div className="flex gap-4 mb-4 border-b border-[var(--border)] pb-4">
                    <button
                        onClick={() => setActiveMainTab("gestao")}
                        className={`text-lg font-bold uppercase tracking-wider px-6 py-3 rounded-lg transition-all flex items-center gap-2 ${activeMainTab === 'gestao' ? 'bg-[var(--primary)] text-white shadow-[0_0_15px_var(--primary)]' : 'text-[var(--fg-dim)] hover:bg-[var(--bg-card)] hover:text-white'}`}
                    >
                        <History size={20} /> Gestão de Ajustes
                    </button>
                    <button
                        onClick={() => setActiveMainTab("relatorios")}
                        className={`text-lg font-bold uppercase tracking-wider px-6 py-3 rounded-lg transition-all flex items-center gap-2 ${activeMainTab === 'relatorios' ? 'bg-indigo-600 text-white shadow-[0_0_15px_rgba(79,70,229,0.5)]' : 'text-[var(--fg-dim)] hover:bg-[var(--bg-card)] hover:text-white'}`}
                    >
                        <FileText size={20} /> Central de Relatórios
                    </button>
                </div>

                {activeMainTab === "gestao" && (
                    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-200">
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

                {/* Filtros Container */}
                <div className="bg-[var(--bg-card)] p-5 rounded-2xl border border-[var(--border)] shadow-xl flex flex-col gap-6 relative z-10">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                        
                        {/* Busca Texto */}
                        <div className="md:col-span-3">
                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest mb-2 block flex items-center gap-2">
                                <Search size={12} /> Busca Rápida
                            </label>
                            <div className="relative">
                                <Search className="absolute left-3 top-3 text-[var(--fg-dim)]" size={14} />
                                <input
                                    type="text"
                                    className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-white pl-9 pr-4 py-2.5 rounded-xl text-sm focus:border-[var(--primary)] outline-none transition-all placeholder:text-[var(--fg-dim)]/50"
                                    placeholder="Razão, Profissional, CNPJ..."
                                    value={filterSearchText}
                                    onChange={e => setFilterSearchText(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Dropdown de Clientes */}
                        <div className="md:col-span-3">
                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest mb-2 block">Filtrar por Loja</label>
                            <SearchableSelect
                                options={clientes}
                                value={filterClienteId}
                                placeholder="Todas as lojas..."
                                onChange={(client) => setFilterClienteId(client?.id || "")}
                            />
                        </div>

                        {/* Tipo de Filtro de Data */}
                        <div className="md:col-span-2">
                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest mb-2 block">Filtrar por</label>
                            <select
                                className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-white p-2.5 rounded-xl text-sm focus:border-[var(--primary)] outline-none appearance-none cursor-pointer"
                                value={filterDateType}
                                onChange={e => setFilterDateType(e.target.value as any)}
                            >
                                <option value="aplicacao">📅 Data de Aplicação</option>
                                <option value="ocorrencia">⏲️ Data de Ocorrência</option>
                            </select>
                        </div>

                        {/* Data Inicial */}
                        <div className="md:col-span-2">
                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest mb-2 block">Início</label>
                            <input
                                type="date"
                                className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-white p-2.5 rounded-xl text-sm focus:border-[var(--primary)] outline-none transition-all"
                                value={filterDataInicio}
                                onFocus={(e) => (e.target as any).showPicker?.()}
                                onChange={e => setFilterDataInicio(e.target.value)}
                            />
                        </div>

                        {/* Data Final */}
                        <div className="md:col-span-2">
                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest mb-2 block">Fim</label>
                            <input
                                type="date"
                                className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-white p-2.5 rounded-xl text-sm focus:border-[var(--primary)] outline-none transition-all"
                                value={filterDataFim}
                                onFocus={(e) => (e.target as any).showPicker?.()}
                                onChange={e => setFilterDataFim(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="flex justify-between items-center border-t border-[var(--border)] pt-4 mt-2">
                        <div className="flex gap-2">
                            <span className="bg-[var(--bg-main)] px-3 py-1.5 rounded-lg border border-[var(--border)] text-[10px] font-bold text-[var(--fg-dim)] uppercase tracking-wider">
                                {descontosPendentes.length + acrescimosPendentes.length + historico.length} registros encontrados
                            </span>
                            {selectedIds.size > 0 && (
                                <span className="bg-[var(--primary)]/20 px-3 py-1.5 rounded-lg border border-[var(--primary)]/30 text-[10px] font-bold text-[var(--primary)] uppercase tracking-wider animate-pulse">
                                    {selectedIds.size} selecionados
                                </span>
                            )}
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => { setFilterClienteId(""); setFilterDataInicio(""); setFilterDataFim(""); setFilterSearchText(""); setFilterDateType("aplicacao"); setSelectedIds(new Set()); }}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-[var(--fg-dim)] hover:text-white transition-colors"
                            >
                                <X size={16} /> Limpar Filtros
                            </button>
                            <button
                                onClick={handleExportXLSX}
                                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-900/20 transition-all border border-emerald-500/20"
                            >
                                <Upload size={16} className="rotate-180" /> 
                                {selectedIds.size > 0 ? `Exportar Seleção (${selectedIds.size})` : "Exportar Relatório XLSX"}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden shadow-lg">
                    <div className="flex border-b border-[var(--border)] bg-[var(--bg-card-hover)]">
                        <button
                            onClick={() => { setActiveTab("descontos"); setSelectedIds(new Set()); }}
                            className={`px-8 py-4 text-sm font-bold uppercase tracking-widest transition-all ${activeTab === 'descontos' ? 'text-[var(--primary)] border-b-2 border-[var(--primary)] bg-[var(--bg-card)]' : 'text-[var(--fg-dim)] hover:text-white'}`}
                        >
                            Descontos Pendentes
                        </button>
                        <button
                            onClick={() => { setActiveTab("acrescimos"); setSelectedIds(new Set()); }}
                            className={`px-8 py-4 text-sm font-bold uppercase tracking-widest transition-all ${activeTab === 'acrescimos' ? 'text-[var(--primary)] border-b-2 border-[var(--primary)] bg-[var(--bg-card)]' : 'text-[var(--fg-dim)] hover:text-white'}`}
                        >
                            Acréscimos Pendentes
                        </button>
                        <button
                            onClick={() => { setActiveTab("historico"); setSelectedIds(new Set()); }}
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
                                                {isAdminOrAprovador && selectedIds.size > 0 && (
                                                    <button
                                                        onClick={handleBulkDelete}
                                                        className="btn btn-danger w-full bg-red-600 hover:bg-red-700 flex items-center justify-center gap-2 h-10 rounded-xl transition-all"
                                                    >
                                                        <Trash2 size={16} /> Excluir {selectedIds.size} selecionados
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="table-container max-h-[500px] overflow-y-auto relative">
                                            <table className="w-full">
                                                <thead className="sticky top-0 bg-[var(--bg-card)] shadow-sm z-10">
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
                                                                    {isAdminOrAprovador && (
                                                                        <>
                                                                            <button onClick={(e) => { e.stopPropagation(); handleEdit(a); }} title="Editar" className="btn btn-ghost btn-xs text-[var(--primary)]">
                                                                                <Pencil size={14} />
                                                                            </button>
                                                                            <button onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }} title="Excluir" className="btn btn-ghost btn-xs text-[var(--danger)]">
                                                                                <Trash2 size={14} />
                                                                            </button>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                    {descontosPendentes.length === 0 && (
                                                        <tr>
                                                            <td colSpan={6} className="text-center py-10 text-[var(--fg-dim)]">Nenhum desconto encontrado com os filtros atuais.</td>
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
                                                {isAdminOrAprovador && selectedIds.size > 0 && (
                                                    <button
                                                        onClick={handleBulkDelete}
                                                        className="btn btn-danger w-full bg-red-600 hover:bg-red-700 flex items-center justify-center gap-2 h-10 rounded-xl transition-all"
                                                    >
                                                        <Trash2 size={16} /> Excluir {selectedIds.size} selecionados
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="table-container max-h-[500px] overflow-y-auto relative">
                                            <table className="w-full">
                                                <thead className="sticky top-0 bg-[var(--bg-card)] shadow-sm z-10">
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
                                                                    {isAdminOrAprovador && (
                                                                        <>
                                                                            <button onClick={(e) => { e.stopPropagation(); handleEdit(a); }} title="Editar" className="btn btn-ghost btn-xs text-[var(--primary)]">
                                                                                <Pencil size={14} />
                                                                            </button>
                                                                            <button onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }} title="Excluir" className="btn btn-ghost btn-xs text-[var(--danger)]">
                                                                                <Trash2 size={14} />
                                                                            </button>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                    {acrescimosPendentes.length === 0 && (
                                                        <tr>
                                                            <td colSpan={6} className="text-center py-10 text-[var(--fg-dim)]">Nenhum acréscimo encontrado com os filtros atuais.</td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}

                                {activeTab === "historico" && (
                                    <div className="space-y-4">
                                        <div className="flex justify-end min-h-[40px]">
                                            {isAdminOrAprovador && selectedIds.size > 0 && (
                                                <button
                                                    onClick={handleRevertToPending}
                                                    className="btn btn-warning bg-amber-500 hover:bg-amber-600 text-amber-950 flex items-center justify-center gap-2 h-10 rounded-lg transition-all font-bold px-6"
                                                    disabled={isSaving}
                                                >
                                                    {isSaving ? <span className="loading loading-spinner loading-xs"></span> : <History size={16} />}
                                                    Voltar {selectedIds.size} para Pendentes
                                                </button>
                                            )}
                                        </div>
                                        <div className="table-container max-h-[500px] overflow-y-auto relative">
                                            <table className="w-full">
                                                <thead className="sticky top-0 bg-[var(--bg-card)] shadow-sm z-10">
                                                    <tr>
                                                        <th className="w-10">
                                                            <input
                                                                type="checkbox"
                                                                className="checkbox checkbox-xs"
                                                                checked={selectedIds.size === historico.length && historico.length > 0}
                                                                onChange={() => toggleAll(historico.map(a => a.id))}
                                                            />
                                                        </th>
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
                                                            <td>
                                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${a.tipo === 'DESCONTO' ? 'bg-amber-900/40 text-amber-500' : 'bg-primary/20 text-[var(--primary)]'}`}>
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
                                                            <td colSpan={7} className="text-center py-10 text-[var(--fg-dim)]">Nenhum registro encontrado com os filtros atuais.</td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
                </div>
                )}

                {activeMainTab === "relatorios" && (
                    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center bg-[var(--bg-card)] p-6 rounded-2xl border border-[var(--border)] shadow-xl">
                            <div>
                                <h1 className="text-2xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
                                    <FileText className="text-indigo-500" size={28} />
                                    Relatórios de Faturamento
                                </h1>
                                <p className="text-[var(--fg-dim)] text-sm mt-1">
                                    Gere extratos detalhados consolidados em layout profissional PDF para entregar aos seus clientes.
                                </p>
                            </div>
                        </div>

                        {/* Filtros da Central de Relatórios */}
                        <div className="bg-[var(--bg-card)] p-5 rounded-2xl border border-[var(--border)] shadow-xl flex flex-col gap-6">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest mb-2 block">Agrupador (Razão Social)</label>
                                    <select
                                        className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-white p-2.5 rounded-xl text-sm outline-none focus:border-indigo-500"
                                        value={filtroRazaoSocial}
                                        onChange={e => setFiltroRazaoSocial(e.target.value)}
                                    >
                                        <option value="">Selecione uma Empresa-Mãe...</option>
                                        {razoesSociais.map(r => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest mb-2 block">Competência</label>
                                    <input
                                        type="month"
                                        className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-white p-2.5 rounded-xl text-sm outline-none focus:border-indigo-500"
                                        value={filtroMesAno}
                                        onChange={e => setFiltroMesAno(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest mb-2 block">Ciclo Escopo (Opcional)</label>
                                    <select
                                        className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-white p-2.5 rounded-xl text-sm outline-none focus:border-indigo-500"
                                        value={filtroCiclo}
                                        onChange={e => setFiltroCiclo(e.target.value)}
                                    >
                                        <option value="">Todos os Ciclos</option>
                                        {ciclosOptions.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <button 
                                        onClick={handleBuscarRelatorios}
                                        disabled={loading}
                                        className="btn bg-indigo-600 hover:bg-indigo-700 w-full rounded-xl border-none text-white font-bold h-[42px] flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/20"
                                    >
                                        {loading ? <span className="loading loading-spinner loading-sm"></span> : <Search size={18} />}
                                        Buscar Faturados
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Tabela Intermediária e Ações */}
                        {relatoriosData.length > 0 && (
                            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden shadow-xl animate-in slide-in-from-bottom-4">
                                <div className="p-6 border-b border-[var(--border)] bg-indigo-900/10 flex justify-between items-center">
                                    <div>
                                        <h3 className="text-white font-black text-lg">Prévia do Pacote</h3>
                                        <p className="text-[var(--fg-dim)] text-sm">{relatoriosData.length} unidades encontradas desta Raiz.</p>
                                    </div>
                                    <div className="flex gap-4">
                                        <button 
                                            onClick={gerarRelatorioZip}
                                            disabled={isGeneratingZip || isGeneratingPdf}
                                            className="btn bg-amber-600 hover:bg-amber-700 text-white rounded-xl border-none flex items-center gap-2 transition-all"
                                        >
                                            {isGeneratingZip ? <span className="loading loading-spinner loading-sm"></span> : <FileArchive size={18} />}
                                            Baixar ZIP Separado
                                        </button>
                                        <button 
                                            onClick={gerarRelatorioUnificado}
                                            disabled={isGeneratingPdf || isGeneratingZip}
                                            className="btn bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl border-none flex items-center gap-2 transition-all"
                                        >
                                            {isGeneratingPdf ? <span className="loading loading-spinner loading-sm"></span> : <FileText size={18} />}
                                            Gerar PDF Unificado
                                        </button>
                                    </div>
                                </div>

                                <div className="max-h-[500px] overflow-y-auto">
                                    <table className="w-full">
                                        <thead className="sticky top-0 bg-[var(--bg-card)] shadow-sm z-10 border-b border-[var(--border)]">
                                            <tr>
                                                <th className="py-3 px-4 text-left text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest">Loja / Fantasia</th>
                                                <th className="py-3 px-4 text-left text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest">CNPJ</th>
                                                <th className="py-3 px-4 text-right text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest">Acréscimos</th>
                                                <th className="py-3 px-4 text-right text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest">Descontos</th>
                                                <th className="py-3 px-4 text-right text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest">Líquido Final</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {relatoriosData.map((r, i) => (
                                                <tr key={i} className="hover:bg-white/[0.02] border-b border-[var(--border)]/30">
                                                    <td className="py-3 px-4 text-sm font-bold text-white">{r.clientes?.nome_fantasia || r.clientes?.razao_social}</td>
                                                    <td className="py-3 px-4 text-sm font-mono text-[var(--fg-dim)]">{r.clientes?.cnpj}</td>
                                                    <td className="py-3 px-4 text-sm font-mono text-right text-emerald-500">+{fmtCurrency(r.acrescimos)}</td>
                                                    <td className="py-3 px-4 text-sm font-mono text-right text-red-500">-{fmtCurrency(r.descontos)}</td>
                                                    <td className="py-3 px-4 text-sm font-mono text-right font-black text-white">{fmtCurrency(r.valor_liquido_boleto)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Templates Ocultos */}
                        <div className="absolute top-0 left-[-9999px] print:hidden -z-50 pointer-events-none opacity-0">
                            {relatoriosData.map(rel => (
                                <RelatorioTemplate
                                    key={rel.id}
                                    lojaId={rel.clientes?.id}
                                    razaoSocial={rel.clientes?.razao_social}
                                    nomeFantasia={rel.clientes?.nome_fantasia}
                                    cnpj={rel.clientes?.cnpj}
                                    competencia={filtroMesAno}
                                    ciclo={rel.clientes?.ciclos_faturamento?.nome || "-"}
                                    valorBruto={rel.valor_bruto}
                                    acrescimos={rel.acrescimos}
                                    descontos={rel.descontos}
                                    valorLiquido={rel.valor_liquido_boleto}
                                    observacaoReport={rel.observacao_report}
                                />
                            ))}
                        </div>
                    </div>
                )}
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
