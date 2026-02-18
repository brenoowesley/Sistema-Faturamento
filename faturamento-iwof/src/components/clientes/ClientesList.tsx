"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Search, ChevronLeft, ChevronRight } from "lucide-react";
import Modal from "@/components/Modal";
import { createClient } from "@/lib/supabase/client";

/* ---------- types ---------- */
interface Ciclo {
    id: string;
    nome: string;
}

interface Cliente {
    id: string;
    razao_social: string;
    nome_fantasia: string | null;
    nome: string | null;
    cnpj: string;
    cpf: string | null;
    inscricao_estadual: string | null;
    email_principal: string | null;
    email_contato: string | null;
    telefone_principal: string | null;
    cidade: string | null;
    estado: string | null;
    ciclo_faturamento_id: string | null;
    tempo_pagamento_dias: number;
    nome_conta_azul: string | null;
    boleto_unificado: boolean;
    status: boolean;
    ciclos_faturamento?: { nome: string } | null;
}

/* Render semicolon-separated emails as badge chips */
function EmailBadges({ value }: { value: string | null }) {
    if (!value) return <span className="text-[var(--fg-dim)]">—</span>;
    const emails = value.split(";").map((e) => e.trim()).filter(Boolean);
    if (emails.length === 0) return <span className="text-[var(--fg-dim)]">—</span>;
    return (
        <div className="flex flex-wrap gap-1">
            {emails.map((email, i) => (
                <span key={i} className="badge badge-info" style={{ fontSize: 11, padding: '2px 8px' }}>
                    {email}
                </span>
            ))}
        </div>
    );
}

const EMPTY_FORM = {
    razao_social: "",
    nome_fantasia: "",
    nome: "",
    cnpj: "",
    cpf: "",
    inscricao_estadual: "",
    email_principal: "",
    telefone_principal: "",
    cep: "",
    estado: "",
    cidade: "",
    endereco: "",
    numero: "",
    bairro: "",
    complemento: "",
    nome_contato: "",
    email_contato: "",
    nome_conta_azul: "",
    ciclo_faturamento_id: "",
    tempo_pagamento_dias: 30,
    boleto_unificado: false,
    emails_faturamento: "",
    status: true,
};

const PAGE_SIZE = 12;

