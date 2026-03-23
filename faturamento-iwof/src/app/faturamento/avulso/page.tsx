"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import {
    FileCode2,
    FileText,
    ChevronLeft,
    Trash2,
    Plus,
    CheckCircle2,
    Building2,
    DollarSign,
    Calendar,
    ChevronDown,
    Search
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/* ================================================================
   TIPAGENS
   ================================================================ */

interface ClienteDB {
    id: string;
    razao_social: string;
    nome_fantasia: string | null;
    nome_conta_azul: string | null;
    cnpj: string;
}

interface NCRecord {
    id: string;
    cliente_id: string;
    valor: string; // Mascarado (BRL)
    competencia: string; // MM/YYYY ou YYYY-MM
    data_emissao: string;
    motivo: string;
}

interface HCAgendamento {
    id: string;
    nome_profissional: string;
    data_plantao: string;
    vaga: string;
    valor_plantao: string; // Mascarado (BRL)
}

interface HCRecord {
    id: string;
    cliente_id: string;
    valor_bruto: string;
    valor_liquido: string;
    data_vencimento: string;
    competencia: string;
    agendamentos: HCAgendamento[];
}

type Mode = "SELECAO" | "NC" | "HC";

/* ================================================================
   UTILS
   ================================================================ */

const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(val);
};

const parseBRLString = (val: string) => {
    const digits = val.replace(/\D/g, "");
    const num = parseFloat(digits) / 100;
    return isNaN(num) ? 0 : num;
};

const applyBRLMask = (val: string) => {
    const num = parseBRLString(val);
    return formatBRL(num);
};

/* ================================================================
   SUB-COMPONENT: SEARCHABLE SELECT (ISOLADO PARA ESTA PÁGINA)
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
        <div className="relative w-full" ref={containerRef}>
            <div
                className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-white p-2.5 rounded-lg text-sm focus-within:border-[var(--primary)] outline-none cursor-pointer flex justify-between items-center transition-colors"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className={selectedOption ? "text-white font-medium" : "text-[var(--fg-dim)]"}>
                    {selectedOption ? (selectedOption.nome_conta_azul || selectedOption.nome_fantasia || selectedOption.razao_social) : placeholder}
                </span>
                <ChevronDown size={16} className={`text-[var(--fg-dim)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
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
                                    <div className="font-bold text-sm">{option.nome_conta_azul || option.nome_fantasia || option.razao_social}</div>
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
   PÁGINA PRINCIPAL
   ================================================================ */

