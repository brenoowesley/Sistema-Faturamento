"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, Package, Save, X, Percent } from "lucide-react";
import Modal from "@/components/Modal";
import { createClient } from "@/lib/supabase/client";

interface Produto {
    id: string;
    nome: string;
    porcentagem_nf: number;
    created_at: string;
    updated_at: string;
}

interface ProdutoForm {
    nome: string;
    porcentagem_nf: number;
}

const EMPTY_FORM: ProdutoForm = {
    nome: "",
    porcentagem_nf: 11.5,
};

export default function ProdutosPage() {
    const supabase = createClient();

    const [produtos, setProdutos] = useState<Produto[]>([]);
    const [loading, setLoading] = useState(true);

    const [modalOpen, setModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<ProdutoForm>(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    const [deleteTarget, setDeleteTarget] = useState<Produto | null>(null);
    const [deleting, setDeleting] = useState(false);

    const fetchProdutos = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from("produtos_faturamento")
            .select("*")
            .order("nome");

        if (error) console.error("Fetch error:", error);
        setProdutos((data as Produto[]) ?? []);
        setLoading(false);
    }, [supabase]);

    useEffect(() => {
        fetchProdutos();
    }, [fetchProdutos]);

    const openCreateModal = () => {
        setEditingId(null);
        setForm(EMPTY_FORM);
        setModalOpen(true);
    };

    const openEditModal = (p: Produto) => {
        setEditingId(p.id);
        setForm({ nome: p.nome, porcentagem_nf: p.porcentagem_nf });
        setModalOpen(true);
    };

    const handleSave = async () => {
        if (!form.nome.trim()) return;
        setSaving(true);

        const payload = {
            nome: form.nome.trim(),
            porcentagem_nf: form.porcentagem_nf,
        };

        if (editingId) {
            const { error } = await supabase
                .from("produtos_faturamento")
                .update(payload)
                .eq("id", editingId);
            if (error) console.error("Update error:", error);
        } else {
            const { error } = await supabase
                .from("produtos_faturamento")
                .insert(payload);
            if (error) console.error("Insert error:", error);
        }

        setSaving(false);
        setModalOpen(false);
        setEditingId(null);
        setForm(EMPTY_FORM);
        fetchProdutos();
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        const { error } = await supabase
            .from("produtos_faturamento")
            .delete()
            .eq("id", deleteTarget.id);
        if (error) console.error("Delete error:", error);
        setDeleting(false);
        setDeleteTarget(null);
        fetchProdutos();
    };

    const isEditing = editingId !== null;

    return (
        <>
            <div className="page-header">
                <h1 className="page-title">Produtos de Faturamento</h1>
                <p className="page-description">
                    Gerencie os produtos e suas respectivas porcentagens de NF/NC aplicadas no cálculo de faturamento dos clientes.
                </p>
            </div>

            {/* KPI Summary */}
            <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="card" style={{ borderLeft: "3px solid var(--accent)" }}>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-[var(--fg-dim)]">
                                Total Produtos
                            </p>
                            <p className="text-2xl font-bold mt-1 text-[var(--fg)]">
                                {produtos.length}
                            </p>
                        </div>
                        <Package size={28} style={{ color: "var(--accent)", opacity: 0.5 }} />
                    </div>
                </div>
                <div className="card" style={{ borderLeft: "3px solid #22c55e" }}>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-[var(--fg-dim)]">
                                Menor % NF
                            </p>
                            <p className="text-2xl font-bold mt-1 text-emerald-500">
                                {produtos.length > 0 ? `${Math.min(...produtos.map(p => p.porcentagem_nf))}%` : "—"}
                            </p>
                        </div>
                        <Percent size={28} style={{ color: "#22c55e", opacity: 0.5 }} />
                    </div>
                </div>
                <div className="card" style={{ borderLeft: "3px solid #f59e0b" }}>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-[var(--fg-dim)]">
                                Maior % NF
                            </p>
                            <p className="text-2xl font-bold mt-1 text-amber-500">
                                {produtos.length > 0 ? `${Math.max(...produtos.map(p => p.porcentagem_nf))}%` : "—"}
                            </p>
                        </div>
                        <Percent size={28} style={{ color: "#f59e0b", opacity: 0.5 }} />
                    </div>
                </div>
            </div>

            {/* Toolbar */}
            <div className="table-toolbar">
                <div />
                <button className="btn btn-primary" onClick={openCreateModal}>
                    <Plus size={18} />
                    Novo Produto
                </button>
            </div>

            {/* Table */}
            <div className="table-wrapper card">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Nome do Produto</th>
                            <th style={{ width: 160 }}>% Nota Fiscal</th>
                            <th style={{ width: 160 }}>% Nota de Crédito</th>
                            <th style={{ width: 200 }}>Última Atualização</th>
                            <th style={{ width: 100 }}>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={5} className="table-empty">
                                    Carregando...
                                </td>
                            </tr>
                        ) : produtos.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="table-empty">
                                    Nenhum produto cadastrado
                                </td>
                            </tr>
                        ) : (
                            produtos.map((p) => (
                                <tr key={p.id} className="cursor-pointer hover:bg-[var(--bg-hover)]" onClick={() => openEditModal(p)}>
                                    <td>
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="w-9 h-9 rounded-xl flex items-center justify-center"
                                                style={{
                                                    background: `rgba(33,118,255,${0.08 + (p.porcentagem_nf / 100) * 0.2})`,
                                                    color: "var(--accent)",
                                                }}
                                            >
                                                <Package size={18} />
                                            </div>
                                            <span className="table-primary font-bold">{p.nome}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <span
                                            className="badge"
                                            style={{
                                                background: "rgba(33,118,255,0.12)",
                                                color: "var(--accent)",
                                                border: "1px solid rgba(33,118,255,0.25)",
                                                fontSize: 13,
                                                fontWeight: 700,
                                            }}
                                        >
                                            {p.porcentagem_nf}%
                                        </span>
                                    </td>
                                    <td>
                                        <span
                                            className="badge"
                                            style={{
                                                background: "rgba(34,197,94,0.12)",
                                                color: "#22c55e",
                                                border: "1px solid rgba(34,197,94,0.25)",
                                                fontSize: 13,
                                                fontWeight: 700,
                                            }}
                                        >
                                            {(100 - p.porcentagem_nf).toFixed(1)}%
                                        </span>
                                    </td>
                                    <td className="text-sm text-[var(--fg-muted)]">
                                        {new Date(p.updated_at).toLocaleString("pt-BR")}
                                    </td>
                                    <td>
                                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                            <button className="btn-icon" title="Editar" onClick={() => openEditModal(p)}>
                                                <Pencil className="icon-high-contrast" size={14} />
                                            </button>
                                            <button className="btn-icon btn-icon-danger" title="Excluir" onClick={() => setDeleteTarget(p)}>
                                                <Trash2 className="icon-high-contrast" size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Create / Edit Modal */}
            <Modal
                isOpen={modalOpen}
                onClose={() => { setModalOpen(false); setEditingId(null); setForm(EMPTY_FORM); }}
                title={isEditing ? "Editar Produto" : "Novo Produto"}
                width="480px"
            >
                <form
                    className="modal-form"
                    onSubmit={(e) => { e.preventDefault(); handleSave(); }}
                >
                    <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
                        <div className="input-group">
                            <label className="input-label">Nome do Produto *</label>
                            <input
                                className="input"
                                style={{ paddingLeft: 14 }}
                                required
                                placeholder="Ex: iWof Prime"
                                value={form.nome}
                                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Porcentagem NF (%)</label>
                            <div style={{ position: "relative" }}>
                                <input
                                    className="input"
                                    style={{ paddingLeft: 14, paddingRight: 40 }}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="100"
                                    required
                                    value={form.porcentagem_nf}
                                    onChange={(e) => setForm({ ...form, porcentagem_nf: parseFloat(e.target.value) || 0 })}
                                />
                                <span
                                    style={{
                                        position: "absolute",
                                        right: 14,
                                        top: "50%",
                                        transform: "translateY(-50%)",
                                        color: "var(--fg-dim)",
                                        fontWeight: 600,
                                        fontSize: 14,
                                    }}
                                >
                                    %
                                </span>
                            </div>
                            <p className="text-xs text-[var(--fg-dim)] mt-2">
                                A Nota de Crédito será automaticamente <strong>{(100 - (form.porcentagem_nf || 0)).toFixed(1)}%</strong> do valor base faturável.
                            </p>
                        </div>
                    </div>

                    {/* Preview */}
                    <div
                        className="mt-4 p-4 rounded-xl"
                        style={{
                            background: "var(--bg-main)",
                            border: "1px solid var(--border)",
                        }}
                    >
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--fg-dim)] mb-3">Preview de Distribuição</p>
                        <div className="flex gap-3">
                            <div className="flex-1 rounded-lg p-3 text-center" style={{ background: "rgba(33,118,255,0.1)", border: "1px solid rgba(33,118,255,0.2)" }}>
                                <p className="text-[10px] font-bold text-[var(--accent)] uppercase tracking-wider">Nota Fiscal</p>
                                <p className="text-xl font-black text-[var(--accent)] mt-1">{form.porcentagem_nf || 0}%</p>
                            </div>
                            <div className="flex-1 rounded-lg p-3 text-center" style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)" }}>
                                <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Nota de Crédito</p>
                                <p className="text-xl font-black text-emerald-500 mt-1">{(100 - (form.porcentagem_nf || 0)).toFixed(1)}%</p>
                            </div>
                        </div>
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={() => { setModalOpen(false); setEditingId(null); setForm(EMPTY_FORM); }}>
                            <X size={16} /> Cancelar
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            <Save size={16} /> {saving ? "Salvando..." : isEditing ? "Atualizar Produto" : "Salvar Produto"}
                        </button>
                    </div>
                </form>
            </Modal>

            {/* Delete Confirm Modal */}
            <Modal
                isOpen={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                title="Confirmar Exclusão"
                width="480px"
            >
                <div className="p-1">
                    <p className="text-sm text-[var(--fg-muted)] mb-4">
                        Tem certeza que deseja excluir o produto{" "}
                        <strong className="text-[var(--fg)]">{deleteTarget?.nome}</strong>?
                    </p>
                    <p className="text-xs text-[var(--fg-dim)] mb-2">
                        Clientes vinculados a este produto terão o campo de produto esvaziado (retornando ao padrão de 11,5%).
                    </p>
                    <p className="text-xs text-[var(--danger)] mb-5">
                        Esta ação não pode ser desfeita.
                    </p>
                    <div className="modal-actions">
                        <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>
                            Cancelar
                        </button>
                        <button
                            className="btn"
                            style={{ background: "var(--danger)", color: "white" }}
                            disabled={deleting}
                            onClick={handleDelete}
                        >
                            {deleting ? "Excluindo..." : "Excluir Produto"}
                        </button>
                    </div>
                </div>
            </Modal>
        </>
    );
}