export default function ClientesList() {
    const supabase = createClient();

    const [clientes, setClientes] = useState<Cliente[]>([]);
    const [ciclos, setCiclos] = useState<Ciclo[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(0);
    const [total, setTotal] = useState(0);

    /* modal */
    const [modalOpen, setModalOpen] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    /* fetch ciclos */
    useEffect(() => {
        supabase
            .from("ciclos_faturamento")
            .select("id, nome")
            .order("nome")
            .then(({ data }) => {
                if (data) setCiclos(data);
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* fetch clientes */
    const fetchClientes = useCallback(async () => {
        setLoading(true);
        let query = supabase
            .from("clientes")
            .select("*, ciclos_faturamento(nome)", { count: "exact" })
            .order("razao_social")
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (search.trim()) {
            query = query.or(
                `razao_social.ilike.%${search}%,cnpj.ilike.%${search}%,nome_fantasia.ilike.%${search}%,nome.ilike.%${search}%`
            );
        }

        const { data, count } = await query;
        setClientes((data as Cliente[]) ?? []);
        setTotal(count ?? 0);
        setLoading(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, search]);

    useEffect(() => {
        fetchClientes();
    }, [fetchClientes]);

    /* save */
    const handleSave = async () => {
        setSaving(true);
        const payload = {
            ...form,
            ciclo_faturamento_id: form.ciclo_faturamento_id || null,
        };
        await supabase.from("clientes").insert(payload);
        setSaving(false);
        setModalOpen(false);
        setForm(EMPTY_FORM);
        fetchClientes();
    };

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return (
        <div>
            {/* Toolbar */}
            <div className="table-toolbar">
                <div className="input-wrapper" style={{ maxWidth: 360 }}>
                    <Search size={18} className="input-icon" />
                    <input
                        className="input"
                        placeholder="Buscar por nome, razão social ou CNPJ..."
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setPage(0);
                        }}
                    />
                </div>
                <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
                    <Plus size={18} />
                    Novo Cliente
                </button>
            </div>

            {/* Table */}
            <div className="table-wrapper card">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Nome / Razão Social</th>
                            <th>CNPJ</th>
                            <th>Emails</th>
                            <th>Cidade / UF</th>
                            <th>Conta Azul</th>
                            <th>Ciclo</th>
                            <th>Tempo Pgto</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={8} className="table-empty">
                                    Carregando...
                                </td>
                            </tr>
                        ) : clientes.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="table-empty">
                                    Nenhum cliente encontrado
                                </td>
                            </tr>
                        ) : (
                            clientes.map((c) => (
                                <tr key={c.id}>
                                    <td>
                                        <span className="table-primary">
                                            {c.nome || c.razao_social}
                                        </span>
                                        {c.nome_fantasia && (
                                            <span className="table-secondary">
                                                {c.nome_fantasia}
                                            </span>
                                        )}
                                    </td>
                                    <td className="table-mono">{c.cnpj}</td>
                                    <td>
                                        <EmailBadges value={c.email_principal || c.email_contato} />
                                    </td>
                                    <td>
                                        <span className="text-sm text-[var(--fg-muted)]">
                                            {[c.cidade, c.estado]
                                                .filter(Boolean)
                                                .join(" / ") || "—"}
                                        </span>
                                    </td>
                                    <td>
                                        <span className="text-sm text-[var(--fg-muted)]">
                                            {c.nome_conta_azul || "—"}
                                        </span>
                                    </td>
                                    <td>
                                        <span className="badge badge-info">
                                            {c.ciclos_faturamento?.nome ?? "—"}
                                        </span>
                                    </td>
                                    <td>{c.tempo_pagamento_dias} dias</td>
                                    <td>
                                        <span
                                            className={`badge ${c.status ? "badge-success" : "badge-danger"}`}
                                        >
                                            {c.status ? "Ativo" : "Inativo"}
                                        </span>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="table-pagination">
                        <span className="table-pagination-info">
                            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de{" "}
                            {total}
                        </span>
                        <div className="table-pagination-controls">
                            <button
                                className="btn btn-ghost btn-sm"
                                disabled={page === 0}
                                onClick={() => setPage((p) => p - 1)}
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <button
                                className="btn btn-ghost btn-sm"
                                disabled={page >= totalPages - 1}
                                onClick={() => setPage((p) => p + 1)}
                            >
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Modal: Novo Cliente */}
            <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Novo Cliente" width="720px">
                <form
                    className="modal-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleSave();
                    }}
                >
                    {/* Identification */}
                    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-dim)] mb-1">
                        Identificação
                    </p>
                    <div className="form-grid">
                        <div className="input-group" style={{ gridColumn: "span 2" }}>
                            <label className="input-label">Razão Social *</label>
                            <input className="input" style={{ paddingLeft: 14 }} required
                                value={form.razao_social}
                                onChange={(e) => setForm({ ...form, razao_social: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Nome Fantasia</label>
                            <input className="input" style={{ paddingLeft: 14 }}
                                value={form.nome_fantasia}
                                onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Nome</label>
                            <input className="input" style={{ paddingLeft: 14 }}
                                value={form.nome}
                                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">CNPJ *</label>
                            <input className="input" style={{ paddingLeft: 14 }} required
                                value={form.cnpj}
                                onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">CPF</label>
                            <input className="input" style={{ paddingLeft: 14 }}
                                value={form.cpf}
                                onChange={(e) => setForm({ ...form, cpf: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Inscrição Estadual</label>
                            <input className="input" style={{ paddingLeft: 14 }}
                                value={form.inscricao_estadual}
                                onChange={(e) => setForm({ ...form, inscricao_estadual: e.target.value })}
                            />
                        </div>
                    </div>

                    {/* Contact */}
                    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-dim)] mt-4 mb-1">
                        Contato
                    </p>
                    <div className="form-grid">
                        <div className="input-group">
                            <label className="input-label">Email Principal</label>
                            <input className="input" style={{ paddingLeft: 14 }}
                                placeholder="email1@ex.com; email2@ex.com"
                                value={form.email_principal}
                                onChange={(e) => setForm({ ...form, email_principal: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Telefone Principal</label>
                            <input className="input" style={{ paddingLeft: 14 }}
                                value={form.telefone_principal}
                                onChange={(e) => setForm({ ...form, telefone_principal: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Nome Contato</label>
                            <input className="input" style={{ paddingLeft: 14 }}
                                value={form.nome_contato}
                                onChange={(e) => setForm({ ...form, nome_contato: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">E-mail Contato</label>
                            <input className="input" style={{ paddingLeft: 14 }}
                                placeholder="email1@ex.com; email2@ex.com"
                                value={form.email_contato}
                                onChange={(e) => setForm({ ...form, email_contato: e.target.value })}
                            />
                        </div>
                    </div>

                    {/* Address */}
                    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-dim)] mt-4 mb-1">
                        Endereço
                    </p>
                    <div className="form-grid">
                        <div className="input-group">
                            <label className="input-label">CEP</label>
                            <input className="input" style={{ paddingLeft: 14 }}
                                value={form.cep}
                                onChange={(e) => setForm({ ...form, cep: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Estado</label>
                            <input className="input" style={{ paddingLeft: 14 }} maxLength={2}
                                value={form.estado}
                                onChange={(e) => setForm({ ...form, estado: e.target.value.toUpperCase() })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Cidade</label>
                            <input className="input" style={{ paddingLeft: 14 }}
                                value={form.cidade}
                                onChange={(e) => setForm({ ...form, cidade: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Endereço</label>
                            <input className="input" style={{ paddingLeft: 14 }}
                                value={form.endereco}
                                onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Número</label>
                            <input className="input" style={{ paddingLeft: 14 }}
                                value={form.numero}
                                onChange={(e) => setForm({ ...form, numero: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Bairro</label>
                            <input className="input" style={{ paddingLeft: 14 }}
                                value={form.bairro}
                                onChange={(e) => setForm({ ...form, bairro: e.target.value })}
                            />
                        </div>
                    </div>

                    {/* Operational */}
                    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-dim)] mt-4 mb-1">
                        Operacional
                    </p>
                    <div className="form-grid">
                        <div className="input-group">
                            <label className="input-label">Ciclo de Faturamento</label>
                            <select className="input" style={{ paddingLeft: 14 }}
                                value={form.ciclo_faturamento_id}
                                onChange={(e) => setForm({ ...form, ciclo_faturamento_id: e.target.value })}
                            >
                                <option value="">Selecione...</option>
                                {ciclos.map((c) => (
                                    <option key={c.id} value={c.id}>{c.nome}</option>
                                ))}
                            </select>
                        </div>
                        <div className="input-group">
                            <label className="input-label">Tempo Pagamento (dias)</label>
                            <input className="input" style={{ paddingLeft: 14 }} type="number" min={0}
                                value={form.tempo_pagamento_dias}
                                onChange={(e) => setForm({ ...form, tempo_pagamento_dias: parseInt(e.target.value) || 0 })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Nome Conta Azul</label>
                            <input className="input" style={{ paddingLeft: 14 }}
                                value={form.nome_conta_azul}
                                onChange={(e) => setForm({ ...form, nome_conta_azul: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded accent-[var(--accent)]"
                                    checked={form.boleto_unificado}
                                    onChange={(e) => setForm({ ...form, boleto_unificado: e.target.checked })}
                                />
                                Boleto Unificado
                            </label>
                        </div>
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>
                            Cancelar
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? "Salvando..." : "Salvar Cliente"}
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
