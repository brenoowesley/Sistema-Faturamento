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
    Pencil
} from "lucide-react";
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
            .select("*, clientes(nome_fantasia, razao_social, nome_conta_azul)")
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

        const { error } = editingId
            ? await supabase.from("ajustes_faturamento").update(payload).eq("id", editingId)
            : await supabase.from("ajustes_faturamento").insert(payload);

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

        const { error } = editingId
            ? await supabase.from("ajustes_faturamento").update(payload).eq("id", editingId)
            : await supabase.from("ajustes_faturamento").insert(payload);

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
                            className="btn btn-primary bg-amber-600 hover:bg-amber-700 border-none flex items-center gap-2"
                        >
                            <Minus size={18} /> Lançar Novo Desconto
                        </button>
                        <button
                            onClick={() => { resetForm(); setShowModalAcrescimo(true); }}
                            className="btn btn-primary flex items-center gap-2"
                        >
                            <Plus size={18} /> Lançar Novo Acréscimo
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
                                        <div className="flex justify-between items-center bg-amber-950/20 p-4 rounded-xl border border-amber-900/30">
                                            <span className="text-amber-500 font-bold uppercase text-xs tracking-widest">Saldo Total Pendente</span>
                                            <span className="text-2xl font-black text-amber-500">{fmtCurrency(totalDescontos)}</span>
                                        </div>
                                        <div className="table-container">
                                            <table className="w-full">
                                                <thead>
                                                    <tr>
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
                                                            <td className="table-primary">{a.clientes?.nome_conta_azul || a.clientes?.nome_fantasia || a.clientes?.razao_social}</td>
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
                                        <div className="flex justify-between items-center bg-[var(--primary)]/10 p-4 rounded-xl border border-[var(--primary)]/20">
                                            <span className="text-[var(--primary)] font-bold uppercase text-xs tracking-widest">Saldo Total Pendente</span>
                                            <span className="text-2xl font-black text-[var(--primary)]">{fmtCurrency(totalAcrescimos)}</span>
                                        </div>
                                        <div className="table-container">
                                            <table className="w-full">
                                                <thead>
                                                    <tr>
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
                                                            <td className="table-primary">{a.clientes?.nome_conta_azul || a.clientes?.nome_fantasia || a.clientes?.razao_social}</td>
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
                                                        <td className="table-primary">{a.clientes?.nome_conta_azul || a.clientes?.nome_fantasia || a.clientes?.razao_social}</td>
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
                                    {selectedAjuste.clientes?.nome_conta_azul || selectedAjuste.clientes?.nome_fantasia || selectedAjuste.clientes?.razao_social}
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
        </div >
    );
}