export default function FaturamentoAvulsoPage() {
    const supabase = createClient();
    const [mode, setMode] = useState<Mode>("SELECAO");
    const [clientes, setClientes] = useState<ClienteDB[]>([]);
    const [loadingClientes, setLoadingClientes] = useState(true);

    // States - NC
    const [ncs, setNcs] = useState<NCRecord[]>([]);

    // States - HC
    const [hcs, setHcs] = useState<HCRecord[]>([]);

    // Load Clientes
    useEffect(() => {
        const fetchClientes = async () => {
            const { data, error } = await supabase
                .from("clientes")
                .select("id, razao_social, nome_fantasia, nome_conta_azul, cnpj")
                .eq("status", true)
                .order("nome_conta_azul", { ascending: true });

            if (!error && data) setClientes(data);
            setLoadingClientes(false);
        };
        fetchClientes();
    }, [supabase]);

    /* --- INIT NC --- */
    const startNC = () => {
        setMode("NC");
        setNcs([{
            id: crypto.randomUUID(),
            cliente_id: "",
            valor: "0,00",
            competencia: "",
            data_emissao: new Date().toISOString().split("T")[0],
            motivo: ""
        }]);
    };

    const addNC = () => {
        setNcs(prev => [...prev, {
            id: crypto.randomUUID(),
            cliente_id: "",
            valor: "0,00",
            competencia: "",
            data_emissao: new Date().toISOString().split("T")[0],
            motivo: ""
        }]);
    };

    const removeNC = (id: string) => {
        setNcs(prev => prev.filter(n => n.id !== id));
    };

    const updateNC = (id: string, field: keyof NCRecord, val: string) => {
        setNcs(prev => prev.map(n => n.id === id ? { ...n, [field]: val } : n));
    };

    /* --- INIT HC --- */
    const startHC = () => {
        setMode("HC");
        setHcs([{
            id: crypto.randomUUID(),
            cliente_id: "",
            valor_bruto: "0,00",
            valor_liquido: "0,00",
            competencia: "",
            data_vencimento: new Date().toISOString().split("T")[0],
            agendamentos: []
        }]);
    };

    const addHC = () => {
        setHcs(prev => [...prev, {
            id: crypto.randomUUID(),
            cliente_id: "",
            valor_bruto: "0,00",
            valor_liquido: "0,00",
            competencia: "",
            data_vencimento: new Date().toISOString().split("T")[0],
            agendamentos: []
        }]);
    };

    const removeHC = (id: string) => {
        setHcs(prev => prev.filter(h => h.id !== id));
    };

    const updateHC = (id: string, field: keyof HCRecord, val: string) => {
        setHcs(prev => prev.map(h => h.id === id ? { ...h, [field]: val } : h));
    };

    const addAgendamento = (hcId: string) => {
        setHcs(prev => prev.map(h => {
            if (h.id === hcId) {
                return {
                    ...h,
                    agendamentos: [...h.agendamentos, {
                        id: crypto.randomUUID(),
                        nome_profissional: "",
                        data_plantao: "",
                        vaga: "",
                        valor_plantao: "0,00"
                    }]
                };
            }
            return h;
        }));
    };

    const removeAgendamento = (hcId: string, agId: string) => {
        setHcs(prev => prev.map(h => {
            if (h.id === hcId) {
                return { ...h, agendamentos: h.agendamentos.filter(a => a.id !== agId) };
            }
            return h;
        }));
    };

    const updateAgendamento = (hcId: string, agId: string, field: keyof HCAgendamento, val: string) => {
        setHcs(prev => prev.map(h => {
            if (h.id === hcId) {
                return {
                    ...h,
                    agendamentos: h.agendamentos.map(a => a.id === agId ? { ...a, [field]: val } : a)
                };
            }
            return h;
        }));
    };

    /* --- SUBMITION LOGIC --- */
    const handleSubmitAction = () => {
        if (mode === "NC") {
            const invalidItem = ncs.find(n => !n.cliente_id || parseBRLString(n.valor) <= 0);
            if (invalidItem) {
                alert("Verifique se todas as NCs possuem um cliente selecionado e um valor maior que zero.");
                return;
            }

            const payload = ncs.map(n => ({
                cliente_id: n.cliente_id,
                valor_nc: parseBRLString(n.valor),
                competencia: n.competencia,
                data_emissao: n.data_emissao,
                motivo: n.motivo
            }));

            console.log("PAYLOAD_ENVIAR_NC_AVULSA:", JSON.stringify(payload, null, 2));
            alert("Notas de Crédito submetidas com sucesso! (Veja o console para Payload API)");
            setMode("SELECAO");
            setNcs([]);
        }

        if (mode === "HC") {
            const invalidHC = hcs.find(h => !h.cliente_id || parseBRLString(h.valor_liquido) <= 0);
            if (invalidHC) {
                alert("Verifique se todas as Faturas (HC) possuem cliente selecionado e valor líquido maior que zero.");
                return;
            }
            
            const payload = hcs.map(h => ({
                cliente_id: h.cliente_id,
                valor_bruto: parseBRLString(h.valor_bruto),
                valor_liquido: parseBRLString(h.valor_liquido),
                competencia: h.competencia,
                data_vencimento: h.data_vencimento,
                agendamentos: h.agendamentos.map(a => ({
                    nome_profissional: a.nome_profissional,
                    data_plantao: a.data_plantao,
                    vaga: a.vaga,
                    valor_plantao: parseBRLString(a.valor_plantao)
                }))
            }));

            console.log("PAYLOAD_ENVIAR_HC_AVULSA:", JSON.stringify(payload, null, 2));
            alert("Faturas / Honorários submetidos com sucesso! (Veja o console para Payload API)");
            setMode("SELECAO");
            setHcs([]);
        }
    };

    /* --- RENDER HELPERS --- */
    const totalNCValue = ncs.reduce((acc, curr) => acc + parseBRLString(curr.valor), 0);
    const totalHCValue = hcs.reduce((acc, curr) => acc + parseBRLString(curr.valor_liquido), 0);
    const totalItems = mode === "NC" ? ncs.length : hcs.length;

    return (
        <div className="min-h-screen bg-[var(--bg-main)] p-8 pb-32">
            <div className="max-w-5xl mx-auto space-y-8">
                
                {mode === "SELECAO" ? (
                    <Link
                        href="/faturamento/novo"
                        className="btn btn-ghost text-[var(--fg-dim)] hover:text-white flex items-center gap-2 pl-0 hover:bg-transparent"
                    >
                        <ChevronLeft size={20} /> Voltar para o Faturamento
                    </Link>
                ) : (
                    <button
                        onClick={() => setMode("SELECAO")}
                        className="btn btn-ghost text-[var(--fg-dim)] hover:text-white flex items-center gap-2 pl-0 hover:bg-transparent"
                    >
                        <ChevronLeft size={20} /> Voltar para Seleção
                    </button>
                )}

                <div className="flex justify-between items-center bg-[var(--bg-card)] p-6 rounded-2xl border border-[var(--border)] shadow-xl relative overflow-hidden">
                    <div className="relative z-10">
                        <h1 className="text-2xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
                            {mode === "SELECAO" ? <FileText className="text-[var(--primary)]" size={28} /> : 
                             mode === "NC" ? <FileCode2 className="text-amber-500" size={28} /> :
                             <FileText className="text-blue-500" size={28} />}
                            Emissão Avulsa ({mode === "SELECAO" ? "Novo Protocolo" : mode})
                        </h1>
                        <p className="text-[var(--fg-dim)] text-sm mt-1">
                            {mode === "SELECAO" ? "Selecione o tipo de documento que deseja emitir manualmente." :
                             mode === "NC" ? "Preencha os dados das Notas de Crédito isoladas abaixo." :
                             "Preencha os cabeçalhos das faturas e os arrays de plantão."}
                        </p>
                    </div>
                </div>

                {/* VISÃO: SELEÇÃO */}
                {mode === "SELECAO" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-12">
                        <div
                            onClick={startNC}
                            className="group cursor-pointer bg-[var(--bg-card)] border border-[var(--border)] hover:border-amber-500/50 p-8 flex flex-col items-center justify-center gap-4 rounded-2xl transition-all shadow-lg hover:shadow-amber-500/10 hover:-translate-y-1"
                        >
                            <div className="w-20 h-20 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 group-hover:scale-110 transition-transform">
                                <FileCode2 size={40} />
                            </div>
                            <h2 className="text-xl font-black text-white">Nota de Crédito (NC)</h2>
                            <p className="text-[var(--fg-dim)] text-center text-sm px-6">Emissão isolada de crédito para descontos ou conciliação em faturamento futuro.</p>
                        </div>
                        <div
                            onClick={startHC}
                            className="group cursor-pointer bg-[var(--bg-card)] border border-[var(--border)] hover:border-blue-500/50 p-8 flex flex-col items-center justify-center gap-4 rounded-2xl transition-all shadow-lg hover:shadow-blue-500/10 hover:-translate-y-1"
                        >
                            <div className="w-20 h-20 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform">
                                <FileText size={40} />
                            </div>
                            <h2 className="text-xl font-black text-white">Fatura / Honorário (HC)</h2>
                            <p className="text-[var(--fg-dim)] text-center text-sm px-6">Emissão avulsa de fatura com composição sub-aninhada de agendamentos e prestadores.</p>
                        </div>
                    </div>
                )}

                {/* VISÃO: NC */}
                {mode === "NC" && (
                    <div className="space-y-6">
                        {ncs.map((nc, idx) => {
                            const selectedClient = clientes.find(c => c.id === nc.cliente_id);
                            return (
                                <div key={nc.id} className="bg-[var(--bg-card)] p-6 rounded-2xl border border-[var(--border)] shadow-md flex flex-col gap-6 relative">
                                    <div className="absolute top-4 right-4 text-[10px] font-black uppercase text-[var(--fg-dim)] tracking-widest bg-[var(--bg-main)] px-3 py-1 rounded-full border border-[var(--border)]">
                                        Bloco NC #{idx + 1}
                                    </div>
                                    {/* Busca Cliente */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                                <Building2 size={12} /> Cliente / Empresa Alvo
                                            </label>
                                            <SearchableSelect
                                                options={clientes}
                                                value={nc.cliente_id}
                                                placeholder={loadingClientes ? "Carregando..." : "Buscar empresa..."}
                                                onChange={(client) => updateNC(nc.id, "cliente_id", client?.id || "")}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                                Dados Preenchidos
                                            </label>
                                            <div className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-white p-3 rounded-lg text-sm min-h-[44px] flex items-center">
                                                {selectedClient ? (
                                                    <span className="truncate text-xs opacity-80">
                                                        <b className="text-white opacity-100">{selectedClient.razao_social}</b> • CNPJ: {selectedClient.cnpj}
                                                    </span>
                                                ) : <span className="text-[var(--fg-dim)] italic text-xs">Pendente...</span>}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Campos Inserção */}
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 rounded-xl bg-[var(--bg-main)] border border border-[var(--border)]">
                                        <div className="space-y-1">
                                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-1">
                                                <DollarSign size={12} /> Valor Emissão (NC)
                                            </label>
                                            <input
                                                type="text"
                                                className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-amber-500 font-bold p-2.5 rounded-lg text-sm focus:border-amber-500 outline-none"
                                                placeholder="R$ 0,00"
                                                value={nc.valor}
                                                onChange={e => updateNC(nc.id, "valor", applyBRLMask(e.target.value))}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-1">
                                                <Calendar size={12} /> Competência
                                            </label>
                                            <input
                                                type="month"
                                                className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white p-2.5 rounded-lg text-sm focus:border-[var(--primary)] outline-none"
                                                value={nc.competencia}
                                                onChange={e => updateNC(nc.id, "competencia", e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-1">
                                                <Calendar size={12} /> Emissão Prevista
                                            </label>
                                            <input
                                                type="date"
                                                className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white p-2.5 rounded-lg text-sm focus:border-[var(--primary)] outline-none"
                                                value={nc.data_emissao}
                                                onChange={e => updateNC(nc.id, "data_emissao", e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-1">
                                                Motivo / Obs
                                            </label>
                                            <input
                                                type="text"
                                                className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white p-2.5 rounded-lg text-sm focus:border-[var(--primary)] outline-none"
                                                placeholder="Descrição livre"
                                                value={nc.motivo}
                                                onChange={e => updateNC(nc.id, "motivo", e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    {/* Deletar Row */}
                                    <div className="flex justify-end mt-2">
                                        <button onClick={() => removeNC(nc.id)} className="text-[var(--danger)] hover:text-red-400 flex items-center gap-2 text-xs font-bold transition-colors">
                                            <Trash2 size={14} /> Excluir NC
                                        </button>
                                    </div>
                                </div>
                            );
                        })}

                        <button onClick={addNC} className="w-full border-2 border-dashed border-[var(--border)] hover:border-amber-500/50 hover:bg-[var(--bg-card)] rounded-xl py-6 flex flex-col items-center justify-center gap-2 text-[var(--fg-dim)] hover:text-amber-500 transition-colors font-bold uppercase text-xs tracking-widest">
                            <Plus size={20} />
                            Adicionar Nova NC
                        </button>
                    </div>
                )}

                {/* VISÃO: HC */}
                {mode === "HC" && (
                    <div className="space-y-8">
                        {hcs.map((hc, idx) => {
                            const selectedClient = clientes.find(c => c.id === hc.cliente_id);
                            return (
                                <div key={hc.id} className="bg-[var(--bg-card)] p-0 rounded-2xl border border-[var(--border)] shadow-md overflow-hidden relative">
                                    <div className="bg-blue-900/10 p-6 border-b border-[var(--border)] flex flex-col gap-6 relative">
                                        <div className="absolute top-4 right-4 text-[10px] font-black uppercase text-blue-400 tracking-widest bg-[var(--bg-main)] px-3 py-1 rounded-full border border-blue-900/30">
                                            Cabeçalho HC #{idx + 1}
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-[80%]">
                                            <div className="space-y-2">
                                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                                    <Building2 size={12} /> Cliente / Empresa Alvo
                                                </label>
                                                <SearchableSelect
                                                    options={clientes}
                                                    value={hc.cliente_id}
                                                    placeholder={loadingClientes ? "Carregando..." : "Buscar empresa..."}
                                                    onChange={(client) => updateHC(hc.id, "cliente_id", client?.id || "")}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-2">
                                                    Dados Preenchidos
                                                </label>
                                                <div className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-white p-3 rounded-lg text-sm min-h-[44px] flex items-center">
                                                    {selectedClient ? (
                                                        <span className="truncate text-xs opacity-80">
                                                            <b className="text-white opacity-100">{selectedClient.razao_social}</b> • CNPJ: {selectedClient.cnpj}
                                                        </span>
                                                    ) : <span className="text-[var(--fg-dim)] italic text-xs">Pendente...</span>}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-xl bg-[var(--bg-main)] shadow-inner border border-[var(--border)]">
                                            <div className="space-y-1">
                                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-1">
                                                    <DollarSign size={12} /> Vlr. Bruto
                                                </label>
                                                <input
                                                    type="text"
                                                    className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white font-medium p-2.5 rounded-lg text-sm focus:border-blue-500 outline-none"
                                                    placeholder="R$ 0,00"
                                                    value={hc.valor_bruto}
                                                    onChange={e => updateHC(hc.id, "valor_bruto", applyBRLMask(e.target.value))}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-1">
                                                    <DollarSign size={12} /> Vlr. Líquido
                                                </label>
                                                <input
                                                    type="text"
                                                    className="w-full bg-[var(--bg-card)] border border-blue-500/50 text-blue-400 font-bold p-2.5 rounded-lg text-sm focus:border-blue-500 outline-none bg-blue-900/5"
                                                    placeholder="R$ 0,00"
                                                    value={hc.valor_liquido}
                                                    onChange={e => updateHC(hc.id, "valor_liquido", applyBRLMask(e.target.value))}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-1">
                                                    <Calendar size={12} /> Comp.
                                                </label>
                                                <input
                                                    type="month"
                                                    className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white p-2.5 rounded-lg text-sm focus:border-[var(--primary)] outline-none"
                                                    value={hc.competencia}
                                                    onChange={e => updateHC(hc.id, "competencia", e.target.value)}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest flex items-center gap-1">
                                                    <Calendar size={12} /> Venc.
                                                </label>
                                                <input
                                                    type="date"
                                                    className="w-full bg-[var(--bg-card)] border border-[var(--border)] text-white p-2.5 rounded-lg text-sm focus:border-[var(--primary)] outline-none"
                                                    value={hc.data_vencimento}
                                                    onChange={e => updateHC(hc.id, "data_vencimento", e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* AGENDAMENTOS MAPPING */}
                                    <div className="p-6 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-sm font-bold text-white uppercase tracking-widest">({hc.agendamentos.length}) Agendamentos</h3>
                                        </div>
                                        {hc.agendamentos.length > 0 && (
                                            <div className="overflow-x-auto border border-[var(--border)] rounded-lg">
                                                <table className="w-full min-w-[700px]">
                                                    <thead className="bg-[#1e293b]">
                                                        <tr className="text-left text-[10px] font-bold uppercase text-[var(--fg-dim)] tracking-widest border-b border-[var(--border)]">
                                                            <th className="p-3 w-[30%]">Profissional / Nome</th>
                                                            <th className="p-3 w-[20%]">Data Plantão</th>
                                                            <th className="p-3 w-[20%]">Vaga / Função</th>
                                                            <th className="p-3 w-[20%]">Valor Faturado</th>
                                                            <th className="p-3 w-[10%] text-right">Ação</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {hc.agendamentos.map(ag => (
                                                            <tr key={ag.id} className="border-b border-[#1e293b]/50 hover:bg-[#1e293b]/20">
                                                                <td className="p-2">
                                                                    <input
                                                                        className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-white p-2 text-sm rounded outline-none"
                                                                        placeholder="Nome do prestador"
                                                                        value={ag.nome_profissional}
                                                                        onChange={e => updateAgendamento(hc.id, ag.id, "nome_profissional", e.target.value)}
                                                                    />
                                                                </td>
                                                                <td className="p-2">
                                                                    <input
                                                                        type="date"
                                                                        className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-white p-2 text-sm rounded outline-none"
                                                                        value={ag.data_plantao}
                                                                        onChange={e => updateAgendamento(hc.id, ag.id, "data_plantao", e.target.value)}
                                                                    />
                                                                </td>
                                                                <td className="p-2">
                                                                    <input
                                                                        className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-white p-2 text-sm rounded outline-none"
                                                                        placeholder="Função (Ex: Técnico)"
                                                                        value={ag.vaga}
                                                                        onChange={e => updateAgendamento(hc.id, ag.id, "vaga", e.target.value)}
                                                                    />
                                                                </td>
                                                                <td className="p-2">
                                                                    <input
                                                                        className="w-full bg-[var(--bg-main)] border border-[var(--border)] text-white p-2 text-sm rounded outline-none font-mono"
                                                                        placeholder="R$ 0,00"
                                                                        value={ag.valor_plantao}
                                                                        onChange={e => updateAgendamento(hc.id, ag.id, "valor_plantao", applyBRLMask(e.target.value))}
                                                                    />
                                                                </td>
                                                                <td className="p-2 text-right">
                                                                    <button onClick={() => removeAgendamento(hc.id, ag.id)} className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-md transition-colors">
                                                                        <Trash2 size={16} />
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                        <button onClick={() => addAgendamento(hc.id)} className="w-full bg-[#1e293b]/50 border border-dashed border-[#1e293b] hover:bg-[#1e293b] hover:border-blue-500/50 rounded-lg py-3 flex items-center justify-center gap-2 text-blue-400 font-bold uppercase text-xs tracking-widest transition-colors mb-2">
                                            <Plus size={16} /> Adicionar Plantão/Item
                                        </button>

                                        {/* Deletar Row */}
                                        <div className="flex justify-end pt-4 border-t border-[var(--border)]">
                                            <button onClick={() => removeHC(hc.id)} className="text-[var(--danger)] hover:text-red-400 flex items-center gap-2 text-xs font-bold transition-colors bg-red-500/10 px-4 py-2 rounded-lg border border-red-500/20">
                                                <Trash2 size={14} /> Excluir Fatura Avulsa
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        <button onClick={addHC} className="w-full border-2 border-dashed border-[var(--border)] hover:border-blue-500/50 hover:bg-[var(--bg-card)] rounded-xl py-6 flex flex-col items-center justify-center gap-2 text-[var(--fg-dim)] hover:text-blue-500 transition-colors font-bold uppercase text-xs tracking-widest">
                            <Plus size={20} />
                            Adicionar Nova Fatura/HC
                        </button>
                    </div>
                )}
            </div>

            {/* STICKY FOOTER PARA SUBMIT */}
            {mode !== "SELECAO" && (
                <div className="fixed bottom-0 left-0 w-full bg-[var(--bg-card)] border-t border-[var(--border)] shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-50 animate-in slide-in-from-bottom flex justify-center py-4 px-8">
                    <div className="w-full max-w-5xl flex items-center justify-between">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] uppercase font-bold text-[var(--fg-dim)] tracking-widest">Resumo Operação de {mode}</span>
                            <span className="text-lg font-black text-white flex gap-4">
                                <span>{totalItems} item(s) vinculados</span>
                                <span className="opacity-50">|</span>
                                <span className={mode === "NC" ? "text-amber-500" : "text-blue-500"}>
                                   Soma Líquida: {formatBRL(mode === "NC" ? totalNCValue : totalHCValue)}
                                </span>
                            </span>
                        </div>
                        <button 
                            onClick={handleSubmitAction}
                            disabled={totalItems === 0}
                            className={`btn btn-primary min-w-[200px] h-14 flex items-center justify-center gap-3 font-bold uppercase tracking-wider text-sm shadow-[0_0_20px_var(--primary-glow)] disabled:opacity-50 ${mode === "NC" ? "bg-amber-600 hover:bg-amber-700 shadow-amber-500/20" : "bg-blue-600 hover:bg-blue-700 shadow-blue-500/20"}`}
                        >
                            <CheckCircle2 size={20} />
                            Confirmar Emissão {mode}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
